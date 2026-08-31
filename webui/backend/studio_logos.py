import os
import requests
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

# Fallback path if imported outside main
GITHUB_API_URL = "https://api.github.com/repos/PJGitHub9/simposter-assets/contents/logos"
RAW_BASE_URL = "https://raw.githubusercontent.com/PJGitHub9/simposter-assets/main/logos/"

def get_studio_logos(images_dir: Path):
    """
    Fetches the list of studio logos from the GitHub repository and caches them locally.
    Returns a list of dictionaries with 'name' and 'url' (local URL).
    """
    # The user explicitly asked for config_folder/cache/images/studio_logos
    # In main.py, IMAGES_DIR maps to config/Cache/images (or project_root/images locally)
    studio_logos_dir = images_dir / "studio_logos"
    
    # Ensure directory exists
    studio_logos_dir.mkdir(parents=True, exist_ok=True)
    
    cached_files = []
    
    # Try fetching the list of logos from GitHub
    try:
        response = requests.get(GITHUB_API_URL, timeout=10)
        
        if response.status_code == 200:
            github_files = response.json()
            
            # Filter for images
            image_files = [f for f in github_files if f.get("name", "").lower().endswith(('.png', '.jpg', '.jpeg'))]
            
            for file_info in image_files:
                file_name = file_info["name"]
                file_path = studio_logos_dir / file_name
                
                # If it doesn't exist locally, download it
                if not file_path.exists():
                    download_url = file_info.get("download_url") or f"{RAW_BASE_URL}{file_name}"
                    try:
                        logger.info(f"Downloading studio logo: {file_name}")
                        img_response = requests.get(download_url, timeout=10)
                        if img_response.status_code == 200:
                            with open(file_path, "wb") as f:
                                f.write(img_response.content)
                    except Exception as e:
                        logger.error(f"Failed to download {file_name}: {e}")
                        
        else:
            logger.warning(f"Failed to fetch studio logos list from GitHub. Status: {response.status_code}")
            
    except Exception as e:
        logger.error(f"Error fetching studio logos from GitHub: {e}")
        
    # Read local cache (always do this so even if GitHub fails, we have the cached ones)
    try:
        for file in studio_logos_dir.iterdir():
            if file.is_file() and file.name.lower().endswith(('.png', '.jpg', '.jpeg')):
                cached_files.append({
                    "name": file.stem,
                    "url": f"/api/studio-logos/image/{file.name}"
                })
    except Exception as e:
        logger.error(f"Error reading local studio logos directory: {e}")
        
    # Sort alphabetically
    cached_files.sort(key=lambda x: x["name"].lower())
    return cached_files
