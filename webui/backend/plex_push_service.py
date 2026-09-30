"""
Plex Push Service for Posterizarr WebUI
Handles:
1. Persistent SQLite caching (plex_push_cache.db) of pushed asset timestamps & sizes.
2. Collection diff detection between Plex Server collections and local Assets/Collections/.
3. On-demand & batch pushing of collection artwork to Plex REST API (/library/metadata/{ratingKey}/posters).
4. Automated scheduled sync (Plex Sync mode in Scheduler) for collections, posters, seasons, titlecards, and backgrounds.
"""

import os
import re
import json
import time
import sqlite3
import logging
import asyncio
import threading
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Any, Tuple
import urllib.parse
from xml.etree.ElementTree import fromstring
import httpx

logger = logging.getLogger("plex_push_service")


# ==============================================================================
# 1. PERSISTENT CACHE DATABASE
# ==============================================================================

class PlexPushCache:
    """Thread-safe SQLite cache tracking artwork uploaded to Plex."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.lock = threading.RLock()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=15)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    conn.execute("""
                        CREATE TABLE IF NOT EXISTS plex_push_cache (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            asset_path TEXT UNIQUE,
                            file_mtime REAL,
                            file_size INTEGER,
                            rating_key TEXT,
                            asset_type TEXT,
                            library_name TEXT,
                            item_title TEXT,
                            last_pushed_at TEXT,
                            status TEXT DEFAULT 'synced'
                        );
                    """)
                    conn.execute("""
                        CREATE INDEX IF NOT EXISTS idx_plex_cache_path ON plex_push_cache(asset_path);
                    """)
                    conn.execute("""
                        CREATE INDEX IF NOT EXISTS idx_plex_cache_rating_key ON plex_push_cache(rating_key);
                    """)
                conn.close()
            except Exception as e:
                logger.error(f"[PlexPushCache] Failed to initialize cache database: {e}")

    def get_entry(
        self,
        asset_path: Optional[str] = None,
        rating_key: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                row = None

                # 1. Try matching by rating_key first if provided (most reliable identifier across PMS updates)
                if rating_key:
                    cursor.execute(
                        "SELECT * FROM plex_push_cache WHERE rating_key = ? ORDER BY id DESC LIMIT 1",
                        (str(rating_key),)
                    )
                    row = cursor.fetchone()

                # 2. Try matching by normalized absolute and raw paths
                if not row and asset_path:
                    try:
                        resolved_path = str(Path(asset_path).resolve()).replace("\\", "/").lower()
                    except Exception:
                        resolved_path = str(asset_path).replace("\\", "/").lower()
                    raw_norm = str(asset_path).replace("\\", "/").lower()

                    cursor.execute(
                        "SELECT * FROM plex_push_cache WHERE LOWER(asset_path) = ? OR LOWER(asset_path) = ?",
                        (resolved_path, raw_norm)
                    )
                    row = cursor.fetchone()

                # 3. Fallback: match by collection folder & filename suffix (e.g. Collections/Name/poster.png)
                if not row and asset_path:
                    parts = Path(asset_path).parts
                    if len(parts) >= 2:
                        suffix_pattern = f"%{parts[-2].lower()}/{parts[-1].lower()}"
                        cursor.execute(
                            "SELECT * FROM plex_push_cache WHERE LOWER(asset_path) LIKE ? ORDER BY id DESC LIMIT 1",
                            (suffix_pattern,)
                        )
                        row = cursor.fetchone()

                conn.close()
                if row:
                    return dict(row)
                return None
            except Exception as e:
                logger.error(f"[PlexPushCache] Error reading cache (path={asset_path}, ratingKey={rating_key}): {e}")
                return None

    def record_push(
        self,
        asset_path: str,
        file_mtime: float,
        file_size: int,
        rating_key: str,
        asset_type: str = "collection",
        library_name: str = "",
        item_title: str = "",
        status: str = "synced"
    ) -> bool:
        try:
            norm_path = str(Path(asset_path).resolve()).replace("\\", "/")
        except Exception:
            norm_path = str(asset_path).replace("\\", "/")
        now_iso = datetime.now().isoformat()
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "SELECT id FROM plex_push_cache WHERE rating_key = ? OR LOWER(asset_path) = ?",
                        (str(rating_key), norm_path.lower())
                    )
                    existing = cursor.fetchone()
                    if existing:
                        conn.execute("""
                            UPDATE plex_push_cache SET
                                asset_path = ?,
                                file_mtime = ?,
                                file_size = ?,
                                rating_key = ?,
                                asset_type = ?,
                                library_name = ?,
                                item_title = ?,
                                last_pushed_at = ?,
                                status = ?
                            WHERE id = ?
                        """, (
                            norm_path, file_mtime, file_size, str(rating_key),
                            asset_type, library_name, item_title, now_iso, status,
                            existing[0]
                        ))
                    else:
                        conn.execute("""
                            INSERT INTO plex_push_cache (
                                asset_path, file_mtime, file_size, rating_key,
                                asset_type, library_name, item_title, last_pushed_at, status
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            norm_path, file_mtime, file_size, str(rating_key),
                            asset_type, library_name, item_title, now_iso, status
                        ))
                conn.close()
                return True
            except Exception as e:
                logger.error(f"[PlexPushCache] Error recording push for {norm_path}: {e}")
                return False

    def is_asset_in_sync(self, file_path: Path, rating_key: Optional[str] = None) -> bool:
        if not file_path.exists():
            return False
        try:
            stat = file_path.stat()
            entry = self.get_entry(str(file_path), rating_key=rating_key)
            if not entry:
                return False
            # Check if file has been modified since cached upload
            cached_mtime = float(entry.get("file_mtime") or 0)
            cached_size = int(entry.get("file_size") or 0)
            # Match within 2 seconds tolerance for filesystem precision differences
            if (abs(stat.st_mtime - cached_mtime) < 2.0 or stat.st_mtime <= cached_mtime + 2.0) and stat.st_size == cached_size:
                return True
            return False
        except Exception:
            return False


