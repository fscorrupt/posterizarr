"""Scheduled Plex image cleanup inspired by Kometa-Team/ImageMaid.

Selected-artwork protection adapts ImageMaid's MIT-licensed cleanup helpers.
Attribution and the upstream license are in docs/plex_image_cleanup.md.
"""

import os
import re
import json
import logging
import shutil
import sqlite3
import sys
import tempfile
import time
import uuid
import zipfile
from contextlib import closing
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse
from xml.etree.ElementTree import fromstring

import httpx
from PIL import Image


ARTWORK_COLUMNS = (
    "user_thumb_url", "user_art_url", "user_banner_url",
    "user_clear_logo_url", "user_square_art_url",
)
logger = logging.getLogger(__name__)
_cleanup_running = False
MAX_DATABASE_BYTES = 20 * 1024 * 1024 * 1024


def is_cleanup_running():
    return _cleanup_running


def cleanup_schedule_options(data):
    path = str(data.get("plex_data_path") or "").strip()
    if not path or not Path(path).is_absolute():
        raise ValueError("Plex image cleanup requires an absolute Plex data-directory path")
    action = data.get("cleanup_action", "report")
    source = data.get("database_source", "plex")
    if action not in ("report", "quarantine", "remove"):
        raise ValueError("Image cleanup action must be report, quarantine, or remove")
    if source not in ("plex", "local"):
        raise ValueError("Image cleanup database source must be plex or local")
    age = data.get("minimum_age_days", 7)
    if isinstance(age, bool) or not str(age).isdigit() or not 1 <= int(age) <= 3650:
        raise ValueError("Image cleanup grace period must be between 1 and 3650 whole days")
    confirmed = data.get("confirm_image_removal") is True
    if action == "remove" and not confirmed:
        raise ValueError("Permanent image removal requires explicit confirmation")
    return {"plex_data_path": path, "cleanup_action": action, "database_source": source,
            "minimum_age_days": int(age), "confirm_image_removal": confirmed}


def selected_artwork(connection):
    columns = {row[1] for row in connection.execute("PRAGMA table_info(metadata_items)")}
    if not {"user_thumb_url", "user_art_url"}.issubset(columns):
        raise ValueError("Unsupported Plex metadata schema; image cleanup aborted")
    if not connection.execute("SELECT 1 FROM metadata_items LIMIT 1").fetchone():
        raise ValueError("Plex metadata database is empty; image cleanup aborted")
    selected = set()
    for column in ARTWORK_COLUMNS:
        if column not in columns:
            continue
        for row in connection.execute(f"SELECT {column} FROM metadata_items WHERE {column} IS NOT NULL"):
            address = urlparse(str(row[0]))
            if address.scheme in ("upload", "metadata"):
                filename = Path(unquote(address.path)).name.lower()
                selected.update((filename, Path(filename).stem))
    return selected


def image_cleanup_candidates(metadata_dir, selected, minimum_age_days=7, now=None):
    root = Path(metadata_dir).resolve(strict=True)
    if root.name != "Metadata" or not root.is_dir():
        raise ValueError("Cleanup must be confined to the Plex Metadata directory")
    minimum_age_days = int(minimum_age_days)
    if minimum_age_days < 1:
        raise ValueError("Image cleanup requires an age grace period of at least one day")
    cutoff = (time.time() if now is None else now) - minimum_age_days * 86400
    candidates = []
    for parent, directories, filenames in os.walk(root, followlinks=False):
        directories[:] = [
            name for name in directories
            if name != "Contents" and not (Path(parent).name == "Uploads" and name == "themes")
            and not Path(parent, name).is_symlink()
            and not getattr(os.path, "isjunction", lambda path: False)(Path(parent, name))
        ]
        relative_parent = Path(parent).relative_to(root)
        if "Uploads" not in relative_parent.parts:
            continue
        for filename in filenames:
            if not re.fullmatch(r"[a-fA-F0-9]{40}", filename) or filename.lower() in selected:
                continue
            path = Path(parent, filename)
            if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
                continue
            stat = path.stat()
            if stat.st_mtime > cutoff:
                continue
            try:
                with Image.open(path) as image:
                    if image.format not in ("JPEG", "PNG", "WEBP"):
                        continue
                    image.verify()
            except (OSError, ValueError, Image.DecompressionBombError):
                continue
            candidates.append({"path": path, "size": stat.st_size, "mtime_ns": stat.st_mtime_ns})
    return candidates


