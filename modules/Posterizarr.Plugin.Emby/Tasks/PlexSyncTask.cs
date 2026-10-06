using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
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
using Posterizarr.Plugin.Configuration;

namespace Posterizarr.Plugin.Tasks
{
    public class PlexSyncTask : IScheduledTask
    {
        private readonly ILibraryManager _libraryManager;
        private readonly ILogManager _logManager;
        private readonly ILogger _logger;
        private readonly IServerApplicationHost _appHost;
        private static readonly HttpClient _httpClient = new(new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            MaxConnectionsPerServer = 10
        })
        {
            Timeout = TimeSpan.FromSeconds(60)
        };

        public PlexSyncTask(
            ILibraryManager libraryManager,
            ILogManager logManager,
            IServerApplicationHost appHost)
        {
            _libraryManager = libraryManager;
            _logManager = logManager;
            _appHost = appHost;
            _logger = logManager.GetLogger(GetType().Name);
        }

        public string Name => "Sync Artwork from Plex";
        public string Key => "PosterizarrPlexSyncTask";
        public string Description => "Directly mirrors active artwork (including Kometa overlays) from a Plex server to Emby using Plex bulk queries.";
        public string Category => "Posterizarr";

        public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
        {
            return new[]
            {
                new TaskTriggerInfo
                {
                    Type = TaskTriggerInfo.TriggerDaily,
                    TimeOfDayTicks = TimeSpan.FromHours(3).Ticks
                }
            };
        }

        private void LogDebug(string message, params object?[] args)
        {
            if (Plugin.Instance?.Configuration?.EnableDebugMode == true)
            {
                _logger.Info("[Posterizarr PlexSync DEBUG] " + message, args);
            }
        }

