# Backend Python Architecture & Documentation

This document provides a technical overview of the Python backend files used in Posterizarr's WebUI. The backend is built using FastAPI and serves as the intermediary between the React frontend and the underlying PowerShell scripts or local databases.

---

## Architecture Overview

The backend handles the following core responsibilities:

1. **API Endpoints**: Serves data to the frontend (FastAPI).
2. **Configuration Management**: Reads, writes, and maps the `config.json` file.
3. **Database Operations**: Manages SQLite databases for runtime statistics, exported media, and caching.
4. **Task Orchestration**: Triggers PowerShell scripts via a queue manager or scheduler.

---

## File Breakdown (`webui\backend\`)

### Core API & Application

- **`main.py`**: The primary FastAPI application entry point. It defines all the API routes, initializes the server, handles CORS, and integrates with other backend modules.
- **`auth_middleware.py`**: Handles authentication and security middleware for the FastAPI routes, ensuring that unauthorized users cannot trigger operations or read configurations (includes strict API Key requirements for webhooks).

### Configuration & Data Mapping

- **`config_database.py`**: Interacts with the backend database storing configuration states.
- **`config_mapper.py`**: A crucial file that maps frontend JSON/API payloads to the expected `config.json` format required by the PowerShell scripts. It ensures data sanitization and type casting.
- **`config_tooltips.py`**: Stores the tooltip descriptions and metadata for configuration fields, served dynamically to the frontend `ConfigEditor`.
- **`defaults.py`**: Contains default settings, schemas, and fallback configurations for the application.

### Databases & State

- **`database.py`**: The core SQLAlchemy/SQLite configuration file that establishes connections and base models.
- **`media_export_database.py`**: Manages the database schema and operations for media exported from Plex/Jellyfin/Emby.
- **`runtime_database.py`**: Manages the schema for runtime statistics (successes, failures, durations).
- **`server_libraries_database.py`**: Caches the library configurations of connected media servers.

### Task Management & Scheduling

- **`queue_manager.py`**: Manages the execution queue for PowerShell scripts, ensuring that multiple operations (like manual generation vs library sync) don't conflict or overlap destructively.
- **`scheduler.py`**: Handles cron-like scheduling for automated tasks (e.g., triggering `Posterizarr.ps1` at set intervals).
- **`runtime_parser.py`**: Parses the output of the PowerShell scripts to update the `runtime_database.py` with execution statistics.

### Utilities & Helpers

- **`logs_watcher.py`**: A dual-purpose background watcher that monitors Posterizarr log files in real-time (allowing the frontend to stream logs via WebSockets) and tracks newly appended entries in `Logs/ImageChoices.csv` to broadcast real-time `asset_updated` WebSocket events to media server plugins (Jellyfin/Emby) without requiring polling or filesystem hooks on the assets folder.
- **`plex_push_service.py`**: Lightweight, standalone Plex push and synchronization service. Provides collection matching and normalization (`[boxset]`, `&`/`and`, trailing keywords), visual diff state calculations (`synced`, `update_available`, `missing_server`, `missing_local`), thread-safe SQLite change caching (`database/plex_push_cache.db`), single/batch REST poster uploads to Plex Media Server, and scheduled background sync execution for selected libraries and asset types without invoking PowerShell.
- **`improve_logging.py`**: Enhances standard Python logging for the backend application.
- **`overlay_generator.py`**: A backend helper script used for generating quick preview overlays for the UI without invoking the full PowerShell stack.
- **`studio_logos.py`**: Handles studio, network, and production company logo resolution, local caching, and transparent PNG delivery for collection designs and media badges.
- **`migrate_runtime_data.py`**: A migration script used to upgrade database schemas or runtime data formats between versions.

### Security Utilities (`main.py`)

- **`is_safe_url(url, allow_private, allow_apprise_schemes)`**: Validates URL schemes (`http`/`https` or custom Apprise schemes) and resolves DNS hostnames to ensure loopback (`127.0.0.1`, `localhost`, `::1`) and private/link-local/multicast IP addresses are strictly blocked against SSRF attacks (unless private network access is explicitly authorized for configured media servers).
- **`get_safe_path(base_dir, user_path)`**: Enforces strict directory containment, preventing path traversal attacks when resolving user-specified asset files or collection presets.
- **`sanitize_command_arg(arg)`**: Cleans command line arguments passed to PowerShell, stripping null bytes and non-printable control characters, and disallowing unintended flag injections.
- **`mask_secret(secret)`**: Redacts sensitive strings (API keys, tokens, passwords) before writing to server logs.

---

## Contribution Guidelines
When making a Pull Request to the Python backend:

- **New Endpoints**: Define routes in `main.py` (or a dedicated router file if it grows) and ensure they are protected by `auth_middleware.py` or appropriate security decorators.
- **Database Schema Changes**: Ensure you provide a migration strategy or update `migrate_runtime_data.py` so existing users do not lose their data.
- **Configuration Parsing**: If a new feature introduces a new `config.json` field, update `config_mapper.py` and provide a tooltip in `config_tooltips.py`.
- **Security Protections**: When proxying remote URLs or writing local files, always apply `is_safe_url` and `get_safe_path`.
