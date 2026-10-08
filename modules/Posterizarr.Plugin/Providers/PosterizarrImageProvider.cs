using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Providers;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

namespace Posterizarr.Plugin.Providers;

public class PosterizarrImageProvider : IRemoteImageProvider, IHasItemChangeMonitor, IHasOrder
{
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<PosterizarrImageProvider> _logger;
    private readonly AssetPathResolver _pathResolver;

    public PosterizarrImageProvider(ILibraryManager libraryManager, ILogger<PosterizarrImageProvider> logger, AssetPathResolver? pathResolver = null)
    {
        _libraryManager = libraryManager;
        _logger = logger;
        _pathResolver = pathResolver ?? new AssetPathResolver(libraryManager, logger);
    }

    public string Name => "Posterizarr Local Middleware";
    public int Order => -10;

    public AssetPathResolver PathResolver => _pathResolver;

    private void LogDebug(string message, params object[] args)
    {
        if (Plugin.Instance?.Configuration?.EnableDebugMode == true)
        {
            _logger.LogInformation("[Posterizarr DEBUG] " + message, args);
        }
    }

    public bool Supports(BaseItem item) => item is Movie || item is Series || item is Season || item is Episode || item is BoxSet;

    public IEnumerable<ImageType> GetSupportedImages(BaseItem item)
    {
        var config = Plugin.Instance?.Configuration;
        var types = new List<ImageType>();
        
        if (item is Movie || item is Series)
        {
            if (config?.UpdatePoster == true) types.Add(ImageType.Primary);
            if (config?.UpdateBackdrop == true) types.Add(ImageType.Backdrop);
            if (config?.UpdateThumbnail == true) types.Add(ImageType.Thumb);
        }
        else if (item is Season)
        {
            if (config?.UpdateSeason == true) types.Add(ImageType.Primary);
        }
        else if (item is Episode)
        {
            if (config?.UpdateTitlecard == true) types.Add(ImageType.Primary);
        }
        else if (item is BoxSet)
        {
            if (config?.UpdateCollection == true)
            {
                types.Add(ImageType.Primary);
                if (config?.UpdateBackdrop == true) types.Add(ImageType.Backdrop);
                if (config?.UpdateThumbnail == true) types.Add(ImageType.Thumb);
            }
        }

        return types;
    }

    /// <summary>
    /// Required by Jellyfin's MetadataService to prevent skipping the provider when refreshing
    /// metadata on existing items (runAllProviders is false unless IHasItemChangeMonitor.HasChanged returns true).
    /// </summary>
    public bool HasChanged(BaseItem item, IDirectoryService directoryService)
    {
        var config = Plugin.Instance?.Configuration;
        if (config == null || string.IsNullOrEmpty(config.AssetFolderPath))
        {
            return false;
        }

        if (config.EnablePlexSync && (item is not BoxSet || !config.UpdateCollection))
        {
            return false;
        }

        try
        {
            foreach (var type in GetSupportedImages(item))
            {
                var fileInfo = FindFileInfo(item, config, type);
                if (fileInfo != null)
                {
                    LogDebug("HasChanged: Local file match found for '{0}' ({1}): {2}", item.Name, type, fileInfo.FullName);
                    return true;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Posterizarr] Error in HasChanged for '{0}'", item.Name);
        }

        return false;
    }

    public async Task<IEnumerable<RemoteImageInfo>> GetImages(BaseItem item, CancellationToken cancellationToken)
    {
        var config = Plugin.Instance?.Configuration;
        if (config?.EnablePlexSync == true && (item is not BoxSet || !config.UpdateCollection))
        {
            LogDebug("Plex Direct Sync is active. Bypassing local image lookup for '{0}' to prevent overwrite.", item.Name);
            return Enumerable.Empty<RemoteImageInfo>();
        }

        _logger.LogInformation("[Posterizarr] Searching images for '{0}' (Type: {1})", item.Name, item.GetType().Name);

        if (config == null || string.IsNullOrEmpty(config.AssetFolderPath))
        {
            _logger.LogWarning("[Posterizarr] Configuration missing or AssetFolderPath is not configured.");
            return Enumerable.Empty<RemoteImageInfo>();
        }

        var results = new List<RemoteImageInfo>();
        foreach (var type in GetSupportedImages(item))
        {
            LogDebug("Checking for image type: {0}", type);
            var fileInfo = FindFileInfo(item, config, type);
            if (fileInfo != null)
            {
                _logger.LogInformation("[Posterizarr] Found {0} for '{1}' at '{2}'", type, item.Name, fileInfo.FullName);
                results.Add(new RemoteImageInfo { ProviderName = Name, Url = fileInfo.FullName, Type = type });
            }
            else
            {
                LogDebug("RESULT: No matching file found for {0}", type);
            }
        }

        if (results.Count == 0)
        {
            _logger.LogInformation("[Posterizarr] No matching images found for '{0}' in '{1}'", item.Name, config.AssetFolderPath);
        }

        return results;
    }

    public FileInfo? FindFileInfo(BaseItem item, Configuration.PluginConfiguration config, ImageType type)
    {
        return _pathResolver.FindFileInfo(item, config, type);
    }

    public string? FindFile(BaseItem item, Configuration.PluginConfiguration config, ImageType type)
    {
        return _pathResolver.FindFile(item, config, type);
    }

    public Task<HttpResponseMessage> GetImageResponse(string url, CancellationToken cancellationToken)
    {
        if (File.Exists(url))
        {
            _logger.LogInformation("[Posterizarr] Serving image: {0}", url);
            var response = new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StreamContent(File.OpenRead(url)) };
            var ext = Path.GetExtension(url).ToLowerInvariant();
            string mimeType = ext switch { ".png" => "image/png", ".webp" => "image/webp", ".bmp" => "image/bmp", _ => "image/jpeg" };
            response.Content.Headers.ContentType = new MediaTypeHeaderValue(mimeType);
            return Task.FromResult(response);
        }
        _logger.LogError("[Posterizarr] File not found when serving response: {0}", url);
        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.NotFound));
    }
}