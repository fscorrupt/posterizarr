# First Look at the Web UI

This guide maps the live Posterizarr navigation to the tasks described in the
other guides. Most pages are read-only until you explicitly save, start a run,
or confirm an upload or cleanup action.

![Posterizarr Dashboard and main sidebar](images/01-dashboard-overview.png)

*Open **Dashboard** from the left sidebar after starting Posterizarr. The dashboard summarizes engine and scheduler status, system/configuration state, recent assets, and the live log feed.*

## Main Navigation

| Sidebar entry | What you do there |
|---|---|
| **Dashboard** | Check engine state, upcoming schedules, configuration status, recent assets, and live logs. **Run Script** opens Run Modes. |
| **Run Modes** | Start a normal or testing run, back up or restore artwork, sync supported servers, update logos, or create one asset manually. |
| **Queue** | Review queued work and its state; run or clear queued items. |
| **Scheduler** | Create and manage timed tasks. For Docker, set `RUN_TIME=disabled` before enabling the UI scheduler. |
| **Media Server Export** | Expand for **Plex** or **Jellyfin / Emby** cached library and episode records. Refresh or import data here; this is not an artwork-generation run. |
| **Asset Management** | Expand for artwork galleries, Manual Assets, Backup Assets, Action Center, and Test Gallery. Plex Image Quarantine is available when its Plex cleanup data and configuration make it applicable. |
| **Auto Triggers** | Configure Tautulli, Sonarr, and Radarr events. Native Webhook setup is recommended; Docker and Windows instructions are retained for legacy arrangements. |
| **Builders** | Expand for Collection Builder, Logo Builder, Overlay Builder, Dynamic Overlays, and Blueprint Builder. |
| **Configuration** | Search and edit System, Providers, Media Servers, Global Visuals, Posters, Seasons, Backgrounds, Title Cards, and Collections settings. |
| **Insights** | Explore run history, filters, charts, runtime and asset statistics, exports, and optional demo data. |
| **Logs** | Search, filter, download, and gather support logs. |
| **How It Works / About** | Read the in-app workflow overview and application/build information. |

