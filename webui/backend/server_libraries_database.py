"""
Database module for managing server_libraries.db
Separate database for media server library management
"""

import sqlite3
import json
from pathlib import Path
import logging
import threading
from typing import Optional, List, Dict
from datetime import datetime

logger = logging.getLogger(__name__)


class ServerLibrariesDB:
    """Database class for managing media server libraries"""

    def __init__(self, db_path: Path):
        """
        Initialize the database connection

        Args:
            db_path: Path to the database file
        """
        self.db_path = db_path
        # REMOVED: self.connection
        self.lock = threading.RLock()  # Thread-safety lock

    def _get_connection(self):
        """Helper to create a new, thread-safe connection"""
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def connect(self):
        """Establish database connection (now just ensures tables exist)"""
        logger.debug(
            f"Attempting to initialize server libraries database: {self.db_path}"
        )
        self.create_tables()


    def close(self):
        """Close connection - No longer needed."""
        pass

    def create_tables(self):
        """Create the media_server_libraries table if it doesn't exist"""
        with self.lock:
            logger.debug("Creating tables if they don't exist...")
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS media_server_libraries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        server_type TEXT NOT NULL,
                        library_name TEXT NOT NULL,
                        library_type TEXT,
                        is_excluded INTEGER DEFAULT 0,
                        last_fetched TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                        UNIQUE(server_type, library_name)
                    )
                """
                )
                conn.commit()
                conn.close()
                logger.info("Server libraries table created or already exists")
            except sqlite3.Error as e:
                logger.error(f"Error creating table: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                raise

    def initialize(self):
        """Initialize the database (connect and create tables)"""
        logger.info("=" * 60)
        logger.info("INITIALIZING SERVER LIBRARIES DATABASE")

        db_exists = self.db_path.exists()
        logger.debug(f"Database path: {self.db_path}")
        logger.debug(f"Database exists: {db_exists}")

        if db_exists:
            logger.info(f"Database already exists: {self.db_path}")
        else:
            logger.info(f"Creating new server libraries database: {self.db_path}")

        self.connect() # This creates the tables

        logger.info("Server libraries database initialization complete")
        logger.info("=" * 60)

    def _get_config_exclusions(self, server_type: str) -> list:
        try:
            candidates = [
                self.db_path.parent.parent / "config.json",
                self.db_path.parent / "config.json",
                Path("config.json"),
            ]
            for config_file in candidates:
                if config_file.exists():
                    with open(config_file, "r", encoding="utf-8") as f:
                        cfg = json.load(f)
                    if server_type == "plex":
                        ex = cfg.get("PlexLibstoExclude") or cfg.get("PlexPart", {}).get("LibstoExclude", []) or []
                    elif server_type == "jellyfin":
                        ex = cfg.get("JellyfinLibstoExclude") or cfg.get("JellyfinPart", {}).get("LibstoExclude", []) or []
                    elif server_type == "emby":
                        ex = cfg.get("EmbyLibstoExclude") or cfg.get("EmbyPart", {}).get("LibstoExclude", []) or []
                    else:
                        ex = []
                    if ex:
                        return list(ex)
        except Exception as e:
            logger.warning(f"Error reading exclusions from config.json for {server_type}: {e}")
        return []

    def save_media_server_libraries(
        self, server_type: str, libraries: list, excluded_libraries: list = None
    ):
        """
        Save media server libraries to database using a batch operation.
        """
        logger.info(f"Saving {len(libraries)} libraries for {server_type}")
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                # Get existing exclusion status
                cursor.execute(
                    "SELECT library_name, is_excluded FROM media_server_libraries WHERE server_type = ?",
                    (server_type,),
                )
                existing_exclusions = {row["library_name"]: row["is_excluded"] for row in cursor.fetchall()}

                if excluded_libraries is not None:
                    excluded_set = set(excluded_libraries)
                else:
                    excluded_set = set(k for k, v in existing_exclusions.items() if v == 1)
                    if not excluded_set:
                        cfg_ex = self._get_config_exclusions(server_type)
                        if cfg_ex:
                            excluded_set = set(cfg_ex)

                # Delete existing libraries
                cursor.execute(
                    "DELETE FROM media_server_libraries WHERE server_type = ?",
                    (server_type,),
                )

                # Prepare new libraries for batch insert
                libraries_to_insert = []
                for lib in libraries:
                    lib_name = lib["name"]
                    is_excluded = 1 if lib_name in excluded_set else 0
                    libraries_to_insert.append(
                        (server_type, lib_name, lib.get("type", ""), is_excluded)
                    )

                if libraries_to_insert:
                    cursor.executemany(
                        """
                        INSERT INTO media_server_libraries (server_type, library_name, library_type, is_excluded)
                        VALUES (?, ?, ?, ?)
                        """,
                        libraries_to_insert,
                    )

                conn.commit()
                conn.close()
                logger.info(
                    f"Successfully saved {len(libraries)} libraries for {server_type}"
                )
            except sqlite3.Error as e:
                logger.error(f"Error saving media server libraries: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                raise

    def update_library_exclusions(self, server_type: str, excluded_libraries: list):
        """Update the exclusion status of libraries"""
        logger.info(f"Updating exclusions for {server_type}: {excluded_libraries}")
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()

                # Set all to included
                cursor.execute(
                    "UPDATE media_server_libraries SET is_excluded = 0 WHERE server_type = ?",
                    (server_type,),
                )

                # Set specified to excluded
                if excluded_libraries:
                    # Build placeholders safely
                    placeholders = ",".join("?" * len(excluded_libraries))
                    query = f"UPDATE media_server_libraries SET is_excluded = 1 WHERE server_type = ? AND library_name IN ({placeholders})"

                    # Combine parameters into one flat list
                    params = [server_type] + list(excluded_libraries)
                    cursor.execute(query, params) # nosec B608

                conn.commit()
                conn.close()
                logger.info(f"Successfully updated exclusions for {server_type}")
            except sqlite3.Error as e:
                logger.error(f"Error updating library exclusions: {e}")
                if 'conn' in locals():
                    conn.rollback()
                    conn.close()
                raise

    def get_media_server_libraries(self, server_type: str):
        """Get media server libraries from database"""
        logger.debug(f"Fetching libraries for {server_type}")
        with self.lock:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT library_name, library_type, is_excluded, last_fetched
                    FROM media_server_libraries
                    WHERE server_type = ?
                    ORDER BY library_name
                    """,
                    (server_type,),
                )

                rows = cursor.fetchall()

                libraries = []
                excluded = []
                for row in rows:
                    lib_data = {
                        "name": row["library_name"],
                        "type": row["library_type"],
                        "last_fetched": row["last_fetched"],
                        "is_excluded": bool(row["is_excluded"])
                    }
                    libraries.append(lib_data)
                    if row["is_excluded"] == 1:
                        excluded.append(row["library_name"])

                # If no exclusions found in DB yet, check config.json and sync DB
                if not excluded and libraries:
                    cfg_ex = self._get_config_exclusions(server_type)
                    if cfg_ex:
                        try:
                            placeholders = ",".join("?" * len(cfg_ex))
                            cursor.execute(
                                f"UPDATE media_server_libraries SET is_excluded = 1 WHERE server_type = ? AND library_name IN ({placeholders})",
                                [server_type] + list(cfg_ex)
                            )
                            conn.commit()
                            excluded = [lib["name"] for lib in libraries if lib["name"] in cfg_ex]
                            for lib in libraries:
                                if lib["name"] in cfg_ex:
                                    lib["is_excluded"] = True
                            logger.info(f"Auto-synced {len(excluded)} exclusions from config.json to DB for {server_type}")
                        except Exception as e:
                            logger.warning(f"Error auto-syncing config exclusions to DB: {e}")

                conn.close()

                logger.debug(
                    f"Found {len(libraries)} libraries for {server_type} ({len(excluded)} excluded)"
                )
                return {"libraries": libraries, "excluded": excluded}

            except sqlite3.Error as e:
                logger.error(f"Error fetching media server libraries: {e}")
                if 'conn' in locals():
                    conn.close()
                return {"libraries": [], "excluded": []}

def init_server_libraries_db(db_path: Path) -> ServerLibrariesDB:
    """
    Initialize the server libraries database
    """
    db = ServerLibrariesDB(db_path)
    db.initialize()
    return db