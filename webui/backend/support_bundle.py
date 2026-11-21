"""Collect sanitized support diagnostics without modifying source files."""

import csv
import io
import json
import logging
import os
import re
import sqlite3
import time
import zipfile
from contextlib import closing
from pathlib import Path

import yaml


logger = logging.getLogger("support_bundle")
DATABASE_NAMES = (
    "media_export.db", "runtime_stats.db", "server_libraries.db", "imagechoices.db",
    "overlay_cache.db", "animetafill.db", "plex_push_cache.db",
)
CONFIG_NAMES = (
    "dynamic_overlays_settings.json", "dynamic_overlays_visual_config.json", "animetafill_config.json",
)
REPORT_NAMES = {"last_change_detection_report.json", "anime_database.json", "unmapped_shows.json"}
EXCLUDED_DIRS = {"__pycache__", "plex-image-quarantine", "quarantine", "assets", "uploads", "metadata", "media", "fonts"}
SECRET_KEY = re.compile(r"token|password|passwd|secret|credential|apikey|passphrase|authorization|cookie|webhook|privatekey|signingkey", re.I)
QUERY_SECRET = re.compile(r"(?i)([?&](?:[\w-]*(?:token|api[_-]?key|password|secret)|key|pin|auth)=)[^&\s\"'<>]+")
LOG_SECRET = re.compile(r'''(?ix)(["']?\b[\w-]*(?:api[_-]?key|token|password|passwd|secret|credential|passphrase|authorization|cookie|webhook)[\w-]*["']?\s*[:=]\s*)(["'])((?:\\.|(?!\2).)*)\2|(["']?\b(?:key|pin|auth|[\w-]*(?:api[_-]?key|token|password|passwd|secret|credential|passphrase|webhook)[\w-]*)["']?\s*[:=]\s*)([^\s,"';]+)''')
LOCAL_IP = re.compile(r"(?<!\d)(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|127\.0\.0\.1)(?!\d)|(?<![\w-])localhost(?![\w-])", re.I)
LOCAL_HOST = re.compile(r"(?<![\w-])[\w-]+(?:\.[\w-]+)*(?:\.local|\.lan)\b", re.I)


def _sensitive_key(key):
    normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
    return not normalized.endswith("enabled") and (normalized in {"key", "pin", "auth", "apprise", "appriseurls"} or bool(SECRET_KEY.search(normalized)))


def sanitize_string(value):
    value = QUERY_SECRET.sub(r"\1[MASKED]", value)
    value = re.sub(r"(?i)\b(discord|tgram|telegram|slack|pushed|pushover|pushbullet|prowl|growl|gotify|matrix|msteams|twilio|vonage|signal)://[^\s\"'<>]+", r"\1://[MASKED]", value)
    value = re.sub(r"(?i)(https?://(?:discord|discordapp)\.com/api/webhooks/)[^\s\"'<>]+", r"\1[MASKED]", value)
    value = re.sub(r"(?i)(https?://[^\s\"'<>]+/api/push/)[\w-]+", r"\1[MASKED]", value)
    value = re.sub(r"(?i)(https?://)[^/@\s]+:[^/@\s]+@", r"\1[MASKED]@", value)
    value = re.sub(r"(?im)(\b(?:authorization|cookie)\s*[:=]\s*)[^\r\n]+", r"\1[MASKED]", value)

    def replace_secret(match):
        prefix = match.group(1) or match.group(4)
        raw = match.group(3) if match.group(1) else match.group(5)
        if "enabled" in prefix.lower() or raw.lower() in ("true", "false"):
            return match.group(0)
        quote = match.group(2) if match.group(1) else ""
        return prefix + quote + "[MASKED]" + quote

    value = LOG_SECRET.sub(replace_secret, value)
    value = LOCAL_IP.sub("[MASKED_IP]", value)
    return LOCAL_HOST.sub("[MASKED_HOST]", value)


