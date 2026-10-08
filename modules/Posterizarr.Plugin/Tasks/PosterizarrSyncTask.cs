using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Querying;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;
using Posterizarr.Plugin.Providers;

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

    private void LogDebug(string message, params object[] args)
    {
        if (Plugin.Instance?.Configuration?.EnableDebugMode == true)
        {
            _logger.LogInformation("[Posterizarr DEBUG] " + message, args);
        }
    }

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        var config = Plugin.Instance?.Configuration;
        if (config == null)
        {
            return;
        }

        if (config.EnablePlexSync)
        {
            if (!config.UpdateCollection)
            {
                _logger.LogInformation("[Posterizarr] Plex Direct Sync is enabled and Collection sync is disabled. Skipping local asset sync task.");
                return;
            }

            _logger.LogInformation("[Posterizarr] Plex Direct Sync is enabled. Local asset sync will only process Collections (BoxSets).");
        }

        if (string.IsNullOrEmpty(config.AssetFolderPath))
        {
            _logger.LogWarning("[Posterizarr] AssetFolderPath is not configured. Aborting sync.");
            return;
        }

        var dataFolder = Plugin.Instance?.DataFolderPath ?? Path.Combine(AppContext.BaseDirectory, "data");
        var syncCache = new SyncCacheManager(dataFolder, _logger);
        syncCache.Load();

        var pathResolver = new AssetPathResolver(_libraryManager, _loggerFactory.CreateLogger<AssetPathResolver>());
        var provider = new PosterizarrImageProvider(_libraryManager, _loggerFactory.CreateLogger<PosterizarrImageProvider>(), pathResolver);

        var query = new InternalItemsQuery
        {
            IncludeItemTypes = config.EnablePlexSync
                ? new[] { BaseItemKind.BoxSet }
                : new[] { BaseItemKind.Movie, BaseItemKind.Series, BaseItemKind.Season, BaseItemKind.Episode, BaseItemKind.BoxSet },
            Recursive = true,
            IsVirtualItem = false
        };

        var items = _libraryManager.GetItemList(query);
        int totalItems = items.Count;

        _logger.LogInformation("[Posterizarr] Starting high-speed parallel sync for {0} items ({1} cached entries).", totalItems, syncCache.Count);

        var stopwatch = Stopwatch.StartNew();
        int processedCount = 0;
        int cacheHitCount = 0;
        int updatedCount = 0;
        int noAssetCount = 0;

        int degreeOfParallelism = Math.Clamp(Environment.ProcessorCount, 4, 12);

        try
        {
            await Parallel.ForEachAsync(items, new ParallelOptions
            {
                MaxDegreeOfParallelism = degreeOfParallelism,
                CancellationToken = cancellationToken
            }, async (item, ct) =>
            {
                var current = Interlocked.Increment(ref processedCount);
                if (current % 250 == 0 || current == totalItems)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    progress.Report((double)current / totalItems * 100);
                }

                try
                {
                    var typesToCheck = provider.GetSupportedImages(item);
                    bool itemUpdated = false;

                    foreach (var type in typesToCheck)
                    {
                        var sourceFileInfo = provider.FindFileInfo(item, config, type);
                        if (sourceFileInfo == null)
                        {
                            Interlocked.Increment(ref noAssetCount);
                            continue;
                        }

                        var existingImage = item.GetImageInfo(type, 0);

                        bool needUpdate = false;
                        if (existingImage == null)
                        {
                            needUpdate = true;
                        }
                        else if (syncCache.IsMatch(item.Id, type, sourceFileInfo, existingImage))
                        {
                            // Tier 1 Fast-path: Unchanged asset matches cache
                            LogDebug("[{0}] Cache hit for '{1}'. Skipping.", item.Name, type);
                            Interlocked.Increment(ref cacheHitCount);
                            continue;
                        }
                        else
                        {
                            // Tier 2: Cache miss or modified asset
                            needUpdate = ShouldUpdateImage(sourceFileInfo, existingImage);
                            if (!needUpdate)
                            {
                                // Verified identical: record in cache to avoid future checks
                                LogDebug("[{0}] Verified identical for '{1}'. Updating cache.", item.Name, type);
                                syncCache.Update(item.Id, type, sourceFileInfo, existingImage);
                                Interlocked.Increment(ref cacheHitCount);
                                continue;
                            }
                        }

                        if (needUpdate)
                        {
                            _logger.LogInformation("[Posterizarr] [{0}] Updating '{1}' from '{2}'", item.Name, type, sourceFileInfo.FullName);
                            try
                            {
                                var ext = sourceFileInfo.Extension.ToLowerInvariant();
                                string mimeType = ext switch
                                {
                                    ".png" => "image/png",
                                    ".webp" => "image/webp",
                                    ".bmp" => "image/bmp",
                                    _ => "image/jpeg"
                                };

                                using (var stream = new FileStream(sourceFileInfo.FullName, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.SequentialScan))
                                {
                                    await _providerManager.SaveImage(item, stream, mimeType, type, 0, ct).ConfigureAwait(false);
                                }

                                var updatedImage = item.GetImageInfo(type, 0);
                                if (updatedImage != null)
                                {
                                    syncCache.Update(item.Id, type, sourceFileInfo, updatedImage);
                                }

                                itemUpdated = true;
                                Interlocked.Increment(ref updatedCount);
                            }
                            catch (Exception ex)
                            {
                                _logger.LogError(ex, "[Posterizarr] Failed to process image update for {0}", item.Name);
                            }
                        }
                    }

                    if (itemUpdated)
                    {
                        var parent = item.ParentId != Guid.Empty ? _libraryManager.GetItemById(item.ParentId) : null;
                        await _libraryManager.UpdateItemAsync(item, parent ?? item, ItemUpdateType.ImageUpdate, ct).ConfigureAwait(false);
                    }
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Posterizarr] Error syncing item '{0}' ({1})", item.Name, item.Id);
                }
            }).ConfigureAwait(false);
        }
        finally
        {
            // Always persist cache and clear transient memory
            syncCache.Save();
            pathResolver.ClearCache();
        }

        stopwatch.Stop();
        progress.Report(100);
        _logger.LogInformation(
            "[Posterizarr] Sync finished in {0:mm\\:ss\\.fff}. Total items: {1}, Cache hits: {2}, Updated: {3}, No asset: {4}.",
            stopwatch.Elapsed, totalItems, cacheHitCount, updatedCount, noAssetCount);
    }

    private bool ShouldUpdateImage(FileInfo sourceFile, ItemImageInfo existingImage)
    {
        if (string.IsNullOrEmpty(existingImage.Path))
        {
            return true;
        }

        // 1. If paths are identical, simple last-write-time check
        if (string.Equals(sourceFile.FullName, existingImage.Path, StringComparison.OrdinalIgnoreCase))
        {
            return sourceFile.LastWriteTimeUtc > existingImage.DateModified.ToUniversalTime().AddSeconds(2);
        }

        // 2. Different paths (NAS source vs. Jellyfin metadata storage)
        if (!File.Exists(existingImage.Path))
        {
            return true;
        }

        try
        {
            var existingInfo = new FileInfo(existingImage.Path);

            // Size mismatch: files are definitively different
            if (sourceFile.Length != existingInfo.Length)
            {
                return true;
            }

            // Fast header check: if first 4KB differs, files are different
            if (sourceFile.Length > 4096)
            {
                Span<byte> header1 = stackalloc byte[4096];
                Span<byte> header2 = stackalloc byte[4096];

                using (var h1 = new FileStream(sourceFile.FullName, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan))
                using (var h2 = new FileStream(existingImage.Path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan))
                {
                    int r1 = h1.Read(header1);
                    int r2 = h2.Read(header2);
                    if (r1 != r2 || !header1[..r1].SequenceEqual(header2[..r2]))
                    {
                        return true;
                    }
                }
            }

            // Full hash check when sizes and headers match
            using var fs1 = new FileStream(sourceFile.FullName, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.SequentialScan);
            using var fs2 = new FileStream(existingImage.Path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.SequentialScan);

            byte[] hash1 = MD5.HashData(fs1);
            byte[] hash2 = MD5.HashData(fs2);

            return !hash1.SequenceEqual(hash2);
        }
        catch
        {
            return true;
        }
    }
}