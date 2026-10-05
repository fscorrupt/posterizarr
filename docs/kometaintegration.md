# Kometa Integration

Posterizarr generates assets in a folder structure that is fully compatible with [Kometa](https://kometa.wiki/en/latest/kometa/guides/assets/), eliminating the need for manual renaming or relocation.

If you are using both Posterizarr and Kometa, the most efficient setup is to point Kometa directly to the Posterizarr output directory.

## 1. Docker Volume Mount

If you are running Kometa in Docker (e.g., via Docker Compose or Synology Container Manager), the best approach is to mount your local Posterizarr assets directory directly into the Kometa container.

This ensures your Posterizarr assets are immediately accessible to Kometa at its default `/assets` path, without any additional scripts or syncing.

Update your Kometa `docker-compose.yml` to include the Posterizarr output location in the `volumes` section:

```yaml
services:
  kometa:
    image: kometateam/kometa
    container_name: kometa
    volumes:
      # This mounts your local Posterizarr folder to the default Kometa path
      - /path/to/your/posterizarr/assets:/assets
      # You can leave other volumes exactly as they are
      - /path/to/your/kometa/config:/config
```

!!! note
    Ensure that `/path/to/your/posterizarr/assets` points to the directory defined as the `AssetPath` in your Posterizarr configuration.

!!! warning "Asset loss"
    Mounting your Posterizarr directory directly to `/assets` is only recommended if you **do not** already have existing assets stored in Kometa's default `/assets` directory. If you have existing assets there, you should mount the Posterizarr output to a different path (e.g., `/posterizarr-assets`) and adjust your Kometa `asset_directory` settings accordingly to avoid conflicts.

## 2. Kometa Configuration per Library

Once the directory is mounted to `/assets` in the Kometa container, you must configure Kometa to use this directory for your libraries.

Add the following settings to your Kometa configuration file (e.g., `config.yml`) for each library you want Kometa to manage assets for. Note that the folder name (e.g., `4K TV Shows`) should match the exact name of the library as exported by Posterizarr.

```yaml
libraries:
  "4K TV Shows":
    # Metadata files configurations...
    
    # Asset directory settings
    settings:
      asset_directory: /assets/4K TV Shows
      prioritize_assets: true
      
    # Operations
    operations:
      assets_for_all: true
```

### Explanation of Settings

- **`asset_directory`**: Tells Kometa specifically where to find the images for this library. Because we mapped the Posterizarr assets directly into `/assets`, the path corresponds directly to `/assets/YourLibraryName`.
- **`prioritize_assets`**: Ensures Kometa prioritizes found local image assets over downloading from metadata agents, preserving the textless images you generated.
- **`assets_for_all`**: Instructs Kometa to apply these assets to all matches within the library during an operation run.

## 3. Kometa and Real-Time Triggers (Tautulli / *Arr Webhooks)

A common question is how Posterizarr's `PlexUpload` configuration behaves alongside Kometa when using real-time triggers:

- **Scheduled & Normal Runs:** Setting `"PlexUpload": "false"` in `config.json` ensures Posterizarr does **not** upload to Plex during scheduled batch runs. Posterizarr will solely save generated assets to your `/assets` directory, allowing Kometa to pick them up, apply its overlays, and handle the final upload to Plex.
- **Trigger Modes (Tautulli / *Arr Webhooks):** When triggered by newly added media events, Posterizarr **intentionally forces direct upload to Plex** (`Upload2Plex = true`), bypassing `PlexUpload: false`. This design ensures that newly imported movies or episodes immediately receive custom artwork in Plex rather than displaying default agent artwork or blank posters until your next scheduled Kometa run (which may only run once daily or every few days). Kometa will still process the asset and apply its overlays over the artwork during its next scheduled cycle.
- **Pure Kometa-Only Upload Workflow:** If you want strictly zero uploads from Posterizarr so that *only* the finished poster with Kometa overlays is ever pushed to Plex, **do not configure Tautulli or *Arr triggers**. Instead, schedule Posterizarr regular batch runs to execute shortly before your Kometa scheduled run.

## 4. Kometa and Scheduled Plex Sync (Important Warning)

> [!WARNING]
> **Do NOT use the automated Plex Sync schedule (`plexsync`) on media managed by Kometa!**
> 
> The WebUI includes a lightweight **Plex Sync** schedule mode designed to directly upload artwork (posters, seasons, titlecards, backgrounds, and collections) from your local `/assets` directory to Plex via REST API.
> 
> If you run a Plex Sync schedule on libraries managed by Kometa:
> 1. Kometa uploads its own overlaid artwork and metadata to Plex.
> 2. Posterizarr's Plex Sync detects that the artwork currently live on Plex does not match the clean, un-overlaid local file in `/assets`.
> 3. Plex Sync attempts to re-upload the local file, overwriting Kometa's overlays.
> 4. Kometa runs its next cycle and overwrites Posterizarr's upload again, causing an **endless overwrite loop**.
> 
> **Best Practice:** If you use Kometa to manage posters/overlays, either:
> - **Only** use Plex Sync for **Collections / BoxSets** (by checking *Collections Only*), provided Kometa is not managing collection artwork.
> - Or leave artwork uploads entirely to Kometa.

## Summary

By doing these two simple steps: 
1. Mounting the Posterizarr output folder to Kometa's `/assets` 
2. Configuring Kometa's library settings to point to this directory

You fully automate your asset pipeline between Posterizarr and Kometa.
