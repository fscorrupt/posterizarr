# Frequently Asked Questions (FAQs)

## Plex: Secure Connection Issues

**Question:** I changed my Plex server to "Secure connections: Required" and now Posterizarr cannot reconnect. I tried using the server's IP address and port, but it doesn't work. What should I do?

**Answer:** 
When you require secure connections in Plex, you can no longer connect using a plain IP address because the SSL certificate is tied to a specific Plex domain name. 

To fix this, you must use your server's exact, secure domain name. This is a long string that looks something like this:
`https://192-168-1-50.abcdef1234567890.plex.direct:32400`

### How to find your secure Plex URL:

1.  Open your browser and navigate to the following URL (replace `YOUR_TOKEN_HERE` with your actual Plex token):
    `https://plex.tv/api/resources?includeHttps=1&X-Plex-Token=YOUR_TOKEN_HERE`
2.  Look for the `<Connection>` tag that has `protocol="https"` and `local="1"`.
3.  Copy the value of the `uri` attribute. It should look like the `plex.direct` example above.
4.  Use this full URI as your Plex URL in the Posterizarr configuration.

!!! tip "Finding your Plex Token"
    If you don't know how to find your Plex token, refer to the [official Plex documentation](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

## UI: Action Center Alerts

**Question:** I just setup Posterizarr and I'm getting a lot of errors/alerts in my Action Center. What do I do with these?

**Answer:** 
Don't worry! These aren't system errors. The **Action Center** is simply a list of assets (posters, backgrounds, etc.) that Posterizarr thinks you might want to review. 

Common reasons for alerts include:
*   A poster was found but in a different language than your preferred one.
*   An image was sourced from a secondary provider (like Fanart.tv) instead of your primary one (like TMDB).
*   The text on a logo might be truncated.

You can read more about how to manage these in the [Action Center Guide](action_center.md).

## Plex & Automation: Why does Posterizarr upload artwork during Tautulli / *Arr runs even if `PlexUpload` is `false`?

**Question:** I set `PlexUpload: "false"` in my configuration because I use Kometa to manage asset uploads and overlays. However, when new media is imported via Tautulli or Radarr/Sonarr triggers, Posterizarr still uploads the poster/background directly to Plex. Is this intended?

**Answer:** 
**Yes, this is completely intentional by design.**

Here is why:
* **`PlexUpload: "false"`** is designed specifically for **scheduled, batch, and normal library runs**. In this workflow, Posterizarr generates and stores stylized assets in your `/assets` directory. Kometa then runs subsequently on a schedule, applies its own overlays/metadata, and pushes the final combined artwork to Plex.
* **Auto-triggers (Tautulli and Radarr/Sonarr webhooks)** are designed for **instant real-time fulfillment**. When a new movie, show, or episode is added, the trigger's sole purpose is to immediately supply custom Posterizarr artwork to your media server so the new media has a clean, styled poster immediately. If uploads were disabled in trigger mode, the trigger would have no visible effect in Plex until a subsequent Kometa cycle ran (which might be hours or days away).

### Recommended Workflows

1. **If you want immediate artwork upon media addition (Recommended):**
   Leave Tautulli or *Arr triggers enabled. Newly added media receives styled Posterizarr artwork right away, and whenever Kometa runs later, Kometa will add its overlay flags on top.
2. **If you want ONLY Kometa to ever touch Plex artwork:**
   **Disable Tautulli and *Arr triggers entirely**. Instead, schedule Posterizarr to run periodically (e.g., daily at 02:00) before your scheduled Kometa run (e.g., daily at 03:00). With `PlexUpload: "false"`, Posterizarr will generate images exclusively into the `/assets` directory, and Kometa will perform 100% of the uploads to Plex.

## Plex: How does Collection Diff & Push work in Collection Explorer?

**Question:** How does the Collection Explorer compare local collection posters with Plex, and will it push artwork if I use Kometa?

**Answer:**
Under `/media-server-collections`, Posterizarr inspects your local `Assets/Collections/` directory alongside your Plex collections. It computes a status tag for each collection:
* **`In Sync`**: The local collection image exists and matches the recorded upload state.
* **`Update Ready`**: The local image was modified or redesigned and differs from the last uploaded version.
* **`Missing on Plex`**: A local collection poster exists on disk, but has not yet been pushed to your Plex server.
* **`No Local Asset`**: A collection exists on Plex, but no matching artwork exists in `Assets/Collections/`.

You can preview the local image vs. the server image directly using the **LOCAL / SERVER** switcher on each card. Clicking **"Push to Plex"** or **"Push All Out-of-Sync"** performs a direct REST upload (`/library/metadata/{rating_key}/posters`) and updates the internal cache (`database/plex_push_cache.db`). This is completely manual and opt-in, so your Kometa configurations remain fully respected unless you explicitly push.

## Plex: Can I schedule automated artwork pushes for only specific asset types?

**Question:** I want Posterizarr to automatically push only my custom **Collection** posters to Plex on a schedule, while letting Kometa manage movie and TV show posters. Is that possible?

**Answer:**
**Yes!** In the WebUI under **Scheduler** (`/scheduler`), you can create a job with the execution mode set to **`Plex Sync (Lightweight)`**.
When setting up the schedule:
1. Select the library (or `All Libraries`).
2. In the **Asset Types** selector, check only **Collections** (and uncheck Posters, Seasons, Title Cards, Backgrounds).
3. Set your cron schedule or interval (e.g., daily).

This job runs as a fast Python task without invoking PowerShell or ImageMagick, inspects local files for changes against `database/plex_push_cache.db`, and pushes only your selected asset types to Plex.

!!! warning "Warning for Kometa Users"
    Never schedule Plex Sync for asset types (like movie/show posters or seasons) that are also managed by Kometa. Because Kometa applies its own overlays directly to Plex, Posterizarr will detect that the server image differs from the local file and will repeatedly attempt to re-upload it, leading to a continuous overwrite war. If you use Kometa, only sync asset types (such as custom **Collections**) that Kometa does not touch.