# ==============================================================================
# 2. NAME NORMALIZATION & COLLECTION ASSET DISCOVERY
# ==============================================================================

def normalize_collection_name(name: str) -> str:
    """Normalize a collection name for fuzzy, case-insensitive comparison."""
    if not name:
        return ""
    s = name.strip()
    # Strip common boxset tags like [boxset], {boxset}, (boxset)
    s = re.sub(r'[\[\{\(]boxset[\)\}\]]', '', s, flags=re.IGNORECASE)
    # Replace & with and
    s = s.replace('&', 'and')
    # Remove punctuation / special characters
    s = re.sub(r'[\':;\"!?,\-–—._]', ' ', s)
    # Collapse whitespace
    s = re.sub(r'\s+', ' ', s).strip().lower()
    # Strip trailing "collection"
    if s.endswith(' collection'):
        s = s[:-11].strip()
    return s


def is_collection_match(server_name: str, local_name: str) -> bool:
    """Compare a server collection name with a local folder/filename."""
    if not server_name or not local_name:
        return False
    norm_s = normalize_collection_name(server_name)
    norm_l = normalize_collection_name(local_name)
    if not norm_s or not norm_l:
        return False
    return norm_s == norm_l


def scan_local_collection_assets(assets_dir: Path) -> Dict[str, Dict[str, Any]]:
    """
    Scans Assets/Collections (and subfolders) for collection posters and backdrops.
    Returns dictionary mapping normalized collection names to asset file paths.
    """
    results: Dict[str, Dict[str, Any]] = {}
    if not assets_dir.exists():
        return results

    collections_root = assets_dir / "Collections"
    if not collections_root.exists() or not collections_root.is_dir():
        return results

    supported_exts = {".jpg", ".jpeg", ".png", ".webp"}
    poster_filenames = {"poster", "folder", "cover", "default"}
    backdrop_filenames = {"background", "fanart", "backdrop", "art"}

    # 1. Check subfolders in Assets/Collections/<Name>/... or Assets/Collections/<Lib>/<Name>/...
    for root, dirs, files in os.walk(collections_root):
        rel_root = Path(root).relative_to(assets_dir)
        folder_name = Path(root).name

        # If inside a collection folder
        if root != str(collections_root):
            matched_poster = None
            matched_backdrop = None

            for f in files:
                p = Path(f)
                ext = p.suffix.lower()
                if ext not in supported_exts:
                    continue
                stem = p.stem.lower()

                if stem in poster_filenames or stem == folder_name.lower():
                    matched_poster = Path(root) / f
                elif stem in backdrop_filenames:
                    matched_backdrop = Path(root) / f

            if matched_poster:
                norm_key = normalize_collection_name(folder_name)
                rel_poster = matched_poster.relative_to(assets_dir)
                rel_poster_str = str(rel_poster).replace("\\", "/")

                mtime_val = matched_poster.stat().st_mtime
                results[norm_key] = {
                    "collection_folder": folder_name,
                    "poster_path": str(matched_poster),
                    "poster_rel_path": rel_poster_str,
                    "poster_url": f"/poster_assets/{urllib.parse.quote(rel_poster_str, safe='/')}?t={int(mtime_val)}",
                    "backdrop_path": str(matched_backdrop) if matched_backdrop else None,
                    "mtime": mtime_val,
                    "size": matched_poster.stat().st_size,
                }

    # 2. Check flat files directly in Assets/Collections/<Name>.jpg
    try:
        for f in collections_root.iterdir():
            if f.is_file() and f.suffix.lower() in supported_exts:
                stem = f.stem
                norm_key = normalize_collection_name(stem)
                if norm_key not in results:
                    rel_poster = f.relative_to(assets_dir)
                    rel_poster_str = str(rel_poster).replace("\\", "/")
                    f_mtime = f.stat().st_mtime
                    results[norm_key] = {
                        "collection_folder": stem,
                        "poster_path": str(f),
                        "poster_rel_path": rel_poster_str,
                        "poster_url": f"/poster_assets/{urllib.parse.quote(rel_poster_str, safe='/')}?t={int(f_mtime)}",
                        "backdrop_path": None,
                        "mtime": f_mtime,
                        "size": f.stat().st_size,
                    }
    except Exception as e:
        logger.error(f"[scan_local_collection_assets] Error checking flat collection files: {e}")

    return results


