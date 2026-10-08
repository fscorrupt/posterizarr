using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
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
using MediaBrowser.Model.Querying;

namespace Posterizarr.Plugin.Providers
{
    public class PosterizarrImageProvider : IRemoteImageProvider, IHasItemChangeMonitor, IHasOrder
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

        public bool HasChanged(BaseItem item, LibraryOptions libraryOptions, IDirectoryService directoryService)
        {
            var config = Plugin.Instance?.Configuration;
            if (config == null || string.IsNullOrEmpty(config.AssetFolderPath))
                return false;

            if (config.EnablePlexSync && (item is not BoxSet || !config.UpdateCollection))
                return false;

            try
            {
                foreach (var type in GetSupportedImages(item))
                {
                    var path = FindFile(item, config, type);
                    if (!string.IsNullOrEmpty(path))
                    {
                        LogDebug("HasChanged: Local file match found for '{0}' ({1}): {2}", item.Name, type, path);
                        return true;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.ErrorException("[Posterizarr] Error in HasChanged for '{0}'", ex, item.Name);
            }

            return false;
        }

        public Task<IEnumerable<RemoteImageInfo>> GetImages(BaseItem item, LibraryOptions libraryOptions, CancellationToken cancellationToken)
        {
            var config = Plugin.Instance?.Configuration;
            if (config?.EnablePlexSync == true && (item is not BoxSet || !config.UpdateCollection))
            {
                LogDebug("Plex Direct Sync is active. Bypassing local image provider for '{0}' to prevent overwrite.", item.Name);
                return Task.FromResult(Enumerable.Empty<RemoteImageInfo>());
            }

            _logger.Info("[Posterizarr] Searching images for '{0}' ({1})", item.Name, item.GetType().Name);

            if (config == null || string.IsNullOrEmpty(config.AssetFolderPath))
            {
                _logger.Warn("[Posterizarr] AssetFolderPath is not configured.");
                return Task.FromResult(Enumerable.Empty<RemoteImageInfo>());
            }

            var results = new List<RemoteImageInfo>();
            foreach (var type in GetSupportedImages(item))
            {
                var path = FindFile(item, config, type);
                if (string.IsNullOrEmpty(path)) continue;

                _logger.Info("[Posterizarr] Found {0} for '{1}' at '{2}'", type, item.Name, path);
                var mtime = new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeSeconds();
                var url = $"http://127.0.0.1:{_appHost.HttpPort}/Posterizarr/Image?path={Uri.EscapeDataString(path)}&t={mtime}";
                results.Add(new RemoteImageInfo { ProviderName = Name, Url = url, ThumbnailUrl = url, Type = type });
            }

            if (results.Count == 0)
            {
                _logger.Info("[Posterizarr] No matching images found for '{0}' in '{1}'", item.Name, config.AssetFolderPath);
            }

            return Task.FromResult<IEnumerable<RemoteImageInfo>>(results);
        }

        internal string? FindFile(BaseItem item, Configuration.PluginConfiguration config, ImageType type)
        {
            if (item is BoxSet boxSet)
            {
                return FindCollectionFile(boxSet, config, type);
            }

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
                (ImageType.Thumb, _) => "background",
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

                if (type == ImageType.Backdrop || type == ImageType.Thumb)
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

        internal string? FindCollectionFile(BoxSet boxSet, Configuration.PluginConfiguration config, ImageType type)
        {
            if (config == null || string.IsNullOrEmpty(config.AssetFolderPath) || !config.UpdateCollection || !Directory.Exists(config.AssetFolderPath))
            {
                return null;
            }

            var candidateNames = GetCollectionCandidateNames(boxSet.Name, boxSet.Path);
            if (candidateNames.Count == 0) return null;

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
                    LogDebug("SUCCESS: Found collection asset for '{0}' at '{1}'", boxSet.Name, match);
                    return match;
                }

                // Check subfolders under Collections (e.g., Collections/Movies, Collections/Shows, etc.)
                try
                {
                    foreach (var sub in Directory.GetDirectories(collectionsDir))
                    {
                        if (checkedDirs.Add(sub))
                        {
                            match = FindInDirectory(sub, candidateNames, supportedExtensions, type);
                            if (match != null)
                            {
                                LogDebug("SUCCESS: Found collection asset for '{0}' in Collections subfolder at '{1}'", boxSet.Name, match);
                                return match;
                            }
                        }
                    }
                }
                catch { }
            }

            // 2. Discover potential library names associated with this collection
            var libraryNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var collectionFolders = _libraryManager.GetCollectionFolders(boxSet);
            if (collectionFolders != null && collectionFolders.Length > 0)
            {
                foreach (var cf in collectionFolders)
                {
                    if (!string.IsNullOrEmpty(cf.Name) && !cf.Name.Equals("Collections", StringComparison.OrdinalIgnoreCase))
                    {
                        libraryNames.Add(cf.Name);
                    }
                }
            }

            try
            {
                var child = _libraryManager.GetItemList(new InternalItemsQuery
                {
                    Parent = boxSet,
                    Limit = 1
                }).FirstOrDefault();

                if (child != null)
                {
                    var childFolders = _libraryManager.GetCollectionFolders(child);
                    if (childFolders != null && childFolders.Length > 0)
                    {
                        foreach (var cf in childFolders)
                        {
                            if (!string.IsNullOrEmpty(cf.Name) && !cf.Name.Equals("Collections", StringComparison.OrdinalIgnoreCase))
                            {
                                libraryNames.Add(cf.Name);
                            }
                        }
                    }
                }
            }
            catch { }

            try
            {
                if (!string.IsNullOrEmpty(collectionsDir))
                {
                    foreach (var lib in libraryNames)
                    {
                        var collectionsSubLib = Path.Combine(collectionsDir, lib);
                        if (checkedDirs.Add(collectionsSubLib))
                        {
                            var match = FindInDirectory(collectionsSubLib, candidateNames, supportedExtensions, type);
                            if (match != null) return match;
                        }
                    }
                }

                var rootDirs = Directory.GetDirectories(assetRoot);
                foreach (var lib in libraryNames)
                {
                    var libraryDir = rootDirs.FirstOrDefault(d =>
                        string.Equals(Path.GetFileName(d), lib, StringComparison.OrdinalIgnoreCase));
                    if (libraryDir != null)
                    {
                        var libCollections = Path.Combine(libraryDir, "Collections");
                        if (Directory.Exists(libCollections) && checkedDirs.Add(libCollections))
                        {
                            var match = FindInDirectory(libCollections, candidateNames, supportedExtensions, type);
                            if (match != null) return match;
                        }

                        if (!config.EnablePlexSync && checkedDirs.Add(libraryDir))
                        {
                            var match = FindInDirectory(libraryDir, candidateNames, supportedExtensions, type);
                            if (match != null) return match;
                        }
                    }
                }

                // 3. Check any other root libraries (e.g. Movies/Collections or Shows/Collections)
                foreach (var rootDir in rootDirs)
                {
                    var rootCollections = Path.Combine(rootDir, "Collections");
                    if (Directory.Exists(rootCollections) && checkedDirs.Add(rootCollections))
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
            }
            catch { }

            // 4. Check root asset folder itself (only if Plex Direct Sync is not restricting search to collection paths)
            if (!config.EnablePlexSync && checkedDirs.Add(assetRoot))
            {
                var match = FindInDirectory(assetRoot, candidateNames, supportedExtensions, type);
                if (match != null) return match;
            }

            LogDebug("RESULT: No collection asset found for '{0}'", boxSet.Name);
            return null;
        }

        private string? FindInDirectory(string dir, List<string> candidateNames, string[] supportedExtensions, ImageType type)
        {
            if (!Directory.Exists(dir)) return null;

            // A. Check subfolders in dir for matching collection name
            foreach (var name in candidateNames)
            {
                var subfolderPath = Path.Combine(dir, name);
                if (Directory.Exists(subfolderPath))
                {
                    var fileMatch = MatchCollectionFolderFile(subfolderPath, name, supportedExtensions, type);
                    if (fileMatch != null) return fileMatch;
                }
            }

            // Fuzzy subfolder match
            try
            {
                var subdirs = Directory.GetDirectories(dir);
                foreach (var sub in subdirs)
                {
                    var subName = Path.GetFileName(sub);
                    if (candidateNames.Any(c => IsCollectionNameMatch(subName, c)))
                    {
                        var fileMatch = MatchCollectionFolderFile(sub, subName, supportedExtensions, type);
                        if (fileMatch != null) return fileMatch;
                    }
                }
            }
            catch { }

            // B. Check flat files directly in dir
            foreach (var name in candidateNames)
            {
                var flatMatch = MatchCollectionFlatFile(dir, name, supportedExtensions, type);
                if (flatMatch != null) return flatMatch;
            }

            return null;
        }

        private static string? MatchCollectionFolderFile(string folderPath, string candidateName, string[] supportedExtensions, ImageType type)
        {
            if (!Directory.Exists(folderPath)) return null;
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

            try
            {
                var files = Directory.GetFiles(folderPath);
                foreach (var baseName in targetBaseNames)
                {
                    foreach (var ext in supportedExtensions)
                    {
                        var target = baseName + ext;
                        var match = files.FirstOrDefault(f => Path.GetFileName(f).Equals(target, StringComparison.OrdinalIgnoreCase));
                        if (match != null) return match;
                    }
                }
            }
            catch { }
            return null;
        }

        private static string? MatchCollectionFlatFile(string dirPath, string candidateName, string[] supportedExtensions, ImageType type)
        {
            if (!Directory.Exists(dirPath)) return null;
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

            try
            {
                var files = Directory.GetFiles(dirPath);
                foreach (var baseName in targetBaseNames)
                {
                    foreach (var ext in supportedExtensions)
                    {
                        var target = baseName + ext;
                        var match = files.FirstOrDefault(f => Path.GetFileName(f).Equals(target, StringComparison.OrdinalIgnoreCase));
                        if (match != null) return match;
                    }
                }
            }
            catch { }
            return null;
        }

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

                var stripped = Regex.Replace(trimmed, @"\s*[\[\(\{]boxset[\]\)\}]\s*", "", RegexOptions.IgnoreCase).Trim();
                if (!string.IsNullOrEmpty(stripped) && !results.Contains(stripped, StringComparer.OrdinalIgnoreCase))
                    results.Add(stripped);

                // Handle '&' vs 'and' variants (e.g. "Alien & Predator Timeline" <-> "Alien and Predator Timeline")
                if (trimmed.Contains('&'))
                {
                    var withAnd = trimmed.Replace("&", "and");
                    var cleanAnd = Regex.Replace(withAnd, @"\s+", " ").Trim();
                    if (!results.Contains(cleanAnd, StringComparer.OrdinalIgnoreCase))
                        results.Add(cleanAnd);
                }
                if (Regex.IsMatch(trimmed, @"\band\b", RegexOptions.IgnoreCase))
                {
                    var withAmp = Regex.Replace(trimmed, @"\band\b", "&", RegexOptions.IgnoreCase);
                    var cleanAmp = Regex.Replace(withAmp, @"\s+", " ").Trim();
                    if (!results.Contains(cleanAmp, StringComparer.OrdinalIgnoreCase))
                        results.Add(cleanAmp);
                }

                var replacedPunct = trimmed.Replace(':', '-').Replace('/', '-').Replace('\\', '-');
                var cleanPunct = Regex.Replace(replacedPunct, @"\s+", " ").Trim(' ', '-');
                if (!string.IsNullOrEmpty(cleanPunct) && !results.Contains(cleanPunct, StringComparer.OrdinalIgnoreCase))
                    results.Add(cleanPunct);

                var illegal = Path.GetInvalidFileNameChars().Concat(new[] { ':', '*', '?', '"', '<', '>', '|' }).Distinct();
                var strippedIllegal = new string(trimmed.Where(c => !illegal.Contains(c)).ToArray()).Trim();
                strippedIllegal = Regex.Replace(strippedIllegal, @"\s+", " ").Trim();
                if (!string.IsNullOrEmpty(strippedIllegal) && !results.Contains(strippedIllegal, StringComparer.OrdinalIgnoreCase))
                    results.Add(strippedIllegal);

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
            var stripped = Regex.Replace(s, @"[\[\(\{][^\]\)\}]*[\]\)\}]", "");
            stripped = stripped.Replace("&", "and");
            var cleaned = Regex.Replace(stripped, @"[^a-zA-Z0-9]", "");
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

        // Required by IRemoteImageProvider; not called since URLs are served via the HTTP endpoint.
        public Task<HttpResponseInfo> GetImageResponse(string url, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseInfo { StatusCode = System.Net.HttpStatusCode.NotFound });
    }
}
