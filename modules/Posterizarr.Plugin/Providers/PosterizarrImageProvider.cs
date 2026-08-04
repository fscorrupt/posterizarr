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

public class PosterizarrImageProvider : IRemoteImageProvider, IHasOrder
{
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<PosterizarrImageProvider> _logger;

    public PosterizarrImageProvider(ILibraryManager libraryManager, ILogger<PosterizarrImageProvider> logger)
    {
        _libraryManager = libraryManager;
        _logger = logger;
    }

    public string Name => "Posterizarr Local Middleware";
    public int Order => -10;

    private void LogDebug(string message, params object[] args)
    {
        if (Plugin.Instance?.Configuration?.EnableDebugMode == true)
        {
            _logger.LogInformation("[Posterizarr DEBUG] " + message, args);
        }
    }

    public bool Supports(BaseItem item) => item is Movie || item is Series || item is Season || item is Episode;
    public IEnumerable<ImageType> GetSupportedImages(BaseItem item)
    {
        var config = Plugin.Instance?.Configuration;
        var types = new List<ImageType> { ImageType.Primary };
        if (config?.ReplaceThumbwithBackdropExclusively != true)
        {
            types.Add(ImageType.Backdrop);
        }
        if (config?.ReplaceThumbwithBackdrop == true)
        {
            types.Add(ImageType.Thumb);
        }
        return types;
    }

    public async Task<IEnumerable<RemoteImageInfo>> GetImages(BaseItem item, CancellationToken cancellationToken)
    {
        var config = Plugin.Instance?.Configuration;
        LogDebug(">>> STARTING image search for Item: '{0}' (Type: {1})", item.Name, item.GetType().Name);

        if (config == null || string.IsNullOrEmpty(config.AssetFolderPath))
        {
            _logger.LogWarning("[Posterizarr] Configuration missing or AssetFolderPath is not configured.");
            return Enumerable.Empty<RemoteImageInfo>();
        }

        var results = new List<RemoteImageInfo>();
        foreach (var type in GetSupportedImages(item))
        {
            LogDebug("Checking for image type: {0}", type);
            var path = FindFile(item, config, type);
            if (!string.IsNullOrEmpty(path))
            {
                LogDebug("SUCCESS: Found {0} at '{1}'", type, path);
                results.Add(new RemoteImageInfo { ProviderName = Name, Url = path, Type = type });
            }
            else
            {
                LogDebug("RESULT: No matching file found for {0}", type);
            }
        }
        return results;
    }

