# 🚀 API Endpoints

The following API endpoints are available.

**Authentication:**
- **Option 1 (Recommended):** Add `?api_key=YOUR_KEY` to the URL.
- **Option 2:** Use the `X-API-Key: YOUR_KEY` header.
- **Option 3:** Use Basic Authentication (username/password).
  - `http://admin:posterizarr@YOUR_IP:8000/api/webhook/tautulli`

---

## ⚙️ System

### `/api`
Returns the basic status of the API server.

??? example "View Response"
    ```json
    {
      "message": "Posterizarr Web UI API",
      "status": "running"
    }
    ```

### `/api/system-info`
Returns hardware and OS information about the host system.

??? example "View Response"
    ```json
    {
      "platform": "Linux",
      "os_version": "Alpine Linux v3.22",
      "cpu_model": "11th Gen Intel(R) Core(TM) i5-1145G7 @ 2.60GHz",
      "cpu_cores": 8,
      "total_memory": "63931 MB",
      "used_memory": "9589 MB",
      "free_memory": "54342 MB",
      "memory_percent": 15.0,
      "is_docker": true
    }
    ```

### `/api/version`
Checks installed version against remote GitHub version.

??? example "View Response"
    ```json
    {
      "local": "2.1.15",
      "remote": "2.1.15",
      "is_update_available": false
    }
    ```

### `/api/releases`
Fetches the latest release notes from GitHub.

??? example "View Response"
    ```json
    {
      "success": true,
      "releases": [
        {
          "version": "2.1.15",
          "name": "v2.1.15",
          "published_at": "2025-11-21T11:00:57Z",
          "days_ago": 4,
          "is_prerelease": false,
          "is_draft": false,
          "html_url": "[https://github.com/fscorrupt/posterizarr/releases/tag/2.1.15](https://github.com/fscorrupt/posterizarr/releases/tag/2.1.15)",
          "body": "## What's Changed\r\n* Fix missing assets in gallery..."
        }
      ]
    }
    ```

---

## 📊 Status & Monitoring

### `/api/status`
Returns the current execution status of the script.

??? example "View Response"
    ```json
    {
      "running": false,
      "manual_running": false,
      "scheduler_running": false,
      "scheduler_is_executing": false,
      "last_logs": [
        "[2025-11-25 16:34:18] [INFO]    |L.33500| Finished, Total images created: 0",
        "[2025-11-25 16:34:18] [INFO]    |L.6718 |      Text-size cache: hits='0', misses='0' (0%); magick_calls='0' in '0 ms'; est_saved='0h 0m 0s'",
        "[2025-11-25 16:34:18] [INFO]    |L.33561| Script execution time: 0h 4m 14s",
        "[2025-11-25 16:34:20] [INFO]    |L.6705 | Uptime Kuma webhook sent: Status=up, Msg=OK, Ping=254627"
      ],
      "script_exists": true,
      "config_exists": true,
      "pid": null,
      "current_mode": null,
      "active_log": "Scriptlog.log",
      "already_running_detected": false,
      "running_file_exists": false,
      "start_time": null
    }
    ```

### `/api/scheduler/status`
Details regarding the internal scheduler, next run times, and active jobs.

??? example "View Response"
    ```json
    {
      "success": true,
      "enabled": true,
      "running": true,
      "is_executing": false,
      "schedules": [
        {
          "time": "01:30",
          "description": "30min before Kometa"
        },
        {
          "time": "04:30",
          "description": "30min before Kometa"
        }
      ],
      "timezone": "Europe/Berlin",
      "last_run": "2025-11-25T16:30:00.002702",
      "next_run": "2025-11-25T19:30:00+01:00",
      "active_jobs": [
        {
          "id": "posterizarr_normal_6",
          "name": "Posterizarr Normal Mode @ 19:30",
          "next_run": "2025-11-25T19:30:00+01:00"
        }
      ]
    }
    ```

### `/api/runtime-history`
Returns a full history of previous script executions.

??? example "View Response"
    ```json
    {
      "success": true,
      "history": [
        {
          "id": 327,
          "timestamp": "2025-11-25T16:30:03",
          "mode": "scheduled",
          "runtime_seconds": 254,
          "runtime_formatted": "0h 4m 14s",
          "total_images": 0,
          "posters": 0,
          "seasons": 0,
          "backgrounds": 0,
          "titlecards": 0,
          "collections": 0,
          "errors": 0,
          "status": "completed"
        }
      ],
      "count": 50,
      "total": 327,
      "limit": 50,
      "offset": 0,
      "mode_filter": null
    }
    ```

