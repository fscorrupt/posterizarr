# Posterizarr Plugin for Emby

**Middleware for asset lookup. Maps local assets to library items as posters, backgrounds, or titlecards.**

> This plugin is an Emby port of the original [Posterizarr Jellyfin Plugin](https://github.com/fscorrupt/posterizarr/tree/main/modules/Posterizarr.Plugin) by [fscorrupt](https://github.com/fscorrupt). All credit for the original idea, architecture, and implementation goes to him.
>
> This port was vibecoded using [Claude](https://claude.ai) (Anthropic).

## Overview

The Posterizarr Plugin acts as a local asset proxy for Emby. It is designed to work alongside the [Posterizarr](https://github.com/fscorrupt/posterizarr) automation script, allowing your media server to utilize locally generated or managed assets (posters, backgrounds, title cards) as metadata.

> [!IMPORTANT]
> This middleware does not allow you to browse, search, or download assets.
> Its sole purpose is to replace the default artwork by mapping library items to your local file system.

## Features

*   **Local Asset Mapping:** Maps local files to library items without replacing original metadata permanently in some configurations.
*   **Metadata Provider:** Registers as a metadata provider for images.
*   **Support for Multiple Asset Types:** Handles Posters, Backgrounds (Fanart), and Title Cards.
*   **Plex Direct Sync (Kometa Mirroring):** High-speed direct mirroring of active Plex artwork into Emby for movies, TV series, seasons, episode title cards, and backdrops. Bulk-queries Plex metadata in seconds and detects changes via Plex artwork version timestamps (disabled by default, enabled via plugin settings).
*   **Scheduled Sync Tasks:** 
    *   *Sync Posterizarr Assets* (local asset sync)
    *   *Sync Artwork from Plex* (direct Plex mass query)
*   **Hybrid Sync Support:** Real-Time Sync and Plex Direct Sync can be used together. New Posterizarr assets apply immediately via WebSocket, and scheduled Plex sync runs will replace them if Kometa overlays differ in Plex.

## Installation

1. Copy `Posterizarr.Plugin.dll` into the Emby plugin folder (e.g. `/config/plugins/`)
2. Restart Emby

## Configuration

1. After restarting, go to **Plugins** → **Installed Plugins** and click **Posterizarr**.
2. Click on **"Settings"**
3. Configure your **Root Asset Folder Path** (the directory where your curated images are stored, e.g. `/assets`).
4. Save.
5. Go to your **Dashboard** → **Libraries**.
6. Manage a library (e.g., Movies).
7. Enable **Posterizarr** under the **Image Fetchers** settings.
8. Ensure it is prioritized according to your preferences.
9. Refresh metadata (**Search for missing metadata** → **Replace existing images**) for your library to pick up local assets.

## Scheduled Tasks & Automation

The plugin registers two scheduled background tasks under **Scheduled Tasks**:

*   **Posterizarr Sync Task** (default: daily at 02:00 AM): Automatically syncs and refreshes your libraries against your local curated asset directory.
*   **Sync Artwork from Plex** (default: daily at 03:00 AM): High-speed direct query and mirroring of active artwork from Plex (only runs when *Enable Plex Direct Sync* is enabled).

> [!NOTE]
> If **Enable Plex Direct Sync** is turned on, the local *Posterizarr Sync Task* and image provider lookups are bypassed for movies and TV series so local asset files will never overwrite Kometa/Plex overlays. If **Update Collections** is enabled, the scheduled task will exclusively sync **Collections (BoxSets)** from collection asset folders (`/assets/Collections`). Real-Time Sync remains active to deliver new assets immediately, with Plex Direct Sync taking precedence when overlays differ.

### Configuring the Sync Schedule

1. Open your Emby **Dashboard**.
2. In the left sidebar under the **Server** section, navigate to **Scheduled Tasks**.
3. Locate **Posterizarr Sync Task** or **Sync Artwork from Plex** in the list.
4. Click on either task to customize its triggers:
    * You can configure the task to run on an interval, at a specific time of day (e.g., daily at 3:00 AM), on system startup, or on a weekly schedule.
5. You can also trigger either task manually at any time by clicking the **Play (Run)** button next to it.

## Building from Source

```bash
dotnet publish -c Release -o publish
```

The compiled `Posterizarr.Plugin.dll` will be in the `publish/` directory.
