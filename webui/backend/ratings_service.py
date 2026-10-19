"""
Multi-Source Rating Service & Cache Manager for Posterizarr Dynamic Overlays.
Fetches, caches, and invalidates movie/show ratings from:
1. Plex Internal Metadata (Native XML - IMDb, Rotten Tomatoes critic & audience, TMDb)
2. TMDb API (Native Posterizarr integration)
3. MDBList API (Optional - Trakt, Letterboxd, IMDb, RT, Metacritic)
4. OMDb API (Optional - IMDb, RT, Metacritic)

Supports automatic cache invalidation with tiered TTL and seamless integration
with Dynamic Overlays composite recipes.
"""

import os
import re
import json
import shutil
import sqlite3
import logging
import asyncio
import threading
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple
import hashlib
from xml.etree.ElementTree import fromstring
from PIL import Image, ImageDraw, ImageFont

import httpx

logger = logging.getLogger("ratings_service")
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def get_database_dir() -> Path:
    """Resolve database directory (/config/database in Docker, PROJECT_ROOT/database in local)."""
    app_data = os.environ.get("APP_DATA")
    if app_data and Path(app_data).exists():
        return Path(app_data) / "database"
    if os.path.exists("/config/database"):
        return Path("/config/database")
    is_docker = (
        os.path.exists("/.dockerenv")
        or os.environ.get("DOCKER_ENV", "").lower() == "true"
        or os.environ.get("POSTERIZARR_NON_ROOT", "").lower() == "true"
    )
    if is_docker:
        return Path("/config/database")
    return PROJECT_ROOT / "database"


DATABASE_DIR = get_database_dir()
DB_PATH = DATABASE_DIR / "overlay_cache.db"
# Auto-migrate legacy database from webui/backend/database/overlay_cache.db if canonical DB does not exist
_old_backend_db = Path(__file__).resolve().parent / "database" / "overlay_cache.db"
if not DB_PATH.exists() and _old_backend_db.exists():
    try:
        DATABASE_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(_old_backend_db, DB_PATH)
        logger.info(f"[RatingsService] Auto-migrated database from {_old_backend_db} to {DB_PATH}")
    except Exception as e:
        logger.warning(f"[RatingsService] Could not migrate database: {e}")


# Tiered Cache TTL durations in days
TTL_NEW_MEDIA_DAYS = 3      # Released in the last 180 days
TTL_RECENT_MEDIA_DAYS = 14  # Released 180 days - 2 years ago
TTL_CLASSIC_MEDIA_DAYS = 30 # Released > 2 years ago


