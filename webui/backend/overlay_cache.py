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
from contextlib import closing
from functools import lru_cache
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List, Union, Tuple

logger = logging.getLogger("overlay_cache")
_font_digest_lock = threading.RLock()


def _font_stat_signature(path):
    stat = Path(path).stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


@lru_cache(maxsize=256)
def _font_content_digest(path, signature):
    from PIL import ImageFont
    try:
        ImageFont.truetype(path, size=12)
    except (OSError, ValueError):
        return None
    digest = hashlib.sha256()
    with open(path, "rb") as font_file:
        for chunk in iter(lambda: font_file.read(65536), b""):
            digest.update(chunk)
    if _font_stat_signature(path) != signature:
        raise OSError("Font changed while computing its content hash")
    return digest.hexdigest()


def _recipe_layers(layers):
    return [{key: value for key, value in layer.items() if key != "image_element"} for layer in layers]


def _font_digest_candidates(path):
    requested = Path(path)
    yield requested
    from overlay_engine import get_candidate_font_dirs
    for directory in get_candidate_font_dirs():
        candidate = directory / requested.name
        if candidate != requested:
            yield candidate


def _font_recipe_payload(layers):
    payload = _recipe_layers(layers)
    complete = True
    for layer in payload:
        path = layer.get("font_path")
        if not path:
            continue
        for candidate in _font_digest_candidates(path):
            try:
                signature = _font_stat_signature(candidate)
                with _font_digest_lock:
                    digest = _font_content_digest(str(candidate), signature)
                if digest is not None:
                    layer["font_path"] = {"sha256": digest}
                    break
            except OSError:
                continue
        else:
            complete = False
            layer["font_path"] = {"unavailable": str(path)}
    return payload, complete


def compute_layers_recipe_hash(layers):
    payload, _ = _font_recipe_payload(layers)
    return hashlib.md5(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def snapshot_overlay_layers(attr_snapshot, layers):
    try:
        snapshot = json.loads(attr_snapshot or "{}")
    except (TypeError, ValueError):
        snapshot = {}
    if not isinstance(snapshot, dict):
        snapshot = {}
    snapshot["_overlay_layers"] = [
        {key: value for key, value in layer.items() if key != "image_element"}
        for layer in layers
    ]
    return json.dumps(snapshot, sort_keys=True)


def describe_overlay_layer_changes(attr_snapshot, layers, shared_snapshots=None):
    try:
        snapshot = json.loads(attr_snapshot or "{}")
        previous = snapshot.get("_overlay_layers")
        if previous is None and shared_snapshots is not None:
            packed = shared_snapshots.get(snapshot.get("_overlay_layers_ref"))
            if packed is not None:
                previous = json.loads(packed)
    except (AttributeError, TypeError, ValueError):
        previous = None
    if not isinstance(previous, list) or not all(isinstance(layer, dict) for layer in previous):
        return "previous layer details unavailable"
    current = json.loads(snapshot_overlay_layers(None, layers))["_overlay_layers"]
    changes = []
    if len(previous) != len(current):
        changes.append(f"layer count: {len(previous)} -> {len(current)}")
    for index, (before, after) in enumerate(zip(previous, current)):
        name = str(after.get("name") or before.get("name") or index)
        for field in sorted(before.keys() | after.keys()):
            if before.get(field) != after.get(field) or (field in before) != (field in after):
                old_value = json.dumps(before.get(field), ensure_ascii=True)[:120]
                new_value = json.dumps(after.get(field), ensure_ascii=True)[:120]
                changes.append(f"{name}.{field}: {old_value} -> {new_value}")
    if not changes:
        return "layer fields unchanged; fingerprint differs"
    return "; ".join(changes[:4]) + (f"; {len(changes) - 4} more changes" if len(changes) > 4 else "")


def get_overlay_database_stats(database_dir: Path, anime_db_path: Optional[Path] = None) -> Dict[str, Any]:
    databases = []
    for name, db_path in (
        ("Overlay Cache", database_dir / "overlay_cache.db"),
        ("AniMetaFill", anime_db_path or database_dir / "animetafill.db"),
    ):
        entry = {
            "name": name, "filename": db_path.name, "exists": db_path.is_file(),
            "size_bytes": 0, "wal_bytes": 0, "total_records": 0, "tables": [],
        }
        try:
            if entry["exists"]:
                entry["size_bytes"] = db_path.stat().st_size
                wal_path = Path(f"{db_path}-wal")
                entry["wal_bytes"] = wal_path.stat().st_size if wal_path.is_file() else 0
                with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True, timeout=5)) as conn:
                    table_names = [row[0] for row in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
                    )]
                    for table_name in table_names:
                        quoted_name = '"' + table_name.replace('"', '""') + '"'
                        row_count = conn.execute(f"SELECT COUNT(*) FROM {quoted_name}").fetchone()[0]
                        table = {"name": table_name, "records": row_count}
                        if table_name == "dynamic_overlay_cache":
                            for column in ("status", "server_type", "asset_type"):
                                table[column] = dict(conn.execute(
                                    f'SELECT "{column}", COUNT(*) FROM {quoted_name} GROUP BY "{column}"'
                                ))
                        elif table_name == "media_ratings_cache":
                            valid = conn.execute(
                                f"SELECT COUNT(*) FROM {quoted_name} WHERE expires_at > ?",
                                (datetime.utcnow().isoformat(),)
                            ).fetchone()[0]
                            table.update(valid=valid, expired=row_count - valid)
                        elif table_name == "episodes":
                            table["shows"] = conn.execute(f"SELECT COUNT(DISTINCT anime_title) FROM {quoted_name}").fetchone()[0]
                            table["category"] = dict(conn.execute(
                                f"SELECT category, COUNT(*) FROM {quoted_name} GROUP BY category"
                            ))
                        entry["tables"].append(table)
                        entry["total_records"] += row_count
        except (sqlite3.Error, OSError) as error:
            entry["error"] = str(error)
        databases.append(entry)
    return {"databases": databases}