        public async Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
        {
            var config = Plugin.Instance?.Configuration;
            if (config == null || !config.EnablePlexSync)
            {
                LogDebug("Plex Direct Sync is disabled. Skipping task.");
                return;
            }

            if (string.IsNullOrWhiteSpace(config.PlexServerUrl) || string.IsNullOrWhiteSpace(config.PlexToken))
            {
                _logger.Warn("[Posterizarr PlexSync] Plex Server URL or Token is missing. Aborting sync.");
                return;
            }

            var plexBaseUrl = config.PlexServerUrl.Trim().TrimEnd('/');
            var plexToken = config.PlexToken.Trim();

            var dataFolder = Plugin.Instance?.DataFolderPath ?? Path.Combine(AppContext.BaseDirectory, "data");
            var plexCache = new PlexSyncCacheManager(dataFolder, _logger);
            plexCache.Load();

            var artworkStorageDir = Path.Combine(dataFolder, "plex_artwork");
            Directory.CreateDirectory(artworkStorageDir);

            _logger.Info("[Posterizarr PlexSync] Starting direct Plex artwork sync from '{0}'...", plexBaseUrl);
            var stopwatch = Stopwatch.StartNew();

            int totalPlexItems = 0;
            int cacheHits = 0;
            int updatedCount = 0;
            int unmatchedCount = 0;

            try
            {
                // 1. Fetch Plex Sections (Libraries)
                var sections = await FetchPlexSectionsAsync(plexBaseUrl, plexToken, cancellationToken).ConfigureAwait(false);
                if (sections.Count == 0)
                {
                    _logger.Warn("[Posterizarr PlexSync] No supported libraries found in Plex.");
                    return;
                }

                var allowedLibraries = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (!string.IsNullOrWhiteSpace(config.PlexLibrariesToInclude))
                {
                    foreach (var lib in config.PlexLibrariesToInclude.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    {
                        allowedLibraries.Add(lib);
                    }
                }

                // 2. Query all Emby Items into Memory
                _logger.Info("[Posterizarr PlexSync] Indexing Emby libraries in memory...");
                var itemTypes = new List<string> { typeof(Movie).Name, typeof(Series).Name, typeof(Season).Name };
                if (config.PlexSyncTitlecards)
                {
                    itemTypes.Add(typeof(Episode).Name);
                }

                var embyItems = _libraryManager.GetItemList(new InternalItemsQuery
                {
                    IncludeItemTypes = itemTypes.ToArray(),
                    Recursive = true,
                    IsVirtualItem = false
                });

                var moviesByTmdb = new Dictionary<string, List<BaseItem>>(StringComparer.OrdinalIgnoreCase);
                var moviesByImdb = new Dictionary<string, List<BaseItem>>(StringComparer.OrdinalIgnoreCase);
                var moviesByTvdb = new Dictionary<string, List<BaseItem>>(StringComparer.OrdinalIgnoreCase);
                var moviesByTitleYear = new Dictionary<string, List<BaseItem>>(StringComparer.OrdinalIgnoreCase);
                var moviesByCleanFileName = new Dictionary<string, List<BaseItem>>(StringComparer.OrdinalIgnoreCase);

                var seriesByTvdb = new Dictionary<string, List<BaseItem>>(StringComparer.OrdinalIgnoreCase);
                var seriesByTmdb = new Dictionary<string, List<BaseItem>>(StringComparer.OrdinalIgnoreCase);
                var seriesByImdb = new Dictionary<string, List<BaseItem>>(StringComparer.OrdinalIgnoreCase);
                var seriesByTitleYear = new Dictionary<string, List<BaseItem>>(StringComparer.OrdinalIgnoreCase);
                var seriesByCleanFileName = new Dictionary<string, List<BaseItem>>(StringComparer.OrdinalIgnoreCase);

                var seasonsBySeriesAndIndex = new Dictionary<string, Season>(StringComparer.OrdinalIgnoreCase);
                var episodesBySeriesAndIndex = new Dictionary<string, Episode>(StringComparer.OrdinalIgnoreCase);

                foreach (var item in embyItems)
                {
                    if (item is Movie movie)
                    {
                        var tmdb = GetProviderId(movie, "Tmdb");
                        if (tmdb != null) AddToMap(moviesByTmdb, tmdb, movie);

                        var imdb = GetProviderId(movie, "Imdb");
                        if (imdb != null) AddToMap(moviesByImdb, NormalizeImdbId(imdb), movie);

                        var tvdb = GetProviderId(movie, "Tvdb");
                        if (tvdb != null) AddToMap(moviesByTvdb, tvdb, movie);

                        var titleYearKey = BuildTitleYearKey(movie.Name, movie.ProductionYear);
                        if (!string.IsNullOrEmpty(titleYearKey)) AddToMap(moviesByTitleYear, titleYearKey, movie);

                        if (!string.IsNullOrEmpty(movie.OriginalTitle))
                        {
                            var origKey = BuildTitleYearKey(movie.OriginalTitle, movie.ProductionYear);
                            if (!string.IsNullOrEmpty(origKey)) AddToMap(moviesByTitleYear, origKey, movie);
                        }

                        if (!string.IsNullOrEmpty(movie.Path))
                        {
                            var cleanFile = BuildCleanFileKey(movie.Path);
                            if (!string.IsNullOrEmpty(cleanFile)) AddToMap(moviesByCleanFileName, cleanFile, movie);
                        }
                    }
                    else if (item is Series series)
                    {
                        var tvdb = GetProviderId(series, "Tvdb");
                        if (tvdb != null) AddToMap(seriesByTvdb, tvdb, series);

                        var tmdb = GetProviderId(series, "Tmdb");
                        if (tmdb != null) AddToMap(seriesByTmdb, tmdb, series);

                        var imdb = GetProviderId(series, "Imdb");
                        if (imdb != null) AddToMap(seriesByImdb, NormalizeImdbId(imdb), series);

                        var titleYearKey = BuildTitleYearKey(series.Name, series.ProductionYear);
                        if (!string.IsNullOrEmpty(titleYearKey)) AddToMap(seriesByTitleYear, titleYearKey, series);

                        if (!string.IsNullOrEmpty(series.OriginalTitle))
                        {
                            var origKey = BuildTitleYearKey(series.OriginalTitle, series.ProductionYear);
                            if (!string.IsNullOrEmpty(origKey)) AddToMap(seriesByTitleYear, origKey, series);
                        }

                        if (!string.IsNullOrEmpty(series.Path))
                        {
                            var cleanFile = BuildCleanFileKey(series.Path);
                            if (!string.IsNullOrEmpty(cleanFile)) AddToMap(seriesByCleanFileName, cleanFile, series);
                        }
                    }
                    else if (item is Season season && season.IndexNumber.HasValue)
                    {
                        var parentSeries = season.FindParent<Series>();
                        if (parentSeries != null)
                        {
                            var key = $"{parentSeries.Id:N}_{season.IndexNumber.Value}";
                            seasonsBySeriesAndIndex[key] = season;
                        }
                    }
                    else if (item is Episode episode && episode.ParentIndexNumber.HasValue && episode.IndexNumber.HasValue)
                    {
                        var parentSeries = episode.FindParent<Series>() ?? episode.Series;
                        if (parentSeries != null)
                        {
                            var key = $"{parentSeries.Id:N}_{episode.ParentIndexNumber.Value}_{episode.IndexNumber.Value}";
                            episodesBySeriesAndIndex[key] = episode;
                        }
                    }
                }

                _logger.Info("[Posterizarr PlexSync] Indexed {0} movies, {1} series, {2} seasons, and {3} episodes in Emby.",
                    moviesByTmdb.Count + moviesByTitleYear.Count, seriesByTvdb.Count + seriesByTitleYear.Count, seasonsBySeriesAndIndex.Count, episodesBySeriesAndIndex.Count);

                double currentSectionIndex = 0;

                // Process 4K libraries first so that items with Kometa 4K overlays are synced and registered with priority.
                // Non-4K / 1080p libraries will not overwrite items that belong to a 4K library.
                var sortedSections = sections
                    .OrderByDescending(s => Is4KLibrary(s.Title))
                    .ToList();

                var itemsIn4KLibrary = new HashSet<Guid>();

                // 3. Process Each Plex Library Section
                foreach (var section in sortedSections)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    currentSectionIndex++;
                    progress.Report(currentSectionIndex / sortedSections.Count * 90);

                    if (allowedLibraries.Count > 0 && !allowedLibraries.Contains(section.Title))
                    {
                        LogDebug("Skipping library '{0}' (not in PlexLibrariesToInclude).", section.Title);
                        continue;
                    }

                    bool is4KSection = Is4KLibrary(section.Title);

                    if (section.Type.Equals("movie", StringComparison.OrdinalIgnoreCase))
                    {
                        if (!config.PlexSyncMovies && !config.PlexSyncBackdrops) continue;

                        _logger.Info("[Posterizarr PlexSync] Bulk fetching movies from Plex library '{0}'...", section.Title);
                        var plexMovies = await FetchPlexMoviesAsync(plexBaseUrl, plexToken, section.Key, cancellationToken).ConfigureAwait(false);
                        totalPlexItems += plexMovies.Count;

                        foreach (var pMovie in plexMovies)
                        {
                            cancellationToken.ThrowIfCancellationRequested();

                            BaseItem? matchedMovie = null;
                            List<BaseItem>? candidates = null;

                            if (pMovie.TmdbId != null && moviesByTmdb.TryGetValue(pMovie.TmdbId, out candidates)) { }
                            else if (pMovie.ImdbId != null && moviesByImdb.TryGetValue(NormalizeImdbId(pMovie.ImdbId), out candidates)) { }
                            else if (pMovie.TvdbId != null && moviesByTvdb.TryGetValue(pMovie.TvdbId, out candidates)) { }
                            else if (!string.IsNullOrEmpty(pMovie.Title) && moviesByTitleYear.TryGetValue(BuildTitleYearKey(pMovie.Title, pMovie.Year), out candidates)) { }
                            else if (!string.IsNullOrEmpty(pMovie.OriginalTitle) && moviesByTitleYear.TryGetValue(BuildTitleYearKey(pMovie.OriginalTitle, pMovie.Year), out candidates)) { }
                            else if (!string.IsNullOrEmpty(pMovie.FileName) && moviesByCleanFileName.TryGetValue(BuildCleanFileKey(pMovie.FileName), out candidates)) { }
                            else if (!string.IsNullOrEmpty(pMovie.Title) && pMovie.Year.HasValue &&
                                     (moviesByTitleYear.TryGetValue(BuildTitleYearKey(pMovie.Title, pMovie.Year.Value - 1), out candidates) ||
                                      moviesByTitleYear.TryGetValue(BuildTitleYearKey(pMovie.Title, pMovie.Year.Value + 1), out candidates))) { }

                            if (candidates != null && candidates.Count > 0)
                            {
                                matchedMovie = DisambiguateCandidate(candidates, section.Title, is4KSection);
                            }

                            if (matchedMovie == null)
                            {
                                unmatchedCount++;
                                _logger.Warn("[Posterizarr PlexSync] Unmatched movie in Emby: '{0}' (Year: {1}, TMDB: {2}, IMDB: {3}, File: {4})",
                                    pMovie.Title, pMovie.Year, pMovie.TmdbId ?? "none", pMovie.ImdbId ?? "none", pMovie.FileName ?? "none");
                                continue;
                            }

                            if (is4KSection)
                            {
                                itemsIn4KLibrary.Add(matchedMovie.Id);
                            }
                            else if (itemsIn4KLibrary.Contains(matchedMovie.Id))
                            {
                                LogDebug("Skipping movie '{0}' in library '{1}' because it was already matched from a 4K library.", matchedMovie.Name, section.Title);
                                continue;
                            }

                            // Sync Poster
                            if (config.PlexSyncMovies && !string.IsNullOrEmpty(pMovie.Thumb))
                            {
                                bool updated = await SyncItemArtworkAsync(
                                    matchedMovie, ImageType.Primary, pMovie.Thumb, plexBaseUrl, plexToken,
                                    artworkStorageDir, plexCache, is4KSection, cancellationToken).ConfigureAwait(false);

                                if (updated) updatedCount++;
                                else cacheHits++;
                            }

                            // Sync Backdrop
                            if (config.PlexSyncBackdrops && !string.IsNullOrEmpty(pMovie.Art))
                            {
                                bool updated = await SyncItemArtworkAsync(
                                    matchedMovie, ImageType.Backdrop, pMovie.Art, plexBaseUrl, plexToken,
                                    artworkStorageDir, plexCache, is4KSection, cancellationToken).ConfigureAwait(false);

                                if (updated) updatedCount++;
                                else cacheHits++;
                            }
                        }
                    }
                    else if (section.Type.Equals("show", StringComparison.OrdinalIgnoreCase))
                    {
                        if (!config.PlexSyncShows && !config.PlexSyncSeasons && !config.PlexSyncBackdrops && !config.PlexSyncTitlecards) continue;

                        _logger.Info("[Posterizarr PlexSync] Bulk fetching shows from Plex library '{0}'...", section.Title);
                        var plexShows = await FetchPlexShowsAsync(plexBaseUrl, plexToken, section.Key, cancellationToken).ConfigureAwait(false);
                        totalPlexItems += plexShows.Count;

                        var plexRatingKeyToEmbySeries = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);

                        foreach (var pShow in plexShows)
                        {
                            cancellationToken.ThrowIfCancellationRequested();

                            BaseItem? matchedSeries = null;
                            List<BaseItem>? candidates = null;

                            if (pShow.TvdbId != null && seriesByTvdb.TryGetValue(pShow.TvdbId, out candidates)) { }
                            else if (pShow.TmdbId != null && seriesByTmdb.TryGetValue(pShow.TmdbId, out candidates)) { }
                            else if (pShow.ImdbId != null && seriesByImdb.TryGetValue(NormalizeImdbId(pShow.ImdbId), out candidates)) { }
                            else if (!string.IsNullOrEmpty(pShow.Title) && seriesByTitleYear.TryGetValue(BuildTitleYearKey(pShow.Title, pShow.Year), out candidates)) { }
                            else if (!string.IsNullOrEmpty(pShow.OriginalTitle) && seriesByTitleYear.TryGetValue(BuildTitleYearKey(pShow.OriginalTitle, pShow.Year), out candidates)) { }
                            else if (!string.IsNullOrEmpty(pShow.FileName) && seriesByCleanFileName.TryGetValue(BuildCleanFileKey(pShow.FileName), out candidates)) { }
                            else if (!string.IsNullOrEmpty(pShow.Title) && pShow.Year.HasValue &&
                                     (seriesByTitleYear.TryGetValue(BuildTitleYearKey(pShow.Title, pShow.Year.Value - 1), out candidates) ||
                                      seriesByTitleYear.TryGetValue(BuildTitleYearKey(pShow.Title, pShow.Year.Value + 1), out candidates))) { }

                            if (candidates != null && candidates.Count > 0)
                            {
                                matchedSeries = DisambiguateCandidate(candidates, section.Title, is4KSection);
                            }

                            if (matchedSeries == null)
                            {
                                unmatchedCount++;
                                _logger.Warn("[Posterizarr PlexSync] Unmatched show in Emby: '{0}' (Year: {1}, TVDB: {2}, TMDB: {3})",
                                    pShow.Title, pShow.Year, pShow.TvdbId ?? "none", pShow.TmdbId ?? "none");
                                continue;
                            }

                            if (is4KSection)
                            {
                                itemsIn4KLibrary.Add(matchedSeries.Id);
                            }
                            else if (itemsIn4KLibrary.Contains(matchedSeries.Id))
                            {
                                LogDebug("Skipping series '{0}' in library '{1}' because it was already matched from a 4K library.", matchedSeries.Name, section.Title);
                                continue;
                            }

                            plexRatingKeyToEmbySeries[pShow.RatingKey] = matchedSeries;

                            // Sync Series Poster
                            if (config.PlexSyncShows && !string.IsNullOrEmpty(pShow.Thumb))
                            {
                                bool updated = await SyncItemArtworkAsync(
                                    matchedSeries, ImageType.Primary, pShow.Thumb, plexBaseUrl, plexToken,
                                    artworkStorageDir, plexCache, is4KSection, cancellationToken).ConfigureAwait(false);

                                if (updated) updatedCount++;
                                else cacheHits++;
                            }

                            // Sync Series Backdrop
                            if (config.PlexSyncBackdrops && !string.IsNullOrEmpty(pShow.Art))
                            {
                                bool updated = await SyncItemArtworkAsync(
                                    matchedSeries, ImageType.Backdrop, pShow.Art, plexBaseUrl, plexToken,
                                    artworkStorageDir, plexCache, is4KSection, cancellationToken).ConfigureAwait(false);

                                if (updated) updatedCount++;
                                else cacheHits++;
                            }
                        }

                        var plexSeasonRatingKeyToSeriesRatingKey = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

                        // Sync Seasons
                        if (config.PlexSyncSeasons || config.PlexSyncTitlecards)
                        {
                            _logger.Info("[Posterizarr PlexSync] Bulk fetching all seasons from Plex library '{0}'...", section.Title);
                            var plexSeasons = await FetchPlexSeasonsAsync(plexBaseUrl, plexToken, section.Key, cancellationToken).ConfigureAwait(false);
                            totalPlexItems += plexSeasons.Count;

                            foreach (var pSeason in plexSeasons)
                            {
                                cancellationToken.ThrowIfCancellationRequested();

                                if (string.IsNullOrEmpty(pSeason.ParentRatingKey)) continue;
                                plexSeasonRatingKeyToSeriesRatingKey[pSeason.RatingKey] = pSeason.ParentRatingKey;

                                if (!config.PlexSyncSeasons) continue;
                                if (!pSeason.Index.HasValue) continue;
                                if (!plexRatingKeyToEmbySeries.TryGetValue(pSeason.ParentRatingKey, out var embySeries)) continue;

                                var seasonKey = $"{embySeries.Id:N}_{pSeason.Index.Value}";
                                if (!seasonsBySeriesAndIndex.TryGetValue(seasonKey, out var embySeason))
                                {
                                    continue;
                                }

                                if (!string.IsNullOrEmpty(pSeason.Thumb))
                                {
                                    bool updated = await SyncItemArtworkAsync(
                                        embySeason, ImageType.Primary, pSeason.Thumb, plexBaseUrl, plexToken,
                                        artworkStorageDir, plexCache, is4KSection, cancellationToken).ConfigureAwait(false);

                                    if (updated) updatedCount++;
                                    else cacheHits++;
                                }
                            }
                        }

                        // Sync Episode Title Cards if enabled
                        if (config.PlexSyncTitlecards)
                        {
                            _logger.Info("[Posterizarr PlexSync] Bulk fetching all episode title cards from Plex library '{0}'...", section.Title);
                            var plexEpisodes = await FetchPlexEpisodesAsync(plexBaseUrl, plexToken, section.Key, cancellationToken).ConfigureAwait(false);
                            totalPlexItems += plexEpisodes.Count;

                            foreach (var pEp in plexEpisodes)
                            {
                                cancellationToken.ThrowIfCancellationRequested();

                                if (!pEp.ParentIndex.HasValue || !pEp.Index.HasValue || string.IsNullOrEmpty(pEp.Thumb)) continue;

                                BaseItem? embySeries = null;
                                if (!string.IsNullOrEmpty(pEp.GrandparentRatingKey) && plexRatingKeyToEmbySeries.TryGetValue(pEp.GrandparentRatingKey, out embySeries))
                                {
                                }
                                else if (!string.IsNullOrEmpty(pEp.ParentRatingKey) && plexSeasonRatingKeyToSeriesRatingKey.TryGetValue(pEp.ParentRatingKey, out var sKey) && plexRatingKeyToEmbySeries.TryGetValue(sKey, out embySeries))
                                {
                                }

                                if (embySeries == null) continue;

                                var epKey = $"{embySeries.Id:N}_{pEp.ParentIndex.Value}_{pEp.Index.Value}";
                                if (!episodesBySeriesAndIndex.TryGetValue(epKey, out var embyEpisode))
                                {
                                    continue;
                                }

                                bool updated = await SyncItemArtworkAsync(
                                    embyEpisode, ImageType.Primary, pEp.Thumb, plexBaseUrl, plexToken,
                                    artworkStorageDir, plexCache, is4KSection, cancellationToken).ConfigureAwait(false);

                                if (updated) updatedCount++;
                                else cacheHits++;
                            }
                        }
                    }
                }
            }
            finally
            {
                plexCache.Save();
            }

