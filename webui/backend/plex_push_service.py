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
import socket
import ipaddress
import sqlite3
import logging
import asyncio
import threading
from pathlib import Path
from datetime import datetime
from typing import Union, Optional, Dict, List, Any, Tuple
import urllib.parse
from xml.etree.ElementTree import fromstring
import httpx

logger = logging.getLogger("plex_push_service")


# ==============================================================================
# SECURITY UTILITIES (SSRF & PATH TRAVERSAL MITIGATION)
# ==============================================================================

def is_safe_url(url: str, allow_private: bool = True, allow_loopback: bool = True) -> bool:
    """
    Validate that URL is using http/https and does not target link-local cloud metadata (169.254.169.254) or multicast.
    Allows private IPs and localhost/127.0.0.1 when allow_loopback=True (to support media servers hosted on the same machine).
    """
    if not url:
        return False
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ["http", "https"]:
            return False

        hostname = parsed.hostname
        if not hostname:
            return False

        # Allow localhost / loopback only if allow_loopback is True
        if hostname.lower() in ["localhost", "127.0.0.1", "::1"]:
            if not allow_loopback:
                logger.warning(f"[Security] Blocked loopback URL: {hostname}")
                return False
            return True

        try:
            ip_addr = socket.gethostbyname(hostname)
            ip = ipaddress.ip_address(ip_addr)
        except Exception as res_err:
            logger.debug(f"[Security] URL hostname resolution failed for '{hostname}': {res_err}")
            return False

        # Strictly block link-local (cloud metadata 169.254.x.x) and multicast
        if ip.is_link_local or ip.is_multicast:
            logger.warning(f"[Security] Blocked SSRF attempt to link-local/multicast IP: {ip_addr}")
            return False

        if ip.is_loopback and not allow_loopback:
            logger.warning(f"[Security] Blocked loopback IP: {ip_addr}")
            return False

        if not allow_private and ip.is_private:
            logger.warning(f"[Security] Blocked SSRF attempt to private IP: {ip_addr}")
            return False

        return True
    except Exception as e:
        logger.error(f"[Security] Error validating URL '{url}': {e}")
        return False


