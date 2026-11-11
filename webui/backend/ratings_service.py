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
import time
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple
import hashlib
from contextlib import closing
from xml.etree.ElementTree import fromstring
from PIL import Image, ImageDraw, ImageFont

import httpx
from urllib.parse import urlparse
from imdb_dataset import ImdbDataset

logger = logging.getLogger("ratings_service")
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_MDBLIST_REQUEST_INTERVAL_SECONDS = 0.5
_MDBLIST_PACE_LOCK = threading.Lock()
_MDBLIST_NEXT_REQUEST_AT = 0.0


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
imdb_dataset = ImdbDataset(DATABASE_DIR / "imdb_dataset.db")
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
EPISODE_RATING_SOURCE_COLUMNS = {
    "imdb": "imdb_rating",
    "tmdb": "tmdb_rating",
    "tomatoes": "rt_critic_rating",
    "tomatoesaudience": "rt_audience_rating",
    "trakt": "trakt_rating",
    "metacritic": "metacritic_rating",
    "letterboxd": "letterboxd_rating",
    "mdblist_episode": "mdblist_rating",
}


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
                            mdblist_rating REAL,

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
                    conn.execute("""
                        CREATE TABLE IF NOT EXISTS streaming_provider_cache (
                            media_type TEXT NOT NULL,
                            tmdb_id TEXT NOT NULL,
                            provider_results TEXT NOT NULL,
                            expires_at TEXT NOT NULL,
                            PRIMARY KEY (media_type, tmdb_id)
                        )
                    """)
                    conn.execute("""
                        CREATE TABLE IF NOT EXISTS season_rating_mappings (
                            server_type TEXT NOT NULL,
                            item_id TEXT NOT NULL,
                            payload TEXT NOT NULL,
                            updated_at TEXT NOT NULL,
                            PRIMARY KEY (server_type, item_id)
                        )
                    """)
                    conn.execute("""
                        CREATE TABLE IF NOT EXISTS mdblist_episode_ratings_cache (
                            tmdb_id TEXT PRIMARY KEY,
                            payload TEXT NOT NULL,
                            fetched_at TEXT NOT NULL,
                            expires_at TEXT NOT NULL
                        )
                    """)
                    for col_sql in [
                        "ALTER TABLE media_ratings_cache ADD COLUMN simkl_rating REAL;",
                        "ALTER TABLE media_ratings_cache ADD COLUMN mal_rating REAL;",
                        "ALTER TABLE media_ratings_cache ADD COLUMN simkl_url TEXT;",
                        "ALTER TABLE media_ratings_cache ADD COLUMN show_status TEXT;",
                        "ALTER TABLE media_ratings_cache ADD COLUMN network TEXT;",
                        "ALTER TABLE media_ratings_cache ADD COLUMN content_rating TEXT;",
                        "ALTER TABLE media_ratings_cache ADD COLUMN last_refresh_at TEXT;",
                        "ALTER TABLE media_ratings_cache ADD COLUMN last_refresh_status TEXT;",
                        "ALTER TABLE media_ratings_cache ADD COLUMN last_refresh_details TEXT;",
                        "ALTER TABLE media_ratings_cache ADD COLUMN mdblist_rating REAL;"
                    ]:
                        try:
                            conn.execute(col_sql)
                        except Exception:
                            pass
                conn.close()
            except Exception as e:
                logger.error(f"[RatingsCache] Error initializing database: {e}")


    def get_watch_providers(self, media_type: str, tmdb_id: str, allow_stale: bool = False) -> Optional[Dict[str, Any]]:
        with self.lock:
            with closing(self._get_connection()) as connection:
                row = connection.execute(
                    "SELECT provider_results, expires_at FROM streaming_provider_cache WHERE media_type = ? AND tmdb_id = ?",
                    (media_type, str(tmdb_id))
                ).fetchone()
            if row is None or (not allow_stale and datetime.fromisoformat(row["expires_at"]) <= datetime.now()):
                return None
            return json.loads(row["provider_results"])

    def save_watch_providers(self, media_type: str, tmdb_id: str, results: Dict[str, Any]) -> None:
        with self.lock:
            with closing(self._get_connection()) as connection:
                with connection:
                    connection.execute(
                        "INSERT INTO streaming_provider_cache (media_type, tmdb_id, provider_results, expires_at) VALUES (?, ?, ?, ?) "
                        "ON CONFLICT(media_type, tmdb_id) DO UPDATE SET provider_results = excluded.provider_results, expires_at = excluded.expires_at",
                        (media_type, str(tmdb_id), json.dumps(results, sort_keys=True), (datetime.now() + timedelta(days=1)).isoformat())
                    )

    def get_cached_ratings(self, server_type: str, item_id: str, allow_stale: bool = False) -> Optional[Dict[str, Any]]:
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
                        if not allow_stale and datetime.utcnow() > exp_dt:
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
                for source in ("simkl", "mal"):
                    if data.get(f"{source}_rating") is not None:
                        data[source] = data[f"{source}_rating"]

                return data
            except Exception as e:
                logger.error(f"[RatingsCache] Error reading cache ({server_type}, {item_id}): {e}")
                return None

    def get_season_mapping(self, server_type, item_id):
        with self.lock, closing(self._get_connection()) as connection:
            row = connection.execute(
                "SELECT payload FROM season_rating_mappings WHERE server_type = ? AND item_id = ?",
                (server_type.lower(), str(item_id)),
            ).fetchone()
        return json.loads(row[0]) if row else None

    def save_season_mapping(self, server_type, item_id, mapping, invalidate=False, expected_choice=None):
        now = datetime.utcnow().isoformat()
        with self.lock, closing(self._get_connection()) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                if expected_choice is not None:
                    current_row = connection.execute(
                        "SELECT payload FROM season_rating_mappings WHERE server_type = ? AND item_id = ?",
                        (server_type.lower(), str(item_id)),
                    ).fetchone()
                    current = json.loads(current_row[0]) if current_row else {}
                    if (current.get("mode", "auto"), current.get("simkl_id")) != expected_choice:
                        return None
                connection.execute(
                    "INSERT INTO season_rating_mappings (server_type, item_id, payload, updated_at) VALUES (?, ?, ?, ?) "
                    "ON CONFLICT(server_type, item_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
                    (server_type.lower(), str(item_id), json.dumps(mapping), now),
                )
                if invalidate:
                    connection.execute(
                        "UPDATE media_ratings_cache SET imdb_rating = NULL, tmdb_rating = NULL, rt_critic_rating = NULL, "
                        "rt_audience_rating = NULL, trakt_rating = NULL, metacritic_rating = NULL, letterboxd_rating = NULL, "
                        "simkl_rating = NULL, mal_rating = NULL, simkl_url = NULL, expires_at = ?, "
                        "last_refresh_status = NULL, last_refresh_details = NULL WHERE server_type = ? AND item_id = ? AND media_type = 'season'",
                        (now, server_type.lower(), str(item_id)),
                    )
        return mapping

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
                            metacritic_rating, letterboxd_rating, mdblist_rating, simkl_rating, mal_rating, simkl_url, source,
                            cached_at, expires_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(server_type, item_id) DO UPDATE SET
                            title = excluded.title,
                            media_type = excluded.media_type,
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
                            mdblist_rating = COALESCE(excluded.mdblist_rating, media_ratings_cache.mdblist_rating),
                            simkl_rating = COALESCE(excluded.simkl_rating, media_ratings_cache.simkl_rating),
                            mal_rating = COALESCE(excluded.mal_rating, media_ratings_cache.mal_rating),
                            simkl_url = COALESCE(excluded.simkl_url, media_ratings_cache.simkl_url),
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
                            ratings.get("mdblist_episode"),
                            ratings.get("simkl"),
                            ratings.get("mal"),
                            ratings.get("_simkl_url"),
                            source,
                            now.isoformat(),
                            expires_at.isoformat()
                        )
                    )
                conn.close()
                return True
            except Exception as e:
                logger.error(f"[RatingsCache] Error saving ratings for {title}: {e}")
                return False

    def get_cached_mdblist_episode_ratings(self, tmdb_id: int):
        now = datetime.utcnow().isoformat()
        with self.lock, closing(self._get_connection()) as connection:
            row = connection.execute(
                "SELECT payload FROM mdblist_episode_ratings_cache WHERE tmdb_id = ? AND expires_at > ?",
                (str(tmdb_id), now),
            ).fetchone()
        return json.loads(row[0]) if row else None

    def save_mdblist_episode_ratings(self, tmdb_id: int, payload: Dict[str, Any], ttl_days: int = 1):
        now = datetime.utcnow()
        with self.lock, closing(self._get_connection()) as connection:
            with connection:
                connection.execute(
                    "INSERT INTO mdblist_episode_ratings_cache (tmdb_id, payload, fetched_at, expires_at) VALUES (?, ?, ?, ?) "
                    "ON CONFLICT(tmdb_id) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at",
                    (str(tmdb_id), json.dumps(payload), now.isoformat(), (now + timedelta(days=ttl_days)).isoformat()),
                )

    def clear_all(self):
        """Purge all cached ratings."""
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    conn.execute("DELETE FROM media_ratings_cache;")
                    conn.execute("DELETE FROM mdblist_episode_ratings_cache;")
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
                            media_type = 'show',
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

    def record_refresh(self, server_type: str, item_id: str, status: str, details: Dict[str, Any]) -> None:
        with self.lock:
            with closing(self._get_connection()) as connection:
                with connection:
                    connection.execute(
                        "UPDATE media_ratings_cache SET last_refresh_at = ?, last_refresh_status = ?, last_refresh_details = ? "
                        "WHERE server_type = ? AND item_id = ?",
                        (datetime.utcnow().isoformat(), status, json.dumps(details, sort_keys=True), server_type.lower(), str(item_id))
                    )

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
        sort_desc: bool = True,
        source: Optional[str] = None,
        missing_only: bool = False,
        score: Optional[str] = None,
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

        if server_type and server_type.strip().lower() not in ("all", ""):
            where_clauses.append("server_type = ?")
            params.append(server_type.strip().lower())

        if media_type and media_type.strip().lower() not in ("all", ""):
            where_clauses.append("media_type = ?")
            params.append(media_type.strip().lower())

        if show_status and show_status.strip().lower() not in ("all", ""):
            where_clauses.append("show_status = ?")
            params.append(show_status.strip().lower())

        if source and source.strip().lower() not in ("all", ""):
            where_clauses.append("LOWER(COALESCE(source, '')) = ?")
            params.append(source.strip().lower())

        score_columns = (
            "imdb_rating", "tmdb_rating", "rt_critic_rating", "rt_audience_rating",
            "trakt_rating", "metacritic_rating", "letterboxd_rating", "mdblist_rating",
            "simkl_rating", "mal_rating",
        )
        score_column = {
            "imdb": "imdb_rating",
            "tmdb": "tmdb_rating",
            "rt_critic": "rt_critic_rating",
            "rt_audience": "rt_audience_rating",
            "trakt": "trakt_rating",
            "metacritic": "metacritic_rating",
            "letterboxd": "letterboxd_rating",
            "mdblist_episode": "mdblist_rating",
            "simkl": "simkl_rating",
            "mal": "mal_rating",
        }.get((score or "").strip().lower())
        if score_column:
            where_clauses.append(f"{score_column} IS NOT NULL")
        elif missing_only or (score or "").strip().lower() == "missing":
            where_clauses.append("(" + " AND ".join(f"{column} IS NULL" for column in score_columns) + ")")

        if status:
            stat = status.strip().lower()
            if stat == "valid":
                where_clauses.append("expires_at > ?")
                params.append(now_iso)
            elif stat == "expired":
                where_clauses.append("expires_at <= ?")
                params.append(now_iso)

        with self.lock:
            try:
                conn = self._get_connection()
                cur = conn.cursor()
                overlay_columns = set()
                overlay_table = cur.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dynamic_overlay_cache'"
                ).fetchone()
                if overlay_table:
                    overlay_columns = {row[1] for row in cur.execute("PRAGMA table_info(dynamic_overlay_cache)")}

                if search and search.strip():
                    search_value = f"%{search.strip()}%"
                    search_clause = "title LIKE ? OR imdb_id LIKE ? OR item_id LIKE ? OR show_status LIKE ?"
                    params.extend([search_value] * 4)
                    if {"server_type", "item_id", "asset_type", "item_title"}.issubset(overlay_columns):
                        search_clause += """ OR EXISTS (
                            SELECT 1 FROM dynamic_overlay_cache AS artwork
                            WHERE artwork.server_type = media_ratings_cache.server_type
                              AND artwork.item_id = media_ratings_cache.item_id
                              AND artwork.asset_type = CASE media_ratings_cache.media_type
                                  WHEN 'episode' THEN 'titlecard' WHEN 'season' THEN 'season' ELSE 'poster' END
                              AND artwork.item_title LIKE ?
                        )"""
                        params.append(search_value)
                    where_clauses.append(f"({search_clause})")
                where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

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

                overlay_context = {}
                media_assets = {"episode": "titlecard", "season": "season", "movie": "poster", "show": "poster"}
                overlay_keys = [
                    (row["server_type"], str(row["item_id"]), media_assets.get(row["media_type"], "poster"))
                    for row in rows
                ]
                if overlay_keys:
                    if overlay_table:
                        required_columns = {"server_type", "item_id", "asset_type"}
                        if required_columns.issubset(overlay_columns):
                            title_column = "item_title" if "item_title" in overlay_columns else "NULL"
                            library_column = "library_name" if "library_name" in overlay_columns else "NULL"
                            order_clause = "ORDER BY id DESC" if "id" in overlay_columns else ""
                            key_clause = " OR ".join("(server_type = ? AND item_id = ? AND asset_type = ?)" for _ in overlay_keys)
                            overlay_rows = cur.execute(
                                f"SELECT server_type, item_id, asset_type, {title_column} AS overlay_title, {library_column} AS library_name "
                                f"FROM dynamic_overlay_cache WHERE ({key_clause}) {order_clause}",
                                tuple(value for key in overlay_keys for value in key),
                            ).fetchall()
                            for row in overlay_rows:
                                overlay_context.setdefault(
                                    (row["server_type"], str(row["item_id"]), row["asset_type"]), dict(row)
                                )

                entries = []
                for r in rows:
                    item = dict(r)
                    asset_type = media_assets.get(item.get("media_type"), "poster")
                    item.update(overlay_context.get((item["server_type"], str(item["item_id"]), asset_type), {}))
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
                cur.execute(
                    "SELECT LOWER(TRIM(show_status)), COUNT(*) FROM media_ratings_cache "
                    "WHERE show_status IS NOT NULL AND TRIM(show_status) != '' "
                    "GROUP BY LOWER(TRIM(show_status))"
                )
                show_status_counts = {row[0]: row[1] for row in cur.fetchall()}

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
                        "expired": all_total - valid_count,
                        "show_status_counts": show_status_counts,
                    }
                }
            except Exception as e:
                logger.error(f"[RatingsCache] Error querying entries: {e}")
                return {"entries": [], "total": 0, "page": page, "limit": limit, "total_pages": 1, "stats": {}}

    def ensure_unmapped_episode(self, server_type, item_id, title, year, imdb_id):
        now = datetime.utcnow()
        with self.lock, closing(self._get_connection()) as connection, connection:
            connection.execute(
                "INSERT OR IGNORE INTO media_ratings_cache (server_type,item_id,media_type,title,year,imdb_id,cached_at,expires_at) VALUES (?,?,'episode',?,?,?,?,?)",
                (server_type.lower(), str(item_id), title, year, imdb_id, now.isoformat(), (now - timedelta(days=1)).isoformat()),
            )

    def apply_imdb_mapping(self, entry_id, imdb_id, rating):
        with self.lock, closing(self._get_connection()) as connection, connection:
            connection.execute(
                "UPDATE media_ratings_cache SET imdb_id=?, imdb_rating=?, source=CASE WHEN ? IS NOT NULL THEN 'imdb_dataset' ELSE source END WHERE id=? AND media_type='episode'",
                (imdb_id, rating, rating, int(entry_id)),
            )
            if connection.execute("SELECT 1 FROM sqlite_master WHERE name='ratings_refresh_retry'").fetchone():
                connection.execute("DELETE FROM ratings_refresh_retry WHERE (server_type,item_id) IN (SELECT server_type,item_id FROM media_ratings_cache WHERE id=?)", (int(entry_id),))

    def apply_imdb_season_mapping(self, dataset, server, context):
        series = context.get("series_title") or context.get("parent_imdb_id")
        with self.lock, closing(self._get_connection()) as connection:
            entries = connection.execute("SELECT id, item_id FROM media_ratings_cache WHERE server_type=? AND media_type='episode'", (server,)).fetchall()
        updated = 0
        for entry in entries:
            saved = dataset.context(server, entry["item_id"])
            if ((saved.get("series_title") or saved.get("parent_imdb_id")) != series
                    or str(saved.get("season_number")) != str(context.get("season_number"))):
                continue
            match = dataset.resolve(server, entry["item_id"])
            self.apply_imdb_mapping(entry["id"], match.get("imdb_id") if match.get("status") == "matched" else None, match.get("rating"))
            updated += 1
        return updated

    def reset_entry(self, entry_id: int) -> Optional[Dict[str, Any]]:
        """Reset one item's ratings and overlay metadata cache without changing mappings."""
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    row = conn.execute(
                        "SELECT * FROM media_ratings_cache WHERE id = ?", (int(entry_id),)
                    ).fetchone()
                    item = dict(row) if row else None
                    if item:
                        conn.execute("DELETE FROM media_ratings_cache WHERE id = ?", (int(entry_id),))
                        tables = {table[0] for table in conn.execute(
                            "SELECT name FROM sqlite_master WHERE type = 'table'"
                        )}
                        if "ratings_refresh_retry" in tables:
                            conn.execute(
                                "DELETE FROM ratings_refresh_retry WHERE server_type = ? AND item_id = ?",
                                (item["server_type"], item["item_id"]),
                            )
                        if "dynamic_overlay_cache" in tables:
                            conn.execute(
                                "DELETE FROM dynamic_overlay_cache WHERE server_type = ? AND item_id = ?",
                                (item["server_type"], item["item_id"]),
                            )
                            if "overlay_layer_snapshots" in tables:
                                conn.execute(
                                    "DELETE FROM overlay_layer_snapshots WHERE digest NOT IN ("
                                    "SELECT json_extract(attr_snapshot, '$._overlay_layers_ref') FROM dynamic_overlay_cache "
                                    "WHERE json_valid(attr_snapshot) AND json_type(attr_snapshot, '$._overlay_layers_ref') = 'text')"
                                )
                conn.close()
                return item
            except Exception as e:
                logger.error(f"[RatingsCache] Error resetting entry {entry_id}: {e}")
                return None

    def delete_entry(self, entry_id: int) -> bool:
        """Delete a single cached rating record and its associated overlay metadata."""
        return self.reset_entry(entry_id) is not None

    def delete_item(self, server_type: str, item_id: str) -> bool:
        """Delete cached state for a media item confirmed missing by its server."""
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    server_type = server_type.lower()
                    item_id = str(item_id)
                    cur = conn.execute(
                        "DELETE FROM media_ratings_cache WHERE server_type = ? AND item_id = ?",
                        (server_type, item_id),
                    )
                    deleted = cur.rowcount > 0
                    tables = {row[0] for row in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )}
                    for table in ("ratings_refresh_retry", "season_rating_mappings", "dynamic_overlay_cache"):
                        if table in tables:
                            cur = conn.execute(
                                f"DELETE FROM {table} WHERE server_type = ? AND item_id = ?",
                                (server_type, item_id),
                            )
                            deleted = deleted or cur.rowcount > 0
                    if "dynamic_overlay_cache" in tables and "overlay_layer_snapshots" in tables:
                        conn.execute(
                            "DELETE FROM overlay_layer_snapshots WHERE digest NOT IN ("
                            "SELECT json_extract(attr_snapshot, '$._overlay_layers_ref') FROM dynamic_overlay_cache "
                            "WHERE json_valid(attr_snapshot) AND json_type(attr_snapshot, '$._overlay_layers_ref') = 'text')"
                        )
                conn.close()
                return deleted
            except Exception as e:
                logger.error(f"[RatingsCache] Error deleting missing item ({server_type}, {item_id}): {e}")
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
                    retry_table = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ratings_refresh_retry'").fetchone()
                    if updated and retry_table:
                        conn.execute(
                            "DELETE FROM ratings_refresh_retry WHERE (server_type, item_id) IN "
                            "(SELECT server_type, item_id FROM media_ratings_cache WHERE id = ?)", (int(entry_id),),
                        )
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
        video = root if root.tag in ("Video", "Directory") else root.find(".//Video")
        if video is None:
            video = root.find(".//Directory")
        if video is not None:
            for attribute, image_attribute in (("audienceRating", "audienceRatingImage"), ("rating", "ratingImage")):
                image = str(video.get(image_attribute) or "").lower()
                try:
                    value = float(video.get(attribute))
                    if "imdb" in image:
                        ratings.setdefault("imdb", round(value, 1))
                    elif "themoviedb" in image or "tmdb" in image:
                        ratings.setdefault("tmdb", round(value, 1))
                    elif "rottentomatoes" in image:
                        key = "rt_audience" if attribute == "audienceRating" else "rt_critic"
                        ratings.setdefault(key, int(round(value * 10)) if value <= 10 else int(round(value)))
                except (TypeError, ValueError):
                    pass

    except Exception as e:
        logger.debug(f"[Ratings] Error parsing Plex XML ratings: {e}")

    return ratings


