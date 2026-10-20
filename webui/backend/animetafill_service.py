"""
AniMetaFill Integration Service for Posterizarr.
Bridges AniMetaFill (Anime canon/filler/mixed episode classifier) directly into Posterizarr backend,
eliminating the need for an external container. Generates Kometa-compatible anime_overlays.yml
directly in Overlayfiles/kometa/configs/.
"""

import os
import sys
import json
import time
import shutil
import logging
import threading
import sqlite3
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime

logger = logging.getLogger("animetafill_service")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = Path(__file__).resolve().parent

def get_config_dir() -> Path:
    """Resolve writable configuration directory (/config in Docker, PROJECT_ROOT in local)."""
    app_data = os.environ.get("APP_DATA")
    if app_data and Path(app_data).exists():
        return Path(app_data)
    if os.path.exists("/config") and os.path.isdir("/config"):
        return Path("/config")
    is_docker = (
        os.path.exists("/.dockerenv")
        or os.environ.get("DOCKER_ENV", "").lower() == "true"
        or os.environ.get("POSTERIZARR_NON_ROOT", "").lower() == "true"
    )
    if is_docker:
        return Path("/config")
    return PROJECT_ROOT


def get_database_dir() -> Path:
    """Resolve database directory (/config/database in Docker, PROJECT_ROOT/database in local)."""
    return get_config_dir() / "database"


def get_dynamic_overlays_config_dir() -> Path:
    """Resolve dedicated directory for Dynamic Overlays & AniMetaFill JSON configurations."""
    d = get_config_dir() / "dynamic_overlays"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_ui_logs_dir() -> Path:
    """Resolve UILogs directory (/config/UILogs in Docker, PROJECT_ROOT/UILogs in local)."""
    app_data = os.environ.get("APP_DATA")
    if app_data and Path(app_data).exists():
        d = Path(app_data) / "UILogs"
    elif os.path.exists("/config") and os.path.isdir("/config"):
        d = Path("/config") / "UILogs"
    else:
        d = PROJECT_ROOT / "UILogs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_overlays_base_dir() -> Path:
    """Resolve base directory for dynamic overlays (persistent /config in Docker, PROJECT_ROOT in local)."""
    cfg_dir = get_config_dir()
    for base in [cfg_dir, PROJECT_ROOT]:
        candidate = base / "Overlayfiles" / "dynamic_overlays"
        if candidate.exists():
            return candidate
        legacy = base / "Overlayfiles" / "kometa"
        if legacy.exists():
            return legacy
    d = cfg_dir / "Overlayfiles" / "dynamic_overlays"
    d.mkdir(parents=True, exist_ok=True)
    return d


CONFIG_FILE = get_dynamic_overlays_config_dir() / "animetafill_config.json"
# Auto-migrate legacy animetafill_config.json from old locations if needed
if not CONFIG_FILE.exists():
    for _legacy_cfg in [
        get_config_dir() / "animetafill_config.json",
        PROJECT_ROOT / "animetafill_config.json",
        BACKEND_DIR / "animetafill_config.json"
    ]:
        if _legacy_cfg.exists():
            try:
                CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(_legacy_cfg, CONFIG_FILE)
                logger.info(f"[AniMetaFill] Auto-migrated config from {_legacy_cfg} to {CONFIG_FILE}")
                break
            except Exception as e:
                logger.warning(f"[AniMetaFill] Could not migrate config from {_legacy_cfg}: {e}")

LOG_FILE_PATH = get_ui_logs_dir() / "AniMetaFill.log"

_overlays_base = get_overlays_base_dir()
DEFAULT_YAML_OUTPUT = _overlays_base / "configs" / "anime_overlays.yml"
DEFAULT_DB_PATH = get_database_dir() / "animetafill.db"

_is_sync_running: bool = False
_last_sync_result: Dict[str, Any] = {
    "status": "idle",
    "timestamp": None,
    "shows_mapped": 0,
    "error": None
}


def _get_config_json_paths() -> List[Path]:
    """Return all valid candidate paths for config.json."""
    candidates = [
        PROJECT_ROOT / "config.json",
        Path(__file__).resolve().parent.parent.parent / "config.json",
    ]
    if os.environ.get("APP_DATA"):
        candidates.insert(0, Path(os.environ["APP_DATA"]) / "config.json")
    if os.path.exists("/config/config.json"):
        candidates.insert(0, Path("/config/config.json"))
    seen = set()
    valid = []
    for c in candidates:
        try:
            resolved = c.resolve()
            if resolved not in seen and c.exists():
                seen.add(resolved)
                valid.append(c)
        except Exception:
            if c.exists() and str(c) not in seen:
                seen.add(str(c))
                valid.append(c)
    return valid


def _get_posterizarr_config() -> Dict[str, Any]:
    """Read the latest config.json from Posterizarr."""
    paths = _get_config_json_paths()
    for p in paths:
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.debug(f"Error reading {p}: {e}")
    return {}


