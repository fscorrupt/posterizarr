"""
Dynamic Overlays Management & Translation Service for Posterizarr
==================================================================
Eliminates raw YAML editing by translating structured UI configurations into
standard template YAML files and vice-versa.

Features:
1. Master Toggle: Feature is DISABLED by default (opt-in only).
2. Translation Engine: Reads/writes Overlayfiles/dynamic_overlays/configs/config.yml
   as clean, reactive JSON objects for the WebUI.
3. Import Engine: Allows importing existing YAML configurations once,
   translating them immediately into visual UI controls.
"""

import os
import re
import json
import shutil
import logging
from pathlib import Path, PurePosixPath
from typing import Dict, Any, List, Optional, Union, Tuple
import yaml

logger = logging.getLogger("dynamic_overlays_service")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

ASSET_OVERRIDE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def _normalize_asset_overrides(value: Any) -> Dict[str, Dict[str, str]]:
    normalized = {}
    if not isinstance(value, dict):
        return normalized
    for default_name, variants in value.items():
        family = str(default_name).strip().lower()
        if not re.fullmatch(r"[a-z0-9_-]+", family) or not isinstance(variants, dict):
            continue
        clean_variants = {}
        for variant, asset_path in variants.items():
            key = str(variant).strip().lower()
            path_text = str(asset_path or "").strip().replace("\\", "/")
            path = PurePosixPath(path_text)
            if (
                not re.fullmatch(r"[a-z0-9_-]+", key)
                or not path_text
                or path.is_absolute()
                or ":" in path_text
                or ".." in path.parts
                or path.suffix.lower() not in ASSET_OVERRIDE_EXTENSIONS
            ):
                continue
            clean_variants[key] = path.as_posix()
        if clean_variants:
            normalized[family] = clean_variants
    return normalized


def apply_asset_overrides_to_rules(overlay_files, asset_overrides, previous_overrides=None):
    current = _normalize_asset_overrides(asset_overrides)
    previous = _normalize_asset_overrides(previous_overrides)
    families = set(current) | set(previous)
    for family in families:
        targets = []
        for rule in overlay_files:
            if not isinstance(rule, dict):
                continue
            default_name = str(rule.get("default") or "").strip().lower()
            file_name = str(rule.get("file") or "").lower()
            if default_name == family or (family == "resolution" and any(name in file_name for name in ("overlays_movies.yml", "overlays_tv.yml"))):
                targets.append(rule)
        if not targets and current.get(family):
            target_rule = {"default": family, "template_variables": {}}
            overlay_files.append(target_rule)
            targets.append(target_rule)
        for rule in targets:
            variables = rule.setdefault("template_variables", {})
            if not isinstance(variables, dict):
                variables = {}
                rule["template_variables"] = variables
            for variant, old_path in previous.get(family, {}).items():
                if variant not in current.get(family, {}) and variables.get(f"file_{variant}") == old_path:
                    variables.pop(f"file_{variant}", None)
            for variant, asset_path in current.get(family, {}).items():
                variables[f"file_{variant}"] = asset_path
    return current

def get_config_dir() -> Path:
    """
    Resolve the writable configuration directory.
    In Docker / Container: /config ($env:APP_DATA).
    In Local / Dev: PROJECT_ROOT or directory pointed to by APP_DATA.
    """
    app_data = os.environ.get("APP_DATA")
    if app_data:
        p = Path(app_data)
        if p.exists():
            return p

    # In Docker, /config is the mounted writable volume
    if os.path.exists("/config") and os.path.isdir("/config"):
        return Path("/config")

    is_docker = (
        os.path.exists("/.dockerenv")
        or os.environ.get("DOCKER_ENV", "").lower() == "true"
        or os.environ.get("POSTERIZARR_NON_ROOT", "").lower() == "true"
    )
    if is_docker:
        return Path("/config")

    # Local development: PROJECT_ROOT
    return PROJECT_ROOT


def get_dynamic_overlays_config_dir() -> Path:
    """
    Resolve dedicated directory for Dynamic Overlays & AniMetaFill JSON configurations:
    /config/dynamic_overlays in Docker or PROJECT_ROOT/dynamic_overlays in local dev.
    """
    d = get_config_dir() / "dynamic_overlays"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_dynamic_overlays_settings_file(for_writing: bool = False) -> Path:
    """
    Resolve dynamic_overlays_settings.json path.
    All JSON configuration files strictly belong in /config/dynamic_overlays (Docker)
    or PROJECT_ROOT/dynamic_overlays (Local Dev). Never written to webui/backend.
    """
    folder = get_dynamic_overlays_config_dir()
    target = folder / "dynamic_overlays_settings.json"

    if for_writing:
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    if target.exists() and target.is_file():
        return target

    # Search candidates in priority order (migrating legacy copies to canonical destination)
    legacy_candidates = [
        folder / "settings.json",
        get_config_dir() / "dynamic_overlays_settings.json",
        PROJECT_ROOT / "dynamic_overlays_settings.json",
        Path(__file__).resolve().parent / "dynamic_overlays_settings.json",
        PROJECT_ROOT / "webui" / "backend" / "dynamic_overlays_settings.json"
    ]
    if os.environ.get("APP_DATA"):
        legacy_candidates.insert(0, Path(os.environ["APP_DATA"]) / "dynamic_overlays" / "dynamic_overlays_settings.json")
        legacy_candidates.insert(1, Path(os.environ["APP_DATA"]) / "dynamic_overlays_settings.json")
    if os.path.exists("/config/dynamic_overlays/dynamic_overlays_settings.json"):
        legacy_candidates.insert(0, Path("/config/dynamic_overlays/dynamic_overlays_settings.json"))
    if os.path.exists("/config/dynamic_overlays_settings.json"):
        legacy_candidates.insert(1, Path("/config/dynamic_overlays_settings.json"))

    for cand in legacy_candidates:
        try:
            if cand and cand.exists() and cand.is_file():
                try:
                    if cand.resolve() != target.resolve():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(cand, target)
                        logger.info(f"[DynamicOverlays] Auto-migrated settings JSON from {cand} to {target}")
                        return target
                except Exception:
                    pass
                return cand
        except Exception:
            continue

    return target


def get_visual_config_file(for_writing: bool = False) -> Path:
    """
    Resolve dynamic_overlays_visual_config.json path.
    All JSON configuration files strictly belong in /config/dynamic_overlays (Docker)
    or PROJECT_ROOT/dynamic_overlays (Local Dev). Never written to webui/backend.
    """
    folder = get_dynamic_overlays_config_dir()
    target = folder / "dynamic_overlays_visual_config.json"

    if for_writing:
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    if target.exists() and target.is_file():
        return target

    # Search candidates in priority order (migrating legacy copies to canonical destination)
    legacy_candidates = [
        folder / "visual_config.json",
        get_config_dir() / "dynamic_overlays_visual_config.json",
        PROJECT_ROOT / "dynamic_overlays_visual_config.json",
        Path(__file__).resolve().parent / "dynamic_overlays_visual_config.json",
        PROJECT_ROOT / "webui" / "backend" / "dynamic_overlays_visual_config.json"
    ]
    if os.environ.get("APP_DATA"):
        legacy_candidates.insert(0, Path(os.environ["APP_DATA"]) / "dynamic_overlays" / "dynamic_overlays_visual_config.json")
        legacy_candidates.insert(1, Path(os.environ["APP_DATA"]) / "dynamic_overlays_visual_config.json")
    if os.path.exists("/config/dynamic_overlays/dynamic_overlays_visual_config.json"):
        legacy_candidates.insert(0, Path("/config/dynamic_overlays/dynamic_overlays_visual_config.json"))
    if os.path.exists("/config/dynamic_overlays_visual_config.json"):
        legacy_candidates.insert(1, Path("/config/dynamic_overlays_visual_config.json"))

    for cand in legacy_candidates:
        try:
            if cand and cand.exists() and cand.is_file():
                try:
                    if cand.resolve() != target.resolve():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(cand, target)
                        logger.info(f"[DynamicOverlays] Auto-migrated visual config JSON from {cand} to {target}")
                        return target
                except Exception:
                    pass
                return cand
        except Exception:
            continue

    return target


