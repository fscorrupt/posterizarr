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

        public PluginConfiguration()
        {
            AssetFolderPath = string.Empty;
            SupportedExtensions = new[] { ".jpg", ".jpeg", ".png", ".webp", ".bmp" };
            EnableDebugMode = false;
            UpdatePoster = true;
            UpdateSeason = true;
            UpdateTitlecard = true;
            UpdateBackdrop = true;
            UpdateThumbnail = true;
        }
    }
}
