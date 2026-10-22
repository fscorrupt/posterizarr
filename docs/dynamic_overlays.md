# Dynamic Overlays (Kometa Migration)

**Native in-memory dynamic overlay engine for Posterizarr WebUI.**  
Replaces external Kometa overlay pipelines with a zero-footprint, high-performance Pillow (`PIL`) compositor.

---

## Overview

Historically, applying dynamic badges, ratings, ribbons, and status banners required running a separate Kometa (Plex Meta Manager) container alongside Posterizarr. This often caused media server artwork overwrite loops, required Plex as an intermediary to mirror images to Jellyfin or Emby, and modified files or required complex Docker setups.

**Dynamic Overlays** in Posterizarr solves this natively:

1. **In-Memory Compositing (Clean Assets Preserved):**  
   Clean posters and titlecards stored in `/assets` remain **100% untouched and clean on disk**. Compositing happens entirely in RAM before pushing directly to the media server API.
2. **True Multi-Media Server Support:**  
   Pushes overlaid artwork directly to **Plex**, **Jellyfin**, and **Emby** via their respective REST APIs.
3. **Change-Detection Fingerprint Cache:**  
   Tracks a composite hash of clean asset metadata + applied overlay parameters. If media ratings, video resolution, or series status haven't changed, items are skipped with **0 rendering and 0 network uploads**.
4. **Predictable File Layout:**  
   All Kometa-compatible configs and overlay assets reside in a dedicated subfolder inside `Overlayfiles/kometa/`.

---

## Folder Layout

All configuration and assets live inside `Overlayfiles/kometa/`:

```text
Overlayfiles/
├── (default fonts & frame overlays: Colus-Regular.ttf, overlay.png, etc.)
└── kometa/
    ├── configs/     # Your YAML configuration files (config.yml, anime_overlays.yml, etc.)
    ├── defaults/    # On-demand cached Kometa GitHub templates (network.yml, status.yml, etc.)
    ├── assets/      # Overlay image files (rating badges, 4K banners, network logos, flags)
    └── fonts/       # Overlay font files (CircularStd-Bold.otf, Comfortaa, etc.)
```

---

## Supported Overlay Types

| Overlay Type | Target Level | Source Metadata | Description |
|---|---|---|---|
| **4K Quality Banner** | Movie Posters & Titlecards | Stream video resolution (`width >= 3840` or `4K`) | Diagonal top banner on posters or corner badge on episode cards. |
| **Audience Rating** | Movies & Shows | Audience / critic score (IMDb, TMDb, Plex) | Color-tiered badge (High $\ge 6.5$, Mid $4.5-6.4$, Low $<4.5$) + formatted score text. |
| **Series Status** | Shows | Series status (`Airing`, `Returning`, `Ended`, `Canceled`) | Optical centered status banner with status colors (`Colus-Regular.ttf`). |
| **Runtime** | Movies & Titlecards | Stream duration (`RunTimeTicks` / `duration`) | Clean duration badge (e.g. `124 min`, `24 min`). |
| **Audio Languages** | Movies & Titlecards | Audio streams present in media item | Square badges or flags for audio languages (e.g. `de`, `en`, `ja`). |
| **Anime Filler Tag** | Anime Episodes | `anime_overlays.yml` episode regex match | "Canon" (Green), "Filler" (Red), or "Mixed" (Orange) badge on episode titlecards. |
| **Network Logos** | Seasons | Studio / TV Network | Official network logo (e.g., Netflix, HBO, Disney+, Apple TV+). |
| **Common Sense Media**| Movies | Common Sense Media age rating | Age rating badge (e.g., 10+, 14+, 18+). |

---

## Web UI Features

Navigate to **Builders $\to$ Dynamic Overlays** in the Posterizarr Web UI:

### 0. Guided Onboarding Setup Wizard
- **Zero Confusion Onboarding:** A friendly 4-step visual wizard guides new users through the engine's core concepts, eliminating manual reading.
- **1-Click Turnkey Configuration:** Instantly applies battle-tested overlay presets for Movies (4K badges, ratings, runtime, age ratings), TV Shows (status banners, network logos, episode runtimes), and 16:9 Backdrops.
- **Direct Multi-Config Upload:** Migrating from Kometa or PMM? Directly select or drag-and-drop multiple YAML config files at once (`config.yml`, `overlays_tv.yml`, `overlays_movies.yml`, `anime_overlays.yml`, etc.). Posterizarr automatically validates YAML syntax, imports API keys, and maps rules to your media libraries.
- **Interactive Visual Studio Tour:** Introduces the live preview canvas, drag-and-drop badge movement, rule-of-thirds guides, and per-format customization (keeping show posters and episode titlecard resolution badges safely isolated).
- **Always Accessible:** Reopenable anytime via the **Setup Wizard** button on the Dynamic Overlays header.

