# Posterizarr - LLM Project & Architecture Guide
> **Purpose**: This file provides immediate, structured, high-density context for Large Language Models (LLMs) and AI coding agents. Read this file first to understand the codebase architecture, key components, configuration schemas, execution modes, databases, rendering engines, API endpoints, and critical conventions without scanning the entire repository.

---

## 1. Project Overview & Mission

**Posterizarr** is an automated artwork processing, overlay generation, and metadata synchronization engine for personal media servers (**Plex**, **Jellyfin**, and **Emby**).

### Primary Capabilities:
1. **Multi-Provider Artwork Scraping**: Queries metadata providers (**TMDB**, **TVDB**, **Fanart.tv**, and local media servers, with IMDb fallback) using configurable language sequences and priority strategies.
2. **Dynamic Overlay & Badge Compositing**: Uses **ImageMagick 7** to dynamically composite overlays (borders, inner glow, gradient fades, resolution banners like 4K/1080p, HDR/Dolby Vision flags, audio codec badges, source watermarks, and custom typography) onto posters, season posters, backgrounds, and title cards.
3. **Textless Detection & ClearLogo Compositing**: Automatically detects textless artwork, scrapes transparent clearlogos/clearart from TVDB, TMDB, or Fanart, converts colors if requested (monochrome silhouettes), and falls back gracefully to formatted typography.
4. **Direct Media Server Synchronization**: Uploads processed artwork directly to Plex, Jellyfin, or Emby via REST APIs. Embeds EXIF metadata/hashes to prevent redundant reprocessing.
5. **Interactive Live Collection Designer**: Offers a real-time canvas editor in the Web UI for designing collection posters with customizable linear/radial gradients, vignettes, matte masks, film grain textures, typography alignments, drop shadows, and preset thumbnail capture.
6. **Web UI & Management Dashboard**: Modern single-page React application with real-time dashboards, asset overview tables, manual image choice pickers (Asset Replacer), clearlogo browsers, logs viewer (WebSocket streaming), and background queue runners.
7. **Arr & Companion Integrations**: Webhook handlers and trigger scripts for Radarr, Sonarr, and Tautulli, automated callbacks for **Agregarr**, Kometa (Plex Meta Manager) folder alignment, native C# media server plugins, Uptime Kuma monitoring, and Discord rich embeds.

---

## 2. Technology Stack & Components Matrix

| Component | Technology | Primary Location | Key Responsibilities |
| :--- | :--- | :--- | :--- |
| **Automation Core** | PowerShell 7+ (`pwsh`) | `Posterizarr.ps1`, `modules/` | Scrapes APIs, prepares images, constructs ImageMagick commands, handles parallel runspaces, uploads to media servers, manages backups. |
| **Web UI Backend** | Python 3.13 + FastAPI + Uvicorn | `webui/backend/` | Serves REST API and WebSockets, manages SQLite DBs, coordinates background runs, enforces SSRF protections, handles image proxies. |
| **Web UI Frontend** | React 18 + Vite + Tailwind CSS | `webui/frontend/` | Single-page application: Dashboard, Asset Overview, Live Collection Editor, Settings Editor, Logs, Queue Manager, Onboarding Wizard. |
| **Image Processing** | ImageMagick 7 (`magick`) + Pillow | Alpine packages / `Overlayfiles/` | Compositing overlays, badge positioning, typography rendering, color extraction, textless detection, and UI preview rendering. |
| **Databases** | SQLite3 | `database/*.db` | Six specialized databases: `imagechoices.db`, `config.db`, `queue.db`, `server_libraries.db`, `media_export.db`, `runtime_history.db`. |
| **Containerization** | Docker (Alpine 3.24) | `Dockerfile`, `Start.ps1`, `start.sh` | Multi-stage build with multi-process orchestration (`uvicorn` backend daemon + `pwsh Start.ps1` scheduler/worker). |
| **Media Server Plugins** | C# (.NET 8/9/10) | `modules/Posterizarr.Plugin*/` | Native plugins for Jellyfin (10.11.x on .NET 9, 12.0.x on .NET 10) and Emby (on .NET 8) providing automated event notifications and metadata sync. |

---

## 3. Directory Layout & Codebase Map

