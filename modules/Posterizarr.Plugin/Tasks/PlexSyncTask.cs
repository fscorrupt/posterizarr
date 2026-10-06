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
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Querying;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;
using Posterizarr.Plugin.Configuration;

namespace Posterizarr.Plugin.Tasks;

public class PlexSyncTask : IScheduledTask
{
    private readonly ILibraryManager _libraryManager;
    private readonly IProviderManager _providerManager;
    private readonly ILogger<PlexSyncTask> _logger;
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
        IProviderManager providerManager,
        ILogger<PlexSyncTask> logger)
    {
        _libraryManager = libraryManager;
        _providerManager = providerManager;
        _logger = logger;
    }

    public string Name => "Sync Artwork from Plex";
    public string Key => "PosterizarrPlexSyncTask";
    public string Description => "Directly mirrors active artwork (including Kometa overlays) from a Plex server to Jellyfin using Plex bulk queries.";
    public string Category => "Posterizarr";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        return new[]
        {
            new TaskTriggerInfo
            {
                Type = TaskTriggerInfoType.DailyTrigger,
                TimeOfDayTicks = TimeSpan.FromHours(3).Ticks
            }
        };
    }

    private void LogDebug(string message, params object?[] args)
    {
        if (Plugin.Instance?.Configuration?.EnableDebugMode == true)
        {
            _logger.LogInformation("[Posterizarr PlexSync DEBUG] " + message, args);
        }
    }

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        var config = Plugin.Instance?.Configuration;
        if (config == null || !config.EnablePlexSync)
        {
            LogDebug("Plex Direct Sync is disabled. Skipping task.");
            return;
        }

        if (string.IsNullOrWhiteSpace(config.PlexServerUrl) || string.IsNullOrWhiteSpace(config.PlexToken))
        {
            _logger.LogWarning("[Posterizarr PlexSync] Plex Server URL or Token is missing. Aborting sync.");
            return;
        }

        var plexBaseUrl = config.PlexServerUrl.Trim().TrimEnd('/');
        var plexToken = config.PlexToken.Trim();

        var dataFolder = Plugin.Instance?.DataFolderPath ?? Path.Combine(AppContext.BaseDirectory, "data");
        var plexCache = new PlexSyncCacheManager(dataFolder, _logger);
        plexCache.Load();

        _logger.LogInformation("[Posterizarr PlexSync] Starting direct Plex artwork sync from '{0}'...", plexBaseUrl);
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
                _logger.LogWarning("[Posterizarr PlexSync] No supported libraries found in Plex.");
                return;
            }

            // Optional library filter
            var allowedLibraries = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (!string.IsNullOrWhiteSpace(config.PlexLibrariesToInclude))
            {
                foreach (var lib in config.PlexLibrariesToInclude.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    allowedLibraries.Add(lib);
                }
            }

            // 2. Query all Jellyfin Items into Memory
            _logger.LogInformation("[Posterizarr PlexSync] Indexing Jellyfin libraries in memory...");
            var jfItemsQuery = new InternalItemsQuery
            {
                IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Series, BaseItemKind.Season },
                Recursive = true,
                IsVirtualItem = false
            };
            var jfItems = _libraryManager.GetItemList(jfItemsQuery);

            var moviesByTmdb = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);
            var moviesByImdb = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);
            var moviesByTvdb = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);
            var moviesByTitleYear = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);

            var seriesByTvdb = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);
            var seriesByTmdb = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);
            var seriesByImdb = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);
            var seriesByTitleYear = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);

            var seasonsBySeriesAndIndex = new Dictionary<string, Season>(StringComparer.OrdinalIgnoreCase);

            foreach (var item in jfItems)
            {
                if (item is Movie movie)
                {
                    var tmdb = GetProviderId(movie, "Tmdb");
                    if (tmdb != null) moviesByTmdb[tmdb] = movie;

                    var imdb = GetProviderId(movie, "Imdb");
                    if (imdb != null) moviesByImdb[imdb] = movie;

                    var tvdb = GetProviderId(movie, "Tvdb");
                    if (tvdb != null) moviesByTvdb[tvdb] = movie;

                    var titleYearKey = BuildTitleYearKey(movie.Name, movie.ProductionYear);
                    if (!string.IsNullOrEmpty(titleYearKey)) moviesByTitleYear[titleYearKey] = movie;
                }
                else if (item is Series series)
                {
                    var tvdb = GetProviderId(series, "Tvdb");
                    if (tvdb != null) seriesByTvdb[tvdb] = series;

                    var tmdb = GetProviderId(series, "Tmdb");
                    if (tmdb != null) seriesByTmdb[tmdb] = series;

                    var imdb = GetProviderId(series, "Imdb");
                    if (imdb != null) seriesByImdb[imdb] = series;

                    var titleYearKey = BuildTitleYearKey(series.Name, series.ProductionYear);
                    if (!string.IsNullOrEmpty(titleYearKey)) seriesByTitleYear[titleYearKey] = series;
                }
                else if (item is Season season && season.IndexNumber.HasValue)
                {
                    var key = $"{season.SeriesId:N}_{season.IndexNumber.Value}";
                    seasonsBySeriesAndIndex[key] = season;
                }
            }

            _logger.LogInformation("[Posterizarr PlexSync] Indexed {0} movies, {1} series, and {2} seasons in Jellyfin.",
                moviesByTmdb.Count + moviesByTitleYear.Count, seriesByTvdb.Count + seriesByTitleYear.Count, seasonsBySeriesAndIndex.Count);

            double currentSectionIndex = 0;

            // 3. Process Each Plex Library Section
            foreach (var section in sections)
            {
                cancellationToken.ThrowIfCancellationRequested();
                currentSectionIndex++;
                progress.Report(currentSectionIndex / sections.Count * 90);

                if (allowedLibraries.Count > 0 && !allowedLibraries.Contains(section.Title))
                {
                    LogDebug("Skipping library '{0}' (not in PlexLibrariesToInclude).", section.Title);
                    continue;
                }

                if (section.Type.Equals("movie", StringComparison.OrdinalIgnoreCase))
                {
                    if (!config.PlexSyncMovies && !config.PlexSyncBackdrops) continue;

                    _logger.LogInformation("[Posterizarr PlexSync] Bulk fetching movies from Plex library '{0}'...", section.Title);
                    var plexMovies = await FetchPlexMoviesAsync(plexBaseUrl, plexToken, section.Key, cancellationToken).ConfigureAwait(false);
                    totalPlexItems += plexMovies.Count;

                    foreach (var pMovie in plexMovies)
                    {
                        cancellationToken.ThrowIfCancellationRequested();

                        BaseItem? matchedJfMovie = null;
                        if (pMovie.TmdbId != null && moviesByTmdb.TryGetValue(pMovie.TmdbId, out matchedJfMovie)) { }
                        else if (pMovie.ImdbId != null && moviesByImdb.TryGetValue(pMovie.ImdbId, out matchedJfMovie)) { }
                        else if (pMovie.TvdbId != null && moviesByTvdb.TryGetValue(pMovie.TvdbId, out matchedJfMovie)) { }
                        else if (!string.IsNullOrEmpty(pMovie.Title))
                        {
                            var key = BuildTitleYearKey(pMovie.Title, pMovie.Year);
                            moviesByTitleYear.TryGetValue(key, out matchedJfMovie);
                        }

                        if (matchedJfMovie == null)
                        {
                            unmatchedCount++;
                            LogDebug("Unmatched movie in Jellyfin: '{0}' ({1}) [TMDB: {2}, IMDB: {3}]",
                                pMovie.Title, pMovie.Year, pMovie.TmdbId, pMovie.ImdbId);
                            continue;
                        }

                        // Sync Poster
                        if (config.PlexSyncMovies && !string.IsNullOrEmpty(pMovie.Thumb))
                        {
                            bool updated = await SyncItemArtworkAsync(
                                matchedJfMovie, ImageType.Primary, pMovie.Thumb, plexBaseUrl, plexToken,
                                plexCache, cancellationToken).ConfigureAwait(false);

                            if (updated) updatedCount++;
                            else cacheHits++;
                        }

                        // Sync Backdrop
                        if (config.PlexSyncBackdrops && !string.IsNullOrEmpty(pMovie.Art))
                        {
                            bool updated = await SyncItemArtworkAsync(
                                matchedJfMovie, ImageType.Backdrop, pMovie.Art, plexBaseUrl, plexToken,
                                plexCache, cancellationToken).ConfigureAwait(false);

                            if (updated) updatedCount++;
                            else cacheHits++;
                        }
                    }
                }
                else if (section.Type.Equals("show", StringComparison.OrdinalIgnoreCase))
                {
                    if (!config.PlexSyncShows && !config.PlexSyncSeasons && !config.PlexSyncBackdrops) continue;

                    _logger.LogInformation("[Posterizarr PlexSync] Bulk fetching shows from Plex library '{0}'...", section.Title);
                    var plexShows = await FetchPlexShowsAsync(plexBaseUrl, plexToken, section.Key, cancellationToken).ConfigureAwait(false);
                    totalPlexItems += plexShows.Count;

                    var plexRatingKeyToJfSeries = new Dictionary<string, BaseItem>(StringComparer.OrdinalIgnoreCase);

                    foreach (var pShow in plexShows)
                    {
                        cancellationToken.ThrowIfCancellationRequested();

                        BaseItem? matchedJfSeries = null;
                        if (pShow.TvdbId != null && seriesByTvdb.TryGetValue(pShow.TvdbId, out matchedJfSeries)) { }
                        else if (pShow.TmdbId != null && seriesByTmdb.TryGetValue(pShow.TmdbId, out matchedJfSeries)) { }
                        else if (pShow.ImdbId != null && seriesByImdb.TryGetValue(pShow.ImdbId, out matchedJfSeries)) { }
                        else if (!string.IsNullOrEmpty(pShow.Title))
                        {
                            var key = BuildTitleYearKey(pShow.Title, pShow.Year);
                            seriesByTitleYear.TryGetValue(key, out matchedJfSeries);
                        }

                        if (matchedJfSeries == null)
                        {
                            unmatchedCount++;
                            LogDebug("Unmatched show in Jellyfin: '{0}' ({1}) [TVDB: {2}, TMDB: {3}]",
                                pShow.Title, pShow.Year, pShow.TvdbId, pShow.TmdbId);
                            continue;
                        }

                        plexRatingKeyToJfSeries[pShow.RatingKey] = matchedJfSeries;

                        // Sync Series Poster
                        if (config.PlexSyncShows && !string.IsNullOrEmpty(pShow.Thumb))
                        {
                            bool updated = await SyncItemArtworkAsync(
                                matchedJfSeries, ImageType.Primary, pShow.Thumb, plexBaseUrl, plexToken,
                                plexCache, cancellationToken).ConfigureAwait(false);

                            if (updated) updatedCount++;
                            else cacheHits++;
                        }

                        // Sync Series Backdrop
                        if (config.PlexSyncBackdrops && !string.IsNullOrEmpty(pShow.Art))
                        {
                            bool updated = await SyncItemArtworkAsync(
                                matchedJfSeries, ImageType.Backdrop, pShow.Art, plexBaseUrl, plexToken,
                                plexCache, cancellationToken).ConfigureAwait(false);

                            if (updated) updatedCount++;
                            else cacheHits++;
                        }
                    }

                    // Sync Seasons if enabled
                    if (config.PlexSyncSeasons)
                    {
                        _logger.LogInformation("[Posterizarr PlexSync] Bulk fetching all seasons from Plex library '{0}'...", section.Title);
                        var plexSeasons = await FetchPlexSeasonsAsync(plexBaseUrl, plexToken, section.Key, cancellationToken).ConfigureAwait(false);
                        totalPlexItems += plexSeasons.Count;

                        foreach (var pSeason in plexSeasons)
                        {
                            cancellationToken.ThrowIfCancellationRequested();

                            if (string.IsNullOrEmpty(pSeason.ParentRatingKey) || !pSeason.Index.HasValue) continue;
                            if (!plexRatingKeyToJfSeries.TryGetValue(pSeason.ParentRatingKey, out var jfSeries)) continue;

                            var seasonKey = $"{jfSeries.Id:N}_{pSeason.Index.Value}";
                            if (!seasonsBySeriesAndIndex.TryGetValue(seasonKey, out var jfSeason))
                            {
                                continue;
                            }

                            if (!string.IsNullOrEmpty(pSeason.Thumb))
                            {
                                bool updated = await SyncItemArtworkAsync(
                                    jfSeason, ImageType.Primary, pSeason.Thumb, plexBaseUrl, plexToken,
                                    plexCache, cancellationToken).ConfigureAwait(false);

                                if (updated) updatedCount++;
                                else cacheHits++;
                            }
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
        _logger.LogInformation(
            "[Posterizarr PlexSync] Sync completed in {0:mm\\:ss\\.fff}. Total Plex items: {1}, Cache hits: {2}, Updated: {3}, Unmatched: {4}.",
            stopwatch.Elapsed, totalPlexItems, cacheHits, updatedCount, unmatchedCount);
    }

    private async Task<bool> SyncItemArtworkAsync(
        BaseItem item,
        ImageType imageType,
        string plexArtworkPath,
        string plexBaseUrl,
        string plexToken,
        PlexSyncCacheManager cache,
        CancellationToken ct)
    {
        var existingImage = item.GetImageInfo(imageType, 0);

        // Fast path: if existing image is present and Plex thumb has not changed in cache, skip!
        if (existingImage != null && cache.IsMatch(item.Id, imageType, plexArtworkPath))
        {
            return false;
        }

        // Modified or new: Stream image from Plex
        var imageUrl = $"{plexBaseUrl}{plexArtworkPath}?X-Plex-Token={plexToken}";
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, imageUrl);
            using var resp = await _httpClient.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);

            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("[Posterizarr PlexSync] Failed to download image for '{0}' ({1}): HTTP {2}",
                    item.Name, imageType, resp.StatusCode);
                return false;
            }

            var mimeType = resp.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
            await using var stream = await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);

            await _providerManager.SaveImage(item, stream, mimeType, imageType, 0, ct).ConfigureAwait(false);

            var parent = item.ParentId != Guid.Empty ? _libraryManager.GetItemById(item.ParentId) : null;
            await _libraryManager.UpdateItemAsync(item, parent ?? item, ItemUpdateType.ImageUpdate, ct).ConfigureAwait(false);

            cache.Update(item.Id, imageType, plexArtworkPath);
            LogDebug("Updated {0} for '{1}' from Plex thumb '{2}'", imageType, item.Name, plexArtworkPath);
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Posterizarr PlexSync] Error applying image for '{0}' ({1})", item.Name, imageType);
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
                int? year = elem.TryGetProperty("year", out var y) && y.TryGetInt32(out var yi) ? yi : null;
                var thumb = elem.TryGetProperty("thumb", out var th) ? th.GetString() : null;
                var art = elem.TryGetProperty("art", out var a) ? a.GetString() : null;

                if (string.IsNullOrEmpty(ratingKey) || string.IsNullOrEmpty(title)) continue;

                var (tmdb, imdb, tvdb) = ExtractProviderIds(elem);
                list.Add(new PlexMovieItem(ratingKey, title, year, thumb, art, tmdb, imdb, tvdb));
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
                int? year = elem.TryGetProperty("year", out var y) && y.TryGetInt32(out var yi) ? yi : null;
                var thumb = elem.TryGetProperty("thumb", out var th) ? th.GetString() : null;
                var art = elem.TryGetProperty("art", out var a) ? a.GetString() : null;

                if (string.IsNullOrEmpty(ratingKey) || string.IsNullOrEmpty(title)) continue;

                var (tmdb, imdb, tvdb) = ExtractProviderIds(elem);
                list.Add(new PlexShowItem(ratingKey, title, year, thumb, art, tmdb, imdb, tvdb));
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
                imdb ??= val.Substring(7);
            else if (val.StartsWith("tmdb://", StringComparison.OrdinalIgnoreCase))
                tmdb ??= val.Substring(7);
            else if (val.StartsWith("tvdb://", StringComparison.OrdinalIgnoreCase))
                tvdb ??= val.Substring(7);
            else if (val.Contains("agents.imdb://", StringComparison.OrdinalIgnoreCase))
            {
                var match = Regex.Match(val, @"agents\.imdb://(tt\d+)", RegexOptions.IgnoreCase);
                if (match.Success) imdb ??= match.Groups[1].Value;
            }
            else if (val.Contains("agents.themoviedb://", StringComparison.OrdinalIgnoreCase))
            {
                var match = Regex.Match(val, @"agents\.themoviedb://(\d+)", RegexOptions.IgnoreCase);
                if (match.Success) tmdb ??= match.Groups[1].Value;
            }
            else if (val.Contains("agents.thetvdb://", StringComparison.OrdinalIgnoreCase))
            {
                var match = Regex.Match(val, @"agents\.thetvdb://(\d+)", RegexOptions.IgnoreCase);
                if (match.Success) tvdb ??= match.Groups[1].Value;
            }
        }

        if (elem.TryGetProperty("Guid", out var guidElem))
        {
            if (guidElem.ValueKind == JsonValueKind.Array)
            {
                foreach (var g in guidElem.EnumerateArray())
                {
                    if (g.TryGetProperty("id", out var idProp))
                        ProcessId(idProp.GetString());
                }
            }
            else if (guidElem.ValueKind == JsonValueKind.Object)
            {
                if (guidElem.TryGetProperty("id", out var idProp))
                    ProcessId(idProp.GetString());
            }
        }

        if (elem.TryGetProperty("guid", out var singleGuidProp))
        {
            ProcessId(singleGuidProp.GetString());
        }

        return (tmdb, imdb, tvdb);
    }

    private static string? GetProviderId(BaseItem item, string providerName)
    {
        if (item.ProviderIds == null) return null;
        if (item.ProviderIds.TryGetValue(providerName, out var id) && !string.IsNullOrWhiteSpace(id))
            return id.Trim();
        if (item.ProviderIds.TryGetValue(providerName.ToLowerInvariant(), out var idLower) && !string.IsNullOrWhiteSpace(idLower))
            return idLower.Trim();
        return null;
    }

    private static string BuildTitleYearKey(string? title, int? year)
    {
        if (string.IsNullOrWhiteSpace(title)) return string.Empty;
        var cleanTitle = Regex.Replace(title.ToLowerInvariant(), @"[^a-z0-9]", "");
        return $"{cleanTitle}_{year ?? 0}";
    }

    private record PlexSection(string Key, string Type, string Title);
    private record PlexMovieItem(string RatingKey, string Title, int? Year, string? Thumb, string? Art, string? TmdbId, string? ImdbId, string? TvdbId);
    private record PlexShowItem(string RatingKey, string Title, int? Year, string? Thumb, string? Art, string? TmdbId, string? ImdbId, string? TvdbId);
    private record PlexSeasonItem(string RatingKey, string ParentRatingKey, int? Index, string? Thumb);
}