# ==============================================================================
# 3. PLEX CREDENTIALS HELPER
# ==============================================================================

def get_plex_credentials_from_config(config_path: Path) -> Tuple[Optional[str], Optional[str]]:
    """Extract Plex URL and Token from config.json (supporting flat or nested structure)."""
    if not config_path.exists():
        return None, None
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)

        if cfg.get("using_flat_structure"):
            url = cfg.get("PlexUrl")
            token = cfg.get("PlexToken")
        else:
            url = cfg.get("PlexPart", {}).get("PlexUrl")
            token = cfg.get("ApiPart", {}).get("PlexToken")

        if url:
            url = url.rstrip('/')
        return url, token
    except Exception as e:
        logger.error(f"[get_plex_credentials] Failed to load config: {e}")
        return None, None


def get_plex_exclusions_from_config(config_path: Path) -> List[str]:
    """Extract Plex excluded libraries from config.json (supporting flat or nested structure)."""
    if not config_path.exists():
        return []
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        if cfg.get("using_flat_structure"):
            return cfg.get("PlexLibstoExclude", []) or []
        else:
            return cfg.get("PlexPart", {}).get("LibstoExclude", []) or []
    except Exception as e:
        logger.error(f"[get_plex_exclusions] Failed to load config: {e}")
        return []


def get_effective_plex_exclusions(config_path: Path, db_path: Optional[Path] = None) -> List[str]:
    """Get unique combined list of Plex excluded libraries from config.json and server_libraries.db."""
    exclusions = set()
    cfg_ex = get_plex_exclusions_from_config(config_path)
    if cfg_ex:
        exclusions.update(cfg_ex)

    if db_path and db_path.exists():
        try:
            conn = sqlite3.connect(db_path, timeout=5)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT library_name FROM media_server_libraries WHERE server_type = 'plex' AND is_excluded = 1")
            for row in cursor.fetchall():
                exclusions.add(row["library_name"])
            conn.close()
        except Exception:
            pass
    return sorted(list(exclusions))


def get_asset_path_from_config(config_path: Path, base_dir: Optional[Path] = None) -> Path:
    """Extract AssetPath from config.json (supporting flat or nested structure), fallback to base_dir/assets or /assets."""
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            asset_path = None
            if cfg.get("using_flat_structure"):
                asset_path = cfg.get("AssetPath")
            else:
                asset_path = cfg.get("PrerequisitePart", {}).get("AssetPath") or cfg.get("AssetPath")
            if asset_path and Path(asset_path).exists():
                return Path(asset_path)
        except Exception as e:
            logger.warning(f"[get_asset_path_from_config] Error reading {config_path}: {e}")

    if base_dir and (base_dir / "assets").exists():
        return base_dir / "assets"
    if Path("/assets").exists():
        return Path("/assets")
    return (base_dir / "assets") if base_dir else Path("assets")


# ==============================================================================
# 4. COLLECTION DIFF DETECTION & ENRICHMENT
# ==============================================================================