def sanitize_data(value):
    if isinstance(value, dict):
        return {
            key: "[MASKED]" if _sensitive_key(key) and item is not None and not isinstance(item, bool) else sanitize_data(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize_data(item) for item in value]
    return sanitize_string(value) if isinstance(value, str) else value


def _sanitize_cell(value, column):
    if _sensitive_key(column) and value is not None and not isinstance(value, bool):
        return "[MASKED]"
    if not isinstance(value, str):
        return value
    try:
        structured = json.loads(value)
    except (ValueError, TypeError):
        return sanitize_string(value)
    return json.dumps(sanitize_data(structured), ensure_ascii=True) if isinstance(structured, (dict, list)) else sanitize_string(value)


def sanitize_database(path):
    def quoted(identifier):
        return '"' + identifier.replace('"', '""') + '"'

    with closing(sqlite3.connect(path)) as connection:
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("PRAGMA secure_delete=ON")
        tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        with connection:
            for table in tables:
                schema = connection.execute(f"PRAGMA table_info({quoted(table)})").fetchall()
                columns = [row[1] for row in schema]
                key_value_columns = {column.lower(): index for index, column in enumerate(columns)}
                has_key_value = "key" in key_value_columns and "value" in key_value_columns
                identifiers = [row[1] for row in sorted(schema, key=lambda row: row[5]) if row[5]] or ["rowid"]
                selected = identifiers + columns
                rows = connection.execute(f"SELECT {', '.join(map(quoted, selected))} FROM {quoted(table)}").fetchall()
                for row in rows:
                    original = row[len(identifiers):]
                    sanitized = [_sanitize_cell(value, column) for column, value in zip(columns, original)]
                    if has_key_value:
                        key_index = key_value_columns["key"]
                        value_index = key_value_columns["value"]
                        field_name = original[key_index]
                        sanitized[key_index] = sanitize_string(field_name) if isinstance(field_name, str) else field_name
                        sanitized[value_index] = _sanitize_cell(original[value_index], field_name)
                    if list(original) != sanitized:
                        assignments = ", ".join(f"{quoted(column)} = ?" for column in columns)
                        condition = " AND ".join(f"{quoted(column)} IS ?" for column in identifiers)
                        connection.execute(f"UPDATE {quoted(table)} SET {assignments} WHERE {condition}", sanitized + list(row[:len(identifiers)]))
        connection.execute("VACUUM")


def snapshot_database(source, destination):
    started = time.monotonic()

    def check_timeout(status, remaining, total):
        if time.monotonic() - started > 30:
            raise TimeoutError("Support database snapshot exceeded 30 seconds")

    with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)) as original:
        with closing(sqlite3.connect(destination)) as snapshot:
            original.backup(snapshot, pages=256, progress=check_timeout)
    sanitize_database(destination)


def _linked(path):
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def _safe_file(path, root):
    try:
        relative = path.relative_to(root)
        if _linked(root) or not path.resolve().is_relative_to(root.resolve()):
            return False
        current = root
        for part in relative.parts:
            current = current / part
            if _linked(current):
                return False
        return path.is_file()
    except (OSError, ValueError):
        return False


def _files(root):
    if not root.is_dir() or _linked(root) or any(_linked(parent) for parent in root.parents):
        return
    for directory, folders, filenames in os.walk(root, followlinks=False):
        folders[:] = [name for name in folders if name.lower() not in EXCLUDED_DIRS and not _linked(Path(directory) / name)]
        for name in filenames:
            path = Path(directory) / name
            if _safe_file(path, root):
                yield path