### `/api/runtime-history?limit=10`
Returns a limited history of previous script executions.

??? example "View Response"
    ```json
    {
      "success": true,
      "history": [
        {
          "id": 327,
          "timestamp": "2025-11-25T16:30:03",
          "mode": "scheduled",
          "runtime_seconds": 254,
          "runtime_formatted": "0h 4m 14s",
          "total_images": 0,
          "status": "completed"
        }
      ],
      "count": 10,
      "total": 327,
      "limit": 10
    }
    ```

---

## 🔧 Configuration

### `/api/config`
Returns the full configuration.

!!! warning "Security Note"
    Sensitive keys (API Tokens, Passwords, Webhooks) have been redacted in the example below.

??? example "View Response"
    ```json
    {
      "success": true,
      "config": {
        "tvdbapi": "<REDACTED>",
        "tmdbtoken": "<REDACTED>",
        "FanartTvAPIKey": "<REDACTED>",
        "PlexToken": "<REDACTED>",
        "JellyfinAPIKey": "<REDACTED>",
        "EmbyAPIKey": "<REDACTED>",
        "FavProvider": "tmdb",
        "PreferredLanguageOrder": [
          "xx",
          "en",
          "de"
        ],
        "PlexUrl": "http://plex:32400",
        "UsePlex": "true",
        "JellyfinUrl": "http://jellyfin:8096",
        "UseJellyfin": "false",
        "EmbyUrl": "http://192.168.1.93:8096/emby",
        "UseEmby": "false",
        "SendNotification": "true",
        "AppriseUrl": "<REDACTED>",
        "UptimeKumaUrl": "<REDACTED>",
        "AssetPath": "/assets",
        "logLevel": "2",
        "basicAuthEnabled": "false",
        "basicAuthUsername": "admin",
        "basicAuthPassword": "<REDACTED>"
      },
      "ui_groups": {
        "WebUI Settings": [
          "basicAuthEnabled",
          "basicAuthUsername",
          "basicAuthPassword"
        ]
      },
      "display_names": {
        "tvdbapi": "TVDB API Key",
        "tmdbtoken": "TMDB API Token"
      },
      "tooltips": {},
      "using_flat_structure": true
    }
    ```

---

## 📁 Assets & File Management

### `/api/assets/overview`
Returns a categorized overview of assets (missing, non-primary language, etc.).

??? example "View Response"
    ```json
    {
      "categories": {
        "missing_assets": {
          "count": 0,
          "assets": []
        },
        "non_primary_lang": {
          "count": 13,
          "assets": [
            {
              "id": 54766,
              "Title": "Jurassic World: Die Chaostheorie | Season 2",
              "Type": "Season",
              "Rootfolder": "Jurassic World - Chaos Theory (2024) [tvdb-440997]",
              "LibraryName": "Kids Shows",
              "Language": "en",
              "has_poster": true
            }
          ]
        },
        "resolved": {
          "count": 34,
          "assets": [
            {
              "id": 53663,
              "Title": "S01E01 | WILLKOMMEN IN PARADISE",
              "Type": "Episode",
              "LibraryName": "TV Shows",
              "Language": "Textless",
              "has_poster": true
            }
          ]
        }
      },
      "config": {
        "primary_language": "xx",
        "primary_provider": "tmdb"
      }
    }
    ```

### `/api/assets/stats`
Returns storage usage and file counts per library folder.

??? example "View Response"
    ```json
    {
      "success": true,
      "stats": {
        "posters": 2313,
        "backgrounds": 0,
        "seasons": 2179,
        "titlecards": 34425,
        "total_size": 83481927747,
        "folders": [
          {
            "name": "Anime Shows",
            "path": "Anime Shows",
            "poster_count": 355,
            "files": 16519,
            "size": 31830640233
          },
          {
            "name": "TV Shows",
            "path": "TV Shows",
            "poster_count": 382,
            "files": 13795,
            "size": 32606586825
          }
        ]
      }
    }
    ```

### `/api/assets-folders`
Returns a specific list of asset folders and their counts.

??? example "View Response"
    ```json
    {
      "folders": [
        {
          "name": "4K Movies",
          "path": "4K Movies",
          "files": 66,
          "size": 152763048
        },
        {
          "name": "TV Shows",
          "path": "TV Shows",
          "files": 13795,
          "size": 32606586825
        }
      ]
    }
    ```

### `/api/manual-assets-gallery`
Returns a structure for the manual asset selector UI.