```text
PosterizarrUI_dev/
├── Posterizarr.ps1             # Main PowerShell CLI entrypoint for standalone runs & execution modes
├── Start.ps1                  # Container entrypoint script (manages scheduling loop, CheckJson validation)
├── start.sh                   # Alpine shell bootstrap (spawns uvicorn in background, then Start.ps1)
├── Dockerfile                 # Multi-stage Docker build (Node 20 frontend -> Python 3.13 Alpine runtime)
├── config.example.json        # Authoritative master template for all configuration sections and default values
├── Overlayfiles/              # Stock overlay PNGs (inner glow, 4k/HDR badges), fonts (.ttf, .otf), and assets
│
├── modules/                   # Core PowerShell automation modules
│   ├── ArrTrigger.sh          # Shell script for Sonarr/Radarr Custom Script import triggers
│   ├── trigger.py             # Python script for Tautulli notification agent triggers
│   ├── Posterizarr.Plugin/    # In-tree C# plugin for Jellyfin
│   ├── Posterizarr.Plugin.Emby/ # In-tree C# plugin for Emby
│   ├── core/
│   │   ├── Variables.ps1      # Global variables, branch detection, config loader, path standardization
│   │   └── PrerequisitesCheck.ps1 # Directory validation, tool check (ImageMagick, pwsh), font validation
│   ├── functions/
│   │   ├── ApiHandlers.ps1    # TMDB, TVDB, Fanart, Plex, Jellyfin, Emby API requests & URL builders
│   │   ├── AssetCache.ps1     # Fast .NET EnumerateFiles recursive indexing and hashing
│   │   ├── AssetReset.ps1     # Reset media server assets to default scraped metadata
│   │   ├── AssetUpload.ps1    # Direct artwork pushing to Plex, Jellyfin, and Emby with EXIF tagging
│   │   ├── BackupRestore.ps1  # Mass download and targeted restore of media server artwork
│   │   ├── CoreGeneration.ps1 # Master ImageMagick composition pipelines for posters, seasons, title cards
│   │   ├── ImageMagick.ps1    # ImageMagick CLI wrappers, point size calculators, text size cache
│   │   ├── JellyEmby.ps1      # Jellyfin and Emby connection validators and API helpers
│   │   ├── Notifications.ps1  # Discord, Apprise, Uptime Kuma, and Agregarr callback dispatchers
│   │   ├── Plex.ps1           # Plex connection check, library enumeration, and EXIF extraction
│   │   ├── Sync.ps1           # Cross-server artwork synchronization (Plex -> Jellyfin/Emby)
│   │   └── System.ps1         # Path security, CheckJson schema validator, log rotation, secret masking
│   └── modes/
│       ├── NormalMode.ps1     # Default mode: iterates all configured libraries sequentially/in parallel
│       ├── ArrMode.ps1        # Single-item processing triggered by Radarr/Sonarr or webhooks
│       ├── TautulliMode.ps1   # Single-item processing triggered by Tautulli 'Recently Added' events
│       ├── ManualMode.ps1     # Interactive or semi-automated processing of user-specified media
│       ├── BackupMode.ps1     # Downloads existing media server artwork to /assetsbackup
│       ├── RestoreMode.ps1    # Restores backed-up artwork directly to media servers
│       ├── SyncMode.ps1       # Synchronizes artwork across media servers (Plex -> Jellyfin/Emby)
│       ├── PosterresetMode.ps1 # Resets library posters to default scraped metadata
│       ├── LogoUpdaterMode.ps1 # Scans, uploads, or reverts ClearLogos across libraries
│       ├── EmbyJellyMode.ps1  # Optimized library processing loop for Jellyfin/Emby servers
│       └── TestingMode.ps1    # Generates pink test posters/backgrounds in ./test for style validation
│
├── webui/
│   ├── backend/               # FastAPI backend application
│   │   ├── main.py            # Primary REST API routes, WebSocket endpoints, image proxies, SSRF filters
│   │   ├── auth_middleware.py # Basic Auth, API Key validation for webhooks, session handling
│   │   ├── config_database.py # SQLite CRUD operations for WebUI configuration
│   │   ├── config_mapper.py   # Bidirectional mapper between frontend payloads and config.json
│   │   ├── config_tooltips.py # Field-by-field tooltips and descriptions for ConfigEditor
│   │   ├── database.py        # SQLAlchemy engine initialization and base models
│   │   ├── defaults.py        # Default schemas, fallback configurations, and setup helpers
│   │   ├── logs_watcher.py    # Tail watcher streaming log lines over WebSockets
│   │   ├── media_export_database.py # Database operations for exported Plex/Jellyfin/Emby media
│   │   ├── overlay_generator.py # Python/Pillow overlay generator for real-time collection previews
│   │   ├── queue_manager.py   # SQLite-backed background job queue and execution state tracker
│   │   ├── runtime_database.py # Execution statistics, duration, and success/failure metric tracking
│   │   ├── runtime_parser.py  # PowerShell stdout/log parser that feeds runtime statistics
│   │   ├── scheduler.py       # Cron / interval scheduling engine for automated Posterizarr runs
│   │   ├── server_libraries_database.py # Caching layer for media server library structures
│   │   ├── studio_logos.py    # Scraper, local cache, and delivery engine for production company logos
│   │   └── migrate_runtime_data.py # Database migration utility for upgrading schemas between versions
│   └── frontend/              # Vite + React 18 single-page application
│       ├── src/
│       │   ├── App.jsx        # Root routing table, theme provider, and top-level modals
│       │   ├── index.css      # Tailwind CSS directives and custom UI animations
│       │   ├── components/    # 50+ React components (Dashboard, AssetOverview, CollectionLiveEditor, etc.)
│       │   ├── context/       # AuthContext, ThemeContext, SidebarContext, ToastContext, DashboardLoadingContext
│       │   ├── locales/       # Translation dictionaries (en, de, fr, es, etc.)
│       │   └── utils/         # fetchInterceptor.js (auth & headers), uiLogger.js
│       └── package.json
│
└── docs/                      # Complete MkDocs documentation suite
```

---

## 4. Runtime & Container Lifecycle

### Docker Architecture:
In Docker (`IS_DOCKER = True`), paths and permissions follow a strict container layout:
- `/config` (`$env:APP_DATA`): Writable volume containing `config.json`, `Logs/`, `RotatedLogs/`, `database/`, and cached assets.
- `/app` (`$env:APP_ROOT`): Read-only application root containing PowerShell modules, FastAPI backend, and precompiled frontend.
- `/assets`: Output directory where processed artwork is written (structured for Kometa compatibility).
- `/manualassets`: Custom images placed by users to override automated scrapers.
- `/assetsbackup`: Original unmodified artwork downloaded during backup runs.
- `/posterizarr/watcher`: Monitored directory for `.posterizarr` trigger files created by `ArrTrigger.sh`.

### Process Orchestration (`start.sh`):
1. Sets up system environment variables (`PYTHONUNBUFFERED=1`, `PWSH_TELEMETRY_OPTOUT=1`).
2. Creates necessary runtime directories under `/config`.
3. Spawns `uvicorn main:app --host 0.0.0.0 --port 8000` in the background.
4. Executes `pwsh /app/Start.ps1` in the foreground under `catatonit` to handle SIGINT/SIGTERM gracefully.

### Configuration Integrity (`CheckJson`):
Before any scheduled run or upon UI configuration save:
- `CheckJson` compares the active `config.json` against `config.example.json`.
- Missing keys are automatically populated with safe defaults.
- Obsolete keys that no longer exist in the template are scrubbed to prevent schema corruption.
- Branch detection ensures development containers (`$env:APP_VERSION -match 'dev'`) synchronize against the `dev` branch template.

