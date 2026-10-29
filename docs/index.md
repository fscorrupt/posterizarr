<div align="center">
  <img src="images/logo_banner.png" alt="Logo" width="350">

  <h1 align="center">Welcome to Posterizarr</h1>

  <p>
    Automate the creation of beautiful assets for your Plex, Jellyfin, or Emby library.
  </p>
</div>

<div align="center">
  <a href="https://github.com/fscorrupt/posterizarr">
    <img src="images/posterizarr_banner.jpg" alt="Logo" width="650" height="650">
  </a>
  <br />
  <p>
  <a href="https://ko-fi.com/R6R81S6SC" target="_blank">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Buy Me A Coffee" style="height: 35px; width: auto;">
  </a><br />
  <a href="https://discord.gg/fYyJQSGt54" target="_blank">
    <img src="https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png" alt="Discord" style="height: 35px; width: auto;">
  </a>
</p>
  Posterizarr is free to use. If it saves you time, <a href="https://ko-fi.com/R6R81S6SC">your support helps keep development going</a>.
  <br>
  <a href="https://discord.gg/fYyJQSGt54">Join our Discord</a>
</div>

## Manage Your Artwork From the Web UI

Posterizarr creates and manages artwork for Plex, Jellyfin, and Emby. Use the
dashboard to check engine status, upcoming schedules, and recently generated
artwork. Open **Action Center** to review assets that need attention, or
**Insights** to explore execution history and runtime statistics.

![Dashboard with engine status, upcoming scheduler jobs and recent artwork](images/ui-dashboard.png)

- [Install Posterizarr](installation.md) for a new setup.
- [Review assets in Action Center](action_center.md) to resolve artwork issues.
- [Create reusable Blueprints](blueprints.md) for asset-generation recipes.
- [Configure automation](modes.md) for scheduled and externally triggered runs.

## Native Dynamic Overlays

**Builders > Dynamic Overlays** previews and composites supported badges for
posters, titlecards, and backgrounds. Choose a library and format, adjust badge
placement, check required assets, and sync directly to Plex, Jellyfin, or Emby.
Clean source artwork stays unchanged on disk.

![Dynamic Overlays live preview with a sample poster and badge placement controls](images/ui-dynamic-overlays.png)

Start with **Dry Run** to evaluate and render changes without uploading artwork.
Supported Kometa-style YAML can be imported, but Posterizarr does not run Kometa
and does not implement every Kometa feature.

[Open the Dynamic Overlays setup guide](dynamic_overlays.md)

## Explore Run History

Insights brings run counts, success/error filters, durations, artwork totals,
storage figures, and interactive charts into one view. Its optional **Demo**
mode lets you explore the interface using simulated runs.

![Insights KPI cards and charts with the built-in Sample Preview enabled](images/ui-insights.png)

!!! note "About these screenshots"
    These are development-build captures from a local, read-only documentation
    preview. Library and title names are replaced with examples. The Insights
    image uses built-in simulated telemetry; overlay previews use sample metadata.
    They illustrate the UI, not benchmark results, default configuration, or a
    completed media-server sync.
