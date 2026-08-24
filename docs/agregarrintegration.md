# Agregarr integration

Posterizarr can notify Agregarr after an Arr-triggered movie or show poster has
been successfully uploaded to Plex. Agregarr then checks that single Plex item,
adds it to matching collections, and applies its configured overlays. Sonarr
callbacks also include the imported season and episode numbers, allowing
Agregarr to update that season poster and episode title card.

Open **Auto Triggers** in the Posterizarr Web UI, select **Agregarr**, and
configure:

- **Enable Agregarr callback**
- **Agregarr URL**
- **Agregarr API key**

Use **Test connection** before saving. The API key is stored in
`/config/agregarr_integration.json`, is never returned to the browser, and is
written with owner-only permissions where the platform supports it.

Docker environment variables can be used instead for headless deployments:

```yaml
environment:
  - AGREGARR_TRIGGER_ENABLED=true
  - AGREGARR_URL=http://agregarr:7171
  - AGREGARR_API_KEY=replace-with-the-agregarr-api-key
```

`AGREGARR_URL` must be reachable from the Posterizarr container. The service-name
URL above works when both containers share a Docker network. Otherwise, use the
Agregarr server's reachable IP address and port. Environment variables override
the corresponding Web UI values and make those fields read-only.

The callback is sent only when all of these conditions are met:

- Posterizarr is running in Arr trigger mode.
- Plex integration is enabled.
- A root movie/show poster, season poster, or episode title card was
  successfully uploaded to Plex.

Posterizarr sends at most one callback at the end of each completed Arr job,
even when that job uploaded a root poster, season poster, and title card. For a
large Sonarr import, jobs remain individual so every successfully finished
episode has its own retryable callback; Agregarr serializes those callbacks.
The callback carries Sonarr's season and episode numbers.
When Sonarr sends a multi-episode file in one webhook, Posterizarr expands its
`episodes` array into one queued job per episode before processing begins.
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
