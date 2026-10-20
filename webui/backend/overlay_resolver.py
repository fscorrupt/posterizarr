"""
Dynamic Overlays Configuration & Asset Resolver for Posterizarr.
Handles:
1. Secure path resolution (blocking path traversal, null bytes, disallowed extensions).
2. Parsing YAML configs from Overlayfiles/dynamic_overlays/configs/.
3. Extracting and validating asset dependencies (fonts, images, default templates).
4. Direct fetching of official default overlay templates from repository sources.
5. On-demand safe fetching of missing assets from official repositories.
"""

import os
import re
import yaml
import shutil
import logging
import asyncio
import socket
import ipaddress
import urllib.parse
from pathlib import Path
from typing import Optional, Dict, Any, List, Set, Union, Tuple
import httpx

# ==============================================================================
# DYNAMIC OVERLAY RESOLUTION ENGINE:
# Handles template resolution, coordinate placement, asset fetching, and layout.
# ==============================================================================

logger = logging.getLogger("overlay_resolver")
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

ALLOWED_CONFIG_EXTS = {".yml", ".yaml"}
ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_FONT_EXTS = {".ttf", ".otf"}
ALLOWED_ALL_EXTS = ALLOWED_CONFIG_EXTS | ALLOWED_IMAGE_EXTS | ALLOWED_FONT_EXTS

OVERLAY_TEMPLATES_RAW = "https://raw.githubusercontent.com/Kometa-Team/Kometa/master"
KOMETA_GITHUB_RAW = OVERLAY_TEMPLATES_RAW
KOMETA_IMAGES_RAW = f"{KOMETA_GITHUB_RAW}/defaults/overlays/images"

# Official fonts shipped in the Kometa repository (https://github.com/Kometa-Team/Kometa/tree/master/fonts)
OFFICIAL_KOMETA_FONTS = {
    "Arimo-Bold.ttf", "Arimo-BoldItalic.ttf", "Arimo-Italic.ttf", "Arimo-Medium.ttf",
    "Arimo-MediumItalic.ttf", "Arimo-Regular.ttf", "Arimo-SemiBold.ttf", "Arimo-SemiBoldItalic.ttf",
    "Comfortaa-Bold.ttf", "Comfortaa-Light.ttf", "Comfortaa-Medium.ttf", "Comfortaa-Regular.ttf",
    "Comfortaa-SemiBold.ttf", "Consensus-Bold.otf", "Consensus-ExtraLight.otf", "Consensus-Light.otf",
    "Consensus-Medium.otf", "Consensus-Regular.otf", "Consensus-SemiBold.otf", "Consensus-Thin.otf",
    "Figtree-Black.ttf", "Figtree-BlackItalic.ttf", "Figtree-Bold.ttf", "Figtree-BoldItalic.ttf",
    "Figtree-ExtraBold.ttf", "Figtree-ExtraBoldItalic.ttf", "Figtree-Italic.ttf", "Figtree-Light.ttf",
    "Figtree-LightItalic.ttf", "Figtree-Medium.ttf", "Figtree-MediumItalic.ttf", "Figtree-Regular.ttf",
    "Figtree-SemiBold.ttf", "Figtree-SemiBoldItalic.ttf", "Inter-Black.ttf", "Inter-Bold.ttf",
    "Inter-ExtraBold.ttf", "Inter-ExtraLight.ttf", "Inter-Light.ttf", "Inter-Medium.ttf",
    "Inter-Regular.ttf", "Inter-SemiBold.ttf", "Inter-Thin.ttf", "Lato-Black.ttf",
    "Lato-BlackItalic.ttf", "Lato-Bold.ttf", "Lato-BoldItalic.ttf", "Lato-Italic.ttf",
    "Lato-Light.ttf", "Lato-LightItalic.ttf", "Lato-Regular.ttf", "Lato-Thin.ttf",
    "Lato-ThinItalic.ttf", "LibreFranklin-Black.ttf", "LibreFranklin-BlackItalic.ttf",
    "LibreFranklin-Bold.ttf", "LibreFranklin-BoldItalic.ttf", "LibreFranklin-ExtraBold.ttf",
    "LibreFranklin-ExtraBoldItalic.ttf", "LibreFranklin-ExtraLight.ttf", "LibreFranklin-ExtraLightItalic.ttf",
    "LibreFranklin-Italic.ttf", "LibreFranklin-Light.ttf", "LibreFranklin-LightItalic.ttf",
    "LibreFranklin-Medium.ttf", "LibreFranklin-MediumItalic.ttf", "LibreFranklin-Regular.ttf",
    "LibreFranklin-SemiBold.ttf", "LibreFranklin-SemiBoldItalic.ttf", "LibreFranklin-Thin.ttf",
    "LibreFranklin-ThinItalic.ttf", "Montserrat-Black.ttf", "Montserrat-BlackItalic.ttf",
    "Montserrat-Bold.ttf", "Montserrat-BoldItalic.ttf", "Montserrat-ExtraBold.ttf",
    "Montserrat-ExtraBoldItalic.ttf", "Montserrat-ExtraLight.ttf", "Montserrat-ExtraLightItalic.ttf",
    "Montserrat-Italic.ttf", "Montserrat-Light.ttf", "Montserrat-LightItalic.ttf",
    "Montserrat-Medium.ttf", "Montserrat-MediumItalic.ttf", "Montserrat-Regular.ttf",
    "Montserrat-SemiBold.ttf", "Montserrat-SemiBoldItalic.ttf", "Montserrat-Thin.ttf",
    "Montserrat-ThinItalic.ttf", "Roboto-Black.ttf", "Roboto-BlackItalic.ttf",
    "Roboto-Bold.ttf", "Roboto-BoldItalic.ttf", "Roboto-Italic.ttf", "Roboto-Light.ttf",
    "Roboto-LightItalic.ttf", "Roboto-Medium.ttf", "Roboto-MediumItalic.ttf",
    "Roboto-Regular.ttf", "Roboto-Thin.ttf", "Roboto-ThinItalic.ttf", "SourceSans3-Black.ttf",
    "SourceSans3-BlackItalic.ttf", "SourceSans3-Bold.ttf", "SourceSans3-BoldItalic.ttf",
    "SourceSans3-ExtraBold.ttf", "SourceSans3-ExtraBoldItalic.ttf", "SourceSans3-ExtraLight.ttf",
    "SourceSans3-ExtraLightItalic.ttf", "SourceSans3-Italic.ttf", "SourceSans3-Light.ttf",
    "SourceSans3-LightItalic.ttf", "SourceSans3-Medium.ttf", "SourceSans3-MediumItalic.ttf",
    "SourceSans3-Regular.ttf", "SourceSans3-SemiBold.ttf", "SourceSans3-SemiBoldItalic.ttf"
}

OFFICIAL_KOMETA_IMAGE_SUBDIRS = {
    "audio_codec", "audio_codec/compact", "audio_codec/standard",
    "cr", "edition", "flag", "flag/round", "flag/square",
    "logo", "logo/round", "logo/square",
    "network", "network/color", "network/white",
    "rating", "resolution",
    "ribbon", "ribbon/black", "ribbon/gray", "ribbon/red", "ribbon/yellow",
    "streaming", "streaming/color", "streaming/white",
    "studio", "studio/bigger", "studio/standard"
}

OFFICIAL_KOMETA_ROOT_IMAGES = {
    "commonsense.png", "direct-play.png", "mediastinger.png",
    "dual_audio.png", "dual_subs.png", "edition.png", "fire.png",
    "flame.png", "flame2.png", "multi_audio.png", "multi_subs.png",
    "versions.png"
}

OFFICIAL_OVERLAY_DEFAULTS = [
    "aspect.yml",
    "audio_codec.yml",
    "commonsense.yml",
    "content_rating_au.yml",
    "content_rating_de.yml",
    "content_rating_nz.yml",
    "content_rating_uk.yml",
    "content_rating_us_movie.yml",
    "content_rating_us_show.yml",
    "direct_play.yml",
    "episode_info.yml",
    "language_count.yml",
    "languages.yml",
    "mediastinger.yml",
    "network.yml",
    "ratings.yml",
    "resolution.yml",
    "ribbon.yml",
    "runtimes.yml",
    "status.yml",
    "streaming.yml",
    "studio.yml",
    "templates.yml",
    "versions.yml",
    "video_format.yml",
]
OFFICIAL_KOMETA_OVERLAY_DEFAULTS = OFFICIAL_OVERLAY_DEFAULTS


def resolve_official_kometa_image_url(image_name: str) -> Optional[str]:
    """
    Resolve any official Kometa image asset name directly to its official raw GitHub URL:
    https://raw.githubusercontent.com/Kometa-Team/Kometa/master/defaults/overlays/images/...
    Allows fetching only the exact images referenced in configs without downloading full archives.
    """
    if not image_name or is_template_placeholder(image_name):
        return None

    clean = image_name.replace("\\", "/").strip().lstrip("/")
    clean_lower = clean.lower()

    # 1. Direct path with official subfolder (e.g. flag/square/ad.png, resolution/4k.png, rating/imdb.png)
    for sub in OFFICIAL_KOMETA_IMAGE_SUBDIRS:
        if clean_lower.startswith(f"{sub}/"):
            fn = clean if clean.lower().endswith(tuple(ALLOWED_IMAGE_EXTS)) else f"{clean}.png"
            return f"{KOMETA_IMAGES_RAW}/{fn}"

    # 2. Plural "flags/" -> normalize to "flag/"
    if clean_lower.startswith("flags/"):
        normalized = "flag/" + clean[6:]
        fn = normalized if normalized.lower().endswith(tuple(ALLOWED_IMAGE_EXTS)) else f"{normalized}.png"
        return f"{KOMETA_IMAGES_RAW}/{fn}"

    # 3. Known root images (e.g. ribbon.png, etc.)
    if clean_lower in OFFICIAL_KOMETA_ROOT_IMAGES or f"{clean_lower}.png" in OFFICIAL_KOMETA_ROOT_IMAGES:
        fn = clean if clean.lower().endswith(tuple(ALLOWED_IMAGE_EXTS)) else f"{clean}.png"
        return f"{KOMETA_IMAGES_RAW}/{fn}"

    # 4. Standalone resolution keywords (e.g. 4k, 1080p, 720p, hdr, dv, dolby_vision, imax)
    stem = Path(clean_lower).stem
    if any(res in stem for res in ["4k", "1080p", "720p", "480p", "hdr", "dv", "dolby_vision", "hdr10", "imax"]):
        return f"{KOMETA_IMAGES_RAW}/resolution/{stem}.png"

    # 5. Standalone audio codecs (e.g. truehd, atmos, dts, flac, aac, opus, eac3, ac3)
    if any(codec in stem for codec in ["truehd", "atmos", "dts", "flac", "aac", "opus", "eac3", "ac3", "pcm"]):
        return f"{KOMETA_IMAGES_RAW}/audio_codec/standard/{stem}.png"

    # 6. Standalone 2-3 letter country or language codes (e.g. ad, de, en, fr, ja, es, it, nl, etc.)
    # In Kometa, language flag overlays point to flag/square/{lang}.png
    if len(stem) in [2, 3] and stem.isalpha():
        return f"{KOMETA_IMAGES_RAW}/flag/square/{stem}.png"

    # 7. Common streaming services or networks
    common_services = {"netflix", "apple", "disney", "amazon", "hbo", "paramount", "hulu", "peacock"}
    if stem in common_services:
        return f"{KOMETA_IMAGES_RAW}/streaming/color/{stem}.png"

    return None


# ==============================================================================
# SECURITY UTILITIES (PATH TRAVERSAL & SSRF MITIGATION)
# ==============================================================================

def is_safe_remote_url(url: str) -> bool:
    """
    Validate that an outbound URL uses HTTPS, resolves to a valid public IP,
    and does not target link-local, private, or loopback IPs (SSRF mitigation).
    """
    if not url:
        return False
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme.lower() != "https":
            return False

        hostname = parsed.hostname
        if not hostname or hostname.lower() in ("localhost", "127.0.0.1", "::1"):
            return False

        try:
            ip_addr = socket.gethostbyname(hostname)
            ip = ipaddress.ip_address(ip_addr)
        except Exception:
            return False

        # Strictly block link-local cloud metadata (169.254.x.x), loopback, private IPs, and multicast
        if ip.is_link_local or ip.is_multicast or ip.is_loopback or ip.is_private:
            logger.warning(f"[Security] Blocked unsafe IP target: {ip_addr} for URL: {url}")
            return False

        return True
    except Exception as e:
        logger.warning(f"[Security] URL validation error for {url}: {e}")
        return False


def is_template_placeholder(val: Any) -> bool:
    """
    Check if a string represents an uninstantiated Kometa template variable expression,
    e.g. <<rating<<rating_num>>_font>>, <<builder_level>>, <var>, {param}, $env, text(...).
    These are dynamic template blueprints and should not be treated as real asset filenames or URLs.
    """
    if not val or not isinstance(val, str):
        return True
    s = val.strip()
    if not s:
        return True
    if "<<" in s or ">>" in s or "<" in s or ">" in s or "{" in s or "}" in s:
        return True
    if "$" in s or s.startswith("@") or s.startswith("text(") or s.startswith("^") or s.startswith("!"):
        return True
    return False


WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
}


def safe_resolve_overlay_path(
    base_dir: Path,
    user_path: Union[str, Path],
    allowed_extensions: Optional[Set[str]] = None
) -> Optional[Path]:
    """
    Safely resolves a path relative to base_dir, strictly preventing path traversal.
    Blocks null bytes, control characters, double/triple-encoded traversal (%252e%252e),
    parent tokens ('..', '~'), UNC paths (\\\\), Windows Alternate Data Streams (::$DATA),
    Windows DOS reserved device names (CON, NUL, AUX, COM1..9), and enforces allowed file extensions.
    """
    if not user_path:
        return None
    try:
        base_resolved = Path(base_dir).resolve(strict=False)
        raw_input = str(user_path)

        # Block null bytes and control characters immediately (even before strip)
        if re.search(r'[\x00-\x1f\x7f]', raw_input):
            logger.warning(f"[Security] Null byte or control char detected in path: {user_path}")
            return None

        raw_str = raw_input.strip()

        # Reject UNC paths immediately
        if raw_str.startswith("\\\\") or raw_str.startswith("//"):
            logger.warning(f"[Security] UNC path rejected: {user_path}")
            return None

        # Multi-pass URL decode to defend against double/triple/quad-encoded traversal
        for _ in range(5):
            decoded = urllib.parse.unquote(raw_str)
            if decoded == raw_str:
                break
            raw_str = decoded

        user_str = raw_str.replace("\\", "/")

        # Block null bytes and control characters after decode as well
        if re.search(r'[\x00-\x1f\x7f]', user_str):
            logger.warning(f"[Security] Null byte or control char detected after decode: {user_path}")
            return None

        # Clean parts and reject any parent traversal tokens
        parts = [p for p in user_str.split("/") if p]
        if any(p in ("..", "~") or ".." in p for p in parts):
            logger.warning(f"[Security] Directory traversal detected: {user_path}")
            return None

        # Strip Windows drive letters if present in relative path strings
        stripped_str = re.sub(r'^[a-zA-Z]:', '', user_str)
        # Block Windows Alternate Data Streams (e.g. file.yml::$DATA)
        if ":" in stripped_str:
            logger.warning(f"[Security] Alternate data stream token ':' detected in path: {user_path}")
            return None

        clean_parts = [p for p in stripped_str.split("/") if p and p not in ("..", "~", ".")]
        if not clean_parts:
            return None

        # Block Windows DOS reserved device names (CON, PRN, AUX, NUL, COM1..9, LPT1..9)
        for part in clean_parts:
            stem_part = Path(part).stem.upper()
            if stem_part in WINDOWS_RESERVED_NAMES:
                logger.warning(f"[Security] Windows reserved device name detected: {part} in {user_path}")
                return None

        candidate = (base_resolved / Path(*clean_parts)).resolve(strict=False)

        # Ensure the candidate is strictly within base_resolved
        try:
            candidate.relative_to(base_resolved)
        except ValueError:
            logger.warning(f"[Security] Path escaped base directory: {user_path} outside {base_dir}")
            return None

        if allowed_extensions and candidate.suffix.lower() not in allowed_extensions:
            logger.warning(f"[Security] Disallowed file extension: {candidate.suffix} in {user_path}")
            return None

        return candidate
    except Exception as e:
        logger.warning(f"[Security] Path resolution exception for {user_path}: {e}")
        return None