def _get_config_db_paths() -> List[Path]:
    """Discover all valid paths to config.db across workspace and deployment."""
    candidates = [
        PROJECT_ROOT / "database" / "config.db",
        BACKEND_DIR.parent / "database" / "config.db",
        BACKEND_DIR / "database" / "config.db"
    ]
    if os.environ.get("APP_DATA"):
        candidates.insert(0, Path(os.environ["APP_DATA"]) / "database" / "config.db")
    if os.path.exists("/config/database/config.db"):
        candidates.insert(0, Path("/config/database/config.db"))
    valid = []
    seen = set()
    for c in candidates:
        try:
            resolved = str(c.resolve())
            if resolved not in seen and c.exists():
                seen.add(resolved)
                valid.append(c)
        except Exception:
            if c.exists() and str(c) not in seen:
                seen.add(str(c))
                valid.append(c)
    return valid


def _read_from_config_db(section: str = "AniMetaFill") -> Dict[str, Any]:
    """Read all keys stored under a given section in config.db."""
    for db_path in _get_config_db_paths():
        try:
            conn = sqlite3.connect(db_path, timeout=10)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT key, value, value_type FROM config WHERE section = ?", (section,))
            rows = cursor.fetchall()
            conn.close()
            result: Dict[str, Any] = {}
            for r in rows:
                k = r["key"]
                val = r["value"]
                vt = r["value_type"]
                if vt == "boolean":
                    result[k] = str(val).lower() == "true"
                elif vt == "integer":
                    try:
                        result[k] = int(val)
                    except Exception:
                        result[k] = val
                elif vt == "float":
                    try:
                        result[k] = float(val)
                    except Exception:
                        result[k] = val
                elif vt in ("list", "dict"):
                    try:
                        result[k] = json.loads(val)
                    except Exception:
                        result[k] = val
                else:
                    result[k] = val
            if result:
                return result
        except Exception as e:
            logger.debug(f"Error reading from config.db at {db_path}: {e}")
    return {}