def _rating_error_details(data):
    error_text = str(data.get("error") or data.get("Error") or "").lower() if isinstance(data, dict) else ""
    if "not found" in error_text or "not exist" in error_text:
        return "not_found", "Item not found by provider"
    if "limit" in error_text or "quota" in error_text:
        return "quota", "Provider rate or daily limit reached"
    if any(fragment in error_text for fragment in ("api key", "apikey", "api_key", "invalid key", "unauthor", "authenticat")):
        return "auth", "Invalid or unauthorized API key"
    return "rejected", "Provider rejected the request"


async def _fetch_rating_json(client, provider, url, outcomes, **kwargs):
    try:
        response = await client.get(url, **kwargs)
        if response.status_code != 200:
            outcomes[provider] = {"status": "failed", "message": f"HTTP {response.status_code}",
                                 "http_status": response.status_code}
            if provider == "mdblist":
                if response.status_code == 429:
                    outcomes[provider]["error_code"] = "rate_limit"
                    if response.headers.get("Retry-After", "").isdigit():
                        outcomes[provider]["retry_after"] = int(response.headers["Retry-After"])
                elif response.status_code >= 500:
                    outcomes[provider]["error_code"] = "server_error"
            if provider == "omdb":
                try:
                    error_code, message = _rating_error_details(response.json())
                except ValueError:
                    error_code, message = "rejected", None
                if error_code != "rejected":
                    outcomes[provider].update(error_code=error_code, message=message)
                else:
                    outcomes[provider]["error_code"] = "rate_limit" if response.status_code == 429 else "http_error"
                outcomes[provider]["http_status"] = response.status_code
            return None
        data = response.json()
        if not isinstance(data, dict) or data.get("error") or data.get("Response") == "False":
            error_code, message = _rating_error_details(data)
            outcomes[provider] = {"status": "failed", "message": message}
            if provider == "mdblist":
                outcomes[provider]["error_code"] = error_code
            if provider == "omdb":
                outcomes[provider].update(error_code=error_code, http_status=response.status_code)
            return None
        outcomes[provider] = {"status": "no_scores", "message": "No usable scores returned"}
        return data
    except Exception as error:
        outcomes[provider] = {"status": "failed", "message": f"Request failed ({type(error).__name__})"}
        return None


