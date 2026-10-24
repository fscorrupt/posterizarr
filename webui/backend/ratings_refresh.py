import asyncio
import json
import logging
import threading
from contextlib import closing
from datetime import datetime

import httpx
from xml.etree.ElementTree import fromstring

from ratings_service import ratings_cache, resolve_media_ratings

logger = logging.getLogger("ratings_refresh")


class RatingsRefreshService:
    def __init__(self, cache):
        self.cache = cache
        self.task = None
        self.periodic_task = None
        self.lock = threading.Lock()

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

    def candidates(self, entry_id=None, include_missing=True):
        with closing(self.cache._get_connection()) as connection:
            if entry_id is not None:
                row = connection.execute("SELECT * FROM media_ratings_cache WHERE id = ?", (entry_id,)).fetchone()
                return [dict(row)] if row else []
            rows = connection.execute(
                "SELECT * FROM media_ratings_cache WHERE media_type IN ('movie', 'show') AND expires_at <= ? ORDER BY id",
                (datetime.utcnow().isoformat(),)
            ).fetchall()
            candidates = {(row["server_type"], row["item_id"]): dict(row) for row in rows}
            exists = connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dynamic_overlay_cache'").fetchone()
            if exists and include_missing:
                missing = connection.execute(
                    "SELECT DISTINCT overlay.server_type, overlay.item_id, overlay.media_type, overlay.item_title AS title "
                    "FROM dynamic_overlay_cache AS overlay LEFT JOIN media_ratings_cache AS ratings "
                    "ON ratings.server_type = overlay.server_type AND ratings.item_id = overlay.item_id "
                    "WHERE overlay.asset_type = 'poster' AND overlay.media_type IN ('movie', 'show') AND ratings.id IS NULL"
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

    async def _refresh_item(self, item, credentials, settings, client):
        server = item["server_type"]
        server_config = credentials.get(server) or {}
        if not server_config.get("enabled") or not server_config.get("url"):
            raise ValueError("Media server is disabled or not configured")
        xml_bytes = None
        community_rating = None
        critic_rating = None
        if server == "plex":
            response = await client.get(f"{server_config['url']}/library/metadata/{item['item_id']}",
                                        headers={"X-Plex-Token": server_config.get("token") or "", "Accept": "application/xml"})
            if response.status_code != 200:
                raise ValueError(f"Plex metadata HTTP {response.status_code}")
            xml_bytes = response.content
            root = fromstring(xml_bytes)
            node = root.find("Video")
            if node is None:
                node = root.find("Directory")
            if node is None:
                raise ValueError("No movie or show metadata returned")
            item.update(title=node.get("title") or item.get("title"), year=int(node.get("year")) if node.get("year") else item.get("year"),
                        media_type=node.get("type") if node.get("type") in ("movie", "show") else ("show" if node.tag == "Directory" else "movie"))
            for guid in node.findall("Guid"):
                value = guid.get("id", "")
                if value.startswith("imdb://"):
                    item["imdb_id"] = value[7:]
                elif value.startswith("tmdb://"):
                    item["tmdb_id"] = value[7:]
        else:
            response = await client.get(f"{server_config['url']}/Items/{item['item_id']}",
                                        headers={"X-Emby-Token": server_config.get("api_key") or ""})
            if response.status_code != 200:
                raise ValueError(f"Media server metadata HTTP {response.status_code}")
            data = response.json()
            ids = data.get("ProviderIds") or {}
            item.update(title=data.get("Name") or item.get("title"), year=data.get("ProductionYear") or item.get("year"),
                        imdb_id=ids.get("Imdb") or item.get("imdb_id"), tmdb_id=ids.get("Tmdb") or item.get("tmdb_id"),
                        media_type={"Movie": "movie", "Series": "show"}.get(data.get("Type"), item["media_type"]))
            community_rating, critic_rating = data.get("CommunityRating"), data.get("CriticRating")
        return await resolve_media_ratings(
            server, item["item_id"], item.get("title") or item["item_id"], item.get("year"), item["media_type"],
            item.get("imdb_id"), item.get("tmdb_id"), plex_xml_bytes=xml_bytes,
            tmdb_api_key=credentials.get("tmdb_token"), mdblist_api_key=settings.get("mdblist_api_key"),
            omdb_api_key=settings.get("omdb_api_key"), enabled_sources=settings.get("rating_sources"),
            client=client, force_refresh=True, server_community_rating=community_rating, server_critic_rating=critic_rating,
        )

    async def _run(self, credentials, settings, entry_id, state):
        try:
            items = await asyncio.to_thread(self.candidates, entry_id, state["trigger"] != "automatic")
            state["total"] = len(items)
            self._save(state)
            async with httpx.AsyncClient(timeout=15.0) as client:
                for item in items:
                    state["current_title"] = item.get("title") or item["item_id"]
                    try:
                        result = await self._refresh_item(item, credentials, settings, client)
                        outcome = result["_refresh_status"]
                        details = {"providers": result.get("_providers", {})}
                        message = "No fresh scores returned" if outcome == "failed" else "Some providers failed or returned no scores" if outcome == "partial" else None
                        if outcome == "failed" and not (item.get("imdb_id") or item.get("tmdb_id")):
                            message = "No native ratings or IMDb/TMDb IDs available from the media server"
                    except Exception as error:
                        outcome = "failed"
                        message = str(error) if isinstance(error, ValueError) and str(error).startswith(("Plex metadata HTTP", "Media server metadata HTTP", "Media server is disabled", "No movie or show")) else f"Metadata request failed ({type(error).__name__})"
                        details = {"message": message}
                    state["current_title"] = item.get("title") or item["item_id"]
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