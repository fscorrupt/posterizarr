import asyncio
import json
import logging
from logging.handlers import RotatingFileHandler
import threading
from contextlib import closing
from datetime import datetime

import httpx
from xml.etree.ElementTree import fromstring

from ratings_service import ratings_cache, resolve_media_ratings, resolve_season_ratings, RatingsProviderRunState

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
        connection.commit()
        return connection

    def _save(self, state):
        with closing(self._connection()) as connection:
            with connection:
                connection.execute("INSERT OR REPLACE INTO ratings_refresh_job (id, state) VALUES (1, ?)", (json.dumps(state),))

    def status(self):
        with closing(self._connection()) as connection:
            row = connection.execute("SELECT state FROM ratings_refresh_job WHERE id = 1").fetchone()
        state = json.loads(row[0]) if row else {"running": False, "status": "idle"}
        if state.get("running") and (self.task is None or self.task.done()):
            state.update(running=False, status="interrupted", message="Refresh interrupted by backend restart", finished_at=datetime.utcnow().isoformat())
            self._save(state)
        return state

    def candidates(self, entry_id=None, include_missing=True, enabled_sources=None, include_seasons=False):
        episode_columns = {"imdb": "imdb_rating", "tmdb": "tmdb_rating"}
        sources = enabled_sources if enabled_sources is not None else ["imdb", "tmdb"]
        missing_episode_scores = " OR ".join(f"{column} IS NULL" for source, column in episode_columns.items() if source in sources) or "0"
        with closing(self.cache._get_connection()) as connection:
            if entry_id is not None:
                row = connection.execute("SELECT * FROM media_ratings_cache WHERE id = ?", (entry_id,)).fetchone()
                return [dict(row)] if row else []
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
        return list(candidates.values())

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
            items = await asyncio.to_thread(self.candidates, entry_id, state["trigger"] != "automatic", settings.get("rating_sources"), bool(settings.get("simkl_client_id")))
            state["total"] = len(items)
            self._save(state)
            async with httpx.AsyncClient(timeout=15.0) as client:
                for item in items:
                    state["current_title"] = item.get("title") or item["item_id"]
                    try:
                        result = await self._refresh_item(item, credentials, settings, client)
                        outcome = result["_refresh_status"]
                        details = {"providers": result.get("_providers", {})}
                        message = (result.get("_message") or "No fresh scores returned") if outcome == "failed" else "Some providers failed or returned no scores" if outcome == "partial" else None
                        if outcome == "failed" and item["media_type"] != "season" and not (item.get("imdb_id") or item.get("tmdb_id")):
                            message = "No native ratings or IMDb/TMDb IDs available from the media server"
                    except Exception as error:
                        outcome = "failed"
                        message = str(error) if isinstance(error, ValueError) and str(error).startswith(("Plex metadata HTTP", "Media server metadata HTTP", "Media server is disabled", "No movie")) else f"Metadata request failed ({type(error).__name__})"
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
        last_attempt = None
        while True:
            try:
                settings = await asyncio.to_thread(get_dynamic_overlays_settings)
                now = asyncio.get_running_loop().time()
                if settings.get("enabled") and settings.get("ratings_auto_refresh_enabled", True) and (last_attempt is None or now - last_attempt >= 3600):
                    credentials = await asyncio.to_thread(get_server_credentials, config_path)
                    result = await self.start(credentials, settings, trigger="automatic")
                    if result["success"]:
                        last_attempt = now
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