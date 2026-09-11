using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;
using Posterizarr.Plugin.Configuration;

namespace Posterizarr.Plugin.Providers;

/// <summary>
/// High-performance asset path and file resolver with multi-level caching
/// designed for remote network shares (SMB/NFS).
/// </summary>
public class AssetPathResolver
{
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger _logger;

    // Cache of library folder names in AssetFolderPath (e.g. "TV Shows", "Movies")
    private static readonly ConcurrentDictionary<string, string?> LibraryFolderCache = new(StringComparer.OrdinalIgnoreCase);
    private static string[]? _cachedRootDirectories;
    private static DateTime _rootDirectoriesExpiry = DateTime.MinValue;
    private static readonly object RootDirLock = new();

    // Cache of files inside each media folder (e.g. "/assets/TV Shows/Ted Lasso" -> { "poster.jpg": FileInfo, "s01e01.jpg": FileInfo })
    private readonly ConcurrentDictionary<string, IReadOnlyDictionary<string, FileInfo>?> _folderFilesCache = new(StringComparer.OrdinalIgnoreCase);

    public AssetPathResolver(ILibraryManager libraryManager, ILogger logger)
    {
        _libraryManager = libraryManager;
        _logger = logger;
    }

    private void LogDebug(string message, params object[] args)
    {
        if (Plugin.Instance?.Configuration?.EnableDebugMode == true)
        {
            _logger.LogInformation("[Posterizarr DEBUG] " + message, args);
        }
    }

    /// <summary>
    /// Clears transient directory and folder caches to free memory after large sync runs.
    /// </summary>
    public void ClearCache()
    {
        _folderFilesCache.Clear();
        LibraryFolderCache.Clear();
        lock (RootDirLock)
        {
            _cachedRootDirectories = null;
            _rootDirectoriesExpiry = DateTime.MinValue;
        }
    }

    /// <summary>
    /// Resolves the matching FileInfo for an item and image type, with cached file metadata.
    /// </summary>
    public FileInfo? FindFileInfo(BaseItem item, PluginConfiguration config, ImageType type)
    {
        if (config == null || string.IsNullOrEmpty(config.AssetFolderPath))
        {
            return null;
        }

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

        // 2. Resolve Library Folder on Disk (Cached)
        var libraryDir = ResolveLibraryDirectory(config.AssetFolderPath, displayLibraryName, internalLibraryName);
        if (libraryDir == null)
        {
            LogDebug("FAIL: Could not find library folder for '{0}' / '{1}' in '{2}'",
                displayLibraryName, internalLibraryName, config.AssetFolderPath);
            return null;
        }

        // 3. Resolve Media Subfolder
        var directoryPath = (item is Movie || item is Series)
            ? (item is Movie ? Path.GetDirectoryName(item.Path) : item.Path)
            : (item is Season s ? s.Series.Path : (item is Episode e ? e.Series.Path : ""));

        var subFolder = Path.GetFileName(directoryPath) ?? string.Empty;
        if (string.IsNullOrEmpty(subFolder))
        {
            return null;
        }

        LogDebug("Media Subfolder resolved to: '{0}'", subFolder);

        var actualFolder = Path.Combine(libraryDir, subFolder);
        LogDebug("Full target path to check: {0}", actualFolder);

        // 4. Retrieve cached file dictionary for this folder
        var folderFiles = GetFolderFiles(actualFolder);
        if (folderFiles == null || folderFiles.Count == 0)
        {
            LogDebug("Folder '{0}' does not exist or contains no files.", actualFolder);
            return null;
        }

        // 5. Determine base file name
        string fileNameBase = type switch
        {
            ImageType.Primary when item is Season sn => $"season{sn.IndexNumber ?? 0:D2}",
            ImageType.Primary when item is Episode ep => $"S{ep.ParentIndexNumber ?? 0:D2}E{ep.IndexNumber ?? 0:D2}",
            ImageType.Primary => "poster",
            ImageType.Thumb => "background",
            _ => "background"
        };

        LogDebug("Searching for base name '{0}' with supported extensions...", fileNameBase);

        // 6. Fast O(1) dictionary lookup by file extension
        var supportedExtensions = config.SupportedExtensions ?? new[] { ".jpg", ".jpeg", ".png", ".webp", ".bmp" };

        foreach (var ext in supportedExtensions)
        {
            var targetFile = fileNameBase + ext;
            if (folderFiles.TryGetValue(targetFile, out var match))
            {
                LogDebug("SUCCESS: Found {0} at '{1}'", type, match.FullName);
                return match;
            }

            if (type == ImageType.Backdrop || type == ImageType.Thumb)
            {
                var fanartTarget = "fanart" + ext;
                if (folderFiles.TryGetValue(fanartTarget, out var fanartMatch))
                {
                    LogDebug("Found fallback: {0}", fanartMatch.FullName);
                    return fanartMatch;
                }
            }
        }

        LogDebug("No file matched '{0}' with extensions: {1}", fileNameBase, string.Join(", ", supportedExtensions));
        return null;
    }

