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
    return bool(settings.get("enabled") and settings.get("change_detection_enabled", True)
                and settings.get("regenerate_assets_on_title_change", False))


def title_regeneration_allowed(settings, manual=False):
    return bool(settings.get("enabled") and not settings.get("change_detection_dry_run", True)
                and (manual or title_regeneration_enabled(settings)))


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


def _record_kind(record):
    kind = str(record.get("Type") or "").strip().casefold()
    if kind == "episode":
        match = re.search(r"\bS(\d+)E(\d+)\b", record["Title"], re.I)
        return ("episode", int(match[1]), int(match[2])) if match else None
    return None


def _asset_path(record, kind, assets, library_folders):
    media_type, season, episode = kind
    if media_type != "episode":
        return None
    root = str(record.get("Rootfolder") or "").replace("\\", "/")
    library = str(record.get("LibraryName") or "")
    if not root or not library or Path(root).is_absolute() or ".." in Path(root).parts:
        return None
    filename = f"S{season:02d}E{episode:02d}"
    relative = Path(library) / root / f"{filename}.jpg" if library_folders else Path(f"{root}_{filename}.jpg")
    path = (assets / relative).resolve()
    if not path.is_relative_to(assets.resolve()) or not path.is_file():
        return None
    return path


def _placeholder(title):
    return not title.strip() or bool(re.fullmatch(
        r"(?:episode|folge|épisode|episodio|episódio)\s*#?\s*\d+(?:[.\-]\d+)?|tba|tbd|to be announced|untitled",
        title.strip(), re.I))


def _recorded_episode_title(record):
    match = re.fullmatch(r"\s*S\d+E\d+\s*\|\s*(.*?)\s*", str(record.get("Title") or ""), re.I)
    return match[1] if match and match[1] else None


def _same_episode_title(previous, current):
    if isinstance(previous, str) and isinstance(current, str):
        return previous.casefold() == current.casefold()
    return previous == current


def _same_title_snapshot(previous, current):
    if previous is None or current is None:
        return False
    previous_values, current_values = json.loads(previous), json.loads(current)
    return len(previous_values) == len(current_values) and all(
        _same_episode_title(old, new) for old, new in zip(previous_values, current_values))


def _unknown_text_block_reason(job):
    if is_media_server_source(job.get("source"), [job.get("server_url")]):
        return "media_server_source"
    if _placeholder(str(job.get("title") or "")):
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


