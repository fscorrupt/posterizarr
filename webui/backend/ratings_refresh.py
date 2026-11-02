import asyncio
import json
import logging
import hashlib
from logging.handlers import RotatingFileHandler
import threading
from contextlib import closing
from datetime import datetime, timedelta, timezone

import httpx
from xml.etree.ElementTree import fromstring

from ratings_service import (
    EPISODE_RATING_SOURCE_COLUMNS,
    ratings_cache,
    resolve_media_ratings,
    resolve_season_ratings,
    RatingsProviderRunState,
)

logger = logging.getLogger("ratings_refresh")


def configure_ratings_logging(log_directory):
    log_directory.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        log_directory / "RatingsRefresh.log", maxBytes=10 * 1024 * 1024,
        backupCount=1, encoding="utf-8",
    )
    handler.set_name("ratings_file")
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S",
    ))
    previous_handlers = set()
    for name in ("ratings_service", "ratings_refresh"):
        ratings_logger = logging.getLogger(name)
        for previous in list(ratings_logger.handlers):
            if previous.get_name() == "ratings_file":
                ratings_logger.removeHandler(previous)
                previous_handlers.add(previous)
        ratings_logger.addHandler(handler)
        ratings_logger.setLevel(logging.INFO)
    for previous in previous_handlers:
        previous.close()
    return handler


