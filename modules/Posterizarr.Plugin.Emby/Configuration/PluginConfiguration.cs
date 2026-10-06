using MediaBrowser.Model.Plugins;

namespace Posterizarr.Plugin.Configuration
{
    public class PluginConfiguration : BasePluginConfiguration
    {
        public string AssetFolderPath { get; set; }
        public string[] SupportedExtensions { get; set; }
        public bool EnableDebugMode { get; set; }
        public bool UpdatePoster { get; set; }
        public bool UpdateSeason { get; set; }
        public bool UpdateTitlecard { get; set; }
        public bool UpdateBackdrop { get; set; }
        public bool UpdateThumbnail { get; set; }
        public bool UpdateCollection { get; set; }
        public string PosterizarrApiUrl { get; set; }
        public string PosterizarrApiKey { get; set; }
        public bool EnableRealtimeSync { get; set; }

        // Plex Direct Sync (Kometa / Asset Mirroring)
        public bool EnablePlexSync { get; set; }
        public string PlexServerUrl { get; set; }
        public string PlexToken { get; set; }
        public bool PlexSyncMovies { get; set; }
        public bool PlexSyncShows { get; set; }
        public bool PlexSyncSeasons { get; set; }
        public bool PlexSyncBackdrops { get; set; }
        public string PlexLibrariesToInclude { get; set; }

        public PluginConfiguration()
        {
            AssetFolderPath = string.Empty;
            SupportedExtensions = new[] { ".jpg", ".jpeg", ".png", ".webp", ".bmp" };
            EnableDebugMode = false;
            UpdatePoster = true;
            UpdateSeason = true;
            UpdateTitlecard = true;
            UpdateBackdrop = true;
            UpdateThumbnail = false;
            UpdateCollection = false;
            PosterizarrApiUrl = string.Empty;
            PosterizarrApiKey = string.Empty;
            EnableRealtimeSync = false;

            // Plex Direct Sync defaults (disabled by default)
            EnablePlexSync = false;
            PlexServerUrl = string.Empty;
            PlexToken = string.Empty;
            PlexSyncMovies = true;
            PlexSyncShows = true;
            PlexSyncSeasons = true;
            PlexSyncBackdrops = false;
            PlexLibrariesToInclude = string.Empty;
        }
    }
}
