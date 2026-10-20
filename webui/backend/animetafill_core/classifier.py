import re
import time
from typing import Optional, List
from animetafill_core.database import AnimeDatabase
from animetafill_core.providers import AnimeFillerListProvider, SimklProvider
from animetafill_core.logger import logger

class EpisodeClassifierService:
    """
    Coordinates the classification of anime episodes by querying data providers 
    (SIMKL, AnimeFillerList) using a fallback priority system.
    """
    def __init__(
        self, 
        db: AnimeDatabase, 
        afl_provider: AnimeFillerListProvider,
        simkl_provider: SimklProvider
    ):
        self.db = db
        self.afl_provider = afl_provider
        self.simkl_provider = simkl_provider

    def _clean_seasonal_noise(self, title: str) -> str:
        """
        Strips common seasonal suffixes (S2, Season 2, Part 2, etc.) to normalize
        titles. This prevents redundant API calls for shows that are indexed 
        under a single main title on filler databases.
        """
        # Patterns for S2, Season 2, 2nd Season, Part 2, etc.
        patterns = [
            r'\s+S\d+$',
            r'\s+Season\s+\d+$',
            r'\s+Part\s+\d+$',
            r'\s+Cour\s+\d+$',
            r'\s+\d+(st|nd|rd|th)\s+Season$',
            r'\s+\(\d{4}\)$' # Also strip years in parens here if not already handled
        ]
        cleaned = title.strip()
        for p in patterns:
            cleaned = re.sub(p, '', cleaned, flags=re.IGNORECASE)
        return cleaned.strip()

    def force_update_mapping(self, title_candidates: List[str], tvdb_id: Optional[int] = None, expected_count: int = 0):
        """
        Synchronizes episode classification data for a show across all tiers.
        
        The strategy follows a 3-tier approach:
        1. TVDB ID Matching (SIMKL)
        2. Broad Title-based searching (SIMKL -> AFL)
        3. 100% Canon Fallback (Safe assumption if providers return no data)
        """
        main_title = title_candidates[0]
        
        # Deduplicate titles while preserving order. Pre-cleaning titles here 
        # ensures we don't waste API calls on titles like "Show" and "Show S2".
        unique_candidates = []
        seen_normalized = set()
        for t in title_candidates:
            t_clean = self._clean_seasonal_noise(t)
            norm = t_clean.lower()
            if norm and norm not in seen_normalized:
                unique_candidates.append(t_clean)
                seen_normalized.add(norm)
        
        # Limit candidates to the top 10 most likely variations.
        title_candidates = unique_candidates[:10]
        
        episodes = []
        source_url = None
        show_found_on_any = False
        had_provider_error = False

        # --- PHASE 1: TVDB ID Match (SIMKL) ---
        if tvdb_id:
            logger.process(f"Looking up TVDB ID: {tvdb_id}...")
            try:
                # Note: Pass the main title for logging, but the actual lookup uses the ID
                eps, found, url = self.simkl_provider.fetch_episodes(main_title, tvdb_id=tvdb_id)
                if found: 
                    show_found_on_any = True
                    source_url = url
                    # If ID match is found, we are sure of the show. 
                    # If it has episodes, we are done.
                    if eps:
                        episodes = eps
                        # Break and move to DB update
                    else:
                        # We found the show but no filler data. 
                        # We can still check AFL for filler list, but we don't need 
                        # to keep searching SIMKL with alternate titles.
                        logger.info(f"Show found on SIMKL via ID, but no filler list found. Checking AFL fallback...")
                
                if episodes:
                    # Found episodes via TVDB ID match. No need for more API calls.
                    # We can skip the Title Search phase entirely.
                    title_candidates = [] 
            except Exception as e:
                logger.error(f"SIMKL ID lookup error: {e}")
                had_provider_error = True

        # --- PHASE 2: Title Candidate Search (SIMKL -> AFL) ---
        for title in title_candidates:
            # Try SIMKL ONLY if we haven't already pinpointed the show on SIMKL via ID
            # (If show_found_on_any is True and we came from ID phase, we skip SIMKL title searching)
            if not show_found_on_any:
                logger.process(f"Searching SIMKL for '{title}'...")
                try:
                    # Pass tvdb_id=None here because we already tried the ID lookup above
                    eps, found, url = self.simkl_provider.fetch_episodes(title, tvdb_id=None)
                    if found: 
                        show_found_on_any = True
                        source_url = url
                    if eps:
                        episodes = eps
                        break
                except Exception as e:
                    logger.error(f"SIMKL error for {title}: {e}")
                    had_provider_error = True
            
            # Anti-ban sleep
            time.sleep(2.0)

            # Try AnimeFillerList - Fallback Scraper
            logger.process(f"Searching AFL for '{title}'...")
            try:
                eps, found, url = self.afl_provider.fetch_episodes(title, tvdb_id=tvdb_id)
                if found: 
                    show_found_on_any = True
                    source_url = url
                if eps:
                    episodes = eps
                    break
            except Exception as e:
                logger.error(f"AFL error for {title}: {e}")
                had_provider_error = True
            
            # Mandatory anti-ban delay if all providers failed for this title
            time.sleep(2.5)

        # Step 4: Canon Fallback
        # Per user feedback: Default to 100% Canon if search returns nothing,
        # but skip if there was a technical error to avoid incorrect mappings.
        if not episodes and not had_provider_error and expected_count > 0:
            logger.info(f"No filler data found for {main_title} after searching all providers. Assuming 100% Canon ({expected_count} episodes).")
            from animetafill_core.providers import EpisodeData, EpisodeCategory
            episodes = [
                EpisodeData(number=i, title=f"Episode {i}", category=EpisodeCategory.CANON)
                for i in range(1, expected_count + 1)
            ]
            source_url = "Calculated Fallback (Canon)"
        elif not episodes and had_provider_error:
            logger.warning(f"Technical errors occurred during search for {main_title}. Skipping fallback to prevent incorrect mapping.")

        # Step 3: Upsert to DB (Tier 1)
        if episodes:
            print(f"[Classifier] Successfully found {len(episodes)} episodes. Updating local DB...")
            self.db.upsert_episodes(main_title, episodes, source_url=source_url)
            return True, source_url
        else:
            print(f"[Classifier] Failed to find any episode data for {main_title} in all tiers.")
            return False, None