def _write_to_config_db(data: Dict[str, Any], section: str = "AniMetaFill") -> None:
    """Save key-value pairs into config.db under the given section."""
    for db_path in _get_config_db_paths():
        try:
            db_path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(db_path, timeout=10)
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    section TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT,
                    value_type TEXT NOT NULL,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                    updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
                    UNIQUE(section, key)
                )
            """)
            for k, val in data.items():
                if val is None:
                    continue
                if isinstance(val, bool):
                    val_type = "boolean"
                    val_str = "true" if val else "false"
                elif isinstance(val, int):
                    val_type = "integer"
                    val_str = str(val)
                elif isinstance(val, float):
                    val_type = "float"
                    val_str = str(val)
                elif isinstance(val, (list, dict)):
                    val_type = "dict" if isinstance(val, dict) else "list"
                    val_str = json.dumps(val)
                else:
                    val_type = "string"
                    val_str = str(val)

                cursor.execute("""
                    INSERT INTO config (section, key, value, value_type, updated_at)
                    VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
                    ON CONFLICT(section, key)
                    DO UPDATE SET
                        value = excluded.value,
                        value_type = excluded.value_type,
                        updated_at = datetime('now', 'localtime')
                """, (section, k, val_str, val_type))
            conn.commit()
            conn.close()
            logger.info(f"Saved {len(data)} AniMetaFill setting(s) to config.db at {db_path}")
        except Exception as e:
            logger.warning(f"Error writing to config.db at {db_path}: {e}")


def _clean_config_json_ui_sections() -> None:
    """
    Ensure UI-only settings like SonarrPart and SimklClientId are NEVER written to config.json.
    Cleans them out if they were previously placed there.
    """
    for p in _get_config_json_paths():
        try:
            if not p.exists():
                continue
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            modified = False
            if "SonarrPart" in data:
                del data["SonarrPart"]
                modified = True
            if "ApiPart" in data and isinstance(data["ApiPart"], dict) and "SimklClientId" in data["ApiPart"]:
                del data["ApiPart"]["SimklClientId"]
                modified = True
            if modified:
                with open(p, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
                logger.info(f"Cleaned UI-only sections from {p}")
        except Exception as e:
            logger.debug(f"Error cleaning {p}: {e}")


def _get_default_show_libraries(media_server: str = "plex") -> List[str]:
    """
    Query cached media server libraries and return ONLY libraries of type 'show' / 'tv'.
    Movies and music libraries are strictly excluded for anime titlecards.
    """
    db_candidates = [
        PROJECT_ROOT / "database" / "server_libraries.db",
        BACKEND_DIR.parent / "database" / "server_libraries.db",
        BACKEND_DIR / "database" / "server_libraries.db"
    ]
    if os.environ.get("APP_DATA"):
        db_candidates.insert(0, Path(os.environ["APP_DATA"]) / "database" / "server_libraries.db")
    if os.path.exists("/config/database/server_libraries.db"):
        db_candidates.insert(0, Path("/config/database/server_libraries.db"))
    for db_p in db_candidates:
        if db_p.exists():
            try:
                conn = sqlite3.connect(db_p, timeout=5)
                cur = conn.cursor()
                cur.execute(
                    "SELECT name, type FROM media_server_libraries WHERE LOWER(server_type) = ? AND is_excluded = 0",
                    (media_server.lower(),)
                )
                rows = cur.fetchall()
                conn.close()
                show_libs = []
                for name, l_type in rows:
                    if str(l_type).lower() in ("show", "tv"):
                        if "anime" in name.lower():
                            show_libs.append(name)
                if show_libs:
                    return show_libs
                for name, l_type in rows:
                    if str(l_type).lower() in ("show", "tv"):
                        show_libs.append(name)
                if show_libs:
                    return show_libs
            except Exception as e:
                logger.debug(f"Error querying server_libraries.db: {e}")
    return ["Anime Shows"]


def _get_posterizarr_config() -> Dict[str, Any]:
    """Read the latest config.json from Posterizarr for media server URLs/tokens."""
    paths = _get_config_json_paths()
    for p in paths:
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.debug(f"Error reading {p}: {e}")
    return {}


def _detect_configured_server() -> str:
    """Detect which media server is actively enabled in Posterizarr config.json."""
    pj_config = _get_posterizarr_config()
    plex_part = pj_config.get("PlexPart", {})
    jf_part = pj_config.get("JellyfinPart", {})
    emby_part = pj_config.get("EmbyPart", {})
    
    use_emby = str(emby_part.get("UseEmby", pj_config.get("UseEmby", ""))).lower() == "true"
    use_jf = str(jf_part.get("UseJellyfin", pj_config.get("UseJellyfin", ""))).lower() == "true"
    use_plex = str(plex_part.get("UsePlex", pj_config.get("UsePlex", ""))).lower() == "true"

    if use_emby and not use_plex and not use_jf:
        return "emby"
    if use_jf and not use_plex:
        return "jellyfin"
    if use_plex:
        return "plex"
    if emby_part.get("EmbyUrl") and not plex_part.get("PlexUrl"):
        return "emby"
    if jf_part.get("JellyfinUrl") and not plex_part.get("PlexUrl"):
        return "jellyfin"
    return "plex"


def _get_defaults() -> Dict[str, Any]:
    """Load default settings with zero hardcoded keys or IDs."""
    server = _detect_configured_server()
    return {
        "enabled": False,
        "media_server": server,  # plex, jellyfin, or emby
        "target_libraries": ["Anime Shows"],
        "labels": {
            "canon": "Canon",
            "filler": "Filler",
            "mixed": "Mixed"
        },
        "colors": {
            "canon": "#27C24CB3",
            "filler": "#FF0000B3",
            "mixed": "#FFA500B3"
        },
        "aesthetic": {
            "horizontal_align": "left",
            "vertical_align": "top",
            "horizontal_offset": 0,
            "vertical_offset": 15,
            "back_color": "#000000BF",
            "back_width": 300,
            "back_height": 100,
            "font_size": 70
        },
        "mal_enabled": True,
        "last_sync": None,
        "last_status": "idle",
        "last_error": None
    }


def get_animetafill_config() -> Dict[str, Any]:
    """
    Returns stored AniMetaFill configuration.
    Sonarr credentials, SIMKL ID, and UI preferences are strictly read from config.db.
    Plex/Jellyfin/Emby credentials are read from config.json (single source of truth for media servers).
    """
    defaults = _get_defaults()
    app_cfg = {}
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                app_cfg = json.load(f)
        except Exception as e:
            logger.warning(f"Error loading {CONFIG_FILE}: {e}")

    # Read from config.db (takes precedence for UI settings and UI credentials)
    db_cfg = _read_from_config_db("AniMetaFill")

    merged = {**defaults, **app_cfg, **db_cfg}
    primary_server = _detect_configured_server()
    user_chosen_server = db_cfg.get("media_server") or app_cfg.get("media_server")
    if user_chosen_server and str(user_chosen_server).lower().strip() in ("plex", "jellyfin", "emby"):
        media_server = str(user_chosen_server).lower().strip()
    else:
        media_server = primary_server
    merged["media_server"] = media_server

    # Preselect target libraries strictly of type 'show' if empty
    target_libs = merged.get("target_libraries") or merged.get("plex_libraries")
    if not target_libs or not isinstance(target_libs, list) or len(target_libs) == 0:
        target_libs = _get_default_show_libraries(media_server)
    merged["target_libraries"] = target_libs

    # Pull media server credentials dynamically from config.json
    pj_config = _get_posterizarr_config()
    plex_part = pj_config.get("PlexPart", {})
    api_part = pj_config.get("ApiPart", {})
    jf_part = pj_config.get("JellyfinPart", {})
    emby_part = pj_config.get("EmbyPart", {})

    plex_url = merged.get("plex_url") or (merged.get("server_url") if media_server == "plex" else "") or plex_part.get("PlexUrl") or pj_config.get("PlexUrl") or ""
    plex_token = merged.get("plex_token") or (merged.get("server_token") if media_server == "plex" else "") or api_part.get("PlexToken") or plex_part.get("PlexToken") or pj_config.get("PlexToken") or ""

    jf_url = merged.get("jellyfin_url") or (merged.get("server_url") if media_server == "jellyfin" else "") or jf_part.get("JellyfinUrl") or pj_config.get("JellyfinUrl") or ""
    jf_key = merged.get("jellyfin_api_key") or (merged.get("server_token") if media_server == "jellyfin" else "") or api_part.get("JellyfinAPIKey") or api_part.get("JellyfinApiKey") or pj_config.get("JellyfinApiKey") or ""

    emby_url = merged.get("emby_url") or (merged.get("server_url") if media_server == "emby" else "") or emby_part.get("EmbyUrl") or pj_config.get("EmbyUrl") or ""
    emby_key = merged.get("emby_api_key") or (merged.get("server_token") if media_server == "emby" else "") or api_part.get("EmbyAPIKey") or api_part.get("EmbyApiKey") or pj_config.get("EmbyApiKey") or ""

    # Sonarr, Simkl, and MAL are strictly stored in config.db
    sonarr_url = merged.get("sonarr_url", "")
    sonarr_api_key = merged.get("sonarr_api_key", "")
    simkl_client_id = merged.get("simkl_client_id", "")
    mal_enabled = bool(merged.get("mal_enabled", True))

    # Attach active server URL & Token
    if media_server == "jellyfin":
        current_server_url = jf_url
        current_server_token = jf_key
    elif media_server == "emby":
        current_server_url = emby_url
        current_server_token = emby_key
    else:
        current_server_url = plex_url
        current_server_token = plex_token

    merged["server_url"] = current_server_url
    merged["server_token"] = current_server_token
    merged["sonarr_url"] = sonarr_url
    merged["sonarr_api_key"] = sonarr_api_key
    merged["simkl_client_id"] = simkl_client_id
    merged["mal_enabled"] = mal_enabled

    # Backward compatibility fields
    merged["plex_url"] = plex_url
    merged["plex_token"] = plex_token
    merged["plex_libraries"] = merged.get("target_libraries", [])

    merged["available_servers"] = [
        {"id": "plex", "name": "Plex Media Server", "configured": bool(plex_url), "url": plex_url},
        {"id": "jellyfin", "name": "Jellyfin", "configured": bool(jf_url), "url": jf_url},
        {"id": "emby", "name": "Emby", "configured": bool(emby_url), "url": emby_url},
    ]

    return merged


def save_animetafill_config(new_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Persists AniMetaFill configuration.
    Sonarr credentials, SIMKL client ID, MAL settings, and preferences are saved directly to config.db.
    config.json is NOT modified with UI credentials, keeping Posterizarr config clean.
    animetafill_config.json stores the local runtime state.
    """
    current = get_animetafill_config()

    target_libs = new_config.get("target_libraries")
    if target_libs is None and "plex_libraries" in new_config:
        target_libs = new_config["plex_libraries"]
    if target_libs is None:
        target_libs = current.get("target_libraries", [])

    media_srv = new_config.get("media_server") or current.get("media_server", "plex")

    db_payload: Dict[str, Any] = {
        "enabled": bool(new_config.get("enabled", current.get("enabled", False))),
        "media_server": media_srv.lower().strip(),
        "target_libraries": target_libs if isinstance(target_libs, list) else [],
        "labels": new_config.get("labels", current.get("labels", _get_defaults()["labels"])),
        "colors": new_config.get("colors", current.get("colors", _get_defaults()["colors"])),
        "aesthetic": new_config.get("aesthetic", current.get("aesthetic", _get_defaults()["aesthetic"])),
        "mal_enabled": bool(new_config.get("mal_enabled", current.get("mal_enabled", True)))
    }

    if "sonarr_url" in new_config:
        db_payload["sonarr_url"] = str(new_config["sonarr_url"]).strip()
    if "sonarr_api_key" in new_config:
        db_payload["sonarr_api_key"] = str(new_config["sonarr_api_key"]).strip()
    if "simkl_client_id" in new_config:
        db_payload["simkl_client_id"] = str(new_config["simkl_client_id"]).strip()

    if "last_sync" in new_config:
        db_payload["last_sync"] = new_config["last_sync"]
    if "last_status" in new_config:
        db_payload["last_status"] = new_config["last_status"]
    if "last_error" in new_config:
        db_payload["last_error"] = new_config["last_error"]

    # 1. Save directly into config.db under section 'AniMetaFill'
    _write_to_config_db(db_payload, section="AniMetaFill")

    # 2. Ensure config.json is completely free of SonarrPart and SimklClientId
    _clean_config_json_ui_sections()

    # 3. Persist local runtime config to animetafill_config.json
    safe_config = {
        **db_payload,
        "last_sync": new_config.get("last_sync", current.get("last_sync")),
        "last_status": new_config.get("last_status", current.get("last_status", "idle")),
        "last_error": new_config.get("last_error", current.get("last_error"))
    }

    try:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(safe_config, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving {CONFIG_FILE}: {e}")


    return get_animetafill_config()


def test_sonarr_connection(url: Optional[str] = None, api_key: Optional[str] = None) -> Dict[str, Any]:
    """
    Test connection to Sonarr.
    If url or api_key are omitted, pulls credentials from config.json.
    """
    import requests

    if not url or not api_key:
        cfg = get_animetafill_config()
        url = url or cfg.get("sonarr_url", "")
        api_key = api_key or cfg.get("sonarr_api_key", "")

    clean_url = str(url or "").strip().rstrip("/")
    clean_key = str(api_key or "").strip()

    if not clean_url:
        return {"success": False, "error": "Sonarr URL is not configured.", "message": "Sonarr URL is required."}
    if not clean_key:
        return {"success": False, "error": "Sonarr API Key is not configured.", "message": "Sonarr API Key is required."}

    # Validate URL against SSRF (enforce http/https, block link-local metadata and multicast)
    try:
        import urllib.parse
        import socket
        import ipaddress
        parsed = urllib.parse.urlparse(clean_url)
        if parsed.scheme not in ("http", "https"):
            return {"success": False, "error": "Sonarr URL must use http or https.", "message": "Invalid URL scheme."}
        h = parsed.hostname
        if h and h.lower() not in ("localhost", "127.0.0.1", "::1"):
            ip_addr = socket.gethostbyname(h)
            ip = ipaddress.ip_address(ip_addr)
            if ip.is_link_local or ip.is_multicast:
                return {"success": False, "error": "Blocked link-local/multicast address.", "message": "Target IP blocked by security policy."}
    except Exception as ve:
        return {"success": False, "error": f"Invalid Sonarr URL target: {ve}", "message": "Invalid Sonarr URL."}

    headers = {
        "X-Api-Key": clean_key,
        "Accept": "application/json"
    }

    endpoints = [
        f"{clean_url}/api/v3/system/status",
        f"{clean_url}/api/system/status"
    ]

    last_error = "Connection failed"
    for ep in endpoints:
        try:
            resp = requests.get(ep, headers=headers, timeout=8)
            if resp.status_code == 200:
                data = resp.json()
                version = data.get("version", "Unknown")
                app_name = data.get("appName", "Sonarr")
                branch = data.get("branch", "main")
                return {
                    "success": True,
                    "version": version,
                    "appName": app_name,
                    "branch": branch,
                    "message": f"Successfully connected to {app_name} v{version} (branch: {branch})"
                }
            elif resp.status_code in (401, 403):
                return {
                    "success": False,
                    "error": "Authentication Failed: Invalid Sonarr API Key.",
                    "message": "Authentication Failed: Invalid Sonarr API Key (HTTP 401/403)."
                }
            else:
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
        except requests.exceptions.RequestException as e:
            last_error = str(e)

    return {
        "success": False,
        "error": last_error,
        "message": f"Failed to connect to Sonarr at {clean_url}: {last_error}"
    }


def is_animetafill_enabled() -> bool:
    """Check if AniMetaFill integration switch is active."""
    cfg = get_animetafill_config()
    return bool(cfg.get("enabled", False))


def is_animetafill_running() -> bool:
    """Check if AniMetaFill background sync is currently running."""
    return _is_sync_running


def get_animetafill_status() -> Dict[str, Any]:
    """Returns comprehensive status, sync history, show counts, and recent logs."""
    cfg = get_animetafill_config()
    db_path = DEFAULT_DB_PATH
    show_count = 0
    ep_count = 0

    if db_path.exists():
        try:
            import sqlite3
            with sqlite3.connect(db_path) as conn:
                cur = conn.cursor()
                cur.execute("SELECT COUNT(DISTINCT anime_title) FROM episodes")
                show_count = cur.fetchone()[0] or 0
                cur.execute("SELECT COUNT(*) FROM episodes")
                ep_count = cur.fetchone()[0] or 0
        except Exception:
            pass

    # Read last 35 log lines
    recent_logs = []
    log_candidates = [
        LOG_FILE_PATH,
        get_ui_logs_dir() / "AniMetaFill.log",
        get_ui_logs_dir() / "animetafill.log",
        PROJECT_ROOT / "UILogs" / "AniMetaFill.log",
    ]
    for l_cand in log_candidates:
        if l_cand.exists():
            try:
                with open(l_cand, "r", encoding="utf-8", errors="ignore") as lf:
                    lines = lf.readlines()
                    recent_logs = [line.strip() for line in lines[-35:]]
                break
            except Exception:
                pass

    yaml_ready = DEFAULT_YAML_OUTPUT.exists()
    yaml_mtime = None
    if yaml_ready:
        try:
            yaml_mtime = datetime.fromtimestamp(DEFAULT_YAML_OUTPUT.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass

    return {
        "enabled": bool(cfg.get("enabled", False)),
        "is_running": _is_sync_running,
        "last_sync": cfg.get("last_sync"),
        "last_status": cfg.get("last_status", "idle"),
        "last_error": cfg.get("last_error"),
        "shows_mapped": show_count,
        "episodes_mapped": ep_count,
        "yaml_exists": yaml_ready,
        "yaml_last_updated": yaml_mtime,
        "recent_logs": recent_logs
    }


def run_animetafill_sync_task(force: bool = False, runtime_overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Executes the AniMetaFill synchronizer in background thread.
    Connects to Sonarr/Plex/Jellyfin/Emby/SIMKL/MAL/AFL, extracts canon/filler data, and generates anime_overlays.yml.
    """
    global _is_sync_running, _last_sync_result

    if _is_sync_running:
        return {"success": False, "error": "AniMetaFill sync is already in progress.", "is_running": True}

    if runtime_overrides and isinstance(runtime_overrides, dict):
        try:
            save_animetafill_config(runtime_overrides)
        except Exception as e:
            logger.warning(f"Failed applying runtime overrides before sync: {e}")

    cfg = get_animetafill_config()
    simkl_id = str(cfg.get("simkl_client_id") or "").strip()
    if not simkl_id:
        return {
            "success": False,
            "error": "SIMKL Client ID is required for AniMetaFill episode classification. Please configure your SIMKL Client ID in settings.",
            "is_running": False
        }

    _is_sync_running = True

    def _worker():
        global _is_sync_running, _last_sync_result
        cfg = get_animetafill_config()
        out_dir = str(DEFAULT_YAML_OUTPUT.parent)
        db_path = str(DEFAULT_DB_PATH)

        # Set up log environment
        LOG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        os.environ["LOG_FILE"] = str(LOG_FILE_PATH)
        try:
            from animetafill_core.logger import logger as core_logger
            if hasattr(core_logger, "reconfigure_log_file"):
                core_logger.reconfigure_log_file(str(LOG_FILE_PATH))
        except Exception:
            pass

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            with open(LOG_FILE_PATH, "a", encoding="utf-8") as lf:
                lf.write(f"\n[{now_str}] [Posterizarr-AniMetaFill] Starting background anime synchronization...\n")
        except Exception:
            pass

        try:
            srv_type = cfg.get("media_server", "plex")
            srv_url = cfg.get("server_url", "")
            srv_token = cfg.get("server_token", "")
            target_libs = cfg.get("target_libraries", cfg.get("plex_libraries", []))

            # Build runtime config dictionary matching AniMetaFill requirements
            runtime_config = {
                "server": {
                    "type": srv_type,
                    "url": srv_url,
                    "token": srv_token,
                    "libraries": target_libs
                },
                "media_server": srv_type,
                "server_url": srv_url,
                "server_token": srv_token,
                "target_libraries": target_libs,
                "plex": {
                    "url": srv_url if srv_type == "plex" else "",
                    "token": srv_token if srv_type == "plex" else "",
                    "libraries": target_libs
                },
                "sonarr": {
                    "url": cfg.get("sonarr_url", ""),
                    "api_key": cfg.get("sonarr_api_key", "")
                },
                "simkl": {
                    "client_id": cfg.get("simkl_client_id", "")
                },
                "mal": {
                    "enabled": bool(cfg.get("mal_enabled", True))
                },
                "overlays": {
                    "output_dir": out_dir,
                    "font_path": "config/fonts/Colus-Regular.ttf",
                    "labels": cfg.get("labels", {}),
                    "colors": cfg.get("colors", {}),
                    "aesthetic": cfg.get("aesthetic", {})
                },
                "kometa": {
                    "output_dir": out_dir,
                    "font_path": "config/fonts/Colus-Regular.ttf",
                    "labels": cfg.get("labels", {}),
                    "colors": cfg.get("colors", {}),
                    "aesthetic": cfg.get("aesthetic", {})
                },
                "database": {
                    "path": db_path
                },
                "scheduling": {
                    "enabled": False
                }
            }

            from animetafill_core.main import run_sync
            run_sync(scheduler=None, custom_config=runtime_config, force=force)

            # Update success state
            timestamp_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            save_animetafill_config({
                "last_sync": timestamp_str,
                "last_status": "success",
                "last_error": None
            })
            _last_sync_result = {
                "status": "success",
                "timestamp": timestamp_str,
                "error": None
            }
            logger.info("[AniMetaFill] Synchronization completed successfully.")
        except Exception as e:
            err_msg = str(e)
            logger.error(f"[AniMetaFill] Execution error: {err_msg}", exc_info=True)
            save_animetafill_config({
                "last_status": "error",
                "last_error": err_msg
            })
            _last_sync_result = {
                "status": "error",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "error": err_msg
            }
            try:
                with open(LOG_FILE_PATH, "a", encoding="utf-8") as lf:
                    lf.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ERROR: {err_msg}\n")
            except Exception:
                pass
        finally:
            _is_sync_running = False

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()

    return {
        "success": True,
        "message": "AniMetaFill background synchronization initiated.",
        "is_running": True
    }


def get_anime_database_path() -> Path:
    if DEFAULT_DB_PATH.exists():
        return DEFAULT_DB_PATH

    candidates = []
    if os.environ.get("APP_DATA"):
        candidates.append(Path(os.environ["APP_DATA"]) / "database" / "animetafill.db")
    for c in candidates:
        if c.exists():
            try:
                DEFAULT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(c, DEFAULT_DB_PATH)
                logger.info(f"[AniMetaFill] Migrated database from {c} to {DEFAULT_DB_PATH}")
                return DEFAULT_DB_PATH
            except Exception:
                return c
    return DEFAULT_DB_PATH


def get_anime_shows(query: Optional[str] = None, category: Optional[str] = None, page: int = 1, page_size: int = 30) -> Dict[str, Any]:
    import sqlite3
    db_p = get_anime_database_path()
    if not db_p.exists():
        return {"total_shows": 0, "shows": [], "page": page, "page_size": page_size}

    try:
        conn = sqlite3.connect(str(db_p))
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        where_clauses = []
        params = []
        if query and query.strip():
            where_clauses.append("e.anime_title LIKE ?")
            params.append(f"%{query.strip()}%")

        if category and category.strip().lower() in ("canon", "filler", "mixed"):
            where_clauses.append("e.category = ?")
            params.append(category.strip().lower())

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        count_sql = f"SELECT COUNT(DISTINCT e.anime_title) as cnt FROM episodes e {where_sql}"
        cur.execute(count_sql, params)
        total_shows = cur.fetchone()["cnt"]

        offset = max(0, (page - 1) * page_size)
        shows_sql = f"""
            SELECT 
                e.anime_title,
                COUNT(e.absolute_number) as total_episodes,
                SUM(CASE WHEN e.category = 'canon' THEN 1 ELSE 0 END) as canon_count,
                SUM(CASE WHEN e.category = 'filler' THEN 1 ELSE 0 END) as filler_count,
                SUM(CASE WHEN e.category = 'mixed' THEN 1 ELSE 0 END) as mixed_count,
                u.last_checked,
                u.source_url
            FROM episodes e
            LEFT JOIN updates u ON u.anime_title = e.anime_title
            {where_sql}
            GROUP BY e.anime_title
            ORDER BY e.anime_title COLLATE NOCASE ASC
            LIMIT ? OFFSET ?
        """
        cur.execute(shows_sql, params + [page_size, offset])
        rows = cur.fetchall()

        shows = []
        for r in rows:
            shows.append({
                "title": r["anime_title"],
                "total_episodes": r["total_episodes"],
                "canon_count": r["canon_count"],
                "filler_count": r["filler_count"],
                "mixed_count": r["mixed_count"],
                "last_checked": r["last_checked"],
                "source_url": r["source_url"]
            })
        conn.close()
        return {
            "total_shows": total_shows,
            "shows": shows,
            "page": page,
            "page_size": page_size
        }
    except Exception as e:
        logger.error(f"Error querying anime shows: {e}")
        return {"total_shows": 0, "shows": [], "error": str(e), "page": page, "page_size": page_size}


def get_anime_episodes(anime_title: str) -> List[Dict[str, Any]]:
    import sqlite3
    db_p = get_anime_database_path()
    if not db_p.exists():
        return []
    try:
        conn = sqlite3.connect(str(db_p))
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT absolute_number, episode_title, category FROM episodes WHERE anime_title = ? ORDER BY absolute_number ASC",
            (anime_title,)
        )
        rows = cur.fetchall()
        eps = [{"number": r["absolute_number"], "title": r["episode_title"] or f"Episode {r['absolute_number']}", "category": r["category"]} for r in rows]
        conn.close()
        return eps
    except Exception as e:
        logger.error(f"Error querying episodes for {anime_title}: {e}")
        return []


def upsert_anime_item(anime_title: str, episode_range: str, category: str, episode_title: Optional[str] = None) -> Dict[str, Any]:
    import sqlite3
    import time
    db_p = get_anime_database_path()
    db_p.parent.mkdir(parents=True, exist_ok=True)

    cat = category.strip().lower()
    if cat not in ("canon", "filler", "mixed"):
        cat = "canon"

    ep_numbers = []
    for part in episode_range.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            bounds = part.split("-")
            try:
                start_n = int(bounds[0].strip())
                end_n = int(bounds[1].strip())
                ep_numbers.extend(range(start_n, end_n + 1))
            except Exception:
                pass
        else:
            try:
                ep_numbers.append(int(part))
            except Exception:
                pass

    if not ep_numbers:
        return {"success": False, "error": f"Invalid episode range: '{episode_range}'"}

    try:
        conn = sqlite3.connect(str(db_p))
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS episodes (
                anime_title TEXT,
                absolute_number INTEGER,
                episode_title TEXT,
                category TEXT,
                PRIMARY KEY (anime_title, absolute_number)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS updates (
                anime_title TEXT PRIMARY KEY,
                last_checked REAL,
                source_url TEXT
            )
        """)

        for num in ep_numbers:
            ep_t = episode_title if len(ep_numbers) == 1 else f"Episode {num}"
            cur.execute(
                "INSERT OR REPLACE INTO episodes (anime_title, absolute_number, episode_title, category) VALUES (?, ?, ?, ?)",
                (anime_title.strip(), num, ep_t, cat)
            )

        cur.execute(
            "INSERT OR REPLACE INTO updates (anime_title, last_checked, source_url) VALUES (?, ?, ?)",
            (anime_title.strip(), time.time(), "Manual User Entry")
        )
        conn.commit()
        conn.close()

        _update_anime_overlays_yml_for_title(anime_title.strip())

        return {
            "success": True,
            "message": f"Successfully mapped {len(ep_numbers)} episode(s) for '{anime_title}' as {cat.upper()}.",
            "episodes_updated": len(ep_numbers)
        }
    except Exception as e:
        logger.error(f"Error upserting anime item: {e}")
        return {"success": False, "error": str(e)}


def update_single_episode(anime_title: str, episode_number: int, category: str) -> Dict[str, Any]:
    import sqlite3
    db_p = get_anime_database_path()
    cat = category.strip().lower()
    if cat not in ("canon", "filler", "mixed"):
        cat = "canon"

    try:
        conn = sqlite3.connect(str(db_p))
        cur = conn.cursor()
        cur.execute(
            "UPDATE episodes SET category = ? WHERE anime_title = ? AND absolute_number = ?",
            (cat, anime_title.strip(), episode_number)
        )
        conn.commit()
        conn.close()
        _update_anime_overlays_yml_for_title(anime_title.strip())
        return {"success": True, "message": f"Updated episode {episode_number} to {cat.upper()}."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def delete_anime_show(anime_title: str) -> Dict[str, Any]:
    import sqlite3
    db_p = get_anime_database_path()
    try:
        conn = sqlite3.connect(str(db_p))
        cur = conn.cursor()
        cur.execute("DELETE FROM episodes WHERE anime_title = ?", (anime_title.strip(),))
        cur.execute("DELETE FROM updates WHERE anime_title = ?", (anime_title.strip(),))
        conn.commit()
        conn.close()

        if DEFAULT_YAML_OUTPUT.exists():
            try:
                import yaml
                with open(DEFAULT_YAML_OUTPUT, "r", encoding="utf-8") as yf:
                    ydata = yaml.safe_load(yf) or {}
                ovs = ydata.get("overlays", {})
                keys_to_del = [k for k in ovs if k.startswith(f"{anime_title.strip()} -")]
                for k in keys_to_del:
                    del ovs[k]
                with open(DEFAULT_YAML_OUTPUT, "w", encoding="utf-8") as yf:
                    yaml.dump(ydata, yf, default_flow_style=False, sort_keys=False)
            except Exception:
                pass

        return {"success": True, "message": f"Deleted '{anime_title}' from classification database."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _update_anime_overlays_yml_for_title(anime_title: str):
    """Regenerates or updates overlays block for the specified anime title in anime_overlays.yml."""
    if not DEFAULT_YAML_OUTPUT.exists():
        return
    try:
        import yaml
        with open(DEFAULT_YAML_OUTPUT, "r", encoding="utf-8") as yf:
            ydata = yaml.safe_load(yf) or {}

        overlays = ydata.setdefault("overlays", {})
        eps = get_anime_episodes(anime_title)
        by_cat = {"canon": [], "filler": [], "mixed": []}
        for ep in eps:
            c = ep["category"].lower()
            if c in by_cat:
                by_cat[c].append(ep["number"])

        cfg = get_animetafill_config()
        labels = cfg.get("labels", {})
        colors = cfg.get("colors", {})

        for cat, numbers in by_cat.items():
            key_name = f"{anime_title} - {cat.capitalize()}"
            if not numbers:
                if key_name in overlays:
                    del overlays[key_name]
                continue

            ep_patterns = [f"S\\d+E{n:02d}|E{n:02d}|E{n:03d}|Episode\\s*{n}" for n in numbers]
            regex_str = f"(?i)({'|'.join(ep_patterns[:80])})"

            overlays[key_name] = {
                "template": {
                    "name": "AnimeBar",
                    "label": labels.get(cat, cat.capitalize()),
                    "color": colors.get(cat, "#27C24CB3" if cat == "canon" else "#FF0000B3")
                },
                "builder_level": "episode",
                "plex_search": {
                    "title.is": anime_title
                },
                "filters": {
                    "show_title": anime_title,
                    "filepath.regex": regex_str
                }
            }

        with open(DEFAULT_YAML_OUTPUT, "w", encoding="utf-8") as yf:
            yaml.dump(ydata, yf, default_flow_style=False, sort_keys=False)
        logger.info(f"Updated anime_overlays.yml for '{anime_title}'.")
    except Exception as e:
        logger.error(f"Error updating anime_overlays.yml: {e}")