def get_overlay_database_entries(
    database_dir: Path,
    database: str,
    table: str,
    page: int = 1,
    limit: int = 50,
    search: str = "",
    sort_by: Optional[str] = None,
    descending: bool = True,
    anime_db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    paths = {
        "overlay_cache.db": database_dir / "overlay_cache.db",
        "animetafill.db": anime_db_path or database_dir / "animetafill.db",
    }
    if database not in paths:
        raise ValueError("Unknown overlay database")
    db_path = paths[database]
    page = max(1, int(page))
    limit = max(1, min(200, int(limit)))
    result = {"database": database, "table": table, "page": page, "limit": limit,
              "exists": db_path.is_file(), "columns": [], "entries": [], "total": 0, "total_pages": 0}
    if not result["exists"]:
        return result
    with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True, timeout=5)) as conn:
        conn.row_factory = sqlite3.Row
        tables = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )}
        if table not in tables:
            raise ValueError("Unknown overlay database table")
        quoted_table = '"' + table.replace('"', '""') + '"'
        schema = list(conn.execute(f"PRAGMA table_info({quoted_table})"))
        columns = [column["name"] for column in schema]
        result["columns"] = columns
        if sort_by and sort_by not in columns:
            raise ValueError("Unknown sort column")
        order_column = sort_by or next((column["name"] for column in schema if column["pk"]), columns[0])
        quote = lambda name: '"' + name.replace('"', '""') + '"'
        parameters = []
        where = ""
        if search:
            pattern = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            where = " WHERE " + " OR ".join(f"CAST({quote(column)} AS TEXT) LIKE ? ESCAPE '\\'" for column in columns)
            parameters = [pattern] * len(columns)
        result["total"] = conn.execute(f"SELECT COUNT(*) FROM {quoted_table}{where}", parameters).fetchone()[0]
        result["total_pages"] = (result["total"] + limit - 1) // limit
        result["page"] = min(page, max(1, result["total_pages"]))
        order_columns = [order_column] + [column for column in columns if column != order_column and any(field["name"] == column and field["pk"] for field in schema)]
        order = ", ".join(f"{quote(column)} {'DESC' if descending else 'ASC'}" for column in order_columns)
        rows = conn.execute(
            f"SELECT * FROM {quoted_table}{where} ORDER BY {order} LIMIT ? OFFSET ?",
            [*parameters, limit, (result["page"] - 1) * limit],
        )
        result["entries"] = [dict(row) for row in rows]
    return result

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
        self._layer_snapshots = {}
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        if self._init_db():
            self.compact_storage()

    def _compact_attr_snapshot(self, attr_snapshot, connection=None):
        try:
            snapshot = json.loads(attr_snapshot or "{}")
        except (TypeError, ValueError):
            return attr_snapshot
        if not isinstance(snapshot, dict):
            return attr_snapshot
        layers = snapshot.pop("_overlay_layers", None)
        if isinstance(layers, list):
            packed = json.dumps(layers, sort_keys=True, separators=(",", ":"))
            digest = hashlib.sha256(packed.encode("utf-8")).hexdigest()
            with self.lock:
                if digest not in self._layer_snapshots:
                    if connection is not None:
                        connection.execute("INSERT OR IGNORE INTO overlay_layer_snapshots VALUES (?, ?)", (digest, packed))
                    else:
                        with closing(self._get_connection()) as writer:
                            with writer:
                                writer.execute("INSERT OR IGNORE INTO overlay_layer_snapshots VALUES (?, ?)", (digest, packed))
                    self._layer_snapshots[digest] = packed
            snapshot["_overlay_layers_ref"] = digest
        return json.dumps(snapshot, sort_keys=True, separators=(",", ":"))

    def get_recipe_layers(self, entry):
        try:
            snapshot = json.loads((entry or {}).get("attr_snapshot") or "{}")
            if isinstance(snapshot.get("_overlay_layers"), list):
                return snapshot["_overlay_layers"]
            packed = self._layer_snapshots.get(snapshot.get("_overlay_layers_ref"))
            return json.loads(packed) if packed is not None else None
        except (AttributeError, TypeError, ValueError):
            return None

    def prune_recipe_snapshots(self):
        with self.lock:
            with closing(self._get_connection()) as connection:
                with connection:
                    connection.execute(
                        "DELETE FROM overlay_layer_snapshots WHERE digest NOT IN ("
                        "SELECT json_extract(attr_snapshot, '$._overlay_layers_ref') FROM dynamic_overlay_cache "
                        "WHERE json_valid(attr_snapshot) AND json_type(attr_snapshot, '$._overlay_layers_ref') = 'text')"
                    )
                self._layer_snapshots = dict(connection.execute("SELECT digest, layers_json FROM overlay_layer_snapshots"))

    def compact_storage(self):
        with self.lock:
            try:
                with closing(self._get_connection()) as connection:
                    connection.execute("PRAGMA wal_checkpoint(PASSIVE)")
                    connection.execute("VACUUM")
                    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                return True
            except sqlite3.Error as error:
                logger.info("[OverlayCache] Storage compaction deferred: %s", error)
                return False

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
            conn = None
            try:
                migrated = 0
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
                            media_file_path TEXT,
                            detected_video_source TEXT,
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
                        "attr_snapshot": "TEXT",
                        "media_file_path": "TEXT",
                        "detected_video_source": "TEXT"
                    }
                    for col, col_type in new_cols.items():
                        if col not in existing_cols:
                            conn.execute(f"ALTER TABLE dynamic_overlay_cache ADD COLUMN {col} {col_type};")
                            logger.info(f"[OverlayCache] Migrated dynamic_overlay_cache schema: added column {col}")

                    conn.execute("CREATE TABLE IF NOT EXISTS overlay_layer_snapshots (digest TEXT PRIMARY KEY, layers_json TEXT NOT NULL) WITHOUT ROWID")
                    self._layer_snapshots.update(dict(conn.execute("SELECT digest, layers_json FROM overlay_layer_snapshots")))
                    last_id = -1
                    while True:
                        legacy = conn.execute(
                            "SELECT id, attr_snapshot FROM dynamic_overlay_cache "
                            "WHERE id > ? AND instr(attr_snapshot, '\"_overlay_layers\"') > 0 ORDER BY id LIMIT 256",
                            (last_id,)
                        ).fetchall()
                        if not legacy:
                            break
                        for row in legacy:
                            compact = self._compact_attr_snapshot(row["attr_snapshot"], conn)
                            if compact != row["attr_snapshot"]:
                                conn.execute("UPDATE dynamic_overlay_cache SET attr_snapshot = ? WHERE id = ?", (compact, row["id"]))
                                migrated += 1
                        last_id = legacy[-1]["id"]

                conn.close()
                if migrated:
                    logger.info("[OverlayCache] Deduplicated layer diagnostics for %s cached items", migrated)
                return migrated
            except Exception as e:
                logger.error(f"[OverlayCache] Failed to initialize database at {self.db_path}: {e}")
            finally:
                if conn is not None:
                    conn.close()

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
        item_meta: Optional[Dict[str, Any]] = None,
        resolved_layers: Optional[List[Dict[str, Any]]] = None
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
        migrate_font_recipe = False
        font_migration_issue = None
        if cached_recipe_hash != overlay_recipe_hash and resolved_layers is not None:
            legacy_hash = hashlib.md5(json.dumps(_recipe_layers(resolved_layers), sort_keys=True).encode()).hexdigest()
            previous_layers = resolved_layers if cached_recipe_hash == legacy_hash else self.get_recipe_layers(entry)
            if previous_layers is not None:
                previous_hash = hashlib.md5(json.dumps(_recipe_layers(previous_layers), sort_keys=True).encode()).hexdigest()
            else:
                previous_hash = None
            if cached_recipe_hash == previous_hash:
                payload, complete = _font_recipe_payload(resolved_layers)
                previous_payload, previous_complete = _font_recipe_payload(previous_layers)
                content_hash = hashlib.md5(json.dumps(payload, sort_keys=True).encode()).hexdigest()
                migrate_font_recipe = complete and previous_complete and payload == previous_payload and content_hash == overlay_recipe_hash
                if not complete or not previous_complete:
                    font_migration_issue = "font identity could not be resolved to a valid local font; migration deferred"
                elif content_hash != overlay_recipe_hash:
                    font_migration_issue = "font identity changed during recipe evaluation; migration deferred"

        if is_cached_empty and is_current_empty:
            pass  # Both indicate that no overlay rules apply
        elif cached_recipe_hash != overlay_recipe_hash and not migrate_font_recipe:
            details = f"; {describe_overlay_layer_changes(entry.get('attr_snapshot'), resolved_layers, self._layer_snapshots)}" if resolved_layers is not None else ""
            if font_migration_issue:
                details += f"; {font_migration_issue}"
            diff_reasons.append(f"Resolved overlay layers changed ({cached_recipe_hash[:8]} -> {overlay_recipe_hash[:8]}{details})")

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

        if migrate_font_recipe:
            self._migrate_font_recipe(server_type, item_id, asset_type, entry, overlay_recipe_hash, resolved_layers)
        return True, "Up-to-date"

    def _migrate_font_recipe(self, server_type, item_id, asset_type, entry, recipe_hash, layers):
        with self.lock:
            with closing(self._get_connection()) as connection:
                with connection:
                    snapshot = self._compact_attr_snapshot(snapshot_overlay_layers(entry.get("attr_snapshot"), layers), connection=connection)
                    cursor = connection.execute(
                        "UPDATE dynamic_overlay_cache SET overlay_recipe_hash = ?, attr_snapshot = ? "
                        "WHERE server_type = ? AND item_id = ? AND asset_type = ? AND overlay_recipe_hash = ?",
                        (recipe_hash, snapshot, server_type.lower(), str(item_id), asset_type.lower(), entry["overlay_recipe_hash"]),
                    )
                    if cursor.rowcount != 1:
                        raise RuntimeError("Overlay cache changed during font recipe migration; retry the item")
            entry.update({"overlay_recipe_hash": recipe_hash, "attr_snapshot": snapshot})

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
    def seed_recipe_snapshot(self, server_type, item_id, asset_type, recipe_hash, layers, cached_entry, cache_map=None):
        if not cached_entry or cached_entry.get("overlay_recipe_hash") != recipe_hash:
            return False
        try:
            snapshot = json.loads(cached_entry.get("attr_snapshot") or "{}")
        except (TypeError, ValueError):
            snapshot = {}
        if isinstance(snapshot, dict) and (isinstance(snapshot.get("_overlay_layers"), list) or snapshot.get("_overlay_layers_ref") in self._layer_snapshots):
            return True
        return self.update_attr_snapshot(
            server_type, item_id, asset_type,
            snapshot_overlay_layers(cached_entry.get("attr_snapshot"), layers), cache_map=cache_map
        )

    def update_media_file_metadata(self, server_type, item_id, asset_type, media_file_path, detected_video_source, cache_map=None):
        if not media_file_path:
            return True
        key = (server_type.lower(), str(item_id), asset_type.lower())
        values = {"media_file_path": str(media_file_path), "detected_video_source": detected_video_source}
        if cache_map is not None and key in cache_map and all(cache_map[key].get(field) == value for field, value in values.items()):
            return True
        with self.lock:
            try:
                with closing(self._get_connection()) as connection:
                    with connection:
                        cursor = connection.execute(
                            "UPDATE dynamic_overlay_cache SET media_file_path = ?, detected_video_source = ? "
                            "WHERE server_type = ? AND item_id = ? AND asset_type = ?",
                            (*values.values(), *key)
                        )
                        if cursor.rowcount == 0:
                            return False
                if cache_map is not None and key in cache_map:
                    cache_map[key].update(values)
                return True
            except Exception as error:
                logger.error("[OverlayCache] Could not update media file metadata: %s", error)
                return False

    def update_verified_fingerprints(
        self, server_type, item_id, asset_type, clean_asset_hash, overlay_recipe_hash, metadata_hash,
        attr_snapshot, clean_asset_mtime, clean_asset_size, cache_map=None, media_file_path=None, detected_video_source=None,
        server_updated_at=None, detected_languages=None, detected_resolution=None, detected_audio_codec=None,
        detected_video_format=None
    ) -> bool:
        key = (server_type.lower(), str(item_id), asset_type.lower())
        attr_snapshot = self._compact_attr_snapshot(attr_snapshot)
        values = {
            "clean_asset_hash": clean_asset_hash, "overlay_recipe_hash": overlay_recipe_hash,
            "metadata_hash": metadata_hash, "attr_snapshot": attr_snapshot,
            "clean_asset_mtime": clean_asset_mtime, "clean_asset_size": clean_asset_size,
        }
        if media_file_path:
            values.update({"media_file_path": str(media_file_path), "detected_video_source": detected_video_source})
        if server_updated_at is not None:
            values["server_updated_at"] = str(server_updated_at)
        for column, value in (("detected_languages", detected_languages), ("detected_resolution", detected_resolution),
                              ("detected_audio_codec", detected_audio_codec), ("detected_video_format", detected_video_format)):
            if value is not None:
                values[column] = value
        with self.lock:
            try:
                conn = self._get_connection()
                try:
                    with conn:
                        conn.execute(
                            "UPDATE dynamic_overlay_cache SET " + ", ".join(f"{field} = ?" for field in values) + " "
                            "WHERE server_type = ? AND item_id = ? AND asset_type = ?",
                            (*values.values(), *key)
                        )
                finally:
                    conn.close()
                if cache_map is not None and key in cache_map:
                    cache_map[key].update(values)
                return True
            except Exception as error:
                logger.error("[OverlayCache] Could not refresh verified fingerprints: %s", error)
                return False

    def update_attr_snapshot(
        self,
        server_type: str,
        item_id: str,
        asset_type: str,
        attr_snapshot: str,
        cache_map: Optional[Dict[Tuple[str, str, str], Dict[str, Any]]] = None
    ) -> bool:
        """Update attr_snapshot for a cached entry without modifying hashes."""
        if not attr_snapshot:
            return False
        attr_snapshot = self._compact_attr_snapshot(attr_snapshot)
        st_lower = server_type.lower()
        it_str = str(item_id)
        at_lower = asset_type.lower()
        key = (st_lower, it_str, at_lower)
        previous_entry = cache_map.get(key) if cache_map is not None else self.get_entry(server_type, item_id, asset_type)
        try:
            previous = json.loads((previous_entry or {}).get("attr_snapshot") or "{}")
            current = json.loads(attr_snapshot)
            if isinstance(previous, dict) and isinstance(current, dict):
                for field in ("_overlay_layers_ref", "plex_poster_key", "plex_thumb"):
                    if field not in current and field in previous:
                        current[field] = previous[field]
                attr_snapshot = json.dumps(current, sort_keys=True, separators=(",", ":"))
        except (TypeError, ValueError):
            pass

        # Zero-write skip: if memory cache already has this exact snapshot, skip DB write
        if cache_map is not None and key in cache_map:
            cached_val = cache_map[key].get("attr_snapshot")
            if str(cached_val or "") == str(attr_snapshot):
                return True
            cache_map[key]["attr_snapshot"] = str(attr_snapshot)

        with self.lock:
            try:
                conn = self._get_connection()
                with conn:
                    conn.execute(
                        """
                        UPDATE dynamic_overlay_cache
                        SET attr_snapshot = ?
                        WHERE server_type = ? AND item_id = ? AND asset_type = ?
                        """,
                        (str(attr_snapshot), st_lower, it_str, at_lower)
                    )
                conn.close()
                return True
            except Exception as e:
                logger.error(f"[OverlayCache] Error updating attr_snapshot: {e}")
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
        cache_map: Optional[Dict[Tuple[str, str, str], Dict[str, Any]]] = None,
        resolved_layers: Optional[List[Dict[str, Any]]] = None,
        media_file_path: Optional[str] = None,
        detected_video_source: Optional[str] = None
    ) -> bool:
        """Upsert a record marking that dynamic overlays were successfully pushed with full metadata signature."""
        if resolved_layers is not None:
            attr_snapshot = snapshot_overlay_layers(attr_snapshot, resolved_layers)
        if attr_snapshot is not None:
            attr_snapshot = self._compact_attr_snapshot(attr_snapshot)
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
                "media_file_path": str(media_file_path) if media_file_path else (cache_map.get((st_lower, it_str, at_lower)) or {}).get("media_file_path"),
                "detected_video_source": detected_video_source if media_file_path else (cache_map.get((st_lower, it_str, at_lower)) or {}).get("detected_video_source"),
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
                            detected_audio_codec, detected_video_format, detected_resolution, attr_snapshot,
                            media_file_path, detected_video_source
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                            attr_snapshot = COALESCE(excluded.attr_snapshot, dynamic_overlay_cache.attr_snapshot),
                            media_file_path = COALESCE(excluded.media_file_path, dynamic_overlay_cache.media_file_path),
                            detected_video_source = CASE WHEN excluded.media_file_path IS NOT NULL THEN excluded.detected_video_source ELSE dynamic_overlay_cache.detected_video_source END
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
                            attr_snapshot,
                            str(media_file_path) if media_file_path else None,
                            detected_video_source
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
                self.prune_recipe_snapshots()
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