class RatingsRefreshService:
    def __init__(self, cache):
        self.cache = cache
        self.task = None
        self.periodic_task = None
        self.lock = threading.Lock()
        self.provider_run_state = None
        self.episode_parent_ids = {}
        self.season_parent_metadata = {}
        self.season_catalog_cache = {}

    def _connection(self):
        connection = self.cache._get_connection()
        connection.execute("CREATE TABLE IF NOT EXISTS ratings_refresh_job (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)")
        connection.execute("CREATE TABLE IF NOT EXISTS ratings_refresh_schedule (id INTEGER PRIMARY KEY CHECK (id = 1), last_attempt REAL NOT NULL)")
        connection.execute("CREATE TABLE IF NOT EXISTS ratings_refresh_retry (server_type TEXT NOT NULL, item_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (server_type, item_id))")
        connection.commit()
        return connection

    def _save(self, state):
        with closing(self._connection()) as connection:
            with connection:
                connection.execute("INSERT OR REPLACE INTO ratings_refresh_job (id, state) VALUES (1, ?)", (json.dumps(state),))

    def _schedule_now(self):
        return datetime.now(timezone.utc).timestamp()

    def _get_automatic_refresh_last_attempt(self):
        with closing(self._connection()) as connection:
            row = connection.execute("SELECT last_attempt FROM ratings_refresh_schedule WHERE id = 1").fetchone()
        return row[0] if row else None

    def _set_automatic_refresh_last_attempt(self, timestamp):
        with closing(self._connection()) as connection:
            with connection:
                connection.execute(
                    "INSERT OR REPLACE INTO ratings_refresh_schedule (id, last_attempt) VALUES (1, ?)",
                    (timestamp,),
                )

    def status(self):
        with closing(self._connection()) as connection:
            row = connection.execute("SELECT state FROM ratings_refresh_job WHERE id = 1").fetchone()
        state = json.loads(row[0]) if row else {"running": False, "status": "idle"}
        if state.get("running") and (self.task is None or self.task.done()):
            state.update(running=False, status="interrupted", message="Refresh interrupted by backend restart", finished_at=datetime.utcnow().isoformat())
            self._save(state)
        return state

    def _overlay_context(self, connection, item=None):
        available = {row[1] for row in connection.execute("PRAGMA table_info(dynamic_overlay_cache)")}
        if not {"server_type", "item_id", "asset_type"}.issubset(available):
            return {}
        columns = [name for name in ("server_type", "item_id", "asset_type", "library_name", "server_updated_at", "metadata_hash", "media_file_path") if name in available]
        query = f"SELECT {', '.join(columns)} FROM dynamic_overlay_cache WHERE asset_type IN ('poster', 'season', 'titlecard')"
        params = ()
        if item is not None:
            query += " AND server_type = ? AND item_id = ?"
            params = (item["server_type"], item["item_id"])
        return {(row["server_type"].lower(), str(row["item_id"]), row["asset_type"]): dict(row) for row in connection.execute(query, params)}

    def _enrich_candidate(self, item, context):
        asset = "season" if item.get("media_type") == "season" else "titlecard" if item.get("media_type") == "episode" else "poster"
        item["_overlay"] = context.get((item["server_type"].lower(), str(item["item_id"]), asset), {})
        item["library_name"] = item["_overlay"].get("library_name")
        return item

    def _retry_fingerprint(self, item, settings, credentials, mapping=None):
        provider_names = ("simkl_client_id",) if item.get("media_type") == "season" else (
            ("rating_sources", "omdb_api_key", "mdblist_api_key") if item.get("media_type") == "episode" else
            ("rating_sources", "simkl_client_id", "omdb_api_key", "mdblist_api_key")
        )
        provider_settings = {name: settings.get(name) for name in provider_names}
        provider_settings["server"] = credentials.get(item["server_type"])
        if item.get("media_type") != "season":
            provider_settings["tmdb_token"] = credentials.get("tmdb_token")
        digest = hashlib.sha256(json.dumps(provider_settings, sort_keys=True, default=str).encode("utf-8")).hexdigest()
        payload = {"type": item.get("media_type"), "imdb": item.get("imdb_id"), "tmdb": item.get("tmdb_id"),
                   "overlay": item.get("_overlay") or {}, "provider_context": digest,
                   "mapping": {key: (mapping or {}).get(key) for key in ("mode", "simkl_id", "mal_id", "tvdb_id", "episode_numbers")}}
        return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()

    def _apply_retry_policy(self, items, settings, credentials):
        now = datetime.utcnow().isoformat()
        with closing(self._connection()) as connection:
            retries = {(row["server_type"], row["item_id"]): json.loads(row["payload"]) for row in connection.execute("SELECT * FROM ratings_refresh_retry")}
            mappings = {}
            for row in connection.execute("SELECT server_type, item_id, payload FROM season_rating_mappings"):
                data = json.loads(row["payload"])
                mappings[(row["server_type"], row["item_id"])] = {key: data.get(key) for key in ("mode", "simkl_id", "mal_id", "tvdb_id", "episode_numbers")}
        eligible = []
        for item in items:
            key = (item["server_type"], str(item["item_id"]))
            retry = retries.get(key)
            if not retry or retry.get("fingerprint") != self._retry_fingerprint(item, settings, credentials, mappings.get(key)):
                eligible.append(item)
            elif retry.get("kind") == "hourly" or (retry.get("next_attempt_at") and retry["next_attempt_at"] <= now):
                eligible.append(item)
        return eligible

    def _record_retry_policy(self, item, settings, credentials, outcome, message, result):
        with closing(self._connection()) as connection:
            row = connection.execute("SELECT * FROM media_ratings_cache WHERE server_type = ? AND item_id = ?", (item["server_type"], str(item["item_id"]))).fetchone()
            if row is None:
                return
            stored = self._enrich_candidate(dict(row), self._overlay_context(connection, dict(row)))
            mapping = self.cache.get_season_mapping(item["server_type"], item["item_id"]) if stored["media_type"] == "season" else None
            selected = settings.get("rating_sources") if settings.get("rating_sources") is not None else ["imdb", "tmdb"]
            missing = any(source in selected and stored.get(column) is None for source, column in EPISODE_RATING_SOURCE_COLUMNS.items()) if stored["media_type"] == "episode" else (
                stored.get("simkl_rating") is None or stored.get("mal_rating") is None
            ) if stored["media_type"] == "season" else False
            if outcome != "failed" and not missing:
                with connection:
                    connection.execute("DELETE FROM ratings_refresh_retry WHERE server_type = ? AND item_id = ?", (item["server_type"], str(item["item_id"])))
                return
            now = datetime.utcnow()
            recent_episode = False
            try:
                age = now - datetime.fromisoformat(str(item.get("released_at") or "")[:10])
                recent_episode = stored["media_type"] == "episode" and timedelta(0) <= age <= timedelta(days=14)
            except ValueError:
                pass
            metadata_missing = str(message or "").endswith("HTTP 404") or "No native ratings or IMDb/TMDb IDs" in str(message or "")
            mapping_status = (mapping or {}).get("status")
            kind = "wait_for_change" if mapping_status == "ambiguous" else "hourly" if recent_episode and not metadata_missing else "daily"
            payload = {"kind": kind, "reason": message or "Missing selected provider scores", "attempted_at": now.isoformat(),
                       "next_attempt_at": (now + timedelta(days=1)).isoformat() if kind == "daily" else None,
                       "fingerprint": self._retry_fingerprint(stored, settings, credentials, mapping)}
            with connection:
                connection.execute("INSERT INTO ratings_refresh_retry VALUES (?, ?, ?) ON CONFLICT(server_type, item_id) DO UPDATE SET payload = excluded.payload",
                                   (item["server_type"], str(item["item_id"]), json.dumps(payload)))
            next_label = payload["next_attempt_at"] or ("next hourly run" if kind == "hourly" else "metadata/manual mapping change")
            logger.info("[RatingsRefresh] Retry %s %s: %s; next=%s", item["server_type"], item["item_id"], kind, next_label)

    def candidates(self, entry_id=None, include_missing=True, enabled_sources=None, include_seasons=False, settings=None, automatic=False, credentials=None):
        sources = enabled_sources if enabled_sources is not None else ["imdb", "tmdb"]
        episode_sources = sources if include_missing else [source for source in ("imdb", "tmdb") if source in sources]
        episode_columns = {source: EPISODE_RATING_SOURCE_COLUMNS[source] for source in episode_sources}
        missing_episode_scores = " OR ".join(f"{column} IS NULL" for source, column in episode_columns.items() if source in sources) or "0"
        with closing(self.cache._get_connection()) as connection:
            if entry_id is not None:
                row = connection.execute("SELECT * FROM media_ratings_cache WHERE id = ?", (entry_id,)).fetchone()
                return [self._enrich_candidate(dict(row), self._overlay_context(connection, dict(row)))] if row else []
            context = self._overlay_context(connection)
            rows = connection.execute(
                "SELECT * FROM media_ratings_cache WHERE (media_type IN ('movie', 'show', 'episode') OR (? AND media_type = 'season')) AND "
                f"(expires_at <= ? OR (media_type = 'episode' AND ({missing_episode_scores})) OR "
                "(media_type = 'season' AND (simkl_rating IS NULL OR mal_rating IS NULL))) ORDER BY id",
                (include_seasons, datetime.utcnow().isoformat())
            ).fetchall()
            candidates = {(row["server_type"], row["item_id"]): dict(row) for row in rows}
            exists = connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dynamic_overlay_cache'").fetchone()
            if exists:
                missing = connection.execute(
                    "SELECT DISTINCT overlay.server_type, overlay.item_id, overlay.media_type, overlay.item_title AS title "
                    "FROM dynamic_overlay_cache AS overlay LEFT JOIN media_ratings_cache AS ratings "
                    "ON ratings.server_type = overlay.server_type AND ratings.item_id = overlay.item_id "
                    "WHERE ratings.id IS NULL AND ("
                    "(overlay.asset_type = 'titlecard' AND overlay.media_type = 'episode') OR "
                    "(? AND overlay.asset_type = 'season' AND overlay.media_type = 'season') OR "
                    "(? AND overlay.asset_type = 'poster' AND overlay.media_type IN ('movie', 'show'))) ",
                    (include_seasons, include_missing)
                ).fetchall()
                for row in missing:
                    candidates[(row["server_type"], row["item_id"])] = dict(row)
        from dynamic_overlays_service import season_ratings_enabled_for_library
        result = []
        for item in candidates.values():
            self._enrich_candidate(item, context)
            if item.get("media_type") == "season" and not season_ratings_enabled_for_library(settings or {}, item.get("library_name")):
                continue
            result.append(item)
        return self._apply_retry_policy(result, settings or {}, credentials or {}) if automatic else result

    async def start(self, credentials, settings, entry_id=None, trigger="manual"):
        with self.lock:
            if self.task is not None and not self.task.done():
                return {"success": False, "error": "A ratings refresh is already running."}
            state = {"running": True, "status": "running", "trigger": trigger, "started_at": datetime.utcnow().isoformat(),
                     "finished_at": None, "total": 0, "completed": 0, "success": 0, "partial": 0, "failed": 0, "errors": []}
            self._save(state)
            self.task = asyncio.create_task(self._run(credentials, settings, entry_id, state))
        return {"success": True, "job": state.copy()}

    async def _episode_parent_tmdb_id(self, server, parent_id, server_config, client):
        key = (server, str(parent_id))
        if key in self.episode_parent_ids:
            return self.episode_parent_ids[key]
        tmdb_id = None
        try:
            if server == "plex":
                response = await client.get(
                    f"{server_config['url'].rstrip('/')}/library/metadata/{parent_id}",
                    headers={"X-Plex-Token": server_config.get("token") or "", "Accept": "application/xml"},
                    params={"includeGuids": "1"},
                )
                if response.status_code == 200:
                    root = fromstring(response.content)
                    node = root if root.tag == "Directory" else root.find("Directory")
                    if node is not None and node.get("type") == "show":
                        for guid in node.findall("Guid"):
                            value = guid.get("id", "")
                            if value.startswith("tmdb://"):
                                tmdb_id = value[7:]
                                break
            else:
                response = await client.get(
                    f"{server_config['url'].rstrip('/')}/Items/{parent_id}",
                    headers={"X-Emby-Token": server_config.get("api_key") or ""},
                    params={"Fields": "ProviderIds"},
                )
                if response.status_code == 200:
                    data = response.json()
                    if data.get("Type") == "Series":
                        tmdb_id = (data.get("ProviderIds") or {}).get("Tmdb")
        except Exception as error:
            logger.warning("[RatingsRefresh] Episode parent metadata unavailable (%s)", type(error).__name__)
        self.episode_parent_ids[key] = tmdb_id
        return tmdb_id

    async def _season_context(self, server, parent_id, season_id, server_config, client):
        key = (server, str(parent_id))
        if key not in self.season_parent_metadata:
            parent = {"id": str(parent_id)}
            if server == "plex":
                response = await client.get(f"{server_config['url'].rstrip('/')}/library/metadata/{parent_id}",
                    headers={"X-Plex-Token": server_config.get("token") or "", "Accept": "application/xml"}, params={"includeGuids": "1"})
                if response.status_code != 200:
                    raise ValueError(f"Plex metadata HTTP {response.status_code}")
                root = fromstring(response.content)
                node = root if root.tag == "Directory" else root.find("Directory")
                if node is None or node.get("type") != "show":
                    raise ValueError("No show metadata returned for season parent")
                parent["title"] = node.get("title")
                for guid in node.findall("Guid"):
                    identifier = str(guid.get("id") or "")
                    if identifier.startswith("tvdb://"):
                        parent["tvdb_id"] = identifier[7:]
            else:
                response = await client.get(f"{server_config['url'].rstrip('/')}/Items/{parent_id}",
                    headers={"X-Emby-Token": server_config.get("api_key") or ""}, params={"Fields": "ProviderIds"})
                if response.status_code != 200:
                    raise ValueError(f"Media server metadata HTTP {response.status_code}")
                data = response.json()
                if data.get("Type") != "Series":
                    raise ValueError("No show metadata returned for season parent")
                parent["title"] = data.get("Name")
                parent["tvdb_id"] = (data.get("ProviderIds") or {}).get("Tvdb")
            self.season_parent_metadata[key] = parent
        if server == "plex":
            response = await client.get(f"{server_config['url'].rstrip('/')}/library/metadata/{season_id}/children",
                headers={"X-Plex-Token": server_config.get("token") or "", "Accept": "application/xml"})
            if response.status_code != 200:
                raise ValueError(f"Plex metadata HTTP {response.status_code}")
            episodes = [int(node.get("index")) for node in fromstring(response.content).findall(".//Video") if str(node.get("index") or "").isdigit()]
        else:
            response = await client.get(f"{server_config['url'].rstrip('/')}/Shows/{parent_id}/Episodes",
                headers={"X-Emby-Token": server_config.get("api_key") or ""}, params={"SeasonId": str(season_id)})
            if response.status_code != 200:
                raise ValueError(f"Media server metadata HTTP {response.status_code}")
            episodes = [int(node["IndexNumber"]) for node in response.json().get("Items", []) if node.get("IndexNumber") is not None]
        return self.season_parent_metadata[key], episodes

    async def _refresh_item(self, item, credentials, settings, client):
        server = item["server_type"]
        server_config = credentials.get(server) or {}
        if not server_config.get("enabled") or not server_config.get("url"):
            raise ValueError("Media server is disabled or not configured")
        xml_bytes = None
        community_rating = None
        critic_rating = None
        season_number = None
        episode_number = None
        parent_id = None
        if server == "plex":
            response = await client.get(f"{server_config['url']}/library/metadata/{item['item_id']}",
                                        headers={"X-Plex-Token": server_config.get("token") or "", "Accept": "application/xml"},
                                        params={"includeGuids": "1"})
            if response.status_code != 200:
                raise ValueError(f"Plex metadata HTTP {response.status_code}")
            xml_bytes = response.content
            root = fromstring(xml_bytes)
            node = root if root.tag in ("Video", "Directory") else root.find("Video")
            if node is None:
                node = root.find("Directory")
            if node is None:
                raise ValueError("No movie, show or episode metadata returned")
            item.update(title=node.get("title") or item.get("title"), year=int(node.get("year")) if node.get("year") else item.get("year"),
                        media_type=node.get("type") if node.get("type") in ("movie", "show", "episode", "season") else ("show" if node.tag == "Directory" else "movie"))
            item["released_at"] = node.get("originallyAvailableAt")
            if item["media_type"] == "season":
                parent_id, season_number = node.get("parentRatingKey"), node.get("index")
            if item["media_type"] == "episode":
                item["imdb_id"] = item["tmdb_id"] = None
                season_number, episode_number = node.get("parentIndex"), node.get("index")
                parent_id = node.get("grandparentRatingKey")
            for guid in node.findall("Guid"):
                value = guid.get("id", "")
                if value.startswith("imdb://"):
                    item["imdb_id"] = value[7:]
                elif value.startswith("tmdb://") and item["media_type"] != "episode":
                    item["tmdb_id"] = value[7:]
                elif value.startswith("tvdb://"):
                    item["tvdb_id"] = value[7:]
        else:
            response = await client.get(f"{server_config['url']}/Items/{item['item_id']}",
                                        headers={"X-Emby-Token": server_config.get("api_key") or ""})
            if response.status_code != 200:
                raise ValueError(f"Media server metadata HTTP {response.status_code}")
            data = response.json()
            ids = data.get("ProviderIds") or {}
            item["released_at"] = data.get("PremiereDate")
            item["tvdb_id"] = ids.get("Tvdb")
            item.update(title=data.get("Name") or item.get("title"), year=data.get("ProductionYear") or item.get("year"),
                        imdb_id=ids.get("Imdb") or item.get("imdb_id"), tmdb_id=ids.get("Tmdb") or item.get("tmdb_id"),
                        media_type={"Movie": "movie", "Series": "show", "Episode": "episode", "Season": "season"}.get(data.get("Type"), item["media_type"]))
            if item["media_type"] == "season":
                parent_id, season_number = data.get("SeriesId"), data.get("IndexNumber")
            if item["media_type"] == "episode":
                item["imdb_id"], item["tmdb_id"] = ids.get("Imdb"), None
                season_number, episode_number = data.get("ParentIndexNumber"), data.get("IndexNumber")
                parent_id = data.get("SeriesId")
            community_rating, critic_rating = data.get("CommunityRating"), data.get("CriticRating")
        try:
            season_number = int(season_number) if season_number is not None else None
            episode_number = int(episode_number) if episode_number is not None else None
        except (TypeError, ValueError):
            season_number = episode_number = None
        if item["media_type"] == "season":
            from dynamic_overlays_service import season_ratings_enabled_for_library
            if not season_ratings_enabled_for_library(settings, item.get("library_name")):
                raise ValueError("Season library is not enabled for anime ratings")
            if parent_id is None or season_number is None:
                raise ValueError("No season parent or season number returned")
            parent, episodes = await self._season_context(server, parent_id, item["item_id"], server_config, client)
            if parent.get("title"):
                item["title"] = f"{parent['title']} S{season_number:02d}"
            return await resolve_season_ratings(server, item["item_id"], item.get("title") or str(item["item_id"]),
                parent, season_number, episodes, settings.get("simkl_client_id"), client, force_refresh=True,
                cache=self.cache, catalog_cache=self.season_catalog_cache)
        if item["media_type"] == "episode" and parent_id and credentials.get("tmdb_token") and season_number is not None and episode_number is not None:
            item["tmdb_id"] = await self._episode_parent_tmdb_id(server, parent_id, server_config, client)
        enabled_sources = settings.get("rating_sources")
        if item["media_type"] != "episode" and settings.get("simkl_client_id"):
            enabled_sources = list(enabled_sources) if enabled_sources is not None else ["imdb", "tmdb", "tomatoes", "tomatoesaudience"]
            for source in ("simkl", "mal"):
                if item.get(f"{source}_rating") is not None and source not in enabled_sources:
                    enabled_sources.append(source)
        return await resolve_media_ratings(
            server, item["item_id"], item.get("title") or item["item_id"], item.get("year"), item["media_type"],
            item.get("imdb_id"), item.get("tmdb_id"), plex_xml_bytes=xml_bytes,
            tmdb_api_key=credentials.get("tmdb_token"), mdblist_api_key=settings.get("mdblist_api_key"),
            omdb_api_key=settings.get("omdb_api_key"), enabled_sources=enabled_sources,
            client=client, force_refresh=True, server_community_rating=community_rating, server_critic_rating=critic_rating,
            season_number=season_number, episode_number=episode_number,
            simkl_client_id=settings.get("simkl_client_id"), tvdb_id=item.get("tvdb_id"),
            provider_run_state=self.provider_run_state,
        )

    async def _run(self, credentials, settings, entry_id, state):
        try:
            self.provider_run_state = RatingsProviderRunState()
            self.episode_parent_ids = {}
            self.season_parent_metadata = {}
            self.season_catalog_cache = {}
            unfiltered = await asyncio.to_thread(self.candidates, entry_id, state["trigger"] != "automatic", settings.get("rating_sources"), bool(settings.get("simkl_client_id")), settings)
            items = await asyncio.to_thread(self._apply_retry_policy, unfiltered, settings, credentials) if state["trigger"] == "automatic" and entry_id is None else unfiltered
            state["deferred"] = len(unfiltered) - len(items)
            if state["deferred"]:
                logger.info("[RatingsRefresh] Deferred %s candidates by retry policy", state["deferred"])
            if entry_id is not None and items and items[0].get("media_type") == "season":
                from dynamic_overlays_service import season_ratings_enabled_for_library
                if not season_ratings_enabled_for_library(settings, items[0].get("library_name")):
                    items = []
            state["total"] = len(items)
            self._save(state)
            async with httpx.AsyncClient(timeout=15.0) as client:
                for item in items:
                    state["current_title"] = item.get("title") or item["item_id"]
                    result = {}
                    try:
                        result = await self._refresh_item(item, credentials, settings, client)
                        outcome = result["_refresh_status"]
                        details = {"providers": result.get("_providers", {})}
                        message = (result.get("_message") or "No fresh scores returned") if outcome == "failed" else "Some providers failed or returned no scores" if outcome == "partial" else None
                        if outcome == "failed" and item["media_type"] != "season" and not (item.get("imdb_id") or item.get("tmdb_id")):
                            message = "No native ratings or IMDb/TMDb IDs available from the media server"
                    except Exception as error:
                        outcome = "failed"
                        message = str(error) if isinstance(error, ValueError) and str(error).startswith(("Plex metadata HTTP", "Media server metadata HTTP", "Media server is disabled", "No movie", "Season library")) else f"Metadata request failed ({type(error).__name__})"
                        details = {"message": message}
                    state["current_title"] = item.get("title") or item["item_id"]
                    logger.info("[RatingsRefresh] %s %s '%s': %s; %s", item["server_type"], item["item_id"],
                                state["current_title"], outcome, json.dumps({"message": message, **details}, sort_keys=True))
                    if outcome == "failed":
                        with closing(self.cache._get_connection()) as connection:
                            exists = connection.execute("SELECT 1 FROM media_ratings_cache WHERE server_type = ? AND item_id = ?", (item["server_type"], item["item_id"])).fetchone()
                        if not exists:
                            self.cache.save_ratings(item["server_type"], item["item_id"], item["media_type"], item.get("title"), item.get("year"),
                                                    item.get("imdb_id"), item.get("tmdb_id"), {}, ttl_days=-1)
                        self.cache.record_refresh(item["server_type"], item["item_id"], outcome, details)
                    with closing(self.cache._get_connection()) as connection:
                        with connection:
                            connection.execute(
                                "UPDATE media_ratings_cache SET title = ?, media_type = ? WHERE server_type = ? AND item_id = ?",
                                (item.get("title"), item["media_type"], item["server_type"], item["item_id"]),
                            )
                    await asyncio.to_thread(self._record_retry_policy, item, settings, credentials, outcome, message, result)
                    state[outcome] += 1
                    state["completed"] += 1
                    if message:
                        state["errors"] = (state["errors"] + [{"title": state["current_title"], "message": message, **details}])[-20:]
                    self._save(state)
            state["status"] = "failed" if state["failed"] and not (state["success"] or state["partial"]) else "partial" if state["failed"] or state["partial"] else "success"
        except asyncio.CancelledError:
            state.update(status="interrupted", message="Refresh interrupted")
            raise
        except Exception as error:
            state.update(status="failed", message=f"Refresh failed ({type(error).__name__})")
        finally:
            state.update(running=False, finished_at=datetime.utcnow().isoformat(), current_title=None)
            if self.provider_run_state is not None:
                state["omdb"] = self.provider_run_state.snapshot()
                logger.info("[RatingsRefresh] OMDb run summary: %s", json.dumps(state["omdb"], sort_keys=True))
            self._save(state)
            logger.info("[RatingsRefresh] %s: %s/%s completed; success=%s partial=%s failed=%s", state["status"], state["completed"], state["total"], state["success"], state["partial"], state["failed"])

    def start_periodic(self, config_path):
        if self.periodic_task is None or self.periodic_task.done():
            self.periodic_task = asyncio.create_task(self._periodic(config_path))

    async def _periodic(self, config_path):
        from dynamic_overlays_service import get_dynamic_overlays_settings
        from overlay_sync_service import get_server_credentials
        startup_checked = False
        while True:
            try:
                settings = await asyncio.to_thread(get_dynamic_overlays_settings)
                if settings.get("enabled") and settings.get("ratings_auto_refresh_enabled", True):
                    try:
                        interval_hours = int(settings.get("ratings_auto_refresh_interval_hours", 1))
                    except (TypeError, ValueError):
                        interval_hours = 1
                    interval_seconds = min(max(interval_hours, 1), 8760) * 3600
                    now = self._schedule_now()
                    last_attempt = await asyncio.to_thread(self._get_automatic_refresh_last_attempt)
                    if last_attempt is None:
                        await asyncio.to_thread(self._set_automatic_refresh_last_attempt, now)
                        logger.info("[RatingsRefresh] Automatic refresh scheduled in %s hours", interval_seconds // 3600)
                    elif now - last_attempt >= interval_seconds:
                        await asyncio.to_thread(self._set_automatic_refresh_last_attempt, now)
                        if startup_checked:
                            credentials = await asyncio.to_thread(get_server_credentials, config_path)
                            await self.start(credentials, settings, trigger="automatic")
                        else:
                            logger.info("[RatingsRefresh] Skipping overdue refresh during backend startup; next run in %s hours", interval_seconds // 3600)
                    startup_checked = True
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning("[RatingsRefresh] Automatic refresh failed (%s)", type(error).__name__)
            await asyncio.sleep(60)

    async def stop(self):
        for task in (self.periodic_task, self.task):
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass


ratings_refresh_service = RatingsRefreshService(ratings_cache)