??? example "View Response"
    ```json
    {
      "libraries": [
        {
          "name": "4K TV Shows",
          "folders": [
            {
              "name": "Dexter - Original Sin (2024) [tvdb-430780]",
              "path": "4K TV Shows/Dexter - Original Sin (2024) [tvdb-430780]",
              "assets": [
                {
                  "name": "poster.jpg",
                  "path": "4K TV Shows/Dexter - Original Sin (2024) [tvdb-430780]/poster.jpg",
                  "type": "poster",
                  "url": "/manual_poster_assets/4K%20TV%20Shows/Dexter%20-%20Original%20Sin%20%282024%29%20%5Btvdb-430780%5D/poster.jpg"
                }
              ],
              "asset_count": 1
            }
          ],
          "folder_count": 3
        }
      ],
      "total_assets": 226
    }
    ```

### `/api/overlayfiles`
Lists available overlay image files and fonts.

??? example "View Response"
    ```json
    {
      "success": true,
      "files": [
        {
          "name": "Colus-Regular.ttf",
          "type": "font",
          "extension": ".ttf",
          "size": 87484
        },
        {
          "name": "overlay-innerglow.png",
          "type": "image",
          "extension": ".png",
          "size": 42936
        }
      ]
    }
    ```

### `/api/folder-view/browse`
Browses the root folder structure of assets.

??? example "View Response"
    ```json
    {
      "success": true,
      "path": "",
      "items": [
        {
          "type": "folder",
          "name": "4K Movies",
          "path": "4K Movies",
          "item_count": 66
        },
        {
          "type": "folder",
          "name": "TV Shows",
          "path": "TV Shows",
          "item_count": 383
        }
      ]
    }
    ```

---

## 🎬 Plex Export

### `/api/plex-export/statistics`
Statistics regarding the Plex library export CSVs.

??? example "View Response"
    ```json
    {
      "success": true,
      "statistics": {
        "total_runs": 8,
        "total_library_records": 2315,
        "total_episode_records": 2145,
        "latest_run": "2025-11-25T16:31:22.63845"
      }
    }
    ```

### `/api/plex-export/runs`
List of timestamps for previous Plex export runs.

??? example "View Response"
    ```json
    {
      "success": true,
      "runs": [
        "2025-11-25T16:31:22.63845",
        "2025-11-22T01:31:13.933402"
      ],
      "count": 8
    }
    ```

---

## 🎞️ Other Media Export

### `/api/other-media-export/statistics`
Statistics regarding non-Plex media exports.

??? example "View Response"
    ```json
    {
      "success": true,
      "statistics": {
        "total_runs": 0,
        "total_library_records": 0,
        "total_episode_records": 0,
        "latest_run": null
      }
    }
    ```

### `/api/other-media-export/runs`
List of timestamps for previous non-Plex export runs.

??? example "View Response"
    ```json
    {
      "success": true,
      "runs": [],
      "count": 0
    }
    ```

---

## 🖥️ Dashboard & Logs

### `/api/dashboard/all`
A combined endpoint used to populate the main dashboard (Status + Version + System Info).

??? example "View Response"
    ```json
    {
      "success": true,
      "status": {
        "running": false,
        "manual_running": false,
        "scheduler_running": false,
        "active_log": "Scriptlog.log"
      },
      "version": {
        "local": "2.1.15",
        "remote": "2.1.15",
        "is_update_available": false
      },
      "scheduler_status": {
        "enabled": true,
        "next_run": "2025-11-25T19:30:00+01:00"
      },
      "system_info": {
        "platform": "Linux",
        "cpu_cores": 8,
        "memory_percent": 15.0,
        "is_docker": true
      }
    }
    ```

### `/api/logs`
Lists available log files on the server.

??? example "View Response"
    ```json
    {
      "logs": [
        {
          "name": "BackendServer.log",
          "size": 2354179,
          "directory": "UILogs"
        },
        {
          "name": "Scriptlog.log",
          "size": 27563,
          "directory": "Logs"
        }
      ]
    }
    ```

## 🔔 Webhooks

### `/api/webhook/arr`
Endpoint for Sonarr and Radarr `On Import` and `On Upgrade` webhooks. Converts the Arr JSON payload into a trigger file.

??? example "View Response"
    ```json
    {
      "success": true,
      "message": "Trigger queued for Radarr",
      "file": "/config/watcher/recently_added_20251125120000_a1b2c3.posterizarr"
    }
    ```