            stopwatch.Stop();
            progress.Report(100);
            _logger.Info(
                "[Posterizarr PlexSync] Sync completed in {0:mm\\:ss\\.fff}. Total Plex items: {1}, Cache hits: {2}, Updated: {3}, Unmatched: {4}.",
                stopwatch.Elapsed, totalPlexItems, cacheHits, updatedCount, unmatchedCount);
        }

        private async Task<bool> SyncItemArtworkAsync(
            BaseItem item,
            ImageType imageType,
            string plexArtworkPath,
            string plexBaseUrl,
            string plexToken,
            string storageDirectory,
            PlexSyncCacheManager cache,
            bool is4KSection,
            CancellationToken ct)
        {
            var existingImage = item.GetImageInfo(imageType, 0);

            // Fast path: if existing image is present and Plex thumb has not changed in cache, skip!
            if (existingImage != null && !string.IsNullOrEmpty(existingImage.Path) && File.Exists(existingImage.Path) &&
                cache.IsMatch(item.Id, imageType, plexArtworkPath))
            {
                return false;
            }

            // 4K protection: If this item was already synced from a 4K library (which has Kometa 4K overlays),
            // and the current library is a standard/non-4K library, do NOT overwrite it!
            if (!is4KSection && cache.TryGetRecord(item.Id, imageType, out var existingRecord) && existingRecord != null && existingRecord.Is4K)
            {
                if (Is4KLibrary(GetItemLibraryName(item)) || Is4KLibrary(item.Path))
                {
                    LogDebug("Preserving 4K artwork for '{0}' ({1}) - skipping non-4K library update.", item.Name, imageType);
                    return false;
                }
            }

            // Stream new image from Plex to storage folder
            var imageUrl = $"{plexBaseUrl}{plexArtworkPath}?X-Plex-Token={plexToken}";
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, imageUrl);
                using var resp = await _httpClient.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);

                if (!resp.IsSuccessStatusCode)
                {
                    _logger.Warn("[Posterizarr PlexSync] Failed to download image for '{0}' ({1}): HTTP {2}",
                        item.Name, imageType, resp.StatusCode);
                    return false;
                }

                var contentType = resp.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
                var ext = contentType switch
                {
                    "image/png" => ".png",
                    "image/webp" => ".webp",
                    _ => ".jpg"
                };

                var targetFilePath = Path.Combine(storageDirectory, $"{item.Id:N}_{imageType}{ext}");
                await using (var fileStream = new FileStream(targetFilePath, FileMode.Create, FileAccess.Write, FileShare.None, 65536, true))
                {
                    await resp.Content.CopyToAsync(fileStream, ct).ConfigureAwait(false);
                }

                item.SetImage(new ItemImageInfo
                {
                    Path = targetFilePath,
                    Type = imageType,
                    DateModified = DateTime.UtcNow
                }, 0);

                _libraryManager.UpdateItem(item, item.GetParent(), ItemUpdateType.ImageUpdate);
                cache.Update(item.Id, imageType, plexArtworkPath, is4KSection);

                LogDebug("Updated {0} for '{1}' from Plex thumb '{2}'", imageType, item.Name, plexArtworkPath);
                return true;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.Error("[Posterizarr PlexSync] Error applying image for '{0}' ({1}): {2}", item.Name, imageType, ex.Message);
                return false;
            }
        }

        private static async Task<List<PlexSection>> FetchPlexSectionsAsync(string plexBaseUrl, string plexToken, CancellationToken ct)
        {
            var url = $"{plexBaseUrl}/library/sections";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Add("Accept", "application/json");
            req.Headers.Add("X-Plex-Token", plexToken);

            using var resp = await _httpClient.SendAsync(req, ct).ConfigureAwait(false);
            resp.EnsureSuccessStatusCode();

            using var jsonDoc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false), default, ct).ConfigureAwait(false);
            var sections = new List<PlexSection>();

            if (jsonDoc.RootElement.TryGetProperty("MediaContainer", out var mc) &&
                mc.TryGetProperty("Directory", out var dirProp))
            {
                if (dirProp.ValueKind == JsonValueKind.Array)
                {
                    foreach (var elem in dirProp.EnumerateArray())
                    {
                        AddSectionIfSupported(elem, sections);
                    }
                }
                else if (dirProp.ValueKind == JsonValueKind.Object)
                {
                    AddSectionIfSupported(dirProp, sections);
                }
            }

            return sections;
        }

        private static void AddSectionIfSupported(JsonElement elem, List<PlexSection> list)
        {
            var key = elem.TryGetProperty("key", out var k) ? k.GetString() : null;
            var type = elem.TryGetProperty("type", out var t) ? t.GetString() : null;
            var title = elem.TryGetProperty("title", out var titleProp) ? titleProp.GetString() : null;

            if (!string.IsNullOrEmpty(key) && !string.IsNullOrEmpty(type) && !string.IsNullOrEmpty(title))
            {
                if (type.Equals("movie", StringComparison.OrdinalIgnoreCase) || type.Equals("show", StringComparison.OrdinalIgnoreCase))
                {
                    list.Add(new PlexSection(key, type, title));
                }
            }
        }

        private static async Task<List<PlexMovieItem>> FetchPlexMoviesAsync(string plexBaseUrl, string plexToken, string sectionKey, CancellationToken ct)
        {
            var url = $"{plexBaseUrl}/library/sections/{sectionKey}/all?type=1&includeGuids=1";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Add("Accept", "application/json");
            req.Headers.Add("X-Plex-Token", plexToken);

            using var resp = await _httpClient.SendAsync(req, ct).ConfigureAwait(false);
            resp.EnsureSuccessStatusCode();

            using var jsonDoc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false), default, ct).ConfigureAwait(false);
            var list = new List<PlexMovieItem>();

            if (jsonDoc.RootElement.TryGetProperty("MediaContainer", out var mc) &&
                mc.TryGetProperty("Metadata", out var metaProp) && metaProp.ValueKind == JsonValueKind.Array)
            {
                foreach (var elem in metaProp.EnumerateArray())
                {
                    var ratingKey = elem.TryGetProperty("ratingKey", out var rk) ? rk.GetString() : null;
                    var title = elem.TryGetProperty("title", out var t) ? t.GetString() : null;
                    var originalTitle = elem.TryGetProperty("originalTitle", out var ot) ? ot.GetString() : null;
                    int? year = elem.TryGetProperty("year", out var y) && y.TryGetInt32(out var yi) ? yi : null;
                    var thumb = elem.TryGetProperty("thumb", out var th) ? th.GetString() : null;
                    var art = elem.TryGetProperty("art", out var a) ? a.GetString() : null;
                    var fileName = ExtractMediaFileName(elem);

                    if (string.IsNullOrEmpty(ratingKey) || string.IsNullOrEmpty(title)) continue;

                    var (tmdb, imdb, tvdb) = ExtractProviderIds(elem);
                    list.Add(new PlexMovieItem(ratingKey, title, originalTitle, year, thumb, art, tmdb, imdb, tvdb, fileName));
                }
            }

            return list;
        }

        private static async Task<List<PlexShowItem>> FetchPlexShowsAsync(string plexBaseUrl, string plexToken, string sectionKey, CancellationToken ct)
        {
            var url = $"{plexBaseUrl}/library/sections/{sectionKey}/all?type=2&includeGuids=1";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Add("Accept", "application/json");
            req.Headers.Add("X-Plex-Token", plexToken);

            using var resp = await _httpClient.SendAsync(req, ct).ConfigureAwait(false);
            resp.EnsureSuccessStatusCode();

            using var jsonDoc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false), default, ct).ConfigureAwait(false);
            var list = new List<PlexShowItem>();

            if (jsonDoc.RootElement.TryGetProperty("MediaContainer", out var mc) &&
                mc.TryGetProperty("Metadata", out var metaProp) && metaProp.ValueKind == JsonValueKind.Array)
            {
                foreach (var elem in metaProp.EnumerateArray())
                {
                    var ratingKey = elem.TryGetProperty("ratingKey", out var rk) ? rk.GetString() : null;
                    var title = elem.TryGetProperty("title", out var t) ? t.GetString() : null;
                    var originalTitle = elem.TryGetProperty("originalTitle", out var ot) ? ot.GetString() : null;
                    int? year = elem.TryGetProperty("year", out var y) && y.TryGetInt32(out var yi) ? yi : null;
                    var thumb = elem.TryGetProperty("thumb", out var th) ? th.GetString() : null;
                    var art = elem.TryGetProperty("art", out var a) ? a.GetString() : null;
                    var fileName = ExtractLocationOrFileName(elem);

                    if (string.IsNullOrEmpty(ratingKey) || string.IsNullOrEmpty(title)) continue;

                    var (tmdb, imdb, tvdb) = ExtractProviderIds(elem);
                    list.Add(new PlexShowItem(ratingKey, title, originalTitle, year, thumb, art, tmdb, imdb, tvdb, fileName));
                }
            }

            return list;
        }

        private static async Task<List<PlexSeasonItem>> FetchPlexSeasonsAsync(string plexBaseUrl, string plexToken, string sectionKey, CancellationToken ct)
        {
            var url = $"{plexBaseUrl}/library/sections/{sectionKey}/all?type=3&includeGuids=1";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Add("Accept", "application/json");
            req.Headers.Add("X-Plex-Token", plexToken);

            using var resp = await _httpClient.SendAsync(req, ct).ConfigureAwait(false);
            resp.EnsureSuccessStatusCode();

            using var jsonDoc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false), default, ct).ConfigureAwait(false);
            var list = new List<PlexSeasonItem>();

            if (jsonDoc.RootElement.TryGetProperty("MediaContainer", out var mc) &&
                mc.TryGetProperty("Metadata", out var metaProp) && metaProp.ValueKind == JsonValueKind.Array)
            {
                foreach (var elem in metaProp.EnumerateArray())
                {
                    var ratingKey = elem.TryGetProperty("ratingKey", out var rk) ? rk.GetString() : null;
                    var parentRatingKey = elem.TryGetProperty("parentRatingKey", out var prk) ? prk.GetString() : null;
                    int? index = elem.TryGetProperty("index", out var idx) && idx.TryGetInt32(out var idxi) ? idxi : null;
                    var thumb = elem.TryGetProperty("thumb", out var th) ? th.GetString() : null;

                    if (string.IsNullOrEmpty(ratingKey) || string.IsNullOrEmpty(parentRatingKey)) continue;

                    list.Add(new PlexSeasonItem(ratingKey, parentRatingKey, index, thumb));
                }
            }

            return list;
        }

        private static async Task<List<PlexEpisodeItem>> FetchPlexEpisodesAsync(string plexBaseUrl, string plexToken, string sectionKey, CancellationToken ct)
        {
            var url = $"{plexBaseUrl}/library/sections/{sectionKey}/all?type=4";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Add("Accept", "application/json");
            req.Headers.Add("X-Plex-Token", plexToken);

            using var resp = await _httpClient.SendAsync(req, ct).ConfigureAwait(false);
            resp.EnsureSuccessStatusCode();

            using var jsonDoc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false), default, ct).ConfigureAwait(false);
            var list = new List<PlexEpisodeItem>();

            if (jsonDoc.RootElement.TryGetProperty("MediaContainer", out var mc) &&
                mc.TryGetProperty("Metadata", out var metaProp) && metaProp.ValueKind == JsonValueKind.Array)
            {
                foreach (var elem in metaProp.EnumerateArray())
                {
                    var ratingKey = elem.TryGetProperty("ratingKey", out var rk) ? rk.GetString() : null;
                    var gpRatingKey = elem.TryGetProperty("grandparentRatingKey", out var gprk) ? gprk.GetString() : null;
                    var pRatingKey = elem.TryGetProperty("parentRatingKey", out var prk) ? prk.GetString() : null;
                    int? parentIndex = ParseIntProperty(elem, "parentIndex");
                    int? index = ParseIntProperty(elem, "index");
                    var thumb = elem.TryGetProperty("thumb", out var th) ? th.GetString() : null;

                    if (string.IsNullOrEmpty(ratingKey)) continue;

                    list.Add(new PlexEpisodeItem(ratingKey, gpRatingKey, pRatingKey, parentIndex, index, thumb));
                }
            }

            return list;
        }

        private static int? ParseIntProperty(JsonElement elem, string propName)
        {
            if (elem.TryGetProperty(propName, out var p))
            {
                if (p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out var val)) return val;
                if (p.ValueKind == JsonValueKind.String && int.TryParse(p.GetString(), out var sVal)) return sVal;
            }
            return null;
        }

        private static (string? tmdb, string? imdb, string? tvdb) ExtractProviderIds(JsonElement elem)
        {
            string? tmdb = null;
            string? imdb = null;
            string? tvdb = null;

            void ProcessId(string? val)
            {
                if (string.IsNullOrWhiteSpace(val)) return;
                val = val.Trim();

                if (val.StartsWith("imdb://", StringComparison.OrdinalIgnoreCase))
                    imdb ??= NormalizeImdbId(val.Substring(7));
                else if (val.StartsWith("tmdb://", StringComparison.OrdinalIgnoreCase))
                    tmdb ??= val.Substring(7).Trim();
                else if (val.StartsWith("tvdb://", StringComparison.OrdinalIgnoreCase))
                    tvdb ??= val.Substring(7).Trim();
                else if (val.Contains("agents.imdb://", StringComparison.OrdinalIgnoreCase))
                {
                    var match = Regex.Match(val, @"agents\.imdb://(tt\d+)", RegexOptions.IgnoreCase);
                    if (match.Success) imdb ??= NormalizeImdbId(match.Groups[1].Value);
                }
                else if (val.Contains("agents.themoviedb://", StringComparison.OrdinalIgnoreCase))
                {
                    var match = Regex.Match(val, @"agents\.themoviedb://(\d+)", RegexOptions.IgnoreCase);
                    if (match.Success) tmdb ??= match.Groups[1].Value.Trim();
                }
                else if (val.Contains("agents.thetvdb://", StringComparison.OrdinalIgnoreCase))
                {
                    var match = Regex.Match(val, @"agents\.thetvdb://(\d+)", RegexOptions.IgnoreCase);
                    if (match.Success) tvdb ??= match.Groups[1].Value.Trim();
                }
            }

            foreach (var prop in elem.EnumerateObject())
            {
                if (prop.Name.Equals("Guid", StringComparison.OrdinalIgnoreCase) ||
                    prop.Name.Equals("Guids", StringComparison.OrdinalIgnoreCase))
                {
                    if (prop.Value.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var g in prop.Value.EnumerateArray())
                        {
                            if (g.ValueKind == JsonValueKind.Object && g.TryGetProperty("id", out var idProp))
                                ProcessId(idProp.GetString());
                            else if (g.ValueKind == JsonValueKind.String)
                                ProcessId(g.GetString());
                        }
                    }
                    else if (prop.Value.ValueKind == JsonValueKind.Object)
                    {
                        if (prop.Value.TryGetProperty("id", out var idProp))
                            ProcessId(idProp.GetString());
                    }
                    else if (prop.Value.ValueKind == JsonValueKind.String)
                    {
                        ProcessId(prop.Value.GetString());
                    }
                }
                else if (prop.Name.Equals("guid", StringComparison.OrdinalIgnoreCase) && prop.Value.ValueKind == JsonValueKind.String)
                {
                    ProcessId(prop.Value.GetString());
                }
            }

            return (tmdb, imdb, tvdb);
        }

        private static string? ExtractMediaFileName(JsonElement elem)
        {
            if (elem.TryGetProperty("Media", out var mediaArr) && mediaArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var m in mediaArr.EnumerateArray())
                {
                    if (m.TryGetProperty("Part", out var partArr) && partArr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var p in partArr.EnumerateArray())
                        {
                            if (p.TryGetProperty("file", out var fProp) && !string.IsNullOrWhiteSpace(fProp.GetString()))
                            {
                                return Path.GetFileName(fProp.GetString());
                            }
                        }
                    }
                }
            }
            return null;
        }

        private static string? ExtractLocationOrFileName(JsonElement elem)
        {
            if (elem.TryGetProperty("Location", out var locArr) && locArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var loc in locArr.EnumerateArray())
                {
                    if (loc.TryGetProperty("path", out var pProp))
                    {
                        var pStr = pProp.GetString();
                        if (!string.IsNullOrWhiteSpace(pStr))
                        {
                            return Path.GetFileName(pStr.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                        }
                    }
                }
            }
            return null;
        }

        private static string? GetProviderId(BaseItem item, string providerName)
        {
            if (item.ProviderIds == null) return null;

            foreach (var kvp in item.ProviderIds)
            {
                if (kvp.Key.Equals(providerName, StringComparison.OrdinalIgnoreCase))
                {
                    if (!string.IsNullOrWhiteSpace(kvp.Value)) return kvp.Value.Trim();
                }
                if (providerName.Equals("Tmdb", StringComparison.OrdinalIgnoreCase) &&
                    (kvp.Key.Equals("TheMovieDb", StringComparison.OrdinalIgnoreCase) ||
                     kvp.Key.Equals("Themoviedb", StringComparison.OrdinalIgnoreCase)))
                {
                    if (!string.IsNullOrWhiteSpace(kvp.Value)) return kvp.Value.Trim();
                }
                if (providerName.Equals("Tvdb", StringComparison.OrdinalIgnoreCase) &&
                    (kvp.Key.Equals("TheTVDB", StringComparison.OrdinalIgnoreCase) ||
                     kvp.Key.Equals("TheTvdb", StringComparison.OrdinalIgnoreCase)))
                {
                    if (!string.IsNullOrWhiteSpace(kvp.Value)) return kvp.Value.Trim();
                }
            }
            return null;
        }

        private static string NormalizeImdbId(string? imdbId)
        {
            if (string.IsNullOrWhiteSpace(imdbId)) return string.Empty;
            var trimmed = imdbId.Trim().ToLowerInvariant();
            if (trimmed.StartsWith("tt")) return trimmed;
            return "tt" + trimmed;
        }

        private static string BuildCleanFileKey(string? filePath)
        {
            if (string.IsNullOrWhiteSpace(filePath)) return string.Empty;
            try
            {
                var name = Path.GetFileNameWithoutExtension(filePath);
                if (string.IsNullOrWhiteSpace(name))
                {
                    name = Path.GetFileName(filePath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                }
                if (string.IsNullOrWhiteSpace(name)) return string.Empty;
                var normalized = name
                    .Replace("³", "3")
                    .Replace("²", "2")
                    .Replace("¹", "1")
                    .Replace("&", "and");
                return Regex.Replace(normalized.ToLowerInvariant(), @"[^a-z0-9]", "");
            }
            catch
            {
                return string.Empty;
            }
        }

        private static string BuildTitleYearKey(string? title, int? year)
        {
            if (string.IsNullOrWhiteSpace(title)) return string.Empty;
            var normalized = title
                .Replace("³", "3")
                .Replace("²", "2")
                .Replace("¹", "1")
                .Replace("Ⅳ", "4")
                .Replace("Ⅲ", "3")
                .Replace("Ⅱ", "2")
                .Replace("Ⅰ", "1")
                .Replace("&", "and")
                .Replace("+", "and");
            var cleanTitle = Regex.Replace(normalized.ToLowerInvariant(), @"[^a-z0-9]", "");
            return $"{cleanTitle}_{year ?? 0}";
        }

        private static void AddToMap(Dictionary<string, List<BaseItem>> map, string? key, BaseItem item)
        {
            if (string.IsNullOrEmpty(key)) return;
            if (!map.TryGetValue(key, out var list))
            {
                list = new List<BaseItem>();
                map[key] = list;
            }
            list.Add(item);
        }

        private string GetItemLibraryName(BaseItem item)
        {
            try
            {
                var collectionFolders = _libraryManager.GetCollectionFolders(item);
                if (collectionFolders?.Length > 0 && !string.IsNullOrWhiteSpace(collectionFolders[0].Name))
                {
                    return collectionFolders[0].Name;
                }
            }
            catch { }

            return item.Path ?? string.Empty;
        }

        private BaseItem DisambiguateCandidate(List<BaseItem> candidates, string sectionTitle, bool is4KSection)
        {
            if (candidates.Count == 1) return candidates[0];

            // 1. Exact library name match
            var exact = candidates.FirstOrDefault(c => string.Equals(GetItemLibraryName(c), sectionTitle, StringComparison.OrdinalIgnoreCase));
            if (exact != null) return exact;

            // 2. Partial match on library name or path
            var partial = candidates.FirstOrDefault(c =>
            {
                var lib = GetItemLibraryName(c);
                return lib.IndexOf(sectionTitle, StringComparison.OrdinalIgnoreCase) >= 0 ||
                       (!string.IsNullOrEmpty(c.Path) && c.Path.IndexOf(sectionTitle, StringComparison.OrdinalIgnoreCase) >= 0);
            });
            if (partial != null) return partial;

            // 3. Resolution match: If section is 4K, prefer candidate whose library or path is 4K
            if (is4KSection)
            {
                var match4k = candidates.FirstOrDefault(c => Is4KLibrary(GetItemLibraryName(c)) || Is4KLibrary(c.Path));
                if (match4k != null) return match4k;
            }
            else
            {
                var matchNon4k = candidates.FirstOrDefault(c => !Is4KLibrary(GetItemLibraryName(c)) && !Is4KLibrary(c.Path));
                if (matchNon4k != null) return matchNon4k;
            }

            return candidates[0];
        }

        private static bool Is4KLibrary(string? sectionTitle)
        {
            if (string.IsNullOrWhiteSpace(sectionTitle)) return false;
            var lower = sectionTitle.ToLowerInvariant();
            return lower.Contains("4k") || lower.Contains("uhd") || lower.Contains("2160p") || lower.Contains("ultra hd");
        }

        private record PlexSection(string Key, string Type, string Title);
        private record PlexMovieItem(string RatingKey, string Title, string? OriginalTitle, int? Year, string? Thumb, string? Art, string? TmdbId, string? ImdbId, string? TvdbId, string? FileName);
        private record PlexShowItem(string RatingKey, string Title, string? OriginalTitle, int? Year, string? Thumb, string? Art, string? TmdbId, string? ImdbId, string? TvdbId, string? FileName);
        private record PlexSeasonItem(string RatingKey, string ParentRatingKey, int? Index, string? Thumb);
        private record PlexEpisodeItem(string RatingKey, string? GrandparentRatingKey, string? ParentRatingKey, int? ParentIndex, int? Index, string? Thumb);
    }
}
