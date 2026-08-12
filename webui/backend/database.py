"""
Database module for ImageChoices tracking
"""

import sqlite3
from pathlib import Path
from typing import List, Dict, Optional
import logging
import csv
import threading
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class ImageChoicesDB:
    """Database handler for ImageChoices.csv data"""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.lock = threading.RLock()  # Thread-safety lock
        self.init_database()

    def _get_connection(self):
        """Helper to create a new, thread-safe connection"""
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def init_database(self):
        """Initialize the database and create table if it doesn't exist"""
        logger.info("=" * 60)
        logger.info("INITIALIZING IMAGECHOICES DATABASE")
        logger.debug(f"Database path: {self.db_path}")

        try:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)

            with self.lock:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS imagechoices (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        Title TEXT NOT NULL,
                        Type TEXT,
                        Rootfolder TEXT,
                        LibraryName TEXT,
                        Language TEXT,
                        Fallback TEXT,
                        TextTruncated TEXT,
                        DownloadSource TEXT,
                        FavProviderLink TEXT,
                        Manual TEXT,
                        tmdbid TEXT,
                        tvdbid TEXT,
                        imdbid TEXT,
                        LogoSource TEXT,
                        LogoLanguage TEXT,
                        LogoTextFallback TEXT,
                        created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                        updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                        UNIQUE(Title, Rootfolder, Type, LibraryName)
                    )
                """
                )

                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS skipped_items (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        Title TEXT NOT NULL,
                        Type TEXT,
                        Rootfolder TEXT,
                        LibraryName TEXT,
                        server_type TEXT,
                        item_id TEXT,
                        skipped_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                        UNIQUE(Title, Rootfolder, Type, LibraryName)
                    )
                """
                )

                # Add index for faster lookups
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_rootfolder ON imagechoices(Rootfolder)"
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_title ON imagechoices(Title)"
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_created_at ON imagechoices(created_at)"
                )

                conn.commit()
                conn.close()

            # Run schema migration check to add columns to existing DBs
            self.check_schema_updates()

            logger.info("✓ ImageChoices database initialized successfully")
            logger.info("=" * 60)
        except sqlite3.Error as e:
            logger.error(f"Error initializing ImageChoices database: {e}")
            if 'conn' in locals():
                conn.rollback()
                conn.close()
            raise

    def check_schema_updates(self):
        """
        Automatic Schema Migration:
        Checks for missing columns and adds them dynamically.
        This allows updates without deleting the database.
        """
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                # Get list of existing columns in the table
                cursor.execute("PRAGMA table_info(imagechoices)")
                existing_columns = {row['name'] for row in cursor.fetchall()}

                # Define columns that MUST exist and their types
                required_columns = {
                    "LogoSource": "TEXT",
                    "LogoLanguage": "TEXT",
                    "LogoTextFallback": "TEXT"
                }

                # Check and Add
                changes_made = False
                for col_name, col_type in required_columns.items():
                    if col_name not in existing_columns:
                        logger.info(f"MIGRATION: Adding missing column '{col_name}' to database...")
                        cursor.execute(f"ALTER TABLE imagechoices ADD COLUMN {col_name} {col_type}")
                        changes_made = True

                if changes_made:
                    conn.commit()
                    logger.info("✓ Schema migration completed successfully")
                else:
                    logger.debug("Schema is up to date")

                conn.close()
            except sqlite3.Error as e:
                logger.error(f"Error during schema migration: {e}")
                if 'conn' in locals():
                    conn.close()

    def close(self):
        """Close connection - No longer needed as connections are per-function."""
        pass

    def insert_choice(self, **kwargs) -> int:
        """Insert a new choice into the database"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                columns = ", ".join(kwargs.keys())
                placeholders = ", ".join("?" * len(kwargs))
                values = list(kwargs.values())

                query = f"INSERT OR IGNORE INTO imagechoices ({columns}) VALUES ({placeholders})"
                cursor.execute(query, values)

                inserted_id = cursor.lastrowid
                conn.commit()
                conn.close()
                return inserted_id
            except sqlite3.Error as e:
                logger.error(f"Error inserting choice: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                raise

    def get_all_choices(self) -> List[sqlite3.Row]:
        """Get all choices from the database"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM imagechoices ORDER BY id DESC")
                rows = cursor.fetchall()
                conn.close()
                return rows
            except sqlite3.Error as e:
                logger.error(f"Error getting all choices: {e}")
                if 'conn' in locals():
                    conn.close()
                return []

    # NEW METHODS FOR RUNTIME HISTORY & ANALYTICS

    def get_assets_created_between(self, start_date: str, end_date: str) -> List[sqlite3.Row]:
        """Get assets created within a specific time range"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                # Use >= and <= to include the boundaries
                cursor.execute(
                    "SELECT * FROM imagechoices WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC",
                    (start_date, end_date)
                )
                rows = cursor.fetchall()
                conn.close()
                return rows
            except sqlite3.Error as e:
                logger.error(f"Error getting assets by date range: {e}")
                if 'conn' in locals():
                    conn.close()
                return []

    def get_provider_stats_by_date(self, days: int = 30) -> List[Dict]:
        """
        Get daily statistics of asset providers (TMDB, TVDB, Fanart)
        Returns list of {date: 'YYYY-MM-DD', TMDB: 5, TVDB: 2, ...}
        """
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                # Calculate cutoff date
                cutoff_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

                # Use substr for reliable YYYY-MM-DD extraction across all SQLite versions
                query = """
                    SELECT
                        substr(created_at, 1, 10) as day,
                        CASE
                            WHEN LOWER(DownloadSource) LIKE '%tmdb%' OR LOWER(DownloadSource) LIKE '%themoviedb%' THEN 'TMDB'
                            WHEN LOWER(DownloadSource) LIKE '%tvdb%' OR LOWER(DownloadSource) LIKE '%thetvdb%' THEN 'TVDB'
                            WHEN LOWER(DownloadSource) LIKE '%fanart%' THEN 'Fanart'
                            ELSE 'Other'
                        END as provider,
                        COUNT(*) as count
                    FROM imagechoices
                    WHERE created_at >= ?
                    GROUP BY day, provider
                    ORDER BY day ASC
                """

                cursor.execute(query, (cutoff_date,))
                rows = cursor.fetchall()
                conn.close()

                # Pivot data
                stats_by_day = {}

                for row in rows:
                    day = row['day']
                    if not day or len(day) != 10: continue

                    provider = row['provider']
                    count = row['count']

                    if day not in stats_by_day:
                        stats_by_day[day] = {"date": day, "TMDB": 0, "TVDB": 0, "Fanart": 0, "Other": 0}

                    stats_by_day[day][provider] = count

                # Sort by date
                return sorted(list(stats_by_day.values()), key=lambda x: x['date'])

            except sqlite3.Error as e:
                logger.error(f"Error getting provider stats: {e}")
                if 'conn' in locals():
                    conn.close()
                return []
    #-------------------------------------------------

    def get_choice_by_id(self, record_id: int) -> Optional[sqlite3.Row]:
        """Get a specific choice by its ID"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM imagechoices WHERE id = ?", (record_id,))
                row = cursor.fetchone()
                conn.close()
                return row
            except sqlite3.Error as e:
                logger.error(f"Error getting choice by ID: {e}")
                if 'conn' in locals():
                    conn.close()
                return None

    def get_choice_by_title(self, title: str) -> Optional[sqlite3.Row]:
        """Get a specific choice by its Title"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM imagechoices WHERE Title = ?", (title,))
                row = cursor.fetchone()
                conn.close()
                return row
            except sqlite3.Error as e:
                logger.error(f"Error getting choice by Title: {e}")
                if 'conn' in locals():
                    conn.close()
                return None

    def get_choice_by_rootfolder(self, rootfolder: str) -> Optional[sqlite3.Row]:
        """Get a specific choice by its Rootfolder"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM imagechoices WHERE Rootfolder = ?", (rootfolder,))
                row = cursor.fetchone()
                conn.close()
                return row
            except sqlite3.Error as e:
                logger.error(f"Error getting choice by Rootfolder: {e}")
                if 'conn' in locals():
                    conn.close()
                return None

    def update_choice(self, record_id: int, **kwargs):
        """Update an existing choice and auto-update 'updated_at'"""
        allowed_columns = {
            "Title", "Type", "Rootfolder", "LibraryName", "Language",
            "Fallback", "TextTruncated", "DownloadSource", "FavProviderLink",
            "Manual", "tmdbid", "tvdbid", "imdbid", "LogoSource",
            "LogoLanguage", "LogoTextFallback"
        }
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                set_clause_parts = ["updated_at = (datetime('now', 'localtime'))"]
                values = []

                for k, v in kwargs.items():
                    if k in allowed_columns:
                        set_clause_parts.append(f'"{k}" = ?')
                        values.append(v)
                    else:
                        logger.warning(f"Ignored unauthorized column update attempt: {k}")

                if len(set_clause_parts) == 1:
                    return

                set_clause = ", ".join(set_clause_parts)
                values.append(record_id)

                query = f"UPDATE imagechoices SET {set_clause} WHERE id = ?"
                cursor.execute(query, values) # nosec B608
                conn.commit()
                conn.close()
            except sqlite3.Error as e:
                logger.error(f"Error updating choice: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                raise

    def delete_choice(self, record_id: int):
        """Delete a choice by its ID"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute("DELETE FROM imagechoices WHERE id = ?", (record_id,))
                conn.commit()
                conn.close()
            except sqlite3.Error as e:
                logger.error(f"Error deleting choice: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                raise

    def import_from_csv(self, csv_path: Path) -> dict:
        """
        Import data from ImageChoices.csv, inserting new records
        and updating existing ones based on the unique key.
        """
        if not csv_path.exists():
            return {"added": 0, "updated": 0, "skipped": 0, "errors": 0, "error_details": []}

        with self.lock:
            conn = None
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                records_to_upsert = []
                errors = 0
                error_details = []

                with open(csv_path, "r", encoding="utf-8", errors="ignore") as f:
                    reader = csv.DictReader(f, delimiter=";")

                    for i, row in enumerate(reader):
                        try:
                            # Clean up quotes from values
                            clean_row = {k.strip('"'): v.strip('"') for k, v in row.items()}

                            if not clean_row.get("Title") and not clean_row.get("Rootfolder"):
                                continue

                            records_to_upsert.append((
                                clean_row.get("Title", ""),
                                clean_row.get("Type", ""),
                                clean_row.get("Rootfolder", ""),
                                clean_row.get("LibraryName", ""),
                                clean_row.get("Language", ""),
                                clean_row.get("Fallback", ""),
                                clean_row.get("TextTruncated", ""),
                                clean_row.get("Download Source", ""),
                                clean_row.get("Fav Provider Link", ""),
                                clean_row.get("Manual", ""),
                                clean_row.get("Logo Source", ""),
                                clean_row.get("Logo Language", ""),
                                clean_row.get("Logo TextFallback", ""),
                            ))
                        except Exception as e_row:
                            logger.warning(f"Error processing CSV row {i+1}: {e_row}")
                            errors += 1
                            error_details.append(f"Row {i+1}: {str(e_row)}")

                if records_to_upsert:
                    cursor.execute("SELECT COUNT(*) FROM imagechoices")
                    rows_before = cursor.fetchone()[0]

                    cursor.execute("SELECT total_changes()")
                    changes_before = cursor.fetchone()[0]

                    # UPSERT Logic
                    sql_upsert = """
                        INSERT INTO imagechoices (
                            Title, Type, Rootfolder, LibraryName, Language,
                            Fallback, TextTruncated, DownloadSource, FavProviderLink, Manual,
                            LogoSource, LogoLanguage, LogoTextFallback
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(Title, Rootfolder, Type, LibraryName) DO UPDATE SET
                            Language = excluded.Language,
                            Fallback = excluded.Fallback,
                            TextTruncated = excluded.TextTruncated,
                            DownloadSource = excluded.DownloadSource,
                            FavProviderLink = excluded.FavProviderLink,
                            Manual = excluded.Manual,
                            LogoSource = excluded.LogoSource,
                            LogoLanguage = excluded.LogoLanguage,
                            LogoTextFallback = excluded.LogoTextFallback,
                            updated_at = (datetime('now', 'localtime'))
                        WHERE
                            imagechoices.Language IS NOT excluded.Language OR
                            imagechoices.Fallback IS NOT excluded.Fallback OR
                            imagechoices.TextTruncated IS NOT excluded.TextTruncated OR
                            imagechoices.DownloadSource IS NOT excluded.DownloadSource OR
                            imagechoices.FavProviderLink IS NOT excluded.FavProviderLink OR
                            imagechoices.Manual IS NOT excluded.Manual OR
                            imagechoices.LogoSource IS NOT excluded.LogoSource OR
                            imagechoices.LogoLanguage IS NOT excluded.LogoLanguage OR
                            imagechoices.LogoTextFallback IS NOT excluded.LogoTextFallback
                    """

                    cursor.executemany(sql_upsert, records_to_upsert)
                    conn.commit()

                    cursor.execute("SELECT total_changes()")
                    changes_after = cursor.fetchone()[0]

                    cursor.execute("SELECT COUNT(*) FROM imagechoices")
                    rows_after = cursor.fetchone()[0]

                    conn.close()

                    total_changes = changes_after - changes_before
                    added_count = rows_after - rows_before
                    updated_count = total_changes - added_count
                    skipped_count = len(records_to_upsert) - total_changes

                    return {
                        "added": added_count,
                        "updated": updated_count,
                        "skipped": skipped_count,
                        "errors": errors,
                        "error_details": error_details,
                    }

                conn.close()
                return {"added": 0, "updated": 0, "skipped": 0, "errors": errors, "error_details": error_details}

            except Exception as e:
                logger.error(f"Error importing CSV: {e}")
                if conn:
                    conn.rollback()
                    conn.close()
                return {"added": 0, "updated": 0, "skipped": 0, "errors": errors + 1, "error_details": [str(e)]}

    def bulk_update_manual_status(self, record_ids: List[int], manual_status: str) -> int:
        """Update the 'Manual' status for a list of record IDs"""
        if not record_ids:
            return 0

        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                placeholders = ",".join("?" * len(record_ids))
                query = f"UPDATE imagechoices SET Manual = ?, updated_at = (datetime('now', 'localtime')) WHERE id IN ({placeholders})"
                values = [manual_status] + record_ids
                cursor.execute(query, values)
                updated_count = cursor.rowcount
                conn.commit()
                conn.close()
                return updated_count
            except sqlite3.Error as e:
                logger.error(f"Error bulk updating manual status: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                raise

    def search_assets(self, query: str, limit: int = 5) -> List[Dict]:
        """Search for assets by title"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                sql = "SELECT * FROM imagechoices WHERE Title LIKE ? OR Rootfolder LIKE ? ORDER BY id DESC LIMIT ?"
                cursor.execute(sql, (f"%{query}%", f"%{query}%", limit))
                rows = cursor.fetchall()
                conn.close()

                results = []
                for row in rows:
                    r = dict(row)
                    results.append({
                        "id": r["id"],
                        "title": r["Title"],
                        "type": r["Type"],
                        "year": "",
                        "library": r["LibraryName"]
                    })
                return results
            except sqlite3.Error as e:
                logger.error(f"Error searching assets: {e}")
                if 'conn' in locals():
                    conn.close()
                return []

    # ==========================================
    # SKIPPED ITEMS METHODS
    # ==========================================

    def add_skipped_item(self, title: str, asset_type: str, rootfolder: str, library_name: str, server_type: str, item_id: str) -> int:
        """Add an item to the skipped_items table"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                query = """
                    INSERT OR IGNORE INTO skipped_items 
                    (Title, Type, Rootfolder, LibraryName, server_type, item_id) 
                    VALUES (?, ?, ?, ?, ?, ?)
                """
                cursor.execute(query, (title, asset_type, rootfolder, library_name, server_type, item_id))
                inserted_id = cursor.lastrowid
                conn.commit()
                conn.close()
                return inserted_id
            except sqlite3.Error as e:
                logger.error(f"Error adding skipped item: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                raise

    def get_skipped_items(self) -> List[sqlite3.Row]:
        """Get all skipped items"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM skipped_items ORDER BY skipped_at DESC")
                rows = cursor.fetchall()
                conn.close()
                return rows
            except sqlite3.Error as e:
                logger.error(f"Error getting skipped items: {e}")
                if 'conn' in locals():
                    conn.close()
                return []

    def delete_skipped_item(self, item_id: int) -> bool:
        """Delete an item from the skipped_items table by its DB ID"""
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute("DELETE FROM skipped_items WHERE id = ?", (item_id,))
                deleted = cursor.rowcount > 0
                conn.commit()
                conn.close()
                return deleted
            except sqlite3.Error as e:
                logger.error(f"Error deleting skipped item: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                return False

def init_database(db_path: Path) -> ImageChoicesDB:
    """Initialize the database"""
    return ImageChoicesDB(db_path)