### `/api/webhook/tautulli`
Endpoint for Tautulli notifications. Maps incoming JSON keys directly to script arguments.

??? example "View Response"
    ```json
    {
      "success": true,
      "message": "Tautulli trigger queued",
      "file": "/config/watcher/tautulli_trigger_20251125120000_x9y8z7.posterizarr"
    }
    ```
---

## ?? Authentication & Onboarding

### `/api/onboarding/complete`
Submits data or triggers an action at `/api/onboarding/complete`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/auth/check`
Retrieves data from `/api/auth/check`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/auth/keys`
Retrieves data from `/api/auth/keys`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/auth/keys`
Submits data or triggers an action at `/api/auth/keys`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/auth/keys/{key_id}`
Deletes a resource at `/api/auth/keys/{key_id}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```


---

## ?? Connection Validation

### `/api/validate/plex`
Submits data or triggers an action at `/api/validate/plex`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/validate/jellyfin`
Submits data or triggers an action at `/api/validate/jellyfin`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/validate/emby`
Submits data or triggers an action at `/api/validate/emby`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/validate/tmdb`
Submits data or triggers an action at `/api/validate/tmdb`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/validate/tvdb`
Submits data or triggers an action at `/api/validate/tvdb`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/validate/fanart`
Submits data or triggers an action at `/api/validate/fanart`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/validate/discord`
Submits data or triggers an action at `/api/validate/discord`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/validate/apprise`
Submits data or triggers an action at `/api/validate/apprise`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/validate/uptimekuma`
Submits data or triggers an action at `/api/validate/uptimekuma`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/validate/agregarr`
Validates the Agregarr URL and API key against its read-only Posterizarr
integration status endpoint.

??? example "View Response"
    ```json
    {
      "valid": true,
      "message": "Agregarr connection and API key are valid.",
      "details": {
        "status_code": 200
      }
    }
    ```


---

## ?? Library & Server Management

### `/api/plex/action`
Submits data or triggers an action at `/api/plex/action`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/jellyfin-emby/action`
Submits data or triggers an action at `/api/jellyfin-emby/action`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/libraries/{server_type}/cached`
Retrieves data from `/api/libraries/{server_type}/cached`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/libraries/{server_type}/exclusions`
Submits data or triggers an action at `/api/libraries/{server_type}/exclusions`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/libraries/plex`
Submits data or triggers an action at `/api/libraries/plex`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/libraries/jellyfin`
Submits data or triggers an action at `/api/libraries/jellyfin`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/libraries/emby`
Submits data or triggers an action at `/api/libraries/emby`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/libraries/plex/items`
Submits data or triggers an action at `/api/libraries/plex/items`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```


---

## ?? Script Execution & Control

### `/api/run/{mode}`
Submits data or triggers an action at `/api/run/{mode}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/run-manual`
Submits data or triggers an action at `/api/run-manual`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/run-manual-upload`
Submits data or triggers an action at `/api/run-manual-upload`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/run-logoupdater`
Submits data or triggers an action at `/api/run-logoupdater`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/run-restore`
Submits data or triggers an action at `/api/run-restore`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/reset-posters`
Submits data or triggers an action at `/api/reset-posters`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/tmdb/search-posters`
Submits data or triggers an action at `/api/tmdb/search-posters`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/stop`
Submits data or triggers an action at `/api/stop`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/force-kill`
Submits data or triggers an action at `/api/force-kill`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```


---

## ??? Asset Galleries & Image Choices

### `/api/assets/skip`
Adds the `skip_posterizarr` tag/label to the specified asset in the active media server and removes it from the Action Center.

**Payload**:
```json
{
  "asset_id": 123
}
```

??? example "View Response"
    ```json
    {
      "success": true,
      "message": "Successfully skipped item in Plex"
    }
    ```

### `/api/gallery`
Retrieves data from `/api/gallery`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/gallery/{path:path}`
Deletes a resource at `/api/gallery/{path:path}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/gallery/bulk-delete`
Submits data or triggers an action at `/api/gallery/bulk-delete`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/backgrounds-gallery`
Retrieves data from `/api/backgrounds-gallery`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/backgrounds/{path:path}`
Deletes a resource at `/api/backgrounds/{path:path}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/backgrounds/bulk-delete`
Submits data or triggers an action at `/api/backgrounds/bulk-delete`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/seasons-gallery`
Retrieves data from `/api/seasons-gallery`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/seasons/{path:path}`
Deletes a resource at `/api/seasons/{path:path}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/seasons/bulk-delete`
Submits data or triggers an action at `/api/seasons/bulk-delete`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/titlecards-gallery`
Retrieves data from `/api/titlecards-gallery`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/titlecards/{path:path}`
Deletes a resource at `/api/titlecards/{path:path}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/titlecards/bulk-delete`
Submits data or triggers an action at `/api/titlecards/bulk-delete`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/manual-assets/{path:path}`
Deletes a resource at `/api/manual-assets/{path:path}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/manual-assets/bulk-delete`
Submits data or triggers an action at `/api/manual-assets/bulk-delete`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/backup-assets-gallery`
Retrieves data from `/api/backup-assets-gallery`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/backup-assets/{path:path}`
Deletes a resource at `/api/backup-assets/{path:path}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/backup-assets/bulk-delete`
Submits data or triggers an action at `/api/backup-assets/bulk-delete`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/thumbnail`
Retrieves data from `/api/thumbnail`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/assets-folder-images/{image_type}/{folder_path:path}`
Retrieves data from `/api/assets-folder-images/{image_type}/{folder_path:path}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/recent-assets`
Retrieves data from `/api/recent-assets`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/asset-type-lookup`
Retrieves data from `/api/asset-type-lookup`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/test-gallery`
Retrieves data from `/api/test-gallery`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/imagechoices`
Retrieves data from `/api/imagechoices`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/imagechoices`
Submits data or triggers an action at `/api/imagechoices`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/imagechoices/{title}`
Retrieves data from `/api/imagechoices/{title}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/imagechoices/{record_id}`
Updates a resource at `/api/imagechoices/{record_id}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/imagechoices/{record_id}`
Deletes a resource at `/api/imagechoices/{record_id}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/imagechoices/{record_id}/find-asset`
Retrieves data from `/api/imagechoices/{record_id}/find-asset`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/imagechoices/import`
Submits data or triggers an action at `/api/imagechoices/import`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```