async def fetch_tmdb_rating(
    tmdb_id: int,
    api_key: str,
    client: httpx.AsyncClient,
    media_type: str = "movie",
    outcomes: Optional[Dict[str, Any]] = None
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

    outcomes = outcomes if outcomes is not None else {}
    data = await _fetch_rating_json(client, "tmdb", url, outcomes, headers=headers, params=params, timeout=6.0)
    if data:
        try:
            avg = float(data.get("vote_average"))
            if 0 < avg <= 10:
                outcomes["tmdb"] = {"status": "success", "scores": ["tmdb"]}
                return round(avg, 1)
        except (TypeError, ValueError):
            pass
    return None


async def fetch_tmdb_episode_rating(
    tmdb_id: int,
    season_number: int,
    episode_number: int,
    api_key: str,
    client: httpx.AsyncClient,
    outcomes: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[float], Optional[str]]:
    """Fetch one TMDb episode score and its episode-level IMDb ID."""
    if not tmdb_id or not api_key or season_number is None or episode_number is None:
        return None, None

    token = str(api_key).strip()
    headers = {"Authorization": f"Bearer {token}"} if token.startswith("ey") or len(token) > 40 else {}
    params = {"append_to_response": "external_ids"}
    if not headers:
        params["api_key"] = token
    url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{season_number}/episode/{episode_number}"
    outcomes = outcomes if outcomes is not None else {}
    data = await _fetch_rating_json(client, "tmdb", url, outcomes, headers=headers, params=params, timeout=6.0)
    if not data:
        return None, None
    imdb_id = (data.get("external_ids") or {}).get("imdb_id")
    try:
        score = float(data.get("vote_average"))
        if 0 < score <= 10:
            outcomes["tmdb"] = {"status": "success", "scores": ["tmdb"]}
            return round(score, 1), imdb_id
    except (TypeError, ValueError):
        pass
    outcomes["tmdb"] = {"status": "no_scores", "message": "TMDb has no rating for this episode"}
    return None, imdb_id


async def _pace_mdblist_request():
    global _MDBLIST_NEXT_REQUEST_AT
    with _MDBLIST_PACE_LOCK:
        now = time.monotonic()
        request_at = max(now, _MDBLIST_NEXT_REQUEST_AT)
        _MDBLIST_NEXT_REQUEST_AT = request_at + _MDBLIST_REQUEST_INTERVAL_SECONDS
    delay = request_at - now
    if delay > 0:
        await asyncio.sleep(delay)



async def fetch_mdblist_ratings(
    imdb_id: Optional[str],
    tmdb_id: Optional[int],
    api_key: str,
    client: httpx.AsyncClient,
    media_type: str = "movie",
    outcomes: Optional[Dict[str, Any]] = None,
    provider_run_state: Optional["RatingsProviderRunState"] = None,
) -> Dict[str, Any]:
    """
    Fetch comprehensive ratings from MDBList API (IMDb, RT, TMDb, Trakt, Letterboxd, Metacritic).
    Optional integration enabled only when user provides an MDBList API Key.
    """
    if not api_key or (not imdb_id and not tmdb_id):
        return {}

    m_type = "show" if media_type in ["show", "tv", "episode"] else "movie"
    params = {"apikey": api_key.strip(), "m": m_type}
    if imdb_id:
        params["i"] = imdb_id.strip()
    if tmdb_id:
        params["tm"] = str(tmdb_id)

    url = "https://mdblist.com/api/"
    ratings = {}
    outcomes = outcomes if outcomes is not None else {}
    if provider_run_state is not None:
        reason = provider_run_state.begin_mdblist_request()
        if reason:
            outcomes["mdblist"] = {"status": "skipped", "error_code": "run_suppressed", "message": reason}
            return {}
    try:
        await _pace_mdblist_request()
        data = await _fetch_rating_json(client, "mdblist", url, outcomes, params=params, timeout=8.0)
        if data:
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
    except (TypeError, ValueError, AttributeError):
        outcomes["mdblist"] = {"status": "failed", "message": "Invalid rating data"}

    if ratings:
        outcomes["mdblist"] = {"status": "success", "scores": sorted(ratings)}

    if provider_run_state is not None:
        provider_run_state.observe_mdblist(outcomes.get("mdblist") or {})

    return ratings


async def fetch_mdblist_episode_rating(tmdb_id, season_number, episode_number, api_key, client,
                                       cache=None, outcomes=None, provider_run_state=None):
    """Fetch one episode score from MDBList's supporter-only show episode matrix."""
    cache = cache if cache is not None else ratings_cache
    outcomes = outcomes if outcomes is not None else {}
    if not api_key or tmdb_id is None or season_number is None or episode_number is None:
        outcomes["mdblist"] = {"status": "no_scores", "message": "Episode lookup requires a TMDb show ID and coordinates"}
        return None

    async def load_matrix():
        if provider_run_state is not None:
            reason = provider_run_state.begin_mdblist_request()
            if reason:
                outcomes["mdblist"] = {"status": "skipped", "error_code": "run_suppressed", "message": reason}
                return None
        await _pace_mdblist_request()
        details = await _fetch_rating_json(
            client, "mdblist", f"https://api.mdblist.com/tmdb/show/{tmdb_id}", outcomes,
            params={"apikey": api_key.strip(), "append_to_response": "episode_ratings"}, timeout=8.0,
        )
        outcome = outcomes.get("mdblist") or {}
        if provider_run_state is not None:
            provider_run_state.observe_mdblist(outcome)
        if not details:
            return None
        matrix = details.get("episode_ratings") or {}
        cache.save_mdblist_episode_ratings(tmdb_id, matrix, ttl_days=1)
        return matrix

    matrix = cache.get_cached_mdblist_episode_ratings(tmdb_id)
    if matrix is None and provider_run_state is not None:
        async with provider_run_state.mdblist_matrix_lock(tmdb_id):
            matrix = cache.get_cached_mdblist_episode_ratings(tmdb_id)
            if matrix is None:
                matrix = await load_matrix()
    elif matrix is None:
        matrix = await load_matrix()
    if matrix is None:
        return None

    seasons = matrix.get("seasons") if isinstance(matrix, dict) else None
    if not seasons:
        outcomes["mdblist"] = {"status": "no_scores", "message": "MDBList episode ratings are unavailable for this account or show"}
        return None
    season = next((entry for entry in seasons if str(entry.get("season_number")) == str(season_number)), None)
    episode = next((entry for entry in (season or {}).get("episodes", [])
                    if str(entry.get("episode_number")) == str(episode_number)), None)
    try:
        score = float((episode or {}).get("rating"))
        if score > 10 and score <= 100:
            score /= 10
        if not 0 < score <= 10:
            raise ValueError
    except (TypeError, ValueError):
        outcomes["mdblist"] = {"status": "no_scores", "message": "MDBList has no rating for this episode"}
        return None
    outcomes["mdblist"] = {"status": "success", "scores": ["mdblist_episode"], "cached_matrix": True}
    return round(score, 1)


def select_simkl_season_candidate(candidates, season_number, episode_numbers):
    relevant = [candidate for candidate in candidates if season_number in candidate.get("mapped_seasons", [])]
    if len(relevant) > 1:
        return None, "ambiguous"
    if not relevant:
        return None, "unmapped"
    candidate = relevant[0]
    if candidate.get("mapped_seasons") != [season_number] or not episode_numbers:
        return None, "unmapped"
    if set(candidate.get("episode_numbers", [])) != set(episode_numbers):
        return None, "incomplete"
    return candidate, "matched"


def _simkl_request_context(client_id):
    try:
        version = (PROJECT_ROOT / "Release.txt").read_text(encoding="utf-8").splitlines()[0].strip()
    except (OSError, IndexError):
        version = "unknown"
    params = {"client_id": str(client_id).strip(), "app-name": "posterizarr", "app-version": version}
    headers = {"User-Agent": f"Posterizarr/{version}"}
    return params, headers


async def fetch_simkl_catalog(imdb_id, tmdb_id, client_id, client, media_type="movie", outcomes=None, tvdb_id=None, anime_id=None):
    outcomes = outcomes if outcomes is not None else {}
    if not client_id or media_type not in ("movie", "show") or not (imdb_id or tmdb_id or tvdb_id or anime_id):
        return {}
    params, headers = _simkl_request_context(client_id)
    try:
        if anime_id is not None:
            if not str(anime_id).isdigit() or int(anime_id) <= 0:
                return {}
            parts = ["anime", str(anime_id)]
        else:
            identifiers = {key: value for key, value in (("imdb", imdb_id), ("tmdb", tmdb_id), ("tvdb", tvdb_id)) if value}
            response = await client.get(
                "https://api.simkl.com/redirect", params={**params, **identifiers, "type": "movie" if media_type == "movie" else "tv", "to": "simkl"},
                headers=headers, follow_redirects=False, timeout=6.0,
            )
            if response.status_code not in (301, 302):
                outcomes["simkl"] = {"status": "failed", "message": f"ID resolution HTTP {response.status_code}"}
                return {}
            destination = urlparse(response.headers.get("Location", ""))
            parts = destination.path.strip("/").split("/")
            if destination.scheme != "https" or destination.netloc != "simkl.com" or len(parts) < 2 or parts[0] not in ("movies", "tv", "anime") or not parts[1].isdigit():
                outcomes["simkl"] = {"status": "no_scores", "message": "No matching catalog item"}
                return {}
        if (media_type == "movie" and parts[0] == "tv") or (media_type == "show" and parts[0] == "movies"):
            outcomes["simkl"] = {"status": "no_scores", "message": "Catalog item type mismatch"}
            return {}
        data = await _fetch_rating_json(client, "simkl", f"https://api.simkl.com/{parts[0]}/{parts[1]}", outcomes,
                                        params=params, headers=headers, follow_redirects=False, timeout=6.0)
        if not data:
            return {}
        slug = str((data.get("ids") or {}).get("slug") or (parts[2] if len(parts) > 2 else ""))
        slug = slug if all(character.isalnum() or character in "-_" for character in slug) else ""
        data["_simkl_url"] = f"https://simkl.com/{parts[0]}/{parts[1]}" + (f"/{slug}" if slug else "")
        data["_simkl_id"] = int(parts[1])
        return data
    except Exception as error:
        outcomes["simkl"] = {"status": "failed", "message": f"Request failed ({type(error).__name__})"}
        return {}


def _simkl_scores(data, sources=("imdb", "simkl", "mal")):
    scores = {}
    for source in sources:
        rating = (data.get("ratings") or {}).get(source)
        if not isinstance(rating, dict):
            continue
        try:
            value = float(rating.get("rating"))
            if 0 < value <= 10:
                scores[source] = round(value, 1)
        except (TypeError, ValueError):
            pass
    if scores and data.get("_simkl_url"):
        scores["_simkl_url"] = data["_simkl_url"]
    return scores


async def fetch_simkl_ratings(imdb_id, tmdb_id, client_id, client, media_type="movie", outcomes=None, tvdb_id=None):
    outcomes = outcomes if outcomes is not None else {}
    data = await fetch_simkl_catalog(imdb_id, tmdb_id, client_id, client, media_type, outcomes, tvdb_id)
    scores = _simkl_scores(data)
    if scores:
        outcomes["simkl"] = {"status": "success", "scores": sorted(key for key in scores if not key.startswith("_"))}
    return scores


async def fetch_simkl_season_candidates(parent_metadata, client_id, client):
    tvdb_id = str(parent_metadata.get("tvdb_id") or "")
    if not tvdb_id or not client_id:
        return [], False
    root = await fetch_simkl_catalog(None, None, client_id, client, "show", tvdb_id=tvdb_id)
    if not root:
        return [], False
    if not str(root.get("_simkl_url", "")).startswith("https://simkl.com/anime/"):
        return [], True
    params, headers = _simkl_request_context(client_id)
    pending = [root]
    visited = set()
    candidates = []
    complete = True
    while pending and len(visited) < 32:
        data = pending.pop(0)
        anime_id = data["_simkl_id"]
        if anime_id in visited:
            continue
        visited.add(anime_id)
        if str((data.get("ids") or {}).get("tvdb") or "") != tvdb_id:
            complete = False
            continue
        for relation in data.get("relations") or []:
            if not isinstance(relation, dict) or relation.get("relation_type") not in ("sequel", "prequel") or relation.get("anime_type", "tv") not in ("tv", "ona"):
                continue
            related_id = (relation.get("ids") or {}).get("simkl")
            if related_id is None or not str(related_id).isdigit():
                complete = False
                continue
            if int(related_id) in visited or any(entry["_simkl_id"] == int(related_id) for entry in pending):
                continue
            if len(visited) + len(pending) >= 32:
                complete = False
                break
            related = await fetch_simkl_catalog(None, None, client_id, client, "show", anime_id=related_id)
            if related:
                pending.append(related)
            else:
                complete = False
        try:
            response = await client.get(f"https://api.simkl.com/anime/episodes/{anime_id}", params=params, headers=headers,
                                        follow_redirects=False, timeout=6.0)
            episodes = response.json() if response.status_code == 200 else None
            if not isinstance(episodes, list) or not episodes:
                complete = False
                continue
            by_season = {}
            for episode in episodes:
                if episode.get("type", "episode") != "episode":
                    continue
                coordinate = episode.get("tvdb") or {}
                if coordinate.get("season") is None or coordinate.get("episode") is None:
                    complete = False
                    continue
                by_season.setdefault(str(int(coordinate["season"])), []).append(int(coordinate["episode"]))
            mapped_seasons = sorted(set(int(value) for value in (data.get("mapped_tvdb_seasons") or [])) | {int(value) for value in by_season})
            candidates.append({"simkl_id": anime_id, "mal_id": (data.get("ids") or {}).get("mal"),
                               "title": data.get("title") or str(anime_id), "mapped_seasons": mapped_seasons,
                               "episodes_by_season": by_season, "ratings": _simkl_scores(data, ("simkl", "mal")),
                               "url": data["_simkl_url"]})
        except Exception as error:
            complete = False
            logger.info("[Ratings] SIMKL season mapping unavailable (%s)", type(error).__name__)
    return candidates, complete and not pending


async def resolve_season_ratings(server_type, item_id, title, parent_metadata, season_number, episode_numbers,
                                 client_id, client, force_refresh=False, cache=None, catalog_cache=None):
    cache = cache if cache is not None else ratings_cache
    mapping = cache.get_season_mapping(server_type, item_id) or {"mode": "auto"}
    expected_choice = (mapping.get("mode", "auto"), mapping.get("simkl_id"))
    cached = cache.get_cached_ratings(server_type, item_id)
    if cached and cached.get("media_type") == "season" and not force_refresh:
        return {source: cached[f"{source}_rating"] for source in ("simkl", "mal") if cached.get(f"{source}_rating") is not None}
    if cache.get_cached_ratings(server_type, item_id, allow_stale=True) is None:
        cache.save_ratings(server_type, item_id, "season", title, None, None, None, {}, source="simkl", ttl_days=-1)
    previous_id = mapping.get("simkl_id")
    mapping.update(parent_item_id=str(parent_metadata.get("id") or ""), season_number=int(season_number),
                   tvdb_id=parent_metadata.get("tvdb_id"), episode_numbers=list(episode_numbers))
    scores = {}
    if mapping["mode"] == "manual" and mapping.get("simkl_id"):
        data = await fetch_simkl_catalog(None, None, client_id, client, "show", anime_id=mapping["simkl_id"])
        if data and data.get("type", "anime") == "anime":
            scores = _simkl_scores(data, ("simkl", "mal"))
            mapping.update(status="manual", mal_id=(data.get("ids") or {}).get("mal"), source_title=data.get("title"))
        else:
            mapping["status"] = "unavailable"
    else:
        key = str(parent_metadata.get("tvdb_id") or "")
        if catalog_cache is not None and key in catalog_cache:
            candidates, complete = catalog_cache[key]
        else:
            candidates, complete = await fetch_simkl_season_candidates(parent_metadata, client_id, client)
            if catalog_cache is not None:
                catalog_cache[key] = (candidates, complete)
        candidates = [{**candidate, "episode_numbers": (candidate.get("episodes_by_season") or {}).get(str(season_number), [])} for candidate in candidates]
        selected, status = select_simkl_season_candidate(candidates, int(season_number), episode_numbers)
        if not complete:
            selected = None
            mapping.update(status="unavailable")
            if candidates:
                mapping["candidates"] = candidates
        else:
            mapping.update(candidates=candidates, status=status, simkl_id=selected["simkl_id"] if selected else None,
                           mal_id=selected.get("mal_id") if selected else None, source_title=selected.get("title") if selected else None)
        if selected:
            scores = selected["ratings"]
    invalidate = previous_id != mapping.get("simkl_id") or mapping["status"] in ("ambiguous", "unmapped", "incomplete")
    if cache.save_season_mapping(server_type, item_id, mapping, invalidate=invalidate, expected_choice=expected_choice) is None:
        return {"_refresh_status": "failed", "_message": "Season mapping changed during lookup; retry with the new selection", "_providers": {}}
    if scores:
        if not cache.save_ratings(server_type, item_id, "season", title, None, None, None, scores, source="simkl"):
            raise RuntimeError("Could not save season ratings to cache")
        outcome, message = "success", "Season ratings resolved"
    else:
        outcome = "failed"
        message = {"ambiguous": "Multiple anime entries cover this season; select one manually",
                   "unmapped": "No one-to-one anime mapping for this season",
                   "incomplete": "Incomplete anime mapping or episode coverage; manual selection required"}.get(mapping["status"], "No fresh season scores returned")
        stale = cache.get_cached_ratings(server_type, item_id, allow_stale=True) or {}
        scores = {source: stale[f"{source}_rating"] for source in ("simkl", "mal") if stale.get(f"{source}_rating") is not None}
    details = {"message": message, "mapping_status": mapping["status"], "simkl_id": mapping.get("simkl_id")}
    cache.record_refresh(server_type, item_id, outcome, details)
    logger.info("[Ratings] %s season %s: %s; %s", server_type, item_id, outcome, json.dumps(details))
    return {**scores, "_refresh_status": outcome, "_message": message, "_providers": {"simkl": {"status": outcome, "message": message}}}


class RatingsProviderRunState:
    """OMDb request guard owned by one ratings refresh or overlay sync run."""

    def __init__(self, failure_threshold=3):
        self.failure_threshold = max(1, int(failure_threshold))
        self._lock = threading.Lock()
        self._mdblist_reason = None
        self._mdblist_failures = 0
        self._mdblist_requests = 0
        self._mdblist_skipped = 0
        self._reason = None
        self._failures = 0
        self._requests = 0
        self._skipped = 0

    def begin_mdblist_request(self):
        with self._lock:
            if self._mdblist_reason:
                self._mdblist_skipped += 1
                return self._mdblist_reason
            self._mdblist_requests += 1
        return None

    def mdblist_matrix_lock(self, tmdb_id):
        with self._lock:
            if not hasattr(self, "_mdblist_matrix_locks"):
                self._mdblist_matrix_locks = {}
            key = str(tmdb_id)
            if key not in self._mdblist_matrix_locks:
                self._mdblist_matrix_locks[key] = asyncio.Lock()
            return self._mdblist_matrix_locks[key]

    def observe_mdblist(self, outcome):
        blocked_reason = None
        with self._lock:
            if self._mdblist_reason:
                return
            error_code = outcome.get("error_code")
            if error_code in ("quota", "rate_limit") or outcome.get("http_status") == 429:
                blocked_reason = outcome.get("message") or "MDBList request limit reached"
            elif outcome.get("status") == "failed" and (
                error_code == "server_error" or int(outcome.get("http_status") or 0) >= 500
            ):
                self._mdblist_failures += 1
                if self._mdblist_failures >= self.failure_threshold:
                    blocked_reason = f"{self._mdblist_failures} consecutive MDBList server errors"
            elif outcome.get("status") != "skipped":
                self._mdblist_failures = 0
            if blocked_reason:
                self._mdblist_reason = blocked_reason
        if blocked_reason:
            logger.warning("[Ratings] MDBList disabled for the remainder of this run: %s", blocked_reason)

    def begin_omdb_request(self):
        with self._lock:
            if self._reason:
                self._skipped += 1
                return self._reason
            self._requests += 1
        return None

    def observe_omdb(self, outcome):
        blocked_reason = None
        with self._lock:
            if self._reason:
                return
            error_code = outcome.get("error_code")
            if error_code in ("quota", "auth", "rate_limit") or outcome.get("http_status") == 429:
                blocked_reason = outcome.get("message") or "Provider request limit reached"
            elif outcome.get("status") == "failed" and error_code != "not_found":
                self._failures += 1
                if self._failures >= self.failure_threshold:
                    blocked_reason = f"{self._failures} consecutive provider failures ({outcome.get('message') or 'Unknown provider failure'})"
            else:
                self._failures = 0
            if blocked_reason:
                self._reason = blocked_reason
        if blocked_reason:
            logger.warning("[Ratings] OMDb disabled for the remainder of this run: %s", blocked_reason)

    def snapshot(self):
        with self._lock:
            return {"suppressed": bool(self._reason), "reason": self._reason,
                    "requests": self._requests, "skipped": self._skipped,
                    "consecutive_failures": self._failures,
                    "mdblist": {"suppressed": bool(self._mdblist_reason), "reason": self._mdblist_reason,
                                "requests": self._mdblist_requests, "skipped": self._mdblist_skipped,
                                "consecutive_failures": self._mdblist_failures}}


async def fetch_omdb_ratings(
    imdb_id: str,
    api_key: str,
    client: httpx.AsyncClient,
    outcomes: Optional[Dict[str, Any]] = None,
    provider_run_state: Optional[RatingsProviderRunState] = None,
) -> Dict[str, Any]:
    """
    Fetch IMDb, Rotten Tomatoes, and Metascore ratings from OMDb API.
    Optional integration enabled only when user provides an OMDb API Key.
    """
    if not api_key or not imdb_id:
        return {}

    url = "https://www.omdbapi.com/"
    ratings = {}
    outcomes = outcomes if outcomes is not None else {}
    if provider_run_state is not None:
        reason = provider_run_state.begin_omdb_request()
        if reason:
            outcomes["omdb"] = {"status": "skipped", "error_code": "run_suppressed",
                                "message": f"OMDb disabled for this run: {reason}"}
            return {}
    try:
        data = await _fetch_rating_json(client, "omdb", url, outcomes,
                                        params={"apikey": api_key.strip(), "i": imdb_id.strip()}, timeout=6.0)
        if data:
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
    except (TypeError, ValueError, AttributeError):
        outcomes["omdb"] = {"status": "failed", "message": "Invalid rating data"}

    if ratings:
        outcomes["omdb"] = {"status": "success", "scores": sorted(ratings)}

    if provider_run_state is not None:
        provider_run_state.observe_omdb(outcomes.get("omdb") or {})
    return ratings


# ==============================================================================
# UNIFIED RESOLUTION FUNCTION
# ==============================================================================

def normalize_provider_ratings(ratings: Dict[str, Any]) -> Dict[str, Optional[float]]:
    normalized = {}
    for source in ("imdb", "tmdb", "rt_critic", "rt_audience", "trakt", "metacritic", "letterboxd", "simkl", "mal", "mdblist_episode"):
        value = ratings.get(source)
        try:
            value = float(value) if value is not None else None
            if value is not None:
                if source in ("rt_critic", "rt_audience", "metacritic"):
                    value /= 10
                elif source == "letterboxd":
                    value *= 2
                if not 0 < value <= 10:
                    value = None
        except (TypeError, ValueError):
            value = None
        normalized[source] = value
    return normalized


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
    server_critic_rating: Optional[float] = None,
    season_number: Optional[int] = None,
    episode_number: Optional[int] = None,
    simkl_client_id: Optional[str] = None,
    tvdb_id: Optional[str] = None,
    provider_run_state: Optional[RatingsProviderRunState] = None,
    rating_context: Optional[Dict[str, Any]] = None,
    reuse_partial_cache: bool = False,
) -> Dict[str, Any]:
    """
    Unified ratings resolver with multi-source fallback and SQLite caching.
    Returns dictionary with available scores (imdb, tmdb, rt_critic, rt_audience, trakt, metacritic, letterboxd).
    """
    # 1. Cache lookup
    if not force_refresh:
        cached = ratings_cache.get_cached_ratings(server_type, item_id)
        missing_simkl_selection = cached and not reuse_partial_cache and simkl_client_id and media_type != "episode" and any(
            source in (enabled_sources or []) and cached.get(f"{source}_rating") is None for source in ("simkl", "mal")
        )
        requested_episode_sources = enabled_sources or ["imdb", "tmdb", "tomatoes", "tomatoesaudience"]
        missing_episode_selection = cached and not reuse_partial_cache and media_type == "episode" and any(
            source in requested_episode_sources and cached.get(column) is None
            for source, column in EPISODE_RATING_SOURCE_COLUMNS.items()
        )
        missing_dataset_selection = cached and not reuse_partial_cache and cached.get("imdb_rating") is None and "imdb" in (enabled_sources or ["imdb"]) and imdb_dataset.status()["enabled"]
        if cached and not missing_simkl_selection and not missing_episode_selection and not missing_dataset_selection:
            return {
                "imdb": cached.get("imdb_rating"),
                "tmdb": cached.get("tmdb_rating"),
                "rt_critic": cached.get("rt_critic_rating"),
                "rt_audience": cached.get("rt_audience_rating"),
                "trakt": cached.get("trakt_rating"),
                "metacritic": cached.get("metacritic_rating"),
                "letterboxd": cached.get("letterboxd_rating"),
                "mdblist_episode": cached.get("mdblist_rating"),
                "simkl": cached.get("simkl_rating"),
                "mal": cached.get("mal_rating"),
                "_simkl_url": cached.get("simkl_url"),
                "_source": cached.get("source"),
                "_cached": True
            }

    # Sources requested by user (default to imdb, tmdb, rt_critic, rt_audience)
    if not enabled_sources:
        enabled_sources = ["imdb", "tmdb", "tomatoes", "tomatoesaudience"]

    resolved: Dict[str, Any] = {}
    primary_source = "plex"
    outcomes: Dict[str, Any] = {}

    # 2. Extract native ratings from Plex XML if available
    if plex_xml_bytes:
        plex_ratings = parse_plex_xml_ratings(plex_xml_bytes)
        for k, v in plex_ratings.items():
            if v is not None:
                resolved[k] = v
        outcomes["plex"] = {"status": "success" if resolved else "no_scores", "scores": sorted(resolved)}

    dataset_context = dict(rating_context or {})
    if media_type == "episode":
        dataset_context.update({key: value for key, value in {
            "season_number": season_number, "episode_number": episode_number,
        }.items() if value is not None})
    if media_type == "episode" and plex_xml_bytes:
        root = fromstring(plex_xml_bytes)
        video = root if root.tag == "Video" else root.find(".//Video")
        if video is not None:
            part = video.find(".//Part")
            if video.get("grandparentRatingKey"):
                parent = ratings_cache.get_cached_ratings(server_type, video.get("grandparentRatingKey"), allow_stale=True) or {}
                dataset_context.update({key: value for key, value in {"parent_imdb_id": parent.get("imdb_id"), "series_year": parent.get("year")}.items() if value})
            dataset_context.update({key: value for key, value in {
                "series_title": video.get("grandparentTitle"), "episode_title": video.get("title"),
                "original_title": video.get("originalTitle"), "file_path": part.get("file") if part is not None else None,
                "season_number": video.get("parentIndex"), "episode_number": video.get("index"),
                "released_at": video.get("originallyAvailableAt"),
            }.items() if value is not None})

    season_override = False

    async def local_imdb_rating():
        nonlocal imdb_id, primary_source, season_override
        if "imdb" not in enabled_sources:
            return
        try:
            match = await asyncio.to_thread(imdb_dataset.resolve, server_type, str(item_id), imdb_id, media_type, dataset_context)
            if match.get("status") == "disabled":
                return
            outcomes["imdb_dataset"] = {"status": "success" if match.get("rating") is not None else "unmapped",
                                        "mapping_status": match["status"], "mode": match.get("mode", "auto")}
            if match.get("mode") == "season":
                season_override = True
                imdb_id = match.get("imdb_id")
                resolved.pop("imdb", None)
            if match.get("rating") is not None and (resolved.get("imdb") is None or match.get("mode") in ("manual", "season")):
                imdb_id = match["imdb_id"]
                resolved["imdb"] = match["rating"]
                primary_source = "imdb_dataset"
        except (OSError, sqlite3.Error, ValueError):
            logger.exception("[IMDb Dataset] Local lookup unavailable; using existing providers")
            outcomes["imdb_dataset"] = {"status": "failed", "message": "Local index unavailable"}

    await local_imdb_rating()
    dataset_checked_id = imdb_id

    # 3. If TMDb rating is requested and missing, use TMDb API
    local_client = client or httpx.AsyncClient(timeout=10.0)
    should_close_client = client is None

    try:
        if media_type == "episode" and tmdb_id and tmdb_api_key and season_number is not None and episode_number is not None:
            needs_episode_details = ("tmdb" in enabled_sources and resolved.get("tmdb") is None) or (
                not imdb_id and not season_override and (mdblist_api_key or omdb_api_key or imdb_dataset.status()["enabled"])
                and any(source not in ("tmdb", "mdblist_episode") for source in enabled_sources)
            )
            if needs_episode_details:
                token = str(tmdb_api_key).strip()
                bearer = token.startswith("ey") or len(token) > 40
                details = await _fetch_rating_json(
                    local_client, "tmdb", f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{season_number}/episode/{episode_number}",
                    outcomes, headers={"Authorization": f"Bearer {token}"} if bearer else {},
                    params={"append_to_response": "external_ids", **({} if bearer else {"api_key": token})}, timeout=6.0
                )
                if details:
                    imdb_id = imdb_id or (details.get("external_ids") or {}).get("imdb_id")
                    try:
                        score = float(details.get("vote_average"))
                        if "tmdb" in enabled_sources and 0 < score <= 10 and resolved.get("tmdb") is None:
                            resolved["tmdb"] = round(score, 1)
                            primary_source = "tmdb"
                    except (TypeError, ValueError):
                        pass
                    if imdb_id or resolved.get("tmdb") is not None:
                        outcomes["tmdb"] = {"status": "success", "message": "Episode metadata resolved"}
        elif media_type != "episode" and "tmdb" in enabled_sources and resolved.get("tmdb") is None and tmdb_id and tmdb_api_key:
            tmdb_score = await fetch_tmdb_rating(tmdb_id, tmdb_api_key, local_client, media_type, outcomes=outcomes)
            if tmdb_score is not None:
                resolved["tmdb"] = tmdb_score
                primary_source = "tmdb"

        if imdb_id != dataset_checked_id or season_override:
            await local_imdb_rating()

        # 4. If MDBList API key is provided and needed ratings are still missing (or Trakt/Letterboxd requested)
        source_aliases = {"tomatoes": "rt_critic", "tomatoesaudience": "rt_audience"}
        mdblist_sources = {"imdb", "tmdb", "tomatoes", "tomatoesaudience", "trakt", "letterboxd", "metacritic"}
        needs_external = any(source in mdblist_sources and resolved.get(source_aliases.get(source, source)) is None for source in enabled_sources)
        provider_tmdb_id = None if media_type == "episode" else tmdb_id
        if media_type == "episode" and "mdblist_episode" in enabled_sources and mdblist_api_key:
            mdblist_episode = await fetch_mdblist_episode_rating(
                tmdb_id, season_number, episode_number, mdblist_api_key, local_client,
                outcomes=outcomes, provider_run_state=provider_run_state,
            )
            if mdblist_episode is not None:
                resolved["mdblist_episode"] = mdblist_episode
                primary_source = "mdblist"

        if media_type != "episode" and mdblist_api_key and needs_external and (imdb_id or provider_tmdb_id):
            mdb_res = await fetch_mdblist_ratings(
                imdb_id, provider_tmdb_id, mdblist_api_key, local_client, media_type,
                outcomes=outcomes, provider_run_state=provider_run_state,
            )
            for k, v in mdb_res.items():
                if v is not None and resolved.get(k) is None:
                    resolved[k] = v
            if mdb_res:
                primary_source = "mdblist"

        if simkl_client_id and media_type != "episode" and any(source in enabled_sources and resolved.get(source) is None for source in ("imdb", "simkl", "mal")):
            simkl_result = await fetch_simkl_ratings(imdb_id, tmdb_id, simkl_client_id, local_client, media_type, outcomes, tvdb_id)
            for source, value in simkl_result.items():
                if resolved.get(source) is None:
                    resolved[source] = value
            if simkl_result:
                primary_source = "simkl"

        # 5. Query OMDb only for selected scores that it can supply.
        omdb_sources = {"imdb": "imdb", "tomatoes": "rt_critic", "metacritic": "metacritic"}
        needs_omdb = any(source in enabled_sources and resolved.get(key) is None for source, key in omdb_sources.items())
        if omdb_api_key and needs_omdb and imdb_id:
            omdb_res = await fetch_omdb_ratings(imdb_id, omdb_api_key, local_client, outcomes=outcomes, provider_run_state=provider_run_state)
            for k, v in omdb_res.items():
                if v is not None and resolved.get(k) is None:
                    resolved[k] = v
            if omdb_res:
                primary_source = "omdb"

        # 6. Fallback to server's native community/critic ratings (Emby/Jellyfin/Plex) if available and still missing
        if server_community_rating is not None and media_type != "episode":
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

        if server_critic_rating is not None and media_type != "episode":
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

    has_provider_failures = any(outcome["status"] in ("failed", "no_scores", "skipped") for outcome in outcomes.values())
    refresh_status = ("partial" if has_provider_failures else "success") if resolved else "failed"
    if resolved:
        saved = ratings_cache.save_ratings(
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
        if not saved:
            raise RuntimeError("Could not save fresh ratings to cache")
    elif media_type == "episode" and "imdb" in enabled_sources and imdb_dataset.status()["enabled"]:
        ratings_cache.ensure_unmapped_episode(server_type, item_id, title, year, imdb_id)
    ratings_cache.record_refresh(server_type, str(item_id), refresh_status, {
        "scores": sorted(resolved),
        "providers": outcomes,
        "message": "Fresh scores received" if resolved else "No fresh scores returned; cached scores and expiry preserved",
    })
    logger.info("[Ratings] %s %s refresh %s; providers=%s", server_type, item_id, refresh_status, json.dumps(outcomes, sort_keys=True))

    has_fresh_scores = bool(resolved)
    cached_scores = ratings_cache.get_cached_ratings(server_type, str(item_id), allow_stale=True) or {}
    cached_sources = []
    for key, column in (
        ("imdb", "imdb_rating"), ("tmdb", "tmdb_rating"), ("rt_critic", "rt_critic_rating"),
        ("rt_audience", "rt_audience_rating"), ("trakt", "trakt_rating"),
        ("metacritic", "metacritic_rating"), ("letterboxd", "letterboxd_rating"),
        ("simkl", "simkl_rating"), ("mal", "mal_rating"),
    ):
        if key == "imdb" and season_override and (not imdb_id or cached_scores.get("imdb_id") != imdb_id):
            continue
        if resolved.get(key) is None and cached_scores.get(column) is not None:
            resolved[key] = cached_scores[column]
            cached_sources.append(key)
    if cached_sources:
        resolved["_cached_sources"] = cached_sources
        if not resolved.get("_simkl_url") and cached_scores.get("simkl_url"):
            resolved["_simkl_url"] = cached_scores["simkl_url"]
    if not has_fresh_scores:
        resolved["_stale"] = bool(cached_sources)

    resolved["_source"] = primary_source
    resolved["_cached"] = False
    resolved["_refresh_status"] = refresh_status
    resolved["_providers"] = outcomes
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

