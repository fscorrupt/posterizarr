"""
Database module for Media Server export data tracking
Handles media library export data (Plex, Jellyfin, Emby) with run history
"""

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional
import logging
import csv
import os
import threading

logger = logging.getLogger(__name__)

# Determine base directory based on environment
IS_DOCKER = os.getenv("POSTERIZARR_NON_ROOT") == "TRUE"
if IS_DOCKER:
    BASE_DIR = Path("/config")
else:
    # Local: webui/backend/media_export_database.py -> project root (2 levels up)
    BASE_DIR = Path(__file__).parent.parent.parent

# Database path in the database folder
DATABASE_DIR = BASE_DIR / "database"
DB_PATH = DATABASE_DIR / "media_export.db"
LOGS_DIR = BASE_DIR / "Logs"


class MediaExportDatabase:
    """Database handler for media server export data"""

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self.lock = threading.RLock()  # Thread-safety lock
        self.init_database()

    def _get_connection(self):
        """Helper to create a new connection"""
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def init_database(self):
        """Initialize the database and create tables if they don't exist"""
        logger.info("=" * 60)
        logger.info("INITIALIZING MEDIA EXPORT DATABASE")
        logger.debug(f"Database path: {self.db_path}")

        try:
            # Ensure database directory exists
            self.db_path.parent.mkdir(parents=True, exist_ok=True)

            with self.lock:
                conn = self._get_connection()
                cursor = conn.cursor()

                # Create plex_library_export table
                logger.debug("Creating plex_library_export table if not exists...")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS plex_library_export (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        run_timestamp TEXT NOT NULL,
                        library_name TEXT,
                        library_type TEXT,
                        library_language TEXT,
                        title TEXT NOT NULL,
                        resolution TEXT,
                        original_title TEXT,
                        season_names TEXT,
                        season_numbers TEXT,
                        season_rating_keys TEXT,
                        year TEXT,
                        tvdbid TEXT,
                        imdbid TEXT,
                        tmdbid TEXT,
                        rating_key TEXT UNIQUE,
                        path TEXT,
                        root_foldername TEXT,
                        extra_folder TEXT,
                        multiple_versions TEXT,
                        plex_poster_url TEXT,
                        plex_background_url TEXT,
                        plex_season_urls TEXT,
                        labels TEXT,
                        created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                        updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime'))
                    )
                """
                )

                # Create plex_episode_export table
                logger.debug("Creating plex_episode_export table if not exists...")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS plex_episode_export (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        run_timestamp TEXT NOT NULL,
                        show_name TEXT NOT NULL,
                        type TEXT,
                        tvdbid TEXT,
                        tmdbid TEXT,
                        library_name TEXT,
                        season_number TEXT,
                        episodes TEXT,
                        title TEXT,
                        rating_keys TEXT,
                        plex_titlecard_urls TEXT,
                        resolutions TEXT,
                        created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                        updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                        UNIQUE(show_name, season_number)
                    )
                """
                )

                # Create other_media_library_export table (Jellyfin/Emby)
                logger.debug("Creating other_media_library_export table if not exists...")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS other_media_library_export (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        run_timestamp TEXT NOT NULL,
                        library_name TEXT,
                        library_type TEXT,
                        library_language TEXT,
                        media_id TEXT UNIQUE,
                        title TEXT NOT NULL,
                        original_title TEXT,
                        year TEXT,
                        resolution TEXT,
                        imdbid TEXT,
                        tmdbid TEXT,
                        tvdbid TEXT,
                        path TEXT,
                        root_foldername TEXT,
                        extra_folder TEXT,
                        other_media_poster_url TEXT,
                        other_media_background_url TEXT,
                        labels TEXT,
                        created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                        updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime'))
                    )
                """
                )

                # Create other_media_episode_export table (Jellyfin/Emby)
                logger.debug("Creating other_media_episode_export table if not exists...")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS other_media_episode_export (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        run_timestamp TEXT NOT NULL,
                        show_name TEXT NOT NULL,
                        type TEXT,
                        tvdbid TEXT,
                        tmdbid TEXT,
                        imdbid TEXT,
                        library_name TEXT,
                        season_number TEXT,
                        episodes TEXT,
                        title TEXT,
                        rating_keys TEXT,
                        other_media_titlecard_urls TEXT,
                        resolutions TEXT,
                        created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                        updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                        UNIQUE(show_name, season_number)
                    )
                """
                )

                # Create index for faster queries
                logger.debug("Creating indexes...")
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_library_run ON plex_library_export(run_timestamp)"
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_library_tmdbid ON plex_library_export(tmdbid)"
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_other_library_run ON other_media_library_export(run_timestamp)"
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_other_library_tmdbid ON other_media_library_export(tmdbid)"
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_episode_run ON plex_episode_export(run_timestamp)"
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_episode_tmdbid ON plex_episode_export(tmdbid)"
                )

                # New Index for library name lookup
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_library_name ON plex_library_export(library_name)"
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_other_library_name ON other_media_library_export(library_name)"
                )

                conn.commit()
                conn.close()

            logger.info("✓ Media export database initialized successfully")

            # Run migration to remove duplicates from old schema
            self._migrate_remove_duplicates()

            logger.info("=" * 60)

        except sqlite3.Error as e:
            logger.error(f"Error initializing database: {e}")
            raise

    def close(self):
        """Close connection - No longer needed as connections are per-function."""
        pass

    def _migrate_remove_duplicates(self):
        """
        Migration: Remove duplicate entries from old schema where UNIQUE was (run_timestamp, rating_key)
        Keep only the most recent entry for each rating_key/media_id
        Also recreate tables with new UNIQUE constraints
        """
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                # Check if migration is needed by looking for a migration marker
                cursor.execute(
                    "CREATE TABLE IF NOT EXISTS migration_info (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)"
                )

                cursor.execute(
                    "SELECT value FROM migration_info WHERE key = 'schema_v2_unique_keys'"
                )
                result = cursor.fetchone()

                if result and result["value"] == "true":
                    logger.debug("Schema v2 migration (unique keys) already completed")
                    conn.close()
                    return

                logger.info(
                    "Running migration: Updating schema to enforce unique rating_keys/media_ids..."
                )

                # Check if old schema exists
                cursor.execute(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='plex_library_export'"
                )
                current_schema_row = cursor.fetchone()
                current_schema = current_schema_row["sql"] if current_schema_row else ""

                if (
                    current_schema
                    and "UNIQUE(run_timestamp, rating_key)" in current_schema
                ):
                    logger.info(
                        "Old schema detected - recreating tables with new constraints..."
                    )

                    # Recreate plex_library_export table
                    logger.debug("Migrating plex_library_export...")
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS plex_library_export_new (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            run_timestamp TEXT NOT NULL,
                            library_name TEXT,
                            library_type TEXT,
                            library_language TEXT,
                            title TEXT NOT NULL,
                            resolution TEXT,
                            original_title TEXT,
                            season_names TEXT,
                            season_numbers TEXT,
                            season_rating_keys TEXT,
                            year TEXT,
                            tvdbid TEXT,
                            imdbid TEXT,
                            tmdbid TEXT,
                            rating_key TEXT UNIQUE,
                            path TEXT,
                            root_foldername TEXT,
                            extra_folder TEXT,
                            multiple_versions TEXT,
                            plex_poster_url TEXT,
                            plex_background_url TEXT,
                            plex_season_urls TEXT,
                            labels TEXT,
                            created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                            updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime'))
                        )
                    """
                    )

                    # Copy data, keeping only most recent entry for each rating_key
                    cursor.execute(
                        """
                        INSERT INTO plex_library_export_new
                        SELECT * FROM (
                            SELECT *, ROW_NUMBER() OVER (PARTITION BY rating_key ORDER BY id DESC) as rn
                            FROM plex_library_export
                        ) WHERE rn = 1
                    """
                    )
                    plex_lib_count = cursor.rowcount

                    cursor.execute("DROP TABLE plex_library_export")
                    cursor.execute(
                        "ALTER TABLE plex_library_export_new RENAME TO plex_library_export"
                    )

                    # Recreate plex_episode_export table
                    logger.debug("Migrating plex_episode_export...")
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS plex_episode_export_new (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            run_timestamp TEXT NOT NULL,
                            show_name TEXT NOT NULL,
                            type TEXT,
                            tvdbid TEXT,
                            tmdbid TEXT,
                            library_name TEXT,
                            season_number TEXT,
                            episodes TEXT,
                            title TEXT,
                            rating_keys TEXT,
                            plex_titlecard_urls TEXT,
                            resolutions TEXT,
                            created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                            updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                            UNIQUE(show_name, season_number)
                        )
                    """
                    )

                    cursor.execute(
                        """
                        INSERT INTO plex_episode_export_new
                        SELECT * FROM (
                            SELECT *, ROW_NUMBER() OVER (PARTITION BY show_name, season_number ORDER BY id DESC) as rn
                            FROM plex_episode_export
                        ) WHERE rn = 1
                    """
                    )
                    plex_ep_count = cursor.rowcount

                    cursor.execute("DROP TABLE plex_episode_export")
                    cursor.execute(
                        "ALTER TABLE plex_episode_export_new RENAME TO plex_episode_export"
                    )

                    # Recreate other_media_library_export table
                    logger.debug("Migrating other_media_library_export...")
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS other_media_library_export_new (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            run_timestamp TEXT NOT NULL,
                            library_name TEXT,
                            library_type TEXT,
                            library_language TEXT,
                            media_id TEXT UNIQUE,
                            title TEXT NOT NULL,
                            original_title TEXT,
                            year TEXT,
                            resolution TEXT,
                            imdbid TEXT,
                            tmdbid TEXT,
                            tvdbid TEXT,
                            path TEXT,
                            root_foldername TEXT,
                            extra_folder TEXT,
                            other_media_poster_url TEXT,
                            other_media_background_url TEXT,
                            labels TEXT,
                            created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                            updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime'))
                        )
                    """
                    )

                    cursor.execute(
                        """
                        INSERT INTO other_media_library_export_new
                        SELECT * FROM (
                            SELECT *, ROW_NUMBER() OVER (PARTITION BY media_id ORDER BY id DESC) as rn
                            FROM other_media_library_export
                        ) WHERE rn = 1
                    """
                    )
                    other_lib_count = cursor.rowcount

                    cursor.execute("DROP TABLE other_media_library_export")
                    cursor.execute(
                        "ALTER TABLE other_media_library_export_new RENAME TO other_media_library_export"
                    )

                    # Recreate other_media_episode_export table
                    logger.debug("Migrating other_media_episode_export...")
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS other_media_episode_export_new (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            run_timestamp TEXT NOT NULL,
                            show_name TEXT NOT NULL,
                            type TEXT,
                            tvdbid TEXT,
                            tmdbid TEXT,
                            imdbid TEXT,
                            library_name TEXT,
                            season_number TEXT,
                            episodes TEXT,
                            title TEXT,
                            rating_keys TEXT,
                            other_media_titlecard_urls TEXT,
                            resolutions TEXT,
                            created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                            updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                            UNIQUE(show_name, season_number)
                        )
                    """
                    )

                    cursor.execute(
                        """
                        INSERT INTO other_media_episode_export_new
                        SELECT * FROM (
                            SELECT *, ROW_NUMBER() OVER (PARTITION BY show_name, season_number ORDER BY id DESC) as rn
                            FROM other_media_episode_export
                        ) WHERE rn = 1
                    """
                    )
                    other_ep_count = cursor.rowcount

                    cursor.execute("DROP TABLE other_media_episode_export")
                    cursor.execute(
                        "ALTER TABLE other_media_episode_export_new RENAME TO other_media_episode_export"
                    )

                    # Recreate indexes
                    cursor.execute(
                        "CREATE INDEX IF NOT EXISTS idx_library_run ON plex_library_export(run_timestamp)"
                    )
                    cursor.execute(
                        "CREATE INDEX IF NOT EXISTS idx_library_tmdbid ON plex_library_export(tmdbid)"
                    )
                    cursor.execute(
                        "CREATE INDEX IF NOT EXISTS idx_other_library_run ON other_media_library_export(run_timestamp)"
                    )
                    cursor.execute(
                        "CREATE INDEX IF NOT EXISTS idx_other_library_tmdbid ON other_media_library_export(tmdbid)"
                    )
                    cursor.execute(
                        "CREATE INDEX IF NOT EXISTS idx_episode_run ON plex_episode_export(run_timestamp)"
                    )
                    cursor.execute(
                        "CREATE INDEX IF NOT EXISTS idx_episode_tmdbid ON plex_episode_export(tmdbid)"
                    )
                    # New Index for library name lookup
                    cursor.execute(
                        "CREATE INDEX IF NOT EXISTS idx_library_name ON plex_library_export(library_name)"
                    )
                    cursor.execute(
                        "CREATE INDEX IF NOT EXISTS idx_other_library_name ON other_media_library_export(library_name)"
                    )

                    logger.info(f"✓ Schema migration complete:")
                    logger.info(f"  - Plex Library: {plex_lib_count} records migrated")
                    logger.info(f"  - Plex Episodes: {plex_ep_count} records migrated")
                    logger.info(
                        f"  - Other Media Library: {other_lib_count} records migrated"
                    )
                    logger.info(
                        f"  - Other Media Episodes: {other_ep_count} records migrated"
                    )

                # Mark migration as complete
                cursor.execute(
                    "INSERT OR REPLACE INTO migration_info (key, value, updated_at) VALUES (?, ?, ?)",
                    ("schema_v2_unique_keys", "true", datetime.now().isoformat()),
                )

                conn.commit()
                conn.close()
                logger.debug("Schema v2 migration marked as complete")

            except Exception as e:
                logger.error(f"Error during schema migration: {e}")
                logger.exception("Full traceback:")
                if 'conn' in locals():
                    try:
                        conn.rollback()
                        conn.close()
                    except Exception as re:
                        logger.error(f"Rollback failed: {re}")
                # Don't raise - let the app continue with whatever schema exists

    def import_library_csv(
        self, csv_path: Path, run_timestamp: Optional[str] = None
    ) -> int:
        """
        Import PlexLibexport.csv into the database

        Args:
            csv_path: Path to PlexLibexport.csv
            run_timestamp: Optional timestamp for this run (default: current time)

        Returns:
            Number of records imported
        """
        if not csv_path.exists():
            logger.error(f"CSV file not found: {csv_path}")
            return 0

        if run_timestamp is None:
            run_timestamp = datetime.now().isoformat()

        logger.info(f"Importing PlexLibexport.csv: {csv_path}")
        logger.debug(f"Run timestamp: {run_timestamp}")

        records_to_insert = []
        try:
            with open(csv_path, "r", encoding="utf-8") as f:
                # Detect delimiter (semicolon or comma)
                sample = f.read(1024)
                f.seek(0)
                delimiter = ";" if ";" in sample else ","

                reader = csv.DictReader(f, delimiter=delimiter)

                for row in reader:
                    try:
                        # Remove quotes from values - handle both string and other types
                        clean_row = {}
                        for k, v in row.items():
                            if isinstance(v, str):
                                clean_row[k] = v.strip('"').strip()
                            else:
                                clean_row[k] = str(v).strip() if v is not None else ""

                        # Skip empty rows (check critical fields)
                        if not clean_row.get("title") and not clean_row.get(
                            "ratingKey"
                        ):
                            logger.debug("Skipping empty row")
                            continue

                        records_to_insert.append((
                            run_timestamp,
                            clean_row.get("Library Name", ""),
                            clean_row.get("Library Type", ""),
                            clean_row.get("Library Language", ""),
                            clean_row.get("title", ""),
                            clean_row.get("Resolution", ""),
                            clean_row.get("originalTitle", ""),
                            clean_row.get("SeasonNames", ""),
                            clean_row.get("SeasonNumbers", ""),
                            clean_row.get("SeasonRatingKeys", ""),
                            clean_row.get("year", ""),
                            clean_row.get("tvdbid", ""),
                            clean_row.get("imdbid", ""),
                            clean_row.get("tmdbid", ""),
                            clean_row.get("ratingKey", ""),
                            clean_row.get("Path", ""),
                            clean_row.get("RootFoldername", ""),
                            clean_row.get("extraFolder", ""),
                            clean_row.get("MultipleVersions", ""),
                            clean_row.get("PlexPosterUrl", ""),
                            clean_row.get("PlexBackgroundUrl", ""),
                            clean_row.get("PlexSeasonUrls", ""),
                            clean_row.get("Labels", ""),
                        ))
                    except Exception as e:
                        logger.warning(f"Error importing row: {e}")
                        continue

            # Batch insert all records in one transaction
            if records_to_insert:
                with self.lock:
                    conn = self._get_connection()
                    cursor = conn.cursor()
                    cursor.executemany(
                        """
                        INSERT OR REPLACE INTO plex_library_export (
                            run_timestamp, library_name, library_type, library_language,
                            title, resolution, original_title, season_names, season_numbers,
                            season_rating_keys, year, tvdbid, imdbid, tmdbid, rating_key,
                            path, root_foldername, extra_folder, multiple_versions,
                            plex_poster_url, plex_background_url, plex_season_urls, labels,
                            updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (datetime('now', 'localtime')))
                        """,
                        records_to_insert
                    )
                    conn.commit()
                    conn.close()

                    imported_count = cursor.rowcount
                    skipped_count = len(records_to_insert) - imported_count

                    logger.info(
                        f"✓ Imported {imported_count} library records (skipped {skipped_count} duplicates)"
                    )
                    return imported_count
            else:
                logger.warning("No valid records found in Plex library CSV.")
                return 0

        except Exception as e:
            logger.error(f"Error importing library CSV: {e}", exc_info=True)
            if 'conn' in locals():
                try:
                    conn.rollback()
                    conn.close()
                except Exception as re:
                    logger.error(f"Rollback failed: {re}")
            return 0 # Return 0 on failure

    def import_episode_csv(
        self, csv_path: Path, run_timestamp: Optional[str] = None
    ) -> int:
        """
        Import PlexEpisodeExport.csv into the database

        Args:
            csv_path: Path to PlexEpisodeExport.csv
            run_timestamp: Optional timestamp for this run (default: current time)

        Returns:
            Number of records imported
        """
        if not csv_path.exists():
            logger.error(f"CSV file not found: {csv_path}")
            return 0

        if run_timestamp is None:
            run_timestamp = datetime.now().isoformat()

        logger.info(f"Importing PlexEpisodeExport.csv: {csv_path}")
        logger.debug(f"Run timestamp: {run_timestamp}")

        records_to_insert = []
        try:
            with open(csv_path, "r", encoding="utf-8") as f:
                # Detect delimiter (semicolon or comma)
                sample = f.read(1024)
                f.seek(0)
                delimiter = ";" if ";" in sample else ","

                reader = csv.DictReader(f, delimiter=delimiter)

                for row in reader:
                    try:
                        # Remove quotes from values - handle both string and other types
                        clean_row = {}
                        for k, v in row.items():
                            if isinstance(v, str):
                                clean_row[k] = v.strip('"').strip()
                            else:
                                clean_row[k] = str(v).strip() if v is not None else ""

                        # Skip empty rows (check critical fields)
                        if not clean_row.get("Show Name") and not clean_row.get(
                            "Season Number"
                        ):
                            logger.debug("Skipping empty row")
                            continue

                        records_to_insert.append((
                            run_timestamp,
                            clean_row.get("Show Name", ""),
                            clean_row.get("Type", ""),
                            clean_row.get("tvdbid", ""),
                            clean_row.get("tmdbid", ""),
                            clean_row.get("Library Name", ""),
                            clean_row.get("Season Number", ""),
                            clean_row.get("Episodes", ""),
                            clean_row.get("Title", ""),
                            clean_row.get("RatingKeys", ""),
                            clean_row.get("PlexTitleCardUrls", ""),
                            clean_row.get("Resolutions", ""),
                        ))
                    except Exception as e:
                        logger.warning(f"Error importing row: {e}")
                        continue

            # Batch insert all records in one transaction
            if records_to_insert:
                with self.lock:
                    conn = self._get_connection()
                    cursor = conn.cursor()
                    cursor.executemany(
                        """
                        INSERT OR REPLACE INTO plex_episode_export (
                            run_timestamp, show_name, type, tvdbid, tmdbid,
                            library_name, season_number, episodes, title,
                            rating_keys, plex_titlecard_urls, resolutions,
                            updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (datetime('now', 'localtime')))
                        """,
                        records_to_insert,
                    )
                    conn.commit()
                    conn.close()

                    imported_count = cursor.rowcount
                    skipped_count = len(records_to_insert) - imported_count

                    logger.info(
                        f"✓ Imported {imported_count} episode records (skipped {skipped_count} duplicates)"
                    )
                    return imported_count
            else:
                logger.warning("No valid records found in Plex episode CSV.")
                return 0

        except Exception as e:
            logger.error(f"Error importing episode CSV: {e}", exc_info=True)
            if 'conn' in locals():
                try:
                    conn.rollback()
                    conn.close()
                except Exception as re:
                    logger.error(f"Rollback failed: {re}")
            return 0 # Return 0 on failure

    def import_other_library_csv(
        self, csv_path: Path, run_timestamp: Optional[str] = None
    ) -> int:
        """
        Import OtherMediaServerLibExport.csv (Jellyfin/Emby) into the database

        Args:
            csv_path: Path to OtherMediaServerLibExport.csv
            run_timestamp: Optional timestamp for this run (default: current time)

        Returns:
            Number of records imported
        """
        if not csv_path.exists():
            logger.error(f"CSV file not found: {csv_path}")
            return 0

        if run_timestamp is None:
            run_timestamp = datetime.now().isoformat()

        logger.info(f"Importing OtherMediaServerLibExport.csv: {csv_path}")
        logger.debug(f"Run timestamp: {run_timestamp}")

        records_to_insert = []
        try:
            with open(csv_path, "r", encoding="utf-8") as f:
                # Detect delimiter (semicolon or comma)
                sample = f.read(1024)
                f.seek(0)
                delimiter = ";" if ";" in sample else ","

                reader = csv.DictReader(f, delimiter=delimiter)

                for row in reader:
                    try:
                        # Remove quotes from values - handle both string and other types
                        clean_row = {}
                        for k, v in row.items():
                            if isinstance(v, str):
                                clean_row[k] = v.strip('"').strip()
                            else:
                                clean_row[k] = str(v).strip() if v is not None else ""

                        # Skip empty rows (check critical fields)
                        if not clean_row.get("title") and not clean_row.get("Id"):
                            logger.debug("Skipping empty row")
                            continue

                        records_to_insert.append((
                            run_timestamp,
                            clean_row.get("Library Name", ""),
                            clean_row.get("Library Type", ""),
                            clean_row.get("Library Language", ""),
                            clean_row.get("Id", ""),
                            clean_row.get("title", ""),
                            clean_row.get("originalTitle", ""),
                            clean_row.get("year", ""),
                            clean_row.get("Resolution", ""),
                            clean_row.get("imdbid", ""),
                            clean_row.get("tmdbid", ""),
                            clean_row.get("tvdbid", ""),
                            clean_row.get("Path", ""),
                            clean_row.get("RootFoldername", ""),
                            clean_row.get("extraFolder", ""),
                            clean_row.get("OtherMediaServerPosterUrl", ""),
                            clean_row.get("OtherMediaServerBackgroundUrl", ""),
                            clean_row.get("Labels", ""),
                        ))
                    except Exception as e:
                        logger.warning(f"Error importing row: {e}")
                        continue

            # Batch insert all records in one transaction
            if records_to_insert:
                with self.lock:
                    conn = self._get_connection()
                    cursor = conn.cursor()
                    cursor.executemany(
                        """
                        INSERT OR REPLACE INTO other_media_library_export (
                            run_timestamp, library_name, library_type, library_language,
                            media_id, title, original_title, year, resolution,
                            imdbid, tmdbid, tvdbid, path, root_foldername,
                            extra_folder, other_media_poster_url, other_media_background_url, labels,
                            updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (datetime('now', 'localtime')))
                        """,
                        records_to_insert,
                    )
                    conn.commit()
                    conn.close()

                    imported_count = cursor.rowcount
                    skipped_count = len(records_to_insert) - imported_count

                    logger.info(
                        f"✓ Imported {imported_count} OtherMedia library records (skipped {skipped_count} duplicates)"
                    )
                    return imported_count
            else:
                logger.warning("No valid records found in OtherMedia library CSV.")
                return 0

        except Exception as e:
            logger.error(f"Error importing OtherMedia library CSV: {e}", exc_info=True)
            if 'conn' in locals():
                try:
                    conn.rollback()
                    conn.close()
                except Exception as re:
                    logger.error(f"Rollback failed: {re}")
            return 0 # Return 0 on failure

    def import_other_episode_csv(
        self, csv_path: Path, run_timestamp: Optional[str] = None
    ) -> int:
        """
        Import OtherMediaServerEpisodeExport.csv (Jellyfin/Emby) into the database

        Args:
            csv_path: Path to OtherMediaServerEpisodeExport.csv
            run_timestamp: Optional timestamp for this run (default: current time)

        Returns:
            Number of records imported
        """
        if not csv_path.exists():
            logger.error(f"CSV file not found: {csv_path}")
            return 0

        if run_timestamp is None:
            run_timestamp = datetime.now().isoformat()

        logger.info(f"Importing OtherMediaServerEpisodeExport.csv: {csv_path}")
        logger.debug(f"Run timestamp: {run_timestamp}")

        records_to_insert = []
        try:
            with open(csv_path, "r", encoding="utf-8") as f:
                # Detect delimiter (semicolon or comma)
                sample = f.read(1024)
                f.seek(0)
                delimiter = ";" if ";" in sample else ","

                reader = csv.DictReader(f, delimiter=delimiter)

                for row in reader:
                    try:
                        # Remove quotes from values - handle both string and other types
                        clean_row = {}
                        for k, v in row.items():
                            if isinstance(v, str):
                                clean_row[k] = v.strip('"').strip()
                            else:
                                clean_row[k] = str(v).strip() if v is not None else ""

                        # Skip empty rows (check critical fields)
                        if not clean_row.get("Show Name") and not clean_row.get(
                            "Season Number"
                        ):
                            logger.debug("Skipping empty row")
                            continue

                        records_to_insert.append((
                            run_timestamp,
                            clean_row.get("Show Name", ""),
                            clean_row.get("Type", ""),
                            clean_row.get("tvdbid", ""),
                            clean_row.get("tmdbid", ""),
                            clean_row.get("imdbid", ""),
                            clean_row.get("Library Name", ""),
                            clean_row.get("Season Number", ""),
                            clean_row.get("Episodes", ""),
                            clean_row.get("Title", ""),
                            clean_row.get("RatingKeys", ""),
                            clean_row.get("OtherMediaServerTitleCardUrls", ""),
                            clean_row.get("Resolutions", ""),
                        ))
                    except Exception as e:
                        logger.warning(f"Error importing row: {e}")
                        continue

            # Batch insert all records in one transaction
            if records_to_insert:
                with self.lock:
                    conn = self._get_connection()
                    cursor = conn.cursor()
                    cursor.executemany(
                        """
                        INSERT OR REPLACE INTO other_media_episode_export (
                            run_timestamp, show_name, type, tvdbid, tmdbid, imdbid,
                            library_name, season_number, episodes, title,
                            rating_keys, other_media_titlecard_urls, resolutions,
                            updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (datetime('now', 'localtime')))
                        """,
                        records_to_insert,
                    )
                    conn.commit()
                    conn.close()

                    imported_count = cursor.rowcount
                    skipped_count = len(records_to_insert) - imported_count

                    logger.info(
                        f"✓ Imported {imported_count} OtherMedia episode records (skipped {skipped_count} duplicates)"
                    )
                    return imported_count
            else:
                logger.warning("No valid records found in OtherMedia episode CSV.")
                return 0

        except Exception as e:
            logger.error(f"Error importing OtherMedia episode CSV: {e}", exc_info=True)
            if 'conn' in locals():
                try:
                    conn.rollback()
                    conn.close()
                except Exception as re:
                    logger.error(f"Rollback failed: {re}")
            return 0 # Return 0 on failure

    def import_latest_csvs(self) -> Dict[str, int]:
        """
        Import the latest Plex CSV files from the Logs directory
        Relies on UNIQUE constraints to handle duplicates.

        Returns:
            Dictionary with import counts
        """
        library_csv = LOGS_DIR / "PlexLibexport.csv"
        episode_csv = LOGS_DIR / "PlexEpisodeExport.csv"

        results = {
            "library_count": 0,
            "episode_count": 0,
            "run_timestamp": datetime.now().isoformat(), # Use a single timestamp for this import run
        }

        logger.info(f"Starting Plex CSV import, run_timestamp: {results['run_timestamp']}")

        if library_csv.exists():
            try:
                results["library_count"] = self.import_library_csv(
                    library_csv, results["run_timestamp"]
                )
            except Exception as e:
                logger.error(f"Error importing PlexLibexport.csv: {e}", exc_info=True)
        else:
            logger.warning(f"PlexLibexport.csv not found at {library_csv}")

        if episode_csv.exists():
            try:
                results["episode_count"] = self.import_episode_csv(
                    episode_csv, results["run_timestamp"]
                )
            except Exception as e:
                logger.error(f"Error importing PlexEpisodeExport.csv: {e}", exc_info=True)
        else:
            logger.warning(f"PlexEpisodeExport.csv not found at {episode_csv}")

        return results

    def lookup_library_type_by_name(self, library_name: str) -> Optional[str]:
        """
        Lookup library type (movie/show) by library name

        Args:
            library_name: The library folder name (e.g., "TestMovies", "TestSerien")

        Returns:
            Library type string ("movie" or "show"), or None if not found
        """
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                # Try Plex library export first (latest run)
                cursor.execute(
                    """
                    SELECT library_type
                    FROM plex_library_export
                    WHERE library_name = ?
                    ORDER BY run_timestamp DESC
                    LIMIT 1
                    """,
                    (library_name,),
                )

                result = cursor.fetchone()

                if result:
                    conn.close()
                    return result["library_type"].lower() if result["library_type"] else None

                # Try other media server export (Jellyfin/Emby) if Plex not found
                cursor.execute(
                    """
                    SELECT library_type
                    FROM other_media_library_export
                    WHERE library_name = ?
                    ORDER BY run_timestamp DESC
                    LIMIT 1
                    """,
                    (library_name,),
                )

                result = cursor.fetchone()
                conn.close()

                if result:
                    return result["library_type"].lower() if result["library_type"] else None

                return None

            except Exception as e:
                logger.error(f"Error looking up library type for {library_name}: {e}")
                if 'conn' in locals():
                    conn.close()
                return None

    def get_all_runs(self) -> List[str]:
        """Get list of all unique run timestamps from both library and episode tables"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                cursor.execute(
                    """
                    SELECT DISTINCT run_timestamp
                    FROM (
                        SELECT run_timestamp FROM plex_library_export
                        UNION
                        SELECT run_timestamp FROM plex_episode_export
                    )
                    ORDER BY run_timestamp DESC
                    """
                )

                runs = [row["run_timestamp"] for row in cursor.fetchall()]
                conn.close()

                return runs

            except Exception as e:
                logger.error(f"Error getting runs: {e}")
                if 'conn' in locals():
                    conn.close()
                return []

    def get_library_data(
        self,
        run_timestamp: Optional[str] = None,
        limit: Optional[int] = None,
        root_foldername: Optional[str] = None,
    ) -> List[Dict]:
        """
        Get library export data

        Args:
            run_timestamp: Optional specific run to query (default: latest)
            limit: Optional limit on number of results
            root_foldername: Optional filter on root folder name

        Returns:
            List of library records
        """
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                if run_timestamp:
                    query = "SELECT * FROM plex_library_export WHERE run_timestamp = ?"
                    params = [run_timestamp]
                else:
                    # Get latest run
                    query = """
                        SELECT * FROM plex_library_export
                        WHERE run_timestamp = (SELECT MAX(run_timestamp) FROM plex_library_export)
                    """
                    params = []

                if root_foldername:
                    query += " AND root_foldername = ?"
                    params.append(root_foldername)

                query += " ORDER BY title"

                if limit:
                    query += " LIMIT ?"
                    params.append(limit)

                cursor.execute(query, params)
                rows = cursor.fetchall()

                results = [dict(row) for row in rows]
                conn.close()

                return results

            except Exception as e:
                logger.error(f"Error getting library data: {e}")
                if 'conn' in locals():
                    conn.close()
                return []

    def get_episode_data(
        self, run_timestamp: Optional[str] = None, limit: Optional[int] = None
    ) -> List[Dict]:
        """
        Get episode export data

        Args:
            run_timestamp: Optional specific run to query (default: latest)
            limit: Optional limit on number of results

        Returns:
            List of episode records
        """
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                if run_timestamp:
                    query = "SELECT * FROM plex_episode_export WHERE run_timestamp = ? ORDER BY show_name, season_number"
                    params = [run_timestamp]
                else:
                    # Get latest run
                    query = """
                        SELECT * FROM plex_episode_export
                        WHERE run_timestamp = (SELECT MAX(run_timestamp) FROM plex_episode_export)
                        ORDER BY show_name, season_number
                    """
                    params = []

                if limit:
                    query += " LIMIT ?"
                    params.append(limit)

                cursor.execute(query, params)
                rows = cursor.fetchall()

                results = [dict(row) for row in rows]
                conn.close()

                return results

            except Exception as e:
                logger.error(f"Error getting episode data: {e}")
                if 'conn' in locals():
                    conn.close()
                return []

    def import_other_latest_csvs(self) -> Dict[str, int]:
        """
        Import the latest OtherMedia CSV files from the Logs directory
        Relies on UNIQUE constraints to handle duplicates.

        Returns:
            Dictionary with import counts
        """
        library_csv = LOGS_DIR / "OtherMediaServerLibExport.csv"
        episode_csv = LOGS_DIR / "OtherMediaServerEpisodeExport.csv"

        results = {
            "library_count": 0,
            "episode_count": 0,
            "run_timestamp": datetime.now().isoformat(), # Use a single timestamp for this import run
        }

        logger.info(f"Starting OtherMedia CSV import, run_timestamp: {results['run_timestamp']}")

        if library_csv.exists():
            try:
                results["library_count"] = self.import_other_library_csv(
                    library_csv, results["run_timestamp"]
                )
            except Exception as e:
                logger.error(f"Error importing OtherMediaServerLibExport.csv: {e}", exc_info=True)
        else:
            logger.warning(f"OtherMediaServerLibExport.csv not found at {library_csv}")

        if episode_csv.exists():
            try:
                results["episode_count"] = self.import_other_episode_csv(
                    episode_csv, results["run_timestamp"]
                )
            except Exception as e:
                logger.error(f"Error importing OtherMediaServerEpisodeExport.csv: {e}", exc_info=True)
        else:
            logger.warning(
                f"OtherMediaServerEpisodeExport.csv not found at {episode_csv}"
            )

        return results

    def get_other_all_runs(self) -> List[str]:
        """Get list of all unique run timestamps from OtherMedia tables"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                cursor.execute(
                    """
                    SELECT DISTINCT run_timestamp
                    FROM (
                        SELECT run_timestamp FROM other_media_library_export
                        UNION
                        SELECT run_timestamp FROM other_media_episode_export
                    )
                    ORDER BY run_timestamp DESC
                    """
                )

                runs = [row["run_timestamp"] for row in cursor.fetchall()]
                conn.close()

                return runs

            except Exception as e:
                logger.error(f"Error getting OtherMedia runs: {e}")
                if 'conn' in locals():
                    conn.close()
                return []

    def get_other_library_data(
        self,
        run_timestamp: Optional[str] = None,
        limit: Optional[int] = None,
        root_foldername: Optional[str] = None,
    ) -> List[Dict]:
        """
        Get OtherMedia library data for a specific run or all runs

        Args:
            run_timestamp: Optional specific run to query (default: latest)
            limit: Optional limit on number of results
            root_foldername: Optional filter on root folder name

        Returns:
            List of library records
        """
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                where = []
                params = []
                if run_timestamp:
                    where.append("run_timestamp = ?")
                    params.append(run_timestamp)
                if root_foldername:
                    where.append("root_foldername = ?")
                    params.append(root_foldername)

                query = "SELECT * FROM other_media_library_export"
                if where:
                    query += " WHERE " + " AND ".join(where)
                if run_timestamp:
                    query += " ORDER BY library_name, title"
                else:
                    query += " ORDER BY run_timestamp DESC, library_name, title"

                if limit:
                    query += " LIMIT ?"
                    params.append(limit)

                cursor.execute(query, params)
                results = [dict(row) for row in cursor.fetchall()]
                conn.close()
                return results

            except Exception as e:
                logger.error(f"Error getting OtherMedia library data: {e}")
                if 'conn' in locals():
                    conn.close()
                return []

    def get_other_episode_data(
        self, run_timestamp: Optional[str] = None, limit: Optional[int] = None
    ) -> List[Dict]:
        """
        Get OtherMedia episode data for a specific run or all runs

        Args:
            run_timestamp: Optional specific run to query (default: latest)
            limit: Optional limit on number of results

        Returns:
            List of episode records
        """
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                if run_timestamp:
                    query = """
                        SELECT * FROM other_media_episode_export
                        WHERE run_timestamp = ?
                        ORDER BY show_name, season_number
                    """
                    params = [run_timestamp]
                else:
                    query = "SELECT * FROM other_media_episode_export ORDER BY run_timestamp DESC, show_name, season_number"
                    params = []

                if limit:
                    query += " LIMIT ?"
                    params.append(limit)

                cursor.execute(query, params)
                results = [dict(row) for row in cursor.fetchall()]
                conn.close()
                return results

            except Exception as e:
                logger.error(f"Error getting OtherMedia episode data: {e}")
                if 'conn' in locals():
                    conn.close()
                return []

    def get_other_statistics(self) -> Dict:
        """Get OtherMedia database statistics"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                stats = {}

                # Total runs (from both tables)
                cursor.execute(
                    """
                    SELECT COUNT(DISTINCT run_timestamp) FROM (
                        SELECT run_timestamp FROM other_media_library_export
                        UNION
                        SELECT run_timestamp FROM other_media_episode_export
                    )
                    """
                )
                stats["total_runs"] = cursor.fetchone()[0]

                # Total library items
                cursor.execute("SELECT COUNT(*) FROM other_media_library_export")
                stats["total_library_records"] = cursor.fetchone()[0]

                # Total episode records
                cursor.execute("SELECT COUNT(*) FROM other_media_episode_export")
                stats["total_episode_records"] = cursor.fetchone()[0]

                # Latest run timestamp (from both tables)
                cursor.execute(
                    """
                    SELECT MAX(run_timestamp) FROM (
                        SELECT run_timestamp FROM other_media_library_export
                        UNION
                        SELECT run_timestamp FROM other_media_episode_export
                    )
                    """
                )
                stats["latest_run"] = cursor.fetchone()[0]

                # Items in latest run
                if stats["latest_run"]:
                    cursor.execute(
                        "SELECT COUNT(*) FROM other_media_library_export WHERE run_timestamp = ?",
                        (stats["latest_run"],),
                    )
                    stats["latest_run_library_count"] = cursor.fetchone()[0]

                    cursor.execute(
                        "SELECT COUNT(*) FROM other_media_episode_export WHERE run_timestamp = ?",
                        (stats["latest_run"],),
                    )
                    stats["latest_run_episode_count"] = cursor.fetchone()[0]

                    # Count actual episodes (sum of episode numbers in latest run)
                    cursor.execute(
                        """
                        SELECT SUM(
                            CASE
                                WHEN episodes IS NOT NULL AND episodes != ''
                                THEN LENGTH(episodes) - LENGTH(REPLACE(episodes, ',', '')) + 1
                                ELSE 0
                            END
                        ) FROM other_media_episode_export WHERE run_timestamp = ?
                        """,
                        (stats["latest_run"],),
                    )
                    result = cursor.fetchone()[0]
                    stats["latest_run_total_episodes"] = result if result else 0

                conn.close()
                return stats

            except Exception as e:
                logger.error(f"Error getting OtherMedia statistics: {e}")
                if 'conn' in locals():
                    conn.close()
                return {}

    def get_statistics(self) -> Dict:
        """Get database statistics"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                stats = {}

                # Total runs (from both tables)
                cursor.execute(
                    """
                    SELECT COUNT(DISTINCT run_timestamp) FROM (
                        SELECT run_timestamp FROM plex_library_export
                        UNION
                        SELECT run_timestamp FROM plex_episode_export
                    )
                    """
                )
                stats["total_runs"] = cursor.fetchone()[0]

                # Total library items
                cursor.execute("SELECT COUNT(*) FROM plex_library_export")
                stats["total_library_records"] = cursor.fetchone()[0]

                # Total episode records
                cursor.execute("SELECT COUNT(*) FROM plex_episode_export")
                stats["total_episode_records"] = cursor.fetchone()[0]

                # Latest run timestamp (from both tables)
                cursor.execute(
                    """
                    SELECT MAX(run_timestamp) FROM (
                        SELECT run_timestamp FROM plex_library_export
                        UNION
                        SELECT run_timestamp FROM plex_episode_export
                    )
                    """
                )
                stats["latest_run"] = cursor.fetchone()[0]

                # Items in latest run
                if stats["latest_run"]:
                    cursor.execute(
                        "SELECT COUNT(*) FROM plex_library_export WHERE run_timestamp = ?",
                        (stats["latest_run"],),
                    )
                    stats["latest_run_library_count"] = cursor.fetchone()[0]

                    cursor.execute(
                        "SELECT COUNT(*) FROM plex_episode_export WHERE run_timestamp = ?",
                        (stats["latest_run"],),
                    )
                    stats["latest_run_episode_count"] = cursor.fetchone()[0]

                    # Count actual episodes (sum of episode numbers in latest run)
                    cursor.execute(
                        """
                        SELECT SUM(
                            CASE
                                WHEN episodes IS NOT NULL AND episodes != ''
                                THEN LENGTH(episodes) - LENGTH(REPLACE(episodes, ',', '')) + 1
                                ELSE 0
                            END
                        ) FROM plex_episode_export WHERE run_timestamp = ?
                        """,
                        (stats["latest_run"],),
                    )
                    result = cursor.fetchone()[0]
                    stats["latest_run_total_episodes"] = result if result else 0

                conn.close()
                return stats

            except Exception as e:
                logger.error(f"Error getting statistics: {e}")
                if 'conn' in locals():
                    conn.close()
                return {}


# Global database instance
# This is created by main.py in the lifespan event
# media_export_db = MediaExportDatabase()
# We remove this line - main.py will create the instance


if __name__ == "__main__":
    # Setup logging for standalone testing
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    # Test the database
    db = MediaExportDatabase()

    # Try to import latest CSVs
    results = db.import_latest_csvs()
    print(f"\nImport Results: {results}")

    # Get statistics
    stats = db.get_statistics()
    print(f"\nDatabase Statistics:")
    for key, value in stats.items():
        print(f"  {key}: {value}")

    # Close the connection when done
    # db.close() # No longer needed