---

## ?? Assets Replacement & Operations

### `/api/assets/fetch-replacements`
Submits data or triggers an action at `/api/assets/fetch-replacements`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/assets/upload-replacement`
Submits data or triggers an action at `/api/assets/upload-replacement`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/assets/replace-from-url`
Submits data or triggers an action at `/api/assets/replace-from-url`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/assets/delete-asset/{record_id}`
Deletes a resource at `/api/assets/delete-asset/{record_id}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/assets/bulk-delete-assets`
Submits data or triggers an action at `/api/assets/bulk-delete-assets`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/refresh-cache`
Submits data or triggers an action at `/api/refresh-cache`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/cache/status`
Retrieves data from `/api/cache/status`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```


---

## ?? Scheduler & Queue Management

### `/api/scheduler/config`
Retrieves data from `/api/scheduler/config`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/scheduler/config`
Submits data or triggers an action at `/api/scheduler/config`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/scheduler/schedule`
Submits data or triggers an action at `/api/scheduler/schedule`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/scheduler/schedule/{time}`
Deletes a resource at `/api/scheduler/schedule/{time}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/scheduler/schedules`
Deletes a resource at `/api/scheduler/schedules`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/scheduler/enable`
Submits data or triggers an action at `/api/scheduler/enable`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/scheduler/disable`
Submits data or triggers an action at `/api/scheduler/disable`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/scheduler/restart`
Submits data or triggers an action at `/api/scheduler/restart`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/scheduler/run-now`
Submits data or triggers an action at `/api/scheduler/run-now`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/queue`
Retrieves data from `/api/queue`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/queue/{item_id}`
Deletes a resource at `/api/queue/{item_id}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/queue/clear`
Submits data or triggers an action at `/api/queue/clear`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/queue/run`
Submits data or triggers an action at `/api/queue/run`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/queue/delete`
Submits data or triggers an action at `/api/queue/delete`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```


---

## ??? Fonts & Overlay Creator