async def get_plex_collection_diffs(
    plex_url: str,
    plex_token: str,
    library_id: Optional[str] = None,
    assets_dir: Optional[Path] = None,
    cache: Optional[PlexPushCache] = None,
    limit: int = 99999,
    excluded_libraries: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """
    Queries Plex server collections and correlates them with local assets and push cache.
    Returns list of collections with syncStatus, localPosterUrl, and diff information.
    When library_id is 'all' or None, libraries in excluded_libraries are skipped.
    """
    if not assets_dir:
        assets_dir = Path("/assets") if Path("/assets").exists() else Path("assets")

    if not cache:
        cache_db_path = Path("database/plex_push_cache.db")
        cache = PlexPushCache(cache_db_path)

    local_assets = scan_local_collection_assets(assets_dir)
    enriched_items: List[Dict[str, Any]] = []

    plex_url = plex_url.rstrip('/')
    headers = {
        "X-Plex-Token": plex_token,
        "Accept": "application/xml"
    }

    section_entries: List[Tuple[str, str]] = [] # list of (sec_key, sec_title)
    ex_set = {str(x).lower().strip() for x in (excluded_libraries or [])}

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Fetch Plex server identity for direct Plex Web deep links (app.plex.tv/desktop/#!/server/{machineIdentifier}/details?key=...)
        machine_identifier = ""
        try:
            id_res = await client.get(f"{plex_url}/identity", headers=headers)
            if id_res.status_code == 200:
                id_root = fromstring(id_res.content)
                machine_identifier = id_root.get("machineIdentifier", "")
        except Exception as e:
            logger.debug(f"[get_plex_collection_diffs] Could not fetch Plex identity: {e}")

        # Query all sections from Plex
        try:
            sec_res = await client.get(f"{plex_url}/library/sections", headers=headers)
            if sec_res.status_code == 200:
                root = fromstring(sec_res.content)
                if not machine_identifier:
                    machine_identifier = root.get("machineIdentifier", "")
                for dir_elem in root.findall(".//Directory"):
                    sec_type = dir_elem.get("type")
                    sec_key = dir_elem.get("key")
                    sec_title = dir_elem.get("title", "")
                    if sec_type not in ["movie", "show"]:
                        continue

                    # If specific library requested:
                    if library_id and library_id != "all":
                        if library_id == sec_key or library_id.lower().strip() == sec_title.lower().strip():
                            section_entries.append((sec_key, sec_title))
                    else:
                        # "all" libraries requested: skip if library is excluded in config
                        if sec_title.lower().strip() in ex_set:
                            logger.info(f"[get_plex_collection_diffs] Skipping excluded Plex library: '{sec_title}'")
                            continue
                        section_entries.append((sec_key, sec_title))
        except Exception as e:
            logger.error(f"[get_plex_collection_diffs] Failed fetching Plex sections: {e}")

        # Fallback if specific library_id was passed and not found via title matching
        if not section_entries and library_id and library_id != "all":
            section_entries.append((library_id, ""))

        for sec_id, sec_name in section_entries:
            try:
                # Type 18 = Collection
                api_url = f"{plex_url}/library/sections/{sec_id}/all"
                res = await client.get(api_url, headers=headers, params={"type": "18"})
                if res.status_code != 200:
                    continue

                root = fromstring(res.content)
                for item in root.findall(".//*[@title]"):
                    rating_key = item.get("ratingKey", "")
                    title = item.get("title", "")
                    thumb = item.get("thumb", "")
                    has_server_poster = bool(thumb)

                    if has_server_poster and thumb:
                        thumb_path = thumb if thumb.startswith("/") else f"/{thumb}"
                        server_poster_url = (
                            f"/api/media-server/image?server_type=plex&url="
                            f"{urllib.parse.quote(f'{plex_url}{thumb_path}')}"
                        )
                    elif has_server_poster:
                        server_poster_url = (
                            f"/api/media-server/image?server_type=plex&url="
                            f"{urllib.parse.quote(f'{plex_url}/library/metadata/{rating_key}/thumb')}"
                        )
                    else:
                        server_poster_url = None

                    # Extract server timestamp from thumb URL (/library/metadata/{key}/thumb/{timestamp}) or updatedAt
                    server_thumb_timestamp = 0.0
                    if thumb:
                        thumb_parts = thumb.rstrip("/").split("/")
                        if thumb_parts and thumb_parts[-1].isdigit():
                            try:
                                server_thumb_timestamp = float(thumb_parts[-1])
                            except (ValueError, TypeError):
                                pass
                    if not server_thumb_timestamp and item.get("updatedAt"):
                        try:
                            server_thumb_timestamp = float(item.get("updatedAt"))
                        except (ValueError, TypeError):
                            pass
                    if not server_thumb_timestamp and item.get("addedAt"):
                        try:
                            server_thumb_timestamp = float(item.get("addedAt"))
                        except (ValueError, TypeError):
                            pass

                    # Match with local asset
                    norm_title = normalize_collection_name(title)
                    matched_local = local_assets.get(norm_title)

                    # Fallback check against all local keys if exact match misses
                    if not matched_local:
                        for l_key, l_data in local_assets.items():
                            if is_collection_match(title, l_key):
                                matched_local = l_data
                                break

                    sync_status = "missing_local"
                    local_poster_url = None
                    local_asset_path = None
                    last_pushed_at = None

                    if matched_local:
                        local_poster_url = matched_local["poster_url"]
                        local_asset_path = matched_local["poster_rel_path"]
                        full_local_path = Path(matched_local["poster_path"])
                        current_mtime = matched_local["mtime"]

                        # Check cache using both resolved path and rating_key
                        cache_entry = cache.get_entry(str(full_local_path), rating_key=rating_key)
                        if cache_entry:
                            last_pushed_at = cache_entry.get("last_pushed_at")
                            cached_mtime = float(cache_entry.get("file_mtime") or 0)

                            # If local file hasn't been modified since cached push:
                            if abs(current_mtime - cached_mtime) < 2.0 or current_mtime <= cached_mtime + 2.0:
                                sync_status = "synced"
                            else:
                                sync_status = "update_available"
                        else:
                            # Not in cache yet
                            if has_server_poster:
                                # Compare local file modification time with server thumb/updatedAt timestamp
                                if server_thumb_timestamp > 0 and current_mtime <= server_thumb_timestamp + 5.0:
                                    # Server poster was set at or after local file modification => already in sync!
                                    sync_status = "synced"
                                    # Seed cache entry
                                    cache.record_push(
                                        asset_path=str(full_local_path),
                                        file_mtime=current_mtime,
                                        file_size=matched_local["size"],
                                        rating_key=rating_key,
                                        asset_type="collection",
                                        item_title=title,
                                        status="synced"
                                    )
                                else:
                                    sync_status = "update_available"
                            else:
                                sync_status = "missing_server"

                    child_count_str = item.get("childCount") or item.get("leafCount") or item.get("size")
                    child_count = int(child_count_str) if child_count_str and child_count_str.isdigit() else None
                    min_year = item.get("minYear", "")
                    max_year = item.get("maxYear", "")
                    year_val = item.get("year", "")
                    if min_year and max_year:
                        year_display = min_year if min_year == max_year else f"{min_year} - {max_year}"
                    elif min_year:
                        year_display = min_year
                    elif max_year:
                        year_display = max_year
                    elif year_val:
                        year_display = year_val
                    else:
                        year_display = ""

                    local_stat = full_local_path.stat() if (matched_local and full_local_path.exists()) else None

                    enriched_items.append({
                        "ratingKey": rating_key,
                        "title": title,
                        "year": year_display,
                        "minYear": min_year,
                        "maxYear": max_year,
                        "childCount": child_count,
                        "itemCount": child_count,
                        "summary": item.get("summary", ""),
                        "type": "collection",
                        "subtype": item.get("subtype", "movie"),
                        "libraryId": sec_id,
                        "libraryName": sec_name or item.get("libraryName", ""),
                        "hasPoster": has_server_poster,
                        "posterUrl": server_poster_url,
                        "hasLocalAsset": bool(matched_local),
                        "localPosterUrl": local_poster_url,
                        "localAssetPath": local_asset_path,
                        "localFullPath": matched_local["poster_path"] if matched_local else None,
                        "localFilename": Path(matched_local["poster_path"]).name if matched_local else "poster.png",
                        "localSize": local_stat.st_size if local_stat else (matched_local.get("size") if matched_local else None),
                        "localMtime": local_stat.st_mtime if local_stat else (matched_local.get("mtime") if matched_local else None),
                        "localCreated": getattr(local_stat, "st_ctime", None) if local_stat else None,
                        "updatedAt": server_thumb_timestamp or None,
                        "syncStatus": sync_status,
                        "lastPushedAt": last_pushed_at,
                        "machineIdentifier": machine_identifier,
                        "plexWebUrl": f"https://app.plex.tv/desktop/#!/server/{machine_identifier}/details?key=%2Flibrary%2Fcollections%2F{rating_key}" if (machine_identifier and rating_key) else None,
                        "plexLocalUrl": f"{plex_url}/web/index.html#!/server/{machine_identifier}/details?key=%2Flibrary%2Fcollections%2F{rating_key}" if (machine_identifier and rating_key) else None,
                    })

            except Exception as e:
                logger.error(f"[get_plex_collection_diffs] Error scanning section {sec_id}: {e}")

    return enriched_items


# ==============================================================================
# 5. PLEX ARTWORK UPLOAD
# ==============================================================================

async def push_collection_artwork_to_plex(
    plex_url: str,
    plex_token: str,
    rating_key: str,
    local_image_path: Path,
    cache: PlexPushCache,
    asset_type: str = "collection",
    library_name: str = "",
    item_title: str = "",
    is_backdrop: bool = False
) -> Dict[str, Any]:
    """Uploads a local image file directly to Plex Media Server collection metadata."""
    safe_key = "".join(c for c in str(rating_key) if c.isdigit()).strip()
    if not safe_key:
        return {"success": False, "error": f"Invalid rating_key: {rating_key}"}

    local_image_path = local_image_path.resolve()
    if not local_image_path.exists() or not local_image_path.is_file():
        return {"success": False, "error": f"Local file not found: {local_image_path}"}

    plex_url = plex_url.rstrip('/')
    endpoint = "arts" if is_backdrop else "posters"
    upload_url = f"{plex_url}/library/metadata/{safe_key}/{endpoint}"

    # Determine MIME type
    ext = local_image_path.suffix.lower()
    content_type = "image/png" if ext == ".png" else "image/jpeg"

    try:
        with open(local_image_path, "rb") as img_file:
            data = img_file.read()

        stat = local_image_path.stat()
        headers = {
            "X-Plex-Token": plex_token,
            "Content-Type": content_type
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(upload_url, headers=headers, content=data)
            if response.status_code in [200, 201]:
                # Update persistent cache on success
                cache.record_push(
                    asset_path=str(local_image_path),
                    file_mtime=stat.st_mtime,
                    file_size=stat.st_size,
                    rating_key=safe_key,
                    asset_type=asset_type,
                    library_name=library_name,
                    item_title=item_title,
                    status="synced"
                )
                return {"success": True, "message": f"Successfully uploaded {asset_type} artwork to Plex"}
            else:
                return {
                    "success": False,
                    "error": f"Plex returned status code {response.status_code}: {response.text[:200]}"
                }
    except Exception as e:
        logger.error(f"[push_collection_artwork_to_plex] Failed upload for ratingKey {safe_key}: {e}")
        return {"success": False, "error": str(e)}


async def push_batch_collections_to_plex(
    plex_url: str,
    plex_token: str,
    items: List[Dict[str, Any]],
    assets_dir: Path,
    cache: PlexPushCache,
    max_concurrency: int = 2
) -> Dict[str, Any]:
    """
    Pushes a list of collection artwork to Plex with controlled concurrency (semaphore).
    """
    semaphore = asyncio.Semaphore(max_concurrency)
    pushed_count = 0
    failed_count = 0
    errors: List[str] = []

    async def _push_worker(item: Dict[str, Any]):
        nonlocal pushed_count, failed_count
        raw_key = item.get("ratingKey")
        local_rel = str(item.get("localAssetPath", "")).strip()
        title = item.get("title", "")
        if not raw_key or not local_rel:
            return

        safe_key = "".join(c for c in str(raw_key) if c.isdigit()).strip()
        if not safe_key:
            failed_count += 1
            errors.append(f"{title}: Invalid rating key")
            return

        # Secure path traversal check
        try:
            safe_rel = local_rel.lstrip("/\\")
            cand_path = (assets_dir / safe_rel).resolve()
            if not cand_path.is_relative_to(assets_dir.resolve()):
                failed_count += 1
                errors.append(f"{title}: Path traversal attempt blocked")
                return
            if not cand_path.exists() or not cand_path.is_file():
                failed_count += 1
                return
            full_path = cand_path
        except Exception:
            failed_count += 1
            return

        async with semaphore:
            res = await push_collection_artwork_to_plex(
                plex_url=plex_url,
                plex_token=plex_token,
                rating_key=safe_key,
                local_image_path=full_path,
                cache=cache,
                asset_type="collection",
                item_title=title
            )
            if res.get("success"):
                pushed_count += 1
            else:
                failed_count += 1
                errors.append(f"{title}: {res.get('error')}")

    tasks = [_push_worker(it) for it in items]
    await asyncio.gather(*tasks, return_exceptions=True)

    return {
        "success": True,
        "total": len(items),
        "pushed": pushed_count,
        "failed": failed_count,
        "errors": errors[:10]
    }


# ==============================================================================
# 6. SCHEDULED FULL PLEX SYNC TASK
# ==============================================================================

async def run_plex_sync_task(
    schedule_config: Dict[str, Any],
    base_dir: Path,
    assets_dir: Path,
    config_path: Path,
    log_file_path: Optional[Path] = None
) -> Dict[str, Any]:
    """
    Main execution worker for the 'plexsync' Scheduler mode.
    Handles targeted libraries and asset types (collection, poster, season, titlecard, background).
    Writes execution status directly to UILogs/PlexSync.log.
    """
    if not log_file_path:
        log_file_path = base_dir / "UILogs" / "PlexSync.log"
    log_file_path.parent.mkdir(parents=True, exist_ok=True)

    def write_log(msg: str):
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        formatted = f"[{now_str}] {msg}\n"
        try:
            with open(log_file_path, "a", encoding="utf-8") as lf:
                lf.write(formatted)
        except Exception:
            pass
        logger.info(f"[PlexSync] {msg}")

    write_log("=" * 60)
    write_log("STARTING SCHEDULED PLEX SYNC TASK")

    plex_url, plex_token = get_plex_credentials_from_config(config_path)
    if not plex_url or not plex_token:
        err = "Plex URL or Plex Token is not configured. Aborting sync."
        write_log(f"ERROR: {err}")
        write_log("=" * 60)
        return {"success": False, "error": err}

    target_lib = schedule_config.get("library", "all")
    asset_types = schedule_config.get("asset_types", ["collection", "poster", "season", "titlecard", "background"])
    if isinstance(asset_types, str):
        asset_types = [asset_types] if asset_types != "all" else ["collection", "poster", "season", "titlecard", "background"]

    # Retrieve exclusions from config.json and server_libraries.db
    excluded_libraries = get_effective_plex_exclusions(config_path, base_dir / "database" / "server_libraries.db")

    # Resolve real assets_dir from config if not supplied or invalid/empty default
    cfg_assets = get_asset_path_from_config(config_path, base_dir)
    if cfg_assets and cfg_assets.exists():
        assets_dir = cfg_assets
    elif not assets_dir or not assets_dir.exists():
        assets_dir = cfg_assets

    write_log(f"Assets Directory: {assets_dir}")
    write_log(f"Target Library: {target_lib}")
    if target_lib == "all" and excluded_libraries:
        write_log(f"Config Excluded Libraries ({len(excluded_libraries)}): {', '.join(excluded_libraries)}")
    write_log(f"Target Asset Types: {', '.join(asset_types)}")

    cache_db_path = base_dir / "database" / "plex_push_cache.db"
    cache = PlexPushCache(cache_db_path)

    total_checked = 0
    total_pushed = 0
    total_skipped = 0
    total_failed = 0

    # 1. Sync Collections if enabled
    if "collection" in asset_types:
        write_log("--- Syncing Collections ---")
        try:
            diffs = await get_plex_collection_diffs(
                plex_url=plex_url,
                plex_token=plex_token,
                library_id=None if target_lib == "all" else target_lib,
                assets_dir=assets_dir,
                cache=cache,
                excluded_libraries=excluded_libraries if target_lib == "all" else None
            )
            write_log(f"Discovered {len(diffs)} Plex collection(s) in included libraries.")

            to_push = [d for d in diffs if d.get("syncStatus") in ["update_available", "missing_server"] and d.get("hasLocalAsset")]
            in_sync_count = len([d for d in diffs if d.get("syncStatus") == "synced"])
            no_local_count = len([d for d in diffs if not d.get("hasLocalAsset")])
            write_log(f"Found {len(to_push)} collection(s) needing artwork push ({in_sync_count} in-sync, {no_local_count} without local asset).")

            for item in to_push:
                total_checked += 1
                title = item.get("title")
                lib_name = item.get("libraryName", "")
                rating_key = "".join(c for c in str(item.get("ratingKey", "")) if c.isdigit())
                if not rating_key:
                    continue

                full_path = None
                if item.get("localFullPath") and Path(item["localFullPath"]).exists():
                    full_path = Path(item["localFullPath"])
                else:
                    local_rel = str(item.get("localAssetPath", "")).lstrip("/\\")
                    if local_rel:
                        try:
                            cand = (assets_dir / local_rel).resolve()
                            if cand.exists() and cand.is_file():
                                full_path = cand
                        except Exception:
                            pass

                if not full_path or not full_path.exists() or not full_path.is_file():
                    write_log(f"  [!] Artwork file missing on disk for '{title}' (RatingKey: {rating_key})")
                    continue

                res = await push_collection_artwork_to_plex(
                    plex_url=plex_url,
                    plex_token=plex_token,
                    rating_key=rating_key,
                    local_image_path=full_path,
                    cache=cache,
                    asset_type="collection",
                    library_name=lib_name,
                    item_title=title
                )
                if res.get("success"):
                    total_pushed += 1
                    write_log(f"  [+] Pushed collection poster for '{title}' in '{lib_name}' (RatingKey: {rating_key})")
                else:
                    total_failed += 1
                    write_log(f"  [-] Failed collection poster for '{title}' in '{lib_name}': {res.get('error')}")

            total_skipped += in_sync_count
        except Exception as e:
            write_log(f"Error during collection sync: {e}")

    # 2. Sync Media Items (posters, seasons, titlecards, backgrounds) via media_export.db
    media_types_requested = set(asset_types) - {"collection"}
    if media_types_requested:
        write_log(f"--- Syncing Media Items: {', '.join(media_types_requested)} ---")
        export_db_path = base_dir / "database" / "media_export.db"
        if export_db_path.exists():
            try:
                conn = sqlite3.connect(export_db_path, timeout=10)
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                query = "SELECT rating_key, root_foldername, library_name, title, season_rating_keys FROM plex_library_export"
                params = []
                if target_lib != "all":
                    query += " WHERE library_name = ?"
                    params.append(target_lib)
                elif excluded_libraries:
                    placeholders = ",".join("?" for _ in excluded_libraries)
                    query += f" WHERE library_name NOT IN ({placeholders})"
                    params.extend(excluded_libraries)

                cursor.execute(query, params)
                items = cursor.fetchall()
                write_log(f"Found {len(items)} media export item(s) in included libraries to evaluate.")

                for row in items:
                    r_key = "".join(c for c in str(row["rating_key"]) if c.isdigit())
                    r_folder = str(row["root_foldername"] or "").strip().replace("\\", "/").lstrip("/")
                    lib_name = str(row["library_name"] or "").strip().replace("\\", "/").lstrip("/")
                    title = row["title"] or r_folder

                    if not r_folder or not r_key or ".." in r_folder or ".." in lib_name:
                        continue

                    # Check poster
                    if "poster" in media_types_requested:
                        for ext in [".jpg", ".png", ".webp"]:
                            try:
                                p_file = (assets_dir / lib_name / r_folder / f"poster{ext}").resolve()
                                if not p_file.is_relative_to(assets_dir.resolve()):
                                    continue
                            except Exception:
                                continue

                            if p_file.exists() and p_file.is_file():
                                total_checked += 1
                                if not cache.is_asset_in_sync(p_file):
                                    res = await push_collection_artwork_to_plex(
                                        plex_url=plex_url, plex_token=plex_token,
                                        rating_key=r_key, local_image_path=p_file,
                                        cache=cache, asset_type="poster", library_name=lib_name, item_title=title
                                    )
                                    if res.get("success"):
                                        total_pushed += 1
                                        write_log(f"  [+] Pushed movie/show poster: '{title}'")
                                    else:
                                        total_failed += 1
                                else:
                                    total_skipped += 1
                                break

                    # Check background
                    if "background" in media_types_requested:
                        for b_name in ["background", "fanart", "backdrop"]:
                            for ext in [".jpg", ".png", ".webp"]:
                                try:
                                    b_file = (assets_dir / lib_name / r_folder / f"{b_name}{ext}").resolve()
                                    if not b_file.is_relative_to(assets_dir.resolve()):
                                        continue
                                except Exception:
                                    continue

                                if b_file.exists() and b_file.is_file():
                                    total_checked += 1
                                    if not cache.is_asset_in_sync(b_file):
                                        res = await push_collection_artwork_to_plex(
                                            plex_url=plex_url, plex_token=plex_token,
                                            rating_key=r_key, local_image_path=b_file,
                                            cache=cache, asset_type="background", library_name=lib_name, item_title=title,
                                            is_backdrop=True
                                        )
                                        if res.get("success"):
                                            total_pushed += 1
                                            write_log(f"  [+] Pushed background: '{title}'")
                                        else:
                                            total_failed += 1
                                    else:
                                        total_skipped += 1
                                    break

                conn.close()
            except Exception as e:
                write_log(f"Error reading media_export.db: {e}")

    write_log(f"SYNC SUMMARY: Checked: {total_checked}, Pushed: {total_pushed}, Skipped (In-Sync): {total_skipped}, No Local Asset: {no_local_count}, Failed: {total_failed}")
    write_log("PLEX SYNC TASK COMPLETED")
    write_log("=" * 60)

    return {
        "success": True,
        "checked": total_checked,
        "pushed": total_pushed,
        "skipped": total_skipped,
        "failed": total_failed
    }
