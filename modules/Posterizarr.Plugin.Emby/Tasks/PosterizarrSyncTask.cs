using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Querying;
using MediaBrowser.Model.Tasks;
using Posterizarr.Plugin.Providers;

namespace Posterizarr.Plugin.Tasks
{
    public class PosterizarrSyncTask : IScheduledTask
    {
        private readonly ILibraryManager _libraryManager;
        private readonly ILogManager _logManager;
        private readonly ILogger _logger;
        private readonly IServerApplicationHost _appHost;

        public PosterizarrSyncTask(
            ILibraryManager libraryManager,
            ILogManager logManager,
            IServerApplicationHost appHost)
        {
            _libraryManager = libraryManager;
            _logManager = logManager;
            _appHost = appHost;
            _logger = logManager.GetLogger(GetType().Name);
        }

        public string Name => "Sync Posterizarr Assets";
        public string Key => "PosterizarrSyncTask";
        public string Description => "Syncs local Posterizarr assets to library items.";
        public string Category => "Posterizarr";

        public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
        {
            return new[]
            {
                new TaskTriggerInfo
                {
                    Type = TaskTriggerInfo.TriggerDaily,
                    TimeOfDayTicks = TimeSpan.FromHours(2).Ticks
                }
            };
        }

        public Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
        {
            var config = Plugin.Instance?.Configuration;
            if (config == null || string.IsNullOrEmpty(config.AssetFolderPath)) return Task.CompletedTask;

            var provider = new PosterizarrImageProvider(_libraryManager, _logManager, _appHost);

            var items = _libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = new[] { typeof(Movie).Name, typeof(Series).Name, typeof(Season).Name, typeof(Episode).Name },
                Recursive = true,
                IsVirtualItem = false
            });

            _logger.Info("[Posterizarr] Starting sync for {0} items.", items.Length);

            for (var i = 0; i < items.Length; i++)
            {
                if (i % 100 == 0)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    progress.Report((double)i / items.Length * 100);
                }

                var item = items[i];
                var typesToCheck = new List<ImageType> { ImageType.Primary };
                if (item is Movie || item is Series)
                    typesToCheck.Add(ImageType.Backdrop);

                var itemUpdated = false;
                foreach (var type in typesToCheck)
                {
                    var localPath = provider.FindFile(item, config, type);
                    if (string.IsNullOrEmpty(localPath)) continue;

                    var existingImage = item.GetImageInfo(type, 0);
                    if (existingImage == null || !IsHashMatch(localPath, existingImage.Path))
                    {
                        item.SetImage(new ItemImageInfo
                        {
                            Path = localPath,
                            Type = type,
                            DateModified = File.GetLastWriteTimeUtc(localPath)
                        }, 0);
                        itemUpdated = true;
                    }
                }

                if (itemUpdated)
                    _libraryManager.UpdateItem(item, item.GetParent(), ItemUpdateType.ImageUpdate);
            }

            progress.Report(100);
            _logger.Info("[Posterizarr] Sync finished.");
            return Task.CompletedTask;
        }

        private bool IsHashMatch(string sourcePath, string existingPath)
        {
            if (string.IsNullOrEmpty(existingPath) || !File.Exists(sourcePath) || !File.Exists(existingPath))
                return false;

            try
            {
                var sourceInfo = new FileInfo(sourcePath);
                var existingInfo = new FileInfo(existingPath);
                if (sourceInfo.Length != existingInfo.Length) return false;

                // SequentialScan avoids polluting the OS page cache with large image files
                using var fs1 = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan);
                using var fs2 = new FileStream(existingPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan);

                return MD5.HashData(fs1).SequenceEqual(MD5.HashData(fs2));
            }
            catch (Exception ex)
            {
                _logger.Error("[Posterizarr] Error comparing files '{0}' and '{1}': {2}", sourcePath, existingPath, ex.Message);
                return false;
            }
        }
    }
}
