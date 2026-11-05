import csv
import gzip
import json
import logging
import re
import sqlite3
import threading
import unicodedata
from contextlib import closing
from datetime import datetime, timezone, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx


logger = logging.getLogger("ratings_service")
IMDB_ID = re.compile(r"tt\d{7,12}\Z")


def normalized_title(value):
    return "".join(character for character in unicodedata.normalize("NFKC", value or "").casefold() if character.isalnum())


def filename_episode(value):
    name = re.split(r"[/\\]", value or "")[-1]
    match = re.search(r" - S\d+E\d+ - (\d+) - (.+?)(?:\s*\[|\.[a-zA-Z0-9]{2,4}$|$)", name, re.I)
    return (int(match[1]), match[2].strip()) if match else (None, None)


class ImdbDataset:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.import_lock = threading.Lock()
        self.job = {"running": False, "phase": "idle", "error": None}

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.lock, closing(self.connect()) as connection, connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS contexts (
                    server TEXT NOT NULL, item TEXT NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(server, item));
                CREATE TABLE IF NOT EXISTS mappings (
                    server TEXT NOT NULL, item TEXT NOT NULL, imdb_id TEXT NOT NULL,
                    PRIMARY KEY(server, item));
                CREATE TABLE IF NOT EXISTS season_mappings (
                    server TEXT NOT NULL, series TEXT NOT NULL, season INTEGER NOT NULL,
                    imdb_id TEXT NOT NULL, target_season INTEGER NOT NULL, episode_offset INTEGER NOT NULL,
                    PRIMARY KEY(server, series, season));
                CREATE TABLE IF NOT EXISTS ratings (imdb_id TEXT PRIMARY KEY, rating REAL, votes INTEGER);
                CREATE TABLE IF NOT EXISTS titles (
                    imdb_id TEXT PRIMARY KEY, title TEXT, original_title TEXT, normalized TEXT,
                    original_normalized TEXT, kind TEXT, year INTEGER);
                CREATE TABLE IF NOT EXISTS episodes (
                    imdb_id TEXT PRIMARY KEY, parent_id TEXT, season INTEGER, episode INTEGER);
            """)

    def status(self):
        result = {"enabled": False, "updated_at": None, "last_attempt": None, "ratings": 0, "episodes": 0, "job": dict(self.job)}
        if self.path.exists():
            with closing(self.connect()) as connection:
                values = dict(connection.execute("SELECT key, value FROM settings").fetchall())
                result.update(enabled=values.get("enabled") == "1", updated_at=values.get("updated_at"),
                              last_attempt=values.get("last_attempt"),
                              ratings=int(values.get("ratings", 0)), episodes=int(values.get("episodes", 0)))
        return result

    def configure(self, enabled):
        self.initialize()
        with self.lock, closing(self.connect()) as connection, connection:
            connection.execute("INSERT OR REPLACE INTO settings VALUES ('enabled', ?)", ("1" if enabled else "0",))
        return self.status()

    def context(self, server, item, payload=None):
        if not self.path.exists() or not self.status()["enabled"]:
            return {}
        with self.lock, closing(self.connect()) as connection, connection:
            row = connection.execute("SELECT payload FROM contexts WHERE server=? AND item=?", (server, str(item))).fetchone()
            context = json.loads(row[0]) if row else {}
            if payload:
                context.update({key: value for key, value in payload.items() if value is not None and value != ""})
                encoded = json.dumps(context, ensure_ascii=True)
                if not row or encoded != row[0]:
                    connection.execute("INSERT OR REPLACE INTO contexts VALUES (?, ?, ?)", (server, str(item), encoded))
            return context

    def search(self, query="", parent_id=None, limit=30):
        if not self.path.exists():
            return []
        query = str(query).strip()[:250]
        with self.lock, closing(self.connect()) as connection:
            conditions, parameters = [], []
            if parent_id:
                conditions.append("e.parent_id=?")
                parameters.append(parent_id)
            if IMDB_ID.fullmatch(query):
                conditions.append("t.imdb_id=?")
                parameters.append(query)
            elif query:
                conditions.append("(instr(t.normalized, ?) > 0 OR instr(t.original_normalized, ?) > 0)")
                parameters.extend([normalized_title(query)] * 2)
            elif not parent_id:
                return []
            rows = connection.execute("""
                SELECT t.imdb_id, t.title, t.original_title, t.year, e.parent_id, e.season, e.episode,
                       p.title AS series_title, r.rating, r.votes
                FROM episodes e JOIN titles t USING(imdb_id)
                JOIN ratings r USING(imdb_id) LEFT JOIN titles p ON p.imdb_id=e.parent_id
                WHERE """ + " AND ".join(conditions) + " ORDER BY e.season, e.episode LIMIT ?",
                [*parameters, min(max(int(limit), 1), 50)]).fetchall()
            return [dict(row) for row in rows]

    def resolve(self, server, item, imdb_id=None, media_type="episode", context=None):
        if not self.status()["enabled"]:
            return {"status": "disabled"}
        context = self.context(server, item, context)
        with self.lock, closing(self.connect()) as connection:
            manual = connection.execute("SELECT imdb_id FROM mappings WHERE server=? AND item=?", (server, str(item))).fetchone()
            season_mapping = self.season_mapping(server, context)
            if media_type == "episode" and not manual and season_mapping:
                target_episode = int(context.get("episode_number") or 0) + season_mapping["episode_offset"]
                rows = connection.execute("""
                    SELECT e.imdb_id, r.rating, r.votes FROM episodes e
                    LEFT JOIN ratings r USING(imdb_id)
                    WHERE e.parent_id=? AND e.season=? AND e.episode=? LIMIT 2
                """, (season_mapping["imdb_id"], season_mapping["target_season"], target_episode)).fetchall()
                result = {"mode": "season", "season_mapping": season_mapping, "context": context}
                if context.get("episode_number") is not None and target_episode > 0 and len(rows) == 1:
                    return {**result, **dict(rows[0]), "status": "matched"}
                return {**result, "status": "unmapped", "candidates": []}
            selected = manual[0] if manual else imdb_id
            if selected and IMDB_ID.fullmatch(str(selected)):
                row = connection.execute("SELECT * FROM ratings WHERE imdb_id=?", (selected,)).fetchone()
                if row:
                    if media_type == "episode":
                        episode = connection.execute("SELECT 1 FROM episodes WHERE imdb_id=?", (selected,)).fetchone()
                        if not episode:
                            return {"status": "unmapped", "mode": "manual" if manual else "auto"}
                    return {**dict(row), "status": "matched", "mode": "manual" if manual else "auto"}
            if media_type != "episode" or manual:
                return {"status": "unmapped", "mode": "manual" if manual else "auto", "imdb_id": selected}
            parent_id = context.get("parent_imdb_id")
            if not parent_id:
                name = normalized_title(context.get("series_title"))
                series_year = context.get("series_year")
                file_name = re.split(r"[/\\]", context.get("file_path") or "")[-1]
                file_series = re.match(r"(.+?) \((\d{4})\) - S\d+E\d+", file_name, re.I)
                if file_series and normalized_title(file_series[1]) == name:
                    series_year = int(file_series[2])
                parameters = [name, name]
                year_filter = ""
                if series_year:
                    year_filter = " AND year=?"
                    parameters.append(series_year)
                parents = connection.execute("SELECT imdb_id FROM titles WHERE kind IN ('tvSeries', 'tvMiniSeries') AND (normalized=? OR original_normalized=?)" + year_filter + " LIMIT 2", parameters).fetchall() if name else []
                if len(parents) == 1:
                    parent_id = parents[0][0]
            if not parent_id:
                return {"status": "missing_series", "mode": "auto", "context": context, "candidates": []}
            absolute, file_title = filename_episode(context.get("file_path"))
            names = {normalized_title(context.get(key)) for key in ("episode_title", "original_title")}
            names.add(normalized_title(file_title))
            names.discard("")
            rows = connection.execute("""
                SELECT t.imdb_id, t.title, t.original_title, t.normalized, t.original_normalized,
                       e.parent_id, e.season, e.episode, r.rating, r.votes
                FROM episodes e JOIN titles t USING(imdb_id) JOIN ratings r USING(imdb_id)
                WHERE e.parent_id=? ORDER BY e.season, e.episode
            """, (parent_id,)).fetchall()
            matches = [dict(row) for row in rows if names.intersection((row["normalized"], row["original_normalized"]))]
            if len(matches) > 1 and absolute is not None:
                matches = [row for row in matches if row["season"] == 1 and row["episode"] == absolute]
            if len(matches) == 1:
                return {**matches[0], "status": "matched", "mode": "auto", "parent_id": parent_id}
            candidates = matches or [dict(row) for row in rows if absolute is not None and row["season"] == 1 and row["episode"] == absolute]
            return {"status": "ambiguous" if len(matches) > 1 else "unmapped", "mode": "auto", "parent_id": parent_id,
                    "context": context, "candidates": candidates[:30]}

    def season_mapping(self, server, context):
        series = context.get("series_title") or context.get("parent_imdb_id")
        season = context.get("season_number")
        if not series or season is None or not self.path.exists():
            return None
        with self.lock, closing(self.connect()) as connection:
            exists = connection.execute("SELECT 1 FROM sqlite_master WHERE name='season_mappings'").fetchone()
            if not exists:
                return None
            row = connection.execute("SELECT * FROM season_mappings WHERE server=? AND series=? AND season=?",
                                     (server, str(series), int(season))).fetchone()
            return dict(row) if row else None

    def save_season_mapping(self, server, context, imdb_id, target_season=1, episode_offset=0):
        self.initialize()
        series = context.get("series_title") or context.get("parent_imdb_id")
        season = context.get("season_number")
        if not series or season is None:
            raise ValueError("Refresh episode ratings first to load the series and season context")
        with self.lock, closing(self.connect()) as connection, connection:
            if imdb_id is None:
                connection.execute("DELETE FROM season_mappings WHERE server=? AND series=? AND season=?",
                                   (server, str(series), int(season)))
            else:
                if (not IMDB_ID.fullmatch(imdb_id) or target_season < 0 or not connection.execute(
                        "SELECT 1 FROM titles WHERE imdb_id=? AND kind IN ('tvSeries', 'tvMiniSeries')", (imdb_id,)).fetchone()):
                    raise ValueError("Select a series present in the local IMDb dataset and a valid target season")
                connection.execute("INSERT OR REPLACE INTO season_mappings VALUES (?, ?, ?, ?, ?, ?)",
                                   (server, str(series), int(season), imdb_id, int(target_season), int(episode_offset)))

    def save_mapping(self, server, item, imdb_id):
        self.initialize()
        with self.lock, closing(self.connect()) as connection, connection:
            if imdb_id is None:
                connection.execute("DELETE FROM mappings WHERE server=? AND item=?", (server, str(item)))
            else:
                if not IMDB_ID.fullmatch(imdb_id) or not connection.execute("SELECT 1 FROM episodes WHERE imdb_id=?", (imdb_id,)).fetchone():
                    raise ValueError("Select an episode present in the local IMDb dataset")
                connection.execute("INSERT OR REPLACE INTO mappings VALUES (?, ?, ?)", (server, str(item), imdb_id))

    def maybe_update(self):
        status = self.status()
        if not status["enabled"] or not status["updated_at"] or status["job"]["running"]:
            return
        latest = max(datetime.fromisoformat(value) for value in (status["updated_at"], status["last_attempt"]) if value)
        if datetime.now(timezone.utc) - latest >= timedelta(days=1):
            self.start_import()

    def start_import(self):
        self.initialize()
        if not self.import_lock.acquire(blocking=False):
            return self.status()
        try:
            with closing(self.connect()) as connection, connection:
                connection.execute("INSERT OR REPLACE INTO settings VALUES ('last_attempt', ?)", (datetime.now(timezone.utc).isoformat(),))
            self.job = {"running": True, "phase": "starting", "error": None}
            threading.Thread(target=self._download_import, name="imdb-dataset-import", daemon=True).start()
        except Exception:
            self.job.update(running=False, phase="idle")
            self.import_lock.release()
            raise
        return self.status()

    def _download_import(self):
        try:
            with TemporaryDirectory(prefix="imdb-import-", dir=self.path.parent) as directory:
                files = {}
                with httpx.Client(timeout=httpx.Timeout(60, connect=15), follow_redirects=True) as client:
                    for name in ("ratings", "episode", "basics"):
                        self.job["phase"] = f"downloading_{name}"
                        target = Path(directory) / f"{name}.tsv.gz"
                        with client.stream("GET", f"https://datasets.imdbws.com/title.{name}.tsv.gz") as response:
                            response.raise_for_status()
                            with target.open("wb") as output:
                                for chunk in response.iter_bytes(1024 * 1024):
                                    output.write(chunk)
                        files[name] = target
                self.import_files(files)
        except Exception:
            logger.exception("[IMDb Dataset] Import failed; previous index preserved")
            self.job["error"] = "IMDb import failed. Check disk space, network and backend log. Previous index preserved."
        finally:
            self.job.update(running=False, phase="idle")
            self.import_lock.release()

    def import_files(self, files):
        self.initialize()
        with closing(self.connect()) as connection:
            schemas = {
                "ratings": "imdb_id TEXT PRIMARY KEY, rating REAL, votes INTEGER",
                "episodes": "imdb_id TEXT PRIMARY KEY, parent_id TEXT, season INTEGER, episode INTEGER",
                "titles": "imdb_id TEXT PRIMARY KEY, title TEXT, original_title TEXT, normalized TEXT, original_normalized TEXT, kind TEXT, year INTEGER",
            }
            for name, schema in schemas.items():
                with connection:
                    connection.execute(f"DROP TABLE IF EXISTS next_{name}")
                    connection.execute(f"CREATE TABLE next_{name} ({schema})")
            imports = (
                ("ratings", ("tconst", "averageRating", "numVotes"), "INSERT INTO next_ratings VALUES (?, ?, ?)"),
                ("episode", ("tconst", "parentTconst", "seasonNumber", "episodeNumber"),
                 "INSERT INTO next_episodes SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM next_ratings WHERE imdb_id=?)"),
                ("basics", ("tconst", "titleType", "primaryTitle", "originalTitle", "startYear"),
                 "INSERT INTO next_titles SELECT ?, ?, ?, ?, ?, ?, ? WHERE ? IN ('tvSeries', 'tvMiniSeries') OR EXISTS (SELECT 1 FROM next_episodes WHERE imdb_id=?)"),
            )
            for name, headers, statement in imports:
                self.job["phase"] = f"importing_{name}"
                batch = []
                with gzip.open(files[name], "rt", encoding="utf-8", newline="") as source:
                    reader = csv.DictReader(source, delimiter="\t", quoting=csv.QUOTE_NONE)
                    if not set(headers).issubset(reader.fieldnames or []):
                        raise ValueError(f"Invalid IMDb {name} header")
                    for row in reader:
                        identifier = row["tconst"]
                        if not IMDB_ID.fullmatch(identifier):
                            raise ValueError("Invalid IMDb title ID")
                        if name == "ratings":
                            score, votes = float(row["averageRating"]), int(row["numVotes"])
                            if not 0 < score <= 10 or votes < 1:
                                raise ValueError("Invalid IMDb rating")
                            values = (identifier, score, votes)
                        elif name == "episode":
                            values = (identifier, row["parentTconst"], None if row["seasonNumber"] == "\\N" else int(row["seasonNumber"]),
                                      None if row["episodeNumber"] == "\\N" else int(row["episodeNumber"]), identifier)
                        else:
                            if row["titleType"] not in ("tvSeries", "tvMiniSeries", "tvEpisode"):
                                continue
                            values = (identifier, row["primaryTitle"], row["originalTitle"], normalized_title(row["primaryTitle"]),
                                      normalized_title(row["originalTitle"]), row["titleType"],
                                      None if row["startYear"] == "\\N" else int(row["startYear"]), row["titleType"], identifier)
                        batch.append(values)
                        if len(batch) >= 5000:
                            with connection:
                                connection.executemany(statement, batch)
                            batch.clear()
                    if batch:
                        with connection:
                            connection.executemany(statement, batch)
            counts = {name: connection.execute(f"SELECT COUNT(*) FROM next_{name}").fetchone()[0] for name in ("ratings", "episodes", "titles")}
            if not all(counts.values()):
                raise ValueError("Empty IMDb dataset; previous index preserved")
            with self.lock, connection:
                connection.execute("BEGIN IMMEDIATE")
                for name in ("ratings", "episodes", "titles"):
                    connection.execute(f"DROP TABLE {name}")
                    connection.execute(f"ALTER TABLE next_{name} RENAME TO {name}")
                connection.execute("CREATE INDEX imdb_episode_parent ON episodes(parent_id, season, episode)")
                connection.execute("CREATE INDEX imdb_title_name ON titles(kind, normalized)")
                connection.execute("CREATE INDEX imdb_original_name ON titles(kind, original_normalized)")
                connection.executemany("INSERT OR REPLACE INTO settings VALUES (?, ?)", [
                    ("updated_at", datetime.now(timezone.utc).isoformat()),
                    ("ratings", str(counts["ratings"])), ("episodes", str(counts["episodes"]))])