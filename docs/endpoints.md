# 🚀 API Endpoints

The following API endpoints are available.

**Authentication:**
- **Option 1 (Recommended):** Add `?api_key=YOUR_KEY` to the URL.
- **Option 2:** Use the `X-API-Key: YOUR_KEY` header.
- **Option 3:** Use Basic Authentication (username/password).
  - `http://admin:posterizarr@YOUR_IP:8000/api/webhook/tautulli`

---

## External Provider API

These endpoints are opt-in: they do not change regular Posterizarr runs or
media-server artwork. Both require a Posterizarr API key in the `X-API-Key`
header or as an `Authorization: Bearer` token, even when Web UI authentication
is disabled. Create a key in the Web UI. Query-string keys and Basic Auth are
not accepted by these endpoints.

### `GET /api/provider/v1/asset/{media_type}/{item_id}`

`GET /api/provider/v1/poster/{media_type}/{item_id}` remains as a backwards-
compatible alias. `media_type` is `movie` or `show`; the response is a JPEG.
`asset_type` selects `poster` (default), `background`, `season`, or `titlecard`.
Season and titlecard requests require `season_number`; titlecards also require
`episode_number`. Seasons and titlecards require `media_type=show`.

`provider` can be `auto` (default), `tmdb`, or `tvdb`. With `auto` or `tmdb`,
`item_id` is a TMDb ID; `tvdb_id` may additionally be supplied so the configured
provider order can try TVDB. With `provider=tvdb`, `item_id` is a TVDB ID and
`tmdb_id` may be supplied for TMDb fallback. For shows, Posterizarr attempts to
resolve a missing TVDB ID through TMDb's external IDs. Artwork selection follows
`ProviderPriorityMode`, `FavProvider`, `ProviderOrder`, and the per-media-type
provider order. This API currently searches TMDb and TVDB; Fanart and Plex
providers are not yet queried here.

The requested asset's Posterizarr language list is used: `PreferredLanguageOrder`
for posters, `PreferredBackgroundLanguageOrder` for backgrounds,
`PreferredSeasonLanguageOrder` for seasons, and `PreferredTCLanguageOrder` for
titlecards. `PleaseFillMe` inherits the standard poster order, and
`TmdbLanguageMappings` applies to TMDb requests. The caption uses the selected
provider's localized title when available. If TVDB artwork has no matching
title translation, Posterizarr uses the localized TMDb title, then TMDb's
English default. A TVDB-only request without a resolvable TMDb ID can only use
the TVDB title when available. TMDb is also the artwork fallback according to
the configured provider order.

Posterizarr applies the corresponding manual settings from `config.json` (text,
font, borders, and overlays) in an isolated temporary workspace. Dynamic Overlay
YAML rules are not applied. The result is cached separately in
`database/provider_posters`; the cache key includes asset type, IDs, season or
episode coordinates, and relevant provider/language/render settings. Existing
assets are never overwritten and no media-server upload is performed.

Pass `create=false` for lookup only. Without `library`, an existing matching
asset or API cache entry may be returned, but no new asset is created. When
`library` is provided, only an existing asset in that library is returned; the
API cache is not used. Ambiguous existing matches return `409` and require
`library`. A TMDb key is
required for TMDb lookup/fallback; a TVDB key is required for TVDB. Creating an
asset requires PowerShell 7 and ImageMagick. Missing artwork returns `404`;
rendering or upstream failures return `502` or `503`.