The general first-run wizard appears automatically when setup is incomplete; it
is not a sidebar destination. Its steps and save behavior are covered in
[First-time setup](getting_started.md#automatic-first-run-wizard). The separate
Dynamic Overlays guide is under **Builders > Dynamic Overlays > Setup Wizard**.
Selecting Dynamic Overlays in the first-run wizard enables it with Dry Run and
opens this guide after Finish.
Its preset/import actions have different effects, described in the
[Dynamic Overlays guide](dynamic_overlays.md#quick-start-from-the-web-ui).

## Connect a Server and Providers

![Configuration with Media Servers selected](images/06-configuration-media-servers.png)

*Choose **Configuration** in the sidebar, then **Media Servers** in Config Groups to enter a server URL and API credential, validate it, and select included libraries.*

![Provider configuration and search preferences](images/17-configuration-providers.png)

*Choose **Configuration > Providers** to enter artwork-provider credentials and set provider priority.*

Save your changes after configuring the server, providers, and a small set of
artwork types. The [first-time setup guide](getting_started.md) gives the
recommended sequence; [Configuration](configuration.md) explains every field.

![System configuration settings](images/34-config-system.png)

*Choose **Configuration > System** for Web UI, path, processing, and notification settings.*

![Global Visuals configuration settings](images/35-config-global-visuals.png)

*Choose **Configuration > Global Visuals** for shared language, image, text, logo, border, and overlay preferences.*

![Poster configuration settings](images/36-config-posters.png)

*Choose **Configuration > Posters** to tune movie and show poster behavior.*

![Season configuration settings](images/37-config-seasons.png)

*Choose **Configuration > Seasons** to tune season artwork and season text.*

![Background configuration settings](images/38-config-backgrounds.png)

*Choose **Configuration > Backgrounds** to tune background artwork, text, logos, and processing.*

![Title Cards configuration settings](images/39-config-title-cards.png)

*Choose **Configuration > Title Cards** to tune episode-card sources, text, and fallbacks.*

![Collections configuration settings](images/40-config-collections.png)

*Choose **Configuration > Collections** to tune collection poster behavior.*

## Run and Review Work

![Run Modes quick actions and manual form](images/02-run-modes.png)

*Choose **Run Modes** in the sidebar. Testing Mode generates sample output without uploading it; normal runs use the configured libraries and upload behavior.*

![Asset Queue status and controls](images/03-asset-queue.png)

*Choose **Queue** in the sidebar to review pending, running, and completed queue work.*

Run Modes also includes backup, restore, Jellyfin/Emby/Silo sync, Logo Updater,
poster reset, and manual asset creation. See [Run Modes and automation](modes.md)
for confirmations, destructive actions, scheduler behavior, and optional CLI
commands.

![Test Gallery output](images/31-test-gallery.png)

*After a Testing Mode run, expand **Asset Management** and choose **Test Gallery** to inspect generated samples.*

## Browse and Manage Assets

![Poster Gallery under Asset Management](images/14-poster-gallery.png)

*Expand **Asset Management** and choose **Posters**. The same group includes Backgrounds, Seasons, and Title Cards galleries.*

![Background Gallery](images/25-background-gallery.png)

*Choose **Asset Management > Backgrounds** to browse background artwork.*

![Season Gallery](images/26-season-gallery.png)

*Choose **Asset Management > Seasons** to browse season artwork.*

![Titlecard Gallery](images/27-titlecard-gallery.png)

*Choose **Asset Management > Title Cards** to browse episode titlecard artwork.*

![Manual Assets browser](images/08-manual-assets.png)

*Choose **Asset Management > Manual Assets** to browse the local asset structure and inspect the files Posterizarr can reuse.*

![Backup Assets view](images/15-asset-backups.png)

*Choose **Asset Management > Backup Assets** to browse saved artwork backups.*

![Action Center review filters and actions](images/07-action-center.png)

*Choose **Asset Management > Action Center** to filter flagged assets and resolve, replace, or delete their tracking entries.*

The galleries, test output, and server export have different purposes: a gallery
browses available artwork, Test Gallery shows Testing Mode results, and Media
Server Export browses cached metadata records. Read the [Action Center guide](action_center.md)
before bulk actions and the [Plex Image Cleanup guide](plex_image_cleanup.md)
before quarantining or removing files.

## Export Library Data

![Plex library records and filters](images/09-plex-library-export.png)

*Expand **Media Server Export** and choose **Plex** to browse the cached Plex library and episode records.*

![Jellyfin and Emby library export](images/16-jellyfin-emby-export.png)

*Choose **Media Server Export > Jellyfin / Emby** for cached records from those servers.*

Use the refresh or import controls to update the export data. Endpoint behavior
and response formats are in the [API reference](endpoints.md).

## Build Artwork and Overlays

![Blueprint Builder presets](images/11-blueprint-builder.png)

*Expand **Builders** and choose **Blueprint Builder** to review and apply reusable presets.*

![Collection Builder](images/28-collection-builder.png)

*Choose **Builders > Collection Builder** to compare local collection artwork with Plex and review push status.*

![Logo Builder](images/29-logo-builder.png)

*Choose **Builders > Logo Builder** to browse logos by server/library and search, replace, or update them.*

![Overlay Builder asset library](images/30-overlay-builder.png)

*Choose **Builders > Overlay Builder** to browse overlay assets or open Overlay Creator.*

![Dynamic Overlays configure, design, and apply workspace](images/10-dynamic-overlays.png)

*Choose **Builders > Dynamic Overlays**. The page groups setup, rule configuration, badge design, preview, synchronization, and cache tools.*

![Dynamic Overlays Libraries and Rules](images/18-overlay-libraries-rules.png)

*Choose **Builders > Dynamic Overlays > Libraries & Rules** to scope configurations to libraries and artwork formats.*

![Dynamic Overlays Config and YAML Files](images/19-overlay-config-yaml.png)

*Choose **Config & YAML Files** to import supported rules, manage assets and fonts, and check readiness.*

![Dynamic Overlays Visual Badges](images/20-overlay-visual-badges.png)

*Choose **Visual Badges** to configure badge appearance and layout.*

![Dynamic Overlays Live Preview](images/21-overlay-live-preview.png)

*Choose **Live Preview** to inspect sample artwork and adjust badge placement. Previewing does not upload artwork.*

![Dynamic Overlays Synchronize view with separate maintenance tabs](images/22-overlay-sync-cache.png)

*Choose **Sync & Maintenance** for the separate **Synchronize**, **Media Changes**,
**Episode Title Review**, **Overlay Cache**, and **Ratings Cache** views. The
screenshot shows Synchronize with Dry Run on and illustrative library counts.*

![Episode Title Review with historical title differences and eligibility](images/45-episode-title-review.png)

*Episode Title Review compares existing titlecards with current episode titles
and filters by eligibility, blocking reason, or historical/future status. The
initial scan does not recreate artwork. These are sample review records; queue
and Fast Normal Run actions require confirmation.*

![AniMetaFill settings](images/23-animetafill.png)

*Choose **AniMetaFill** under Dynamic Overlays to configure anime discovery and local metadata workflows.*

Start with **Dry Run** and a narrow library/item scope. The [Dynamic Overlays guide](dynamic_overlays.md)
documents rating sources, local IMDb datasets and episode mappings, bundles,
cache refresh, retry behavior, and Kometa compatibility limits. Other builders
are described in [Blueprints and recipes](blueprints.md), [Logo Builder and
logo workflows](modes.md#logo-updater), and the [capabilities guide](capabilities.md).

## Schedule, Trigger, and Diagnose

![Scheduler configuration](images/04-scheduler.png)

*Choose **Scheduler** to create, enable, or run scheduled tasks. In Docker, disable the container timer with `RUN_TIME=disabled` before using this scheduler.*

![Auto Triggers setup](images/05-auto-triggers.png)

*Choose **Auto Triggers** to configure Tautulli, Sonarr, or Radarr; the native webhook method is recommended.*

![Insights analytics](images/12-insights.png)

*Choose **Insights** for execution history and analytics. Demo mode is simulated data.*

![Logs search and filters](images/13-logs.png)

*Choose **Logs** to find errors, download logs, or gather support information.*

Schedule only after a small run has produced the expected result. The
[automation guide](modes.md), [networking guide](networking.md), and
[FAQs](faqs.md) cover external services, troubleshooting, and legacy command
line workflows.

## In-App Help and Build Information

![How Posterizarr Works workflow page](images/32-how-it-works.png)

*Choose **How It Works** in the sidebar for the in-app workflow overview.*

![About Posterizarr version and release information](images/33-about.png)

*Choose **About** in the sidebar for version, update, and release information.*

