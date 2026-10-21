import requests
import time
import yaml
import os
from bs4 import BeautifulSoup
from animetafill_core.database import AnimeDatabase
from animetafill_core.providers import AnimeFillerListProvider
from animetafill_core.logger import logger

def load_config():
    config_path = 'config.yml'
    if not os.path.exists(config_path):
        config_path = 'config.example.yml'

    with open(config_path, 'r') as f:
        return yaml.safe_load(f)

def scrape_all():
    config = load_config()
    db_path = config.get('database', {}).get('path', '/data/anime_data.db')
    db = AnimeDatabase(db_path)
    afl_provider = AnimeFillerListProvider()

    url = "https://www.animefillerlist.com/shows/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    try:
        logger.info(f"[Bootstrap] Fetching master show list from {url}...")
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')
        # Find all show links. Usually they are in <div class="Group"> or similar
        # Looking for links starting with /shows/
        show_links = soup.find_all('a', href=True)
        slugs = []
        for link in show_links:
            href = link['href']
            if href.startswith('/shows/') and len(href.split('/')) == 3:
                slug = href.split('/')[-1]
                if slug and slug not in slugs:
                    slugs.append(slug)

        logger.info(f"[Bootstrap] Found {len(slugs)} potential shows to scrape.")

        for i, slug in enumerate(slugs):
            logger.process(f"[Bootstrap] Processing show {i+1}/{len(slugs)}: {slug}")

            # Use the provider to fetch and parse
            # We use the slug as the "title" here because AFLProvider slugifies it anyway
            episodes = afl_provider.fetch_episodes(slug)

            if episodes:
                # Use a somewhat formatted title for the DB (replace hyphens with spaces and title case)
                guessed_title = slug.replace('-', ' ').title()
                db.upsert_episodes(guessed_title, episodes)
                logger.success(f"[Bootstrap] Successfully saved {len(episodes)} episodes for {guessed_title}.")
            else:
                logger.warning(f"[Bootstrap] No episodes found for {slug}.")

            # Respectful rate limiting
            time.sleep(2.0)

        # Export to JSON for the blueprint
        json_export_path = "/data/anime_database.json"
        db.export_to_json(json_export_path)
        logger.success("[Bootstrap] Mass scrape complete and exported to JSON.")

    except Exception as e:
        logger.error(f"[Bootstrap] Critical error during mass scrape: {e}")

if __name__ == "__main__":
    scrape_all()
