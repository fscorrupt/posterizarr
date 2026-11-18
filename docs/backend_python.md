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
- **`support_bundle.py`**: Builds the diagnostic ZIP requested by `POST /api/admin/support-zip`, independently of application startup tasks.
- **`animetafill_service.py`**: Integration service bridging AniMetaFill into Posterizarr's backend. Coordinates anime canon/filler classification tasks, library scans, and triggers overlay generation.
- **`animetafill_core/`**: Core engine for anime episode classification:
  - **`classifier.py`**: Evaluates episode data against SIMKL and AnimeFillerList providers.
  - **`database.py`**: Local SQLite cache for anime episode classifications and sync states.
  - **`media_scanner.py`**: Scans Plex, Jellyfin, and Emby servers for configured anime libraries.
  - **`overlay_yaml.py`** (`OverlayYamlGenerator`): Generates and parses unified episode overlay YAML files (`anime_overlays.yml`).
  - **`sonarr_client.py`**: Maps absolute episode numbers to season/episode numbers via Sonarr.

### Security Utilities (`main.py`)

- **`is_safe_url(url, allow_private, allow_apprise_schemes)`**: Validates URL schemes (`http`/`https` or custom Apprise schemes) and resolves DNS hostnames to ensure loopback (`127.0.0.1`, `localhost`, `::1`) and private/link-local/multicast IP addresses are strictly blocked against SSRF attacks (unless private network access is explicitly authorized for configured media servers).
- **`get_safe_path(base_dir, user_path)`**: Enforces strict directory containment, preventing path traversal attacks when resolving user-specified asset files or collection presets.
- **`sanitize_command_arg(arg)`**: Cleans command line arguments passed to PowerShell, stripping null bytes and non-printable control characters, and disallowing unintended flag injections.
- **`mask_secret(secret)`**: Redacts sensitive strings (API keys, tokens, passwords) before writing to server logs.

---

## Log Retention

Service diagnostics and per-item progress are not mirrored into `BackendServer.log`
or `FrontendUI.log`. Ratings/provider refresh details stay in `RatingsRefresh.log`,
overlay synchronization in `DynamicOverlaysSync.log`, and episode-title comparison
and recreation in `EpisodeTitleChanges.log`. Plex Sync, image cleanup, AniMetaFill,
and overlay-default updates retain their own service logs. Scheduler orchestration
is recorded in `Scheduler.log`. These logs are available separately in the log viewer;
general backend/API and browser diagnostics retain their existing UI log targets.

Backend/container startup does not delete or truncate logs. In Docker, `UILogs` lives under the persistent `/config` volume. `BackendServer.log` and `FrontendUI.log` append across restarts because they record continuous server activity rather than individual jobs.

These two continuous logs rotate at approximately 10 MiB per active file and
retain three numbered backups (`.log.1` through `.log.3`). Backend and browser
entries in `FrontendUI.log` share the same thread-safe handler, including the
single and batch UI-log endpoints. Individual formatted records are limited to
32,768 characters with a truncation marker, so one large UI payload cannot grow
the active log without bound. An already oversized log rotates on the next
write; its full previous contents are initially retained in the first backup
until normal backup rotation ages it out. No blanket startup cleanup is used.
`EpisodeTitleChanges.log` and `Scheduler.log` use the same bounded continuous-log
rotation rather than being reset by background scans.

When a Python job actually starts, its previous active log is renamed to `Name.old.log` and the new run writes a fresh `Name.log`. One previous run is retained; the next rotation replaces that backup. This applies to Plex Sync, Dynamic Overlays Sync, Overlay Defaults, Ratings Refresh, AniMetaFill, and Plex Image Cleanup. Rejected/busy jobs do not rotate logs. If rotation fails, the existing log is retained and new output is appended rather than discarded. The `.old.log` files remain available in the log viewer.

PowerShell runs keep their existing timestamped archive behavior under `RotatedLogs`; backend startup does not clear those archives.

## Support Bundles

The Generate Support Logs action includes application/UI logs, selected change-detection JSON reports, scheduler and application configuration, Dynamic Overlays/AniMetaFill JSON settings, active overlay YAML files, and default templates. Legacy JSON locations and the older `Overlayfiles/kometa` directory are supported.

Database exports include `media_export.db`, `runtime_stats.db`, `server_libraries.db`, `imagechoices.db`, `overlay_cache.db`, `animetafill.db`, and `plex_push_cache.db` when present. SQLite's backup API captures a consistent committed snapshot, including WAL-backed updates, without changing the source database. Overlay layer snapshots remain available for recipe-drift diagnosis.

JSON/YAML settings and database text are sanitized before packaging. Credentials, supported notification URLs, and local addresses are masked. Sanitized databases are compacted to remove old values from unused pages. If a selected file cannot be parsed, backed up, or sanitized, the export fails rather than returning an unsanitized archive. Failed exports remove their temporary staging directory; successful downloads retain the existing background cleanup.

Artwork, fonts, quarantine contents, links/junctions, SQLite sidecar files, and compressed log archives are not included. Support bundles still contain diagnostic library titles and paths; review the ZIP before sharing it publicly.

## Contribution Guidelines
When making a Pull Request to the Python backend:

- **New Endpoints**: Define routes in `main.py` (or a dedicated router file if it grows) and ensure they are protected by `auth_middleware.py` or appropriate security decorators.
- **Database Schema Changes**: Ensure you provide a migration strategy or update `migrate_runtime_data.py` so existing users do not lose their data.
- **Configuration Parsing**: If a new feature introduces a new `config.json` field, update `config_mapper.py` and provide a tooltip in `config_tooltips.py`.
- **Security Protections**: When proxying remote URLs or writing local files, always apply `is_safe_url` and `get_safe_path`.
