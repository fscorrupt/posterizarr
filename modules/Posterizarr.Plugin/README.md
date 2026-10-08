# Posterizarr Plugin for Jellyfin

**Middleware for asset lookup. Maps local assets to library items as posters, backgrounds, or titlecards.**

## Overview

The Posterizarr Plugin acts as a local asset proxy for Jellyfin. It is designed to work alongside the [Posterizarr](https://github.com/fscorrupt/posterizarr) automation script, allowing your media server to utilize locally generated or managed assets (posters, backgrounds, title cards) as metadata.

> [!IMPORTANT]
> This middleware does not allow you to browse, search, or download assets.
> Its sole purpose is to replace the default artwork by mapping library items to your local file system.

## Features

*   **Local Asset Mapping:** Maps local files to library items without replacing original metadata permanently in some configurations.
*   **Metadata Provider:** Registers as a metadata provider for images.
*   **Support for Multiple Asset Types:** Handles Posters, Backgrounds (Fanart), and Title Cards.
*   **Plex Direct Sync (Kometa Mirroring):** High-speed direct mirroring of active Plex artwork into Jellyfin for movies, TV series, seasons, episode title cards, and backdrops. Bulk-queries Plex metadata in seconds and detects changes via Plex artwork version timestamps (disabled by default, enabled via plugin settings).
*   **Real-Time WebSocket Sync:** Listens for live asset events from Posterizarr to immediately apply changes.
*   **Hybrid Sync Support:** Real-Time Sync and Plex Direct Sync can be used together. New Posterizarr assets apply immediately via WebSocket, and scheduled Plex sync runs will replace them if Kometa overlays differ in Plex.
*   **Broad Version Compatibility:** Multi-targeted for **Jellyfin 10.11.x** (.NET 9) and **Jellyfin 12.0.x** (.NET 10). The plugin repository manifest automatically serves the appropriate build for your server version.

## Installation

### Via Repository (Recommended)

1.  Open your Jellyfin **Dashboard**.
2.  Navigate to **Plugins** -> **Repositories**.
3.  Click **Add** and enter the following information:
    *   **Repository Name:** Posterizarr
    *   **Repository URL:** `https://raw.githubusercontent.com/fscorrupt/posterizarr/main/manifest.json`
4.  Navigate to the **Catalog** tab.
5.  Find **Posterizarr** under the **Metadata** category.
6.  Click **Install** and choose the latest version.
7.  **Restart** your server.

## Configuration

1. After restarting, go to **Plugins** → **Installed Plugins** and click **Posterizarr**.
1. Click on **"Settings"**
1. Configure your Asset Root Path (the directory where your curated images are stored).
1. Safe it
1. Go to your **Dashboard** -> **Libraries**.
1. Manage a library (e.g., Movies).
1. Enable **Posterizarr** under the **Image Fetchers** settings.
1. Ensure it is prioritized according to your preferences.
1. Refresh metadata (Search for missing metadata → **Replace existing images**) for your library to pick up local assets.

## Scheduled Tasks & Automation

The plugin registers two scheduled background tasks under **Scheduled Tasks**:

*   **Posterizarr Sync Task** (default: daily at 02:00 AM): Automatically syncs and refreshes your libraries against your local curated asset directory.
*   **Sync Artwork from Plex** (default: daily at 03:00 AM): High-speed direct query and mirroring of active artwork from Plex (only runs when *Enable Plex Direct Sync* is enabled).

> [!NOTE]
> If **Enable Plex Direct Sync** is turned on, the local *Posterizarr Sync Task* and image provider lookups are bypassed for movies and TV series so local asset files will never overwrite Kometa/Plex overlays. If **Update Collections** is enabled, the scheduled task will exclusively sync **Collections (BoxSets)** from collection asset folders (`/assets/Collections`). Real-Time Sync remains active to deliver new assets immediately, with Plex Direct Sync taking precedence when overlays differ.

### Configuring the Sync Schedule

1. Open your Jellyfin **Dashboard**.
2. In the left sidebar under the **Server** section, navigate to **Scheduled Tasks**.
3. Locate **Posterizarr Sync Task** or **Sync Artwork from Plex** in the list.
4. Click on either task to customize its triggers:
    * You can configure the task to run on an interval, at a specific time of day (e.g., daily at 3:00 AM), on system startup, or on a weekly schedule.
5. You can also trigger either task manually at any time by clicking the **Play (Run)** button next to it.

## Building from Source

```bash
# Build for both Jellyfin 10.11.x (.NET 9) and 12.0.x (.NET 10)
dotnet build -c Release

# Or publish specifically for a target version:
dotnet publish -c Release -f net9.0 -o publish/net9.0
dotnet publish -c Release -f net10.0 -o publish/net10.0
```

The compiled `Posterizarr.Plugin.dll` will be placed in the respective output folder.