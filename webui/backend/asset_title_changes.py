import asyncio
import hashlib
import json
import logging
import re
import sqlite3
import shutil
import threading
import tempfile
import uuid
from contextlib import closing
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

import httpx
from defusedxml.ElementTree import fromstring

logger = logging.getLogger(__name__)


def title_regeneration_enabled(settings):
    return bool(settings.get("regenerate_assets_on_title_change", False))


def title_regeneration_allowed(settings, manual=False):
    if settings.get("title_change_dry_run", False):
        return False
    return bool(manual or title_regeneration_enabled(settings))


def is_media_server_source(source, server_urls=()):
    try:
        parsed = urlsplit(str(source or "").strip())
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        origin = (parsed.scheme, parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        for server_url in server_urls:
            server = urlsplit(str(server_url or ""))
            server_origin = (server.scheme, server.hostname, server.port or (443 if server.scheme == "https" else 80))
            if origin == server_origin:
                return True
        native_image_path = r"/library/metadata/[^/]+/(?:thumb|art|file)(?:/|$)|/photo/:/transcode(?:/|$)|/items/[^/]+/images/(?:primary|backdrop|thumb)(?:/|$)"
        return bool(re.search(native_image_path, unquote(parsed.path), re.I))
    except ValueError:
        return False


def _with_source_safety(job):
    if is_media_server_source(job.get("source"), [job.get("server_url")]):
        return {**job, "status": "blocked", "reason": "media_server_source"}
    return job


def get_enabled_text_media_types(config):
    """
    Determine which media types have text overlays enabled in the configuration.
    If a media type has AddText disabled, title changes on that media type are ignored
    because no text is burned onto those images.
    """
    prereq = config.get("PrerequisitePart") or config
    poster_part = config.get("PosterOverlayPart") or {}
    season_part = config.get("SeasonPosterOverlayPart") or {}
    tc_title_part = config.get("TitleCardTitleTextPart") or {}
    tc_ep_part = config.get("TitleCardEPTextPart") or {}

    tc_enabled = str(prereq.get("TitleCards", "false")).strip().lower() == "true"
    tc_text = (
        str(tc_title_part.get("AddEPTitleText", "false")).strip().lower() == "true" or
        str(tc_ep_part.get("AddEPText", "false")).strip().lower() == "true"
    )

    season_enabled = str(prereq.get("SeasonPosters", "false")).strip().lower() == "true"
    season_text = str(season_part.get("AddText", "false")).strip().lower() == "true"
    season_override_name = str(
        season_part.get("OverrideSeasonName") or
        season_part.get("SeasonPosterOverrideSeasonName") or
        config.get("SeasonPosterOverrideSeasonName") or
        config.get("OverrideSeasonName") or
        "false"
    ).strip().lower() == "true"
    # If SeasonPosterOverrideSeasonName is true, Posterizarr overrides the season name with
    # a static string (e.g. "Season 1") rather than using the media server/metadata season name,
    # so metadata season title changes do not affect the burned-on text.
    season_tracks_metadata = season_enabled and season_text and not season_override_name

    poster_enabled = str(prereq.get("Posters", "false")).strip().lower() == "true"
    poster_text = str(poster_part.get("AddText", "false")).strip().lower() == "true"

    return {
        "episode": tc_enabled and tc_text,
        "season": season_tracks_metadata,
        "movie": poster_enabled and poster_text,
        "show": poster_enabled and poster_text,
    }


def _record_kind(record):
    kind = str(record.get("Type") or "").strip().casefold()
    title = str(record.get("Title") or "").strip()
    if kind == "episode":
        match = re.search(r"\bS(\d+)E(\d+)\b", title, re.I)
        return ("episode", int(match[1]), int(match[2])) if match else None
    if kind == "season":
        match = re.search(r"\|\s*(?:Season|Staffel|Saison|Stagione|Temporada)?\s*(\d+)", title, re.I)
        if not match:
            match = re.search(r"\b(?:S|Season|Staffel)\s*(\d+)\b", title, re.I)
        return ("season", int(match[1])) if match else None
    if kind == "movie":
        return ("movie",)
    if kind == "show":
        return ("show",)
    return None


def _asset_path(record, kind, assets, library_folders):
    media_type = kind[0]
    root = str(record.get("Rootfolder") or "").replace("\\", "/")
    library = str(record.get("LibraryName") or "")
    if not root or not library or Path(root).is_absolute() or ".." in Path(root).parts:
        return None

    if media_type == "episode":
        season, episode = kind[1], kind[2]
        filename = f"S{season:02d}E{episode:02d}.jpg"
        relative = Path(library) / root / filename if library_folders else Path(f"{root}_{filename}")
        path = (assets / relative).resolve()
        if path.is_relative_to(assets.resolve()) and path.is_file():
            return path
        return None

    if media_type == "season":
        season = kind[1]
        filename = f"Season{season:02d}.jpg"
        relative = Path(library) / root / filename if library_folders else Path(f"{root}_{filename}")
        path = (assets / relative).resolve()
        if path.is_relative_to(assets.resolve()) and path.is_file():
            return path
        return None

    if media_type in ("movie", "show"):
        if library_folders:
            path = (assets / library / root / "poster.jpg").resolve()
            if path.is_relative_to(assets.resolve()) and path.is_file():
                return path
        else:
            path = (assets / f"{root}.jpg").resolve()
            if path.is_relative_to(assets.resolve()) and path.is_file():
                return path
            alt = (assets / f"{root}_poster.jpg").resolve()
            if alt.is_relative_to(assets.resolve()) and alt.is_file():
                return alt
        return None

    return None


def _placeholder(title, media_type="episode"):
    s = str(title or "").strip()
    if not s:
        return True
    if media_type == "episode":
        return bool(re.fullmatch(
            r"(?:episode|folge|épisode|episodio|episódio)\s*#?\s*\d+(?:[.\-]\d+)?|tba|tbd|to be announced|untitled",
            s, re.I))
    if media_type == "season":
        return bool(re.fullmatch(r"tba|tbd|to be announced|untitled", s, re.I))
    return bool(re.fullmatch(r"tba|tbd|to be announced|untitled(?:\s+project)?", s, re.I))


def _recorded_title(record, kind):
    media_type = kind[0]
    title_str = str(record.get("Title") or "").strip()
    if media_type == "episode":
        match = re.fullmatch(r"\s*S\d+E\d+\s*\|\s*(.*?)\s*", title_str, re.I)
        return match[1] if match and match[1] else None
    if media_type == "season":
        parts = title_str.split("|", 1)
        if len(parts) > 1:
            return parts[1].strip()
        return f"Season {kind[1]}"
    if media_type in ("movie", "show"):
        return title_str or None
    return None


def _same_title(previous, current, media_type="episode"):
    if previous is None or current is None:
        return previous == current
    p = str(previous).strip().casefold()
    c = str(current).strip().casefold()
    if p == c:
        return True
    if media_type == "season":
        norm_p = re.sub(r'^(?:season|staffel|saison|stagione|temporada)\s*0*(\d+)$', r'season \1', p)
        norm_c = re.sub(r'^(?:season|staffel|saison|stagione|temporada)\s*0*(\d+)$', r'season \1', c)
        if norm_p == norm_c:
            return True
        norm_p_sp = re.sub(r'^(?:specials?|sp[ée]ciaux|sp[ée]cial|speciali|speciale|especiais|especial)$', 'specials', p)
        norm_c_sp = re.sub(r'^(?:specials?|sp[ée]ciaux|sp[ée]cial|speciali|speciale|especiais|especial)$', 'specials', c)
        if norm_p_sp == norm_c_sp and norm_p_sp == 'specials':
            return True
    return False


def _same_title_snapshot(previous, current, media_type="episode"):
    if previous is None or current is None:
        return False
    previous_values, current_values = json.loads(previous), json.loads(current)
    return len(previous_values) == len(current_values) and all(
        _same_title(old, new, media_type) for old, new in zip(previous_values, current_values))


def _unknown_text_block_reason(job):
    if is_media_server_source(job.get("source"), [job.get("server_url")]):
        return "media_server_source"
    if _placeholder(str(job.get("title") or ""), job.get("media_type", "episode")):
        return "placeholder"
    try:
        source = urlsplit(str(job.get("source") or "").strip())
        if source.scheme not in ("http", "https") or not source.hostname or source.username or source.password:
            return "missing_source"
    except ValueError:
        return "missing_source"
    if not job.get("source_textless"):
        return "source_has_text"
    return None


def _can_force_unknown_text(job):
    return job.get("reason") == "unknown_text" and _unknown_text_block_reason(job) is None


def _can_force_media_server_source(job):
    return job.get("reason") == "media_server_source" and not _placeholder(str(job.get("title") or ""), job.get("media_type", "episode"))


def _can_force(job):
    return _can_force_unknown_text(job) or _can_force_media_server_source(job)


def _rebuild_block_reason(job):
    if job.get("reason") == "unknown_text":
        return _unknown_text_block_reason(job)
    if job.get("reason") == "media_server_source" and not _can_force_media_server_source(job):
        return "placeholder"
    return None


# Same markers and 64 KB window as GetPlexArtwork in ApiHandlers.ps1.
PROCESSED_ARTWORK_MARKERS = re.compile(rb"overlay|titlecard|created with ppm|created with posterizarr", re.I)
MAX_MEDIA_SERVER_ORIGINAL_BYTES = 50 * 1024 * 1024


def _origin(url):
    parts = urlsplit(str(url or "").strip())
    return parts.scheme, parts.hostname, parts.port or (443 if parts.scheme == "https" else 80)


def _image_extension(content):
    if content.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return ".webp"
    return None


def hash_validation_disabled(config_path):
    try:
        config = json.loads(Path(config_path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return False
    value = (config.get("PrerequisitePart") or {}).get("DisableHashValidation", config.get("DisableHashValidation"))
    return str(value).strip().lower() == "true"


async def download_media_server_original(job, credentials, destination_dir, config_path):
    name = Path(job["asset_path"]).name
    source = str(job.get("source") or "").strip()
    server = str(credentials.get("url") or "").rstrip("/")
    if not server or urlsplit(source).scheme not in ("http", "https") or _origin(source) != _origin(server):
        logger.warning("[TitleChanges] Cannot force recreate %s: the recorded original is not on the configured media server.", name)
        return None
    headers = {"X-Plex-Token": credentials.get("token") or ""} if job.get("server_type") == "plex" else {"X-Emby-Token": credentials.get("api_key") or ""}
    try:
        async with httpx.AsyncClient(timeout=30, verify=False, follow_redirects=False) as client:
            response = await client.get(source, headers=headers)
    except httpx.HTTPError as error:
        logger.warning("[TitleChanges] Cannot force recreate %s: media server download failed (%s).", name, type(error).__name__)
        return None
    content = response.content
    extension = _image_extension(content) if response.status_code == 200 else None
    if extension is None or len(content) > MAX_MEDIA_SERVER_ORIGINAL_BYTES:
        logger.warning("[TitleChanges] Cannot force recreate %s: the media server did not return a usable image (HTTP %s).", name, response.status_code)
        return None
    if PROCESSED_ARTWORK_MARKERS.search(content[:65536]) and not hash_validation_disabled(config_path):
        logger.warning("[TitleChanges] Cannot force recreate %s: the media server artwork already has Posterizarr/Kometa/TCM EXIF data. Choose a provider image or enable DisableHashValidation.", name)
        return None
    destination_dir.mkdir(parents=True, exist_ok=True)
    path = destination_dir / f"title-regeneration-{uuid.uuid4().hex}{extension}"
    path.write_bytes(content)
    return path


def _dismissal_fingerprint(job):
    state = [job.get("reason"), job.get("old_title"), job.get("title"), job.get("source")]
    return hashlib.sha256(json.dumps(state, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()


def _candidate_matches_filters(job, status_filter="all", reason_filter="all", review_type="all", media_type_filter="all"):
    if media_type_filter not in ("", "all") and job.get("media_type") != media_type_filter:
        return False
    if status_filter == "eligible" and job.get("status") != "ready":
        return False
    if status_filter == "blocked" and job.get("status") == "ready":
        return False
    if reason_filter == "none" and job.get("reason"):
        return False
    if reason_filter not in ("", "all", "none") and job.get("reason") != reason_filter:
        return False
    if review_type == "historical" and not job.get("requires_review"):
        return False
    if review_type == "future" and job.get("requires_review"):
        return False
    return True


def _candidate_matches_search(job, search):
    search = str(search or "").strip().casefold()
    return not search or search in " ".join(
        str(job.get(key) or "") for key in ("library", "parent_title", "folder", "old_title", "title", "media_type")
    ).casefold()


class AssetTitleChanges:
    def __init__(self, base_dir, assets_dir, library_folders=True, enabled_types=None):
        self.base_dir = Path(base_dir)
        self.assets = Path(assets_dir)
        self.library_folders = library_folders
        self.enabled_types = enabled_types or {"episode": True, "season": True, "movie": True, "show": True}
        self.database = self.base_dir / "database" / "overlay_cache.db"
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS asset_title_baselines (
                server_key TEXT NOT NULL, asset_path TEXT NOT NULL, item_id TEXT NOT NULL,
                titles TEXT NOT NULL, PRIMARY KEY(server_key, asset_path))""")
            columns = {row[1] for row in connection.execute("PRAGMA table_info(asset_title_baselines)")}
            if "applied_titles" not in columns:
                connection.execute("ALTER TABLE asset_title_baselines ADD COLUMN applied_titles TEXT")
            connection.execute("""CREATE TABLE IF NOT EXISTS episode_title_candidates (
                candidate_id TEXT PRIMARY KEY, server_key TEXT NOT NULL, asset_path TEXT NOT NULL,
                library_name TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
                scan_id TEXT NOT NULL)""")
            connection.execute("""CREATE TABLE IF NOT EXISTS episode_title_candidate_dismissals (
                candidate_id TEXT NOT NULL, fingerprint TEXT NOT NULL, dismissed_at TEXT NOT NULL,
                PRIMARY KEY(candidate_id, fingerprint))""")

    def _records(self):
        database = self.base_dir / "database" / "imagechoices.db"
        if not database.is_file():
            return []
        active_types = [t for t, enabled in self.enabled_types.items() if enabled]
        if not active_types:
            return []
        placeholders = ",".join("?" for _ in active_types)
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as connection:
            connection.row_factory = sqlite3.Row
            records = [dict(row) for row in connection.execute(
                f"SELECT * FROM imagechoices WHERE LOWER(TRIM(Type)) IN ({placeholders}) ORDER BY id DESC",
                [t.lower() for t in active_types]
            )]
        seen = set()
        result = []
        for record in records:
            kind = _record_kind(record)
            if not kind or not self.enabled_types.get(kind[0]):
                continue
            path = _asset_path(record, kind, self.assets, self.library_folders)
            if path is None or str(path) in seen:
                continue
            seen.add(str(path))
            result.append((record, kind, path))
        return result

    def plan(self, server_type, server_url, items, library="all", excluded=()):
        from overlay_sync_service import _overlay_target_provider_ids

        server_key = server_type + ":" + hashlib.sha256(server_url.rstrip("/").encode()).hexdigest()
        items = [item for item in items if self.enabled_types.get(item.get("type"))]
        by_id = {str(item["id"]): item for item in items}
        index = {}
        for item in items:
            mtype = item["type"]
            if mtype == "episode":
                coord = (item["library"], mtype, item.get("season"), item.get("episode"))
            elif mtype == "season":
                coord = (item["library"], mtype, item.get("season"))
            else:
                coord = (item["library"], mtype)
            keys = [("root", root) for root in [item.get("root"), *(item.get("roots") or [])] if root]
            keys.extend((provider, str(value)) for provider, value in (item.get("provider_ids") or {}).items())
            for provider, value in keys:
                index.setdefault((*coord, provider, value), {})[str(item["id"])] = item
        exclusions = {str(name).casefold() for name in excluded}
        jobs = []
        scan_id = uuid.uuid4().hex
        with closing(sqlite3.connect(self.database)) as connection, connection:
            baselines = {row[0]: (row[1], row[2], row[3]) for row in connection.execute(
                "SELECT asset_path, item_id, titles, applied_titles FROM asset_title_baselines WHERE server_key = ?", (server_key,))}
            previous = {row[0]: json.loads(row[1]) for row in connection.execute(
                "SELECT candidate_id, payload FROM episode_title_candidates WHERE server_key = ?", (server_key,))}
            dismissed = set(connection.execute(
                "SELECT candidate_id, fingerprint FROM episode_title_candidate_dismissals"))
            for record, kind, path in self._records():
                library_name = record.get("LibraryName") or ""
                if library_name.casefold() in exclusions or (library != "all" and library_name.casefold() != library.casefold()):
                    continue
                media_type = kind[0]
                if media_type == "episode":
                    season, episode = kind[1], kind[2]
                    coord = (library_name, media_type, season, episode)
                elif media_type == "season":
                    season, episode = kind[1], None
                    coord = (library_name, media_type, season)
                else:
                    season, episode = None, None
                    coord = (library_name, media_type)

                baseline = baselines.get(str(path))
                if baseline:
                    current = by_id.get(baseline[0])
                    candidates = [current] if current and current["library"] == library_name and (
                        media_type != "episode" or (current.get("season") == season and current.get("episode") == episode)
                    ) and (
                        media_type != "season" or current.get("season") == season
                    ) else []
                else:
                    matches = {}
                    root = str(record.get("Rootfolder") or "").replace("\\", "/").rstrip("/").split("/")[-1]
                    keys = [("root", root), *_overlay_target_provider_ids(record).items()]
                    for provider, value in keys:
                        matches.update(index.get((*coord, provider, value), {}))
                    candidates = list(matches.values())
                if len(candidates) != 1:
                    continue
                item = candidates[0]
                if not str(item["title"]).strip():
                    continue
                render_title = item["title"]
                parent_title = item.get("parent_title") or (item.get("title") if media_type != "episode" else "")
                titles = json.dumps([render_title], ensure_ascii=True)
                recorded_title = _recorded_title(record, kind)
                applied_titles = baseline[2] if baseline and baseline[2] is not None else json.dumps([recorded_title], ensure_ascii=True)
                if not baseline:
                    connection.execute("INSERT OR IGNORE INTO asset_title_baselines (server_key, asset_path, item_id, titles, applied_titles) VALUES (?, ?, ?, ?, ?)",
                                       (server_key, str(path), str(item["id"]), titles, applied_titles))
                elif baseline[2] is None:
                    connection.execute("UPDATE asset_title_baselines SET applied_titles = ? WHERE server_key = ? AND asset_path = ?",
                                       (applied_titles, server_key, str(path)))
                if baseline and _same_title(recorded_title, render_title, media_type) and str(record.get("TextTruncated")).lower() in ("false", "0"):
                    applied_titles = titles
                    connection.execute("UPDATE asset_title_baselines SET titles = ?, applied_titles = ? WHERE server_key = ? AND asset_path = ?",
                                       (titles, titles, server_key, str(path)))
                if _same_title_snapshot(applied_titles, titles, media_type):
                    continue
                source = str(record.get("DownloadSource") or "").strip()
                parsed = urlsplit(source)
                old_title = json.loads(applied_titles)[0]
                reason = None
                if is_media_server_source(source, [server_url]):
                    reason = "media_server_source"
                elif not old_title or str(record.get("TextTruncated") or "").lower() == "true":
                    reason = "unknown_text"
                elif _placeholder(render_title, media_type):
                    reason = "placeholder"
                elif parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
                    reason = "missing_source"
                elif str(record.get("Language") or "").casefold() != "textless":
                    reason = "source_has_text"
                candidate_id = hashlib.sha256(f"{server_key}\n{path}".encode()).hexdigest()
                prior = previous.get(candidate_id, {})
                if reason == "media_server_source" and prior.get("reason") != reason:
                    logger.warning("[TitleChanges] Cannot recreate %s (%s): the original image was taken from a media server and may contain overlays; a provider original is required.", path.name, library_name)
                requires_review = prior.get("requires_review", not baseline or _same_title_snapshot(baseline[1], titles, media_type))
                poster_type = "titlecard" if media_type == "episode" else ("season" if media_type == "season" else "poster")
                job = {"server_key": server_key, "server_type": server_type,
                             "server_url": server_url.rstrip("/"),
                             "item_id": str(item["id"]), "asset_path": str(path), "titles": titles,
                             "source": source, "library": library_name,
                             "provider_ids": item.get("provider_ids") or {},
                             "source_textless": str(record.get("Language") or "").casefold() == "textless",
                             "folder": str(record["Rootfolder"]), "media_type": media_type,
                             "parent_id": str(item.get("parent_id") or item["id"]),
                             "poster_type": poster_type,
                             "title": render_title, "parent_title": parent_title,
                             "season": season, "episode": episode,
                             "candidate_id": candidate_id, "old_title": old_title,
                             "requires_review": requires_review, "reason": reason,
                             "status": "ready" if reason is None else "blocked",
                             "checked_at": datetime.now().isoformat(),
                             "preview_path": path.relative_to(self.assets.resolve()).as_posix()}
                if _same_title_snapshot(prior.get("titles"), titles, media_type) and prior.get("source") == source and prior.get("last_error"):
                    job["last_error"] = prior["last_error"]
                if (candidate_id, _dismissal_fingerprint(job)) in dismissed:
                    continue
                connection.execute("""INSERT INTO episode_title_candidates VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(candidate_id) DO UPDATE SET library_name = excluded.library_name,
                    status = excluded.status, payload = excluded.payload, scan_id = excluded.scan_id""",
                    (candidate_id, server_key, str(path), library_name, job["status"], json.dumps(job), scan_id))
                if reason is None and not requires_review:
                    jobs.append(job)
            connection.execute("DELETE FROM episode_title_candidates WHERE server_key = ? AND scan_id != ? AND (? = 'all' OR library_name = ? COLLATE NOCASE)",
                               (server_key, scan_id, library, library))
        return jobs

    def dismiss_candidate(self, candidate_id):
        with closing(sqlite3.connect(self.database)) as connection, connection:
            row = connection.execute("SELECT payload FROM episode_title_candidates WHERE candidate_id = ?", (candidate_id,)).fetchone()
            if not row:
                return False
            job = _with_source_safety(json.loads(row[0]))
            if job.get("titles") and job.get("server_key") and job.get("asset_path"):
                connection.execute("UPDATE asset_title_baselines SET titles = ?, applied_titles = ? WHERE server_key = ? AND asset_path = ?",
                                   (job["titles"], job["titles"], job["server_key"], job["asset_path"]))
            connection.execute("INSERT OR IGNORE INTO episode_title_candidate_dismissals (candidate_id, fingerprint, dismissed_at) VALUES (?, ?, ?)",
                               (candidate_id, _dismissal_fingerprint(job), datetime.now().isoformat()))
            connection.execute("DELETE FROM episode_title_candidates WHERE candidate_id = ?", (candidate_id,))
        return True

    def dismiss_candidates(self, candidate_ids):
        count = 0
        for cid in candidate_ids:
            if self.dismiss_candidate(cid):
                count += 1
        return count

    def detach_candidate_assets(self, jobs):
        backup_root = self.base_dir / "temp"
        backup_root.mkdir(parents=True, exist_ok=True)
        backup_dir = Path(tempfile.mkdtemp(prefix="episode-title-normal-run-", dir=backup_root))
        entries = []
        seen_paths = set()
        try:
            for index, job in enumerate(jobs):
                target = Path(job["asset_path"]).resolve(strict=True)
                if not target.is_relative_to(self.assets.resolve()) or not target.is_file():
                    raise ValueError("unsafe_asset_path")
                if target in seen_paths:
                    raise ValueError("duplicate_asset_path")
                seen_paths.add(target)
                backup = backup_dir / f"{index}{target.suffix}"
                shutil.copy2(target, backup)
                entries.append({"job": job, "target": target, "backup": backup})
            for entry in entries:
                entry["target"].unlink()
            return backup_dir, entries
        except Exception:
            for entry in entries:
                if entry["backup"].is_file() and not entry["target"].exists():
                    shutil.copy2(entry["backup"], entry["target"])
            shutil.rmtree(backup_dir, ignore_errors=True)
            raise

    def finish_detached_candidate_assets(self, backup_dir, entries, run_success):
        completed = 0
        for entry in entries:
            target, backup, job = entry["target"], entry["backup"], entry["job"]
            if run_success and target.is_file():
                try:
                    self.acknowledge(job)
                    backup.unlink(missing_ok=True)
                    completed += 1
                    continue
                except Exception:
                    logger.exception("[TitleChanges] Could not acknowledge normal-run asset %s", target.name)
            try:
                target.unlink(missing_ok=True)
                if backup.is_file():
                    shutil.copy2(backup, target)
            except Exception:
                logger.exception("[TitleChanges] Could not restore local titlecard %s", target.name)
        shutil.rmtree(backup_dir, ignore_errors=True)
        return completed

    def candidates(self, search="", limit=50, offset=0, status_filter="all", reason_filter="all", review_type="all", media_type_filter="all"):
        with closing(sqlite3.connect(self.database)) as connection:
            rows = [_with_source_safety(json.loads(row[0])) for row in connection.execute("SELECT payload FROM episode_title_candidates ORDER BY library_name, asset_path")]
        rows = [row for row in rows if not _same_title(row.get("old_title"), row.get("title"), row.get("media_type", "episode")) and
            _candidate_matches_search(row, search) and _candidate_matches_filters(row, status_filter, reason_filter, review_type, media_type_filter)]
        return {"total": len(rows), "eligible": sum(row["status"] == "ready" for row in rows),
            "force_eligible": sum(row["status"] == "ready" or _can_force(row) for row in rows),
            "enabled_types": self.enabled_types,
                "entries": [{**{key: value for key, value in row.items() if key not in ("source", "asset_path", "server_url", "server_key", "titles")},
                             "force_recreatable": _can_force(row),
                             "rebuild_block_reason": _rebuild_block_reason(row)}
                            for row in rows[offset:offset + limit]]}

    def candidate_jobs(self, candidate_ids=None, search="", all_eligible=False, force_unknown_text=False,
                       status_filter="all", reason_filter="all", review_type="all", media_type_filter="all"):
        with closing(sqlite3.connect(self.database)) as connection:
            rows = [_with_source_safety(json.loads(row[0])) for row in connection.execute("SELECT payload FROM episode_title_candidates ORDER BY library_name, asset_path")]
        selected = set(candidate_ids or [])
        jobs = []
        for row in rows:
            candidate_selected = row["candidate_id"] in selected
            eligible = row["status"] == "ready" or (force_unknown_text and _can_force(row))
            if (not eligible or _same_title(row.get("old_title"), row.get("title"), row.get("media_type", "episode"))
                    or not _candidate_matches_filters(row, status_filter, reason_filter, review_type, media_type_filter)):
                continue
            if candidate_selected or (all_eligible and _candidate_matches_search(row, search)):
                forced = bool(force_unknown_text and row["status"] != "ready")
                jobs.append({**row, "force_unknown_text": forced,
                             "force_media_server_source": forced and row.get("reason") == "media_server_source"})
        return jobs

    def record_failure(self, job, reason):
        with closing(sqlite3.connect(self.database)) as connection, connection:
            row = connection.execute("SELECT payload FROM episode_title_candidates WHERE candidate_id = ?", (job["candidate_id"],)).fetchone()
            if row:
                payload = json.loads(row[0])
                payload["last_error"] = reason
                connection.execute("UPDATE episode_title_candidates SET payload = ? WHERE candidate_id = ?", (json.dumps(payload), job["candidate_id"]))

    def candidate_job(self, candidate_id, force_unknown_text=False):
        with closing(sqlite3.connect(self.database)) as connection:
            row = connection.execute("SELECT payload FROM episode_title_candidates WHERE candidate_id = ?", (candidate_id,)).fetchone()
        job = _with_source_safety(json.loads(row[0])) if row else None
        forced = bool(job and force_unknown_text and job["status"] != "ready" and _can_force(job))
        if job and job["reason"] == "media_server_source" and not forced:
            logger.warning("[TitleChanges] Cannot recreate %s: the original was taken from a media server; use force recreate or a provider original.", Path(job["asset_path"]).name)
        eligible = job and (job["status"] == "ready" or forced)
        if eligible and forced and job["reason"] == "media_server_source":
            job = {**job, "force_media_server_source": True}
        return job if eligible and not _same_title(job.get("old_title"), job.get("title"), job.get("media_type", "episode")) else None

    def acknowledge_replacement(self, asset_path, rendered_title):
        target = Path(asset_path).resolve()
        if not target.is_relative_to(self.assets.resolve()) or not target.is_file() or not str(rendered_title or "").strip():
            return 0
        completed = 0
        with closing(sqlite3.connect(self.database)) as connection, connection:
            rows = connection.execute("SELECT payload FROM episode_title_candidates WHERE asset_path = ?", (str(target),)).fetchall()
            for row in rows:
                job = json.loads(row[0])
                if not _same_title(job.get("title"), rendered_title, job.get("media_type", "episode")):
                    continue
                connection.execute("UPDATE asset_title_baselines SET titles = ?, applied_titles = ? WHERE server_key = ? AND asset_path = ? AND item_id = ?",
                                   (job["titles"], job["titles"], job["server_key"], job["asset_path"], job["item_id"]))
                connection.execute("DELETE FROM episode_title_candidates WHERE candidate_id = ?", (job["candidate_id"],))
                completed += 1
        return completed

    def acknowledge(self, job):
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute("UPDATE asset_title_baselines SET titles = ?, applied_titles = ? WHERE server_key = ? AND asset_path = ? AND item_id = ?",
                               (job["titles"], job["titles"], job["server_key"], job["asset_path"], job["item_id"]))
            connection.execute("DELETE FROM episode_title_candidates WHERE candidate_id = ?", (job["candidate_id"],))


async def acknowledge_titlecard_replacement(base_dir, config_path, asset_path, rendered_title, return_code):
    if return_code != 0:
        return 0
    try:
        monitor = await asyncio.to_thread(create_title_monitor, base_dir, config_path)
        completed = await asyncio.to_thread(monitor.acknowledge_replacement, monitor.assets / asset_path, rendered_title)
        if completed:
            logger.info("[TitleChanges] Confirmed recreated titlecard %s; cleared %s review entry/entries", Path(asset_path).name, completed)
        return completed
    except Exception:
        logger.exception("[TitleChanges] Could not confirm recreated titlecard %s", Path(asset_path).name)
        return 0


async def fetch_title_items(client, server_type, credentials, library="all", enabled_types=None):
    if enabled_types is None:
        enabled_types = {"episode": True, "season": False, "movie": False, "show": False}
    url = credentials["url"].rstrip("/")
    items = []
    if server_type == "plex":
        headers = {"X-Plex-Token": credentials["token"], "Accept": "application/xml"}
        response = await client.get(url + "/library/sections", headers=headers)
        response.raise_for_status()
        for section in fromstring(response.content).findall("Directory"):
            name = section.get("title", "")
            sec_type = section.get("type", "")
            if library != "all" and name.casefold() != library.casefold():
                continue
            if name.casefold() in {str(value).casefold() for value in credentials.get("excluded_libs", [])}:
                continue

            # Movie Libraries
            if sec_type == "movie" and enabled_types.get("movie"):
                start = 0
                while True:
                    res = await client.get(url + f"/library/sections/{section.get('key')}/all", headers=headers,
                                           params={"type": 1, "includeGuids": 1, "X-Plex-Container-Start": start, "X-Plex-Container-Size": 500})
                    res.raise_for_status()
                    container = fromstring(res.content)
                    page = [node for node in container if node.tag == "Video"]
                    for node in page:
                        paths = [loc.get("path") for loc in node.findall("Location") if loc.get("path")]
                        roots = list(dict.fromkeys(p.replace("\\", "/").rstrip("/").split("/")[-1] for p in paths if p.rstrip("/\\")))
                        identifiers = {guid.get("id", "").split("://")[0]: guid.get("id", "").split("://")[-1] for guid in node.findall("Guid")}
                        items.append({"id": node.get("ratingKey"), "library": name, "type": "movie",
                                      "title": node.get("title", ""), "parent_title": node.get("title", ""),
                                      "parent_id": node.get("ratingKey"),
                                      "root": roots[0] if roots else node.get("title", ""), "roots": roots,
                                      "provider_ids": identifiers, "season": None, "episode": None})
                    start += len(page)
                    if not page or start >= int(container.get("totalSize") or container.get("size") or len(page)):
                        break

            # TV Show Libraries
            elif sec_type == "show" and (enabled_types.get("show") or enabled_types.get("season") or enabled_types.get("episode")):
                kinds = []
                # Always include kind 2 (Show) if season/episode is needed, to resolve parent shows and folder roots
                kinds.append(2)
                if enabled_types.get("season"):
                    kinds.append(3)
                if enabled_types.get("episode"):
                    kinds.append(4)
                kinds = list(dict.fromkeys(kinds))

                nodes = []
                for kind in kinds:
                    start = 0
                    while True:
                        res = await client.get(url + f"/library/sections/{section.get('key')}/all", headers=headers,
                                               params={"type": kind, "includeGuids": 1, "X-Plex-Container-Start": start, "X-Plex-Container-Size": 500})
                        res.raise_for_status()
                        container = fromstring(res.content)
                        page = [node for node in container if node.tag in ("Video", "Directory")]
                        nodes.extend(page)
                        start += len(page)
                        if not page or start >= int(container.get("totalSize") or container.get("size") or len(page)):
                            break

                parents = {node.get("ratingKey"): node for node in nodes if node.get("type") == "show"}
                folder_roots = {}
                location_limit = asyncio.Semaphore(8)

                async def locate_show(parent_id):
                    parent = parents[parent_id]
                    paths = [location.get("path") for location in parent.findall("Location") if location.get("path")]
                    if not paths:
                        try:
                            async with location_limit:
                                r = await client.get(url + "/library/metadata/" + quote(str(parent_id), safe=""), headers=headers)
                                r.raise_for_status()
                            details = fromstring(r.content)
                            paths = [loc.get("path") for show in details.findall("Directory")
                                     if show.get("ratingKey") == parent_id and show.get("type") == "show"
                                     for loc in show.findall("Location") if loc.get("path")]
                        except httpx.HTTPError:
                            logger.warning("[TitleChanges] Could not retrieve folder metadata for Plex show %s", parent_id)
                    folder_roots[parent_id] = list(dict.fromkeys(
                        path.replace("\\", "/").rstrip("/").split("/")[-1] for path in paths if path.rstrip("/\\")))

                parent_ids = {node.get("grandparentRatingKey") for node in nodes if node.get("type") == "episode"}
                parent_ids.update(node.get("parentRatingKey") for node in nodes if node.get("type") == "season")
                if enabled_types.get("show"):
                    parent_ids.update(node.get("ratingKey") for node in nodes if node.get("type") == "show")
                await asyncio.gather(*(locate_show(parent_id) for parent_id in parent_ids if parent_id in parents))

                for node in nodes:
                    ntype = node.get("type")
                    if ntype == "show" and enabled_types.get("show"):
                        roots = folder_roots.get(node.get("ratingKey"), [])
                        identifiers = {guid.get("id", "").split("://")[0]: guid.get("id", "").split("://")[-1] for guid in node.findall("Guid")}
                        items.append({"id": node.get("ratingKey"), "library": name, "type": "show",
                                      "title": node.get("title", ""), "parent_title": node.get("title", ""),
                                      "parent_id": node.get("ratingKey"),
                                      "root": roots[0] if roots else node.get("title", ""), "roots": roots,
                                      "provider_ids": identifiers, "season": None, "episode": None})
                    elif ntype == "season" and enabled_types.get("season"):
                        parent = parents.get(node.get("parentRatingKey"))
                        if parent is None:
                            continue
                        roots = folder_roots.get(parent.get("ratingKey"), [])
                        identifiers = {guid.get("id", "").split("://")[0]: guid.get("id", "").split("://")[-1] for guid in parent.findall("Guid")}
                        season_idx = int(node.get("index")) if node.get("index") is not None else None
                        items.append({"id": node.get("ratingKey"), "library": name, "type": "season",
                                      "title": node.get("title", ""), "parent_title": parent.get("title", ""),
                                      "parent_id": parent.get("ratingKey"),
                                      "root": roots[0] if roots else parent.get("title", ""), "roots": roots,
                                      "provider_ids": identifiers,
                                      "season": season_idx, "episode": None})
                    elif ntype == "episode" and enabled_types.get("episode"):
                        parent = parents.get(node.get("grandparentRatingKey"))
                        if parent is None:
                            continue
                        roots = folder_roots.get(parent.get("ratingKey"), [])
                        identifiers = {guid.get("id", "").split("://")[0]: guid.get("id", "").split("://")[-1] for guid in parent.findall("Guid")}
                        items.append({"id": node.get("ratingKey"), "library": name, "type": "episode",
                                      "title": node.get("title", ""), "parent_title": parent.get("title", ""),
                                      "parent_id": parent.get("ratingKey"),
                                      "root": roots[0] if roots else parent.get("title", ""), "roots": roots,
                                      "provider_ids": identifiers,
                                      "season": int(node.get("parentIndex")) if node.get("parentIndex") is not None else None,
                                      "episode": int(node.get("index")) if node.get("index") is not None else None})
    elif server_type in ("jellyfin", "emby"):
        headers = {"X-Emby-Token": credentials["api_key"]}
        response = await client.get(url + "/Library/VirtualFolders", headers=headers)
        response.raise_for_status()
        for folder in response.json():
            name = folder.get("Name", "")
            is_movies = folder.get("CollectionType") == "movies"
            if library != "all" and name.casefold() != library.casefold():
                continue
            if name.casefold() in {str(value).casefold() for value in credentials.get("excluded_libs", [])}:
                continue

            if is_movies and enabled_types.get("movie"):
                rows = []
                while True:
                    res = await client.get(url + "/Items", headers=headers, params={
                        "ParentId": folder.get("ItemId") or folder["Id"], "Recursive": "true",
                        "IncludeItemTypes": "Movie", "Fields": "Path,ProviderIds",
                        "StartIndex": len(rows), "Limit": 500})
                    res.raise_for_status()
                    body = res.json()
                    page = body.get("Items", [])
                    rows.extend(page)
                    if not page or len(rows) >= body.get("TotalRecordCount", len(rows)):
                        break
                for row in rows:
                    path = str(row.get("Path") or "").replace("\\", "/")
                    root = Path(path).parent.name if Path(path).is_file() else Path(path).name
                    items.append({"id": row["Id"], "library": name, "type": "movie", "title": row.get("Name", ""),
                                  "root": root or row.get("Name", ""), "parent_title": row.get("Name", ""),
                                  "parent_id": row.get("Id"),
                                  "provider_ids": {k.casefold(): v for k, v in (row.get("ProviderIds") or {}).items()},
                                  "season": None, "episode": None})

            elif not is_movies and (enabled_types.get("show") or enabled_types.get("season") or enabled_types.get("episode")):
                req_types = ["Series"]
                if enabled_types.get("season"):
                    req_types.append("Season")
                if enabled_types.get("episode"):
                    req_types.append("Episode")
                rows = []
                while True:
                    res = await client.get(url + "/Items", headers=headers, params={
                        "ParentId": folder.get("ItemId") or folder["Id"], "Recursive": "true",
                        "IncludeItemTypes": ",".join(req_types), "Fields": "Path,ProviderIds",
                        "StartIndex": len(rows), "Limit": 500})
                    res.raise_for_status()
                    body = res.json()
                    page = body.get("Items", [])
                    rows.extend(page)
                    if not page or len(rows) >= body.get("TotalRecordCount", len(rows)):
                        break
                parents = {row["Id"]: row for row in rows if row.get("Type") == "Series"}
                for row in rows:
                    row_type = row.get("Type")
                    if row_type == "Series" and enabled_types.get("show"):
                        path = str(row.get("Path") or "").replace("\\", "/")
                        root = Path(path).name
                        items.append({"id": row["Id"], "library": name, "type": "show", "title": row.get("Name", ""),
                                      "root": root or row.get("Name", ""), "parent_title": row.get("Name", ""),
                                      "parent_id": row.get("Id"),
                                      "provider_ids": {k.casefold(): v for k, v in (row.get("ProviderIds") or {}).items()},
                                      "season": None, "episode": None})
                    elif row_type == "Season" and enabled_types.get("season"):
                        parent = parents.get(row.get("SeriesId"))
                        if parent is None:
                            continue
                        path = str(parent.get("Path") or "").replace("\\", "/")
                        root = Path(path).name
                        items.append({"id": row["Id"], "library": name, "type": "season", "title": row.get("Name", ""),
                                      "root": root or parent.get("Name", ""), "parent_title": parent.get("Name", ""),
                                      "parent_id": parent.get("Id"),
                                      "provider_ids": {k.casefold(): v for k, v in (parent.get("ProviderIds") or {}).items()},
                                      "season": row.get("IndexNumber"), "episode": None})
                    elif row_type == "Episode" and enabled_types.get("episode"):
                        parent = parents.get(row.get("SeriesId"))
                        if parent is None:
                            continue
                        path = str(parent.get("Path") or "").replace("\\", "/")
                        root = Path(path).name
                        items.append({"id": row["Id"], "library": name, "type": "episode", "title": row.get("Name", ""),
                                      "root": root or parent.get("Name", ""), "parent_title": parent.get("Name", ""),
                                      "parent_id": parent.get("Id"),
                                      "provider_ids": {k.casefold(): v for k, v in (parent.get("ProviderIds") or {}).items()},
                                      "season": row.get("ParentIndexNumber"), "episode": row.get("IndexNumber")})
    return items


_regenerator = None
_review_queue = None
_review_queue_runner = None


def configure_title_regenerator(callback):
    global _regenerator
    _regenerator = callback


def configure_episode_title_queue(queue, runner):
    global _review_queue, _review_queue_runner
    _review_queue = queue
    _review_queue_runner = runner


async def queued_episode_title_is_current(job, config_path):
    from overlay_sync_service import get_server_credentials

    credentials = await asyncio.to_thread(get_server_credentials, Path(config_path))
    server = credentials.get(job["server_type"], {})
    if not server.get("enabled") or str(server.get("url") or "").rstrip("/") != job["server_url"]:
        return False
    async with httpx.AsyncClient(timeout=30, verify=False) as client:
        if job["server_type"] == "plex":
            response = await client.get(f"{server['url']}/library/metadata/{quote(job['item_id'], safe='')}",
                                        headers={"X-Plex-Token": server["token"], "Accept": "application/xml"})
            response.raise_for_status()
            content = fromstring(response.content)
            item = content.find("Video") or content.find("Directory")
            if item is None or str(item.get("ratingKey")) != job["item_id"]:
                return False
            title = item.get("title")
        else:
            response = await client.get(f"{server['url']}/Items", params={"Ids": job["item_id"]},
                                        headers={"X-Emby-Token": server["api_key"]})
            response.raise_for_status()
            items = [item for item in response.json().get("Items", []) if str(item.get("Id")) == job["item_id"]]
            if len(items) != 1:
                return False
            title = items[0].get("Name")
    return _same_title(str(title or "").strip(), job["title"].strip(), job.get("media_type", "episode"))


def create_title_monitor(base_dir, config_path):
    from overlay_sync_service import resolve_configured_asset_path

    with open(config_path, encoding="utf-8-sig") as config_file:
        config = json.load(config_file)
    assets = config.get("AssetPath") or config.get("PrerequisitePart", {}).get("AssetPath")
    if not assets:
        raise ValueError("assets_not_configured")
    library_folders = str(config.get("LibraryFolders", config.get("PrerequisitePart", {}).get("LibraryFolders", "true"))).lower() == "true"
    enabled_types = get_enabled_text_media_types(config)
    return AssetTitleChanges(base_dir, resolve_configured_asset_path(assets), library_folders, enabled_types=enabled_types)


async def _scan_title_changes(base_dir, config_path):
    from overlay_sync_service import get_server_credentials

    monitor = await asyncio.to_thread(create_title_monitor, base_dir, config_path)
    credentials = await asyncio.to_thread(get_server_credentials, Path(config_path))
    jobs = []
    scanned_keys = set()
    errors = []
    active_keys = []
    async with httpx.AsyncClient(timeout=30, verify=False) as client:
        for server_type in ("plex", "jellyfin", "emby"):
            server = credentials.get(server_type) or {}
            if not server.get("enabled") or not server.get("url"):
                continue
            server_key = server_type + ":" + hashlib.sha256(server["url"].rstrip("/").encode()).hexdigest()
            active_keys.append(server_key)
            try:
                items = await fetch_title_items(client, server_type, server, enabled_types=monitor.enabled_types)
                jobs.extend(await asyncio.to_thread(monitor.plan, server_type, server["url"], items, excluded=server.get("excluded_libs", [])))
                scanned_keys.add(server_key)
            except Exception as error:
                logger.warning("[TitleChanges] %s scan failed (%s)", server_type, type(error).__name__)
                errors.append(server_type)
    with closing(sqlite3.connect(monitor.database)) as connection, connection:
        if active_keys:
            placeholders = ",".join("?" for key in active_keys)
            connection.execute(f"DELETE FROM episode_title_candidates WHERE server_key NOT IN ({placeholders})", active_keys)
        else:
            raise ValueError("no_servers")
    return monitor, jobs, scanned_keys, errors


class EpisodeTitleReview:
    def __init__(self):
        self.operation_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.cancelled = threading.Event()
        self.task = None
        self.state = {"running": False, "phase": "idle", "total": 0, "processed": 0,
                      "succeeded": 0, "failed": 0, "skipped": 0}

    def status(self):
        with self.state_lock:
            return dict(self.state)

    def _update(self, **values):
        with self.state_lock:
            self.state.update(values)

    def _reserve(self, phase):
        if not self.operation_lock.acquire(blocking=False):
            raise RuntimeError("busy")
        self.cancelled.clear()
        with self.state_lock:
            self.state = {"running": True, "phase": phase, "total": 0, "processed": 0,
                          "succeeded": 0, "failed": 0, "skipped": 0, "current_title": "",
                          "error": None, "scan_errors": [], "cancel_requested": False, "started_at": datetime.now().isoformat()}

    async def start_scan(self, base_dir, config_path):
        status = self.status()
        if status.get("running") and status.get("phase") == "scanning":
            return status
        self._reserve("scanning")
        self.task = asyncio.create_task(self._run_scan(base_dir, config_path))
        return self.status()

    async def _run_scan(self, base_dir, config_path):
        try:
            monitor, jobs, scanned, errors = await _scan_title_changes(base_dir, config_path)
            result = await asyncio.to_thread(monitor.candidates)
            self._update(total=result["total"], scan_errors=errors, phase="cancelled" if self.cancelled.is_set() else "complete")
        except Exception as error:
            logger.warning("[TitleChanges] Historical scan failed (%s)", type(error).__name__)
            self._update(error="scan_failed", phase="failed")
        finally:
            self._update(running=False)
            self.operation_lock.release()

    async def start_rebuild(self, base_dir, config_path, candidate_ids=None, all_eligible=False, search="",
                            force_unknown_text=False, status_filter="all", reason_filter="all", review_type="all",
                            media_type_filter="all"):
        from dynamic_overlays_service import get_dynamic_overlays_settings

        settings = get_dynamic_overlays_settings()
        if not title_regeneration_allowed(settings, manual=True):
            raise ValueError("rebuild_disabled")
        if bool(candidate_ids) == bool(all_eligible):
            raise ValueError("invalid_selection")
        if _review_queue is None or _review_queue_runner is None:
            raise RuntimeError("unavailable")
        self._reserve("scanning")
        try:
            monitor = await asyncio.to_thread(create_title_monitor, base_dir, config_path)
            selected = await asyncio.to_thread(monitor.candidate_jobs, candidate_ids, search, all_eligible,
                                               force_unknown_text, status_filter, reason_filter, review_type,
                                               media_type_filter)
            if not selected:
                raise ValueError("nothing_selected")
            self._update(total=len(selected))
            self.task = asyncio.create_task(self._run_rebuild(base_dir, config_path, [row["candidate_id"] for row in selected], force_unknown_text))
            return self.status()
        except Exception:
            self._update(running=False, phase="failed")
            self.operation_lock.release()
            raise

    async def _run_rebuild(self, base_dir, config_path, candidate_ids, force_unknown_text=False):
        from dynamic_overlays_service import get_dynamic_overlays_settings

        try:
            monitor, automatic, scanned, errors = await _scan_title_changes(base_dir, config_path)
            jobs = await asyncio.to_thread(monitor.candidate_jobs, candidate_ids, force_unknown_text=force_unknown_text)
            jobs = [job for job in jobs if job["server_key"] in scanned]
            self._update(phase="rebuilding", scan_errors=errors, skipped=len(candidate_ids) - len(jobs))

            def should_stop():
                return self.cancelled.is_set() or not title_regeneration_allowed(get_dynamic_overlays_settings(), manual=True)

            async def item_finished(item, status):
                values = self.status()
                self._update(processed=values["processed"] + 1,
                             succeeded=values["succeeded"] + int(status == "completed"),
                             failed=values["failed"] + int(status == "failed"), current_title="")

            if not should_stop() and jobs:
                queue_ids = await asyncio.to_thread(_review_queue.add_episode_title_items, jobs)
                self._update(queue_ids=queue_ids)
                await _review_queue_runner(queue_ids, should_stop=should_stop, on_item_finished=item_finished)
            if should_stop():
                self._update(phase="cancelled")
            if self.status()["phase"] != "cancelled":
                self._update(phase="cancelled" if self.cancelled.is_set() else "complete")
        except Exception as error:
            logger.warning("[TitleChanges] Episode batch failed (%s)", type(error).__name__)
            self._update(error="rebuild_failed", phase="failed")
        finally:
            self._update(running=False, current_title="")
            self.operation_lock.release()

    def cancel(self):
        self.cancelled.set()
        self._update(cancel_requested=True)
        return self.status()


episode_title_review = EpisodeTitleReview()


async def regenerate_changed_asset_titles(base_dir, config_path):
    from dynamic_overlays_service import get_dynamic_overlays_settings
    from overlay_sync_service import is_overlay_sync_running

    settings = get_dynamic_overlays_settings()
    if not title_regeneration_enabled(settings) or _regenerator is None or is_overlay_sync_running():
        return {"detected": 0, "regenerated": 0}
    if not episode_title_review.operation_lock.acquire(blocking=False):
        return {"detected": 0, "regenerated": 0}
    result = {"detected": 0, "regenerated": 0}
    try:
        monitor, jobs, scanned, errors = await _scan_title_changes(base_dir, config_path)
        result["detected"] = len(jobs)
        for job in jobs:
            current = get_dynamic_overlays_settings()
            if not title_regeneration_enabled(current):
                break
            if current.get("title_change_dry_run", False):
                logger.info("[TitleChanges] DRY RUN: would regenerate %s", Path(job["asset_path"]).name)
                continue
            try:
                if await _regenerator(job):
                    await asyncio.to_thread(monitor.acknowledge, job)
                    result["regenerated"] += 1
            except Exception as error:
                logger.warning("[TitleChanges] Failed to regenerate %s (%s)", Path(job["asset_path"]).name, type(error).__name__)
    finally:
        episode_title_review.operation_lock.release()
    logger.info("[TitleChanges] Detected %s; regenerated %s", result["detected"], result["regenerated"])
    return result