def _copy_text(source, destination):
    raw = source.read_bytes()
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        content = raw.decode("utf-16")
    else:
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            content = raw.decode("latin-1")
    suffix = source.suffix.lower()
    if suffix == ".json":
        content = json.dumps(sanitize_data(json.loads(content)), indent=2, ensure_ascii=True)
    elif suffix in (".yml", ".yaml"):
        content = yaml.safe_dump(sanitize_data(yaml.safe_load(content)), sort_keys=False, allow_unicode=True)
    elif suffix == ".csv":
        rows = list(csv.reader(io.StringIO(content)))
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        if rows:
            writer.writerow(rows[0])
            for row in rows[1:]:
                writer.writerow([_sanitize_cell(value, rows[0][index] if index < len(rows[0]) else "") for index, value in enumerate(row)])
        content = output.getvalue()
    else:
        content = sanitize_string(content)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8")


def create_support_bundle(staging_dir, zip_path, *, base_dir, database_dir, logs_dir, rotated_logs_dir, ui_logs_dir, project_root):
    try:
        staging_dir = Path(staging_dir)
        zip_path = Path(zip_path)
        base_dir, database_dir, project_root = map(Path, (base_dir, database_dir, project_root))
        for source_root, name in ((Path(logs_dir), "Logs"), (Path(rotated_logs_dir), "RotatedLogs"), (Path(ui_logs_dir), "UILogs")):
            for source in _files(source_root):
                suffix = source.suffix.lower()
                log_file = suffix in (".log", ".txt") or (suffix not in (".gz", ".zip", ".bz2", ".xz") and bool(re.search(r"\.log[._-]\d", source.name, re.I)))
                diagnostic = source.name.lower() in REPORT_NAMES or source.name.lower() == "imagechoices.csv"
                if log_file or diagnostic or (name == "UILogs" and suffix == ".json"):
                    _copy_text(source, staging_dir / name / source.relative_to(source_root))

        database_output = staging_dir / "database"
        database_output.mkdir(parents=True, exist_ok=True)
        for name in DATABASE_NAMES:
            source = database_dir / name
            if _safe_file(source, database_dir):
                snapshot_database(source, database_output / name)

        for name in ("scheduler.json", "config.json"):
            source = base_dir / name
            if _safe_file(source, base_dir):
                _copy_text(source, staging_dir / name)

        roots = list(dict.fromkeys((base_dir, project_root, Path(__file__).resolve().parent)))
        for name in CONFIG_NAMES:
            alias = {"dynamic_overlays_settings.json": "settings.json", "dynamic_overlays_visual_config.json": "visual_config.json"}.get(name)
            candidates = []
            for root in roots:
                candidates.append((root / "dynamic_overlays" / name, root))
                if alias:
                    candidates.append((root / "dynamic_overlays" / alias, root))
                candidates.append((root / name, root))
            for source, root in candidates:
                if _safe_file(source, root):
                    _copy_text(source, staging_dir / "dynamic_overlays" / name)
                    break

        overlay_roots = [(root / "Overlayfiles" / folder, root) for root in roots[:2] for folder in ("dynamic_overlays", "kometa")]
        for overlay_root, root in overlay_roots:
            if (overlay_root / "configs" / "config.yml").is_file() and _safe_file(overlay_root / "configs" / "config.yml", root):
                for source in _files(overlay_root / "configs"):
                    if source.suffix.lower() in (".yml", ".yaml", ".json"):
                        _copy_text(source, staging_dir / "Overlayfiles" / "dynamic_overlays" / source.relative_to(overlay_root))
                break

        default_roots = [overlay_root / "defaults" for overlay_root, root in overlay_roots]
        default_roots.extend(root / "defaults" for root in roots[:2])
        for default_root in default_roots:
            for source in _files(default_root):
                destination = staging_dir / "Overlayfiles" / "dynamic_overlays" / "defaults" / source.relative_to(default_root)
                if source.suffix.lower() in (".yml", ".yaml") and not destination.exists():
                    _copy_text(source, destination)

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for source in _files(staging_dir):
                if source.resolve() != zip_path.resolve():
                    archive.write(source, source.relative_to(staging_dir))
        return True
    except Exception as error:
        logger.error("[SupportZip] Support bundle creation failed (%s); no archive will be returned", type(error).__name__)
        if Path(zip_path).exists():
            Path(zip_path).unlink()
        return False