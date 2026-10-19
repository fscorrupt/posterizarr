from plexapi.server import PlexServer
from typing import List

class PlexScanner:
    """
    Connects to Plex Media Server to identify shows in specified libraries
    and provide episode maps if Sonarr is unavailable.
    """
    def __init__(self, url: str, token: str):
        self.url = url
        self.token = token
        self._server = None

    def _connect(self):
        """Lazy-loaded connection to the Plex server."""
        if not self._server:
            try:
                self._server = PlexServer(self.url, self.token)
            except Exception as e:
                print(f"[Plex] Error connecting to Plex: {e}")
                return None
        return self._server

    def get_episode_map(self, title: str) -> dict:
        """
        Builds a mapping of {absolute_number: "SxxExx"} directly from Plex metadata.
        Used as a fallback when Sonarr is not available for a show.
        """
        server = self._connect()
        if not server:
            return {}

        try:
            # Search across the entire server for the show title
            results = server.search(title, mediatype='show')
            if not results:
                return {}
            
            # Select the most likely match (first result)
            selected_show = results[0]
            # Use episodes() to get a flat list of all episodes across all seasons
            ep_list = selected_show.episodes()
            
            # Sort episodes by season (parentIndex) and then episode (index)
            # Filter out season 0 (specials) if present
            standard_episodes = [e for e in ep_list if e.parentIndex > 0]
            standard_episodes.sort(key=lambda x: (x.parentIndex, x.index))
            
            mapping = {}
            for i, ep in enumerate(standard_episodes, 1):
                # i is the 1-based sequential absolute number
                s_e = f"S{ep.parentIndex:02d}E{ep.index:02d}"
                mapping[i] = s_e
            
            return mapping
        except Exception as e:
            print(f"[Plex] Error building fallback mapping for '{title}': {e}")
            return {}

    def get_shows_from_libraries(self, libraries: List[str]) -> List[str]:
        """
        Retrieves all show titles from a list of Plex library sections.
        """
        server = self._connect()
        if not server:
            return []

        show_titles = set()
        for lib_name in libraries:
            try:
                print(f"[Plex] Scanning library: {lib_name}")
                section = server.library.section(lib_name)
                for show in section.all():
                    show_titles.add(show.title)
            except Exception as e:
                print(f"[Plex] Error scanning library '{lib_name}': {e}")

        return list(show_titles)
