# Posterizarr - LLM Project & Architecture Guide
> **Purpose**: This file provides immediate, structured context for Large Language Models (LLMs) and AI agents. Read this file first to understand the codebase architecture, key components, configuration schemas, and common conventions without scanning the entire repository.

---

## 1. Project Overview & Mission

**Posterizarr** is an automated artwork processing, overlay generation, and metadata synchronization engine for personal media servers (**Plex**, **Jellyfin**, and **Emby**).

### Primary Capabilities:
1. **Scrapes Artwork**: Queries multiple metadata providers (**TMDB**, **TVDB**, **Fanart.tv**, and local media servers) using granular language and priority preferences.
2. **Generates Overlays**: Uses **ImageMagick 7** to dynamically composite overlays (borders, gradients, resolution banners like 4K/HDR/Dolby Vision, audio codec badges, source watermarks) onto posters, season posters, backgrounds, and title cards.
3. **Uploads to Media Servers**: Uploads processed artwork directly to Plex, Jellyfin, or Emby via API.
4. **Web UI & Management**: Provides a modern web interface with real-time dashboards, asset overview tables, manual image choice pickers, collection poster designers, logs viewer, and queue runners.
5. **Notification & Arr Integrations**: Webhooks for Apprise, Discord, Uptime Kuma, and callbacks for **Agregarr**.

---

## 2. Technology Stack & Components

| Component | Technology | Primary Location | Key Responsibilities |
| :--- | :--- | :--- | :--- |
| **Automation Core** | PowerShell (pwsh 7+) | `Posterizarr.ps1`, `modules/` | Scrapes APIs, prepares images, executes ImageMagick commands, uploads to media servers, manages backups. |
| **Web UI Backend** | Python 3.13 + FastAPI + Uvicorn | `webui/backend/main.py` | Serves REST API and WebSockets, manages SQLite DBs, coordinates background runs, handles proxies. |
| **Web UI Frontend** | React 18 + Vite + Tailwind CSS | `webui/frontend/` | Responsive dark-themed UI, Asset Overview, Live Collection Editor, Settings Editor, Logs, Queue Manager. |
| **Image Processing** | ImageMagick 7 (`magick`) + Pillow | Alpine / System packages | Compositing overlays, badge positioning, typography rendering, color extraction, textless detection. |
| **Databases** | SQLite3 | `database/*.db` | `imagechoices.db`, `config.db`, `queue.db`, `server_libraries.db`, `media_export.db`. |
| **Containerization** | Docker (Alpine 3.24) | `Dockerfile`, `Start.ps1`, `start.sh` | Orchestrates multi-process runtime (`uvicorn` backend + `pwsh Start.ps1` scheduler/worker). |

---

## 3. Directory Structure Map

```text
PosterizarrUI_dev/
├── Posterizarr.ps1             # Main PowerShell CLI entrypoint for standalone runs
├── Start.ps1                  # Container entrypoint script (manages schedule, integrity check)
├── Dockerfile                 # Multi-stage Docker build (Node frontend -> Python Alpine runtime)
├── config.example.json        # Master template for all configuration sections and default values
├── Overlayfiles/              # Stock overlay PNGs, fonts (.ttf, .otf), and graphic assets
│
├── modules/                   # Core PowerShell automation modules
│   ├── core/
│   │   ├── Variables.ps1      # Global variables, branch detection, config loader, paths
│   │   ├── PrerequisitesCheck.ps1 # Directory validation, tool check (ImageMagick), font installs
│   │   └── Database.ps1       # SQLite helper wrappers for PowerShell
│   └── functions/
│       ├── ApiHandlers.ps1    # TMDB, TVDB, Fanart, Plex, Jellyfin, Emby API requests
│       ├── CoreGeneration.ps1 # ImageMagick CLI command construction & composition logic
│       ├── System.ps1         # Path security, CheckJson config validator, process execution
│       ├── Notifications.ps1  # Discord, Apprise, Uptime Kuma, Agregarr webhook payloads
│       └── BackupRestore.ps1  # Image backup and rollback system
│
├── webui/
│   ├── backend/               # FastAPI backend
│   │   ├── main.py            # Main API routes, WebSocket listeners, image proxying
│   │   ├── scheduler.py       # Cron / interval scheduling engine for Posterizarr runs
│   │   ├── queue_manager.py   # Job queue for asset processing requests
│   │   ├── config_database.py # SQLite CRUD for WebUI configuration
│   │   └── overlay_generator.py # Python/Pillow overlay generator for live previews
│   └── frontend/              # Vite + React single-page application
│       ├── src/
│       │   ├── components/    # AssetOverview, ConfigEditor, CollectionLiveEditor, Dashboard, etc.
│       │   ├── i18n/          # Translation dictionaries (en, de, fr, es, etc.)
│       │   └── App.jsx        # Root routing and theme provider
│       └── package.json
│
└── docs/                      # Markdown documentation for users and developers
```

