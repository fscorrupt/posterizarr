<a name="readme-top"></a>
<br />
<div align="center">
  <a href="https://github.com/fscorrupt/posterizarr">
    <img src="/docs/images/logo_banner.png" alt="Logo" width="550" height="550">
  </a>

  <p align="center">
    Automate the creation of beautiful assets for your Plex, Jellyfin, or Emby library.
  </p>
</div>
<br />
<div align="center">
  <a href="https://github.com/fscorrupt/posterizarr">
    <img src="/docs/images/posterizarr_banner.jpg" alt="Logo" width="650" height="550">
  </a>
    <br />
    <br />
    <strong><a href="https://fscorrupt.github.io/posterizarr/">View Full Documentation »</a></strong>
    <br />
    <br />
    <a href="https://github.com/fscorrupt/posterizarr/issues">Report Bug</a>
    ·
    <a href="https://github.com/fscorrupt/posterizarr/issues">Request Feature</a>
    ·
    <a href="https://discord.gg/fYyJQSGt54">Join our Discord</a>
  </p>
</div>

<p align="center">
    <a href="https://ko-fi.com/R6R81S6SC" target="_blank"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Buy Me A Coffee" height="25"></a><br />
    <a href="https://discord.gg/fYyJQSGt54" target="_blank"><img src="https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png" alt="Discord" height="25"></a>
</p>

## About The Project

Posterizarr is a PowerShell script with a full Web UI that automates generating images for your media library. It fetches artwork from Fanart.tv, TMDB, TVDB, Plex, and IMDb, focusing on textless images and applying your own custom overlays and text.

* **User-Friendly Web UI:** Manage settings, monitor activity, and trigger runs from a browser.
* **Multiple Media Servers:** Supports Plex, Jellyfin, and Emby.
* **Kometa Integration:** Organizes assets in a Kometa-compatible folder structure.
* **Smart Integration:** Trigger runs from Tautulli, Sonarr, and Radarr.

<p align="center">
  <a href="https://fscorrupt.github.io/posterizarr/installation">
    <img alt="Web UI Preview" width="100%" src="/docs/images/PosterizarrUI.png">
  </a>
</p>

## 🚀 Get Started

All installation instructions, configuration guides, and advanced tutorials have been moved to our dedicated documentation site.

## **[Click Here to Read the Full Documentation](https://fscorrupt.github.io/posterizarr/installation)**

## Supported Platforms 💻

[![Docker](https://img.shields.io/static/v1?style=for-the-badge&logo=docker&logoColor=FFFFFF&message=docker&color=1E63EE&label=)](https://fscorrupt.github.io/posterizarr/installation)
[![Unraid](https://img.shields.io/static/v1?style=for-the-badge&logo=unraid&logoColor=FFFFFF&message=unraid&color=E8402A&label=)](https://fscorrupt.github.io/posterizarr/installation)
[![Linux](https://img.shields.io/static/v1?style=for-the-badge&logo=linux&logoColor=FFFFFF&message=Linux&color=0D597F&label=)](https://fscorrupt.github.io/posterizarr/installation)
[![Windows](https://img.shields.io/static/v1?style=for-the-badge&logo=windows&logoColor=FFFFFF&message=windows&color=097CD7&label=)](https://fscorrupt.github.io/posterizarr/installation)
[![MacOS](https://img.shields.io/static/v1?style=for-the-badge&logo=apple&logoColor=FFFFFF&message=macOS&color=515151&label=)](https://fscorrupt.github.io/posterizarr/installation)
[![ARM](https://img.shields.io/static/v1?style=for-the-badge&logo=arm&logoColor=FFFFFF&message=ARM&color=815151&label=)](https://fscorrupt.github.io/posterizarr/installation)

## Sponsors ❤️

Check out our awesome sponsors!

<!-- sponsors --><!-- sponsors -->

## Privacy & Telemetry

[telemetry-code](telemetry-worker/worker.js)

Starting with `v2.2.50`, Posterizarr collects completely anonymous, basic usage stats to help guide development (e.g., knowing whether to prioritize Docker vs. Bare-Metal, or Plex vs. Jellyfin).

**NO** IP addresses, **NO** personal data, and **NO** file paths are collected or stored.

The telemetry payload contains exactly:
- Anonymous GUID
- OS
- Target Media Server
- App Version

You can opt-out at any time by setting `"telemetry": false` in your `config.json`.

## Enjoy

Feel free to customize the script further to meet your specific preferences or automation requirements.

I'm open about the fact that I use AI as a coding assistant, for the UI and Web components since I’m not a web dev by trade.
It helps me handle boilerplate and refactoring at a speed I couldn't achieve alone.
I review and test every line before it’s committed.

## PR Rules

> [!IMPORTANT]
>
> - Adjust on each PR the version number in script on Line 57 `$CurrentScriptVersion = "3.0.0"`
> - Adjust the version number in [Release.txt](Release.txt) to match the one in script.
>   - this is required because the script checks against this file if a newer version is available.
> - Do not include images on a PR.

<div align="center">
<br />
  <img src="docs/images/versioning.jpg" alt="Version Management" width="350">
  <br />
  <em>Version synchronization is critical for update detection</em>
</div>

<br />

**⭐ Star this repo if Posterizarr helps organize your media library!**

<div align="center">

[![Star History Chart](https://api.star-history.com/chart?repos=fscorrupt/posterizarr&type=date&legend=top-left&sealed_token=UnvtqA0-rM_NkgL8lgyAq-I_prozQwNYS1wh-4wh1wiIugXX349fyqJ530qGr22AVPY4GASP5PrS3s7GFpKqJ30IG8NpXMmHFqMa7F0cQghRjrCglFiErA)](https://www.star-history.com/?repos=fscorrupt%2Fposterizarr&type=date&legend=top-left)


<br />

---

<sub>Made with ❤️ by [fscorrupt](https://github.com/fscorrupt) and the [open source community](https://github.com/fscorrupt/posterizarr/graphs/contributors)</sub>

</div>
