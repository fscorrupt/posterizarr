# Posterizarr Plugin for Emby

**Middleware for asset lookup. Maps local assets to library items as posters, backgrounds, or titlecards.**

!!! note "Port & Credits"
    This plugin is an Emby port of the original [Posterizarr Jellyfin Plugin](https://github.com/fscorrupt/posterizarr/tree/main/modules/Posterizarr.Plugin) by [fscorrupt](https://github.com/fscorrupt). All credit for the original idea, architecture, and implementation goes to him.

    This port was vibecoded using **Claude** (Anthropic).

## Overview

The Posterizarr Plugin acts as a local asset proxy for Emby. It is designed to work alongside the [Posterizarr](https://github.com/fscorrupt/posterizarr) automation script, allowing your media server to utilize locally generated or managed assets (posters, backgrounds, title cards) as metadata.

!!! tip "Middleware purpose"
    This middleware does not allow you to browse, search, or download assets.
    Its sole purpose is to replace the default artwork by mapping library items to your local file system.

## Features

*   **Local Asset Mapping:** Maps local files to library items without replacing original metadata permanently in some configurations.
*   **Metadata Provider:** Registers as a metadata provider for images.
*   **Support for Multiple Asset Types:** Handles Posters, Backgrounds, Seasons, and Title Cards.
*   **Real-Time WebSocket Sync:** Connects directly to Posterizarr's event stream. Automatically refreshes Emby library items immediately when artwork is created, edited, or overlay-processed in Posterizarr.
*   **Plex Direct Sync (Kometa Mirroring):** High-speed direct mirroring of active Plex artwork into Emby for movies, TV series, seasons, episode title cards, and backdrops. Detects changes via Plex artwork version timestamps.
*   **Hybrid Sync (Combined Real-Time & Plex Sync):** Run real-time WebSocket sync and Plex Direct Sync together. New Posterizarr artwork applies instantly, while scheduled Plex sync runs will replace it whenever Kometa overlays differ in Plex.
*   **Scheduled Sync Task:** Registers a background task to keep library images in sync with your local assets automatically on a customized schedule.

## Installation

!!! tip "Plex & Kometa Compatibility"
    If you sync metadata or overlays from Plex (such as Kometa overlays), you can enable **Plex Direct Sync** in the plugin settings to mirror artwork directly from Plex. You can also combine it with **Real-Time Sync** for instant updates.

1.  Download the latest version of `Posterizarr.Plugin.Emby.dll` from the [GitHub Releases](https://github.com/fscorrupt/posterizarr/releases).
2.  Copy `Posterizarr.Plugin.Emby.dll` into your Emby Server's plugin directory:
    *   **Docker:** `/config/plugins/`
    *   **Windows:** `%appdata%\Emby-Server\programdata\plugins`
3.  **Restart** your Emby Server.

## Configuration

1. After restarting, go to **Dashboard** → **Plugins** → **Installed Plugins** and click **Posterizarr Emby**.
2. Click on **Settings**.
3. Configure your **Root Asset Folder Path** (the directory where your curated images are stored, e.g., `/assets`).
4. **Image Target Types:** Select which artwork types to automatically apply (Posters, Season Posters, Titlecards, Backdrops, Thumbnails).
5. **Real-Time Sync (WebSocket) Settings:**
    *   **Enable Real-Time Sync (WebSocket):** Check this box to enable instant updates.
    *   **Posterizarr URL:** Enter your Posterizarr server URL (e.g., `http://192.168.1.50:8000` or `http://localhost:8000`).
    *   **Posterizarr API Key (Required):** Enter your Posterizarr API key. The key is transmitted securely via the `X-API-Key` HTTP header and is mandatory for WebSocket authentication.
6. **Plex Direct Sync Settings (Optional):**
    *   **Enable Plex Direct Sync:** Check this box to mirror artwork directly from Plex.
    *   **Plex Server URL:** Base URL of your Plex server (e.g., `http://192.168.1.50:32400`).
    *   **Plex Token:** Your Plex authentication token (`X-Plex-Token`).
    *   **Libraries to Sync (Optional):** Comma-separated list of Plex libraries to sync, or leave blank for all.
    *   **Artwork Types:** Choose which artwork types to mirror (Posters, TV Shows, Seasons, Titlecards, Backdrops).
7. Click **Save**.
8. Go to your **Dashboard** → **Libraries**.
9. Manage a library (e.g., Movies).
10. Enable **Posterizarr** under the **Image Fetchers** settings.
11. Ensure it is prioritized according to your preferences.
12. Refresh metadata (**Search for missing metadata** → **Replace existing images**) for your library to pick up local assets for the first time.

## Combining Real-Time Sync & Plex Direct Sync (Hybrid Mode)

You can enable both **Real-Time Sync** and **Plex Direct Sync** simultaneously to get the best of both worlds:

```mermaid
flowchart TD
    subgraph Instant["1. Instant Real-Time Sync"]
        A[Posterizarr finishes rendering] -->|WebSocket event| B[Emby Plugin applies artwork immediately]
        B --> C[Plex sync cache invalidated for item]
    end

    subgraph Scheduled["2. Scheduled Plex Direct Sync"]
        D[Scheduled Plex Sync runs] --> E{Compare Plex artwork with Emby}
        E -->|Different e.g. Kometa overlays| F[Plex sync wins: applies Kometa overlay]
        E -->|Identical| G[Skips re-save & updates cache]
    end

    Instant -.-> Scheduled
```

* **Instant Updates:** You don't have to wait for a daily or scheduled Plex sync task to see fresh artwork in Emby. The WebSocket listener updates Emby immediately upon rendering.
* **Kometa Priority:** When the scheduled Plex Sync task runs, it evaluates the item. If Kometa added overlays (borders, badges, ratings) in Plex, **Plex sync takes precedence and updates the artwork**. If the artwork is identical, it avoids redundant downloads and disk writes.

## Real-Time Synchronization (WebSocket)

The Emby plugin includes a real-time event listener service (`PosterizarrWebSocketListener`) that connects directly to Posterizarr's `/ws/events` WebSocket endpoint.

### How It Works

```mermaid
sequenceDiagram
    participant Engine as Posterizarr Engine / WebUI
    participant Backend as Posterizarr Backend (/ws/events)
    participant Plugin as Emby Plugin
    participant Emby as Emby Media Server

    Engine->>Backend: Render Asset / Upload / Replace Artwork
    Backend-->>Plugin: WebSocket event: "asset_updated"
    Plugin->>Plugin: Validate path & confine to Asset Root (CWE-22)
    Plugin->>Emby: Lookup item & SetImage(...)
    Plugin->>Emby: UpdateItem (Instant Refresh)
```

1. **Instant Event Broadcast:** Whether artwork is generated during automated runs (Tautulli Recently Added, Sonarr/Radarr webhooks, manual runs, scheduled runs) or replaced in the WebUI, `LogsWatcher` detects the change and immediately broadcasts an `asset_updated` event over `/ws/events`.
2. **Direct Image Application:** Upon receiving the event, the Emby plugin directly opens the rendered file from disk and applies it to the library item via Emby's internal `SetImage` and `UpdateItem` APIs. The item refreshes in under a second without requiring a full library scan or waiting for scheduled tasks.
3. **Autonomous Operation:** Even if Posterizarr is configured with `UsePlex: true` and `UseJellyfin: false` / `UseEmby: false`, the Emby plugin operates autonomously by monitoring the shared `/assets` directory. When an asset is modified, Emby updates instantaneously without waiting for the daily scheduled task.
4. **Smart Cache Synchronization:** Once an item is updated via real-time sync, its hash is updated in the plugin's `SyncCacheManager`, ensuring scheduled tasks skip it without redundant re-processing.

### Security Highlights

* **Strict Header-Based Authentication:** The API key is **never** passed in the URL or query parameters. It is transmitted securely via the `X-API-Key` HTTP header during the WebSocket upgrade handshake, preventing accidental disclosure in web server access logs or proxy headers.
* **Path Traversal Protection (CWE-22):** All event paths are strictly sanitized against directory traversal sequences (`..`), invalid characters, and rooted paths, and are cryptographically verified to reside within the canonical `AssetFolderPath` root boundary before any file operation takes place.
* **DoS & Buffer Protections (CWE-400):** Incoming frames are enforced with maximum message limits (64 KB) to avoid memory exhaustion.

## Scheduled Tasks & Automation

The plugin registers a scheduled background task (default: daily at 02:00 AM) that automatically syncs and refreshes your libraries against local assets.

### Configuring the Sync Schedule

1. Open your Emby **Dashboard**.
2. In the left sidebar under the **Server** section, navigate to **Scheduled Tasks**.
3. Locate the **Posterizarr Sync Task** in the list.
4. Click on the task to customize its triggers:
    * You can configure the task to run on an interval, at a specific time of day (e.g., daily at 3:00 AM), on system startup, or on a weekly schedule.
5. You can also trigger the task manually at any time by clicking the **Play (Run)** button next to it.

## Building from Source

If you prefer to compile the plugin yourself from source code, run:

```bash
dotnet publish modules/Posterizarr.Plugin.Emby/Posterizarr.Plugin.Emby.csproj -c Release -o publish
```

The compiled `Posterizarr.Plugin.Emby.dll` will be located inside the `publish/` directory.