```bash
# Existing/default poster request (same URL as before)
curl -H "X-API-Key: YOUR_KEY" "http://posterizarr:8000/api/provider/v1/poster/movie/603" --output poster.jpg

# TVDB-first show season poster
curl -H "X-API-Key: YOUR_KEY" "http://posterizarr:8000/api/provider/v1/asset/show/603?tvdb_id=121361&asset_type=season&season_number=2" --output season.jpg

# TMDb show season poster
curl -H "X-API-Key: YOUR_KEY" "http://posterizarr:8000/api/provider/v1/asset/show/603?provider=tmdb&asset_type=season&season_number=2" --output season.jpg

# TVDB episode titlecard, with TMDb ID available for localized title fallback
curl -H "X-API-Key: YOUR_KEY" "http://posterizarr:8000/api/provider/v1/asset/show/121361?provider=tvdb&tmdb_id=603&asset_type=titlecard&season_number=2&episode_number=3" --output titlecard.jpg

# TMDb episode titlecard
curl -H "X-API-Key: YOUR_KEY" "http://posterizarr:8000/api/provider/v1/asset/show/603?provider=tmdb&asset_type=titlecard&season_number=2&episode_number=3" --output titlecard.jpg
```

The API requires an authentication header. A consumer that only supplies a
`url_poster` URL to Plex cannot use it directly unless it can provide that
header; a Kometa integration would need to download the image with credentials
and upload the downloaded file. Do not put an API key in a URL.

### `GET /api/provider/v1/ratings/{media_type}/{item_id}`

`media_type` is `movie` or `show`. With `provider=auto` (the default), a
numeric `item_id` is treated as a TMDb ID and an IMDb ID beginning with `tt` is
detected automatically. Set `provider=tmdb`, `provider=tvdb`, or
`provider=imdb` to specify the ID type explicitly. Optional `tmdb_id`,
`tvdb_id`, and `imdb_id` query parameters can supply additional identifiers.
Posterizarr resolves missing cross-IDs through TMDb or TVDB where configured,
then queries the configured TMDb, MDBList, SIMKL, and OMDb rating sources.
**TVDB and IMDb here are identifier types, not new rating providers**; TVDB
ratings themselves are not currently fetched. The response includes all IDs it
resolved, omits unavailable ratings, and identifies the provider for each score.

```bash
# Existing TMDb form
curl -H "X-API-Key: YOUR_KEY" "http://posterizarr:8000/api/provider/v1/ratings/movie/603"

# TVDB or IMDb identifier forms
curl -H "X-API-Key: YOUR_KEY" "http://posterizarr:8000/api/provider/v1/ratings/show/121361?provider=tvdb"
curl -H "X-API-Key: YOUR_KEY" "http://posterizarr:8000/api/provider/v1/ratings/movie/tt0133093?provider=imdb"
```

The endpoint is not a full metadata API and does not yet support seasons,
episodes, Floppy ratings, or the local IMDb dataset. Results do not write into
the Dynamic Overlays ratings cache; successful responses are held in a separate
in-memory cache for 15 minutes. Provider failures are reported in `providers`,
and complete upstream failure returns `502`; missing rating-provider
configuration returns `503`.

```json
{
  "media_type": "movie",
  "tmdb_id": 603,
  "imdb_id": "tt0133093",
  "scale": 10,
  "ratings": {
    "tmdb": {"value": 8.2, "source": "tmdb"},
    "rt_critic": {"value": 8.3, "source": "mdblist"}
  },
  "providers": {"tmdb": "success", "mdblist": "success"}
}
```

Kometa does not currently have a generic HTTP ratings-provider configuration.
A Kometa feature request or adapter must register the Posterizarr rating
variables, authenticate, map item IDs and consume this API. Existing Kometa
configurations are unaffected.

---

## Dynamic Overlays

| Endpoint | Purpose |
|---|---|
| `GET /api/dynamic-overlays/episode-title-changes` | Paged review candidates. Optional `search`, `limit`, `offset`, `status_filter` (`all`, `eligible`, `blocked`), `reason_filter` (`all`, `none`, or a blocking reason), and `review_type` (`all`, `historical`, `future`) filter the result set and eligible count. |
| `POST /api/dynamic-overlays/episode-title-changes/rebuild` | Confirmed queue recreation; returns `409` while another run is active. `candidate_ids` or `all_eligible` with `search` and the same filters selects candidates. Optional `force_unknown_text: true` includes safe uncertain-text candidates and media-server originals (re-downloaded and EXIF-checked) in either selection. |
| `POST /api/dynamic-overlays/episode-title-changes/queue` | Confirmed queueing with the same body as `rebuild`. Allowed while a run is active. Returns `queued` and `queue_ids`; these items start automatically once no run, queue, overlay sync, or cleanup is active. |
| `POST /api/dynamic-overlays/episode-title-changes/dismiss` | Permanently hides one review entry (`candidate_id`) with any blocking reason. |
| `POST /api/dynamic-overlays/episode-title-changes/fast-normal-run` | Confirmed Fast Normal Run over `candidate_ids` or `all_eligible`, using the same search and filters. Optional `force_unknown_text: true` includes safe uncertain-text candidates. |