def safe_resolve_asset_path(
    base_dir: Path,
    user_path: Union[str, Path],
    allowed_extensions: Optional[set] = None
) -> Optional[Path]:
    """
    Safely resolves a path relative to base_dir, strictly preventing path traversal.
    Blocks null bytes, traversal parent directory patterns ('..'), and restricts to allowed extensions.
    """
    if not user_path:
        return None
    try:
        base_resolved = Path(base_dir).resolve(strict=False)

        if isinstance(user_path, Path) and user_path.is_absolute():
            try:
                rel = user_path.relative_to(base_resolved)
                user_str = str(rel).replace("\\", "/")
            except ValueError:
                logger.warning(f"[Security] Path outside base directory: {user_path}")
                return None
        else:
            user_str = str(user_path).strip().replace("\\", "/")

        path_parts = [p for p in user_str.split("/") if p]
        if (
            "\x00" in user_str
            or user_str.startswith("/")
            or any(part in ("..", "~") for part in path_parts)
        ):
            logger.warning(f"[Security] Directory traversal detected in path: {user_path}")
            return None

        clean_parts = [p for p in re.sub(r'^[a-zA-Z]:', '', user_str).split("/") if p and p not in ("..", "~", ".")]
        if not clean_parts:
            return None

        resolved_candidate = (base_resolved / Path(*clean_parts)).resolve(strict=False)
        try:
            rel_path = resolved_candidate.relative_to(base_resolved)
        except ValueError:
            logger.warning(f"[Security] Path traversal attempt blocked: {user_path} outside {base_dir}")
            return None

        safe_path = (base_resolved / rel_path).resolve(strict=False)

        if allowed_extensions and safe_path.suffix.lower() not in allowed_extensions:
            logger.warning(f"[Security] Disallowed file extension: {safe_path.suffix} in {user_path}")
            return None

        return safe_path
    except Exception as e:
        logger.warning(f"[Security] Error resolving safe path for {user_path}: {e}")
        return None


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
        norm_path = os.path.normpath(str(asset_path)).replace("\\", "/")
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
    if not is_safe_url(plex_url, allow_private=True):
        logger.warning(f"[get_plex_collection_diffs] Blocked unsafe Plex URL: {plex_url}")
        return []

    clean_lib_id = None
    if library_id and library_id != "all":
        clean_lib_id = "".join(c for c in str(library_id) if c.isalnum() or c in "-_ ").strip()

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
                    if clean_lib_id:
                        if clean_lib_id == sec_key or clean_lib_id.lower().strip() == sec_title.lower().strip():
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
    is_backdrop: bool = False,
    allowed_base_dir: Optional[Path] = None
) -> Dict[str, Any]:
    """Uploads a local image file directly to Plex Media Server collection metadata."""
    if not is_safe_url(plex_url, allow_private=True):
        return {"success": False, "error": "Unsafe Plex server URL (SSRF blocked)"}

    safe_key = "".join(c for c in str(rating_key) if c.isdigit()).strip()
    if not safe_key:
        return {"success": False, "error": f"Invalid rating_key: {rating_key}"}

    if not allowed_base_dir:
        return {"success": False, "error": "Server misconfiguration: allowed_base_dir is required for safe path validation"}

    validated_path = safe_resolve_asset_path(allowed_base_dir, local_image_path, allowed_extensions={".jpg", ".jpeg", ".png", ".webp"})
    if not validated_path or not validated_path.is_file():
        return {"success": False, "error": "Local artwork file not found or path blocked"}

    local_image_path = validated_path

    ext = local_image_path.suffix.lower()
    allowed_exts = {".jpg", ".jpeg", ".png", ".webp"}
    if ext not in allowed_exts:
        return {"success": False, "error": f"Disallowed file extension '{ext}'. Only {allowed_exts} allowed."}

    try:
        stat = local_image_path.stat()
        if stat.st_size > 50 * 1024 * 1024:
            return {"success": False, "error": f"File size exceeds 50MB limit: {stat.st_size} bytes"}
    except Exception as e:
        return {"success": False, "error": f"Could not inspect file: {e}"}

    plex_url = plex_url.rstrip('/')
    endpoint = "arts" if is_backdrop else "posters"
    upload_url = f"{plex_url}/library/metadata/{safe_key}/{endpoint}"

    if ext == ".png":
        content_type = "image/png"
    elif ext == ".webp":
        content_type = "image/webp"
    else:
        content_type = "image/jpeg"

    try:
        with open(local_image_path, "rb") as img_file:
            data = img_file.read()

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
    if not is_safe_url(plex_url, allow_private=True):
        return {"success": False, "error": "Unsafe Plex server URL (SSRF blocked)"}

    safe_items = items[:500] if isinstance(items, list) else []

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

        full_path = safe_resolve_asset_path(assets_dir, local_rel, allowed_extensions={".jpg", ".jpeg", ".png", ".webp"})
        if not full_path or not full_path.is_file():
            failed_count += 1
            errors.append(f"{title}: Local artwork file not found or invalid path")
            return

        async with semaphore:
            res = await push_collection_artwork_to_plex(
                plex_url=plex_url,
                plex_token=plex_token,
                rating_key=safe_key,
                local_image_path=full_path,
                cache=cache,
                asset_type="collection",
                item_title=title,
                allowed_base_dir=assets_dir
            )
            if res.get("success"):
                pushed_count += 1
            else:
                failed_count += 1
                errors.append(f"{title}: {res.get('error')}")

    tasks = [_push_worker(it) for it in safe_items]
    await asyncio.gather(*tasks, return_exceptions=True)

    return {
        "success": True,
        "total": len(safe_items),
        "pushed": pushed_count,
        "failed": failed_count,
        "errors": errors[:10]
    }


# ==============================================================================
# 6. SCHEDULED FULL PLEX SYNC TASK & HELPERS
# ==============================================================================

def find_season_poster(show_dir: Path, s_num: int, r_folder: str = "") -> Optional[Path]:
    """Finds matching season poster on disk for season number s_num."""
    try:
        resolved_show_dir = show_dir.resolve()
    except Exception:
        return None

    allowed_exts = {".jpg", ".png", ".webp", ".jpeg"}
    stems = [
        f"Season{s_num:02d}",
        f"Season{s_num}",
        f"Season {s_num:02d}",
        f"Season {s_num}",
        f"season{s_num:02d}",
        f"season{s_num}",
        f"season {s_num:02d}",
        f"season {s_num}",
    ]
    clean_r = re.sub(r'[\W_]+', '', str(r_folder))
    if clean_r:
        stems.extend([
            f"{clean_r}_Season{s_num:02d}",
            f"{clean_r}_Season{s_num}",
        ])
    if s_num == 0:
        stems.extend(["Specials", "specials"])
        if clean_r:
            stems.extend([f"{clean_r}_Specials", f"{clean_r}_specials"])

    for stem in stems:
        for ext in allowed_exts:
            try:
                cand = (resolved_show_dir / f"{stem}{ext}").resolve()
                if cand.is_relative_to(resolved_show_dir) and cand.exists() and cand.is_file():
                    return cand
            except Exception:
                continue
    return None