def load_visual_config() -> Dict[str, Any]:
    """Load visual configuration JSON, returning empty dict if missing or invalid."""
    vis_file = get_visual_config_file(for_writing=False)
    if vis_file and vis_file.exists():
        try:
            with open(vis_file, "r", encoding="utf-8") as jf:
                return json.load(jf) or {}
        except Exception as e:
            logger.error(f"Error loading visual config from {vis_file}: {e}")
    return {}


# For backward-compatible imports that inspect SETTINGS_FILE / VISUAL_CONFIG_FILE as module attributes
SETTINGS_FILE = get_dynamic_overlays_settings_file(for_writing=False)
VISUAL_CONFIG_FILE = get_visual_config_file(for_writing=False)


def get_overlays_dir() -> Path:
    """
    Resolve active dynamic overlays directory.
    Prefers writable config directory (Overlayfiles/dynamic_overlays) in Docker,
    falling back to PROJECT_ROOT for local dev or existing installations.
    """
    config_dir = get_config_dir()
    p_config = config_dir / "Overlayfiles" / "dynamic_overlays"
    if p_config.exists():
        return p_config
    legacy_config = config_dir / "Overlayfiles" / "kometa"
    if legacy_config.exists():
        return legacy_config

    p = PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays"
    if p.exists():
        return p
    legacy = PROJECT_ROOT / "Overlayfiles" / "kometa"
    if legacy.exists():
        return legacy

    return p_config


def get_config_yml_path() -> Path:
    """
    Resolve active config.yml path.
    Prefers writable config dir, falls back to PROJECT_ROOT for reading if not found.
    """
    config_dir = get_config_dir()
    target = config_dir / "Overlayfiles" / "dynamic_overlays" / "configs" / "config.yml"
    if target.exists():
        return target

    legacy_target = config_dir / "Overlayfiles" / "kometa" / "configs" / "config.yml"
    if legacy_target.exists():
        return legacy_target

    proj_target = PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays" / "configs" / "config.yml"
    if proj_target.exists():
        return proj_target

    return target


# ==============================================================================
# 1. MASTER FEATURE SETTINGS (OFF BY DEFAULT)
# ==============================================================================

