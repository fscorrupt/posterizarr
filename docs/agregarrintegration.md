# Agregarr integration

Posterizarr can notify Agregarr after an Arr-triggered movie or show poster has
been successfully uploaded to Plex. Agregarr then checks that single Plex item,
adds it to matching collections, and applies its configured overlays. Sonarr
callbacks also include the imported season and episode numbers, allowing
Agregarr to update that season poster and episode title card.

Open **Settings > System > Language & Notifications** in the Posterizarr Web
UI and configure:

- **Enable Agregarr Callback**
- **Agregarr URL**
- **Agregarr API Key**
- **Agregarr Retry Timeout**

Use **Test** beside the URL to verify that Posterizarr can reach Agregarr
and authenticate. The test reads Agregarr's integration status and does not
queue collection or overlay work.

These settings use Posterizarr's central `config.json` configuration. They can
also be edited directly under the existing `Notification` section:

```json
"Notification": {
  "AgregarrTriggerEnabled": "true",
  "AgregarrUrl": "http://agregarr:7171",
  "AgregarrApiKey": "replace-with-the-agregarr-api-key",
  "AgregarrRetryTimeout": "60"
}
```

`AgregarrUrl` must be reachable from the Posterizarr container. The service-name
URL above works when both containers share a Docker network. Otherwise, use the
Agregarr server's reachable IP address and port.

## How it works

1. Sonarr or Radarr triggers Posterizarr, which creates and uploads the selected
   artwork to Plex.
2. After Plex confirms the upload, Posterizarr sends Agregarr the Plex item and
   any available season or episode details.
3. Agregarr updates matching collections and applies its configured movie,
   show, season, or episode overlays.

The callback is sent only when all of these conditions are met:

- Posterizarr is running in Arr trigger mode.
- Plex integration is enabled.
- A root movie/show poster, season poster, or episode title card was
  successfully uploaded to Plex.

Posterizarr sends at most one callback at the end of each completed Arr job,
even when that job uploaded a root poster, season poster, and title card. For a
large Sonarr import, jobs remain individual so every successfully finished
episode has its own callback; Agregarr serializes those callbacks.
The callback carries Sonarr's season and episode numbers.
When Sonarr sends a multi-episode file in one webhook, Posterizarr expands its
`episodes` array into one queued job per episode before processing begins.

If Agregarr is busy with a full sync or its bounded callback queue is full, it
returns a retry delay. Posterizarr honors that delay and retries for up to the
configured `AgregarrRetryTimeout` window (default: 60 seconds). Set to `0` to
disable retries. Authentication and configuration errors are not retried. Artwork that
was already uploaded remains successful even if the downstream callback
eventually fails, and the failure is recorded in Posterizarr's log.
In Agregarr, tag overlay templates with the desired artwork targets in the
template editor: **Main poster**, **Season poster**, and/or **Episode card**.
Existing templates default to Main poster. Episode templates should normally
use a 1920x1080 canvas. Each Agregarr library configuration also controls which
targets are processed by full and quick overlay syncs. Movie libraries expose
main posters; TV libraries can process main, season, and episode artwork.
Sonarr follow-up callbacks target only the root show and the imported child
artwork, avoiding a full-library scan.

A callback failure is logged as a warning and does not make the completed
Posterizarr run fail.

The target Agregarr build must provide `POST /api/v1/posterizarr/trigger`. The
callback authenticates with the normal Agregarr API key through the
`X-Api-Key` header.
