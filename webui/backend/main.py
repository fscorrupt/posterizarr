from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
    Query,
    Request,
    UploadFile,
    File,
    Form,
    BackgroundTasks,
)
from contextlib import asynccontextmanager
try:
    from .defaults import setup_default_images
except ImportError:
    from defaults import setup_default_images
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import json
import subprocess
import shlex
import asyncio
import os
import httpx
from pathlib import Path
from typing import Optional, List, Literal, Dict, Any
import logging
import re
import time
import requests
import threading
from datetime import datetime, timedelta
import threading
from defusedxml.ElementTree import fromstring
import sys
from urllib.parse import quote
import zipfile
import tempfile
import shutil
import sqlite3
import socket
import ipaddress
import urllib.parse
import bcrypt
import secrets
from starlette.responses import FileResponse
from PIL import Image, ImageDraw, ImageChops
from io import BytesIO
from base64 import b64encode
try:
    from .overlay_generator import generate_overlay_image
except ImportError:
    from overlay_generator import generate_overlay_image
try:
    from .queue_manager import QueueManager
except ImportError:
    from queue_manager import QueueManager

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).parent))

# Check if running in Docker
IS_DOCKER = (
    os.path.exists("/.dockerenv")
    or os.environ.get("DOCKER_ENV", "").lower() == "true"
    or os.environ.get("POSTERIZARR_NON_ROOT", "").lower() == "true"
)

port = int(os.environ.get("PORT", os.environ.get("APP_PORT", 8000)))

if IS_DOCKER:
    BASE_DIR = Path("/config")
    APP_DIR = Path("/app")
    ASSETS_DIR = Path("/assets")
    MANUAL_ASSETS_DIR = Path("/manualassets")
    IMAGES_DIR = Path("/config/Cache/images")
    FRONTEND_DIR = Path("/app/frontend/dist")
    BACKUP_DIR = Path("/assetsbackup")
else:
    # Local: webui/backend/main.py -> project root (3 levels up)
    PROJECT_ROOT = Path(__file__).parent.parent.parent
    BASE_DIR = PROJECT_ROOT
    APP_DIR = PROJECT_ROOT
    IMAGES_DIR = PROJECT_ROOT / "images"
    FRONTEND_DIR = PROJECT_ROOT / "webui" / "frontend" / "dist"

    # Load AssetPath, ManualAssetPath and BackupPath from config
    CONFIG_PATH_TEMP = PROJECT_ROOT / "config.json"
    ASSETS_DIR = PROJECT_ROOT / "assets"  # Default
    MANUAL_ASSETS_DIR = PROJECT_ROOT / "manualassets"  # Default
    BACKUP_DIR = PROJECT_ROOT / "assetsbackup"  # Default

    if CONFIG_PATH_TEMP.exists():
        try:
            with open(CONFIG_PATH_TEMP, "r", encoding="utf-8") as f:
                config_data = json.load(f)
                if "PrerequisitePart" in config_data:
                    asset_path = config_data["PrerequisitePart"].get("AssetPath")
                    manual_asset_path = config_data["PrerequisitePart"].get(
                        "ManualAssetPath"
                    )
                    backup_path = config_data["PrerequisitePart"].get("BackupPath")

                    if asset_path:
                        ASSETS_DIR = Path(asset_path)
                    if manual_asset_path:
                        MANUAL_ASSETS_DIR = Path(manual_asset_path)
                    if backup_path:
                        BACKUP_DIR = Path(backup_path)
        except Exception as e:
            pass  # Use defaults if config can't be read

# ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
# ++ SECURITY UTILITY FUNCTIONS
# ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

def is_safe_url(url: str, allow_private: bool = False, allow_apprise_schemes: bool = False) -> bool:
    """
    Validate that the URL is using a safe scheme (http/https) and that the
    target host is not a loopback or reserved IP address.

    If allow_private is False (default), private network ranges (LAN/Docker) are also blocked.
    """
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ["http", "https"]:
            if allow_apprise_schemes:
                # Apprise uses many custom schemes (discord, telegram, etc.)
                return True
            logger.warning(f"Blocked URL with unsafe scheme: {parsed.scheme}")
            return False

        # Resolve hostname to IP
        hostname = parsed.hostname
        if not hostname:
            return False

        # ALWAYS block loopback/localhost
        if hostname.lower() in ["localhost", "127.0.0.1", "::1"]:
            logger.warning(f"Blocked SSRF attempt to localhost: {hostname}")
            return False

        try:
            ip_addr = socket.gethostbyname(hostname)
            ip = ipaddress.ip_address(ip_addr)
            logger.debug(f"URL Validation: {hostname} resolved to {ip_addr}")
        except Exception as res_err:
            logger.error(f"URL Validation: Failed to resolve hostname '{hostname}': {res_err}")
            return False

        # Always block loopback IPs resolved via DNS
        if ip.is_loopback:
            logger.warning(f"Blocked SSRF attempt to loopback IP: {ip_addr}")
            return False

        # Block private, link-local, and multicast ranges unless explicitly allowed
        if not allow_private:
            if ip.is_private or ip.is_link_local or ip.is_multicast:
                logger.warning(f"Blocked SSRF attempt to internal/private IP: {ip_addr} (hostname: {hostname})")
                return False
        else:
            if ip.is_private:
                logger.debug(f"URL Validation: Allowing private IP {ip_addr} for hostname {hostname}")

        return True
    except Exception as e:
        logger.error(f"Error validating URL '{url}': {e}", exc_info=True)
        return False



def sanitize_command_arg(arg: str) -> str:
    """
    Sanitize an argument for a command line to prevent argument injection
    and null-byte issues, while preserving legitimate special characters.
    Also ensures the argument doesn't start with a hyphen to prevent flag injection.
    """
    if not arg:
        return ""
    # Remove null bytes and non-printable control characters
    sanitized = "".join(c for c in arg if c.isprintable()).strip()

    # Prevent flag injection by prefixing with a space if it starts with -
    # (PowerShell handles this well, but it's an extra layer of safety)
    if sanitized.startswith("-"):
        sanitized = " " + sanitized

    return sanitized


def mask_secret(secret: Any) -> str:
    """
    Mask a sensitive string (API Key, Token, Password) for logging.
    Example: 'abcdef123456789' -> 'abcde...56789'
    """
    if not secret:
        return "None"
    s = str(secret)
    if len(s) <= 8:
        return "***"
    return f"{s[:5]}...{s[-4:]}"


def get_safe_path(base_dir: Path, user_path: str) -> Path:
    """
    Safely joins a base directory with a user-provided path, ensuring that
    the resulting path remains within the base directory (preventing Path Traversal).
    """
    # Normalize paths
    safe_base = Path(os.path.abspath(base_dir))

    # Handle both absolute and relative user paths safely
    # If user_path starts with a slash, it's "drive-relative" on Windows
    # and would anchor to the drive root (e.g. C:\etc\passwd instead of C:\assets\etc\passwd)
    user_path = user_path.lstrip("/\\")

    if os.path.isabs(user_path):
        # Strip drive letter to force it to be relative to base_dir
        parts = Path(user_path).parts
        if parts[0].endswith(":") or parts[0].startswith("\\\\"):
            user_path = str(Path(*parts[1:]))

    requested_path = Path(os.path.abspath(os.path.join(safe_base, user_path)))

    # Check if requested_path is still inside safe_base
    if not str(requested_path).startswith(str(safe_base)):
        logger.warning(f"Path traversal attempt detected: {user_path} tried to exit {base_dir}")
        raise HTTPException(status_code=403, detail="Path traversal attempt detected")

    return requested_path



# ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
# ++ END OF SECURITY UTILITY FUNCTIONS
# ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    ASSETS_DIR.mkdir(exist_ok=True)
    MANUAL_ASSETS_DIR.mkdir(exist_ok=True)
    BACKUP_DIR.mkdir(exist_ok=True)

# Ensure directories exist locally
SUBDIRS_TO_CREATE = [
    "Logs",
    "temp",
    "test",
    "UILogs",
    "uploads",
    "fontpreviews",
    "database",
    "queue_staging",
]

# Creating all directories in a single loop with better error handling
for subdir in SUBDIRS_TO_CREATE:
    try:
        subdir_path = BASE_DIR / subdir
        subdir_path.mkdir(parents=True, exist_ok=True)
        # Test write permissions
        test_file = subdir_path / ".write_test"
        test_file.touch()
        test_file.unlink()
    except PermissionError as e:
        pass  # Silent - no console output
    except Exception as e:
        pass  # Silent - no console output

CONFIG_PATH = BASE_DIR / "config.json"
CONFIG_EXAMPLE_PATH = BASE_DIR / "config.example.json"
SCRIPT_PATH = APP_DIR / "Posterizarr.ps1"
LOGS_DIR = BASE_DIR / "Logs"
ROTATED_LOGS_DIR = BASE_DIR / "RotatedLogs"
TEST_DIR = BASE_DIR / "test"
TEMP_DIR = BASE_DIR / "temp"
UI_LOGS_DIR = BASE_DIR / "UILogs"
OVERLAYFILES_DIR = BASE_DIR / "Overlayfiles"
UPLOADS_DIR = BASE_DIR / "uploads"
FONTPREVIEWS_DIR = BASE_DIR / "fontpreviews"
DATABASE_DIR = BASE_DIR / "database"
RUNNING_FILE = TEMP_DIR / "Posterizarr.Running"
IMAGECHOICES_DB_PATH = DATABASE_DIR / "imagechoices.db"
QUEUE_STAGING_DIR = BASE_DIR / "queue_staging"
QUEUE_DB_PATH = DATABASE_DIR / "queue.db"

# Initialize Queue Manager
queue_manager = QueueManager(QUEUE_DB_PATH)

# Global lock for process management
process_lock = threading.RLock()

# Clear UILogs on startup - remove all log files
import glob

for log_file in glob.glob(str(UI_LOGS_DIR / "*.log")):
    try:
        os.remove(log_file)
        pass  # Silent - no console output
    except Exception as e:
        pass  # Silent - no console output

# Determine log level from config file or environment variable or default to INFO
LOG_LEVEL_MAP = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}

WEBUI_SETTINGS_PATH = UI_LOGS_DIR / "webui_settings.json"

# Global queue listener for thread-safe logging
queue_listener = None


def load_webui_settings():
    """Load WebUI settings from JSON file"""
    default_settings = {
        "log_level": "INFO",
        "theme": "dark",
        "auto_refresh_interval": 180,
    }

    try:
        if WEBUI_SETTINGS_PATH.exists():
            with open(WEBUI_SETTINGS_PATH, "r", encoding="utf-8") as f:
                settings = json.load(f)
                return {**default_settings, **settings}
    except Exception as e:
        pass  # Silent - no console output

    return default_settings


def save_webui_settings(settings: dict):
    """Save WebUI settings to JSON file"""
    try:
        with open(WEBUI_SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        pass  # Silent - no console output
        return False


def load_log_level_config():
    """Load log level from webui_settings.json or environment variable"""
    try:
        if WEBUI_SETTINGS_PATH.exists():
            with open(WEBUI_SETTINGS_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)
                level = config.get("log_level", "").upper()
                if level:
                    # Silent - no console output
                    return level
    except Exception as e:
        pass  # Silent - no console output

    # Fallback to environment variable or default
    env_level = os.getenv("WEBUI_LOG_LEVEL", "INFO").upper()
    # Silent - no console output
    return env_level


def save_log_level_config(level: str):
    """DEPRECATED: Use save_webui_settings instead. Kept for backward compatibility."""
    try:
        settings = load_webui_settings()
        settings["log_level"] = level.upper()
        return save_webui_settings(settings)
    except Exception as e:
        pass  # Silent - no console output
        return False


def initialize_webui_settings():
    """Initialize webui_settings.json with default values if it doesn't exist"""
    if not WEBUI_SETTINGS_PATH.exists():
        default_settings = {
            "log_level": "INFO",
            "theme": "dark",
            "auto_refresh_interval": 180,
        }
        try:
            WEBUI_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(WEBUI_SETTINGS_PATH, "w", encoding="utf-8") as f:
                json.dump(default_settings, f, indent=2, ensure_ascii=False)
        except Exception as e:
            pass  # Silent - no console output


# Initialize webui_settings.json if it doesn't exist
initialize_webui_settings()

# Get log level from config file, environment variable, or default to INFO
LOG_LEVEL_ENV = load_log_level_config()
LOG_LEVEL = LOG_LEVEL_MAP.get(LOG_LEVEL_ENV, logging.INFO)

# Silent - no console output

# Setup logging with configurable log level - FILE ONLY, NO CONSOLE OUTPUT
# Remove any existing handlers first
logging.root.handlers.clear()

# Create file handler for BackendServer.log
file_handler = logging.FileHandler(
    UI_LOGS_DIR / "BackendServer.log", mode="w", encoding="utf-8"
)
file_handler.setLevel(LOG_LEVEL)
file_handler.setFormatter(
    logging.Formatter(
        "[%(asctime)s] [%(levelname)-8s] [%(name)s:%(funcName)s:%(lineno)d] - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
)

# Configure root logger - ONLY file handler, no console
logging.root.setLevel(LOG_LEVEL)
logging.root.addHandler(file_handler)

# Set httpx to WARNING to reduce noise, but keep our app at DEBUG
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# DISABLE uvicorn console output completely
uvicorn_access_logger = logging.getLogger("uvicorn.access")
uvicorn_access_logger.handlers.clear()
uvicorn_access_logger.propagate = False  # Don't propagate to root logger

uvicorn_error_logger = logging.getLogger("uvicorn.error")
uvicorn_error_logger.handlers.clear()
uvicorn_error_logger.propagate = False  # Don't propagate to root logger

uvicorn_logger = logging.getLogger("uvicorn")
uvicorn_logger.handlers.clear()
uvicorn_logger.propagate = False  # Don't propagate to root logger

logger = logging.getLogger(__name__)
logger.info("=" * 80)
logger.info("POSTERIZARR WEB UI BACKEND INITIALIZING")
logger.info("=" * 80)
logger.info(f"Log Level: {LOG_LEVEL_ENV} ({LOG_LEVEL})")
logger.debug(f"Python version: {sys.version}")
logger.debug(f"Working directory: {os.getcwd()}")
logger.debug(f"Base directory: {BASE_DIR}")
logger.debug(f"Docker mode: {IS_DOCKER}")

# Create Overlayfiles directory if it doesn't exist
OVERLAYFILES_DIR.mkdir(exist_ok=True)

# Create uploads directory if it doesn't exist
UPLOADS_DIR.mkdir(exist_ok=True)

# Try to find the example config file (in /app for Docker, or BASE_DIR for local)
example_source_path = Path("/app/config.example.json") if IS_DOCKER else CONFIG_EXAMPLE_PATH

if not CONFIG_PATH.exists():
    logger.warning(f"Config file not found at {CONFIG_PATH}")
    if example_source_path.exists():
        try:
            import shutil
            shutil.copy2(example_source_path, CONFIG_PATH)
            logger.info(f"Copied default config from {example_source_path} to {CONFIG_PATH}")
        except Exception as e:
            logger.error(f"Failed to copy default config: {e}")
            CONFIG_PATH = example_source_path
    else:
        logger.error(f"Fallback config.example.json not found at {example_source_path}!")
else:
    logger.debug(f"Config path set to: {CONFIG_PATH}")
    logger.debug(f"Config exists: {CONFIG_PATH.exists()}")


def setup_backend_ui_logger():
    """Setup backend logger to also write to FrontendUI.log"""
    global queue_listener
    logger.info("Initializing backend UI logger")
    try:
        # Create UILogs directory if not exists
        UI_LOGS_DIR.mkdir(exist_ok=True)
        logger.debug(f"UILogs directory: {UI_LOGS_DIR}")
        logger.debug(f"UILogs directory exists: {UI_LOGS_DIR.exists()}")

        # CLEANUP: Delete old log files on startup
        backend_log_path = UI_LOGS_DIR / "FrontendUI.log"
        if backend_log_path.exists():
            logger.debug(f"Removing existing FrontendUI.log: {backend_log_path}")
            backend_log_path.unlink()
            logger.info(f"Cleared old FrontendUI.log")
        else:
            logger.debug("No existing FrontendUI.log to clear")

        # Create File Handler for FrontendUI.log with thread-safe queue
        logger.debug(f"Creating file handler for: {backend_log_path}")
        backend_ui_file_handler = logging.FileHandler(
            backend_log_path, encoding="utf-8", mode="w"
        )
        backend_ui_file_handler.setLevel(LOG_LEVEL)  # Use configurable log level
        backend_ui_file_handler.setFormatter(
            logging.Formatter(
                "[%(asctime)s] [%(levelname)-8s] [BACKEND:%(name)s:%(funcName)s:%(lineno)d] - %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
        logger.debug("File handler formatter configured")

        # Use QueueHandler for thread-safe logging
        from queue import Queue
        from logging.handlers import QueueHandler, QueueListener

        log_queue = Queue(-1)  # Unlimited queue size
        queue_handler = QueueHandler(log_queue)

        # Start queue listener in background thread
        queue_listener = QueueListener(
            log_queue, backend_ui_file_handler, respect_handler_level=True
        )
        queue_listener.start()
        logger.debug("Queue listener started for thread-safe logging")

        # Add queue handler to root logger (so all backend logs are captured)
        logging.getLogger().addHandler(queue_handler)
        logger.info(f"Backend logger initialized successfully: {backend_log_path}")
        logger.info(
            f"Backend logging to FrontendUI.log enabled with {LOG_LEVEL_ENV} level"
        )
        logger.debug(
            "All backend logs will be captured in both BackendServer.log and FrontendUI.log"
        )

    except PermissionError as e:
        logger.error(f"Permission denied initializing backend UI logger: {e}")
    except OSError as e:
        logger.error(f"OS error initializing backend UI logger: {e}")
    except Exception as e:
        logger.error(f"Unexpected error initializing backend UI logger: {e}")
        logger.debug(f"Exception type: {type(e).__name__}", exc_info=True)


# Initialize Backend UI Logger on startup
logger.info("Setting up backend UI logger...")
setup_backend_ui_logger()

# Import config tooltips
try:
    logger.debug("Attempting to import config_tooltips module")
    from config_tooltips import CONFIG_TOOLTIPS
    try:
        from .config_tooltips import CONFIG_TOOLTIPS
    except ImportError:
        from config_tooltips import CONFIG_TOOLTIPS
    logger.info("Config tooltips loaded successfully")
except ImportError as e:
    CONFIG_TOOLTIPS = {}
    logger.warning(f"Config tooltips not available: {e}")

logger.info("Loading modules...")
try:
    logger.debug("Attempting to import config_mapper module")
    from config_mapper import (
        flatten_config,
        unflatten_config,
        UI_GROUPS,
        DISPLAY_NAMES,
        get_display_name,
        get_tooltip,
    )

    CONFIG_MAPPER_AVAILABLE = True
    logger.info("Config mapper loaded successfully")
    logger.debug(f"UI_GROUPS available: {len(UI_GROUPS) if UI_GROUPS else 0}")
except ImportError as e:
    CONFIG_MAPPER_AVAILABLE = False
    logger.warning(f"Config mapper not available: {e}. Using grouped config structure.")
    logger.debug(f"ImportError details: {type(e).__name__}: {str(e)}", exc_info=True)

# Import scheduler module
try:
    logger.debug("Attempting to import scheduler module")
    from scheduler import PosterizarrScheduler

    SCHEDULER_AVAILABLE = True
    logger.info("Scheduler module loaded successfully")
except ImportError as e:
    SCHEDULER_AVAILABLE = False
    logger.warning(
        f"Scheduler not available: {e}. Scheduler features will be disabled."
    )
    logger.debug(f"ImportError details: {type(e).__name__}: {str(e)}", exc_info=True)

# Import auth middleware for Basic Authentication
try:
    logger.debug("Attempting to import auth_middleware module")
    from auth_middleware import BasicAuthMiddleware, load_auth_config

    AUTH_MIDDLEWARE_AVAILABLE = True
    logger.info("Auth middleware loaded successfully")
except ImportError as e:
    AUTH_MIDDLEWARE_AVAILABLE = False
    logger.warning(f"Auth middleware not available: {e}. Basic Auth will be disabled.")
    logger.debug(f"ImportError details: {type(e).__name__}: {str(e)}", exc_info=True)

# Import database module
try:
    logger.debug("Attempting to import database module")
    from database import init_database, ImageChoicesDB

    DATABASE_AVAILABLE = True
    logger.info("Database module loaded successfully")
except ImportError as e:
    DATABASE_AVAILABLE = False
    logger.warning(
        f"Database module not available: {e}. Database features will be disabled."
    )
    logger.debug(f"ImportError details: {type(e).__name__}: {str(e)}", exc_info=True)

# Import server libraries database module
try:
    logger.debug("Attempting to import server_libraries_database module")
    from server_libraries_database import init_server_libraries_db, ServerLibrariesDB

    SERVER_LIBRARIES_DB_AVAILABLE = True
    logger.info("Server libraries database module loaded successfully")
except ImportError as e:
    SERVER_LIBRARIES_DB_AVAILABLE = False
    logger.warning(
        f"Server libraries database module not available: {e}. Library management will be disabled."
    )
    logger.debug(f"ImportError details: {type(e).__name__}: {str(e)}", exc_info=True)

# Import config database module
try:
    logger.debug("Attempting to import config_database module")
    from config_database import ConfigDB

    CONFIG_DATABASE_AVAILABLE = True
    logger.info("Config database module loaded successfully")
except ImportError as e:
    CONFIG_DATABASE_AVAILABLE = False
    logger.warning(
        f"Config database not available: {e}. Config database will be disabled."
    )
    logger.debug(f"ImportError details: {type(e).__name__}: {str(e)}", exc_info=True)

# Import runtime database module
try:
    logger.debug("Attempting to import runtime_database and runtime_parser modules")
    from runtime_database import runtime_db
    from runtime_parser import parse_runtime_from_log, save_runtime_to_db

    RUNTIME_DB_AVAILABLE = True
    logger.info("Runtime database module loaded successfully")
except ImportError as e:
    RUNTIME_DB_AVAILABLE = False
    runtime_db = None
    logger.warning(
        f"Runtime database not available: {e}. Runtime tracking will be disabled."
    )
    logger.debug(f"ImportError details: {type(e).__name__}: {str(e)}", exc_info=True)

# Import logs watcher module
try:
    logger.debug("Attempting to import logs_watcher module")
    from logs_watcher import create_logs_watcher

    LOGS_WATCHER_AVAILABLE = True
    logger.info("Logs watcher module loaded successfully")
except ImportError as e:
    LOGS_WATCHER_AVAILABLE = False
    logger.warning(
        f"Logs watcher not available: {e}. Automatic file monitoring will be disabled."
    )
    logger.debug(f"ImportError details: {type(e).__name__}: {str(e)}", exc_info=True)

# Import media export database module
try:
    logger.debug("Attempting to import media_export_database module")
    from media_export_database import MediaExportDatabase

    MEDIA_EXPORT_DB_AVAILABLE = True
    logger.info("Media export database module loaded successfully")
except ImportError as e:
    MEDIA_EXPORT_DB_AVAILABLE = False
    logger.warning(
        f"Media export database not available: {e}. Media CSV tracking will be disabled."
    )
    logger.debug(f"ImportError details: {type(e).__name__}: {str(e)}", exc_info=True)

logger.info("Module loading completed")
logger.debug(f"Config Mapper: {CONFIG_MAPPER_AVAILABLE}")
logger.debug(f"Scheduler: {SCHEDULER_AVAILABLE}")
logger.debug(f"Auth Middleware: {AUTH_MIDDLEWARE_AVAILABLE}")
logger.debug(f"Database: {DATABASE_AVAILABLE}")
logger.debug(f"Config Database: {CONFIG_DATABASE_AVAILABLE}")
logger.debug(f"Runtime Database: {RUNTIME_DB_AVAILABLE}")
logger.debug(f"Logs Watcher: {LOGS_WATCHER_AVAILABLE}")
logger.debug(f"Media Export Database: {MEDIA_EXPORT_DB_AVAILABLE}")

current_process: Optional[subprocess.Popen] = None
current_mode: Optional[str] = None
current_start_time: Optional[str] = None
scheduler: Optional["PosterizarrScheduler"] = None
db: Optional["ImageChoicesDB"] = None
config_db: Optional["ConfigDB"] = None
media_export_db: Optional["MediaExportDatabase"] = None
server_libraries_db: Optional["ServerLibrariesDB"] = None

# Initialize cache variables early to prevent race conditions
cache_refresh_task = None
cache_refresh_running = False
cache_scan_in_progress = False


def check_directory_permissions(
    directory: Path, directory_name: str = "directory"
) -> dict:
    """
    Check if a directory is accessible and writable.
    Returns diagnostic information for troubleshooting upload issues.

    Args:
        directory: Path to check
        directory_name: Human-readable name for logging

    Returns:
        dict with keys: exists, readable, writable, error
    """
    result = {
        "path": str(directory),
        "name": directory_name,
        "exists": False,
        "readable": False,
        "writable": False,
        "error": None,
        "platform": sys.platform,
        "is_docker": IS_DOCKER,
    }

    try:
        result["exists"] = directory.exists()

        if result["exists"]:
            # Test read permissions
            try:
                list(directory.iterdir())
                result["readable"] = True
            except PermissionError:
                result["error"] = f"No read permission for {directory_name}"
            except Exception as e:
                result["error"] = f"Cannot read {directory_name}: {str(e)}"

            # Test write permissions
            try:
                test_file = directory / ".write_test_diagnostic"
                test_file.touch()
                test_file.unlink()
                result["writable"] = True
            except PermissionError:
                result["error"] = f"No write permission for {directory_name}"
            except Exception as e:
                result["error"] = f"Cannot write to {directory_name}: {str(e)}"
        else:
            result["error"] = f"{directory_name} does not exist"

    except Exception as e:
        result["error"] = f"Error checking {directory_name}: {str(e)}"

    return result


def import_imagechoices_to_db():
    """
    Import ImageChoices.csv from Logs directory to database
    Inserts new records and updates existing ones
    """
    if not DATABASE_AVAILABLE or db is None:
        logger.debug("Database not available, skipping CSV import")
        return

    csv_path = LOGS_DIR / "ImageChoices.csv"
    if not csv_path.exists():
        logger.debug("ImageChoices.csv does not exist yet, skipping import")
        return

    try:
        logger.info(" Importing/Updating ImageChoices.csv to database...")
        stats = db.import_from_csv(csv_path)

        added = stats.get('added', 0)
        updated = stats.get('updated', 0)
        skipped = stats.get('skipped', 0)
        errors = stats.get('errors', 0)

        if added > 0 or updated > 0:
            logger.info(
                f"CSV import successful: {added} new record(s) added, "
                f"{updated} record(s) updated, "
                f"{skipped} skipped (no change), "
                f"{errors} error(s)"
            )
        else:
            logger.debug(
                f"CSV import: No new or updated records ({skipped} skipped, {errors} errors)"
            )

        if errors > 0:
            logger.warning(f"Import errors: {stats.get('error_details', [])}")

    except Exception as e:
        logger.error(f"Error importing CSV to database: {e}")


def parse_version(version_str: str) -> tuple:
    """
    Parse a semantic version string into a tuple of integers for comparison.
    Handles versions like "1.9.97", "2.0.0", "1.10.5", etc.

    Returns tuple of (major, minor, patch) or None if parsing fails
    """
    if not version_str:
        return None

    try:
        # Remove 'v' prefix if present
        version_str = version_str.strip().lstrip("v")

        # Split by '.' and convert to integers
        parts = version_str.split(".")

        # Pad with zeros if necessary (e.g., "2.0" becomes "2.0.0")
        while len(parts) < 3:
            parts.append("0")

        # Convert to integers
        major = int(parts[0])
        minor = int(parts[1])
        patch = int(parts[2])

        return (major, minor, patch)
    except (ValueError, IndexError) as e:
        logger.error(f"Failed to parse version '{version_str}': {e}")
        return None


def is_version_newer(current: str, remote: str) -> bool:
    """
    Compare two semantic versions.
    Returns True if remote version is newer than current version.

    Examples:
        is_version_newer("2.0.0", "1.9.97") -> False (2.0.0 is newer)
        is_version_newer("1.9.97", "2.0.0") -> True (2.0.0 is newer)
        is_version_newer("1.9.5", "1.9.97") -> True (1.9.97 is newer)
    """
    current_parsed = parse_version(current)
    remote_parsed = parse_version(remote)

    # If we can't parse either version, fall back to string comparison
    if current_parsed is None or remote_parsed is None:
        logger.warning(
            f"Version parsing failed, using string comparison: {current} vs {remote}"
        )
        return current != remote

    # Compare tuples (Python does lexicographic comparison)
    # (2, 0, 0) > (1, 9, 97) returns True
    is_newer = remote_parsed > current_parsed

    logger.info(
        f"Version comparison: {current} {current_parsed} vs {remote} {remote_parsed} -> newer: {is_newer}"
    )

    return is_newer


class CachedStaticFiles(StaticFiles):
    """StaticFiles with Cache-Control headers for browser caching"""

    def __init__(self, *args, max_age: int = 3600, **kwargs):
        self.max_age = max_age
        super().__init__(*args, **kwargs)

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = f"public, max-age={self.max_age}"
        return response


def is_poster_file(filename: str) -> bool:
    """
    Check if file is a poster.
    Supports: .jpg, .jpeg, .png, .webp, .tbn
    """
    lower_name = filename.lower()
    valid_extensions = (".jpg", ".jpeg", ".png", ".webp", ".tbn")

    # 1. Must end with a valid extension
    if not lower_name.endswith(valid_extensions):
        return False

    # 2. EXCLUDE specific folder-based reserved filenames (regardless of extension)
    # We check if the name starts with specific reserved words to handle background.png, Season01.webp, etc.
    if lower_name.startswith("background."):
        return False
    if re.match(r"^season\d+\.", lower_name):
        return False
    if re.match(r"^s\d+e\d+\.", lower_name):
        return False

    # 3. File-based exclusions (naming convention: Name_Type.ext)
    # Exclude files ending with _background.ext, _SeasonXX.ext, _SxxExx.ext
    if re.search(r"_background\.(jpg|jpeg|png|webp|tbn)$", lower_name):
        return False
    if re.search(r"_season\d+\.(jpg|jpeg|png|webp|tbn)$", lower_name):
        return False
    if re.search(r"_s\d+e\d+\.(jpg|jpeg|png|webp|tbn)$", lower_name):
        return False

    # If it passed all exclusions and has a valid extension, it's a poster
    return True


def is_background_file(filename: str) -> bool:
    """
    Check if file is a background.
    Matches: background.ext OR *_background.ext
    """
    lower_name = filename.lower()

    # Exact match: background.jpg, background.png, etc.
    if re.match(r"^background\.(jpg|jpeg|png|webp|tbn)$", lower_name):
        return True

    # File-based: ends with _background.ext
    if re.search(r"_background\.(jpg|jpeg|png|webp|tbn)$", lower_name):
        return True

    return False


def is_season_file(filename: str) -> bool:
    """
    Check if file is a season poster.
    Matches: SeasonXX.ext OR *_SeasonXX.ext
    """
    # Folder-based: SeasonXX.ext (case insensitive via flag or lower handling)
    if re.match(r"^season\d+\.(jpg|jpeg|png|webp|tbn)$", filename, re.IGNORECASE):
        return True

    # File-based: *_SeasonXX.ext
    if re.search(r"_season\d+\.(jpg|jpeg|png|webp|tbn)$", filename, re.IGNORECASE):
        return True

    return False


def is_titlecard_file(filename: str) -> bool:
    """
    Check if file is a title card / episode.
    Matches: SxxExx.ext OR *_SxxExx.ext
    """
    # Folder-based: SxxExx.ext
    if re.match(r"^s\d+e\d+\.(jpg|jpeg|png|webp|tbn)$", filename, re.IGNORECASE):
        return True

    # File-based: *_SxxExx.ext
    if re.search(r"_s\d+e\d+\.(jpg|jpeg|png|webp|tbn)$", filename, re.IGNORECASE):
        return True

    return False


# ============================================================================
# DYNAMIC ASSET CACHING SYSTEM
# ============================================================================
CACHE_TTL_SECONDS = 300  # Cache data for 3 minutes (only for statistics)
CACHE_REFRESH_INTERVAL = 600  # Refresh cache every 3 minutes for faster gallery updates

asset_cache = {
    "last_scanned": 0,
    "posters": [],
    "backgrounds": [],
    "seasons": [],
    "titlecards": [],
    "folders": [],
    "manual_gallery": {"libraries": [], "total_assets": 0},
}

# Background refresh control (already initialized above, see global variables)


def process_image_path(image_path: Path):
    """Helper function to process a Path object into a dictionary."""
    try:
        relative_path = image_path.relative_to(ASSETS_DIR)
        url_path = str(relative_path).replace("\\", "/")
        # URL encode the path to handle special characters like #
        encoded_url_path = quote(url_path, safe="/")

        # Get file stats
        file_stat = image_path.stat()

        # Extract library folder (first part of relative path) and determine media type
        library_folder = None
        media_type = None
        try:
            library_folder = relative_path.parts[0]
            media_type = determine_media_type(image_path.name, library_folder)
        except (ValueError, IndexError):
            # If relative_path does not have any parts, or library_folder cannot be determined,
            # we ignore the error and leave library_folder and media_type as None.
            pass

        return {
            "path": str(relative_path),
            "name": image_path.name,
            "size": file_stat.st_size,
            "url": f"/poster_assets/{encoded_url_path}",
            "created": file_stat.st_ctime,  # Creation time (Unix timestamp)
            "modified": file_stat.st_mtime,  # Modification time (Unix timestamp)
            "type": media_type,  # Media type (Movie, Show, Season, Episode, Background)
        }
    except Exception as e:
        logger.error(f"Error processing image path {image_path}: {e}")
        return None

def determine_media_type(filename: str, library_folder: str = None) -> str:
    """
    Determine media type from filename and library folder.
    Supports .jpg, .jpeg, .png, .webp
    """
    name = filename.lower()
    # Regex to match supported extensions
    ext_pattern = r"\.(jpg|jpeg|png|webp|tbn)$"

    # Check for episodes/title cards first (matches S01E01.jpg, S01E01.png, etc.)
    if (
        re.match(r"^s\d+e\d+" + ext_pattern, name)
        or re.match(r".*_s\d+e\d+" + ext_pattern, name)
        or name.startswith("episodetemplate")
    ):
        logger.debug(
            f"[MediaType] {filename} in {library_folder} -> Episode (pattern match)"
        )
        return "Episode"

    # Check for season posters (matches Season01.jpg, Season01.png, etc.)
    if re.match(r"^season\d+" + ext_pattern, name):
        logger.debug(
            f"[MediaType] {filename} in {library_folder} -> Season (pattern match)"
        )
        return "Season"

    # Get library type from database for backgrounds and posters
    library_type = None
    if library_folder:
        library_type = get_library_type_from_db(library_folder)
        logger.debug(
            f"[MediaType] Library '{library_folder}' type from DB: {library_type}"
        )

    # Check for backgrounds (matches background.jpg, background.png, etc.)
    if re.match(r"^background" + ext_pattern, name):
        if library_type == "show":
            logger.debug(f"[MediaType] {filename} -> Show Background (library_type=show)")
            return "Show Background"
        elif library_type == "movie":
            logger.debug(f"[MediaType] {filename} -> Movie Background (library_type=movie)")
            return "Movie Background"

        # Guess from folder name if DB lookup failed
        if library_folder:
            folder_lower = library_folder.lower()
            if any(k in folder_lower for k in ["show", "series", "tv", "serien"]):
                return "Show Background"
            if any(k in folder_lower for k in ["movie", "film", "kino"]):
                return "Movie Background"

        return "Background"

    # Check for posters (matches poster.jpg, poster.png, etc.)
    if re.match(r"^poster" + ext_pattern, name):
        if library_type == "show":
            logger.debug(f"[MediaType] {filename} -> Show (library_type=show)")
            return "Show"
        elif library_type == "movie":
            logger.debug(f"[MediaType] {filename} -> Movie (library_type=movie)")
            return "Movie"

        # Guess from folder name if DB lookup failed
        if library_folder:
            folder_lower = library_folder.lower()
            if any(k in folder_lower for k in ["show", "series", "tv", "serien"]):
                return "Show"
            if any(k in folder_lower for k in ["movie", "film", "kino"]):
                return "Movie"

    # Default to Movie for unrecognized images
    logger.debug(f"[MediaType] {filename} in {library_folder} -> Movie (default)")
    return "Movie"

def get_library_type_from_db(library_folder: str) -> Optional[str]:
    """
    Get library type (movie/show) from database by library folder name
    Uses a cache to avoid repeated database lookups

    Args:
        library_folder: The library folder name (e.g., "TestMovies", "TestSerien")

    Returns:
        "movie" or "show", or None if not found
    """
    # Use a simple module-level cache
    if not hasattr(get_library_type_from_db, "cache"):
        get_library_type_from_db.cache = {}

    # Check cache first
    if library_folder in get_library_type_from_db.cache:
        cached_type = get_library_type_from_db.cache[library_folder]
        logger.debug(f"[LibraryType] Cache hit for '{library_folder}': {cached_type}")
        return cached_type

    # Silence warnings for 'Collections' folder and cache the result as None
    if library_folder.lower() == "collections":
        get_library_type_from_db.cache[library_folder] = None
        return None

    logger.debug(
        f"[LibraryType] Cache miss for '{library_folder}', querying database..."
    )

    # Use the global media_export_db instance, do not create a new one
    db_instance = media_export_db

    if db_instance:
        try:
            library_type = db_instance.lookup_library_type_by_name(library_folder)
            if library_type:
                # Normalize the library type to match the expected "movie" or "show"
                lib_type_lower = library_type.lower()
                normalized_type = None
                if lib_type_lower in ["show", "shows", "series", "tvshows", "tvshow"]:
                    normalized_type = "show"
                elif lib_type_lower in ["movie", "movies"]:
                    normalized_type = "movie"
                else:
                    normalized_type = lib_type_lower

                # Cache the result
                get_library_type_from_db.cache[library_folder] = normalized_type
                logger.info(
                    f"[LibraryType] Database lookup for '{library_folder}': {normalized_type} (cached, DB was '{library_type}')"
                )
                return normalized_type
            else:
                logger.warning(
                    f"[LibraryType] No library type found in database for '{library_folder}'"
                )
        except Exception as e:
            logger.error(
                f"[LibraryType] Error looking up library type for '{library_folder}': {e}"
            )

    return None

def cleanup_outdated_assets():
    """Asset cleanup"""
    logger.info("Starting cleanup of outdated assets...")
    deleted_count = 0

    if not MANUAL_ASSETS_DIR.exists() or not ASSETS_DIR.exists():
        logger.warning("Cleanup skipped: Manual assets or assets directory missing.")
        return

    # Iterate through manual assets
    for manual_file in MANUAL_ASSETS_DIR.rglob("*"):
        if manual_file.is_file():
            # Get relative path to find corresponding file in assets
            relative_path = manual_file.relative_to(MANUAL_ASSETS_DIR)
            corresponding_asset = ASSETS_DIR / relative_path

            if corresponding_asset.exists():
                # Compare modification times (stat().st_mtime)
                if manual_file.stat().st_mtime > corresponding_asset.stat().st_mtime:
                    try:
                        corresponding_asset.unlink()
                        deleted_count += 1
                        logger.info(f"Deleted outdated asset: {relative_path}")
                    except Exception as e:
                        logger.error(f"Failed to delete {corresponding_asset}: {e}")

    logger.info(f"Asset cleanup finished. Files deleted: {deleted_count}")

def scan_and_cache_assets():
    """
    Scans the assets directory and populates/refreshes the cache atomically.
    Builds a new cache in the background and replaces the old one at the end.
    """
    global cache_scan_in_progress, asset_cache

    # Prevent overlapping scans (thread-safe)
    if cache_scan_in_progress:
        logger.warning("Asset scan already in progress, skipping this request")
        return

    cache_scan_in_progress = True
    scan_start_time = time.time()
    logger.info("Starting background asset cache refresh...")

    # 1. Create a new, local cache. We will build this in the background.
    #    The global 'asset_cache' remains untouched and is served to the user.
    new_cache = {
        "posters": [],
        "backgrounds": [],
        "seasons": [],
        "titlecards": [],
        "folders": [],
        "manual_gallery": {"libraries": [], "total_assets": 0},
        "backup_gallery": {"libraries": [], "total_assets": 0},
        "last_scanned": 0, # Will be set at the end
    }

    if not ASSETS_DIR.exists() or not ASSETS_DIR.is_dir():
        logger.warning("Assets directory not found. Clearing cache.")
        # If the path is gone, clear the global cache and stop.
        asset_cache = new_cache # Set to empty
        asset_cache["last_scanned"] = time.time()
        cache_scan_in_progress = False
        return

    try:
        # =========================================================
        # 1. MAIN ASSETS SCAN (Existing Logic)
        # =========================================================

        # Cleanup Assets when newer Manualasset found.
        cleanup_outdated_assets()

        image_extensions = {".jpg", ".jpeg", ".png", ".webp"}

        logger.info(f"Scanning assets directory: {ASSETS_DIR}")
        all_images = [
            p
            for p in ASSETS_DIR.rglob("*")
            if p.suffix.lower() in image_extensions and "@eaDir" not in p.parts
        ]
        logger.info(f"Found {len(all_images)} image files to process")

        temp_folders = {}
        processed_count = 0
        last_log_time = time.time()

        for image_path in all_images:
            processed_count += 1

            # Log progress every 5000 files or every 10 seconds
            current_time = time.time()
            if processed_count % 5000 == 0 or (current_time - last_log_time) >= 10:
                logger.info(
                    f"Processing assets: {processed_count}/{len(all_images)} ({(processed_count/len(all_images)*100):.1f}%)"
                )
                last_log_time = current_time

            image_data = process_image_path(image_path)
            if not image_data:
                continue

            # Get folder name from original Path object
            try:
                folder_name = image_path.relative_to(ASSETS_DIR).parts[0]
            except (ValueError, IndexError):
                folder_name = "root"

            if folder_name not in temp_folders:
                temp_folders[folder_name] = {
                    "name": folder_name,
                    "path": folder_name,
                    "poster_count": 0,
                    "background_count": 0,
                    "season_count": 0,
                    "titlecard_count": 0,
                    "files": 0,
                    "size": 0,
                }

            # Count files and size for the folder
            temp_folders[folder_name]["files"] += 1
            temp_folders[folder_name]["size"] += image_data["size"]

            # Add assets to the 'new_cache'
            if is_poster_file(image_path.name):
                new_cache["posters"].append(image_data)
                temp_folders[folder_name]["poster_count"] += 1
            elif is_background_file(image_path.name):
                new_cache["backgrounds"].append(image_data)
                temp_folders[folder_name]["background_count"] += 1
            elif is_season_file(image_path.name):
                new_cache["seasons"].append(image_data)
                temp_folders[folder_name]["season_count"] += 1
            elif is_titlecard_file(image_path.name):
                new_cache["titlecards"].append(image_data)
                temp_folders[folder_name]["titlecard_count"] += 1

        logger.info("Sorting asset lists...")
        # Sort the lists in 'new_cache'
        for key in ["posters", "backgrounds", "seasons", "titlecards"]:
            new_cache[key].sort(key=lambda x: x["path"])

        logger.info("Finalizing folder metadata...")
        # Finalize folder data
        folder_list = list(temp_folders.values())
        for folder in folder_list:
            folder["total_count"] = (
                folder["poster_count"]
                + folder["background_count"]
                + folder["season_count"]
                + folder["titlecard_count"]
            )
        folder_list.sort(key=lambda x: x["name"])
        new_cache["folders"] = folder_list

        # =========================================================
        # 2. MANUAL ASSETS SCAN (Existing Logic)
        # =========================================================
        logger.info("Scanning manual assets directory...")
        manual_libraries = []
        manual_total_assets = 0
        if not MANUAL_ASSETS_DIR.exists():
            logger.warning(
                f"Manual assets directory does not exist: {MANUAL_ASSETS_DIR}"
            )
        else:
            try:
                for library_dir in MANUAL_ASSETS_DIR.iterdir():
                    if not library_dir.is_dir() or library_dir.name == "@eaDir":
                        continue

                    library_name = library_dir.name
                    folders = []

                    for folder_dir in library_dir.iterdir():
                        if not folder_dir.is_dir() or folder_dir.name == "@eaDir":
                            continue

                        folder_name = folder_dir.name
                        assets = []

                        for img_file in folder_dir.iterdir():
                            if "@eaDir" in img_file.parts:
                                continue
                            if img_file.is_file() and img_file.suffix.lower() in [
                                ".jpg", ".jpeg", ".png", ".webp"
                            ]:
                                if img_file.suffix == ".backup" or ".backup" in img_file.name:
                                    continue

                                filename_lower = img_file.name.lower()
                                if "poster.jpg" in filename_lower or "poster.png" in filename_lower:
                                    asset_type = "poster"
                                elif "background.jpg" in filename_lower or "background.png" in filename_lower:
                                    asset_type = "background"
                                elif filename_lower.startswith("season"):
                                    asset_type = "season"
                                elif re.match(r"^s\d+e\d+\.", filename_lower, re.IGNORECASE) or filename_lower.startswith("episodetemplate"):
                                    asset_type = "titlecard"
                                else:
                                    asset_type = "other"

                                relative_path = f"{library_name}/{folder_name}/{img_file.name}"
                                encoded_relative_path = quote(relative_path, safe="/")

                                assets.append(
                                    {
                                        "name": img_file.name,
                                        "path": relative_path,
                                        "type": asset_type,
                                        "size": img_file.stat().st_size,
                                        "url": f"/manual_poster_assets/{encoded_relative_path}",
                                        "modified": img_file.stat().st_mtime
                                    }
                                )
                                manual_total_assets += 1

                        if assets:
                            folders.append(
                                {
                                    "name": folder_name,
                                    "path": f"{library_name}/{folder_name}",
                                    "assets": assets,
                                    "asset_count": len(assets),
                                }
                            )

                    if folders:
                        manual_libraries.append(
                            {
                                "name": library_name,
                                "folders": folders,
                                "folder_count": len(folders),
                            }
                        )
            except Exception as e:
                logger.error(f"Error scanning manual assets directory: {e}")

        # Add manual gallery to 'new_cache'
        new_cache["manual_gallery"] = {
            "libraries": manual_libraries,
            "total_assets": manual_total_assets
        }
        logger.info(
            f"Manual assets scan complete: {len(manual_libraries)} libraries, {manual_total_assets} total assets"
        )

        # =========================================================
        # 3. BACKUP ASSETS SCAN (NEW LOGIC)
        # =========================================================
        logger.info("Scanning backup assets directory...")
        backup_libraries = []
        backup_total_assets = 0

        if not BACKUP_DIR.exists():
            logger.warning(f"Backup assets directory does not exist: {BACKUP_DIR}")
        else:
            try:
                for library_dir in BACKUP_DIR.iterdir():
                    if not library_dir.is_dir() or library_dir.name == "@eaDir":
                        continue

                    library_name = library_dir.name
                    folders = []
                    root_assets = []

                    for folder_dir in library_dir.iterdir():
                        if folder_dir.name == "@eaDir":
                            continue

                        if folder_dir.is_file() and folder_dir.suffix.lower() in [
                            ".jpg", ".jpeg", ".png", ".webp"
                        ]:
                            filename_lower = folder_dir.name.lower()

                            # Determine Asset Type based on filename patterns
                            if "poster" in filename_lower:
                                asset_type = "poster"
                            elif "background" in filename_lower:
                                asset_type = "background"
                            elif filename_lower.startswith("season"):
                                asset_type = "season"
                            elif re.match(r"^s\d+e\d+\.", filename_lower, re.IGNORECASE) or filename_lower.startswith("episodetemplate"):
                                asset_type = "titlecard"
                            else:
                                asset_type = "other"

                            relative_path = f"{library_name}/{folder_dir.name}"
                            encoded_relative_path = quote(relative_path, safe="/")

                            root_assets.append({
                                "name": folder_dir.name,
                                "path": relative_path,
                                "type": asset_type,
                                "size": folder_dir.stat().st_size,
                                "url": f"/backup_assets/{encoded_relative_path}", # Points to static mount
                                "modified": folder_dir.stat().st_mtime
                            })
                            backup_total_assets += 1
                            continue

                        if not folder_dir.is_dir():
                            continue

                        folder_name = folder_dir.name
                        assets = []

                        for img_file in folder_dir.iterdir():
                            if "@eaDir" in img_file.parts:
                                continue

                            # Support standard image extensions
                            # Note: You can add or remove specific extensions here
                            if img_file.is_file() and img_file.suffix.lower() in [
                                ".jpg", ".jpeg", ".png", ".webp"
                            ]:
                                filename_lower = img_file.name.lower()

                                # Determine Asset Type based on filename patterns
                                if "poster" in filename_lower:
                                    asset_type = "poster"
                                elif "background" in filename_lower:
                                    asset_type = "background"
                                elif filename_lower.startswith("season"):
                                    asset_type = "season"
                                elif re.match(r"^s\d+e\d+\.", filename_lower, re.IGNORECASE) or filename_lower.startswith("episodetemplate"):
                                    asset_type = "titlecard"
                                else:
                                    asset_type = "other"

                                relative_path = f"{library_name}/{folder_name}/{img_file.name}"
                                encoded_relative_path = quote(relative_path, safe="/")

                                assets.append({
                                    "name": img_file.name,
                                    "path": relative_path,
                                    "type": asset_type,
                                    "size": img_file.stat().st_size,
                                    "url": f"/backup_assets/{encoded_relative_path}", # Points to static mount
                                    "modified": img_file.stat().st_mtime
                                })
                                backup_total_assets += 1

                        if assets:
                            folders.append({
                                "name": folder_name,
                                "path": f"{library_name}/{folder_name}",
                                "assets": assets,
                                "asset_count": len(assets),
                            })

                    if root_assets:
                        folders.append({
                            "name": "Root Assets",
                            "path": library_name,
                            "assets": root_assets,
                            "asset_count": len(root_assets),
                        })

                    if folders:
                        backup_libraries.append({
                            "name": library_name,
                            "folders": folders,
                            "folder_count": len(folders),
                        })
            except Exception as e:
                logger.error(f"Error scanning backup assets directory: {e}")

        # Add backup gallery to 'new_cache'
        new_cache["backup_gallery"] = {
            "libraries": backup_libraries,
            "total_assets": backup_total_assets
        }
        logger.info(
            f"Backup assets scan complete: {len(backup_libraries)} libraries, {backup_total_assets} total assets"
        )

        # =========================================================
        # 4. FINALIZE CACHE UPDATE
        # =========================================================
        # Now that 'new_cache' is fully built, replace the global 'asset_cache'
        # This is a single, instant operation.
        new_cache["last_scanned"] = time.time()
        asset_cache = new_cache

    except Exception as e:
        logger.error(f"An error occurred during asset scan: {e}")
    finally:
        # Release lock
        cache_scan_in_progress = False
        scan_duration = time.time() - scan_start_time
        logger.info(
            f"Asset cache refresh finished in {scan_duration:.1f}s. "
            f"Found {len(new_cache['posters'])} posters, "
            f"{len(new_cache['backgrounds'])} backgrounds, "
            f"{len(new_cache['seasons'])} seasons, "
            f"{len(new_cache['titlecards'])} titlecards, "
            f"{len(new_cache['folders'])} folders, "
            f"{new_cache['manual_gallery']['total_assets']} manual assets, "
            f"{new_cache['backup_gallery']['total_assets']} backup assets."
        )

def background_cache_refresh(skip_initial_scan: bool = False):
    """Background thread that refreshes the cache periodically"""
    global cache_refresh_running

    logger.info(
        f"Background cache refresh started (interval: {CACHE_REFRESH_INTERVAL}s)"
    )

    # Run an initial scan immediately on startup
    try:
        if cache_refresh_running and not skip_initial_scan:
            logger.info("Running initial asset cache scan on startup...")
            scan_and_cache_assets()
            logger.info("Initial cache scan complete.")
        elif skip_initial_scan:
            logger.info("Skipping initial cache scan (already run by startup process).")
    except Exception as e:
        logger.error(f"Error during initial cache scan: {e}")

    while cache_refresh_running:
        try:
            # Wait until the next refresh
            # Sleep in 1-second intervals to allow for fast shutdown
            logger.debug(f"Cache refresh thread sleeping for {CACHE_REFRESH_INTERVAL} seconds...")
            for _ in range(CACHE_REFRESH_INTERVAL):
                if not cache_refresh_running:
                    logger.info("Cache refresh thread received stop signal during sleep.")
                    break
                time.sleep(1)

            if cache_refresh_running:  # Check again after sleep
                logger.info("Background cache refresh triggered by interval")
                scan_and_cache_assets()
                logger.info("Background cache refresh completed")
        except Exception as e:
            logger.error(f"Error in background cache refresh loop: {e}")
            # Continue running even if there's an error
            time.sleep(60)  # Wait a bit before retrying

def start_cache_refresh_background(skip_initial_scan: bool = False): # <-- MODIFIED
    """Start the background cache refresh thread"""
    global cache_refresh_task, cache_refresh_running

    if cache_refresh_task is not None and cache_refresh_task.is_alive():
        logger.warning("Background cache refresh is already running")
        return

    cache_refresh_running = True
    cache_refresh_task = threading.Thread(
        target=background_cache_refresh,
        args=(skip_initial_scan,), # <-- MODIFIED
        daemon=True,
        name="CacheRefresh"
    )
    cache_refresh_task.start()
    logger.info("Background cache refresh thread started")

def stop_cache_refresh_background():
    """Stop the background cache refresh thread"""
    global cache_refresh_running

    if cache_refresh_running:
        logger.info("Stopping background cache refresh...")
        cache_refresh_running = False
        if cache_refresh_task:
            cache_refresh_task.join(timeout=5)
        logger.info("Background cache refresh stopped")

def get_fresh_assets():
    """Returns the asset cache (always fresh thanks to background refresh)"""
    # Fully rely on background refresh - no blocking scans!
    # Return cache even if empty (first startup) - background thread will populate it
    if asset_cache["last_scanned"] == 0:
        logger.debug("Cache not yet populated - background scan in progress")
    return asset_cache

def find_poster_in_assets(
    rootfolder: str,
    asset_type: str = "Poster",
    title: str = "",
    download_source: str = "",
) -> str:
    """
    Search recursively in ASSETS_DIR for a folder matching rootfolder and return image URL

    Args:
        rootfolder: The rootfolder name from ImageChoices.csv (e.g. "1 Million Followers (2024) {tmdb-1117126}")
        asset_type: Type of asset ("Poster", "Season", "TitleCard", "Title_Card", "Background", "Episode", "Show")
        title: Full title from CSV (used to extract Season/Episode info)
        download_source: Path from CSV (for manually created assets, contains actual file path)

    Returns:
        URL path to image or None if not found
    """
    if not ASSETS_DIR.exists():
        return None

    try:
        # If download_source is a local path, try to extract the filename from it
        image_filename = None
        if download_source and download_source != "N/A":
            # Check if it looks like a file path (has backslashes or forward slashes and contains a file extension)
            if (
                "\\" in download_source or "/" in download_source
            ) and "." in download_source:
                # Extract filename from path (e.g., "C:\...\S01E02.jpg" -> "S01E02.jpg")
                import os

                image_filename = os.path.basename(download_source)
                logger.info(
                    f"Extracted filename from download_source: {image_filename} (from: {download_source})"
                )

        # Search recursively for the folder
        for item in ASSETS_DIR.rglob("*"):
            # Skip @eaDir folders from Synology NAS
            if item.is_dir() and item.name == "@eaDir":
                continue

            if item.is_dir() and item.name == rootfolder:
                # Found the matching folder
                image_file = None

                # First priority: use filename from download_source if available
                if image_filename:
                    image_file = item / image_filename
                    logger.info(f"Checking for file from download_source: {image_file}")
                    if not image_file.exists():
                        logger.warning(
                            f"File from download_source not found: {image_file}"
                        )
                        image_file = None

                # Second priority: determine by asset type
                if not image_file:
                    if asset_type == "Season":
                        # Extract season number from title (format: "Show Name | Season 01" or "Title SEASON")
                        import re

                        match = re.search(r"Season\s*(\d+)", title, re.IGNORECASE)
                        if match:
                            season_num = match.group(1).zfill(2)  # Pad to 2 digits
                            image_file = item / f"Season{season_num}.jpg"
                            if not image_file.exists():
                                # Try without padding
                                image_file = item / f"Season{match.group(1)}.jpg"
                        else:
                            # If no season number in title, look for any Season*.jpg file
                            import glob

                            season_files = list(item.glob("Season*.jpg"))
                            if season_files:
                                # Use the first Season*.jpg file found
                                image_file = season_files[0]
                                logger.info(
                                    f"No season number in title, using first found: {image_file.name}"
                                )

                    elif asset_type in ["TitleCard", "Title_Card", "Episode"]:
                        # Extract episode info from title (format: "S01E01 | Episode Title" or just "Episode Title")
                        import re

                        match = re.search(r"(S\d+E\d+)", title, re.IGNORECASE)
                        if match:
                            episode_code = match.group(1).upper()  # e.g. "S01E01"
                            image_file = item / f"{episode_code}.jpg"

                    elif asset_type in [
                        "Background",
                        "Movie Background",
                        "Show Background",
                        "TV Background",
                        "Series Background",
                        "Episode Background",
                    ]:
                        # Look for background.jpg in the folder
                        image_file = item / "background.jpg"

                    else:
                        # Default: look for poster.jpg (for "Poster", "Show", or any other type)
                        image_file = item / "poster.jpg"

                # Check if the image file exists
                if image_file and image_file.exists() and image_file.is_file():
                    # Create relative path from ASSETS_DIR
                    relative_path = image_file.relative_to(ASSETS_DIR)
                    # Create URL path with forward slashes
                    url_path = str(relative_path).replace("\\", "/")
                    # URL encode the path to handle special characters like #
                    encoded_url_path = quote(url_path, safe="/")
                    # Add cache busting parameter using file modification time
                    mtime = int(image_file.stat().st_mtime)
                    logger.info(f"Found image: {url_path} (mtime: {mtime})")
                    return f"/poster_assets/{encoded_url_path}?t={mtime}"

        logger.warning(
            f"No image found for rootfolder: {rootfolder}, type: {asset_type}"
        )
        return None

    except Exception as e:
        logger.error(f"Error searching for {asset_type} in assets: {e}")
        return None

def find_poster_with_metadata(
    rootfolder: str,
    asset_type: str = "Poster",
    title: str = "",
    download_source: str = "",
) -> dict:
    """
    Same as find_poster_in_assets but returns metadata including file timestamps

    Returns:
        dict with 'url', 'created', 'modified' keys, or None if not found
    """
    if not ASSETS_DIR.exists():
        return None

    try:
        # If download_source is a local path, try to extract the filename from it
        image_filename = None
        if download_source and download_source != "N/A":
            if (
                "\\" in download_source or "/" in download_source
            ) and "." in download_source:
                import os

                image_filename = os.path.basename(download_source)

        # Search recursively for the folder
        for item in ASSETS_DIR.rglob("*"):
            if item.is_dir() and item.name == "@eaDir":
                continue

            if item.is_dir() and item.name == rootfolder:
                image_file = None

                # First priority: use filename from download_source if available
                if image_filename:
                    image_file = item / image_filename
                    if not image_file.exists():
                        image_file = None

                # Second priority: determine by asset type
                if not image_file:
                    if asset_type == "Season":
                        import re

                        match = re.search(r"Season\s*(\d+)", title, re.IGNORECASE)
                        if match:
                            season_num = match.group(1).zfill(2)
                            image_file = item / f"Season{season_num}.jpg"
                            if not image_file.exists():
                                image_file = item / f"Season{match.group(1)}.jpg"
                        else:
                            import glob

                            season_files = list(item.glob("Season*.jpg"))
                            if season_files:
                                image_file = season_files[0]

                    elif asset_type in ["TitleCard", "Title_Card", "Episode"]:
                        import re

                        match = re.search(r"(S\d+E\d+)", title, re.IGNORECASE)
                        if match:
                            episode_code = match.group(1).upper()
                            image_file = item / f"{episode_code}.jpg"

                    elif asset_type in [
                        "Background",
                        "Movie Background",
                        "Show Background",
                        "TV Background",
                        "Series Background",
                        "Episode Background",
                    ]:
                        image_file = item / "background.jpg"

                    else:
                        image_file = item / "poster.jpg"

                # Check if the image file exists
                if image_file and image_file.exists() and image_file.is_file():
                    file_stat = image_file.stat()
                    relative_path = image_file.relative_to(ASSETS_DIR)
                    url_path = str(relative_path).replace("\\", "/")
                    encoded_url_path = quote(url_path, safe="/")
                    mtime = int(file_stat.st_mtime)

                    return {
                        "url": f"/poster_assets/{encoded_url_path}?t={mtime}",
                        "created": file_stat.st_ctime,
                        "modified": file_stat.st_mtime,
                    }

        return None

    except Exception as e:
        logger.error(f"Error searching for {asset_type} in assets: {e}")
        return None

def parse_image_choices_csv(csv_path: Path) -> list:
    """
    Parse ImageChoices.csv file and return list of assets
    CSV format: "Title";"Type";"Rootfolder";"LibraryName";"Language";"Fallback";"TextTruncated";"Download Source";"Fav Provider Link"

    Skips empty rows where all fields are empty (no assets created during script run)
    """
    import csv

    assets = []

    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            # CSV uses semicolon as delimiter
            reader = csv.DictReader(f, delimiter=";")

            for row in reader:
                # Skip empty rows (all fields are empty or just semicolons)
                title = row.get("Title", "").strip('"').strip()
                rootfolder = row.get("Rootfolder", "").strip('"').strip()

                # If both title and rootfolder are empty, this is an empty row
                if not title and not rootfolder:
                    continue

                # Remove quotes from values if present
                download_source = row.get("Download Source", "").strip('"')
                provider_link = row.get("Fav Provider Link", "").strip('"')

                # Determine if manually created (download_source is N/A or a local path)
                is_manually_created = download_source == "N/A" or (
                    download_source
                    and (
                        download_source.startswith("C:")
                        or download_source.startswith("/")
                        or download_source.startswith("\\")
                    )
                )

                asset = {
                    "title": row.get("Title", "").strip('"'),
                    "type": row.get("Type", "").strip('"'),
                    "rootfolder": row.get("Rootfolder", "").strip('"'),
                    "library": row.get("LibraryName", "").strip('"'),
                    "language": row.get("Language", "").strip('"'),
                    "fallback": row.get("Fallback", "").strip('"').lower() == "true",
                    "text_truncated": row.get("TextTruncated", "").strip('"').lower()
                    == "true",
                    "download_source": download_source,
                    "provider_link": provider_link if provider_link != "N/A" else "",
                    "is_manually_created": is_manually_created,
                }
                assets.append(asset)

    except Exception as e:
        logger.error(f"Error parsing CSV {csv_path}: {e}")
        raise

    return assets

async def fetch_version(local_filename: str, github_url: str, version_type: str):
    """
    A reusable function to get a local version from a file and fetch the remote
    version from GitHub when running in a Docker environment.
    """
    local_version = None
    remote_version = None

    # Get Local Version
    try:
        version_file = BASE_DIR / local_filename
        if version_file.exists():
            local_version = version_file.read_text().strip()
    except Exception as e:
        logger.error(f"Error reading local {version_type} version file: {e}")

    # Get Remote Version (if in Docker)
    if IS_DOCKER:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(github_url, timeout=10.0)
                response.raise_for_status()
                remote_version = response.text.strip()
                logger.info(
                    f"Successfully fetched remote {version_type} version: {remote_version}"
                )
        except httpx.RequestError as e:
            logger.warning(
                f"Could not fetch remote {version_type} version from GitHub: {e}"
            )
        except Exception as e:
            logger.error(
                f"An unexpected error occurred while fetching remote {version_type} version: {e}"
            )

    # Check if local version is greater than remote (development version)
    display_version = local_version
    if local_version and remote_version:
        local_parsed = parse_version(local_version)
        remote_parsed = parse_version(remote_version)

        if local_parsed and remote_parsed and local_parsed > remote_parsed:
            # Local version is ahead of GitHub - add -dev suffix
            display_version = f"{local_version}-dev"
            logger.info(
                f"Local {version_type} version {local_version} is ahead of remote {remote_version}, adding -dev suffix"
            )

    return {"local": display_version, "remote": remote_version}

async def get_script_version():
    """
    Reads the version from Posterizarr.ps1 and compares with GitHub Release.txt
    Similar to the PowerShell CompareScriptVersion function

    NOW WITH SEMANTIC VERSION COMPARISON!
    """
    local_version = None
    remote_version = None

    # Get Local Version from Posterizarr.ps1
    try:
        # Use the already defined SCRIPT_PATH
        posterizarr_path = SCRIPT_PATH

        logger.info(f"Looking for Posterizarr.ps1 at: {posterizarr_path}")

        if posterizarr_path.exists():
            with open(posterizarr_path, "r", encoding="utf-8") as f:
                content = f.read()

            # Extract version using regex: $CurrentScriptVersion = "1.9.95"
            match = re.search(r'\$CurrentScriptVersion\s*=\s*"([^"]+)"', content)
            if match:
                local_version = match.group(1)
                logger.info(
                    f"Local script version from Posterizarr.ps1: {local_version}"
                )
            else:
                logger.warning(
                    "Could not find $CurrentScriptVersion in Posterizarr.ps1"
                )
        else:
            logger.error(f"Posterizarr.ps1 not found at {posterizarr_path}")
    except Exception as e:
        logger.error(f"Error reading version from Posterizarr.ps1: {e}")

    # Get Remote Version from GitHub Release.txt
    # Always fetch from GitHub (both Docker and local)
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://raw.githubusercontent.com/fscorrupt/posterizarr/refs/heads/main/Release.txt",
                timeout=10.0,
            )
            response.raise_for_status()
            remote_version = response.text.strip()
            logger.info(f"Remote version from GitHub Release.txt: {remote_version}")
    except httpx.RequestError as e:
        logger.warning(f"Could not fetch remote version from GitHub: {e}")
    except Exception as e:
        logger.error(f"Error fetching remote version: {e}")

    # SEMANTIC VERSION COMPARISON
    is_update_available = False
    display_version = local_version

    if local_version and remote_version:
        is_update_available = is_version_newer(local_version, remote_version)

        # Check if local version is GREATER than remote (development version)
        local_parsed = parse_version(local_version)
        remote_parsed = parse_version(remote_version)

        if local_parsed and remote_parsed and local_parsed > remote_parsed:
            # Local version is ahead of GitHub - add -dev suffix
            display_version = f"{local_version}-dev"
            logger.info(
                f"Local version {local_version} is ahead of remote {remote_version}, adding -dev suffix"
            )

        logger.info(
            f"Update available: {is_update_available} (local: {local_version}, remote: {remote_version})"
        )

    return {
        "local": display_version,
        "remote": remote_version,
        "is_update_available": is_update_available,  # Boolean for update availability
    }

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler for startup and shutdown"""
    global scheduler, db, config_db, media_export_db, logs_watcher, server_libraries_db

    logger.info("Starting Posterizarr Web UI Backend")

    # Setup default images for Creator Mode preview
    try:
        setup_default_images(IMAGES_DIR)
        logger.info(f"Default images checked/created in {IMAGES_DIR}")
    except Exception as e:
        logger.error(f"Error setting up default images: {e}")

    # This blocks the app from starting until the first scan is done,
    # ensuring the UI is populated on first load.
    logger.info("Running initial asset cache scan... (UI will be available after this is complete)")
    try:
        # We wrap the blocking function in asyncio.to_thread to be a good async citizen
        await asyncio.to_thread(scan_and_cache_assets)
        logger.info("Initial asset cache scan complete.")
    except Exception as e:
        logger.error(f"Error during initial cache scan: {e}")
        # We can decide to continue or fail startup. Let's continue.

    # Start background cache refresh (which will now skip its own initial scan)
    start_cache_refresh_background(skip_initial_scan=True)

    # Initialize config database if available
    if CONFIG_DATABASE_AVAILABLE:
        try:
            logger.info("Initializing config database...")
            CONFIG_DB_PATH = DATABASE_DIR / "config.db"
            logger.info(f"Target CONFIG_DB_PATH is {CONFIG_DB_PATH}")

            config_db = ConfigDB(CONFIG_DB_PATH, CONFIG_PATH)
            config_db.initialize()

            logger.info(f"Config database ready: {CONFIG_DB_PATH}")
            logger.info(f"Does config.db exist on disk now? {CONFIG_DB_PATH.exists()}")
        except Exception as e:
            logger.error(f"Failed to initialize config database: {e}", exc_info=True)
            config_db = None
    else:
        logger.info("Config database module not available, skipping initialization")
    # Initialize media export database if available
    if MEDIA_EXPORT_DB_AVAILABLE:
        try:
            logger.info("Initializing media export database...")
            media_export_db = MediaExportDatabase()
            logger.info("Media export database ready")
        except Exception as e:
            logger.error(f"Failed to initialize media export database: {e}")
            media_export_db = None
    else:
        logger.info(
            "Media export database module not available, skipping initialization"
        )

    # Initialize database if available
    if DATABASE_AVAILABLE:
        try:
            logger.info("Initializing imagechoices database...")

            # Check if database exists before initialization
            db_existed_before = IMAGECHOICES_DB_PATH.exists()

            # Initialize database (creates if not exists)
            db = init_database(IMAGECHOICES_DB_PATH)

            # If database was just created (first start), check for existing CSV to import
            if not db_existed_before:
                csv_path = LOGS_DIR / "ImageChoices.csv"
                if csv_path.exists():
                    logger.info(
                        "Found existing ImageChoices.csv - importing to new database..."
                    )
                    try:
                        stats = db.import_from_csv(csv_path)
                        if stats["added"] > 0:
                            logger.info(
                                f"Initialized database with {stats['added']} records from existing CSV"
                            )
                        else:
                            logger.info(
                                "No records imported from CSV (all empty or invalid)"
                            )
                    except Exception as csv_error:
                        logger.warning(f"Could not import existing CSV: {csv_error}")
                else:
                    logger.info("No existing CSV found - database initialized empty")

            # Check if database has any records
            try:
                record_count = len(db.get_all_choices())
                logger.info(
                    f"Database ready: {IMAGECHOICES_DB_PATH} ({record_count} records)"
                )
            except Exception:
                logger.info(f"Database ready: {IMAGECHOICES_DB_PATH}")

        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            db = None
    else:
        logger.info("Database module not available, skipping database initialization")

    # Initialize server libraries database
    server_libraries_db = None
    if SERVER_LIBRARIES_DB_AVAILABLE:
        try:
            logger.info("Initializing server libraries database...")
            SERVER_LIBRARIES_DB_PATH = DATABASE_DIR / "server_libraries.db"
            server_libraries_db = init_server_libraries_db(SERVER_LIBRARIES_DB_PATH)
            logger.info(f"Server libraries database ready: {SERVER_LIBRARIES_DB_PATH}")
        except Exception as e:
            logger.error(f"Failed to initialize server libraries database: {e}")
            server_libraries_db = None
    else:
        logger.info(
            "Server libraries database module not available, skipping initialization"
        )

    # Initialize and start logs watcher if available
    logs_watcher = None
    if LOGS_WATCHER_AVAILABLE and DATABASE_AVAILABLE and RUNTIME_DB_AVAILABLE:
        try:
            logger.info(
                "Initializing logs watcher for background process monitoring..."
            )
            logs_watcher = create_logs_watcher(
                logs_dir=LOGS_DIR,
                db_instance=db,
                runtime_db_instance=runtime_db,
                media_export_db_instance=(
                    media_export_db if MEDIA_EXPORT_DB_AVAILABLE else None
                ),
            )
            logs_watcher.start()
            logger.info(
                "✓ Logs watcher started - monitoring for background process files"
            )
        except Exception as e:
            logger.error(f"Failed to initialize logs watcher: {e}")
            logs_watcher = None
    else:
        if not LOGS_WATCHER_AVAILABLE:
            logger.info("Logs watcher module not available, skipping")
        elif not DATABASE_AVAILABLE:
            logger.info("Database not available, skipping logs watcher")
        elif not RUNTIME_DB_AVAILABLE:
            logger.info("Runtime database not available, skipping logs watcher")

    # Initialize and start scheduler if available
    if SCHEDULER_AVAILABLE:
        try:
            scheduler = PosterizarrScheduler(BASE_DIR, SCRIPT_PATH)
            scheduler.start()
            logger.info("Scheduler initialized and started")
        except Exception as e:
            logger.error(f"Failed to initialize scheduler: {e}")
            scheduler = None
    else:
        logger.info("Scheduler module not available, skipping scheduler initialization")

    yield

    # Shutdown

    # Stop logs watcher
    if logs_watcher:
        try:
            logger.info("Stopping logs watcher...")
            logs_watcher.stop()
            logger.info("Logs watcher stopped")
        except Exception as e:
            logger.error(f"Error stopping logs watcher: {e}")

    # Stop queue listener for thread-safe logging
    global queue_listener
    if queue_listener:
        try:
            logger.info("Stopping queue listener for FrontendUI.log")
            queue_listener.stop()
            logger.info("Queue listener stopped")
        except Exception as e:
            logger.error(f"Error stopping queue listener: {e}")

    # Stop background cache refresh
    stop_cache_refresh_background()

    if scheduler:
        try:
            scheduler.stop()
            logger.info("Scheduler stopped")
        except Exception as e:
            logger.error(f"Error stopping scheduler: {e}")

    if db:
        try:
            db.close()
            logger.info("Database connection closed")
        except Exception as e:
            logger.error(f"Error closing database: {e}")

    if config_db:
        try:
            config_db.close()
            logger.info("Config database connection closed")
        except Exception as e:
            logger.error(f"Error closing config database: {e}")

    logger.info("Shutting down Posterizarr Web UI Backend")


app = FastAPI(title="Posterizarr Web UI", lifespan=lifespan)

# Add exception handler for validation errors
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Custom handler for validation errors with detailed logging"""
    logger.error(f"Validation error for {request.method} {request.url}")
    logger.error(f"Request body: {await request.body()}")
    logger.error(f"Validation errors: {exc.errors()}")
    return JSONResponse(
        status_code=400,
        content={"detail": exc.errors(), "body": str(exc.body)},
    )


# Basic Auth Middleware
if AUTH_MIDDLEWARE_AVAILABLE:
    try:
        # Ensure path is correct by using DATABASE_DIR directly
        auth_db_path = DATABASE_DIR / "config.db"

        app.add_middleware(
            BasicAuthMiddleware,
            config_path=CONFIG_PATH,
            db_path=auth_db_path, # Use the local variable
        )
        logger.info("Basic Auth middleware registered with dynamic config reload")
    except Exception as e:
        logger.error(f"Failed to initialize Basic Auth: {e}")
else:
    logger.info("Basic Auth middleware not available, skipping")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/onboarding/complete")
async def complete_onboarding():
    """Mark onboarding as completed."""
    if CONFIG_DATABASE_AVAILABLE and config_db:
        success = config_db.set_value('_root', 'onboarding_completed', True)
        if success:
            logger.info("Onboarding marked as completed by user.")
            return {"success": True, "message": "Onboarding completed"}
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": "Failed to mark onboarding as completed."}
    )

class ConfigUpdate(BaseModel):
    config: dict


class ResetPostersRequest(BaseModel):
    library: str

class LogoUpdaterRequest(BaseModel):
    library: str
    force_replace: bool = False
    revert: bool = False

class RestoreModeRequest(BaseModel):
    library_name: Optional[str] = None
    item_name: Optional[str] = None
    asset_type: Optional[str] = None

class ManualModeRequest(BaseModel):
    model_config = {"extra": "ignore"}  # Ignore extra fields from frontend

    picturePath: str
    titletext: str
    folderName: str
    libraryName: str
    posterType: Literal[
        "standard", "season", "collection", "titlecard", "background"
    ] = "standard"
    seasonPosterName: str = ""
    epTitleName: str = ""
    episodeNumber: str = ""
    mediaType: str = ""
    add_to_queue: bool = False
    posterWithText: bool = False
    blueprint_overrides: Optional[Dict] = None


class UILogEntry(BaseModel):
    level: str  # "INFO", "WARNING", "ERROR", "DEBUG"
    message: str
    timestamp: str
    component: str = (
        "UI"  # Component/module name (e.g., "Gallery", "ImagePreviewModal")
    )


class UILogBatch(BaseModel):
    logs: list[UILogEntry]


class ScheduleCreate(BaseModel):
    time: str  # Format: "HH:MM"
    description: Optional[str] = ""
    mode: Optional[str] = "normal"


class ScheduleUpdate(BaseModel):
    enabled: Optional[bool] = None
    schedules: Optional[List[dict]] = None
    timezone: Optional[str] = None
    skip_if_running: Optional[bool] = None


class TMDBSearchRequest(BaseModel):
    query: str  # Can be title or TMDB ID
    media_type: str = "movie"  # "movie" or "tv"
    poster_type: str = "standard"  # "standard", "season", "titlecard"
    year: Optional[int] = None  # Year for search (required for numeric titles)
    season_number: Optional[int] = None  # For season posters and titlecards
    episode_number: Optional[int] = None  # For titlecards only


class PlexValidationRequest(BaseModel):
    url: str
    token: str


class JellyfinValidationRequest(BaseModel):
    url: str
    api_key: str


class EmbyValidationRequest(BaseModel):
    url: str
    api_key: str


class TMDBValidationRequest(BaseModel):
    token: str


class TVDBValidationRequest(BaseModel):
    api_key: str
    pin: Optional[str] = None


class FanartValidationRequest(BaseModel):
    api_key: str


class DiscordValidationRequest(BaseModel):
    webhook_url: str


class AppriseValidationRequest(BaseModel):
    url: str


class UptimeKumaValidationRequest(BaseModel):
    url: str

# In backend/main.py

class OverlayCreatorRequest(BaseModel):
    border_enabled: bool = False
    border_px: int = 0
    border_color: str = "#FFFFFF"
    corner_radius: float = 0.0

    # Gradient / Matte
    matte_height_ratio: float = 0.0
    fade_height_ratio: float = 0.0
    gradient_color: str = "#000000"

    # Effects
    inner_glow_strength: float = 0.0
    inner_glow_color: str = "#000000"

    vignette_strength: float = 0.0
    vignette_color: str = "#000000"

    grain_amount: float = 0.0
    grain_size: float = 1.0

    filename: Optional[str] = None
    overlay_type: str = "poster"
    overwrite: bool = False
    show_text_area: bool = False

@app.get("/api")
async def api_root():
    return {"message": "Posterizarr Web UI API", "status": "running"}


@app.get("/api/auth/check")
async def check_auth():
    """
    Check if Basic Auth is enabled and if user is authenticated.
    This endpoint is always accessible (not protected by auth middleware).
    """
    if AUTH_MIDDLEWARE_AVAILABLE:
        try:
            auth_config = load_auth_config(CONFIG_PATH)
            return {
                "enabled": auth_config["enabled"],
                "authenticated": True,  # If this endpoint is reached, user is authenticated
            }
        except Exception as e:
            logger.error(f"Error checking auth config: {e}")
            return {"enabled": False, "authenticated": True, "error": str(e)}
    else:
        return {"enabled": False, "authenticated": True}

class ApiKeyCreate(BaseModel):
    name: str

@app.get("/api/auth/keys")
async def list_api_keys():
    """List all active API keys"""
    if not CONFIG_DATABASE_AVAILABLE or not config_db:
        raise HTTPException(status_code=503, detail="Config DB not available")
    return {"success": True, "keys": config_db.list_api_keys()}

@app.post("/api/auth/keys")
async def create_api_key(data: ApiKeyCreate):
    """Generate a new API key"""
    if not CONFIG_DATABASE_AVAILABLE or not config_db:
        raise HTTPException(status_code=503, detail="Config DB not available")

    # Generate a secure random key (32 chars)
    raw_key = secrets.token_urlsafe(32)

    key_id = config_db.add_api_key(data.name, raw_key)

    if key_id != -1:
        return {
            "success": True,
            "key": raw_key,
            "message": "Key generated. Save it now, it won't be shown again!",
            "id": key_id
        }
    else:
        raise HTTPException(status_code=500, detail="Failed to create key")

@app.delete("/api/auth/keys/{key_id}")
async def revoke_api_key(key_id: int):
    """Revoke an API key"""
    if not CONFIG_DATABASE_AVAILABLE or not config_db:
        raise HTTPException(status_code=503, detail="Config DB not available")

    if config_db.delete_api_key(key_id):
        return {"success": True, "message": "Key revoked"}
    else:
        raise HTTPException(status_code=500, detail="Failed to revoke key")


@app.get("/api/config")
async def get_config(request: Request):
    """Get current config.json - SECURED: Blocks CLI tools when auth is off"""
    logger.info("=" * 60)
    logger.info("CONFIG READ REQUEST")

    # This block prevents unauthorized CLI access even if Middleware fails
    try:
        # Check if Auth is enabled in the file directly
        auth_enabled = False
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                c = json.load(f)
                webui = c.get("WebUI", {})
                auth_enabled = str(webui.get("basicAuthEnabled", False)).lower() in ["true", "1", "yes"]

        # 1. Check for API Key presence
        api_key = request.query_params.get("api_key") or request.headers.get("X-API-Key")

        # 2. Validate API Key if present
        is_key_valid = False
        if api_key and config_db:
            # Validate against the database
            is_key_valid = config_db.validate_api_key(api_key)
            if is_key_valid:
                logger.info("Access granted via valid API Key (Script/CLI access)")
            else:
                logger.warning(f"Invalid API Key provided: {api_key[:5]}...")

        # 3. Security Logic
        # If Auth is OFF, we enforce Browser-Only access...
        # UNLESS a VALID API key is provided (bypasses browser check)
        if not auth_enabled and not is_key_valid:
            referer = request.headers.get("referer", "")
            origin = request.headers.get("origin", "")
            host = request.headers.get("host", "")

            is_valid_ui = False
            if host:
                if referer and host in referer: is_valid_ui = True
                if origin and host in origin: is_valid_ui = True

            if not is_valid_ui:
                # If they provided a key but it was wrong, give a specific error
                if api_key:
                    logger.warning("Blocking request: Invalid API Key")
                    raise HTTPException(status_code=403, detail="Invalid API Key")

                # Otherwise, give the standard "Browser Only" error
                logger.warning(f"SECURITY: Blocking direct non-browser access to config from {request.client.host}")
                raise HTTPException(status_code=403, detail="Direct API access denied. Use the Web UI.")

    except HTTPException:
        raise
    except Exception as sec_err:
        logger.error(f"Security check error: {sec_err}")

    try:
        if not CONFIG_PATH.exists():
            raise HTTPException(status_code=404, detail="Config file not found")

        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            grouped_config = json.load(f)
        # Get onboarding_completed from DB
        # Default to False if config_db is missing or failed to load, to ensure fresh installs see the modal
        onboarding_completed = False
        if CONFIG_DATABASE_AVAILABLE and config_db:
            val = config_db.get_value('_root', 'onboarding_completed')
            if val is not None:
                # Value is stored as integer 0 or 1 in SQLite, convert to bool
                onboarding_completed = bool(val)

        # Merge API keys correctly into the final response

        if CONFIG_MAPPER_AVAILABLE:
            flat_config = flatten_config(grouped_config)

            display_names_dict = {}
            for key in flat_config.keys():
                display_names_dict[key] = get_display_name(key)

            return {
                "success": True,
                "config": flat_config,  # Actual values returned
                "_root": {"onboarding_completed": onboarding_completed},
                "ui_groups": UI_GROUPS,
                "display_names": display_names_dict,
                "tooltips": CONFIG_TOOLTIPS,
                "using_flat_structure": True,
            }
        else:
            return {
                "success": True,
                "config": grouped_config,  # Actual values returned
                "_root": {"onboarding_completed": onboarding_completed},
                "tooltips": CONFIG_TOOLTIPS,
                "using_flat_structure": False,
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error reading config: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/config/backup")
async def backup_config():
    """Create a timestamped backup of the current config.json"""
    logger.info("=" * 60)
    logger.info("CONFIG BACKUP REQUEST")
    try:
        if not CONFIG_PATH.exists():
            return {"success": False, "message": "No config.json found to backup"}

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"config_backup_{timestamp}.json"
        backup_path = BASE_DIR / backup_filename

        shutil.copy2(CONFIG_PATH, backup_path)
        logger.info(f"Created config backup at {backup_path}")

        return {
            "success": True,
            "message": "Backup created successfully",
            "backup_file": backup_filename
        }
    except Exception as e:
        logger.error(f"Error creating config backup: {e}")
        raise HTTPException(status_code=500, detail="Failed to create config backup")

@app.get("/api/config/export")
async def export_blueprint():
    """Export the grouped config.json minus sensitive data"""
    try:
        if not CONFIG_PATH.exists():
            raise HTTPException(status_code=404, detail="Config not found")

        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            export_data = json.load(f)

        # Remove sensitive sections completely
        for section in ["ApiPart", "PlexPart", "JellyfinPart", "EmbyPart", "Notification", "WebUI"]:
            export_data.pop(section, None)

        # Remove specific paths from PrerequisitePart
        if "PrerequisitePart" in export_data:
            for path_key in ["AssetPath", "ManualAssetPath", "BackupPath", "magickinstalllocation", "overlayfile"]:
                export_data["PrerequisitePart"].pop(path_key, None)

        return JSONResponse(
            content=export_data,
            headers={"Content-Disposition": 'attachment; filename="custom_blueprint.json"'}
        )
    except Exception as e:
        logger.error(f"Error exporting blueprint: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/config/import")
async def import_blueprint(request: Request):
    """Import a grouped config.json (blueprint), create backup, and deep merge"""
    try:
        imported_config = await request.json()

        # 1. Create backup
        if CONFIG_PATH.exists():
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = BASE_DIR / f"config_backup_{timestamp}.json"
            shutil.copy2(CONFIG_PATH, backup_path)

        # 2. Load current config
        current_config = {}
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                current_config = json.load(f)

        # 3. Deep merge
        def deep_merge(source, destination):
            for key, value in source.items():
                if isinstance(value, dict):
                    node = destination.setdefault(key, {})
                    deep_merge(value, node)
                else:
                    destination[key] = value
            return destination

        new_config = deep_merge(imported_config, current_config)

        # 4. Save
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(new_config, f, indent=4, ensure_ascii=False)

        # 5. Sync to database if available
        try:
            if 'CONFIG_DATABASE_AVAILABLE' in globals() and 'config_db' in globals():
                if CONFIG_DATABASE_AVAILABLE and config_db:
                    config_db.update_all_from_json(str(CONFIG_PATH))
        except Exception as db_err:
            logger.warning(f"Failed to sync imported config to database: {db_err}")

        return {"success": True, "message": "Blueprint imported successfully"}
    except Exception as e:
        logger.error(f"Error importing blueprint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/config")
async def update_config(data: ConfigUpdate):
    """Update config.json - accepts FLAT structure and saves as GROUPED when config_mapper available"""
    logger.info("=" * 60)
    logger.info("CONFIG UPDATE REQUEST")
    logger.debug(f"Number of config keys to update: {len(data.config)}")
    logger.debug(f"Config mapper available: {CONFIG_MAPPER_AVAILABLE}")

    try:
        # Load current config to detect changes
        logger.debug("Loading current config to detect changes...")
        current_config = {}
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                current_config = json.load(f)

        # Flatten current config if needed for comparison
        if CONFIG_MAPPER_AVAILABLE and current_config:
            current_flat = flatten_config(current_config)
        else:
            current_flat = current_config

        # Check if basicAuthPassword is being updated
        if "basicAuthPassword" in data.config:
            new_pass = data.config["basicAuthPassword"]
            # Only hash if it's not already a hash (user entered a new plain password)
            if new_pass and not new_pass.startswith(("$2b$", "$2a$", "$2y$")):
                logger.info("Hashing new password provided in config update...")
                hashed = bcrypt.hashpw(new_pass.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                data.config["basicAuthPassword"] = hashed

        # Preserve library exclusions if database hasn't been populated yet
        logger.debug("Checking if library exclusions need to be preserved...")
        for server_config in [
            ("plex", "PlexLibstoExclude"),
            ("jellyfin", "JellyfinLibstoExclude"),
            ("emby", "EmbyLibstoExclude"),
        ]:
            server_type, exclusion_key = server_config
            try:
                db_result = server_libraries_db.get_media_server_libraries(server_type)
                has_db_libraries = len(db_result.get("libraries", [])) > 0

                if not has_db_libraries and current_flat.get(exclusion_key):
                    current_exclusions = current_flat.get(exclusion_key)
                    new_exclusions = data.config.get(exclusion_key, [])

                    if not new_exclusions and current_exclusions:
                        logger.info(f"Preserving {exclusion_key} from config.json (DB empty)")
                        data.config[exclusion_key] = current_exclusions
                    elif new_exclusions != current_exclusions:
                        logger.debug(f"{exclusion_key} changed by user")
                else:
                    if has_db_libraries:
                        logger.debug(f"Database has libraries for {server_type}, using value from update")
            except Exception as db_error:
                logger.warning(f"Could not check database for {server_type} libraries: {db_error}")
                if current_flat.get(exclusion_key):
                    data.config[exclusion_key] = current_flat.get(exclusion_key)

        # Detect and log changes
        changes_detected = []
        for key, new_value in data.config.items():
            old_value = current_flat.get(key)
            if old_value != new_value:
                if any(sensitive in key.lower() for sensitive in ["password", "token", "key", "api"]):
                    old_display = "***" if old_value else None
                    new_display = "***" if new_value else None
                else:
                    old_display = old_value
                    new_display = new_value

                changes_detected.append({"key": key, "old": old_display, "new": new_display})
                logger.info(f"CONFIG CHANGE: {key}")
                logger.info(f"  Old value: {old_display}")
                logger.info(f"  New value: {new_display}")

        if changes_detected:
            logger.info(f"Total changes detected: {len(changes_detected)}")
        else:
            logger.info("No changes detected in config")

        logger.info("Saving config changes to config.json...")

        if CONFIG_MAPPER_AVAILABLE:
            logger.debug("Transforming flat config back to grouped structure...")
            grouped_config = unflatten_config(data.config)
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(grouped_config, f, indent=2, ensure_ascii=False)
        else:
            logger.debug("Saving config as grouped structure (no mapper)...")
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(data.config, f, indent=2, ensure_ascii=False)

        # Update config database
        if CONFIG_DATABASE_AVAILABLE and config_db:
            try:
                logger.info("Syncing config changes to database...")
                config_db.import_from_json()
                logger.info("Config database synced successfully with config.json")
            except Exception as db_error:
                logger.warning(f"Could not sync config database: {db_error}")

        logger.info("=" * 60)
        return {
            "success": True,
            "message": "Config updated successfully",
            "changes_count": len(changes_detected),
        }
    except Exception as e:
        logger.error(f"Error updating config: {e}")
        logger.exception("Full traceback:")
        logger.info("=" * 60)
        raise HTTPException(status_code=500, detail="Internal server error")

# ============================================================================
# CUSTOM BLUEPRINTS ENDPOINTS
# ============================================================================

@app.get("/api/custom-blueprints")
async def get_custom_blueprints():
    """Get custom blueprints from the configuration database"""
    try:
        if not CONFIG_DATABASE_AVAILABLE or not config_db:
            return []

        blueprints_str = config_db.get_value("CustomBlueprints", "blueprints")
        if not blueprints_str:
            return []

        return json.loads(blueprints_str)
    except Exception as e:
        logger.error(f"Error reading custom blueprints: {e}")
        return []

@app.post("/api/custom-blueprints")
async def save_custom_blueprints(request: Request):
    """Save custom blueprints to the configuration database"""
    try:
        if not CONFIG_DATABASE_AVAILABLE or not config_db:
            raise HTTPException(status_code=500, detail="Database not available")

        data = await request.json()

        # Ensure it's a list
        if not isinstance(data, list):
            data = [data]

        success = config_db.set_value(
            "CustomBlueprints",
            "blueprints",
            json.dumps(data)
        )

        if success:
            return {"status": "success", "message": "Custom blueprints saved successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to save custom blueprints")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving custom blueprints: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

# ============================================================================
# CONFIG DATABASE ENDPOINTS
# ============================================================================


@app.get("/api/config-db/status")
async def get_config_db_status():
    """Get config database status and statistics"""
    try:
        if not CONFIG_DATABASE_AVAILABLE or not config_db:
            return {
                "success": False,
                "available": False,
                "message": "Config database not available",
            }

        # Call the new thread-safe method
        status_data = config_db.get_status()

        if "error" in status_data:
            raise Exception(status_data["error"])

        return {
            "success": True,
            "available": True,
            **status_data, # Unpack the safe data
        }
    except Exception as e:
        logger.error(f"Error getting config database status: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/api/config-db/section/{section}")
async def get_config_db_section(section: str):
    """Get all values from a specific config section"""
    try:
        if not CONFIG_DATABASE_AVAILABLE or not config_db:
            raise HTTPException(status_code=503, detail="Config database not available")

        section_data = config_db.get_section(section)

        return {"success": True, "section": section, "data": section_data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting config section: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/config-db/value/{section}/{key}")
async def get_config_db_value(section: str, key: str):
    """Get a specific config value"""
    try:
        if not CONFIG_DATABASE_AVAILABLE or not config_db:
            raise HTTPException(status_code=503, detail="Config database not available")

        value = config_db.get_value(section, key)

        if value is None:
            raise HTTPException(
                status_code=404, detail=f"Config value not found: {section}.{key}"
            )

        return {"success": True, "section": section, "key": key, "value": value}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting config value: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/config-db/sync")
async def sync_config_db():
    """Manually trigger sync from config.json to config database"""
    try:
        if not CONFIG_DATABASE_AVAILABLE or not config_db:
            raise HTTPException(status_code=503, detail="Config database not available")

        success = config_db.import_from_json()

        if success:
            return {
                "success": True,
                "message": "Config database synced successfully with config.json",
            }
        else:
            return {
                "success": False,
                "message": "Config database sync completed with warnings",
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error syncing config database: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/config-db/export")
async def export_config_db():
    """Export config database to JSON format"""
    try:
        if not CONFIG_DATABASE_AVAILABLE or not config_db:
            raise HTTPException(status_code=503, detail="Config database not available")

        config_data = config_db.export_to_json()

        return {"success": True, "config": config_data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error exporting config database: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ============================================================================
# OVERLAY FILES ENDPOINTS
# ============================================================================


# In backend/main.py

# 1. Update the list endpoint to include modification time (mtime)
@app.get("/api/overlayfiles")
async def get_overlay_files():
    """Get list of overlay files from Overlayfiles directory"""
    try:
        if not OVERLAYFILES_DIR.exists():
            OVERLAYFILES_DIR.mkdir(exist_ok=True)
            return {"success": True, "files": []}

        # Get all image and font files (png, jpg, jpeg, ttf, otf, woff, woff2)
        allowed_extensions = {
            ".png",
            ".jpg",
            ".jpeg",
            ".ttf",
            ".otf",
            ".woff",
            ".woff2",
        }
        files = []

        for f in OVERLAYFILES_DIR.iterdir():
            if f.is_file() and f.suffix.lower() in allowed_extensions:
                stat = f.stat()
                file_info = {
                    "name": f.name,
                    "type": (
                        "image"
                        if f.suffix.lower() in {".png", ".jpg", ".jpeg"}
                        else "font"
                    ),
                    "extension": f.suffix.lower(),
                    "size": stat.st_size,
                    "mtime": int(stat.st_mtime),
                }
                files.append(file_info)

        # Sort alphabetically by name
        files.sort(key=lambda x: x["name"])

        logger.info(f"Found {len(files)} overlay files")
        return {"success": True, "files": files}

    except Exception as e:
        logger.error(f"Error getting overlay files: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# 2. Update the preview endpoint to disable caching headers
@app.get("/api/overlayfiles/preview/{filename}")
async def preview_overlay_file(filename: str):
    """Serve overlay file for preview"""
    try:
        # Sanitize filename
        safe_filename = "".join(
            c for c in filename if c.isalnum() or c in "._- "
        ).strip()
        safe_filename = os.path.basename(safe_filename)

        if not safe_filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

        file_path = OVERLAYFILES_DIR / safe_filename

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found")

        # Serve file with NO CACHE headers so overwrites show immediately
        return FileResponse(
            file_path,
            media_type="image/png",  # Will auto-detect based on extension
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving overlay file: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/overlayfiles/upload")
async def upload_overlay_file(file: UploadFile = File(...)):
    """Upload a new overlay file to Overlayfiles directory"""
    logger.info("=" * 60)
    logger.info("OVERLAY FILE UPLOAD STARTED")
    logger.info(f"Filename: {file.filename}")
    logger.info(f"Content-Type: {file.content_type}")
    logger.debug(f"Target directory: {OVERLAYFILES_DIR}")

    try:
        # Ensure directory exists with permission check
        logger.debug("Checking directory existence and permissions...")
        try:
            OVERLAYFILES_DIR.mkdir(parents=True, exist_ok=True)
            logger.debug(f"Directory exists: {OVERLAYFILES_DIR.exists()}")
            # Test write permissions
            test_file = OVERLAYFILES_DIR / ".write_test"
            test_file.touch()
            test_file.unlink()
            logger.debug("Write permission check: OK")
        except PermissionError:
            logger.error(
                f"No write permission for Overlayfiles directory: {OVERLAYFILES_DIR}"
            )
            raise HTTPException(
                status_code=500,
                detail=f"No write permission for Overlayfiles directory. Check Docker/NAS/Unraid volume permissions.",
            )
        except Exception as e:
            logger.error(f"Error accessing Overlayfiles directory: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Cannot access Overlayfiles directory: {str(e)}",
            )

        # Validate file type - images and fonts
        logger.debug("Validating file type...")
        allowed_extensions = {
            ".png",
            ".jpg",
            ".jpeg",
            ".ttf",
            ".otf",
            ".woff",
            ".woff2",
        }
        file_ext = Path(file.filename).suffix.lower()
        logger.debug(f"File extension: {file_ext}")

        if file_ext not in allowed_extensions:
            logger.warning(f"Invalid file type rejected: {file_ext}")
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Only PNG, JPG, JPEG, TTF, OTF, WOFF, and WOFF2 files are allowed.",
            )

        # Sanitize filename (remove dangerous characters)
        logger.debug("Sanitizing filename...")
        safe_filename = "".join(
            c for c in file.filename if c.isalnum() or c in "._- "
        ).strip()
        safe_filename = os.path.basename(safe_filename)
        logger.debug(f"Sanitized filename: {safe_filename}")

        if not safe_filename:
            logger.error("Filename sanitization resulted in empty filename")
            raise HTTPException(status_code=400, detail="Invalid filename")

        # Save file
        file_path = OVERLAYFILES_DIR / safe_filename
        logger.debug(f"Target file path: {file_path}")

        # Check if file already exists
        if file_path.exists():
            logger.warning(f"File already exists: {safe_filename}")
            raise HTTPException(
                status_code=400,
                detail=f"File '{safe_filename}' already exists. Please rename or delete the existing file first.",
            )

        # Write file with better error handling
        logger.info("Writing file to disk...")
        try:
            content = await file.read()
            content_size = len(content)
            logger.info(f"File size: {content_size} bytes ({content_size/1024:.2f} KB)")

            if content_size == 0:
                logger.error("Uploaded file is empty")
                raise HTTPException(status_code=400, detail="Uploaded file is empty")

            with open(file_path, "wb") as f:
                f.write(content)

            # Verify file was written
            logger.debug("Verifying file was written correctly...")
            if not file_path.exists() or file_path.stat().st_size == 0:
                logger.error(
                    f"File verification failed - exists: {file_path.exists()}, size: {file_path.stat().st_size if file_path.exists() else 0}"
                )
                raise HTTPException(
                    status_code=500, detail="File was not saved successfully"
                )

            actual_size = file_path.stat().st_size
            logger.debug(
                f"File written successfully - size on disk: {actual_size} bytes"
            )

        except PermissionError as e:
            logger.error(f"Permission denied writing overlay file: {e}")
            logger.exception("Full traceback:")
            raise HTTPException(
                status_code=500,
                detail=f"Permission denied: Unable to write file. Check folder permissions on your system (Docker/NAS/Unraid).",
            )
        except OSError as e:
            logger.error(f"OS error writing overlay file: {e}")
            logger.exception("Full traceback:")
            raise HTTPException(
                status_code=500,
                detail=f"File system error: {str(e)}. Check disk space and permissions.",
            )

        logger.info(f"Uploaded overlay file: {safe_filename} ({content_size} bytes)")
        logger.info("=" * 60)

        return {
            "success": True,
            "message": f"File '{safe_filename}' uploaded successfully",
            "filename": safe_filename,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading overlay file: {e}")
        import traceback

        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Internal server error")


@app.delete("/api/overlayfiles/{filename}")
async def delete_overlay_file(filename: str):
    """Delete an overlay file from Overlayfiles directory"""
    try:
        # Sanitize filename
        safe_filename = "".join(
            c for c in filename if c.isalnum() or c in "._- "
        ).strip()
        safe_filename = os.path.basename(safe_filename)

        if not safe_filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

        file_path = OVERLAYFILES_DIR / safe_filename

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found")

        # Check if file is in use in config
        # TODO: Optional - check if file is referenced in config and warn user

        # Delete file
        file_path.unlink()

        logger.info(f"Deleted overlay file: {safe_filename}")

        return {
            "success": True,
            "message": f"File '{safe_filename}' deleted successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting overlay file: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")



# ============================================================================
# FONT FILES ENDPOINTS
# ============================================================================


@app.get("/api/fonts")
async def get_font_files():
    """Get list of font files from Overlayfiles directory"""
    try:
        if not OVERLAYFILES_DIR.exists():
            OVERLAYFILES_DIR.mkdir(exist_ok=True)
            return {"success": True, "files": []}

        # Get all font files (ttf, otf, woff, woff2)
        font_extensions = {".ttf", ".otf", ".woff", ".woff2"}
        files = [
            f.name
            for f in OVERLAYFILES_DIR.iterdir()
            if f.is_file() and f.suffix.lower() in font_extensions
        ]

        # Sort alphabetically
        files.sort()

        logger.info(f"Found {len(files)} font files")
        return {"success": True, "files": files}

    except Exception as e:
        logger.error(f"Error getting font files: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/fonts/upload")
async def upload_font_file(file: UploadFile = File(...)):
    """Upload a new font file to Overlayfiles directory"""
    try:
        # Ensure directory exists with permission check
        try:
            OVERLAYFILES_DIR.mkdir(parents=True, exist_ok=True)
            # Test write permissions
            test_file = OVERLAYFILES_DIR / ".write_test"
            test_file.touch()
            test_file.unlink()
        except PermissionError:
            logger.error(
                f"No write permission for Overlayfiles directory: {OVERLAYFILES_DIR}"
            )
            raise HTTPException(
                status_code=500,
                detail=f"No write permission for Overlayfiles directory. Check Docker/NAS/Unraid volume permissions.",
            )
        except Exception as e:
            logger.error(f"Error accessing Overlayfiles directory: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Cannot access Overlayfiles directory: {str(e)}",
            )

        # Validate file type
        allowed_extensions = {".ttf", ".otf", ".woff", ".woff2"}
        file_ext = Path(file.filename).suffix.lower()

        if file_ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Only TTF, OTF, WOFF, and WOFF2 files are allowed.",
            )

        # Sanitize filename (remove dangerous characters)
        safe_filename = "".join(
            c for c in file.filename if c.isalnum() or c in "._- "
        ).strip()

        if not safe_filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

        # Save file
        file_path = OVERLAYFILES_DIR / safe_filename

        # Check if file already exists
        if file_path.exists():
            raise HTTPException(
                status_code=400,
                detail=f"File '{safe_filename}' already exists. Please rename or delete the existing file first.",
            )

        # Write file with better error handling
        try:
            content = await file.read()
            if len(content) == 0:
                raise HTTPException(status_code=400, detail="Uploaded file is empty")

            with open(file_path, "wb") as f:
                f.write(content)

            # Verify file was written
            if not file_path.exists() or file_path.stat().st_size == 0:
                raise HTTPException(
                    status_code=500, detail="File was not saved successfully"
                )

        except PermissionError as e:
            logger.error(f"Permission denied writing font file: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Permission denied: Unable to write file. Check folder permissions on your system (Docker/NAS/Unraid).",
            )
        except OSError as e:
            logger.error(f"OS error writing font file: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"File system error: {str(e)}. Check disk space and permissions.",
            )

        logger.info(f"Uploaded font file: {safe_filename} ({len(content)} bytes)")

        return {
            "success": True,
            "message": f"Font '{safe_filename}' uploaded successfully",
            "filename": safe_filename,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading font file: {e}")
        import traceback

        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Internal server error")


@app.delete("/api/fonts/{filename}")
async def delete_font_file(filename: str):
    """Delete a font file from Overlayfiles directory"""
    try:
        import os
        # Sanitize filename
        safe_filename = "".join(
            c for c in filename if c.isalnum() or c in "._- "
        ).strip()
        safe_filename = os.path.basename(safe_filename)

        if not safe_filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

        file_path = (OVERLAYFILES_DIR / safe_filename).resolve()

        # Guard against path traversal: resolved path must stay within OVERLAYFILES_DIR
        if not file_path.is_relative_to(OVERLAYFILES_DIR.resolve()):
            raise HTTPException(status_code=400, detail="Invalid filename")

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found")

        # Delete file
        file_path.unlink()

        logger.info(f"Deleted font file: {safe_filename}")

        return {
            "success": True,
            "message": f"Font '{safe_filename}' deleted successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting font file: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/fonts/download/{filename}")
async def download_font_file(filename: str):
    """Download a font file from Overlayfiles directory for previewing in the UI"""
    try:
        import os
        safe_filename = "".join(c for c in filename if c.isalnum() or c in "._- ")
        safe_filename = os.path.basename(safe_filename)
        if not safe_filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

        font_path = (OVERLAYFILES_DIR / safe_filename).resolve()

        # Guard against path traversal: resolved path must stay within OVERLAYFILES_DIR
        if not font_path.is_relative_to(OVERLAYFILES_DIR.resolve()):
            raise HTTPException(status_code=400, detail="Invalid filename")

        if not font_path.exists():
            raise HTTPException(status_code=404, detail="Font file not found")

        return FileResponse(font_path)
    except Exception as e:
        logger.error(f"Error downloading font: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/fonts/preview/{filename}")
async def preview_font_file(filename: str, text: str = "Aa"):
    """Generate a preview image for a font file"""
    try:
        import os
        # Sanitize filename
        safe_filename = "".join(
            c for c in filename if c.isalnum() or c in "._- "
        ).strip()
        safe_filename = os.path.basename(safe_filename)

        if not safe_filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

        font_path = (OVERLAYFILES_DIR / safe_filename).resolve()

        # Guard against path traversal: resolved path must stay within OVERLAYFILES_DIR
        if not font_path.is_relative_to(OVERLAYFILES_DIR.resolve()):
            raise HTTPException(status_code=400, detail="Invalid filename")

        if not font_path.exists():
            raise HTTPException(status_code=404, detail="Font file not found")

        # Validate font extension
        allowed_extensions = {".ttf", ".otf", ".woff", ".woff2"}
        if font_path.suffix.lower() not in allowed_extensions:
            raise HTTPException(status_code=400, detail="Not a valid font file")

        # Sanitize preview text
        safe_text = "".join(c for c in text if c.isprintable())[:100] or "Aa"

        # Create font preview image with unique name based on content
        import hashlib

        cache_key = hashlib.md5(f"{safe_filename}_{safe_text}".encode()).hexdigest()
        font_preview = FONTPREVIEWS_DIR / f"font_preview_{cache_key}.png"

        # Return cached preview if it exists and is recent
        if font_preview.exists():
            return FileResponse(
                font_preview,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=3600"},
            )

        try:
            # Try using PIL/Pillow for font rendering (more reliable than ImageMagick for custom fonts)
            from PIL import Image, ImageDraw, ImageFont

            logger.info(f"Generating font preview for: {safe_filename}")
            logger.info(f"Font path: {str(font_path)}")
            logger.info(f"Font path exists: {font_path.exists()}")
            logger.info(f"Text: {safe_text}")

            # Adjust image size and font size based on text length
            text_length = len(safe_text)
            if text_length <= 6:
                # Short text (like "AaBbCc") - larger font, smaller canvas
                img_width, img_height = 400, 200
                font_size = 48
            elif text_length <= 20:
                # Medium text (like "The Quick Brown Fox")
                img_width, img_height = 600, 150
                font_size = 36
            else:
                # Long text (like full alphabet)
                img_width, img_height = 800, 150
                font_size = 32

            # Create image with better quality
            img = Image.new("RGB", (img_width, img_height), color=(42, 42, 42))
            draw = ImageDraw.Draw(img)

            # Load font - must succeed or raise error
            try:
                font = ImageFont.truetype(str(font_path.absolute()), font_size)
                logger.info(
                    f"Font loaded successfully: {font.getname() if hasattr(font, 'getname') else 'Unknown'}"
                )
            except OSError as e:
                logger.error(f"OSError loading font: {e}")
                raise HTTPException(
                    status_code=500, detail=f"Cannot load font file: {e}"
                )
            except Exception as e:
                logger.error(f"Error loading font: {e}")
                raise HTTPException(status_code=500, detail=f"Error loading font: {e}")

            # Calculate text position for centering
            bbox = draw.textbbox((0, 0), safe_text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            x = (img_width - text_width) // 2
            y = (img_height - text_height) // 2 - bbox[1]  # Adjust for baseline

            # Draw text
            draw.text((x, y), safe_text, font=font, fill="white")

            # Save image
            img.save(font_preview, "PNG")

            logger.info(f"Font preview generated successfully: {font_preview}")

            return FileResponse(
                font_preview,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=3600"},
            )

        except ImportError:
            # Pillow not available, fall back to ImageMagick with different approach
            logger.warning("Pillow not available, using ImageMagick fallback")

            # Find magick executable
            if IS_DOCKER:
                magick_cmd = "magick"
            else:
                magick_exe = APP_DIR / "magick" / "magick.exe"
                if magick_exe.exists():
                    magick_cmd = str(magick_exe)
                else:
                    magick_cmd = "magick"

            absolute_output_path = str(font_preview.absolute()).replace("\\", "/")

            # Try copying font to a temp location that ImageMagick might handle better
            import shutil

            temp_font = TEMP_DIR / f"temp_{safe_filename}"
            shutil.copy2(font_path, temp_font)
            temp_font_path = str(temp_font.absolute()).replace("\\", "/")

            logger.info(f"Using temporary font copy: {temp_font_path}")

            # Prevent ImageMagick from interpreting leading '@' as a file reference
            magick_text = safe_text
            if magick_text.startswith("@"):
                magick_text = "\\" + magick_text

            # Generate preview using ImageMagick with temp font copy
            cmd = [
                magick_cmd,
                "-background",
                "#2A2A2A",
                "-fill",
                "white",
                "-font",
                temp_font_path,
                "-pointsize",
                "48",
                "-size",
                "400x200",
                "-gravity",
                "center",
                f"label:{magick_text}",
                absolute_output_path,
            ]

            logger.info(f"ImageMagick command: {shlex.join(cmd)}")

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

            # Clean up temp font
            if temp_font.exists():
                try:
                    temp_font.unlink()
                except:
                    pass

            if result.returncode != 0:
                logger.error(f"ImageMagick error: {result.stderr}")
                logger.error(f"ImageMagick stdout: {result.stdout}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to generate font preview: {result.stderr}",
                )

            if not font_preview.exists():
                raise HTTPException(
                    status_code=500,
                    detail="Preview image was not created",
                )

            return FileResponse(
                font_preview,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=3600"},
            )

        except subprocess.TimeoutExpired:
            logger.error("Font preview generation timed out")
            raise HTTPException(
                status_code=500, detail="Font preview generation timed out"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating font preview: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ============================================================================
# VALIDATION ENDPOINTS
# ============================================================================


@app.post("/api/validate/plex")
async def validate_plex(request: PlexValidationRequest):
    """Validate Plex connection"""
    logger.info("=" * 60)
    logger.info("PLEX VALIDATION STARTED")
    logger.info(f"[URL] URL: {request.url}")
    logger.info(
        f"[KEY] Token: {mask_secret(request.token)}"
    )


    if not is_safe_url(request.url, allow_private=True):
        logger.warning(f"SSRF attempt blocked for Plex URL: {request.url[:20]}...")
        raise HTTPException(status_code=400, detail="Invalid or unsafe Plex URL")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Use params for safe token passing instead of f-string URL building
            base_url = f"{request.url.rstrip('/')}/library/sections/"
            params = {"X-Plex-Token": request.token}

            logger.info(f"[REQUEST] Sending request to Plex API...")
            logger.debug(f"Target URL: {base_url}")

            response = await client.get(base_url, params=params)
            logger.info(f"Response received - Status: {response.status_code}")
            logger.debug(f"Response headers: {dict(response.headers)}")
            logger.debug(f"Response size: {len(response.content)} bytes")

            if response.status_code == 200:
                # Parse XML to check for libraries
                root = fromstring(response.content)
                lib_count = int(root.get("size", 0))
                server_name = root.get("friendlyName", "Unknown")

                logger.debug(f"Parsed XML root attributes: {root.attrib}")
                logger.info(f"Plex validation successful!")
                logger.info(f"   Server: {server_name}")
                logger.info(f"   Libraries: {lib_count}")
                logger.info("=" * 60)

                return {
                    "valid": True,
                    "message": f"Plex connection successful! Found {lib_count} libraries.",
                    "details": {"library_count": lib_count, "server_name": server_name},
                }
            elif response.status_code == 401:
                logger.warning(f"[FAILED]Plex validation failed: Invalid token (401)")
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": "Invalid Plex token. Please check your token.",
                    "details": {"status_code": 401},
                }
            else:
                logger.warning(f"Plex validation failed: Status {response.status_code}")
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": f"Plex connection failed (Status: {response.status_code})",
                    "details": {"status_code": response.status_code},
                }
    except httpx.TimeoutException:
        logger.error(f"[TIMEOUT]  Plex validation timeout - URL unreachable")
        logger.info("=" * 60)
        return {
            "valid": False,
            "message": "Connection timeout. Check if Plex URL is correct and server is reachable.",
            "details": {"error": "timeout"},
        }
    except Exception as e:
        logger.error(f"[ERROR] Plex validation error: {str(e)}")
        logger.exception("Full traceback:")
        logger.info("=" * 60)
        return {
            "valid": False,
            "message": f"Error connecting to Plex: {str(e)}",
            "details": {"error": str(e)},
        }


@app.post("/api/validate/jellyfin")
async def validate_jellyfin(request: JellyfinValidationRequest):
    """Validate Jellyfin connection"""
    logger.info("=" * 60)
    logger.info("JELLYFIN VALIDATION STARTED")
    logger.info(f"[URL] URL: {request.url}")
    logger.info(
        f"[KEY] API Key: {mask_secret(request.api_key)}"
    )


    if not is_safe_url(request.url, allow_private=True):
        logger.warning(f"SSRF attempt blocked for Jellyfin URL: {request.url[:20]}...")
        raise HTTPException(status_code=400, detail="Invalid or unsafe Jellyfin URL")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            base_url = f"{request.url.rstrip('/')}/System/Info"
            headers = {"Authorization": f'MediaBrowser Token="{request.api_key}"'}
            logger.info(f"[REQUEST] Sending request to Jellyfin API...")
            logger.debug(f"Target URL: {base_url}")

            response = await client.get(base_url, headers=headers)
            logger.info(f"Response received - Status: {response.status_code}")
            logger.debug(f"Response headers: {dict(response.headers)}")
            logger.debug(f"Response size: {len(response.content)} bytes")

            if response.status_code == 200:
                data = response.json()
                logger.debug(f"Response JSON keys: {list(data.keys())}")
                version = data.get("Version", "Unknown")
                server_name = data.get("ServerName", "Unknown")

                logger.info(f"Jellyfin validation successful!")
                logger.info(f"   Server: {server_name}")
                logger.info(f"   Version: {version}")
                logger.info("=" * 60)

                return {
                    "valid": True,
                    "message": f" Jellyfin connection successful! Version: {version}",
                    "details": {"version": version, "server_name": server_name},
                }
            elif response.status_code == 401:
                logger.warning(f"Jellyfin validation failed: Invalid API key (401)")
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": " Invalid Jellyfin API key. Please check your API key.",
                    "details": {"status_code": 401},
                }
            else:
                logger.warning(
                    f"Jellyfin validation failed: Status {response.status_code}"
                )
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": f" Jellyfin connection failed (Status: {response.status_code})",
                    "details": {"status_code": response.status_code},
                }
    except httpx.TimeoutException:
        logger.error(f"[TIMEOUT]  Jellyfin validation timeout - URL unreachable")
        logger.info("=" * 60)
        return {
            "valid": False,
            "message": " Connection timeout. Check if Jellyfin URL is correct and server is reachable.",
            "details": {"error": "timeout"},
        }
    except Exception as e:
        logger.error(f"[ERROR] Jellyfin validation error: {str(e)}")
        logger.exception("Full traceback:")
        logger.info("=" * 60)
        return {
            "valid": False,
            "message": f" Error connecting to Jellyfin: {str(e)}",
            "details": {"error": str(e)},
        }


@app.post("/api/validate/emby")
async def validate_emby(request: EmbyValidationRequest):
    """Validate Emby connection"""
    logger.info("=" * 60)
    logger.info("EMBY VALIDATION STARTED")
    logger.info(f"[URL] URL: {request.url}")
    logger.info(
        f"[KEY] API Key: {mask_secret(request.api_key)}"
    )


    if not is_safe_url(request.url, allow_private=True):
        logger.warning(f"SSRF attempt blocked for Emby URL: {request.url[:20]}...")
        raise HTTPException(status_code=400, detail="Invalid or unsafe Emby URL")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            base_url = f"{request.url.rstrip('/')}/System/Info"
            headers = {"Authorization": f'MediaBrowser Token="{request.api_key}"'}
            logger.info(f"[REQUEST] Sending request to Emby API...")
            logger.debug(f"Target URL: {base_url}")

            response = await client.get(base_url, headers=headers)
            logger.info(f"Response received - Status: {response.status_code}")
            logger.debug(f"Response headers: {dict(response.headers)}")
            logger.debug(f"Response size: {len(response.content)} bytes")

            if response.status_code == 200:
                data = response.json()
                logger.debug(f"Response JSON keys: {list(data.keys())}")
                version = data.get("Version", "Unknown")
                server_name = data.get("ServerName", "Unknown")

                logger.info(f"Emby validation successful!")
                logger.info(f"   Server: {server_name}")
                logger.info(f"   Version: {version}")
                logger.info("=" * 60)

                return {
                    "valid": True,
                    "message": f" Emby connection successful! Version: {version}",
                    "details": {"version": version, "server_name": server_name},
                }
            elif response.status_code == 401:
                logger.warning(f"Emby validation failed: Invalid API key (401)")
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": " Invalid Emby API key. Please check your API key.",
                    "details": {"status_code": 401},
                }
            else:
                logger.warning(f"Emby validation failed: Status {response.status_code}")
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": f" Emby connection failed (Status: {response.status_code})",
                    "details": {"status_code": response.status_code},
                }
    except httpx.TimeoutException:
        logger.error(f"[TIMEOUT]  Emby validation timeout - URL unreachable")
        logger.info("=" * 60)
        return {
            "valid": False,
            "message": " Connection timeout. Check if Emby URL is correct and server is reachable.",
            "details": {"error": "timeout"},
        }
    except Exception as e:
        logger.error(f"[ERROR] Emby validation error: {str(e)}")
        logger.exception("Full traceback:")
        logger.info("=" * 60)
        return {
            "valid": False,
            "message": "Error connecting to Emby. Please check your configuration and logs.",
            "details": {"status": "error"},
        }


@app.post("/api/validate/tmdb")
async def validate_tmdb(request: TMDBValidationRequest):
    """Validate TMDB API token"""
    logger.info("=" * 60)
    logger.info("TMDB VALIDATION STARTED")
    logger.info(
        f"[KEY] Token: {mask_secret(request.token)}"
    )


    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {
                "Authorization": f"Bearer {request.token}",
                "Content-Type": "application/json",
            }
            logger.info(f"[REQUEST] Sending request to TMDB API...")
            logger.debug(
                f"Request headers (without token): Content-Type=application/json"
            )

            response = await client.get(
                "https://api.themoviedb.org/3/configuration", headers=headers
            )
            logger.info(f"Response received - Status: {response.status_code}")
            logger.debug(f"Response size: {len(response.content)} bytes")

            if response.status_code == 200:
                logger.info(f"TMDB validation successful!")
                logger.info("=" * 60)
                return {
                    "valid": True,
                    "message": " TMDB API token is valid!",
                    "details": {"status_code": 200},
                }
            elif response.status_code == 401:
                logger.warning(f"TMDB validation failed: Invalid token (401)")
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": " Invalid TMDB token. Please check your Read Access Token.",
                    "details": {"status_code": 401},
                }
            else:
                logger.warning(f"TMDB validation failed: Status {response.status_code}")
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": f" TMDB validation failed (Status: {response.status_code})",
                    "details": {"status_code": response.status_code},
                }
    except Exception as e:
        logger.error(f"[ERROR] TMDB validation error: {str(e)}")
        logger.exception("Full traceback:")
        logger.info("=" * 60)
        return {
            "valid": False,
            "message": f" Error validating TMDB token: {str(e)}",
            "details": {"error": str(e)},
        }


@app.post("/api/validate/tvdb")
async def validate_tvdb(request: TVDBValidationRequest):
    """Validate TVDB API key - with login flow"""
    logger.info("=" * 60)
    logger.info("TVDB VALIDATION STARTED")
    logger.info(
        f"[KEY] API Key: {mask_secret(request.api_key)}"
    )
    if request.pin:
        logger.info(f" PIN provided: {'*' * len(request.pin) if request.pin else 'None'}")


    max_retries = 6
    retry_count = 0
    success = False
    logger.debug(f"TVDB validation configured with max_retries={max_retries}")

    while not success and retry_count < max_retries:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                login_url = "https://api4.thetvdb.com/v4/login"
                logger.debug(f"TVDB API endpoint: {login_url}")

                # Request body with or without PIN
                if request.pin:
                    body = {"apikey": request.api_key, "pin": request.pin}
                    logger.info(
                        f"[REQUEST] Attempting TVDB login with API Key + PIN (Attempt {retry_count + 1}/{max_retries})..."
                    )
                    logger.debug(
                        f"Request body includes: apikey (hidden), pin={'*' * len(request.pin) if request.pin else 'None'}"
                    )
                else:
                    body = {"apikey": request.api_key}
                    logger.info(
                        f"[REQUEST] Attempting TVDB login with API Key only (Attempt {retry_count + 1}/{max_retries})..."
                    )
                    logger.debug(f"Request body includes: apikey (hidden) only")

                headers = {
                    "accept": "application/json",
                    "Content-Type": "application/json",
                }

                # POST-Request zum Login
                login_response = await client.post(
                    login_url, json=body, headers=headers
                )

                logger.info(
                    f"Login response received - Status: {login_response.status_code}"
                )

                if login_response.status_code == 200:
                    data = login_response.json()
                    token = data.get("data", {}).get("token")

                    if token:
                        success = True
                        pin_msg = " (with PIN: ****)" if request.pin else ""
                        logger.info(
                            f"[TOKEN]  Successfully received TVDB token: {mask_secret(token)}"
                        )
                        logger.info(f"TVDB validation successful!{pin_msg}")
                        logger.info(f"   Token is valid and working")
                        logger.info("=" * 60)

                        return {
                            "valid": True,
                            "message": f"TVDB API key is valid{pin_msg}!",
                            "details": {
                                "status_code": 200,
                                "has_pin": bool(request.pin),
                                "token_received": True,
                            },
                        }
                    else:
                        logger.warning(f" No token in response data")
                        retry_count += 1
                        if retry_count < max_retries:
                            logger.info(f"[WAIT] Waiting 10 seconds before retry...")
                            await asyncio.sleep(10)

                elif login_response.status_code == 401:
                    logger.warning(f"TVDB login failed: Invalid API key (401)")
                    logger.warning(
                        f"   You may be using a legacy API key. Please use a 'Project API Key'"
                    )
                    logger.info("=" * 60)
                    return {
                        "valid": False,
                        "message": "Invalid TVDB API key. Please use a 'Project API Key' (not legacy key).",
                        "details": {"status_code": 401, "legacy_key_hint": True},
                    }

                else:
                    logger.warning(
                        f"TVDB login failed: Status {login_response.status_code}"
                    )
                    retry_count += 1
                    if retry_count < max_retries:
                        logger.info(f"[WAIT] Waiting 10 seconds before retry...")
                        await asyncio.sleep(10)

        except httpx.TimeoutException:
            logger.warning(
                f"[TIMEOUT]  TVDB login timeout (Attempt {retry_count + 1}/{max_retries})"
            )
            retry_count += 1
            if retry_count < max_retries:
                logger.info(f"[WAIT] Waiting 10 seconds before retry...")
                await asyncio.sleep(10)

        except Exception as e:
            logger.error(f"[ERROR] TVDB validation error: {str(e)}")
            logger.exception("Full traceback:")
            retry_count += 1
            if retry_count < max_retries:
                logger.info(f"[WAIT] Waiting 10 seconds before retry...")
                await asyncio.sleep(10)

    # If all retries failed
    if not success:
        logger.error(f"TVDB validation failed after {max_retries} attempts")
        logger.error(
            f"   You may be using a legacy API key. Please use a 'Project API Key'"
        )
        logger.info("=" * 60)
        return {
            "valid": False,
            "message": f"Could not validate TVDB API key after {max_retries} attempts. You may be using a legacy API key - please use a 'Project API Key'.",
            "details": {"attempts": max_retries, "legacy_key_hint": True},
        }


@app.post("/api/validate/fanart")
async def validate_fanart(request: FanartValidationRequest):
    """Validate Fanart.tv API key"""
    logger.info("=" * 60)
    logger.info("FANART.TV VALIDATION STARTED")
    logger.info(
        f"[KEY] API Key: {mask_secret(request.api_key)}"
    )

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            test_url = (
                f"https://webservice.fanart.tv/v3/movies/603?api_key={request.api_key}"
            )
            logger.info(
                f"[REQUEST] Sending test request to Fanart.tv API (Movie ID: 603 - The Matrix)..."
            )

            response = await client.get(test_url)
            logger.info(f"Response received - Status: {response.status_code}")

            if response.status_code == 200:
                logger.info(f"Fanart.tv validation successful!")
                logger.info("=" * 60)
                return {
                    "valid": True,
                    "message": " Fanart.tv API key is valid!",
                    "details": {"status_code": 200},
                }
            elif response.status_code == 401:
                logger.warning(f"Fanart.tv validation failed: Invalid API key (401)")
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": " Invalid Fanart.tv API key. Please check your Personal API key.",
                    "details": {"status_code": 401},
                }
            else:
                logger.warning(
                    f"Fanart.tv validation failed: Status {response.status_code}"
                )
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": f" Fanart.tv validation failed (Status: {response.status_code})",
                    "details": {"status_code": response.status_code},
                }
    except Exception as e:
        logger.error(f"[ERROR] Fanart.tv validation error: {str(e)}")
        logger.exception("Full traceback:")
        logger.info("=" * 60)
        return {
            "valid": False,
            "message": f" Error validating Fanart.tv key: {str(e)}",
            "details": {"error": str(e)},
        }


@app.post("/api/validate/discord")
async def validate_discord(request: DiscordValidationRequest):
    """Validate Discord webhook"""
    logger.info("=" * 60)
    logger.info("DISCORD WEBHOOK VALIDATION STARTED")
    logger.info(f"[URL] Webhook URL: {request.webhook_url[:50]}...")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            payload = {
                "content": "[SUCCESS] Posterizarr WebUI - Discord webhook validation successful!",
                "username": "Posterizarr",
            }
            if not is_safe_url(request.webhook_url):
                logger.warning(f"SSRF attempt blocked for Discord webhook: {request.webhook_url[:20]}...")
                raise HTTPException(status_code=400, detail="Invalid or unsafe webhook URL")

            response = await client.post(request.webhook_url, json=payload)
            logger.info(f"Response received - Status: {response.status_code}")

            if response.status_code == 204:
                logger.info(
                    f"Discord webhook validation successful! Test message sent."
                )
                logger.info("=" * 60)
                return {
                    "valid": True,
                    "message": " Discord webhook is valid! Test message sent.",
                    "details": {"status_code": 204},
                }
            elif response.status_code == 404:
                logger.warning(
                    f"Discord webhook validation failed: Webhook not found (404)"
                )
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": " Discord webhook not found. Please check your webhook URL.",
                    "details": {"status_code": 404},
                }
            else:
                logger.warning(
                    f"Discord webhook validation failed: Status {response.status_code}"
                )
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": f" Discord webhook validation failed (Status: {response.status_code})",
                    "details": {"status_code": response.status_code},
                }
    except Exception as e:
        logger.error(f"[ERROR] Discord webhook validation error: {str(e)}")
        logger.exception("Full traceback:")
        logger.info("=" * 60)
        return {
            "valid": False,
            "message": f" Error validating Discord webhook: {str(e)}",
            "details": {"error": str(e)},
        }


@app.post("/api/validate/apprise")
async def validate_apprise(request: AppriseValidationRequest):
    """Validate Apprise URL dynamically and send a test message"""
    logger.info("=" * 60)
    logger.info("APPRISE VALIDATION & TEST MESSAGE STARTED")
    logger.info(f"[URL] URL: {request.url[:20]}...")

    if not is_safe_url(request.url, allow_private=True, allow_apprise_schemes=True):
        logger.warning(f"SSRF attempt blocked for Apprise URL: {request.url[:20]}...")
        raise HTTPException(status_code=400, detail="Invalid or unsafe Apprise URL")

    try:
        # Local import to prevent startup crashes if library is missing
        import apprise

        apobj = apprise.Apprise()

        # Dynamically validate the protocol (supports ntfys://, discord://, etc.)
        if not apobj.add(request.url):
            logger.warning(f"Apprise URL rejected (Unsupported or Invalid): {request.url}")
            return {
                "valid": False,
                "message": "Invalid Apprise URL or unsupported protocol.",
                "details": {"format_check": False},
            }

        # Send the Test Notification
        logger.info("Sending test notification...")
        test_success = apobj.notify(
            body="[SUCCESS] Posterizarr WebUI - Apprise notification validation successful!",
            title="Posterizarr Test Message",
        )

        if test_success:
            detected_service = request.url.split('://')[0]
            logger.info(f"Apprise validation successful! Service: {detected_service}")
            return {
                "valid": True,
                "message": f"Success! {detected_service.upper()} URL is valid and test message sent.",
                "details": {"service": detected_service, "notification_sent": True},
            }
        else:
            return {
                "valid": False,
                "message": "URL format is valid, but the test message failed to send. Check your credentials.",
                "details": {"format_check": True, "notification_sent": False},
            }

    except ImportError:
        logger.error("Apprise library not found. Please install it with 'pip install apprise'")
        return {
            "valid": False,
            "message": "Apprise library is not installed on the server.",
            "details": {"error": "ImportError"},
        }
    except Exception as e:
        logger.error(f"[ERROR] Apprise validation error: {str(e)}")
        return {
            "valid": False,
            "message": f"Error validating Apprise: {str(e)}",
            "details": {"error": str(e)},
        }

@app.post("/api/validate/uptimekuma")
async def validate_uptimekuma(request: UptimeKumaValidationRequest):
    """Validate Uptime Kuma push URL"""
    logger.info("=" * 60)
    logger.info("UPTIME KUMA VALIDATION STARTED")
    logger.info(f"[URL] Push URL: {request.url[:50]}...")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if not is_safe_url(request.url):
                logger.warning(f"SSRF attempt blocked for Uptime Kuma: {request.url[:20]}...")
                raise HTTPException(status_code=400, detail="Invalid or unsafe URL")

            response = await client.get(
                request.url,
                params={
                    "status": "up",
                    "msg": "Posterizarr WebUI validation test",
                    "ping": "",
                },
            )
            logger.info(f"Response received - Status: {response.status_code}")

            if response.status_code == 200:
                data = response.json()
                logger.info(f"   Response data: {data}")

                if data.get("ok"):
                    logger.info(f"Uptime Kuma validation successful! Test ping sent.")
                    logger.info("=" * 60)
                    return {
                        "valid": True,
                        "message": " Uptime Kuma push URL is valid!",
                        "details": {"status_code": 200},
                    }
                else:
                    logger.warning(f"Uptime Kuma responded but 'ok' was false")
                    logger.info("=" * 60)
                    return {
                        "valid": False,
                        "message": " Uptime Kuma responded but validation failed.",
                        "details": {"response": data},
                    }
            else:
                logger.warning(
                    f"Uptime Kuma validation failed: Status {response.status_code}"
                )
                logger.info("=" * 60)
                return {
                    "valid": False,
                    "message": f" Uptime Kuma validation failed (Status: {response.status_code})",
                    "details": {"status_code": response.status_code},
                }
    except Exception as e:
        logger.error(f"[ERROR] Uptime Kuma validation error: {str(e)}")
        logger.exception("Full traceback:")
        logger.info("=" * 60)
        return {
            "valid": False,
            "message": f" Error validating Uptime Kuma URL: {str(e)}",
            "details": {"error": str(e)},
        }


# ============================================================================
# PLEX ACTIONS ENDPOINT
# ============================================================================

class PlexActionRequest(BaseModel):
    action: str  # "refresh_item", "analyze_item", "scan_library"
    rating_key: Optional[str] = None
    library_name: Optional[str] = None

@app.post("/api/plex/action")
async def perform_plex_action(request: PlexActionRequest):
    """
    Perform actions on Plex Media Server (Refresh, Analyze, Scan, Empty Trash)
    """
    logger.info(f"Plex Action Request: {request.action} for key={request.rating_key}, lib={request.library_name}")

    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=404, detail="Config file not found")

    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)

        # Robust Config Loading
        # 1. Try Root level (Flat structure)
        plex_url = config.get("PlexUrl")
        plex_token = config.get("PlexToken")

        # 2. Try ApiPart (PlexToken is defined here in config_mapper.py)
        if not plex_token:
            api_part = config.get("ApiPart")
            if isinstance(api_part, dict):
                plex_token = api_part.get("PlexToken")

        # 3. Try PlexPart (PlexUrl is defined here, Token might be here in older configs)
        if not plex_url or not plex_token:
            plex_part = config.get("PlexPart")
            if isinstance(plex_part, dict):
                if not plex_url:
                    plex_url = plex_part.get("PlexUrl")
                if not plex_token:
                    plex_token = plex_part.get("PlexToken")


        if not plex_url or not plex_token:
            # Log what we found to help debug if it still fails
            logger.error(f"Config Check Failed - URL found: {bool(plex_url)}, Token found: {bool(plex_token)}")
            raise HTTPException(status_code=400, detail="Plex URL or Token not configured")

        plex_url = plex_url.rstrip("/")

    except Exception as e:
        logger.error(f"Error loading Plex config: {e}", exc_info=True)
        # Only return detailed error if it wasn't the HTTPException raised above
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail="Internal server error while loading Plex configuration")

    async with httpx.AsyncClient(timeout=10.0) as client:
        headers = {"X-Plex-Token": plex_token, "Accept": "application/json"}

        try:
            # ACTION: Refresh Metadata (Item Level)
            if request.action == "refresh_item":
                if not request.rating_key:
                    raise HTTPException(status_code=400, detail="Rating Key required")

                url = f"{plex_url}/library/metadata/{request.rating_key}/refresh"
                response = await client.put(url, headers=headers)

                if response.status_code == 200:
                    return {"success": True, "message": f"Refreshed metadata for item {request.rating_key}"}

            # ACTION: Analyze Item
            elif request.action == "analyze_item":
                if not request.rating_key:
                    raise HTTPException(status_code=400, detail="Rating Key required")

                url = f"{plex_url}/library/metadata/{request.rating_key}/analyze"
                response = await client.put(url, headers=headers)

                if response.status_code == 200:
                    return {"success": True, "message": f"Started analysis for item {request.rating_key}"}

            # ACTIONS: Library Level (Scan & Empty Trash)
            elif request.action in ["scan_library", "empty_trash"]:
                if not request.library_name:
                    raise HTTPException(status_code=400, detail="Library Name required")

                # Find the section ID for this library name
                sections_url = f"{plex_url}/library/sections"
                sections_resp = await client.get(sections_url, headers=headers)

                if sections_resp.status_code != 200:
                    raise HTTPException(status_code=500, detail="Failed to fetch Plex libraries")

                data = sections_resp.json()
                section_id = None

                # Check nested structure for directory list
                directories = data.get("MediaContainer", {}).get("Directory", [])

                for directory in directories:
                    if directory.get("title") == request.library_name:
                        section_id = directory.get("key")
                        break

                if not section_id:
                    raise HTTPException(status_code=404, detail=f"Library '{request.library_name}' not found on Plex")

                if request.action == "scan_library":
                    # Trigger Scan: /library/sections/{id}/refresh
                    scan_url = f"{plex_url}/library/sections/{section_id}/refresh"
                    await client.get(scan_url, headers=headers)
                    return {"success": True, "message": f"Started scan for library '{request.library_name}'"}

                elif request.action == "empty_trash":
                    # Trigger Empty Trash: /library/sections/{id}/emptyTrash
                    trash_url = f"{plex_url}/library/sections/{section_id}/emptyTrash"
                    await client.put(trash_url, headers=headers)
                    return {"success": True, "message": f"Trash emptied for library '{request.library_name}'"}

            else:
                raise HTTPException(status_code=400, detail=f"Invalid action: {request.action}")

            # Generic error handler for non-200 responses
            if response.status_code != 200:
                logger.error(f"Plex API Error ({response.status_code}): {response.text}")
                raise HTTPException(status_code=response.status_code, detail=f"Plex API Error: {response.status_code}")

        except httpx.RequestError as e:
            logger.error(f"Plex Connection Error: {e}")
            raise HTTPException(status_code=502, detail="Failed to connect to Plex Server")

# ============================================================================
# JELLYFIN/EMBY ACTIONS ENDPOINT
# ============================================================================

class JellyfinEmbyActionRequest(BaseModel):
    action: str  # "refresh_item", "refresh_images"
    media_id: str

@app.post("/api/jellyfin-emby/action")
async def perform_jellyfin_emby_action(request: JellyfinEmbyActionRequest):
    """
    Perform actions on Jellyfin/Emby Server
    """
    logger.info(f"Jellyfin/Emby Action Request: {request.action} for id={request.media_id}")

    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=404, detail="Config file not found")

    # 1. Load Config & Determine Server
    server_url = None
    api_key = None
    server_type = None

    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)

        # Helper to check nested dicts safely
        def get_val(key, section_name):
            # 1. Try Root (Flat)
            val = config.get(key)
            # 2. Try Section (Grouped)
            if not val:
                val = config.get(section_name, {}).get(key)
            return val

        # Check enabled flags
        use_jellyfin = get_val("UseJellyfin", "JellyfinPart")
        use_emby = get_val("UseEmby", "EmbyPart")

        if use_jellyfin:
            server_type = "Jellyfin"
            server_url = get_val("JellyfinUrl", "JellyfinPart")

            #  API Key is in ApiPart, not JellyfinPart
            api_key = config.get("JellyfinAPIKey") # Flat
            if not api_key:
                api_key = config.get("ApiPart", {}).get("JellyfinAPIKey") # Correct Group
            if not api_key:
                api_key = config.get("JellyfinPart", {}).get("JellyfinAPIKey") # Legacy Group fallback

        elif use_emby:
            server_type = "Emby"
            server_url = get_val("EmbyUrl", "EmbyPart")

            #  API Key is in ApiPart, not EmbyPart
            api_key = config.get("EmbyAPIKey") # Flat
            if not api_key:
                api_key = config.get("ApiPart", {}).get("EmbyAPIKey") # Correct Group
            if not api_key:
                api_key = config.get("EmbyPart", {}).get("EmbyAPIKey") # Legacy Group fallback

        if not server_url or not api_key:
            # Log specific missing items for debugging
            logger.error(f"{server_type} Config Check Failed - URL found: {bool(server_url)}, Key found: {bool(api_key)}")
            raise HTTPException(status_code=400, detail="Jellyfin/Emby not enabled or missing configuration")

        server_url = server_url.rstrip("/")

    except Exception as e:
        logger.error(f"Error loading config: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail="Failed to load configuration")

    async with httpx.AsyncClient(timeout=10.0) as client:
        # Jellyfin/Emby use similar endpoints for basic item refresh
        # Endpoint: /Items/{Id}/Refresh

        url = f"{server_url}/Items/{request.media_id}/Refresh"

        # Default params for general refresh
        params = {
            "Recursive": "true",
            "ImageRefreshMode": "Default",
            "MetadataRefreshMode": "Default",
            "ReplaceAllImages": "false",
            "ReplaceAllMetadata": "false"
        }

        if request.action == "refresh_item":
            # Full metadata refresh
            params["MetadataRefreshMode"] = "Full"

        elif request.action == "refresh_images":
            # Image specific refresh (look for new images)
            params["ImageRefreshMode"] = "Full"
            params["MetadataRefreshMode"] = "Default"

        else:
            raise HTTPException(status_code=400, detail="Invalid action")

        try:
            headers = {"Authorization": f'MediaBrowser Token="{api_key}"'}
            response = await client.post(url, headers=headers, params=params)

            if response.status_code == 204 or response.status_code == 200:
                return {
                    "success": True,
                    "message": f"Triggered '{request.action}' on {server_type} for item {request.media_id}"
                }
            else:
                logger.error(f"{server_type} API Error ({response.status_code}): {response.text}")
                raise HTTPException(status_code=response.status_code, detail=f"{server_type} API Error")

        except httpx.RequestError as e:
            logger.error(f"{server_type} Connection Error: {e}")
            raise HTTPException(status_code=502, detail=f"Failed to connect to {server_type}")

# ============================================================================
# LIBRARY FETCHING ENDPOINTS
# ============================================================================

@app.get("/api/libraries/{server_type}/cached")
async def get_cached_libraries(server_type: str):
    logger.info(f"Fetching cached libraries for {server_type}")

    if server_type not in ["plex", "jellyfin", "emby"]:
        return {"success": False, "error": "Invalid server type"}

    if not SERVER_LIBRARIES_DB_AVAILABLE or server_libraries_db is None:
        return {
            "success": True,
            "libraries": [],
            "excluded": [],
            "message": "Server libraries database not initialized"
        }

    try:
        result = server_libraries_db.get_media_server_libraries(server_type)
        logger.info(
            f"Found {len(result['libraries'])} cached libraries for {server_type} ({len(result['excluded'])} excluded)"
        )
        return {
            "success": True,
            "libraries": result["libraries"],
            "excluded": result["excluded"],
        }
    except Exception as e:
        logger.error(f"Error fetching cached libraries: {e}")
        return {"success": False, "error": str(e), "libraries": [], "excluded": []}

class LibraryExclusionUpdate(BaseModel):
    excluded_libraries: list[str]

@app.post("/api/libraries/{server_type}/exclusions")
async def update_library_exclusions(server_type: str, request: LibraryExclusionUpdate):
    logger.info(f"Updating exclusions for {server_type}: {request.excluded_libraries}")

    if server_type not in ["plex", "jellyfin", "emby"]:
        return {"success": False, "error": "Invalid server type"}

    try:
        server_libraries_db.update_library_exclusions(
            server_type, request.excluded_libraries
        )
        logger.info(f"Successfully updated exclusions for {server_type}")
        return {"success": True}
    except Exception as e:
        logger.error(f"Error updating library exclusions: {e}")
        return {"success": False, "error": str(e)}

@app.post("/api/libraries/plex")
async def get_plex_libraries(request: PlexValidationRequest):
    """Fetch Plex libraries"""
    logger.info("Fetching Plex libraries...")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            url = f"{request.url}/library/sections/?X-Plex-Token={request.token}"
            response = await client.get(url)

            if response.status_code == 200:
                root = fromstring(response.content)
                libraries = []
                # excluded_libraries = []

                for directory in root.findall(".//Directory"):
                    lib_title = directory.get("title", "")
                    lib_type = directory.get("type", "")
                    lib_key = directory.get("key", "")

                    lib_info = {"name": lib_title, "type": lib_type, "key": lib_key}

                    # Add ALL libraries to the main list
                    libraries.append(lib_info)

                logger.info(
                    f"Found {len(libraries)} Plex libraries (all types)"
                )

                # Save libraries to database
                try:
                    # Pass an empty list for exclusions
                    server_libraries_db.save_media_server_libraries(
                        "plex", libraries, []
                    )
                    logger.info("Saved Plex libraries to database")
                except Exception as db_error:
                    logger.error(
                        f"Failed to save Plex libraries to database: {str(db_error)}"
                    )

                # Return all libraries in the main list
                return {
                    "success": True,
                    "libraries": libraries,
                    "excluded": [],
                }
            else:
                logger.error(f"Failed to fetch Plex libraries: {response.status_code}")
                return {
                    "success": False,
                    "error": f"Failed to fetch libraries (Status: {response.status_code})",
                }
    except Exception as e:
        logger.error(f"[ERROR] Error fetching Plex libraries: {str(e)}")
        return {"success": False, "error": str(e)}

@app.post("/api/libraries/jellyfin")
async def get_jellyfin_libraries(request: JellyfinValidationRequest):
    """Fetch Jellyfin libraries"""
    logger.info("Fetching Jellyfin libraries...")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {"Authorization": f'MediaBrowser Token="{request.api_key}"'}
            url = f"{request.url}/Library/VirtualFolders"
            response = await client.get(url, headers=headers)

            if response.status_code == 200:
                data = response.json()
                libraries = []
                # excluded_libraries = []

                for lib in data:
                    lib_name = lib.get("Name", "")
                    lib_type = lib.get("CollectionType", "mixed")

                    lib_info = {
                        "name": lib_name,
                        "type": lib_type,
                        "id": lib.get("ItemId", ""),
                    }

                    # Add ALL libraries to the main list
                    libraries.append(lib_info)

                logger.info(
                    f"Found {len(libraries)} Jellyfin libraries (all types)"
                )

                # Save libraries to database
                try:
                    # Pass an empty list for exclusions
                    server_libraries_db.save_media_server_libraries(
                        "jellyfin", libraries, []
                    )
                    logger.info("Saved Jellyfin libraries to database")
                except Exception as db_error:
                    logger.error(
                        f"Failed to save Jellyfin libraries to database: {str(db_error)}"
                    )

                # Return all libraries in the main list
                return {
                    "success": True,
                    "libraries": libraries,
                    "excluded": [],
                }
            else:
                logger.error(
                    f"Failed to fetch Jellyfin libraries: {response.status_code}"
                )
                return {
                    "success": False,
                    "error": f"Failed to fetch libraries (Status: {response.status_code})",
                }
    except Exception as e:
        logger.error(f"[ERROR] Error fetching Jellyfin libraries: {str(e)}")
        return {"success": False, "error": str(e)}

@app.post("/api/libraries/emby")
async def get_emby_libraries(request: EmbyValidationRequest):
    """Fetch Emby libraries"""
    logger.info("Fetching Emby libraries...")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            url = f"{request.url}/Library/VirtualFolders"
            headers = {"Authorization": f'MediaBrowser Token="{request.api_key}"'}
            response = await client.get(url, headers=headers)

            if response.status_code == 200:
                data = response.json()
                libraries = []
                # excluded_libraries = []

                for lib in data:
                    lib_name = lib.get("Name", "")
                    lib_type = lib.get("CollectionType", "mixed")

                    lib_info = {
                        "name": lib_name,
                        "type": lib_type,
                        "id": lib.get("ItemId", ""),
                    }

                    # Add ALL libraries to the main list
                    libraries.append(lib_info)

                logger.info(
                    f"Found {len(libraries)} Emby libraries (all types)"
                )

                # Save libraries to database
                try:
                    # Pass an empty list for exclusions
                    server_libraries_db.save_media_server_libraries(
                        "emby", libraries, []
                    )
                    logger.info("Saved Emby libraries and exclusions to database")
                except Exception as db_error:
                    logger.error(
                        f"Failed to save Emby libraries to database: {str(db_error)}"
                    )

                # Return all libraries in the main list
                return {
                    "success": True,
                    "libraries": libraries,
                    "excluded": [],
                }
            else:
                logger.error(f"Failed to fetch Emby libraries: {response.status_code}")
                return {
                    "success": False,
                    "error": f"Failed to fetch libraries (Status: {response.status_code})",
                }
    except Exception as e:
        logger.error(f"[ERROR] Error fetching Emby libraries: {str(e)}")
        return {"success": False, "error": str(e)}
# Request model for fetching library items
class LibraryItemsRequest(BaseModel):
    url: str
    token: str
    library_key: str


@app.post("/api/libraries/plex/items")
async def get_plex_library_items(request: LibraryItemsRequest):
    """Fetch items from a specific Plex library"""
    logger.info(f"Fetching items from Plex library key: {request.library_key}")

    # SSRF Validation
    if not is_safe_url(request.url, allow_private=True):
        raise HTTPException(status_code=400, detail="Invalid or unsafe Plex URL")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Use params for safety
            url = f"{request.url.rstrip('/')}/library/sections/{request.library_key}/all"
            params = {"X-Plex-Token": request.token}
            response = await client.get(url, params=params)

            if response.status_code == 200:
                root = fromstring(response.content)
                items = []

                # Parse both Video (movies) and Directory (shows) elements
                for item in root.findall(".//*[@title]"):
                    title = item.get("title", "")
                    year = item.get("year", "")
                    item_type = item.get("type", "")
                    rating_key = item.get("ratingKey", "")

                    # Get the folder path if available
                    folder_name = title
                    if year:
                        folder_name = f"{title} ({year})"

                    # Try to get TMDB ID from GUID
                    tmdb_id = ""
                    for guid in item.findall(".//Guid"):
                        guid_id = guid.get("id", "")
                        if "tmdb://" in guid_id:
                            tmdb_id = guid_id.replace("tmdb://", "")
                            folder_name = f"{title} ({year}) {{tmdb-{tmdb_id}}}"
                            break

                    items.append(
                        {
                            "title": title,
                            "year": year,
                            "folderName": folder_name,
                            "type": item_type,
                            "ratingKey": rating_key,
                        }
                    )

                logger.info(f"Found {len(items)} items in library")
                return {"success": True, "items": items}
            else:
                logger.error(f"Failed to fetch library items: {response.status_code}")
                return {
                    "success": False,
                    "error": f"Failed to fetch items (Status: {response.status_code})",
                }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching Plex library items: {e}", exc_info=True)
        return {"success": False, "error": "Internal error fetching library items"}


@app.get("/api/assets/folders")
async def get_assets_folders(library_name: Optional[str] = None):
    """Get folders from assets directory

    If library_name is provided, returns folders from that library.
    Otherwise returns all library folders (top-level directories).
    """
    try:
        if not ASSETS_DIR.exists():
            logger.warning(f"Assets directory does not exist: {ASSETS_DIR}")
            return {"success": True, "folders": [], "path": str(ASSETS_DIR)}

        logger.info(f"Scanning assets directory: {ASSETS_DIR}")

        if library_name:
            # Get items from specific library folder - Path Traversal protection
            try:
                library_path = get_safe_path(ASSETS_DIR, library_name)
            except HTTPException as e:
                return {"success": False, "error": e.detail}

            if not library_path.is_dir():
                logger.warning(f"Library folder not found: {library_path}")
                return {
                    "success": False,
                    "error": f"Library folder '{library_name}' not found",
                }

            folders = []
            try:
                # List all subdirectories in the library folder
                for item_path in sorted(library_path.iterdir()):
                    if item_path.is_dir():
                        folder_name = item_path.name

                        # Try to extract title and year from folder name
                        # Format: "Title (Year) {tmdb-123}" or "Title (Year)" or just "Title"
                        title = folder_name
                        year = ""

                        # Try to extract year from (YYYY) pattern
                        year_match = re.search(r"\((\d{4})\)", folder_name)
                        if year_match:
                            year = year_match.group(1)
                            # Extract title (everything before the year)
                            title = folder_name[: year_match.start()].strip()

                        folders.append(
                            {
                                "folderName": folder_name,
                                "title": title,
                                "year": year,
                                "path": str(item_path.relative_to(ASSETS_DIR)),
                            }
                        )

                logger.info(f"Found {len(folders)} folders in library '{library_name}'")
                return {
                    "success": True,
                    "folders": folders,
                    "library": library_name,
                    "path": str(library_path.relative_to(ASSETS_DIR)),
                }
            except Exception as e:
                logger.error(f"Error scanning library folder: {e}")
                return {"success": False, "error": str(e)}
        else:
            # Get top-level library folders
            libraries = []
            try:
                for library_path in sorted(ASSETS_DIR.iterdir()):
                    if library_path.is_dir():
                        # Count items in library
                        item_count = sum(
                            1 for item in library_path.iterdir() if item.is_dir()
                        )

                        libraries.append(
                            {
                                "name": library_path.name,
                                "path": str(library_path.relative_to(ASSETS_DIR)),
                                "itemCount": item_count,
                            }
                        )

                logger.info(f"Found {len(libraries)} library folders")
                return {
                    "success": True,
                    "libraries": libraries,
                    "path": str(ASSETS_DIR),
                }
            except Exception as e:
                logger.error(f"Error scanning assets directory: {e}")
                return {"success": False, "error": str(e)}

    except Exception as e:
        logger.error(f"[ERROR] Error getting assets folders: {str(e)}")
        logger.exception("Full traceback:")
        return {"success": False, "error": str(e)}


def get_last_log_lines(count=25, mode=None, log_file=None):
    """Get last N lines from log files based on current mode or specific log file"""

    # Map modes to their log files
    mode_log_map = {
        "normal": "Scriptlog.log",
        "testing": "Testinglog.log",
        "manual": "Manuallog.log",
        "backup": "Scriptlog.log",
        "syncjelly": "Scriptlog.log",  # Added for Jellyfin sync
        "syncemby": "Scriptlog.log",  # Added for Emby sync
        "reset": "Scriptlog.log",
    }

    # If specific log file is provided, use that
    if log_file:
        log_files_to_check = [log_file]
    # If mode is specified, try that log file first
    elif mode and mode in mode_log_map:
        log_files_to_check = [mode_log_map[mode]]
    else:
        # Fallback: check all log files in order
        log_files_to_check = ["Scriptlog.log", "Testinglog.log", "Manuallog.log"]

    for log_filename in log_files_to_check:
        scriptlog_path = LOGS_DIR / log_filename
        if scriptlog_path.exists() and scriptlog_path.stat().st_size > 0:
            try:
                with open(scriptlog_path, "r", encoding="utf-8", errors="ignore") as f:
                    all_lines = f.readlines()
                    # Filter out empty lines and decorative lines
                    lines = []
                    for line in all_lines:
                        stripped = line.strip()
                        if (
                            stripped
                            and not stripped.startswith("=====")
                            and not stripped.startswith("_____")
                            and not all(c in "=-_| " for c in stripped)
                        ):
                            lines.append(stripped)

                    if lines:
                        return lines[-count:]  # Return last N lines
            except Exception as e:
                logger.error(f"Error reading log file {log_filename}: {e}")
                continue

    return []


@app.post("/api/logs/ui")
async def receive_ui_log(log_entry: UILogEntry):
    """
    Receives UI/Frontend logs and writes them to FrontendUI.log
    Format matches backend logs for consistent viewing
    """
    try:
        ui_log_path = UI_LOGS_DIR / "FrontendUI.log"

        # Use server timestamp to avoid client/server time differences
        from datetime import datetime

        server_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        level = log_entry.level.upper()
        component = log_entry.component
        message = log_entry.message

        # Format: [TIMESTAMP] [LEVEL] [UI:Component] - MESSAGE
        # This matches backend format but with UI: prefix
        log_line = f"[{server_timestamp}] [{level:8}] [UI:{component}] - {message}\n"

        # Write to FrontendUI.log
        with open(ui_log_path, "a", encoding="utf-8") as f:
            f.write(log_line)

        return {"success": True}

    except Exception as e:
        logger.error(f"Error writing UI log: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/logs/ui/batch")
async def receive_ui_logs_batch(batch: UILogBatch):
    """
    Receives multiple UI logs at once (better performance)
    Uses server timestamps to ensure chronological consistency
    """
    try:
        ui_log_path = UI_LOGS_DIR / "FrontendUI.log"

        from datetime import datetime

        log_lines = []
        for log_entry in batch.logs:
            # Use server timestamp for all logs
            server_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            level = log_entry.level.upper()
            component = log_entry.component
            message = log_entry.message

            log_line = (
                f"[{server_timestamp}] [{level:8}] [UI:{component}] - {message}\n"
            )
            log_lines.append(log_line)

        # Batch write for better performance
        with open(ui_log_path, "a", encoding="utf-8") as f:
            f.writelines(log_lines)

        return {"success": True, "count": len(batch.logs)}

    except Exception as e:
        logger.error(f"Error writing UI logs batch: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/system-info")
async def get_system_info():
    """Get system information (CPU, RAM, OS, Platform) - Optimized for Docker & Windows"""
    import platform
    import os
    import subprocess
    import sys
    from pathlib import Path

    # 1. Initialize safe defaults
    system_info = {
        "platform": platform.system(),
        "os_version": "Unknown",
        "cpu_model": "Unknown",
        "cpu_cores": os.cpu_count() or 0,
        "total_memory": "Unknown",
        "used_memory": "Unknown",
        "free_memory": "Unknown",
        "memory_percent": 0,
        "is_docker": Path("/.dockerenv").exists() or Path("/run/secrets/docker_secret").exists()
    }

    try:
        # =========================================================
        # OS VERSION DETECTION
        # =========================================================
        if platform.system() == "Linux":
            if Path("/etc/os-release").exists():
                try:
                    with open("/etc/os-release", "r") as f:
                        for line in f:
                            if line.startswith("PRETTY_NAME="):
                                system_info["os_version"] = line.split("=")[1].strip().strip('"')
                                break
                except:
                    pass

        elif platform.system() == "Windows":
            # Modern Python 3.10+ handles Windows versions well natively
            system_info["os_version"] = f"Windows {platform.release()} ({platform.version()})"

            # Try to get detailed build number via ctypes for precision
            try:
                import ctypes
                class OSVERSIONINFOEXW(ctypes.Structure):
                    _fields_ = [("dwOSVersionInfoSize", ctypes.c_ulong),
                                ("dwMajorVersion", ctypes.c_ulong),
                                ("dwMinorVersion", ctypes.c_ulong),
                                ("dwBuildNumber", ctypes.c_ulong),
                                ("dwPlatformId", ctypes.c_ulong),
                                ("szCSDVersion", ctypes.c_wchar * 128)]
                os_ver = OSVERSIONINFOEXW()
                os_ver.dwOSVersionInfoSize = ctypes.sizeof(os_ver)
                if ctypes.windll.ntdll.RtlGetVersion(ctypes.byref(os_ver)) == 0:
                    system_info["os_version"] = f"Windows {os_ver.dwMajorVersion}.{os_ver.dwMinorVersion} Build {os_ver.dwBuildNumber}"
            except:
                pass

        elif platform.system() == "Darwin":
            system_info["os_version"] = f"macOS {platform.mac_ver()[0]}"


        # =========================================================
        # CPU MODEL (Refactored for Reliability)
        # =========================================================
        cpu_found = False

        if platform.system() == "Linux":
            # METHOD 1: Read /proc/cpuinfo (Fastest & Docker Safe)
            try:
                with open("/proc/cpuinfo", "r") as f:
                    for line in f:
                        if "model name" in line:
                            system_info["cpu_model"] = line.split(":")[1].strip()
                            cpu_found = True
                            break
            except:
                pass

        elif platform.system() == "Windows":
            # METHOD 1: Registry (Fastest & Most Accurate "Marketing Name")
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
                cpu_name = winreg.QueryValueEx(key, "ProcessorNameString")[0]
                winreg.CloseKey(key)
                if cpu_name:
                    system_info["cpu_model"] = cpu_name.strip()
                    cpu_found = True
            except:
                pass

            # METHOD 2: PowerShell (Backup if registry fails)
            if not cpu_found:
                try:
                    cmd = "Get-CimInstance -ClassName Win32_Processor | Select-Object -ExpandProperty Name"
                    res = subprocess.run(["powershell", "-Command", cmd], capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
                    if res.stdout.strip():
                        system_info["cpu_model"] = res.stdout.strip()
                        cpu_found = True
                except:
                    pass

        elif platform.system() == "Darwin":
            try:
                res = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True)
                if res.stdout.strip():
                    system_info["cpu_model"] = res.stdout.strip()
                    cpu_found = True
            except:
                pass

        # Fallback for all platforms
        if not cpu_found:
            system_info["cpu_model"] = platform.processor() or "Unknown CPU"


        # =========================================================
        # MEMORY USAGE
        # =========================================================
        if platform.system() == "Linux":
            try:
                with open("/proc/meminfo", "r") as f:
                    mem = {}
                    for line in f:
                        parts = line.split(':')
                        if len(parts) == 2:
                            mem[parts[0].strip()] = int(parts[1].split()[0])

                    if 'MemTotal' in mem and 'MemAvailable' in mem:
                        total_mb = mem['MemTotal'] // 1024
                        avail_mb = mem['MemAvailable'] // 1024
                        used_mb = total_mb - avail_mb

                        system_info["total_memory"] = f"{total_mb} MB"
                        system_info["used_memory"] = f"{used_mb} MB"
                        system_info["free_memory"] = f"{avail_mb} MB"
                        system_info["memory_percent"] = round((used_mb / total_mb) * 100, 1)
            except:
                pass

        elif platform.system() == "Windows":
            # GlobalMemoryStatusEx via ctypes (Fastest/Most Reliable)
            try:
                import ctypes
                from ctypes import wintypes
                class MEMORYSTATUSEX(ctypes.Structure):
                    _fields_ = [("dwLength", ctypes.c_ulong),
                                ("dwMemoryLoad", ctypes.c_ulong),
                                ("ullTotalPhys", ctypes.c_ulonglong),
                                ("ullAvailPhys", ctypes.c_ulonglong),
                                ("ullTotalPageFile", ctypes.c_ulonglong),
                                ("ullAvailPageFile", ctypes.c_ulonglong),
                                ("ullTotalVirtual", ctypes.c_ulonglong),
                                ("ullAvailVirtual", ctypes.c_ulonglong),
                                ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

                stat = MEMORYSTATUSEX()
                stat.dwLength = ctypes.sizeof(stat)
                ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))

                total_mb = stat.ullTotalPhys // (1024 * 1024)
                avail_mb = stat.ullAvailPhys // (1024 * 1024)
                used_mb = total_mb - avail_mb

                system_info["total_memory"] = f"{total_mb} MB"
                system_info["used_memory"] = f"{used_mb} MB"
                system_info["free_memory"] = f"{avail_mb} MB"
                system_info["memory_percent"] = round((used_mb / total_mb) * 100, 1)
            except:
                pass

        elif platform.system() == "Darwin":
             # (Keep your existing macOS logic here if needed, omitted for brevity but it was fine)
             pass

    except Exception as e:
        # logger.error(f"System info error: {e}")
        pass

    return system_info

# ============================================================================
# LOG LEVEL MANAGEMENT ENDPOINTS
# ============================================================================


# DEPRECATED: Old /api/log-level endpoints removed
# Use /api/webui-settings instead for centralized settings management


# ============================================================================
# WEBUI SETTINGS ENDPOINTS (separate from config.json)
# ============================================================================


@app.get("/api/webui-settings")
async def get_webui_settings():
    """Get WebUI settings (log level, theme, etc.)"""
    logger.info("=" * 60)
    logger.info("WEBUI SETTINGS REQUEST")

    try:
        settings = load_webui_settings()

        # Add current log level from runtime
        current_level = logging.getLogger().level
        current_level_name = logging.getLevelName(current_level)
        settings["current_log_level"] = current_level_name

        logger.info(f"WebUI settings loaded: {len(settings)} keys")
        logger.debug(f"Settings: {settings}")
        logger.info("=" * 60)

        return {
            "success": True,
            "settings": settings,
            "available_log_levels": ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
            "config_file": str(WEBUI_SETTINGS_PATH),
        }

    except Exception as e:
        logger.error(f"Error getting WebUI settings: {e}")
        logger.exception("Full traceback:")
        logger.info("=" * 60)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/webui-settings")
async def update_webui_settings(data: dict):
    """
    Update WebUI settings (persistent)

    Request body:
    {
        "log_level": "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL",
        "theme": "dark" | "light",
        "auto_refresh_interval": 180
    }
    """
    logger.info("=" * 60)
    logger.info("WEBUI SETTINGS UPDATE REQUEST")
    logger.debug(f"Request data: {data}")

    try:
        # Load current settings
        current_settings = load_webui_settings()
        logger.debug(f"Current settings: {current_settings}")

        # Update settings
        updates = data.get("settings", {})
        current_settings.update(updates)

        # Save settings
        logger.info(f"Saving updated settings: {list(updates.keys())}")
        save_success = save_webui_settings(current_settings)

        if not save_success:
            raise HTTPException(status_code=500, detail="Failed to save settings")

        # If log_level was updated, apply it immediately
        if "log_level" in updates:
            new_level_name = updates["log_level"].upper()

            if new_level_name in LOG_LEVEL_MAP:
                new_level = LOG_LEVEL_MAP[new_level_name]
                old_level_name = logging.getLevelName(logging.getLogger().level)

                logger.info(
                    f"Applying log level change: {old_level_name} -> {new_level_name}"
                )

                # Update root logger
                logging.getLogger().setLevel(new_level)

                # Update all handlers
                for handler in logging.getLogger().handlers:
                    handler.setLevel(new_level)

                # Update global variables
                global LOG_LEVEL, LOG_LEVEL_ENV
                LOG_LEVEL = new_level
                LOG_LEVEL_ENV = new_level_name

                # Also save to old log_config.json for backward compatibility
                save_log_level_config(new_level_name)

                logger.info(f"Log level changed: {old_level_name} -> {new_level_name}")

        logger.info(f"WebUI settings saved successfully")
        logger.info("=" * 60)

        return {
            "success": True,
            "message": "Settings updated successfully",
            "settings": current_settings,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating WebUI settings: {e}")
        logger.exception("Full traceback:")
        logger.info("=" * 60)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/upload-diagnostics")
async def get_upload_diagnostics():
    """
    Get diagnostic information about upload directories and permissions.
    Useful for troubleshooting upload issues on Docker/NAS/Unraid/Windows/Linux.
    """
    import platform

    diagnostics = {
        "platform": platform.system(),
        "is_docker": IS_DOCKER,
        "python_version": sys.version,
        "directories": {},
        "environment": {
            "DOCKER_ENV": os.environ.get("DOCKER_ENV", "not set"),
            "POSTERIZARR_NON_ROOT": os.environ.get("POSTERIZARR_NON_ROOT", "not set"),
        },
    }

    # Check all upload-related directories
    directories_to_check = {
        "BASE_DIR": BASE_DIR,
        "UPLOADS_DIR": UPLOADS_DIR,
        "OVERLAYFILES_DIR": OVERLAYFILES_DIR,
        "ASSETS_DIR": ASSETS_DIR,
        "LOGS_DIR": LOGS_DIR,
        "TEMP_DIR": TEMP_DIR,
    }

    for name, directory in directories_to_check.items():
        diagnostics["directories"][name] = check_directory_permissions(directory, name)

    # Add user/group information on Unix systems
    if platform.system() in ["Linux", "Darwin"]:
        try:
            import pwd
            import grp

            diagnostics["user"] = {
                "uid": os.getuid(),
                "gid": os.getgid(),
                "username": pwd.getpwuid(os.getuid()).pw_name,
                "groupname": grp.getgrgid(os.getgid()).gr_name,
            }
        except Exception as e:
            logger.debug(f"Error determining Unix user info: {e}")
            diagnostics["user"] = {"error": "Unable to determine user details"}

    # Check if running with elevated privileges on Windows
    if platform.system() == "Windows":
        try:
            import ctypes

            diagnostics["is_admin"] = ctypes.windll.shell32.IsUserAnAdmin() != 0
        except Exception as e:
            logger.debug(f"Error determining Windows admin privileges: {e}")
            diagnostics["is_admin"] = "Unable to determine"

    return diagnostics


@app.get("/api/status")
async def get_status():
    """Get script status with last log lines from appropriate log file"""
    global current_process, current_mode, current_start_time

    with process_lock:
        manual_is_running = False
        if current_process is not None:
            poll_result = current_process.poll()
            if poll_result is None:
                # Process is still running
                manual_is_running = True
            else:
                logger.info(
                    f"Process finished with exit code {poll_result}, cleaning up..."
                )
                # Store mode before clearing for runtime tracking
                finished_mode = current_mode

                current_process = None
                current_mode = None
                current_start_time = None
                manual_is_running = False

                # Auto-trigger cache refresh after script finishes
                logger.info("Triggering cache refresh after script completion...")
                try:
                    threading.Thread(target=scan_and_cache_assets, daemon=True).start()
                    logger.info("Cache refresh started in background after script completion")
                except Exception as e:
                    logger.error(f"Error refreshing cache after script completion: {e}")

                # Save runtime statistics to database
                if RUNTIME_DB_AVAILABLE and finished_mode:
                    try:
                        mode_log_map = {
                            "normal": "Scriptlog.log",
                            "testing": "Testinglog.log",
                            "manual": "Manuallog.log",
                            "backup": "Scriptlog.log",
                            "syncjelly": "Scriptlog.log",
                            "syncemby": "Scriptlog.log",
                            "reset": "Scriptlog.log",
                        }
                        log_filename = mode_log_map.get(finished_mode, "Scriptlog.log")
                        log_path = LOGS_DIR / log_filename

                        if log_path.exists():
                            logger.info(
                                f"Runtime statistics will be imported by logs_watcher for {finished_mode} mode"
                            )
                    except Exception as e:
                        logger.error(f"Error saving runtime to database: {e}")

        scheduler_is_running = False
        scheduler_pid = None
        if SCHEDULER_AVAILABLE and scheduler:
            if scheduler.is_running and scheduler.current_process:
                poll_result = scheduler.current_process.poll()
                if poll_result is None:
                    # Scheduler process is still running
                    scheduler_is_running = True
                    scheduler_pid = scheduler.current_process.pid
                else:
                    # Scheduler process has finished - clean up!
                    logger.info(
                        f"Scheduler process finished with exit code {poll_result}, cleaning up..."
                    )
                    scheduler.current_process = None
                    scheduler.is_running = False
                    scheduler_is_running = False

                    # Auto-trigger cache refresh after scheduler finishes
                    logger.info("Triggering cache refresh after scheduler completion...")
                    try:
                        threading.Thread(target=scan_and_cache_assets, daemon=True).start()
                        logger.info(
                            "Cache refresh started in background after scheduler completion"
                        )
                    except Exception as e:
                        logger.error(
                            f"Error refreshing cache after scheduler completion: {e}"
                        )

                    # Save runtime statistics to database for scheduler runs
                    if RUNTIME_DB_AVAILABLE:
                        try:
                            log_path = LOGS_DIR / "Scriptlog.log"
                            if log_path.exists():
                                logger.info(
                                    "Runtime statistics will be imported by logs_watcher for scheduled run"
                                )
                        except Exception as e:
                            logger.error(f"Error saving scheduler runtime to database: {e}")

        # Check if running file exists
        running_file_exists = RUNNING_FILE.exists()

        # Combined running status
        # FIX: Treat running_file_exists as a valid running state for Webhook/Watcher triggers
        is_running = manual_is_running or scheduler_is_running or running_file_exists

        # Determine current mode
        effective_mode = current_mode
        if scheduler_is_running and not manual_is_running:
            effective_mode = "scheduled"
        elif running_file_exists and not manual_is_running and not scheduler_is_running:
            # If lockfile exists but API didn't start it, it's a Webhook/Watcher run.
            # Read the content to know exactly what it is (e.g. "Tautulli", "Arr")
            try:
                with open(RUNNING_FILE, "r", encoding="utf-8") as f:
                    content = f.read().strip()
                    # Use content as mode if present, else default to "webhook"
                    effective_mode = content.lower() if content else "webhook"
            except Exception:
                effective_mode = "webhook"
        elif not is_running:
            effective_mode = None

        # Determine which log file to use
        # Map modes to their log files
        mode_log_map = {
            "normal": "Scriptlog.log",
            "testing": "Testinglog.log",
            "manual": "Manuallog.log",
            "backup": "Scriptlog.log",
            "syncjelly": "Scriptlog.log",
            "syncemby": "Scriptlog.log",
            "reset": "Scriptlog.log",
            "scheduled": "Scriptlog.log",
            "webhook": "Scriptlog.log",
            "tautulli": "Scriptlog.log",
            "arr": "Scriptlog.log"
        }

        # If script is running, use current mode
        if is_running and effective_mode:
            active_log = mode_log_map.get(effective_mode, "Scriptlog.log")
        else:
            # Find the most recently modified log file
            log_files = ["Testinglog.log", "Manuallog.log", "Scriptlog.log"]
            newest_log = None
            newest_time = 0

            for log_file in log_files:
                log_path = LOGS_DIR / log_file
                if log_path.exists():
                    mtime = log_path.stat().st_mtime
                    if mtime > newest_time:
                        newest_time = mtime
                        newest_log = log_file

            active_log = newest_log if newest_log else "Scriptlog.log"

        # Get last 25 log lines from the active log file
        last_logs = get_last_log_lines(25, log_file=active_log)

        # Check for "already running" warning
        already_running = False
        for line in last_logs[-5:]:  # Check last 5 lines
            if "Another Posterizarr instance already running" in line:
                already_running = True
                break

        # Determine PID to show
        display_pid = None
        if manual_is_running:
            display_pid = current_process.pid
        elif scheduler_is_running:
            display_pid = scheduler_pid
        elif is_running and (effective_mode == "webhook" or effective_mode == "tautulli" or effective_mode == "arr"):
            display_pid = "External"

        return {
            "running": is_running,
            "manual_running": manual_is_running,
            "scheduler_running": scheduler_is_running,
            "scheduler_is_executing": scheduler_is_running,
            "last_logs": last_logs,
            "script_exists": SCRIPT_PATH.exists(),
            "config_exists": CONFIG_PATH.exists(),
            "pid": display_pid,
            "current_mode": effective_mode,
            "active_log": active_log,
            "already_running_detected": already_running,
            "running_file_exists": running_file_exists,
            "start_time": current_start_time if is_running else None,
        }

@app.delete("/api/running-file")
async def delete_running_file():
    """Delete the Posterizarr.Running file"""
    try:
        if RUNNING_FILE.exists():
            RUNNING_FILE.unlink()
            logger.info("Deleted Posterizarr.Running file")
            return {"success": True, "message": "Running file deleted successfully"}
        else:
            return {"success": False, "message": "Running file does not exist"}
    except Exception as e:
        logger.error(f"Error deleting running file: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/runtime-stats")
async def get_runtime_stats():
    """
    Get last runtime statistics from database
    """
    logger.info("=" * 60)
    logger.info("RUNTIME STATS REQUEST")
    logger.debug(f"Runtime DB available: {RUNTIME_DB_AVAILABLE}")
    logger.debug(f"Scheduler available: {SCHEDULER_AVAILABLE}")

    try:
        if not RUNTIME_DB_AVAILABLE or not runtime_db:
            logger.warning("Runtime database not available")
            return {
                "success": False,
                "message": "Runtime database not available",
                "runtime": None,
                "total_images": 0,
                "posters": 0,
                "seasons": 0,
                "backgrounds": 0,
                "titlecards": 0,
                "collections": 0,
                "errors": 0,
            }

        logger.debug("Fetching latest runtime entry from database...")
        latest = runtime_db.get_latest_runtime()

        if not latest:
            logger.info("No runtime data found in database")
            return {
                "success": False,
                "message": "No runtime data available. Please run the script or import JSON files.",
                "runtime": None,
                "total_images": 0,
                "posters": 0,
                "seasons": 0,
                "backgrounds": 0,
                "titlecards": 0,
                "collections": 0,
                "errors": 0,
            }

        logger.debug(
            f"Latest runtime entry: ID={latest.get('id')}, Mode={latest.get('mode')}, Timestamp={latest.get('timestamp')}"
        )

        # Get scheduler information if available
        scheduler_info = {
            "enabled": False,
            "schedules": [],
            "next_run": None,
            "timezone": None,
        }

        if SCHEDULER_AVAILABLE and scheduler:
            try:
                logger.debug("Fetching scheduler status...")
                status = scheduler.get_status()
                scheduler_info = {
                    "enabled": status.get("enabled", False),
                    "schedules": status.get("schedules", []),
                    "next_run": status.get("next_run"),
                    "timezone": status.get("timezone"),
                }
                logger.debug(
                    f"Scheduler: enabled={scheduler_info['enabled']}, schedules={len(scheduler_info['schedules'])}"
                )
            except Exception as e:
                logger.warning(f"Could not get scheduler info: {e}")

        logger.info(
            f"Runtime stats retrieved: {latest.get('total_images', 0)} images, {latest.get('errors', 0)} errors"
        )
        logger.info("=" * 60)

        return {
            "success": True,
            "runtime": latest.get("runtime_formatted"),
            "total_images": latest.get("total_images", 0),
            "posters": latest.get("posters", 0),
            "seasons": latest.get("seasons", 0),
            "backgrounds": latest.get("backgrounds", 0),
            "titlecards": latest.get("titlecards", 0),
            "collections": latest.get("collections", 0),
            "errors": latest.get("errors", 0),
            "tba_skipped": latest.get("tba_skipped", 0),
            "jap_chines_skipped": latest.get("jap_chines_skipped", 0),
            "notification_sent": latest.get("notification_sent", 0) == 1,
            "uptime_kuma": latest.get("uptime_kuma", 0) == 1,
            "images_cleared": latest.get("images_cleared", 0),
            "folders_cleared": latest.get("folders_cleared", 0),
            "space_saved": latest.get("space_saved"),
            "script_version": latest.get("script_version"),
            "im_version": latest.get("im_version"),
            "start_time": latest.get("start_time"),
            "end_time": latest.get("end_time"),
            "mode": latest.get("mode"),
            "timestamp": latest.get("timestamp"),
            "fallbacks": latest.get("fallbacks", 0),
            "textless": latest.get("textless", 0),
            "truncated": latest.get("truncated", 0),
            "text": latest.get("text", 0),
            "scheduler": scheduler_info,
            "source": "database",
        }

    except Exception as e:
        logger.error(f"Error getting runtime stats: {e}")
        logger.exception("Full traceback:")
        logger.info("=" * 60)
        return {
            "success": False,
            "message": str(e),
            "runtime": None,
            "total_images": 0,
            "posters": 0,
            "seasons": 0,
            "backgrounds": 0,
            "titlecards": 0,
            "collections": 0,
            "errors": 0,
        }


@app.get("/api/runtime-history")
async def get_runtime_history(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    mode: Optional[str] = Query(None),
):
    """
    Get runtime history with pagination

    Args:
        limit: Maximum number of entries to return (1-500)
        offset: Number of entries to skip
        mode: Filter by mode (optional)
    """
    try:
        if not RUNTIME_DB_AVAILABLE or not runtime_db:
            return {
                "success": False,
                "message": "Runtime database not available",
                "history": [],
            }

        history = runtime_db.get_runtime_history(limit=limit, offset=offset, mode=mode)
        total = runtime_db.get_runtime_history_total_count(mode=mode)

        return {
            "success": True,
            "history": history,
            "count": len(history),
            "total": total,
            "limit": limit,
            "offset": offset,
            "mode_filter": mode,
        }

    except Exception as e:
        logger.error(f"Error getting runtime history: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/runtime-summary")
async def get_runtime_summary(days: int = Query(30, ge=1, le=365)):
    """
    Get summary statistics for the last N days

    Args:
        days: Number of days to include (1-365)
    """
    try:
        if not RUNTIME_DB_AVAILABLE or not runtime_db:
            return {
                "success": False,
                "message": "Runtime database not available",
                "summary": {},
            }

        summary = runtime_db.get_runtime_stats_summary(days=days)

        return {
            "success": True,
            "summary": summary,
        }

    except Exception as e:
        logger.error(f"Error getting runtime summary: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.delete("/api/runtime-history/cleanup")
async def cleanup_old_runtime_entries(days: int = Query(90, ge=30, le=365)):
    """
    Delete runtime entries older than specified days

    Args:
        days: Keep entries from the last N days (30-365)
    """
    try:
        if not RUNTIME_DB_AVAILABLE or not runtime_db:
            return {
                "success": False,
                "message": "Runtime database not available",
            }

        deleted_count = runtime_db.delete_old_entries(days=days)

        return {
            "success": True,
            "deleted_count": deleted_count,
            "message": f"Deleted {deleted_count} entries older than {days} days",
        }

    except Exception as e:
        logger.error(f"Error cleaning up runtime history: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/runtime-history/migrate")
async def migrate_runtime_data_from_logs():
    """
    Migrate runtime data from existing log files to database
    This endpoint can be used to manually trigger migration (automatic migration runs on first DB creation)
    """
    try:
        if not RUNTIME_DB_AVAILABLE or not runtime_db:
            return {
                "success": False,
                "message": "Runtime database not available",
            }

        # Check if already migrated
        if runtime_db._is_migrated():
            return {
                "success": True,
                "already_migrated": True,
                "message": "Migration was already performed. Database contains migrated data.",
            }

        logger.info("Starting manual runtime data migration from logs...")

        # Import logs from current and rotated directories
        rotated_logs_dir = BASE_DIR / "RotatedLogs"
        log_files_to_check = []

        # Current logs
        current_logs = [
            ("Scriptlog.log", "normal"),
            ("Testinglog.log", "testing"),
            ("Manuallog.log", "manual"),
        ]

        for log_file, mode in current_logs:
            log_path = LOGS_DIR / log_file
            if log_path.exists():
                log_files_to_check.append((log_path, mode))

        # Rotated logs (if they exist)
        if rotated_logs_dir.exists():
            logger.info(f"Checking rotated logs in {rotated_logs_dir}")
            for rotation_dir in rotated_logs_dir.iterdir():
                if rotation_dir.is_dir():
                    for log_file, mode in current_logs:
                        log_path = rotation_dir / log_file
                        if log_path.exists():
                            log_files_to_check.append((log_path, mode))

        imported_count = 0
        skipped_count = 0
        error_count = 0

        for log_path, mode in log_files_to_check:
            try:
                runtime_data = parse_runtime_from_log(log_path, mode)

                if runtime_data:
                    runtime_db.add_runtime_entry(**runtime_data)
                    imported_count += 1
                else:
                    skipped_count += 1

            except Exception as e:
                logger.error(f"Error processing {log_path}: {e}")
                error_count += 1

        logger.info(
            f"Migration complete: {imported_count} imported, {skipped_count} skipped, {error_count} errors"
        )

        # Mark as migrated
        runtime_db._mark_as_migrated(imported_count)

        return {
            "success": True,
            "imported": imported_count,
            "skipped": skipped_count,
            "errors": error_count,
            "message": f"Migrated {imported_count} runtime entries from log files",
        }

    except Exception as e:
        logger.error(f"Error migrating runtime data: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/runtime-history/migration-status")
async def get_migration_status():
    """
    Get migration status information
    """
    try:
        if not RUNTIME_DB_AVAILABLE or not runtime_db:
            return {
                "success": False,
                "message": "Runtime database not available",
            }

        is_migrated = runtime_db._is_migrated()

        # Get migration info using the new thread-safe method
        migration_info = runtime_db.get_migration_info()

        if "error" in migration_info:
            logger.debug(f"Could not get migration info: {migration_info['error']}")
            migration_info = {}

        return {
            "success": True,
            "is_migrated": is_migrated,
            "migration_info": migration_info,
        }

    except Exception as e:
        logger.error(f"Error getting migration status: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/runtime-history/migrate-format")
async def migrate_runtime_format():
    """
    Migrate all runtime_formatted entries to new format (Xh:Ym:Zs)
    """
    try:
        if not RUNTIME_DB_AVAILABLE or not runtime_db:
            return {
                "success": False,
                "message": "Runtime database not available",
            }

        updated_count = runtime_db.migrate_runtime_format()

        return {
            "success": True,
            "updated_count": updated_count,
            "message": f"Migrated {updated_count} runtime entries to new format (Xh:Ym:Zs)",
        }

    except Exception as e:
        logger.error(f"Error migrating runtime format: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/runtime-history/import-json")
async def import_json_runtime_data():
    """
    Import runtime data from JSON files in Logs directory

    Looks for and imports from:
    - normal.json
    - manual.json
    - testing.json
    - tautulli.json
    - arr.json
    - syncjelly.json
    - syncemby.json
    - backup.json
    - scheduled.json
    """
    try:
        if not RUNTIME_DB_AVAILABLE or not runtime_db:
            return {
                "success": False,
                "message": "Runtime database not available",
            }

        from runtime_parser import import_json_to_db

        # Import JSON files
        import_json_to_db(LOGS_DIR)

        return {
            "success": True,
            "message": "JSON files imported successfully",
        }

    except Exception as e:
        logger.error(f"Error importing JSON runtime data: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/api/analytics/providers")
async def get_provider_stats(days: int = Query(30, ge=7, le=365)):
    """Get provider source statistics over time"""
    try:
        if not DATABASE_AVAILABLE or not db:
             return {"success": False, "stats": [], "error": "Database not available"}

        # Use the new method in database.py
        stats = db.get_provider_stats_by_date(days)
        return {"success": True, "stats": stats}
    except Exception as e:
        logger.error(f"Error getting provider stats: {e}")
        return {"success": False, "error": str(e), "stats": []}

# =========================================================================
# Plex Export Database Endpoints
# =========================================================================


@app.get("/api/plex-export/statistics")
async def get_plex_export_statistics():
    """
    Get Plex export database statistics
    """
    try:
        if not MEDIA_EXPORT_DB_AVAILABLE or not media_export_db:
            return {
                "success": False,
                "message": "Plex export database not available",
            }

        stats = media_export_db.get_statistics()

        return {
            "success": True,
            "statistics": stats,
        }

    except Exception as e:
        logger.error(f"Error getting Plex export statistics: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/plex-export/runs")
async def get_plex_export_runs():
    """
    Get list of all Plex export run timestamps
    """
    try:
        if not MEDIA_EXPORT_DB_AVAILABLE or not media_export_db:
            return {
                "success": False,
                "message": "Plex export database not available",
            }

        runs = media_export_db.get_all_runs()

        return {
            "success": True,
            "runs": runs,
            "count": len(runs),
        }

    except Exception as e:
        logger.error(f"Error getting Plex export runs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/plex-export/library")
async def get_plex_library_data(
    run_timestamp: Optional[str] = None, limit: Optional[int] = None
):
    """
    Get Plex library export data

    Args:
        run_timestamp: Optional specific run to query (default: latest)
        limit: Optional limit on number of results
    """
    try:
        if not MEDIA_EXPORT_DB_AVAILABLE or not media_export_db:
            return {
                "success": False,
                "message": "Plex export database not available",
            }

        data = media_export_db.get_library_data(run_timestamp, limit)

        return {
            "success": True,
            "data": data,
            "count": len(data),
            "run_timestamp": run_timestamp or "latest",
        }

    except Exception as e:
        logger.error(f"Error getting Plex library data: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/plex-export/episodes")
async def get_plex_episode_data(
    run_timestamp: Optional[str] = None, limit: Optional[int] = None
):
    """
    Get Plex episode export data

    Args:
        run_timestamp: Optional specific run to query (default: latest)
        limit: Optional limit on number of results
    """
    try:
        if not MEDIA_EXPORT_DB_AVAILABLE or not media_export_db:
            return {
                "success": False,
                "message": "Plex export database not available",
            }

        data = media_export_db.get_episode_data(run_timestamp, limit)

        return {
            "success": True,
            "data": data,
            "count": len(data),
            "run_timestamp": run_timestamp or "latest",
        }

    except Exception as e:
        logger.error(f"Error getting Plex episode data: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/plex-export/import")
async def import_plex_csvs():
    """
    Import the latest Plex CSV files from Logs directory
    """
    try:
        if not MEDIA_EXPORT_DB_AVAILABLE or not media_export_db:
            return {
                "success": False,
                "message": "Plex export database not available",
            }

        results = media_export_db.import_latest_csvs()

        return {
            "success": True,
            "results": results,
            "message": f"Imported {results['library_count']} library + {results['episode_count']} episode records",
        }

    except Exception as e:
        logger.error(f"Error importing Plex CSVs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# =========================================================================
# OtherMedia (Jellyfin/Emby) Export Endpoints
# =========================================================================


@app.get("/api/other-media-export/statistics")
async def get_other_media_statistics():
    """Get OtherMedia (Jellyfin/Emby) export database statistics"""
    try:
        if not MEDIA_EXPORT_DB_AVAILABLE or not media_export_db:
            return {
                "success": False,
                "message": "OtherMedia export database not available",
            }

        stats = media_export_db.get_other_statistics()

        return {"success": True, "statistics": stats}

    except Exception as e:
        logger.error(f"Error getting OtherMedia statistics: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/other-media-export/runs")
async def get_other_media_runs():
    """Get list of all OtherMedia export run timestamps"""
    try:
        if not MEDIA_EXPORT_DB_AVAILABLE or not media_export_db:
            return {
                "success": False,
                "message": "OtherMedia export database not available",
            }

        runs = media_export_db.get_other_all_runs()

        return {"success": True, "runs": runs, "count": len(runs)}

    except Exception as e:
        logger.error(f"Error getting OtherMedia runs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/other-media-export/library")
async def get_other_media_library_data(
    run_timestamp: Optional[str] = None, limit: Optional[int] = None
):
    """
    Get OtherMedia library export data

    Args:
        run_timestamp: Optional specific run to query (default: latest)
        limit: Optional limit on number of results
    """
    try:
        if not MEDIA_EXPORT_DB_AVAILABLE or not media_export_db:
            return {
                "success": False,
                "message": "OtherMedia export database not available",
            }

        data = media_export_db.get_other_library_data(run_timestamp)

        if limit:
            data = data[:limit]

        return {
            "success": True,
            "data": data,
            "count": len(data),
            "run_timestamp": run_timestamp or "latest",
        }

    except Exception as e:
        logger.error(f"Error getting OtherMedia library data: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/other-media-export/episodes")
async def get_other_media_episode_data(
    run_timestamp: Optional[str] = None, limit: Optional[int] = None
):
    """
    Get OtherMedia episode export data

    Args:
        run_timestamp: Optional specific run to query (default: latest)
        limit: Optional limit on number of results
    """
    try:
        if not MEDIA_EXPORT_DB_AVAILABLE or not media_export_db:
            return {
                "success": False,
                "message": "OtherMedia export database not available",
            }

        data = media_export_db.get_other_episode_data(run_timestamp, limit)

        return {
            "success": True,
            "data": data,
            "count": len(data),
            "run_timestamp": run_timestamp or "latest",
        }

    except Exception as e:
        logger.error(f"Error getting OtherMedia episode data: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/other-media-export/import")
async def import_other_media_csvs():
    """
    Import the latest OtherMedia (Jellyfin/Emby) CSV files from Logs directory
    """
    try:
        if not MEDIA_EXPORT_DB_AVAILABLE or not media_export_db:
            return {
                "success": False,
                "message": "OtherMedia export database not available",
            }

        results = media_export_db.import_other_latest_csvs()

        return {
            "success": True,
            "results": results,
            "message": f"Imported {results['library_count']} library + {results['episode_count']} episode records",
        }

    except Exception as e:
        logger.error(f"Error importing OtherMedia CSVs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

        # =========================================================================
        # Admin Endpoints
        # =========================================================================

        logger.error(f"Error getting migration status: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/tmdb/search-posters")
async def search_tmdb_posters(request: TMDBSearchRequest):
    """
    Search TMDB for images by title or ID
    - Standard: Returns show/movie posters (filtered by PreferredLanguageOrder)
    - Season: Returns season-specific posters (filtered by PreferredSeasonLanguageOrder)
    - Titlecard: Returns episode stills (only 'xx' - no language/international)
    - Background: Returns show/movie backdrops (filtered by PreferredBackgroundLanguageOrder)
    - Collection: Returns collection posters (only 'xx' - no language/international)
    """

    def filter_and_sort_posters_by_language(posters_list, preferred_languages):
        """
        Filter and sort posters based on preferred language order.

        Args:
            posters_list: List of poster dicts from TMDB
            preferred_languages: List of language codes in order of preference (e.g., ['de', 'en', 'xx'])

        Returns:
            Filtered and sorted list of posters
        """
        if not preferred_languages:
            return posters_list

        # Normalize language codes to lowercase
        preferred_languages = [
            lang.lower().strip() for lang in preferred_languages if lang
        ]

        # Group posters by language
        language_groups = {lang: [] for lang in preferred_languages}
        language_groups["other"] = []  # For languages not in preferences

        for poster in posters_list:
            poster_lang = (poster.get("iso_639_1") or "xx").lower()

            # Check if poster language matches any preferred language
            if poster_lang in preferred_languages:
                language_groups[poster_lang].append(poster)
            else:
                language_groups["other"].append(poster)

        # Build result list in order of preference
        result = []
        for lang in preferred_languages:
            result.extend(language_groups[lang])

        # Optionally add other languages at the end (commented out to only show preferred)
        # result.extend(language_groups['other'])

        return result

    try:
        # Load config to get TMDB token
        if not CONFIG_PATH.exists():
            raise HTTPException(status_code=404, detail="Config file not found")

        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            grouped_config = json.load(f)

        # Convert grouped config to flat structure
        if CONFIG_MAPPER_AVAILABLE:
            flat_config = flatten_config(grouped_config)
            tmdb_token = flat_config.get("tmdbtoken")
            preferred_language_order = flat_config.get("PreferredLanguageOrder", "")
            preferred_season_language_order = flat_config.get(
                "PreferredSeasonLanguageOrder", ""
            )
            preferred_background_language_order = flat_config.get(
                "PreferredBackgroundLanguageOrder", ""
            )
            preferred_tc_language_order = flat_config.get(
                "PreferredTCLanguageOrder", ""
            )
        else:
            # Fallback: Try both structures
            tmdb_token = grouped_config.get("tmdbtoken")
            if not tmdb_token and isinstance(grouped_config.get("ApiPart"), dict):
                tmdb_token = grouped_config["ApiPart"].get("tmdbtoken")

            # Try to get language preferences from different possible locations
            preferred_language_order = grouped_config.get("PreferredLanguageOrder", "")
            preferred_season_language_order = grouped_config.get(
                "PreferredSeasonLanguageOrder", ""
            )
            preferred_background_language_order = grouped_config.get(
                "PreferredBackgroundLanguageOrder", ""
            )
            preferred_tc_language_order = grouped_config.get(
                "PreferredTCLanguageOrder", ""
            )

            # If not found at root, try in ApiPart
            if not preferred_language_order and isinstance(
                grouped_config.get("ApiPart"), dict
            ):
                preferred_language_order = grouped_config["ApiPart"].get(
                    "PreferredLanguageOrder", ""
                )
            if not preferred_season_language_order and isinstance(
                grouped_config.get("ApiPart"), dict
            ):
                preferred_season_language_order = grouped_config["ApiPart"].get(
                    "PreferredSeasonLanguageOrder", ""
                )
            if not preferred_background_language_order and isinstance(
                grouped_config.get("ApiPart"), dict
            ):
                preferred_background_language_order = grouped_config["ApiPart"].get(
                    "PreferredBackgroundLanguageOrder", ""
                )
            if not preferred_tc_language_order and isinstance(
                grouped_config.get("ApiPart"), dict
            ):
                preferred_tc_language_order = grouped_config["ApiPart"].get(
                    "PreferredTCLanguageOrder", ""
                )

        # Parse language preferences (handle both string and list formats)
        def parse_language_order(value):
            """Convert language order to list, handling both string and list inputs"""
            if not value:
                return []
            if isinstance(value, list):
                # Already a list, just clean up entries
                return [lang.strip() for lang in value if lang and str(lang).strip()]
            if isinstance(value, str):
                # String format, split by comma
                return [lang.strip() for lang in value.split(",") if lang.strip()]
            return []

        language_order_list = parse_language_order(preferred_language_order)
        season_language_order_list = parse_language_order(
            preferred_season_language_order
        )
        background_language_order_list = parse_language_order(
            preferred_background_language_order
        )
        tc_language_order_list = parse_language_order(preferred_tc_language_order)

        # If TC language order is empty or "PleaseFillMe", fall back to standard poster language order
        if not tc_language_order_list or (
            len(tc_language_order_list) == 1
            and tc_language_order_list[0].lower() == "pleasefillme"
        ):
            logger.info(
                "TC language order not configured, using standard poster language order"
            )
            tc_language_order_list = language_order_list

        logger.info(
            f"Language preferences - Standard: {language_order_list}, Season: {season_language_order_list}, Background: {background_language_order_list}, TitleCard: {tc_language_order_list}"
        )

        if not tmdb_token:
            logger.error("TMDB token not found in config")
            logger.error(f"Config structure: {list(grouped_config.keys())}")
            raise HTTPException(status_code=400, detail="TMDB API token not configured")

        headers = {
            "Authorization": f"Bearer {tmdb_token}",
            "Content-Type": "application/json",
        }

        results = []
        tmdb_ids = []  # Changed to list to support multiple IDs

        # Log the incoming request for debugging
        logger.info(f"TMDB Search Request:")
        logger.info(f"   Query: '{request.query}'")
        logger.info(f"   Media Type: {request.media_type}")
        logger.info(f"   Poster Type: {request.poster_type}")
        logger.info(f"   Year: {request.year}")
        logger.info(f"   Is Digit: {request.query.isdigit()}")

        # Step 1: Get TMDB ID(s)
        # For numeric queries, we'll search both by ID AND by title to cover movies like "1917"
        if request.query.isdigit():
            # Try to use query as TMDB ID
            potential_id = request.query
            logger.info(f" Query is numeric - will search by ID: {potential_id}")
            tmdb_ids.append(("id", potential_id))

            # Also search by title for numeric queries (e.g., "1917", "2012")
            logger.info(
                f" Also searching by title for numeric query: '{request.query}'"
            )

        # Always do a title search (unless we only got an ID without title search)
        if not request.query.isdigit() or request.query.isdigit():
            # Query is a title - search for it
            allowed_media_types = {"movie": "movie", "tv": "tv"}
            if request.media_type not in allowed_media_types:
                raise ValueError(f"Invalid media_type: {request.media_type}")
            safe_media_type = allowed_media_types[request.media_type]
            search_url = f"https://api.themoviedb.org/3/search/{safe_media_type}"
            search_params = {"query": request.query, "page": 1}

            logger.info(
                f"Searching TMDB by title for: '{request.query}' (media_type: {request.media_type})"
            )

            # Add year parameter if provided
            if request.year:
                if request.media_type == "movie":
                    search_params["year"] = request.year
                    logger.info(f"   Adding year filter: {request.year}")
                elif request.media_type == "tv":
                    search_params["first_air_date_year"] = request.year
                    logger.info(f"   Adding first_air_date_year filter: {request.year}")

            search_response = requests.get(
                search_url, headers=headers, params=search_params, timeout=10
            )

            logger.info(f"   TMDB Response Status: {search_response.status_code}")

            if search_response.status_code == 200:
                search_data = search_response.json()
                search_results = search_data.get("results", [])
                logger.info(f"Found {len(search_results)} title search results")
                # Add all found IDs from title search (to get posters from multiple matches)
                for result in search_results[:5]:  # Limit to top 5 results
                    result_id = result.get("id")
                    result_title = result.get(
                        "title" if request.media_type == "movie" else "name"
                    )
                    if result_id and ("title", result_id) not in [
                        (t, i) for t, i in tmdb_ids
                    ]:
                        tmdb_ids.append(("title", result_id))
                        logger.info(
                            f"   Added result: ID={result_id}, Title='{result_title}'"
                        )
            else:
                logger.error(f"TMDB title search error: {search_response.status_code}")

        if not tmdb_ids:
            logger.warning(f"No TMDB IDs found for '{request.query}'")
            return {
                "success": True,
                "posters": [],
                "count": 0,
                "message": "No results found",
            }

        # Step 2 & 3: Loop through all found IDs and fetch images
        media_endpoint = "movie" if request.media_type == "movie" else "tv"
        seen_posters = set()  # Track unique poster paths to avoid duplicates

        for source_type, tmdb_id in tmdb_ids:
            logger.info(f" Processing TMDB ID {tmdb_id} (from {source_type} search)")

            # Get item details (for title)
            details_url = f"https://api.themoviedb.org/3/{media_endpoint}/{tmdb_id}"
            logger.info(f"Fetching details from: {details_url}")
            details_response = requests.get(details_url, headers=headers, timeout=10)
            logger.info(f"   Response Status: {details_response.status_code}")

            if details_response.status_code == 200:
                details = details_response.json()
                base_title = (
                    details.get("title") or details.get("name") or f"TMDB ID: {tmdb_id}"
                )
                logger.info(f"   Title: '{base_title}'")
            else:
                logger.warning(
                    f"   Failed to fetch details for ID {tmdb_id}: {details_response.status_code}"
                )
                if details_response.status_code == 404:
                    logger.error(
                        f"   TMDB ID {tmdb_id} not found for media_type '{request.media_type}'"
                    )
                    continue  # Skip this ID and try the next one
                details = {}
                base_title = f"TMDB ID: {tmdb_id}"

            # Fetch appropriate images based on poster_type
            if request.poster_type == "titlecard":
                # ========== TITLE CARDS (Episode Stills) ==========
                if not request.season_number or not request.episode_number:
                    raise HTTPException(
                        status_code=400,
                        detail="Season and episode numbers required for titlecards",
                    )

                # Get episode stills
                episode_url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{request.season_number}/episode/{request.episode_number}/images"
                episode_response = requests.get(
                    episode_url, headers=headers, timeout=10
                )

                if episode_response.status_code == 200:
                    episode_data = episode_response.json()
                    stills = episode_data.get("stills", [])

                    # Also get episode details for title
                    ep_details_url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{request.season_number}/episode/{request.episode_number}"
                    ep_details_response = requests.get(
                        ep_details_url, headers=headers, timeout=10
                    )
                    ep_details = (
                        ep_details_response.json()
                        if ep_details_response.status_code == 200
                        else {}
                    )
                    episode_title = ep_details.get(
                        "name", f"Episode {request.episode_number}"
                    )

                    title = f"{base_title} - S{request.season_number:02d}E{request.episode_number:02d}: {episode_title}"

                    # Filter and sort by PreferredTCLanguageOrder
                    filtered_stills = filter_and_sort_posters_by_language(
                        stills, tc_language_order_list
                    )

                    logger.info(
                        f"Title cards: {len(stills)} total, {len(filtered_stills)} after filtering by language preferences"
                    )

                    for still in filtered_stills:  # Load all stills
                        poster_path = still.get("file_path")
                        if poster_path not in seen_posters:
                            seen_posters.add(poster_path)
                            results.append(
                                {
                                    "tmdb_id": tmdb_id,
                                    "title": title,
                                    "poster_path": poster_path,
                                    "poster_url": f"https://image.tmdb.org/t/p/w500{poster_path}",
                                    "original_url": f"https://image.tmdb.org/t/p/original{poster_path}",
                                    "language": still.get("iso_639_1"),
                                    "vote_average": still.get("vote_average", 0),
                                    "width": still.get("width", 0),
                                    "height": still.get("height", 0),
                                    "type": "episode_still",
                                }
                            )
                else:
                    logger.warning(
                        f"No episode stills found for S{request.season_number}E{request.episode_number}"
                    )

            elif request.poster_type == "season":
                # ========== SEASON POSTERS ==========
                if not request.season_number:
                    raise HTTPException(
                        status_code=400,
                        detail="Season number required for season posters",
                    )

                # Get season posters
                season_url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{request.season_number}/images"
                season_response = requests.get(season_url, headers=headers, timeout=10)

                if season_response.status_code == 200:
                    season_data = season_response.json()
                    posters = season_data.get("posters", [])

                    # Get season details for title
                    season_details_url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{request.season_number}"
                    season_details_response = requests.get(
                        season_details_url, headers=headers, timeout=10
                    )
                    season_details = (
                        season_details_response.json()
                        if season_details_response.status_code == 200
                        else {}
                    )
                    season_name = season_details.get(
                        "name", f"Season {request.season_number}"
                    )

                    title = f"{base_title} - {season_name}"

                    # Filter and sort by PreferredSeasonLanguageOrder
                    filtered_posters = filter_and_sort_posters_by_language(
                        posters, season_language_order_list
                    )

                    logger.info(
                        f"Season posters: {len(posters)} total, {len(filtered_posters)} after filtering by language preferences"
                    )

                    for poster in filtered_posters:  # Load all posters
                        poster_path = poster.get("file_path")
                        if poster_path not in seen_posters:
                            seen_posters.add(poster_path)
                            results.append(
                                {
                                    "tmdb_id": tmdb_id,
                                    "title": title,
                                    "poster_path": poster_path,
                                    "poster_url": f"https://image.tmdb.org/t/p/w500{poster_path}",
                                    "original_url": f"https://image.tmdb.org/t/p/original{poster_path}",
                                    "language": poster.get("iso_639_1"),
                                    "vote_average": poster.get("vote_average", 0),
                                    "width": poster.get("width", 0),
                                    "height": poster.get("height", 0),
                                    "type": "season_poster",
                                }
                            )
                else:
                    logger.warning(
                        f"No season posters found for Season {request.season_number}"
                    )

            elif request.poster_type == "background":
                # ========== BACKGROUND IMAGES (Backdrops 16:9) ==========
                images_url = (
                    f"https://api.themoviedb.org/3/{media_endpoint}/{tmdb_id}/images"
                )
                images_response = requests.get(images_url, headers=headers, timeout=10)

                if images_response.status_code == 200:
                    images_data = images_response.json()
                    backdrops = images_data.get("backdrops", [])

                    # Filter and sort by PreferredBackgroundLanguageOrder
                    # If background language order is empty or "PleaseFillMe", fall back to standard poster language order
                    if not background_language_order_list or (
                        len(background_language_order_list) == 1
                        and background_language_order_list[0].lower() == "pleasefillme"
                    ):
                        logger.info(
                            "Background language order not configured, using standard poster language order"
                        )
                        filtered_backdrops = filter_and_sort_posters_by_language(
                            backdrops, language_order_list
                        )
                    else:
                        filtered_backdrops = filter_and_sort_posters_by_language(
                            backdrops, background_language_order_list
                        )

                    logger.info(
                        f"Background images: {len(backdrops)} total, {len(filtered_backdrops)} after filtering by language preferences"
                    )

                    for backdrop in filtered_backdrops:  # Load all backdrops
                        poster_path = backdrop.get("file_path")
                        if poster_path not in seen_posters:
                            seen_posters.add(poster_path)
                            results.append(
                                {
                                    "tmdb_id": tmdb_id,
                                    "title": base_title,
                                    "poster_path": poster_path,
                                    "poster_url": f"https://image.tmdb.org/t/p/w500{poster_path}",
                                    "original_url": f"https://image.tmdb.org/t/p/original{poster_path}",
                                    "language": backdrop.get("iso_639_1"),
                                    "vote_average": backdrop.get("vote_average", 0),
                                    "width": backdrop.get("width", 0),
                                    "height": backdrop.get("height", 0),
                                    "type": "backdrop",
                                }
                            )
                else:
                    logger.warning(f"No background images found for {base_title}")

            else:
                # ========== STANDARD POSTERS (Show/Movie) ==========
                images_url = (
                    f"https://api.themoviedb.org/3/{media_endpoint}/{tmdb_id}/images"
                )
                images_response = requests.get(images_url, headers=headers, timeout=10)

                if images_response.status_code == 200:
                    images_data = images_response.json()
                    posters = images_data.get("posters", [])

                    # Different filtering based on poster type
                    if request.poster_type == "collection":
                        # Collections: Only 'xx' (no language/international)
                        filtered_posters = [
                            p
                            for p in posters
                            if (p.get("iso_639_1") or "xx").lower() == "xx"
                        ]
                        logger.info(
                            f"Collection posters: {len(posters)} total, {len(filtered_posters)} after filtering (xx only)"
                        )
                    else:
                        # Standard posters: Filter and sort by PreferredLanguageOrder
                        filtered_posters = filter_and_sort_posters_by_language(
                            posters, language_order_list
                        )
                        logger.info(
                            f"Standard posters: {len(posters)} total, {len(filtered_posters)} after filtering by language preferences"
                        )

                    for poster in filtered_posters:  # Load all posters
                        poster_path = poster.get("file_path")
                        if poster_path not in seen_posters:
                            seen_posters.add(poster_path)
                            results.append(
                                {
                                    "tmdb_id": tmdb_id,
                                    "title": base_title,
                                    "poster_path": poster_path,
                                    "poster_url": f"https://image.tmdb.org/t/p/w500{poster_path}",
                                    "original_url": f"https://image.tmdb.org/t/p/original{poster_path}",
                                    "language": poster.get("iso_639_1"),
                                    "vote_average": poster.get("vote_average", 0),
                                    "width": poster.get("width", 0),
                                    "height": poster.get("height", 0),
                                    "type": "show_poster",
                                }
                            )

        logger.info(
            f"TMDB search for '{request.query}' ({request.poster_type}) returned {len(results)} images from {len(tmdb_ids)} ID(s)"
        )
        return {"success": True, "posters": results, "count": len(results)}

    except requests.RequestException as e:
        logger.error(f"TMDB API error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error communicating with TMDB API")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching TMDB posters: {e}")
        import traceback

        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Internal server error")


# ============================================================================
# MANUAL RUN ENDPOINTS - Must be defined BEFORE generic /api/run/{mode}
# ============================================================================

def generate_blueprint_override_config(blueprint_overrides: dict) -> str:
    import uuid
    import json
    from pathlib import Path

    if not CONFIG_DATABASE_AVAILABLE or not config_db:
        logger.error("Cannot generate blueprint config: config_db is unavailable")
        raise RuntimeError("config_db is unavailable")

    current_config = config_db.export_to_json()

    def deep_merge(source, destination):
        if destination is None:
            destination = {}
        for key, value in source.items():
            if isinstance(value, dict):
                destination[key] = deep_merge(value, destination.get(key) or {})
            else:
                destination[key] = value
        return destination

    merged_config = deep_merge(blueprint_overrides, current_config)

    def clean_case_duplicates(d):
        if isinstance(d, list):
            return [clean_case_duplicates(item) for item in d]
        elif not isinstance(d, dict):
            if isinstance(d, bool):
                return "true" if d else "false"
            return str(d) if d is not None else d

        new_d = {}
        seen_keys_lower = set()

        # Sort keys so that CamelCase comes before lowercase (e.g., 'S' before 's' in ASCII)
        for key in sorted(d.keys()):
            key_lower = key.lower()
            if key_lower not in seen_keys_lower:
                seen_keys_lower.add(key_lower)
                new_d[key] = clean_case_duplicates(d[key])

        return new_d

    merged_config = clean_case_duplicates(merged_config)

    TEMP_DIR.mkdir(exist_ok=True)
    temp_file = TEMP_DIR / f"posterizarr_override_{uuid.uuid4().hex}.json"

    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(merged_config, f, indent=4)

    return str(temp_file)

@app.post("/api/run-manual")
async def run_manual_mode(request: ManualModeRequest):
    """Run manual mode with custom parameters"""
    global current_process, current_mode, current_start_time

    # QUEUE HANDLING
    if request.add_to_queue:
        logger.info(f"Queuing manual run (PicturePath: {request.picturePath})")

        # Determine source type
        source_type = "url"
        # if not http/https, assume local path
        if not request.picturePath.lower().startswith("http"):
            source_type = "local_path"

        # Construct parameters for queue
        overlay_params = {
            "library_name": request.libraryName,
            "folder_name": request.folderName,
            "title_text": request.titletext,
            "poster_type": request.posterType,
            "season_number": request.seasonPosterName if request.posterType == "season" else None,
            "episode_number": request.episodeNumber if request.posterType == "titlecard" else None,
            "episode_title": request.epTitleName if request.posterType == "titlecard" else None,
            "process_with_overlays": True,
            "asset_type": request.posterType,
            "poster_with_text": request.posterWithText,
            "blueprint_overrides": request.blueprint_overrides,
        }

        # Construct a reference asset path
        filename = Path(request.picturePath).name
        # Sanitize filename
        import re
        filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
        asset_path = f"{request.libraryName}/{request.folderName}/{filename}"

        try:
            queue_manager.add_item(
                asset_path=asset_path,
                source_type=source_type,
                source_data=request.picturePath,
                overlay_params=overlay_params
            )
            return {"success": True, "message": "Manual run added to queue"}
        except Exception as e:
            logger.error(f"Failed to queue asset: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to add item to processing queue")

    with process_lock:
        # Debug logging
        logger.info(f"Manual mode request received for: {request.titletext} in {request.libraryName}")

        # Check if already running
        if current_process and current_process.poll() is None:
            raise HTTPException(
                status_code=400,
                detail="Script is already running. Please stop the script first.",
            )

        if not SCRIPT_PATH.exists():
            raise HTTPException(status_code=404, detail="Posterizarr.ps1 not found")

        # Validate required fields
        if not request.picturePath or not request.picturePath.strip():
            raise HTTPException(status_code=400, detail="Picture path is required")

        if  not request.folderName or not request.folderName.strip():
            raise HTTPException(status_code=400, detail="Folder name is required")

        if not request.libraryName or not request.libraryName.strip():
            raise HTTPException(status_code=400, detail="Library name is required")

        # Validate season poster
        if request.posterType == "season" and (
            not request.seasonPosterName or not request.seasonPosterName.strip()
        ):
            raise HTTPException(
                status_code=400, detail="Season poster name is required for season posters"
            )

        # Validate title card
        if request.posterType == "titlecard":
            if not request.epTitleName or not request.epTitleName.strip():
                raise HTTPException(
                    status_code=400, detail="Episode title name is required for title cards"
                )
            if not request.episodeNumber or not request.episodeNumber.strip():
                raise HTTPException(
                    status_code=400, detail="Episode number is required for title cards"
                )
            if not request.seasonPosterName or not request.seasonPosterName.strip():
                raise HTTPException(
                    status_code=400, detail="Season name is required for title cards"
                )

        # Determine PowerShell command
        import platform

        if platform.system() == "Windows":
            ps_command = "pwsh"
            try:
                subprocess.run([ps_command, "-v"], capture_output=True, check=True)
            except (subprocess.CalledProcessError, FileNotFoundError):
                ps_command = "powershell"
                logger.info("pwsh not found, using powershell instead")
        else:
            ps_command = "pwsh"

        # Build command based on poster type
        command = [
            ps_command,
            "-File",
            str(SCRIPT_PATH),
            "-Manual",
            "-PicturePath",
            request.picturePath.strip(),
        ]

        # Add poster type specific switches and parameters
        if request.posterType == "season":
            command.extend(
                [
                    "-SeasonPoster",
                    "-Titletext",
                    sanitize_command_arg(request.titletext),
                    "-FolderName",
                    sanitize_command_arg(request.folderName),
                    "-LibraryName",
                    sanitize_command_arg(request.libraryName),
                    "-SeasonPosterName",
                    sanitize_command_arg(request.seasonPosterName),
                ]
            )
        elif request.posterType == "collection":
            command.extend(
                [
                    "-CollectionCard",
                    "-Titletext",
                    sanitize_command_arg(request.titletext),
                    "-FolderName",
                    sanitize_command_arg(request.folderName),
                    "-LibraryName",
                    sanitize_command_arg(request.libraryName),
                ]
            )
        elif request.posterType == "background":
            command.extend(
                [
                    "-BackgroundCard",
                    "-Titletext",
                    sanitize_command_arg(request.titletext),
                    "-FolderName",
                    sanitize_command_arg(request.folderName),
                    "-LibraryName",
                    sanitize_command_arg(request.libraryName),
                ]
            )
        elif request.posterType == "titlecard":
            command.extend(
                [
                    "-TitleCard",
                    "-Titletext",
                    sanitize_command_arg(request.epTitleName),  # Use episode title as the main title
                    "-FolderName",
                    sanitize_command_arg(request.folderName),
                    "-LibraryName",
                    sanitize_command_arg(request.libraryName),
                    "-EPTitleName",
                    sanitize_command_arg(request.epTitleName),
                    "-SeasonPosterName",
                    sanitize_command_arg(request.seasonPosterName),
                    "-EpisodeNumber",
                    sanitize_command_arg(request.episodeNumber),
                ]
            )
        else:  # standard
            command.extend(
                [
                    "-Titletext",
                    sanitize_command_arg(request.titletext),
                    "-FolderName",
                    sanitize_command_arg(request.folderName),
                    "-LibraryName",
                    sanitize_command_arg(request.libraryName),
                ]
            )

        if request.posterWithText:
            command.append("-PosterWithText")

        if request.blueprint_overrides:
            temp_override_path = generate_blueprint_override_config(request.blueprint_overrides)
            command.extend(["-ConfigOverride", temp_override_path])

        try:
            logger.info(f"Running manual mode with parameters:")
            logger.info(f"  Picture Path: {request.picturePath}")
            logger.info(f"  Type: {request.posterType}")
            if request.posterType == "titlecard":
                logger.info(f"  Folder: {request.folderName}")
                logger.info(f"  Library: {request.libraryName}")
                logger.info(f"  Episode Title: {request.epTitleName}")
                logger.info(f"  Season: {request.seasonPosterName}")
                logger.info(f"  Episode Number: {request.episodeNumber}")
            elif request.posterType == "season":
                logger.info(f"  Title: {request.titletext}")
                logger.info(f"  Folder: {request.folderName}")
                logger.info(f"  Library: {request.libraryName}")
                logger.info(f"  Season: {request.seasonPosterName}")
            elif request.posterType == "collection":
                logger.info(f"  Title: {request.titletext}")
                logger.info(f"  Folder: {request.folderName}")
                logger.info(f"  Library: {request.libraryName}")
            else:
                logger.info(f"  Title: {request.titletext}")
                logger.info(f"  Folder: {request.folderName}")
                logger.info(f"  Library: {request.libraryName}")
            logger.info(f"Running command: {shlex.join(command)}")

            # Run the manual mode command
            current_process = subprocess.Popen(
                command,
                cwd=str(BASE_DIR),
                stdout=None,
                stderr=None,
                text=True,
            )
            current_mode = "manual"  # Set current mode to manual
            current_start_time = datetime.now().isoformat()

            logger.info(f"Started manual mode with PID {current_process.pid}")

            poster_type_display = {
                "standard": "standard poster",
                "season": "season poster",
                "collection": "collection poster",
                "titlecard": "episode title card",
            }

            return {
                "success": True,
                "message": f"Started manual mode for {poster_type_display.get(request.posterType, 'poster')}",
                "pid": current_process.pid,
            }
        except FileNotFoundError as e:
            error_msg = f"PowerShell not found. Please install PowerShell 7+ (pwsh) or ensure Windows PowerShell is in PATH."
            logger.error(error_msg)
            raise HTTPException(status_code=500, detail=error_msg)
        except Exception as e:
            logger.error(f"Error running manual mode: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/run-manual-upload")
async def run_manual_mode_upload(
    file: UploadFile = File(...),
    picturePath: str = Form(""),
    titletext: str = Form(""),
    folderName: str = Form(""),
    libraryName: str = Form(""),
    posterType: str = Form("standard"),
    seasonPosterName: str = Form(""),
    epTitleName: str = Form(""),
    episodeNumber: str = Form(""),
    add_to_queue: bool = Form(False),
    posterWithText: bool = Form(False),
    blueprint_overrides: Optional[str] = Form(None),
):
    """Run manual mode with uploaded file"""
    global current_process, current_mode, current_start_time

    with process_lock:
        logger.info(f"Manual mode upload request received")
        logger.info(f"  File: {file.filename if file else 'None'}")
        logger.info(f"  File content type: {file.content_type if file else 'None'}")
        logger.info(f"  Poster Type: {posterType}")
        logger.info(f"  Title Text: '{titletext}'")
        logger.info(f"  Folder Name: '{folderName}'")
        logger.info(f"  Library Name: '{libraryName}'")
        logger.info(f"  Season Poster Name: '{seasonPosterName}'")
        logger.info(f"  Episode Title Name: '{epTitleName}'")
        logger.info(f"  Episode Number: '{episodeNumber}'")
        logger.info(f"  Add to Queue: {add_to_queue}")

        # Check if already running (ONLY block if we are NOT queuing)
        if current_process and current_process.poll() is None:
            if not add_to_queue:
                error_msg = "Script is already running. Please stop the script first."
                logger.error(f"Manual upload rejected: {error_msg}")
                raise HTTPException(status_code=400, detail=error_msg)
            else:
                logger.info("Script is currently running, but request is to queue. Proceeding with upload.")

        if not SCRIPT_PATH.exists() and not add_to_queue:
            error_msg = "Posterizarr.ps1 not found"
            logger.error(f"Manual upload failed: {error_msg}")
            raise HTTPException(status_code=404, detail=error_msg)

        # Validate file upload
        if not file:
            error_msg = "No file uploaded"
            logger.error(f"Manual upload validation failed: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)

        # Validate file type
        allowed_extensions = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"]
        file_extension = Path(file.filename).suffix.lower()
        if file_extension not in allowed_extensions:
            error_msg = f"Invalid file type '{file_extension}'. Allowed: {', '.join(allowed_extensions)}"
            logger.error(f"Manual upload validation failed: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)

        # Validate required fields
        if not folderName.strip():
            error_msg = "Folder name is required"
            logger.error(f"Manual upload validation failed: {error_msg} (posterType: {posterType})")
            raise HTTPException(status_code=400, detail=error_msg)

        if not libraryName.strip():
            error_msg = "Library name is required"
            logger.error(f"Manual upload validation failed: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)

        if posterType == "season" and not seasonPosterName.strip():
            error_msg = "Season poster name is required for season posters"
            logger.error(f"Manual upload validation failed: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)

        if posterType == "titlecard":
            if not epTitleName.strip():
                error_msg = "Episode title name is required for title cards"
                logger.error(f"Manual upload validation failed: {error_msg}")
                raise HTTPException(status_code=400, detail=error_msg)
            if not episodeNumber.strip():
                error_msg = "Episode number is required for title cards"
                logger.error(f"Manual upload validation failed: {error_msg}")
                raise HTTPException(status_code=400, detail=error_msg)
            if not seasonPosterName.strip():
                error_msg = "Season name is required for title cards"
                logger.error(f"Manual upload validation failed: {error_msg}")
                raise HTTPException(status_code=400, detail=error_msg)

        try:
            # Create uploads directory if it doesn't exist with permission check
            try:
                UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
                # Verify write permissions
                test_file = UPLOADS_DIR / ".write_test"
                test_file.touch()
                test_file.unlink()
            except PermissionError as e:
                logger.error(f"No write permission for uploads directory: {UPLOADS_DIR}")
                raise HTTPException(
                    status_code=500,
                    detail=f"No write permission for uploads directory. This may be a Docker/NAS permission issue. Please check folder permissions.",
                )
            except Exception as e:
                logger.error(f"Error creating uploads directory: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Cannot create uploads directory: {str(e)}",
                )

            # Generate unique filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            # Sanitize filename to prevent path traversal and special characters
            safe_name = "".join(
                c for c in file.filename if c.isalnum() or c in "._- "
            ).strip()
            if not safe_name:
                safe_name = "upload.jpg"
            safe_filename = f"{timestamp}_{safe_name}"
            upload_path = UPLOADS_DIR / safe_filename

            # Save uploaded file to uploads directory
            logger.info(f"Saving uploaded file to: {upload_path}")
            logger.info(f"Upload directory: {UPLOADS_DIR.resolve()}")
            logger.info(f"Is Docker: {IS_DOCKER}")

            try:
                content = await file.read()
                if len(content) == 0:
                    raise HTTPException(status_code=400, detail="Uploaded file is empty")

                # Validate image aspect ratio
                try:
                    from PIL import Image
                    import io

                    # Open image from bytes
                    img = Image.open(io.BytesIO(content))
                    width, height = img.size
                    logger.info(f"Manual upload image dimensions: {width}x{height} pixels")

                    # Define target ratios and tolerance
                    POSTER_RATIO = 2 / 3  # 0.666...
                    BACKGROUND_RATIO = 16 / 9  # 1.777...
                    # Tolerance allows for minor pixel deviations
                    TOLERANCE = 0.05

                    # Check for zero height
                    if height == 0:
                        error_msg = "Image height cannot be zero."
                        logger.error(error_msg)
                        raise HTTPException(status_code=400, detail=error_msg)

                    image_ratio = width / height
                    logger.info(f"Image ratio calculated as: {image_ratio}")

                    # Check aspect ratio based on poster type
                    if posterType in ["standard", "season", "collection"]:
                        # Check for 2:3 ratio
                        if abs(image_ratio - POSTER_RATIO) > TOLERANCE:
                            error_msg = (
                                f"Invalid aspect ratio for poster. Image is {width}x{height} "
                                f"(ratio ~{image_ratio:.2f}), but must be 2:3 "
                                f"(ratio ~{POSTER_RATIO:.2f})."
                            )
                            logger.error(error_msg)
                            raise HTTPException(status_code=400, detail=error_msg)
                        logger.info("Image aspect ratio validated as 2:3.")

                    elif posterType in ["background", "titlecard"]:
                        # Check for 16:9 ratio
                        if abs(image_ratio - BACKGROUND_RATIO) > TOLERANCE:
                            error_msg = (
                                f"Invalid aspect ratio for background/title card. Image is {width}x{height} "
                                f"(ratio ~{image_ratio:.2f}), but must be 16:9 "
                                f"(ratio ~{BACKGROUND_RATIO:.2f})."
                            )
                            logger.error(error_msg)
                            raise HTTPException(status_code=400, detail=error_msg)
                        logger.info("Image aspect ratio validated as 16:9.")

                except HTTPException:
                    # Re-raise HTTP exceptions (ratio validation failures)
                    raise
                except Exception as e:
                    logger.warning(
                        f"Could not validate image dimensions for manual upload: {e}"
                    )
                    # Don't fail upload if dimension check itself fails

                with open(upload_path, "wb") as buffer:
                    buffer.write(content)

                # Verify file was written
                if not upload_path.exists():
                    raise HTTPException(
                        status_code=500, detail="File was not saved successfully"
                    )

                actual_size = upload_path.stat().st_size
                if actual_size != len(content):
                    logger.warning(
                        f"File size mismatch: expected {len(content)}, got {actual_size}"
                    )

            except PermissionError as e:
                logger.error(f"Permission denied writing file: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Permission denied: Unable to write uploaded file. Check Docker/NAS/Unraid volume permissions.",
                )
            except OSError as e:
                logger.error(f"OS error writing file: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"File system error: {str(e)}. This may be a Docker volume mount issue.",
                )

            logger.info(f"File saved successfully: {upload_path} ({len(content)} bytes)")

            # ==========================================
            # NEW QUEUE LOGIC INJECTED HERE
            # ==========================================
            if add_to_queue:
                logger.info("Queuing manual upload")

                # Construct parameters for queue
                overlay_params = {
                    "library_name": libraryName,
                    "folder_name": folderName,
                    "title_text": titletext,
                    "poster_type": posterType,
                    "season_number": seasonPosterName if posterType == "season" else None,
                    "episode_number": episodeNumber if posterType == "titlecard" else None,
                    "episode_title": epTitleName if posterType == "titlecard" else None,
                    "process_with_overlays": True,
                    "asset_type": posterType,
                    "poster_with_text": posterWithText,
                    "blueprint_overrides": json.loads(blueprint_overrides) if blueprint_overrides else None,
                }

                # Construct a reference asset path
                filename = Path(file.filename).name
                import re
                filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
                asset_path = f"{libraryName}/{folderName}/{filename}"

                try:
                    queue_manager.add_item(
                        asset_path=asset_path,
                        source_type="upload",
                        source_data=str(upload_path), # Path to the file we just saved
                        overlay_params=overlay_params
                    )
                    return {
                         "success": True,
                         "message": "Manual run queued successfully",
                         "upload_path": str(upload_path)
                    }
                except Exception as e:
                    logger.error(f"Failed to queue background: {e}", exc_info=True)
                    raise HTTPException(status_code=500, detail="Failed to add background to processing queue")
            # ==========================================

            # ==========================================
            # OLD MANUAL EXECUTION LOGIC (runs if not queued)
            # ==========================================

            # Determine PowerShell command
            import platform

            if platform.system() == "Windows":
                ps_command = "pwsh"
                try:
                    subprocess.run([ps_command, "-v"], capture_output=True, check=True)
                except (subprocess.CalledProcessError, FileNotFoundError):
                    ps_command = "powershell"
                    logger.info("pwsh not found, using powershell instead")
            else:
                ps_command = "pwsh"

            # Build command with uploaded file path
            command = [
                ps_command,
                "-File",
                str(SCRIPT_PATH),
                "-Manual",
                "-PicturePath",
                str(upload_path),  # Use the uploaded file path
            ]

            # Add poster type specific switches and parameters
            if posterType == "season":
                command.extend(
                    [
                        "-SeasonPoster",
                        "-Titletext",
                        titletext.strip(),
                        "-FolderName",
                        folderName.strip(),
                        "-LibraryName",
                        libraryName.strip(),
                        "-SeasonPosterName",
                        seasonPosterName.strip(),
                    ]
                )
            elif posterType == "collection":
                command.extend(
                    [
                        "-CollectionCard",
                        "-Titletext",
                        titletext.strip(),
                        "-FolderName",
                        folderName.strip(),
                        "-LibraryName",
                        libraryName.strip(),
                    ]
                )
            elif posterType == "background":
                command.extend(
                    [
                        "-BackgroundCard",
                        "-Titletext",
                        titletext.strip(),
                        "-FolderName",
                        folderName.strip(),
                        "-LibraryName",
                        libraryName.strip(),
                    ]
                )
            elif posterType == "titlecard":
                command.extend(
                    [
                        "-TitleCard",
                        "-Titletext",
                        epTitleName.strip(),
                        "-FolderName",
                        folderName.strip(),
                        "-LibraryName",
                        libraryName.strip(),
                        "-EPTitleName",
                        epTitleName.strip(),
                        "-SeasonPosterName",
                        seasonPosterName.strip(),
                        "-EpisodeNumber",
                        episodeNumber.strip(),
                    ]
                )
            else:  # standard
                command.extend(
                    [
                        "-Titletext",
                        titletext.strip(),
                        "-FolderName",
                        folderName.strip(),
                        "-LibraryName",
                        libraryName.strip(),
                    ]
                )

            if posterWithText:
                command.append("-PosterWithText")

            logger.info(f"Running manual mode with uploaded file:")
            logger.info(f"  Picture Path: {upload_path}")
            logger.info(f"  Type: {posterType}")
            logger.info(f"Running command: {' '.join(command)}")

            # Run the manual mode command
            current_process = subprocess.Popen(
                command,
                cwd=str(BASE_DIR),
                stdout=None,
                stderr=None,
                text=True,
            )
            current_mode = "manual"
            current_start_time = datetime.now().isoformat()

            logger.info(f"Started manual mode with PID {current_process.pid}")

            # Schedule cleanup after process completes (in background)
            async def cleanup_upload():
                """Cleanup uploaded file after process completes"""
                try:
                    # Wait for process to complete
                    while current_process.poll() is None:
                        await asyncio.sleep(1)

                    # Wait a bit more to ensure file operations are complete
                    await asyncio.sleep(5)

                    # Delete the uploaded file
                    if upload_path.exists():
                        upload_path.unlink()
                        logger.info(f"Cleaned up uploaded file: {upload_path}")
                except Exception as e:
                    logger.error(f"Error cleaning up uploaded file: {e}")

            # Start cleanup task in background
            asyncio.create_task(cleanup_upload())

            poster_type_display = {
                "standard": "standard poster",
                "season": "season poster",
                "collection": "collection poster",
                "titlecard": "episode title card",
                "background": "background poster",
            }

            return {
                "success": True,
                "message": f"Started manual mode for {poster_type_display.get(posterType, 'poster')}",
                "pid": current_process.pid,
                "upload_path": str(upload_path),
            }
        except HTTPException:
            # Re-raise HTTPExceptions as they are already properly formatted
            raise
        except FileNotFoundError as e:
            error_msg = f"PowerShell not found. Please install PowerShell 7+ (pwsh) or ensure Windows PowerShell is in PATH."
            logger.error(f"Manual upload failed: {error_msg}")
            logger.error(f"Exception details: {e}")
            raise HTTPException(status_code=500, detail=error_msg)
        except Exception as e:
            error_msg = f"Error running manual mode with uploaded file: {str(e)}"
            logger.error(error_msg)
            logger.exception("Full traceback:")
            raise HTTPException(status_code=500, detail="Internal server error")


# ============================================================================
# GENERIC RUN ENDPOINT - Must be defined AFTER specific endpoints like /api/run-manual
# ============================================================================
@app.post("/api/run/{mode}")
async def run_script(mode: str):
    """Run Posterizarr script in different modes"""
    global current_process, current_mode, current_start_time

    with process_lock:
        # Check if already running
        if current_process and current_process.poll() is None:
            raise HTTPException(status_code=400, detail="Script is already running")

        if not SCRIPT_PATH.exists():
            raise HTTPException(status_code=404, detail="Posterizarr.ps1 not found")

        # Determine PowerShell command
        import platform

        if platform.system() == "Windows":
            ps_command = "pwsh"
            try:
                subprocess.run([ps_command, "-v"], capture_output=True, check=True)
            except (subprocess.CalledProcessError, FileNotFoundError):
                ps_command = "powershell"
                logger.info("pwsh not found, using powershell instead")
        else:
            ps_command = "pwsh"

        # Determine command based on mode
        commands = {
            "normal": [ps_command, "-File", str(SCRIPT_PATH)],
            "testing": [ps_command, "-File", str(SCRIPT_PATH), "-Testing"],
            "manual": [ps_command, "-File", str(SCRIPT_PATH), "-Manual"],
            "backup": [ps_command, "-File", str(SCRIPT_PATH), "-Backup"],
            "restore": [ps_command, "-File", str(SCRIPT_PATH), "-Restore"],
            "syncjelly": [ps_command, "-File", str(SCRIPT_PATH), "-SyncJelly"],
            "syncemby": [ps_command, "-File", str(SCRIPT_PATH), "-SyncEmby"],
        }

        if mode not in commands:
            raise HTTPException(status_code=400, detail=f"Invalid mode: {mode}")

        try:
            logger.info(f"Running command: {' '.join(commands[mode])}")
            current_process = subprocess.Popen(
                commands[mode],
                cwd=str(BASE_DIR),
                stdout=None,
                stderr=None,
                text=True,
            )
            current_mode = mode  # Set current mode
            current_start_time = datetime.now().isoformat()
            logger.info(
                f"Started Posterizarr in {mode} mode with PID {current_process.pid}"
            )
            return {
                "success": True,
                "message": f"Started in {mode} mode",
                "pid": current_process.pid,
            }
        except FileNotFoundError as e:
            error_msg = f"PowerShell not found. Please install PowerShell 7+ (pwsh) or ensure Windows PowerShell is in PATH. Error: {str(e)}"
            logger.error(error_msg)
            raise HTTPException(status_code=500, detail=error_msg)
        except Exception as e:
            logger.error(f"Error starting script: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/reset-posters")
async def reset_posters(request: ResetPostersRequest):
    """Reset all posters in a Plex library"""
    global current_process, current_mode, current_start_time
    with process_lock:
        # Check if script is running
        if current_process and current_process.poll() is None:
            raise HTTPException(
                status_code=400,
                detail="Cannot reset posters while script is running. Please stop the script first.",
            )

        if not SCRIPT_PATH.exists():
            raise HTTPException(status_code=404, detail="Posterizarr.ps1 not found")

        if not request.library or not request.library.strip():
            raise HTTPException(status_code=400, detail="Library name is required")

        # Determine PowerShell command
        import platform

        if platform.system() == "Windows":
            ps_command = "pwsh"
            try:
                subprocess.run([ps_command, "-v"], capture_output=True, check=True)
            except (subprocess.CalledProcessError, FileNotFoundError):
                ps_command = "powershell"
                logger.info("pwsh not found, using powershell instead")
        else:
            ps_command = "pwsh"

        # Build command with PosterReset switch and library parameter
        command = [
            ps_command,
            "-File",
            str(SCRIPT_PATH),
            "-PosterReset",
            "-LibraryToReset",
            sanitize_command_arg(request.library),
        ]

        try:
            logger.info(f"Resetting posters for library: {request.library}")
            logger.info(f"Running command: {shlex.join(command)}")

            # Run the reset command
            current_process = subprocess.Popen(
                command,
                cwd=str(BASE_DIR),
                stdout=None,
                stderr=None,
                text=True,
            )
            current_mode = "reset"  # Set current mode to reset
            current_start_time = datetime.now().isoformat()

            logger.info(
                f"Started poster reset for library '{request.library}' with PID {current_process.pid}"
            )

            return {
                "success": True,
                "message": f"Started resetting posters for library: {request.library}",
                "pid": current_process.pid,
            }
        except FileNotFoundError as e:
            error_msg = f"PowerShell not found. Please install PowerShell 7+ (pwsh) or ensure Windows PowerShell is in PATH. Error: {str(e)}"
            logger.error(error_msg)
            raise HTTPException(status_code=500, detail=error_msg)
        except Exception as e:
            logger.error(f"Error resetting posters: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/run-logoupdater")
async def run_logoupdater(request: LogoUpdaterRequest):
    """Run LogoUpdater mode for a specific Plex library"""
    global current_process, current_mode, current_start_time
    with process_lock:
        if current_process and current_process.poll() is None:
            raise HTTPException(
                status_code=400,
                detail="Cannot run LogoUpdater while script is already running.",
            )

        if not SCRIPT_PATH.exists():
            raise HTTPException(status_code=404, detail="Posterizarr.ps1 not found")

        if not request.library or not request.library.strip():
            raise HTTPException(status_code=400, detail="Library name is required")

        import platform
        if platform.system() == "Windows":
            ps_command = "pwsh"
            try:
                subprocess.run([ps_command, "-v"], capture_output=True, check=True)
            except (subprocess.CalledProcessError, FileNotFoundError):
                ps_command = "powershell"
        else:
            ps_command = "pwsh"

        command = [
            ps_command,
            "-File",
            str(SCRIPT_PATH),
        ]

        if request.revert:
            command.append("-LogoRevert")
        else:
            command.append("-LogoUpdater")

        command.extend([
            "-LibraryName",
            request.library.strip(),
        ])

        if request.force_replace:
            command.append("-ForceReplace")

        try:
            logger.info(f"Running LogoUpdater for library: {request.library}")
            current_process = subprocess.Popen(
                command,
                cwd=str(BASE_DIR),
                stdout=None,
                stderr=None,
                text=True,
            )
            current_mode = "logoupdater"
            current_start_time = datetime.now().isoformat()
            return {
                "success": True,
                "message": f"Started LogoUpdater for library: {request.library}",
                "pid": current_process.pid,
            }
        except Exception as e:
            logger.error(f"Error running LogoUpdater: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/run-restore")
async def run_restore(request: RestoreModeRequest):
    """Run Restore mode with optional filters"""
    global current_process, current_mode, current_start_time
    with process_lock:
        if current_process and current_process.poll() is None:
            raise HTTPException(
                status_code=400,
                detail="Cannot run Restore while script is already running.",
            )

        if not SCRIPT_PATH.exists():
            raise HTTPException(status_code=404, detail="Posterizarr.ps1 not found")

        import platform
        if platform.system() == "Windows":
            ps_command = "pwsh"
            try:
                subprocess.run([ps_command, "-v"], capture_output=True, check=True)
            except (subprocess.CalledProcessError, FileNotFoundError):
                ps_command = "powershell"
        else:
            ps_command = "pwsh"

        command = [
            ps_command,
            "-File",
            str(SCRIPT_PATH),
            "-Restore"
        ]

        if request.library_name:
            command.extend(["-RestoreLibrary", request.library_name.strip()])
        if request.item_name:
            command.extend(["-RestoreItem", request.item_name.strip()])
        if request.asset_type:
            command.extend(["-RestoreType", request.asset_type.strip()])

        try:
            logger.info(f"Running Restore for library: {request.library_name}, item: {request.item_name}, type: {request.asset_type}")
            current_process = subprocess.Popen(
                command,
                cwd=str(BASE_DIR),
                stdout=None,
                stderr=None,
                text=True,
            )
            current_mode = "restore"
            current_start_time = datetime.now().isoformat()
            return {
                "success": True,
                "message": f"Started Restore mode",
                "pid": current_process.pid,
            }
        except Exception as e:
            logger.error(f"Error running Restore: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/stop")
async def stop_script():
    """Stop running script gracefully - works for both manual and scheduled runs"""
    global current_process, current_mode, current_start_time

    with process_lock:
        # Check if manual process is running
        manual_running = current_process and current_process.poll() is None

        # Check if scheduler process is running
        scheduler_running = False
        if SCHEDULER_AVAILABLE and scheduler:
            scheduler_running = scheduler.is_running and scheduler.current_process

        # If nothing is running
        if not manual_running and not scheduler_running:
            return {"success": False, "message": "No script is running"}

        try:
            stopped_processes = []

            # Stop manual process if running
            if manual_running:
                try:
                    current_process.terminate()
                    current_process.wait(timeout=5)
                    current_process = None
                    current_mode = None
                    current_start_time = None
                    stopped_processes.append("manual")
                except subprocess.TimeoutExpired:
                    current_process.kill()
                    current_process = None
                    current_mode = None
                    current_start_time = None
                    stopped_processes.append("manual (force killed after timeout)")

            # Stop scheduler process if running
            if scheduler_running:
                try:
                    scheduler.current_process.terminate()
                    scheduler.current_process.wait(timeout=5)
                    scheduler.current_process = None
                    scheduler.is_running = False
                    stopped_processes.append("scheduled")
                except subprocess.TimeoutExpired:
                    scheduler.current_process.kill()
                    scheduler.current_process = None
                    scheduler.is_running = False
                    stopped_processes.append("scheduled (force killed after timeout)")
                except Exception as e:
                    logger.error(f"Error stopping scheduler process: {e}")

            if stopped_processes:
                message = f"Stopped: {', '.join(stopped_processes)}"
                return {"success": True, "message": message}
            else:
                return {"success": False, "message": "Failed to stop processes"}

        except Exception as e:
            logger.error(f"Error stopping script: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/force-kill")
async def force_kill_script():
    """Force kill running script immediately - works for both manual and scheduled runs"""
    global current_process, current_mode, current_start_time

    with process_lock:
        # Check if manual process is running
        manual_running = current_process and current_process.poll() is None

        # Check if scheduler process is running
        scheduler_running = False
        if SCHEDULER_AVAILABLE and scheduler:
            scheduler_running = scheduler.is_running and scheduler.current_process

        # If nothing is running
        if not manual_running and not scheduler_running:
            return {"success": False, "message": "No script is running"}

        try:
            killed_processes = []

            # Kill manual process if running
            if manual_running:
                try:
                    current_process.kill()
                    current_process.wait(timeout=2)
                    current_process = None
                    current_mode = None
                    current_start_time = None
                    killed_processes.append("manual")
                    logger.warning("Manual script was force killed")
                except Exception as e:
                    logger.error(f"Error force killing manual process: {e}")
                    current_process = None
                    current_mode = None
                    current_start_time = None
                    killed_processes.append("manual (cleared)")

            # Kill scheduler process if running
            if scheduler_running:
                try:
                    scheduler.current_process.kill()
                    scheduler.current_process.wait(timeout=2)
                    scheduler.current_process = None
                    scheduler.is_running = False
                    killed_processes.append("scheduled")
                    logger.warning("Scheduled script was force killed")
                except Exception as e:
                    logger.error(f"Error force killing scheduler process: {e}")
                    scheduler.current_process = None
                    scheduler.is_running = False
                    killed_processes.append("scheduled (cleared)")

            if killed_processes:
                message = f"Force killed: {', '.join(killed_processes)}"
                return {"success": True, "message": message}
            else:
                return {"success": False, "message": "Failed to kill processes"}

        except Exception as e:
            logger.error(f"Error force killing script: {e}")
            # Try to set to None anyway
            current_process = None
            current_mode = None
            current_start_time = None
            if SCHEDULER_AVAILABLE and scheduler:
                scheduler.current_process = None
                scheduler.is_running = False
            return {"success": True, "message": "Script process cleared"}


@app.get("/api/logs")
async def get_logs():
    """Get available log files from both Logs and UILogs directories"""
    log_files = []

    # Get logs from main Logs directory
    if LOGS_DIR.exists():
        for log_file in LOGS_DIR.glob("*.log"):
            stat = log_file.stat()
            log_files.append(
                {
                    "name": log_file.name,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "directory": "Logs",
                }
            )

    # Get logs from UILogs directory
    if UI_LOGS_DIR.exists():
        for log_file in UI_LOGS_DIR.glob("*.log"):
            stat = log_file.stat()
            log_files.append(
                {
                    "name": log_file.name,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "directory": "UILogs",
                }
            )

    return {"logs": sorted(log_files, key=lambda x: x["modified"], reverse=True)}


@app.get("/api/logs/{log_name}")
async def get_log_content(log_name: str, tail: int = 100):
    """Get log file content from either Logs or UILogs directory"""
    # Try Logs directory first
    log_path = LOGS_DIR / log_name

    # If not found, try UILogs directory
    if not log_path.exists():
        log_path = UI_LOGS_DIR / log_name

    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Log file not found")

    try:
        with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            return {"content": lines[-tail:] if tail else lines}
    except Exception as e:
        logger.error(f"Error reading log: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/logs/ui/unified")
async def get_unified_ui_logs(tail: int = 500):
    """
    Get unified UI logs from FrontendUI.log with both backend and frontend entries
    Returns chronologically sorted logs with source identification
    """
    try:
        ui_log_path = UI_LOGS_DIR / "FrontendUI.log"

        if not ui_log_path.exists():
            return {"logs": [], "total": 0, "message": "No UI logs available yet"}

        import re
        from datetime import datetime

        logs = []

        with open(ui_log_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()

        # Parse each log line
        # Backend format: [TIMESTAMP] [LEVEL] [BACKEND:module:function:line] - MESSAGE
        # Frontend format: [TIMESTAMP] [LEVEL] [UI:Component] - MESSAGE

        backend_pattern = re.compile(
            r"^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[BACKEND:([^\]]+)\]\s+-\s+(.*)$"
        )
        frontend_pattern = re.compile(
            r"^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[UI:([^\]]+)\]\s+-\s+(.*)$"
        )

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Try backend format
            backend_match = backend_pattern.match(line)
            if backend_match:
                timestamp_str, level, module_info, message = backend_match.groups()
                logs.append(
                    {
                        "timestamp": timestamp_str,
                        "level": level.strip(),
                        "source": "backend",
                        "component": module_info,
                        "message": message,
                        "raw": line,
                    }
                )
                continue

            # Try frontend format
            frontend_match = frontend_pattern.match(line)
            if frontend_match:
                timestamp_str, level, component, message = frontend_match.groups()
                logs.append(
                    {
                        "timestamp": timestamp_str,
                        "level": level.strip(),
                        "source": "frontend",
                        "component": component,
                        "message": message,
                        "raw": line,
                    }
                )
                continue

            # If no pattern matches, include as raw log
            logs.append(
                {
                    "timestamp": "",
                    "level": "UNKNOWN",
                    "source": "unknown",
                    "component": "",
                    "message": line,
                    "raw": line,
                }
            )

        # Sort by timestamp (most recent last)
        def parse_timestamp(log_entry):
            try:
                if log_entry["timestamp"]:
                    return datetime.strptime(
                        log_entry["timestamp"], "%Y-%m-%d %H:%M:%S"
                    )
                return datetime.min
            except (ValueError, TypeError):
                return datetime.min

        logs.sort(key=parse_timestamp)

        # Return last N entries
        result_logs = logs[-tail:] if tail and len(logs) > tail else logs

        return {"logs": result_logs, "total": len(result_logs), "total_all": len(logs)}

    except Exception as e:
        logger.error(f"Error reading unified UI logs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/logs/{log_name}/exists")
async def check_log_exists(log_name: str):
    """Check if a log file exists (for waiting until script creates log)"""
    # Try Logs directory first
    log_path = LOGS_DIR / log_name

    # If not found, try UILogs directory
    if not log_path.exists():
        log_path = UI_LOGS_DIR / log_name

    exists = log_path.exists()

    return {
        "exists": exists,
        "log_name": log_name,
        "path": str(log_path) if exists else None,
    }


@app.websocket("/ws/logs")
async def websocket_logs(
    websocket: WebSocket, log_file: Optional[str] = Query("Scriptlog.log")
):
    """
    WebSocket endpoint for REAL-TIME log streaming

    Now properly accepts and respects the log_file query parameter
    - Frontend can specify which log file to watch
    - Backend won't override user's manual selection
    - Only auto-switches if user is watching the "active" log for current mode
    """
    await websocket.accept()
    logger.info(f"WebSocket connection established for log: {log_file}")

    # Determine which log file to monitor - check both directories
    log_path = LOGS_DIR / log_file
    if not log_path.exists():
        log_path = UI_LOGS_DIR / log_file

    # Track if user explicitly requested a specific log file
    user_requested_log = log_file != "Scriptlog.log"  # User manually selected a log

    # Map modes to their log files for dynamic switching
    mode_log_map = {
        "normal": "Scriptlog.log",
        "testing": "Testinglog.log",
        "manual": "Manuallog.log",
        "backup": "Scriptlog.log",
        "syncjelly": "Scriptlog.log",
        "syncemby": "Scriptlog.log",
        "reset": "Scriptlog.log",
        "scheduled": "Scriptlog.log",
    }

    try:
        # Send initial logs (increased to 100 lines)
        if log_path.exists():
            with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()[-100:]
                for line in lines:
                    stripped = line.strip()
                    if stripped:  # Only send non-empty lines
                        await websocket.send_json({"type": "log", "content": stripped})

        # Monitor log file for changes with dynamic log file switching
        last_position = log_path.stat().st_size if log_path.exists() else 0
        last_mode = current_mode
        current_log_file = log_file  # Track current log file being watched

        loop_count = 0
        while True:
            try:
                # FASTER POLLING: 0.3s instead of 1s
                await asyncio.sleep(0.3)

                # Send ping every ~15 seconds to prevent proxy idle timeouts
                loop_count += 1
                if loop_count >= 50:
                    await websocket.send_json({"type": "ping"})
                    loop_count = 0
            except asyncio.CancelledError:
                logger.info("WebSocket log streaming cancelled (connection closed)")
                break

            # Only auto-switch if user didn't manually request a specific log
            # AND the current mode changed
            if (
                not user_requested_log
                and current_mode != last_mode
                and current_mode in mode_log_map
            ):
                new_log_file = mode_log_map[current_mode]

                # Only switch if it's actually a different file
                if new_log_file != current_log_file:
                    logger.info(
                        f"WebSocket auto-switching from {current_log_file} to {new_log_file} (mode: {current_mode})"
                    )

                    current_log_file = new_log_file
                    # Check both directories for the new log file
                    log_path = LOGS_DIR / new_log_file
                    if not log_path.exists():
                        log_path = UI_LOGS_DIR / new_log_file
                    last_position = log_path.stat().st_size if log_path.exists() else 0

                    # Notify client about log file change
                    await websocket.send_json(
                        {
                            "type": "log_file_changed",
                            "log_file": new_log_file,
                            "mode": current_mode,
                        }
                    )

                last_mode = current_mode
            elif user_requested_log and current_mode != last_mode:
                # User manually requested a log, just update last_mode without switching
                last_mode = current_mode
                logger.debug(
                    f"Mode changed to {current_mode}, but user manually selected {log_file}, not auto-switching"
                )

            # Monitor current log file
            if log_path.exists():
                try:
                    current_size = log_path.stat().st_size

                    # Handle log file truncation/rotation
                    if current_size < last_position:
                        last_position = 0
                        logger.info(
                            f"Log file {log_path.name} was truncated or rotated"
                        )

                    if current_size > last_position:
                        with open(
                            log_path, "r", encoding="utf-8", errors="ignore"
                        ) as f:
                            f.seek(last_position)
                            new_lines = f.readlines()

                            # Send new lines immediately as they come
                            for line in new_lines:
                                stripped = line.strip()
                                if stripped:  # Only send non-empty lines
                                    await websocket.send_json(
                                        {"type": "log", "content": stripped}
                                    )

                        last_position = current_size
                except OSError as e:
                    logger.warning(f"Error reading log file: {e}")
                    await asyncio.sleep(1)  # Wait longer on file errors

    except WebSocketDisconnect as e:
        # Normal disconnect - check close code
        close_code = e.code if hasattr(e, "code") else None

        if close_code in [1000, 1001, 1005]:
            logger.info(f"WebSocket disconnected normally (code: {close_code})")
        else:
            logger.warning(f"WebSocket disconnected unexpectedly (code: {close_code})")

    except asyncio.CancelledError:
        logger.debug("WebSocket task cancelled during shutdown")

    except Exception as e:
        error_msg = str(e)

        if "1001" in error_msg or "1005" in error_msg or "going away" in error_msg:
            logger.info(f"WebSocket closed normally: {error_msg}")
        else:
            logger.error(f"WebSocket error: {e}")
            try:
                await websocket.send_json(
                    {"type": "error", "message": f"WebSocket error: {str(e)}"}
                )
            except:
                pass
    finally:
        logger.debug("WebSocket connection closed")

import hashlib

@app.get("/api/thumbnail")
async def get_thumbnail(path: str = Query(..., description="Path to the image"), width: int = Query(400, description="Thumbnail width")):
    """Generate or retrieve a thumbnail for a given image path"""
    # The frontend might double-encode the path (e.g. %2520 for space), so we decode it again
    import urllib.parse
    path = urllib.parse.unquote(path)

    # Determine the real file path and its base directory based on the URL path prefix
    base_dir = None
    suffix = None
    if path.startswith("/poster_assets/"):
        base_dir = str(ASSETS_DIR)
        suffix = path[len("/poster_assets/"):]
    elif path.startswith("/manual_poster_assets/"):
        base_dir = str(MANUAL_ASSETS_DIR)
        suffix = path[len("/manual_poster_assets/"):]
    elif path.startswith("/backup_assets/"):
        base_dir = str(BACKUP_DIR)
        suffix = path[len("/backup_assets/"):]
    elif path.startswith("/test/"):
        base_dir = str(TEST_DIR)
        suffix = path[len("/test/"):]
    elif path.startswith("/images/"):
        base_dir = str(IMAGES_DIR)
        suffix = path[len("/images/"):]
    else:
        raise HTTPException(status_code=400, detail="Invalid path prefix")

    # Ensure it's safe and prevent directory traversal
    import os
    base_dir_abs = os.path.abspath(base_dir)
    filepath = os.path.abspath(os.path.join(base_dir_abs, suffix.lstrip("\\/")))
    if not filepath.startswith(base_dir_abs + os.sep) and filepath != base_dir_abs:
        raise HTTPException(status_code=403, detail="Access denied: Invalid path")

    real_path = Path(filepath)

    if not real_path.exists() or not real_path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")

    try:
        # Create thumbnails directory if it doesn't exist (using Cache instead of temp so they survive runs)
        thumbs_dir = BASE_DIR / "Cache" / "thumbnails"
        thumbs_dir.mkdir(parents=True, exist_ok=True)

        # Create a safe, unique filename for the thumbnail based on the path and last modified time
        mtime = real_path.stat().st_mtime
        hash_input = f"{str(real_path)}_{mtime}_{width}"
        thumb_hash = hashlib.md5(hash_input.encode()).hexdigest()
        thumb_path = thumbs_dir / f"{thumb_hash}.webp"

        # Generate thumbnail if it doesn't exist
        if not thumb_path.exists():
            with Image.open(real_path) as img:
                # Calculate new height maintaining aspect ratio
                w_percent = (width / float(img.size[0]))
                h_size = int((float(img.size[1]) * float(w_percent)))

                # Resize using high quality resampling
                img = img.resize((width, h_size), Image.Resampling.LANCZOS)

                # Convert to RGB if necessary (e.g., for PNGs with transparency)
                if img.mode in ('RGBA', 'P'):
                    img = img.convert('RGB')

                # Save as WebP for optimal compression
                img.save(thumb_path, "WEBP", quality=80)

        return FileResponse(thumb_path, media_type="image/webp", headers={"Cache-Control": "public, max-age=86400"})

    except Exception as e:
        logger.error(f"Error generating thumbnail for {path}: {e}")
        # Fallback to the original file if thumbnail generation fails
        return FileResponse(real_path)
@app.get("/api/gallery")
async def get_gallery():
    """Get poster gallery from the assets directory (only poster.jpg) - uses cache"""
    try:
        cache = get_fresh_assets()
        # Return cached posters, limit to 200 for performance
        return {"images": cache["posters"][:200]}
    except Exception as e:
        logger.error(f"Error getting gallery from cache: {e}")
        return {"images": []}


@app.delete("/api/gallery/{path:path}")
async def delete_poster(path: str):
    """Delete a poster from the assets directory"""
    try:
        # Construct the full file path
        file_path = ASSETS_DIR / path

        # Ensure the path is within ASSETS_DIR
        try:
            file_path = file_path.resolve()
            file_path.relative_to(ASSETS_DIR.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied: Invalid path")

        # Check if file exists
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Poster not found")

        # Check if it's a file (not a directory)
        if not file_path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")

        # Delete the file
        file_path.unlink()
        logger.info(f"Deleted poster: {file_path}")

        # Delete corresponding database entries
        delete_db_entries_for_asset(path)

        # Invalidate cache to reflect changes immediately
        asset_cache["last_scanned"] = 0

        return {"success": True, "message": f"Poster '{path}' deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting poster {path}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


class BulkDeleteRequest(BaseModel):
    paths: List[str]

class BulkResolveRequest(BaseModel):
    status: str
    category: str
    searchQuery: str
    type: str
    library: str

def _get_categorized_assets(config: dict) -> dict:
    """
    Internal helper to fetch all assets from DB and categorize them.
    This logic is extracted from get_assets_overview endpoint for reuse.
    """
    if not DATABASE_AVAILABLE or db is None:
        raise Exception("Database not available")

    # Get all records from database
    records = db.get_all_choices()

    # Create a fast lookup map from the asset cache
    logger.debug("Creating fast asset lookup map from cache for overview...")
    cache = get_fresh_assets()
    all_cached_assets = (
        cache["posters"]
        + cache["backgrounds"]
        + cache["seasons"]
        + cache["titlecards"]
    )
    asset_map = {
        img["path"].replace("\\", "/"): img for img in all_cached_assets
    }
    logger.debug(f"Asset map created with {len(asset_map)} items for overview")

    # Get primary language and provider from config
    primary_language = None
    primary_background_language = None
    primary_season_language = None
    primary_titlecard_language = None
    primary_provider = None
    try:
        # Check ApiPart for PreferredLanguageOrder
        api_part = config.get("ApiPart", {})
        lang_order = api_part.get("PreferredLanguageOrder", [])
        if lang_order and len(lang_order) > 0:
            primary_language = lang_order[0]

        # Background Language (Fallback to Main if empty or "PleaseFillMe")
        bg_lang_order = api_part.get("PreferredBackgroundLanguageOrder", [])
        if bg_lang_order and len(bg_lang_order) > 0 and bg_lang_order[0].lower() != "pleasefillme":
            primary_background_language = bg_lang_order[0]
        else:
            primary_background_language = primary_language

        # Season Language (Fallback to Main if empty or "PleaseFillMe")
        season_lang_order = api_part.get("PreferredSeasonLanguageOrder", [])
        if season_lang_order and len(season_lang_order) > 0 and season_lang_order[0].lower() != "pleasefillme":
            primary_season_language = season_lang_order[0]
        else:
            primary_season_language = primary_language

        # Title Card Language (Fallback to Main if empty or "PleaseFillMe")
        tc_lang_order = api_part.get("PreferredTCLanguageOrder", [])
        if tc_lang_order and len(tc_lang_order) > 0 and tc_lang_order[0].lower() != "pleasefillme":
            primary_titlecard_language = tc_lang_order[0]
        else:
            primary_titlecard_language = primary_language

        # Get FavProvider from ApiPart
        fav_provider = api_part.get("FavProvider", "")
        if fav_provider:
            primary_provider = fav_provider.lower()
    except Exception as e:
        logger.warning(f"Could not read config for primary lang/provider: {e}")

    # Initialize categories
    categories = {
        "missing_assets": [],
        "missing_assets_fav_provider": [],
        "non_primary_lang": [],
        "non_primary_provider": [],
        "truncated_text": [],
        "assets_with_issues": [],
        "resolved": [],
        "all": [], # New category to hold all assets
    }

    all_assets_map = {} # Use a map to store all unique assets once

    # Categorize each record
    for record in records:
        record_dict = dict(record)

        # Add to 'all' map
        if record_dict["id"] not in all_assets_map:
             all_assets_map[record_dict["id"]] = record_dict

        rootfolder = record_dict.get("Rootfolder", "")
        asset_type_from_db = record_dict.get("Type", "Poster")
        title = record_dict.get("Title", "")
        library = record_dict.get("LibraryName", "")

        asset_filename = "poster.jpg" # Default
        asset_type_lower = (asset_type_from_db or "").lower()

        if "background" in asset_type_lower:
            asset_filename = "background.jpg"
        elif "season" in asset_type_lower:
            season_match = re.search(r"season\s*(\d+)", title, re.IGNORECASE)
            if season_match:
                season_num = season_match.group(1).zfill(2)
                asset_filename = f"Season{season_num}.jpg"
            else:
                asset_filename = "Season_unknown.jpg" # Will not match
        elif "titlecard" in asset_type_lower or "episode" in asset_type_lower:
            episode_match = re.search(r"(S\d+E\d+)", title, re.IGNORECASE)
            if episode_match:
                episode_code = episode_match.group(1).upper()
                asset_filename = f"{episode_code}.jpg"
            else:
                asset_filename = "Episode_unknown.jpg" # Will not match

        relative_path_key = f"{library}/{rootfolder}/{asset_filename}"
        poster_data = asset_map.get(relative_path_key)

        # Add cache data to the record dictionary
        if poster_data:
            record_dict["poster_url"] = poster_data["url"]
            record_dict["has_poster"] = True
            record_dict["created"] = poster_data["created"]
            record_dict["modified"] = poster_data["modified"]
        else:
            record_dict["poster_url"] = None
            record_dict["has_poster"] = False
            record_dict["created"] = None
            record_dict["modified"] = None

        # Check if this is a Manual entry (resolved)
        manual_value = str(record_dict.get("Manual", "")).lower()
        if manual_value == "yes" or manual_value == "true":
            categories["resolved"].append(record_dict)
            continue  # Skip issue categorization for resolved items

        has_issue = False

        # Missing Assets: DownloadSource == "false" (string) or False (boolean) or empty
        download_source = record_dict.get("DownloadSource")
        provider_link = record_dict.get("FavProviderLink", "")

        is_download_missing = (
            download_source == "false"
            or download_source == False
            or not download_source
        )

        is_provider_link_missing = (
            provider_link == "false" or provider_link == False or not provider_link
        )

        # Category 1: Missing Asset (DownloadSource is missing)
        if is_download_missing:
            categories["missing_assets"].append(record_dict)
            has_issue = True

        # Category 2: Missing Asset at Favorite Provider (FavProviderLink is missing)
        if is_provider_link_missing:
            categories["missing_assets_fav_provider"].append(record_dict)
            has_issue = True

        # Non-Primary Language: Check language against config
        language = record_dict.get("Language", "")

        # Determine which primary language setting to use
        target_primary_lang = primary_language # Default to poster preference
        if "background" in asset_type_lower:
            target_primary_lang = primary_background_language
        elif "season" in asset_type_lower:
            target_primary_lang = primary_season_language
        elif "titlecard" in asset_type_lower or "episode" in asset_type_lower:
            target_primary_lang = primary_titlecard_language

        if language and target_primary_lang:
            lang_normalized = (
                "xx" if language.lower() == "textless" else language.lower()
            )
            primary_normalized = (
                "xx"
                if target_primary_lang.lower() == "textless"
                else target_primary_lang.lower()
            )
            if lang_normalized != primary_normalized:
                categories["non_primary_lang"].append(record_dict)
                has_issue = True
        elif language and not target_primary_lang:
            if language.lower() not in ["xx", "textless"]:
                categories["non_primary_lang"].append(record_dict)
                has_issue = True

        # Non-Primary Provider
        if not is_download_missing and not is_provider_link_missing:
            if primary_provider:
                provider_patterns = {
                    "tmdb": ["tmdb", "themoviedb"],
                    "tvdb": ["tvdb", "thetvdb"],
                    "fanart": ["fanart"],
                    "plex": ["plex"],
                }
                patterns = provider_patterns.get(
                    primary_provider, [primary_provider]
                )
                is_download_from_primary = any(
                    pattern in download_source.lower() for pattern in patterns
                )
                is_fav_link_from_primary = any(
                    pattern in provider_link.lower() for pattern in patterns
                )
                if not is_download_from_primary or not is_fav_link_from_primary:
                    categories["non_primary_provider"].append(record_dict)
                    has_issue = True

        # Truncated Text
        truncated_value = str(record_dict.get("TextTruncated", "")).lower()
        if truncated_value == "true":
            categories["truncated_text"].append(record_dict)
            has_issue = True

        # Add to assets_with_issues if any issue flag is set
        if has_issue:
            categories["assets_with_issues"].append(record_dict)

    # Add the 'all' list
    categories["all"] = list(all_assets_map.values())

    # Return the categorized data
    return {
        "categories": {
            "missing_assets": {
                "count": len(categories["missing_assets"]),
                "assets": categories["missing_assets"],
            },
            "missing_assets_fav_provider": {
                "count": len(categories["missing_assets_fav_provider"]),
                "assets": categories["missing_assets_fav_provider"],
            },
            "non_primary_lang": {
                "count": len(categories["non_primary_lang"]),
                "assets": categories["non_primary_lang"],
            },
            "non_primary_provider": {
                "count": len(categories["non_primary_provider"]),
                "assets": categories["non_primary_provider"],
            },
            "truncated_text": {
                "count": len(categories["truncated_text"]),
                "assets": categories["truncated_text"],
            },
            "assets_with_issues": {
                "count": len(categories["assets_with_issues"]),
                "assets": categories["assets_with_issues"],
            },
            "resolved": {
                "count": len(categories["resolved"]),
                "assets": categories["resolved"],
            },
            "all": { # Return all assets as well
                "count": len(categories["all"]),
                "assets": categories["all"],
            }
        },
        "config": {
            "primary_language": primary_language,
            "primary_language_background": primary_background_language,
            "primary_language_season": primary_season_language,
            "primary_language_titlecard": primary_titlecard_language,
            "primary_provider": primary_provider,
        },
    }

@app.post("/api/gallery/bulk-delete")
async def bulk_delete_posters(request: BulkDeleteRequest):
    """Delete multiple posters from the assets directory"""
    try:
        deleted = []
        failed = []

        for path in request.paths:
            try:
                # Construct the full file path
                file_path = ASSETS_DIR / path

                # Ensure the path is within ASSETS_DIR
                try:
                    file_path = file_path.resolve()
                    file_path.relative_to(ASSETS_DIR.resolve())
                except ValueError:
                    failed.append(
                        {"path": path, "error": "Access denied: Invalid path"}
                    )
                    continue

                # Check if file exists
                if not file_path.exists():
                    failed.append({"path": path, "error": "File not found"})
                    continue

                # Check if it's a file (not a directory)
                if not file_path.is_file():
                    failed.append({"path": path, "error": "Path is not a file"})
                    continue

                # Delete the file
                file_path.unlink()
                deleted.append(path)
                logger.info(f"Deleted poster: {file_path}")

                # Delete corresponding database entries
                delete_db_entries_for_asset(path)
            except Exception as e:
                failed.append({"path": path, "error": str(e)})
                logger.error(f"Error deleting poster {path}: {e}")

        # Invalidate cache to reflect changes immediately
        asset_cache["last_scanned"] = 0

        return {
            "success": True,
            "deleted": deleted,
            "failed": failed,
            "message": f"Successfully deleted {len(deleted)} poster(s). {len(failed)} failed.",
        }
    except Exception as e:
        logger.error(f"Error in bulk delete: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/backgrounds-gallery")
async def get_backgrounds_gallery():
    """Get backgrounds gallery from assets directory (only background.jpg) - uses cache"""
    try:
        cache = get_fresh_assets()
        return {"images": cache["backgrounds"][:200]}
    except Exception as e:
        logger.error(f"Error getting backgrounds from cache: {e}")
        return {"images": []}


@app.delete("/api/backgrounds/{path:path}")
async def delete_background(path: str):
    """Delete a background from the assets directory"""
    try:
        # Construct the full file path
        file_path = ASSETS_DIR / path

        # Ensure the path is within ASSETS_DIR
        try:
            file_path = file_path.resolve()
            file_path.relative_to(ASSETS_DIR.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied: Invalid path")

        # Check if file exists
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Background not found")

        # Check if it's a file (not a directory)
        if not file_path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")

        # Delete the file
        file_path.unlink()
        logger.info(f"Deleted background: {file_path}")

        # Delete corresponding database entries
        delete_db_entries_for_asset(path)

        # Invalidate cache to reflect changes immediately
        asset_cache["last_scanned"] = 0

        return {"success": True, "message": f"Background '{path}' deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting background {path}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/backgrounds/bulk-delete")
async def bulk_delete_backgrounds(request: BulkDeleteRequest):
    """Delete multiple backgrounds from the assets directory"""
    try:
        deleted = []
        failed = []

        for path in request.paths:
            try:
                # Construct the full file path
                file_path = ASSETS_DIR / path

                # Ensure the path is within ASSETS_DIR
                try:
                    file_path = file_path.resolve()
                    file_path.relative_to(ASSETS_DIR.resolve())
                except ValueError:
                    failed.append(
                        {"path": path, "error": "Access denied: Invalid path"}
                    )
                    continue

                # Check if file exists
                if not file_path.exists():
                    failed.append({"path": path, "error": "File not found"})
                    continue

                # Check if it's a file (not a directory)
                if not file_path.is_file():
                    failed.append({"path": path, "error": "Path is not a file"})
                    continue

                # Delete the file
                file_path.unlink()
                deleted.append(path)
                logger.info(f"Deleted background: {file_path}")

                # Delete corresponding database entries
                delete_db_entries_for_asset(path)
            except Exception as e:
                failed.append({"path": path, "error": str(e)})
                logger.error(f"Error deleting background {path}: {e}")

        # Invalidate cache to reflect changes immediately
        asset_cache["last_scanned"] = 0

        return {
            "success": True,
            "deleted": deleted,
            "failed": failed,
            "message": f"Successfully deleted {len(deleted)} background(s). {len(failed)} failed.",
        }
    except Exception as e:
        logger.error(f"Error in bulk delete backgrounds: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/seasons-gallery")
async def get_seasons_gallery():
    """Get seasons gallery from assets directory (only SeasonXX.jpg) - uses cache"""
    try:
        cache = get_fresh_assets()
        return {"images": cache["seasons"][:200]}
    except Exception as e:
        logger.error(f"Error getting seasons from cache: {e}")
        return {"images": []}


@app.delete("/api/seasons/{path:path}")
async def delete_season(path: str):
    """Delete a season from the assets directory"""
    try:
        # Construct the full file path
        file_path = ASSETS_DIR / path

        # Ensure the path is within ASSETS_DIR
        try:
            file_path = file_path.resolve()
            file_path.relative_to(ASSETS_DIR.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied: Invalid path")

        # Check if file exists
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Season not found")

        # Check if it's a file (not a directory)
        if not file_path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")

        # Delete the file
        file_path.unlink()
        logger.info(f"Deleted season: {file_path}")

        # Delete corresponding database entries
        delete_db_entries_for_asset(path)

        # Invalidate cache to reflect changes immediately
        asset_cache["last_scanned"] = 0

        return {"success": True, "message": f"Season '{path}' deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting season {path}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/seasons/bulk-delete")
async def bulk_delete_seasons(request: BulkDeleteRequest):
    """Delete multiple seasons from the assets directory"""
    try:
        deleted = []
        failed = []

        for path in request.paths:
            try:
                # Construct the full file path
                file_path = ASSETS_DIR / path

                # Ensure the path is within ASSETS_DIR
                try:
                    file_path = file_path.resolve()
                    file_path.relative_to(ASSETS_DIR.resolve())
                except ValueError:
                    failed.append(
                        {"path": path, "error": "Access denied: Invalid path"}
                    )
                    continue

                # Check if file exists
                if not file_path.exists():
                    failed.append({"path": path, "error": "File not found"})
                    continue

                # Check if it's a file (not a directory)
                if not file_path.is_file():
                    failed.append({"path": path, "error": "Path is not a file"})
                    continue

                # Delete the file
                file_path.unlink()
                deleted.append(path)
                logger.info(f"Deleted season: {file_path}")

                # Delete corresponding database entries
                delete_db_entries_for_asset(path)
            except Exception as e:
                failed.append({"path": path, "error": str(e)})
                logger.error(f"Error deleting season {path}: {e}")

        # Invalidate cache to reflect changes immediately
        asset_cache["last_scanned"] = 0

        return {
            "success": True,
            "deleted": deleted,
            "failed": failed,
            "message": f"Successfully deleted {len(deleted)} season(s). {len(failed)} failed.",
        }
    except Exception as e:
        logger.error(f"Error in bulk delete seasons: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/titlecards-gallery")
async def get_titlecards_gallery():
    """Get title cards gallery from assets directory (only SxxExx.jpg - episodes) - uses cache"""
    try:
        cache = get_fresh_assets()
        return {"images": cache["titlecards"][:200]}
    except Exception as e:
        logger.error(f"Error getting titlecards from cache: {e}")
        return {"images": []}


@app.delete("/api/titlecards/{path:path}")
async def delete_titlecard(path: str):
    """Delete a titlecard from the assets directory"""
    try:
        # Construct the full file path
        file_path = ASSETS_DIR / path

        # Ensure the path is within ASSETS_DIR
        try:
            file_path = file_path.resolve()
            file_path.relative_to(ASSETS_DIR.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied: Invalid path")

        # Check if file exists
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="TitleCard not found")

        # Check if it's a file (not a directory)
        if not file_path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")

        # Delete the file
        file_path.unlink()
        logger.info(f"Deleted titlecard: {file_path}")

        # Delete corresponding database entries
        delete_db_entries_for_asset(path)

        # Invalidate cache to reflect changes immediately
        asset_cache["last_scanned"] = 0

        return {"success": True, "message": f"TitleCard '{path}' deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting titlecard {path}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/titlecards/bulk-delete")
async def bulk_delete_titlecards(request: BulkDeleteRequest):
    """Delete multiple titlecards from the assets directory"""
    try:
        deleted = []
        failed = []

        for path in request.paths:
            try:
                # Construct the full file path
                file_path = ASSETS_DIR / path

                # Ensure the path is within ASSETS_DIR
                try:
                    file_path = file_path.resolve()
                    file_path.relative_to(ASSETS_DIR.resolve())
                except ValueError:
                    failed.append(
                        {"path": path, "error": "Access denied: Invalid path"}
                    )
                    continue

                # Check if file exists
                if not file_path.exists():
                    failed.append({"path": path, "error": "File not found"})
                    continue

                # Check if it's a file (not a directory)
                if not file_path.is_file():
                    failed.append({"path": path, "error": "Path is not a file"})
                    continue

                # Delete the file
                file_path.unlink()
                deleted.append(path)
                logger.info(f"Deleted titlecard: {file_path}")

                # Delete corresponding database entries
                delete_db_entries_for_asset(path)
            except Exception as e:
                failed.append({"path": path, "error": str(e)})
                logger.error(f"Error deleting titlecard {path}: {e}")

        # Invalidate cache to reflect changes immediately
        asset_cache["last_scanned"] = 0

        return {
            "success": True,
            "deleted": deleted,
            "failed": failed,
            "message": f"Successfully deleted {len(deleted)} titlecard(s). {len(failed)} failed.",
        }
    except Exception as e:
        logger.error(f"Error in bulk delete titlecards: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ============================================================================
# MANUAL ASSETS GALLERY
# ============================================================================


@app.get("/api/manual-assets-gallery")
async def get_manual_assets_gallery():
    """Get all assets from manualassets directory - (uses cache)"""
    try:
        # Use the main asset cache, which is refreshed in the background
        cache = get_fresh_assets()
        manual_gallery_data = cache.get("manual_gallery", {"libraries": [], "total_assets": 0})

        # Log this at a DEBUG level to avoid spam
        logger.debug(
            f"Returning cached manual assets gallery: {len(manual_gallery_data.get('libraries', []))} libraries"
        )
        return manual_gallery_data

    except Exception as e:
        logger.error(f"Error getting manual assets gallery from cache: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Internal server error")

@app.delete("/api/manual-assets/{path:path}")
async def delete_manual_asset(path: str):
    """Delete an asset from the manual assets directory"""
    try:
        # Construct the full file path
        file_path = MANUAL_ASSETS_DIR / path

        # Ensure the path is within MANUAL_ASSETS_DIR
        try:
            file_path = file_path.resolve()
            file_path.relative_to(MANUAL_ASSETS_DIR.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied: Invalid path")

        # Check if file exists
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Asset not found")

        # Check if it's a file (not a directory)
        if not file_path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")

        # Delete the file
        file_path.unlink()
        logger.info(f"Deleted manual asset: {file_path}")

        return {
            "success": True,
            "message": f"Manual asset '{path}' deleted successfully",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting manual asset {path}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/manual-assets/bulk-delete")
async def bulk_delete_manual_assets(request: BulkDeleteRequest):
    """Delete multiple assets from the manual assets directory"""
    try:
        deleted = []
        failed = []

        for path in request.paths:
            try:
                # Construct the full file path
                file_path = MANUAL_ASSETS_DIR / path

                # Ensure the path is within MANUAL_ASSETS_DIR
                try:
                    file_path = file_path.resolve()
                    file_path.relative_to(MANUAL_ASSETS_DIR.resolve())
                except ValueError:
                    failed.append(
                        {"path": path, "error": "Access denied: Invalid path"}
                    )
                    continue

                # Check if file exists
                if not file_path.exists():
                    failed.append({"path": path, "error": "File not found"})
                    continue

                # Check if it's a file (not a directory)
                if not file_path.is_file():
                    failed.append({"path": path, "error": "Path is not a file"})
                    continue

                # Delete the file
                file_path.unlink()
                deleted.append(path)
                logger.info(f"Deleted manual asset: {file_path}")
            except Exception as e:
                failed.append({"path": path, "error": str(e)})
                logger.error(f"Error deleting manual asset {path}: {e}")

        return {
            "success": True,
            "deleted": deleted,
            "failed": failed,
            "message": f"Successfully deleted {len(deleted)} manual asset(s). {len(failed)} failed.",
        }
    except Exception as e:
        logger.error(f"Error in bulk delete manual assets: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ============================================================================
# BACKUP ASSETS ENDPOINTS
# ============================================================================

@app.get("/api/backup-assets-gallery")
async def get_backup_assets_gallery():
    """Get all assets from backup directory - (uses cache)"""
    try:
        cache = get_fresh_assets()
        gallery = cache.get("backup_gallery", {"libraries": [], "total_assets": 0})

        # Determine configured libraries from server_libraries_db
        configured_libraries = set()
        if SERVER_LIBRARIES_DB_AVAILABLE and server_libraries_db is not None:
            for srv_type in ["plex", "jellyfin", "emby"]:
                try:
                    res = server_libraries_db.get_media_server_libraries(srv_type)
                    if res.get("success"):
                        for lib in res.get("libraries", []):
                            configured_libraries.add(lib.get("name"))
                except Exception:
                    pass

        annotated_libraries = []
        for lib in gallery.get("libraries", []):
            lib_copy = lib.copy()
            # If no configured libraries exist yet (e.g. not synced), we default to True
            lib_copy["is_configured"] = True if not configured_libraries else (lib_copy["name"] in configured_libraries)
            annotated_libraries.append(lib_copy)

        return {"libraries": annotated_libraries, "total_assets": gallery.get("total_assets", 0)}
    except Exception as e:
        logger.error(f"Error getting backup gallery: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.delete("/api/backup-assets/{path:path}")
async def delete_backup_asset(path: str):
    """Delete an asset from the backup directory"""
    try:
        # Construct the full file path
        file_path = BACKUP_DIR / path

        # Ensure the path is within BACKUP_DIR
        try:
            file_path = file_path.resolve()
            file_path.relative_to(BACKUP_DIR.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied: Invalid path")

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Asset not found")

        file_path.unlink()
        logger.info(f"Deleted backup asset: {file_path}")

        # Trigger background scan to update cache
        threading.Thread(target=scan_and_cache_assets, daemon=True).start()

        return {"success": True, "message": f"Backup asset '{path}' deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting backup asset {path}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/backup-assets/bulk-delete")
async def bulk_delete_backup_assets(request: BulkDeleteRequest):
    """Bulk delete assets from the backup directory"""
    try:
        deleted = []
        failed = []

        for path in request.paths:
            try:
                file_path = BACKUP_DIR / path
                try:
                    file_path = file_path.resolve()
                    file_path.relative_to(BACKUP_DIR.resolve())
                except ValueError:
                    failed.append({"path": path, "error": "Access denied"})
                    continue

                if not file_path.exists():
                    failed.append({"path": path, "error": "File not found"})
                    continue

                file_path.unlink()
                deleted.append(path)
                logger.info(f"Deleted backup asset: {file_path}")
            except Exception as e:
                failed.append({"path": path, "error": str(e)})

        # Trigger background scan
        threading.Thread(target=scan_and_cache_assets, daemon=True).start()

        return {
            "success": True,
            "deleted": deleted,
            "failed": failed,
            "message": f"Deleted {len(deleted)} backup asset(s)."
        }
    except Exception as e:
        logger.error(f"Error in bulk delete backups: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Mount Static Files for Backups
if BACKUP_DIR.exists():
    app.mount(
        "/backup_assets",
        CachedStaticFiles(directory=str(BACKUP_DIR), max_age=86400),
        name="backup_assets",
    )
    logger.info(f"Mounted /backup_assets -> {BACKUP_DIR}")


@app.get("/api/assets-folders")
async def get_assets_folders():
    """Get list of folders in assets directory with image counts per type - uses cache"""
    try:
        cache = get_fresh_assets()
        return {"folders": cache["folders"]}
    except Exception as e:
        logger.error(f"Error getting folders from cache: {e}")
        return {"folders": []}


@app.get("/api/assets-folder-images/{image_type}/{folder_path:path}")
async def get_assets_folder_images_filtered(image_type: str, folder_path: str):
    """Get filtered images from a specific folder - uses cache"""
    # Validate image_type
    valid_types = ["posters", "backgrounds", "seasons", "titlecards"]
    if image_type not in valid_types:
        raise HTTPException(
            status_code=400, detail=f"Invalid image type. Must be one of: {valid_types}"
        )

    try:
        cache = get_fresh_assets()

        # Get the appropriate image list from cache
        all_images = cache[image_type]

        # Filter images that belong to the specified folder
        # folder_path is like "4K" or "Movies/ActionMovies"
        filtered_images = [
            img
            for img in all_images
            if img["path"].startswith(folder_path + "/")
            or img["path"].startswith(folder_path + "\\")
        ]

        return {"images": filtered_images}
    except Exception as e:
        logger.error(f"Error getting folder images from cache: {e}")
        return {"images": []}

# ============================================================================
# FOLDER VIEW (RECURSIVE)
# ============================================================================
# This new endpoint REPLACES get_folder_view_items and get_folder_view_assets
@app.get("/api/folder-view/browse")
async def get_folder_view_browse(path: Optional[str] = Query(None)):
    """
    Recursively browse the assets directory.
    Returns a list of folders and assets at the specified path.
    """
    try:
        current_dir = ASSETS_DIR
        relative_path_str = ""

        if path:
            # Safely resolve path within ASSETS_DIR
            current_dir = get_safe_path(ASSETS_DIR, path)

            if not current_dir.is_dir():
                raise HTTPException(status_code=400, detail="Path is not a directory")

            relative_path_str = str(current_dir.relative_to(ASSETS_DIR)).replace("\\", "/")


        logger.info(f"Browsing folder view: {current_dir}")

        items = []
        # Determine library folder (first part of path) for media type detection
        library_folder = relative_path_str.split('/')[0] if relative_path_str else None

        for item in current_dir.iterdir():
            if item.name == "@eaDir": # Skip Synology index folders
                continue
            try:
                stat = item.stat()
                created = stat.st_ctime
                modified = stat.st_mtime
            except Exception:
                created = 0
                modified = 0

            if item.is_dir():
                # This is a folder
                try:
                    # Count items inside this subfolder
                    item_count = sum(1 for sub_item in item.iterdir() if sub_item.name != "@eaDir")

                    folder_path = item.relative_to(ASSETS_DIR)
                    items.append({
                        "type": "folder",
                        "name": item.name,
                        "path": str(folder_path).replace("\\", "/"),
                        "item_count": item_count,
                        "created": created,
                        "modified": modified,
                    })
                except Exception as e:
                    logger.warning(f"Could not scan subfolder {item.name}: {e}")

            elif item.is_file():
                # This is a file, check if it's an image
                file_ext = item.suffix.lower()
                if file_ext in {".jpg", ".jpeg", ".png", ".webp"}:
                    # This is an asset
                    file_path = item.relative_to(ASSETS_DIR)
                    url_path = str(file_path).replace("\\", "/")
                    encoded_url_path = quote(url_path, safe="/")

                    # Determine asset type (poster, background, etc.)
                    asset_type_str = determine_media_type(item.name, library_folder)

                    # Map to simple types for frontend (poster, background, season, titlecard)
                    asset_type_simple = "poster" # default
                    if "background" in asset_type_str.lower():
                        asset_type_simple = "background"
                    elif "season" in asset_type_str.lower():
                        asset_type_simple = "season"
                    elif "episode" in asset_type_str.lower():
                        asset_type_simple = "titlecard"

                    items.append({
                        "type": "asset",
                        "name": item.name,
                        "path": url_path,
                        "url": f"/poster_assets/{encoded_url_path}",
                        "size": item.stat().st_size,
                        "asset_type": asset_type_simple, # e.g., 'poster', 'background'
                        "full_type": asset_type_str, # e.g., 'Movie', 'Show Background'
                        "created": created,
                        "modified": modified,
                    })

        # Sort: folders first, then assets
        items.sort(key=lambda x: (x["type"] != "folder", x["name"]))

        return {
            "success": True,
            "path": relative_path_str,
            "items": items,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ERROR] Error browsing folder view at path '{path}': {str(e)}")
        logger.exception("Full traceback:")
        return {"success": False, "error": str(e), "items": []}

@app.get("/api/recent-assets")
async def get_recent_assets():
    """
    Get recently created assets from the imagechoices database
    Returns the most recent assets with their poster images from assets folder
    USES FAST CACHE FOR IMAGE LOOKUPS
    """
    try:
        if not DATABASE_AVAILABLE or db is None:
            # Return empty list instead of crashing if DB isn't ready
            return {
                "success": True,
                "assets": [],
                "total_count": 0,
            }

        # CSV import is handled by logs_watcher, no import needed here
        try:
            pass # Keep block for safety
        except Exception as e:
            logger.warning(f"Could not import CSV to database: {e}")

        # Get all assets from database (already sorted by id DESC - newest first)
        db_records = db.get_all_choices()

        logger.info(f"Found {len(db_records)} total assets in database")

        # If no assets found, return early
        if not db_records:
            logger.warning(" No assets found in database")
            return {
                "success": True,
                "assets": [],
                "total_count": 0,
            }

        # Create a fast lookup map from the asset cache
        # This scans the cache (memory) not the disk
        logger.debug("Creating fast asset lookup map from cache...")
        cache = get_fresh_assets()
        # Combine all asset types into one lookup
        all_cached_assets = (
            cache["posters"]
            + cache["backgrounds"]
            + cache["seasons"]
            + cache["titlecards"]
        )

        # Create a map: { "Library/Folder/poster.jpg": { ... asset data ... } }
        # Use normalized paths for lookup
        asset_map = {
            img["path"].replace("\\", "/"): img for img in all_cached_assets
        }
        logger.debug(f"Asset map created with {len(asset_map)} items")

        # Convert database records to asset format and find poster files
        all_assets_with_mtime = []

        # Process records until we have 100 valid assets (not just first 100 records)
        for record in db_records:

            # Convert database record (sqlite3.Row) to dict
            asset_dict = dict(record)

            rootfolder = asset_dict.get("Rootfolder", "")
            asset_type_from_db = asset_dict.get("Type", "Poster")
            title = asset_dict.get("Title", "")
            download_source = asset_dict.get("DownloadSource", "") # Corrected key
            library = asset_dict.get("LibraryName", "")

            manual_field = asset_dict.get("Manual", "N/A")
            if manual_field in ["Yes", "true", True]:
                is_manually_created = True
            else:
                # For "No", "false", False, or N/A - check download_source as fallback
                is_manually_created = download_source == "N/A" or (
                    download_source
                    and (
                        download_source.startswith("C:")
                        or download_source.startswith("/")
                        or download_source.startswith("\\")
                    )
                )

            if rootfolder:
                # Find the asset file path in our fast cache map
                # This is the new, fast part.

                # Determine asset filename (poster.jpg, background.jpg, Season01.jpg, S01E01.jpg)
                asset_filename = "poster.jpg" # Default
                asset_type_lower = (asset_type_from_db or "").lower()

                if "background" in asset_type_lower:
                    asset_filename = "background.jpg"
                elif "season" in asset_type_lower:
                    season_match = re.search(r"season\s*(\d+)", title, re.IGNORECASE)
                    if season_match:
                        season_num = season_match.group(1).zfill(2)
                        asset_filename = f"Season{season_num}.jpg"
                    else:
                        asset_filename = "Season_unknown.jpg" # Will not match
                elif "titlecard" in asset_type_lower or "episode" in asset_type_lower:
                    episode_match = re.search(r"(S\d+E\d+)", title, re.IGNORECASE)
                    if episode_match:
                        episode_code = episode_match.group(1).upper()
                        asset_filename = f"{episode_code}.jpg"
                    else:
                        asset_filename = "Episode_unknown.jpg" # Will not match

                # Construct the relative path we expect to find in the cache
                # Use forward slashes for normalized lookup
                relative_path_key = f"{library}/{rootfolder}/{asset_filename}"

                poster_data = asset_map.get(relative_path_key)

                if poster_data:
                    # Format asset for frontend (match old CSV format)
                    asset = {
                        "title": asset_dict.get("Title", ""),
                        "type": asset_type_from_db,
                        "rootfolder": rootfolder,
                        "library": library,
                        "language": asset_dict.get("Language", ""),
                        "fallback": False,
                        "text_truncated": asset_dict.get("TextTruncated", "").lower()
                        == "true",
                        "download_source": download_source,
                        "provider_link": (
                            asset_dict.get("FavProviderLink", "")
                            if asset_dict.get("FavProviderLink", "") != "N/A"
                            else ""
                        ),
                        "is_manually_created": is_manually_created,
                        "LogoSource": asset_dict.get("LogoSource", ""),
                        "LogoLanguage": asset_dict.get("LogoLanguage", ""),
                        "LogoTextFallback": asset_dict.get("LogoTextFallback", ""),
                        # Use data directly from the cache
                        "poster_url": poster_data["url"],
                        "has_poster": True,
                        "created": poster_data["created"],
                        "modified": poster_data["modified"],
                    }
                    all_assets_with_mtime.append(asset)
                else:
                    logger.debug(f"[SKIP] Skipping asset (poster not found in cache): {title} at {relative_path_key}")

        # Add sorting and limiting *after* the loop
        logger.info(f"Sorting {len(all_assets_with_mtime)} assets by modification time...")

        # Sort the list by the 'modified' timestamp (newest first)
        # Use a default value of 0 for any assets that somehow lack a modified time
        all_assets_with_mtime.sort(key=lambda x: x.get("modified", 0), reverse=True)

        # Now, take the top 100
        max_assets = 100
        recent_assets = all_assets_with_mtime[:max_assets]

        logger.info(
            f"Returning {len(recent_assets)} most recent assets with existing images from database"
        )

        return {
            "success": True,
            "assets": recent_assets,
            "total_count": len(recent_assets),
        }

    except Exception as e:
        logger.error(f"[ERROR] Error getting recent assets from database: {e}")
        import traceback

        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e), "assets": [], "total_count": 0}

@app.get("/api/asset-type-lookup")
async def get_asset_type_lookup(
    library_name: str = Query(...)
):
    """
    Look up the media type (movie/show) for a given library folder name.
    This is used by the frontend galleries to determine media type.
    """
    try:
        if not library_name:
            return {"success": False, "error": "library_name parameter required"}

        # Use the cached lookup function
        media_type = get_library_type_from_db(library_name)

        if media_type:
            return {
                "success": True,
                "library_name": library_name,
                "media_type": media_type,
            }
        else:
            return {
                "success": False,
                "library_name": library_name,
                "media_type": None,
                "error": "Library type not found in database",
            }
    except Exception as e:
        logger.error(f"Error looking up asset type: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/version")
async def get_version():
    """
    Gets script version from Posterizarr.ps1 and compares with GitHub Release.txt
    """
    return await get_script_version()


@app.get("/api/version-ui")
async def get_version_ui():
    """
    Gets UI version
    """
    return await fetch_version(
        local_filename="ReleaseUI.txt",
        github_url="https://raw.githubusercontent.com/fscorrupt/posterizarr/refs/heads/main/ReleaseUI.txt",
        version_type="UI",
    )


@app.get("/api/releases")
async def get_github_releases():
    """
    Fetches all releases from GitHub and returns them formatted
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.github.com/repos/fscorrupt/posterizarr/releases",
                headers={"Accept": "application/vnd.github.v3+json"},
                timeout=10.0,
            )
            response.raise_for_status()
            releases = response.json()

            # Format the releases for frontend display
            formatted_releases = []
            for release in releases[:10]:  # Only last 10 releases
                published_date = datetime.fromisoformat(
                    release["published_at"].replace("Z", "+00:00")
                )
                days_ago = (datetime.now(published_date.tzinfo) - published_date).days

                formatted_releases.append(
                    {
                        "version": release["tag_name"],
                        "name": release["name"],
                        "published_at": release["published_at"],
                        "days_ago": days_ago,
                        "is_prerelease": release["prerelease"],
                        "is_draft": release["draft"],
                        "html_url": release["html_url"],
                        "body": release["body"],  # Changelog-Text
                    }
                )

            return {"success": True, "releases": formatted_releases}

    except httpx.RequestError as e:
        logger.error(f"Could not fetch releases from GitHub: {e}")
        return {
            "success": False,
            "error": "Could not fetch releases from GitHub",
            "releases": [],
        }
    except Exception as e:
        logger.error(f"Error fetching releases: {e}")
        return {"success": False, "error": str(e), "releases": []}


@app.get("/api/dashboard/all")
async def get_dashboard_all():
    """
    Combined endpoint for all dashboard data - reduces HTTP requests from 4 to 1
    Returns: status, version, scheduler_status, system_info
    """
    result = {
        "success": True,
        "status": None,
        "version": None,
        "scheduler_status": None,
        "system_info": None,
    }

    # Fetch status (always required)
    try:
        status_response = await get_status()
        result["status"] = status_response
    except Exception as e:
        logger.error(f"Error fetching status in dashboard/all: {e}")
        result["status"] = {
            "running": False,
            "last_logs": [],
            "script_exists": False,
            "config_exists": False,
        }

    # Fetch version (cached, so fast)
    try:
        version_response = await get_version()
        result["version"] = version_response
    except Exception as e:
        logger.error(f"Error fetching version in dashboard/all: {e}")
        result["version"] = {"local": None, "remote": None}

    # Fetch scheduler status (if available)
    if SCHEDULER_AVAILABLE and scheduler:
        try:
            scheduler_status = scheduler.get_status()
            result["scheduler_status"] = {
                "success": True,
                "enabled": scheduler_status.get("enabled", False),
                "running": scheduler_status.get("running", False),
                "is_executing": scheduler_status.get("is_executing", False),
                "schedules": scheduler_status.get("schedules", []),
                "next_run": scheduler_status.get("next_run"),
                "timezone": scheduler_status.get("timezone"),
            }
        except Exception as e:
            logger.error(f"Error fetching scheduler status in dashboard/all: {e}")
            result["scheduler_status"] = {"success": False}
    else:
        result["scheduler_status"] = {"success": False}

    # Fetch system info
    try:
        system_info_response = await get_system_info()
        result["system_info"] = system_info_response
    except Exception as e:
        logger.error(f"Error fetching system info in dashboard/all: {e}")
        result["system_info"] = {
            "platform": "Unknown",
            "cpu_cores": 0,
            "memory_percent": 0,
            "total_memory": "Unknown",
            "used_memory": "Unknown",
            "free_memory": "Unknown",
        }

    return result


@app.get("/api/assets/stats")
async def get_assets_stats():
    """
    Returns statistics about created assets - uses cache
    """
    try:
        # Use the existing cache instead of rescanning
        cache = get_fresh_assets()

        # Calculate total size from cache
        total_size = sum(img["size"] for img in cache["posters"])
        total_size += sum(img["size"] for img in cache["backgrounds"])
        total_size += sum(img["size"] for img in cache["seasons"])
        total_size += sum(img["size"] for img in cache["titlecards"])

        sorted_folders = sorted(
            cache["folders"], key=lambda x: x["files"], reverse=True
        )

        stats = {
            "posters": len(cache["posters"]),
            "backgrounds": len(cache["backgrounds"]),
            "seasons": len(cache["seasons"]),
            "titlecards": len(cache["titlecards"]),
            "total_size": total_size,
            "folders": sorted_folders[:10],  # Top 10 folders by file count
        }

        return {"success": True, "stats": stats}

    except Exception as e:
        logger.error(f"Error getting asset stats: {e}")
        return {"success": False, "error": str(e), "stats": {}}


@app.post("/api/refresh-cache")
async def refresh_cache():
    """Manually refresh the asset cache"""
    try:
        scan_and_cache_assets()
        return {
            "success": True,
            "message": "Cache refreshed successfully",
            "posters": len(asset_cache["posters"]),
            "backgrounds": len(asset_cache["backgrounds"]),
            "seasons": len(asset_cache["seasons"]),
            "titlecards": len(asset_cache["titlecards"]),
            "folders": len(asset_cache["folders"]),
        }
    except Exception as e:
        logger.error(f"Error refreshing cache: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/cache/status")
async def get_cache_status():
    """Get detailed cache status including background refresh info"""
    try:
        now = time.time()
        last_scan = asset_cache.get("last_scanned", 0)
        age_seconds = now - last_scan if last_scan > 0 else 0
        is_initial_scan = last_scan == 0

        # Robust thread checking
        thread_alive = False
        try:
            if cache_refresh_task is not None:
                thread_alive = cache_refresh_task.is_alive()
        except Exception:
            thread_alive = False

        return {
            "success": True,
            "cache": {
                "last_scanned": (
                    datetime.fromtimestamp(last_scan).isoformat()
                    if last_scan > 0
                    else None
                ),
                "age_seconds": int(age_seconds),
                "ttl_seconds": CACHE_TTL_SECONDS,
                "refresh_interval": CACHE_REFRESH_INTERVAL,
                "is_stale": False,  # TTL check removed, cache is always valid
                "is_initial_scan": is_initial_scan,
                "posters_count": len(asset_cache.get("posters", [])),
                "backgrounds_count": len(asset_cache.get("backgrounds", [])),
                "seasons_count": len(asset_cache.get("seasons", [])),
                "titlecards_count": len(asset_cache.get("titlecards", [])),
                "folders_count": len(asset_cache.get("folders", [])),
            },
            "background_refresh": {
                "running": cache_refresh_running,
                "thread_alive": thread_alive,
                "scan_in_progress": cache_scan_in_progress,
            },
        }
    except Exception as e:
        logger.error(f"Error getting cache status: {e}")
        # Still return a valid response
        return {
            "success": False,
            "error": str(e),
            "cache": {
                "posters_count": 0,
                "backgrounds_count": 0,
                "seasons_count": 0,
                "titlecards_count": 0,
                "folders_count": 0,
                "is_initial_scan": True,
            },
            "background_refresh": {
                "running": False,
                "thread_alive": False,
                "scan_in_progress": False,
            },
        }


@app.get("/api/test-gallery")
async def get_test_gallery():
    """Get poster gallery from test directory with image URLs"""
    if not TEST_DIR.exists():
        return {"images": []}

    images = []
    image_extensions = {".jpg", ".jpeg", ".png", ".webp"}

    try:
        # Filter out @eaDir during iteration
        all_test_images = [
            p
            for p in TEST_DIR.rglob("*")
            if p.suffix.lower() in image_extensions and "@eaDir" not in str(p)
        ]

        for image_path in all_test_images:
            if image_path.is_file():
                try:
                    relative_path = image_path.relative_to(TEST_DIR)
                    # Create URL path with forward slashes
                    url_path = str(relative_path).replace("\\", "/")
                    # URL encode the path to handle special characters like #
                    encoded_url_path = quote(url_path, safe="/")
                    images.append(
                        {
                            "path": str(relative_path),
                            "name": image_path.name,
                            "size": image_path.stat().st_size,
                            "url": f"/test/{encoded_url_path}",
                        }
                    )
                except Exception as e:
                    logger.error(f"Error processing test image {image_path}: {e}")
                    continue

        # Sort by name and limit
        images.sort(key=lambda x: x["name"])
        return {"images": images[:200]}  # Limit to 200 for performance
    except Exception as e:
        logger.error(f"Error scanning test gallery: {e}")
        return {"images": []}


@app.get("/api/scheduler/status")
async def get_scheduler_status():
    """Get current scheduler status and configuration"""
    if not SCHEDULER_AVAILABLE or not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")

    try:
        status = scheduler.get_status()
        return {"success": True, **status}
    except Exception as e:
        logger.error(f"Error getting scheduler status: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/api/scheduler/config")
async def get_scheduler_config():
    """Get scheduler configuration"""
    if not SCHEDULER_AVAILABLE or not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")

    try:
        config = scheduler.load_config()
        return {"success": True, "config": config}
    except Exception as e:
        logger.error(f"Error loading scheduler config: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/scheduler/config")
async def update_scheduler_config(data: ScheduleUpdate):
    """Update scheduler configuration"""
    if not SCHEDULER_AVAILABLE or not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")

    try:
        updates = {}
        if data.enabled is not None:
            updates["enabled"] = data.enabled
        if data.schedules is not None:
            updates["schedules"] = data.schedules
        if data.timezone is not None:
            updates["timezone"] = data.timezone
        if data.skip_if_running is not None:
            updates["skip_if_running"] = data.skip_if_running

        config = scheduler.update_config(updates)

        # Restart scheduler if enabled
        if config.get("enabled", False):
            scheduler.restart()
        else:
            scheduler.stop()

        return {
            "success": True,
            "message": "Scheduler configuration updated",
            "config": config,
        }
    except Exception as e:
        logger.error(f"Error updating scheduler config: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/scheduler/schedule")
async def add_schedule(request: Request):
    """Add a new execution schedule with enhanced cron and interval support"""
    try:
        data = await request.json()

        # Core fields
        time_str = data.get("time")
        description = data.get("description", "")
        mode = data.get("mode", "normal")

        # Cron-like parameters
        frequency = data.get("frequency", "daily")
        day_of_week = data.get("day_of_week", "*")
        day = data.get("day", "*")
        month = data.get("month", "*")

        # Interval parameters
        interval_value = data.get("interval_value", 1)
        interval_unit = data.get("interval_unit", "hours")

        if frequency != "interval" and not time_str:
            raise HTTPException(status_code=400, detail="Time is required for non-interval schedules")

        # Pass all arguments to the updated scheduler logic
        success = scheduler.add_schedule(
            time_str=time_str,
            description=description,
            mode=mode,
            frequency=frequency,
            day_of_week=day_of_week,
            day=day,
            month=month,
            interval_value=interval_value,
            interval_unit=interval_unit
        )

        if success:
            return {"success": True, "message": "Schedule added successfully"}
        else:
            raise HTTPException(status_code=400, detail="Schedule already exists or is invalid")

    except Exception as e:
        logger.error(f"Error adding schedule: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.delete("/api/scheduler/schedule/{time}")
async def remove_schedule(time: str):
    """Remove a schedule by time"""
    if not SCHEDULER_AVAILABLE or not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")

    try:
        # Replace URL encoded colon if needed
        time = time.replace("%3A", ":")

        success = scheduler.remove_schedule(time)
        if success:
            # Give scheduler a moment to update jobs
            import asyncio

            await asyncio.sleep(0.1)
            # Get updated status after removal
            status = scheduler.get_status()
            return {"success": True, "message": f"Schedule removed: {time}", **status}
        else:
            raise HTTPException(status_code=404, detail="Schedule not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing schedule: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.delete("/api/scheduler/schedules")
async def clear_all_schedules():
    """Remove all schedules"""
    if not SCHEDULER_AVAILABLE or not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")

    try:
        scheduler.clear_schedules()
        # Get updated status immediately after clearing
        status = scheduler.get_status()
        return {"success": True, "message": "All schedules cleared", **status}
    except Exception as e:
        logger.error(f"Error clearing schedules: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/scheduler/enable")
async def enable_scheduler():
    """Enable the scheduler"""
    if not SCHEDULER_AVAILABLE or not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")

    try:
        config = scheduler.update_config({"enabled": True})
        scheduler.restart()
        return {"success": True, "message": "Scheduler enabled", "config": config}
    except Exception as e:
        logger.error(f"Error enabling scheduler: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/scheduler/disable")
async def disable_scheduler():
    """Disable the scheduler"""
    if not SCHEDULER_AVAILABLE or not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")

    try:
        config = scheduler.update_config({"enabled": False})
        scheduler.stop()
        return {"success": True, "message": "Scheduler disabled", "config": config}
    except Exception as e:
        logger.error(f"Error disabling scheduler: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/scheduler/restart")
async def restart_scheduler():
    """Restart the scheduler with current configuration"""
    if not SCHEDULER_AVAILABLE or not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")

    try:
        scheduler.restart()
        status = scheduler.get_status()
        return {"success": True, "message": "Scheduler restarted", **status}
    except Exception as e:
        logger.error(f"Error restarting scheduler: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/scheduler/run-now")
async def run_scheduler_now():
    """Manually trigger a scheduled run immediately (non-blocking)"""
    if not SCHEDULER_AVAILABLE or not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")

    try:
        # Use asyncio.create_task to run it asynchronously
        asyncio.create_task(scheduler.run_script(force_run=True))
        return {"success": True, "message": "Manual run triggered successfully"}
    except RuntimeError as e:
        logger.warning(f"Cannot trigger run: {e}")
        raise HTTPException(status_code=400, detail="A script execution is already in progress or the scheduler is busy.")

    except Exception as e:
        logger.error(f"Error triggering scheduled run: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ============================================================================
# LOGS WATCHER API
# ============================================================================


@app.get("/api/logs-watcher/status")
async def get_logs_watcher_status():
    """Get current logs watcher status"""
    try:
        if not LOGS_WATCHER_AVAILABLE:
            return {
                "success": True,
                "available": False,
                "running": False,
                "message": "Logs watcher module not available",
            }

        if not logs_watcher:
            return {
                "success": True,
                "available": True,
                "running": False,
                "message": "Logs watcher not initialized (database may not be available)",
            }

        return {
            "success": True,
            "available": True,
            "running": logs_watcher.is_running,
            "logs_dir": str(logs_watcher.logs_dir),
            "debounce_seconds": logs_watcher.debounce_seconds,
            "poll_interval": logs_watcher.poll_interval,
            "monitored_files": {
                "csv": "ImageChoices.csv",
                "json": sorted(
                    [
                        "tautulli.json",
                        "arr.json",
                        "normal.json",
                        "manual.json",
                        "testing.json",
                        "backup.json",
                        "syncjelly.json",
                        "syncemby.json",
                        "scheduled.json",
                        "replace.json",
                    ]
                ),
            },
        }

    except Exception as e:
        logger.error(f"Error getting logs watcher status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


# ============================================================================
# ASSET REPLACEMENT API
# ============================================================================


class AssetReplaceRequest(BaseModel):
    """Request to fetch asset previews from services or upload custom"""

    asset_path: str  # Path to the asset being replaced
    media_type: str  # "movie" or "tv"
    asset_type: str  # "poster", "background", "season", "titlecard"
    tmdb_id: Optional[str] = None
    tvdb_id: Optional[str] = None
    imdb_id: Optional[str] = None
    title: Optional[str] = None  # Movie/show title for fallback search
    show_title: Optional[str] = None
    year: Optional[int] = None  # Release year for fallback search
    season_number: Optional[int] = None
    episode_number: Optional[int] = None
    is_manual_search: bool = False


class AssetUploadRequest(BaseModel):
    """Request to replace an asset with uploaded image"""

    asset_path: str
    image_data: str  # Base64 encoded image

class BulkDeleteAssetsRequest(BaseModel):
    record_ids: List[int] = Field(..., min_items=1)

@app.post("/api/assets/fetch-replacements")
async def fetch_asset_replacements(request: AssetReplaceRequest):
    """
    Fetch replacement asset previews from TMDB, TVDB, and Fanart.tv
    Returns a list of preview images from all available sources
    """
    try:
        # Determine the best title to use for searches
        search_query_title = request.show_title if request.show_title else request.title

        # DEBUG: Log incoming request
        logger.info("=" * 80)
        logger.info(f"FETCH ASSET REPLACEMENTS REQUEST:")
        logger.info(f"  Asset Path: {request.asset_path}")
        logger.info(f"  Media Type: {request.media_type}")
        logger.info(f"  Asset Type: {request.asset_type}")
        logger.info(f"  Title: {request.title}")
        logger.info(f"  Year: {request.year}")
        logger.info(f"  TMDB ID: {request.tmdb_id}")
        logger.info(f"  TVDB ID: {request.tvdb_id}")
        logger.info(f"  IMDB ID: {request.imdb_id}")
        logger.info(f"  Season Number: {request.season_number}")
        logger.info(f"  Episode Number: {request.episode_number}")
        logger.info("=" * 80)

        # Try to get IDs from database if not provided in request
        if (not request.tmdb_id or not request.tvdb_id) and not request.is_manual_search:
            try:
                # Use the global thread-safe db instance
                if not db:
                    logger.warning("Database not initialized, cannot fetch IDs")
                    raise Exception("Database not available")

                db_record = None
                search_method = None

                # Method 1: Search by asset path (for AssetReplacer)
                if not request.is_manual_search and request.asset_path and not request.asset_path.startswith("manual_"):
                    # Extract show/movie name from asset path to match against Rootfolder
                    import os

                    path_parts = request.asset_path.replace("\\", "/").split("/")

                    # Look for folder with TMDB/TVDB ID pattern in path
                    rootfolder_candidate = None
                    for part in path_parts:
                        # Check if this part has an ID pattern like {tmdb-123}, [tvdb-456], etc.
                        if any(
                            pattern in part.lower()
                            for pattern in ["tmdb-", "tvdb-", "imdb-"]
                        ):
                            rootfolder_candidate = part
                            break

                    if rootfolder_candidate:
                        logger.info(
                            f"Searching database by path for: {rootfolder_candidate}"
                        )
                        search_method = "path"

                        with db.lock:
                            conn = db._get_connection()
                            try:
                                cursor = conn.cursor()
                                cursor.execute(
                                    """
                                    SELECT tmdbid, tvdbid, imdbid, Rootfolder
                                    FROM imagechoices
                                    WHERE Rootfolder LIKE ?
                                    LIMIT 1
                                """,
                                    (f"%{rootfolder_candidate}%",),
                                )
                                db_record = cursor.fetchone()
                            finally:
                                conn.close()
                # Method 2: Search by title + year (for Manual Mode)
                if not db_record and search_query_title:
                    logger.info(
                        f"Searching database by title for: '{search_query_title}' (year: {request.year})"
                    )
                    search_method = "title"

                    with db.lock:
                        conn = db._get_connection()
                        try:
                            cursor = conn.cursor()
                            if request.year:
                                cursor.execute(
                                    """
                                    SELECT tmdbid, tvdbid, imdbid, Rootfolder
                                    FROM imagechoices
                                    WHERE Rootfolder LIKE ?
                                    LIMIT 1
                                """,
                                    (f"%{search_query_title}%({request.year})%",),
                                )
                            else:
                                cursor.execute(
                                    """
                                    SELECT tmdbid, tvdbid, imdbid, Rootfolder
                                    FROM imagechoices
                                    WHERE Rootfolder LIKE ?
                                    LIMIT 1
                                """,
                                    (f"%{search_query_title}%",),
                                )
                            db_record = cursor.fetchone()
                        finally:
                            conn.close()

                # Process database record if found
                if db_record:
                    db_tmdbid = db_record[0] if db_record[0] != "false" else None
                    db_tvdbid = db_record[1] if db_record[1] != "false" else None
                    db_imdbid = db_record[2] if db_record[2] != "false" else None
                    db_rootfolder = db_record[3]

                    logger.info(f"Found database record (via {search_method}):")
                    logger.info(f"  Rootfolder: {db_rootfolder}")
                    logger.info(f"  TMDB ID: {db_tmdbid}")
                    logger.info(f"  TVDB ID: {db_tvdbid}")
                    logger.info(f"  IMDB ID: {db_imdbid}")

                    # Use database IDs if not provided in request
                    if not request.tmdb_id and db_tmdbid:
                        request.tmdb_id = db_tmdbid
                        logger.info(f"Using TMDB ID from database: {db_tmdbid}")

                    if not request.tvdb_id and db_tvdbid:
                        request.tvdb_id = db_tvdbid
                        logger.info(f"Using TVDB ID from database: {db_tvdbid}")

                    # Store IMDB ID for Fanart.tv (store in request for later use)
                    if db_imdbid:
                        # Store it as a custom attribute (we'll use it for Fanart)
                        if not hasattr(request, "imdb_id") or not request.imdb_id:
                            request.imdb_id = db_imdbid
                            logger.info(f"Using IMDB ID from database: {db_imdbid}")
                else:
                    logger.info(
                        f"No matching database record found (searched via {search_method})"
                    )

            except Exception as e:
                logger.warning(f"Could not query database for IDs: {e}")
                logger.debug("Continuing with title-based search...")

        # Load config to get API keys and language preferences
        if not CONFIG_PATH.exists():
            raise HTTPException(status_code=404, detail="Config file not found")

        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            grouped_config = json.load(f)

        # Get API tokens and language preferences - support multiple key name variants
        if CONFIG_MAPPER_AVAILABLE:
            flat_config = flatten_config(grouped_config)
            tmdb_token = flat_config.get("tmdbtoken", "")
            # Support both "tvdbapikey" and "tvdbapi" for TVDB
            tvdb_api_key = flat_config.get("tvdbapikey") or flat_config.get(
                "tvdbapi", ""
            )

            tvdb_pin = ""  # Initialize pin
            if "#" in tvdb_api_key:
                tvdb_api_key_parts = tvdb_api_key.split("#", 2)
                tvdb_api_key = tvdb_api_key_parts[0]
                tvdb_pin = tvdb_api_key_parts[1]

            # Support both "fanartapikey" and "FanartTvAPIKey" for Fanart.tv
            fanart_api_key = (
                flat_config.get("fanartapikey")
                or flat_config.get("fanarttvapikey")
                or flat_config.get("FanartTvAPIKey", "")
            )
            # Get language preferences
            preferred_language_order = flat_config.get("PreferredLanguageOrder", "")
            preferred_season_language_order = flat_config.get(
                "PreferredSeasonLanguageOrder", ""
            )
            preferred_background_language_order = flat_config.get(
                "PreferredBackgroundLanguageOrder", ""
            )
            preferred_tc_language_order = flat_config.get(
                "PreferredTCLanguageOrder", ""
            )
            # Add LogoLanguageOrder retrieval
            preferred_logo_language_order = flat_config.get(
                "LogoLanguageOrder", ""
            )
        else:
            api_part = grouped_config.get("ApiPart", {})
            tmdb_token = api_part.get("tmdbtoken", "")
            # Support both "tvdbapikey" and "tvdbapi" for TVDB
            tvdb_api_key = api_part.get("tvdbapikey") or api_part.get("tvdbapi", "")

            tvdb_pin = ""  # Initialize pin
            if "#" in tvdb_api_key:
                tvdb_api_key_parts = tvdb_api_key.split("#", 2)
                tvdb_api_key = tvdb_api_key_parts[0]
                tvdb_pin = tvdb_api_key_parts[1]

            # Support both "fanartapikey" and "FanartTvAPIKey" for Fanart.tv
            fanart_api_key = (
                api_part.get("fanartapikey")
                or api_part.get("fanarttvapikey")
                or api_part.get("FanartTvAPIKey", "")
            )

            # Try to get language preferences from different possible locations
            preferred_language_order = grouped_config.get("PreferredLanguageOrder", "")
            preferred_season_language_order = grouped_config.get(
                "PreferredSeasonLanguageOrder", ""
            )
            preferred_background_language_order = grouped_config.get(
                "PreferredBackgroundLanguageOrder", ""
            )
            preferred_tc_language_order = grouped_config.get(
                "PreferredTCLanguageOrder", ""
            )
            preferred_logo_language_order = grouped_config.get(
                "LogoLanguageOrder", ""
            )

            # If not found at root, try in ApiPart
            if not preferred_language_order and isinstance(
                grouped_config.get("ApiPart"), dict
            ):
                preferred_language_order = grouped_config["ApiPart"].get(
                    "PreferredLanguageOrder", ""
                )
            if not preferred_season_language_order and isinstance(
                grouped_config.get("ApiPart"), dict
            ):
                preferred_season_language_order = grouped_config["ApiPart"].get(
                    "PreferredSeasonLanguageOrder", ""
                )
            if not preferred_background_language_order and isinstance(
                grouped_config.get("ApiPart"), dict
            ):
                preferred_background_language_order = grouped_config["ApiPart"].get(
                    "PreferredBackgroundLanguageOrder", ""
                )
            if not preferred_tc_language_order and isinstance(
                grouped_config.get("ApiPart"), dict
            ):
                preferred_tc_language_order = grouped_config["ApiPart"].get(
                    "PreferredTCLanguageOrder", ""
                )
            if not preferred_logo_language_order and isinstance(
                grouped_config.get("ApiPart"), dict
            ):
                preferred_logo_language_order = grouped_config["ApiPart"].get(
                    "LogoLanguageOrder", ""
                )

        # Parse language preferences (handle both string and list formats)
        def parse_language_order(value):
            """Convert language order to list, handling both string and list inputs"""
            if not value:
                return []
            if isinstance(value, list):
                # Already a list, just clean up entries
                return [lang.strip() for lang in value if lang and str(lang).strip()]
            if isinstance(value, str):
                # String format, split by comma
                return [lang.strip() for lang in value.split(",") if lang.strip()]
            return []

        language_order_list = parse_language_order(preferred_language_order)
        season_language_order_list = parse_language_order(
            preferred_season_language_order
        )
        background_language_order_list = parse_language_order(
            preferred_background_language_order
        )
        tc_language_order_list = parse_language_order(preferred_tc_language_order)
        logo_language_order_list = parse_language_order(preferred_logo_language_order)

        logger.info(
            f"Language preferences loaded - Standard: {language_order_list}, Season: {season_language_order_list}, Background: {background_language_order_list}, TitleCard: {tc_language_order_list}, Logo: {logo_language_order_list}"
        )

        # Helper function to filter and sort by language preference
        def filter_and_sort_by_language(items_list, preferred_languages):
            """
            Sort items based on preferred language order.
            Preferred languages come first in order, then all other languages.

            Args:
                items_list: List of item dicts with 'language' field
                preferred_languages: List of language codes in order of preference (e.g., ['de', 'en', 'xx'])

            Returns:
                Sorted list of items (preferred languages first, then others)
            """
            if not preferred_languages or not items_list:
                return items_list

            # Normalize language codes to lowercase
            preferred_languages = [
                lang.lower().strip() for lang in preferred_languages if lang
            ]

            # Group items by language
            language_groups = {lang: [] for lang in preferred_languages}
            language_groups["other"] = []  # For languages not in preferences

            for item in items_list:
                item_lang = (item.get("language") or "xx").lower()

                # Check if item language matches any preferred language
                if item_lang in preferred_languages:
                    language_groups[item_lang].append(item)
                else:
                    language_groups["other"].append(item)

            # Build result list in order of preference, then add other languages
            result = []
            for lang in preferred_languages:
                result.extend(language_groups[lang])

            # Add other languages at the end
            #result.extend(language_groups["other"])

            return result

        results = {"tmdb": [], "tvdb": [], "fanart": []}

        # Helper function to search for TMDB ID by title and year
        async def search_tmdb_id(
            title: str, year: Optional[int], media_type: str
        ) -> Optional[str]:
            if not tmdb_token or not title:
                return None
            try:
                headers = {
                    "Authorization": f"Bearer {tmdb_token}",
                    "Content-Type": "application/json",
                }
                search_endpoint = "movie" if media_type == "movie" else "tv"
                url = f"https://api.themoviedb.org/3/search/{search_endpoint}"
                params = {"query": title}

                if year and media_type == "movie":
                    params["year"] = year
                elif year and media_type == "tv":
                    params["first_air_date_year"] = year

                logger.info(f" TMDB API Request: {url}")
                logger.info(f"   Params: {params}")

                response = requests.get(url, headers=headers, params=params, timeout=10)
                logger.info(f"   Response Status: {response.status_code}")

                if response.status_code == 200:
                    data = response.json()
                    search_results = data.get("results", [])
                    logger.info(f"   Results Count: {len(search_results)}")
                    if search_results:
                        result_id = str(search_results[0].get("id"))
                        result_title = search_results[0].get(
                            "title" if media_type == "movie" else "name"
                        )
                        logger.info(
                            f"   First Result: ID={result_id}, Title='{result_title}'"
                        )
                        return result_id
                    else:
                        logger.warning(f"   No results found in TMDB response")
            except Exception as e:
                logger.error(f"Error searching TMDB by title: {e}")
            return None

        # Helper function to search for TVDB ID by title and year
        async def search_tvdb_id(
            title: str, year: Optional[int], media_type: str
        ) -> Optional[str]:
            if not tvdb_api_key or not title:
                return None
            try:
                # First, login to get token
                async with httpx.AsyncClient(timeout=10.0) as client:
                    login_url = "https://api4.thetvdb.com/v4/login"
                    body = {"apikey": tvdb_api_key}
                    if tvdb_pin:
                        body["pin"] = tvdb_pin

                    headers_tvdb = {
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    }

                    login_response = await client.post(
                        login_url, json=body, headers=headers_tvdb
                    )

                    if login_response.status_code == 200:
                        token = login_response.json().get("data", {}).get("token")

                        if token:
                            auth_headers = {
                                "Authorization": f"Bearer {token}",
                                "accept": "application/json",
                            }

                            # Search for series/movie
                            search_url = "https://api4.thetvdb.com/v4/search"
                            params = {
                                "query": title,
                                "type": "series" if media_type == "tv" else "movie",
                            }

                            if year:
                                params["year"] = year

                            logger.info(f" TVDB API Request: {search_url}")
                            logger.info(f"   Params: {params}")

                            search_response = await client.get(
                                search_url, headers=auth_headers, params=params
                            )
                            logger.info(
                                f"   Response Status: {search_response.status_code}"
                            )

                            if search_response.status_code == 200:
                                data = search_response.json()
                                results = data.get("data", [])
                                logger.info(f"   Results Count: {len(results)}")

                                if results:
                                    # Get the first result
                                    result_id = str(results[0].get("tvdb_id"))
                                    result_name = results[0].get("name")
                                    logger.info(
                                        f"   First Result: ID={result_id}, Name='{result_name}'"
                                    )
                                    return result_id
                                else:
                                    logger.warning(
                                        f"   No results found in TVDB response"
                                    )
                        else:
                            logger.error(f" TVDB: Login failed with code: {login_response.status_code}")
            except Exception as e:
                logger.error(f"Error searching TVDB by title: {e}")
            return None

        # Determine TMDB ID(s) - collect multiple IDs for dual search
        tmdb_ids_to_use = []

        # If TMDB ID is provided or found in DB, use it
        if request.tmdb_id:
            tmdb_ids_to_use.append(("provided_id", request.tmdb_id))
            logger.info(f"Using TMDB ID from database/request: {request.tmdb_id}")

        # Check if title contains an ID with prefix (e.g., "tmdb-123", "tvdb-456", "imdb-789")
        # This handles manual ID entry in RunModes search bar with explicit provider prefix
        # ONLY check for prefixes if we don't have IDs from database yet
        potential_tmdb_id = None
        potential_tvdb_id = None
        potential_imdb_id = None
        detected_provider = None  # Track which provider prefix was used

        if not tmdb_ids_to_use and search_query_title:
            title_lower = search_query_title.strip().lower()

            # Check for TMDB ID: tmdb-123 or tmdb:123
            tmdb_match = re.match(r"tmdb[-:](\d+)", title_lower)
            if tmdb_match:
                potential_tmdb_id = tmdb_match.group(1)
                detected_provider = "tmdb"
                logger.info(f"Detected TMDB ID from title prefix: {potential_tmdb_id}")

            # Check for TVDB ID: tvdb-123 or tvdb:123
            tvdb_match = re.match(r"tvdb[-:](\d+)", title_lower)
            if tvdb_match:
                potential_tvdb_id = tvdb_match.group(1)
                detected_provider = "tvdb"
                logger.info(f"Detected TVDB ID from title prefix: {potential_tvdb_id}")

            # Check for IMDB ID: imdb-123 or imdb:123 or imdb-tt123 or just tt123
            imdb_match = re.match(r"(?:imdb[-:])?(?:tt)?(\d+)", title_lower)
            if imdb_match and (
                title_lower.startswith("imdb") or title_lower.startswith("tt")
            ):
                potential_imdb_id = imdb_match.group(1)
                detected_provider = "imdb"
                # IMDB IDs should have the 'tt' prefix for Fanart.tv
                if not potential_imdb_id.startswith("tt"):
                    potential_imdb_id = f"tt{potential_imdb_id}"
                logger.info(f"Detected IMDB ID from title prefix: {potential_imdb_id}")

        # If we detected a TMDB ID in title prefix, use it
        if not tmdb_ids_to_use and potential_tmdb_id:
            tmdb_ids_to_use.append(("manual_id_entry", potential_tmdb_id))
            logger.info(
                f"Using manually entered TMDB ID from prefix: {potential_tmdb_id}"
            )

        # Only search by title if we don't have any TMDB ID yet AND no ID prefix was detected
        if (
            not tmdb_ids_to_use
            and search_query_title
            and not (potential_tmdb_id or potential_tvdb_id or potential_imdb_id)
            and tmdb_token
        ):
            logger.info(
                f"No TMDB ID available - searching TMDB by title: '{search_query_title}' (year: {request.year})"
            )
            found_id = await search_tmdb_id(
                search_query_title, request.year, request.media_type
            )
            if found_id:
                tmdb_ids_to_use.append(("title_search", found_id))
                logger.info(f"Found TMDB ID from title search: {found_id}")
            else:
                logger.warning(f"No TMDB ID found for title: '{search_query_title}'")

        # Determine TVDB ID(s) - collect multiple IDs for dual search
        tvdb_ids_to_use = []

        # If TVDB ID is provided or found in DB, use it (works for both TV and Movies in TVDB API v4)
        if request.tvdb_id:
            tvdb_ids_to_use.append(("provided_id", request.tvdb_id))
            logger.info(
                f"Using TVDB ID from database/request: {request.tvdb_id} (media_type: {request.media_type})"
            )

        # If we detected a TVDB ID in title prefix (only if no DB ID), use it
        if not tvdb_ids_to_use and potential_tvdb_id:
            tvdb_ids_to_use.append(("manual_id_entry", potential_tvdb_id))
            logger.info(
                f"Using manually entered TVDB ID from prefix: {potential_tvdb_id}"
            )

        # Only search by title if we don't have any TVDB ID yet AND no ID prefix was detected
        # TVDB API v4 supports both TV shows and movies
        if (
            not tvdb_ids_to_use
            and search_query_title
            and not (potential_tmdb_id or potential_tvdb_id or potential_imdb_id)
            and tvdb_api_key
        ):
            logger.info(
                f"No TVDB ID available - searching TVDB by title: '{search_query_title}' (year: {request.year}, media_type: {request.media_type})"
            )
            found_id = await search_tvdb_id(
                search_query_title, request.year, request.media_type
            )
            if found_id:
                tvdb_ids_to_use.append(("title_search", found_id))
                logger.info(f"Found TVDB ID from title search: {found_id}")
            else:
                logger.warning(f"No TVDB ID found for title: '{search_query_title}'")

        # Create async tasks for parallel fetching - AFTER IDs are resolved
        async def fetch_tmdb():
            """Fetch TMDB assets asynchronously from all collected IDs"""
            if not tmdb_token:
                logger.warning("TMDB: No API token configured")
                return []

            if not tmdb_ids_to_use:
                logger.warning("TMDB: No TMDB IDs available")
                return []

            all_results = []
            seen_urls = set()  # Track unique image URLs to avoid duplicates

            try:
                headers = {
                    "Authorization": f"Bearer {tmdb_token}",
                    "Content-Type": "application/json",
                }

                media_endpoint = "movie" if request.media_type == "movie" else "tv"

                # Fetch from all collected IDs
                for source, tmdb_id in tmdb_ids_to_use:
                    logger.info(
                        f" TMDB: Fetching {request.asset_type} for ID: {tmdb_id} (from {source})"
                    )

                    async with httpx.AsyncClient(timeout=10.0) as client:
                        if request.asset_type == "logo":
                            # LOGOS (PNGs)
                            url = f"https://api.themoviedb.org/3/{media_endpoint}/{tmdb_id}/images"
                            response = await client.get(url, headers=headers)
                            if response.status_code == 200:
                                data = response.json()
                                # TMDB stores clear logos in the 'logos' array
                                for logo in data.get("logos", []):
                                    file_path = logo.get('file_path')
                                    original_url = f"https://image.tmdb.org/t/p/original{file_path}"

                                    if original_url not in seen_urls:
                                        seen_urls.add(original_url)
                                        all_results.append(
                                            {
                                                "url": f"https://image.tmdb.org/t/p/w500{file_path}", # Preview
                                                "original_url": original_url, # Actual full res for the script
                                                "source": "TMDB",
                                                "source_type": source,
                                                "type": "logo",
                                                "language": logo.get("iso_639_1"),
                                                "vote_average": logo.get("vote_average", 0),
                                                "width": logo.get("width", 0),
                                                "height": logo.get("height", 0),
                                            }
                                        )
                        elif (
                            request.asset_type == "titlecard"
                            and request.season_number
                            and request.episode_number
                        ):
                            # Episode stills
                            url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{request.season_number}/episode/{request.episode_number}/images"
                            response = await client.get(url, headers=headers)
                            if response.status_code == 200:
                                data = response.json()
                                for still in data.get("stills", []):
                                    original_url = f"https://image.tmdb.org/t/p/original{still.get('file_path')}"
                                    if original_url not in seen_urls:
                                        seen_urls.add(original_url)
                                        all_results.append(
                                            {
                                                "url": f"https://image.tmdb.org/t/p/w500{still.get('file_path')}",
                                                "original_url": original_url,
                                                "source": "TMDB",
                                                "source_type": source,  # "provided_id" or "title_search"
                                                "type": "episode_still",
                                                "language": still.get("iso_639_1"),
                                                "vote_average": still.get(
                                                    "vote_average", 0
                                                ),
                                                "width": still.get("width", 0),
                                                "height": still.get("height", 0),
                                            }
                                        )

                        elif request.asset_type == "season" and request.season_number:
                            # Season posters
                            url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{request.season_number}/images"
                            response = await client.get(url, headers=headers)
                            if response.status_code == 200:
                                data = response.json()
                                for poster in data.get("posters", []):
                                    original_url = f"https://image.tmdb.org/t/p/original{poster.get('file_path')}"
                                    if original_url not in seen_urls:
                                        seen_urls.add(original_url)
                                        all_results.append(
                                            {
                                                "url": f"https://image.tmdb.org/t/p/w500{poster.get('file_path')}",
                                                "original_url": original_url,
                                                "source": "TMDB",
                                                "source_type": source,  # "provided_id" or "title_search"
                                                "type": "season_poster",
                                                "language": poster.get("iso_639_1"),
                                                "vote_average": poster.get(
                                                    "vote_average", 0
                                                ),
                                                "width": poster.get("width", 0),
                                                "height": poster.get("height", 0),
                                            }
                                        )

                        elif request.asset_type == "background":
                            # Backgrounds
                            url = f"https://api.themoviedb.org/3/{media_endpoint}/{tmdb_id}/images"
                            response = await client.get(url, headers=headers)
                            if response.status_code == 200:
                                data = response.json()
                                for backdrop in data.get("backdrops", []):
                                    original_url = f"https://image.tmdb.org/t/p/original{backdrop.get('file_path')}"
                                    if original_url not in seen_urls:
                                        seen_urls.add(original_url)
                                        all_results.append(
                                            {
                                                "url": f"https://image.tmdb.org/t/p/w500{backdrop.get('file_path')}",
                                                "original_url": original_url,
                                                "source": "TMDB",
                                                "source_type": source,  # "provided_id" or "title_search"
                                                "type": "backdrop",
                                                "language": backdrop.get("iso_639_1"),
                                                "vote_average": backdrop.get(
                                                    "vote_average", 0
                                                ),
                                                "width": backdrop.get("width", 0),
                                                "height": backdrop.get("height", 0),
                                            }
                                        )

                        else:
                            # Standard posters
                            url = f"https://api.themoviedb.org/3/{media_endpoint}/{tmdb_id}/images"
                            logger.info(f" TMDB Poster URL: {url}")
                            response = await client.get(url, headers=headers)
                            logger.info(
                                f" TMDB Response Status: {response.status_code}"
                            )
                            if response.status_code == 200:
                                data = response.json()
                                for poster in data.get("posters", []):
                                    original_url = f"https://image.tmdb.org/t/p/original{poster.get('file_path')}"
                                    if original_url not in seen_urls:
                                        seen_urls.add(original_url)
                                        all_results.append(
                                            {
                                                "url": f"https://image.tmdb.org/t/p/w500{poster.get('file_path')}",
                                                "original_url": original_url,
                                                "source": "TMDB",
                                                "source_type": source,  # "provided_id" or "title_search"
                                                "type": "poster",
                                                "language": poster.get("iso_639_1"),
                                                "vote_average": poster.get(
                                                    "vote_average", 0
                                                ),
                                                "width": poster.get("width", 0),
                                                "height": poster.get("height", 0),
                                            }
                                        )

                logger.info(
                    f" TMDB: Collected {len(all_results)} unique images from {len(tmdb_ids_to_use)} ID(s)"
                )

            except Exception as e:
                logger.error(f"Error fetching TMDB assets: {e}")

            return all_results

        async def fetch_tvdb():
            """Fetch TVDB assets asynchronously from all collected IDs"""
            if not tvdb_api_key:
                logger.warning("TVDB: No API key configured")
                return []

            if not tvdb_ids_to_use:
                logger.warning(
                    f"TVDB: No TVDB IDs available (media_type={request.media_type}, asset_type={request.asset_type}) - skipping TVDB fetch"
                )
                return []

            logger.info(
                f"TVDB: Starting fetch for {len(tvdb_ids_to_use)} ID(s): {tvdb_ids_to_use}"
            )
            all_results = []
            seen_urls = set()

            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    login_url = "https://api4.thetvdb.com/v4/login"
                    body = {"apikey": tvdb_api_key}
                    if tvdb_pin:
                        body["pin"] = tvdb_pin

                    headers_tvdb = {
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    }

                    login_response = await client.post(
                        login_url, json=body, headers=headers_tvdb
                    )

                    if login_response.status_code == 200:
                        token = login_response.json().get("data", {}).get("token")

                        if token:
                            auth_headers = {
                                "Authorization": f"Bearer {token}",
                                "accept": "application/json",
                            }

                            for source, tvdb_id in tvdb_ids_to_use:
                                entity_type = (
                                    "series" if request.media_type == "tv" else "movies"
                                )

                                # =========================================================
                                # LOGIC 1: SEASON POSTERS
                                # =========================================================
                                if (
                                    request.asset_type == "season"
                                    and request.season_number
                                    and entity_type == "series"
                                ):
                                    # [Logic remains same as previous working version]
                                    logger.info(f" TVDB: Fetching season {request.season_number} for {tvdb_id}")
                                    series_ext_url = f"https://api4.thetvdb.com/v4/series/{tvdb_id}/extended"
                                    series_resp = await client.get(series_ext_url, headers=auth_headers)

                                    if series_resp.status_code == 200:
                                        series_data = series_resp.json().get("data", {})
                                        seasons_list = series_data.get("seasons", [])

                                        target_season_id = None
                                        for s in seasons_list:
                                            if s.get("number") == request.season_number and s.get("type", {}).get("type") == "official":
                                                target_season_id = s.get("id")
                                                break

                                        if not target_season_id:
                                            for s in seasons_list:
                                                if s.get("number") == request.season_number and s.get("type", {}).get("type") == "alternate":
                                                    target_season_id = s.get("id")
                                                    break

                                        if target_season_id:
                                            season_ext_url = f"https://api4.thetvdb.com/v4/seasons/{target_season_id}/extended"
                                            season_resp = await client.get(season_ext_url, headers=auth_headers)

                                            if season_resp.status_code == 200:
                                                season_data = season_resp.json().get("data", {})
                                                artworks = season_data.get("artwork", [])

                                                for art in artworks:
                                                    if str(art.get("type")) == '7':
                                                        img = art.get("image")
                                                        if img and img not in seen_urls:
                                                            seen_urls.add(img)

                                                            raw_lang = art.get("language")
                                                            # 1. Map textless (null, None, or empty) to "xx"
                                                            if raw_lang is None or str(raw_lang).lower() == "null" or str(raw_lang).strip() == "":
                                                                final_lang = "xx"
                                                            # 2. Convert 3-letter codes to 2-letter (eng -> en)
                                                            elif isinstance(raw_lang, str) and len(raw_lang) >= 2:
                                                                final_lang = raw_lang[:2].lower()
                                                            # 3. Fallback
                                                            else:
                                                                final_lang = raw_lang

                                                            all_results.append({
                                                                "url": img,
                                                                "original_url": img,
                                                                "source": "TVDB",
                                                                "source_type": source,
                                                                "type": "season",
                                                                "language": final_lang,
                                                                "width": art.get("width", 0),
                                                                "height": art.get("height", 0),
                                                            })

                                # =========================================================
                                # LOGIC 2: TITLE CARDS
                                # =========================================================
                                elif (
                                    request.asset_type == "titlecard"
                                    and request.season_number is not None
                                    and request.episode_number is not None
                                    and entity_type == "series"
                                ):
                                    # [Logic remains same as previous working version]
                                    logger.info(f" TVDB: Fetching Title Card S{request.season_number}E{request.episode_number} for {tvdb_id}")
                                    page = 0
                                    found_episode = False
                                    while not found_episode:
                                        ep_url = f"https://api4.thetvdb.com/v4/series/{tvdb_id}/episodes/default"
                                        ep_resp = await client.get(ep_url, headers=auth_headers, params={"page": page})
                                        if ep_resp.status_code != 200: break
                                        ep_data = ep_resp.json().get("data", {})
                                        episodes_list = ep_data.get("episodes", [])
                                        if not episodes_list: break
                                        for ep in episodes_list:
                                            if (ep.get("seasonNumber") == request.season_number and
                                                ep.get("number") == request.episode_number):
                                                img = ep.get("image")
                                                if img and img not in seen_urls:
                                                    seen_urls.add(img)
                                                    all_results.append({
                                                        "url": img,
                                                        "original_url": img,
                                                        "source": "TVDB",
                                                        "source_type": source,
                                                        "type": "titlecard",
                                                        "language": None,
                                                        "width": 0, "height": 0,
                                                    })
                                                found_episode = True
                                                break
                                        page += 1
                                        if page > 50: break

                                # =========================================================
                                # LOGIC 3: MAIN ARTWORKS (POSTERS, BACKGROUNDS, LOGOS)
                                # =========================================================
                                else:
                                    artworks_found = []
                                    should_try_both = source == "manual_id_entry"

                                    # 3a. MOVIE Logic -> /extended
                                    if entity_type == "movies" or should_try_both:
                                        artwork_url = f"https://api4.thetvdb.com/v4/movies/{tvdb_id}/extended"
                                        resp = await client.get(artwork_url, headers=auth_headers)
                                        if resp.status_code == 200:
                                            movie_data = resp.json()
                                            raw_list = movie_data.get("data", {}).get("artworks", [])
                                            for x in raw_list:
                                                x['_origin_type'] = 'movie'
                                            artworks_found.extend(raw_list)

                                    # 3b. SERIES Logic -> /artworks
                                    # Only skip if we are in 'try both' mode and already found movies.
                                    # For normal series requests, this ALWAYS runs.
                                    if entity_type == "series" or (should_try_both and not artworks_found):
                                        artwork_url = f"https://api4.thetvdb.com/v4/series/{tvdb_id}/artworks"
                                        resp = await client.get(artwork_url, headers=auth_headers)
                                        if resp.status_code == 200:
                                            series_data = resp.json()
                                            raw_data = series_data.get("data")
                                            # Handle both Data list (direct) and Data dict (with .artworks)
                                            if isinstance(raw_data, dict) and "artworks" in raw_data:
                                                raw_list = raw_data.get("artworks", [])
                                            elif isinstance(raw_data, list):
                                                raw_list = raw_data
                                            else:
                                                raw_list = []

                                            for x in raw_list:
                                                x['_origin_type'] = 'series'
                                            artworks_found.extend(raw_list)

                                    logger.info(f" TVDB: Processing {len(artworks_found)} total artworks for ID {tvdb_id}")

                                    # 3c. FILTERING
                                    for artwork in artworks_found:
                                        image_url = artwork.get("image")
                                        if not image_url or image_url in seen_urls:
                                            continue

                                        art_type = str(artwork.get("type"))
                                        # Relax origin check slightly to ensure we don't miss valid types due to tagging issues
                                        is_match = False

                                        # Allow "logo", "clearlogo", "clearart" to trigger logo logic
                                        if request.asset_type in ["logo", "clearlogo", "clearart"]:
                                            # Series: 23 (ClearLogo), 22 (ClearArt)
                                            # Movies: 25 (ClearLogo), 24 (ClearArt)
                                            # We check ALL valid logo types to be safe
                                            if art_type in ['22', '23', '24', '25']:
                                                is_match = True

                                        elif request.asset_type in ["poster", "standard"]:
                                            # Series: 2, Movies: 14
                                            if art_type in ['2', '14']:
                                                is_match = True

                                        elif request.asset_type == "background":
                                            # Series: 3, Movies: 15
                                            if art_type in ['3', '15']:
                                                is_match = True

                                        if is_match:
                                            seen_urls.add(image_url)

                                            # FIX: "Asterisk" / Wildcard Logic
                                            # Instead of a hardcoded map, we take the first 2 letters of the language code.
                                            # This allows 'eng' to match 'en' and 'deu' to match 'de', mimicking the
                                            # PowerShell logic: $_.language -like "$lang*"
                                            raw_lang = artwork.get("language")
                                            # 1. Map textless (null, None, or empty) to "xx"
                                            if raw_lang is None or str(raw_lang).lower() == "null" or str(raw_lang).strip() == "":
                                                final_lang = "xx"
                                            # 2. Convert 3-letter codes to 2-letter (eng -> en)
                                            elif isinstance(raw_lang, str) and len(raw_lang) >= 2:
                                                final_lang = raw_lang[:2].lower()
                                            # 3. Fallback
                                            else:
                                                final_lang = raw_lang

                                            all_results.append({
                                                "url": image_url,
                                                "original_url": image_url,
                                                "source": "TVDB",
                                                "source_type": source,
                                                "type": "logo" if request.asset_type in ["logo", "clearlogo", "clearart"] else request.asset_type,
                                                "language": final_lang,
                                                # Map 'score' to 'vote_average' to ensure they aren't sorted to the bottom
                                                "vote_average": artwork.get("score", 0),
                                                "width": artwork.get("width", 0),
                                                "height": artwork.get("height", 0),
                                            })

                        else:
                            logger.error(f" TVDB: Login failed with code: {login_response.status_code}")

                logger.info(
                    f" TVDB: Collected {len(all_results)} unique images"
                )

            except Exception as e:
                logger.error(f"Error fetching TVDB assets: {e}")

            return all_results

        async def fetch_fanart():
            """Fetch Fanart.tv assets asynchronously from all collected IDs

            ID Usage:
            - Movies: TMDB ID + IMDB ID
            - TV Shows: TVDB ID only
            """
            if not fanart_api_key:
                logger.warning("Fanart.tv: No API key configured")
                return []

            # Check if we have any IDs to use
            imdb_id = getattr(request, "imdb_id", None)

            # If we detected a manual IMDB ID entry, use it for Fanart (Movies only!)
            if not imdb_id and potential_imdb_id and request.media_type == "movie":
                imdb_id = potential_imdb_id
                logger.info(f"Using manually entered IMDB ID for Fanart.tv: {imdb_id}")

            if not (tmdb_ids_to_use or tvdb_ids_to_use or imdb_id):
                logger.warning("Fanart.tv: No TMDB, TVDB, or IMDB IDs available")
                return []

            all_results = []
            seen_urls = set()  # Track unique image URLs to avoid duplicates

            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    # ========== MOVIES: Use TMDB ID + IMDB ID ==========
                    if request.media_type == "movie":
                        # Try TMDB IDs first
                        if tmdb_ids_to_use:
                            for source, tmdb_id in tmdb_ids_to_use:
                                logger.info(
                                    f" Fanart.tv: Fetching movie artwork for TMDB ID: {tmdb_id} (from {source})"
                                )
                                url = f"https://webservice.fanart.tv/v3/movies/{tmdb_id}?api_key={fanart_api_key}"
                                response = await client.get(url)
                                if response.status_code == 200:
                                    data = response.json()

                                    # Map asset types to fanart.tv keys
                                    if request.asset_type == "logo":
                                        fanart_keys = [
                                            "hdmovieclearart", "hdmovielogo", "clearart", "clearlogo", # Movies
                                            "hdtvclearart", "hdtvlogo", "clearart", "clearlogo" # TV
                                        ]
                                    elif request.asset_type == "poster":
                                        fanart_keys = ["movieposter"]
                                    elif request.asset_type == "background":
                                        fanart_keys = ["moviebackground"]
                                    else:
                                        fanart_keys = []

                                    for key in fanart_keys:
                                        for item in data.get(key, []):
                                            item_url = item.get("url")
                                            if item_url and item_url not in seen_urls:
                                                seen_urls.add(item_url)
                                                all_results.append(
                                                    {
                                                        "url": item_url,
                                                        "original_url": item_url,
                                                        "source": "Fanart.tv",
                                                        "source_type": source,
                                                        "type": request.asset_type,
                                                        "language": item.get("lang"),
                                                        "likes": item.get("likes", 0),
                                                    }
                                                )

                        # Also try IMDB ID if available (Movies only!)
                        if imdb_id:
                            logger.info(
                                f" Fanart.tv: Fetching movie artwork for IMDB ID: {imdb_id} (from database)"
                            )
                            url = f"https://webservice.fanart.tv/v3/movies/{imdb_id}?api_key={fanart_api_key}"
                            response = await client.get(url)
                            if response.status_code == 200:
                                data = response.json()

                                # Map asset types to fanart.tv keys
                                if request.asset_type == "logo":
                                    fanart_keys = [
                                        "hdmovieclearart", "hdmovielogo", "clearart", "clearlogo", # Movies
                                        "hdtvclearart", "hdtvlogo", "clearart", "clearlogo" # TV
                                    ]
                                elif request.asset_type == "poster":
                                    fanart_keys = ["movieposter"]
                                elif request.asset_type == "background":
                                    fanart_keys = ["moviebackground"]
                                else:
                                    fanart_keys = []

                                for key in fanart_keys:
                                    for item in data.get(key, []):
                                        item_url = item.get("url")
                                        if item_url and item_url not in seen_urls:
                                            seen_urls.add(item_url)
                                            all_results.append(
                                                {
                                                    "url": item_url,
                                                    "original_url": item_url,
                                                    "source": "Fanart.tv",
                                                    "source_type": "imdb_id",
                                                    "type": request.asset_type,
                                                    "language": item.get("lang"),
                                                    "likes": item.get("likes", 0),
                                                }
                                            )

                    # ========== TV SHOWS: Use TVDB ID only ==========
                    elif request.media_type == "tv" and tvdb_ids_to_use:
                        logger.info(
                            f" Fanart.tv: Processing {len(tvdb_ids_to_use)} TVDB IDs for TV show"
                        )
                        for source, tvdb_id in tvdb_ids_to_use:
                            logger.info(
                                f" Fanart.tv: Fetching TV artwork for TVDB ID: {tvdb_id} (from {source})"
                            )
                            url = f"https://webservice.fanart.tv/v3/tv/{tvdb_id}?api_key={fanart_api_key}"
                            response = await client.get(url)
                            logger.info(
                                f" Fanart.tv: Response status: {response.status_code}"
                            )
                            if response.status_code == 200:
                                data = response.json()

                                # Map asset types to fanart.tv keys
                                if request.asset_type == "logo":
                                    fanart_keys = [
                                        "hdmovieclearart", "hdmovielogo", "clearart", "clearlogo", # Movies
                                        "hdtvclearart", "hdtvlogo", "clearart", "clearlogo" # TV
                                    ]
                                elif request.asset_type == "poster":
                                    # Standard TV show posters
                                    fanart_keys = ["tvposter"]
                                elif request.asset_type == "season":
                                    # Season-specific posters
                                    # Fanart.tv has seasonposter but requires season filtering
                                    fanart_keys = ["seasonposter"]
                                elif request.asset_type == "background":
                                    fanart_keys = ["showbackground"]
                                else:
                                    fanart_keys = []

                                logger.info(
                                    f" Fanart.tv: Looking for keys: {fanart_keys}"
                                )
                                for key in fanart_keys:
                                    items = data.get(key, [])
                                    logger.info(
                                        f" Fanart.tv: Found {len(items)} items for key '{key}'"
                                    )
                                    for item in items:
                                        # For season posters, filter by season number
                                        if (
                                            key == "seasonposter"
                                            and request.season_number
                                        ):
                                            item_season = item.get("season")
                                            # Convert to int for comparison, handle string seasons like "1" or "01"
                                            try:
                                                item_season_num = (
                                                    int(item_season)
                                                    if item_season
                                                    else None
                                                )
                                            except (ValueError, TypeError):
                                                item_season_num = None

                                            if item_season_num != request.season_number:
                                                logger.debug(
                                                    f" Fanart.tv: Skipping season {item_season} poster (looking for season {request.season_number})"
                                                )
                                                continue
                                            else:
                                                logger.info(
                                                    f" Fanart.tv: Found matching season {request.season_number} poster"
                                                )

                                        item_url = item.get("url")
                                        if item_url and item_url not in seen_urls:
                                            seen_urls.add(item_url)
                                            all_results.append(
                                                {
                                                    "url": item_url,
                                                    "original_url": item_url,
                                                    "source": "Fanart.tv",
                                                    "source_type": source,  # "provided_id" or "title_search"
                                                    "type": request.asset_type,
                                                    "language": item.get("lang"),
                                                    "likes": item.get("likes", 0),
                                                }
                                            )
                            else:
                                logger.warning(
                                    f" Fanart.tv: Non-200 response: {response.status_code}"
                                )
                    else:
                        if request.media_type == "tv" and not tvdb_ids_to_use:
                            logger.warning(
                                f" Fanart.tv: TV show requested but no TVDB IDs available"
                            )

                logger.info(f" Fanart.tv: Collected {len(all_results)} unique images")

            except Exception as e:
                logger.error(f"Error fetching Fanart.tv assets: {e}")

            return all_results

        # Fetch from all providers in parallel
        logger.info("Fetching assets from all providers in parallel...")
        tmdb_results, tvdb_results, fanart_results = await asyncio.gather(
            fetch_tmdb(), fetch_tvdb(), fetch_fanart(), return_exceptions=True
        )

        # Handle exceptions from gather
        if isinstance(tmdb_results, Exception):
            logger.error(f"TMDB fetch failed: {tmdb_results}")
            tmdb_results = []
        if isinstance(tvdb_results, Exception):
            logger.error(f"TVDB fetch failed: {tvdb_results}")
            tvdb_results = []
        if isinstance(fanart_results, Exception):
            logger.error(f"Fanart fetch failed: {fanart_results}")
            fanart_results = []

        results["tmdb"] = tmdb_results
        results["tvdb"] = tvdb_results
        results["fanart"] = fanart_results

        # Apply language filtering based on asset type
        logger.info(
            f" Applying language filtering for asset_type: {request.asset_type}"
        )

        if request.asset_type == "season":
            # Filter season posters by PreferredSeasonLanguageOrder
            logger.info(f"   Using season language order: {season_language_order_list}")
            results["tmdb"] = filter_and_sort_by_language(
                results["tmdb"], season_language_order_list
            )
            results["tvdb"] = filter_and_sort_by_language(
                results["tvdb"], season_language_order_list
            )
            results["fanart"] = filter_and_sort_by_language(
                results["fanart"], season_language_order_list
            )
        elif request.asset_type == "background":
            # Filter backgrounds by PreferredBackgroundLanguageOrder
            logger.info(
                f"   Using background language order: {background_language_order_list}"
            )
            results["tmdb"] = filter_and_sort_by_language(
                results["tmdb"], background_language_order_list
            )
            results["tvdb"] = filter_and_sort_by_language(
                results["tvdb"], background_language_order_list
            )
            results["fanart"] = filter_and_sort_by_language(
                results["fanart"], background_language_order_list
            )
        elif request.asset_type == "titlecard":
            # Filter titlecards by PreferredTCLanguageOrder
            logger.info(
                f"   Using titlecard language order: {tc_language_order_list}"
            )
            results["tmdb"] = filter_and_sort_by_language(
                results["tmdb"], tc_language_order_list
            )
            results["tvdb"] = filter_and_sort_by_language(
                results["tvdb"], tc_language_order_list
            )
            results["fanart"] = filter_and_sort_by_language(
                results["fanart"], tc_language_order_list
            )
        elif request.asset_type == "logo":
            # Filter logos by LogoLanguageOrder
            logger.info(
                f"   Using logo language order: {logo_language_order_list}"
            )
            results["tmdb"] = filter_and_sort_by_language(
                results["tmdb"], logo_language_order_list
            )
            results["tvdb"] = filter_and_sort_by_language(
                results["tvdb"], logo_language_order_list
            )
            results["fanart"] = filter_and_sort_by_language(
                results["fanart"], logo_language_order_list
            )
        else:
            # Filter standard posters by PreferredLanguageOrder
            logger.info(f"   Using standard language order: {language_order_list}")
            results["tmdb"] = filter_and_sort_by_language(
                results["tmdb"], language_order_list
            )
            results["tvdb"] = filter_and_sort_by_language(
                results["tvdb"], language_order_list
            )
            results["fanart"] = filter_and_sort_by_language(
                results["fanart"], language_order_list
            )

        # Count total results after filtering
        total_count = sum(len(results[source]) for source in results)

        logger.info(
            f"After language filtering: {total_count} results - "
            f"TMDB={len(results['tmdb'])}, TVDB={len(results['tvdb'])}, Fanart={len(results['fanart'])}"
        )

        return {
            "success": True,
            "results": results,
            "total_count": total_count,
            "detected_provider": detected_provider,  # Let frontend know if a prefix was used
        }

    except Exception as e:
        logger.error(f"Error fetching asset replacements: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/assets/upload-replacement")
async def upload_asset_replacement(
    file: UploadFile = File(...),
    asset_path: str = Query(...),
    process_with_overlays: bool = Query(False),
    add_to_queue: bool = Query(False),
    title_text: Optional[str] = Query(None),
    folder_name: Optional[str] = Query(None),
    library_name: Optional[str] = Query(None),
    season_number: Optional[str] = Query(None),
    episode_number: Optional[str] = Query(None),
    episode_title: Optional[str] = Query(None),
    asset_type: Optional[str] = Query(None),
    mediaType: Optional[str] = Query(None),
    posterWithText: bool = Query(False),
    blueprint_overrides: Optional[str] = Query(None),
):
    """
    Replace an asset with an uploaded image
    Optionally process with overlays using Manual Run
    Optionally add to queue instead of immediate processing
    """
    try:
        # Normalize path separators for cross-platform compatibility
        normalized_path = asset_path.replace("\\", "/")

        # Check if Posterizarr is currently running (only if processing immediately)
        if not add_to_queue and RUNNING_FILE.exists():
            logger.warning(
                f"Asset replacement blocked: Posterizarr is currently running"
            )
            raise HTTPException(
                status_code=409,
                detail="Cannot replace assets while Posterizarr is running. Please wait until all processing is completed before using the replace or manual update options.",
            )

        logger.info(f"Asset replacement upload request received")
        logger.info(f"  Asset path: {asset_path}")
        logger.info(f"  File: {file.filename}")
        logger.info(f"  Content type: {file.content_type}")
        logger.info(f"  Process with overlays: {process_with_overlays}")
        logger.info(f"  Add to queue: {add_to_queue}")

        # Validate file upload
        if not file or not file.filename:
            logger.error("No file uploaded")
            raise HTTPException(status_code=400, detail="No file uploaded")

        # Validate file type - check both content type and extension
        allowed_extensions = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"]
        file_extension = Path(file.filename).suffix.lower()

        if file_extension not in allowed_extensions:
            logger.error(f"Invalid file extension: {file_extension}")
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}",
            )

        # Validate content type
        if not file.content_type or not file.content_type.startswith("image/"):
            logger.error(f"Invalid content type: {file.content_type}")
            raise HTTPException(status_code=400, detail="File must be an image")

        # Read uploaded file
        try:
            contents = await file.read()
            logger.info(f"File read successfully: {len(contents)} bytes")
        except Exception as e:
            logger.error(f"Error reading uploaded file: {e}", exc_info=True)
            raise HTTPException(status_code=400, detail="Error reading uploaded file contents")

        # Validate file size
        if len(contents) == 0:
            logger.error("Uploaded file is empty")
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        # ==========================================
        # NEW QUEUE LOGIC INJECTED HERE
        # ==========================================
        if add_to_queue:
            import time
            try:
                # Ensure staging directory exists
                QUEUE_STAGING_DIR.mkdir(parents=True, exist_ok=True)

                # Create a unique filename for the staged file
                timestamp = int(time.time() * 1000)
                safe_filename = f"{timestamp}_{file.filename}"
                staging_path = QUEUE_STAGING_DIR / safe_filename

                # Save file to staging
                with open(staging_path, "wb") as f:
                    f.write(contents)

                logger.info(f"File staged for queue at: {staging_path}")

                # Prepare overlay parameters
                overlay_params = {
                    "title_text": title_text,
                    "folder_name": folder_name,
                    "library_name": library_name,
                    "season_number": season_number,
                    "episode_number": episode_number,
                    "episode_title": episode_title,
                    "asset_type": asset_type,
                    "mediaType": mediaType,
                    "process_with_overlays": process_with_overlays,
                    "poster_with_text": posterWithText,
                    "blueprint_overrides": json.loads(blueprint_overrides) if blueprint_overrides else None
                }

                # Remove None values
                overlay_params = {k: v for k, v in overlay_params.items() if v is not None}

                # Add to DB
                item_id = queue_manager.add_item(
                    asset_path=asset_path,
                    source_type="upload",
                    source_data=str(staging_path),
                    overlay_params=overlay_params
                )

                return {
                    "success": True,
                    "queued": True,
                    "message": "Asset replacement added to queue",
                    "queue_id": item_id
                }

            except Exception as e:
                logger.error(f"Error adding to queue: {e}")
                raise HTTPException(status_code=500, detail="Failed to add to queue")
        # ==========================================

        # ==========================================
        # OLD MANUAL EXECUTION LOGIC (runs if not queued)
        # ==========================================        # Validate and sanitize asset path
        try:
            # Determine target directory based on process_with_overlays flag
            target_base_dir = ASSETS_DIR if process_with_overlays else MANUAL_ASSETS_DIR
            logger.info(f"Target directory for upload: {target_base_dir.name}")

            # Safely resolve path
            full_asset_path = get_safe_path(target_base_dir, asset_path)
            logger.info(f"Resolved safe upload path: {full_asset_path}")

        except HTTPException:
            raise  # Re-raise path traversal 403
        except Exception as e:
            logger.error(f"Error determining asset path: {e}", exc_info=True)
            raise HTTPException(status_code=400, detail="Invalid asset path format")

        try:
            # Check if directory exists
            full_asset_path.parent.mkdir(parents=True, exist_ok=True)
            # Log whether this is a new asset or replacement
            if full_asset_path.exists():
                logger.info(f"Replacing existing asset: {full_asset_path}")
            else:
                logger.info(f"Creating new asset: {full_asset_path}")

            logger.info(f"Full asset path: {full_asset_path}")
            logger.info(f"Is Docker: {IS_DOCKER}, Target Dir: {target_base_dir}")

        except (ValueError, OSError) as e:
            logger.error(f"Invalid asset path '{asset_path}': {e}", exc_info=True)
            raise HTTPException(status_code=400, detail="Invalid asset path or filename")

        # Ensure parent directory exists with permission check
        try:
            full_asset_path.parent.mkdir(parents=True, exist_ok=True)
            # Test write permissions in parent directory
            test_file = full_asset_path.parent / ".write_test"
            test_file.touch()
            test_file.unlink()
        except PermissionError as e:
            logger.error(
                f"No write permission for asset directory: {full_asset_path.parent}"
            )
            raise HTTPException(
                status_code=500,
                detail=f"No write permission for asset directory. On Docker/NAS/Unraid, ensure volume is mounted with write permissions (e.g., /assets:/assets:rw).",
            )
        except OSError as e:
            logger.error(f"OS error accessing asset directory: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Cannot access asset directory: {str(e)}. Check if the path exists and is accessible.",
            )

        # Validate image aspect ratio instead of dimensions
        try:
            from PIL import Image
            import io

            img = Image.open(io.BytesIO(contents))
            width, height = img.size
            logger.info(f"Manual upload image dimensions: {width}x{height} pixels")

            # Determine asset type from path/filename
            asset_path_lower = asset_path.lower()
            is_poster = (
                "poster" in asset_path_lower
                or asset_path_lower.endswith((".jpg", ".png"))
                and "background" not in asset_path_lower
                and "titlecard" not in asset_path_lower
                and "episodetemplate" not in asset_path_lower
                and not re.search(r"s\d+e\d+", asset_path_lower, re.IGNORECASE)
            )
            is_background = "background" in asset_path_lower
            is_titlecard = "titlecard" in asset_path_lower or "episodetemplate" in asset_path_lower or re.search(
                r"s\d+e\d+", asset_path_lower, re.IGNORECASE
            )
            is_season = (
                re.search(r"season\s*\d+", asset_path_lower, re.IGNORECASE)
                and not is_titlecard
            )

            # Check for zero height
            if height == 0:
                error_msg = "Image height cannot be zero."
                logger.error(error_msg)
                raise HTTPException(status_code=400, detail=error_msg)

            # Calculate ratio
            ratio = width / height
            logger.info(f"Image aspect ratio: {ratio:.3f}")

            # Define expected ratios
            POSTER_RATIO = 2 / 3  # ≈ 0.667
            BG_TC_RATIO = 16 / 9  # ≈ 1.778
            TOLERANCE = 0.05  # ±5% tolerance

            def ratio_within_tolerance(actual, expected, tolerance):
                return abs(actual - expected) / expected <= tolerance

            # Validate based on type
            if is_poster or is_season:
                if not ratio_within_tolerance(ratio, POSTER_RATIO, TOLERANCE):
                    error_msg = (
                        f"Invalid aspect ratio ({ratio:.3f}). Expected approximately 2:3 "
                        f"({POSTER_RATIO:.3f} ± {TOLERANCE*100:.0f}%)."
                    )
                    logger.error(error_msg)
                    raise HTTPException(status_code=400, detail=error_msg)

            elif is_background or is_titlecard:
                if not ratio_within_tolerance(ratio, BG_TC_RATIO, TOLERANCE):
                    error_msg = (
                        f"Invalid aspect ratio ({ratio:.3f}). Expected approximately 16:9 "
                        f"({BG_TC_RATIO:.3f} ± {TOLERANCE*100:.0f}%)."
                    )
                    logger.error(error_msg)
                    raise HTTPException(status_code=400, detail=error_msg)

        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Could not validate image ratio: {e}")
            # Don't fail upload if dimension check itself fails, just log it

        # Check if asset exists in alternate location (for moving between folders)
        alternate_base_dir = (
            ASSETS_DIR if not process_with_overlays else MANUAL_ASSETS_DIR
        )
        alternate_asset_path = alternate_base_dir / normalized_path
        asset_exists_in_alternate = alternate_asset_path.exists()

        # Track if this is a replacement or new asset in target location
        is_replacement = full_asset_path.exists()

        # Delete old asset from alternate location if moving between folders
        if asset_exists_in_alternate:
            try:
                logger.info(
                    f"Deleting old asset from alternate location: {alternate_asset_path}"
                )
                alternate_asset_path.unlink()
            except Exception as e:
                logger.warning(
                    f"Could not delete old asset from alternate location: {e}"
                )

        # Save new image
        try:
            with open(full_asset_path, "wb") as f:
                f.write(contents)

            # Verify file was written correctly
            if not full_asset_path.exists():
                raise HTTPException(
                    status_code=500, detail="File was not saved successfully"
                )

            actual_size = full_asset_path.stat().st_size
            if actual_size != len(contents):
                logger.error(
                    f"File size mismatch: expected {len(contents)}, got {actual_size}"
                )
                raise HTTPException(
                    status_code=500, detail="File was not saved completely"
                )

            action = "Replaced" if is_replacement else "Created"
            logger.info(
                f"{action} asset: {asset_path} (size: {len(contents)} bytes, target: {target_base_dir.name})"
            )
        except PermissionError as e:
            logger.error(f"Permission denied writing to {full_asset_path}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Permission denied: Unable to write to file. On Docker/NAS/Unraid, check that user has write permissions (uid/gid mapping).",
            )
        except OSError as e:
            logger.error(f"OS error writing to {full_asset_path}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"File system error. Check disk space and permissions.",
            )
        except Exception as e:
            logger.error(f"Unexpected error writing file: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail="An internal error occurred while saving the file.")


        result = {
            "success": True,
            "message": f"Asset {'replaced' if is_replacement else 'created'} successfully",
            "path": asset_path,
            "size": len(contents),
            "was_replacement": is_replacement,
        }

        # If process_with_overlays is enabled, trigger Manual Run
        if process_with_overlays:
            logger.info(f"Processing with overlays enabled for: {asset_path}")

            try:
                # Parse asset path to extract info
                # Format: LibraryName/FolderName/poster.jpg, Season01.jpg, or S01E01.jpg
                path_parts = Path(normalized_path).parts
                logger.info(f"Path parts: {path_parts} (length: {len(path_parts)})")

                if len(path_parts) >= 3:
                    # Use provided library_name and folder_name if available, otherwise extract from path
                    extracted_library_name = path_parts[0]
                    extracted_folder_name = path_parts[1]

                    final_library_name = library_name or extracted_library_name
                    final_folder_name = folder_name or extracted_folder_name
                    final_title_text = title_text if title_text is not None else extracted_folder_name

                    logger.info(
                        f"Overlay parameters - Library: {final_library_name}, Folder: {final_folder_name}, Title: {final_title_text}"
                    )

                    # Determine poster type from filename
                    filename = Path(normalized_path).name.lower()

                    # Build Manual Run command
                    command = [
                        "pwsh" if os.name == "nt" else "pwsh",
                        "-File",
                        str(SCRIPT_PATH),
                        "-manual",
                        "-PicturePath",
                        str(full_asset_path),
                        "-Titletext",
                        sanitize_command_arg(final_title_text),
                        "-FolderName",
                        sanitize_command_arg(final_folder_name),
                    ]
                    if final_library_name:
                        command.extend(["-LibraryName", sanitize_command_arg(final_library_name)])

                    # Handle Season posters (Season01.jpg, Season 01.jpg, etc.)
                    if season_number or "season" in filename:
                        command.extend(["-SeasonPoster"])
                        if season_number:
                            command.extend(["-SeasonPosterName", sanitize_command_arg(season_number)])

                    # Handle TitleCards (S01E01.jpg, etc.)
                    elif episode_number and episode_title:
                        command.extend(["-TitleCards"])
                        command.extend(["-EpisodeNumber", sanitize_command_arg(episode_number)])
                        command.extend(["-EPTitleName", sanitize_command_arg(episode_title)])

                    if posterWithText:
                        command.append("-PosterWithText")

                    if blueprint_overrides:
                        import json
                        override_dict = json.loads(blueprint_overrides)
                        temp_override_path = generate_blueprint_override_config(override_dict)
                        command.extend(["-ConfigOverride", temp_override_path])

                    logger.info(f"Running Manual Mode Overlay Process:")         # Handle Background cards (background.jpg, backdrop.jpg, etc.)
                    # Handle Background cards (background.jpg, backdrop.jpg, etc.)
                    if "background" in filename or "backdrop" in filename:
                        command.extend(["-BackgroundCard"])

                    elif mediaType == "movie":
                        command.extend(["-MoviePosterCard"])

                    elif mediaType in ["show", "tv"]:
                        command.extend(["-ShowPosterCard"])

                    logger.info(
                        f"Starting Manual Run for overlay processing: {shlex.join(command)}"
                    )

                    # Start the Manual Run process
                    global current_process, current_mode, current_start_time
                    current_process = subprocess.Popen(
                        command,
                        cwd=str(BASE_DIR),
                        stdout=None,
                        stderr=None,
                        text=True,
                    )
                    current_mode = "manual"
                    current_start_time = datetime.now().isoformat()

                    logger.info(
                        f"Manual Run started (PID: {current_process.pid}) for overlay processing"
                    )

                    result["manual_run_triggered"] = True
                    result["message"] = (
                        "Asset replaced and queued for overlay processing"
                    )

                else:
                    logger.warning(
                        f"Invalid path structure for overlay processing: {asset_path}"
                    )
                    result["manual_run_triggered"] = False
                    result["message"] = (
                        "Asset replaced but overlay processing skipped (invalid path structure)"
                    )

            except Exception as e:
                logger.error(f"Error triggering Manual Run: {e}")
                result["manual_run_triggered"] = False
                result["error"] = "An error occurred while triggering overlay processing."

        return result

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        error_details = traceback.format_exc()
        logger.error(f"Unexpected error uploading asset replacement: {e}")
        logger.error(f"Traceback:\n{error_details}")
        raise HTTPException(status_code=500, detail="An internal server error occurred.")


def delete_db_entries_for_asset(asset_path: str):
    """
    Delete database entries for a given asset path.
    Matches entries based on Rootfolder, Type, and filename pattern.

    Args:
        asset_path: Path to the asset (e.g., "TestSerien/Show Name (2020)/Season02.jpg")
    """
    if not DATABASE_AVAILABLE or db is None:
        logger.debug("Database not available, skipping DB entry deletion")
        return

    try:
        # Parse the asset path to extract metadata
        # Normalize path separators to forward slashes
        normalized_path = asset_path.replace("\\", "/")
        path_parts = normalized_path.split("/")

        if len(path_parts) < 2:
            logger.warning(f"Asset path too short to extract metadata: {asset_path}")
            return

        # Extract folder name and filename
        folder_name = path_parts[1] if len(path_parts) > 1 else ""
        filename = path_parts[-1] if len(path_parts) > 0 else ""

        # Determine asset type from filename
        # Note: Database uses different type names than our internal naming
        # Database types: "Movie", "Movie Background", "Show", "Show Background", "Season", "Episode"
        is_background = "background" in filename.lower()
        is_season = re.match(r"^Season(\d+)\.jpg$", filename, re.IGNORECASE)
        is_episode = re.match(r"^S(\d+)E(\d+)\.jpg$", filename, re.IGNORECASE)

        # Determine the database Type values to search for
        # For posters/backgrounds, we need to check both Movie and Show types
        search_types = []
        if is_season:
            search_types = ["Season"]
        elif is_episode:
            search_types = ["Episode"]
        elif is_background:
            search_types = ["Movie Background", "Show Background"]
        else:
            # Regular poster - could be Movie or Show or Poster
            search_types = ["Movie", "Show", "Poster"]

        # Collect all matching entries across all possible type names
        all_entries = []

        logger.debug(
            f"Searching for DB entries: folder={folder_name}, types={search_types}, is_episode={bool(is_episode)}, is_season={bool(is_season)}"
        )

        # FIX: Use _get_connection within the lock
        with db.lock:
            conn = db._get_connection()
            try:
                cursor = conn.cursor()

                for db_type in search_types:
                    if is_season:
                        # For seasons, find entries with matching season number in title
                        season_num = is_season.group(1)
                        cursor.execute(
                            """SELECT id, Title, Type FROM imagechoices
                               WHERE Rootfolder = ? AND Type = ?
                               AND (Title LIKE ? OR Title LIKE ? OR Title LIKE ?)""",
                            (
                                folder_name,
                                db_type,
                                f"%Season{season_num}%",
                                f"%Season {season_num}%",
                                f"%Season0{season_num}%",
                            ),
                        )
                    elif is_episode:
                        # For episodes, find entries with matching episode pattern in title
                        season_num = is_episode.group(1)
                        episode_num = is_episode.group(2)
                        pattern1 = f"%S{season_num}E{episode_num}%"
                        pattern2 = f"%S0{season_num}E0{episode_num}%"
                        cursor.execute(
                            """SELECT id, Title, Type FROM imagechoices
                               WHERE Rootfolder = ? AND Type = ?
                               AND (Title LIKE ? OR Title LIKE ?)""",
                            (folder_name, db_type, pattern1, pattern2),
                        )
                    else:
                        # For poster/background, match on Rootfolder + Type only
                        cursor.execute(
                            "SELECT id, Title, Type FROM imagechoices WHERE Rootfolder = ? AND Type = ?",
                            (folder_name, db_type),
                        )

                    # Fetch and extend results for this type
                    found = cursor.fetchall()
                    logger.debug(f"Found {len(found)} entries for type {db_type}")
                    all_entries.extend(found)
            finally:
                conn.close()

        if all_entries:
            for entry in all_entries:
                record_id = entry["id"]
                title = entry["Title"]
                entry_type = entry["Type"]
                db.delete_choice(record_id)
                logger.info(
                    f"Deleted DB entry #{record_id} for deleted asset: {title} ({entry_type})"
                )
        else:
            logger.debug(
                f"No DB entries found for deleted asset: {filename} in {folder_name}"
            )

    except Exception as e:
        logger.error(f"Error deleting database entries for asset {asset_path}: {e}")
        import traceback

        logger.error(traceback.format_exc())


async def update_asset_db_entry_as_manual(
    asset_path: str,
    image_url: str,
    library_name: Optional[str] = None,
    folder_name: Optional[str] = None,
    title_text: Optional[str] = None,
):
    """
    Delete existing database entries for a manually replaced asset.
    The new entry will be created by the CSV import after the Posterizarr script completes.
    This prevents duplicate entries with different title formats.

    Args:
        asset_path: Path to the asset (e.g., "4K/Movie Name (2024)/poster.jpg")
        image_url: URL where the image was downloaded from
        library_name: Optional library name override
        folder_name: Optional folder name override
        title_text: Optional title text override
    """
    if not DATABASE_AVAILABLE or db is None:
        logger.warning(
            "Database not available, skipping DB entry for manual replacement"
        )
        return

    try:
        # Parse asset path to extract metadata
        path_parts = Path(asset_path).parts

        if len(path_parts) < 2:
            logger.warning(f"Asset path too short to extract metadata: {asset_path}")
            return

        # Extract library name (first part of path)
        extracted_library_name = path_parts[0] if len(path_parts) > 0 else ""
        # Extract folder name (second part of path)
        extracted_folder_name = path_parts[1] if len(path_parts) > 1 else ""
        # Extract filename
        filename = path_parts[-1] if len(path_parts) > 0 else ""

        # Use provided values or fall back to extracted values
        final_library_name = library_name or extracted_library_name
        final_folder_name = folder_name or extracted_folder_name

        # Extract title from folder name if not provided
        # Remove year and ID tags like (2024) {tmdb-12345}
        final_title_text = title_text
        if not final_title_text:  # This catches both None and "" for DB cleanup purposes
            # Match patterns like "Movie Name (2024) {tmdb-12345}"
            title_match = re.match(r"^([^()]+)\s*\(\d{4}\)", final_folder_name)
            final_title_text = title_match.group(1).strip() if title_match else final_folder_name

        # Determine asset type from filename
        # Match database Type column values: "Show", "Movie", "Show Background", "Movie Background", "Season", "Episode"
        asset_type = "Poster"  # Default, will be refined below

        if "background" in filename.lower():
            # Could be "Show Background" or "Movie Background"
            asset_type = "Background"
        elif re.match(r"^Season\d+\.jpg$", filename, re.IGNORECASE):
            asset_type = "Season"
        elif re.match(r"^S\d+E\d+\.jpg$", filename, re.IGNORECASE):
            asset_type = "Episode"
        # For poster.jpg files, asset_type remains "Poster"
        # We'll match both "Show" and "Movie" types in the query

        # Delete any existing database entries for this specific asset
        # This prevents duplicates - the CSV import will create the new entry after the script finishes
        # We need to match more specifically to avoid deleting unrelated assets:
        # - For seasons: match on Rootfolder + Type + season number in Title
        # - For episodes: match on Rootfolder + Type + episode pattern in Title
        # - For poster/background: match on Rootfolder + Type

        existing_entries = []
        with db.lock:
            conn = db._get_connection()
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                # Extract season/episode info from filename for more specific matching
                season_match = re.match(r"^Season(\d+)\.jpg$", filename, re.IGNORECASE)
                episode_match = re.match(r"^S(\d+)E(\d+)\.jpg$", filename, re.IGNORECASE)

                if season_match:
                    # For seasons, find entries with matching season number in title
                    season_num = season_match.group(1)
                    # Also try without leading zero
                    season_num_int = str(int(season_num))
                    logger.info(
                        f"Searching for Season: folder='{final_folder_name}', season_num='{season_num}', season_num_int='{season_num_int}'"
                    )
                    cursor.execute(
                        """SELECT id, Title, Type FROM imagechoices
                           WHERE Rootfolder = ? AND Type = ?
                           AND (Title LIKE ? OR Title LIKE ? OR Title LIKE ? OR Title LIKE ?)""",
                        (
                            final_folder_name,
                            asset_type,
                            f"%Season{season_num}%",
                            f"%Season {season_num}%",
                            f"%Season{season_num_int}%",
                            f"%Season{season_num_int}%",
                        ),
                    )
                elif episode_match:
                    # For episodes, find entries with matching episode pattern in title
                    season_num = episode_match.group(1)
                    episode_num = episode_match.group(2)
                    cursor.execute(
                        """SELECT id, Title FROM imagechoices
                           WHERE Rootfolder = ? AND Type = ?
                           AND (Title LIKE ? OR Title LIKE ?)""",
                        (
                            final_folder_name,
                            asset_type,
                            f"%S{season_num}E{episode_num}%",
                            f"%S0{season_num}E0{episode_num}%",
                        ),
                    )
                else:
                    # For poster/background, match on Rootfolder + Type
                    if asset_type == "Poster":
                        cursor.execute(
                            "SELECT id, Title, Type FROM imagechoices WHERE Rootfolder = ? AND Type IN ('Show', 'Movie')",
                            (final_folder_name,),
                        )
                    elif asset_type == "Background":
                        cursor.execute(
                            "SELECT id, Title, Type FROM imagechoices WHERE Rootfolder = ? AND Type IN ('Show Background', 'Movie Background')",
                            (final_folder_name,),
                        )
                    else:
                        cursor.execute(
                            "SELECT id, Title, Type FROM imagechoices WHERE Rootfolder = ? AND Type = ?",
                            (final_folder_name, asset_type),
                        )

                existing_entries = cursor.fetchall()
            finally:
                conn.close()

        if existing_entries:
            for entry in existing_entries:
                record_id = entry["id"]
                old_title = entry["Title"]
                # sqlite3.Row objects use dictionary-style access, not .get()
                entry_type = entry["Type"] if "Type" in entry.keys() else asset_type
                db.delete_choice(record_id)
                logger.info(
                    f"Deleted DB entry #{record_id} for manual replacement: {old_title} ({entry_type})"
                )
            logger.info(
                f"New entry will be created by CSV import after script completes"
            )
        else:
            logger.info(
                f"No existing DB entries found for: {filename} in {final_folder_name}"
            )
            logger.info(
                f"New entry will be created by CSV import after script completes"
            )

    except Exception as e:
        logger.error(f"Error updating database entry for manual replacement: {e}")
        import traceback

        logger.error(traceback.format_exc())


@app.post("/api/assets/replace-from-url")
async def replace_asset_from_url(
    asset_path: str = Query(...),
    image_url: str = Query(...),
    process_with_overlays: bool = Query(False),
    add_to_queue: bool = Query(False),
    title_text: Optional[str] = Query(None),
    folder_name: Optional[str] = Query(None),
    library_name: Optional[str] = Query(None),
    season_number: Optional[str] = Query(None),
    episode_number: Optional[str] = Query(None),
    episode_title: Optional[str] = Query(None),
    asset_type: Optional[str] = Query(None),
    mediaType: Optional[str] = Query(None),
    posterWithText: bool = Query(False),
    blueprint_overrides: Optional[str] = Query(None),
):
    """
    Replace an asset by downloading from a URL
    Optionally process with overlays using Manual Run
    Optionally add to queue instead of immediate processing
    """
    try:
        # SSRF Validation for image_url
        if not is_safe_url(image_url, allow_private=True):
            raise HTTPException(status_code=400, detail="Invalid or unsafe image URL")

        # Check if Posterizarr is currently running (only if processing immediately)
        if not add_to_queue and RUNNING_FILE.exists():
            logger.warning(
                f"Asset replacement blocked: Posterizarr is currently running"
            )
            raise HTTPException(
                status_code=409,
                detail="Cannot replace assets while Posterizarr is running. Please wait or use 'Add to Queue'.",
            )

        # QUEUE LOGIC
        if add_to_queue:
            try:
                # Prepare overlay parameters
                overlay_params = {
                    "title_text": title_text,
                    "folder_name": folder_name,
                    "library_name": library_name,
                    "season_number": season_number,
                    "episode_number": episode_number,
                    "episode_title": episode_title,
                    "asset_type": asset_type,
                    "mediaType": mediaType,
                    "process_with_overlays": process_with_overlays,
                    "poster_with_text": posterWithText,
                    "blueprint_overrides": json.loads(blueprint_overrides) if blueprint_overrides else None
                }

                # Remove None values
                overlay_params = {k: v for k, v in overlay_params.items() if v is not None}

                # Add to DB
                item_id = queue_manager.add_item(
                    asset_path=asset_path,
                    source_type="url",
                    source_data=image_url,
                    overlay_params=overlay_params
                )

                return {
                    "success": True,
                    "queued": True,
                    "message": "Asset replacement added to queue",
                    "queue_id": item_id
                }
            except Exception as e:
                logger.error(f"Error adding to queue: {e}")
                raise HTTPException(status_code=500, detail="Failed to add to queue")

        # Validate asset path exists
        # Determine target directory based on process_with_overlays flag
        target_base_dir = ASSETS_DIR if process_with_overlays else MANUAL_ASSETS_DIR
        logger.info(f"Target directory for asset: {target_base_dir.name}")

        # Path Traversal protection
        full_asset_path = get_safe_path(target_base_dir, asset_path)

        # Check if asset exists in either location (for replacement)
        # First check target location, then check alternate location
        asset_exists_in_target = full_asset_path.exists()

        # Also check the alternate location (in case user is moving between folders)
        alternate_base_dir = ASSETS_DIR if not process_with_overlays else MANUAL_ASSETS_DIR
        try:
            alternate_asset_path = get_safe_path(alternate_base_dir, asset_path)
            asset_exists_in_alternate = alternate_asset_path.exists()
        except HTTPException:
            # If get_safe_path fails for alternate, we just assume it doesn't exist there
            asset_exists_in_alternate = False
            alternate_asset_path = None

        if not asset_exists_in_target and not asset_exists_in_alternate:
            logger.warning(
                f"Asset not found in either location, will create new: {asset_path}"
            )
            # Don't fail - just create new asset

        # Download image from URL
        if not is_safe_url(image_url, allow_private=True):
            logger.warning(f"SSRF attempt blocked for image download: {image_url}")
            raise HTTPException(status_code=400, detail="Invalid or unsafe image URL")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(image_url)
            if response.status_code != 200:
                raise HTTPException(
                    status_code=400, detail="Failed to download image from URL"
                )

            contents = response.content

        # Ensure target directory exists
        full_asset_path.parent.mkdir(parents=True, exist_ok=True)

        # Delete old asset from alternate location if moving between folders
        if asset_exists_in_alternate:
            try:
                logger.info(
                    f"Deleting old asset from alternate location: {alternate_asset_path}"
                )
                alternate_asset_path.unlink()
            except Exception as e:
                logger.warning(
                    f"Could not delete old asset from alternate location: {e}"
                )

        # Save new image
        with open(full_asset_path, "wb") as f:
            f.write(contents)

        logger.info(
            f"Replaced asset from URL: {asset_path} (size: {len(contents)} bytes, target: {target_base_dir.name})"
        )

        # Add/Update database entry for this replaced asset (mark as Manual)
        try:
            await update_asset_db_entry_as_manual(
                asset_path, image_url, library_name, folder_name, title_text
            )
        except Exception as e:
            logger.warning(f"Could not update database entry for replaced asset: {e}")

        result = {
            "success": True,
            "message": "Asset replaced successfully",
            "path": asset_path,
            "size": len(contents),
            "queued": False
        }

        # If process_with_overlays is enabled, trigger Manual Run
        if process_with_overlays:
            logger.info(f"Processing with overlays enabled for: {asset_path}")

            try:
                # Parse asset path to extract info
                # Format: LibraryName/FolderName/poster.jpg, Season01.jpg, or S01E01.jpg
                path_parts = Path(asset_path).parts

                if len(path_parts) >= 3:
                    is_collection = path_parts[0] == "Collections"

                    if is_collection and len(path_parts) >= 4:
                        extracted_library_name = path_parts[1]
                        extracted_folder_name = path_parts[2]
                    else:
                        extracted_library_name = path_parts[0]
                        extracted_folder_name = path_parts[1]

                    filename = path_parts[-1]

                    # Prefer user-provided values over extracted values
                    final_library_name = (
                        library_name if library_name else extracted_library_name
                    )
                    final_folder_name = (
                        folder_name if folder_name else extracted_folder_name
                    )

                    # Determine poster type from filename
                    poster_type = None
                    season_poster_name = None
                    ep_title_name = None
                    ep_number = None

                    if filename == "poster.jpg":
                        poster_type = "collection" if is_collection else "standard"
                    elif filename == "background.jpg":
                        poster_type = "background"
                    elif re.match(r"^Season(\d+)\.jpg$", filename):
                        poster_type = "season"
                        # Extract season number from filename or use provided one
                        season_match = re.match(r"^Season(\d+)\.jpg$", filename)
                        if season_match:
                            extracted_season = season_match.group(1)
                            # Use provided season_number as-is (user controls the text)
                            # If not provided, fall back to extracted season number only
                            season_poster_name = (
                                season_number if season_number else extracted_season
                            )
                        elif season_number:
                            # Use whatever the user provided as-is
                            season_poster_name = season_number
                        else:
                            raise ValueError(
                                f"Could not determine season number for: {filename}"
                            )
                    elif re.match(r"^S(\d+)E(\d+)\.jpg$", filename):
                        poster_type = "titlecard"
                        # Extract season/episode from filename or use provided values
                        ep_match = re.match(r"^S(\d+)E(\d+)\.jpg$", filename)
                        if ep_match:
                            extracted_season = ep_match.group(1)
                            extracted_episode = ep_match.group(2)
                            # Use provided values or fall back to extracted
                            season_poster_name = (
                                season_number if season_number else extracted_season
                            )
                            ep_number = (
                                episode_number if episode_number else extracted_episode
                            )
                        else:
                            season_poster_name = season_number
                            ep_number = episode_number

                        # Episode title must be provided
                        if not episode_title:
                            raise ValueError(
                                f"Episode title is required for title card processing"
                            )
                        ep_title_name = episode_title
                    else:
                        raise ValueError(
                            f"Unsupported file type for overlay processing: {filename}"
                        )

                    # Extract title text from folder name if not provided
                    # Remove year and TMDB/TVDB ID from folder name
                    final_title_text = title_text
                    if title_text is None:
                        title_match = re.match(r"^([^()]+)\s*\(\d{4}\)", final_folder_name)
                        final_title_text = title_match.group(1).strip() if title_match else final_folder_name
                    else:
                        final_title_text = title_text

                    logger.info(
                        f"Manual Run params - Library: {final_library_name}, Folder: {final_folder_name}, Type: {poster_type}, Title: {final_title_text}"
                    )
                    if season_poster_name:
                        logger.info(f"Season: {season_poster_name}")
                    if ep_number and ep_title_name:
                        logger.info(f"Episode: {ep_number} - {ep_title_name}")

                    # Build ManualModeRequest
                    manual_request = ManualModeRequest(
                        picturePath=str(full_asset_path),
                        titletext=(
                            final_title_text
                            if poster_type != "titlecard"
                            else ep_title_name
                        ),
                        folderName=final_folder_name,
                        libraryName=final_library_name,
                        posterType=poster_type,
                        mediaType=mediaType,
                        seasonPosterName=season_poster_name or "",
                        epTitleName=ep_title_name or "",
                        episodeNumber=ep_number or "",
                        posterWithText=posterWithText,
                        blueprint_overrides=json.loads(blueprint_overrides) if blueprint_overrides else None,
                    )

                    # Call run_manual_mode (we need to make it callable)
                    await trigger_manual_run_internal(manual_request)

                    result["message"] = (
                        "Asset replaced and queued for overlay processing"
                    )
                    result["manual_run_triggered"] = True
                    logger.info(f"Manual Run triggered successfully for {asset_path}")
                else:
                    logger.warning(
                        f"Cannot extract library/folder from path: {asset_path}"
                    )
                    result["manual_run_triggered"] = False
                    result["message"] = (
                        "Asset replaced but overlay processing skipped (invalid path structure)"
                    )

            except Exception as e:
                logger.error(f"Failed to trigger Manual Run: {e}")
                result["manual_run_triggered"] = False
                result["manual_run_error"] = "An error occurred while triggering overlay processing."
                # Don't fail the whole request, asset is already replaced

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error replacing asset from URL: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred.")


async def trigger_manual_run_internal(request: ManualModeRequest):
    """
    Internal function to trigger manual run without HTTP overhead
    This is called from replace_asset_from_url
    """
    global current_process, current_mode, current_start_time

    # Check if already running
    if current_process and current_process.poll() is None:
        raise ValueError("Script is already running")

    if not SCRIPT_PATH.exists():
        raise ValueError("Posterizarr.ps1 not found")

    # Determine PowerShell command
    import platform

    if platform.system() == "Windows":
        ps_command = "pwsh"
        try:
            subprocess.run([ps_command, "-v"], capture_output=True, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            ps_command = "powershell"
            logger.info("pwsh not found, using powershell instead")
    else:
        ps_command = "pwsh"

    # Build command based on poster type
    command = [
        ps_command,
        "-File",
        str(SCRIPT_PATH),
        "-Manual",
        "-PicturePath",
        request.picturePath.strip(),
    ]

    # Add poster type specific switches and parameters
    if request.posterType == "titlecard":
        command.extend(
            [
                "-TitleCard",
                "-Titletext",
                request.epTitleName.strip(),
                "-FolderName",
                request.folderName.strip(),
                "-LibraryName",
                request.libraryName.strip(),
                "-EPTitleName",
                request.epTitleName.strip(),
                "-EpisodeNumber",
                request.episodeNumber.strip(),
                "-SeasonPosterName",
                request.seasonPosterName.strip(),
            ]
        )
    elif request.posterType == "season":
        command.extend(
            [
                "-SeasonPoster",
                "-Titletext",
                request.titletext.strip(),
                "-FolderName",
                request.folderName.strip(),
                "-LibraryName",
                request.libraryName.strip(),
                "-SeasonPosterName",
                request.seasonPosterName.strip(),
            ]
        )
    elif request.posterType == "collection":
        command.extend([
            "-CollectionCard",
            "-Titletext", request.titletext.strip(),
            "-FolderName", request.folderName.strip(),
            "-LibraryName", request.libraryName.strip(),
        ])
    elif request.posterType == "background":
        command.extend(
            [
                "-BackgroundCard",
                "-Titletext",
                request.titletext.strip(),
                "-FolderName",
                request.folderName.strip(),
                "-LibraryName",
                request.libraryName.strip(),
            ]
        )
    else:  # standard poster
        command.extend(
            [
                "-Titletext",
                request.titletext.strip(),
                "-FolderName",
                request.folderName.strip(),
                "-LibraryName",
                request.libraryName.strip(),
            ]
        )
        if request.mediaType == "movie":
            command.extend(["-MoviePosterCard"])

        elif request.mediaType in ["show", "tv"]:
            command.extend(["-ShowPosterCard"])

    if getattr(request, "posterWithText", False):
        command.append("-PosterWithText")

    if getattr(request, "blueprint_overrides", None):
        temp_override_path = generate_blueprint_override_config(request.blueprint_overrides)
        command.extend(["-ConfigOverride", temp_override_path])

    logger.info(f"Starting Manual Run: {' '.join(command)}")

    # Start the process in background
    # IMPORTANT: Do NOT redirect stdout/stderr to PIPE if we're not reading them!
    # This prevents the process from hanging when the buffer fills up
    current_process = subprocess.Popen(
        command,
        cwd=str(BASE_DIR),
        stdout=None,  # Let output go to console/log
        stderr=None,  # Let output go to console/log
        text=True,
    )
    current_mode = "manual"
    current_start_time = datetime.now().isoformat()

    logger.info(f"Manual Run process started (PID: {current_process.pid})")

async def _find_and_delete_asset(record_id: int) -> Dict[str, any]:
    """
    Internal helper to find an asset file by its DB record ID,
    delete the file, and then delete the DB record.

    Returns:
        A dict with status and asset info.
    """
    if not DATABASE_AVAILABLE or db is None:
        logger.warning(f"[DeleteAsset] Database not available (ID: {record_id})")
        return {"success": False, "error": "Database not available"}

    # Step 1: Get the record from DB
    record = db.get_choice_by_id(record_id)
    if not record:
        logger.warning(f"[DeleteAsset] Record not found in DB (ID: {record_id})")
        return {"success": False, "error": "Record not found in database"}

    record_dict = dict(record)
    rootfolder = record_dict.get("Rootfolder")
    library = record_dict.get("LibraryName")
    asset_type = (record_dict.get("Type") or "").lower()
    title = record_dict.get("Title") or ""

    if not rootfolder or not library:
        logger.warning(f"[DeleteAsset] Record missing Rootfolder/LibraryName (ID: {record_id})")
        # Record exists but is invalid, delete it from DB
        try:
            db.delete_choice(record_id)
            logger.info(f"[DeleteAsset] Deleted invalid DB record (ID: {record_id})")
        except Exception as e_db:
            logger.error(f"[DeleteAsset] Failed to delete invalid DB record (ID: {record_id}): {e_db}")
        return {"success": True, "file_deleted": False, "db_deleted": True, "asset_info": title}

    asset_info = f"{library}/{rootfolder} ({title})"

    # Step 2: Determine filename
    asset_filename = None
    if "background" in asset_type:
        asset_filename = "background.jpg"
    elif "season" in asset_type:
        season_match = re.search(r"season\s*(\d+)", title, re.IGNORECASE)
        if season_match:
            season_num = season_match.group(1).zfill(2)
            asset_filename = f"Season{season_num}.jpg"
    elif "titlecard" in asset_type or "episode" in asset_type:
        episode_match = re.search(r"(S\d+E\d+)", title, re.IGNORECASE)
        if episode_match:
            episode_code = episode_match.group(1).upper()
            asset_filename = f"{episode_code}.jpg"
    else: # Default to poster
        asset_filename = "poster.jpg"

    if not asset_filename:
        logger.warning(f"[DeleteAsset] Could not determine filename for {asset_info}")
        # We can still delete the DB record
        try:
            db.delete_choice(record_id)
            logger.info(f"[DeleteAsset] Deleted DB record (file not found) (ID: {record_id})")
        except Exception as e_db:
            logger.error(f"[DeleteAsset] Failed to delete DB record (ID: {record_id}): {e_db}")
        return {"success": True, "file_deleted": False, "db_deleted": True, "asset_info": asset_info}

    # Step 3: Construct file path
    try:
        file_path = get_safe_path(ASSETS_DIR / library / rootfolder, asset_filename)
        logger.debug(f"[DeleteAsset] Resolved safe delete path: {file_path}")
    except HTTPException as e:
        logger.warning(f"[DeleteAsset] Path traversal blocked or invalid path for {asset_info}: {e.detail}")
        # Delete DB record anyway since it's "orphan" or dangerous
        db.delete_choice(record_id)
        return {"success": True, "file_deleted": False, "db_deleted": True, "asset_info": asset_info}
    file_deleted = False

    # Step 4: Delete the file
    try:
        if file_path.exists() and file_path.is_file():
            file_path.unlink()
            file_deleted = True
            logger.info(f"[DeleteAsset] Successfully deleted asset file: {file_path}")
        else:
            logger.warning(f"[DeleteAsset] Asset file not found, skipping delete: {file_path}")
    except Exception as e_file:
        logger.error(f"[DeleteAsset] Error deleting asset file {file_path}: {e_file}")
        # Do NOT proceed to delete DB record if file delete failed
        return {"success": False, "error": f"Failed to delete file: {e_file}", "asset_info": asset_info}

    # Step 5: Delete the DB record
    try:
        db.delete_choice(record_id)
        logger.info(f"[DeleteAsset] Successfully deleted DB record (ID: {record_id})")
        return {"success": True, "file_deleted": file_deleted, "db_deleted": True, "asset_info": asset_info}
    except Exception as e_db:
        logger.error(f"[DeleteAsset] File deleted, but failed to delete DB record (ID: {record_id}): {e_db}")
        return {"success": False, "error": f"File deleted, but DB delete failed: {e_db}", "asset_info": asset_info}

@app.delete("/api/assets/delete-asset/{record_id}")
async def delete_asset_and_record(record_id: int):
    """
    Deletes a single asset: the file from /assets AND the
    corresponding record from the imagechoices database.
    """
    logger.info("=" * 60)
    logger.info(f"SINGLE ASSET DELETE REQUEST: ID {record_id}")
    try:
        result = await _find_and_delete_asset(record_id)

        if result["success"]:
            # Trigger cache refresh in background
            threading.Thread(target=scan_and_cache_assets, daemon=True).start()
            logger.info(f"Delete successful for {result['asset_info']}, triggering cache refresh.")
            logger.info("=" * 60)
            return {
                "success": True,
                "message": f"Asset '{result['asset_info']}' deleted.",
                "file_deleted": result["file_deleted"],
                "db_deleted": result["db_deleted"],
            }
        else:
            logger.error(f"Delete failed for ID {record_id}: {result['error']}")
            logger.info("=" * 60)
            raise HTTPException(status_code=500, detail="Failed to delete asset.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting asset ID {record_id}: {e}", exc_info=True)
        logger.info("=" * 60)
        raise HTTPException(status_code=500, detail="An internal server error occurred.")

@app.post("/api/assets/bulk-delete-assets")
async def bulk_delete_assets_and_records(request: BulkDeleteAssetsRequest):
    """
    Deletes multiple assets: files from /assets AND the
    corresponding records from the imagechoices database.
    """
    logger.info("=" * 60)
    logger.info(f"BULK ASSET DELETE REQUEST: {len(request.record_ids)} items")

    deleted_count = 0
    failed_items = []

    for record_id in request.record_ids:
        try:
            result = await _find_and_delete_asset(record_id)
            if result["success"]:
                deleted_count += 1
            else:
                failed_items.append({"id": record_id, "error": result.get("error", "Unknown error")})
                logger.warning(f"Bulk delete failed for ID {record_id}: {result.get('error')}")
        except Exception as e:
            failed_items.append({"id": record_id, "error": str(e)})
            logger.error(f"Unexpected error in bulk delete for ID {record_id}: {e}", exc_info=True)

    # Trigger cache refresh in background *after* all deletes are done
    if deleted_count > 0:
        threading.Thread(target=scan_and_cache_assets, daemon=True).start()
        logger.info(f"Bulk delete complete, triggering cache refresh.")

    logger.info(f"Bulk delete summary: {deleted_count} deleted, {len(failed_items)} failed.")
    logger.info("=" * 60)

    return {
        "success": True,
        "deleted_count": deleted_count,
        "failed_count": len(failed_items),
        "failed_items": failed_items,
        "message": f"Deleted {deleted_count} assets. {len(failed_items)} failed."
    }

class SkipAssetRequest(BaseModel):
    asset_id: int

@app.post("/api/assets/skip")
async def skip_media_server_asset(request: SkipAssetRequest):
    """
    Add skip_posterizarr tag/label to the item in the active media server and remove from Action Center.
    """
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    if not MEDIA_EXPORT_DB_AVAILABLE or media_export_db is None:
        raise HTTPException(status_code=503, detail="Media export database not available")

    # 1. Get the asset from imagechoices
    with db.lock:
        conn = db._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM imagechoices WHERE id = ?", (request.asset_id,))
        asset = cursor.fetchone()
        conn.close()

    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    asset_dict = dict(asset)
    rootfolder = asset_dict.get("Rootfolder")
    library_name = asset_dict.get("LibraryName")
    asset_type = asset_dict.get("Type", "").lower()
    asset_title = asset_dict.get("Title", "")

    if not rootfolder or not library_name:
        raise HTTPException(status_code=400, detail="Asset missing Rootfolder or LibraryName")

    # 2. Load Media Server Config
    try:
        if not CONFIG_PATH.exists():
            raise HTTPException(status_code=404, detail="Config file not found")

        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)

        plex_part = config.get("PlexPart", {})
        use_plex = str(plex_part.get("UsePlex", "true")).lower() == "true"

        jellyfin_part = config.get("JellyfinPart", {})
        use_jellyfin = str(jellyfin_part.get("UseJellyfin", "false")).lower() == "true"

        emby_part = config.get("EmbyPart", {})
        use_emby = str(emby_part.get("UseEmby", "false")).lower() == "true"

        active_server = None
        server_url = None
        server_token = None

        if use_plex:
            active_server = "plex"
            server_url = plex_part.get("PlexUrl") or config.get("PlexUrl")
            server_token = plex_part.get("PlexToken") or config.get("PlexToken")
            if not server_token and config.get("ApiPart"):
                server_token = config.get("ApiPart").get("PlexToken")
        elif use_jellyfin:
            active_server = "jellyfin"
            server_url = jellyfin_part.get("JellyfinUrl")
            server_token = jellyfin_part.get("JellyfinToken")
        elif use_emby:
            active_server = "emby"
            server_url = emby_part.get("EmbyUrl")
            server_token = emby_part.get("EmbyToken")

        if not active_server:
            raise HTTPException(status_code=400, detail="No active media server configured")

        if not server_url or not server_token:
            raise HTTPException(status_code=400, detail=f"{active_server.capitalize()} URL or Token not configured")

        server_url = server_url.rstrip("/")
    except (json.JSONDecodeError, OSError) as e:
        import logging
        logging.error(f"Error loading config: {e}")
        raise HTTPException(status_code=500, detail="Error loading media server configuration")

    # 3. Find Item ID in export database
    item_id = None
    with media_export_db.lock:
        try:
            m_conn = media_export_db._get_connection()
            m_cursor = m_conn.cursor()

            if active_server == "plex":
                m_cursor.execute(
                    "SELECT rating_key FROM plex_library_export WHERE library_name = ? AND root_foldername = ? ORDER BY id DESC LIMIT 1",
                    (library_name, rootfolder)
                )
                row = m_cursor.fetchone()
                if row:
                    item_id = row["rating_key"]
            else:
                m_cursor.execute(
                    "SELECT media_id FROM other_media_library_export WHERE library_name = ? AND root_foldername = ? ORDER BY id DESC LIMIT 1",
                    (library_name, rootfolder)
                )
                row = m_cursor.fetchone()
                if row:
                    item_id = row["media_id"]

            m_conn.close()
        except Exception as e:
            import logging
            logging.error(f"Error querying media export db: {e}")

    if not item_id:
        raise HTTPException(status_code=404, detail="Could not find corresponding media item")

    # 4. Connect to API and update tags
    async with httpx.AsyncClient(timeout=10.0) as client:

        season_num = None
        episode_num = None
        if asset_type in ["season", "titlecard", "episode"]:
            import re
            if asset_type == "season":
                m = re.search(r'Season (\d+)', asset_title, re.IGNORECASE)
                if m: season_num = int(m.group(1))
            else:
                m = re.search(r'S(\d+)E(\d+)', asset_title, re.IGNORECASE)
                if m:
                    season_num = int(m.group(1))
                    episode_num = int(m.group(2))

        if active_server == "plex":
            headers = {"X-Plex-Token": server_token, "Accept": "application/json"}

            # Get section_id
            sections_url = f"{server_url}/library/sections"
            sections_resp = await client.get(sections_url, headers=headers)
            if sections_resp.status_code != 200:
                raise HTTPException(status_code=500, detail="Failed to fetch Plex libraries")

            section_id = None
            directories = sections_resp.json().get("MediaContainer", {}).get("Directory", [])
            for directory in directories:
                if directory.get("title") == library_name:
                    section_id = directory.get("key")
                    break
            if not section_id:
                raise HTTPException(status_code=404, detail=f"Library '{library_name}' not found on Plex")

            # Resolve season/episode item_id if necessary
            if season_num is not None:
                    seasons_url = f"{server_url}/library/metadata/{item_id}/children"
                    seasons_resp = await client.get(seasons_url, headers=headers)
                    if seasons_resp.status_code == 200:
                        seasons = seasons_resp.json().get("MediaContainer", {}).get("Metadata", [])
                        season_key = None
                        for s in seasons:
                            if s.get("index") == season_num:
                                season_key = s.get("ratingKey")
                                break

                        if season_key:
                            if asset_type == "season":
                                item_id = season_key
                            elif episode_num is not None:
                                ep_url = f"{server_url}/library/metadata/{season_key}/children"
                                ep_resp = await client.get(ep_url, headers=headers)
                                if ep_resp.status_code == 200:
                                    episodes = ep_resp.json().get("MediaContainer", {}).get("Metadata", [])
                                    for ep in episodes:
                                        if ep.get("index") == episode_num:
                                            item_id = ep.get("ratingKey")
                                            break

            # Get existing labels and type
            metadata_url = f"{server_url}/library/metadata/{item_id}"
            metadata_resp = await client.get(metadata_url, headers=headers)
            if metadata_resp.status_code != 200:
                raise HTTPException(status_code=500, detail="Failed to fetch Plex metadata")

            item_metadata = metadata_resp.json().get("MediaContainer", {}).get("Metadata", [])
            if not item_metadata:
                raise HTTPException(status_code=404, detail="Plex item metadata not found")

            item = item_metadata[0]
            item_type_str = item.get("type", "movie")

            # Extract rich metadata for skipped items
            poster_path = item.get("thumb", "")
            year = str(item.get("year", ""))
            overview = item.get("summary", "")
            # Example Plex Web URL requires machine identifier, we'll store server_url/web/index.html#!/server/... if possible
            # But since we don't know machine identifier easily here, we'll store a generic or API link, or just leave it empty.
            media_url = ""

            # Map type string to id
            type_map = {"movie": 1, "show": 2, "season": 3, "episode": 4}
            type_id = type_map.get(item_type_str, 1)

            existing_labels = item.get("Label", [])
            label_names = [label.get("tag") for label in existing_labels]

            if "skip_posterizarr" not in label_names:
                label_names.append("skip_posterizarr")

            # Construct PUT URL
            put_url = f"{server_url}/library/sections/{section_id}/all"
            params = {
                "type": type_id,
                "id": item_id,
                "label.locked": 1,
            }
            for i, tag in enumerate(label_names):
                params[f"label[{i}].tag.tag"] = tag

            import urllib.parse
            query_string = urllib.parse.urlencode(params, safe="[]")

            logger.info(f"Sending PUT request to Plex: {put_url}")
            logger.info(f"Params string: {query_string}")

            put_resp = await client.put(put_url, headers=headers, params=query_string)
            logger.info(f"Plex PUT response status: {put_resp.status_code}")
            logger.info(f"Plex PUT response body: {put_resp.text}")

            if put_resp.status_code != 200:
                raise HTTPException(status_code=500, detail=f"Failed to update Plex labels: {put_resp.status_code}")

        else:
            # Jellyfin / Emby Logic
            auth_header = f'MediaBrowser Token="{server_token}"'
            headers = {"Authorization": auth_header, "Accept": "application/json", "Content-Type": "application/json"}

            # Resolve season/episode item_id if necessary
            if season_num is not None:
                # Get show's seasons
                import urllib.parse
                safe_item_id = urllib.parse.quote(item_id, safe="")
                seasons_url = f"{server_url}/Shows/{safe_item_id}/Seasons"
                seasons_resp = await client.get(seasons_url, headers=headers)
                if seasons_resp.status_code == 200:
                    seasons = seasons_resp.json().get("Items", [])
                    season_key = None
                    for s in seasons:
                        if s.get("IndexNumber") == season_num:
                            season_key = s.get("Id")
                            break

                    if season_key:
                        if asset_type == "season":
                            item_id = season_key
                        elif episode_num is not None:
                            # Get season's episodes
                            import urllib.parse
                            safe_item_id_for_show = urllib.parse.quote(item_id, safe="")
                            safe_season_key = urllib.parse.quote(season_key, safe="")
                            ep_url = f"{server_url}/Shows/{safe_item_id_for_show}/Episodes?seasonId={safe_season_key}"
                            ep_resp = await client.get(ep_url, headers=headers)
                            if ep_resp.status_code == 200:
                                episodes = ep_resp.json().get("Items", [])
                                for ep in episodes:
                                    if ep.get("IndexNumber") == episode_num:
                                        item_id = ep.get("Id")
                                        break

            import urllib.parse
            safe_item_id = urllib.parse.quote(item_id, safe="")
            item_url = f"{server_url}/Items/{safe_item_id}"
            item_resp = await client.get(item_url, headers=headers)
            if item_resp.status_code != 200:
                raise HTTPException(status_code=500, detail=f"Failed to fetch {active_server.capitalize()} item metadata")

            item_metadata = item_resp.json()

            # Extract rich metadata for Jellyfin/Emby
            year = str(item_metadata.get("ProductionYear", ""))
            overview = item_metadata.get("Overview", "")
            poster_path = ""
            if "Primary" in item_metadata.get("ImageTags", {}):
                poster_path = f"/Items/{safe_item_id}/Images/Primary?tag={item_metadata['ImageTags']['Primary']}"
            media_url = f"{server_url}/web/index.html#!/details?id={safe_item_id}"

            tags = item_metadata.get("Tags", [])
            if "skip_posterizarr" not in tags:
                tags.append("skip_posterizarr")
                item_metadata["Tags"] = tags

                post_resp = await client.post(item_url, headers=headers, json=item_metadata)
                if post_resp.status_code not in (200, 204):
                    raise HTTPException(status_code=500, detail=f"Failed to update {active_server.capitalize()} tags: {post_resp.status_code}")

    # 5. Insert into skipped_items tracking table
    if DATABASE_AVAILABLE and db is not None:
        try:
            # Note: For Plex we could construct a direct link if we had machine ID. For now we use the API path.
            db.add_skipped_item(asset_title, asset_type, rootfolder, library_name, active_server, str(item_id), poster_path, year, overview, media_url)
        except Exception as e:
            logger.error(f"Failed to add item to skipped_items: {e}")

    # 6. Delete from imagechoices
    with db.lock:
        conn = db._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM imagechoices WHERE id = ?", (request.asset_id,))
        conn.commit()
        conn.close()

    import threading
    threading.Thread(target=scan_and_cache_assets, daemon=True).start()

    return {"success": True, "message": f"Successfully skipped item in {active_server.capitalize()}"}


@app.get("/api/assets/skipped")
async def get_skipped_assets():
    """Get all skipped items from local database and media_export.db"""
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        rows = db.get_skipped_items()

        skipped_list = []
        for row in rows:
            item = dict(row)
            skipped_list.append({
                "id": item["id"],
                "item_id": item["item_id"],
                "server_type": item["server_type"],
                "Title": item.get("Title") or item.get("title", "Unknown"),
                "Type": item.get("Type") or item.get("type", "Unknown"),
                "LibraryName": item.get("LibraryName") or item.get("library_name", "Unknown"),
                "Rootfolder": item.get("Rootfolder") or item.get("rootfolder", ""),
                "poster_path": item.get("poster_path", ""),
                "year": item.get("year", ""),
                "overview": item.get("overview", ""),
                "media_url": item.get("media_url", ""),
            })

        # Track existing items to deduplicate
        existing_keys = set()
        for item in skipped_list:
            if item.get("server_type") and item.get("item_id"):
                existing_keys.add(f"{item['server_type']}_{item['item_id']}")

        # Query media_export.db for items that have skip_posterizarr label
        media_export_db_path = BASE_DIR / "database" / "media_export.db"
        if media_export_db_path.exists():
            import sqlite3
            conn = sqlite3.connect(media_export_db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            try:
                # Plex
                cursor.execute("SELECT title, library_name, rating_key as item_id, 'movie/show' as type, 'plex' as server_type, root_foldername as rootfolder FROM plex_library_export WHERE labels LIKE '%skip_posterizarr%'")
                for row in cursor.fetchall():
                    item = dict(row)
                    key = f"plex_{item['item_id']}"
                    if key not in existing_keys:
                        skipped_list.append({
                            "id": f"manual_{key}",
                            "item_id": str(item["item_id"]),
                            "server_type": "plex",
                            "Title": item.get("Title") or item.get("title", "Unknown"),
                            "Type": item.get("Type") or item.get("type", "movie"),
                            "LibraryName": item.get("LibraryName") or item.get("library_name", "Unknown"),
                            "Rootfolder": item.get("Rootfolder") or item.get("rootfolder", ""),
                            "poster_path": "",
                            "year": "",
                            "overview": "",
                            "media_url": "", # We don't easily know Plex machine identifier for web links
                        })
                        existing_keys.add(key)

                # Jellyfin/Emby
                cursor.execute("SELECT title, library_name, media_id as item_id, 'movie/show' as type, 'jellyfin/emby' as server_type, root_foldername as rootfolder FROM other_media_library_export WHERE labels LIKE '%skip_posterizarr%'")
                for row in cursor.fetchall():
                    item = dict(row)
                    key = f"jellyfin_{item['item_id']}"
                    if key not in existing_keys:

                        # Fallback for Jellyfin URLs (need server URL which we don't store in media_export, we only have config)
                        jellyfin_url = ""
                        try:
                            # We can try to get the server URL from config database
                            config_conn = sqlite3.connect(BASE_DIR / "database" / "config.db")
                            config_cursor = config_conn.cursor()
                            config_cursor.execute("SELECT URL FROM JFEMBY_Settings LIMIT 1")
                            config_row = config_cursor.fetchone()
                            if config_row:
                                jellyfin_url = f"{config_row[0]}/web/index.html#!/details?id={item['item_id']}"
                            config_conn.close()
                        except:
                            pass

                        skipped_list.append({
                            "id": f"manual_{key}",
                            "item_id": str(item["item_id"]),
                            "server_type": "jellyfin/emby",
                            "Title": item.get("Title") or item.get("title", "Unknown"),
                            "Type": item.get("Type") or item.get("type", "movie"),
                            "LibraryName": item.get("LibraryName") or item.get("library_name", "Unknown"),
                            "Rootfolder": item.get("Rootfolder") or item.get("rootfolder", ""),
                            "poster_path": "",
                            "year": "",
                            "overview": "",
                            "media_url": jellyfin_url,
                        })
                        existing_keys.add(key)
            except Exception as e:
                logger.error(f"Error querying media_export.db: {e}")
            finally:
                conn.close()

        return skipped_list
    except Exception as e:
        logger.error(f"Error fetching skipped items: {e}")
        raise HTTPException(status_code=500, detail="Error fetching skipped items")

from fastapi.responses import StreamingResponse
import httpx

def _get_media_server_credentials(server_type: str):
    server_url = ""
    server_token = ""
    try:
        import json
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)

            if server_type.lower() == "plex":
                plex_part = config.get("PlexPart") or {}
                url_val = plex_part.get("PlexUrl") or config.get("PlexUrl") or ""
                server_url = url_val.rstrip("/")
                server_token = plex_part.get("PlexToken") or config.get("PlexToken") or ""
                if not server_token and config.get("ApiPart"):
                    server_token = config.get("ApiPart").get("PlexToken") or ""
            else:
                jellyfin_part = config.get("JellyfinPart") or {}
                url_val = jellyfin_part.get("JellyfinUrl") or config.get("JellyfinUrl") or ""
                server_url = url_val.rstrip("/")
                server_token = jellyfin_part.get("JellyfinToken") or config.get("JellyfinToken") or ""
    except Exception as e:
        logger.error(f"Error loading credentials: {e}")
    return server_url, server_token

@app.get("/api/proxy/poster")
async def get_proxy_poster(server_type: str, item_id: str):
    """Proxy endpoint to fetch poster images from media servers without exposing tokens or dealing with CORS"""
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    import re
    if not re.match(r"^[a-zA-Z0-9\-]+$", item_id):
        raise HTTPException(status_code=400, detail="Invalid item_id format")

    try:
        if server_type.lower() == "plex":
            active_server = "plex"
            server_url, server_token = _get_media_server_credentials("plex")

            if not server_url or not server_token:
                raise HTTPException(status_code=400, detail="Plex credentials missing")

            import urllib.parse
            safe_item_id = urllib.parse.quote(item_id, safe="")

            # Plex poster is usually /library/metadata/{item_id}/thumb
            image_url = f"{server_url}/library/metadata/{safe_item_id}/thumb"
            headers = {"X-Plex-Token": server_token}

        elif server_type.lower() in ["jellyfin", "emby", "jellyfin/emby"]:
            active_server = "jellyfin"
            server_url, server_token = _get_media_server_credentials("jellyfin")

            if not server_url or not server_token:
                raise HTTPException(status_code=400, detail="Jellyfin credentials missing")

            import urllib.parse
            safe_item_id = urllib.parse.quote(item_id, safe="")

            image_url = f"{server_url}/Items/{safe_item_id}/Images/Primary"
            headers = {"Authorization": f'MediaBrowser Token="{server_token}"'}
        else:
            raise HTTPException(status_code=400, detail="Unknown server type")

        # Fetch image
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(image_url, headers=headers)
            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail="Image not found")

            return StreamingResponse(
                resp.iter_bytes(),
                media_type=resp.headers.get("content-type", "image/jpeg")
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in proxy poster: {e}")
        raise HTTPException(status_code=500, detail="Failed to proxy image")


from fastapi import BackgroundTasks

class RefreshSkippedRequest(BaseModel):
    ids: List[str] = [] # If empty, refresh all

async def refresh_skipped_metadata_background(ids: List[str]):
    """Background task to fetch and update metadata for skipped items"""
    if not DATABASE_AVAILABLE or db is None:
        return

    try:
        # Get active server credentials
        plex_url, plex_token = _get_media_server_credentials("plex")
        jf_url, jf_token = _get_media_server_credentials("jellyfin")

        # Get all skipped items (including from media_export.db)
        # get_skipped_assets is an async function, we can await it
        rows_data = await get_skipped_assets()

        async with httpx.AsyncClient(timeout=10.0) as client:
            for item in rows_data:

                # Check if we should process this item
                str_id = str(item['id'])
                if ids and str_id not in ids:
                    continue

                # If this is a manual item from media_export, we need to add it to local DB first
                if str_id.startswith("manual_"):
                    try:
                        new_id = db.add_skipped_item(
                            title=item.get("Title", "Unknown"),
                            asset_type=item.get("Type", "Unknown"),
                            rootfolder=item.get("Rootfolder", ""),
                            library_name=item.get("LibraryName", "Unknown"),
                            server_type=item.get("server_type"),
                            item_id=item.get("item_id"),
                            poster_path="", year="", overview="", media_url=""
                        )
                        db_id = new_id
                    except Exception as e:
                        logger.error(f"Failed to add manual skipped item to db: {e}")
                        continue
                else:
                    db_id = item['id']

                server_type = item.get("server_type", "").lower()
                item_id = item.get("item_id")

                if not server_type or not item_id:
                    continue

                # Fetch from Plex
                if server_type == "plex" and plex_url and plex_token:
                    server_url = plex_url
                    headers = {"X-Plex-Token": plex_token, "Accept": "application/json"}

                    try:
                        import urllib.parse
                        safe_item_id = urllib.parse.quote(item_id, safe="")
                        metadata_url = f"{server_url}/library/metadata/{safe_item_id}"
                        resp = await client.get(metadata_url, headers=headers)
                        if resp.status_code == 200:
                            meta_container = resp.json().get("MediaContainer", {})
                            machine_id = meta_container.get("machineIdentifier", "")
                            meta = meta_container.get("Metadata", [])
                            
                            if meta:
                                m = meta[0]
                                poster_path = m.get("thumb", "")
                                year = str(m.get("year", ""))
                                overview = m.get("summary", "")
                                asset_type = m.get("type", "movie")
                                
                                media_url = ""
                                if machine_id:
                                    # Construct Plex Web app URL for this specific server and item
                                    media_url = f"https://app.plex.tv/desktop/#!/server/{machine_id}/details?key=%2Flibrary%2Fmetadata%2F{item_id}"
                                    
                                db.update_skipped_item_metadata(db_id, poster_path, year, overview, media_url, asset_type)
                    except Exception as e:
                        logger.error(f"Error refreshing Plex metadata for skipped item {item_id}: {e}")

                # Fetch from Jellyfin
                elif server_type in ["jellyfin", "emby", "jellyfin/emby"] and jf_url and jf_token:
                    server_url = jf_url
                    headers = {"Authorization": f'MediaBrowser Token="{jf_token}"', "Accept": "application/json"}

                    try:
                        import urllib.parse
                        safe_item_id = urllib.parse.quote(item_id, safe="")
                        item_url = f"{server_url}/Items/{safe_item_id}"
                        resp = await client.get(item_url, headers=headers)
                        if resp.status_code == 200:
                            m = resp.json()

                            year = str(m.get("ProductionYear", ""))
                            overview = m.get("Overview", "")
                            poster_path = ""
                            if "Primary" in m.get("ImageTags", {}):
                                poster_path = f"/Items/{safe_item_id}/Images/Primary?tag={m['ImageTags']['Primary']}"
                            media_url = f"{server_url}/web/index.html#!/details?id={safe_item_id}"
                            asset_type = m.get("Type", "Movie").lower()
                            db.update_skipped_item_metadata(db_id, poster_path, year, overview, media_url, asset_type)
                    except Exception as e:
                        logger.error(f"Error refreshing Jellyfin metadata for skipped item {item_id}: {e}")

    except Exception as e:
        logger.error(f"Error in background metadata refresh task: {e}")

@app.post("/api/assets/skipped/refresh")
async def refresh_skipped_metadata(request: RefreshSkippedRequest, background_tasks: BackgroundTasks):
    """Trigger a background refresh of skipped items metadata"""
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    background_tasks.add_task(refresh_skipped_metadata_background, request.ids)
    return {"success": True, "message": "Metadata refresh started in the background"}

from typing import Optional, Union

class UnskipAssetRequest(BaseModel):
    id: Union[int, str] # The internal DB ID or manual ID
    item_id: Optional[str] = None
    server_type: Optional[str] = None

@app.post("/api/assets/unskip")
async def unskip_asset(request: UnskipAssetRequest):
    """Remove the skip_posterizarr tag from media server and local DB"""
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    active_server = ""
    item_id = ""
    db_id = None
    item_dict = {}

    if isinstance(request.id, int) or (isinstance(request.id, str) and request.id.isdigit()):
        db_id = int(request.id)
        # Get item from db
        rows = db.get_skipped_items()
        item = next((r for r in rows if dict(r)["id"] == db_id), None)

        if not item and not request.item_id:
            raise HTTPException(status_code=404, detail="Skipped item not found in local database")

        if item:
            item_dict = dict(item)
            active_server = item_dict.get("server_type", "").lower()
            item_id = item_dict.get("item_id")

    if not active_server and request.server_type:
        active_server = request.server_type.lower()
    if not item_id and request.item_id:
        item_id = request.item_id

    if not active_server or not item_id:
        if db_id is not None:
            db.delete_skipped_item(db_id)
            return {"success": True, "message": "Removed from skipped items list"}
        raise HTTPException(status_code=400, detail="Missing server_type or item_id")

    # Load Media Server Config
    try:
        if not CONFIG_PATH.exists():
            raise HTTPException(status_code=404, detail="Config file not found")

        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)

        plex_part = config.get("PlexPart") or {}
        jellyfin_part = config.get("JellyfinPart") or {}

        server_url = ""
        server_token = ""

        if active_server == "plex":
            url_val = plex_part.get("PlexUrl") or config.get("PlexUrl") or ""
            server_url = url_val.rstrip("/")
            server_token = plex_part.get("PlexToken") or config.get("PlexToken") or ""
            if not server_token and config.get("ApiPart"):
                server_token = config.get("ApiPart").get("PlexToken") or ""
        else:
            url_val = jellyfin_part.get("JellyfinUrl") or config.get("JellyfinUrl") or ""
            server_url = url_val.rstrip("/")
            server_token = jellyfin_part.get("JellyfinToken") or config.get("JellyfinToken") or ""

        if not server_url or not server_token:
            raise HTTPException(status_code=400, detail=f"{active_server.capitalize()} credentials missing in Posterizarr UI configuration")

    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"Error loading config in unskip_asset: {e}")
        raise HTTPException(status_code=500, detail="Failed to load media server configuration")

    async with httpx.AsyncClient(timeout=10.0) as client:
        if active_server == "plex":
            headers = {"X-Plex-Token": server_token, "Accept": "application/json"}

            # Fetch existing tags
            import urllib.parse
            safe_item_id = urllib.parse.quote(item_id, safe="")
            metadata_url = f"{server_url}/library/metadata/{safe_item_id}"
            metadata_resp = await client.get(metadata_url, headers=headers)

            if metadata_resp.status_code == 404:
                logger.warning(f"Item {item_id} not found in Plex, skipping API label removal.")
            else:
                if metadata_resp.status_code != 200:
                    raise HTTPException(status_code=500, detail="Failed to fetch Plex metadata")

                item_metadata = metadata_resp.json().get("MediaContainer", {}).get("Metadata", [])
                if not item_metadata:
                    raise HTTPException(status_code=404, detail="Plex item metadata not found")

                metadata_item = item_metadata[0]
                type_map = {"movie": 1, "show": 2, "season": 3, "episode": 4}
                type_id = type_map.get(metadata_item.get("type", "movie"), 1)

                # We need librarySectionID to use the PUT endpoint
                section_id = metadata_item.get("librarySectionID")
                if not section_id:
                     raise HTTPException(status_code=500, detail="Missing librarySectionID")

                put_url = f"{server_url}/library/sections/{section_id}/all"
                params = {
                    "type": type_id,
                    "id": item_id,
                    "label.locked": 1,
                    # In Plex API, to remove a label you must use the tag- suffix
                    # We provide multiple casing variations just in case
                    "label[].tag.tag-": "skip_posterizarr,Skip_posterizarr,SKIP_POSTERIZARR"
                }

                query_string = urllib.parse.urlencode(params, safe="[]-")

                put_resp = await client.put(put_url, headers=headers, params=query_string)

                if put_resp.status_code != 200:
                    raise HTTPException(status_code=500, detail=f"Failed to update Plex labels: {put_resp.status_code}")

            # Remove label from media_export.db to instantly update the UI without waiting for a sync
            try:
                import sqlite3
                media_export_path = BASE_DIR / "database" / "media_export.db"
                if media_export_path.exists():
                    me_conn = sqlite3.connect(media_export_path)
                    me_cursor = me_conn.cursor()
                    me_cursor.execute("UPDATE plex_library_export SET labels = REPLACE(REPLACE(labels, 'skip_posterizarr,', ''), 'skip_posterizarr', '') WHERE rating_key = ?", (item_id,))
                    me_cursor.execute("UPDATE plex_library_export SET labels = REPLACE(REPLACE(labels, 'Skip_posterizarr,', ''), 'Skip_posterizarr', '') WHERE rating_key = ?", (item_id,))
                    me_conn.commit()
                    me_conn.close()
            except Exception:
                pass

        else:
            auth_header = f'MediaBrowser Token="{server_token}"'
            headers = {"Authorization": auth_header, "Accept": "application/json", "Content-Type": "application/json"}

            import urllib.parse
            safe_item_id = urllib.parse.quote(item_id, safe="")
            item_url = f"{server_url}/Items/{safe_item_id}"
            item_resp = await client.get(item_url, headers=headers)

            if item_resp.status_code == 404:
                logger.warning(f"Item {item_id} not found in {active_server.capitalize()}, skipping API label removal.")
            else:
                if item_resp.status_code != 200:
                    raise HTTPException(status_code=500, detail=f"Failed to fetch {active_server.capitalize()} item metadata")

                item_metadata = item_resp.json()
                tags = item_metadata.get("Tags", [])
                has_skip_tag = any(str(tag).lower() == "skip_posterizarr" for tag in tags)

                if has_skip_tag:
                    item_metadata["Tags"] = [tag for tag in tags if str(tag).lower() != "skip_posterizarr"]

                    post_resp = await client.post(item_url, headers=headers, json=item_metadata)
                    if post_resp.status_code not in (200, 204):
                        raise HTTPException(status_code=500, detail=f"Failed to update tags: {post_resp.status_code}")

            # Remove label from media_export.db to instantly update the UI without waiting for a syncor a sync
                try:
                    import sqlite3
                    media_export_path = BASE_DIR / "database" / "media_export.db"
                    if media_export_path.exists():
                        me_conn = sqlite3.connect(media_export_path)
                        me_cursor = me_conn.cursor()
                        me_cursor.execute("UPDATE other_media_library_export SET labels = REPLACE(REPLACE(labels, 'skip_posterizarr,', ''), 'skip_posterizarr', '') WHERE media_id = ?", (item_id,))
                        me_cursor.execute("UPDATE other_media_library_export SET labels = REPLACE(REPLACE(labels, 'Skip_posterizarr,', ''), 'Skip_posterizarr', '') WHERE media_id = ?", (item_id,))
                        me_conn.commit()
                        me_conn.close()
                except Exception:
                    pass

    # Delete from local DB if it was a UI-tracked skip
    if db_id is not None:
        db.delete_skipped_item(db_id)
    return {"success": True, "message": f"Successfully unskipped {item_dict.get('Title', 'item')}"}


# ============================================
# API ENDPOINTS: IMAGE CHOICES DATABASE
# ============================================


class ImageChoiceRecord(BaseModel):
    """Model for image choice record"""

    Title: str
    Type: Optional[str] = None
    Rootfolder: Optional[str] = None
    LibraryName: Optional[str] = None
    Language: Optional[str] = None
    Fallback: Optional[str] = None
    TextTruncated: Optional[str] = None
    DownloadSource: Optional[str] = None
    FavProviderLink: Optional[str] = None
    Manual: Optional[str] = None

@app.get("/api/assets/overview")
async def get_assets_overview():
    """
    Get asset overview with categorized issues.
    Categories: Missing Assets, Non-Primary Lang, Non-Primary Provider, Truncated Text, Total with Issues, Resolved
    Note: Manual entries are categorized separately as "Resolved"
    """
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Get all records from database
        records = db.get_all_choices()

        # Create a fast lookup map from the asset cache
        logger.debug("Creating fast asset lookup map from cache for overview...")
        cache = get_fresh_assets()
        all_cached_assets = (
            cache["posters"]
            + cache["backgrounds"]
            + cache["seasons"]
            + cache["titlecards"]
        )

        # Create a map: { "Library/Folder/poster.jpg": { ... asset data ... } }
        asset_map = {
            img["path"].replace("\\", "/"): img for img in all_cached_assets
        }
        logger.debug(f"Asset map created with {len(asset_map)} items for overview")

        # Get primary languages and provider from config
        primary_language = None
        primary_background_language = None
        primary_season_language = None
        primary_titlecard_language = None
        primary_provider = None
        use_plex = True
        use_jellyfin = False
        use_emby = False

        try:
            if CONFIG_PATH.exists():
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    config = json.load(f)

                    # Check ApiPart for Language Orders
                    api_part = config.get("ApiPart", {})

                    # 1. Main Poster Language
                    lang_order = api_part.get("PreferredLanguageOrder", [])
                    if lang_order and len(lang_order) > 0:
                        primary_language = lang_order[0]

                    # 2. Background Language (Fallback to Main if empty or "PleaseFillMe")
                    bg_lang_order = api_part.get("PreferredBackgroundLanguageOrder", [])
                    if bg_lang_order and len(bg_lang_order) > 0 and bg_lang_order[0].lower() != "pleasefillme":
                        primary_background_language = bg_lang_order[0]
                    else:
                        primary_background_language = primary_language

                    # 3. Season Language (Fallback to Main if empty or "PleaseFillMe")
                    season_lang_order = api_part.get("PreferredSeasonLanguageOrder", [])
                    if season_lang_order and len(season_lang_order) > 0 and season_lang_order[0].lower() != "pleasefillme":
                        primary_season_language = season_lang_order[0]
                    else:
                        primary_season_language = primary_language

                    # 4. Title Card Language (Fallback to Main if empty or "PleaseFillMe")
                    tc_lang_order = api_part.get("PreferredTCLanguageOrder", [])
                    if tc_lang_order and len(tc_lang_order) > 0 and tc_lang_order[0].lower() != "pleasefillme":
                        primary_titlecard_language = tc_lang_order[0]
                    else:
                        primary_titlecard_language = primary_language

                    # Get FavProvider from ApiPart
                    fav_provider = api_part.get("FavProvider", "")
                    if fav_provider:
                        primary_provider = fav_provider.lower()

                    # Get UsePlex from PlexPart
                    plex_part = config.get("PlexPart", {})
                    use_plex_val = plex_part.get("UsePlex", "true")
                    use_plex = str(use_plex_val).lower() == "true"

                    # Get UseJellyfin from JellyfinPart
                    jellyfin_part = config.get("JellyfinPart", {})
                    use_jellyfin_val = jellyfin_part.get("UseJellyfin", "false")
                    use_jellyfin = str(use_jellyfin_val).lower() == "true"

                    # Get UseEmby from EmbyPart
                    emby_part = config.get("EmbyPart", {})
                    use_emby_val = emby_part.get("UseEmby", "false")
                    use_emby = str(use_emby_val).lower() == "true"

        except Exception as e:
            logger.warning(f"Could not read config: {e}")

        # Initialize categories
        missing_assets = []
        missing_assets_fav_provider = []
        non_primary_lang = []
        non_primary_provider = []
        truncated_text = []
        assets_with_issues = []
        resolved_assets = []

        # Categorize each record
        for record in records:
            record_dict = dict(record)

            rootfolder = record_dict.get("Rootfolder", "")
            asset_type_from_db = record_dict.get("Type", "Poster")
            title = record_dict.get("Title", "")
            library = record_dict.get("LibraryName", "")

            asset_filename = "poster.jpg" # Default
            asset_type_lower = (asset_type_from_db or "").lower()

            if "background" in asset_type_lower:
                asset_filename = "background.jpg"
            elif "season" in asset_type_lower:
                season_match = re.search(r"season\s*(\d+)", title, re.IGNORECASE)
                if season_match:
                    season_num = season_match.group(1).zfill(2)
                    asset_filename = f"Season{season_num}.jpg"
                else:
                    asset_filename = "Season_unknown.jpg"
            elif "titlecard" in asset_type_lower or "episode" in asset_type_lower:
                episode_match = re.search(r"(S\d+E\d+)", title, re.IGNORECASE)
                if episode_match:
                    episode_code = episode_match.group(1).upper()
                    asset_filename = f"{episode_code}.jpg"
                else:
                    asset_filename = "Episode_unknown.jpg"

            relative_path_key = f"{library}/{rootfolder}/{asset_filename}"
            poster_data = asset_map.get(relative_path_key)

            # Add cache data
            if poster_data:
                record_dict["poster_url"] = poster_data["url"]
                record_dict["has_poster"] = True
                record_dict["created"] = poster_data["created"]
                record_dict["modified"] = poster_data["modified"]
            else:
                record_dict["poster_url"] = None
                record_dict["has_poster"] = False
                record_dict["created"] = None
                record_dict["modified"] = None

            # Check Resolved Status
            manual_value = str(record_dict.get("Manual", "")).lower()
            if manual_value == "yes" or manual_value == "true":
                resolved_assets.append(record_dict)
                continue

            has_issue = False

            # Missing Assets Logic
            download_source = record_dict.get("DownloadSource")
            provider_link = record_dict.get("FavProviderLink", "")

            is_download_missing = (
                download_source == "false"
                or download_source == False
                or not download_source
            )

            is_provider_link_missing = (
                provider_link == "false" or provider_link == False or not provider_link
            )

            if is_download_missing:
                missing_assets.append(record_dict)
                has_issue = True

            if is_provider_link_missing:
                missing_assets_fav_provider.append(record_dict)
                has_issue = True

            # Non-Primary Language Logic - TYPE AWARE
            language = record_dict.get("Language", "")

            # Determine which primary language setting to use
            target_primary_lang = primary_language # Default to poster preference
            if "background" in asset_type_lower:
                target_primary_lang = primary_background_language
            elif "season" in asset_type_lower:
                target_primary_lang = primary_season_language
            elif "titlecard" in asset_type_lower or "episode" in asset_type_lower:
                target_primary_lang = primary_titlecard_language

            if language and target_primary_lang:
                # Normalize: "Textless" = "xx"
                lang_normalized = (
                    "xx" if language.lower() == "textless" else language.lower()
                )
                primary_normalized = (
                    "xx"
                    if target_primary_lang.lower() == "textless"
                    else target_primary_lang.lower()
                )

                if lang_normalized != primary_normalized:
                    non_primary_lang.append(record_dict)
                    has_issue = True
            elif language and not target_primary_lang:
                # Fallback if no config: assume non-textless is wrong
                if language.lower() not in ["xx", "textless"]:
                    non_primary_lang.append(record_dict)
                    has_issue = True

            # Non-Primary Provider Logic
            if not is_download_missing and not is_provider_link_missing:
                if primary_provider:
                    provider_patterns = {
                        "tmdb": ["tmdb", "themoviedb"],
                        "tvdb": ["tvdb", "thetvdb"],
                        "fanart": ["fanart"],
                        "plex": ["plex"],
                    }
                    patterns = provider_patterns.get(primary_provider, [primary_provider])
                    is_download_from_primary = any(pattern in download_source.lower() for pattern in patterns)
                    is_fav_link_from_primary = any(pattern in provider_link.lower() for pattern in patterns)

                    if not is_download_from_primary or not is_fav_link_from_primary:
                        non_primary_provider.append(record_dict)
                        has_issue = True

            # Truncated Text Logic
            truncated_value = str(record_dict.get("TextTruncated", "")).lower()
            if truncated_value == "true":
                truncated_text.append(record_dict)
                has_issue = True

            if has_issue:
                assets_with_issues.append(record_dict)

        return {
            "categories": {
                "missing_assets": {"count": len(missing_assets), "assets": missing_assets},
                "missing_assets_fav_provider": {"count": len(missing_assets_fav_provider), "assets": missing_assets_fav_provider},
                "non_primary_lang": {"count": len(non_primary_lang), "assets": non_primary_lang},
                "non_primary_provider": {"count": len(non_primary_provider), "assets": non_primary_provider},
                "truncated_text": {"count": len(truncated_text), "assets": truncated_text},
                "assets_with_issues": {"count": len(assets_with_issues), "assets": assets_with_issues},
                "resolved": {"count": len(resolved_assets), "assets": resolved_assets},
            },
            "config": {
                "primary_language": primary_language,
                "primary_language_background": primary_background_language,
                "primary_language_season": primary_season_language,
                "primary_language_titlecard": primary_titlecard_language,
                "primary_provider": primary_provider,
                "use_plex": use_plex,
                "use_jellyfin": use_jellyfin,
                "use_emby": use_emby,
            },
        }
    except Exception as e:
        logger.error(f"Error fetching assets overview: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/api/imagechoices")
async def get_all_imagechoices():
    """Get all image choice records"""
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        records = db.get_all_choices()
        # Convert sqlite3.Row to dict
        return [dict(record) for record in records]
    except Exception as e:
        logger.error(f"Error fetching image choices: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/imagechoices/{title}")
async def get_imagechoice_by_title(title: str):
    """Get image choice by title"""
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        record = db.get_choice_by_title(title)
        if record is None:
            raise HTTPException(status_code=404, detail="Record not found")
        return dict(record)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching image choice: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/imagechoices")
async def create_imagechoice(record: ImageChoiceRecord):
    """Create a new image choice record"""
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        record_id = db.insert_choice(
            title=record.Title,
            type_=record.Type,
            rootfolder=record.Rootfolder,
            library_name=record.LibraryName,
            language=record.Language,
            fallback=record.Fallback,
            text_truncated=record.TextTruncated,
            download_source=record.DownloadSource,
            fav_provider_link=record.FavProviderLink,
            manual=record.Manual,
        )
        return {"id": record_id, "message": "Record created successfully"}
    except Exception as e:
        logger.error(f"Error creating image choice: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.put("/api/imagechoices/{record_id}")
async def update_imagechoice(record_id: int, record: ImageChoiceRecord):
    """Update an existing image choice record"""
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Convert record to dict and filter out None values
        update_data = {k: v for k, v in record.dict().items() if v is not None}
        db.update_choice(record_id, **update_data)
        return {"message": "Record updated successfully"}
    except Exception as e:
        logger.error(f"Error updating image choice: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.delete("/api/imagechoices/{record_id}")
async def delete_imagechoice(record_id: int):
    """Delete an image choice record"""
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        db.delete_choice(record_id)
        return {"message": "Record deleted successfully"}
    except Exception as e:
        logger.error(f"Error deleting image choice: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/imagechoices/{record_id}/find-asset")
async def find_asset_for_imagechoice(record_id: int):
    """
    Find the actual asset file path for a database record.
    Searches the filesystem for the matching asset based on Rootfolder, LibraryName, and Type.
    Returns the asset path in Gallery-compatible format.
    """
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Get the record from DB
        record = db.get_choice_by_id(record_id)
        if not record:
            raise HTTPException(status_code=404, detail="Record not found")

        record_dict = dict(record)
        rootfolder = record_dict.get("Rootfolder")
        library = record_dict.get("LibraryName")
        asset_type = (record_dict.get("Type") or "").lower()
        title = record_dict.get("Title") or ""  # Title contains season/episode info

        if not rootfolder or not library:
            raise HTTPException(
                status_code=400, detail="Record missing Rootfolder or LibraryName"
            )

        # Construct the folder path
        folder_path = ASSETS_DIR / library / rootfolder

        if not folder_path.exists() or not folder_path.is_dir():
            raise HTTPException(
                status_code=404,
                detail=f"Asset folder not found: {library}/{rootfolder}",
            )

        # Determine which file pattern to look for based on type
        import re

        if "background" in asset_type:
            pattern = "background.*"
        elif "season" in asset_type:
            # For seasons, extract the season number from the Title field
            # Title format: "Show Name | Season04" or "Show Name | Season05"
            season_match = re.search(r"season\s*(\d+)", title, re.IGNORECASE)
            if season_match:
                season_num = season_match.group(1).zfill(2)  # Ensure 2 digits
                pattern = f"Season{season_num}.*"
                logger.info(f"Season pattern extracted from title '{title}': {pattern}")
            else:
                # Fallback to generic pattern
                pattern = "Season*.*"
                logger.warning(
                    f"Could not extract season number from title '{title}', using generic pattern"
                )
        elif "titlecard" in asset_type or "episode" in asset_type:
            # For titlecards, extract episode code from Title
            # Title format: "S04E01 | Episode Title"
            episode_match = re.search(r"(S\d+E\d+)", title, re.IGNORECASE)
            if episode_match:
                episode_code = episode_match.group(1).upper()
                pattern = f"{episode_code}.*"
                logger.info(
                    f"Episode pattern extracted from title '{title}': {pattern}"
                )
            else:
                pattern = "S[0-9][0-9]E[0-9][0-9].*"
                logger.warning(
                    f"Could not extract episode code from title '{title}', using generic pattern"
                )
        else:
            pattern = "poster.*"

        # Find matching files
        import glob

        matching_files = list(folder_path.glob(pattern))

        if not matching_files:
            logger.error(
                f"No matching asset found in {library}/{rootfolder} with pattern '{pattern}'"
            )
            raise HTTPException(
                status_code=404,
                detail=f"No matching asset found in {library}/{rootfolder} with pattern {pattern}",
            )

        # Return the first match (in Gallery-compatible format)
        asset_file = matching_files[0]
        logger.info(
            f"Found asset file for record {record_id}: {asset_file.name} (pattern: {pattern}, from title: '{title}')"
        )
        relative_path = asset_file.relative_to(ASSETS_DIR)
        path_str = str(relative_path).replace("\\", "/")
        # URL encode the path to handle special characters like #
        encoded_path_str = quote(path_str, safe="/")

        return {
            "success": True,
            "asset": {
                "name": asset_file.name,
                "path": path_str,
                "url": f"/poster_assets/{encoded_path_str}",
                "type": asset_type,
                "library": library,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error finding asset for record {record_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/imagechoices/import")
async def import_imagechoices_csv():
    """Manually trigger import of ImageChoices.csv to database"""
    if not DATABASE_AVAILABLE or db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    csv_path = LOGS_DIR / "ImageChoices.csv"
    if not csv_path.exists():
        raise HTTPException(
            status_code=404, detail="ImageChoices.csv not found in Logs directory"
        )

    try:
        stats = db.import_from_csv(csv_path)
        return {
            "message": "CSV import completed",
            "stats": {
                "added": stats.get("added", 0),
                "updated": stats.get("updated", 0),
                "skipped": stats.get("skipped", 0),
                "errors": stats.get("errors", 0),
                "error_details": stats.get("error_details", []) if stats.get("errors", 0) > 0 else [],
            },
        }
    except Exception as e:
        logger.error(f"Error importing CSV: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ============================================================================
# SUPPORT & TROUBLESHOOTING
# ============================================================================

# Regex definitions for support zip sanitization
RE_QUERY_PARAMS = re.compile(
    r"(?i)(token|key|pin|password|secret|auth|x-plex-token)=([^&\s\n\"';]+)"
)

# Specifically target Apprise URL schemes
RE_APPRISE_URLS = re.compile(
    r"(?i)\b(discord|tgram|telegram|slack|pushed|pushover|pushbullet|prowl|growl|gotify|matrix|msteams|twilio|vonage|signal)://([^\s\n\"';]+)"
)

# Specifically target Discord webhooks and Uptime Kuma push URLs
RE_DISCORD_WEBHOOK = re.compile(
    r"(?i)(https?://(?:discord|discordapp)\.com/api/webhooks/)([^\s\n\"';]+)"
)
RE_UPTIME_KUMA = re.compile(
    r"(?i)(https?://[^\s\n\"';]+/api/push/)([a-zA-Z0-9_-]+)"
)

# Authorization & Cookie headers (including JSON quoted format)
RE_AUTH_HEADERS = re.compile(
    r"(?i)(authorization\s*[\"']?\s*:\s*[\"']?\w+\s+)([^\"'\s\n,;]+)"
)
RE_COOKIE_HEADERS = re.compile(
    r"(?i)(cookie\s*:\s*)([^\s\n\"';]+)"
)

# Key-Value pairs in logs/configs
# Matches: key = value, key: value, "key": "value" (supporting quotes around keys, quotes around values, and spaces inside quoted values)
RE_KEY_VALUES = re.compile(
    r"(?i)([\"']?\b[a-z0-9_-]*(?:key|token|password|pin|secret|auth|credential|api)[a-z0-9_-]*\b[\"']?\s*[:=]\s*)(?:([\"'])(.*?)\2|([^\"'\s\n,;]+))"
)

RE_LOCAL_IPS = re.compile(
    r"(?<!\d)(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|127\.0\.0\.1)(?!\d)|(?<![a-zA-Z0-9_-])localhost(?![a-zA-Z0-9_-])",
    re.IGNORECASE
)
RE_LOCAL_DOMAINS = re.compile(
    r"(?<![a-zA-Z0-9_-])[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*(?:\.local|\.lan)\b",
    re.IGNORECASE
)

def _key_value_sub(match):
    prefix = match.group(1)
    quote_char = match.group(2)
    quoted_val = match.group(3)
    unquoted_val = match.group(4)

    val = quoted_val if quote_char is not None else unquoted_val
    prefix_lower = prefix.lower()
    val_lower = val.lower() if val else ""

    # Check if the key contains 'enabled' or the value is a boolean, which are not secrets
    is_boolean_flag = (
        "enabled" in prefix_lower or
        val_lower in ["true", "false"]
    )

    if is_boolean_flag:
        return match.group(0)

    if quote_char is not None:
        # It was a quoted value (e.g. "my secret password")
        return f"{prefix}{quote_char}[MASKED]{quote_char}"
    else:
        # It was an unquoted value
        return f"{prefix}[MASKED]"

def _sanitize_string(val: str) -> str:
    if not isinstance(val, str):
        return val

    # 1. URL Query parameters
    val = RE_QUERY_PARAMS.sub(r"\1=[MASKED]", val)

    # 2. Apprise URLs
    val = RE_APPRISE_URLS.sub(r"\1://[MASKED]", val)

    # 3. Discord webhooks & Uptime Kuma URLs
    val = RE_DISCORD_WEBHOOK.sub(r"\1[MASKED]", val)
    val = RE_UPTIME_KUMA.sub(r"\1[MASKED]", val)

    # 4. Authorization & Cookie headers
    val = RE_AUTH_HEADERS.sub(r"\1[MASKED]", val)
    val = RE_COOKIE_HEADERS.sub(r"\1[MASKED]", val)

    # 5. Key-Value configurations/logs
    val = RE_KEY_VALUES.sub(_key_value_sub, val)

    # 6. Local IPs
    val = RE_LOCAL_IPS.sub("[MASKED_IP]", val)

    # 7. Local Domains
    val = RE_LOCAL_DOMAINS.sub("[MASKED_HOST]", val)

    return val

def _sanitize_db_file(db_path: Path):
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cursor.fetchall() if r[0] != 'sqlite_sequence']

        for table in tables:
            cursor.execute(f"PRAGMA table_info({table})")
            columns_info = cursor.fetchall()
            text_cols = []
            primary_keys = []
            for col in columns_info:
                col_name = col[1]
                col_type = col[2].upper() if col[2] else ""
                col_pk = col[5]
                if col_pk > 0:
                    primary_keys.append(col_name)
                if not col_type or "TEXT" in col_type or "CHAR" in col_type or "CLOB" in col_type:
                    text_cols.append(col_name)

            if not text_cols:
                continue

            use_rowid = len(primary_keys) == 0
            id_cols = ["rowid"] if use_rowid else primary_keys

            select_cols = id_cols + text_cols
            cols_str = ", ".join(f'"{c}"' for c in select_cols)
            cursor.execute(f'SELECT {cols_str} FROM "{table}"')
            rows = cursor.fetchall()

            updates = []
            for row in rows:
                row_ids = row[:len(id_cols)]
                text_vals = row[len(id_cols):]

                sanitized_vals = []
                changed = False
                for val in text_vals:
                    if isinstance(val, str):
                        sanitized = _sanitize_string(val)
                        if sanitized != val:
                            changed = True
                        sanitized_vals.append(sanitized)
                    else:
                        sanitized_vals.append(val)

                if changed:
                    set_clause = ", ".join(f'"{c}" = ?' for c in text_cols)
                    where_clause = " AND ".join(f'"{c}" = ?' for c in id_cols)
                    sql = f'UPDATE "{table}" SET {set_clause} WHERE {where_clause}'
                    params = list(sanitized_vals) + list(row_ids)
                    updates.append((sql, params))

            if updates:
                for sql, params in updates:
                    cursor.execute(sql, params)
                conn.commit()
                logger.info(f"[SupportZip] Sanitized {len(updates)} rows in table '{table}' of DB: {db_path.name}")
        conn.close()
    except Exception as e:
        logger.error(f"[SupportZip] Failed to sanitize database {db_path}: {e}", exc_info=True)

def _sanitize_text_file(file_path: Path):
    try:
        content = None
        for encoding in ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    content = f.read()
                break
            except UnicodeDecodeError:
                continue
        if content is None:
            logger.error(f"[SupportZip] Could not read text file with any encoding: {file_path}")
            return

        sanitized = _sanitize_string(content)
        if sanitized != content:
            with open(file_path, 'w', encoding='utf-8', newline='') as f:
                f.write(sanitized)
            logger.debug(f"[SupportZip] Sanitized text/log file: {file_path.name}")
    except Exception as e:
        logger.error(f"[SupportZip] Failed to sanitize text file {file_path}: {e}", exc_info=True)

def _create_support_zip_blocking(staging_dir_path: Path, zip_file_path: Path) -> bool:
    """
    Internal blocking function to create the support zip in a background thread.
    This function performs all file I/O operations.
    """
    try:
        # 1. Define Paths (uses globals from main.py)
        db_staging_dir = staging_dir_path / "database"
        db_staging_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"[SupportZip] Staging directory: {staging_dir_path}")

        # 2. Copy Log Folders
        # Define ignore patterns
        ignore_patterns_default = shutil.ignore_patterns('*.pyc', '__pycache__', '.DS_Store')
        # For LOGS_DIR and ROTATED_LOGS_DIR, also ignore .json files
        ignore_patterns_logs = shutil.ignore_patterns('*.pyc', '__pycache__', '.DS_Store', '*.json')

        if 'LOGS_DIR' in globals() and LOGS_DIR.exists():
            shutil.copytree(
                LOGS_DIR,
                staging_dir_path / "Logs",
                dirs_exist_ok=True,
                ignore=ignore_patterns_logs  # Use ignore pattern with '*.json'
            )
            logger.info("[SupportZip] Copied Logs directory (excluding .json files)")

        if 'ROTATED_LOGS_DIR' in globals() and ROTATED_LOGS_DIR.exists():
            shutil.copytree(
                ROTATED_LOGS_DIR,
                staging_dir_path / "RotatedLogs",
                dirs_exist_ok=True,
                ignore=ignore_patterns_logs  # Same ignore rules as Logs
            )
            logger.info("[SupportZip] Copied RotatedLogs directory (excluding .json files)")

        if 'UI_LOGS_DIR' in globals() and UI_LOGS_DIR.exists():
            shutil.copytree(
                UI_LOGS_DIR,
                staging_dir_path / "UILogs",
                dirs_exist_ok=True,
                ignore=ignore_patterns_default # Use default ignore pattern
            )
            logger.info("[SupportZip] Copied UILogs directory")

        # 3. Copy Databases
        for db_name in [
            "media_export.db",
            "runtime_stats.db",
            "server_libraries.db",
            "imagechoices.db"
        ]:
            src_db = DATABASE_DIR / db_name
            if src_db.exists():
                shutil.copy2(src_db, db_staging_dir / db_name)
                logger.debug(f"[SupportZip] Copied DB: {db_name}")

        # 3b. Sanitize all copied logs and databases recursively
        logger.info("[SupportZip] Sanitizing all staged support files...")
        for root, dirs, files in os.walk(staging_dir_path):
            for file in files:
                file_path = Path(root) / file
                # Skip the zip file itself if it is already in the staging directory
                if file_path == zip_file_path:
                    continue

                suffix = file_path.suffix.lower()
                if suffix == '.db':
                    logger.debug(f"[SupportZip] Sanitizing database file: {file_path.name}")
                    _sanitize_db_file(file_path)
                elif suffix in ['.log', '.txt', '.json'] or (suffix == '.csv' and file_path.name.lower() == 'imagechoices.csv'):
                    logger.debug(f"[SupportZip] Sanitizing text file: {file_path.name}")
                    _sanitize_text_file(file_path)

        # 4. Create ZIP file
        logger.debug(f"[SupportZip] Creating ZIP file at: {zip_file_path}")
        with zipfile.ZipFile(zip_file_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(staging_dir_path):
                if Path(root) == zip_file_path.parent and zip_file_path.name in files:
                    files.remove(zip_file_path.name)

                for file in files:
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(staging_dir_path)
                    zipf.write(file_path, arcname)

        logger.info(f"[SupportZip] Support ZIP created successfully: {zip_file_path}")
        return True

    except Exception as e:
        logger.error(f"[SupportZip] Failed to create support zip: {e}")
        logger.exception("Full traceback for zip creation:")
        return False

def _cleanup_support_files(staging_dir: Path):
    """
    Cleanup function for BackgroundTasks to remove the temp staging directory.
    """
    try:
        if staging_dir.exists():
            shutil.rmtree(staging_dir)
            logger.debug(f"[SupportZip] Cleaned up staging directory: {staging_dir}")
    except Exception as e:
        logger.error(f"[SupportZip] Error cleaning up staging directory {staging_dir}: {e}")


@app.post("/api/admin/support-zip")
async def get_support_zip(background_tasks: BackgroundTasks):
    """
    Create and return a ZIP file containing logs and sanitized databases
    for troubleshooting and support.
    """
    logger.info("=" * 60)
    logger.info("SUPPORT ZIP REQUESTED")

    # 1. Create a temp staging directory
    try:
        staging_dir = Path(tempfile.mkdtemp(prefix="posterizarr_support_"))

        # Generate timestamp for unique filename
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        # Ensure there is no trailing underscore after .zip
        zip_filename = f"posterizarr_support_{timestamp}.zip"
        zip_path = staging_dir / zip_filename

        logger.debug(f"[SupportZip] Staging directory created: {staging_dir}")
    except Exception as e:
        logger.error(f"[SupportZip] Failed to create temp directory: {e}")
        raise HTTPException(status_code=500, detail="Failed to create temporary directory")

    # 2. Add cleanup task to remove the *entire* staging dir
    background_tasks.add_task(_cleanup_support_files, staging_dir)

    # 3. Run the blocking zip creation in a separate thread
    try:
        success = await asyncio.to_thread(
            _create_support_zip_blocking, staging_dir, zip_path
        )

        if not success or not zip_path.exists():
            logger.error("[SupportZip] ZIP creation failed in background thread.")
            raise HTTPException(status_code=500, detail="Failed to create support ZIP file")

        # 4. Return the file
        logger.info("[SupportZip] Sending support ZIP file to user...")
        logger.info("=" * 60)
        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename=zip_filename  # Use dynamic filename
        )

    except Exception as e:
        logger.error(f"Failed to create support ZIP: {e}", exc_info=True)
        logger.info("=" * 60)
        raise HTTPException(status_code=500, detail="Internal error while creating support package")

# ============================================================================
# WEBHOOK ENDPOINTS (ARR & TAUTULLI)
# ============================================================================

@app.post("/api/webhook/arr")
async def arr_webhook(request: Request):
    """
    Accepts Webhooks from Sonarr/Radarr (at /api/webhook/arr),
    converts them to .posterizarr files, and drops them in the watcher folder.
    """
    try:
        payload = await request.json()

        # Determine Event and Platform
        event_type = payload.get("eventType", "Unknown")

        # Handle "Test" event from the Arr settings page
        if event_type == "Test":
            logger.info("Received Test Webhook from Arr instance")
            return {"success": True, "message": "Test successful"}

        # We typically only care about Import/Download/Grab/Delete events
        if event_type not in ["Download", "Import", "Grab", "MovieFileDelete", "EpisodeFileDelete"]:
            return {"success": True, "message": f"Ignored event type: {event_type}"}

        data_map = {}
        platform = "Unknown"

        # Map JSON Data to Posterizarr Arguments (mimicking ArrTrigger.sh logic)

        # RADARR
        if "movie" in payload:
            platform = "Radarr"
            movie = payload.get("movie", {})
            movie_file = payload.get("movieFile", {})

            data_map["arr_platform"] = platform
            data_map["event"] = event_type
            data_map["arr_movie_title"] = movie.get("title", "")
            data_map["arr_movie_tmdb"] = movie.get("tmdbId", "")
            data_map["arr_movie_imdb"] = movie.get("imdbId", "")
            data_map["arr_movie_year"] = movie.get("year", "")
            data_map["arr_movie_path"] = movie.get("folderPath", "")

            # For downloads/upgrades, get specific file info
            if movie_file:
                data_map["arr_moviefile_path"] = movie_file.get("path", "")
                data_map["arr_moviefile_id"] = movie_file.get("id", "")

        # SONARR
        elif "series" in payload:
            platform = "Sonarr"
            series = payload.get("series", {})
            episodes = payload.get("episodes", [])

            data_map["arr_platform"] = platform
            data_map["event"] = event_type
            data_map["arr_series_title"] = series.get("title", "")
            data_map["arr_series_tvdb"] = series.get("tvdbId", "")
            data_map["arr_series_path"] = series.get("path", "")

            # Sonarr webhooks don't always send IMDB/TMDB in the main payload
            if "imdbId" in series:
                data_map["arr_series_imdb"] = series.get("imdbId")

            # Handle Episode Data
            if episodes:
                first_ep = episodes[0]
                data_map["arr_episode_season"] = first_ep.get("seasonNumber", "")
                data_map["arr_episode_numbers"] = first_ep.get("episodeNumber", "")
                data_map["arr_episode_titles"] = first_ep.get("title", "")

                # If there's an episode file payload
                if "episodeFile" in payload:
                    data_map["arr_episode_path"] = payload["episodeFile"].get("path", "")

        else:
            logger.warning(f"Unknown payload format received: {payload.keys()}")
            raise HTTPException(status_code=400, detail="Unknown payload format")

        # 3. Write the .posterizarr file
        watcher_dir = BASE_DIR / "watcher"
        watcher_dir.mkdir(parents=True, exist_ok=True)

        # Create unique filename timestamp_random.posterizarr
        # The prefix "recently_added_" is used by Start.ps1 to calculate delay times
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")[:-3]
        rand_str = os.urandom(3).hex()
        filename = f"recently_added_{timestamp}_{rand_str}.posterizarr"
        file_path = watcher_dir / filename

        logger.info(f"Creating Arr trigger file for {platform}: {file_path}")

        with open(file_path, "w", encoding="utf-8") as f:
            for key, value in data_map.items():
                # Write in the format: [key]: value
                f.write(f"[{key}]: {value}\n")

        return {
            "success": True,
            "message": f"Trigger queued for {platform}",
            "file": str(file_path)
        }

    except Exception as e:
        logger.error(f"Error processing Arr webhook: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/webhook/tautulli")
async def tautulli_webhook(request: Request):
    """
    Accepts Webhooks from Tautulli (at /api/webhook/tautulli).
    Maps JSON keys directly to .posterizarr trigger file format.
    """
    try:
        payload = await request.json()

        # Filter out empty payloads
        if not payload:
            return {"success": False, "message": "Empty payload"}

        # Handle Tautulli "Test" Webhook
        # A test webhook from Tautulli either sends empty strings for values,
        # or the literal placeholder strings if it doesn't substitute them.
        all_empty = all(not str(v).strip() for v in payload.values())
        has_placeholders = any(isinstance(v, str) and (v == "{rating_key}" or v == "{media_type}") for v in payload.values())

        if all_empty or has_placeholders:
            logger.info("Received Test Webhook from Tautulli")
            return {"success": True, "message": "Test successful"}

        # Define the Watcher Directory
        watcher_dir = BASE_DIR / "watcher"
        watcher_dir.mkdir(parents=True, exist_ok=True)

        # Create unique filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")[:-3]
        rand_str = os.urandom(3).hex()

        filename = f"tautulli_trigger_{timestamp}_{rand_str}.posterizarr"
        file_path = watcher_dir / filename

        logger.info(f"Creating Tautulli trigger file: {file_path}")

        with open(file_path, "w", encoding="utf-8") as f:
            for key, value in payload.items():
                # Only write keys that have values.
                if value:
                    f.write(f"[{key}]: {value}\n")

        return {
            "success": True,
            "message": "Tautulli trigger queued",
            "file": str(file_path)
        }

    except Exception as e:
        logger.error(f"Error processing Tautulli webhook: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ============================================================================
# OVERLAY CREATOR ENDPOINTS
# ============================================================================

@app.post("/api/overlay-creator/preview")
async def preview_created_overlay(options: OverlayCreatorRequest):
    """Generates a low-res preview of the overlay settings"""
    try:
        # Convert options to dict
        opt_dict = options.dict()

        # If Show Text Area is enabled, fetch config values from DB
        if options.show_text_area and config_db:
            try:
                # Determine which config section to look up based on type
                # Currently matching the 2 buttons in UI (Poster vs Background)
                # You can expand this logic if you add Season/TitleCard buttons later
                section = ""
                if options.overlay_type == "background":
                    section = "BackgroundOverlayPart"
                else:
                    section = "PosterOverlayPart"

                # Fetch values (defaulting to 0 if not found/error)
                def get_int(key):
                    val = config_db.get_value(section, key)
                    try:
                        return int(val) if val is not None else 0
                    except:
                        return 0

                opt_dict["text_box_w"] = get_int("MaxWidth")
                opt_dict["text_box_h"] = get_int("MaxHeight")
                opt_dict["text_box_offset"] = get_int("text_offset")

            except Exception as e:
                logger.error(f"Error fetching config for preview guide: {e}")

        # Generate full res (RGBA)
        img = generate_overlay_image(opt_dict)

        # Resize for faster preview transfer (e.g., 500px width)
        w, h = img.size
        preview_w = 500
        preview_h = int(h * (preview_w / w))
        img = img.resize((preview_w, preview_h), Image.Resampling.LANCZOS)

        # Convert to base64
        buffered = BytesIO()
        img.save(buffered, format="PNG")
        img_str = b64encode(buffered.getvalue()).decode("utf-8")

        return {"success": True, "image_base64": img_str}
    except Exception as e:
        logger.error(f"Error generating preview: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/overlay-creator/save")
async def save_created_overlay(options: OverlayCreatorRequest):
    """Generates and saves the overlay as a PNG to Overlayfiles"""
    try:
        if not options.filename:
            raise HTTPException(status_code=400, detail="Filename required")

        safe_filename = "".join(c for c in options.filename if c.isalnum() or c in "._- ").strip()
        if not safe_filename.lower().endswith(".png"):
            safe_filename += ".png"

        save_path = OVERLAYFILES_DIR / safe_filename

        # Check existence only if overwrite is False
        if save_path.exists() and not options.overwrite:
            raise HTTPException(status_code=409, detail="File already exists")

        # Generate
        img = generate_overlay_image(options.dict())
        img.save(save_path, "PNG")

        return {"success": True, "message": f"Saved {safe_filename}", "filename": safe_filename}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving created overlay: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ============================================
# STATIC FILE MOUNTS
# ============================================

if ASSETS_DIR.exists():
    app.mount(
        "/poster_assets",
        CachedStaticFiles(directory=str(ASSETS_DIR), max_age=86400),  # 24h Cache
        name="poster_assets",
    )
    logger.info(f"Mounted /poster_assets -> {ASSETS_DIR} (with 24h cache)")

if MANUAL_ASSETS_DIR.exists():
    app.mount(
        "/manual_poster_assets",
        CachedStaticFiles(directory=str(MANUAL_ASSETS_DIR), max_age=86400),  # 24h Cache
        name="manual_poster_assets",
    )
    logger.info(
        f"Mounted /manual_poster_assets -> {MANUAL_ASSETS_DIR} (with 24h cache)"
    )

if TEST_DIR.exists():
    app.mount(
        "/test",
        CachedStaticFiles(directory=str(TEST_DIR), max_age=86400),  # 24h Cache
        name="test",
    )
    logger.info(f"Mounted /test -> {TEST_DIR} (with 24h cache)")

IMAGES_DIR.mkdir(parents=True, exist_ok=True)

if IMAGES_DIR.exists():
    app.mount(
        "/images",
        CachedStaticFiles(directory=str(IMAGES_DIR), max_age=86400),  # 24h Cache
        name="images",
    )
    logger.info(f"Mounted /images -> {IMAGES_DIR} (with 24h cache)")

# ============================================
# QUEUE SYSTEM IMPLEMENTATION
# ============================================

async def finalize_asset_replacement(
    asset_path: str,
    file_content: bytes,
    process_with_overlays: bool,
    overlay_params: dict
):
    """
    Finalize the replacement process.
    Handles specific pathing for Collections while preserving original
    regex logic for Seasons and TitleCards.
    """
    try:
        # 1. Identify asset type
        explicit_asset_type = str(overlay_params.get("asset_type", "")).lower()

        if not process_with_overlays:
            target_base_dir = MANUAL_ASSETS_DIR
        else:
            target_base_dir = ASSETS_DIR

        # 2. Path Logic: Prepend 'Collections' ONLY if type is collection
        try:
            if explicit_asset_type == "collection":
                full_asset_path = get_safe_path(target_base_dir / "Collections", asset_path)
            else:
                full_asset_path = get_safe_path(target_base_dir, asset_path)

            logger.info(f"Queue Processor: Resolved safe path {full_asset_path}")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Queue Processor: Path resolution error: {e}", exc_info=True)
            raise HTTPException(status_code=400, detail="Invalid asset path in queue")

        # Ensure directory exists
        full_asset_path.parent.mkdir(parents=True, exist_ok=True)

        # 3. Save source file
        with open(full_asset_path, "wb") as f:
            f.write(file_content)

        logger.info(f"Queue Processor: Saved asset successfully")


        # 4. Update Database
        try:
            await update_asset_db_entry_as_manual(
                asset_path,
                "Queue Processing",
                overlay_params.get("library_name"),
                overlay_params.get("folder_name"),
                overlay_params.get("title_text")
            )
        except Exception as e:
            logger.warning(f"Queue Processor: DB update warning: {e}")

        # 5. Trigger Manual Run (PowerShell)
        if process_with_overlays:
            path_parts = Path(asset_path).parts
            filename = Path(asset_path).name.lower()

            final_library_name = overlay_params.get("library_name")
            final_folder_name = overlay_params.get("folder_name")
            final_title_text = overlay_params.get("title_text")

            if len(path_parts) >= 2:
                final_library_name = final_library_name or path_parts[0]
                final_folder_name = final_folder_name or path_parts[1]

                if not final_title_text:
                     final_title_text = overlay_params.get("title_text", "")

            # 6. Poster Type and Regex Extraction Logic
            poster_type = "standard"
            season_poster_name = overlay_params.get("season_number", "")
            ep_number = overlay_params.get("episode_number", "")
            ep_title_name = overlay_params.get("episode_title", "")

            # Regex patterns
            title_card_regex = r"(?i)s(\d+)e(\d+)"
            season_regex = r"(?i)season\s*?-?_?(\d+)"

            if explicit_asset_type == "collection":
                poster_type = "collection"
            elif explicit_asset_type == "titlecard":
                poster_type = "titlecard"
                if not ep_number or not season_poster_name:
                    tc_match = re.search(title_card_regex, filename)
                    if tc_match:
                        if not season_poster_name: season_poster_name = tc_match.group(1)
                        if not ep_number: ep_number = tc_match.group(2)
            elif explicit_asset_type == "season":
                poster_type = "season"
                if not season_poster_name:
                    s_match = re.search(season_regex, filename)
                    if s_match:
                        season_poster_name = s_match.group(1)
                    else:
                        num_match = re.search(r"(\d+)", filename)
                        if num_match: season_poster_name = num_match.group(1)
            elif explicit_asset_type == "background":
                poster_type = "background"
            else:
                # Original Auto-detection logic for when no type is provided
                if "background" in filename:
                    poster_type = "background"
                elif (ep_number and ep_title_name) or re.search(title_card_regex, filename):
                    poster_type = "titlecard"
                    tc_match = re.search(title_card_regex, filename)
                    if tc_match and (not season_poster_name or not ep_number):
                        if not season_poster_name: season_poster_name = tc_match.group(1)
                        if not ep_number: ep_number = tc_match.group(2)
                elif season_poster_name or "season" in filename:
                    poster_type = "season"
                    s_match = re.search(season_regex, filename)
                    if s_match and not season_poster_name:
                        season_poster_name = s_match.group(1)

            # Clean up numbers (remove leading zeros)
            if season_poster_name and str(season_poster_name).isdigit():
                season_poster_name = str(int(season_poster_name))
            if ep_number and str(ep_number).isdigit():
                ep_number = str(int(ep_number))

            # 7. Construct and Trigger Request
            manual_request = ManualModeRequest(
                picturePath=str(full_asset_path),
                titletext=final_title_text or "",
                # Only use 'Collections/' prefix for folderName if it's a collection
                folderName=final_folder_name or "",
                libraryName=final_library_name or "",
                posterType=poster_type,
                mediaType=overlay_params.get("mediaType") or "",
                seasonPosterName=season_poster_name or "",
                epTitleName=ep_title_name or "",
                episodeNumber=ep_number or "",
                posterWithText=overlay_params.get("poster_with_text", False),
                blueprint_overrides=overlay_params.get("blueprint_overrides"),
            )

            await trigger_manual_run_internal(manual_request)

            # Wait for completion
            global current_process
            proc = current_process
            if proc is not None:
                try:
                    logger.info(f"Queue Processor: Waiting for Manual Run (PID {proc.pid}) to finish...")
                    while proc.poll() is None:
                        await asyncio.sleep(1)
                finally:
                    if current_process == proc:
                        current_process = None

    except Exception as e:
        logger.error(f"Queue Processor Error: {e}")
        raise e

async def run_queue_processor():
    """
    Background task to process the queue sequentially.
    """
    logger.info("Starting Queue Processor")

    # helper check
    if RUNNING_FILE.exists():
        logger.warning("Posterizarr is running. Aborting queue start.")
        return

    items = queue_manager.get_pending_items()
    logger.info(f"Queue Processor: Found {len(items)} pending items.")

    for item in items:
        # Check running file before each item to be safe/responsive to external stops
        if RUNNING_FILE.exists():
             logger.warning("Queue Processor: execution paused/stopped because RUNNING_FILE appeared.")
             break

        item_id = item["id"]
        logger.info(f"Queue Processor: Processing item #{item_id} ({item['asset_path']})")

        queue_manager.update_status(item_id, "processing")

        try:
            content = b""
            if item["source_type"] == "url":
                async with httpx.AsyncClient() as client:
                    resp = await client.get(item["source_data"])
                    if resp.status_code != 200:
                        raise Exception(f"Failed to download URL: {resp.status_code}")
                    content = resp.content
            elif item["source_type"] == "upload":
                # Staged file
                staged_path = Path(item["source_data"])
                if not staged_path.exists():
                    raise Exception(f"Staged file not found: {staged_path}")
                with open(staged_path, "rb") as f:
                    content = f.read()

            # Execute
            await finalize_asset_replacement(
                asset_path=item["asset_path"],
                file_content=content,
                process_with_overlays=item["overlay_params"].get("process_with_overlays", False),
                overlay_params=item["overlay_params"]
            )

            queue_manager.update_status(item_id, "completed")

            # Cleanup staged file if upload
            if item["source_type"] == "upload":
                try:
                    Path(item["source_data"]).unlink(missing_ok=True)
                except: pass

        except Exception as e:
            logger.error(f"Queue Processor: Failed item #{item_id}: {e}")
            queue_manager.update_status(item_id, "failed", str(e))

    logger.info("Queue Processor: Batch finished.")


@app.get("/api/queue")
async def get_queue():
    items = queue_manager.get_queue()
    return items

@app.delete("/api/queue/{item_id}")
async def delete_queue_item(item_id: int):
    queue_manager.delete_item(item_id)
    return {"success": True, "message": "Item deleted"}

@app.post("/api/queue/clear")
async def clear_queue():
    queue_manager.clear_queue()
    return {"success": True, "message": "Queue cleared"}

@app.post("/api/queue/run")
async def run_queue(background_tasks: BackgroundTasks):
    if RUNNING_FILE.exists():
        raise HTTPException(status_code=409, detail="Posterizarr is already running")

    background_tasks.add_task(run_queue_processor)
    return {"success": True, "message": "Queue execution started"}


if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
    logger.info(f"Mounted frontend from {FRONTEND_DIR}")


# SPA fallback - must be AFTER static files mount
# This catches all routes that don't match API endpoints or static files
# and returns index.html so React Router can handle the routing
@app.exception_handler(404)
async def spa_fallback(request: Request, exc: HTTPException):
    """
    Catch-all handler for SPA (Single Page Application) support.
    Returns index.html for any 404 that doesn't match an API endpoint,
    allowing React Router to handle client-side routing.
    """
    # Don't intercept API calls or WebSocket connections
    if request.url.path.startswith(("/api/", "/ws/")):
        raise exc

    # Return index.html for all other 404s (client-side routes)
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)

    # If index.html doesn't exist, return the original 404
    raise exc

class RunQueueRequest(BaseModel):
    item_ids: Optional[List[int]] = None

class DeleteQueueRequest(BaseModel):
    item_ids: List[int]

async def run_queue_processor(item_ids: Optional[List[int]] = None):
    """
    Background task to process the queue sequentially.
    """
    logger.info("Starting Queue Processor")

    # helper check
    if RUNNING_FILE.exists():
        logger.warning("Posterizarr is running. Aborting queue start.")
        return

    if item_ids:
        logger.info(f"Queue Processor: Processing selected items: {item_ids}")
        items = queue_manager.get_items_by_ids(item_ids)
    else:
        items = queue_manager.get_pending_items()

    logger.info(f"Queue Processor: Found {len(items)} pending items.")

    for item in items:
        # Check running file before each item to be safe/responsive to external stops
        if RUNNING_FILE.exists():
             logger.warning("Queue Processor: execution paused/stopped because RUNNING_FILE appeared.")
             break

        item_id = item["id"]
        logger.info(f"Queue Processor: Processing item #{item_id} ({item['asset_path']})")

        queue_manager.update_status(item_id, "processing")

        try:
            content = b""
            if item["source_type"] == "url":
                async with httpx.AsyncClient() as client:
                    resp = await client.get(item["source_data"])
                    if resp.status_code != 200:
                        raise Exception(f"Failed to download URL: {resp.status_code}")
                    content = resp.content
            elif item["source_type"] == "upload":
                # Staged file
                staged_path = Path(item["source_data"])
                if not staged_path.exists():
                    raise Exception(f"Staged file not found: {staged_path}")
                with open(staged_path, "rb") as f:
                    content = f.read()

            # Execute
            await finalize_asset_replacement(
                asset_path=item["asset_path"],
                file_content=content,
                process_with_overlays=item["overlay_params"].get("process_with_overlays", False),
                overlay_params=item["overlay_params"]
            )

            queue_manager.update_status(item_id, "completed")

            # Cleanup staged file if upload
            if item["source_type"] == "upload":
                try:
                    Path(item["source_data"]).unlink(missing_ok=True)
                except: pass

        except Exception as e:
            logger.error(f"Queue Processor: Failed item #{item_id}: {e}")
            queue_manager.update_status(item_id, "failed", str(e))

    logger.info("Queue Processor: Batch finished.")


@app.get("/api/queue")
async def get_queue():
    items = queue_manager.get_queue()
    return items

@app.delete("/api/queue/{item_id}")
async def delete_queue_item(item_id: int):
    queue_manager.delete_item(item_id)
    return {"success": True, "message": "Item deleted"}

@app.post("/api/queue/delete")
async def delete_queue_items(request: DeleteQueueRequest):
    queue_manager.delete_items(request.item_ids)
    return {"success": True, "message": f"Deleted {len(request.item_ids)} items"}

@app.post("/api/queue/clear")
async def clear_queue():
    queue_manager.clear_queue()
    return {"success": True, "message": "Queue cleared"}

@app.post("/api/queue/run")
async def run_queue(background_tasks: BackgroundTasks, request: Optional[RunQueueRequest] = None):
    if RUNNING_FILE.exists():
        raise HTTPException(status_code=409, detail="Posterizarr is already running")

    item_ids = request.item_ids if request else None
    background_tasks.add_task(run_queue_processor, item_ids)
    return {"success": True, "message": "Queue execution started"}


if __name__ == "__main__":
    import uvicorn
    DEFAULT_HOST = "0.0.0.0" if IS_DOCKER else "127.0.0.1"
    APP_HOST = os.environ.get("APP_HOST", DEFAULT_HOST)

    uvicorn.run(
        app,
        host=APP_HOST,
        port=port,
        log_level="info"
    )  # nosec B104