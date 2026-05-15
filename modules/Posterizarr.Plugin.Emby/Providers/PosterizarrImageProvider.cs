using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Configuration;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Providers;

namespace Posterizarr.Plugin.Providers
{
    public class PosterizarrImageProvider : IRemoteImageProvider, IHasOrder
    {
        private readonly ILibraryManager _libraryManager;
        private readonly ILogger _logger;
        private readonly IServerApplicationHost _appHost;

        public PosterizarrImageProvider(ILibraryManager libraryManager, ILogManager logManager, IServerApplicationHost appHost)
        {
            _libraryManager = libraryManager;
            _logger = logManager.GetLogger(GetType().Name);
            _appHost = appHost;
        }

        public string Name => "Posterizarr";
        public int Order => -10;

        private void LogDebug(string message, params object[] args)
        {
            if (Plugin.Instance?.Configuration?.EnableDebugMode == true)
                _logger.Info("[Posterizarr DEBUG] " + message, args);
        }

        public bool Supports(BaseItem item) => item is Movie || item is Series || item is Season || item is Episode;
        public IEnumerable<ImageType> GetSupportedImages(BaseItem item) =>
            item is Movie || item is Series
                ? new[] { ImageType.Primary, ImageType.Backdrop }
                : new[] { ImageType.Primary };

        public Task<IEnumerable<RemoteImageInfo>> GetImages(BaseItem item, LibraryOptions libraryOptions, CancellationToken cancellationToken)
        {
            var config = Plugin.Instance?.Configuration;
            if (config == null || string.IsNullOrEmpty(config.AssetFolderPath))
            {
                _logger.Warn("[Posterizarr] AssetFolderPath is not configured.");
                return Task.FromResult(Enumerable.Empty<RemoteImageInfo>());
            }

            LogDebug("Searching images for '{0}' ({1})", item.Name, item.GetType().Name);

            var typesToSearch = (item is Movie || item is Series)
                ? new[] { ImageType.Primary, ImageType.Backdrop }
                : new[] { ImageType.Primary };

            var results = new List<RemoteImageInfo>();
            foreach (var type in typesToSearch)
            {
                var path = FindFile(item, config, type);
                if (string.IsNullOrEmpty(path)) continue;

                LogDebug("Found {0}: '{1}'", type, path);
                var mtime = new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeSeconds();
                var url = $"http://127.0.0.1:{_appHost.HttpPort}/Posterizarr/Image?path={Uri.EscapeDataString(path)}&t={mtime}";
                results.Add(new RemoteImageInfo { ProviderName = Name, Url = url, ThumbnailUrl = url, Type = type });
            }

            return Task.FromResult<IEnumerable<RemoteImageInfo>>(results);
        }

        internal string? FindFile(BaseItem item, Configuration.PluginConfiguration config, ImageType type)
        {
            var collectionFolders = _libraryManager.GetCollectionFolders(item);
            var libraryName = collectionFolders?.Length > 0 ? collectionFolders[0].Name : "Unknown";
            LogDebug("Library: '{0}'", libraryName);

            if (!Directory.Exists(config.AssetFolderPath))
            {
                _logger.Error("[Posterizarr] Asset folder does not exist: {0}", config.AssetFolderPath);
                return null;
            }

            var directories = Directory.GetDirectories(config.AssetFolderPath);

            // Strategy A: exact name match
            var libraryDir = directories.FirstOrDefault(d =>
                string.Equals(Path.GetFileName(d), libraryName, StringComparison.OrdinalIgnoreCase));
            if (libraryDir != null)
                LogDebug("Matched library (exact): {0}", Path.GetFileName(libraryDir));

            // Strategy B: fuzzy match — strip spaces, case-insensitive substring
            if (libraryDir == null && libraryName != "Unknown" && libraryName != "root")
            {
                var searchTerm = libraryName.Replace(" ", "").ToLowerInvariant();
                libraryDir = directories.FirstOrDefault(d =>
                {
                    var folderNorm = Path.GetFileName(d).Replace(" ", "").ToLowerInvariant();
                    return folderNorm.Contains(searchTerm) || searchTerm.Contains(folderNorm);
                });
                if (libraryDir != null)
                    LogDebug("Matched library (fuzzy): {0}", Path.GetFileName(libraryDir));
            }

            if (libraryDir == null)
            {
                LogDebug("No asset folder found for library '{0}'", libraryName);
                return null;
            }

            var mediaPath = item switch
            {
                Movie => Path.GetDirectoryName(item.Path),
                Series => item.Path,
                Season s => s.Series.Path,
                Episode e => e.Series.Path,
                _ => ""
            };

            var subFolder = Path.GetFileName(mediaPath) ?? "";
            LogDebug("Media subfolder: '{0}'", subFolder);

            var fileNameBase = (type, item) switch
            {
                (ImageType.Primary, Season sn) => $"season{sn.IndexNumber ?? 0:D2}",
                (ImageType.Primary, Episode ep) => $"S{ep.ParentIndexNumber ?? 0:D2}E{ep.IndexNumber ?? 0:D2}",
                (ImageType.Primary, _) => "poster",
                _ => "background"
            };

            var folder = Path.Combine(libraryDir, subFolder);
            if (!Directory.Exists(folder))
            {
                LogDebug("Folder does not exist: {0}", folder);
                return null;
            }

            LogDebug("Looking for '{0}' in {1}", fileNameBase, folder);
            var files = Directory.GetFiles(folder);
            foreach (var ext in config.SupportedExtensions)
            {
                var match = files.FirstOrDefault(f =>
                    Path.GetFileName(f).Equals(fileNameBase + ext, StringComparison.OrdinalIgnoreCase));
                if (match != null) return match;

                if (type == ImageType.Backdrop)
                {
                    var fanart = files.FirstOrDefault(f =>
                        Path.GetFileName(f).Equals("fanart" + ext, StringComparison.OrdinalIgnoreCase));
                    if (fanart != null)
                    {
                        LogDebug("Using fanart fallback: {0}", Path.GetFileName(fanart));
                        return fanart;
                    }
                }
            }

            LogDebug("No file found for '{0}'", fileNameBase);
            return null;
        }

        // Required by IRemoteImageProvider; not called since URLs are served via the HTTP endpoint.
        public Task<HttpResponseInfo> GetImageResponse(string url, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseInfo { StatusCode = System.Net.HttpStatusCode.NotFound });
    }
}
