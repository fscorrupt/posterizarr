This document describes how Posterizarr searches for assets based on the **Provider Priority** configuration.

Posterizarr uses a unified, dynamic approach to search for assets across all categories. The sequence in which providers are checked depends on your `ProviderPriorityMode`.

### Modes

#### 1. Simple (Default)
In `Simple` mode, Posterizarr automatically constructs a search list based on your `FavProvider`. Your favorite provider is placed first, followed by the remaining legacy providers in this order: `TMDB, FANART, TVDB, PLEX, IMDB`.

For example, if your `FavProvider` is `TVDB`, the search order will be:
`TVDB, TMDB, FANART, PLEX, IMDB`

#### 2. Global
In `Global` mode, Posterizarr bypasses the legacy order entirely and checks providers in the exact sequence specified in your `ProviderOrder` array.
Example: `["FANART", "TMDB", "TVDB", "PLEX"]`

#### 3. PerMediaType
In `PerMediaType` mode, Posterizarr allows you to define a specific provider array for each media type (Movies, Shows, Seasons, Episodes) independently.

### Asset Specifics and Limitations

While the provider list is evaluated sequentially, some providers do not support certain asset types. If a provider in your list does not support the asset being searched for, it is simply skipped.

> **Note on "PLEX"**: In Posterizarr, the provider name `PLEX` generically refers to whichever media server you have connected (Plex, Emby, or Jellyfin). It will search your local media server's existing assets.

| Asset Category | Supported Providers | Notes |
| :--- | :--- | :--- |
| **Movie Poster & Background** | TMDB, FANART, TVDB, PLEX, IMDB | IMDB and PLEX are **not** used for Textless assets (`xx`). IMDB is for Movies only. |
| **Show Poster & Background** | TMDB, FANART, TVDB, PLEX | PLEX is **not** used for Textless assets (`xx`). |
| **Show Season Poster** | TMDB, FANART, TVDB, PLEX | PLEX is **not** used for Textless assets (`xx`). |
| **Title Cards** | TMDB, TVDB, PLEX | FANART and IMDB do not support Title Cards and will be skipped. PLEX is **not** used for Textless assets (`xx`). |

### Fallback Flagging
If an asset is found on a provider that is **not** the first provider in your prioritized list, it will be flagged as a **Fallback** (`Fallback = true`) in the Action Center CSV output.