def get_dynamic_overlays_settings() -> Dict[str, Any]:
    """Retrieve master settings. Disabled by default."""
    defaults = {
        "enabled": False,  # DISABLED BY DEFAULT
        "auto_sync_on_startup": False,
        "sync_mode": "incremental",
        "backdrop_overlays_enabled": True,  # Support for 16:9 movie/show backgrounds
        "rating_sources": ["imdb", "tmdb", "tomatoes", "tomatoesaudience"],
        "rating_slots": {
            "rating1": "imdb",
            "rating2": "tomatoes",
            "rating3": "tmdb"
        },
        "rating_alignment": "vertical",  # "vertical" or "horizontal"
        "rating_position": "top-right",   # e.g., "top-right", "bottom-right"
        "rating_contrast_box": True,     # Translucent contrast box behind badges
        "mdblist_api_key": "",           # Optional MDBList API Key
        "omdb_api_key": "",              # Optional OMDb API Key
        "rating_cache_ttl_days": 7,      # Cache TTL
        "ratings_auto_refresh_enabled": True,
        "debug_logging": False,          # Switchable debug pixel log for overlay positioning
        "concurrency": 4,                # Number of parallel items processed concurrently
        "change_detection_enabled": True,# Fast bulk change detection for languages, cuts, runtime, status
        "change_detection_interval_minutes": 60, # Periodic auto-check interval
        "auto_resync_on_change": True,   # Automatically re-composite and sync when media changes detected
        "change_detection_dry_run": True,  # Detect changes without automatically applying overlays
        "fast_bulk_query_enabled": True, # Bulk section-level query optimization
        "wizard_dismissed": False,       # Onboarding wizard dismissed state
        "last_change_detection_at": None,
        "last_change_detection_summary": None,
        "last_updated": None
    }
    settings_file = get_dynamic_overlays_settings_file(for_writing=False)
    data = {}
    if settings_file.exists():
        try:
            with open(settings_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            logger.warning(f"Error reading dynamic overlays settings from {settings_file}: {e}")

    merged = {**defaults, **data}
    try:
        from config_database import ConfigDB
        from main import config_db, CONFIG_DATABASE_AVAILABLE
        if CONFIG_DATABASE_AVAILABLE and config_db:
            db_val = config_db.get_value("DynamicOverlays", "wizard_dismissed")
            if db_val is not None:
                merged["wizard_dismissed"] = bool(db_val)
    except Exception:
        pass

    return merged


def save_dynamic_overlays_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    """Save master settings to writable storage (/config in Docker) and sync with SQLite DB."""
    cur = get_dynamic_overlays_settings()
    cur.update(settings)
    cur["updated_at"] = os.environ.get("CURRENT_TIME", "")

    if "wizard_dismissed" in settings:
        try:
            from main import config_db, CONFIG_DATABASE_AVAILABLE
            if CONFIG_DATABASE_AVAILABLE and config_db:
                config_db.set_value("DynamicOverlays", "wizard_dismissed", bool(settings["wizard_dismissed"]))
        except Exception as ee:
            logger.warning(f"Error syncing wizard_dismissed to database: {ee}")

    target_file = get_dynamic_overlays_settings_file(for_writing=True)
    try:
        target_file.parent.mkdir(parents=True, exist_ok=True)
        with open(target_file, "w", encoding="utf-8") as f:
            json.dump(cur, f, indent=2)
        logger.info(f"Saved dynamic overlays settings to {target_file}")
    except Exception as e:
        logger.error(f"Error saving dynamic overlays settings to {target_file}: {e}")
    return cur


def save_visual_config(visual_data: Dict[str, Any]) -> bool:
    """Save visual configuration JSON to writable storage (/config in Docker)."""
    target_file = get_visual_config_file(for_writing=True)
    try:
        target_file.parent.mkdir(parents=True, exist_ok=True)
        with open(target_file, "w", encoding="utf-8") as jf:
            json.dump(visual_data, jf, indent=2)
        logger.info(f"Saved dynamic overlays visual config to {target_file}")
        return True
    except Exception as e:
        logger.error(f"Error saving visual configuration to {target_file}: {e}")
        return False


def is_dynamic_overlays_enabled() -> bool:
    """Check whether the dynamic overlays feature is enabled."""
    return bool(get_dynamic_overlays_settings().get("enabled", False))


# ==============================================================================
# 2. YAML <-> VISUAL JSON TRANSLATION ENGINE
# ==============================================================================

def extract_kometa_api_keys(config_dict: Any) -> Dict[str, str]:
    """
    Extracts mdblist_api_key and omdb_api_key from a Kometa configuration dict or raw YAML object.
    Supports standard Kometa format:
      mdblist:
        apikey: <key>
      omdb:
        apikey: <key>
    As well as common variations (api_key, key, token, direct string, flat keys, case-insensitive).
    Returns a dict with extracted keys, e.g. {"mdblist_api_key": "...", "omdb_api_key": "..."}.
    """
    if not isinstance(config_dict, dict):
        return {}

    extracted: Dict[str, str] = {}

    def _find_key_case_insensitive(d: Dict[str, Any], target_name: str) -> Optional[Any]:
        if not isinstance(d, dict):
            return None
        target_clean = target_name.lower().replace("-", "").replace("_", "")
        for k, v in d.items():
            if str(k).lower().replace("-", "").replace("_", "") == target_clean:
                return v
        return None

    def _extract_from_block(block: Any) -> Optional[str]:
        if block is None:
            return None
        if isinstance(block, (int, float)):
            s = str(block).strip()
            return s if s else None
        if isinstance(block, str):
            s = block.strip().strip("'\"")
            if not s or s.lower() in (
                "none", "null", "false", "your_api_key_here",
                "your_mdblist_api_key_here", "your_omdb_api_key_here",
                "change_me", "replace_me", "placeholder", "optional"
            ):
                return None
            return s
        if isinstance(block, dict):
            for candidate in ("apikey", "api_key", "key", "token", "secret", "value"):
                val = _find_key_case_insensitive(block, candidate)
                res = _extract_from_block(val)
                if res:
                    return res
        return None

    # Check top-level or under settings/apis/external
    search_dicts = [config_dict]
    for sub in ("settings", "apis", "api", "keys", "external", "connectors"):
        sub_val = _find_key_case_insensitive(config_dict, sub)
        if isinstance(sub_val, dict):
            search_dicts.append(sub_val)

    # 1. MDBList
    mdblist_key = None
    for d in search_dicts:
        block = _find_key_case_insensitive(d, "mdblist")
        mdblist_key = _extract_from_block(block)
        if mdblist_key:
            break
        for flat_name in ("mdblist_api_key", "mdblist_apikey", "mdblistapi", "mdblistkey"):
            val = _find_key_case_insensitive(d, flat_name)
            mdblist_key = _extract_from_block(val)
            if mdblist_key:
                break
        if mdblist_key:
            break

    if mdblist_key:
        extracted["mdblist_api_key"] = mdblist_key

    # 2. OMDb
    omdb_key = None
    for d in search_dicts:
        block = _find_key_case_insensitive(d, "omdb")
        omdb_key = _extract_from_block(block)
        if omdb_key:
            break
        for flat_name in ("omdb_api_key", "omdb_apikey", "omdbapi", "omdbkey"):
            val = _find_key_case_insensitive(d, flat_name)
            omdb_key = _extract_from_block(val)
            if omdb_key:
                break
        if omdb_key:
            break

    if omdb_key:
        extracted["omdb_api_key"] = omdb_key

    return extracted


POSITION_NORM_MAP = {
    ("left", "top"): "top-left",
    ("center", "top"): "top-center",
    ("right", "top"): "top-right",
    ("left", "center"): "center-left",
    ("center", "center"): "center",
    ("right", "center"): "center-right",
    ("left", "bottom"): "bottom-left",
    ("center", "bottom"): "bottom-center",
    ("right", "bottom"): "bottom-right",
}

def _to_unified_position(h_align: str, v_align: str) -> str:
    h = (h_align or "left").lower().strip()
    v = (v_align or "top").lower().strip()
    return POSITION_NORM_MAP.get((h, v), f"{v}-{h}")

def _split_unified_position(pos: str) -> Tuple[str, str]:
    pos = (pos or "top-left").lower().strip()
    if "-" in pos:
        v, h = pos.split("-", 1)
        return h, v
    if pos in ("top", "bottom"):
        return "center", pos
    if pos in ("left", "right"):
        return pos, "center"
    return "center", "center"


def get_media_server_library_type(lib_name: str) -> Optional[str]:
    """
    Looks up library media type ('movie' or 'show') from cached media server libraries database.
    Checks Plex, Emby, and Jellyfin.
    """
    if not lib_name:
        return None
    clean_target = lib_name.strip().lower()

    # 1. Try server_libraries_database module
    try:
        from server_libraries_database import ServerLibrariesDB
        # Check active singleton from main if available
        try:
            from main import server_libraries_db
            if server_libraries_db:
                for srv in ["plex", "jellyfin", "emby"]:
                    res = server_libraries_db.get_media_server_libraries(srv)
                    for cl in res.get("libraries") or []:
                        c_name = str(cl.get("name") or cl.get("title") or "").strip().lower()
                        if c_name == clean_target:
                            t = str(cl.get("type") or "").strip().lower()
                            if t in ("movie", "movies"):
                                return "movie"
                            if t in ("show", "shows", "tv", "tvshows"):
                                return "show"
        except Exception:
            pass

        # Check database files directly
        db_candidates = [
            get_config_dir() / "database" / "server_libraries.db",
            PROJECT_ROOT / "database" / "server_libraries.db",
            Path("/config/database/server_libraries.db")
        ]
        for db_p in db_candidates:
            if db_p.exists():
                db_obj = ServerLibrariesDB(db_p)
                for srv in ["plex", "jellyfin", "emby"]:
                    res = db_obj.get_media_server_libraries(srv)
                    for cl in res.get("libraries") or []:
                        c_name = str(cl.get("name") or cl.get("title") or "").strip().lower()
                        if c_name == clean_target:
                            t = str(cl.get("type") or "").strip().lower()
                            if t in ("movie", "movies"):
                                return "movie"
                            if t in ("show", "shows", "tv", "tvshows"):
                                return "show"
    except Exception as e:
        logger.debug(f"[DynamicOverlays] Library type lookup error for '{lib_name}': {e}")

    return None


def generate_starter_visual_config(detected_libraries: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    """
    Creates a turnkey starter visual configuration.
    Zero-config onboarding for users with no existing Kometa config.
    Auto-detects active media server libraries or seeds clean Movies & TV Shows.
    """
    libs_to_create = []
    if detected_libraries:
        libs_to_create = detected_libraries
    else:
        # Check if media server libraries can be discovered from server_libraries_database
        try:
            from server_libraries_database import ServerLibrariesDB
            db_candidates = [
                get_config_dir() / "database" / "server_libraries.db",
                PROJECT_ROOT / "database" / "server_libraries.db",
                Path("/config/database/server_libraries.db")
            ]
            for db_p in db_candidates:
                if db_p.exists():
                    db_obj = ServerLibrariesDB(db_p)
                    for s_type in ["plex", "jellyfin", "emby"]:
                        res = db_obj.get_media_server_libraries(s_type)
                        cached_libs = res.get("libraries") or []
                        for cl in cached_libs:
                            cl_name = cl.get("name") or cl.get("title")
                            raw_t = str(cl.get("type") or "").strip().lower()
                            if raw_t in ("artist", "music", "audiobook", "audiobooks", "boxsets", "collections"):
                                continue  # Skip audio/music/collections for poster overlays
                            cl_type = "movie" if raw_t in ("movie", "movies") else ("show" if raw_t in ("show", "shows", "tv", "tvshows") else None)
                            if not cl_type:
                                is_tv = any(w in str(cl_name).lower() for w in ["tv", "show", "series", "serie", "season", "episode"])
                                cl_type = "show" if is_tv else "movie"
                            if cl_name and not any(x["name"].lower() == cl_name.lower() for x in libs_to_create):
                                libs_to_create.append({"name": cl_name, "type": cl_type})
                    if libs_to_create:
                        break
        except Exception as e:
            logger.debug(f"[DynamicOverlays] Error discovering starter libraries: {e}")

    if not libs_to_create:
        libs_to_create = [
            {"name": "Movies", "type": "movie"},
            {"name": "TV Shows", "type": "show"}
        ]

    visual_libs = {}
    for lib_item in libs_to_create:
        lib_name = lib_item.get("name", "Movies")
        db_type = get_media_server_library_type(lib_name)
        media_type = lib_item.get("type") or db_type or ("show" if any(w in lib_name.lower() for w in ["tv", "show", "series", "serie", "season", "episode"]) else "movie")
        is_movie = (media_type == "movie")

        visual_libs[lib_name] = {
            "name": lib_name,
            "media_type": media_type,
            "enabled": True,
            "badges": {
                "resolution": {
                    "enabled": True,
                    "mode": "corner_badge",
                    "banner_4k": True,
                    "banner_1080p": False,
                    "banner_720p": False,
                    "tiers": ["4k", "1080p", "720p", "576p", "480p"],
                    "position": "top-left",
                    "offset_x": 15,
                    "offset_y": 15
                },
                "audio_codec": {
                    "enabled": True,
                    "style": "compact",
                    "position": "top-center",
                    "offset_x": 0,
                    "offset_y": 15,
                    "codecs": ["truehd_atmos", "dtsx", "plus_atmos", "dolby_atmos", "truehd", "ma", "flac", "pcm", "hra", "plus", "dtses", "dts", "digital", "aac", "mp3", "opus"]
                },
                "video_format": {
                    "enabled": True if is_movie else False,
                    "position": "bottom-left",
                    "offset_x": 15,
                    "offset_y": 15,
                    "formats": ["remux", "bluray", "web", "hdtv", "dvd", "telesync", "cam"]
                },
                "audio_languages": {
                    "enabled": True,
                    "languages": ["de", "en"],
                    "level": "movie" if is_movie else "episode",
                    "position": "bottom-left",
                    "style": "square",
                    "offset_x": 30,
                    "offset_y": 35 if is_movie else 30,
                    "limit": 5
                },
                "runtime": {
                    "enabled": True,
                    "level": "movie" if is_movie else "episode",
                    "position": "bottom-right",
                    "offset_x": 18,
                    "offset_y": 20,
                    "back_color": "#00000000",
                    "back_width": 205,
                    "back_height": 80
                },
                "status": {
                    "enabled": not is_movie,
                    "position": "bottom-center",
                    "offset_x": 0,
                    "offset_y": 23,
                    "font_size": 80,
                    "colors": {
                        "airing": "#27C24C",
                        "returning": "#FFA500",
                        "canceled": "#ED1F1F",
                        "ended": "#FF0000"
                    }
                },
                "network": {
                    "enabled": False,
                    "level": "season",
                    "position": "bottom-center",
                    "offset_x": 30,
                    "offset_y": 50,
                    "back_color": "#00000000"
                },
                "rating": {
                    "enabled": False,
                    "source": "audience_rating",
                    "position": "bottom-right",
                    "offset_x": 30,
                    "offset_y": 25,
                    "back_color": "#00000000",
                    "back_width": 130,
                    "back_height": 65
                },
                "critic_rating": {
                    "enabled": True,
                    "source": "ratings",
                    "level": "all",
                    "position": "bottom-right",
                    "offset_x": 30,
                    "offset_y": 25,
                    "back_color": "#00000000",
                    "back_width": 150,
                    "sources": ["imdb", "tomatoes", "tmdb"],
                    "orientation": "horizontal",
                    "spacing": 15,
                    "contrast_box": True,
                    "back_radius": 8,
                    "back_padding": 6,
                    "font_size": 30
                },
                "age_rating": {
                    "enabled": True,
                    "source": "commonsense",
                    "level": "movie" if is_movie else "show",
                    "position": "bottom-left",
                    "offset_x": 255,
                    "offset_y": 37,
                    "back_color": "#00000000",
                    "back_width": 230
                },
                "anime": {
                    "enabled": False,
                    "level": "episode"
                }
            }
        }
    return {"libraries": visual_libs}


def parse_config_yml_to_visual(config_path: Optional[Path] = None, auto_seed: bool = False) -> Dict[str, Any]:
    """
    Parses config.yml into a high-level, human-friendly JSON structure.
    Allows complete visual customization without touching YAML.
    If no configuration exists or libraries is empty, returns empty libraries by default.
    Never automatically seeds or overwrites config.yml on read.
    """
    path = config_path or get_config_yml_path()
    if not path.exists():
        vis_file = get_visual_config_file(for_writing=False)
        if vis_file.exists():
            try:
                with open(vis_file, "r", encoding="utf-8") as jf:
                    data = json.load(jf)
                    if data.get("libraries") and len(data["libraries"]) > 0:
                        return data
            except Exception:
                pass
        if auto_seed:
            return generate_starter_visual_config()
        return {"libraries": {}}

    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    except Exception as e:
        logger.error(f"Failed parsing {path}: {e}")
        return {"libraries": {}, "error": str(e)}

    # Extract API keys if present on import / read
    if isinstance(raw, dict):
        try:
            extracted_keys = extract_kometa_api_keys(raw)
            if extracted_keys:
                cur_settings = get_dynamic_overlays_settings()
                to_update = {}
                for k, v in extracted_keys.items():
                    if v and cur_settings.get(k) != v:
                        to_update[k] = v
                if to_update:
                    save_dynamic_overlays_settings(to_update)
                    logger.info(f"Extracted and updated API keys from {path.name}: {list(to_update.keys())}")
        except Exception as ee:
            logger.warning(f"Error extracting API keys from {path}: {ee}")

    raw_libs = raw.get("libraries", {})
    if not raw_libs:
        if auto_seed:
            return generate_starter_visual_config()
        return {"libraries": {}}

    visual_libs = {}

    # Load existing saved visual config to preserve user manual settings (like media_type)
    existing_vis = {}
    try:
        vis_file = get_visual_config_file(for_writing=False)
        if vis_file.exists():
            with open(vis_file, "r", encoding="utf-8") as jf:
                existing_vis = json.load(jf) or {}
    except Exception:
        pass
    saved_libs = existing_vis.get("libraries", {}) if isinstance(existing_vis, dict) else {}

    for lib_name, lib_data in raw_libs.items():
        if not isinstance(lib_data, dict):
            continue

        overlay_files = lib_data.get("overlay_files") or lib_data.get("overlays") or []
        asset_overrides = _normalize_asset_overrides(
            saved_libs.get(lib_name, {}).get("asset_overrides") if isinstance(saved_libs.get(lib_name), dict) else {}
        )

        db_type = get_media_server_library_type(lib_name)

        # Inspect overlay files in config for movie vs tv hints
        has_movie_rules = any(
            "overlays_movies" in str(e.get("file", "")).lower() or
            str((e.get("template_variables") or {}).get("builder_level", "")).lower() == "movie"
            for e in overlay_files if isinstance(e, dict)
        )
        has_tv_rules = any(
            "overlays_tv" in str(e.get("file", "")).lower() or
            str((e.get("template_variables") or {}).get("builder_level", "")).lower() in ("show", "episode", "season")
            for e in overlay_files if isinstance(e, dict)
        )

        media_type = None

        # 1. Media server library database is authoritative when available
        if db_type in ("movie", "show"):
            # If server database says movie, trust it unless the library only contains TV show rules
            if db_type == "movie" and has_tv_rules and not has_movie_rules:
                media_type = "show"
            elif db_type == "show" and has_movie_rules and not has_tv_rules:
                media_type = "movie"
            else:
                media_type = db_type

        # 2. Check overlay files in config (overlays_movies.yml vs overlays_tv.yml)
        if not media_type:
            if has_movie_rules and not has_tv_rules:
                media_type = "movie"
            elif has_tv_rules and not has_movie_rules:
                media_type = "show"

        # 3. Check explicit lib_data in YAML
        if not media_type:
            raw_t = str(lib_data.get("media_type") or lib_data.get("type") or "").strip().lower()
            if raw_t in ("movie", "movies"):
                media_type = "movie"
            elif raw_t in ("show", "shows", "tv", "tvshows"):
                media_type = "show"

        # 4. Check existing saved visual configuration
        if not media_type:
            if saved_libs.get(lib_name) and saved_libs[lib_name].get("media_type") in ("movie", "show"):
                media_type = saved_libs[lib_name]["media_type"]

        # 5. Check library name keywords (only mark show if TV/shows keywords match; otherwise default to movie)
        if not media_type:
            is_tv = any(w in lib_name.lower() for w in ["tv", "show", "series", "serie", "season", "episode"])
            media_type = "show" if is_tv else "movie"

        is_movie = (media_type == "movie")

        # Badge extraction
        badges: Dict[str, Any] = {
            "resolution": {
                "enabled": False,
                "mode": "corner_badge",
                "banner_4k": False,
                "banner_1080p": False,
                "banner_720p": False,
                "tiers": ["4k", "1080p", "720p", "576p", "480p"],
                "position": "top-left",
                "offset_x": 15,
                "offset_y": 15
            },
            "audio_codec": {
                "enabled": False,
                "style": "compact",
                "position": "top-center",
                "offset_x": 0,
                "offset_y": 15,
                "codecs": ["truehd_atmos", "dtsx", "plus_atmos", "dolby_atmos", "truehd", "ma", "flac", "pcm", "hra", "plus", "dtses", "dts", "digital", "aac", "mp3", "opus"]
            },
            "video_format": {
                "enabled": False,
                "position": "bottom-left",
                "offset_x": 15,
                "offset_y": 15,
                "formats": ["remux", "bluray", "web", "hdtv", "dvd", "telesync", "cam"]
            },
            "audio_languages": {
                "enabled": False,
                "languages": ["de", "en"],
                "level": "episode" if media_type == "show" else "movie",
                "position": "bottom-left",
                "style": "square",
                "offset_x": 30,
                "offset_y": 35 if media_type == "movie" else 30,
                "limit": 5
            },
            "runtime": {
                "enabled": False,
                "level": "episode" if media_type == "show" else "movie",
                "position": "bottom-right",
                "offset_x": 18,
                "offset_y": 20,
                "back_color": "#00000000",
                "back_width": 205,
                "back_height": 80
            },
            "status": {
                "enabled": False,
                "position": "bottom-center",
                "offset_x": 0,
                "offset_y": 23,
                "font_size": 80,
                "colors": {
                    "airing": "#27C24C",
                    "returning": "#FFA500",
                    "canceled": "#ED1F1F",
                    "ended": "#FF0000"
                }
            },
            "network": {
                "enabled": False,
                "level": "season",
                "position": "bottom-center",
                "offset_x": 30,
                "offset_y": 50,
                "back_color": "#00000000"
            },
            "rating": {
                "enabled": False,
                "source": "audience_rating",
                "position": "bottom-right",
                "offset_x": 30,
                "offset_y": 25,
                "back_color": "#00000000",
                "back_width": 130,
                "back_height": 65
            },
            "age_rating": {
                "enabled": False,
                "source": "commonsense",
                "position": "bottom-left",
                "offset_x": 255,
                "offset_y": 37,
                "back_color": "#00000000",
                "back_width": 230
            },
            "anime": {
                "enabled": False,
                "level": "episode"
            }
        }

        # Inspect overlay_files rules
        for entry in overlay_files:
            if not isinstance(entry, dict):
                continue

            default_name = str(entry.get("default", "")).lower()
            file_name = str(entry.get("file", "")).lower()
            vars_dict = entry.get("template_variables") or {}
            asset_family = default_name or (
                "resolution" if any(name in file_name for name in ("overlays_movies.yml", "overlays_tv.yml")) else ""
            )
            file_variables = {
                key[5:].lower(): value
                for key, value in vars_dict.items()
                if isinstance(key, str) and key.lower().startswith("file_")
            } if isinstance(vars_dict, dict) else {}
            if asset_family and file_variables:
                parsed_overrides = _normalize_asset_overrides({asset_family: file_variables})
                asset_overrides.setdefault(asset_family, {}).update(parsed_overrides.get(asset_family, {}))

            # 1. Languages
            if default_name == "languages":
                h_pos = vars_dict.get("horizontal_position") or vars_dict.get("horizontal_align", "left")
                v_pos = vars_dict.get("vertical_position") or vars_dict.get("vertical_align", "bottom")
                raw_x = vars_dict.get("horizontal_offset")
                raw_y = vars_dict.get("vertical_offset")
                def_y = 35 if media_type == "movie" else 30
                language_key = "subtitle_languages" if str(vars_dict.get("use_subtitles", False)).lower() in ("true", "1") else "audio_languages"
                badges[language_key] = {
                    "enabled": True,
                    "languages": vars_dict.get("languages", ["de", "en"]),
                    "level": vars_dict.get("builder_level", "episode" if media_type == "show" else "movie"),
                    "position": _to_unified_position(h_pos, v_pos),
                    "style": vars_dict.get("style", "square"),
                    "offset_x": int(raw_x) if raw_x is not None else 30,
                    "offset_y": int(raw_y) if raw_y is not None else def_y,
                    "limit": vars_dict.get("overlay_limit", 5),
                    "show_labels": str(vars_dict.get("hide_text", True)).lower() not in ("true", "1"),
                    "template_variables": dict(vars_dict)
                }

            elif default_name == "single_rating":
                h_pos = vars_dict.get("horizontal_align") or vars_dict.get("horizontal_position", "right")
                v_pos = vars_dict.get("vertical_align") or vars_dict.get("vertical_position", "bottom")
                badges["rating"] = {
                    "enabled": True, "source": "audience_rating",
                    "level": vars_dict.get("builder_level", "movie" if media_type == "movie" else "show"),
                    "position": _to_unified_position(h_pos, v_pos),
                    "offset_x": vars_dict.get("horizontal_offset", 30), "offset_y": vars_dict.get("vertical_offset", 25),
                    "theme": vars_dict.get("theme", "score")
                }

            # 2. Runtime
            elif default_name in ("runtimes", "runtime"):
                h_pos = vars_dict.get("horizontal_align") or vars_dict.get("horizontal_position", "center" if media_type == "movie" else "right")
                v_pos = vars_dict.get("vertical_align") or vars_dict.get("vertical_position", "bottom")
                raw_rt_x = vars_dict.get("horizontal_offset")
                raw_rt_y = vars_dict.get("vertical_offset")
                def_rt_x = 140 if media_type == "movie" else 18
                def_rt_y = 37 if media_type == "movie" else 20
                badges["runtime"] = {
                    "enabled": True,
                    "level": vars_dict.get("builder_level", "episode" if media_type == "show" else "movie"),
                    "position": _to_unified_position(h_pos, v_pos),
                    "offset_x": int(raw_rt_x) if raw_rt_x is not None else def_rt_x,
                    "offset_y": int(raw_rt_y) if raw_rt_y is not None else def_rt_y,
                    "font_size": int(vars_dict["font_size"]) if vars_dict.get("font_size") else (52 if media_type == "show" else 40),
                    "back_color": vars_dict.get("back_color", "#00000000"),
                    "back_width": int(vars_dict.get("back_width", 205)),
                    "back_height": int(vars_dict.get("back_height", 80)),
                    "text": vars_dict.get("text", ""),
                    "format": vars_dict.get("format", "<<runtimeH>>h <<runtimeM>>m")
                }

            # 3. Status
            elif default_name == "status":
                h_pos = vars_dict.get("horizontal_align") or vars_dict.get("horizontal_position", "center")
                v_pos = vars_dict.get("vertical_align") or vars_dict.get("vertical_position", "bottom")
                badges["status"] = {
                    "enabled": True,
                    "position": _to_unified_position(h_pos, v_pos),
                    "offset_x": vars_dict.get("horizontal_offset", 0),
                    "offset_y": vars_dict.get("vertical_offset", 23),
                    "font_size": vars_dict.get("font_size", 80),
                    "colors": {
                        "airing": vars_dict.get("font_color_airing", "#27C24C"),
                        "returning": vars_dict.get("font_color_returning", "#FFA500"),
                        "canceled": vars_dict.get("font_color_canceled", "#ED1F1F"),
                        "ended": vars_dict.get("font_color_ended", "#FF0000")
                    }
                }

            # 4. Network
            elif default_name == "network":
                h_pos = vars_dict.get("horizontal_position") or vars_dict.get("horizontal_align", "center")
                v_pos = vars_dict.get("vertical_position") or vars_dict.get("vertical_align", "bottom")
                badges["network"] = {
                    "enabled": True,
                    "level": vars_dict.get("builder_level", "season"),
                    "position": _to_unified_position(h_pos, v_pos),
                    "offset_x": vars_dict.get("horizontal_offset", 30),
                    "offset_y": vars_dict.get("vertical_offset", 50),
                    "back_color": vars_dict.get("back_color", "#00000000")
                }

            # 5a. Age Rating (Common Sense Media / Content Rating)
            elif default_name in ("commonsense", "content_rating"):
                h_pos = vars_dict.get("horizontal_position") or vars_dict.get("horizontal_align", "left")
                v_pos = vars_dict.get("vertical_position") or vars_dict.get("vertical_align", "bottom")
                badges["age_rating"] = {
                    "enabled": True,
                    "source": default_name,
                    "level": vars_dict.get("builder_level", "movie" if media_type == "movie" else "show"),
                    "position": _to_unified_position(h_pos, v_pos),
                    "offset_x": vars_dict.get("horizontal_offset", 255),
                    "offset_y": vars_dict.get("vertical_offset", 37),
                    "back_color": vars_dict.get("back_color", "#00000000"),
                    "back_width": vars_dict.get("back_width", 230)
                }

            # 5b. Critic & Audience Rating (IMDb / TMDB / Rotten Tomatoes)
            elif default_name in ("ratings", "rating"):
                h_pos = vars_dict.get("horizontal_align") or vars_dict.get("horizontal_position", "right")
                v_pos = vars_dict.get("vertical_align") or vars_dict.get("vertical_position", "bottom")
                badges["critic_rating"] = {
                    "enabled": True,
                    "source": "ratings",
                    "level": vars_dict.get("builder_level", "all"),
                    "position": _to_unified_position(h_pos, v_pos),
                    "offset_x": vars_dict.get("horizontal_offset", 30),
                    "offset_y": vars_dict.get("vertical_offset", 25),
                    "back_color": vars_dict.get("back_color", "#00000000"),
                    "back_width": vars_dict.get("back_width", 150),
                    "sources": vars_dict.get("sources") or vars_dict.get("rating_sources") or ["imdb", "tomatoes", "tmdb"],
                    "orientation": vars_dict.get("orientation", "horizontal"),
                    "spacing": vars_dict.get("spacing", 15),
                    "contrast_box": vars_dict.get("contrast_box", True),
                    "theme": vars_dict.get("theme", "dark"),
                    "back_radius": vars_dict.get("back_radius", 8),
                    "back_padding": vars_dict.get("back_padding", 6),
                    "font_size": vars_dict.get("font_size", 30)
                }

            # 6. Resolution Banner & Movie/TV overlay files
            elif "overlays_movies.yml" in file_name or "overlays_tv.yml" in file_name or default_name == "resolution":
                h_pos = vars_dict.get("horizontal_align") or vars_dict.get("horizontal_position", "left")
                v_pos = vars_dict.get("vertical_align") or vars_dict.get("vertical_position", "top")
                has_banner_4k = bool(vars_dict.get("4K_banner"))
                has_4k_badge = bool(vars_dict.get("4K"))

                # In TV show libraries:
                # - 4K_banner is a top ribbon banner specifically for show posters.
                # - 4K is a corner badge specifically for episode titlecards (defaulting to top-left, 15px offset).
                # Neither one cancels or displaces the other.
                is_banner = bool(has_banner_4k or vars_dict.get("mode") == "banner" or (vars_dict.get("4K_banner") is not False and ("overlays_movies.yml" in file_name or "overlays_tv.yml" in file_name) and not has_4k_badge))

                badge_pos = _to_unified_position(h_pos, v_pos)
                if badge_pos == "top-center" and (media_type == "show" or "tv" in file_name) and not vars_dict.get("horizontal_align"):
                    badge_pos = "top-left"
                    h_pos = "left"

                raw_x = vars_dict.get("horizontal_offset")
                raw_y = vars_dict.get("vertical_offset")
                off_x = int(raw_x) if raw_x is not None else 15
                off_y = int(raw_y) if raw_y is not None else 15

                badges["resolution"] = {
                    "enabled": True if default_name == "resolution" else bool(has_4k_badge or has_banner_4k or vars_dict.get("1080p")),
                    "mode": "banner" if (is_banner and media_type != "show") else ("both" if (has_banner_4k and has_4k_badge) else ("banner" if has_banner_4k else "corner_badge")),
                    "banner_4k": has_banner_4k,
                    "banner_1080p": bool(vars_dict.get("1080p_banner", vars_dict.get("1080p", False))),
                    "banner_720p": bool(vars_dict.get("720p_banner", False)),
                    "tiers": vars_dict.get("tiers", ["4k", "1080p", "720p", "576p", "480p"]),
                    "position": badge_pos,
                    "offset_x": off_x,
                    "offset_y": off_y,
                    "titlecard_enabled": has_4k_badge,
                    "titlecard_position": badge_pos,
                    "titlecard_offset_x": off_x,
                    "titlecard_offset_y": off_y,
                    "titlecard_mode": "corner_badge",
                    "back_color": vars_dict.get("back_color", "#00000099"),
                    "back_radius": int(vars_dict.get("back_radius", 15)),
                    "back_width": int(vars_dict.get("back_width", 260 if media_type == "show" else 245)),
                    "back_height": int(vars_dict.get("back_height", 85 if media_type == "show" else 95))
                }
                # When overlays_movies.yml or overlays_tv.yml is linked, audience rating pill is enabled by default
                if "overlays_movies.yml" in file_name or "overlays_tv.yml" in file_name:
                    badges["rating"] = {
                        "enabled": True,
                        "source": "audience_rating",
                        "position": "bottom-right",
                        "offset_x": 30,
                        "offset_y": 25,
                        "back_color": "#00000000",
                        "back_width": 130,
                        "back_height": 65
                    }

            # 7. Audio Codec Badges (Dolby Atmos, TrueHD, DTS:X, etc.)
            elif default_name in ("audio_codec", "audiocodec"):
                h_pos = vars_dict.get("horizontal_align") or vars_dict.get("horizontal_position", "center")
                v_pos = vars_dict.get("vertical_align") or vars_dict.get("vertical_position", "top")
                badges["audio_codec"] = {
                    "enabled": True,
                    "style": vars_dict.get("style", "compact"),
                    "position": _to_unified_position(h_pos, v_pos),
                    "offset_x": int(vars_dict.get("horizontal_offset", 0)),
                    "offset_y": int(vars_dict.get("vertical_offset", 15)),
                    "codecs": vars_dict.get("codecs", ["truehd_atmos", "dtsx", "plus_atmos", "dolby_atmos", "truehd", "ma", "flac", "pcm", "hra", "plus", "dtses", "dts", "digital", "aac", "mp3", "opus"])
                }

            # 8. Video Format Badges (Telesync, CAM, Remux, Blu-ray, Web, etc.)
            elif default_name in ("video_format", "videoformat", "format"):
                h_pos = vars_dict.get("horizontal_align") or vars_dict.get("horizontal_position", "left")
                v_pos = vars_dict.get("vertical_align") or vars_dict.get("vertical_position", "bottom")
                badges["video_format"] = {
                    "enabled": True,
                    "position": _to_unified_position(h_pos, v_pos),
                    "offset_x": int(vars_dict.get("horizontal_offset", 15)),
                    "offset_y": int(vars_dict.get("vertical_offset", 15)),
                    "formats": vars_dict.get("formats", ["remux", "bluray", "web", "hdtv", "dvd", "telesync", "cam"])
                }

            elif default_name in ("aspect", "studio", "streaming"):
                h_pos = vars_dict.get("horizontal_align") or vars_dict.get("horizontal_position", "center")
                v_pos = vars_dict.get("vertical_align") or vars_dict.get("vertical_position", "bottom")
                badges[default_name] = {
                    "enabled": True,
                    "level": vars_dict.get("builder_level", "movie" if media_type == "movie" else "show"),
                    "position": _to_unified_position(h_pos, v_pos),
                    "offset_x": int(vars_dict.get("horizontal_offset", 0)),
                    "offset_y": int(vars_dict.get("vertical_offset", 150)),
                    "template_variables": dict(vars_dict),
                    **({
                        "region": vars_dict.get("region", "US"),
                        "availability_types": vars_dict.get("availability_types", ["flatrate"]),
                        "style": vars_dict.get("style", "color"),
                        "limit": vars_dict.get("overlay_limit", 3),
                        "spacing": vars_dict.get("spacing", 115),
                        "orientation": vars_dict.get("orientation", "vertical")
                    } if default_name == "streaming" else {})
                }

            # 9. Anime Overlays
            elif "anime_overlays.yml" in file_name or default_name == "anime":
                h_pos = vars_dict.get("horizontal_align") or vars_dict.get("horizontal_position", "left")
                v_pos = vars_dict.get("vertical_align") or vars_dict.get("vertical_position", "top")
                badges["anime"] = {
                    "enabled": True,
                    "level": "episode",
                    "position": _to_unified_position(h_pos, v_pos),
                    "offset_x": vars_dict.get("horizontal_offset", 20),
                    "offset_y": vars_dict.get("vertical_offset", 20)
                }

        visual_libs[lib_name] = {
            "name": lib_name,
            "media_type": media_type,
            "enabled": True,
            "badges": badges,
            "asset_overrides": asset_overrides
        }

    return {"libraries": visual_libs}


def compile_visual_to_config_yml(visual_data: Dict[str, Any], output_path: Optional[Path] = None) -> bool:
    """
    Translates visual JSON data into standard, human-readable config.yml format.
    Preserves clean structure and compatibility while making UI 100% in control.
    """
    path = output_path or get_config_yml_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    libraries_dict = {}
    visual_libs = visual_data.get("libraries", {})

    for lib_name, lib_info in visual_libs.items():
        if not lib_info.get("enabled", True):
            continue

        media_type = lib_info.get("media_type", "movie")
        badges = lib_info.get("badges", {})
        overlay_files: List[Dict[str, Any]] = []

        # 1a. Age / Content Rating (Common Sense Media)
        b_age = badges.get("age_rating") or (badges.get("rating", {}) if badges.get("rating", {}).get("source") in ("commonsense", "content_rating") else None)
        if b_age and b_age.get("enabled"):
            h, v = _split_unified_position(b_age.get("position", "top-right"))
            age_vars: Dict[str, Any] = {
                "horizontal_position": h,
                "vertical_position": v,
                "horizontal_offset": int(b_age.get("offset_x", 255)),
                "vertical_offset": int(b_age.get("offset_y", 37)),
                "back_width": int(b_age.get("back_width", 230)),
                "back_color": b_age.get("back_color", "#00000000"),
                "font_size": int(b_age.get("font_size", 55)),
                "font": b_age.get("font") or "fonts/Inter-Medium.ttf"
            }
            if b_age.get("level"):
                age_vars["builder_level"] = b_age["level"]
            overlay_files.append({
                "default": b_age.get("source", "commonsense"),
                "template_variables": age_vars
            })

        b_single = badges.get("rating", {})
        if b_single.get("enabled") and b_single.get("source") == "audience_rating":
            h, v = _split_unified_position(b_single.get("position", "bottom-right"))
            overlay_files.append({"default": "single_rating", "template_variables": {
                "builder_level": b_single.get("level", "movie" if media_type == "movie" else "show"),
                "horizontal_align": h, "vertical_align": v,
                "horizontal_offset": int(b_single.get("offset_x", 30)), "vertical_offset": int(b_single.get("offset_y", 25)),
                "theme": b_single.get("theme", "score")
            }})

        # 1b. Audience & Critic Score Rating (IMDb / TMDB / Rotten Tomatoes)
        b_score = badges.get("critic_rating") or (badges.get("rating", {}) if badges.get("rating", {}).get("source") in ("ratings", "rating") else None)
        if b_score and b_score.get("enabled"):
            h, v = _split_unified_position(b_score.get("position", "top-right"))
            score_vars: Dict[str, Any] = {
                "horizontal_position": h,
                "vertical_position": v,
                "horizontal_offset": int(b_score.get("offset_x", 0)),
                "vertical_offset": int(b_score.get("offset_y", 0)),
                "back_color": b_score.get("back_color", "#00000000")
            }
            if b_score.get("level"):
                score_vars["builder_level"] = b_score["level"]
            if b_score.get("sources"):
                score_vars["sources"] = b_score["sources"]
            if b_score.get("orientation"):
                score_vars["orientation"] = b_score["orientation"]
            if b_score.get("spacing") is not None:
                score_vars["spacing"] = int(b_score["spacing"])
            if b_score.get("contrast_box") is not None:
                score_vars["contrast_box"] = bool(b_score["contrast_box"])
            if b_score.get("theme") in ("dark", "brand", "score"):
                score_vars["theme"] = b_score["theme"]
            if b_score.get("back_radius") is not None:
                score_vars["back_radius"] = int(b_score["back_radius"])
            if b_score.get("back_padding") is not None:
                score_vars["back_padding"] = int(b_score["back_padding"])
            if b_score.get("font_size") is not None:
                score_vars["font_size"] = int(b_score["font_size"])

            overlay_files.append({
                "default": "ratings",
                "template_variables": score_vars
            })

        # 2. Network (TV only)
        b_net = badges.get("network", {})
        if media_type == "show" and b_net.get("enabled"):
            h, v = _split_unified_position(b_net.get("position", "bottom-center"))
            overlay_files.append({
                "default": "network",
                "template_variables": {
                    "builder_level": b_net.get("level", "season"),
                    "horizontal_position": h,
                    "vertical_position": v,
                    "horizontal_offset": int(b_net.get("offset_x", 30)),
                    "vertical_offset": int(b_net.get("offset_y", 50)),
                    "back_color": b_net.get("back_color", "#00000000")
                }
            })

        # 3. Audio Languages
        for language_key in ("audio_languages", "subtitle_languages"):
            b_lang = badges.get(language_key, {})
            if not b_lang.get("enabled"):
                continue
            h, v = _split_unified_position(b_lang.get("position", "bottom-left"))
            overlay_files.append({
                "default": "languages",
                "template_variables": {
                    **b_lang.get("template_variables", {}),
                    "use_subtitles": language_key == "subtitle_languages",
                    "languages": b_lang.get("languages", ["de", "en"]),
                    "builder_level": b_lang.get("level", "episode" if media_type == "show" else "movie"),
                    "overlay_limit": int(b_lang.get("limit", 5)),
                    "horizontal_position": h,
                    "vertical_position": v,
                    "style": b_lang.get("style", "square"),
                    "horizontal_offset": int(b_lang.get("offset_x", 30)),
                    "vertical_offset": int(b_lang.get("offset_y", 35 if media_type == "movie" else 30)),
                    "back_color": "#00000000",
                    "hide_text": not b_lang.get("show_labels", False),
                    "font_color": "#FFFFFF",
                    "final_name": "text(<<final_text>>)"
                }
            })

        for badge_key in ("aspect", "studio", "streaming"):
            badge = badges.get(badge_key, {})
            if not badge.get("enabled"):
                continue
            h, v = _split_unified_position(badge.get("position", "bottom-center"))
            overlay_files.append({
                "default": badge_key,
                "template_variables": {
                    **badge.get("template_variables", {}),
                    "builder_level": badge.get("level", "movie" if media_type == "movie" else "show"),
                    "horizontal_align": h, "vertical_align": v,
                    "horizontal_offset": int(badge.get("offset_x", 0)),
                    "vertical_offset": int(badge.get("offset_y", 150)),
                    **({
                        "region": str(badge.get("region", "US")).upper(),
                        "availability_types": badge.get("availability_types", ["flatrate"]),
                        "style": badge.get("style", "color"),
                        "overlay_limit": int(badge.get("limit", 3)),
                        "spacing": int(badge.get("spacing", 115)),
                        "orientation": badge.get("orientation", "vertical")
                    } if badge_key == "streaming" else {})
                }
            })

        # 4. Show Status (TV only)
        b_stat = badges.get("status", {})
        if media_type == "show" and b_stat.get("enabled"):
            h, v = _split_unified_position(b_stat.get("position", "bottom-center"))
            colors = b_stat.get("colors", {})
            stat_vars: Dict[str, Any] = {
                "horizontal_align": h,
                "vertical_align": v,
                "horizontal_offset": int(b_stat.get("offset_x", 0)),
                "vertical_offset": int(b_stat.get("offset_y", 23)),
                "font_size": int(b_stat.get("font_size", 80)),
                "font": "config/fonts/Colus-Regular.ttf",
                "back_height": 149,
                "back_width": 965,
                "back_color": "#00000000",
                "font_color_airing": colors.get("airing", "#27C24C"),
                "font_color_returning": colors.get("returning", "#FFA500"),
                "font_color_canceled": colors.get("canceled", "#ED1F1F"),
                "font_color_ended": colors.get("ended", "#FF0000")
            }
            if b_stat.get("level"):
                stat_vars["builder_level"] = b_stat["level"]
            overlay_files.append({
                "default": "status",
                "template_variables": stat_vars
            })

        # 5. Runtime
        b_rt = badges.get("runtime", {})
        if b_rt.get("enabled"):
            default_pos = "bottom-center" if media_type == "movie" else "bottom-right"
            h, v = _split_unified_position(b_rt.get("position", default_pos))
            raw_rt_x = b_rt.get("offset_x")
            raw_rt_y = b_rt.get("offset_y")
            def_rt_x = 140 if media_type == "movie" else 18
            def_rt_y = 37 if media_type == "movie" else 20
            rt_vars = {
                "builder_level": b_rt.get("level", "episode" if media_type == "show" else "movie"),
                "horizontal_align": h,
                "vertical_align": v,
                "horizontal_offset": int(raw_rt_x) if raw_rt_x is not None else def_rt_x,
                "vertical_offset": int(raw_rt_y) if raw_rt_y is not None else def_rt_y,
                "font_size": int(b_rt["font_size"]) if b_rt.get("font_size") else (52 if media_type == "show" else 50),
                "font": b_rt.get("font") or "fonts/Inter-Bold.ttf",
                "back_color": b_rt.get("back_color", "#00000000"),
                "back_width": int(b_rt.get("back_width", 205)),
                "back_height": int(b_rt.get("back_height", 80)),
                "text": b_rt.get("text", ""),
                "format": b_rt.get("format", "<<runtimeH>>h <<runtimeM>>m")
            }
            overlay_files.append({
                "default": "runtimes",
                "template_variables": rt_vars
            })

        # 6. Resolution Overlays (Corner Badges or Top Ribbon Banner)
        b_res = badges.get("resolution", {})
        if b_res.get("enabled"):
            res_mode = b_res.get("mode", "ribbon" if b_res.get("banner_4k") else "corner_badge")
            h, v = _split_unified_position(b_res.get("position", "top-left"))
            if res_mode == "corner_badge" or (not b_res.get("banner_4k") and not b_res.get("banner_1080p")):
                overlay_files.append({
                    "default": "resolution",
                    "template_variables": {
                        "horizontal_align": h,
                        "vertical_align": v,
                        "horizontal_offset": int(b_res.get("offset_x", 15)),
                        "vertical_offset": int(b_res.get("offset_y", 15)),
                        "back_color": b_res.get("back_color", "#00000099"),
                        "back_radius": int(b_res.get("back_radius", 15)),
                        "back_width": int(b_res.get("back_width", 260 if media_type == "show" else 245)),
                        "back_height": int(b_res.get("back_height", 85 if media_type == "show" else 95))
                    }
                })
            else:
                target_cfg = "config/overlays_movies.yml" if media_type == "movie" else "config/overlays_tv.yml"
                is_banner = bool(b_res.get("banner_4k", False))
                has_corner = bool(b_res.get("titlecard_enabled", True if media_type == "show" else (not is_banner)))
                res_vars = {
                    "4K": has_corner,
                    "4K_banner": is_banner,
                    "1080p": bool(b_res.get("banner_1080p", False)),
                    "720p": bool(b_res.get("banner_720p", False))
                }
                if media_type == "show" or not is_banner:
                    res_vars["back_color"] = b_res.get("back_color", "#00000099")
                    res_vars["back_radius"] = int(b_res.get("back_radius", 15))
                    res_vars["back_width"] = int(b_res.get("back_width", 260 if media_type == "show" else 245))
                    res_vars["back_height"] = int(b_res.get("back_height", 85 if media_type == "show" else 95))
                    res_vars["horizontal_align"] = h
                    res_vars["vertical_align"] = v
                    res_vars["horizontal_offset"] = int(b_res.get("titlecard_offset_x", b_res.get("offset_x", 15)))
                    res_vars["vertical_offset"] = int(b_res.get("titlecard_offset_y", b_res.get("offset_y", 15)))
                # Ensure no duplicate default: resolution exists when custom overlay file is used
                overlay_files[:] = [r for r in overlay_files if not (isinstance(r, dict) and r.get("default") == "resolution")]
                overlay_files.append({
                    "file": target_cfg,
                    "template_variables": res_vars
                })

        # 7. Audio Codec Badges (Dolby Atmos, TrueHD, DTS:X, etc.)
        b_audio = badges.get("audio_codec", {})
        if b_audio.get("enabled"):
            h, v = _split_unified_position(b_audio.get("position", "top-center"))
            overlay_files.append({
                "default": "audio_codec",
                "template_variables": {
                    "style": b_audio.get("style", "compact"),
                    "horizontal_align": h,
                    "vertical_align": v,
                    "horizontal_offset": int(b_audio.get("offset_x", 0)),
                    "vertical_offset": int(b_audio.get("offset_y", 15))
                }
            })

        # 8. Video Format Badges (Telesync, CAM, Remux, Blu-ray, Web, etc.)
        b_vf = badges.get("video_format", {})
        if b_vf.get("enabled"):
            h, v = _split_unified_position(b_vf.get("position", "bottom-left"))
            overlay_files.append({
                "default": "video_format",
                "template_variables": {
                    "horizontal_align": h,
                    "vertical_align": v,
                    "horizontal_offset": int(b_vf.get("offset_x", 15)),
                    "vertical_offset": int(b_vf.get("offset_y", 15))
                }
            })

        # 9. Anime Badges (TV only)
        b_anim = badges.get("anime", {})
        if media_type == "show" and b_anim.get("enabled"):
            anim_vars = {}
            if "offset_x" in b_anim:
                anim_vars["horizontal_offset"] = b_anim["offset_x"]
            if "offset_y" in b_anim:
                anim_vars["vertical_offset"] = b_anim["offset_y"]
            entry = {"file": "config/anime_overlays.yml"}
            if anim_vars:
                entry["template_variables"] = anim_vars
            overlay_files.append(entry)

        apply_asset_overrides_to_rules(overlay_files, lib_info.get("asset_overrides"))

        libraries_dict[lib_name] = {
            "media_type": media_type,
            "schedule": "hourly(02),hourly(05),hourly(08),hourly(11),hourly(14),hourly(17),hourly(20),hourly(23)",
            "schedule_overlays": "hourly(02),hourly(05),hourly(08),hourly(11),hourly(14),hourly(17),hourly(20),hourly(23)",
            "overlay_files": overlay_files,
            "settings": {
                "asset_directory": f"/assets/{lib_name}",
                "prioritize_assets": True
            },
            "operations": {
                "assets_for_all": True
            }
        }

    existing_doc: Dict[str, Any] = {}
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as yf_in:
                loaded = yaml.safe_load(yf_in)
                if isinstance(loaded, dict):
                    existing_doc = loaded
        except Exception:
            pass

    out_doc = dict(existing_doc)
    out_doc["libraries"] = libraries_dict

    # Sync MDBList and OMDb API keys into config.yml if configured
    try:
        cur_settings = get_dynamic_overlays_settings()
        mdb_key = (cur_settings.get("mdblist_api_key") or "").strip()
        if mdb_key:
            if not isinstance(out_doc.get("mdblist"), dict):
                out_doc["mdblist"] = {}
            out_doc["mdblist"]["apikey"] = mdb_key
            if "cache_expiration" not in out_doc["mdblist"]:
                out_doc["mdblist"]["cache_expiration"] = 60

        omdb_key = (cur_settings.get("omdb_api_key") or "").strip()
        if omdb_key:
            if not isinstance(out_doc.get("omdb"), dict):
                out_doc["omdb"] = {}
            out_doc["omdb"]["apikey"] = omdb_key
            if "cache_expiration" not in out_doc["omdb"]:
                out_doc["omdb"]["cache_expiration"] = 60
    except Exception as se:
        logger.warning(f"Failed syncing API keys into {path}: {se}")

    try:
        with open(path, "w", encoding="utf-8") as yf:
            yaml.dump(out_doc, yf, default_flow_style=False, sort_keys=False, allow_unicode=True)

        # Cache visual config in JSON for fast UI retrieval
        save_visual_config(visual_data)

        logger.info(f"Successfully compiled visual configuration to {path}")
        return True
    except Exception as e:
        logger.error(f"Error compiling visual configuration to {path}: {e}")
        return False


def import_yaml_to_visual(raw_yaml_text: str) -> Dict[str, Any]:
    """
    Takes arbitrary YAML text pasted or uploaded by user,
    parses it, extracts external API keys, and returns the converted visual JSON representation.
    """
    try:
        data = yaml.safe_load(raw_yaml_text) or {}
    except Exception as e:
        raise ValueError(f"Invalid YAML syntax: {e}")

    # Extract API keys if present in Kometa config on import
    extracted_keys = {}
    if isinstance(data, dict):
        try:
            extracted_keys = extract_kometa_api_keys(data)
            if extracted_keys:
                save_dynamic_overlays_settings(extracted_keys)
                logger.info(f"Extracted API keys from imported Kometa YAML: {list(extracted_keys.keys())}")
        except Exception as ee:
            logger.warning(f"Error extracting API keys from imported YAML: {ee}")

    # Write temporarily to parse
    temp_path = get_overlays_dir() / "configs" / "temp_import.yml"
    temp_path.parent.mkdir(parents=True, exist_ok=True)
    res = {}
    try:
        with open(temp_path, "w", encoding="utf-8") as f:
            yaml.dump(data, f)
        res = parse_config_yml_to_visual(temp_path)
        if res and res.get("libraries"):
            save_visual_config(res)
            compile_visual_to_config_yml(res)
    finally:
        if temp_path.exists():
            temp_path.unlink()

    if isinstance(res, dict) and extracted_keys:
        res["extracted_keys"] = list(extracted_keys.keys())

    return res
