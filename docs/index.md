<div class="pz-hero">
  <p class="pz-kicker">ARTWORK AUTOMATION · PLEX · JELLYFIN · EMBY · SILO (EXPERIMENTAL)</p>
  <h1>Make your library<br>feel like yours.</h1>
  <p class="pz-hero-copy">Choose the look for each artwork type once. Posterizarr keeps generating matching posters, seasons, backgrounds, and title cards. Add Dynamic Overlays on top for ratings, resolution, language flags, and more.</p>
  <div class="pz-hero-actions">
    <a class="pz-button" href="getting_started.md">Start with the setup guide</a>
    <a class="pz-text-link" href="showcase.md">Explore real artwork</a>
  </div>
</div>

<p class="pz-community-links"><a href="https://ko-fi.com/R6R81S6SC">Support Posterizarr on Ko-fi</a> <span>·</span> <a href="https://discord.gg/fYyJQSGt54">Join the Discord community</a></p>

<div class="pz-gallery-home" data-showcase-url="showcase/" markdown="1">
--8<-- "docs/includes/artwork-gallery.md"
</div>

## New to Posterizarr?

Start with the short setup path: choose an installation method, connect one
media-server library, and test the result before enabling uploads or automation.

![Dashboard with Posterizarr's main navigation and workspace](images/01-dashboard-overview.png)

*Navigate to **Dashboard** in the left sidebar after the Web UI opens. Use the sidebar to reach setup, artwork, automation, and history views.*

1. [Choose an installation method](installation.md) and open the Web UI.
2. Follow [First-time setup](getting_started.md) to connect a server and configure providers.
3. Run a safe [Testing Mode](modes.md#test-mode) sample before processing a library.
4. Use the [Web UI map](ui_guide.md) to locate everyday tasks and the [configuration reference](configuration.md) for individual settings.

## What Posterizarr Does

Posterizarr creates and manages posters, season posters, backgrounds, title
cards, and collection artwork for Plex, Jellyfin, and Emby. Experimental Silo
support is available but does not yet have full feature parity. Artwork sources,
language preference, sizing, logos, text, borders, templates, local assets, and
upload behavior can be configured by artwork type.

![Run Modes with normal, test, backup, restore, sync, and logo actions](images/02-run-modes.png)

*Navigate to **Run Modes** to test, run, back up, restore, or create one asset manually.*

The Web UI also includes the Action Center, asset galleries, scheduling,
webhooks, server export, logs, and Insights. See [Capabilities](capabilities.md)
for the complete feature inventory.

## Native Dynamic Overlays

![Dynamic Overlays configure, design, and apply sections](images/10-dynamic-overlays.png)

*Navigate to **Builders > Dynamic Overlays** to configure supported rules, preview badges, and apply overlays.*

Dynamic Overlays composites supported badges in memory and can upload the
result directly to Plex, Jellyfin, or Emby while keeping clean source artwork
unchanged on disk. Start with **Dry Run**. Kometa-style YAML import supports a
subset of Kometa configuration; Posterizarr does not run Kometa or implement all
of its features. Read the [Dynamic Overlays guide](dynamic_overlays.md).

## Configure and Automate

![Configuration providers view](images/17-configuration-providers.png)

*Navigate to **Configuration > Providers** to set provider credentials and search priority.*

Connect a server and choose a test library under **Configuration > Media
Servers**. Then add provider credentials and choose the artwork types to enable.
Use [the configuration guide](configuration.md) for every setting and
[Run Modes and automation](modes.md) for schedules, Tautulli, Sonarr, and Radarr.

## Full Documentation

| Start here | Use and maintain | Reference and integrations |
|---|---|---|
| [Requirements](requirements.md) · [Installation](installation.md) · [First-time setup](getting_started.md) · [Manual PowerShell walkthrough](walkthrough.md) · [Web UI from source](uiinstallation.md) | [UI map](ui_guide.md) · [Action Center](action_center.md) · [Blueprints](blueprints.md) · [Artwork showcase](showcase.md) · [Plex Image Cleanup](plex_image_cleanup.md) | [Configuration](configuration.md) · [Provider search order](searchorder.md) · [Platform & Tools](platformandtools.md) · [Networking](networking.md) · [FAQs](faqs.md) · [Telemetry](telemetry.md) |
| [Capabilities](capabilities.md) · [Naming manual assets](namingconvention.md) | [Dynamic Overlays](dynamic_overlays.md) · [Homepage API](homepage.md) · [Agregarr](agregarrintegration.md) · [Jellyfin plugin](jellyfin_plugin.md) · [Emby plugin](emby_plugin.md) · [Kometa compatibility](kometaintegration.md) | [API endpoints](endpoints.md) · [PowerShell architecture](powershell_scripts.md) · [Backend architecture](backend_python.md) · [Frontend components](frontend_components.md) · [LLM architecture](llms.md) · [Docs preview workflow](docs_preview.md) |

## Supported Platforms

Docker, Unraid, Linux, Windows, macOS, and ARM deployments are covered in the [installation and platform guides](installation.md).

## Privacy & Telemetry

Telemetry is optional and can be disabled with `"telemetry": false` in the configuration. The complete payload, retention behavior, and opt-out instructions are in [Telemetry & Privacy](telemetry.md). The worker implementation is in [telemetry-worker/worker.js](https://github.com/fscorrupt/posterizarr/blob/main/telemetry-worker/worker.js).

## Contributing

Please review the [Contributing Guidelines](https://github.com/fscorrupt/posterizarr/blob/main/.github/CONTRIBUTING.md) and [Code of Conduct](https://github.com/fscorrupt/posterizarr/blob/main/.github/CODE_OF_CONDUCT.md) before submitting a pull request. Keep `$CurrentScriptVersion` in `Posterizarr.ps1` and [Release.txt](https://github.com/fscorrupt/posterizarr/blob/main/Release.txt) synchronized as required by the contribution guide. Version synchronization supports update detection. The project maintainer reviews and tests AI-assisted UI and web changes before they are committed.

<!-- sponsors --><!-- sponsors -->

Made by [fscorrupt](https://github.com/fscorrupt) and the [open source community](https://github.com/fscorrupt/posterizarr/graphs/contributors). Join the [Discord](https://discord.gg/fYyJQSGt54), [report a bug or request a feature](https://github.com/fscorrupt/posterizarr/issues), or [support Posterizarr](https://ko-fi.com/R6R81S6SC).