### Bare-Metal Local Development:
- **Backend**: `uvicorn main:app --host 127.0.0.1 --port 8000 --reload` from `webui/backend/` (uses Python 3.13 venv).
- **Frontend**: `npm run dev` from `webui/frontend/` (Vite dev server on port 5173, proxies `/api` and `/ws` to port 8000).
- **PowerShell**: `pwsh ./Posterizarr.ps1 -dev` from the workspace root.

---

## 5. Execution Run Modes & CLI Reference

Posterizarr provides 11 distinct execution modes, selectable via CLI parameters or triggered via the Web UI:

```powershell
pwsh ./Posterizarr.ps1 [-ModeSwitch] [Parameters]
```

### 1. Normal Mode (`NormalMode.ps1`)
- **CLI**: `pwsh ./Posterizarr.ps1`
- **Docker**: `docker exec -it posterizarr pwsh /app/Posterizarr.ps1`
- **Description**: Default operational mode. Iterates through all non-excluded media server libraries, resolves artwork across TMDB/TVDB/Fanart/Media Server, renders overlays, and uploads to Plex/Jellyfin/Emby. Supports multi-threaded processing via `$global:ParallelJobs`.

### 2. Arr Mode (`ArrMode.ps1`)
- **CLI**: `pwsh ./Posterizarr.ps1 -ArrTrigger -ExtraArgs ...`
- **Trigger**: Invoked by Radarr/Sonarr via `ArrTrigger.sh` or the native webhook `/api/webhook/arr`.
- **Description**: Targeted single-item run. Reads the TMDB/TVDB ID or media folder passed by the Arr application and processes *only* that specific movie, show, or episode. Dispatches a follow-up callback to **Agregarr** if enabled.

### 3. Tautulli Mode (`TautulliMode.ps1`)
- **CLI**: `pwsh ./Posterizarr.ps1 -Tautulli -RatingKey "12345" -mediatype "movie"`
- **Trigger**: Invoked by Tautulli on 'Recently Added' notifications via `trigger.py` or `/api/webhook/tautulli`.
- **Description**: Targeted single-item run for Plex. Resolves the rating key, queries Plex metadata, and processes the newly added item immediately without a full library scan.

### 4. Manual Mode (`ManualMode.ps1`)
- **Interactive**: `pwsh ./Posterizarr.ps1 -Manual -MoviePosterCard` (prompts for paths, titles, libraries).
- **Semi-Automated**:
  - Movie Poster: `pwsh ./Posterizarr.ps1 -Manual -MoviePosterCard -PicturePath "..." -Titletext "The Martian" -FolderName "The Martian (2015)" -LibraryName "Movies"`
  - Show Poster: `pwsh ./Posterizarr.ps1 -Manual -ShowPosterCard -PicturePath "..." -Titletext "Loki" -FolderName "Loki (2021)" -LibraryName "TV Shows"`
  - Season Poster: `pwsh ./Posterizarr.ps1 -Manual -SeasonPoster -PicturePath "..." -Titletext "Loki" -SeasonPosterName "Season 1" -LibraryName "TV Shows"`
  - Title Card: `pwsh ./Posterizarr.ps1 -Manual -TitleCard -PicturePath "..." -EPTitleName "Glorious Purpose" -EpisodeNumber "1" -SeasonPosterName "Season 1"`
  - Collection Card: `pwsh ./Posterizarr.ps1 -Manual -CollectionCard -PicturePath "..." -Titletext "Star Wars Collection" -LibraryName "Movies"`
  - Background: `pwsh ./Posterizarr.ps1 -Manual -BackgroundCard -PicturePath "..." -Titletext "Dune" -LibraryName "Movies"`

### 5. Backup Mode (`BackupMode.ps1`)
- **CLI**: `pwsh ./Posterizarr.ps1 -Backup`
- **Description**: Iterates through all connected media server libraries and downloads existing artwork to `/assetsbackup`. Retains original images and extracts embedded EXIF metadata.

### 6. Restore Mode (`RestoreMode.ps1`)
- **CLI (Full)**: `pwsh ./Posterizarr.ps1 -Restore` *(Restores all assets across all libraries)*
- **Targeted Restore**:
  - `-RestoreLibrary "Movies"`: Restricts restore to a specific media library.
  - `-RestoreItem "Alien (1979)"`: Targets a single item by title, original title, or folder name.
  - `-RestoreType "poster"`: Restricts restoration to specific asset types (`poster`, `background`, `season`, `episode`, `titlecard`).
  - Example: `pwsh ./Posterizarr.ps1 -Restore -RestoreLibrary "Movies" -RestoreType "poster"`

### 7. Sync Mode (`SyncMode.ps1`)
- **CLI**: `pwsh ./Posterizarr.ps1 -SyncJelly` or `pwsh ./Posterizarr.ps1 -SyncEmby`
- **Description**: Cross-server artwork mirroring. Compares image hashes between Plex and Jellyfin or Emby, copying missing or updated artwork to ensure identical visual presentation across ecosystems.

### 8. Poster Reset Mode (`PosterresetMode.ps1`)
- **CLI**: `pwsh ./Posterizarr.ps1 -PosterReset -LibraryToReset "Movies"`
- **Description**: Removes custom uploaded posters in the specified Plex library and resets items to Plex's default scraped artwork.

### 9. Logo Updater Mode (`LogoUpdaterMode.ps1`)
- **Update**: `pwsh ./Posterizarr.ps1 -LogoUpdater -LibraryName "Movies" [-ForceReplace]`
- **Revert**: `pwsh ./Posterizarr.ps1 -LogoRevert -LibraryName "Movies"`
- **Description**: Dedicated ClearLogo manager. Scans libraries, downloads transparent logos from TMDB/TVDB/Fanart, and uploads them to media servers. In Revert mode, checks embedded EXIF fingerprints to safely remove only Posterizarr-added logos without touching manual user uploads.