    public string? FindFile(BaseItem item, Configuration.PluginConfiguration config, ImageType type)
    {
        // 1. Resolve Library Names
        var displayLibraryName = item.GetAncestorIds()
            .Select(id => _libraryManager.GetItemById(id))
            .OfType<CollectionFolder>()
            .FirstOrDefault()?.Name ?? "Unknown";

        var internalLibraryName = item.GetAncestorIds()
            .Select(id => _libraryManager.GetItemById(id))
            .FirstOrDefault(p => p != null && p.ParentId != Guid.Empty && _libraryManager.GetItemById(p.ParentId)?.ParentId == Guid.Empty)?
            .Name ?? "Unknown";

        LogDebug("Library Resolution -> Display Name: '{0}', Internal Name: '{1}'", displayLibraryName, internalLibraryName);

        // 2. Multi-Strategy Library Lookup
        if (!Directory.Exists(config.AssetFolderPath))
        {
            _logger.LogError("[Posterizarr] Asset Folder Path does not exist: {0}", config.AssetFolderPath);
            return null;
        }

        var directories = Directory.GetDirectories(config.AssetFolderPath);
        string? libraryDir = null;

        // Strategy A: Exact Match on Display Name
        libraryDir = directories.FirstOrDefault(d => string.Equals(Path.GetFileName(d), displayLibraryName, StringComparison.OrdinalIgnoreCase));
        if (libraryDir != null) LogDebug("Strategy A (Exact Display) MATCHED: {0}", Path.GetFileName(libraryDir));

        // Strategy B: Exact Match on Internal Name
        if (libraryDir == null)
        {
            libraryDir = directories.FirstOrDefault(d => string.Equals(Path.GetFileName(d), internalLibraryName, StringComparison.OrdinalIgnoreCase));
            if (libraryDir != null) LogDebug("Strategy B (Exact Internal) MATCHED: {0}", Path.GetFileName(libraryDir));
        }

        // Strategy C: Fuzzy Match
        if (libraryDir == null)
        {
            LogDebug("Strategies A & B failed. Attempting Strategy C (Fuzzy Match)...");
            var searchTerms = new[] { displayLibraryName, internalLibraryName }
                .Where(s => s != "Unknown" && s != "root")
                .Select(s => s.Replace(" ", "").ToLowerInvariant())
                .Distinct();

            libraryDir = directories.FirstOrDefault(d => {
                var folderStripped = Path.GetFileName(d).Replace(" ", "").ToLowerInvariant();
                return searchTerms.Any(term => folderStripped.Contains(term) || term.Contains(folderStripped));
            });
            if (libraryDir != null) LogDebug("Strategy C (Fuzzy) MATCHED: {0}", Path.GetFileName(libraryDir));
        }

        if (libraryDir == null)
        {
            LogDebug("FAIL: Could not find a folder in AssetPath matching '{0}' or '{1}'", displayLibraryName, internalLibraryName);
            return null;
        }

        // 3. Resolve Media Folder Name from Disk
        var directoryPath = (item is Movie || item is Series) ? (item is Movie ? Path.GetDirectoryName(item.Path) : item.Path) :
                            (item is Season s ? s.Series.Path : (item is Episode e ? e.Series.Path : ""));

        var subFolder = Path.GetFileName(directoryPath) ?? "";
        LogDebug("Media Subfolder resolved to: '{0}'", subFolder);

        string fileNameBase = type switch {
            ImageType.Primary when item is Season sn => $"season{sn.IndexNumber ?? 0:D2}",
            ImageType.Primary when item is Episode ep => $"S{ep.ParentIndexNumber ?? 0:D2}E{ep.IndexNumber ?? 0:D2}",
            ImageType.Primary => "poster",
            ImageType.Thumb => "background",
            _ => "background"
        };

        var actualFolder = Path.Combine(libraryDir, subFolder);
        LogDebug("Full target path to check: {0}", actualFolder);

        if (!Directory.Exists(actualFolder))
        {
            LogDebug("FAIL: Folder '{0}' does not exist on disk.", actualFolder);
            return null;
        }

        // 4. File Lookup
        var filesInFolder = Directory.GetFiles(actualFolder);
        LogDebug("Searching for base name '{0}' with supported extensions...", fileNameBase);

        foreach (var ext in config.SupportedExtensions)
        {
            var targetFile = fileNameBase + ext;
            var match = filesInFolder.FirstOrDefault(f => Path.GetFileName(f).Equals(targetFile, StringComparison.OrdinalIgnoreCase));
            if (match != null) return match;

            if (type == ImageType.Backdrop || type == ImageType.Thumb)
            {
                var fanartTarget = "fanart" + ext;
                var fanartMatch = filesInFolder.FirstOrDefault(f => Path.GetFileName(f).Equals(fanartTarget, StringComparison.OrdinalIgnoreCase));
                if (fanartMatch != null)
                {
                    LogDebug("Found fallback: {0}", fanartTarget);
                    return fanartMatch;
                }
            }
        }

        LogDebug("No file matched '{0}' with extensions: {1}", fileNameBase, string.Join(", ", config.SupportedExtensions));
        return null;
    }

    public Task<HttpResponseMessage> GetImageResponse(string url, CancellationToken cancellationToken)
    {
        LogDebug("Serving image response for: {0}", url);
        if (File.Exists(url))
        {
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