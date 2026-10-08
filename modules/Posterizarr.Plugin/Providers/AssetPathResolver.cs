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
using MediaBrowser.Model.Querying;
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
    private static readonly ConcurrentDictionary<string, (string[] Dirs, DateTime Expiry)> SubdirectoriesCache = new(StringComparer.OrdinalIgnoreCase);
    private static string[]? _cachedRootDirectories;
    private static DateTime _rootDirectoriesExpiry = DateTime.MinValue;
    private static readonly object RootDirLock = new();

    private sealed class FolderCacheEntry
    {
        public IReadOnlyDictionary<string, FileInfo>? Files { get; }
        public DateTime ExpiryUtc { get; }

        public FolderCacheEntry(IReadOnlyDictionary<string, FileInfo>? files, TimeSpan ttl)
        {
            Files = files;
            ExpiryUtc = DateTime.UtcNow.Add(ttl);
        }

        public bool IsExpired => DateTime.UtcNow >= ExpiryUtc;
    }

    // Cache of files inside each media folder (e.g. "/assets/TV Shows/Ted Lasso" -> { "poster.jpg": FileInfo, "s01e01.jpg": FileInfo })
    private static readonly ConcurrentDictionary<string, FolderCacheEntry> FolderFilesCache = new(StringComparer.OrdinalIgnoreCase);

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
    /// Evicts a specific folder from the in-memory cache.
    /// </summary>
    public static void InvalidateFolder(string folderPath)
    {
        FolderFilesCache.TryRemove(folderPath, out _);
    }

    /// <summary>
    /// Evicts the parent folder of a file from the in-memory cache.
    /// </summary>
    public static void InvalidateFile(string filePath)
    {
        var dir = Path.GetDirectoryName(filePath);
        if (!string.IsNullOrEmpty(dir))
        {
            FolderFilesCache.TryRemove(dir, out _);
        }
    }

    /// <summary>
    /// Clears transient directory and folder caches to free memory after large sync runs.
    /// </summary>
    public void ClearCache()
    {
        FolderFilesCache.Clear();
        LibraryFolderCache.Clear();
        SubdirectoriesCache.Clear();
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

        if (item is BoxSet boxSet)
        {
            return FindCollectionFileInfo(boxSet, config, type);
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

        var match = MatchFile(folderFiles, fileNameBase, supportedExtensions, type);
        if (match != null)
        {
            LogDebug("SUCCESS: Found {0} at '{1}'", type, match.FullName);
            return match;
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

    private static FileInfo? MatchFile(IReadOnlyDictionary<string, FileInfo> folderFiles, string fileNameBase, string[] supportedExtensions, ImageType type)
    {
        foreach (var ext in supportedExtensions)
        {
            var targetFile = fileNameBase + ext;
            if (folderFiles.TryGetValue(targetFile, out var match))
            {
                return match;
            }

            if (type == ImageType.Backdrop || type == ImageType.Thumb)
            {
                var fanartTarget = "fanart" + ext;
                if (folderFiles.TryGetValue(fanartTarget, out var fanartMatch))
                {
                    return fanartMatch;
                }
            }
        }
        return null;
    }

    private IReadOnlyDictionary<string, FileInfo>? GetFolderFiles(string folderPath)
    {
        if (FolderFilesCache.TryGetValue(folderPath, out var cached) && !cached.IsExpired)
        {
            return cached.Files;
        }

        try
        {
            var dirInfo = new DirectoryInfo(folderPath);
            if (!dirInfo.Exists)
            {
                FolderFilesCache[folderPath] = new FolderCacheEntry(null, TimeSpan.FromSeconds(5));
                return null;
            }

            // GetFiles() retrieves file names, sizes, and timestamps in one round-trip
            var files = dirInfo.GetFiles();
            var dict = new Dictionary<string, FileInfo>(files.Length, StringComparer.OrdinalIgnoreCase);

            foreach (var fi in files)
            {
                dict[fi.Name] = fi;
            }

            // Cache for 60 seconds (fast for batch sync, short enough to expire stale states)
            FolderFilesCache[folderPath] = new FolderCacheEntry(dict, TimeSpan.FromSeconds(60));
            return dict;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "[Posterizarr] Failed to list folder: {0}", folderPath);
            FolderFilesCache[folderPath] = new FolderCacheEntry(null, TimeSpan.FromSeconds(5));
            return null;
        }
    }

    /// <summary>
    /// Resolves the matching FileInfo for a BoxSet (Collection) and image type.
    /// Supports both folder-based (Collections/CollectionName/poster.png) and
    /// flat-based (Collections/CollectionName.png) assets created manually or by Posterizarr/Kometa.
    /// </summary>
    public FileInfo? FindCollectionFileInfo(BoxSet boxSet, PluginConfiguration config, ImageType type)
    {
        if (config == null || string.IsNullOrEmpty(config.AssetFolderPath) || !config.UpdateCollection)
        {
            return null;
        }

        var candidateNames = GetCollectionCandidateNames(boxSet.Name, boxSet.Path);
        if (candidateNames.Count == 0)
        {
            return null;
        }

        var supportedExtensions = config.SupportedExtensions ?? new[] { ".jpg", ".jpeg", ".png", ".webp", ".bmp" };
        LogDebug("Finding collection asset for '{0}' (candidates: {1})", boxSet.Name, string.Join(", ", candidateNames));

        var assetRoot = config.AssetFolderPath;
        var checkedDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // 1. Check primary "Collections" directory
        var collectionsDir = ResolveCollectionsDirectory(assetRoot);
        if (!string.IsNullOrEmpty(collectionsDir) && checkedDirs.Add(collectionsDir))
        {
            var match = FindInDirectory(collectionsDir, candidateNames, supportedExtensions, type);
            if (match != null)
            {
                LogDebug("SUCCESS: Found collection asset for '{0}' at '{1}'", boxSet.Name, match.FullName);
                return match;
            }

            // Check subfolders under Collections (e.g., Collections/Movies, Collections/4K Movies, Collections/Shows, etc.)
            foreach (var sub in GetSubdirectories(collectionsDir))
            {
                if (checkedDirs.Add(sub))
                {
                    match = FindInDirectory(sub, candidateNames, supportedExtensions, type);
                    if (match != null)
                    {
                        LogDebug("SUCCESS: Found collection asset for '{0}' in Collections subfolder at '{1}'", boxSet.Name, match.FullName);
                        return match;
                    }
                }
            }
        }

        // 2. Discover potential library names associated with this collection
        var libraryNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // A. Direct BoxSet library folder IDs
        try
        {
            var folderIds = boxSet.GetLibraryFolderIds();
            if (folderIds != null)
            {
                foreach (var id in folderIds)
                {
                    var folder = _libraryManager.GetItemById(id);
                    if (folder != null && !string.IsNullOrEmpty(folder.Name) && !folder.Name.Equals("Collections", StringComparison.OrdinalIgnoreCase))
                    {
                        libraryNames.Add(folder.Name);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            LogDebug("Error getting library folder IDs for boxset: {0}", ex.Message);
        }

        // B. Linked children libraries (movies inside the collection)
        try
        {
            var children = boxSet.GetChildren(null, true, new InternalItemsQuery { Limit = 5 });
            if (children != null)
            {
                foreach (var child in children)
                {
                    var childLib = child.GetAncestorIds()
                        .Select(id => _libraryManager.GetItemById(id))
                        .OfType<CollectionFolder>()
                        .FirstOrDefault()?.Name;
                    if (!string.IsNullOrEmpty(childLib) && !childLib.Equals("Collections", StringComparison.OrdinalIgnoreCase))
                    {
                        libraryNames.Add(childLib);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            LogDebug("Error getting linked children for boxset: {0}", ex.Message);
        }

        // C. Direct display library if present
        try
        {
            var displayLib = boxSet.GetAncestorIds()
                .Select(id => _libraryManager?.GetItemById(id))
                .OfType<CollectionFolder>()
                .FirstOrDefault()?.Name;
            if (!string.IsNullOrEmpty(displayLib) && displayLib != "Unknown" && displayLib != "root" && !displayLib.Equals("Collections", StringComparison.OrdinalIgnoreCase))
            {
                libraryNames.Add(displayLib);
            }
        }
        catch (Exception ex)
        {
            LogDebug("Error getting ancestor IDs for boxset: {0}", ex.Message);
        }

        foreach (var lib in libraryNames)
        {
            if (!string.IsNullOrEmpty(collectionsDir))
            {
                var collectionsSubLib = Path.Combine(collectionsDir, lib);
                if (checkedDirs.Add(collectionsSubLib))
                {
                    var match = FindInDirectory(collectionsSubLib, candidateNames, supportedExtensions, type);
                    if (match != null) return match;
                }
            }

            var resolvedLibDir = ResolveLibraryDirectory(assetRoot, lib, lib);
            if (!string.IsNullOrEmpty(resolvedLibDir))
            {
                var libCollections = Path.Combine(resolvedLibDir, "Collections");
                if (checkedDirs.Add(libCollections))
                {
                    var match = FindInDirectory(libCollections, candidateNames, supportedExtensions, type);
                    if (match != null) return match;
                }

                if (!config.EnablePlexSync && checkedDirs.Add(resolvedLibDir))
                {
                    var match = FindInDirectory(resolvedLibDir, candidateNames, supportedExtensions, type);
                    if (match != null) return match;
                }
            }
        }

        // 3. Check any other root libraries (e.g. Movies/Collections or Shows/Collections)
        var rootDirs = GetRootDirectories(assetRoot);
        foreach (var rootDir in rootDirs)
        {
            var rootCollections = Path.Combine(rootDir, "Collections");
            if (checkedDirs.Add(rootCollections))
            {
                var match = FindInDirectory(rootCollections, candidateNames, supportedExtensions, type);
                if (match != null) return match;
            }

            if (!config.EnablePlexSync && checkedDirs.Add(rootDir))
            {
                var match = FindInDirectory(rootDir, candidateNames, supportedExtensions, type);
                if (match != null) return match;
            }
        }

        // 4. Check root asset folder itself (only if Plex Direct Sync is not restricting search to collection paths)
        if (!config.EnablePlexSync && checkedDirs.Add(assetRoot))
        {
            var match = FindInDirectory(assetRoot, candidateNames, supportedExtensions, type);
            if (match != null) return match;
        }

        LogDebug("RESULT: No collection asset found for '{0}'", boxSet.Name);
        return null;
    }

    private FileInfo? FindInDirectory(string dir, List<string> candidateNames, string[] supportedExtensions, ImageType type)
    {
        if (!Directory.Exists(dir)) return null;

        // A. Check subfolders in dir for matching collection name
        // 1. Direct subfolder name lookup first
        foreach (var name in candidateNames)
        {
            var subfolderPath = Path.Combine(dir, name);
            if (Directory.Exists(subfolderPath))
            {
                var folderFiles = GetFolderFiles(subfolderPath);
                if (folderFiles != null && folderFiles.Count > 0)
                {
                    var fileMatch = MatchCollectionFolderFile(folderFiles, name, supportedExtensions, type);
                    if (fileMatch != null) return fileMatch;
                }
            }
        }

        // 2. Normalized / fuzzy subfolder lookup if exact folder not found
        var subdirs = GetSubdirectories(dir);
        if (subdirs.Length > 0)
        {
            foreach (var sub in subdirs)
            {
                var subName = Path.GetFileName(sub);
                if (candidateNames.Any(c => IsCollectionNameMatch(subName, c)))
                {
                    var folderFiles = GetFolderFiles(sub);
                    if (folderFiles != null && folderFiles.Count > 0)
                    {
                        var fileMatch = MatchCollectionFolderFile(folderFiles, subName, supportedExtensions, type);
                        if (fileMatch != null) return fileMatch;
                    }
                }
            }
        }

        // B. Check flat files directly in dir (e.g. Collections/Marvel Cinematic Universe.png)
        var dirFiles = GetFolderFiles(dir);
        if (dirFiles != null && dirFiles.Count > 0)
        {
            foreach (var name in candidateNames)
            {
                var flatMatch = MatchCollectionFlatFile(dirFiles, name, supportedExtensions, type);
                if (flatMatch != null) return flatMatch;
            }
        }

        return null;
    }

    private static FileInfo? MatchCollectionFolderFile(IReadOnlyDictionary<string, FileInfo> folderFiles, string candidateName, string[] supportedExtensions, ImageType type)
    {
        var targetBaseNames = new List<string>();
        if (type == ImageType.Primary)
        {
            targetBaseNames.AddRange(new[] { "poster", "folder", "cover", "default" });
            targetBaseNames.Add(candidateName);
            targetBaseNames.Add($"{candidateName} - poster");
            targetBaseNames.Add($"{candidateName} - cover");
            targetBaseNames.Add($"{candidateName}.poster");
        }
        else
        {
            targetBaseNames.AddRange(new[] { "background", "fanart", "backdrop", "art" });
            targetBaseNames.Add($"{candidateName}-fanart");
            targetBaseNames.Add($"{candidateName}-background");
            targetBaseNames.Add($"{candidateName}-backdrop");
            targetBaseNames.Add($"{candidateName} - fanart");
            targetBaseNames.Add($"{candidateName} - background");
            targetBaseNames.Add($"{candidateName} - backdrop");
        }

        foreach (var baseName in targetBaseNames)
        {
            var match = MatchFile(folderFiles, baseName, supportedExtensions, type);
            if (match != null) return match;
        }

        return null;
    }

    private static FileInfo? MatchCollectionFlatFile(IReadOnlyDictionary<string, FileInfo> dirFiles, string candidateName, string[] supportedExtensions, ImageType type)
    {
        var targetBaseNames = new List<string>();
        if (type == ImageType.Primary)
        {
            targetBaseNames.Add(candidateName);
            targetBaseNames.Add($"{candidateName} - poster");
            targetBaseNames.Add($"{candidateName}.poster");
            targetBaseNames.Add($"{candidateName} - cover");
        }
        else
        {
            targetBaseNames.Add($"{candidateName}-fanart");
            targetBaseNames.Add($"{candidateName}-background");
            targetBaseNames.Add($"{candidateName}-backdrop");
            targetBaseNames.Add($"{candidateName} - fanart");
            targetBaseNames.Add($"{candidateName} - background");
            targetBaseNames.Add($"{candidateName} - backdrop");
            targetBaseNames.Add($"{candidateName}.fanart");
            targetBaseNames.Add($"{candidateName}.background");
        }

        foreach (var baseName in targetBaseNames)
        {
            var match = MatchFile(dirFiles, baseName, supportedExtensions, type);
            if (match != null) return match;
        }

        return null;
    }

    /// <summary>
    /// Resolves the Collections directory case-insensitively and handles
    /// configurations where assetRoot itself already points to the Collections directory.
    /// </summary>
    public static string? ResolveCollectionsDirectory(string assetRoot)
    {
        if (string.IsNullOrEmpty(assetRoot) || !Directory.Exists(assetRoot))
            return null;

        var trimmedRoot = assetRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var rootDirName = Path.GetFileName(trimmedRoot);
        if (string.Equals(rootDirName, "Collections", StringComparison.OrdinalIgnoreCase))
        {
            return trimmedRoot;
        }

        try
        {
            var dirs = Directory.GetDirectories(trimmedRoot);
            var matched = dirs.FirstOrDefault(d => string.Equals(Path.GetFileName(d), "Collections", StringComparison.OrdinalIgnoreCase));
            if (matched != null)
            {
                return matched;
            }
        }
        catch { }

        return null;
    }

    private string[] GetSubdirectories(string path)
    {
        if (string.IsNullOrEmpty(path)) return Array.Empty<string>();
        if (SubdirectoriesCache.TryGetValue(path, out var entry) && DateTime.UtcNow < entry.Expiry)
        {
            return entry.Dirs;
        }

        try
        {
            if (Directory.Exists(path))
            {
                var dirs = Directory.GetDirectories(path);
                SubdirectoriesCache[path] = (dirs, DateTime.UtcNow.AddMinutes(10));
                return dirs;
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "[Posterizarr] Failed to enumerate subdirectories in: {0}", path);
        }

        SubdirectoriesCache[path] = (Array.Empty<string>(), DateTime.UtcNow.AddSeconds(30));
        return Array.Empty<string>();
    }

    public static List<string> GetCollectionCandidateNames(string? rawName, string? path = null)
    {
        var results = new List<string>();
        if (string.IsNullOrWhiteSpace(rawName) && string.IsNullOrWhiteSpace(path))
            return results;

        void AddCandidate(string? val)
        {
            if (string.IsNullOrWhiteSpace(val)) return;
            var trimmed = val.Trim();
            if (!results.Contains(trimmed, StringComparer.OrdinalIgnoreCase))
                results.Add(trimmed);

            // Strip [boxset], (boxset), {boxset}
            var stripped = System.Text.RegularExpressions.Regex.Replace(trimmed, @"\s*[\[\(\{]boxset[\]\)\}]\s*", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
            if (!string.IsNullOrEmpty(stripped) && !results.Contains(stripped, StringComparer.OrdinalIgnoreCase))
                results.Add(stripped);

            // Handle '&' vs 'and' variants (e.g. "Alien & Predator Timeline" <-> "Alien and Predator Timeline")
            if (trimmed.Contains('&'))
            {
                var withAnd = trimmed.Replace("&", "and");
                var cleanAnd = System.Text.RegularExpressions.Regex.Replace(withAnd, @"\s+", " ").Trim();
                if (!results.Contains(cleanAnd, StringComparer.OrdinalIgnoreCase))
                    results.Add(cleanAnd);
            }
            if (System.Text.RegularExpressions.Regex.IsMatch(trimmed, @"\band\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            {
                var withAmp = System.Text.RegularExpressions.Regex.Replace(trimmed, @"\band\b", "&", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                var cleanAmp = System.Text.RegularExpressions.Regex.Replace(withAmp, @"\s+", " ").Trim();
                if (!results.Contains(cleanAmp, StringComparer.OrdinalIgnoreCase))
                    results.Add(cleanAmp);
            }

            // Sanitize invalid chars: replace ':' and '/' with ' - '
            var replacedPunct = trimmed.Replace(':', '-').Replace('/', '-').Replace('\\', '-');
            var cleanPunct = System.Text.RegularExpressions.Regex.Replace(replacedPunct, @"\s+", " ").Trim(' ', '-');
            if (!string.IsNullOrEmpty(cleanPunct) && !results.Contains(cleanPunct, StringComparer.OrdinalIgnoreCase))
                results.Add(cleanPunct);

            // Sanitize invalid chars: remove ':' and illegal filename chars entirely
            var illegal = Path.GetInvalidFileNameChars().Concat(new[] { ':', '*', '?', '"', '<', '>', '|' }).Distinct();
            var strippedIllegal = new string(trimmed.Where(c => !illegal.Contains(c)).ToArray()).Trim();
            strippedIllegal = System.Text.RegularExpressions.Regex.Replace(strippedIllegal, @"\s+", " ").Trim();
            if (!string.IsNullOrEmpty(strippedIllegal) && !results.Contains(strippedIllegal, StringComparer.OrdinalIgnoreCase))
                results.Add(strippedIllegal);

            // Collection suffix variants
            var target = !string.IsNullOrEmpty(stripped) ? stripped : trimmed;
            if (target.EndsWith(" Collection", StringComparison.OrdinalIgnoreCase))
            {
                var withoutCollection = target.Substring(0, target.Length - " Collection".Length).Trim();
                if (!string.IsNullOrEmpty(withoutCollection) && !results.Contains(withoutCollection, StringComparer.OrdinalIgnoreCase))
                    results.Add(withoutCollection);
            }
            else
            {
                var withCollection = target + " Collection";
                if (!results.Contains(withCollection, StringComparer.OrdinalIgnoreCase))
                    results.Add(withCollection);
            }
        }

        AddCandidate(rawName);
        if (!string.IsNullOrEmpty(path))
        {
            var folderName = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            AddCandidate(folderName);
        }

        return results;
    }

    public static string NormalizeCollectionName(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return string.Empty;
        var stripped = System.Text.RegularExpressions.Regex.Replace(s, @"[\[\(\{][^\]\)\}]*[\]\)\}]", "");
        stripped = stripped.Replace("&", "and");
        var cleaned = System.Text.RegularExpressions.Regex.Replace(stripped, @"[^a-zA-Z0-9]", "");
        return cleaned.ToLowerInvariant();
    }

    public static bool IsCollectionNameMatch(string name1, string name2)
    {
        if (string.Equals(name1, name2, StringComparison.OrdinalIgnoreCase)) return true;
        var norm1 = NormalizeCollectionName(name1);
        var norm2 = NormalizeCollectionName(name2);
        if (string.IsNullOrEmpty(norm1) || string.IsNullOrEmpty(norm2)) return false;
        if (norm1 == norm2) return true;
        if (norm1.Replace("collection", "") == norm2.Replace("collection", "")) return true;
        return false;
    }
}
