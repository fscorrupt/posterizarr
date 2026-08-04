using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Tasks;
using MediaBrowser.Model.Entities;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Querying;
using MediaBrowser.Model.IO;
using Microsoft.Extensions.Logging;
using Posterizarr.Plugin.Providers;
using System.Security.Cryptography;
using Jellyfin.Data.Enums;
using System.Linq;

namespace Posterizarr.Plugin.Tasks;

public class PosterizarrSyncTask : IScheduledTask
{
    private readonly ILibraryManager _libraryManager;
    private readonly IProviderManager _providerManager;
    private readonly IFileSystem _fileSystem;
    private readonly ILogger<PosterizarrSyncTask> _logger;
    private readonly ILoggerFactory _loggerFactory;

    public PosterizarrSyncTask(
        ILibraryManager libraryManager,
        IProviderManager providerManager,
        IFileSystem fileSystem,
        ILogger<PosterizarrSyncTask> logger,
        ILoggerFactory loggerFactory)
    {
        _libraryManager = libraryManager;
        _providerManager = providerManager;
        _fileSystem = fileSystem;
        _logger = logger;
        _loggerFactory = loggerFactory;
    }

    public string Name => "Sync Posterizarr Assets";
    public string Key => "PosterizarrSyncTask";
    public string Description => "High-performance sync optimized for 30k+ items.";
    public string Category => "Posterizarr";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        return new[] { new TaskTriggerInfo { Type = TaskTriggerInfoType.DailyTrigger, TimeOfDayTicks = TimeSpan.FromHours(2).Ticks } };
    }

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        var config = Plugin.Instance?.Configuration;
        if (config == null || string.IsNullOrEmpty(config.AssetFolderPath)) return;

        var provider = new PosterizarrImageProvider(_libraryManager, _loggerFactory.CreateLogger<PosterizarrImageProvider>());

        var query = new InternalItemsQuery
        {
            IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Series, BaseItemKind.Season, BaseItemKind.Episode },
            Recursive = true,
            IsVirtualItem = false
        };

        var items = _libraryManager.GetItemList(query);
        int totalItems = items.Count;

        _logger.LogInformation("[Posterizarr] Starting memory-optimized sync for {0} items.", totalItems);

        for (var i = 0; i < totalItems; i++)
        {
            // Batch throttling: report progress and check cancellation
            if (i % 100 == 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                progress.Report((double)i / totalItems * 100);
            }

            try
            {
                var item = items[i];
                bool itemUpdated = false;

                // Call provider.GetSupportedImages to get exact types configured by user
                var typesToCheck = provider.GetSupportedImages(item);

                foreach (var type in typesToCheck)
                {
                    var localPath = provider.FindFile(item, config, type);
                    if (string.IsNullOrEmpty(localPath)) continue;

                    var existingImage = item.GetImageInfo(type, 0);

                    bool needUpdate = false;
                    if (existingImage == null)
                    {
                        _logger.LogInformation("[Posterizarr] [{0}] No existing '{1}' image. Need update.", item.Name, type);
                        needUpdate = true;
                    }
                    else if (string.Equals(localPath, existingImage.Path, StringComparison.OrdinalIgnoreCase))
                    {
                        // Same path: check if the file was modified since Jellyfin last saw it
                        if (File.GetLastWriteTimeUtc(localPath) > existingImage.DateModified.AddSeconds(2))
                        {
                            _logger.LogInformation("[Posterizarr] [{0}] Target file '{1}' modified. Need update.", item.Name, type);
                            needUpdate = true;
                        }
                    }
                    else if (!IsHashMatch(localPath, existingImage.Path))
                    {
                        // Different paths: compare hashes
                        _logger.LogInformation("[Posterizarr] [{0}] Hash mismatch for '{1}'. Need update.", item.Name, type);
                        needUpdate = true;
                    }

                    if (needUpdate)
                    {
                        _logger.LogInformation("[Posterizarr] [{0}] Saving image for '{1}' from '{2}'", item.Name, type, localPath);
                        try
                        {
                            var ext = Path.GetExtension(localPath).ToLowerInvariant();
                            string mimeType = ext switch { ".png" => "image/png", ".webp" => "image/webp", ".bmp" => "image/bmp", _ => "image/jpeg" };

                            using (var stream = new FileStream(localPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan))
                            {
                                await _providerManager.SaveImage(item, stream, mimeType, type, 0, cancellationToken).ConfigureAwait(false);
                            }
                            itemUpdated = true;
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "[Posterizarr] Failed to process image update for {0}", item.Name);
                        }
                    }
                }

                if (itemUpdated)
                {
                    // Persistence: Only updates the image rows in the database
                    var parent = item.ParentId != Guid.Empty ? _libraryManager.GetItemById(item.ParentId) : null;
                    await _libraryManager.UpdateItemAsync(item, parent ?? item, ItemUpdateType.ImageUpdate, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Posterizarr] Error syncing item at index {0}", i);
            }
        }

        progress.Report(100);
        _logger.LogInformation("[Posterizarr] Sync finished. Memory usage stabilized.");
    }

    private bool IsHashMatch(string sourcePath, string jellyfinPath)
    {
        if (string.IsNullOrEmpty(jellyfinPath) || !File.Exists(sourcePath) || !File.Exists(jellyfinPath)) return false;

        try
        {
            var sourceInfo = new FileInfo(sourcePath);
            var jellyfinInfo = new FileInfo(jellyfinPath);

            if (sourceInfo.Length != jellyfinInfo.Length) return false;

            // SequentialScan prevents Windows/Linux from caching these 37k files in the RAM Page Cache
            using var fs1 = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan);
            using var fs2 = new FileStream(jellyfinPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan);

            byte[] hash1 = MD5.HashData(fs1);
            byte[] hash2 = MD5.HashData(fs2);

            return hash1.SequenceEqual(hash2);
        }
        catch
        {
            return false;
        }
    }
}