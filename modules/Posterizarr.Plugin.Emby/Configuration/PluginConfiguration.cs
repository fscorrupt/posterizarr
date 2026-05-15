using MediaBrowser.Model.Plugins;

namespace Posterizarr.Plugin.Configuration
{
    public class PluginConfiguration : BasePluginConfiguration
    {
        public string AssetFolderPath { get; set; }
        public string[] SupportedExtensions { get; set; }
        public bool EnableDebugMode { get; set; }

        public PluginConfiguration()
        {
            AssetFolderPath = string.Empty;
            SupportedExtensions = new[] { ".jpg", ".jpeg", ".png", ".webp", ".bmp" };
            EnableDebugMode = false;
        }
    }
}