### Overlay Bundles

| Endpoint | Purpose |
|---|---|
| `GET /api/dynamic-overlays/bundle/export` | Download custom YAML and required custom assets/fonts plus layouts and portable settings. Official downloadable Kometa files are dependency references, not ZIP payloads. Credential fields and media-server connections are excluded; known credentials in text are masked. |
| `POST /api/dynamic-overlays/bundle/preview` | Multipart `file` upload. Returns source profiles, existing destination libraries/server, features, file counts, conflicts, and warnings without applying the bundle. |
| `POST /api/dynamic-overlays/bundle/import` | Multipart upload with `file`, JSON-string `mapping`, JSON-string `anime_libraries`/`season_libraries`, and boolean `import_settings`/`replace_files`. Applies validated mappings and starts in Dry Run, without uploading artwork. |

`mapping` maps source profile names to existing destination library names, for
example `{"Source TV":"My Shows","Source Movies":""}`. An empty value skips a
profile. The two feature-target arrays contain mapped destination show-library
names. Duplicate destinations, nonexistent libraries, and movie/show mismatches
are rejected. `replace_files=true` explicitly approves conflicting shared files;
existing files are backed up before replacement.

Local credentials and media-server selections are preserved even if an uploaded
bundle contains credential fields with blank/null/masked values. Invalid bundles return
`400`; validation failures include `detail.code` and a readable `detail.message`
so clients can translate the error. Preview responses also include
`warning_codes` alongside the existing readable `warnings` list. An active
sync/classification/import returns `409`. See the
[bundle workflow and limits](dynamic_overlays.md#share-a-complete-overlay-bundle).

`official_dependency_count` in the preview reports omitted downloadable defaults.
Export returns `503` with code `officialCatalogUnavailable` if the official
Kometa catalog cannot be verified; it does not silently export the whole catalog.

### `POST /api/dynamic-overlays/sync`

Starts a background overlay sync. Without `target_items`, `library` and `target_server` select the libraries and servers to scan. `scope: "incremental"` skips unchanged artwork; `scope: "all"` forces uploads.

For an item-only request, supply its media-server ID, server, and library:

```json
{
  "target_server": "plex",
  "scope": "incremental",
  "library": "Kids Shows",
  "target_items": [
    {
      "id": "12345",
      "server_type": "plex",
      "library_name": "Kids Shows",
      "media_type": "show"
    }
  ]
}
```

ID targets are fetched directly, without listing unrelated libraries. Missing targets are skipped rather than falling back to a broad scan. An empty `target_items` list does not start a sync. Use `jellyfin` or `emby` and the corresponding item IDs for those servers.

A show target also evaluates its season posters and titlecards. Tautulli and Arr notifications submit the movie/show IDs and libraries processed by their trigger run. Requests received while a sync is running are rejected, not queued.

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
OS, CPU model, core count, and Docker detection are cached for the backend process
lifetime. Memory usage is collected on every request. Collection runs in worker
threads so system probes do not block unrelated API requests.

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

### `/api/assets/overview/page`
Returns only the visible Action Center rows, plus category counts, type/library
filter options, and the configuration used to display issue tags.

- `limit`: 1-500 rows (default 25); `offset`: zero-based starting row (default 0).
- `tab`: `active` (default) or `skipped`.
- `status`: `Unresolved` (default), `Resolved`, or `All`.
- `category`: a category key from `/api/assets/overview`, or empty for all categories.
- `search`: case-insensitive title/root-folder search; `asset_type` and `library`: exact filters.
- `all_matches=true`: return the complete filtered set for an explicitly confirmed
  bulk action. Normal browsing does not use this option.

`total_count` counts all filtered matches, not just returned rows. `offset` is
adjusted to the last available page if necessary. Category counts and filter
options remain independent of pagination. The backend still classifies the full
metadata snapshot; this endpoint limits serialization and transfer, not the
underlying database read. The original full overview endpoint remains available.

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

### `/api/sidebar/counts`
Returns only `success`, `assets_with_issues`, and `manual_assets` for the navigation
badges, rather than full asset lists. The issue count uses the same classification
as `/api/assets/overview`; manual totals come from the existing asset cache.
Results are cached for 60 seconds per backend process, with concurrent requests
sharing one calculation. `?refresh=true` bypasses the cached counts after an asset
replacement. Failed calculations are not cached.

??? example "View Response"
    ```json
    {
      "success": true,
      "assets_with_issues": 12,
      "manual_assets": 7
    }
    ```

### `/api/dashboard/all`
A combined endpoint used to populate the main dashboard (Status + Version + System Info).
The dashboard uses `?include_version=false` to receive status, scheduler jobs, and
system information without waiting for the remote version check. In this mode
`version` is `null`; the frontend loads `/api/version` independently. The parameter
defaults to `true` for compatibility with existing clients.

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
integration status endpoint (`GET /api/v1/posterizarr/status`).

*(Note: Requires the [bitr8/agregarr](https://github.com/bitr8/agregarr-dev) fork image `bitr8/agregarr:develop` with [PR #103](https://github.com/bitr8/agregarr-dev/pull/103). Official/stock Agregarr releases without this PR will return HTTP 404 with a message explaining the requirement).*

??? example "View Response (Success)"
    ```json
    {
      "valid": true,
      "message": "Agregarr connection and API key are valid.",
      "details": {
        "status_code": 200
      }
    }
    ```

??? example "View Response (Missing bitr8 Fork / 404)"
    ```json
    {
      "valid": false,
      "message": "Agregarr is reachable, but its Posterizarr integration endpoint is unavailable. Requires the bitr8 Agregarr fork (Docker image bitr8/agregarr:develop) with PR #103. Upstream agregarr/agregarr does not have this endpoint.",
      "details": {
        "status_code": 404,
        "required_image": "bitr8/agregarr:develop",
        "fork_url": "https://github.com/bitr8/agregarr-dev",
        "pending_pr": "https://github.com/bitr8/agregarr-dev/pull/103"
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
Returns recently modified assets with existing artwork. The dashboard requests only
its visible page using `limit` (1-100, default 100), `offset` (default 0), and `tab`
(`All`, `Posters`, `Collections`, `Backgrounds`, `Seasons`, or `TitleCards`).
The latest 100 matching records are deduplicated before tab filtering and pagination.
`total_count` is the selected tab's count; `counts` contains counts for all tabs.
An offset beyond the available entries is adjusted to the last page.
Asset metadata is still matched against the in-memory file cache to preserve
modification-time ordering; pagination limits the response, not the database scan.

??? example "View Response"
    ```json
    {
      "success": true,
      "assets": [],
      "total_count": 0,
      "offset": 0,
      "counts": {
        "All": 0,
        "Posters": 0,
        "Collections": 0,
        "Backgrounds": 0,
        "Seasons": 0,
        "TitleCards": 0
      }
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
Uploads a replacement image. With `add_to_queue=true` the item is queued instead of processed immediately; adding `start_when_idle=true` starts it automatically once no run is active.

??? example "View Response"
    ```json
    {
      "success": true
    }
    ```

### `/api/assets/replace-from-url`
Replaces an asset from a provider URL. Supports the same `add_to_queue` and `start_when_idle` query parameters as `upload-replacement`.

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
Fetch collections directly from the configured media server. When querying Plex, collections are automatically enriched with local asset diff tracking (`syncStatus`: `synced`, `update_available`, `missing_server`, `missing_local`), local image URLs (`local_asset_url`), and disk paths (`local_asset_path`).

### `POST /api/plex/collections/push-item`
Uploads a single local collection poster directly to Plex via PMS REST API and updates the local push cache database (`database/plex_push_cache.db`).

??? example "View Request"
    ```json
    {
      "rating_key": "12345",
      "local_path": "/assets/Collections/Star Wars Collection.png",
      "url": "http://192.168.1.50:32400",
      "token": "plex-token",
      "title": "Star Wars Collection"
    }
    ```

??? example "View Response"
    ```json
    {
      "success": true,
      "message": "Pushed poster for 'Star Wars Collection' to Plex",
      "rating_key": "12345",
      "status": "synced"
    }
    ```

### `POST /api/plex/collections/push-batch`
Concurrently uploads multiple out-of-sync collection posters to Plex. Uses a controlled concurrency semaphore to prevent overwhelming the Plex Media Server.

??? example "View Request"
    ```json
    {
      "items": [
        {
          "rating_key": "12345",
          "local_path": "/assets/Collections/Star Wars Collection.png",
          "title": "Star Wars Collection"
        }
      ],
      "url": "http://192.168.1.50:32400",
      "token": "plex-token"
    }
    ```

??? example "View Response"
    ```json
    {
      "success": true,
      "total": 1,
      "pushed": 1,
      "failed": 0,
      "results": [
        {
          "rating_key": "12345",
          "title": "Star Wars Collection",
          "status": "synced"
        }
      ]
    }
    ```

### `POST /api/plex/sync/run`
Triggers an on-demand, lightweight background Plex artwork sync in Python (without invoking PowerShell). Scans for modified or missing assets according to specified library and asset types, pushes them to Plex, and writes execution logs to `UILogs/PlexSync.log`.

??? example "View Request"
    ```json
    {
      "library": "all",
      "asset_types": ["collection", "poster", "season", "titlecard", "background"]
    }
    ```

??? example "View Response"
    ```json
    {
      "success": true,
      "message": "Plex sync started in background",
      "library": "all",
      "asset_types": ["collection", "poster", "season", "titlecard", "background"]
    }
    ```

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

### `GET /api/assets/folders`
Get folders from the assets directory. If `library_name` is provided, returns all media folders within that library; otherwise returns all top-level library directories.

??? example "View Response"
    ```json
    {
      "success": true,
      "folders": [
        {
          "folderName": "Inception (2010) {tmdb-27205}",
          "title": "Inception",
          "year": "2010",
          "path": "Movies/Inception (2010) {tmdb-27205}"
        }
      ],
      "library": "Movies"
    }
    ```

### `GET /api/assets/skipped`
Retrieve all skipped items detected during runs, including item title, library, skip reason, and resolution status.

### `POST /api/assets/skipped/refresh`
Forces a re-scan of log files to refresh and update the list of skipped assets.

### `POST /api/assets/unskip`
Marks a skipped item as unskipped or resolved so it can be reprocessed on the next run.

### `GET /api/proxy/poster`
Proxies local or remote poster images to provide secure previews and avoid CORS restrictions.

### `POST /api/media-server/items`
Fetch paginated items from a connected media server (Plex, Jellyfin, Emby) with clearLogo presence detection and proxied image URLs.

??? example "View Request"
    ```json
    {
      "server_type": "plex",
      "url": "http://192.168.1.50:32400",
      "token": "plex-token-here",
      "library_id": "1",
      "start": 0,
      "limit": 50
    }
    ```

### `POST /api/media-server/check-logos`
Batch checks a list of item IDs (`rating_keys`) against Plex to verify which items already have clearLogo artwork.

### `GET /api/media-server/image`
Securely proxies image streams directly from Plex, Jellyfin, or Emby servers without exposing authentication tokens in frontend image URLs. Features persistent local disk caching (`Cache/server_thumbs/`) and public HTTP cache headers (`Cache-Control: public, max-age=604800`) to eliminate redundant server polling and optimize UI load speeds.

### `POST /api/media-server/upload-logo`
Downloads a selected logo (from URL or data URI), applies Posterizarr metadata tags using Pillow/ImageMagick, and uploads it directly to the media server as a clearLogo.

---

## 🖼️ Media Server Collections & Artwork Push

### `POST /api/media-server/collections`
Fetches collections from the media server with diff status detection (Plex) comparing local collection assets against server artwork. Returns `syncStatus` (`synced`, `update_available`, `missing_server`, `missing_local`), `localPosterUrl`, and server poster URLs.

### `POST /api/plex/collections/mark-synced`
Marks a local collection poster as In-Sync with Plex in the persistent SQLite cache (`database/plex_push_cache.db`) without performing a re-upload, updating the status badge immediately.

### `POST /api/plex/collections/push-item`
Pushes a local collection poster or backdrop directly to Plex Media Server via REST API (`/library/metadata/{rating_key}/posters` or `/arts`) and records the updated timestamp and size in the cache.

### `POST /api/plex/collections/push-batch`
Batches multiple collection poster pushes to Plex with rate limiting and concurrency management.

### `POST /api/plex/sync/run`
Triggers an on-demand background Plex Push Sync job across configured libraries and asset types.

---

## 🔌 WebSockets

### `GET /ws/events`
Status probe endpoint for the real-time WebSocket event stream. Used by the Jellyfin and Emby plugin configuration pages to verify network reachability and validate the API key before establishing a persistent WebSocket connection.

**Authentication:**
- Requires `X-API-Key: YOUR_KEY` or `Authorization: Bearer YOUR_KEY` HTTP header.

??? example "View Response"
    ```json
    {
      "status": "online",
      "websocket": true,
      "endpoint": "/ws/events",
      "version": "2.0",
      "authenticated": true
    }
    ```

### `WebSocket /ws/events`
Real-time event bridge for media server integration plugins (Jellyfin and Emby). Dispatches instantaneous notifications whenever artwork is created, uploaded, replaced, or processed with overlays (both from background script runs and manual WebUI operations).

**Authentication:**
- Strictly via `X-API-Key: YOUR_KEY` or `Authorization: Bearer YOUR_KEY` HTTP headers during the WebSocket upgrade handshake (API keys in URL query parameters are rejected).

**Supported Events:**
- `connected`: Sent upon successful handshake connection.
- `ping`: Sent periodically to keep connections alive (client replies with `pong`).
- `asset_updated`: Dispatched when an asset is modified, newly created, or overlay processing completes.

??? example "View Event Payload (`asset_updated`)"
    ```json
    {
      "event": "asset_updated",
      "library_name": "Movies",
      "folder_name": "Inception (2010) [tmdb-27205]",
      "asset_type": "poster",
      "season_number": null,
      "episode_number": null,
      "title": "Inception",
      "relative_path": "Movies/Inception (2010) [tmdb-27205]/poster.jpg",
      "timestamp": "2026-09-10T07:12:00Z",
      "libraryName": "Movies",
      "folderName": "Inception (2010) [tmdb-27205]",
      "assetType": "poster",
      "seasonNumber": null,
      "episodeNumber": null,
      "relativePath": "Movies/Inception (2010) [tmdb-27205]/poster.jpg"
    }
    ```

### `POST /api/internal/asset-event`
Internal event ingestion endpoint for triggering real-time asset updates to connected media servers.

**Authentication:**
- Bypassed for loopback connections (`127.0.0.1`, `::1`) or requires standard API key authentication.

??? example "View Request Body"
    ```json
    {
      "library_name": "Movies",
      "folder_name": "Gladiator II (2024)",
      "asset_type": "poster",
      "relative_path": "Movies/Gladiator II (2024)/poster.jpg",
      "title": "Gladiator II"
    }
    ```

### `WebSocket /ws/logs`
Streams live execution logs line-by-line directly to the Web UI terminal viewer (`LogViewer.jsx`).

### `WebSocket /ws/status`
Broadcasts live system metrics, background execution states, and queue progress to the UI.