class RatingsCacheManager:
    """Thread-safe SQLite cache for media ratings with tiered TTL."""

    def __init__(self, db_path: Path = DB_PATH):
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
                        CREATE TABLE IF NOT EXISTS media_ratings_cache (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            server_type TEXT NOT NULL,
                            item_id TEXT NOT NULL,
                            media_type TEXT DEFAULT 'movie',
                            title TEXT,
                            year INTEGER,
                            imdb_id TEXT,
                            tmdb_id INTEGER,
                            
                            -- Individual score values
                            imdb_rating REAL,
                            tmdb_rating REAL,
                            rt_critic_rating INTEGER,
                            rt_audience_rating INTEGER,
                            trakt_rating REAL,
                            metacritic_rating INTEGER,
                            letterboxd_rating REAL,
                            
                            -- Metadata & Expiration
                            source TEXT DEFAULT 'plex',
                            cached_at TEXT NOT NULL,
                            expires_at TEXT NOT NULL,
                            
                            UNIQUE(server_type, item_id)
                        );
                    """)
                    conn.execute("""
                        CREATE INDEX IF NOT EXISTS idx_mrc_lookup 
                        ON media_ratings_cache(server_type, item_id);
                    """)
                    conn.execute("""
                        CREATE INDEX IF NOT EXISTS idx_mrc_expires 
                        ON media_ratings_cache(expires_at);
                    """)
                    conn.execute("""
                        CREATE INDEX IF NOT EXISTS idx_mrc_ids 
                        ON media_ratings_cache(imdb_id, tmdb_id);
                    """)
                    for col_sql in [
                        "ALTER TABLE media_ratings_cache ADD COLUMN show_status TEXT;",
                        "ALTER TABLE media_ratings_cache ADD COLUMN network TEXT;",
                        "ALTER TABLE media_ratings_cache ADD COLUMN content_rating TEXT;"
                    ]:
                        try:
                            conn.execute(col_sql)
                        except Exception:
                            pass
                conn.close()
            except Exception as e:
                logger.error(f"[RatingsCache] Error initializing database: {e}")


    def get_cached_ratings(self, server_type: str, item_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve unexpired cached ratings for a specific item."""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT * FROM media_ratings_cache 
                    WHERE server_type = ? AND item_id = ?
                    LIMIT 1
                    """,
                    (server_type.lower(), str(item_id))
                )
                row = cursor.fetchone()
                conn.close()
                if not row:
                    return None

                data = dict(row)
                expires_at_str = data.get("expires_at")
                if expires_at_str:
                    try:
                        exp_dt = datetime.fromisoformat(expires_at_str)
                        if datetime.utcnow() > exp_dt:
                            # Expired
                            return None
                    except Exception:
                        pass
                # Normalize and add alias keys for direct overlay mapping
                if data.get("imdb_rating") is not None:
                    data["imdb"] = data["imdb_rating"]
                if data.get("tmdb_rating") is not None:
                    data["tmdb"] = data["tmdb_rating"]
                if data.get("rt_critic_rating") is not None:
                    data["rt_critic"] = data["rt_critic_rating"]
                    data["tomatoes"] = data["rt_critic_rating"]
                if data.get("rt_audience_rating") is not None:
                    data["rt_audience"] = data["rt_audience_rating"]
                    data["tomatoesaudience"] = data["rt_audience_rating"]
                if data.get("trakt_rating") is not None:
                    data["trakt"] = data["trakt_rating"]
                if data.get("metacritic_rating") is not None:
                    data["metacritic"] = data["metacritic_rating"]
                if data.get("letterboxd_rating") is not None:
                    data["letterboxd"] = data["letterboxd_rating"]

                return data
            except Exception as e:
                logger.error(f"[RatingsCache] Error reading cache ({server_type}, {item_id}): {e}")
                return None

    get_ratings = get_cached_ratings

    def save_ratings(
        self,
        server_type: str,
        item_id: str,
        media_type: str,
        title: str,
        year: Optional[int],
        imdb_id: Optional[str],
        tmdb_id: Optional[int],
        ratings: Dict[str, Any],
        source: str = "plex",
        ttl_days: Optional[int] = None
    ):
        """Save or update ratings in the cache with computed TTL."""
        now = datetime.utcnow()
        if ttl_days is not None:
            effective_ttl = ttl_days
        else:
            # Determine TTL by release year
            if year:
                current_year = now.year
                age_years = current_year - year
                if age_years < 1:
                    effective_ttl = TTL_NEW_MEDIA_DAYS
                elif age_years <= 2:
                    effective_ttl = TTL_RECENT_MEDIA_DAYS
                else:
                    effective_ttl = TTL_CLASSIC_MEDIA_DAYS
            else:
                effective_ttl = TTL_RECENT_MEDIA_DAYS

        expires_at = now + timedelta(days=effective_ttl)

        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    conn.execute(
                        """
                        INSERT INTO media_ratings_cache (
                            server_type, item_id, media_type, title, year,
                            imdb_id, tmdb_id, imdb_rating, tmdb_rating,
                            rt_critic_rating, rt_audience_rating, trakt_rating,
                            metacritic_rating, letterboxd_rating, source,
                            cached_at, expires_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(server_type, item_id) DO UPDATE SET
                            title = excluded.title,
                            year = excluded.year,
                            imdb_id = COALESCE(excluded.imdb_id, media_ratings_cache.imdb_id),
                            tmdb_id = COALESCE(excluded.tmdb_id, media_ratings_cache.tmdb_id),
                            imdb_rating = COALESCE(excluded.imdb_rating, media_ratings_cache.imdb_rating),
                            tmdb_rating = COALESCE(excluded.tmdb_rating, media_ratings_cache.tmdb_rating),
                            rt_critic_rating = COALESCE(excluded.rt_critic_rating, media_ratings_cache.rt_critic_rating),
                            rt_audience_rating = COALESCE(excluded.rt_audience_rating, media_ratings_cache.rt_audience_rating),
                            trakt_rating = COALESCE(excluded.trakt_rating, media_ratings_cache.trakt_rating),
                            metacritic_rating = COALESCE(excluded.metacritic_rating, media_ratings_cache.metacritic_rating),
                            letterboxd_rating = COALESCE(excluded.letterboxd_rating, media_ratings_cache.letterboxd_rating),
                            source = excluded.source,
                            cached_at = excluded.cached_at,
                            expires_at = excluded.expires_at;
                        """,
                        (
                            server_type.lower(),
                            str(item_id),
                            media_type or "movie",
                            title or "",
                            year,
                            imdb_id,
                            tmdb_id,
                            ratings.get("imdb"),
                            ratings.get("tmdb"),
                            ratings.get("rt_critic"),
                            ratings.get("rt_audience"),
                            ratings.get("trakt"),
                            ratings.get("metacritic"),
                            ratings.get("letterboxd"),
                            source,
                            now.isoformat(),
                            expires_at.isoformat()
                        )
                    )
                conn.close()
            except Exception as e:
                logger.error(f"[RatingsCache] Error saving ratings for {title}: {e}")

    def clear_all(self):
        """Purge all cached ratings."""
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    conn.execute("DELETE FROM media_ratings_cache;")
                conn.close()
            except Exception as e:
                logger.error(f"[RatingsCache] Error clearing cache: {e}")

    def get_stats(self) -> Dict[str, Any]:
        """Get summary count of cached ratings."""
        with self.lock:
            try:
                conn = self._get_connection()
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM media_ratings_cache;")
                total = cur.fetchone()[0]
                now_str = datetime.utcnow().isoformat()
                cur.execute("SELECT COUNT(*) FROM media_ratings_cache WHERE expires_at > ?;", (now_str,))
                valid = cur.fetchone()[0]
                conn.close()
                return {"total": total, "valid": valid, "expired": total - valid}
            except Exception:
                return {"total": 0, "valid": 0, "expired": 0}

    def get_show_status(self, server_type: str, item_id: str, tmdb_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieve unexpired cached TV show status, networks, and content rating."""
        with self.lock:
            try:
                conn = self._get_connection()
                cur = conn.cursor()
                row = None
                if item_id:
                    cur.execute(
                        "SELECT show_status, network, content_rating, expires_at FROM media_ratings_cache WHERE server_type = ? AND item_id = ? LIMIT 1",
                        (server_type.lower(), str(item_id))
                    )
                    row = cur.fetchone()
                if not row and tmdb_id:
                    cur.execute(
                        "SELECT show_status, network, content_rating, expires_at FROM media_ratings_cache WHERE tmdb_id = ? AND show_status IS NOT NULL LIMIT 1",
                        (str(tmdb_id),)
                    )
                    row = cur.fetchone()
                conn.close()

                if not row or not row["show_status"]:
                    return None

                exp_str = row["expires_at"]
                if exp_str:
                    try:
                        if datetime.utcnow() > datetime.fromisoformat(exp_str):
                            return None  # Expired
                    except Exception:
                        pass

                return {
                    "status": row["show_status"],
                    "network": row["network"],
                    "networks": [row["network"]] if row["network"] else [],
                    "content_rating": row["content_rating"]
                }
            except Exception as e:
                logger.debug(f"[RatingsCache] Error reading show status: {e}")
                return None

    def save_show_status(
        self,
        server_type: str,
        item_id: str,
        title: str,
        year: Optional[int],
        tmdb_id: Optional[Any],
        status: str,
        network: Optional[str] = None,
        content_rating: Optional[str] = None,
        source: str = "tmdb",
        ttl_days: Optional[int] = None
    ):
        """Persistently cache TV show status with tiered TTL."""
        norm_st = str(status or "").strip().lower()
        now = datetime.utcnow()
        if ttl_days is not None:
            effective_ttl = ttl_days
        else:
            # Active/returning/airing shows can change anytime -> 7-day TTL (or 3 days if current year)
            if norm_st in ("returning", "airing", "returning series", "continuing"):
                if year and year >= now.year:
                    effective_ttl = TTL_NEW_MEDIA_DAYS  # 3 days
                else:
                    effective_ttl = 7  # 7 days
            elif norm_st in ("ended", "canceled", "cancelled"):
                effective_ttl = TTL_CLASSIC_MEDIA_DAYS  # 30 days
            else:
                effective_ttl = 14

        expires_at = now + timedelta(days=effective_ttl)

        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    conn.execute(
                        """
                        INSERT INTO media_ratings_cache (
                            server_type, item_id, media_type, title, year, tmdb_id,
                            show_status, network, content_rating, source, cached_at, expires_at
                        ) VALUES (?, ?, 'show', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(server_type, item_id) DO UPDATE SET
                            title = COALESCE(excluded.title, media_ratings_cache.title),
                            year = COALESCE(excluded.year, media_ratings_cache.year),
                            tmdb_id = COALESCE(excluded.tmdb_id, media_ratings_cache.tmdb_id),
                            show_status = excluded.show_status,
                            network = COALESCE(excluded.network, media_ratings_cache.network),
                            content_rating = COALESCE(excluded.content_rating, media_ratings_cache.content_rating),
                            source = excluded.source,
                            cached_at = excluded.cached_at,
                            expires_at = excluded.expires_at;
                        """,
                        (
                            server_type.lower(),
                            str(item_id),
                            title or "",
                            year,
                            str(tmdb_id) if tmdb_id else None,
                            norm_st,
                            network,
                            content_rating,
                            source,
                            now.isoformat(),
                            expires_at.isoformat()
                        )
                    )
                conn.close()
            except Exception as e:
                logger.error(f"[RatingsCache] Error saving show status for {title}: {e}")

    def get_entries(
        self,
        page: int = 1,
        limit: int = 50,
        search: Optional[str] = None,
        server_type: Optional[str] = None,
        media_type: Optional[str] = None,
        status: Optional[str] = None,
        show_status: Optional[str] = None,
        sort_by: str = "cached_at",
        sort_desc: bool = True
    ) -> Dict[str, Any]:
        """Paginated retrieval of cached media ratings with search and filter capabilities."""
        page = max(1, page)
        limit = max(1, min(limit, 200))
        offset = (page - 1) * limit
        now_iso = datetime.utcnow().isoformat()

        allowed_sort_cols = {
            "cached_at": "cached_at",
            "expires_at": "expires_at",
            "title": "title",
            "year": "year",
            "imdb_rating": "imdb_rating",
            "tmdb_rating": "tmdb_rating",
            "rt_critic_rating": "rt_critic_rating",
            "rt_audience_rating": "rt_audience_rating",
            "server_type": "server_type",
            "show_status": "show_status",
            "id": "id"
        }
        col_sort = allowed_sort_cols.get(sort_by, "cached_at")
        dir_sort = "DESC" if sort_desc else "ASC"

        where_clauses = []
        params = []

        if search and search.strip():
            s = f"%{search.strip()}%"
            where_clauses.append("(title LIKE ? OR imdb_id LIKE ? OR item_id LIKE ? OR show_status LIKE ?)")
            params.extend([s, s, s, s])

        if server_type and server_type.strip().lower() not in ("all", ""):
            where_clauses.append("server_type = ?")
            params.append(server_type.strip().lower())

        if media_type and media_type.strip().lower() not in ("all", ""):
            where_clauses.append("media_type = ?")
            params.append(media_type.strip().lower())

        if show_status and show_status.strip().lower() not in ("all", ""):
            where_clauses.append("show_status = ?")
            params.append(show_status.strip().lower())

        if status:
            stat = status.strip().lower()
            if stat == "valid":
                where_clauses.append("expires_at > ?")
                params.append(now_iso)
            elif stat == "expired":
                where_clauses.append("expires_at <= ?")
                params.append(now_iso)

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""


        with self.lock:
            try:
                conn = self._get_connection()
                cur = conn.cursor()

                # Get total matching count
                cur.execute(f"SELECT COUNT(*) FROM media_ratings_cache {where_sql}", tuple(params))
                total = cur.fetchone()[0]

                # Get paginated rows
                query_sql = f"""
                    SELECT * FROM media_ratings_cache 
                    {where_sql}
                    ORDER BY {col_sort} {dir_sort}
                    LIMIT ? OFFSET ?
                """
                cur.execute(query_sql, tuple(params + [limit, offset]))
                rows = cur.fetchall()

                entries = []
                for r in rows:
                    item = dict(r)
                    exp_str = item.get("expires_at")
                    is_expired = False
                    if exp_str:
                        try:
                            is_expired = datetime.utcnow() > datetime.fromisoformat(exp_str)
                        except Exception:
                            pass
                    item["is_expired"] = is_expired
                    entries.append(item)

                # Summary stats for badges
                cur.execute("SELECT COUNT(*) FROM media_ratings_cache")
                all_total = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM media_ratings_cache WHERE expires_at > ?", (now_iso,))
                valid_count = cur.fetchone()[0]

                conn.close()

                total_pages = (total + limit - 1) // limit if total > 0 else 1

                return {
                    "entries": entries,
                    "total": total,
                    "page": page,
                    "limit": limit,
                    "total_pages": total_pages,
                    "stats": {
                        "total": all_total,
                        "valid": valid_count,
                        "expired": all_total - valid_count
                    }
                }
            except Exception as e:
                logger.error(f"[RatingsCache] Error querying entries: {e}")
                return {"entries": [], "total": 0, "page": page, "limit": limit, "total_pages": 1, "stats": {}}

    def delete_entry(self, entry_id: int) -> bool:
        """Delete a single cached rating record by ID."""
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    cur = conn.execute("DELETE FROM media_ratings_cache WHERE id = ?", (int(entry_id),))
                    deleted = cur.rowcount > 0
                conn.close()
                return deleted
            except Exception as e:
                logger.error(f"[RatingsCache] Error deleting entry {entry_id}: {e}")
                return False

    def expire_entry(self, entry_id: int) -> bool:
        """Mark a cached rating record as expired immediately so next sync re-fetches it."""
        past_iso = (datetime.utcnow() - timedelta(days=1)).isoformat()
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    cur = conn.execute("UPDATE media_ratings_cache SET expires_at = ? WHERE id = ?", (past_iso, int(entry_id)))
                    updated = cur.rowcount > 0
                conn.close()
                return updated
            except Exception as e:
                logger.error(f"[RatingsCache] Error expiring entry {entry_id}: {e}")
                return False


ratings_cache = RatingsCacheManager()


# ==============================================================================
# RATING EXTRACTORS & API FETCHERS
# ==============================================================================

def parse_plex_xml_ratings(xml_content: bytes) -> Dict[str, Any]:
    """
    Extract IMDb, Rotten Tomatoes (critic and audience), and TMDb ratings
    from native Plex Metadata XML.
    """
    ratings = {}
    if not xml_content:
        return ratings

    try:
        root = fromstring(xml_content)
        # 1. Check <Rating> tags under <Video> or <Directory>
        for r_elem in root.findall(".//Rating"):
            img = str(r_elem.get("image") or "").lower()
            val_str = r_elem.get("value")
            rtype = str(r_elem.get("type") or "").lower()

            if not val_str:
                continue

            clean_val = val_str.replace("%", "").strip()
            try:
                val_float = float(clean_val)
            except ValueError:
                continue

            if "imdb" in img:
                ratings["imdb"] = round(val_float, 1)
            elif "rottentomatoes" in img or "tomato" in img:
                # Rotten Tomatoes values are usually out of 10 or 100 in Plex XML
                # E.g., 9.3 or 93 -> store as integer percentage (93)
                if val_float <= 10.0:
                    pct = int(round(val_float * 10))
                else:
                    pct = int(round(val_float))
                is_critic = (
                    rtype == "critic"
                    or "critic" in img
                    or "ripe" in img
                    or "certified" in img
                    or ".rotten" in img
                    or "/rotten" in img
                    or img.endswith("rotten")
                )
                is_audience = (
                    rtype == "audience"
                    or "audience" in img
                    or "upright" in img
                    or "spilled" in img
                )
                if is_critic and not is_audience:
                    ratings["rt_critic"] = pct
                elif is_audience:
                    ratings["rt_audience"] = pct
                elif "rt_critic" not in ratings:
                    ratings["rt_critic"] = pct
                else:
                    ratings["rt_audience"] = pct
            elif "themoviedb" in img or "tmdb" in img:
                ratings["tmdb"] = round(val_float, 1)

        # 2. Check main rating / audienceRating attributes as fallbacks
        video = root.find(".//Video") or root.find(".//Directory")
        if video is not None:
            # Fallback audience rating
            if "rt_audience" not in ratings and video.get("audienceRating"):
                try:
                    ar = float(video.get("audienceRating"))
                    ratings["rt_audience"] = int(round(ar * 10)) if ar <= 10.0 else int(round(ar))
                except Exception:
                    pass
            # Fallback primary rating
            if "imdb" not in ratings and "tmdb" not in ratings and video.get("rating"):
                try:
                    r = float(video.get("rating"))
                    ratings["primary"] = round(r, 1)
                except Exception:
                    pass

    except Exception as e:
        logger.debug(f"[Ratings] Error parsing Plex XML ratings: {e}")

    return ratings


async def fetch_tmdb_rating(
    tmdb_id: int,
    api_key: str,
    client: httpx.AsyncClient,
    media_type: str = "movie"
) -> Optional[float]:
    """Fetch vote_average directly from TMDb API with support for v3 API keys and v4 JWT tokens."""
    if not tmdb_id or not api_key:
        return None

    endpoint = "tv" if media_type == "show" else "movie"
    url = f"https://api.themoviedb.org/3/{endpoint}/{tmdb_id}"
    api_key_clean = str(api_key).strip()
    headers = {}
    params = {}
    if api_key_clean.startswith("ey") or len(api_key_clean) > 40:
        headers["Authorization"] = f"Bearer {api_key_clean}"
    else:
        params["api_key"] = api_key_clean

    try:
        resp = await client.get(url, headers=headers, params=params, timeout=6.0)
        if resp.status_code == 200:
            data = resp.json()
            avg = data.get("vote_average")
            if avg is not None:
                return round(float(avg), 1)
    except Exception as e:
        logger.debug(f"[Ratings] TMDb fetch error for {tmdb_id}: {e}")
    return None



async def fetch_mdblist_ratings(
    imdb_id: Optional[str],
    tmdb_id: Optional[int],
    api_key: str,
    client: httpx.AsyncClient,
    media_type: str = "movie"
) -> Dict[str, Any]:
    """
    Fetch comprehensive ratings from MDBList API (IMDb, RT, TMDb, Trakt, Letterboxd, Metacritic).
    Optional integration enabled only when user provides an MDBList API Key.
    """
    if not api_key or (not imdb_id and not tmdb_id):
        return {}

    m_type = "show" if media_type in ["show", "tv"] else "movie"
    params = {"apikey": api_key.strip(), "m": m_type}
    if imdb_id:
        params["i"] = imdb_id.strip()
    if tmdb_id:
        params["tm"] = str(tmdb_id)

    url = "https://mdblist.com/api/"
    ratings = {}
    try:
        resp = await client.get(url, params=params, timeout=8.0)
        if resp.status_code == 200:
            data = resp.json()
            # MDBList provides a list of ratings
            # ratings: [{ 'source': 'imdb', 'value': 8.4, 'score': 84 }, ...]
            for r_item in data.get("ratings", []):
                src = str(r_item.get("source") or "").lower()
                val = r_item.get("value")
                score = r_item.get("score")

                if src == "imdb" and val is not None:
                    ratings["imdb"] = round(float(val), 1)
                elif src == "tomatoes" and score is not None:
                    ratings["rt_critic"] = int(score)
                elif src in ["tomatoesaudience", "popcorn"] and score is not None:
                    ratings["rt_audience"] = int(score)
                elif src == "tmdb" and val is not None:
                    ratings["tmdb"] = round(float(val), 1)
                elif src == "trakt" and score is not None:
                    ratings["trakt"] = round(float(score) / 10.0, 1)
                elif src == "metacritic" and score is not None:
                    ratings["metacritic"] = int(score)
                elif src == "letterboxd" and val is not None:
                    ratings["letterboxd"] = round(float(val), 1)
    except Exception as e:
        logger.debug(f"[Ratings] MDBList fetch error: {e}")

    return ratings


async def fetch_omdb_ratings(
    imdb_id: str,
    api_key: str,
    client: httpx.AsyncClient
) -> Dict[str, Any]:
    """
    Fetch IMDb, Rotten Tomatoes, and Metascore ratings from OMDb API.
    Optional integration enabled only when user provides an OMDb API Key.
    """
    if not api_key or not imdb_id:
        return {}

    url = f"https://www.omdbapi.com/?apikey={api_key.strip()}&i={imdb_id.strip()}"
    ratings = {}
    try:
        resp = await client.get(url, timeout=6.0)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("Response") == "True":
                # IMDb
                try:
                    ratings["imdb"] = round(float(data.get("imdbRating")), 1)
                except Exception:
                    pass

                # Metascore
                try:
                    ratings["metacritic"] = int(data.get("Metascore"))
                except Exception:
                    pass

                # Rotten Tomatoes from Ratings array
                for r_item in data.get("Ratings", []):
                    if r_item.get("Source") == "Rotten Tomatoes":
                        val_str = str(r_item.get("Value") or "").replace("%", "").strip()
                        try:
                            ratings["rt_critic"] = int(val_str)
                        except Exception:
                            pass
    except Exception as e:
        logger.debug(f"[Ratings] OMDb fetch error: {e}")

    return ratings


# ==============================================================================
# UNIFIED RESOLUTION FUNCTION
# ==============================================================================

async def resolve_media_ratings(
    server_type: str,
    item_id: str,
    title: str,
    year: Optional[int],
    media_type: str,
    imdb_id: Optional[str],
    tmdb_id: Optional[int],
    plex_xml_bytes: Optional[bytes] = None,
    tmdb_api_key: Optional[str] = None,
    mdblist_api_key: Optional[str] = None,
    omdb_api_key: Optional[str] = None,
    enabled_sources: Optional[List[str]] = None,
    client: Optional[httpx.AsyncClient] = None,
    force_refresh: bool = False,
    server_community_rating: Optional[float] = None,
    server_critic_rating: Optional[float] = None
) -> Dict[str, Any]:
    """
    Unified ratings resolver with multi-source fallback and SQLite caching.
    Returns dictionary with available scores (imdb, tmdb, rt_critic, rt_audience, trakt, metacritic, letterboxd).
    """
    # 1. Cache lookup
    if not force_refresh:
        cached = ratings_cache.get_cached_ratings(server_type, item_id)
        if cached:
            return {
                "imdb": cached.get("imdb_rating"),
                "tmdb": cached.get("tmdb_rating"),
                "rt_critic": cached.get("rt_critic_rating"),
                "rt_audience": cached.get("rt_audience_rating"),
                "trakt": cached.get("trakt_rating"),
                "metacritic": cached.get("metacritic_rating"),
                "letterboxd": cached.get("letterboxd_rating"),
                "_source": cached.get("source"),
                "_cached": True
            }

    # Sources requested by user (default to imdb, tmdb, rt_critic, rt_audience)
    if not enabled_sources:
        enabled_sources = ["imdb", "tmdb", "tomatoes", "tomatoesaudience"]

    resolved: Dict[str, Any] = {}
    primary_source = "plex"

    # 2. Extract native ratings from Plex XML if available
    if plex_xml_bytes:
        plex_ratings = parse_plex_xml_ratings(plex_xml_bytes)
        for k, v in plex_ratings.items():
            if v is not None:
                resolved[k] = v

    # 3. If TMDb rating is requested and missing, use TMDb API
    local_client = client or httpx.AsyncClient(timeout=10.0)
    should_close_client = client is None

    try:
        if "tmdb" in enabled_sources and resolved.get("tmdb") is None and tmdb_id and tmdb_api_key:
            tmdb_score = await fetch_tmdb_rating(tmdb_id, tmdb_api_key, local_client, media_type)
            if tmdb_score is not None:
                resolved["tmdb"] = tmdb_score
                primary_source = "tmdb"

        # 4. If MDBList API key is provided and needed ratings are still missing (or Trakt/Letterboxd requested)
        needs_external = any(
            (s in ["trakt", "letterboxd", "metacritic"] or resolved.get(s) is None)
            for s in enabled_sources
        )
        if mdblist_api_key and needs_external and (imdb_id or tmdb_id):
            mdb_res = await fetch_mdblist_ratings(imdb_id, tmdb_id, mdblist_api_key, local_client, media_type)
            for k, v in mdb_res.items():
                if v is not None and resolved.get(k) is None:
                    resolved[k] = v
            if mdb_res:
                primary_source = "mdblist"

        # 5. If OMDb API key is provided and IMDb or RT are still missing
        if omdb_api_key and (resolved.get("imdb") is None or resolved.get("rt_critic") is None) and imdb_id:
            omdb_res = await fetch_omdb_ratings(imdb_id, omdb_api_key, local_client)
            for k, v in omdb_res.items():
                if v is not None and resolved.get(k) is None:
                    resolved[k] = v
            if omdb_res:
                primary_source = "omdb"

        # 6. Fallback to server's native community/critic ratings (Emby/Jellyfin/Plex) if available and still missing
        if server_community_rating is not None:
            try:
                c_val = float(server_community_rating)
                if c_val > 0:
                    if resolved.get("tmdb") is None:
                        resolved["tmdb"] = round(c_val, 1)
                        if primary_source == "plex":
                            primary_source = server_type
                    if resolved.get("imdb") is None and not tmdb_id and imdb_id:
                        resolved["imdb"] = round(c_val, 1)
                        if primary_source == "plex":
                            primary_source = server_type
            except Exception:
                pass

        if server_critic_rating is not None:
            try:
                cr_val = float(server_critic_rating)
                if cr_val > 0 and resolved.get("rt_critic") is None:
                    resolved["rt_critic"] = int(round(cr_val))
                    if primary_source == "plex":
                        primary_source = server_type
            except Exception:
                pass

    finally:
        if should_close_client:
            await local_client.aclose()

    # 6. Save into SQLite cache
    ratings_cache.save_ratings(
        server_type=server_type,
        item_id=str(item_id),
        media_type=media_type,
        title=title,
        year=year,
        imdb_id=imdb_id,
        tmdb_id=tmdb_id,
        ratings=resolved,
        source=primary_source
    )

    resolved["_source"] = primary_source
    resolved["_cached"] = False
    return resolved


# ==============================================================================
# MULTI-RATING BADGE CLUSTER COMPOSITOR
# ==============================================================================

def render_multi_rating_cluster(
    ratings: Dict[str, Any],
    sources_to_show: List[str],
    slots: Optional[Dict[str, str]] = None,
    alignment: str = "horizontal",
    contrast_box: bool = True,
    canvas_type: str = "landscape",
    assets_dir: Optional[Path] = None,
    fonts_dir: Optional[Path] = None
) -> Optional[Image.Image]:
    """
    Renders an in-memory RGBA image containing multiple ratings badges (IMDb, RT, TMDb, Trakt, Metacritic, Letterboxd)
    with official logo icons, scores, and an optional translucent rounded contrast capsule.
    """
    if not ratings:
        return None

    project_root = PROJECT_ROOT
    if not assets_dir:
        assets_dir = project_root / "Overlayfiles" / "dynamic_overlays" / "assets" / "rating"
    if not fonts_dir:
        fonts_dir = project_root / "Overlayfiles" / "dynamic_overlays" / "fonts"

    # Font selection
    font_path = fonts_dir / "Inter-Bold.ttf"
    if not font_path.exists():
        font_path = fonts_dir / "Colus-Regular.ttf"
    if not font_path.exists():
        font_path = project_root / "Overlayfiles" / "dynamic_overlays" / "Colus-Regular.ttf"

    is_land = (canvas_type == "landscape")
    target_h = 42 if is_land else 34
    font_size = 34 if is_land else 28

    font = None
    if font_path.exists():
        try:
            font = ImageFont.truetype(str(font_path), size=font_size)
        except Exception:
            pass
    if not font:
        font = ImageFont.load_default()

    # Determine ordered list of sources to display
    ordered_sources: List[str] = []
    if slots and isinstance(slots, dict):
        for slot_key in ["rating1", "rating2", "rating3", "rating4", "rating5"]:
            src = str(slots.get(slot_key) or "").strip().lower()
            if src and src not in ordered_sources and src in sources_to_show:
                ordered_sources.append(src)
    for s in sources_to_show:
        s_clean = str(s).strip().lower()
        if s_clean and s_clean not in ordered_sources:
            ordered_sources.append(s_clean)

    rendered_badges: List[Tuple[Image.Image, int, int]] = []

    for src in ordered_sources:
        icon_name = None
        score_text = None

        if src == "imdb":
            val = ratings.get("imdb")
            if val is not None:
                icon_name = "IMDb.png"
                score_text = f"{float(val):.1f}"

        elif src in ["tomatoes", "rt_critic", "rottencritic"]:
            val = ratings.get("rt_critic")
            if val is not None:
                try:
                    num = int(round(float(val)))
                    icon_name = "RT-Crit-Fresh.png" if num >= 60 else "RT-Crit-Rotten.png"
                    score_text = f"{num}%"
                except Exception:
                    pass

        elif src in ["tomatoesaudience", "rt_audience", "rottenaudience"]:
            val = ratings.get("rt_audience")
            if val is not None:
                try:
                    num = int(round(float(val)))
                    icon_name = "RT-Aud-Fresh.png" if num >= 60 else "RT-Aud-Rotten.png"
                    score_text = f"{num}%"
                except Exception:
                    pass

        elif src == "tmdb":
            val = ratings.get("tmdb")
            if val is not None:
                icon_name = "TMDb.png"
                score_text = f"{float(val):.1f}"

        elif src == "trakt":
            val = ratings.get("trakt")
            if val is not None:
                try:
                    num = int(round(float(val)))
                    icon_name = "Trakt.png"
                    score_text = f"{num}%"
                except Exception:
                    pass

        elif src == "letterboxd":
            val = ratings.get("letterboxd")
            if val is not None:
                icon_name = "Letterboxd.png"
                score_text = f"{float(val):.1f}"

        elif src == "metacritic":
            val = ratings.get("metacritic")
            if val is not None:
                try:
                    num = int(round(float(val)))
                    icon_name = "Metacritic.png"
                    score_text = f"{num}"
                except Exception:
                    pass

        if not icon_name or not score_text:
            continue

        icon_file = assets_dir / icon_name
        if not icon_file.exists():
            continue

        try:
            with Image.open(icon_file) as raw_icon:
                icon = raw_icon.convert("RGBA")
                iw, ih = icon.size
                scaled_w = int(iw * target_h / ih) if ih > 0 else target_h
                icon = icon.resize((scaled_w, target_h), Image.Resampling.LANCZOS)

                bbox = font.getbbox(score_text)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]

                gap = 10
                b_width = scaled_w + gap + tw
                b_height = max(target_h, th)

                badge = Image.new("RGBA", (b_width, b_height), (0, 0, 0, 0))
                # Paste icon vertically centered
                icon_y = (b_height - target_h) // 2
                badge.paste(icon, (0, icon_y), icon)

                # Draw score text vertically centered
                text_y = (b_height - th) // 2 - bbox[1]
                draw = ImageDraw.Draw(badge)
                # Subtle text outline for perfect contrast
                draw.text(
                    (scaled_w + gap, text_y),
                    score_text,
                    font=font,
                    fill=(255, 255, 255, 255),
                    stroke_width=2,
                    stroke_fill=(0, 0, 0, 210)
                )

                rendered_badges.append((badge, b_width, b_height))
        except Exception as e:
            logger.debug(f"[Ratings] Error creating badge for {src}: {e}")

    if not rendered_badges:
        return None

    # Composite into cluster
    is_horiz = (alignment.lower() == "horizontal")
    gap = 24 if is_horiz else 12
    pad_x = 18 if contrast_box else 0
    pad_y = 12 if contrast_box else 0

    if is_horiz:
        total_content_w = sum(w for _, w, _ in rendered_badges) + (gap * (len(rendered_badges) - 1))
        total_w = total_content_w + (pad_x * 2)
        total_h = max(h for _, _, h in rendered_badges) + (pad_y * 2)
    else:
        total_content_w = max(w for _, w, _ in rendered_badges)
        total_w = total_content_w + (pad_x * 2)
        total_content_h = sum(h for _, _, h in rendered_badges) + (gap * (len(rendered_badges) - 1))
        total_h = total_content_h + (pad_y * 2)

    cluster_canvas = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(cluster_canvas)

    if contrast_box:
        # Translucent dark rounded capsule with subtle border
        cdraw.rounded_rectangle(
            (0, 0, total_w, total_h),
            radius=14,
            fill=(0, 0, 0, 160),
            outline=(255, 255, 255, 35),
            width=1
        )

    if is_horiz:
        cur_x = pad_x
        for b_img, bw, bh in rendered_badges:
            b_y = (total_h - bh) // 2
            cluster_canvas.paste(b_img, (cur_x, b_y), b_img)
            cur_x += bw + gap
    else:
        cur_y = pad_y
        for b_img, bw, bh in rendered_badges:
            b_x = pad_x
            cluster_canvas.paste(b_img, (b_x, cur_y), b_img)
            cur_y += bh + gap

    return cluster_canvas