### 1. Importer & Pre-flight Validator
- **Config Scanner:** Detects all YAML files in `Overlayfiles/kometa/configs/`.
- **Readiness Checklist:** Automatically lists every font, image, and template required by your YAML files.
- **1-Click Remote Fetch:** Automatically downloads missing templates and badges from official GitHub repositories.
- **Import Kometa Defaults (from GitHub):** 1-click download of all 25 official Kometa default overlay templates directly from GitHub into `Overlayfiles/kometa/defaults/`.
- **Scheduled Auto-Updates (GitHub Sync):** Automatically keeps templates up to date via the Scheduler (`kometadefaults` run mode). The scheduler queries GitHub's API to discover newly added defaults and updates existing templates with upstream improvements. Can be scheduled on daily, weekly, or custom cron intervals, or enabled via 1-click Quick Schedule directly from the Dynamic Overlays page.
- **Direct Asset Uploader:** Easily drop custom fonts (`.ttf`, `.otf`) or badge PNGs directly into the UI.

### 2. Active Libraries & Rules
- **Interactive Rule Management:** View, add, edit, or remove overlay rules directly on each library card.
- **Add Library:** Click **+ Add Library** on the toolbar to register new server libraries (e.g., *Anime Shows*, *4K Movies*, *Kids TV*) into `config.yml`.
- **Remove Library / Rules:** One-click removal with confirmation and automated `.bak` backup generation.
- **Visual Variable Editor:** Customize `builder_level` (Movie, Show, Season, Titlecard), horizontal/vertical offsets, alignments, and transparent/solid back colors without writing code.
- **Raw JSON & YAML Mode:** Switch tabs to edit raw template variables, or click **Edit Raw config.yml** to modify the complete YAML configuration with instant syntax validation.

#### Recommended Defaults & Level Guide

| Overlay Need | Recommended Source | Target `builder_level` | Purpose / Appearance |
| :--- | :--- | :--- | :--- |
| **Media Runtime** | `default: runtimes` | `episode` or `movie` | Display duration badge (e.g., `124 min`, `24 min`). |
| **Audio Languages** | `default: languages` | `episode` or `movie` | Language stream flags / pills (e.g., `DE`, `EN`, `JA`). |
| **Ratings** | `default: ratings` | `movie` or `show` | Audience / Critic ratings (IMDb, RT, TMDB, Metacritic). |
| **TV Network** | `default: network` | `season` | Network logo on season posters (HBO, Netflix, Disney+). |
| **Series Status** | `default: status` | `show` | Airing, Returning, Ended, or Canceled banner on shows. |
| **Common Sense Media** | `default: commonsense` | `movie` | Age rating badge (e.g., `10+`, `14+`, `18+`). |
| **4K Quality Ribbon** | `default: resolution` or `file: config/overlays_movies.yml` | `movie` or `episode` | 4K UHD, 1080p, HDR badges/ribbons. |
| **Anime Filler Tag** | `file: config/anime_overlays.yml` | `episode` | Canon / Filler / Mixed tag on anime episode titlecards. |
| **Corner Ribbon** | `default: ribbon` | `movie` | Corner ribbon badge for resolution or editions. |
| **Streaming Platform**| `default: streaming` | `show` or `movie` | Streaming service badge (Netflix, Prime, Max, etc.). |
| **Audio Codec** | `default: audio_codec` | `movie` or `episode` | Audio codec badge (Dolby Atmos, TrueHD, DTS:X). |