---

## 4. Runtime & Container Lifecycle

### Docker Architecture:
- In Docker (`IS_DOCKER = True`), paths are standardized:
  - `/config` (`$env:APP_DATA`): Contains `config.json`, logs, cache, and SQLite databases.
  - `/app` (`$env:APP_ROOT`): Read-only application files and modules.
  - `/assets`: Target directory where generated artwork is written.
  - `/manualassets`: Custom images placed by users to override scrapers.
  - `/assetsbackup`: Original unmodified artwork before processing.
- `start.sh` starts `uvicorn` in the background (port 8000), then starts `Start.ps1` via `catatonit`.
- **Integrity Validation**: `Start.ps1` runs `CheckJson` to sync `config.json` against `config.example.json` before triggering scheduled runs.

### Local Development:
- Backend: `uvicorn main:app --host 127.0.0.1 --port 8000` from `webui/backend/` (uses `.venv`).
- Frontend: `npm run dev` from `webui/frontend/` (proxies `/api` to port 8000).
- PowerShell: `pwsh ./Posterizarr.ps1 -dev` from the workspace root.

---

## 5. Configuration Architecture (`config.json`)

Posterizarr uses a categorized JSON config (`config.json`). The authoritative schema is defined in `config.example.json`.

### Primary Sections:
1. **`WebUI`**: Basic auth credentials (`basicAuthEnabled`, `basicAuthUsername`, `basicAuthPassword`).
2. **`ApiPart`**: Metadata provider API keys, resolutions, language sequences, and provider priority rules.
3. **`PlexPart` / `JellyfinPart` / `EmbyPart`**: Server URLs, tokens, library names, and per-server toggles.
4. **`PosterOverlayPart` / `ShowPosterOverlayPart` / `SeasonPosterOverlayPart` / `BackgroundOverlayPart` / `TitleCardOverlayPart`**: Overlay positioning, dimensions, font sizes, colors, and badge preferences.
5. **`Notification`**: Discord, Apprise, Uptime Kuma, and Agregarr trigger settings.

### Provider Priority Strategy (`ProviderPriorityMode`):
Controls how Posterizarr selects artwork across TMDB, TVDB, Fanart, and local media servers:
- **`Simple`**: Starts with `FavProvider` (e.g. `tvdb` or `tmdb`), followed by standard fallback order.
- **`Global`**: Strictly adheres to the custom array in `ApiPart.ProviderOrder` (e.g. `["TMDB", "TVDB", "Fanart", "Plex"]`).
- **`PerMediaType`**: Uses `ApiPart.MovieProviderOrder` for Movies, and `ApiPart.ShowProviderOrder` for TV Shows/Seasons.
- **`LibraryLanguageOverrides`**: Any library can override priority independently:
  ```json
  "LibraryLanguageOverrides": {
    "Anime": {
      "EnableProviderOrderOverride": true,
      "ProviderOrder": ["TVDB", "TMDB", "Fanart", "Plex"],
      "ApplyToPoster": true,
      "ApplyToSeason": true,
      "ApplyToBackground": true,
      "ApplyToLogo": true
    }
  }
  ```

---

## 6. Critical Conventions & Gotchas for LLMs

1. **Schema Integrity (`CheckJson`)**:
   - `CheckJson` compares `config.json` to `config.example.json` (downloaded from GitHub or read locally).
   - If you introduce new configuration keys, you **MUST** declare them in `config.example.json`, otherwise `CheckJson` will treat them as obsolete and remove them!
   - Ensure branch detection (`$env:APP_VERSION -match 'dev'`) uses `dev` so development builds download from the `dev` branch template.

2. **Cross-Provider URL Linking (`FavProviderLink`)**:
   - In `AssetOverview.jsx`, `FavProviderLink` is intended to provide a direct link to the preferred provider so users can fix missing metadata on the upstream provider.
   - If an asset used a fallback provider, `PrimaryProvider` still reflects the preferred provider, and `asset.FavProviderLink` should always be resolved if possible.

3. **ImageMagick Command Construction**:
   - In `CoreGeneration.ps1`, commands are built into an array of string arguments passed to `magick`.
   - Take extreme care with Windows vs Linux quotes and path separators (`/` vs `\`). Always use standard PowerShell array syntax without breaking string interpolation.

4. **WebUI Data Normalization**:
   - The backend supports both grouped configuration (e.g., `config["ApiPart"]["FavProvider"]`) and flat configuration forms (`config["FavProvider"]`). When querying via `/api/config`, always use the helper functions or verify structure presence.

5. **No Placeholders**:
   - Do not commit mock or empty dummy images. Assets should be processed with the actual ImageMagick or Pillow pipelines.
