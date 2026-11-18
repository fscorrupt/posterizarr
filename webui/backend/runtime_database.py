"""
Database module for runtime statistics tracking
"""

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional
import logging
import os
import threading  # Import threading
import re

logger = logging.getLogger(__name__)

# Determine base directory based on environment
IS_DOCKER = os.getenv("POSTERIZARR_NON_ROOT") == "TRUE"
if IS_DOCKER:
    BASE_DIR = Path("/config")
else:
    # Local: webui/backend/runtime_database.py -> project root (2 levels up)
    BASE_DIR = Path(__file__).parent.parent.parent

# Database path in the database folder
DATABASE_DIR = BASE_DIR / "database"
DB_PATH = DATABASE_DIR / "runtime_stats.db"


class RuntimeDatabase:
    """Database handler for runtime statistics"""

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        # REMOVED: self.connection
        self.lock = threading.RLock()  # Thread-safety lock
        self.init_database()

    def _get_connection(self):
        """Helper to create a new, thread-safe connection"""
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def init_database(self):
        """Initialize the database and create tables if they don't exist"""
        logger.info("=" * 60)
        logger.info("INITIALIZING RUNTIME DATABASE")
        logger.debug(f"Database path: {self.db_path}")

        try:
            is_new_database = not self.db_path.exists()
            logger.debug(f"Is new database: {is_new_database}")

            self.db_path.parent.mkdir(parents=True, exist_ok=True)

            with self.lock:
                conn = self._get_connection()
                cursor = conn.cursor()

                # Create runtime_stats table
                logger.debug("Creating runtime_stats table if not exists...")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS runtime_stats (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp TEXT NOT NULL,
                        mode TEXT,
                        runtime_seconds INTEGER,
                        runtime_formatted TEXT,
                        total_images INTEGER DEFAULT 0,
                        posters INTEGER DEFAULT 0,
                        seasons INTEGER DEFAULT 0,
                        backgrounds INTEGER DEFAULT 0,
                        titlecards INTEGER DEFAULT 0,
                        collections INTEGER DEFAULT 0,
                        errors INTEGER DEFAULT 0,
                        fallbacks INTEGER DEFAULT 0,
                        tba_skipped INTEGER DEFAULT 0,
                        jap_chines_skipped INTEGER DEFAULT 0,
                        notification_sent INTEGER DEFAULT 0,
                        uptime_kuma INTEGER DEFAULT 0,
                        images_cleared INTEGER DEFAULT 0,
                        folders_cleared INTEGER DEFAULT 0,
                        space_saved TEXT,
                        script_version TEXT,
                        im_version TEXT,
                        start_time TEXT,
                        end_time TEXT,
                        log_file TEXT,
                        status TEXT DEFAULT 'completed',
                        notes TEXT,
                        textless INTEGER DEFAULT 0,
                        truncated INTEGER DEFAULT 0,
                        text INTEGER DEFAULT 0
                    )
                """
                )

                # Add migration for new columns
                logger.debug("Checking for column migrations...")
                try:
                    cursor.execute("PRAGMA table_info(runtime_stats)")
                    existing_columns = [row["name"] for row in cursor.fetchall()]
                    logger.debug(f"Existing columns: {len(existing_columns)}")

                    new_columns = {
                        "collections": "INTEGER DEFAULT 0",
                        "tba_skipped": "INTEGER DEFAULT 0",
                        "jap_chines_skipped": "INTEGER DEFAULT 0",
                        "notification_sent": "INTEGER DEFAULT 0",
                        "uptime_kuma": "INTEGER DEFAULT 0",
                        "images_cleared": "INTEGER DEFAULT 0",
                        "folders_cleared": "INTEGER DEFAULT 0",
                        "space_saved": "TEXT",
                        "script_version": "TEXT",
                        "im_version": "TEXT",
                        "start_time": "TEXT",
                        "end_time": "TEXT",
                        "fallbacks": "INTEGER DEFAULT 0",
                        "textless": "INTEGER DEFAULT 0",
                        "truncated": "INTEGER DEFAULT 0",
                        "text": "INTEGER DEFAULT 0",
                    }

                    for col_name, col_type in new_columns.items():
                        if col_name not in existing_columns:
                            logger.debug(f"Adding missing column: {col_name}")
                            cursor.execute(
                                f"ALTER TABLE runtime_stats ADD COLUMN {col_name} {col_type}"
                            )
                            logger.info(f"Added column '{col_name}' to runtime_stats table")
                except Exception as e:
                    logger.debug(f"Column migration check: {e}")

                # Create index
                logger.debug("Creating timestamp index if not exists...")
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_timestamp
                    ON runtime_stats(timestamp DESC)
                """
                )

                # Create migration tracking table
                logger.debug("Creating migration_info table if not exists...")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS migration_info (
                        key TEXT PRIMARY KEY,
                        value TEXT,
                        updated_at TEXT
                    )
                """
                )

                conn.commit()
                conn.close()
                logger.debug("Database initialization committed and connection closed")

            if is_new_database:
                logger.info(f"Runtime database created at {self.db_path}")
                self._auto_migrate()
            else:
                logger.info(f"Runtime database initialized at {self.db_path}")
                # Always run migrations on startup
                if not self._is_migrated():
                    logger.info("Migration not yet performed, running auto-migration...")
                    self._auto_migrate()
                else:
                    logger.debug("Migration already completed, skipping")

                # NEW: Run date format migration
                self._migrate_date_formats()
                # END NEW

            logger.info("=" * 60)

        except Exception as e:
            logger.error(f"Error initializing runtime database: {e}")
            logger.exception("Full traceback:")
            raise

    def close(self):
        """Close connection - No longer needed."""
        pass

    def _is_migrated(self) -> bool:
        """Check if migration has already been performed"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT value FROM migration_info WHERE key = 'logs_migrated'"
                )
                result = cursor.fetchone()
                conn.close()
                return result is not None and result["value"] == "true"
            except Exception as e:
                logger.debug(f"Migration check failed: {e}")
                if 'conn' in locals():
                    conn.close()
                return False

    def _migrate_date_formats(self):
        """
        One-time migration to fix 'YYYY-MM-DD HH:MM:SS' and 'DD.MM.YYYY HH:MM:SS'
        formats to the correct ISO 'YYYY-MM-DDTHH:MM:SS' format.
        """
        migration_key = "date_format_v1_migrated"

        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                # Check if this specific migration has already run
                cursor.execute("SELECT value FROM migration_info WHERE key = ?", (migration_key,))
                if cursor.fetchone():
                    logger.debug("Date format migration (v1) already completed.")
                    conn.close()
                    return

                logger.info("--- Starting Runtime Database Date Format Migration ---")
                logger.info("Checking for old date formats (YYYY-MM-DD HH:MM:SS or DD.MM.YYYY HH:MM:SS)...")

                cursor.execute("SELECT id, timestamp, start_time, end_time FROM runtime_stats")
                rows = cursor.fetchall()

                updates_to_make = []  # List of (timestamp, start_time, end_time, id)

                # This is the helper function that was missing its logic
                def reformat_date(date_str: str, row_id: int) -> Optional[str]:
                    if not date_str:
                        return None

                    # Check if it's already in the correct ISO format (with 'T')
                    if 'T' in date_str and re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", date_str):
                        return date_str  # Already correct, no change needed

                    # Try 'DD.MM.YYYY HH:MM:SS'
                    try:
                        dt = datetime.strptime(date_str, '%d.%m.%Y %H:%M:%S')
                        iso_date = dt.isoformat()
                        logger.info(f"  [Row {row_id}] Fixing DD.MM.YYYY: '{date_str}' -> '{iso_date}'")
                        return iso_date
                    except (ValueError, TypeError):
                        pass  # Not this format

                    # Try 'YYYY-MM-DD HH:MM:SS' (with space)
                    try:
                        dt = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S')
                        iso_date = dt.isoformat()
                        logger.info(f"  [Row {row_id}] Fixing YYYY-MM-DD (space): '{date_str}' -> '{iso_date}'")
                        return iso_date
                    except (ValueError, TypeError):
                        pass  # Not this format

                    # Unknown format
                    logger.warning(f"  [Row {row_id}] Skipping unknown or already-fixed date format: '{date_str}'")
                    return date_str # Return original if we can't parse it

                for row in rows:
                    row_id = row['id']
                    ts, start, end = row['timestamp'], row['start_time'], row['end_time']

                    new_ts = reformat_date(ts, row_id)
                    new_start = reformat_date(start, row_id)
                    new_end = reformat_date(end, row_id)

                    # Add to our update list if any changes were made
                    if new_ts != ts or new_start != start or new_end != end:
                        updates_to_make.append((new_ts, new_start, new_end, row_id))

                if updates_to_make:
                    logger.info(f"Found {len(updates_to_make)} rows to update. Applying changes...")
                    cursor.executemany(
                        """
                        UPDATE runtime_stats
                        SET timestamp = ?, start_time = ?, end_time = ?
                        WHERE id = ?
                        """,
                        updates_to_make
                    )
                    conn.commit()
                    logger.info(f"Successfully updated {len(updates_to_make)} rows.")
                else:
                    logger.info("No date format changes needed.")

                # Mark this migration as complete
                cursor.execute(
                    "INSERT OR REPLACE INTO migration_info (key, value, updated_at) VALUES (?, ?, ?)",
                    (migration_key, "true", datetime.now().isoformat()),
                )
                conn.commit()
                conn.close()
                logger.info("--- Date Format Migration Finished ---")

            except Exception as e:
                logger.error(f"Error during date format migration: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()

    def _mark_as_migrated(self, imported_count: int):
        """Mark migration as completed"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO migration_info (key, value, updated_at)
                    VALUES (?, ?, ?)
                """,
                    ("logs_migrated", "true", now_str),
                )
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO migration_info (key, value, updated_at)
                    VALUES (?, ?, ?)
                """,
                    ("migrated_entries", str(imported_count), now_str),
                )
                conn.commit()
                conn.close()
                logger.info(f"Migration marked as completed ({imported_count} entries)")
            except Exception as e:
                logger.error(f"Error marking migration: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()

    def _auto_migrate(self):
        """Automatically migrate runtime data from existing log files and JSON files"""
        try:
            import os
            IS_DOCKER = (
                os.path.exists("/.dockerenv")
                or os.environ.get("DOCKER_ENV", "").lower() == "true"
            )
            if IS_DOCKER:
                BASE_DIR = Path("/config")
            else:
                PROJECT_ROOT = Path(__file__).parent.parent.parent
                BASE_DIR = PROJECT_ROOT
            LOGS_DIR = BASE_DIR / "Logs"

            if not LOGS_DIR.exists():
                logger.info("No Logs directory found, skipping auto-migration")
                self._mark_as_migrated(0)
                return

            logger.info("Starting automatic runtime data migration...")
            imported_count = 0
            skipped_count = 0

            from runtime_parser import parse_runtime_from_json
            json_files = [
                ("normal.json", "normal"), ("manual.json", "manual"), ("testing.json", "testing"),
                ("tautulli.json", "tautulli"), ("arr.json", "arr"), ("syncjelly.json", "syncjelly"),
                ("syncemby.json", "syncemby"), ("backup.json", "backup"), ("scheduled.json", "scheduled"),
            ]

            logger.info("Checking for JSON files...")
            for json_file, mode in json_files:
                json_path = LOGS_DIR / json_file
                if json_path.exists():
                    try:
                        runtime_data = parse_runtime_from_json(json_path, mode)
                        if runtime_data:
                            self.add_runtime_entry(**runtime_data)
                            imported_count += 1
                            logger.info(f"Imported from {json_file}")
                    except Exception as e:
                        logger.debug(f"  [SKIP]  Skipped {json_file}: {e}")
                        skipped_count += 1

            if imported_count == 0:
                logger.info("No JSON files found, checking log files...")
                from runtime_parser import parse_runtime_from_log
                rotated_logs_dir = BASE_DIR / "RotatedLogs"
                log_files_to_check = []
                current_logs = [
                    ("Scriptlog.log", "normal"), ("Testinglog.log", "testing"), ("Manuallog.log", "manual"),
                ]
                for log_file, mode in current_logs:
                    log_path = LOGS_DIR / log_file
                    if log_path.exists():
                        log_files_to_check.append((log_path, mode))
                if rotated_logs_dir.exists():
                    logger.info(f"Checking rotated logs in {rotated_logs_dir}")
                    for rotation_dir in rotated_logs_dir.iterdir():
                        if rotation_dir.is_dir():
                            for log_file, mode in current_logs:
                                log_path = rotation_dir / log_file
                                if log_path.exists():
                                    log_files_to_check.append((log_path, mode))
                for log_path, mode in log_files_to_check:
                    try:
                        runtime_data = parse_runtime_from_log(log_path, mode)
                        if runtime_data:
                            self.add_runtime_entry(**runtime_data)
                            imported_count += 1
                            logger.debug(f"Imported from {log_path.name}")
                        else:
                            skipped_count += 1
                    except Exception as e:
                        logger.debug(f"Skipped {log_path.name}: {e}")
                        skipped_count += 1

            logger.info(
                f"Auto-migration complete: {imported_count} imported, {skipped_count} skipped"
            )
            self._mark_as_migrated(imported_count)
        except Exception as e:
            logger.error(f"Error during auto-migration: {e}")
            self._mark_as_migrated(0)

    def entry_exists(
        self, mode: str, start_time: str = None, end_time: str = None
    ) -> bool:
        """
        Check if a runtime entry already exists based on mode and timestamps
        NOTE: This function is called from within add_runtime_entry, so it shares the lock.
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            if start_time == "": start_time = None
            if end_time == "": end_time = None

            if start_time and end_time:
                cursor.execute(
                    """
                    SELECT COUNT(*) FROM runtime_stats
                    WHERE mode = ? AND start_time = ? AND end_time = ?
                """,
                    (mode, start_time, end_time),
                )
                count = cursor.fetchone()[0]
                conn.close()
                if count > 0:
                    logger.debug(
                        f"Entry already exists: mode={mode}, start={start_time}, end={end_time}"
                    )
                    return True
                logger.debug(
                    f"No match found for timestamps: mode={mode}, start={start_time}, end={end_time}"
                )
                return False

            logger.debug(
                f"No timestamps available for {mode}, using time-based duplicate check"
            )
            cursor.execute(
                """
                SELECT COUNT(*) FROM runtime_stats
                WHERE mode = ?
                AND datetime(timestamp) > datetime('now', '-5 seconds')
            """,
                (mode,),
            )
            count = cursor.fetchone()[0]
            conn.close()

            if count > 0:
                logger.debug(
                    f"Recent entry found for {mode} (within 5s), treating as duplicate"
                )
                return True

            return False
        except Exception as e:
            logger.error(f"Error checking if entry exists: {e}")
            if 'conn' in locals():
                conn.close()
            return False

    def add_runtime_entry(
        self,
        mode: str,
        runtime_seconds: int,
        runtime_formatted: str,
        total_images: int = 0,
        posters: int = 0,
        seasons: int = 0,
        backgrounds: int = 0,
        titlecards: int = 0,
        collections: int = 0,
        errors: int = 0,
        tba_skipped: int = 0,
        jap_chines_skipped: int = 0,
        notification_sent: bool = False,
        uptime_kuma: bool = False,
        images_cleared: int = 0,
        folders_cleared: int = 0,
        space_saved: str = None,
        script_version: str = None,
        im_version: str = None,
        start_time: str = None,
        end_time: str = None,
        log_file: str = None,
        status: str = "completed",
        notes: str = None,
        fallbacks: int = 0,
        textless: int = 0,
        truncated: int = 0,
        text: int = 0,
    ) -> Optional[int]:
        """
        Add a new runtime entry to the database atomically, checking for duplicates.
        """
        with self.lock:
            try:
                # Check for duplicates first, *inside* the lock
                if self.entry_exists(mode, start_time, end_time):
                    logger.info(
                        f"Runtime entry already exists for {mode} mode (start: {start_time}, end: {end_time}), skipping duplicate import"
                    )
                    return None  # Return None to indicate no insertion

                conn = self._get_connection()
                cursor = conn.cursor()

                # START TIMESTAMP FIX
                # Use the 'start_time' (which is now ISO format) as the primary timestamp.
                # If it's missing (e.g., from an old log), use the current time in ISO format.
                timestamp_to_insert = None
                if start_time:
                    timestamp_to_insert = start_time
                else:
                    timestamp_to_insert = datetime.now().isoformat()
                # END TIMESTAMP FIX

                cursor.execute(
                    """
                    INSERT INTO runtime_stats (
                        timestamp, mode, runtime_seconds, runtime_formatted,
                        total_images, posters, seasons, backgrounds, titlecards, collections,
                        errors, tba_skipped, jap_chines_skipped, notification_sent, uptime_kuma,
                        images_cleared, folders_cleared, space_saved, script_version, im_version,
                        start_time, end_time, log_file, status, notes,
                        fallbacks, textless, truncated, text
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        timestamp_to_insert, mode, runtime_seconds, runtime_formatted,
                        total_images, posters, seasons, backgrounds, titlecards, collections,
                        errors, tba_skipped, jap_chines_skipped, 1 if notification_sent else 0, 1 if uptime_kuma else 0,
                        images_cleared, folders_cleared, space_saved, script_version, im_version,
                        start_time, end_time, log_file, status, notes,
                        fallbacks, textless, truncated, text,
                    ),
                )

                entry_id = cursor.lastrowid
                conn.commit()
                conn.close()

                logger.info(
                    f"Added runtime entry #{entry_id}: {mode} - {runtime_formatted}"
                )
                return entry_id
            except Exception as e:
                logger.error(f"Error adding runtime entry: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                raise

    def get_latest_runtime(self) -> Optional[Dict]:
        """Get the most recent runtime entry"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT * FROM runtime_stats
                    ORDER BY timestamp DESC
                    LIMIT 1
                """
                )
                row = cursor.fetchone()
                conn.close()
                if row:
                    return dict(row)
                return None
            except Exception as e:
                logger.error(f"Error getting latest runtime: {e}")
                if 'conn' in locals():
                    conn.close()
                return None

    def get_runtime_by_id(self, run_id: int) -> Optional[Dict]:
        """Get a specific runtime entry by ID"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT * FROM runtime_stats
                    WHERE id = ?
                    LIMIT 1
                """,
                    (run_id,),
                )
                row = cursor.fetchone()
                conn.close()
                if row:
                    return dict(row)
                return None
            except Exception as e:
                logger.error(f"Error getting runtime entry by id {run_id}: {e}")
                if 'conn' in locals():
                    conn.close()
                return None

    def get_runtime_history(
        self, limit: int = 50, offset: int = 0, mode: str = None
    ) -> List[Dict]:
        """Get runtime history with pagination"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                if mode:
                    cursor.execute(
                        """
                        SELECT * FROM runtime_stats
                        WHERE mode = ?
                        ORDER BY timestamp DESC
                        LIMIT ? OFFSET ?
                    """,
                        (mode, limit, offset),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT * FROM runtime_stats
                        ORDER BY timestamp DESC
                        LIMIT ? OFFSET ?
                    """,
                        (limit, offset),
                    )
                rows = cursor.fetchall()
                conn.close()
                return [dict(row) for row in rows]
            except Exception as e:
                logger.error(f"Error getting runtime history: {e}")
                if 'conn' in locals():
                    conn.close()
                return []

    def get_runtime_history_total_count(self, mode: str = None) -> int:
        """Get total count of runtime history entries"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                if mode:
                    cursor.execute(
                        """
                        SELECT COUNT(*) FROM runtime_stats
                        WHERE mode = ?
                    """,
                        (mode,),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT COUNT(*) FROM runtime_stats
                    """
                    )
                total = cursor.fetchone()[0]
                conn.close()
                return total
            except Exception as e:
                logger.error(f"Error getting runtime history total count: {e}")
                if 'conn' in locals():
                    conn.close()
                return 0

    def get_runtime_stats_summary(self, days: int = 30) -> Dict:
        """Get summary statistics for the last N days"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                cutoff_date = datetime.now().replace(
                    hour=0, minute=0, second=0, microsecond=0
                ) - timedelta(days=days - 1)
                cutoff_str = cutoff_date.isoformat()

                cursor.execute("SELECT COUNT(*) FROM runtime_stats WHERE timestamp >= ?", (cutoff_str,))
                total_runs = cursor.fetchone()[0]

                cursor.execute("SELECT SUM(total_images) FROM runtime_stats WHERE timestamp >= ?", (cutoff_str,))
                total_images = cursor.fetchone()[0] or 0

                cursor.execute("SELECT AVG(runtime_seconds) FROM runtime_stats WHERE timestamp >= ? AND runtime_seconds > 0", (cutoff_str,))
                avg_runtime = cursor.fetchone()[0] or 0

                cursor.execute("SELECT SUM(errors) FROM runtime_stats WHERE timestamp >= ?", (cutoff_str,))
                total_errors = cursor.fetchone()[0] or 0

                cursor.execute("SELECT mode, COUNT(*) as count FROM runtime_stats WHERE timestamp >= ? GROUP BY mode", (cutoff_str,))
                mode_counts = {row["mode"]: row["count"] for row in cursor.fetchall()}

                cursor.execute("SELECT * FROM runtime_stats ORDER BY timestamp DESC LIMIT 1")
                latest_row = cursor.fetchone()
                latest_run = None
                if latest_row:
                    latest_run_dict = dict(latest_row)
                    latest_run = {
                        "total_images": latest_run_dict.get("total_images", 0),
                        "posters": latest_run_dict.get("posters", 0),
                        "seasons": latest_run_dict.get("seasons", 0),
                        "backgrounds": latest_run_dict.get("backgrounds", 0),
                        "titlecards": latest_run_dict.get("titlecards", 0),
                        "collections": latest_run_dict.get("collections", 0),
                        "errors": latest_run_dict.get("errors", 0),
                        "fallbacks": latest_run_dict.get("fallbacks", 0),
                        "textless": latest_run_dict.get("textless", 0),
                        "truncated": latest_run_dict.get("truncated", 0),
                        "text": latest_run_dict.get("text", 0),
                        "tba_skipped": latest_run_dict.get("tba_skipped", 0),
                        "jap_chines_skipped": latest_run_dict.get("jap_chines_skipped", 0),
                        "notification_sent": bool(latest_run_dict.get("notification_sent", 0)),
                        "uptime_kuma": bool(latest_run_dict.get("uptime_kuma", 0)),
                        "images_cleared": latest_run_dict.get("images_cleared", 0),
                        "folders_cleared": latest_run_dict.get("folders_cleared", 0),
                        "space_saved": latest_run_dict.get("space_saved"),
                        "script_version": latest_run_dict.get("script_version"),
                        "im_version": latest_run_dict.get("im_version"),
                        "start_time": latest_run_dict.get("start_time"),
                        "end_time": latest_run_dict.get("end_time"),
                        "runtime_formatted": latest_run_dict.get("runtime_formatted"),
                        "mode": latest_run_dict.get("mode"),
                    }

                conn.close()

                summary = {
                    "total_runs": total_runs,
                    "total_images": total_images,
                    "average_runtime_seconds": int(avg_runtime),
                    "average_runtime_formatted": self._format_seconds(int(avg_runtime)),
                    "total_errors": total_errors,
                    "mode_counts": mode_counts,
                    "days": days,
                }
                if latest_run:
                    summary["latest_run"] = latest_run
                return summary
            except Exception as e:
                logger.error(f"Error getting runtime summary: {e}")
                if 'conn' in locals():
                    conn.close()
                return {
                    "total_runs": 0, "total_images": 0, "average_runtime_seconds": 0,
                    "average_runtime_formatted": "0h 0m 0s", "total_errors": 0,
                    "mode_counts": {}, "days": days,
                }

    def delete_old_entries(self, days: int = 90) -> int:
        """Delete entries older than specified days"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cutoff_date = datetime.now() - timedelta(days=days)
                cutoff_str = cutoff_date.isoformat()
                cursor.execute(
                    """
                    DELETE FROM runtime_stats
                    WHERE timestamp < ?
                """,
                    (cutoff_str,),
                )
                deleted_count = cursor.rowcount
                conn.commit()
                conn.close()
                logger.info(f"Deleted {deleted_count} old runtime entries")
                return deleted_count
            except Exception as e:
                logger.error(f"Error deleting old entries: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                return 0

    @staticmethod
    def _format_seconds(seconds: int) -> str:
        """Format seconds to 'Xh:Ym:Zs' format"""
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        secs = seconds % 60
        return f"{hours}h {minutes}m {secs}s"

    def migrate_runtime_format(self) -> int:
        """
        Migrate all runtime_formatted entries to new format (Xh:Ym:Zs)
        Returns the number of updated entries
        """
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT id, runtime_seconds FROM runtime_stats
                    WHERE runtime_seconds IS NOT NULL
                    """
                )
                entries = cursor.fetchall()

                updated_count = 0
                for row in entries:
                    entry_id = row["id"]
                    runtime_seconds = row["runtime_seconds"]
                    new_format = self._format_seconds(runtime_seconds)
                    cursor.execute(
                        """
                        UPDATE runtime_stats
                        SET runtime_formatted = ?
                        WHERE id = ?
                        """,
                        (new_format, entry_id),
                    )
                    updated_count += 1

                conn.commit()
                conn.close()
                logger.info(f"Migrated {updated_count} runtime entries to new format")
                return updated_count
            except Exception as e:
                logger.error(f"Error migrating runtime format: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                return 0

    def get_migration_info(self) -> dict:
        """Get migration info, thread-safe"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT key, value, updated_at FROM migration_info")
                info = {}
                for row in cursor.fetchall():
                    info[row["key"]] = {"value": row["value"], "updated_at": row["updated_at"]}
                conn.close()
                return info
            except Exception as e:
                logger.debug(f"Could not get migration info: {e}")
                if 'conn' in locals():
                    conn.close()
                return {"error": str(e)}

    def get_run_by_id(self, run_id: int) -> Optional[Dict]:
        """Get a specific runtime entry by ID"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM runtime_stats WHERE id = ?", (run_id,))
                row = cursor.fetchone()
                conn.close()
                if row:
                    return dict(row)
                return None
            except Exception as e:
                logger.error(f"Error getting run by ID: {e}")
                if 'conn' in locals():
                    conn.close()
                return None

# Global database instance
runtime_db = RuntimeDatabase()
