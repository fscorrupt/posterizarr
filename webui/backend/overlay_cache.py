"""
Dynamic Overlay Cache Manager for Posterizarr
Tracks overlaid artwork uploaded to media servers (Plex, Jellyfin, Emby).
Maintains fingerprints of (clean asset hash + applied overlay recipe) so media is only
re-composited and re-uploaded when actual metadata (ratings, status, resolution) or clean asset files change.

==============================================================================
HONOR & ATTRIBUTION:
This cache architecture supports incremental overlay synchronization inspired by
and compatible with the overlay systems pioneered by the Kometa Project
(formerly Plex Meta Manager), created by meisnate12 & contributors (MIT License).
==============================================================================
"""

import os
import json
import hashlib
import sqlite3
import threading
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List, Union, Tuple

logger = logging.getLogger("overlay_cache")
def compute_metadata_hash(
    languages: Optional[Union[List[str], str]] = None,
    runtime_mins: Optional[int] = None,
    edition: Optional[str] = None,
    status: Optional[str] = None,
    resolution: Optional[str] = None,
    content_rating: Optional[str] = None,
    network: Optional[str] = None,
    multi_ratings: Optional[Dict[str, Any]] = None,
    audio_codec: Optional[str] = None,
    video_format: Optional[str] = None,
    has_hdr: Optional[bool] = None,
    has_dolby_vision: Optional[bool] = None
) -> str:
    """
    Computes a deterministic MD5 hash of all media attributes that influence dynamic overlays.
    Any change in languages (e.g. en -> de,en), cut/runtime (105m -> 135m), edition, show status,
    resolution, audio codec (e.g. truehd -> atmos), or video format (e.g. 1080p -> 4k hdr/dovi)
    produces a different hash, guaranteeing instant cache invalidation.
    """
    if isinstance(languages, str):
        clean_langs = sorted([l.strip().lower() for l in languages.split(",") if l.strip()])
    elif isinstance(languages, list):
        clean_langs = sorted([str(l).strip().lower() for l in languages if str(l).strip()])
    else:
        clean_langs = []

    # Filter out internal/non-rating keys (e.g. '_cached', '_source') from ratings dictionary
    filtered_ratings = {}
    if isinstance(multi_ratings, dict):
        filtered_ratings = {
            str(k): v for k, v in multi_ratings.items()
            if not str(k).startswith("_") and v is not None
        }

    payload = {
        "languages": clean_langs,
        "runtime_mins": int(runtime_mins) if runtime_mins is not None else None,
        "edition": str(edition).strip().lower() if edition else None,
        "status": str(status).strip().lower() if status else None,
        "resolution": str(resolution).strip().lower() if resolution else None,
        "audio_codec": str(audio_codec).strip().lower() if audio_codec else None,
        "video_format": str(video_format).strip().lower() if video_format else None,
        "has_hdr": bool(has_hdr) if has_hdr is not None else None,
        "has_dolby_vision": bool(has_dolby_vision) if has_dolby_vision is not None else None,
        "content_rating": str(content_rating).strip().lower() if content_rating else None,
        "network": str(network).strip().lower() if network else None,
        "ratings": filtered_ratings
    }
    return hashlib.md5(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()



class OverlayCache:
    """Manages SQLite cache for dynamic overlay pushing and verification."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.lock = threading.RLock()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA busy_timeout=30000;")
        except Exception:
            pass
        return conn

    def _init_db(self):
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    conn.execute("""
                        CREATE TABLE IF NOT EXISTS dynamic_overlay_cache (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            server_type TEXT NOT NULL,
                            server_url TEXT,
                            item_id TEXT NOT NULL,
                            media_type TEXT DEFAULT 'movie',
                            asset_type TEXT DEFAULT 'poster',
                            clean_asset_path TEXT,
                            clean_asset_mtime REAL,
                            clean_asset_size INTEGER,
                            clean_asset_hash TEXT,
                            overlay_recipe_hash TEXT NOT NULL,
                            last_pushed_at TEXT,
                            item_title TEXT,
                            library_name TEXT,
                            status TEXT DEFAULT 'synced',
                            server_updated_at TEXT,
                            detected_languages TEXT,
                            runtime_mins INTEGER,
                            edition TEXT,
                            show_status TEXT,
                            metadata_hash TEXT,
                            detected_audio_codec TEXT,
                            detected_video_format TEXT,
                            detected_resolution TEXT,
                            attr_snapshot TEXT,
                            UNIQUE(server_type, item_id, asset_type)
                        );
                    """)
                    conn.execute("""
                        CREATE INDEX IF NOT EXISTS idx_doc_lookup 
                        ON dynamic_overlay_cache(server_type, item_id, asset_type);
                    """)
                    conn.execute("""
                        CREATE INDEX IF NOT EXISTS idx_doc_hashes 
                        ON dynamic_overlay_cache(clean_asset_hash, overlay_recipe_hash);
                    """)

                    # Automated migration for existing databases
                    cursor = conn.cursor()
                    cursor.execute("PRAGMA table_info(dynamic_overlay_cache);")
                    existing_cols = {row[1] for row in cursor.fetchall()}
                    new_cols = {
                        "server_updated_at": "TEXT",
                        "detected_languages": "TEXT",
                        "runtime_mins": "INTEGER",
                        "edition": "TEXT",
                        "show_status": "TEXT",
                        "metadata_hash": "TEXT",
                        "detected_audio_codec": "TEXT",
                        "detected_video_format": "TEXT",
                        "detected_resolution": "TEXT",
                        "attr_snapshot": "TEXT"
                    }
                    for col, col_type in new_cols.items():
                        if col not in existing_cols:
                            conn.execute(f"ALTER TABLE dynamic_overlay_cache ADD COLUMN {col} {col_type};")
                            logger.info(f"[OverlayCache] Migrated dynamic_overlay_cache schema: added column {col}")

                conn.close()
            except Exception as e:
                logger.error(f"[OverlayCache] Failed to initialize database at {self.db_path}: {e}")

    def get_entry(
        self,
        server_type: str,
        item_id: str,
        asset_type: str = "poster"
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a cached entry for a specific media item and asset type."""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT * FROM dynamic_overlay_cache 
                    WHERE server_type = ? AND item_id = ? AND asset_type = ?
                    LIMIT 1
                    """,
                    (server_type.lower(), str(item_id), asset_type.lower())
                )
                row = cursor.fetchone()
                conn.close()
                return dict(row) if row else None
            except Exception as e:
                logger.error(f"[OverlayCache] Error reading entry ({server_type}, {item_id}, {asset_type}): {e}")
                return None

    def load_cache_map(
        self,
        server_type: Optional[str] = None
    ) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
        """
        Load all cached entries into an in-memory dictionary for high-performance bulk operations.
        Keyed by (server_type, str(item_id), asset_type) -> Dict[str, Any].
        Eliminates per-item SQLite query overhead during large library scans.
        """
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                if server_type:
                    cursor.execute(
                        "SELECT * FROM dynamic_overlay_cache WHERE server_type = ?",
                        (server_type.lower(),)
                    )
                else:
                    cursor.execute("SELECT * FROM dynamic_overlay_cache")
                rows = cursor.fetchall()
                conn.close()
                cache_map: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
                for row in rows:
                    d = dict(row)
                    key = (str(d.get("server_type", "")).lower(), str(d.get("item_id", "")), str(d.get("asset_type", "")).lower())
                    cache_map[key] = d
                return cache_map
            except Exception as e:
                logger.error(f"[OverlayCache] Error loading bulk cache map: {e}")
                return {}

    def check_cache_status(
        self,
        server_type: str,
        item_id: str,
        asset_type: str,
        clean_asset_hash: str,
        overlay_recipe_hash: str,
        metadata_hash: Optional[str] = None,
        server_updated_at: Optional[str] = None,
        cached_entry: Optional[Dict[str, Any]] = None,
        item_meta: Optional[Dict[str, Any]] = None
    ) -> tuple:
        """
        Check if the item has already been overlaid and uploaded with the EXACT same
        clean asset image, applied overlay recipe, and media attribute signature.
        Returns a tuple of (is_current: bool, reason: str).
        """
        entry = cached_entry if cached_entry is not None else self.get_entry(server_type, item_id, asset_type)
        if not entry:
            return False, "Not in cache (initial sync)"

        if entry.get("status") not in ("synced", "skipped"):
            st = entry.get("status") or "unknown"
            return False, f"Previous sync status was '{st}'"

        cached_clean_hash = entry.get("clean_asset_hash") or ""
        cached_recipe_hash = entry.get("overlay_recipe_hash") or ""

        diff_reasons = []

        if cached_clean_hash != clean_asset_hash:
            diff_reasons.append("Clean artwork file changed")

        empty_hashes = ("none", "", "d751713988987e9331980363e24189ce")
        is_cached_empty = cached_recipe_hash in empty_hashes
        is_current_empty = overlay_recipe_hash in empty_hashes

        if is_cached_empty and is_current_empty:
            pass  # Both indicate that no overlay rules apply
        elif cached_recipe_hash != overlay_recipe_hash:
            diff_reasons.append("Overlay recipe/rules modified")

        # Metadata signature drift check
        meta_drift = False
        meta_detail = ""
        if metadata_hash and entry.get("metadata_hash"):
            if entry["metadata_hash"] != metadata_hash:
                meta_drift = True
        elif server_updated_at and entry.get("server_updated_at"):
            if str(entry["server_updated_at"]) != str(server_updated_at):
                meta_drift = True
                meta_detail = "server timestamp drifted"

        if meta_drift:
            if item_meta:
                specific_diffs = []
                if item_meta.get("resolution") and entry.get("detected_resolution"):
                    if str(item_meta["resolution"]).strip().lower() != str(entry["detected_resolution"]).strip().lower():
                        specific_diffs.append(f"resolution: {entry['detected_resolution']} -> {item_meta['resolution']}")
                if item_meta.get("audio_codec") and entry.get("detected_audio_codec"):
                    if str(item_meta["audio_codec"]).strip().lower() != str(entry["detected_audio_codec"]).strip().lower():
                        specific_diffs.append(f"audio: {entry['detected_audio_codec']} -> {item_meta['audio_codec']}")
                if item_meta.get("video_format") and entry.get("detected_video_format"):
                    if str(item_meta["video_format"]).strip().lower() != str(entry["detected_video_format"]).strip().lower():
                        specific_diffs.append(f"format: {entry['detected_video_format']} -> {item_meta['video_format']}")
                if item_meta.get("status") and entry.get("show_status"):
                    if str(item_meta["status"]).strip().lower() != str(entry["show_status"]).strip().lower():
                        specific_diffs.append(f"status: {entry['show_status']} -> {item_meta['status']}")
                if item_meta.get("edition") and entry.get("edition"):
                    if str(item_meta["edition"]).strip().lower() != str(entry["edition"]).strip().lower():
                        specific_diffs.append(f"edition: {entry['edition']} -> {item_meta['edition']}")
                if item_meta.get("runtime_mins") and entry.get("runtime_mins"):
                    try:
                        if abs(int(item_meta["runtime_mins"]) - int(entry["runtime_mins"])) > 1:
                            specific_diffs.append(f"runtime: {entry['runtime_mins']}m -> {item_meta['runtime_mins']}m")
                    except (ValueError, TypeError):
                        pass
                if item_meta.get("audio_languages") and entry.get("detected_languages"):
                    c_langs = sorted([l.strip().lower() for l in (entry.get("detected_languages") or "").split(",") if l.strip()])
                    if isinstance(item_meta["audio_languages"], list):
                        i_langs = sorted([str(l).strip().lower() for l in item_meta["audio_languages"] if str(l).strip()])
                    else:
                        i_langs = sorted([l.strip().lower() for l in str(item_meta["audio_languages"]).split(",") if l.strip()])
                    if c_langs != i_langs:
                        specific_diffs.append(f"languages: {c_langs} -> {i_langs}")

                # Compare persisted attribute snapshot (HDR/DV/content rating/network)
                snap_raw = entry.get("attr_snapshot")
                if snap_raw:
                    try:
                        snap = json.loads(snap_raw)
                        for s_key, label in (("has_hdr", "hdr"), ("has_dolby_vision", "dolby vision")):
                            c_v = bool(snap.get(s_key))
                            i_v = bool(item_meta.get(s_key))
                            if c_v != i_v:
                                specific_diffs.append(f"{label}: {c_v} -> {i_v}")
                        for s_key, label in (("content_rating", "content rating"), ("network", "network")):
                            c_v = str(snap.get(s_key) or "").strip().lower()
                            i_v = str(item_meta.get(s_key) or "").strip().lower()
                            if c_v != i_v:
                                specific_diffs.append(f"{label}: {snap.get(s_key)} -> {item_meta.get(s_key)}")
                    except Exception:
                        pass

                if specific_diffs:
                    diff_reasons.append(f"Media metadata changed ({', '.join(specific_diffs)})")
                elif meta_detail:
                    diff_reasons.append(f"Media metadata changed ({meta_detail})")
                else:
                    diff_reasons.append("Media metadata/ratings modified")
            else:
                if meta_detail:
                    diff_reasons.append(f"Media metadata changed ({meta_detail})")
                else:
                    diff_reasons.append("Media metadata/ratings modified")

        if diff_reasons:
            return False, ", ".join(diff_reasons)

        return True, "Up-to-date"

    def is_cached_and_current(
        self,
        server_type: str,
        item_id: str,
        asset_type: str,
        clean_asset_hash: str,
        overlay_recipe_hash: str,
        metadata_hash: Optional[str] = None,
        server_updated_at: Optional[str] = None,
        cached_entry: Optional[Dict[str, Any]] = None,
        item_meta: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Check if the item has already been overlaid and uploaded with the EXACT same
        clean asset image, applied overlay recipe, and media attribute signature.
        If languages, cut/runtime, status, edition, or server timestamp changed, returns False.
        """
        is_current, _ = self.check_cache_status(
            server_type=server_type,
            item_id=item_id,
            asset_type=asset_type,
            clean_asset_hash=clean_asset_hash,
            overlay_recipe_hash=overlay_recipe_hash,
            metadata_hash=metadata_hash,
            server_updated_at=server_updated_at,
            cached_entry=cached_entry,
            item_meta=item_meta
        )
        return is_current

    def update_server_updated_at(
        self,
        server_type: str,
        item_id: str,
        asset_type: str,
        server_updated_at: str,
        cache_map: Optional[Dict[Tuple[str, str, str], Dict[str, Any]]] = None
    ) -> bool:
        """Update server_updated_at timestamp for a cached entry without changing hashes."""
        if not server_updated_at:
            return False
        st_lower = server_type.lower()
        it_str = str(item_id)
        at_lower = asset_type.lower()
        key = (st_lower, it_str, at_lower)

        # Zero-write skip: if memory cache already has this exact server_updated_at, skip DB write!
        if cache_map is not None and key in cache_map:
            cached_val = cache_map[key].get("server_updated_at")
            if str(cached_val or "") == str(server_updated_at):
                return True
            cache_map[key]["server_updated_at"] = str(server_updated_at)

        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    conn.execute(
                        """
                        UPDATE dynamic_overlay_cache
                        SET server_updated_at = ?
                        WHERE server_type = ? AND item_id = ? AND asset_type = ?
                        """,
                        (str(server_updated_at), st_lower, it_str, at_lower)
                    )
                conn.close()
                return True
            except Exception as e:
                logger.error(f"[OverlayCache] Error updating server_updated_at: {e}")
                return False

    def backfill_attributes(
        self,
        server_type: str,
        item_id: str,
        asset_type: str,
        attr_snapshot: str,
        detected_languages: Optional[str] = None,
        runtime_mins: Optional[int] = None,
        edition: Optional[str] = None,
        show_status: Optional[str] = None,
        detected_audio_codec: Optional[str] = None,
        detected_video_format: Optional[str] = None,
        detected_resolution: Optional[str] = None,
        cache_map: Optional[Dict[Tuple[str, str, str], Dict[str, Any]]] = None
    ) -> bool:
        """
        Backfill the attribute snapshot and missing detected_* columns for legacy entries,
        so the fast incremental path can rebuild an identical metadata hash.
        Zero-write if the in-memory snapshot already matches.
        """
        if not attr_snapshot:
            return False
        st_lower = server_type.lower()
        it_str = str(item_id)
        at_lower = asset_type.lower()
        key = (st_lower, it_str, at_lower)
        fills = {
            "detected_languages": detected_languages,
            "runtime_mins": runtime_mins,
            "edition": edition,
            "show_status": show_status,
            "detected_audio_codec": detected_audio_codec,
            "detected_video_format": detected_video_format,
            "detected_resolution": detected_resolution,
        }
        if cache_map is not None and key in cache_map:
            row = cache_map[key]
            if row.get("attr_snapshot") == attr_snapshot:
                return True
            row["attr_snapshot"] = attr_snapshot
            for col, val in fills.items():
                if val is not None and row.get(col) in (None, ""):
                    row[col] = val
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    conn.execute(
                        """
                        UPDATE dynamic_overlay_cache SET
                            attr_snapshot = ?,
                            detected_languages = COALESCE(NULLIF(detected_languages, ''), ?),
                            runtime_mins = COALESCE(runtime_mins, ?),
                            edition = COALESCE(NULLIF(edition, ''), ?),
                            show_status = COALESCE(NULLIF(show_status, ''), ?),
                            detected_audio_codec = COALESCE(NULLIF(detected_audio_codec, ''), ?),
                            detected_video_format = COALESCE(NULLIF(detected_video_format, ''), ?),
                            detected_resolution = COALESCE(NULLIF(detected_resolution, ''), ?)
                        WHERE server_type = ? AND item_id = ? AND asset_type = ?
                        """,
                        (
                            attr_snapshot,
                            detected_languages, runtime_mins, edition, show_status,
                            detected_audio_codec, detected_video_format, detected_resolution,
                            st_lower, it_str, at_lower
                        )
                    )
                conn.close()
                return True
            except Exception as e:
                logger.error(f"[OverlayCache] Error backfilling attributes: {e}")
                return False


    def record_push(
        self,
        server_type: str,
        item_id: str,
        asset_type: str,
        overlay_recipe_hash: str,
        clean_asset_path: Optional[str] = None,
        clean_asset_mtime: Optional[float] = None,
        clean_asset_size: Optional[int] = None,
        clean_asset_hash: Optional[str] = None,
        server_url: Optional[str] = None,
        item_title: str = "",
        library_name: str = "",
        media_type: str = "movie",
        status: str = "synced",
        server_updated_at: Optional[str] = None,
        detected_languages: Optional[str] = None,
        runtime_mins: Optional[int] = None,
        edition: Optional[str] = None,
        show_status: Optional[str] = None,
        metadata_hash: Optional[str] = None,
        detected_audio_codec: Optional[str] = None,
        detected_video_format: Optional[str] = None,
        detected_resolution: Optional[str] = None,
        attr_snapshot: Optional[str] = None,
        cache_map: Optional[Dict[Tuple[str, str, str], Dict[str, Any]]] = None
    ) -> bool:
        """Upsert a record marking that dynamic overlays were successfully pushed with full metadata signature."""
        now_iso = datetime.now().isoformat()
        st_lower = server_type.lower()
        it_str = str(item_id)
        at_lower = asset_type.lower()
        if cache_map is not None:
            cache_map[(st_lower, it_str, at_lower)] = {
                "server_type": st_lower,
                "server_url": server_url or "",
                "item_id": it_str,
                "media_type": media_type,
                "asset_type": at_lower,
                "clean_asset_path": str(clean_asset_path or ""),
                "clean_asset_mtime": float(clean_asset_mtime or 0.0),
                "clean_asset_size": int(clean_asset_size or 0),
                "clean_asset_hash": clean_asset_hash or "",
                "overlay_recipe_hash": overlay_recipe_hash,
                "last_pushed_at": now_iso,
                "item_title": item_title,
                "library_name": library_name,
                "status": status,
                "server_updated_at": str(server_updated_at) if server_updated_at is not None else None,
                "detected_languages": detected_languages,
                "runtime_mins": runtime_mins,
                "edition": edition,
                "show_status": show_status,
                "metadata_hash": metadata_hash,
                "detected_audio_codec": detected_audio_codec,
                "detected_video_format": detected_video_format,
                "detected_resolution": detected_resolution,
                "attr_snapshot": attr_snapshot if attr_snapshot is not None else (cache_map.get((st_lower, it_str, at_lower)) or {}).get("attr_snapshot")
            }
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    conn.execute(
                        """
                        INSERT INTO dynamic_overlay_cache (
                            server_type, server_url, item_id, media_type, asset_type,
                            clean_asset_path, clean_asset_mtime, clean_asset_size, clean_asset_hash,
                            overlay_recipe_hash, last_pushed_at, item_title, library_name, status,
                            server_updated_at, detected_languages, runtime_mins, edition, show_status, metadata_hash,
                            detected_audio_codec, detected_video_format, detected_resolution, attr_snapshot
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(server_type, item_id, asset_type) DO UPDATE SET
                            server_url = excluded.server_url,
                            clean_asset_path = excluded.clean_asset_path,
                            clean_asset_mtime = excluded.clean_asset_mtime,
                            clean_asset_size = excluded.clean_asset_size,
                            clean_asset_hash = excluded.clean_asset_hash,
                            overlay_recipe_hash = excluded.overlay_recipe_hash,
                            last_pushed_at = excluded.last_pushed_at,
                            item_title = excluded.item_title,
                            library_name = excluded.library_name,
                            media_type = excluded.media_type,
                            status = excluded.status,
                            server_updated_at = COALESCE(excluded.server_updated_at, dynamic_overlay_cache.server_updated_at),
                            detected_languages = COALESCE(excluded.detected_languages, dynamic_overlay_cache.detected_languages),
                            runtime_mins = COALESCE(excluded.runtime_mins, dynamic_overlay_cache.runtime_mins),
                            edition = COALESCE(excluded.edition, dynamic_overlay_cache.edition),
                            show_status = COALESCE(excluded.show_status, dynamic_overlay_cache.show_status),
                            metadata_hash = COALESCE(excluded.metadata_hash, dynamic_overlay_cache.metadata_hash),
                            detected_audio_codec = COALESCE(excluded.detected_audio_codec, dynamic_overlay_cache.detected_audio_codec),
                            detected_video_format = COALESCE(excluded.detected_video_format, dynamic_overlay_cache.detected_video_format),
                            detected_resolution = COALESCE(excluded.detected_resolution, dynamic_overlay_cache.detected_resolution),
                            attr_snapshot = COALESCE(excluded.attr_snapshot, dynamic_overlay_cache.attr_snapshot)
                        """,
                        (
                            server_type.lower(),
                            server_url or "",
                            str(item_id),
                            media_type,
                            asset_type.lower(),
                            str(clean_asset_path or ""),
                            float(clean_asset_mtime or 0.0),
                            int(clean_asset_size or 0),
                            clean_asset_hash or "",
                            overlay_recipe_hash,
                            now_iso,
                            item_title,
                            library_name,
                            status,
                            str(server_updated_at) if server_updated_at is not None else None,
                            detected_languages,
                            runtime_mins,
                            edition,
                            show_status,
                            metadata_hash,
                            detected_audio_codec,
                            detected_video_format,
                            detected_resolution,
                            attr_snapshot
                        )
                    )
                conn.close()
                return True
            except Exception as e:
                logger.error(f"[OverlayCache] Error recording push for ({server_type}, {item_id}): {e}")
                return False

    def get_stats(self) -> Dict[str, Any]:
        """Return cache statistics broken down by server type and asset type."""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM dynamic_overlay_cache")
                total = cursor.fetchone()[0]

                cursor.execute("""
                    SELECT server_type, COUNT(*) 
                    FROM dynamic_overlay_cache 
                    GROUP BY server_type
                """)
                by_server = {row[0]: row[1] for row in cursor.fetchall()}

                cursor.execute("""
                    SELECT asset_type, COUNT(*) 
                    FROM dynamic_overlay_cache 
                    GROUP BY asset_type
                """)
                by_asset = {row[0]: row[1] for row in cursor.fetchall()}

                cursor.execute("""
                    SELECT last_pushed_at 
                    FROM dynamic_overlay_cache 
                    ORDER BY id DESC LIMIT 1
                """)
                last_row = cursor.fetchone()
                last_push = last_row[0] if last_row else None

                conn.close()
                return {
                    "total_cached": total,
                    "by_server": by_server,
                    "by_asset": by_asset,
                    "last_pushed_at": last_push
                }
            except Exception as e:
                logger.error(f"[OverlayCache] Error fetching stats: {e}")
                return {"total_cached": 0, "by_server": {}, "by_asset": {}, "last_pushed_at": None}

    def clear_cache(self, server_type: Optional[str] = None) -> int:
        """Clear cache entries, optionally filtered by server type."""
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    if server_type:
                        cursor = conn.execute(
                            "DELETE FROM dynamic_overlay_cache WHERE server_type = ?",
                            (server_type.lower(),)
                        )
                    else:
                        cursor = conn.execute("DELETE FROM dynamic_overlay_cache")
                    deleted = cursor.rowcount
                conn.close()
                return deleted
            except Exception as e:
                logger.error(f"[OverlayCache] Error clearing cache: {e}")
                return 0

    def get_recent_entries(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Return recently cached entries for dashboard reporting."""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT * FROM dynamic_overlay_cache 
                    ORDER BY id DESC LIMIT ?
                    """,
                    (max(1, min(limit, 200)),)
                )
                rows = cursor.fetchall()
                conn.close()
                return [dict(r) for r in rows]
            except Exception as e:
                logger.error(f"[OverlayCache] Error retrieving recent entries: {e}")
                return []

    def get_entries(
        self,
        page: int = 1,
        limit: int = 50,
        search: Optional[str] = None,
        server_type: Optional[str] = None,
        asset_type: Optional[str] = None,
        media_type: Optional[str] = None,
        status: Optional[str] = None,
        sort_by: str = "last_pushed_at",
        sort_desc: bool = True
    ) -> Dict[str, Any]:
        """Paginated retrieval of dynamic overlay cache records with filtering."""
        page = max(1, page)
        limit = max(1, min(limit, 200))
        offset = (page - 1) * limit

        allowed_sort_cols = {
            "last_pushed_at": "last_pushed_at",
            "item_title": "item_title",
            "library_name": "library_name",
            "server_type": "server_type",
            "asset_type": "asset_type",
            "media_type": "media_type",
            "status": "status",
            "id": "id"
        }
        col_sort = allowed_sort_cols.get(sort_by, "id")
        dir_sort = "DESC" if sort_desc else "ASC"

        where_clauses = []
        params = []

        if search and search.strip():
            s = f"%{search.strip()}%"
            where_clauses.append("(item_title LIKE ? OR item_id LIKE ? OR library_name LIKE ? OR clean_asset_path LIKE ?)")
            params.extend([s, s, s, s])

        if server_type and server_type.strip().lower() not in ("all", ""):
            where_clauses.append("server_type = ?")
            params.append(server_type.strip().lower())

        if asset_type and asset_type.strip().lower() not in ("all", ""):
            where_clauses.append("asset_type = ?")
            params.append(asset_type.strip().lower())

        if media_type and media_type.strip().lower() not in ("all", ""):
            where_clauses.append("media_type = ?")
            params.append(media_type.strip().lower())

        if status and status.strip().lower() not in ("all", ""):
            where_clauses.append("status = ?")
            params.append(status.strip().lower())

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        with self.lock:
            try:
                conn = self._get_connection()
                cur = conn.cursor()

                # Get total count
                cur.execute(f"SELECT COUNT(*) FROM dynamic_overlay_cache {where_sql}", tuple(params))
                total = cur.fetchone()[0]

                # Get paginated rows
                query_sql = f"""
                    SELECT * FROM dynamic_overlay_cache
                    {where_sql}
                    ORDER BY {col_sort} {dir_sort}
                    LIMIT ? OFFSET ?
                """
                cur.execute(query_sql, tuple(params + [limit, offset]))
                rows = cur.fetchall()
                entries = [dict(r) for r in rows]

                conn.close()

                total_pages = (total + limit - 1) // limit if total > 0 else 1

                return {
                    "entries": entries,
                    "total": total,
                    "page": page,
                    "limit": limit,
                    "total_pages": total_pages
                }
            except Exception as e:
                logger.error(f"[OverlayCache] Error querying entries: {e}")
                return {"entries": [], "total": 0, "page": page, "limit": limit, "total_pages": 1}

    def delete_entry_by_id(self, entry_id: int) -> bool:
        """Delete a single cached overlay push record by ID."""
        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    cur = conn.execute("DELETE FROM dynamic_overlay_cache WHERE id = ?", (int(entry_id),))
                    deleted = cur.rowcount > 0
                conn.close()
                return deleted
            except Exception as e:
                logger.error(f"[OverlayCache] Error deleting entry {entry_id}: {e}")
                return False

