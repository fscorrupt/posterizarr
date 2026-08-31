This table illustrates the legacy fallback order when searching for assets (Posters, Backgrounds, etc.) based on the **Favorite Provider** you set in your configuration.

> **Note:** You can now bypass these hardcoded priority lists by setting `ProviderPriorityMode` to `Global` or `PerMediaType` in your configuration. When enabled, Posterizarr will sequentially check providers based strictly on the custom `ProviderOrder` arrays you specify (e.g., `["TMDB", "TVDB", "Fanart", "Plex"]`).

| Asset Category | If Favorite Provider is... | Priority Order (1st to 5th) | Notes |
| :--- | :--- | :--- | :--- |
| **Movie Poster & Background** | **TMDB** | TMDB, FANART, TVDB, PLEX, IMDB | IMDB and PLEX are **not** used for Textless assets (`xx`). |
| | **TVDB** | TVDB, TMDB, FANART, PLEX, IMDB | IMDB is **Movies only**. |
| | **FANART** | FANART, TMDB, TVDB, PLEX, IMDB | |
| **Show Poster & Background** | **TMDB** | TMDB, FANART, TVDB, PLEX | PLEX is **not** used for Textless assets (`xx`). |
| | **FANART** | FANART, TMDB, TVDB, PLEX | |
| | **TVDB** | TVDB, TMDB, FANART, PLEX | |
| **Show Season Poster** | **TMDB** | TMDB, FANART, TVDB, PLEX | PLEX is **not** used for Textless assets (`xx`). |
| | **FANART** | FANART, TMDB, TVDB, PLEX | |
| | **TVDB** | TVDB, TMDB, FANART, PLEX | |


Title Cards have slightly simpler priority logic, often falling back if the primary choice is unavailable.

| Asset Category | Condition | Priority Order (1st to 4th) | Notes |
| :--- | :--- | :--- | :--- |
| **Show TC with Background** | **If TMDB is fav Provider** | TMDB, TVDB, FANART, PLEX | PLEX is **not** used for Textless assets (`xx`). |
| | **Otherwise (Else)** | TVDB, TMDB, FANART, PLEX | |
| **Show TC Poster** | **If TMDB is fav Provider** | TMDB, TVDB, PLEX | PLEX is **not** used for Textless assets (`xx`). |
| | **Otherwise (Else)** | TVDB, TMDB, PLEX | |