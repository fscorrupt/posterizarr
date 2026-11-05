# Requirements

The exact requirements depend on how you install Posterizarr and which artwork
providers you plan to use. You do not need to set up every optional integration
before your first run.

## Needed for a basic setup

- A supported media server: Plex, Jellyfin, or Emby. Silo is also available with
    **experimental** support, without full feature parity.
- Network access from Posterizarr to that server, plus a server API token or key
    with the permissions required for your workflow.
- Persistent storage for configuration and generated assets. With Docker, use
    writable `/config` and `/assets` mounts.

## Provider credentials

Add credentials for the providers you intend to use. Common providers are:

- [TMDb](https://www.themoviedb.org/settings/api): create a Read Access Token.
- [Fanart.tv](https://fanart.tv/get-an-api-key): create a personal API key.
- [TheTVDB](https://thetvdb.com/api-information/signup): use a Project API key,
    not a Legacy API key.

The [configuration reference](configuration.md) lists the setting names and
provider order. Optional features may require their own credentials; their guides
explain those separately.

## Installation-specific software

- **Docker / Unraid:** Docker is required. PowerShell and ImageMagick are included
    in the Posterizarr container; use the [installation guide](installation.md).
- **Manual PowerShell installation:** PowerShell 7 or newer is required. Follow
    the [manual walkthrough](walkthrough.md) for modules and first-run setup.
- **Web UI from source:** Python and Node.js are required. This is a separate
    development/manual UI path described in the [UI installation guide](uiinstallation.md).

## Image sizes

Recommended dimensions when preparing local artwork:

| Artwork | Aspect ratio | Recommended dimensions |
|---|---:|---:|
| Movie, show, and season posters | 2:3 | 2000 × 3000 px |
| Backgrounds and titlecards | 16:9 | 3840 × 2160 px |

Smaller images may still be processed, but can look softer. The Web UI warns
about undersized uploads.