### 10. Emby / Jellyfin Mode (`EmbyJellyMode.ps1`)
- **Trigger**: Automatic fallback when `UseOtherMediaServer = "true"` and Plex is disabled.
- **Description**: Execution pipeline optimized specifically for Jellyfin and Emby API structures, handling item IDs, backdrop replacements, and user-library configurations.

### 11. Testing Mode (`TestingMode.ps1`)
- **CLI**: `pwsh ./Posterizarr.ps1 -Testing`
- **Description**: Safe offline generation test. Generates pink test posters, backgrounds, and title cards under `./test` with short, medium, and long strings in standard and all-caps typography to verify bounding boxes and borders.

### Support Diagnostic Mode (`-GatherLogs`)
- **CLI**: `pwsh ./Posterizarr.ps1 -GatherLogs`
- **Description**: Collects active logs, rotated logs, and SQLite databases into a sanitized zip bundle (`posterizarr_support_<timestamp>.zip`), masking all API keys, tokens, and private hostnames for safe public sharing.

---

## 6. Database Architecture & Schema Specifications

Posterizarr maintains six dedicated SQLite3 databases located in `database/` (`/config/database/` in Docker):

```text
database/
├── config.db              # Web UI settings, authentication, scheduler state, and onboarding
├── imagechoices.db        # Artwork metadata, chosen provider URLs, fallback tags, Action Center items
├── queue.db               # Background job execution queue and task statuses
├── server_libraries.db    # Media server library caches (Plex/Jellyfin/Emby section IDs)
├── media_export.db        # Media library exports and item metadata
└── runtime_history.db     # Historical run metrics, processing durations, and asset counts
```

### Key Schema Responsibilities:
1. **`imagechoices.db`**:
   - Tracks every processed item, selected artwork URL, asset type (`Poster`, `Background`, `Season`, `TitleCard`), provider used (`TMDB`, `TVDB`, `Fanart`, `Plex`), and whether it was a fallback.
   - Powers the **Action Center** (`/api/assets/asset-overview`), enabling users to filter by "Missing Assets", "Non-Primary Provider", or "Truncated Text", and replace artwork directly.
2. **`queue.db`**:
   - Manages asynchronous background runs (`Pending`, `Running`, `Completed`, `Failed`).
   - Prevents concurrent script conflicts by staging execution requests and tracking PID and execution timestamps.
3. **`config.db`**:
   - Stores WebUI persistent state, basic auth hashes, scheduler cron expressions, and the `onboarding_completed` flag.
4. **`server_libraries.db`**:
   - Caches library names, types (`movie`, `show`), server UUIDs, and section keys from Plex, Jellyfin, and Emby to minimize external API roundtrips.
5. **`runtime_history.db`**:
   - Records execution history, run modes, worker counts, total assets created, processing durations, and error logs for display in `RuntimeHistory.jsx`.

---

## 7. ImageMagick Composition & Rendering Pipeline

Posterizarr leverages **ImageMagick 7** (`magick`) for compositing operations:

### Standard Dimensions & Resolutions:
- **Posters**: `2000 x 3000` px (Aspect ratio 1:1.5)
- **Backgrounds**: `3840 x 2160` px (4K UHD 16:9)
- **Episode Title Cards**: `3840 x 2160` px (4K UHD 16:9)

### Composition Pipeline Flow (`CoreGeneration.ps1`):
1. **Source Acquisition**: Download raw image from prioritized provider or locate local manual asset.
2. **Dimension Normalization**: Resize and crop to exact dimensions (`-resize 2000x3000^ -gravity center -extent 2000x3000`).
3. **Overlay & Border Layering**:
   - Border overlay (`borderwidth`, `bordercolor`) applied via `-shave` or composition.
   - Inner glow / gradient overlay (`overlayfile`, `seasonoverlayfile`, `backgroundoverlayfile`, `titlecardoverlayfile`) composited with transparency.
   - Resolution banners (4K, 1080p, 720p) and HDR flags (4K HDR10, Dolby Vision, DoVi+HDR10) layered conditionally based on media stream info.
4. **ClearLogo & ClearArt Processing**:
   - If `UseClearlogo` or `UseClearart` is enabled, scrapes transparent PNG logo.
   - If `ConvertLogoColor` is enabled, transforms logo into a monochrome silhouette matching `LogoFlatColor` (default: `"white"`).
   - If no logo is found and `LogoTextFallback` is true, falls back to typography rendering.
5. **Typography & Text Formatting**:
   - Dynamic Point Size: Uses `Get-OptimalPointSize` in a binary search loop to calculate the exact maximum font size that fits the bounding box (`MaxWidth` x `MaxHeight`).
   - Font Caching: Caches font size computations in memory to eliminate redundant ImageMagick probes for repeated title structures.
   - RTL Support: Renders right-to-left scripts using dedicated `RTLfont`.
   - Hyphenation & Newlines: Automatically breaks long strings using `NewLineSymbols` (e.g. ` - `, `:`) and `NewLineWords` (e.g. forced hyphenation rules).
   - Text Gravity & Stroke: Aligns text (`TextGravity`, default: `south`), applies outline stroke (`strokewidth`, `strokecolor`), and applies offset (`text_offset`).
6. **EXIF Tagging**: Writes custom metadata into the image EXIF tags (identifying Posterizarr version, provider, and media ID) to allow instant hash-validation and prevent redundant uploads.

---

## 8. Live Collection Canvas & Editor Architecture

The **Collection Live Editor** (`CollectionLiveEditor.jsx`) provides a real-time visual canvas studio for creating collection posters:

