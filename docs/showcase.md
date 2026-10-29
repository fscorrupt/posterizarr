# Posterizarr Artwork Showcase

Posterizarr creates artwork and applies supported Dynamic Overlays natively,
with direct uploads to Plex, Jellyfin, and Emby. A separate overlay application
is not required for the native workflow.

![Posterizarr artwork formats with native Dynamic Overlays](images/posterizarr_banner.jpg)

## Posters

Movie and show posters share a portrait canvas but can use different badges.
Season artwork has its own format and rules. Layouts are configurable per library
and format; not every badge has metadata available at every level.

<div style="display: flex; flex-wrap: wrap; gap: 16px; justify-content: center;">
    <img src="images/artwork/native-movie-poster.jpg" alt="Selected Plex Matrix (1999) poster with its current badges" width="280">
    <img src="images/artwork/native-show-poster.jpg" alt="Selected Plex Breaking Bad (2008) show poster with 4K, status and score badges" width="280">
    <img src="images/artwork/native-season-poster.jpg" alt="Selected Plex Breaking Bad Season 1 poster with season title and network artwork" width="280">
</div>

## Titlecards and Backgrounds

Landscape formats use their own placement. These images are the currently
selected Plex episode and background artwork, including any existing text,
borders, or badges. Available badges depend on the item's metadata and rules.

![Selected Plex Breaking Bad S01E01 titlecard with 4K, episode text, flags and runtime](images/artwork/native-titlecard.jpg)

![Selected Plex background for Matrix (1999)](images/artwork/native-background.jpg)

## Collections

Collection posters are an additional artwork format, not a Dynamic Overlay
target level. Use the collection designer for custom collection artwork.

<div style="display: flex; flex-wrap: wrap; gap: 24px; align-items: center; justify-content: center;">
    <img src="images/artwork/collection-poster-example.jpg" alt="Selected Plex Alien and Predator Timeline collection poster" width="280">
</div>

!!! note "Artwork source"
    The six JPEG examples and their banner thumbnails were downloaded from the
    artwork currently selected in a real Plex installation. The movie example is
    Matrix (1999). The show, season, and titlecard all belong to Breaking Bad
    (2008), Season 1; the episode is S01E01. Its video metadata reports a 3840-pixel
    width, independently of the visible 4K badge. The collection is Alien & Predator
    Timeline. No mock titles or preview badges were added for this page.
    Captures used read-only requests; no server artwork or configuration
    was changed. These examples are not default layouts or performance benchmarks.

[Design your own native overlays](dynamic_overlays.md) or
[explore Blueprints and collection recipes](blueprints.md).

## Asset-Creation Styling

Posterizarr's base artwork-generation pipeline also supports fonts, gradients,
borders, and title/logo placement before any dynamic badges are applied.

### Colus-Regular.ttf
![Posterizarr-generated base artwork using Colus](images/posterizarr-overview-new.jpg)

### Comfortaa-Medium.ttf
![Posterizarr-generated base artwork using Comfortaa](images/posterizarr-overview.jpg)

These base-styling examples use this
[Posterizarr configuration](https://github.com/fscorrupt/posterizarr/blob/main/MyPersonalConfig.json).

<a id="images-from-testing-mode"></a>
## Testing Mode

Use the [Testing Mode guide](modes.md#testing-mode) to check asset-generation
styling before processing a library. Dynamic Overlays has a separate preview and
Dry Run workflow; its sample metadata does not represent a particular server item.

![Posterizarr asset-creation test image](images/testing.png)

## Discord Webhook
![webhookexample](images/webhookexample.png)