### 3. Live Preview
- Live, interactive canvas preview for both Movie Posters (1000 $\times$ 1500) and Titlecards / Backdrops (1920 $\times$ 1080).
- Real-time adjustment of ratings, resolution, series status, runtimes, and anime tags.
- **Matching badge artwork:** Drag & Drop uses transparent PNG layers rendered by the same Pillow compositor and recipe builder used for media-server uploads. Badge sizes, fonts, plates, shadows, and overlapping layer order are no longer approximated with HTML/CSS. Drag handles and alignment guides use the rendered pixel bounds, including compound badges such as a rating plate plus score.
- Select the target library to preview its saved upload recipe. Without a selected library, the renderer uses standard default rules. Preview metadata (ratings, status, languages, etc.) is sample data; actual item metadata and filters can select different badges during sync. Upload the generated clean asset as custom test artwork to compare against the same base image. Missing required assets or fonts produce an error instead of a visually different fallback badge.
- Without a selected library, all five preview formats are available: movie poster, show poster, season poster, titlecard, and background. Existing libraries retain their movie/TV-specific format choices.
- **Asset boundaries:** Enabled by default in both Drag & Drop and Final Render. Dashed, shaded boxes show the configured title/logo reservation, season title, optional show title on season posters, and separate episode title and season/episode text areas. A dashed rose outline marks the inner border edge when borders are enabled.
- **Legend:** Shown below the canvas in both preview modes and updated for the selected format and visible guides. Yellow dashed boxes reserve the primary title/logo area; cyan dashed boxes reserve the additional show title or season/episode text area. The rose/red dashed outline marks the border's inner edge. Solid amber lines mark badge alignment; green lines mark magnetic snapping while dragging.
- Boundaries use the saved asset-creation configuration (`MaxWidth`, `MaxHeight`, `text_offset`, and `borderwidth`), scaled from 2000 $\times$ 3000 posters or 3840 $\times$ 2160 landscape assets. As in testing mode, text-box reservations remain visible for textless assets.
- Use the refresh icon beside **Asset boundaries** after saving configuration changes. Guides are preview-only: they do not move badges automatically, change saved layouts, or appear in uploaded artwork. They show reserved boxes rather than exact font, logo, or static-overlay rendering; upload a generated asset as custom artwork to inspect those details.

### 4. 16:9 Backdrop & Multi-Source Ratings Overlays
- **Backdrop Overlay Pipeline:** Overlays dynamic rating badges directly onto 16:9 movie/show background fanart and uploads to Plex (`/library/metadata/{id}/arts`) or Jellyfin/Emby (`/Items/{id}/Images/Backdrop`).
- **Pristine Clean Assets Protected:** Original `background.jpg` / `fanart.jpg` on disk remain 100% untouched.
- **Supported Rating Providers:**
  - **IMDb** (`IMDb.png`)
  - **Rotten Tomatoes Critics** (`RT-Crit-Fresh.png` / `RT-Crit-Rotten.png`)
  - **Rotten Tomatoes Audience** (`RT-Aud-Fresh.png` / `RT-Aud-Rotten.png`)
  - **TMDb** (`TMDb.png`)
  - **Trakt** (`Trakt.png`)
  - **Letterboxd** (`Letterboxd.png`)
  - **Metacritic** (`Metacritic.png`)
- **Zero-Quota Native Resolution:** Transparently reads Plex `<Rating>` XML tags and local TMDb token first, eliminating external quota burn.
- **Optional External APIs:** MDBList and OMDb API keys are strictly optional.
- **Tiered Auto-Update TTL (SQLite):**
  - Media released < 180 days: **3-day refresh**
  - Media released < 2 years: **14-day refresh**
  - Classic media (> 2 years): **30-day refresh**
  - When ratings change during scheduled syncs, updated backdrops are automatically re-rendered and pushed to media servers.

### 5. Cache & Sync
- View cached items in `database/overlay_cache.db` (`media_ratings_cache` table and fingerprint tables).
- Inspect recently synchronized media items across Plex, Jellyfin, and Emby.
- Clear rating or asset caches on demand.

---

## Security Architecture

Posterizarr enforces strict security controls for all dynamic overlay operations:

- **Path Traversal Mitigation:** All configuration and asset file operations are strictly jailed inside `Overlayfiles/kometa/`. Traversal patterns (`..`, `~`), null bytes (`\x00`), and path escapes are strictly blocked.
- **Strict Extension Whitelisting:** Only safe configuration (`.yml`, `.yaml`), image (`.png`, `.jpg`, `.jpeg`, `.webp`), and font (`.ttf`, `.otf`) extensions are permitted.
- **SSRF Mitigation:** All remote asset downloads strictly enforce HTTPS, resolve hostnames against public IP ranges, and block loopback (`127.0.0.1`), link-local (`169.254.x.x`), private IP ranges, and multicast targets.

---

## Open Source Attribution & License

The mathematical coordinate algorithms, optical bounding box calculations, and template parsing logic are adapted from the project **Kometa** (formerly Plex Meta Manager) by **meisnate12** and the Kometa team, licensed under the **MIT License**:

```text
MIT License
Copyright (c) 2026 meisnate12
```

We extend deep gratitude to the Kometa community for their contributions to media server automation.
