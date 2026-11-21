using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Logging;

namespace Posterizarr.Plugin.Tasks
{
    public class PlexSyncRecord
    {
        public string PlexArtworkUrl { get; set; } = string.Empty;
        public long LastSyncUtcTicks { get; set; }
        public bool Is4K { get; set; }
    }

    /// <summary>
    /// Persistent state cache manager to avoid re-downloading artwork from Plex
    /// when Plex's internal thumb/art timestamp has not changed.
    /// </summary>
    public class PlexSyncCacheManager
    {
        private readonly string _cacheFilePath;
        private readonly ILogger _logger;
        private readonly ConcurrentDictionary<string, PlexSyncRecord> _records = new(StringComparer.OrdinalIgnoreCase);
        private bool _isDirty;

        public PlexSyncCacheManager(string dataFolderPath, ILogger logger)
        {
            _logger = logger;
            Directory.CreateDirectory(dataFolderPath);
            _cacheFilePath = Path.Combine(dataFolderPath, "posterizarr_plex_sync_cache.json");
        }

        public int Count => _records.Count;

        public void Load()
        {
            if (!File.Exists(_cacheFilePath))
            {
                _logger.Info("[Posterizarr PlexSync] No existing Plex sync cache found at {0}. Starting fresh.", _cacheFilePath);
                return;
            }

            try
            {
                using var stream = File.OpenRead(_cacheFilePath);
                var loaded = JsonSerializer.Deserialize<Dictionary<string, PlexSyncRecord>>(stream);
                if (loaded != null)
                {
                    _records.Clear();
                    foreach (var kvp in loaded)
                    {
                        _records[kvp.Key] = kvp.Value;
                    }
                    _logger.Info("[Posterizarr PlexSync] Loaded {0} cached Plex sync records from disk.", _records.Count);
                }
            }
            catch (Exception ex)
            {
                _logger.Warn("[Posterizarr PlexSync] Could not read Plex sync cache from {0}. Will regenerate: {1}", _cacheFilePath, ex.Message);
            }
        }

        public void Save()
        {
            if (!_isDirty) return;

            try
            {
                var tempFile = _cacheFilePath + ".tmp";
                using (var stream = new FileStream(tempFile, FileMode.Create, FileAccess.Write, FileShare.None, 65536, FileOptions.SequentialScan))
                {
                    JsonSerializer.Serialize(stream, _records, new JsonSerializerOptions
                    {
                        WriteIndented = false,
                        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
                    });
                }

                File.Move(tempFile, _cacheFilePath, overwrite: true);
                _isDirty = false;
                _logger.Info("[Posterizarr PlexSync] Saved {0} Plex sync records to cache.", _records.Count);
            }
            catch (Exception ex)
            {
                _logger.Error("[Posterizarr PlexSync] Failed to write Plex sync cache to disk: {0}", ex.Message);
            }
        }

        public bool TryGetRecord(Guid itemId, ImageType type, out PlexSyncRecord? record)
        {
            var key = BuildKey(itemId, type);
            return _records.TryGetValue(key, out record);
        }

        public bool IsMatch(Guid itemId, ImageType type, string currentPlexArtworkUrl)
        {
            var key = BuildKey(itemId, type);
            if (_records.TryGetValue(key, out var record))
            {
                return string.Equals(record.PlexArtworkUrl, currentPlexArtworkUrl, StringComparison.OrdinalIgnoreCase);
            }
            return false;
        }

        public void Update(Guid itemId, ImageType type, string currentPlexArtworkUrl, bool is4K = false)
        {
            var key = BuildKey(itemId, type);
            _records[key] = new PlexSyncRecord
            {
                PlexArtworkUrl = currentPlexArtworkUrl,
                LastSyncUtcTicks = DateTime.UtcNow.Ticks,
                Is4K = is4K
            };
            _isDirty = true;
        }

        public bool Invalidate(Guid itemId, ImageType type)
        {
            var key = BuildKey(itemId, type);
            if (_records.TryRemove(key, out _))
            {
                _isDirty = true;
                return true;
            }
            return false;
        }

        private static string BuildKey(Guid itemId, ImageType type) => $"{itemId:N}_{type}";
    }
}