def _dismissal_fingerprint(job):
    state = [job.get("reason"), job.get("old_title"), job.get("title"), job.get("source")]
    return hashlib.sha256(json.dumps(state, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()


def _candidate_matches_filters(job, status_filter="all", reason_filter="all", review_type="all"):
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
        str(job.get(key) or "") for key in ("library", "parent_title", "folder", "old_title", "title")
    ).casefold()


class AssetTitleChanges:
    def __init__(self, base_dir, assets_dir, library_folders=True):
        self.base_dir = Path(base_dir)
        self.assets = Path(assets_dir)
        self.library_folders = library_folders
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
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as connection:
            connection.row_factory = sqlite3.Row
            records = [dict(row) for row in connection.execute("SELECT * FROM imagechoices WHERE LOWER(TRIM(Type)) = 'episode' ORDER BY id DESC")]
        seen = set()
        result = []
        for record in records:
            kind = _record_kind(record)
            if not kind:
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
        items = [item for item in items if item.get("type") == "episode"]
        by_id = {str(item["id"]): item for item in items}
        index = {}
        for item in items:
            coordinates = (item["library"], item["type"], item.get("season"), item.get("episode"))
            keys = [("root", root) for root in [item.get("root"), *(item.get("roots") or [])] if root]
            keys.extend((provider, str(value)) for provider, value in (item.get("provider_ids") or {}).items())
            for provider, value in keys:
                index.setdefault((*coordinates, provider, value), {})[str(item["id"])] = item
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
                season, episode = kind[1:]
                baseline = baselines.get(str(path))
                if baseline:
                    current = by_id.get(baseline[0])
                    candidates = [current] if current and current["library"] == library_name and current.get("season") == season and current.get("episode") == episode else []
                else:
                    matches = {}
                    root = str(record.get("Rootfolder") or "").replace("\\", "/").rstrip("/").split("/")[-1]
                    keys = [("root", root), *_overlay_target_provider_ids(record).items()]
                    for provider, value in keys:
                        matches.update(index.get((library_name, "episode", season, episode, provider, value), {}))
                    candidates = list(matches.values())
                if len(candidates) != 1:
                    continue
                item = candidates[0]
                if not str(item["title"]).strip():
                    continue
                render_title = item["title"]
                parent_title = item.get("parent_title") or ""
                titles = json.dumps([render_title], ensure_ascii=True)
                recorded_title = _recorded_episode_title(record)
                applied_titles = baseline[2] if baseline and baseline[2] is not None else json.dumps([recorded_title], ensure_ascii=True)
                if not baseline:
                    connection.execute("INSERT OR IGNORE INTO asset_title_baselines (server_key, asset_path, item_id, titles, applied_titles) VALUES (?, ?, ?, ?, ?)",
                                       (server_key, str(path), str(item["id"]), titles, applied_titles))
                elif baseline[2] is None:
                    connection.execute("UPDATE asset_title_baselines SET applied_titles = ? WHERE server_key = ? AND asset_path = ?",
                                       (applied_titles, server_key, str(path)))
                if _same_title_snapshot(applied_titles, titles):
                    continue
                source = str(record.get("DownloadSource") or "").strip()
                parsed = urlsplit(source)
                old_title = json.loads(applied_titles)[0]
                reason = None
                if is_media_server_source(source, [server_url]):
                    reason = "media_server_source"
                elif not old_title or str(record.get("TextTruncated") or "").lower() == "true":
                    reason = "unknown_text"
                elif _placeholder(render_title):
                    reason = "placeholder"
                elif parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
                    reason = "missing_source"
                elif str(record.get("Language") or "").casefold() != "textless":
                    reason = "source_has_text"
                candidate_id = hashlib.sha256(f"{server_key}\n{path}".encode()).hexdigest()
                prior = previous.get(candidate_id, {})
                if reason == "media_server_source" and prior.get("reason") != reason:
                    logger.warning("[TitleChanges] Cannot recreate %s (%s): the original image was taken from a media server and may contain overlays; a provider original is required.", path.name, library_name)
                requires_review = prior.get("requires_review", not baseline or _same_title_snapshot(baseline[1], titles))
                job = {"server_key": server_key, "server_type": server_type,
                             "server_url": server_url.rstrip("/"),
                             "item_id": str(item["id"]), "asset_path": str(path), "titles": titles,
                             "source": source, "library": library_name,
                             "provider_ids": item.get("provider_ids") or {},
                             "source_textless": str(record.get("Language") or "").casefold() == "textless",
                             "folder": str(record["Rootfolder"]), "media_type": "episode",
                             "parent_id": str(item.get("parent_id") or item["id"]),
                             "poster_type": "titlecard",
                             "title": render_title, "parent_title": parent_title,
                             "season": season, "episode": episode,
                             "candidate_id": candidate_id, "old_title": old_title,
                             "requires_review": requires_review, "reason": reason,
                             "status": "ready" if reason is None else "blocked",
                             "checked_at": datetime.now().isoformat(),
                             "preview_path": path.relative_to(self.assets.resolve()).as_posix()}
                if _same_title_snapshot(prior.get("titles"), titles) and prior.get("source") == source and prior.get("last_error"):
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
            if job.get("reason") not in {"media_server_source", "unknown_text"}:
                return False
            connection.execute("INSERT OR IGNORE INTO episode_title_candidate_dismissals (candidate_id, fingerprint, dismissed_at) VALUES (?, ?, ?)",
                               (candidate_id, _dismissal_fingerprint(job), datetime.now().isoformat()))
            connection.execute("DELETE FROM episode_title_candidates WHERE candidate_id = ?", (candidate_id,))
        return True

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

    def candidates(self, search="", limit=50, offset=0, status_filter="all", reason_filter="all", review_type="all"):
        with closing(sqlite3.connect(self.database)) as connection:
            rows = [_with_source_safety(json.loads(row[0])) for row in connection.execute("SELECT payload FROM episode_title_candidates ORDER BY library_name, asset_path")]
        rows = [row for row in rows if not _same_episode_title(row.get("old_title"), row.get("title")) and
            _candidate_matches_search(row, search) and _candidate_matches_filters(row, status_filter, reason_filter, review_type)]
        return {"total": len(rows), "eligible": sum(row["status"] == "ready" for row in rows),
            "force_eligible": sum(row["status"] == "ready" or _can_force_unknown_text(row) for row in rows),
                "entries": [{**{key: value for key, value in row.items() if key not in ("source", "asset_path", "server_url", "server_key", "titles")},
                             "force_recreatable": _can_force_unknown_text(row),
                             "rebuild_block_reason": _unknown_text_block_reason(row) if row.get("reason") == "unknown_text" else None}
                            for row in rows[offset:offset + limit]]}

    def candidate_jobs(self, candidate_ids=None, search="", all_eligible=False, force_unknown_text=False,
                       status_filter="all", reason_filter="all", review_type="all"):
        with closing(sqlite3.connect(self.database)) as connection:
            rows = [_with_source_safety(json.loads(row[0])) for row in connection.execute("SELECT payload FROM episode_title_candidates ORDER BY library_name, asset_path")]
        selected = set(candidate_ids or [])
        jobs = []
        for row in rows:
            candidate_selected = row["candidate_id"] in selected
            eligible = row["status"] == "ready" or (force_unknown_text and _can_force_unknown_text(row))
            if (not eligible or _same_episode_title(row.get("old_title"), row.get("title"))
                    or not _candidate_matches_filters(row, status_filter, reason_filter, review_type)):
                continue
            if candidate_selected or (all_eligible and _candidate_matches_search(row, search)):
                jobs.append({**row, "force_unknown_text": bool(force_unknown_text and row["status"] != "ready")})
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
        if job and job["reason"] == "media_server_source":
            logger.warning("[TitleChanges] Cannot recreate %s: the original was taken from a media server; a provider original is required.", Path(job["asset_path"]).name)
        eligible = job and (job["status"] == "ready" or (force_unknown_text and _can_force_unknown_text(job)))
        return job if eligible and not _same_episode_title(job.get("old_title"), job.get("title")) else None

    def acknowledge(self, job):
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute("UPDATE asset_title_baselines SET titles = ?, applied_titles = ? WHERE server_key = ? AND asset_path = ? AND item_id = ?",
                               (job["titles"], job["titles"], job["server_key"], job["asset_path"], job["item_id"]))
            connection.execute("DELETE FROM episode_title_candidates WHERE candidate_id = ?", (job["candidate_id"],))


async def fetch_title_items(client, server_type, credentials, library="all"):
    url = credentials["url"].rstrip("/")
    items = []
    if server_type == "plex":
        headers = {"X-Plex-Token": credentials["token"], "Accept": "application/xml"}
        response = await client.get(url + "/library/sections", headers=headers)
        response.raise_for_status()
        for section in fromstring(response.content).findall("Directory"):
            name = section.get("title", "")
            if section.get("type") != "show" or (library != "all" and name.casefold() != library.casefold()):
                continue
            if name.casefold() in {str(value).casefold() for value in credentials.get("excluded_libs", [])}:
                continue
            kinds = (2, 4)
            nodes = []
            for kind in kinds:
                start = 0
                while True:
                    response = await client.get(url + f"/library/sections/{section.get('key')}/all", headers=headers,
                                                params={"type": kind, "includeGuids": 1, "X-Plex-Container-Start": start, "X-Plex-Container-Size": 500})
                    response.raise_for_status()
                    container = fromstring(response.content)
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
                            response = await client.get(url + "/library/metadata/" + quote(str(parent_id), safe=""), headers=headers)
                            response.raise_for_status()
                        details = fromstring(response.content)
                        paths = [location.get("path") for show in details.findall("Directory")
                                 if show.get("ratingKey") == parent_id and show.get("type") == "show"
                                 for location in show.findall("Location") if location.get("path")]
                    except httpx.HTTPError:
                        logger.warning("[TitleChanges] Could not retrieve folder metadata for Plex show %s; retaining identifier matching.", parent_id)
                folder_roots[parent_id] = list(dict.fromkeys(
                    path.replace("\\", "/").rstrip("/").split("/")[-1] for path in paths if path.rstrip("/\\")))

            parent_ids = {node.get("grandparentRatingKey") for node in nodes if node.get("type") == "episode"}
            await asyncio.gather(*(locate_show(parent_id) for parent_id in parent_ids if parent_id in parents))
            for node in nodes:
                if node.get("type") != "episode":
                    continue
                parent = parents.get(node.get("grandparentRatingKey"))
                if parent is None:
                    continue
                roots = folder_roots.get(parent.get("ratingKey"), [])
                identifiers = {guid.get("id", "").split("://")[0]: guid.get("id", "").split("://")[-1] for guid in parent.findall("Guid")}
                items.append({"id": node.get("ratingKey"), "library": name, "type": "episode",
                              "title": node.get("title", ""), "parent_title": parent.get("title", ""),
                              "parent_id": parent.get("ratingKey"),
                              "root": roots[0] if roots else parent.get("title", ""), "roots": roots, "provider_ids": identifiers,
                              "season": int(node.get("parentIndex")) if node.get("parentIndex") is not None else None,
                              "episode": int(node.get("index")) if node.get("index") is not None else None})
    elif server_type in ("jellyfin", "emby"):
        headers = {"X-Emby-Token": credentials["api_key"]}
        response = await client.get(url + "/Library/VirtualFolders", headers=headers)
        response.raise_for_status()
        for folder in response.json():
            name = folder.get("Name", "")
            if folder.get("CollectionType") == "movies":
                continue
            if library != "all" and name.casefold() != library.casefold():
                continue
            if name.casefold() in {str(value).casefold() for value in credentials.get("excluded_libs", [])}:
                continue
            rows = []
            while True:
                response = await client.get(url + "/Items", headers=headers, params={
                    "ParentId": folder.get("ItemId") or folder["Id"], "Recursive": "true",
                    "IncludeItemTypes": "Series,Episode", "Fields": "Path,ProviderIds",
                    "StartIndex": len(rows), "Limit": 500})
                response.raise_for_status()
                body = response.json()
                page = body.get("Items", [])
                rows.extend(page)
                if not page or len(rows) >= body.get("TotalRecordCount", len(rows)):
                    break
            parents = {row["Id"]: row for row in rows if row.get("Type") == "Series"}
            for row in rows:
                if row.get("Type") != "Episode":
                    continue
                parent = parents.get(row.get("SeriesId"))
                if parent is None:
                    continue
                path = str(parent.get("Path") or "").replace("\\", "/")
                root = Path(path).name
                items.append({"id": row["Id"], "library": name, "type": "episode", "title": row.get("Name", ""),
                              "root": root or parent.get("Name", ""), "parent_title": parent.get("Name", ""),
                              "parent_id": parent.get("Id"),
                              "provider_ids": {key.casefold(): value for key, value in (parent.get("ProviderIds") or {}).items()},
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
            item = fromstring(response.content).find("Video")
            if item is None or item.get("type") != "episode" or str(item.get("ratingKey")) != job["item_id"]:
                return False
            title, parent, season, episode = item.get("title"), item.get("grandparentRatingKey"), item.get("parentIndex"), item.get("index")
        else:
            response = await client.get(f"{server['url']}/Items", params={"Ids": job["item_id"]},
                                        headers={"X-Emby-Token": server["api_key"]})
            response.raise_for_status()
            items = [item for item in response.json().get("Items", []) if str(item.get("Id")) == job["item_id"] and item.get("Type") == "Episode"]
            if len(items) != 1:
                return False
            item = items[0]
            title, parent, season, episode = item.get("Name"), item.get("SeriesId"), item.get("ParentIndexNumber"), item.get("IndexNumber")
    return (_same_episode_title(str(title or "").strip(), job["title"].strip()) and str(parent) == job["parent_id"]
            and str(season) == str(job["season"]) and str(episode) == str(job["episode"]))


def create_title_monitor(base_dir, config_path):
    from overlay_sync_service import resolve_configured_asset_path

    with open(config_path, encoding="utf-8-sig") as config_file:
        config = json.load(config_file)
    assets = config.get("AssetPath") or config.get("PrerequisitePart", {}).get("AssetPath")
    if not assets:
        raise ValueError("assets_not_configured")
    library_folders = str(config.get("LibraryFolders", config.get("PrerequisitePart", {}).get("LibraryFolders", "true"))).lower() == "true"
    return AssetTitleChanges(base_dir, resolve_configured_asset_path(assets), library_folders)


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
                items = await fetch_title_items(client, server_type, server)
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
        from dynamic_overlays_service import get_dynamic_overlays_settings

        if not get_dynamic_overlays_settings().get("enabled"):
            raise ValueError("master_off")
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
                            force_unknown_text=False, status_filter="all", reason_filter="all", review_type="all"):
        from dynamic_overlays_service import get_dynamic_overlays_settings

        settings = get_dynamic_overlays_settings()
        if not settings.get("enabled"):
            raise ValueError("master_off")
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
                                               force_unknown_text, status_filter, reason_filter, review_type)
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
            if current.get("change_detection_dry_run", True):
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