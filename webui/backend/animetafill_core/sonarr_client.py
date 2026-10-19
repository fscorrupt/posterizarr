import requests
import re
import difflib
import time
from typing import List, Dict, Optional, Any
from animetafill_core.logger import logger

class SonarrTranslator:
    """
    Interfaces with Sonarr's API to translate show titles into IDs and
    create mappings between absolute episode numbers and SxxExx formats.
    """
    def __init__(self, url: Optional[str] = None, api_key: Optional[str] = None):
        self.url = (url or "").strip().rstrip('/')
        self.api_key = (api_key or "").strip()
        self.headers = {"X-Api-Key": self.api_key} if self.api_key else {}
        self.is_enabled = bool(self.url and self.api_key)
        self._series_cache: Optional[List[Dict[str, Any]]] = None
        self._series_cache_time: float = 0
        self._episode_cache: Dict[int, tuple] = {}

    def _clean_title(self, title: str) -> str:
        """
        Removes noise from titles to improve matching accuracy. 
        Standardizes punctuation and strips seasonal suffixes that often 
        cause mismatches between Plex and Sonarr metadata.
        """
        # Lowercase and handle common dash differences
        cleaned = title.lower().replace('–', '-').replace('—', '-')
        # Remove years in parentheses
        cleaned = re.sub(r'\s\(\d{4}\)$', '', cleaned)
        # Remove anything after 'season X' to avoid mismatches
        cleaned = re.sub(r'\s-?\s?season\s\d+.*$', '', cleaned)
        # Normalize: keep only alphanumeric and standard spaces/dashes
        cleaned = re.sub(r'[^a-z0-9\s-]', ' ', cleaned)
        # Collapse multiple spaces
        cleaned = re.sub(r'\s+', ' ', cleaned)
        return cleaned.strip()

    def get_series_info(self, title: str) -> Optional[Dict[str, Any]]:
        """
        Retrieves series metadata (ID, TVDB ID, Status, Alt Titles) from Sonarr.
        
        Uses a two-layer matching strategy:
        1. Cleaned exact match against the main title, sort title, and all alt titles.
        2. Fuzzy match (difflib) as a fallback for subtle naming differences.
        """
        if not self.is_enabled:
            return None
        try:
            cleaned_target = self._clean_title(title)
            
            now = time.time()
            if self._series_cache is None or (now - self._series_cache_time > 300):
                response = requests.get(
                    f"{self.url}/api/v3/series",
                    headers=self.headers,
                    timeout=15
                )
                response.raise_for_status()
                self._series_cache = response.json()
                self._series_cache_time = now
            series_list = self._series_cache
            
            candidate_list = []
            
            for series in series_list:
                s_titles = [
                    series.get('title', ''),
                    series.get('sortTitle', '')
                ]
                # Also check alternate titles
                if 'alternateTitles' in series:
                    for alt in series['alternateTitles']:
                        s_titles.append(alt.get('title', ''))
                
                for s_title in s_titles:
                    c_s_title = self._clean_title(s_title)
                    # 1. Exact match after cleaning both
                    if cleaned_target == c_s_title:
                        return {
                            "id": series['id'],
                            "tvdb_id": series.get('tvdbId'),
                            "status": series['status'],
                            "genres": series.get('genres', []),
                            "alternate_titles": [series.get('title', '')] + [alt.get('title', '') for alt in series.get('alternateTitles', [])]
                        }
                    
                    # Store candidate for fuzzy fallback
                    if c_s_title and c_s_title not in candidate_list:
                        candidate_list.append(c_s_title)

            # 2. Fuzzy fallback if no exact clean match
            best_matches = difflib.get_close_matches(cleaned_target, candidate_list, n=1, cutoff=0.85)
            if best_matches:
                best_c_title = best_matches[0]
                # Find the series ID for this candidate
                for series in series_list:
                    check_titles = [series.get('title', ''), series.get('sortTitle', '')]
                    if 'alternateTitles' in series:
                        check_titles.extend([alt.get('title', '') for alt in series['alternateTitles']])
                    
                    if any(self._clean_title(t) == best_c_title for t in check_titles):
                        logger.search("Sonarr", f"Fuzzy match: '{title}' -> '{series.get('title')}'")
                        return {
                            "id": series['id'],
                            "tvdb_id": series.get('tvdbId'),
                            "status": series['status'],
                            "genres": series.get('genres', []),
                            "alternate_titles": [series.get('title', '')] + [alt.get('title', '') for alt in series.get('alternateTitles', [])]
                        }
                    
            return None
        except Exception as e:
            logger.error(f"Sonarr search error: {e}")
            return None

    def _normalize_title(self, title: str) -> str:
        """
        Strips all punctuation, spaces, and casing to create a 
        high-confidence mapping key for title-based matching.
        """
        if not title: return ""
        return re.sub(r'[^a-z0-9]', '', title.lower())

    def get_absolute_to_season_map(self, series_id: int) -> tuple[Dict[int, str], Dict[str, str]]:
        """
        Maps episodes to SxxExx using two keys:
        1. Absolute Number (Primary)
        2. Normalized Title (Fallback for Specials/Shifts)
        
        Returns: (abs_map, title_map)
        """
        if not self.is_enabled:
            return {}, {}
        if series_id in self._episode_cache:
            return self._episode_cache[series_id]
        try:
            response = requests.get(
                f"{self.url}/api/v3/episode",
                params={"seriesId": series_id},
                headers=self.headers,
                timeout=10
            )
            response.raise_for_status()
            episodes = response.json()
            
            # Note: Calculation ONLY applies to standard seasons to maintain linear stability.
            standard_episodes = sorted([ep for ep in episodes if ep.get('seasonNumber', 0) > 0], key=lambda x: (x['seasonNumber'], x['episodeNumber']))
            all_episodes = sorted(episodes, key=lambda x: (x['seasonNumber'], x['episodeNumber']))

            abs_map = {}
            title_map = {}
            
            # Phase 1: Sequential calculation for standard seasons
            calculated_abs = 1
            last_actual_abs = 0
            
            for ep in standard_episodes:
                season = ep['seasonNumber']
                episode_num = ep['episodeNumber']
                s_e_format = f"S{season:02d}E{episode_num:02d}"
                
                # Check if Sonarr already has an absolute number
                actual_abs = ep.get('absoluteEpisodeNumber', 0)
                
                # Detect and handle absolute number resets across seasons.
                if actual_abs > 0 and actual_abs <= last_actual_abs:
                    actual_abs = 0 
                
                mapping_abs = actual_abs if actual_abs > 0 else calculated_abs
                abs_map[mapping_abs] = s_e_format
                
                if actual_abs > 0:
                    last_actual_abs = actual_abs
                
                calculated_abs += 1
            
            # Phase 2: Title & Explicit Mapping for ALL episodes (including Specials/Season 0)
            for ep in all_episodes:
                season = ep['seasonNumber']
                episode_num = ep['episodeNumber']
                s_e_format = f"S{season:02d}E{episode_num:02d}"
                actual_abs = ep.get('absoluteEpisodeNumber', 0)
                title = ep.get('title', '')
                
                # 1. Build Title Map for fallback matching
                if title:
                    norm_title = self._normalize_title(title)
                    title_map[norm_title] = s_e_format
                
                # 2. Add Specials to ABS map if they have explicit numbering
                if season == 0 and actual_abs > 0:
                    abs_map[actual_abs] = s_e_format

            logger.info(f"Sonarr mapping created: {len(abs_map)} numeric, {len(title_map)} titles.")
            self._episode_cache[series_id] = (abs_map, title_map)
            return abs_map, title_map
        except Exception as e:
            logger.error(f"Error creating mapping for series {series_id}: {e}")
            return {}, {}