### `/api/overlayfiles/upload`
Submits data or triggers an action at `/api/overlayfiles/upload`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/overlayfiles/{filename}`
Deletes a resource at `/api/overlayfiles/{filename}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/overlayfiles/preview/{filename}`
Retrieves data from `/api/overlayfiles/preview/{filename}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/fonts`
Retrieves data from `/api/fonts`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/fonts/upload`
Submits data or triggers an action at `/api/fonts/upload`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/fonts/{filename}`
Deletes a resource at `/api/fonts/{filename}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/fonts/download/{filename}`
Retrieves data from `/api/fonts/download/{filename}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/fonts/preview/{filename}`
Retrieves data from `/api/fonts/preview/{filename}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/overlay-creator/preview`
Submits data or triggers an action at `/api/overlay-creator/preview`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/overlay-creator/save`
Submits data or triggers an action at `/api/overlay-creator/save`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```


---

## ?? Runtime History & Exports Additional

### `/api/runtime-stats`
Retrieves data from `/api/runtime-stats`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/runtime-summary`
Retrieves data from `/api/runtime-summary`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/runtime-history/cleanup`
Deletes a resource at `/api/runtime-history/cleanup`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/runtime-history/migrate`
Submits data or triggers an action at `/api/runtime-history/migrate`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/runtime-history/migration-status`
Retrieves data from `/api/runtime-history/migration-status`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/runtime-history/migrate-format`
Submits data or triggers an action at `/api/runtime-history/migrate-format`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/runtime-history/import-json`
Submits data or triggers an action at `/api/runtime-history/import-json`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/plex-export/library`
Retrieves data from `/api/plex-export/library`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/plex-export/episodes`
Retrieves data from `/api/plex-export/episodes`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/plex-export/import`
Submits data or triggers an action at `/api/plex-export/import`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/other-media-export/library`
Retrieves data from `/api/other-media-export/library`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/other-media-export/episodes`
Retrieves data from `/api/other-media-export/episodes`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/other-media-export/import`
Submits data or triggers an action at `/api/other-media-export/import`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```


---

## ?? Additional Configuration & Database

### `/api/config/backup`
Submits data or triggers an action at `/api/config/backup`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/config/export`
Retrieves data from `/api/config/export`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/config/import`
Submits data or triggers an action at `/api/config/import`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/custom-blueprints`
Retrieves data from `/api/custom-blueprints`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/custom-blueprints`
Submits data or triggers an action at `/api/custom-blueprints`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/config-db/status`
Retrieves data from `/api/config-db/status`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/config-db/section/{section}`
Retrieves data from `/api/config-db/section/{section}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/config-db/value/{section}/{key}`
Retrieves data from `/api/config-db/value/{section}/{key}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/config-db/sync`
Submits data or triggers an action at `/api/config-db/sync`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/config-db/export`
Retrieves data from `/api/config-db/export`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/webui-settings`
Retrieves data from `/api/webui-settings`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/webui-settings`
Submits data or triggers an action at `/api/webui-settings`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```


---

## ?? Logs, Diagnostics & Misc

### `/api/logs/ui`
Submits data or triggers an action at `/api/logs/ui`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/logs/ui/batch`
Submits data or triggers an action at `/api/logs/ui/batch`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/logs/{log_name}`
Retrieves data from `/api/logs/{log_name}`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/logs/{log_name}/exists`
Retrieves data from `/api/logs/{log_name}/exists`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/logs/ui/unified`
Retrieves data from `/api/logs/ui/unified`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/upload-diagnostics`
Retrieves data from `/api/upload-diagnostics`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/admin/support-zip`
Submits data or triggers an action at `/api/admin/support-zip`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/logs-watcher/status`
Retrieves data from `/api/logs-watcher/status`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/analytics/providers`
Retrieves data from `/api/analytics/providers`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/running-file`
Deletes a resource at `/api/running-file`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/version-ui`
Retrieves data from `/api/version-ui`.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

---

## 🎨 Creator Mode & Collections

### `GET /api/collections/presets`
Get collection presets from the configuration database.

??? example "View Response"
    ```json
    [
      {
        "id": "1234567890",
        "name": "My Custom Blue Preset",
        "bgType": "texture",
        "overlayImage": "data:image/png;base64,..."
      }
    ]
    ```

### `POST /api/collections/presets`
Save collection presets to the configuration database.

### `POST /api/collections/save`
Save the generated collection poster locally in the Assets directory.

### `POST /api/collections/upload-to-server`
Upload a poster directly to the connected Media Server (Plex, Jellyfin, Emby).

### `POST /api/media-server/collections`
Fetch collections directly from the configured media server.

### `GET /api/studio-logos`
Get the list of available studio logos from the GitHub repository, caching them locally.

### `GET /api/studio-logos/image/{filename}`
Serve a specific studio logo image from the local cache.

### `POST /api/collections/search`
Search TMDB for collections by name or ID (e.g. `tmdb:12345`).

### `POST /api/media/logos`
Search TMDB for media (movies or TV shows) and retrieve their logos.

### `GET /api/proxy-image`
Proxy external images (like TMDB/Fanart) to avoid CORS issues on the frontend canvas.