def find_episode_titlecard(show_dir: Path, s_num: int, e_num: int, r_folder: str = "") -> Optional[Path]:
    """Finds matching episode titlecard on disk for SxxExx."""
    try:
        resolved_show_dir = show_dir.resolve()
    except Exception:
        return None

    allowed_exts = {".jpg", ".png", ".webp", ".jpeg"}
    tag_u = f"S{s_num:02d}E{e_num:02d}"
    tag_l = f"s{s_num:02d}e{e_num:02d}"
    stems = [tag_u, tag_l]
    clean_r = re.sub(r'[\W_]+', '', str(r_folder))
    if clean_r:
        stems.extend([f"{clean_r}_{tag_u}", f"{clean_r}_{tag_l}"])

    # 1. Look directly in show_dir
    for stem in stems:
        for ext in allowed_exts:
            try:
                cand = (resolved_show_dir / f"{stem}{ext}").resolve()
                if cand.is_relative_to(resolved_show_dir) and cand.exists() and cand.is_file():
                    return cand
            except Exception:
                continue

    # 2. Look in season subfolders if present
    subfolders = [
        f"Season {s_num:02d}", f"Season {s_num}",
        f"Season{s_num:02d}", f"Season{s_num}",
        f"season {s_num:02d}", f"season {s_num}",
        f"season{s_num:02d}", f"season{s_num}"
    ]
    if s_num == 0:
        subfolders.extend(["Specials", "specials"])

    for sub in subfolders:
        try:
            sub_dir = (resolved_show_dir / sub).resolve()
            if not sub_dir.is_relative_to(resolved_show_dir) or not sub_dir.exists() or not sub_dir.is_dir():
                continue
            for stem in stems:
                for ext in allowed_exts:
                    cand = (sub_dir / f"{stem}{ext}").resolve()
                    if cand.is_relative_to(resolved_show_dir) and cand.exists() and cand.is_file():
                        return cand
        except Exception:
            continue
    return None


