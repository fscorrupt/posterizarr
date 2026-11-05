# Blueprints & Recipes

Welcome to the Posterizarr Blueprints and Recipes guide! This page provides quick-start configurations for common use cases.
You can easily find which settings you need to adjust to achieve a specific look or behavior.

---

## Logo Instead of Text

If you prefer to have a movie or show logo on your poster instead of standard generated text, you need to configure the following settings:

### Required Settings

1. **Prerequisite Settings** (General Settings)
   - Enable `UseLogo`: Set to `true` (For Posters)
   - Enable `UseBGLogo`: Set to `true` (For Backgrounds)
   - **Logo Type**:
     - For **Clearlogo**: Enable `UseClearlogo` and disable `UseClearart`.
     - For **Clearart**: Enable `UseClearart` and disable `UseClearlogo`.
   - **Flat Colors** (Optional for a clean white logo):
     - Enable `ConvertLogoColor` to `true`.
     - Set `LogoFlatColor` to `white`.

2. **Poster & Background Settings**
   - Enable `AddText` in **Poster Settings**: Set to `true`.
   - Enable `AddText` in **Background Settings**: Set to `true`.

By making these changes, Posterizarr will download the specified logo type from Fanart.tv or TMDb and place it onto the poster and backgrounds instead of text.

---

## Show Title on Season Posters

By default, season posters might only show the season text (e.g., "Season 1"). If you want to also display the show's title (or logo, if logo settings are enabled) on the season posters:

### Required Settings

1. **Show Title on Season Settings**
   - Enable `AddShowTitletoSeason`: Set to `true`.

This will ensure the title/logo is rendered on the season poster alongside the season text.

---

## Minimalist Posters

If you want an extremely clean look and want to disable all borders, text, and overlays, you can completely disable image processing. This ensures that Posterizarr only downloads the original raw poster and moves it to the asset directory.

### Required Settings

1. **Image Processing** (Image Processing Settings)
   - Disable `ImageProcessing`: Set to `false`.

---

## Global Overlay Layouts

In addition to logo-specific blueprints, the Posterizarr WebUI provides several one-click blueprints to quickly adjust the overall layout of all your posters, backgrounds, and title cards at once:

- **Enable All Overlays**: Turns on borders, text, and overlays globally.
- **Only Borders**: Disables text and overlays, keeping only the borders.
- **Only Text**: Disables borders and overlays, keeping only the text (or logos).
- **Only Overlays**: Disables text and borders, keeping only the image overlays (e.g., resolutions or ratings).

---

## Pro Tips & Recipes from the Community

Here are some awesome tips and configurations shared by the community to get the most out of Posterizarr:

### 1. Multi-Server Sync & Asset Sharing
If you run Plex alongside Emby or Jellyfin and want them to share the same Posterizarr assets, set:
- `UsePlex`: `false`
- `UseJellyfin` or `UseEmby`: `true`

Posterizarr will download the artwork and upload it to Emby/Jellyfin. Kometa can then seamlessly use those assets for Plex! Just make sure your library names match across the servers.

**Important:** If you're testing multi-server setups or changing library exclusions, make sure to set `AssetCleanup: false` to avoid accidentally deleting your assets!

Alternatively, you can run Posterizarr with the `-SyncJelly/Emby` switch as a scheduled task to sync artwork directly from Plex to Jellyfin/Emby.

### 2. Test a Blueprint

Open **Run Modes > Testing Mode** to generate sample artwork with your current
configuration and active blueprints. Review the results in **Test Gallery**
before running a full library. Testing Mode does not upload the sample images to
your media server. The [Run Modes guide](modes.md#test-mode) shows the workflow.

### 3. Textless Posters Only
If you *only* want clean, textless posters and want Posterizarr to skip any posters that include text, set your language orders exclusively to `xx`:
- `PreferredLanguageOrder`: `["xx"]`
- `PreferredSeasonLanguageOrder`: `["xx"]`

*(This configuration is available as a 1-click blueprint in the WebUI!)*

### 4. Re-Applying Newly Generated Posters to Libraries
If you've played around with customizations, cleared out your old assets, and generated entirely new posters, Posterizarr won't automatically overwrite the existing images on the media server unless explicitly told to bypass its checks.

To force Posterizarr to apply the new posters over the old ones on your media server, you need to combine two settings:
- `UploadExistingAssets`: `true`
- `DisableHashValidation`: `true`

**Important Note:** You should only enable these settings temporarily when you actually want to replace everything. Because this forces the script to go through and upload *every* asset again, it will take quite a bit of time depending on the size of your library!

---

*Note: You can apply many of these blueprints automatically with a single click using the "Blueprints" feature in the Posterizarr WebUI!*