    /// <summary>
    /// Resolves the absolute path for an item, compatible with existing callers.
    /// </summary>
    public string? FindFile(BaseItem item, PluginConfiguration config, ImageType type)
    {
        return FindFileInfo(item, config, type)?.FullName;
    }

    private string? ResolveLibraryDirectory(string assetFolderPath, string displayLibraryName, string internalLibraryName)
    {
        var cacheKey = $"{assetFolderPath}|{displayLibraryName}|{internalLibraryName}";
        if (LibraryFolderCache.TryGetValue(cacheKey, out var cachedDir))
        {
            return cachedDir;
        }

        var directories = GetRootDirectories(assetFolderPath);
        if (directories.Length == 0)
        {
            LibraryFolderCache[cacheKey] = null;
            return null;
        }

        // Strategy A: Exact Match on Display Name
        var matched = directories.FirstOrDefault(d => string.Equals(Path.GetFileName(d), displayLibraryName, StringComparison.OrdinalIgnoreCase));
        if (matched != null) LogDebug("Strategy A (Exact Display) MATCHED: {0}", Path.GetFileName(matched));

        // Strategy B: Exact Match on Internal Name
        if (matched == null)
        {
            matched = directories.FirstOrDefault(d => string.Equals(Path.GetFileName(d), internalLibraryName, StringComparison.OrdinalIgnoreCase));
            if (matched != null) LogDebug("Strategy B (Exact Internal) MATCHED: {0}", Path.GetFileName(matched));
        }

        // Strategy C: Fuzzy Match
        if (matched == null)
        {
            var searchTerms = new[] { displayLibraryName, internalLibraryName }
                .Where(s => s != "Unknown" && s != "root")
                .Select(s => s.Replace(" ", "").ToLowerInvariant())
                .Distinct()
                .ToArray();

            matched = directories.FirstOrDefault(d =>
            {
                var folderStripped = Path.GetFileName(d).Replace(" ", "").ToLowerInvariant();
                return searchTerms.Any(term => folderStripped.Contains(term) || term.Contains(folderStripped));
            });
            if (matched != null) LogDebug("Strategy C (Fuzzy) MATCHED: {0}", Path.GetFileName(matched));
        }

        LibraryFolderCache[cacheKey] = matched;
        return matched;
    }

    private string[] GetRootDirectories(string assetFolderPath)
    {
        if (string.IsNullOrEmpty(assetFolderPath)) return Array.Empty<string>();

        lock (RootDirLock)
        {
            if (_cachedRootDirectories != null && DateTime.UtcNow < _rootDirectoriesExpiry)
            {
                return _cachedRootDirectories;
            }

            try
            {
                if (Directory.Exists(assetFolderPath))
                {
                    _cachedRootDirectories = Directory.GetDirectories(assetFolderPath);
                    _rootDirectoriesExpiry = DateTime.UtcNow.AddMinutes(10);
                    return _cachedRootDirectories;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Posterizarr] Failed to enumerate root asset directory: {0}", assetFolderPath);
            }

            _cachedRootDirectories = Array.Empty<string>();
            return _cachedRootDirectories;
        }
    }

    private IReadOnlyDictionary<string, FileInfo>? GetFolderFiles(string folderPath)
    {
        if (_folderFilesCache.TryGetValue(folderPath, out var cachedFiles))
        {
            return cachedFiles;
        }

        try
        {
            var dirInfo = new DirectoryInfo(folderPath);
            if (!dirInfo.Exists)
            {
                _folderFilesCache[folderPath] = null;
                return null;
            }

            // GetFiles() retrieves file names, sizes, and timestamps in one round-trip
            var files = dirInfo.GetFiles();
            var dict = new Dictionary<string, FileInfo>(files.Length, StringComparer.OrdinalIgnoreCase);

            foreach (var fi in files)
            {
                dict[fi.Name] = fi;
            }

            _folderFilesCache[folderPath] = dict;
            return dict;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "[Posterizarr] Failed to list folder: {0}", folderPath);
            _folderFilesCache[folderPath] = null;
            return null;
        }
    }
}
