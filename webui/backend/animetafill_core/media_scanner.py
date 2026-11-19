import asyncio
import os
import re
import time
import urllib.parse
from typing import List, Dict, Optional
import requests
import httpx

from animetafill_core.logger import logger
from silo_client import SiloClient

class MediaServerScanner:
    """
    Unified scanner supporting Plex, Jellyfin, Emby, and Silo media servers.
    Retrieves show lists from user-selected libraries and generates
    fallback episode mappings if Sonarr has no match.
    """
    def __init__(self, server_type: str = "plex", url: str = "", token: str = "", profile_id: Optional[str] = None):
        self.server_type = (server_type or "plex").lower().strip()
        self.url = (url or "").rstrip("/")
        self.token = (token or "").strip()
        self._plex_server = None
        self.profile_id = profile_id
        self._silo_shows = {}
        self._silo_episodes = {}
        self.last_library_scan_failed: bool = False
        self.last_episode_lookup_error: Optional[str] = None
        self._plex_show_keys: Dict[str, List[str]] = {}
        self._jf_show_ids: Dict[str, List[str]] = {}

    def _get_headers(self) -> Dict[str, str]:
        if self.server_type == "plex":
            return {"X-Plex-Token": self.token, "Accept": "application/json"}
        # Jellyfin / Emby
        return {
            "Authorization": f'MediaBrowser Token="{self.token}"',
            "X-Emby-Token": self.token,
            "Accept": "application/json"
        }

    # -------------------------------------------------------------
    # PLEX IMPLEMENTATION
    # -------------------------------------------------------------
    def _reset_plex_connection(self):
        """Close any cached Plex HTTP session so the next request opens a fresh socket."""
        if self._plex_server is not None:
            session = getattr(self._plex_server, "_session", None)
            if session is not None:
                try:
                    session.close()
                except Exception:
                    pass
            self._plex_server = None

    def _connect_plex(self):
        if not self.url or not self.token:
            logger.error(f"[Plex] Cannot connect to Plex: URL or token is missing (URL='{self.url}', Token={'***' if self.token else 'EMPTY'}).")
            return None
        if not self._plex_server:
            try:
                from plexapi.server import PlexServer
                self._plex_server = PlexServer(self.url, self.token, timeout=30)
            except Exception as e:
                logger.error(f"[Plex] Error connecting to Plex at {self.url}: {e}")
                return None
        return self._plex_server

    def _get_shows_plex(self, libraries: List[str]) -> List[str]:
        self._plex_show_keys = {}
        if not libraries:
            return []
        if not self._connect_plex():
            self.last_library_scan_failed = True
            return []

        show_titles = set()
        for lib_name in libraries:
            last_exc = None
            for attempt in range(2):
                try:
                    server = self._connect_plex()
                    if not server:
                        raise ConnectionError(f"Could not connect to Plex server while scanning '{lib_name}'")
                    if attempt == 0:
                        logger.info(f"[Plex] Scanning library: {lib_name}")
                    try:
                        section = server.library.section(lib_name)
                    except Exception:
                        sections = server.library.sections()
                        matching = [s for s in sections if s.title.strip().lower() == lib_name.strip().lower()]
                        if matching:
                            section = matching[0]
                        else:
                            raise
                    lib_titles = []
                    lib_keys = []
                    for show in section.all():
                        show_title = getattr(show, "title", None)
                        if not show_title:
                            continue
                        lib_titles.append(show_title)
                        rk = getattr(show, "ratingKey", None)
                        if rk is None or not str(rk).strip():
                            raw_key = getattr(show, "key", None)
                            if raw_key:
                                rk = str(raw_key).replace("/children", "").strip()
                        if rk is not None and str(rk).strip():
                            lib_keys.append((show_title.strip().lower(), str(rk).strip()))

                    for show_title in lib_titles:
                        show_titles.add(show_title)
                    for norm_title, rk_str in lib_keys:
                        keys = self._plex_show_keys.setdefault(norm_title, [])
                        if rk_str not in keys:
                            keys.append(rk_str)
                    last_exc = None
                    break
                except Exception as e:
                    last_exc = e
                    self._reset_plex_connection()
                    if attempt == 0:
                        logger.warning(f"[Plex] Library scan failed for '{lib_name}' ({e}); retrying with fresh connection...")
                        time.sleep(0.5)
            if last_exc is not None:
                logger.error(f"[Plex] Error scanning library '{lib_name}': {last_exc}")
                self.last_library_scan_failed = True

        return sorted(list(show_titles))

    def _get_episodes_plex(self, title: str) -> Dict[int, str]:
        norm_title = title.strip().lower()
        cached_keys = self._plex_show_keys.get(norm_title)
        max_attempts = 3
        retry_delays = (0.5, 1.5)
        last_exc: Optional[Exception] = None

        for attempt in range(max_attempts):
            try:
                server = self._connect_plex()
                if not server:
                    raise ConnectionError("Could not connect to Plex server")

                if cached_keys:
                    ep_list = []
                    for rk in cached_keys:
                        rk_str = str(rk)
                        ekey = f"{rk_str}/allLeaves" if rk_str.startswith("/") else f"/library/metadata/{rk_str}/allLeaves"
                        ep_list.extend(server.fetchItems(ekey))
                else:
                    results = server.search(title, mediatype='show')
                    if not results:
                        self.last_episode_lookup_error = None
                        return {}
                    exact_matches = [
                        r for r in results
                        if str(getattr(r, "title", "")).strip().lower() == norm_title
                    ]
                    selected_show = exact_matches[0] if exact_matches else results[0]
                    ep_list = selected_show.episodes()

                coordinates = set()
                for ep in ep_list:
                    s_num = getattr(ep, "parentIndex", None)
                    e_num = getattr(ep, "index", None)
                    if isinstance(s_num, int) and isinstance(e_num, int) and not isinstance(s_num, bool) and not isinstance(e_num, bool) and s_num > 0 and e_num > 0:
                        coordinates.add((s_num, e_num))

                mapping = {
                    i: f"S{s:02d}E{e:02d}"
                    for i, (s, e) in enumerate(sorted(coordinates), 1)
                }
                self.last_episode_lookup_error = None
                return mapping
            except Exception as e:
                last_exc = e
                self._reset_plex_connection()
                if attempt < max_attempts - 1:
                    delay = retry_delays[attempt]
                    logger.warning(f"[Plex] Attempt {attempt + 1}/{max_attempts} failed for '{title}' ({e}); retrying in {delay}s...")
                    time.sleep(delay)

        self.last_episode_lookup_error = str(last_exc) if last_exc is not None else "Unknown Plex error"
        logger.error(f"[Plex] Error building episode map for '{title}' after {max_attempts} attempts: {last_exc}")
        return {}

    # -------------------------------------------------------------
    # JELLYFIN / EMBY IMPLEMENTATION
    # -------------------------------------------------------------
    def _jf_get_with_retry(self, url: str, headers: Dict[str, str], timeout: int) -> requests.Response:
        """Perform a GET request with one retry on transient transport errors."""
        for attempt in range(2):
            try:
                return requests.get(url, headers=headers, timeout=timeout)
            except requests.RequestException:
                if attempt == 0:
                    time.sleep(0.5)
                    continue
                raise

    def _get_shows_jellyfin_emby(self, libraries: List[str]) -> List[str]:
        self._jf_show_ids = {}
        if not self.url or not self.token:
            logger.error(f"[{self.server_type.capitalize()}] URL or API key missing.")
            self.last_library_scan_failed = True
            return []

        headers = self._get_headers()
        show_titles = set()
        clean_libs = [l.strip().lower() for l in libraries if l.strip()]

        def _record_items(items: List[dict]):
            for it in items:
                name = it.get("Name")
                if not name:
                    continue
                show_titles.add(name)
                series_id = it.get("Id")
                if series_id:
                    ids = self._jf_show_ids.setdefault(name.strip().lower(), [])
                    if series_id not in ids:
                        ids.append(series_id)

        try:
            # Step 1: Discover folders / library IDs
            vf_resp = self._jf_get_with_retry(f"{self.url}/Library/VirtualFolders", headers, timeout=12)
            matched_folder_ids = []
            if vf_resp.status_code == 200:
                folders = vf_resp.json()
                for f in folders:
                    fname = f.get("Name", "")
                    fid = f.get("ItemId")
                    if not clean_libs or fname.lower() in clean_libs:
                        matched_folder_ids.append((fname, fid))
            else:
                logger.error(f"[{self.server_type.capitalize()}] VirtualFolders returned HTTP {vf_resp.status_code}")
                self.last_library_scan_failed = True

            # Step 2: Fetch Series per library folder
            if matched_folder_ids:
                for fname, fid in matched_folder_ids:
                    logger.info(f"[{self.server_type.capitalize()}] Scanning library: {fname}")
                    items_url = f"{self.url}/Items?ParentId={fid}&Recursive=true&IncludeItemTypes=Series&Fields=Name"
                    resp = self._jf_get_with_retry(items_url, headers, timeout=20)
                    if resp.status_code == 200:
                        _record_items(resp.json().get("Items", []))
                    else:
                        logger.error(f"[{self.server_type.capitalize()}] Library '{fname}' returned HTTP {resp.status_code}")
                        self.last_library_scan_failed = True
            else:
                # Fallback: Query all series recursively
                logger.info(f"[{self.server_type.capitalize()}] Querying all Series...")
                resp = self._jf_get_with_retry(
                    f"{self.url}/Items?Recursive=true&IncludeItemTypes=Series&Fields=Name",
                    headers,
                    timeout=20,
                )
                if resp.status_code == 200:
                    _record_items(resp.json().get("Items", []))
                else:
                    logger.error(f"[{self.server_type.capitalize()}] Series query returned HTTP {resp.status_code}")
                    self.last_library_scan_failed = True

        except Exception as e:
            logger.error(f"[{self.server_type.capitalize()}] Failed scanning libraries: {e}")
            self.last_library_scan_failed = True

        return sorted(list(show_titles))

    def _get_episodes_jellyfin_emby(self, title: str) -> Dict[int, str]:
        if not self.url or not self.token:
            self.last_episode_lookup_error = f"{self.server_type.capitalize()} URL or API key missing."
            return {}

        headers = self._get_headers()
        norm_title = title.strip().lower()
        try:
            series_ids = list(self._jf_show_ids.get(norm_title, []))
            if not series_ids:
                encoded_title = urllib.parse.quote(title)
                search_url = f"{self.url}/Items?SearchTerm={encoded_title}&IncludeItemTypes=Series&Recursive=true"
                s_resp = self._jf_get_with_retry(search_url, headers, timeout=10)
                if s_resp.status_code != 200:
                    self.last_episode_lookup_error = f"HTTP {s_resp.status_code} searching for '{title}'"
                    logger.error(f"[{self.server_type.capitalize()}] Search error for '{title}': HTTP {s_resp.status_code}")
                    return {}

                items = s_resp.json().get("Items", [])
                if not items:
                    return {}

                exact_matches = [
                    it for it in items
                    if str(it.get("Name") or "").strip().lower() == norm_title
                ]
                selected = exact_matches[0] if exact_matches else items[0]
                sid = selected.get("Id")
                if not sid:
                    return {}
                series_ids = [sid]

            coordinates = set()
            for series_id in series_ids:
                ep_url = f"{self.url}/Shows/{series_id}/Episodes"
                ep_resp = self._jf_get_with_retry(ep_url, headers, timeout=12)
                if ep_resp.status_code != 200:
                    self.last_episode_lookup_error = f"HTTP {ep_resp.status_code} fetching episodes for '{title}'"
                    logger.error(f"[{self.server_type.capitalize()}] Episode lookup HTTP {ep_resp.status_code} for '{title}'")
                    return {}

                for ep in ep_resp.json().get("Items", []):
                    s_num = ep.get("ParentIndexNumber") or 0
                    e_num = ep.get("IndexNumber") or 0
                    if isinstance(s_num, int) and isinstance(e_num, int) and s_num > 0 and e_num > 0:
                        coordinates.add((s_num, e_num))

            return {
                i: f"S{s_num:02d}E{e_num:02d}"
                for i, (s_num, e_num) in enumerate(sorted(coordinates), 1)
            }
        except Exception as e:
            self.last_episode_lookup_error = str(e)
            logger.error(f"[{self.server_type.capitalize()}] Episode lookup error for '{title}': {e}")
            return {}

    def _get_shows_silo(self, libraries: List[str]) -> List[str]:
        async def scan():
            async with httpx.AsyncClient(timeout=30) as client:
                silo = SiloClient(client, self.url, self.token, self.profile_id)
                selected = {name.strip().casefold() for name in libraries if name.strip()}
                shows = {}
                for library in await silo.libraries():
                    if library["type"] != "show" or (selected and library["name"].strip().casefold() not in selected):
                        continue
                    for row in await silo.catalog(library["id"], "show"):
                        title = row.get("title")
                        if title and row.get("content_id"):
                            shows.setdefault(title, set()).add((library["id"], str(row["content_id"])))
                return shows

        self._silo_shows = {}
        self._silo_episodes = {}
        try:
            self._silo_shows = asyncio.run(scan())
        except Exception as error:
            self.last_library_scan_failed = True
            logger.error(f"[Silo] Failed scanning libraries: {error}")
        return sorted(self._silo_shows)

    def _get_episodes_silo(self, title: str) -> Dict[int, str]:
        matches = self._silo_shows.get(title, set())
        if len({series_id for _, series_id in matches}) != 1:
            return {}

        async def scan():
            coordinates = set()
            async with httpx.AsyncClient(timeout=30) as client:
                silo = SiloClient(client, self.url, self.token, self.profile_id)
                for library_id, series_id in matches:
                    if library_id not in self._silo_episodes:
                        self._silo_episodes[library_id] = await silo.catalog(library_id, "episode")
                    for row in self._silo_episodes[library_id]:
                        if str(row.get("series_id")) != series_id:
                            continue
                        try:
                            season = int(row.get("season_number"))
                            episode = int(row.get("episode_number"))
                        except (TypeError, ValueError):
                            continue
                        if season > 0 and episode > 0:
                            coordinates.add((season, episode))
            return {index: f"S{season:02d}E{episode:02d}"
                    for index, (season, episode) in enumerate(sorted(coordinates), 1)}

        try:
            return asyncio.run(scan())
        except Exception as error:
            self.last_episode_lookup_error = str(error)
            logger.error(f"[Silo] Episode lookup error for '{title}': {error}")
            return {}

    # -------------------------------------------------------------
    # PUBLIC INTERFACE
    # -------------------------------------------------------------
    def get_shows_from_libraries(self, libraries: List[str]) -> List[str]:
        self.last_library_scan_failed = False
        if self.server_type == "plex":
            return self._get_shows_plex(libraries)
        elif self.server_type in ("jellyfin", "emby"):
            return self._get_shows_jellyfin_emby(libraries)
        elif self.server_type == "silo":
            return self._get_shows_silo(libraries)
        return []

    def get_episode_map(self, title: str) -> Dict[int, str]:
        self.last_episode_lookup_error = None
        if self.server_type == "plex":
            return self._get_episodes_plex(title)
        elif self.server_type in ("jellyfin", "emby"):
            return self._get_episodes_jellyfin_emby(title)
        elif self.server_type == "silo":
            return self._get_episodes_silo(title)
        return {}
