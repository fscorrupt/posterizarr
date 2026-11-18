import sqlite3
import json
import time
import os
import sys
import re
from typing import List, Dict, Any, Optional
from animetafill_core.providers import EpisodeData, EpisodeCategory

from animetafill_core.logger import logger

class AnimeDatabase:
    """
    Manages local storage of anime episode classifications using SQLite.
    Stores and retrieves mapping data for Canon, Filler, and Mixed episodes.
    """
    def __init__(self, db_path: str):
        self.db_path = db_path
        # Ensure directory exists and check permissions
        db_dir = os.path.dirname(self.db_path)
        try:
            os.makedirs(db_dir, exist_ok=True)
        except PermissionError:
            logger.error(f"FATAL: No permission to create or write to the database directory: '{db_dir}'")
            raise PermissionError(f"No permission to create or write to the database directory: '{db_dir}'")

        if not os.access(db_dir, os.W_OK):
            logger.error(f"FATAL: Database directory '{db_dir}' is NOT writable.")
            if os.name != 'nt': # Linux/Docker specific advice
                logger.error("FIX: Run 'chown -R 1000:1000 /data' on your host system.")
            raise PermissionError(f"No write access to {db_dir}")

        self.init_db()

    def _get_connection(self):
        """Standard SQLite connection wrapper."""
        return sqlite3.connect(self.db_path)

    def init_db(self):
        """Initializes the database schema with support for episode titles and source tracking."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS episodes (
                    anime_title TEXT,
                    absolute_number INTEGER,
                    episode_title TEXT,
                    category TEXT,
                    PRIMARY KEY (anime_title, absolute_number)
                )
            ''')
            
            # Migration: Add episode_title if it doesn't exist
            cursor.execute("PRAGMA table_info(episodes)")
            columns = [column[1] for column in cursor.fetchall()]
            if 'episode_title' not in columns:
                logger.info("Migrating Database: Adding 'episode_title' column...")
                cursor.execute("ALTER TABLE episodes ADD COLUMN episode_title TEXT")

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS updates (
                    anime_title TEXT PRIMARY KEY,
                    last_checked REAL
                )
            ''')
            
            # Migration: Add source_url if it doesn't exist for existing updates table
            cursor.execute("PRAGMA table_info(updates)")
            columns = [column[1] for column in cursor.fetchall()]
            if 'source_url' not in columns:
                logger.info("Migrating Database: Adding 'source_url' column to updates...")
                cursor.execute("ALTER TABLE updates ADD COLUMN source_url TEXT")

            conn.commit()

    def upsert_episodes(self, anime_title: str, episodes_list: List[EpisodeData], source_url: str = None):
        """
        Saves classifications and tracks the successful source URL.
        """
        with self._get_connection() as conn:
            cursor = conn.cursor()
            # Delete old records for this title to ensure we have fresh data
            cursor.execute("DELETE FROM episodes WHERE anime_title = ?", (anime_title,))

            for ep in episodes_list:
                cursor.execute(
                    "INSERT OR REPLACE INTO episodes (anime_title, absolute_number, episode_title, category) VALUES (?, ?, ?, ?)",
                    (anime_title, ep.number, ep.title, ep.category.value)
                )

            cursor.execute(
                "INSERT OR REPLACE INTO updates (anime_title, last_checked, source_url) VALUES (?, ?, ?)",
                (anime_title, time.time(), source_url)
            )
            conn.commit()

    def get_episodes(self, anime_title: str) -> Dict[str, List[tuple]]:
        """
        Retrieves serialized mapping: { category: [(abs_num, title), ...] }
        """
        result = {"canon": [], "filler": [], "mixed": []}
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT absolute_number, episode_title, category FROM episodes WHERE anime_title = ?",
                (anime_title,)
            )
            rows = cursor.fetchall()
            for row in rows:
                abs_num, ep_title, category = row
                if category in result:
                    result[category].append((abs_num, ep_title))

        # Sort by absolute number
        for cat in result:
            result[cat].sort(key=lambda x: x[0])

        return result

    def has_ever_synced(self, anime_title: str) -> bool:
        """Returns True if this show has ever been searched via a provider."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT last_checked FROM updates WHERE anime_title = ?", (anime_title,))
            return cursor.fetchone() is not None

    def _slugify(self, title: str) -> str:
        """Internal title to slug generator for file-naming consistency."""
        slug = title.lower()
        slug = re.sub(r'[^a-z0-9\s-]', '', slug)
        slug = re.sub(r'[\s]+', '-', slug)
        return slug.strip('-')

    def export_to_json(self, filepath: str):
        master_dict = {}
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT anime_title FROM episodes")
            titles = [row[0] for row in cursor.fetchall()]

            for title in titles:
                slug = self._slugify(title)
                raw_mapping = self.get_episodes(title)
                # Flatten numeric/title tuples back into numeric lists for legacy JSON compatibility
                flat_mapping = {cat: [item[0] for item in eps] for cat, eps in raw_mapping.items()}
                if any(flat_mapping.values()):
                    master_dict[slug] = flat_mapping

        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        tmp_filepath = f"{filepath}.tmp"
        try:
            with open(tmp_filepath, 'w') as f:
                json.dump(master_dict, f, indent=2)
            os.replace(tmp_filepath, filepath)
            logger.db(f"Exported database to {filepath}")
        except Exception as e:
            if os.path.exists(tmp_filepath): os.remove(tmp_filepath)
            logger.error(f"Failed to export DB JSON: {e}")