def _read_current_selection(plex_root, options, credentials, work_dir, client):
    snapshot = Path(work_dir) / "selected-artwork.db"
    source = options.get("database_source", "plex")
    if source == "local":
        database = plex_root / "Plug-in Support" / "Databases" / "com.plexapp.plugins.library.db"
        if not database.is_file() or not database.resolve().is_relative_to(plex_root):
            raise ValueError("Plex library database was not found inside the configured data directory")
        if any(Path(str(database) + suffix).exists() for suffix in ("-wal", "-shm")):
            raise ValueError("Local database mode requires Plex to be stopped: WAL/SHM files are present")
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as original:
            with closing(sqlite3.connect(snapshot)) as backup:
                original.backup(backup)
        if any(Path(str(database) + suffix).exists() for suffix in ("-wal", "-shm")):
            raise ValueError("Plex started while copying the local database; cleanup aborted")
    elif source == "plex":
        url = str(credentials.get("url") or "").rstrip("/")
        token = credentials.get("token")
        if not url or not token:
            raise ValueError("Plex API database export requires configured Plex URL and token")
        headers = {"X-Plex-Token": token, "Accept": "application/xml"}
        preferences = plex_root / "Preferences.xml"
        if not preferences.is_file():
            raise ValueError("API mode requires mounted Plex Preferences.xml to verify the data directory belongs to this server")
        expected_server = fromstring(preferences.read_bytes()).get("MachineIdentifier")
        identity = client.get(url + "/identity", headers=headers)
        identity.raise_for_status()
        if not expected_server or fromstring(identity.content).get("machineIdentifier") != expected_server:
            raise ValueError("Configured Plex data directory does not match the connected server; cleanup aborted")
        sessions = client.get(url + "/status/sessions", headers=headers)
        sessions.raise_for_status()
        if int(fromstring(sessions.content).get("size") or 0):
            raise ValueError("Plex has active playback sessions; cleanup skipped")
        download = Path(work_dir) / "database-export"
        total = 0
        with client.stream("GET", url + "/diagnostics/databases", headers=headers) as response:
            response.raise_for_status()
            with download.open("wb") as output:
                for chunk in response.iter_bytes(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_DATABASE_BYTES:
                        raise ValueError("Plex database export exceeds the 20 GiB safety limit")
                    output.write(chunk)
        if zipfile.is_zipfile(download):
            with zipfile.ZipFile(download) as archive:
                databases = [entry for entry in archive.infolist() if not entry.is_dir()
                             and (Path(entry.filename).name == "com.plexapp.plugins.library.db" or Path(entry.filename).name.startswith("databaseBackup"))
                             and "blobs" not in Path(entry.filename).name.lower()]
                if len(databases) != 1 or databases[0].file_size > MAX_DATABASE_BYTES:
                    raise ValueError("Plex export does not contain one supported library database")
                with archive.open(databases[0]) as original, snapshot.open("wb") as output:
                    shutil.copyfileobj(original, output)
        else:
            shutil.copyfile(download, snapshot)
    else:
        raise ValueError("Database source must be plex or local")
    with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro", uri=True)) as connection:
        return selected_artwork(connection)


def apply_image_cleanup(metadata_dir, candidates, selected, action, quarantine_dir=None):
    root = Path(metadata_dir).resolve(strict=True)
    if action not in ("report", "quarantine", "remove"):
        raise ValueError("Unsupported image cleanup action")
    quarantine = Path(quarantine_dir).resolve() if quarantine_dir else None
    if action == "quarantine" and (quarantine is None or quarantine.is_relative_to(root)):
        raise ValueError("Quarantine must be outside Plex Metadata")
    result = {"candidates": len(candidates), "candidate_bytes": sum(entry["size"] for entry in candidates), "changed": 0, "changed_bytes": 0, "skipped": 0}
    for entry in candidates:
        path = entry["path"]
        if path.name.lower() in selected or path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
            result["skipped"] += 1
            continue
        stat = path.stat()
        if (stat.st_size, stat.st_mtime_ns) != (entry["size"], entry["mtime_ns"]):
            result["skipped"] += 1
            continue
        if action == "report":
            continue
        if action == "quarantine":
            destination = quarantine / path.relative_to(root)
            if destination.exists():
                raise ValueError("Quarantine destination already exists; cleanup stopped without overwriting it")
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path), str(destination))
        else:
            path.unlink()
        result["changed"] += 1
        result["changed_bytes"] += entry["size"]
    return result