def build_multi_rating_layers(
    ratings: Dict[str, Any],
    dyn_settings: Dict[str, Any],
    canvas_type: str = "landscape",
    assets_dir: Optional[Path] = None,
    fonts_dir: Optional[Path] = None
) -> List[Dict[str, Any]]:
    """
    Constructs overlay layer definition for multi-ratings badges.
    Calculates position coordinates (top-right, bottom-right, top-left, bottom-left)
    and passes in-memory cluster image.
    """
    if not ratings:
        return []

    sources_to_show = dyn_settings.get("rating_sources", ["imdb", "tomatoes", "tmdb", "tomatoesaudience"])
    slots = dyn_settings.get("rating_slots", {})
    alignment = dyn_settings.get("rating_alignment", "horizontal")
    contrast_box = dyn_settings.get("rating_contrast_box", True)
    position = dyn_settings.get("rating_position", "top-right")

    cluster_img = render_multi_rating_cluster(
        ratings=ratings,
        sources_to_show=sources_to_show,
        slots=slots,
        alignment=alignment,
        contrast_box=contrast_box,
        canvas_type=canvas_type,
        assets_dir=assets_dir,
        fonts_dir=fonts_dir
    )
    if not cluster_img:
        return []

    # Map position to coordinates
    pos_clean = str(position).strip().lower()
    if pos_clean == "bottom-right":
        h_align, h_offset = "right", 40
        v_align, v_offset = "bottom", 40
    elif pos_clean == "top-left":
        h_align, h_offset = "left", 40
        v_align, v_offset = "top", 40
    elif pos_clean == "bottom-left":
        h_align, h_offset = "left", 40
        v_align, v_offset = "bottom", 40
    else:  # "top-right" default
        h_align, h_offset = "right", 40
        v_align, v_offset = "top", 40

    # Include a rating hash to ensure any rating score change invalidates recipe cache
    scores_summary = f"{ratings.get('imdb')}_{ratings.get('rt_critic')}_{ratings.get('rt_audience')}_{ratings.get('tmdb')}_{ratings.get('trakt')}_{ratings.get('letterboxd')}_{ratings.get('metacritic')}"
    rating_hash = hashlib.md5(f"{scores_summary}_{alignment}_{position}_{contrast_box}".encode()).hexdigest()

    return [{
        "name": "multi_ratings_cluster",
        "type": "image",
        "image_element": cluster_img,
        "horizontal_align": h_align,
        "horizontal_offset": h_offset,
        "vertical_align": v_align,
        "vertical_offset": v_offset,
        "rating_hash": rating_hash
    }]