# ==============================================================================
# RESOLVER DIRECTORY MANAGER & CACHING
# ==============================================================================

_YAML_MTIME_CACHE: Dict[str, Tuple[float, Any]] = {}

def load_cached_yaml_file(file_path: Path) -> Dict[str, Any]:
    """Load and parse YAML file with mtime caching to avoid repetitive disk I/O."""
    try:
        if not file_path.exists():
            return {}
        mtime = file_path.stat().st_mtime
        key = str(file_path.resolve())
        cached = _YAML_MTIME_CACHE.get(key)
        if cached and cached[0] == mtime:
            return cached[1]
        with open(file_path, "r", encoding="utf-8-sig") as fp:
            data = yaml.safe_load(fp) or {}
        _YAML_MTIME_CACHE[key] = (mtime, data)
        return data
    except Exception:
        return {}


_images_import_progress: Dict[str, Any] = {
    "is_running": False,
    "phase": "idle",
    "download_bytes": 0,
    "total_bytes": 0,
    "download_percent": 0.0,
    "extracted_count": 0,
    "total_images": 0,
    "extract_percent": 0.0,
    "overall_percent": 0.0,
    "message": "Idle",
    "error": None
}

def get_images_import_progress() -> Dict[str, Any]:
    global _images_import_progress
    return dict(_images_import_progress)

def is_images_import_running() -> bool:
    global _images_import_progress
    return bool(_images_import_progress.get("is_running", False))