### Visual Controls & Rendering Features:
- **Gradient Engine**: Linear and radial gradients with customizable angle, opacity, color stops, and blend modes.
- **Matte & Vignette**: Top and bottom matte masks with smooth fades and configurable vignette strength.
- **Texture & Grain**: Tiled film grain effect with variable intensity to add depth.
- **Borders & Corners**: Configurable border width, border color, and rounded border radius.
- **Typography & Shadows**: Main collection title and subtext controls with point sizes, letter spacing, font families, alignments, and multi-layer drop shadows (blur, distance, opacity, color).
- **Logo Integration**: Direct upload or provider search for collection clearlogos with color tinting and sizing.
- **Preset Management**: Built-in styling blueprints with real-time thumbnail capture and saving.
- **Direct Upload**: Renders final 2000x3000 image client-side and uploads directly to the media server via backend proxy.

---

## 9. WebUI Frontend Architecture

The frontend is a React 18 single-page application built with Vite and Tailwind CSS.

### Routing Table (`App.jsx`):
- `/`: Dashboard (`Dashboard.jsx`)
- `/run-modes`: Run Modes (`RunModes.jsx`)
- `/queue`: Task Queue Viewer (`QueueView.jsx`)
- `/scheduler`: Cron Scheduler (`SchedulerSettings.jsx`)
- `/assets-manager`: Assets Manager (`AssetsManager.jsx`)
- `/manual-assets`: Manual Assets Tree (`ManualAssets.jsx`, `FolderView.jsx`)
- `/asset-backups`: Backup Gallery (`GalleryHub.jsx`, `BackupAssets.jsx`)
- `/asset-overview`: Action Center & Issue Review (`AssetOverview.jsx`, `AssetReplacer.jsx`)
- `/runtime-history`: Run History & Statistics (`RuntimeHistory.jsx`, `RuntimeStats.jsx`)
- `/media-server-export/plex`: Plex Export View (`PlexExport.jsx`)
- `/media-server-export/jellyfin-emby`: Jellyfin/Emby Export View (`JellyfinEmbyExport.jsx`)
- `/media-server-logos`: ClearLogo Browser (`LogoBrowser.jsx`, `AssetSearchModal.jsx`)
- `/media-server-collections`: Collection Explorer & Live Editor (`CollectionExplorer.jsx`, `CollectionLiveEditor.jsx`)
- `/gallery/*`: Artwork Galleries (`GalleryHub.jsx` for posters, backgrounds, seasons, title cards)
- `/test-gallery`: Offline Test Preview Gallery (`TestGallery.jsx`)
- `/blueprints`: Styling Blueprints & Recipes (`Blueprints.jsx`)
- `/config/*`: Tabbed Configuration Editor (`ConfigEditor.jsx` for System, Providers, Media Servers, Visuals, Posters, Seasons, Backgrounds, Title Cards, Collections)
- `/logs`: Real-Time WebSocket Log Streamer (`LogViewer.jsx`)
- `/how-it-works`: System Concept & Guide (`HowItWorks.jsx`)
- `/auto-triggers`: Webhook & Automation Settings (`AutoTriggers.jsx`)
- `/about`: System Info & Dependencies (`About.jsx`)

### React Context Providers:
- **`AuthProvider`**: Manages session state, basic authentication credentials, and API tokens.
- **`ThemeProvider`**: Manages dark/light theme switching with CSS variables.
- **`SidebarProvider`**: Controls responsive expansion and collapse of the navigation sidebar.
- **`ToastProvider`**: Fires global non-blocking alert toasts throughout the UI.
- **`DashboardLoadingProvider`**: Coordinates data prefetching and smooth transitions between startup and dashboard views.

---

## 10. Backend Python Architecture & REST API Reference

The backend (`webui/backend/main.py`) provides over 170 REST and WebSocket endpoints.

### Security Utilities & SSRF Protections:
- **`is_safe_url(url, allow_private, allow_apprise_schemes)`**: Strictly validates URL schemes and resolves DNS hostnames. By default, blocks loopback (`127.0.0.1`, `localhost`, `::1`), private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local, and multicast addresses to prevent SSRF vulnerabilities.
- **`get_safe_path(base_dir, user_path)`**: Prevents directory traversal attacks by validating that resolved paths remain strictly within `base_dir`.
- **`sanitize_command_arg(arg)`**: Cleans CLI parameters passed to PowerShell, stripping control characters and preventing flag injection.
- **`mask_secret(secret)`**: Redacts passwords, tokens, and keys in logs.

### Key API Endpoint Groups:
1. **System & Health**:
   - `GET /api`: Health check.
   - `GET /api/system-info`: Hardware, memory, CPU, and Docker status.
   - `GET /api/version`: Local vs remote version comparison.
   - `GET /api/releases`: GitHub changelog notes.
2. **Configuration**:
   - `GET /api/config`: Fetches complete configuration (supports categorized and flat views).
   - `POST /api/config`: Saves updated configuration after validation.
   - `GET /api/config/tooltips`: Returns field descriptions and schema documentation.
   - `POST /api/config/validate`: Executes `CheckJson` against template.
3. **Execution & Queue**:
   - `GET /api/status`: Current script execution state and PID.
   - `POST /api/run`: Triggers standard Posterizarr run.
   - `POST /api/run/mode`: Triggers a specific run mode with custom parameters.
   - `POST /api/run/abort`: Gracefully cancels running process.
   - `GET /api/queue`: Lists pending, active, and completed jobs.
   - `DELETE /api/queue/{task_id}`: Removes or cancels queued task.
4. **Assets & Action Center**:
   - `GET /api/assets/asset-overview`: Fetches Action Center items (missing assets, fallbacks, truncated text).
   - `POST /api/assets/replace`: Replaces an asset with a user-selected image from TMDB/TVDB/Fanart.
   - `POST /api/assets/resolve`: Marks an Action Center item as resolved.
   - `GET /api/recent-assets`: Fetches recently created posters with resolution and path metadata.
