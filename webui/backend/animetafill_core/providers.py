import re
import time
import requests
from bs4 import BeautifulSoup
from dataclasses import dataclass
from enum import Enum
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from animetafill_core.logger import logger

class EpisodeCategory(Enum):
    """
    Standardized classification for anime episodes.
    """
    CANON = "canon"
    FILLER = "filler"
    MIXED = "mixed"
    UNKNOWN = "unknown"

    @classmethod
    def from_string(cls, value: str):
        """
        Parses a raw string from a provider (e.g., 'Manga Canon', 'Mixed Filler')
        into a standardized EpisodeCategory enum.
        """
        v = value.lower().strip()
        if "mixed" in v:
            return cls.MIXED
        if "filler" in v:
            return cls.FILLER
        if "canon" in v:
            return cls.CANON
        return cls.UNKNOWN

@dataclass
class EpisodeData:
    number: int
    title: str
    category: EpisodeCategory

class EpisodeSourceProvider(ABC):
    """
    Base class for anime data providers.
    """
    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Human-readable name of the provider."""
        pass

    @abstractmethod
    def fetch_episodes(self, anime_title: str, tvdb_id: Optional[int] = None) -> tuple[List[EpisodeData], bool]:
        """
        Fetches episode classification data.
        Returns a tuple of (List[EpisodeData], found_on_provider).
        """
        pass

    def _slugify(self, title: str) -> str:
        """
        Converts a title into a generic URL-friendly slug.
        Strips non-alphanumeric characters and replaces spaces with hyphens.
        """
        # Lowercase, alphanumeric + hyphens
        slug = title.lower()
        slug = re.sub(r'[^a-z0-9\s-]', '', slug)
        slug = re.sub(r'[\s]+', '-', slug)
        return slug.strip('-')


class AnimeFillerListProvider(EpisodeSourceProvider):
    """
    Provider for AnimeFillerList.com.
    Relies on aggressive slug-guessing since the site does not have a public API.
    """
    @property
    def provider_name(self) -> str:
        return "AnimeFillerListProvider"

    def _get_slug_variations(self, title: str) -> List[str]:
        """
        Generates multiple slug variations to try and match AFL's inconsistent URL patterns.
        AFL often uses literal characters (like ½) or suffixes (-2021) unpredictably.
        """
        # 0. Handle brackets and special cases first. Many Sonarr titles 
        # include anime type or group tags (e.g. 【OSHI NO KO】).
        cleaned_title = title.lower()
        cleaned_title = re.sub(r'[【】\[\]]', '', cleaned_title) # Remove brackets
        
        # 1. Standard alphanumeric slug. Corrected to [a-z0-9] as AFL uses numbers in URLs.
        slug1 = re.sub(r'[^a-z0-9\s-]', '', cleaned_title)
        slug1 = re.sub(r'[\s]+', '-', slug1).strip('-')
        
        variations = [slug1]
        
        # 2. Literal symbol variation (e.g., ranma-½)
        if '½' in title:
            slug_lit = re.sub(r'[^a-z0-9\s½-]', '', title.lower())
            slug_lit = re.sub(r'[\s]+', '-', slug_lit).strip('-')
            if slug_lit not in variations:
                variations.append(slug_lit)

        # 3. No subtitles: Everything after colon or dash removed
        if ':' in cleaned_title or ' - ' in cleaned_title:
            short_title = re.split(r'[:\-]', cleaned_title)[0].strip()
            slug2 = re.sub(r'[^a-z0-9\s-]', '', short_title)
            slug2 = re.sub(r'[\s]+', '-', slug2).strip('-')
            if slug2 and slug2 not in variations:
                variations.append(slug2)

        # 3. Removing common small words
        stop_words = {'is', 'a', 'the', 'of', 'to', 'in', 'and', 'for', 'with', 'on', 'at', 'by'}
        words = slug1.split('-')
        filtered_words = [w for w in words if w not in stop_words]
        if len(filtered_words) < len(words):
            slug3 = '-'.join(filtered_words)
            if slug3 and slug3 not in variations:
                variations.append(slug3)
                
        # 4. Handle years and specific suffixes (Safety: only if initial fails)
        # We don't want to try 7 years for every candidate.
        # Just try the most common -2021 and -series for the top candidates.
        for v in list(variations)[:2]: # Only for the most likely base slugs
            for suffix in ['-2021', '-series']:
                candidate = f"{v}{suffix}"
                if candidate not in variations:
                    variations.append(candidate)

        # Safety Cap: Never try more than 3 variations per candidate title to avoid bans
        return variations[:3]

    def fetch_episodes(self, anime_title: str, tvdb_id: Optional[int] = None) -> tuple[List[EpisodeData], bool, Optional[str]]:
        slug_variations = self._get_slug_variations(anime_title)
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        
        found_any_match = False
        for slug in slug_variations:
            url = f"https://www.animefillerlist.com/shows/{slug}"
            try:
                response = requests.get(url, headers=headers, timeout=10)
                if response.status_code == 404:
                    continue
                
                if response.status_code != 200:
                    continue
                
                found_any_match = True
                soup = BeautifulSoup(response.text, 'html.parser')
                table = soup.find('table', class_='EpisodeList')
                if not table:
                    # Found the page but maybe no episodes listed yet
                    continue
                
                episodes = []
                rows = table.find_all('tr')
                for row in rows:
                    cols = row.find_all('td')
                    if len(cols) < 4:
                        continue
                    
                    try:
                        number_str = cols[0].get_text(strip=True)
                        if not number_str.isdigit():
                            continue
                        number = int(number_str)
                        title = cols[1].get_text(strip=True)
                        type_str = cols[2].get_text(strip=True)
                        category = EpisodeCategory.from_string(type_str)
                        
                        episodes.append(EpisodeData(number=number, title=title, category=category))
                    except (ValueError, IndexError):
                        continue
                
                if episodes:
                    logger.success(f"Found {len(episodes)} episodes on AFL via '{slug}'")
                    return episodes, True, url
                    
            except Exception as e:
                continue
                
        return [], found_any_match, None

class SimklProvider(EpisodeSourceProvider):
    """
    Provider for Simkl.com.
    Uses its API for metadata and scrapes its web UI for filler lists.
    """
    def __init__(self, client_id: Optional[str] = None):
        self.client_id = client_id

    @property
    def provider_name(self) -> str:
        return "SimklProvider"

    def _get_simkl_info(self, title: str, tvdb_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Searches SIMKL for the anime and returns ID, slug, and episode count."""
        if not self.client_id:
            logger.warning("No SIMKL Client ID provided. Skipping SIMKL tier.")
            return None
            
        # 1. Try TVDB ID lookup first
        if tvdb_id:
            try:
                url = f"https://api.simkl.com/search/id?tvdb={tvdb_id}&client_id={self.client_id}"
                headers = {
                    "Content-Type": "application/json",
                    "simkl-api-key": self.client_id
                }
                response = requests.get(url, headers=headers, timeout=10)
                
                if response.status_code in [401, 403]:
                    logger.error(f"SIMKL API Authentication Failed ({response.status_code}). Check your client_id.")
                    return None
                    
                if response.status_code == 200:
                    data = response.json()
                    if data and isinstance(data, list) and len(data) > 0:
                        selected = data[0]
                        ids = selected.get('ids', {})
                        simkl_id = ids.get('simkl') or ids.get('simkl_id')
                        
                        if simkl_id:
                            logger.match("SIMKL", f"Matched via TVDB ID: {tvdb_id}")
                            return {
                                "id": simkl_id,
                                "slug": ids.get('slug', ''),
                                "eps": selected.get('eps', 0)
                            }
            except Exception as e:
                logger.error(f"SIMKL TVDB lookup error: {e}")

        # 2. Try anime search then tv search (Generic Fallback)
        for search_type in ["anime", "tv"]:
            try:
                url = f"https://api.simkl.com/search/{search_type}?q={requests.utils.quote(title)}&client_id={self.client_id}"
                headers = {
                    "Content-Type": "application/json",
                    "simkl-api-key": self.client_id
                }
                response = requests.get(url, headers=headers, timeout=10)
                
                if response.status_code in [401, 403]:
                    logger.error(f"SIMKL API Authentication Failed ({response.status_code}). Check your client_id.")
                    return None

                if response.status_code == 200:
                    data = response.json()
                    if data and isinstance(data, list) and len(data) > 0:
                        # Filter for anime if possible
                        selected = None
                        for item in data:
                            if item.get('type') == 'anime':
                                selected = item
                                break
                        if not selected:
                            selected = data[0]

                        logger.search("SIMKL", f"Found candidate: {selected.get('title')}")
                        ids = selected.get('ids', {})
                        simkl_id = ids.get('simkl_id') or ids.get('simkl')
                        
                        if simkl_id:
                            return {
                                "id": simkl_id,
                                "slug": ids.get('slug', ''),
                                "eps": selected.get('eps', 0)
                            }
            except Exception as e:
                continue
        return None

    def _parse_range(self, range_str: str) -> List[int]:
        """Expands range strings like '1-6, 8, 10-13' into [1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13]."""
        numbers = []
        if not range_str:
            return numbers
            
        parts = [p.strip() for p in range_str.split(',')]
        for part in parts:
            if '-' in part:
                try:
                    start, end = map(int, part.split('-'))
                    numbers.extend(range(start, end + 1))
                except ValueError:
                    continue
            else:
                try:
                    numbers.append(int(part))
                except ValueError:
                    continue
        return sorted(list(set(numbers)))

    def fetch_episodes(self, anime_title: str, tvdb_id: Optional[int] = None) -> tuple[List[EpisodeData], bool, Optional[str]]:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        
        info = self._get_simkl_info(anime_title, tvdb_id=tvdb_id)
        if not info:
            return [], False, None

        simkl_id = info['id']
        slug = info['slug']
        total_eps = info.get('eps', 0)
        
        # SIMKL URL structure: https://simkl.com/anime/{id}/{slug}/filler-list/
        url = f"https://simkl.com/anime/{simkl_id}/{slug}/filler-list/"
        
        try:
            response = requests.get(url, headers=headers, timeout=10)
            
            episodes = []
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                quick_items = soup.find('div', class_='fillerlistquickitems')
                
                if quick_items:
                    # SIMKL categories: Manga Canon, Mixed Canon/Filler, Filler
                    category_map = {
                        "Manga Canon Episodes:": EpisodeCategory.CANON,
                        "Mixed Canon/Filler Episodes:": EpisodeCategory.MIXED,
                        "Filler Episodes:": EpisodeCategory.FILLER,
                        "Anime Canon Episodes:": EpisodeCategory.CANON
                    }

                    blocks = quick_items.find_all('div', class_='fillerlistquickitem')
                    for block in blocks:
                        title_div = block.find('div', class_='fillerlistquickitemtitle')
                        numbers_div = block.find('div', class_='fillerlistquickitemnumbers')
                        
                        if title_div and numbers_div:
                            cat_text = title_div.get_text(strip=True)
                            category = category_map.get(cat_text, EpisodeCategory.UNKNOWN)
                            
                            if category != EpisodeCategory.UNKNOWN:
                                range_str = numbers_div.get_text(strip=True)
                                numbers = self._parse_range(range_str)
                                for num in numbers:
                                    episodes.append(EpisodeData(number=num, title=f"Episode {num}", category=category))

            # Smart Fallback: If no filler list found, but show has reported eps, assume 100% Canon
            if not episodes and total_eps > 0:
                logger.info(f"SIMKL: Show found but no 'Filler List' available. Proceeding with 100% Canon mapping ({total_eps} episodes).")
                for num in range(1, total_eps + 1):
                    episodes.append(EpisodeData(number=num, title=f"Episode {num}", category=EpisodeCategory.CANON))

            if episodes:
                logger.success(f"Successfully found {len(episodes)} episodes via SIMKL")
                return episodes, True, url

            return [], True, url # Found info but no eps found at all

        except Exception as e:
            logger.error(f"SIMKL Scrape error: {e}")
            
        return [], True, url # info was found even if scrape failed


