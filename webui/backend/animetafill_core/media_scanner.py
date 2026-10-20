import os
import re
import urllib.parse
from typing import List, Dict, Optional
import requests

try:
    from animetafill_core.logger import logger
except Exception:
    class DummyLogger:
        def info(self, m): print(f"[MediaScanner] {m}")
        def error(self, m): print(f"[MediaScanner ERROR] {m}")
        def success(self, m): print(f"[MediaScanner SUCCESS] {m}")
    logger = DummyLogger()

class MediaServerScanner:
    """
    Unified scanner supporting Plex, Jellyfin, and Emby media servers.
    Retrieves show lists from user-selected libraries and generates
    fallback episode mappings if Sonarr has no match.
    """
    def __init__(self, server_type: str = "plex", url: str = "", token: str = ""):
        self.server_type = (server_type or "plex").lower().strip()
        self.url = (url or "").rstrip("/")
        self.token = (token or "").strip()
        self._plex_server = None

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
    def _connect_plex(self):
        if not self.url or not self.token:
            logger.error(f"[Plex] Cannot connect to Plex: URL or token is missing (URL='{self.url}', Token={'***' if self.token else 'EMPTY'}).")
            return None
        if not self._plex_server:
            try:
                from plexapi.server import PlexServer
                self._plex_server = PlexServer(self.url, self.token)
            except Exception as e:
                logger.error(f"[Plex] Error connecting to Plex at {self.url}: {e}")
                return None
        return self._plex_server

    def _get_shows_plex(self, libraries: List[str]) -> List[str]:
        server = self._connect_plex()
        if not server:
            return []
        show_titles = set()
        for lib_name in libraries:
            try:
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
                for show in section.all():
                    if hasattr(show, "title") and show.title:
                        show_titles.add(show.title)
            except Exception as e:
                logger.error(f"[Plex] Error scanning library '{lib_name}': {e}")
        return sorted(list(show_titles))

    def _get_episodes_plex(self, title: str) -> Dict[int, str]:
        server = self._connect_plex()
        if not server:
            return {}
        try:
            results = server.search(title, mediatype='show')
            if not results:
                return {}
            selected_show = results[0]
            ep_list = selected_show.episodes()
            standard_episodes = [e for e in ep_list if getattr(e, 'parentIndex', 0) > 0]
            standard_episodes.sort(key=lambda x: (x.parentIndex, x.index))
            mapping = {}
            for i, ep in enumerate(standard_episodes, 1):
                mapping[i] = f"S{ep.parentIndex:02d}E{ep.index:02d}"
            return mapping
        except Exception as e:
            logger.error(f"[Plex] Error building episode map for '{title}': {e}")
            return {}

    # -------------------------------------------------------------
    # JELLYFIN / EMBY IMPLEMENTATION
    # -------------------------------------------------------------
    def _get_shows_jellyfin_emby(self, libraries: List[str]) -> List[str]:
        if not self.url or not self.token:
            logger.error(f"[{self.server_type.capitalize()}] URL or API key missing.")
            return []

        headers = self._get_headers()
        show_titles = set()
        clean_libs = [l.strip().lower() for l in libraries if l.strip()]

        try:
            # Step 1: Discover folders / library IDs
            vf_resp = requests.get(f"{self.url}/Library/VirtualFolders", headers=headers, timeout=12)
            matched_folder_ids = []
            if vf_resp.status_code == 200:
                folders = vf_resp.json()
                for f in folders:
                    fname = f.get("Name", "")
                    fid = f.get("ItemId")
                    if not clean_libs or fname.lower() in clean_libs:
                        matched_folder_ids.append((fname, fid))

            # Step 2: Fetch Series per library folder
            if matched_folder_ids:
                for fname, fid in matched_folder_ids:
                    logger.info(f"[{self.server_type.capitalize()}] Scanning library: {fname}")
                    items_url = f"{self.url}/Items?ParentId={fid}&Recursive=true&IncludeItemTypes=Series&Fields=Name"
                    resp = requests.get(items_url, headers=headers, timeout=20)
                    if resp.status_code == 200:
                        items = resp.json().get("Items", [])
                        for it in items:
                            name = it.get("Name")
                            if name:
                                show_titles.add(name)
            else:
                # Fallback: Query all series recursively
                logger.info(f"[{self.server_type.capitalize()}] Querying all Series...")
                resp = requests.get(f"{self.url}/Items?Recursive=true&IncludeItemTypes=Series&Fields=Name", headers=headers, timeout=20)
                if resp.status_code == 200:
                    for it in resp.json().get("Items", []):
                        if it.get("Name"):
                            show_titles.add(it["Name"])

        except Exception as e:
            logger.error(f"[{self.server_type.capitalize()}] Failed scanning libraries: {e}")

        return sorted(list(show_titles))

    def _get_episodes_jellyfin_emby(self, title: str) -> Dict[int, str]:
        if not self.url or not self.token:
            return {}

        headers = self._get_headers()
        try:
            encoded_title = urllib.parse.quote(title)
            search_url = f"{self.url}/Items?SearchTerm={encoded_title}&IncludeItemTypes=Series&Recursive=true"
            s_resp = requests.get(search_url, headers=headers, timeout=10)
            if s_resp.status_code != 200:
                return {}

            items = s_resp.json().get("Items", [])
            if not items:
                return {}

            series_id = items[0].get("Id")
            if not series_id:
                return {}

            ep_url = f"{self.url}/Shows/{series_id}/Episodes"
            ep_resp = requests.get(ep_url, headers=headers, timeout=12)
            if ep_resp.status_code != 200:
                return {}

            ep_list = ep_resp.json().get("Items", [])
            valid_eps = [
                e for e in ep_list
                if (e.get("ParentIndexNumber") or 0) > 0 and (e.get("IndexNumber") or 0) > 0
            ]
            valid_eps.sort(key=lambda x: (x.get("ParentIndexNumber", 0), x.get("IndexNumber", 0)))

            mapping = {}
            for i, ep in enumerate(valid_eps, 1):
                s_num = ep.get("ParentIndexNumber", 1)
                e_num = ep.get("IndexNumber", 1)
                mapping[i] = f"S{s_num:02d}E{e_num:02d}"
            return mapping
        except Exception as e:
            logger.error(f"[{self.server_type.capitalize()}] Episode lookup error for '{title}': {e}")
            return {}

    # -------------------------------------------------------------
    # PUBLIC INTERFACE
    # -------------------------------------------------------------
    def get_shows_from_libraries(self, libraries: List[str]) -> List[str]:
        if self.server_type == "plex":
            return self._get_shows_plex(libraries)
        elif self.server_type in ("jellyfin", "emby"):
            return self._get_shows_jellyfin_emby(libraries)
        return []

    def get_episode_map(self, title: str) -> Dict[int, str]:
        if self.server_type == "plex":
            return self._get_episodes_plex(title)
        elif self.server_type in ("jellyfin", "emby"):
            return self._get_episodes_jellyfin_emby(title)
        return {}