5. **Logos & Collections**:
   - `GET /api/media-server/logos`: Queries media server items for clearlogo presence.
   - `POST /api/media-server/upload-logo`: Pushes a selected clearlogo directly to media server.
   - `GET /api/media-server/collections`: Enumerates collections across media servers.
   - `POST /api/collections/upload`: Uploads a custom collection poster to media server.
   - `GET /api/studio-logos`: Resolves and serves cached production company logos.
6. **Webhooks**:
   - `POST /api/webhook/arr`: Receives Sonarr/Radarr import webhooks.
   - `POST /api/webhook/tautulli`: Receives Tautulli 'Recently Added' webhooks.
   - `POST /api/agregarr/callback`: Webhook callback verification and delivery.
7. **WebSockets**:
   - `WebSocket /ws/logs`: Real-time streaming log feed.
   - `WebSocket /ws/status`: Live system status and execution progress.

---

## 11. Integrations & Companion Ecosystem

### 1. Agregarr Integration (`docs/agregarrintegration.md`)
- **Status**: Posterizarr implementation complete; requires the [bitr8/agregarr](https://github.com/bitr8/agregarr-dev) fork (`bitr8/agregarr:develop`) with [PR #103](https://github.com/bitr8/agregarr-dev/pull/103). Official upstream `agregarr/agregarr` releases return 404 as they do not include this integration.
- **Workflow**: When Posterizarr finishes processing an Arr-triggered media item and uploads it to Plex, it sends an authenticated callback to Agregarr (`POST /api/v1/posterizarr/trigger`).
- **Multi-Episode Handling**: Multi-episode file imports from Sonarr are expanded into separate jobs so each episode receives an individual callback.
- **Retry Architecture**: If Agregarr is busy (HTTP 409/429), Posterizarr honors the suggested delay and retries up to `AgregarrRetryTimeout` (default: 60s, configurable). Terminal errors (HTTP 403) are logged without retrying.

### 2. Radarr & Sonarr (Arr Integration)
- **Native Webhook (Recommended)**: Webhook pointed to `http://POSTERIZARR:8000/api/webhook/arr?api_key=KEY` with `On Import` and `On Upgrade` triggers.
- **Custom Script**: `ArrTrigger.sh` placed in Sonarr/Radarr custom script folder, writing `.posterizarr` descriptor files into `/posterizarr/watcher`.

### 3. Tautulli Integration
- **Native Webhook**: Webhook pointed to `http://POSTERIZARR:8000/api/webhook/tautulli?api_key=KEY` triggering on `Recently Added`.
- **Custom Script**: `trigger.py` configured under Tautulli Notification Agents.

### 4. Kometa (Plex Meta Manager) Integration
- Posterizarr outputs artwork into the standard Kometa directory hierarchy: `AssetPath/LibraryName/MediaTitle (Year)/poster.ext`.
- Pointing Kometa's `asset_directory` directly to Posterizarr's `/assets` folder enables seamless overlay layering without file moves.

### 5. Media Server C# Plugins
- **`modules/Posterizarr.Plugin`**: In-tree C# plugin for Jellyfin.
- **`modules/Posterizarr.Plugin.Emby`**: In-tree C# plugin for Emby.
- Provides local asset middleware and persistent WebSocket event listeners (`/ws/events`), instantaneously applying posters, backgrounds, season art, and title cards to media server library items without full library scans.

### 6. Monitoring & Notification Channels
- **Uptime Kuma**: Pings push URL on run start and completion with execution time and exit status.
- **Discord**: Dispatches rich embeds showing created asset thumbnails, processing durations, and statistics.
- **Apprise**: Multi-service notification routing via Apprise URLs.

---

## 12. Exhaustive `config.json` Schema Reference

The configuration file `config.json` (modeled by `config.example.json`) contains 17 top-level sections:

### 1. `WebUI`
- `basicAuthEnabled` (bool): Require HTTP basic authentication.
- `basicAuthUsername` (str): Admin username (default: `"admin"`).
- `basicAuthPassword` (str): Admin password (default: `"posterizarr"`).

### 2. `ApiPart`
- `tvdbapi` (str): TVDB API key (supports `APIKEY#PIN` format for subscribers).
- `tmdbtoken` (str): TMDB Read Access Bearer Token.
- `FanartTvAPIKey` (str): Fanart.tv personal API key.
- `PlexToken` (str): Plex authentication token.
- `JellyfinAPIKey` (str): Jellyfin API key.
- `EmbyAPIKey` (str): Emby API key.
- `FavProvider` (str): Preferred provider (`tmdb`, `tvdb`, `fanart`, `plex`).
- `ProviderPriorityMode` (str): Provider search strategy:
  - `"Simple"`: FavProvider first, then standard fallback order.
  - `"Global"`: Follows `ProviderOrder` array strictly.
  - `"PerMediaType"`: Uses `MovieProviderOrder` for movies, `ShowProviderOrder` for shows.
- `ProviderOrder` (array): Priority array when mode is Global (e.g. `["TMDB", "TVDB", "Fanart", "Plex"]`).
- `MovieProviderOrder` (array): Priority array for movies in PerMediaType mode.
- `ShowProviderOrder` (array): Priority array for shows/seasons in PerMediaType mode.
- `WidthHeightFilter` (bool): Enforce minimum resolution dimensions.
- `PosterMinWidth` / `PosterMinHeight` (str): Minimum poster dimensions (default: `2000` x `3000`).
- `BgTcMinWidth` / `BgTcMinHeight` (str): Minimum background/titlecard dimensions (default: `3840` x `2160`).
- `tmdb_vote_sorting` (str): Sorting method for TMDB artwork (`vote_average`, `vote_count`, `primary`).
- `PreferredLanguageOrder` (array): Language sequence for posters (`["xx", "en", "de"]`, where `xx` is textless).
- `PreferredSeasonLanguageOrder` (array): Language sequence for season posters.
- `PreferredBackgroundLanguageOrder` (array): Language sequence for backgrounds.
- `PreferredTCLanguageOrder` (array): Language sequence for title cards.
- `LogoLanguageOrder` (array): Language sequence for clearlogos (`["en", "de"]`).
- `TmdbLanguageMappings` (object): Maps standard codes to regional locales (e.g. `{"fr": "fr-FR"}`).
- `LibraryLanguageOverrides` (object): Per-library language and provider order overrides.

### 3. `PlexPart`
- `PlexUrl` (str): Plex server base URL (`http://IP:32400`).
- `UsePlex` (bool): Enable Plex server processing.
- `LibstoExclude` (array): Library names to skip.
- `UploadExistingAssets` (bool): Upload pre-existing assets only if media server lacks Posterizarr EXIF tags.

### 4. `JellyfinPart`
- `JellyfinUrl` (str): Jellyfin server URL (`http://IP:8096`).
- `UseJellyfin` (bool): Enable Jellyfin server processing.
- `LibstoExclude` (array): Library folder names to skip.
- `UploadExistingAssets` (bool): Upload existing assets if missing EXIF tags.
- `ReplaceThumbwithBackdrop` (bool): Replaces item thumb with backdrop image.
- `ReplaceThumbwithBackdropExclusively` (bool): Uploads backdrop only to thumb, preserving original backdrop.

### 5. `EmbyPart`
- `EmbyUrl` (str): Emby server URL (`http://IP:8096/emby`).
- `UseEmby` (bool): Enable Emby server processing.
- Same options as JellyfinPart (`LibstoExclude`, `UploadExistingAssets`, `ReplaceThumbwithBackdrop`, etc.).

### 6. `Notification`
- `SendNotification` (bool): Master toggle for external notifications.
- `DiscordUserName` (str): Webhook username.
- `Discord` (str): Discord Webhook URL.
- `AppriseUrl` (str): Apprise notification endpoint URL.
- `UseUptimeKuma` (bool): Enable Uptime Kuma heartbeats.
- `UptimeKumaUrl` (str): Uptime Kuma push URL.
- `AgregarrTriggerEnabled` (bool): Enable post-upload Agregarr callbacks.
- `AgregarrUrl` (str): Agregarr base URL.
- `AgregarrApiKey` (str): Agregarr API key.
- `AgregarrRetryTimeout` (str): Maximum seconds to retry Agregarr callback on busy responses (default: `"60"`, `"0"` disables).

### 7. `PrerequisitePart`
- `ParallelJobs` (str): Concurrent generation runspaces (default: `"5"`).
- `FileTestOnTrigger` (bool): Verify local file existence before processing triggers.
- `AssetPath` (str): Output assets directory (`/assets`).
- `BackupPath` (str): Artwork backup directory (`/assetsbackup`).
- `ManualAssetPath` (str): User-provided manual override directory (`/manualassets`).
- `PlexUpload` (bool): Direct upload to Plex.
- `FollowSymlink` (bool): Follow symbolic links during indexing.
- `ForceRunningDeletion` (bool): Automatically remove stale `.Running` locks.
- `AutoUpdatePosterizarr` (bool): Self-update git repo on bare-metal systems.
- `AutoUpdateIM` (bool): Self-update portable ImageMagick (bare-metal only).
- `telemetry` (bool): Send anonymized usage statistics.
- `show_skipped` (bool): Verbose logging for unchanged assets.
- `maxLogs` (str): Number of rotated log sessions to keep.
- `logLevel` (str): Log verbosity (`1` = Warn/Error, `2` = Info, `3` = Debug).
- `font` / `collectionfont` / `RTLfont` / `backgroundfont` / `titlecardfont` (str): Font filenames in `Overlayfiles/`.
- `overlayfile` / `showoverlayfile` / `seasonoverlayfile` / `collectionoverlayfile` / `backgroundoverlayfile` / `titlecardoverlayfile` (str): Overlay PNG files.
- `poster4k` / `Poster1080p` / `Background4k` / `Background1080p` / `TC4k` / `TC1080p` (str): Resolution badge overlays.
- `4KDoVi` / `4KHDR10` / `4KDoViHDR10` (str): HDR badge overlays for posters.
- `4KDoViBackground` / `4KHDR10Background` / `4KDoViHDR10Background` (str): HDR badges for backgrounds.
- `4KDoViTC` / `4KHDR10TC` / `4KDoViHDR10TC` (str): HDR badges for title cards.
- `UsePosterResolutionOverlays` / `UseBackgroundResolutionOverlays` / `UseTCResolutionOverlays` (bool): Apply resolution-specific overlays.
- `LibraryFolders` (bool): Structure output by library folders (Kometa style).
- `Posters` / `SeasonPosters` / `BackgroundPosters` / `TitleCards` (bool): Enable generation per asset category.
- `NewLineOnSpecificSymbols` (bool) & `NewLineSymbols` (array): Insert newlines at symbols (e.g. `[" - "]`).
- `SymbolsToKeepOnNewLine` (array): Symbols retained after line break.
- `NewLineOnSpecificWords` (bool) & `NewLineWords` (object): Word-specific hyphenation mappings.
- `SkipTBA` (bool) & `SkipWords` (array): Skip title card generation if title matches keywords or regex.
- `SkipJapTitle` (bool): Skip title cards with Japanese or Chinese script.
- `AssetCleanup` (bool): Clean up local assets when corresponding media is removed from server.
- `DisableHashValidation` (bool): Skip hash checks and force re-upload.
- `DisableOnlineAssetFetch` / `DisableOnlineTitleCardFetch` / `DisableOnlinePosterFetch` / `DisableOnlineBackgroundFetch` / `DisableOnlineSeasonFetch` (bool): Restrict generation exclusively to local files.
- `AutoCreateSeasonTemplate` (bool): Automatically create and update `SeasonTemplate` in ManualAssets from TV show posters.
- `AutoUpdateExistingSeasonPosters` (bool): When AutoCreateSeasonTemplate is enabled, also automatically update/re-render already created season posters.
- `UseLogo` / `UseBGLogo`: Apply clearlogo instead of title text to posters or backgrounds.
- `UseClearlogo` / `UseClearart`: Scrape transparent clearlogo or clearart PNGs.
- `LogoTextFallback` (bool): Fall back to typography if no logo is available.
- `TextlessPosterBypass` (bool): Bypass textless preference if no logo is found.
- `ConvertLogoColor` (bool) & `LogoFlatColor` (str): Convert logos to solid color silhouettes.
- `PreserveMultiColorLogos` (bool): When converting logo color, preserve multi-colored logos in original hues.
- `UseOriginalTitle` (bool): Use original media title instead of localized string.
- `SkipAddText` / `SkipAddTextAndOverlay` / `SkipAddTextAndBorder`: Skip compositing elements if provider flags image as texted.
- `SkipLocalPosterTextAdd` / `SkipLocalBackgroundTextAdd` / `SkipLocalSeasonTextAdd` / `SkipLocalTCTextAdd`: Skip adding text to local source files.

### 8. `OverlayPart`
- `ImageProcessing` (bool): Enable ImageMagick compositing (if false, raw images are downloaded without modifications).
- `outputQuality` (str): Compression quality (default: `"92%"`).

### 9. `PosterOverlayPart` (Standard Posters)
- `fontAllCaps` (bool): Force uppercase typography.
- `AddBorder` (bool), `borderwidth` (str), `bordercolor` (str): Border styling.
- `AddText` (bool), `fontcolor` (str), `minPointSize` (str), `maxPointSize` (str): Typography controls.
- `AddTextStroke` (bool), `strokecolor` (str), `strokewidth` (str): Text outline.
- `AddOverlay` (bool): Composite overlay PNG.
- `MaxWidth` (str), `MaxHeight` (str), `text_offset` (str), `lineSpacing` (str), `TextGravity` (str): Bounding box layout.

### 10. `SeasonPosterOverlayPart` (Season Posters)
- Same typography, border, and overlay controls as `PosterOverlayPart`.
- `ShowFallback` (bool): Fall back to show poster if season artwork is missing.
- `OverrideSeasonName` (bool): Override default season text.
- `SeasonOverrideText` (str): Custom regular season title (e.g. `"Staffel"`).
- `SpecialSeasonOverrideText` (str): Custom specials season title (e.g. `"Spezial"`).

### 11. `ShowTitleOnSeasonPosterPart`
- `AddShowTitletoSeason` (bool): Add series title or logo above the season text.
- Standard typography, stroke, point size, and layout settings.

### 12. `CollectionTitlePosterPart`
- `AddCollectionTitle` (bool): Add a secondary "Collection" badge or text.
- `CollectionTitle` (str): Label string (default: `"Collection"`).

### 13. `CollectionPosterOverlayPart`
- Typography, borders, overlays, and bounding box parameters for collection posters.

### 14. `BackgroundOverlayPart`
- Compositing, typography, and border settings for 3840x2160 backgrounds.

### 15. `TitleCardOverlayPart`
- `UseBackgroundAsTitleCard` (bool): Use show background image as base for episode title card.
- `BackgroundFallback` (bool): Fall back to background if episode thumb is missing.
- `AddOverlay` (bool), `AddBorder` (bool), `bordercolor` (str), `borderwidth` (str).
- `SkipWords` (array): Keywords or regex expressions that trigger title card skipping.

### 16. `TitleCardTitleTextPart`
- Episode title typography, point sizes (`minPointSize: 50`, `maxPointSize: 150`), and bounding box.

### 17. `TitleCardEPTextPart`
- Season and episode index labeling (e.g. `SeasonTCText: "Season"`, `EpisodeTCText: "Episode"`).
- Formats text as `SEASON 1 • EPISODE 5`.

---

## 13. Critical Rules, Gotchas & Conventions for AI Agents

1. **Schema Synchronization (`CheckJson`)**:
   - Every new configuration property introduced in the codebase **MUST** be added to `config.example.json`.
   - If a key is missing from `config.example.json`, `CheckJson` will flag it as obsolete and silently delete it from user configurations during container startup!
   - Ensure branch detection (`$env:APP_VERSION -match 'dev'`) points to the `dev` branch template when editing development branches.

2. **Provider Resolution & Linking (`FavProviderLink`)**:
   - In `AssetOverview.jsx` and `AssetReplacer.jsx`, `FavProviderLink` provides a direct link to the user's preferred upstream provider so missing metadata can be reported or fixed.
   - Even if an asset was acquired from a secondary fallback provider, `PrimaryProvider` represents the intended preferred provider.

3. **PowerShell Argument Escaping & Command Construction**:
   - In `CoreGeneration.ps1`, arguments passed to `magick` must be constructed as discrete PowerShell string arrays rather than single interpolated strings.
   - Take extreme care with path separators and nested quotation between Windows (`\`) and Linux (`/`).

4. **Multi-Threaded Log Parsing (`[Txx]` Worker IDs)**:
   - When parallel jobs run (`ParallelJobs > 1`), log entries in `Scriptlog.log` from different threads are interleaved.
   - Always group and trace log messages by their Runspace Worker ID (e.g., `[T14]`) to reconstruct the sequential execution of a single media item.

5. **SSRF & Path Traversal Security**:
   - All backend image proxying, clearlogo fetching, and webhook callbacks must pass through `is_safe_url` to prevent SSRF against loopback or unauthorized private network endpoints.
   - User-supplied file paths must always be validated via `get_safe_path` against `base_dir`.

6. **WebUI Configuration Normalization**:
   - The backend supports both grouped structures (`config["ApiPart"]["FavProvider"]`) and flat representations (`config["FavProvider"]`).
   - Use `config_mapper.py` or existing helper methods when querying or saving configuration via `/api/config`.

7. **No Dummy Placeholders**:
   - Never commit empty or dummy mock files for image processing. Posterizarr relies on actual ImageMagick or Pillow pipelines to generate valid binary artwork.