async def fetch_plex_seasons(plex_url: str, plex_token: str, show_rating_key: str, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
    """Fetches seasons for a show directly from Plex API."""
    safe_rk = "".join(c for c in str(show_rating_key) if c.isdigit()).strip()
    if not safe_rk or not is_safe_url(plex_url, allow_private=True):
        return []

    try:
        url = f"{plex_url.rstrip('/')}/library/metadata/{safe_rk}/children"
        resp = await client.get(url, headers={"X-Plex-Token": plex_token, "Accept": "application/xml"})
        if resp.status_code == 200:
            root = fromstring(resp.content)
            seasons = []
            for d in root.findall(".//Directory"):
                rk = d.get("ratingKey")
                idx = d.get("index")
                if rk and idx is not None and idx.isdigit():
                    seasons.append({
                        "ratingKey": rk,
                        "seasonNumber": int(idx),
                        "title": d.get("title", f"Season {idx}")
                    })
            return seasons
    except Exception as e:
        logger.debug(f"Error fetching seasons for {safe_rk}: {e}")
    return []


async def fetch_plex_episodes(plex_url: str, plex_token: str, season_rating_key: str, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
    """Fetches episodes for a season directly from Plex API."""
    safe_rk = "".join(c for c in str(season_rating_key) if c.isdigit()).strip()
    if not safe_rk or not is_safe_url(plex_url, allow_private=True):
        return []

    try:
        url = f"{plex_url.rstrip('/')}/library/metadata/{safe_rk}/children"
        resp = await client.get(url, headers={"X-Plex-Token": plex_token, "Accept": "application/xml"})
        if resp.status_code == 200:
            root = fromstring(resp.content)
            episodes = []
            for v in root.findall(".//Video"):
                rk = v.get("ratingKey")
                idx = v.get("index")
                pidx = v.get("parentIndex")
                if rk and idx is not None and idx.isdigit():
                    episodes.append({
                        "ratingKey": rk,
                        "episodeNumber": int(idx),
                        "seasonNumber": int(pidx) if (pidx and pidx.isdigit()) else 1,
                        "title": v.get("title", f"Episode {idx}")
                    })
            return episodes
    except Exception as e:
        logger.debug(f"Error fetching episodes for season {safe_rk}: {e}")
    return []

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

    # Automatic log rotation: rotate if log file exceeds 10MB
    if log_file_path.exists():
        try:
            if log_file_path.stat().st_size > 10 * 1024 * 1024:
                old_log = log_file_path.with_name("PlexSync.old.log")
                if old_log.exists():
                    old_log.unlink()
                log_file_path.rename(old_log)
        except Exception:
            pass

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

    if not is_safe_url(plex_url, allow_private=True):
        err = f"Configured Plex URL '{plex_url}' is not safe (SSRF blocked). Aborting sync."
        write_log(f"ERROR: {err}")
        write_log("=" * 60)
        return {"success": False, "error": err}

    raw_target = str(schedule_config.get("library", "all")).strip()
    if ".." in raw_target or "/" in raw_target or "\\" in raw_target or "\x00" in raw_target:
        target_lib = "all"
    else:
        target_lib = raw_target

    raw_asset_types = schedule_config.get("asset_types", ["collection", "poster", "season", "titlecard", "background"])
    if isinstance(raw_asset_types, str):
        raw_asset_types = [raw_asset_types] if raw_asset_types != "all" else ["collection", "poster", "season", "titlecard", "background"]
    allowed_types = {"collection", "poster", "season", "titlecard", "background"}
    asset_types = [str(t).lower().strip() for t in raw_asset_types if str(t).lower().strip() in allowed_types]
    if not asset_types:
        asset_types = ["collection", "poster", "season", "titlecard", "background"]

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
    no_local_count = 0

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
                if item.get("localFullPath"):
                    try:
                        cand_full = Path(item["localFullPath"]).resolve()
                        if cand_full.is_relative_to(assets_dir.resolve()) and cand_full.exists() and cand_full.is_file():
                            full_path = cand_full
                    except Exception:
                        pass

                if not full_path:
                    local_rel = str(item.get("localAssetPath", "")).lstrip("/\\")
                    full_path = safe_resolve_asset_path(assets_dir, local_rel, allowed_extensions={".jpg", ".jpeg", ".png", ".webp"})

                if not full_path or not full_path.exists() or not full_path.is_file():
                    write_log(f"  [!] Artwork file missing on disk or blocked for '{title}' (RatingKey: {rating_key})")
                    continue

                res = await push_collection_artwork_to_plex(
                    plex_url=plex_url,
                    plex_token=plex_token,
                    rating_key=rating_key,
                    local_image_path=full_path,
                    cache=cache,
                    asset_type="collection",
                    library_name=lib_name,
                    item_title=title,
                    allowed_base_dir=assets_dir
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

    # 2. Sync Media Items (posters, backgrounds, seasons, titlecards)
    media_types_requested = set(asset_types) - {"collection"}
    if media_types_requested:
        write_log(f"--- Syncing Media Items: {', '.join(sorted(media_types_requested))} ---")
        export_db_path = base_dir / "database" / "media_export.db"
        media_items = []
        if export_db_path.exists():
            try:
                conn = sqlite3.connect(export_db_path, timeout=10)
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                query = "SELECT rating_key, root_foldername, library_name, title, season_rating_keys, library_type FROM plex_library_export"
                params = []
                if target_lib != "all":
                    query += " WHERE library_name = ?"
                    params.append(target_lib)
                elif excluded_libraries:
                    placeholders = ",".join("?" for _ in excluded_libraries)
                    query += f" WHERE library_name NOT IN ({placeholders})"
                    params.extend(excluded_libraries)

                cursor.execute(query, params)
                media_items = [dict(r) for r in cursor.fetchall()]
                conn.close()
            except Exception as e:
                write_log(f"Notice: media_export.db note: {e}")

        async with httpx.AsyncClient(timeout=30.0) as http_client:
            # Fallback to direct Plex sections query if media_export.db is empty
            if not media_items:
                write_log("Notice: media_export.db is unpopulated. Discovering items directly from Plex API...")
                try:
                    sec_resp = await http_client.get(
                        f"{plex_url.rstrip('/')}/library/sections",
                        headers={"X-Plex-Token": plex_token, "Accept": "application/xml"}
                    )
                    if sec_resp.status_code == 200:
                        sec_root = fromstring(sec_resp.content)
                        for d_sec in sec_root.findall(".//Directory"):
                            s_name = d_sec.get("title", "")
                            s_type = d_sec.get("type", "")
                            s_id = d_sec.get("key", "")
                            if s_type not in ["movie", "show"]:
                                continue
                            if target_lib != "all" and s_name != target_lib and s_id != target_lib:
                                continue
                            if target_lib == "all" and s_name in excluded_libraries:
                                continue

                            try:
                                items_resp = await http_client.get(
                                    f"{plex_url.rstrip('/')}/library/sections/{s_id}/all",
                                    headers={"X-Plex-Token": plex_token, "Accept": "application/xml"}
                                )
                                if items_resp.status_code == 200:
                                    items_root = fromstring(items_resp.content)
                                    tag = ".//Directory" if s_type == "show" else ".//Video"
                                    for it in items_root.findall(tag):
                                        rk = it.get("ratingKey")
                                        t = it.get("title", "")
                                        rf = None
                                        part = it.find(".//Part")
                                        if part is not None and part.get("file"):
                                            rf = Path(part.get("file")).parent.name
                                        loc = it.find(".//Location")
                                        if not rf and loc is not None and loc.get("path"):
                                            rf = Path(loc.get("path")).name
                                        if not rf:
                                            rf = t

                                        if rk:
                                            media_items.append({
                                                "rating_key": rk,
                                                "title": t,
                                                "library_name": s_name,
                                                "library_type": s_type,
                                                "root_foldername": rf,
                                                "season_rating_keys": None
                                            })
                            except Exception as sec_err:
                                write_log(f"Error reading section {s_name}: {sec_err}")
                except Exception as e:
                    write_log(f"Error querying Plex sections: {e}")

            write_log(f"Found {len(media_items)} media item(s) to evaluate across included libraries.")

            # Cache library folder listings to avoid repeated filesystem walks
            folder_lookups: Dict[str, Dict[str, Path]] = {}

            for row in media_items:
                r_key = "".join(c for c in str(row.get("rating_key") or "") if c.isdigit())
                r_folder = str(row.get("root_foldername") or "").strip().replace("\\", "/")
                lib_name = str(row.get("library_name") or "").strip().replace("\\", "/")

                # Strip Windows drive letters and leading slashes
                r_folder = re.sub(r'^[a-zA-Z]:', '', r_folder).lstrip("/")
                lib_name = re.sub(r'^[a-zA-Z]:', '', lib_name).lstrip("/")

                title = row.get("title") or r_folder
                lib_type = row.get("library_type") or ("show" if row.get("season_rating_keys") else "movie")

                if not r_key or ".." in r_folder or ".." in lib_name or "\x00" in r_folder or "\x00" in lib_name:
                    continue

                try:
                    lib_asset_dir = (assets_dir / lib_name).resolve()
                    if not lib_asset_dir.is_relative_to(assets_dir.resolve()) or not lib_asset_dir.exists():
                        continue
                except Exception:
                    continue

                if lib_name not in folder_lookups:
                    folder_lookups[lib_name] = {}
                    try:
                        for entry in lib_asset_dir.iterdir():
                            if entry.is_dir():
                                folder_lookups[lib_name][entry.name.lower()] = entry
                                norm = normalize_collection_name(entry.name)
                                if norm:
                                    folder_lookups[lib_name][norm] = entry
                                cond = re.sub(r'[\W_]+', '', entry.name.lower())
                                if cond:
                                    folder_lookups[lib_name][cond] = entry
                    except Exception:
                        pass

                lookup = folder_lookups[lib_name]
                item_dir = None
                # 1. Exact r_folder
                if r_folder and (lib_asset_dir / r_folder).exists():
                    item_dir = (lib_asset_dir / r_folder).resolve()
                # 2. Lookup by folder name lowercase/condensed
                if not item_dir and r_folder:
                    cand = lookup.get(r_folder.lower()) or lookup.get(re.sub(r'[\W_]+', '', r_folder.lower()))
                    if cand and cand.exists():
                        item_dir = cand
                # 3. Lookup by title
                if not item_dir and title:
                    cand = lookup.get(title.lower()) or lookup.get(normalize_collection_name(title)) or lookup.get(re.sub(r'[\W_]+', '', title.lower()))
                    if cand and cand.exists():
                        item_dir = cand

                if item_dir:
                    try:
                        item_dir = item_dir.resolve()
                        if not item_dir.is_relative_to(lib_asset_dir) or not item_dir.is_relative_to(assets_dir.resolve()):
                            item_dir = None
                    except Exception:
                        item_dir = None

                if not item_dir or not item_dir.exists() or not item_dir.is_dir():
                    continue

                # 1. Check Movie/Show Poster
                if "poster" in media_types_requested:
                    for ext in [".jpg", ".png", ".webp", ".jpeg"]:
                        for stem in ["poster", "cover", "folder", f"{item_dir.name}_poster"]:
                            try:
                                p_file = (item_dir / f"{stem}{ext}").resolve()
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
                                        cache=cache, asset_type="poster", library_name=lib_name, item_title=title,
                                        allowed_base_dir=assets_dir
                                    )
                                    if res.get("success"):
                                        total_pushed += 1
                                        write_log(f"  [+] Pushed poster: '{title}' ({lib_name})")
                                    else:
                                        total_failed += 1
                                        write_log(f"  [-] Failed poster for '{title}': {res.get('error')}")
                                else:
                                    total_skipped += 1
                                break
                        else:
                            continue
                        break

                # 2. Check Background / Art
                if "background" in media_types_requested:
                    for ext in [".jpg", ".png", ".webp", ".jpeg"]:
                        for stem in ["background", "fanart", "backdrop", "art", f"{item_dir.name}_background"]:
                            try:
                                b_file = (item_dir / f"{stem}{ext}").resolve()
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
                                        is_backdrop=True,
                                        allowed_base_dir=assets_dir
                                    )
                                    if res.get("success"):
                                        total_pushed += 1
                                        write_log(f"  [+] Pushed background: '{title}' ({lib_name})")
                                    else:
                                        total_failed += 1
                                        write_log(f"  [-] Failed background for '{title}': {res.get('error')}")
                                else:
                                    total_skipped += 1
                                break
                        else:
                            continue
                        break

                # 3. Check Seasons & Episode Titlecards (for TV shows)
                if ("season" in media_types_requested or "titlecard" in media_types_requested) and lib_type == "show":
                    seasons = await fetch_plex_seasons(plex_url, plex_token, r_key, http_client)
                    for s in seasons:
                        s_rk = s["ratingKey"]
                        s_num = s["seasonNumber"]

                        # Season Poster
                        if "season" in media_types_requested:
                            s_file = find_season_poster(item_dir, s_num, item_dir.name)
                            if s_file:
                                try:
                                    if not s_file.resolve().is_relative_to(assets_dir.resolve()):
                                        s_file = None
                                except Exception:
                                    s_file = None

                            if s_file:
                                total_checked += 1
                                if not cache.is_asset_in_sync(s_file):
                                    res = await push_collection_artwork_to_plex(
                                        plex_url=plex_url, plex_token=plex_token,
                                        rating_key=s_rk, local_image_path=s_file,
                                        cache=cache, asset_type="season", library_name=lib_name,
                                        item_title=f"{title} - Season {s_num}",
                                        allowed_base_dir=assets_dir
                                    )
                                    if res.get("success"):
                                        total_pushed += 1
                                        write_log(f"  [+] Pushed season poster: '{title}' Season {s_num}")
                                    else:
                                        total_failed += 1
                                        write_log(f"  [-] Failed season poster for '{title}' Season {s_num}: {res.get('error')}")
                                else:
                                    total_skipped += 1

                        # Episode Titlecards
                        if "titlecard" in media_types_requested:
                            episodes = await fetch_plex_episodes(plex_url, plex_token, s_rk, http_client)
                            for ep in episodes:
                                ep_rk = ep["ratingKey"]
                                ep_num = ep["episodeNumber"]
                                ep_file = find_episode_titlecard(item_dir, s_num, ep_num, item_dir.name)
                                if ep_file:
                                    try:
                                        if not ep_file.resolve().is_relative_to(assets_dir.resolve()):
                                            ep_file = None
                                    except Exception:
                                        ep_file = None

                                if ep_file:
                                    total_checked += 1
                                    if not cache.is_asset_in_sync(ep_file):
                                        res = await push_collection_artwork_to_plex(
                                            plex_url=plex_url, plex_token=plex_token,
                                            rating_key=ep_rk, local_image_path=ep_file,
                                            cache=cache, asset_type="titlecard", library_name=lib_name,
                                            item_title=f"{title} - S{s_num:02d}E{ep_num:02d}",
                                            allowed_base_dir=assets_dir
                                        )
                                        if res.get("success"):
                                            total_pushed += 1
                                            write_log(f"  [+] Pushed episode titlecard: '{title}' S{s_num:02d}E{ep_num:02d}")
                                        else:
                                            total_failed += 1
                                            write_log(f"  [-] Failed episode titlecard for '{title}' S{s_num:02d}E{ep_num:02d}: {res.get('error')}")
                                    else:
                                        total_skipped += 1

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