def run_scheduled_image_cleanup(base_dir, options, *, scheduled=False):
    global _cleanup_running
    if not scheduled:
        return {"success": False, "error": "Plex image cleanup can only run from a configured schedule"}
    from overlay_sync_service import _sync_condition, is_overlay_sync_running, get_server_credentials
    with _sync_condition:
        plex_push = sys.modules.get("plex_push_service")
        plex_push_running = bool(plex_push and getattr(plex_push, "is_plex_sync_running", lambda: False)())
        if _cleanup_running or is_overlay_sync_running() or plex_push_running:
            return {"success": True, "skipped": True, "reason": "Artwork sync is active or queued"}
        _cleanup_running = True
    base_dir = Path(base_dir)
    log_file = base_dir / "UILogs" / "PlexImageCleanup.log"
    report = {"success": False, "started_at": datetime.now().isoformat()}
    try:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        options = cleanup_schedule_options(options)
        action = options.get("cleanup_action", "report")
        if action not in ("report", "quarantine", "remove"):
            raise ValueError("Cleanup action must be report, quarantine, or remove")
        if action == "remove" and options.get("confirm_image_removal") is not True:
            raise ValueError("Permanent image removal requires explicit confirmation in the schedule")
        configured_root = str(options.get("plex_data_path") or "").strip()
        if not configured_root:
            raise ValueError("Configure the Plex data-directory path before scheduling image cleanup")
        plex_root = Path(configured_root).resolve(strict=True)
        metadata = plex_root / "Metadata"
        if not metadata.is_dir():
            raise ValueError("The configured Plex data directory must contain Metadata")
        quarantine = base_dir / "database" / "plex-image-quarantine" / (datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8])
        credentials = get_server_credentials(base_dir / "config.json").get("plex", {}) if options.get("database_source", "plex") == "plex" else {}
        with tempfile.TemporaryDirectory(prefix="posterizarr-image-cleanup-") as work_dir, httpx.Client(timeout=600.0, follow_redirects=False) as client:
            selected = _read_current_selection(plex_root, options, credentials, work_dir, client)
            candidates = image_cleanup_candidates(metadata, selected, options.get("minimum_age_days", 7))
            if action != "report" and candidates:
                selected = _read_current_selection(plex_root, options, credentials, work_dir, client)
            report.update(apply_image_cleanup(metadata, candidates, selected, action, quarantine))
        report.update({"success": True, "action": action, "plex_data_path": str(plex_root), "quarantine_path": str(quarantine) if action == "quarantine" and report["changed"] else None})
    except Exception as error:
        report["error"] = str(error)
        logger.warning("[PlexImageCleanup] %s", error)
    finally:
        report["finished_at"] = datetime.now().isoformat()
        try:
            log_file.parent.mkdir(parents=True, exist_ok=True)
            with log_file.open("a", encoding="utf-8") as output:
                output.write(json.dumps(report, sort_keys=True) + "\n")
            (log_file.parent / "last_image_cleanup_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        finally:
            with _sync_condition:
                _cleanup_running = False
                _sync_condition.notify_all()
    return report