class OverlayResolver:
    """Manages Kometa configuration files, dependencies, and asset resolution."""

    def __init__(self, project_root: Union[Path, str]):
        self.project_root = Path(project_root)
        self.overlayfiles_dir = self.project_root / "Overlayfiles"
        self.overlays_dir = self.overlayfiles_dir / "dynamic_overlays"
        if not self.overlays_dir.exists():
            legacy = self.overlayfiles_dir / "kometa"
            if legacy.exists():
                self.overlays_dir = legacy
        self.kometa_dir = self.overlays_dir
        self.configs_dir = self.overlays_dir / "configs"
        self.defaults_dir = self.overlays_dir / "defaults"
        self.assets_dir = self.overlays_dir / "assets"
        self.fonts_dir = self.overlays_dir / "fonts"

        self._ensure_directories()

    def _ensure_directories(self):
        """Create the Overlayfiles/kometa folder hierarchy."""
        for d in [self.configs_dir, self.defaults_dir, self.assets_dir, self.fonts_dir]:
            d.mkdir(parents=True, exist_ok=True)

        # Clean up any errant "c:" or "C:" directories erroneously created by legacy Windows-path joins on Linux
        import sys
        if sys.platform != "win32":
            for base_check in [self.project_root, PROJECT_ROOT, Path("/config"), Path("/app")]:
                for rogue in ["c:", "C:"]:
                    rogue_dir = base_check / rogue
                    if rogue_dir.exists() and rogue_dir.is_dir():
                        try:
                            shutil.rmtree(rogue_dir, ignore_errors=True)
                            logger.info(f"[OverlayResolver] Cleaned up legacy errant directory: {rogue_dir}")
                        except Exception:
                            pass

    def get_available_defaults(self) -> List[Dict[str, Any]]:
        """List all default template YAML files currently downloaded in Overlayfiles/kometa/defaults/."""
        files = []
        if not self.defaults_dir.exists():
            return files
        for f in self.defaults_dir.iterdir():
            if f.is_file() and f.suffix.lower() in ALLOWED_CONFIG_EXTS:
                files.append({
                    "name": f.name,
                    "size_bytes": f.stat().st_size,
                    "modified_at": f.stat().st_mtime,
                    "path": str(f)
                })
        return sorted(files, key=lambda x: x["name"])

    async def import_defaults_from_github(self, overwrite: bool = False) -> Dict[str, Any]:
        """
        Directly download official Kometa default overlay templates from GitHub
        into Overlayfiles/kometa/defaults/.
        """
        files_to_download = list(OFFICIAL_KOMETA_OVERLAY_DEFAULTS)

        # Attempt to discover any newer default files added upstream via GitHub API
        try:
            async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
                api_res = await client.get(
                    "https://api.github.com/repos/Kometa-Team/Kometa/contents/defaults/overlays",
                    headers={"User-Agent": "Posterizarr-Resolver"}
                )
                if api_res.status_code == 200:
                    items = api_res.json()
                    if isinstance(items, list):
                        api_files = [
                            item["name"] for item in items
                            if isinstance(item, dict) and item.get("type") == "file"
                            and item.get("name", "").endswith((".yml", ".yaml"))
                        ]
                        if api_files:
                            files_to_download = sorted(list(set(files_to_download + api_files)))
        except Exception as e:
            logger.debug(f"[OverlayResolver] GitHub API discovery skipped ({e}), falling back to official list.")

        imported_files = []
        new_files = []
        updated_files = []
        unchanged_files = []
        skipped_files = []
        errors = []

        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            for fname in files_to_download:
                safe_path = safe_resolve_overlay_path(self.defaults_dir, fname, ALLOWED_CONFIG_EXTS)
                if not safe_path:
                    continue
                if safe_path.exists() and not overwrite:
                    skipped_files.append(fname)
                    continue

                raw_url = f"{KOMETA_GITHUB_RAW}/defaults/overlays/{fname}"
                try:
                    resp = await client.get(raw_url)
                    if resp.status_code == 200:
                        content_str = resp.text
                        # Validate YAML syntax before saving
                        yaml.safe_load(content_str)

                        is_existing = safe_path.exists()
                        if is_existing:
                            try:
                                with open(safe_path, "r", encoding="utf-8", errors="ignore") as f:
                                    old_content = f.read()
                                if old_content == content_str:
                                    unchanged_files.append(fname)
                                    continue
                            except Exception:
                                pass

                        with open(safe_path, "w", encoding="utf-8") as f:
                            f.write(content_str)

                        if is_existing:
                            updated_files.append(fname)
                        else:
                            new_files.append(fname)
                        imported_files.append(fname)
                    else:
                        errors.append(f"{fname}: HTTP {resp.status_code}")
                except Exception as err:
                    logger.warning(f"[OverlayResolver] Failed downloading {fname}: {err}")
                    errors.append(f"{fname}: {err}")

        total_defaults = len(list(self.defaults_dir.glob("*.yml")) + list(self.defaults_dir.glob("*.yaml")))
        return {
            "success": True,
            "imported": imported_files,
            "new": new_files,
            "updated": updated_files,
            "unchanged": unchanged_files,
            "skipped": skipped_files,
            "errors": errors,
            "count": len(imported_files),
            "total_available": total_defaults
        }

    def get_configured_yaml_files(self) -> List[Dict[str, Any]]:
        """List all YAML configuration files currently in Overlayfiles/kometa/configs/."""
        files = []
        if not self.configs_dir.exists():
            return files

        for f in self.configs_dir.iterdir():
            if f.is_file() and f.suffix.lower() in ALLOWED_CONFIG_EXTS:
                files.append({
                    "name": f.name,
                    "size_bytes": f.stat().st_size,
                    "modified_at": f.stat().st_mtime,
                    "path": str(f)
                })
        return sorted(files, key=lambda x: x["name"])

    def _resolve_config_path(self, filename: str = "config.yml") -> Optional[Path]:
        """
        Safely resolve a config file path within Overlayfiles/kometa/configs/.
        Gracefully resolves between .yml and .yaml if the requested file exists
        with the sibling extension.
        """
        safe_path = safe_resolve_overlay_path(self.configs_dir, filename, ALLOWED_CONFIG_EXTS)
        if safe_path and safe_path.exists():
            return safe_path

        # If not found, check the alternate .yml/.yaml extension
        if filename in ("config.yml", "config.yaml"):
            alt = "config.yaml" if filename == "config.yml" else "config.yml"
            alt_path = self.configs_dir / alt
            if alt_path.exists():
                return alt_path

        return safe_path

    def scan_and_analyze_rules(self) -> Dict[str, Any]:
        """
        Scans all YAML files in Overlayfiles/kometa/configs/ and extracts:
        - Libraries configured
        - Active overlay definitions (Runtime, Rating, Status, Languages, Network, 4K, Anime, etc.)
        - Asset dependencies needed (Fonts, Images, Default Templates)
        """
        config_path = self._resolve_config_path("config.yml")
        if not config_path or not config_path.exists():
            # Check if any .yml or .yaml exists
            ymls = sorted(list(self.configs_dir.glob("*.yml")) + list(self.configs_dir.glob("*.yaml")))
            if not ymls:
                return {
                    "has_configs": False,
                    "message": "No configuration files found in Overlayfiles/kometa/configs/.",
                    "libraries": {},
                    "required_assets": []
                }
            config_path = ymls[0]

        try:
            main_config = load_cached_yaml_file(config_path)
        except Exception as e:
            logger.error(f"[OverlayResolver] Failed reading main config {config_path}: {e}")
            return {"has_configs": False, "error": f"Invalid YAML in {config_path.name}: {e}"}

        # Extract API keys if present in main config
        if isinstance(main_config, dict):
            try:
                from dynamic_overlays_service import extract_kometa_api_keys, get_dynamic_overlays_settings, save_dynamic_overlays_settings
                extracted = extract_kometa_api_keys(main_config)
                if extracted:
                    cur_settings = get_dynamic_overlays_settings()
                    to_update = {k: v for k, v in extracted.items() if v and cur_settings.get(k) != v}
                    if to_update:
                        save_dynamic_overlays_settings(to_update)
            except Exception as ex:
                logger.debug(f"[OverlayResolver] API key extraction on scan skipped: {ex}")

        libraries = main_config.get("libraries", {})
        parsed_libraries = {}
        all_referenced_assets: Dict[str, Dict[str, Any]] = {}
        parsed_def_assets = set()

        for lib_name, lib_data in libraries.items():
            if not isinstance(lib_data, dict):
                continue

            overlay_files = lib_data.get("overlay_files", [])
            active_overlays = []

            for entry in overlay_files:
                if not isinstance(entry, dict):
                    continue

                # 1. Default template references (e.g. - default: network)
                if "default" in entry:
                    def_name = str(entry["default"]).strip()
                    active_overlays.append({
                        "type": "default",
                        "name": def_name,
                        "variables": entry.get("template_variables", {})
                    })
                    # Add default template asset
                    all_referenced_assets[f"default:{def_name}"] = {
                        "category": "template",
                        "name": f"{def_name}.yml",
                        "type": "default_template",
                        "ref": def_name
                    }
                    # Also parse the default template if present in defaults_dir for sub-assets (fonts, images)
                    if def_name not in parsed_def_assets:
                        parsed_def_assets.add(def_name)
                        self._parse_overlay_file_assets(f"{def_name}.yml", all_referenced_assets, search_defaults=True)

                    # Inspect variables for custom fonts or colors
                    tv = entry.get("template_variables", {})
                    if "font" in tv and tv["font"]:
                        raw_font = str(tv["font"]).strip()
                        if not is_template_placeholder(raw_font):
                            font_file = Path(raw_font).name
                            if font_file.lower().endswith((".ttf", ".otf", ".woff", ".woff2")):
                                all_referenced_assets[f"font:{font_file}"] = {
                                    "category": "font",
                                    "name": font_file,
                                    "type": "font",
                                    "path_in_config": tv["font"]
                                }

                # 2. File references (e.g. - file: config/overlays_movies.yml)
                elif "file" in entry:
                    rel_file = str(entry["file"]).strip()
                    file_name = Path(rel_file).name
                    active_overlays.append({
                        "type": "file",
                        "name": file_name,
                        "variables": entry.get("template_variables", {})
                    })
                    self._parse_overlay_file_assets(file_name, all_referenced_assets)

            parsed_libraries[lib_name] = {
                "name": lib_name,
                "overlays_count": len(active_overlays),
                "overlays": active_overlays
            }

        # Check for any custom overlay files in configs_dir (like overlays_movies.yml, overlays_tv.yml, anime_overlays.yml)
        for cf in sorted(list(self.configs_dir.glob("*.yml")) + list(self.configs_dir.glob("*.yaml"))):
            if cf.name not in ("config.yml", "config.yaml"):
                self._parse_overlay_file_assets(cf.name, all_referenced_assets)

        # Run readiness check on all discovered assets
        readiness_report = self._check_assets_readiness(list(all_referenced_assets.values()))

        # Discover all available custom YAML config files in configs directory
        available_config_files = sorted([
            f.name for f in self.configs_dir.iterdir()
            if f.is_file() and f.suffix.lower() in ALLOWED_CONFIG_EXTS and f.name not in ("config.yml", "config.yaml")
        ])

        return {
            "has_configs": True,
            "main_config": config_path.name,
            "libraries": parsed_libraries,
            "readiness": readiness_report,
            "available_config_files": available_config_files
        }

    def _parse_overlay_file_assets(self, filename: str, asset_collector: Dict[str, Dict[str, Any]], search_defaults: bool = False):
        """Parse sub-overlay files (like overlays_movies.yml, anime_overlays.yml, or defaults) for fonts and images."""
        file_path = self.defaults_dir / filename if search_defaults else (self.configs_dir / filename)
        if not file_path.exists():
            if search_defaults and (self.configs_dir / filename).exists():
                file_path = self.configs_dir / filename
            elif not search_defaults and (self.defaults_dir / filename).exists():
                file_path = self.defaults_dir / filename
            else:
                return

        try:
            data = load_cached_yaml_file(file_path)
            if not data:
                return
        except Exception:
            return

        # Check templates and overlays
        templates = data.get("templates", {})
        overlays = data.get("overlays", {})

        for group in [templates, overlays]:
            if not isinstance(group, dict):
                continue
            for item_name, item_def in group.items():
                if not isinstance(item_def, dict):
                    continue
                ov = item_def.get("overlay", {})
                if not isinstance(ov, dict):
                    continue

                # Font check
                if "font" in ov and ov["font"]:
                    raw_font = str(ov["font"]).strip()
                    if not is_template_placeholder(raw_font):
                        font_name = Path(raw_font).name
                        if font_name.lower().endswith((".ttf", ".otf", ".woff", ".woff2")):
                            asset_collector[f"font:{font_name}"] = {
                                "category": "font",
                                "name": font_name,
                                "type": "font",
                                "path_in_config": ov["font"]
                            }

                # Image / URL check
                if "url" in ov and ov["url"]:
                    url_str = str(ov["url"]).strip()
                    if not is_template_placeholder(url_str) and url_str.startswith(("http://", "https://")):
                        img_name = Path(urllib.parse.urlparse(url_str).path).name or f"{item_name}.png"
                        if not is_template_placeholder(img_name):
                            asset_collector[f"image:{img_name}"] = {
                                "category": "image",
                                "name": img_name,
                                "type": "remote_image",
                                "url": url_str
                            }
                elif "name" in ov and ov["name"]:
                    raw_name = str(ov["name"]).strip()
                    if not is_template_placeholder(raw_name) and not raw_name.startswith("text("):
                        img_name = f"{raw_name}.png" if not raw_name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) else raw_name
                        if not is_template_placeholder(img_name):
                            asset_collector[f"image:{img_name}"] = {
                                "category": "image",
                                "name": img_name,
                                "type": "local_image"
                            }

    def _check_assets_readiness(self, assets: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Verify which assets are already present locally vs. fetchable or missing."""
        ready = 0
        fetchable = 0
        missing = 0
        items_report = []

        for asset in assets:
            cat = asset.get("category")
            name = str(asset.get("name", "")).strip()
            if not name or is_template_placeholder(name):
                continue
            if cat == "font" and not name.lower().endswith((".ttf", ".otf", ".woff", ".woff2")):
                continue
            if cat == "template" and not name.lower().endswith((".yml", ".yaml")):
                continue
            if cat == "image" and any(bad in name for bad in ["<", ">", "{", "}", "$"]):
                continue

            status = "missing"
            source_type = "unknown"
            resolved_path = None
            download_url = None

            # 1. Fonts
            if cat == "font":
                p1 = self.fonts_dir / name
                p2 = self.overlayfiles_dir / name

                if p1.exists():
                    status = "ready"
                    source_type = "local"
                    resolved_path = str(p1)
                elif p2.exists():
                    status = "ready"
                    source_type = "local"
                    resolved_path = str(p2)
                elif name in OFFICIAL_KOMETA_FONTS:
                    status = "fetchable"
                    source_type = "github"
                    download_url = f"{KOMETA_GITHUB_RAW}/fonts/{name}"
                else:
                    status = "upload_needed"
                    source_type = "upload_needed"
                    download_url = None

            # 2. Default Templates
            elif cat == "template":
                p1 = self.defaults_dir / name

                if p1.exists():
                    status = "ready"
                    source_type = "local"
                    resolved_path = str(p1)
                elif (
                    name in OFFICIAL_OVERLAY_DEFAULTS or
                    f"{name}.yml" in OFFICIAL_OVERLAY_DEFAULTS or
                    name.replace(".yml", "").replace(".yaml", "") in [Path(d).stem for d in OFFICIAL_OVERLAY_DEFAULTS]
                ):
                    status = "fetchable"
                    source_type = "github"
                    download_url = f"{KOMETA_GITHUB_RAW}/defaults/overlays/{name}"
                else:
                    status = "upload_needed"
                    source_type = "upload_needed"
                    download_url = None

            # 3. Images
            elif cat == "image":
                name_lower = name.lower()
                target_stem = Path(name_lower).stem
                found_local = None
                search_roots = [self.assets_dir, self.defaults_dir / "images", self.overlayfiles_dir]
                sub_folders = [
                    "", "network", "network/color", "network/white",
                    "streaming", "streaming/color", "streaming/white",
                    "studio", "studio/standard", "studio/bigger",
                    "resolution", "rating", "flags/square", "flag/square",
                    "flags/round", "flag/round",
                    "ribbon/red", "ribbon/black", "ribbon", "ribbon/yellow", "ribbon/gray",
                    "audio_codec", "audio_codec/compact", "audio_codec/standard",
                    "cr", "edition", "logo", "logo/round", "logo/square"
                ]
                for root in search_roots:
                    for sub in sub_folders:
                        check_dir = root / sub if sub else root
                        if check_dir.exists() and check_dir.is_dir():
                            try:
                                for f in check_dir.iterdir():
                                    if f.is_file() and (f.name.lower() == name_lower or f.stem.lower() == target_stem):
                                        found_local = f
                                        break
                            except Exception:
                                pass
                        if found_local:
                            break
                    if found_local:
                        break

                found_url = resolve_official_kometa_image_url(name)
                if found_local:
                    status = "ready"
                    source_type = "local"
                    resolved_path = str(found_local)
                elif "url" in asset and asset["url"] and is_safe_remote_url(asset["url"]):
                    status = "fetchable"
                    source_type = "remote_url"
                    download_url = asset["url"]
                elif found_url:
                    status = "fetchable"
                    source_type = "github"
                    download_url = found_url
                else:
                    status = "upload_needed"
                    source_type = "upload_needed"
                    download_url = None

            if status == "ready":
                ready += 1
            elif status == "fetchable":
                fetchable += 1
            elif status == "upload_needed":
                upload_needed = locals().get("upload_needed", 0) + 1
            else:
                missing += 1

            items_report.append({
                "name": name,
                "category": cat,
                "status": status,
                "source_type": source_type,
                "download_url": download_url,
                "resolved_path": resolved_path
            })

        up_needed = locals().get("upload_needed", 0)
        return {
            "total": len(items_report),
            "ready": ready,
            "fetchable": fetchable,
            "upload_needed": up_needed,
            "missing": missing,
            "all_satisfied": (missing == 0 and fetchable == 0 and up_needed == 0),
            "assets": items_report
        }

    async def fetch_asset(self, asset_name: str, category: str, custom_url: Optional[str] = None) -> Dict[str, Any]:
        """
        Download a missing asset directly into Overlayfiles/dynamic_overlays/.
        Strictly validates extensions, safety of URLs, and prevents file traversal.
        """
        if not asset_name or is_template_placeholder(asset_name):
            return {"success": False, "error": f"Invalid asset name or template placeholder: {asset_name}"}

        default_url = None
        if category == "font":
            target_dir = self.fonts_dir
            allowed_exts = ALLOWED_FONT_EXTS
            if custom_url and is_safe_remote_url(custom_url):
                default_url = custom_url
            elif asset_name in OFFICIAL_KOMETA_FONTS:
                default_url = f"{KOMETA_GITHUB_RAW}/fonts/{asset_name}"
            else:
                return {
                    "success": False,
                    "error": f"'{asset_name}' is a custom font not present in the official Kometa repository. Please upload it via the UI."
                }
        elif category == "template":
            target_dir = self.defaults_dir
            allowed_exts = ALLOWED_CONFIG_EXTS
            stem = Path(asset_name).stem
            if (
                asset_name not in OFFICIAL_OVERLAY_DEFAULTS and
                f"{stem}.yml" not in OFFICIAL_OVERLAY_DEFAULTS
            ):
                return {
                    "success": False,
                    "error": f"'{asset_name}' is not an official Kometa overlay template and cannot be downloaded from the remote repository."
                }
            default_url = f"{KOMETA_GITHUB_RAW}/defaults/overlays/{asset_name}"
        else:
            target_dir = self.assets_dir
            allowed_exts = ALLOWED_IMAGE_EXTS
            if custom_url and is_safe_remote_url(custom_url):
                default_url = custom_url
            else:
                default_url = resolve_official_kometa_image_url(asset_name)

            if not default_url:
                return {
                    "success": False,
                    "error": f"'{asset_name}' is a custom image not present in the official Kometa repository. Please upload it via the UI."
                }

        # If official image URL points to a subpath (e.g. flag/square/ad.png), preserve that subpath
        rel_sub = None
        if default_url and default_url.startswith(f"{KOMETA_IMAGES_RAW}/"):
            rel_sub = default_url[len(KOMETA_IMAGES_RAW) + 1:]

        if rel_sub and category not in ["font", "template"]:
            safe_dest = safe_resolve_overlay_path(target_dir, rel_sub, allowed_exts)
        else:
            safe_dest = safe_resolve_overlay_path(target_dir, asset_name, allowed_exts)

        if not safe_dest:
            safe_dest = safe_resolve_overlay_path(target_dir, asset_name, allowed_exts)

        if not safe_dest:
            return {"success": False, "error": f"Invalid or disallowed asset filename: {asset_name}"}

        safe_dest.parent.mkdir(parents=True, exist_ok=True)

        # Remote Download via HTTPS
        download_url = custom_url or default_url
        if not download_url or not is_safe_remote_url(download_url):
            return {"success": False, "error": f"Invalid or unsafe download URL for {asset_name}: {download_url}"}

        try:
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                res = await client.get(download_url)
                if res.status_code != 200:
                    return {"success": False, "error": f"Download failed with status {res.status_code} from {download_url}"}

                content = res.content
                # Guard against oversized files (max 15MB)
                if len(content) > 15 * 1024 * 1024:
                    return {"success": False, "error": "Downloaded file exceeds 15MB limit"}

                with open(safe_dest, "wb") as fp:
                    fp.write(content)

                # Also save copy in root of assets_dir if safe_dest was in a subfolder
                base_dest = self.assets_dir / Path(asset_name).name
                if safe_dest != base_dest and not base_dest.exists():
                    try:
                        with open(base_dest, "wb") as fp_base:
                            fp_base.write(content)
                    except Exception:
                        pass

                return {"success": True, "method": "downloaded", "path": str(safe_dest)}
        except Exception as e:
            logger.error(f"[OverlayResolver] Error downloading {asset_name}: {e}")
            return {"success": False, "error": str(e)}

    async def import_default_images_from_github(self, overwrite: bool = False) -> Dict[str, Any]:
        """
        Download and extract official Kometa default images from upstream GitHub archive
        directly into Overlayfiles/dynamic_overlays/assets/ and defaults/images/.
        Provides real-time progress for UI display.
        """
        global _images_import_progress
        if _images_import_progress.get("is_running"):
            return {
                "success": False,
                "error": "Image import is already in progress.",
                "progress": dict(_images_import_progress)
            }

        import tarfile
        import urllib.request
        import shutil

        tar_url = "https://github.com/Kometa-Team/Kometa/archive/refs/heads/master.tar.gz"
        imported_count = 0
        dest_dirs = [self.assets_dir, self.defaults_dir / "images"]
        for d in dest_dirs:
            d.mkdir(parents=True, exist_ok=True)

        temp_tar_path = self.overlays_dir / "kometa_images_temp.tar.gz"

        _images_import_progress.update({
            "is_running": True,
            "phase": "downloading",
            "download_bytes": 0,
            "total_bytes": 0,
            "download_percent": 0.0,
            "extracted_count": 0,
            "total_images": 0,
            "extract_percent": 0.0,
            "overall_percent": 0.0,
            "message": "Connecting to GitHub archive...",
            "error": None
        })

        try:
            def _download_and_extract():
                nonlocal imported_count
                req = urllib.request.Request(tar_url, headers={"User-Agent": "Posterizarr"})
                with urllib.request.urlopen(req, timeout=180) as resp:
                    cl = resp.headers.get("Content-Length")
                    total_bytes = int(cl) if cl and cl.isdigit() else 0
                    _images_import_progress["total_bytes"] = total_bytes
                    _images_import_progress["message"] = "Downloading archive from GitHub..."

                    downloaded = 0
                    chunk_size = 1024 * 512  # 512 KB
                    with open(temp_tar_path, "wb") as out_tar:
                        while True:
                            chunk = resp.read(chunk_size)
                            if not chunk:
                                break
                            out_tar.write(chunk)
                            downloaded += len(chunk)
                            if total_bytes > 0:
                                pct = min(100.0, (downloaded / total_bytes) * 100.0)
                                overall = round(pct * 0.5, 1)
                                msg = f"Downloading archive: {downloaded // (1024*1024)} MB / {total_bytes // (1024*1024)} MB ({round(pct, 1)}%)"
                            else:
                                # Estimate ~230 MB for percentage calculation when GitHub omits Content-Length
                                est_bytes = 230 * 1024 * 1024
                                pct = min(99.0, (downloaded / est_bytes) * 100.0)
                                overall = round(pct * 0.5, 1)
                                msg = f"Downloading archive: {downloaded // (1024*1024)} MB (~{round(pct, 1)}%)..."

                            _images_import_progress.update({
                                "download_bytes": downloaded,
                                "download_percent": round(pct, 1),
                                "overall_percent": overall,
                                "message": msg
                            })

                _images_import_progress.update({
                    "phase": "extracting",
                    "download_percent": 100.0,
                    "overall_percent": 50.0,
                    "message": "Inspecting archive members..."
                })

                prefix = "defaults/overlays/images/"
                with tarfile.open(temp_tar_path, mode="r:gz") as tf:
                    members = [m for m in tf.getmembers() if m.isfile() and prefix in m.name]
                    total_members = len(members)
                    _images_import_progress["total_images"] = total_members

                    for idx, member in enumerate(members, 1):
                        rel_subpath = member.name.split(prefix, 1)[1].lstrip("/")
                        if not rel_subpath:
                            continue
                        extracted_f = tf.extractfile(member)
                        if extracted_f:
                            data = extracted_f.read()
                            for dest_root in dest_dirs:
                                dest_file = dest_root / rel_subpath
                                if dest_file.exists() and not overwrite:
                                    continue
                                dest_file.parent.mkdir(parents=True, exist_ok=True)
                                with open(dest_file, "wb") as out_f:
                                    out_f.write(data)
                            imported_count += 1

                        if idx % 20 == 0 or idx == total_members:
                            ext_pct = round((idx / total_members) * 100.0, 1) if total_members > 0 else 100.0
                            overall = round(50.0 + (ext_pct * 0.5), 1)
                            _images_import_progress.update({
                                "extracted_count": imported_count,
                                "extract_percent": ext_pct,
                                "overall_percent": overall,
                                "message": f"Extracting images: {idx} / {total_members} ({ext_pct}%)"
                            })

            await asyncio.to_thread(_download_and_extract)

            _images_import_progress.update({
                "is_running": False,
                "phase": "completed",
                "extracted_count": imported_count,
                "overall_percent": 100.0,
                "message": f"Successfully imported {imported_count} official overlay images!"
            })
            return {
                "success": True,
                "count": imported_count,
                "extracted_count": imported_count,
                "message": f"Successfully imported {imported_count} official overlay images."
            }
        except Exception as e:
            logger.error(f"[OverlayResolver] Error importing default images: {e}", exc_info=True)
            _images_import_progress.update({
                "is_running": False,
                "phase": "error",
                "error": str(e),
                "message": f"Error: {e}"
            })
            return {"success": False, "error": str(e), "count": 0, "extracted_count": 0}
        finally:
            if temp_tar_path.exists():
                try:
                    temp_tar_path.unlink()
                except Exception:
                    pass

    async def fetch_all_missing(self) -> Dict[str, Any]:
        """Fetch all fetchable missing assets in batch."""
        analysis = self.scan_and_analyze_rules()
        readiness = analysis.get("readiness", {})
        assets = readiness.get("assets", [])

        results = []
        for a in assets:
            if a.get("status") == "fetchable":
                res = await self.fetch_asset(
                    asset_name=a["name"],
                    category=a["category"],
                    custom_url=a.get("download_url")
                )
                results.append({"name": a["name"], "result": res})

        # Re-run readiness check after downloads
        fresh_analysis = self.scan_and_analyze_rules()
        return {
            "downloaded_count": len([r for r in results if r["result"].get("success")]),
            "details": results,
            "readiness": fresh_analysis.get("readiness", {})
        }

    def get_config_content(self, filename: str = "config.yml") -> Dict[str, Any]:
        """Read raw text content of a config YAML file in Overlayfiles/kometa/configs/."""
        safe_path = self._resolve_config_path(filename)
        if not safe_path or not safe_path.exists():
            return {"success": False, "error": f"Config file not found: {filename}"}
        try:
            with open(safe_path, "r", encoding="utf-8-sig") as f:
                content = f.read()
            return {"success": True, "filename": safe_path.name, "content": content}
        except Exception as e:
            logger.error(f"[OverlayResolver] Error reading {filename}: {e}")
            return {"success": False, "error": str(e)}

    def save_config_content(self, filename: str, content: str) -> Dict[str, Any]:
        """Validate YAML syntax, create a backup, and save text content."""
        safe_path = self._resolve_config_path(filename)
        if not safe_path:
            return {"success": False, "error": f"Invalid filename: {filename}"}
        try:
            parsed = yaml.safe_load(content)
        except Exception as ye:
            return {"success": False, "error": f"Invalid YAML syntax: {ye}"}

        # Extract and persist API keys if saving main config
        if isinstance(parsed, dict) and filename.lower() in ("config.yml", "config.yaml"):
            try:
                from dynamic_overlays_service import extract_kometa_api_keys, save_dynamic_overlays_settings
                extracted = extract_kometa_api_keys(parsed)
                if extracted:
                    save_dynamic_overlays_settings(extracted)
                    logger.info(f"[OverlayResolver] Extracted API keys on saving {filename}: {list(extracted.keys())}")
            except Exception as ex:
                logger.warning(f"[OverlayResolver] Failed extracting API keys on save: {ex}")

        try:
            if safe_path.exists():
                backup_path = safe_path.with_suffix(f"{safe_path.suffix}.bak")
                shutil.copy2(safe_path, backup_path)

            with open(safe_path, "w", encoding="utf-8") as f:
                f.write(content)

            return {"success": True, "filename": safe_path.name, "message": "Saved successfully with backup created."}
        except Exception as e:
            logger.error(f"[OverlayResolver] Error saving {filename}: {e}")
            return {"success": False, "error": str(e)}

    def delete_config_file(self, filename: str) -> Dict[str, Any]:
        """Safely delete a configuration or overlay YAML file from Overlayfiles/kometa/configs/."""
        safe_path = safe_resolve_overlay_path(self.configs_dir, filename, ALLOWED_CONFIG_EXTS)
        if not safe_path or not safe_path.exists():
            return {"success": False, "error": f"File not found: {filename}"}
        try:
            bak = safe_path.with_suffix(f"{safe_path.suffix}.deleted.bak")
            shutil.copy2(safe_path, bak)
            safe_path.unlink()
            return {"success": True, "filename": filename, "message": f"{filename} deleted (backup saved)."}
        except Exception as e:
            logger.error(f"[OverlayResolver] Error deleting {filename}: {e}")
            return {"success": False, "error": str(e)}

    def remove_library_overlay(self, library_name: str, overlay_index: int, filename: str = "config.yml") -> Dict[str, Any]:
        """Remove an overlay rule at overlay_index from a library in config.yml."""
        safe_path = self._resolve_config_path(filename)
        if not safe_path or not safe_path.exists():
            return {"success": False, "error": f"Config file not found: {filename}"}
        try:
            with open(safe_path, "r", encoding="utf-8-sig") as f:
                data = yaml.safe_load(f) or {}

            libraries = data.get("libraries", {})
            if library_name not in libraries:
                return {"success": False, "error": f"Library '{library_name}' not found in {safe_path.name}"}

            overlay_files = libraries[library_name].get("overlay_files", [])
            if overlay_index < 0 or overlay_index >= len(overlay_files):
                return {"success": False, "error": f"Invalid overlay index {overlay_index}"}

            removed = overlay_files.pop(overlay_index)

            backup_path = safe_path.with_suffix(f"{safe_path.suffix}.bak")
            shutil.copy2(safe_path, backup_path)

            with open(safe_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, sort_keys=False, default_flow_style=False, allow_unicode=True)

            return {"success": True, "removed": removed, "remaining_count": len(overlay_files)}
        except Exception as e:
            logger.error(f"[OverlayResolver] Error removing overlay from {library_name}: {e}")
            return {"success": False, "error": str(e)}

    def add_library_overlay(
        self,
        library_name: str,
        overlay_type: str,
        overlay_name: str,
        template_variables: Optional[Dict[str, Any]] = None,
        filename: str = "config.yml"
    ) -> Dict[str, Any]:
        """Add a new overlay rule (default or file) to a library in config.yml."""
        safe_path = self._resolve_config_path(filename)
        if not safe_path:
            return {"success": False, "error": f"Invalid config file path: {filename}"}
        try:
            data = {}
            if safe_path.exists():
                with open(safe_path, "r", encoding="utf-8-sig") as f:
                    data = yaml.safe_load(f) or {}

            if "libraries" not in data or not isinstance(data["libraries"], dict):
                data["libraries"] = {}
            if library_name not in data["libraries"] or not isinstance(data["libraries"][library_name], dict):
                data["libraries"][library_name] = {"overlay_files": []}

            if "overlay_files" not in data["libraries"][library_name] or not isinstance(data["libraries"][library_name]["overlay_files"], list):
                data["libraries"][library_name]["overlay_files"] = []

            new_rule = {}
            if overlay_type == "file":
                new_rule["file"] = overlay_name
            else:
                new_rule["default"] = overlay_name

            if template_variables:
                new_rule["template_variables"] = template_variables

            data["libraries"][library_name]["overlay_files"].append(new_rule)

            if safe_path.exists():
                backup_path = safe_path.with_suffix(f"{safe_path.suffix}.bak")
                shutil.copy2(safe_path, backup_path)

            with open(safe_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, sort_keys=False, default_flow_style=False, allow_unicode=True)

            return {"success": True, "added": new_rule}
        except Exception as e:
            logger.error(f"[OverlayResolver] Error adding overlay to {library_name}: {e}")
            return {"success": False, "error": str(e)}

    def update_library_overlay(
        self,
        library_name: str,
        overlay_index: int,
        template_variables: Dict[str, Any],
        filename: str = "config.yml"
    ) -> Dict[str, Any]:
        """Update template variables for an existing overlay rule in a library."""
        safe_path = self._resolve_config_path(filename)
        if not safe_path or not safe_path.exists():
            return {"success": False, "error": f"Config file not found: {filename}"}
        try:
            with open(safe_path, "r", encoding="utf-8-sig") as f:
                data = yaml.safe_load(f) or {}

            libraries = data.get("libraries", {})
            if library_name not in libraries:
                return {"success": False, "error": f"Library '{library_name}' not found"}

            overlay_files = libraries[library_name].get("overlay_files", [])
            if overlay_index < 0 or overlay_index >= len(overlay_files):
                return {"success": False, "error": f"Invalid overlay index {overlay_index}"}

            target = overlay_files[overlay_index]
            target["template_variables"] = template_variables

            backup_path = safe_path.with_suffix(f"{safe_path.suffix}.bak")
            shutil.copy2(safe_path, backup_path)

            with open(safe_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, sort_keys=False, default_flow_style=False, allow_unicode=True)

            return {"success": True, "updated": target}
        except Exception as e:
            logger.error(f"[OverlayResolver] Error updating overlay in {library_name}: {e}")
            return {"success": False, "error": str(e)}

    def add_library(self, library_name: str, filename: str = "config.yml") -> Dict[str, Any]:
        """Add a new library entry to config.yml (creates config if not exists)."""
        clean_name = library_name.strip()
        if not clean_name:
            return {"success": False, "error": "Library name cannot be empty."}

        safe_path = self._resolve_config_path(filename)
        if not safe_path:
            return {"success": False, "error": f"Invalid config file path: {filename}"}

        try:
            data = {}
            if safe_path.exists():
                with open(safe_path, "r", encoding="utf-8-sig") as f:
                    data = yaml.safe_load(f) or {}

            if "libraries" not in data or not isinstance(data["libraries"], dict):
                data["libraries"] = {}

            if clean_name in data["libraries"]:
                return {"success": False, "error": f"Library '{clean_name}' already exists."}

            data["libraries"][clean_name] = {"overlay_files": []}

            if safe_path.exists():
                backup_path = safe_path.with_suffix(f"{safe_path.suffix}.bak")
                shutil.copy2(safe_path, backup_path)

            with open(safe_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, sort_keys=False, default_flow_style=False, allow_unicode=True)

            return {"success": True, "library_name": clean_name}
        except Exception as e:
            logger.error(f"[OverlayResolver] Error adding library {clean_name}: {e}")
            return {"success": False, "error": str(e)}

    def remove_libraries(self, library_names: Union[str, List[str]], filename: str = "config.yml") -> Dict[str, Any]:
        """Remove one or more library entries from config.yml and sync visual config."""
        if isinstance(library_names, str):
            target_list = [library_names.strip()]
        else:
            target_list = [str(n).strip() for n in library_names if str(n).strip()]

        if not target_list:
            return {"success": False, "error": "No library specified for removal."}

        safe_path = self._resolve_config_path(filename)
        if not safe_path or not safe_path.exists():
            return {"success": False, "error": f"Config file not found: {filename}"}

        try:
            with open(safe_path, "r", encoding="utf-8-sig") as f:
                data = yaml.safe_load(f) or {}

            libraries = data.get("libraries", {})
            removed = []
            for name in target_list:
                # Exact or case-insensitive match
                matched_key = None
                if name in libraries:
                    matched_key = name
                else:
                    for k in libraries:
                        if k.lower() == name.lower():
                            matched_key = k
                            break
                if matched_key:
                    del data["libraries"][matched_key]
                    removed.append(matched_key)

            if not removed:
                return {"success": False, "error": f"None of the specified libraries {target_list} were found in {filename}."}

            backup_path = safe_path.with_suffix(f"{safe_path.suffix}.bak")
            shutil.copy2(safe_path, backup_path)

            with open(safe_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, sort_keys=False, default_flow_style=False, allow_unicode=True)

            # Also remove from dynamic_overlays_visual_config.json if present
            try:
                from dynamic_overlays_service import load_visual_config, save_visual_config
                vis_cfg = load_visual_config()
                if vis_cfg and "libraries" in vis_cfg:
                    vis_libs = vis_cfg["libraries"]
                    vis_changed = False
                    for rem_name in removed:
                        for vk in list(vis_libs.keys()):
                            if vk.lower() == rem_name.lower():
                                del vis_libs[vk]
                                vis_changed = True
                    if vis_changed:
                        save_visual_config(vis_cfg)
            except Exception as vis_err:
                logger.debug(f"[OverlayResolver] Error removing library from visual config: {vis_err}")

            return {
                "success": True,
                "removed_libraries": removed,
                "removed_count": len(removed),
                "removed_library": removed[0] if removed else None
            }
        except Exception as e:
            logger.error(f"[OverlayResolver] Error removing libraries {target_list}: {e}")
            return {"success": False, "error": str(e)}

    def remove_library(self, library_name: str, filename: str = "config.yml") -> Dict[str, Any]:
        """Remove a single library entry from config.yml."""
        return self.remove_libraries([library_name], filename)

    def save_library_layout(
        self,
        library_name: str,
        layout_updates: Dict[str, Dict[str, Any]],
        filename: str = "config.yml",
        target_format: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Updates positional variables (offsets, alignments) for overlay rules
        matching the keys in layout_updates (e.g. 'ratings', 'runtimes', 'status', 'resolution', 'network', 'languages').
        If config.yml or the library does not exist yet, initializes them safely.
        """
        safe_path = self._resolve_config_path(filename)
        if not safe_path:
            return {"success": False, "error": f"Invalid config file path: {filename}"}
        try:
            clean_lib_name = str(library_name).strip()
            if not clean_lib_name:
                return {"success": False, "error": "Library name cannot be empty."}

            data = {}
            if safe_path.exists():
                with open(safe_path, "r", encoding="utf-8-sig") as f:
                    data = yaml.safe_load(f) or {}

            libraries = data.setdefault("libraries", {})
            if clean_lib_name not in libraries or not isinstance(libraries[clean_lib_name], dict):
                libraries[clean_lib_name] = {"overlay_files": []}

            overlay_files = libraries[clean_lib_name].setdefault("overlay_files", [])
            if not isinstance(overlay_files, list):
                overlay_files = []
                libraries[clean_lib_name]["overlay_files"] = overlay_files

            updated_count = 0
            matched_keys = set()
            age_rating_aliases = {
                "age_rating", "commonsense", "content_rating", "content_rating_de",
                "content_rating_us_movie", "content_rating_uk", "content_rating_au",
                "content_rating_nz", "content_rating_us_show"
            }

            # 1. Update existing matching overlay rules
            for rule in overlay_files:
                if not isinstance(rule, dict):
                    continue
                rule_default = str(rule.get("default") or "").strip()
                rule_file = str(rule.get("file") or "").strip()
                if not rule_default and not rule_file:
                    continue
                rule_name = (rule_default or rule_file).lower()
                is_res_rule = (
                    "overlays_movies.yml" in rule_name or
                    "overlays_tv.yml" in rule_name or
                    rule_name == "resolution"
                )
                matched_entries = []
                for key, coords in layout_updates.items():
                    key_lower = key.lower()
                    # Match e.g. "rating" <-> "ratings", "runtime" <-> "runtimes", "status", "resolution", "languages", age ratings
                    is_match = (
                        (key_lower == "resolution" and is_res_rule) or
                        key_lower == rule_name or
                        key_lower in rule_name or
                        rule_name in key_lower or
                        rule_name.startswith(key_lower) or
                        key_lower.startswith(rule_name) or
                        (key_lower in age_rating_aliases and any(cr in rule_name for cr in age_rating_aliases)) or
                        (key_lower in ("rating", "ratings") and "rating" in rule_name and not any(cr in rule_name for cr in age_rating_aliases)) or
                        (key_lower in ("runtime", "runtimes") and "runtime" in rule_name)
                    )
                    if is_match:
                        matched_entries.append((key, coords))
                        matched_keys.add(key)
                        if any(cr in rule_name for cr in age_rating_aliases):
                            for k in layout_updates:
                                if k.lower() in age_rating_aliases:
                                    matched_keys.add(k)
                        if "rating" in rule_name and not any(cr in rule_name for cr in age_rating_aliases):
                            for k in layout_updates:
                                if k.lower() in ("rating", "ratings"):
                                    matched_keys.add(k)
                        if "runtime" in rule_name:
                            for k in layout_updates:
                                if k.lower() in ("runtime", "runtimes"):
                                    matched_keys.add(k)
                        if is_res_rule:
                            matched_keys.add("resolution")

                if matched_entries:
                    vars_dict = rule.setdefault("template_variables", {})
                    if not isinstance(vars_dict, dict):
                        vars_dict = {}
                        rule["template_variables"] = vars_dict
                    best_key, best_coords = matched_entries[0]
                    for k, c in matched_entries:
                        if k.lower() == rule_name or (k.lower() == "resolution" and is_res_rule):
                            best_key, best_coords = k, c
                            break

                    # Check if layout_updates has rating and apply to overlays_movies.yml / overlays_tv.yml
                    if ("overlays_movies.yml" in rule_name or "overlays_tv.yml" in rule_name):
                        r_coords = layout_updates.get("rating") or layout_updates.get("ratings")
                        if r_coords:
                            matched_entries.append(("rating", r_coords))
                            matched_keys.add("rating")
                            matched_keys.add("ratings")

                    # Apply rating updates if present in matched_entries
                    for k, c in matched_entries:
                        if k.lower() in ("rating", "ratings") and ("overlays_movies.yml" in rule_name or "overlays_tv.yml" in rule_name):
                            vars_dict["rating_horizontal_align"] = c.get("horizontal_align", "center")
                            vars_dict["rating_horizontal_offset"] = int(c.get("horizontal_offset", 375))
                            vars_dict["rating_vertical_align"] = c.get("vertical_align", "bottom")
                            vars_dict["rating_vertical_offset"] = int(c.get("vertical_offset", 0))
                            vars_dict["rating_text_vertical_offset"] = int(c.get("vertical_offset", 0)) + 70

                    if any(k.lower() == "resolution" for k, _ in matched_entries) and ("overlays_movies.yml" in rule_name or "overlays_tv.yml" in rule_name):
                        res_coords = next(c for k, c in matched_entries if k.lower() == "resolution")
                        is_landscape_target = (target_format in ("episode_card", "titlecard", "backdrop", "background"))
                        is_banner = (not is_landscape_target) and bool(res_coords.get("mode") == "banner" or res_coords.get("banner_4k"))

                        if is_landscape_target and "overlays_tv.yml" in rule_name:
                            # For TV episode titlecards, update episode corner badge, preserving show poster 4K_banner!
                            vars_dict["4K"] = True
                            if "4K_banner" not in vars_dict:
                                vars_dict["4K_banner"] = True
                        else:
                            vars_dict["4K_banner"] = bool(is_banner)
                            vars_dict["4K"] = not is_banner

                        vars_dict["1080p"] = False
                        vars_dict["720p"] = False

                        if is_banner and not is_landscape_target:
                            vars_dict["horizontal_offset"] = 0
                            vars_dict["vertical_offset"] = 0
                            vars_dict["horizontal_align"] = "center"
                            vars_dict["vertical_align"] = "top"
                            vars_dict["back_color"] = "#00000000"
                        else:
                            h_al = res_coords.get("horizontal_align", "left")
                            v_al = res_coords.get("vertical_align", "top")
                            if is_landscape_target and h_al == "center" and not res_coords.get("horizontal_offset"):
                                h_al = "left"
                            vars_dict["horizontal_align"] = h_al
                            vars_dict["vertical_align"] = v_al
                            vars_dict["horizontal_offset"] = res_coords.get("horizontal_offset", 15)
                            vars_dict["vertical_offset"] = res_coords.get("vertical_offset", 15)
                            vars_dict["back_color"] = res_coords.get("back_color", "#00000099")
                            vars_dict["back_radius"] = int(res_coords.get("back_radius", 15))
                            vars_dict["back_width"] = int(res_coords.get("back_width", 260 if "tv" in rule_name else 245))
                            vars_dict["back_height"] = int(res_coords.get("back_height", 85 if "tv" in rule_name else 95))
                    elif best_key.lower() in ("runtime", "runtimes"):
                        for coord_k, coord_v in best_coords.items():
                            if coord_v is not None:
                                vars_dict[coord_k] = coord_v
                        if best_coords.get("font_size"):
                            vars_dict["font_size"] = int(best_coords["font_size"])
                        # In Kometa, back_width defines the container box width even when back_color is transparent.
                        # Preserve back_width if provided or present
                        if best_coords.get("back_width"):
                            vars_dict["back_width"] = int(best_coords["back_width"])
                        elif "back_width" not in vars_dict:
                            vars_dict["back_width"] = 205
                    else:
                        for coord_k, coord_v in best_coords.items():
                            if coord_v is not None:
                                vars_dict[coord_k] = coord_v
                    updated_count += 1

            # 2. For active dragged items that did not match an existing rule, append them safely
            has_res_file = any("overlays_movies.yml" in str(r.get("file") or "").lower() or "overlays_tv.yml" in str(r.get("file") or "").lower() for r in overlay_files if isinstance(r, dict))
            for key, coords in layout_updates.items():
                if key in matched_keys or not coords:
                    continue
                key_lower = key.lower()
                # If resolution is already handled by custom overlay files, never append default: resolution
                if key_lower == "resolution" and has_res_file:
                    continue
                # Internal UI keys should NEVER be appended as overlay rules in config.yml
                if key_lower in ("age_rating", "rating", "runtime"):
                    continue
                # If key is an age rating alias but an age rating rule is already configured, skip
                if key_lower in age_rating_aliases and any(any(cr in str(r.get("default") or r.get("file") or "").lower() for cr in age_rating_aliases) for r in overlay_files if isinstance(r, dict)):
                    continue
                clean_vars = {k: v for k, v in coords.items() if v is not None}
                if clean_vars:
                    def_key = key
                    if key_lower == "rating":
                        def_key = "ratings"
                    elif key_lower == "runtime":
                        def_key = "runtimes"
                    overlay_files.append({
                        "default": def_key,
                        "template_variables": clean_vars
                    })
                    matched_keys.add(key)
                    updated_count += 1

            # Remove any orphan/duplicate default: resolution rules if custom files are used
            if has_res_file:
                cleaned_files = [r for r in overlay_files if not (isinstance(r, dict) and r.get("default") == "resolution")]
                overlay_files.clear()
                overlay_files.extend(cleaned_files)

            if safe_path.exists():
                backup_path = safe_path.with_suffix(f"{safe_path.suffix}.bak")
                shutil.copy2(safe_path, backup_path)

            # Persist modified configuration data to config.yml across all active project locations
            target_configs = [safe_path]
            candidate_dirs = [
                self.project_root / "Overlayfiles" / "dynamic_overlays" / "configs",
                PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays" / "configs",
                Path("/config/Overlayfiles/dynamic_overlays/configs"),
                Path("/app/Overlayfiles/dynamic_overlays/configs"),
            ]
            for candidate_dir in candidate_dirs:
                if candidate_dir.exists():
                    cand_file = candidate_dir / filename
                    resolved_cand = cand_file.resolve()
                    if resolved_cand not in [t.resolve() for t in target_configs if t.exists()]:
                        target_configs.append(cand_file)

            for cfg_path in target_configs:
                try:
                    cfg_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(cfg_path, "w", encoding="utf-8") as f:
                        yaml.dump(data, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
                except Exception as save_err:
                    logger.debug(f"[OverlayResolver] Config sync notice for {cfg_path}: {save_err}")

            # Synchronize layout updates back to visual configuration JSON so both stay in lockstep
            vis_data = {}
            try:
                from dynamic_overlays_service import load_visual_config
                vis_data = load_visual_config()
            except Exception:
                vis_data = {}

            try:
                vis_libs = vis_data.setdefault("libraries", {})
                if clean_lib_name in vis_libs and "badges" in vis_libs[clean_lib_name]:
                    b = vis_libs[clean_lib_name]["badges"]
                    badge_map = {
                        "languages": "audio_languages",
                        "audio_languages": "audio_languages",
                        "runtimes": "runtime",
                        "runtime": "runtime",
                        "status": "status",
                        "resolution": "resolution",
                        "network": "network",
                        "anime": "anime",
                        "commonsense": "age_rating",
                        "content_rating_de": "age_rating",
                        "content_rating_us_movie": "age_rating",
                        "content_rating_uk": "age_rating",
                        "content_rating_au": "age_rating",
                        "content_rating_nz": "age_rating",
                        "content_rating_us_show": "age_rating",
                        "age_rating": "age_rating"
                    }
                    for l_key, l_coords in layout_updates.items():
                        target_badge = badge_map.get(l_key.lower())
                        if target_badge and target_badge in b and isinstance(l_coords, dict):
                            if "horizontal_offset" in l_coords:
                                b[target_badge]["offset_x"] = int(l_coords["horizontal_offset"])
                            if "vertical_offset" in l_coords:
                                b[target_badge]["offset_y"] = int(l_coords["vertical_offset"])
                            if "horizontal_align" in l_coords and "vertical_align" in l_coords:
                                b[target_badge]["position"] = f"{l_coords['vertical_align']}-{l_coords['horizontal_align']}"
                            if "font_size" in l_coords and l_coords["font_size"]:
                                b[target_badge]["font_size"] = int(l_coords["font_size"])
                            if "font" in l_coords:
                                b[target_badge]["font"] = str(l_coords["font"])
                            if l_key.lower() == "resolution":
                                if l_coords.get("mode") == "banner" or l_coords.get("banner_4k"):
                                    b[target_badge]["banner_4k"] = True
                                    b[target_badge]["mode"] = "banner"
                                elif l_coords.get("mode") == "corner_badge":
                                    b[target_badge]["banner_4k"] = False
                                    b[target_badge]["mode"] = "corner_badge"
                                    if "back_color" in l_coords:
                                        b[target_badge]["back_color"] = l_coords["back_color"]
                                    if "back_radius" in l_coords:
                                        b[target_badge]["back_radius"] = int(l_coords["back_radius"])
                                    if "back_width" in l_coords:
                                        b[target_badge]["back_width"] = int(l_coords["back_width"])
                                    if "back_height" in l_coords:
                                        b[target_badge]["back_height"] = int(l_coords["back_height"])

                    try:
                        from dynamic_overlays_service import save_visual_config
                        save_visual_config(vis_data)
                    except Exception as s_err:
                        logger.warning(f"[OverlayResolver] Error saving visual config: {s_err}")
            except Exception as vis_err:
                logger.warning(f"[OverlayResolver] Could not sync layout updates to visual config: {vis_err}")

            return {
                "success": True,
                "library_name": clean_lib_name,
                "updated_rules_count": updated_count,
                "total_rules": len(overlay_files)
            }
        except Exception as e:
            logger.error(f"[OverlayResolver] Error saving layout to {library_name}: {e}")
            return {"success": False, "error": str(e)}




# ==============================================================================
# CONFIG-DRIVEN DYNAMIC OVERLAY ENGINE (KOMETA COMPATIBLE)
# ==============================================================================
# HONOR & ATTRIBUTION:
# The OverlayConfigEngine implements configuration parsing, template substitution,
# dynamic queue slots, and rule matching designed by the Kometa Project (formerly PMM)
# created by meisnate12 and the Kometa team (licensed under the MIT License).
# ==============================================================================

def _kometa_replace_var(input_item: Any, search_dicts: List[Dict[str, Any]]) -> Any:
    if not isinstance(search_dicts, list):
        search_dicts = [search_dicts]
    return_item = input_item
    for _ in range(6):
        pass_start = return_item
        for search_dict in search_dicts:
            if not isinstance(search_dict, dict):
                continue
            for rk, rv in search_dict.items():
                if rv is None:
                    continue
                token = f"<<{rk}>>"
                if token == str(return_item):
                    return_item = rv
                elif token in str(return_item):
                    return_item = str(return_item).replace(token, str(rv))
        if return_item == pass_start or not isinstance(return_item, str) or "<<" not in return_item:
            break
    return return_item


def _kometa_substitute_vars_deep(data: Any, search_dicts: List[Dict[str, Any]]) -> Any:
    cur = data
    for _ in range(6):
        prev = cur
        if isinstance(cur, dict):
            res = {}
            for k, v in cur.items():
                new_k = _kometa_replace_var(k, search_dicts)
                new_v = _kometa_substitute_vars_deep(v, search_dicts)
                res[new_k] = new_v
            cur = res
        elif isinstance(cur, list):
            cur = [_kometa_substitute_vars_deep(item, search_dicts) for item in cur]
        elif isinstance(cur, str):
            cur = _kometa_replace_var(cur, search_dicts)
        if cur == prev or not str(cur).count("<<"):
            break
    return cur


def _kometa_evaluate_conditionals(
    conditionals: Dict[str, Any],
    variables: Dict[str, Any],
    defaults: Dict[str, Any]
) -> Dict[str, Any]:
    resolved = {}
    for con_key, con_def in conditionals.items():
        if not isinstance(con_def, dict):
            continue
        # Kometa modules/meta.py line 378: If variable was explicitly supplied by user, retain it
        if con_key in variables and variables[con_key] is not None and str(variables[con_key]) != "":
            resolved[con_key] = variables[con_key]
            continue
        cond_list = con_def.get("conditions", [])
        if isinstance(cond_list, dict):
            cond_list = [cond_list]
        found = False
        for condition in cond_list:
            if not isinstance(condition, dict) or "value" not in condition:
                continue
            passed = True
            for var_key, expected_val in condition.items():
                if var_key == "value":
                    continue
                clean_k = _kometa_replace_var(var_key, [variables, defaults, resolved])
                clean_exp = _kometa_replace_var(expected_val, [variables, defaults, resolved])

                if clean_k.endswith(".exists"):
                    target_k = clean_k[:-7]
                    should_exist = str(clean_exp).lower() in ("true", "1", "yes")
                    exists = target_k in variables and variables[target_k] not in (None, "", False)
                    if should_exist != exists:
                        passed = False
                        break
                elif clean_k.endswith(".not"):
                    target_k = clean_k[:-4]
                    val = variables.get(target_k, defaults.get(target_k, resolved.get(target_k)))
                    if isinstance(clean_exp, list):
                        if val in clean_exp:
                            passed = False
                            break
                    elif str(val) == str(clean_exp):
                        passed = False
                        break
                else:
                    target_k = clean_k
                    val = variables.get(target_k, defaults.get(target_k, resolved.get(target_k)))
                    if isinstance(clean_exp, list):
                        if isinstance(val, list):
                            if not any(x in clean_exp for x in val):
                                passed = False
                                break
                        elif val not in clean_exp and str(val) not in [str(x) for x in clean_exp]:
                            passed = False
                            break
                    else:
                        if isinstance(val, list):
                            if clean_exp not in val and str(clean_exp) not in [str(x) for x in val]:
                                passed = False
                                break
                        elif str(val) != str(clean_exp):
                            passed = False
                            break
            if passed:
                val = condition["value"]
                resolved[con_key] = _kometa_replace_var(val, [variables, defaults, resolved])
                found = True
                break
        if not found and "default" in con_def:
            def_val = con_def["default"]
            resolved[con_key] = _kometa_replace_var(def_val, [variables, defaults, resolved])
    return resolved


class OverlayConfigEngine:
    """
    Config-driven overlay resolution engine.
    Parses Kometa default YAMLs, custom overlay files, and user template_variables.
    Evaluates item metadata against rules, resolves groups/weights/suppress/queues,
    and produces ready-to-render layer dictionaries for DynamicOverlayCompositor.
    """
    def __init__(self, project_root: Path):
        self.project_root = Path(project_root)
        if (self.project_root / "assets").exists() and ((self.project_root / "defaults").exists() or (self.project_root / "configs").exists()):
            self.overlays_dir = self.project_root
        else:
            self.overlays_dir = self.project_root / "Overlayfiles" / "dynamic_overlays"
            if not self.overlays_dir.exists():
                legacy = self.project_root / "Overlayfiles" / "kometa"
                if legacy.exists():
                    self.overlays_dir = legacy
        self.kometa_dir = self.overlays_dir
        self.defaults_dir = self.overlays_dir / "defaults"
        self.configs_dir = self.overlays_dir / "configs"
        self.assets_dir = self.overlays_dir / "assets"
        self.fonts_dir = self.overlays_dir / "fonts"

        # Multi-root resolution: Collect all viable base candidate directories across Docker, project, and config
        self.candidate_roots: List[Path] = []
        for r in [self.project_root, PROJECT_ROOT, Path("/app"), Path("/config")]:
            if r and Path(r).exists() and Path(r) not in self.candidate_roots:
                self.candidate_roots.append(Path(r))

        self.candidate_font_dirs: List[Path] = []
        for cr in self.candidate_roots:
            for sub in [
                cr / "Overlayfiles" / "dynamic_overlays" / "fonts",
                cr / "Overlayfiles" / "kometa" / "fonts",
                cr / "Overlayfiles" / "dynamic_overlays" / "configs" / "fonts",
                cr / "Overlayfiles" / "kometa" / "configs" / "fonts",
                cr / "fonts",
            ]:
                if sub.exists() and sub not in self.candidate_font_dirs:
                    self.candidate_font_dirs.append(sub)
        if Path("/usr/share/fonts/custom").exists():
            self.candidate_font_dirs.append(Path("/usr/share/fonts/custom"))

        self.candidate_asset_dirs: List[Path] = []
        for cr in self.candidate_roots:
            for sub in [
                cr / "Overlayfiles" / "dynamic_overlays" / "assets",
                cr / "Overlayfiles" / "kometa" / "assets",
                cr / "Overlayfiles" / "dynamic_overlays" / "configs",
                cr / "Overlayfiles" / "kometa" / "configs",
                cr / "assets"
            ]:
                if sub.exists() and sub not in self.candidate_asset_dirs:
                    self.candidate_asset_dirs.append(sub)

        self.candidate_default_dirs: List[Path] = []
        for cr in self.candidate_roots:
            for sub in [
                cr / "Overlayfiles" / "dynamic_overlays" / "defaults",
                cr / "Overlayfiles" / "kometa" / "defaults",
                cr / "defaults"
            ]:
                if sub.exists() and sub not in self.candidate_default_dirs:
                    self.candidate_default_dirs.append(sub)

        # Load standard external templates (templates.yml) across candidates
        self.templates = {}
        for dd in self.candidate_default_dirs:
            tpl_path = dd / "templates.yml"
            if tpl_path.exists():
                try:
                    with open(tpl_path, "r", encoding="utf-8") as f:
                        self.templates = yaml.safe_load(f).get("templates", {})
                    if self.templates:
                        break
                except Exception as e:
                    logger.warning(f"[OverlayConfigEngine] Error loading templates.yml from {tpl_path}: {e}")

    def resolve_image_path(self, raw_path: Optional[str]) -> Optional[Path]:
        if not raw_path or str(raw_path).startswith("text(") or str(raw_path).startswith("blur("):
            return None
        p_str = str(raw_path).strip()
        # If full remote URL, extract filename
        if p_str.startswith(("http://", "https://")):
            p_str = Path(urllib.parse.urlparse(p_str).path).name
        # Clean extension
        if not p_str.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            p_str = f"{p_str}.png"

        stem = Path(p_str).stem.lower()
        flag_aliases = {"en": "us", "ja": "jp", "zh": "cn", "ko": "kr", "da": "dk", "sv": "se"}
        target_name = Path(p_str).name.lower()
        target_name_with_ext = target_name if target_name.endswith((".png", ".jpg", ".jpeg", ".webp")) else f"{target_name}.png"

        sub_dirs = [
            "",
            "flag/square", "flags/square", "flag/round", "flags/round",
            "resolution", "rating", "cr", "audio_codec",
            "audio_codec/compact", "audio_codec/standard",
            "network", "network/color", "network/white",
            "studio", "studio/standard", "studio/bigger",
            "streaming", "streaming/color", "streaming/white",
            "ribbon", "ribbon/red", "ribbon/black", "ribbon/yellow", "ribbon/gray",
            "logo/square", "logo/round"
        ]

        for base_asset_dir in self.candidate_asset_dirs:
            # 1. Direct path
            cand1 = base_asset_dir / p_str
            if cand1.exists():
                return cand1

            # 2. Flag vs flags
            if p_str.startswith("flag/"):
                c = base_asset_dir / ("flags" + p_str[4:])
                if c.exists():
                    return c
            elif p_str.startswith("flags/"):
                c = base_asset_dir / ("flag" + p_str[5:])
                if c.exists():
                    return c

            # 3. Subdirectories inside base_asset_dir
            for sub in sub_dirs:
                cand = base_asset_dir / sub / Path(p_str).name
                if cand.exists():
                    return cand
                if stem in flag_aliases:
                    cand_alias = base_asset_dir / sub / f"{flag_aliases[stem]}.png"
                    if cand_alias.exists():
                        return cand_alias
                sub_folder = base_asset_dir / sub
                if sub_folder.exists() and sub_folder.is_dir():
                    try:
                        for f in sub_folder.iterdir():
                            if f.is_file() and f.name.lower() in (target_name, target_name_with_ext):
                                return f
                    except Exception:
                        pass
        # 4. If not found locally, check if it resolves to an official Kometa raw image URL
        # Return expected local path so layer is NOT dropped, and compositor will auto-fetch it on-demand!
        official_url = resolve_official_kometa_image_url(p_str)
        if official_url:
            target_sub = official_url[len(KOMETA_IMAGES_RAW) + 1:] if official_url.startswith(f"{KOMETA_IMAGES_RAW}/") else Path(p_str).name
            base_target = self.candidate_asset_dirs[0] if self.candidate_asset_dirs else (self.project_root / "Overlayfiles" / "dynamic_overlays" / "assets")
            return base_target / target_sub

        return None

    def resolve_font_path(self, font_name: Optional[str]) -> Optional[str]:
        clean_name = Path(font_name).name if font_name else None

        # 1. Search clean_name in candidate font dirs
        if clean_name:
            for fd in self.candidate_font_dirs:
                cand = fd / clean_name
                if cand.exists():
                    return str(cand)
            # Check direct project relative
            for cr in self.candidate_roots:
                cand = cr / font_name
                if cand.exists():
                    return str(cand)

        # 2. Check standard fallbacks
        for fallback in ["Inter-Bold.ttf", "Inter-Medium.ttf", "CircularStd-Bold.otf", "Roboto-Bold.ttf", "Roboto-Medium.ttf"]:
            for fd in self.candidate_font_dirs:
                cand = fd / fallback
                if cand.exists():
                    return str(cand)

        # 3. If clean_name is an official Kometa font, return target path so compositor can auto-fetch it on-demand
        if clean_name and clean_name in OFFICIAL_KOMETA_FONTS:
            base_target = self.candidate_font_dirs[0] if self.candidate_font_dirs else (self.project_root / "Overlayfiles" / "dynamic_overlays" / "fonts")
            return str(base_target / clean_name)

        return None

    def load_overlay_file(self, file_entry: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
        """Loads YAML, returns (overlays_dict, queues_dict, templates_dict, merged_vars)."""
        file_path = None
        temp_vars = dict(file_entry.get("template_variables") or file_entry.get("variables") or {})

        # Normalize position / align aliases so both keys are populated
        if "horizontal_position" in temp_vars and "horizontal_align" not in temp_vars:
            temp_vars["horizontal_align"] = temp_vars["horizontal_position"]
        elif "horizontal_align" in temp_vars and "horizontal_position" not in temp_vars:
            temp_vars["horizontal_position"] = temp_vars["horizontal_align"]

        if "vertical_position" in temp_vars and "vertical_align" not in temp_vars:
            temp_vars["vertical_align"] = temp_vars["vertical_position"]
        elif "vertical_align" in temp_vars and "vertical_position" not in temp_vars:
            temp_vars["vertical_position"] = temp_vars["vertical_align"]

        if "default" in file_entry:
            name = str(file_entry["default"]).strip()
            for dd in self.candidate_default_dirs:
                cand_f = dd / f"{name}.yml"
                if cand_f.exists():
                    file_path = cand_f
                    break
        elif "file" in file_entry:
            f_str = str(file_entry["file"]).strip()
            if f_str.startswith("config/"):
                f_str = f_str[7:]
            for cr in self.candidate_roots:
                for sub in [cr / "Overlayfiles" / "dynamic_overlays" / "configs" / f_str, cr / "Overlayfiles" / "kometa" / "configs" / f_str, cr / file_entry["file"]]:
                    if sub.exists():
                        file_path = sub
                        break
                if file_path:
                    break

        if not file_path or not file_path.exists():
            return {}, {}, {}, {}

        try:
            with open(file_path, "r", encoding="utf-8-sig") as fp:
                data = yaml.safe_load(fp) or {}
        except Exception as e:
            logger.warning(f"[OverlayConfigEngine] Error parsing overlay file {file_path}: {e}")
            return {}, {}, {}, {}

        file_templates = {**self.templates, **data.get("templates", {})}
        file_queues = data.get("queues", {})
        file_overlays = data.get("overlays", {})

        ext_tpl = data.get("external_templates", {})
        ext_vars = ext_tpl.get("template_variables", {}) if isinstance(ext_tpl, dict) else {}

        merged_vars = {}
        for k, v in ext_vars.items():
            if k not in ("default", "conditionals"):
                merged_vars[k] = v
        if "default" in ext_vars:
            merged_vars.update(ext_vars["default"])
        merged_vars.update(temp_vars)

        if "conditionals" in ext_vars:
            cond_res = _kometa_evaluate_conditionals(ext_vars["conditionals"], merged_vars, ext_vars.get("default", {}))
            for ck, cv in cond_res.items():
                if ck not in temp_vars:
                    merged_vars[ck] = cv

        for k in ["back_color", "back_width", "back_height", "addon_position", "addon_offset", "final_name", "queue", "font", "font_size"]:
            if k in ext_vars and k not in merged_vars:
                merged_vars[k] = ext_vars[k]

        return file_overlays, file_queues, file_templates, merged_vars

    def evaluate_item(self, item_metadata: Dict[str, Any], library_rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Evaluates an individual item against all library rules.
        Resolves active overlays, queues, groups, weights, suppressions, and returns
        canonical layer dictionaries for DynamicOverlayCompositor.
        """
        applied_overlays: List[Dict[str, Any]] = []
        queue_overlays: Dict[str, List[Dict[str, Any]]] = {}
        all_queues: Dict[str, List[Dict[str, Any]]] = {}

        media_type = str(item_metadata.get("media_type", "movie")).lower()
        is_season = (item_metadata.get("season_number") is not None and media_type != "episode") or (media_type == "season")
        is_episode = (media_type == "episode") or bool(item_metadata.get("is_episode"))

        # Detect if custom ribbon banner is configured for resolution
        has_custom_banner = any(
            isinstance(r, dict) and (
                ("overlays_movies.yml" in str(r.get("file") or "").lower() or "overlays_tv.yml" in str(r.get("file") or "").lower())
                and bool((r.get("template_variables") or r.get("variables") or {}).get("4K_banner"))
            )
            for r in library_rules
        )

        for rule_entry in library_rules:
            if not isinstance(rule_entry, dict):
                continue
            # When custom ribbon banner is active, ignore any orphan default: resolution rules
            if has_custom_banner and rule_entry.get("default") == "resolution":
                continue
            res = self.load_overlay_file(rule_entry)
            if not res or len(res) < 4:
                continue
            file_overlays, file_queues, file_templates, file_vars = res

            # Resolve queues for this file
            for q_name, q_def in file_queues.items():
                if isinstance(q_def, dict) and "settings" in q_def:
                    slots = self._resolve_queue_slots(q_def["settings"], file_vars)
                    all_queues[q_name] = slots

            # Process each overlay in file
            for ov_key, ov_def in file_overlays.items():
                if not isinstance(ov_def, dict):
                    continue

                b_level = ov_def.get("collection_level") or ov_def.get("builder_level") or file_vars.get("builder_level")
                if b_level:
                    if isinstance(b_level, list):
                        b_levels = [str(x).strip().lower() for x in b_level]
                    else:
                        b_levels = [str(x).strip().lower() for x in str(b_level).split(",") if str(x).strip()]

                    if "all" in b_levels:
                        pass
                    elif is_episode and "episode" not in b_levels:
                        continue
                    elif is_season and "season" not in b_levels:
                        continue
                    elif not is_season and not is_episode and media_type in ("show", "series") and not any(x in b_levels for x in ("show", "series")):
                        continue
                    elif media_type == "movie" and "movie" not in b_levels:
                        continue
                else:
                    # In Kometa, default builder_level is show (for TV) or movie (for Movies).
                    # Seasons and episodes only receive overlays that explicitly set builder_level: season or episode.
                    # Exception: Status overlay in TV show libraries naturally applies to seasons unless restricted.
                    if is_episode:
                        continue
                    if is_season:
                        ov_name_check = (str(ov_key).lower() + " " + str(file_vars.get("default", "")).lower())
                        is_status_rule = "status" in ov_name_check or any("status" in str(t).lower() for t in file_templates.keys())
                        if not is_status_rule:
                            continue
                    elif media_type not in ("show", "series", "movie"):
                        continue

                expanded_ov = self._expand_overlay_definition(str(ov_key), ov_def, file_templates, file_vars)
                if not expanded_ov:
                    continue

                # Check run_definition if present (Kometa default: run_this / allowed_libraries)
                run_def = expanded_ov.get("run_definition")
                if run_def is not None:
                    if isinstance(run_def, list):
                        if any(str(r).strip().lower() in ("false", "none", "", "0") or r is False for r in run_def):
                            continue
                    elif str(run_def).strip().lower() in ("false", "none", "", "0") or run_def is False:
                        continue

                # Check plex_search, plex_all and secondary filters
                matches = False
                p_all = str(expanded_ov.get("plex_all") or ov_def.get("plex_all") or "").lower()
                if p_all in ("true", "1"):
                    matches = True
                elif "plex_search" in expanded_ov:
                    matches = self._match_filters(expanded_ov["plex_search"], item_metadata)
                elif "plex_search" in ov_def:
                    matches = self._match_filters(ov_def["plex_search"], item_metadata)

                sec_filters = expanded_ov.get("filters") or ov_def.get("filters")
                if matches and sec_filters:
                    if not self._match_filters(sec_filters, item_metadata):
                        matches = False

                if not matches:
                    continue

                ov_data = expanded_ov.get("overlay", {})
                if not isinstance(ov_data, dict):
                    continue

                def _clean_val(v, default=None):
                    if v is None:
                        return default
                    if isinstance(v, str):
                        if v.startswith("text("):
                            return v
                        s = v.strip()
                        if s.startswith("<<") and s.endswith(">>"):
                            inner = s[2:-2].strip()
                            if ":" in inner:
                                var_name, def_val = inner.split(":", 1)
                                var_name = var_name.strip()
                                def_val = def_val.strip()
                                if var_name in file_vars and file_vars[var_name] is not None:
                                    return str(file_vars[var_name])
                                return def_val if def_val else default
                            elif inner in file_vars and file_vars[inner] is not None:
                                return str(file_vars[inner])
                            return default
                        if "<<" in v or ">>" in v:
                            return default
                    return v

                def _clean_int(v, default=None):
                    cleaned = _clean_val(v, default)
                    if cleaned is None:
                        return None
                    try:
                        return int(cleaned)
                    except (ValueError, TypeError):
                        return default

                is_commonsense_rule = (
                    str(rule_entry.get("default", "")).lower() == "commonsense"
                    or "commonsense" in str(rule_entry.get("file", "")).lower()
                    or "commonsense" in str(file_vars.get("default", "")).lower()
                )

                mapping_name = f"{ov_key}"
                resolved_ov = {
                    "mapping_name": mapping_name,
                    "name": _clean_val(ov_data.get("name"), ov_key),
                    "default": _clean_val(ov_data.get("default")),
                    "file": _clean_val(ov_data.get("file")),
                    "url": _clean_val(ov_data.get("url")),
                    "group": _clean_val(ov_data.get("group")) or ("commonsense" if is_commonsense_rule else None),
                    "queue": _clean_val(ov_data.get("queue") or file_vars.get("queue")),
                    "weight": _clean_int(ov_data.get("weight")),
                    "suppress": ov_data.get("suppress", []),
                    "horizontal_align": _clean_val(ov_data.get("horizontal_align") or ov_data.get("horizontal_position") or file_vars.get("horizontal_align") or file_vars.get("horizontal_position"), "left"),
                    "horizontal_offset": _clean_int(ov_data.get("horizontal_offset") if ov_data.get("horizontal_offset") is not None else (file_vars.get("horizontal_offset") if file_vars.get("horizontal_offset") is not None else 0), 0),
                    "vertical_align": _clean_val(ov_data.get("vertical_align") or ov_data.get("vertical_position") or file_vars.get("vertical_align") or file_vars.get("vertical_position"), "top"),
                    "vertical_offset": _clean_int(ov_data.get("vertical_offset") if ov_data.get("vertical_offset") is not None else (file_vars.get("vertical_offset") if file_vars.get("vertical_offset") is not None else 0), 0),
                    "font": _clean_val(ov_data.get("font") or file_vars.get("font")),
                    "font_size": _clean_int(ov_data.get("font_size") or file_vars.get("font_size"), 40),
                    "font_color": _clean_val(ov_data.get("font_color") or file_vars.get("font_color"), "#FFFFFF"),
                    "stroke_color": _clean_val(ov_data.get("stroke_color")),
                    "stroke_width": _clean_int(ov_data.get("stroke_width"), 0),
                    # Do not blindly leak file_vars back_color to overlays (e.g. rating_high) that never requested it
                    "back_color": _clean_val(ov_data.get("back_color")),
                    "back_width": _clean_int(ov_data.get("back_width")),
                    "back_height": _clean_int(ov_data.get("back_height")),
                    "back_radius": _clean_int(ov_data.get("back_radius"), 0),
                    "back_padding": _clean_int(ov_data.get("back_padding"), 0),
                    "back_align": _clean_val(ov_data.get("back_align") or file_vars.get("back_align"), "center"),
                    "addon_position": _clean_val(ov_data.get("addon_position") or file_vars.get("addon_position")),
                    "addon_offset": _clean_int(ov_data.get("addon_offset") or file_vars.get("addon_offset"), 0),
                    "scale_width": _clean_int(ov_data.get("scale_width")),
                    "scale_height": _clean_int(ov_data.get("scale_height")),
                }

                # Resolution badge contrast fallback: if back_color not specified, default to dark glass pill
                if str(resolved_ov.get("name") or "").lower() in ("4k", "1080p", "720p", "576p", "480p", "resolution"):
                    if resolved_ov.get("back_color") is None:
                        is_land_item = bool(item_metadata.get("is_landscape") or item_metadata.get("is_backdrop") or is_episode)
                        resolved_ov["back_color"] = "#00000099"
                        resolved_ov["back_radius"] = 15
                        resolved_ov["back_width"] = 260 if is_land_item else 245
                        resolved_ov["back_height"] = 85 if is_land_item else 95

                q_name = resolved_ov["queue"]
                if q_name:
                    if q_name not in queue_overlays:
                        queue_overlays[q_name] = []
                    queue_overlays[q_name].append(resolved_ov)
                else:
                    applied_overlays.append(resolved_ov)

        final_overlays = self._resolve_groups_and_suppress(applied_overlays)

        for q_name, q_items in queue_overlays.items():
            slots = all_queues.get(q_name, [])
            sorted_q = sorted(q_items, key=lambda x: x.get("weight") or 0, reverse=True)
            for idx, item in enumerate(sorted_q):
                if idx < len(slots):
                    slot = slots[idx]
                    item["horizontal_align"] = slot["horizontal_align"]
                    item["horizontal_offset"] = slot["horizontal_offset"]
                    item["vertical_align"] = slot["vertical_align"]
                    item["vertical_offset"] = slot["vertical_offset"]
                    final_overlays.append(item)

        layers = []
        for ov in final_overlays:
            layer = self._convert_to_layer(ov, item_metadata)
            if layer:
                layers.append(layer)

        # When a resolution banner (e.g. 4K_banner) is present, remove any overlapping resolution/codec badges
        has_banner = any(l.get("name") in ("4K_banner", "resolution_banner") for l in layers)
        if has_banner:
            layers = [
                l for l in layers
                if str(l.get("name") or "").lower() not in (
                    "4k", "1080p", "720p", "576p", "480p", "dv", "hdr", "plus", "hlg", "force-filter", "resolution"
                )
            ]
        # Always remove invisible dummy triggers like Force-Filter
        layers = [l for l in layers if str(l.get("name") or "").lower() != "force-filter"]

        # Deduplicate commonsense / age rating layers to guarantee no double-printing on any poster
        seen_cs = False
        deduped_layers = []
        for l in layers:
            is_cs = (str(l.get("name") or "").lower() in ("commonsense", "age_rating") or 
                     (l.get("image_path") and "commonsense" in str(l.get("image_path")).lower()))
            if is_cs:
                if seen_cs:
                    continue
                seen_cs = True
            deduped_layers.append(l)
        layers = deduped_layers

        return layers

    def _resolve_groups_and_suppress(self, overlays: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        groups: Dict[str, List[Dict[str, Any]]] = {}
        non_group = []
        for ov in overlays:
            grp = ov.get("group")
            if grp:
                if grp not in groups:
                    groups[grp] = []
                groups[grp].append(ov)
            else:
                non_group.append(ov)

        survivors = list(non_group)
        for grp, items in groups.items():
            best = max(items, key=lambda x: x.get("weight") or 0)
            survivors.append(best)

        suppressed_names = set()
        for ov in survivors:
            supp_list = ov.get("suppress", [])
            if isinstance(supp_list, str):
                supp_list = [supp_list]
            for s in supp_list:
                suppressed_names.add(s)

        return [ov for ov in survivors if ov.get("mapping_name") not in suppressed_names and ov.get("name") not in suppressed_names]

    def _resolve_queue_slots(self, queue_settings: Dict[str, Any], variables: Dict[str, Any]) -> List[Dict[str, Any]]:
        defaults = queue_settings.get("default", {})
        conditionals = queue_settings.get("conditionals", {})
        con_resolved = _kometa_evaluate_conditionals(conditionals, variables, defaults)
        merged = {**defaults, **con_resolved, **variables}
        dyn = queue_settings.get("dynamic_position", {})

        init_v_align = _kometa_replace_var(dyn.get("initial_vertical_align", merged.get("initial_vertical_align", "top")), [merged])
        init_h_align = _kometa_replace_var(dyn.get("initial_horizontal_align", merged.get("initial_horizontal_align", "left")), [merged])
        init_v_off = int(_kometa_replace_var(dyn.get("initial_vertical_offset", merged.get("initial_vertical_offset", 0)), [merged]))
        init_h_off = int(_kometa_replace_var(dyn.get("initial_horizontal_offset", merged.get("initial_horizontal_offset", 0)), [merged]))

        # Explicit user variables override queue defaults
        if variables.get("initial_horizontal_offset") is not None:
            init_h_off = int(variables["initial_horizontal_offset"])
        elif variables.get("horizontal_offset") is not None:
            init_h_off = int(variables["horizontal_offset"])

        if variables.get("initial_vertical_offset") is not None:
            init_v_off = int(variables["initial_vertical_offset"])
        elif variables.get("vertical_offset") is not None:
            init_v_off = int(variables["vertical_offset"])

        if variables.get("initial_horizontal_align"):
            init_h_align = str(variables["initial_horizontal_align"])
        elif variables.get("horizontal_align"):
            init_h_align = str(variables["horizontal_align"])
        elif variables.get("horizontal_position") in ("left", "center", "right"):
            init_h_align = str(variables["horizontal_position"])

        if variables.get("initial_vertical_align"):
            init_v_align = str(variables["initial_vertical_align"])
        elif variables.get("vertical_align"):
            init_v_align = str(variables["vertical_align"])
        elif variables.get("vertical_position") in ("top", "center", "bottom"):
            init_v_align = str(variables["vertical_position"])

        v_spacing = int(_kometa_replace_var(dyn.get("vertical_spacing", merged.get("vertical_spacing", 0)), [merged]))
        h_spacing = int(_kometa_replace_var(dyn.get("horizontal_spacing", merged.get("horizontal_spacing", 0)), [merged]))
        surround = str(_kometa_replace_var(dyn.get("surround", merged.get("surround", False)), [merged])).lower() in ("true", "1")

        slots = [{
            "vertical_align": init_v_align,
            "horizontal_align": init_h_align,
            "vertical_offset": init_v_off,
            "horizontal_offset": init_h_off
        }]
        for x in range(20):
            factor = ((int(x / 2) + 1) * (-1 if x % 2 == 1 else 1)) if surround else (x + 1)
            slots.append({
                "vertical_align": init_v_align,
                "horizontal_align": init_h_align,
                "vertical_offset": init_v_off + (factor * v_spacing),
                "horizontal_offset": init_h_off + (factor * h_spacing)
            })
        return slots

    def _expand_overlay_definition(
        self,
        key: str,
        ov_def: Dict[str, Any],
        templates: Dict[str, Any],
        file_vars: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        merged_def = dict(ov_def)
        ov_vars = {**file_vars, "overlay_name": str(key), "key": str(key)}
        if "variables" in ov_def:
            ov_vars.update(ov_def["variables"])

        # Dynamically evaluate nested token definitions in ov_vars (e.g. text_<<key>>: <<text>>)
        for _ in range(3):
            updated = {}
            for vk, vv in list(ov_vars.items()):
                new_k = _kometa_replace_var(vk, [ov_vars])
                new_v = _kometa_replace_var(vv, [ov_vars])
                if new_k != vk or new_v != vv:
                    updated[new_k] = new_v
            if not updated:
                break
            ov_vars.update(updated)

        tpl_calls = ov_def.get("template")
        if tpl_calls:
            if not isinstance(tpl_calls, list):
                tpl_calls = [tpl_calls]
            for call in tpl_calls:
                call_dict = call if isinstance(call, dict) else {"name": str(call)}
                tpl_name = call_dict.get("name")
                if tpl_name in templates:
                    tpl_body = templates[tpl_name]
                    curr_vars = {**ov_vars, **call_dict}
                    tpl_defaults = tpl_body.get("default", {})

                    resolved_defaults = {}
                    for dk, dv in tpl_defaults.items():
                        clean_dk = _kometa_replace_var(dk, [curr_vars])
                        if clean_dk not in curr_vars or curr_vars[clean_dk] is None:
                            clean_dv = _kometa_replace_var(dv, [curr_vars, tpl_defaults])
                            resolved_defaults[clean_dk] = clean_dv

                    if "conditionals" in tpl_body:
                        conds = _kometa_evaluate_conditionals(tpl_body["conditionals"], curr_vars, resolved_defaults)
                        curr_vars.update(conds)
                        for dk, dv in resolved_defaults.items():
                            resolved_defaults[dk] = _kometa_replace_var(dv, [curr_vars, resolved_defaults])

                    expanded = _kometa_substitute_vars_deep(tpl_body, [curr_vars, resolved_defaults])
                    for mk, mv in expanded.items():
                        if mk not in ("default", "conditionals", "optional"):
                            if mk == "overlay" and isinstance(mv, dict):
                                if "overlay" not in merged_def:
                                    merged_def["overlay"] = {}
                                merged_def["overlay"].update(mv)
                            elif mk not in merged_def:
                                merged_def[mk] = mv

        final_def = _kometa_substitute_vars_deep(merged_def, [ov_vars, file_vars])
        return final_def

    def _match_filters(self, filters: Union[Dict[str, Any], List[Dict[str, Any]]], meta: Dict[str, Any]) -> bool:
        if not filters:
            return True
        if isinstance(filters, list):
            # In Kometa, list of filter dicts passes if ANY of the filter dicts matches
            return any(self._match_filters(f_item, meta) for f_item in filters if isinstance(f_item, dict))
        if "all" in filters:
            return all(self._check_condition(k, v, meta) for k, v in filters["all"].items())
        if "any" in filters:
            return any(self._check_condition(k, v, meta) for k, v in filters["any"].items())
        return all(self._check_condition(k, v, meta) for k, v in filters.items() if k not in ("validate", "type"))

    def _check_condition(self, k: str, v: Any, meta: Dict[str, Any]) -> bool:
        if k in ("title.is", "title", "show_title.is", "show_title"):
            st = str(meta.get("show_title") or meta.get("title") or "").strip().lower()
            targets = [str(x).strip().lower() for x in (v if isinstance(v, list) else [v])]
            return any(t == st for t in targets)
        if k in ("audio_track_title.regex", "audio_title.regex", "audio_track.regex", "audio.regex"):
            audio_cands = [
                str(meta.get("audio_track_title") or ""),
                str(meta.get("audio_title") or ""),
                str(meta.get("audio_codec") or ""),
                str(meta.get("audio_profile") or ""),
                str(meta.get("filepath") or ""),
                str(meta.get("clean_tc") or ""),
                str(meta.get("file") or ""),
                str(meta.get("title") or "")
            ]
            cand_str = " ".join(c for c in audio_cands if c)
            try:
                return bool(re.search(str(v), cand_str))
            except Exception:
                return False
        if k in ("filepath.regex", "file.regex", "filename.regex"):
            cand_str = str(meta.get("filepath") or meta.get("file") or meta.get("clean_tc") or "")
            if not cand_str and meta.get("title"):
                cand_str = str(meta.get("title"))
            s_num = meta.get("season_number")
            e_num = meta.get("episode_number")
            tag = f"S{s_num:02d}E{e_num:02d}" if (s_num is not None and e_num is not None) else ""
            pat = str(v)
            try:
                return bool(re.search(pat, tag)) or bool(re.search(pat, cand_str))
            except Exception:
                return False
        if k == "content_rating":
            raw_cr = meta.get("content_rating") or meta.get("rating")
            if not raw_cr:
                return False
            cr_str = str(raw_cr).strip().lower()
            if not cr_str or cr_str in ("none", "off", "false", "unknown", "null"):
                return False

            targets = [t.strip().lower() for t in str(v).split(",") if t.strip()]

            # Build comprehensive candidates for the item's content rating
            candidates = {cr_str}
            if "/" in cr_str:
                after_slash = cr_str.split("/")[-1].strip()
                candidates.add(after_slash)
            else:
                after_slash = cr_str

            # Clean common prefixes e.g. "fsk-16" -> "16", "rated r" -> "r", "pegi-18" -> "18"
            cleaned = re.sub(r'^(rated\s+|fsk[-\s]*|pegi[-\s]*|de[-\s]*)', '', after_slash).strip()
            if cleaned:
                candidates.add(cleaned)
                candidates.add(f"de/{cleaned}")
                candidates.add(f"gb/{cleaned}")
                candidates.add(f"us/{cleaned}")
                candidates.add(f"fsk-{cleaned}")
                candidates.add(f"fsk {cleaned}")
                candidates.add(f"fsk{cleaned}")

            # Extract pure digits if present (e.g. 16, 12, 6, 0, 18, 14, 13, 7)
            digits = "".join(ch for ch in cleaned if ch.isdigit())
            if digits:
                candidates.add(digits)
                candidates.add(digits.zfill(2))
                candidates.add(f"{digits}+")
                candidates.add(f"de/{digits}")
                candidates.add(f"gb/{digits}")
                candidates.add(f"no/{digits}")
                candidates.add(f"fsk-{digits}")
                candidates.add(f"fsk {digits}")
                if digits == "0":
                    candidates.update(["0", "00", "0+", "gb/0+", "de/0", "1", "01", "g", "all ages", "g - all ages", "u", "gb/u", "e", "gb/e"])

            # Strictly map standard equivalents per tier without cross-tier pollution
            if "pg-13" in candidates or "13" in candidates:
                candidates.update(["pg-13", "13", "13+", "pg-13 - teens 13 or older"])
            elif "tv-14" in candidates or "14" in candidates:
                candidates.update(["tv-14", "14", "14+"])
            elif "r" in candidates or "17" in candidates:
                candidates.update(["r", "17", "17+", "tvma", "tv-ma", "ma-17", "r - 17+ (violence & profanity)"])
            elif "nc-17" in candidates or "18" in candidates:
                candidates.update(["nc-17", "18", "18+", "r18", "gb/18", "de/18", "no/18"])
            elif "16" in candidates:
                candidates.update(["16", "16+", "de/16", "no/16"])
            elif "15" in candidates:
                candidates.update(["15", "15+", "gb/15", "no/15", "ma15+"])
            elif "12" in candidates:
                candidates.update(["12", "12+", "12a", "gb/12", "gb/12a", "de/12", "no/12"])
            elif "7" in candidates:
                candidates.update(["7", "07", "7+", "tv-y7", "no/7", "no/07"])
            elif "6" in candidates:
                candidates.update(["6", "06", "6+", "pg", "tv-pg", "de/6", "no/6"])
            elif "0" in candidates or "1" in candidates or "g" in candidates:
                candidates.update(["0", "00", "0+", "1", "01", "1+", "g", "tv-g", "tv-y", "de/0", "gb/0+", "gb/u", "u"])

            return any(c in targets for c in candidates)
        if k == "resolution":
            res = str(meta.get("resolution") or "").strip().lower()
            targets = [str(x).strip().lower() for x in (v if isinstance(v, list) else [v])]
            for t in targets:
                if t == "4k" and ("4k" in res or "2160" in res or "3840" in res or "uhd" in res):
                    return True
                if t == "1080p" and ("1080" in res or "fhd" in res):
                    return True
                if t == "720p" and ("720" in res or "hd" in res):
                    return True
                if t in ("576p", "576", "pal") and ("576" in res or "pal" in res):
                    return True
                if t in ("480p", "480", "sd", "ntsc") and ("480" in res or "sd" in res or "ntsc" in res):
                    return True
                if t == res:
                    return True
            return False
        if k in ("audio_language", "audio_languages"):
            item_langs = [str(l).strip().lower() for l in meta.get("audio_languages", [])]
            targets = [str(x).strip().lower() for x in (v if isinstance(v, list) else [v])]
            return any(t in item_langs for t in targets)
        if k in ("subtitle_language", "subtitle_languages"):
            item_langs = [str(l).strip().lower() for l in meta.get("subtitle_languages", [])]
            targets = [str(x).strip().lower() for x in (v if isinstance(v, list) else [v])]
            return any(t in item_langs for t in targets)
        if k.startswith("audience_rating") or k.startswith("rating"):
            raw_score = meta.get("audience_rating") or meta.get("rating")
            try:
                score = float(raw_score or 0.0)
            except (ValueError, TypeError):
                score = 0.0
            if k.endswith(".gte"):
                return score >= float(v)
            elif k.endswith(".lte"):
                return score <= float(v)
            elif k.endswith(".gt"):
                return score > float(v)
            elif k.endswith(".lt"):
                return score < float(v)
            try:
                return abs(score - float(v)) < 0.05
            except (ValueError, TypeError):
                return False
        if k in ("status", "tmdb_status"):
            raw_st = str(meta.get("status") or "").strip().lower()
            STATUS_CANONICAL = {
                "ended": "ended",
                "concluded": "ended",
                "finished": "ended",
                "returning series": "returning",
                "returning": "returning",
                "continuing": "returning",
                "renewed": "returning",
                "canceled": "canceled",
                "cancelled": "canceled",
                "airing": "airing",
                "in production": "airing",
                "planned": "airing",
                "pilot": "airing",
            }
            norm_st = STATUS_CANONICAL.get(raw_st, raw_st)
            targets = [str(x).strip().lower() for x in (v if isinstance(v, list) else [v])]
            norm_targets = [STATUS_CANONICAL.get(t, t) for t in targets]
            return norm_st in norm_targets or raw_st in targets or norm_st in targets
        if k == "episode_air_date":
            raw_st = str(meta.get("status") or "").strip().lower()
            return raw_st in ("airing", "returning series", "returning", "continuing", "in production")
        if k == "has_dolby_vision":
            has_dv = meta.get("has_dolby_vision") or ("dolby vision" in str(meta.get("video_format", "")).lower()) or ("dv" in str(meta.get("video_format", "")).lower())
            return bool(v) == bool(has_dv)
        if k == "has_hdr":
            has_hdr = meta.get("has_hdr") or ("hdr" in str(meta.get("video_format", "")).lower())
            return bool(v) == bool(has_hdr)
        if k in ("studio", "network"):
            raw_vals = []
            if meta.get("network"):
                raw_vals.append(str(meta.get("network")))
            if meta.get("networks"):
                for n in meta.get("networks", []):
                    raw_vals.append(str(n))
            if meta.get("studio"):
                raw_vals.append(str(meta.get("studio")))
            val_strs = [r.strip().lower() for r in raw_vals if r]
            targets = [str(x).strip().lower() for x in (v if isinstance(v, list) else [v])]
            return any(t in s or s in t for t in targets for s in val_strs)
        if k == "audio_codec":
            ac = str(meta.get("audio_codec") or "").strip().lower()
            targets = [str(x).strip().lower() for x in (v if isinstance(v, list) else [v])]
            return any(t in ac for t in targets)
        if k in ("edition", "edition.is", "cut", "version"):
            item_ed = str(meta.get("edition") or meta.get("editionTitle") or meta.get("cut") or "").strip().lower()
            targets = [str(x).strip().lower() for x in (v if isinstance(v, list) else [v])]
            return any(t == item_ed or t in item_ed for t in targets)
        if k in ("edition.regex", "cut.regex"):
            cand = str(meta.get("edition") or meta.get("editionTitle") or meta.get("cut") or meta.get("filepath") or meta.get("title") or "")
            try:
                return bool(re.search(str(v), cand, re.IGNORECASE))
            except Exception:
                return False
        if k.startswith("runtime") or k.startswith("duration"):
            rt = int(meta.get("runtime_mins") or meta.get("runtime") or meta.get("duration") or 0)
            try:
                v_num = int(v)
            except (ValueError, TypeError):
                v_num = 0
            if k.endswith(".gte"):
                return rt >= v_num
            elif k.endswith(".lte"):
                return rt <= v_num
            elif k.endswith(".gt"):
                return rt > v_num
            elif k.endswith(".lt"):
                return rt < v_num
            return rt == v_num
        if k.startswith("languages_count") or k.startswith("language_count"):
            raw_langs = meta.get("audio_languages") or meta.get("languages") or meta.get("detected_languages") or []
            if isinstance(raw_langs, str):
                raw_langs = [l.strip() for l in raw_langs.split(",") if l.strip()]
            cnt = len(raw_langs) if isinstance(raw_langs, (list, tuple, set)) else 0
            try:
                v_num = int(v)
            except (ValueError, TypeError):
                v_num = 0
            if k.endswith(".gte"):
                return cnt >= v_num
            elif k.endswith(".lte"):
                return cnt <= v_num
            elif k.endswith(".gt"):
                return cnt > v_num
            elif k.endswith(".lt"):
                return cnt < v_num
            return cnt == v_num
        return True

    def _convert_to_layer(self, ov: Dict[str, Any], meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        name_str = str(ov.get("name", "")).strip()
        is_text = name_str.startswith("text(")

        image_path = None
        if ov.get("file"):
            image_path = self.resolve_image_path(ov["file"])
        elif ov.get("overlay") and isinstance(ov.get("overlay"), str):
            image_path = self.resolve_image_path(ov["overlay"])
        elif ov.get("url"):
            image_path = self.resolve_image_path(ov["url"])
        elif ov.get("default"):
            image_path = self.resolve_image_path(ov["default"])
        elif not is_text:
            image_path = self.resolve_image_path(name_str)
        if not image_path and ov.get("url"):
            image_path = self.resolve_image_path(ov["url"])

        font_path = self.resolve_font_path(ov.get("font"))

        if is_text:
            match = re.search(r"text\((.+)\)", name_str)
            raw_text = match.group(1) if match else name_str
            if not raw_text or "_style" in raw_text or "_extra" in raw_text:
                return None
            rendered_text = self._render_text_tokens(raw_text, meta)

            if not rendered_text or "<<" in rendered_text or ">>" in rendered_text or "_style" in rendered_text or "_extra" in rendered_text:
                return None

            b_col = ov.get("back_color")
            is_trans = (b_col in ("#00000000", "transparent", None)) or (isinstance(b_col, str) and b_col.endswith("00") and len(b_col) == 9)
            bw = (int(ov["back_width"]) if ov.get("back_width") and int(ov["back_width"]) > 0 else None)
            bh = (int(ov["back_height"]) if ov.get("back_height") and int(ov["back_height"]) > 0 else None)
            is_runtime = ("runtime" in name_str.lower() or "runtime" in str(ov.get("mapping_name", "")).lower())
            is_landscape = bool(meta.get("is_landscape") or meta.get("is_backdrop") or meta.get("is_episode"))
            if is_runtime:
                if bh is None:
                    bh = 65 if is_landscape else 80
                if bw is None:
                    bw = 180 if is_landscape else 205

            font_sz = int(ov.get("font_size") or 40)
            strk_col = ov.get("stroke_color")
            strk_w = int(ov.get("stroke_width") or 0)
            if is_runtime:
                if not ov.get("font") or "inter-medium" in str(font_path).lower():
                    bold_font = self.resolve_font_path("fonts/Inter-Bold.ttf")
                    if bold_font:
                        font_path = bold_font
                if font_sz in (40, 55):
                    font_sz = 52 if is_landscape else 50
                if strk_w == 0:
                    strk_w = 2
                    strk_col = strk_col or "#000000D0"

            return {
                "name": ov.get("mapping_name", name_str),
                "type": "text",
                "text": rendered_text,
                "font_path": font_path,
                "font_size": font_sz,
                "font_color": ov.get("font_color") or "#FFFFFF",
                "stroke_color": strk_col,
                "stroke_width": strk_w,
                "image_path": str(image_path) if image_path else None,
                "horizontal_align": ov.get("horizontal_align") or ov.get("horizontal_position", "left"),
                "horizontal_offset": ov.get("horizontal_offset", 0),
                "vertical_align": ov.get("vertical_align") or ov.get("vertical_position", "top"),
                "vertical_offset": ov.get("vertical_offset", 0),
                "back_color": ov.get("back_color"),
                "back_width": bw,
                "back_height": bh,
                "back_radius": int(ov.get("back_radius") or 0),
                "back_padding": int(ov.get("back_padding") or 0),
                "back_align": ov.get("back_align", "center"),
                "addon_position": ov.get("addon_position"),
                "addon_offset": int(ov.get("addon_offset") or 0),
            }
        else:
            if not image_path:
                return None
            b_col = ov.get("back_color")
            is_trans = (b_col in ("#00000000", "transparent", None)) or (isinstance(b_col, str) and b_col.endswith("00") and len(b_col) == 9)
            return {
                "name": ov.get("mapping_name", name_str),
                "type": "image",
                "image_path": str(image_path),
                "scale_width": ov.get("scale_width"),
                "scale_height": ov.get("scale_height"),
                "horizontal_align": ov.get("horizontal_align") or ov.get("horizontal_position", "left"),
                "horizontal_offset": ov.get("horizontal_offset", 0),
                "vertical_align": ov.get("vertical_align") or ov.get("vertical_position", "top"),
                "vertical_offset": ov.get("vertical_offset", 0),
                "back_color": b_col,
                "back_width": (int(ov["back_width"]) if ov.get("back_width") and int(ov["back_width"]) > 0 else None) if not is_trans else None,
                "back_height": (int(ov["back_height"]) if ov.get("back_height") and int(ov["back_height"]) > 0 else None) if not is_trans else None,
                "back_radius": int(ov.get("back_radius") or 0),
                "back_padding": int(ov.get("back_padding") or 0),
                "back_align": ov.get("back_align", "center"),
            }

    def _render_text_tokens(self, text_tpl: str, meta: Dict[str, Any]) -> str:
        res = text_tpl
        if "_style" in res or "_extra" in res:
            return ""
        rt_mins = int(meta.get("runtime_mins") or meta.get("runtime") or meta.get("duration") or 0)
        if rt_mins <= 0 and ("<<runtime" in res):
            return ""
        hours = rt_mins // 60
        mins = rt_mins % 60
        res = res.replace("<<runtimeH>>", str(hours))
        res = res.replace("<<runtimeM>>", str(mins))
        res = res.replace("<<runtime>>", str(rt_mins))
        if hours == 0 and res.startswith("0h "):
            res = res[3:]

        score = float(meta.get("rating") or meta.get("audience_rating") or 0.0)
        score_str = f"{score:.1f}" if score > 0 else ""
        for special in ["audience_rating", "user_rating", "critic_rating", "rating"]:
            if res.strip() == special:
                res = f"<<{special}>>"
            res = res.replace(f"<<{special}>>", score_str)

        st = str(meta.get("status") or "")
        res = res.replace("<<status>>", st.upper())

        ed = str(meta.get("edition") or meta.get("editionTitle") or meta.get("cut") or "")
        res = res.replace("<<edition>>", ed)
        res = res.replace("<<cut>>", ed)
        res = res.replace("<<version>>", ed)
        return res


# ==============================================================================
# BACKWARD COMPATIBILITY ALIASES
# ==============================================================================
KometaResolver = OverlayResolver
safe_resolve_kometa_path = safe_resolve_overlay_path

