using System;
using System.IO;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
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
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Posterizarr.Plugin.Configuration;
using Posterizarr.Plugin.Tasks;

using System.Text.Json.Serialization;

namespace Posterizarr.Plugin.Services;

/// <summary>
/// Strongly typed payload received from Posterizarr WebSocket event stream.
/// Supports both snake_case and camelCase property names.
/// </summary>
public class AssetEventPayload
{
    [JsonPropertyName("event")]
    public string? Event { get; set; }

    [JsonPropertyName("library_name")]
    public string? LibraryName { get; set; }

    [JsonPropertyName("folder_name")]
    public string? FolderName { get; set; }

    [JsonPropertyName("asset_type")]
    public string? AssetType { get; set; }

    [JsonPropertyName("season_number")]
    public object? SeasonNumber { get; set; }

    [JsonPropertyName("episode_number")]
    public object? EpisodeNumber { get; set; }

    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("relative_path")]
    public string? RelativePath { get; set; }

    [JsonPropertyName("timestamp")]
    public string? Timestamp { get; set; }

    // Fallback setters for camelCase / PascalCase
    [JsonPropertyName("libraryName")]
    public string? LibraryNameCamel { set { if (string.IsNullOrEmpty(LibraryName)) LibraryName = value; } }

    [JsonPropertyName("folderName")]
    public string? FolderNameCamel { set { if (string.IsNullOrEmpty(FolderName)) FolderName = value; } }

    [JsonPropertyName("assetType")]
    public string? AssetTypeCamel { set { if (string.IsNullOrEmpty(AssetType)) AssetType = value; } }

    [JsonPropertyName("seasonNumber")]
    public object? SeasonNumberCamel { set { if (SeasonNumber == null) SeasonNumber = value; } }

    [JsonPropertyName("episodeNumber")]
    public object? EpisodeNumberCamel { set { if (EpisodeNumber == null) EpisodeNumber = value; } }

    [JsonPropertyName("relativePath")]
    public string? RelativePathCamel { set { if (string.IsNullOrEmpty(RelativePath)) RelativePath = value; } }

    public int? GetSeasonNumber()
    {
        if (SeasonNumber == null) return null;
        if (int.TryParse(SeasonNumber.ToString(), out int s)) return s;
        return null;
    }

    public int? GetEpisodeNumber()
    {
        if (EpisodeNumber == null) return null;
        if (int.TryParse(EpisodeNumber.ToString(), out int e)) return e;
        return null;
    }
}

/// <summary>
/// Background service that connects to Posterizarr's real-time WebSocket API.
/// Listens for asset modification events and immediately refreshes affected Jellyfin media items.
/// </summary>
public class PosterizarrWebSocketListener : IHostedService, IDisposable
{
    private readonly ILibraryManager _libraryManager;
    private readonly IProviderManager _providerManager;
    private readonly ILogger<PosterizarrWebSocketListener> _logger;
    private readonly ILoggerFactory _loggerFactory;

    private CancellationTokenSource? _cts;
    private Task? _listenerTask;
    private bool _disposed;

    // Security: Maximum allowable WebSocket message size (64 KB) to avoid memory exhaustion (CWE-400)
    private const int MaxMessageSize = 65536;

    public PosterizarrWebSocketListener(
        ILibraryManager libraryManager,
        IProviderManager providerManager,
        ILogger<PosterizarrWebSocketListener> logger,
        ILoggerFactory loggerFactory)
    {
        _libraryManager = libraryManager;
        _providerManager = providerManager;
        _logger = logger;
        _loggerFactory = loggerFactory;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _cts = new CancellationTokenSource();
        _listenerTask = Task.Run(() => ConnectionLoopAsync(_cts.Token), CancellationToken.None);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_cts != null)
        {
            _cts.Cancel();
        }

        if (_listenerTask != null)
        {
            try
            {
                await Task.WhenAny(_listenerTask, Task.Delay(3000, cancellationToken)).ConfigureAwait(false);
            }
            catch
            {
                // Ignore shutdown timeouts
            }
        }
    }

    private void LogDebug(string message, params object[] args)
    {
        if (Plugin.Instance?.Configuration?.EnableDebugMode == true)
        {
            _logger.LogInformation("[Posterizarr WS DEBUG] " + message, args);
        }
    }

    private bool _hasLoggedMissingEndpoint = false;
    private bool _hasLoggedConnectionRefused = false;
    private bool _hasLoggedMissingApiKey = false;

    private async Task ConnectionLoopAsync(CancellationToken ct)
    {
        int retryDelaySeconds = 5;

        while (!ct.IsCancellationRequested)
        {
            var config = Plugin.Instance?.Configuration;
            if (config == null || !config.EnableRealtimeSync || string.IsNullOrWhiteSpace(config.PosterizarrApiUrl) || string.IsNullOrWhiteSpace(config.PosterizarrApiKey))
            {
                if (config != null && config.EnableRealtimeSync && !string.IsNullOrWhiteSpace(config.PosterizarrApiUrl) && string.IsNullOrWhiteSpace(config.PosterizarrApiKey))
                {
                    if (!_hasLoggedMissingApiKey)
                    {
                        _logger.LogWarning("[Posterizarr WS] Real-time synchronization is enabled, but Posterizarr API Key is missing. An API key is required. Please set your API key in the plugin configuration.");
                        _hasLoggedMissingApiKey = true;
                    }
                }
                else
                {
                    _hasLoggedMissingApiKey = false;
                }

                // Feature is disabled or configuration incomplete; idle sleep and re-check periodically
                _hasLoggedMissingEndpoint = false;
                _hasLoggedConnectionRefused = false;
                retryDelaySeconds = 5;
                await Task.Delay(TimeSpan.FromSeconds(60), ct).ConfigureAwait(false);
                continue;
            }

            _hasLoggedMissingApiKey = false;

            Uri? wsUri = BuildWebSocketUri(config.PosterizarrApiUrl);
            if (wsUri == null)
            {
                _logger.LogWarning("[Posterizarr WS] Invalid PosterizarrApiUrl configured: '{0}'. Retrying in 60s.", config.PosterizarrApiUrl);
                await Task.Delay(TimeSpan.FromSeconds(60), ct).ConfigureAwait(false);
                continue;
            }

            using var client = new ClientWebSocket();

            // SECURITY: Transmit API Key strictly via HTTP Header (never in URL or query params)
            if (!string.IsNullOrWhiteSpace(config.PosterizarrApiKey))
            {
                client.Options.SetRequestHeader("X-API-Key", config.PosterizarrApiKey.Trim());
            }

            try
            {
                LogDebug("Connecting to Posterizarr WebSocket at {0}...", wsUri);
                using var connectCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                connectCts.CancelAfter(TimeSpan.FromSeconds(10));

                await client.ConnectAsync(wsUri, connectCts.Token).ConfigureAwait(false);
                _logger.LogInformation("[Posterizarr WS] Connected successfully to Posterizarr real-time event stream at {0}", wsUri);
                retryDelaySeconds = 5; // Reset backoff upon successful connection
                _hasLoggedMissingEndpoint = false;
                _hasLoggedConnectionRefused = false;

                await ReceiveLoopAsync(client, config, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (WebSocketException ex)
            {
                string msg = ex.Message ?? string.Empty;
                string innerMsg = ex.InnerException?.Message ?? string.Empty;

                bool is404 = msg.IndexOf("404", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            innerMsg.IndexOf("404", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            (ex.InnerException is HttpRequestException httpEx && httpEx.StatusCode == System.Net.HttpStatusCode.NotFound);

                bool isRefused = msg.IndexOf("refused", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                innerMsg.IndexOf("refused", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                ex.InnerException is System.Net.Sockets.SocketException;

                bool isUnauthorized = msg.IndexOf("401", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                      msg.IndexOf("403", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                      msg.IndexOf("1008", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                      innerMsg.IndexOf("401", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                      innerMsg.IndexOf("403", StringComparison.OrdinalIgnoreCase) >= 0;

                if (is404)
                {
                    if (!_hasLoggedMissingEndpoint)
                    {
                        _logger.LogWarning(
                            "[Posterizarr WS] Posterizarr server at '{0}' was reached, but does not support real-time WebSocket events (HTTP 404). " +
                            "This occurs if Posterizarr has not yet been updated to a build with WebSocket support (dev build). " +
                            "Scheduled library scans will continue working normally. Will re-check WebSocket availability in 10 minutes.",
                            wsUri);
                        _hasLoggedMissingEndpoint = true;
                    }
                    else
                    {
                        LogDebug("Posterizarr WebSocket endpoint at '{0}' is still returning HTTP 404. Retrying in 10 minutes...", wsUri);
                    }
                    retryDelaySeconds = 600; // 10 minutes backoff: avoid spamming server logs while Posterizarr is on an older build
                }
                else if (isRefused)
                {
                    if (!_hasLoggedConnectionRefused)
                    {
                        _logger.LogWarning(
                            "[Posterizarr WS] Unable to reach Posterizarr at '{0}' (Connection refused). Verify that Posterizarr is running and port 8000 is reachable. Reconnecting in {1}s...",
                            wsUri, retryDelaySeconds);
                        _hasLoggedConnectionRefused = true;
                    }
                    else
                    {
                        LogDebug("Posterizarr at '{0}' is still unreachable (Connection refused). Reconnecting in {1}s...", wsUri, retryDelaySeconds);
                    }
                    retryDelaySeconds = Math.Min(Math.Max(retryDelaySeconds * 2, 30), 300);
                }
                else if (isUnauthorized)
                {
                    _logger.LogWarning(
                        "[Posterizarr WS] Connection to Posterizarr at '{0}' rejected: Authentication failed. Please verify your API key in plugin settings. Retrying in 60s...",
                        wsUri);
                    retryDelaySeconds = 60;
                }
                else
                {
                    _logger.LogWarning("[Posterizarr WS] WebSocket connection error: {0}. Reconnecting in {1}s...", ex.Message, retryDelaySeconds);
                    retryDelaySeconds = Math.Min(retryDelaySeconds * 2, 60);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Posterizarr WS] Unexpected error in WebSocket listener. Reconnecting in {0}s...", retryDelaySeconds);
                retryDelaySeconds = Math.Min(retryDelaySeconds * 2, 60);
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(retryDelaySeconds), ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private Uri? BuildWebSocketUri(string rawUrl)
    {
        try
        {
            var trimmed = rawUrl.Trim();
            if (!trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
                !trimmed.StartsWith("ws://", StringComparison.OrdinalIgnoreCase) &&
                !trimmed.StartsWith("wss://", StringComparison.OrdinalIgnoreCase))
            {
                trimmed = "http://" + trimmed;
            }

            var builder = new UriBuilder(trimmed);
            if (builder.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase))
            {
                builder.Scheme = "wss";
            }
            else if (builder.Scheme.Equals("http", StringComparison.OrdinalIgnoreCase))
            {
                builder.Scheme = "ws";
            }

            // If no explicit port was specified in rawUrl, default to Posterizarr's default port 8000
            if (!System.Text.RegularExpressions.Regex.IsMatch(trimmed, @":\d+(?:/|$)"))
            {
                builder.Port = 8000;
            }

            builder.Path = builder.Path.TrimEnd('/') + "/ws/events";
            builder.Query = string.Empty; // STRICT SECURITY: Ensure no query parameters
            return builder.Uri;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Posterizarr WS] Error building WebSocket URI from '{0}'", rawUrl);
            return null;
        }
    }

    private async Task ReceiveLoopAsync(ClientWebSocket client, PluginConfiguration config, CancellationToken ct)
    {
        byte[] buffer = new byte[8192];
        using var ms = new MemoryStream();

        while (client.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            ms.SetLength(0);
            WebSocketReceiveResult result;

            do
            {
                result = await client.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _logger.LogInformation("[Posterizarr WS] Server sent close: {0}", result.CloseStatusDescription);
                    await client.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", ct).ConfigureAwait(false);
                    return;
                }

                if (ms.Length + result.Count > MaxMessageSize)
                {
                    _logger.LogWarning("[Posterizarr WS Security] Received oversized message (> {0} bytes). Discarding frame.", MaxMessageSize);
                    return;
                }

                ms.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            if (result.MessageType == WebSocketMessageType.Text)
            {
                string json = Encoding.UTF8.GetString(ms.ToArray());
                LogDebug("Received event payload: {0}", json);

                try
                {
                    var payload = JsonSerializer.Deserialize<AssetEventPayload>(json, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });

                    if (payload != null && string.Equals(payload.Event, "asset_updated", StringComparison.OrdinalIgnoreCase))
                    {
                        await HandleAssetUpdatedEventAsync(payload, config, ct).ConfigureAwait(false);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "[Posterizarr WS] Failed to parse event JSON: {0}", json);
                }
            }
        }
    }

    private async Task HandleAssetUpdatedEventAsync(AssetEventPayload payload, PluginConfiguration config, CancellationToken ct)
    {
        _logger.LogInformation("[Posterizarr WS] Received real-time update event: {0} for '{1}' (Folder: '{2}')",
            payload.AssetType ?? "poster", payload.Title ?? payload.FolderName, payload.FolderName);

        // =========================================================================
        // SECURITY: CWE-22 Path Traversal & Injection Defenses
        // =========================================================================
        if (string.IsNullOrWhiteSpace(config.AssetFolderPath))
        {
            _logger.LogWarning("[Posterizarr WS] Real-time event ignored: Root Asset Folder Path is not configured in Jellyfin plugin settings.");
            return;
        }

        if (string.IsNullOrWhiteSpace(payload.RelativePath) || string.IsNullOrWhiteSpace(payload.FolderName))
        {
            LogDebug("Skipping event with missing relative path or folder name.");
            return;
        }

        // 1. Reject path traversal sequences and invalid characters
        string rawRelative = payload.RelativePath.Trim();
        if (rawRelative.Contains("..") ||
            Path.IsPathRooted(rawRelative) ||
            rawRelative.IndexOfAny(Path.GetInvalidPathChars()) >= 0)
        {
            _logger.LogWarning("[Posterizarr Security] Blocked path traversal attempt in relative path: '{0}'", rawRelative);
            return;
        }

        // Normalize away redundant leading assets/ or manualassets/ prefix
        string relativeForTarget = rawRelative;
        if (relativeForTarget.StartsWith("assets/", StringComparison.OrdinalIgnoreCase) ||
            relativeForTarget.StartsWith("assets\\", StringComparison.OrdinalIgnoreCase))
        {
            relativeForTarget = relativeForTarget.Substring(7);
        }
        else if (relativeForTarget.StartsWith("manualassets/", StringComparison.OrdinalIgnoreCase) ||
                 relativeForTarget.StartsWith("manualassets\\", StringComparison.OrdinalIgnoreCase))
        {
            relativeForTarget = relativeForTarget.Substring(13);
        }

        // 2. Canonicalize path and ensure it strictly resides within AssetFolderPath root
        string normalizedRoot = Path.GetFullPath(config.AssetFolderPath)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;

        string fullTargetFile = Path.GetFullPath(Path.Combine(config.AssetFolderPath, relativeForTarget.Replace('/', Path.DirectorySeparatorChar)));

        if (!fullTargetFile.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning("[Posterizarr Security] Path traversal blocked! Target '{0}' escapes asset root '{1}'", fullTargetFile, normalizedRoot);
            return;
        }

        // 3. Verify file exists on disk (retry up to 5 times / 2s in case of minor flush delay)
        int retries = 0;
        while (!File.Exists(fullTargetFile) && retries < 5)
        {
            await Task.Delay(400, ct).ConfigureAwait(false);
            retries++;
        }

        if (!File.Exists(fullTargetFile))
        {
            _logger.LogWarning("[Posterizarr WS] Asset file does not exist on disk at '{0}'. Verify that Jellyfin's Root Asset Folder Path ('{1}') is correctly mounted to Posterizarr's asset directory.", fullTargetFile, config.AssetFolderPath);
            return;
        }

        var sourceFileInfo = new FileInfo(fullTargetFile);
        _logger.LogInformation("[Posterizarr WS] Processing real-time update for '{0}' (Type: {1}, Folder: '{2}')",
            payload.Title ?? payload.FolderName, payload.AssetType, payload.FolderName);

        // =========================================================================
        // Match affected item in Jellyfin Library
        // =========================================================================
        try
        {
            var query = new InternalItemsQuery
            {
                IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Series },
                Recursive = true,
                IsVirtualItem = false
            };

            var items = _libraryManager.GetItemList(query);
            var matchedItem = items.FirstOrDefault(i =>
                !string.IsNullOrEmpty(i.Path) &&
                (string.Equals(Path.GetFileName(i.Path), payload.FolderName, StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(Path.GetFileName(Path.GetDirectoryName(i.Path)), payload.FolderName, StringComparison.OrdinalIgnoreCase)));

            if (matchedItem == null)
            {
                _logger.LogInformation("[Posterizarr WS] No matching Movie or Series found in Jellyfin for folder '{0}'.", payload.FolderName);
                return;
            }

            BaseItem targetItem = matchedItem;
            var assetTypeLower = (payload.AssetType ?? "poster").ToLowerInvariant();
            ImageType imageType = ImageType.Primary;

            // Handle TV Show Seasons
            if (assetTypeLower.Contains("season") && targetItem is Series series)
            {
                int seasonNum = payload.GetSeasonNumber() ?? 0;
                var seasonQuery = new InternalItemsQuery
                {
                    ParentId = series.Id,
                    IncludeItemTypes = new[] { BaseItemKind.Season },
                    Recursive = false
                };

                var seasonItem = _libraryManager.GetItemList(seasonQuery)
                    .OfType<Season>()
                    .FirstOrDefault(s => (s.IndexNumber ?? 0) == seasonNum);

                if (seasonItem != null)
                {
                    targetItem = seasonItem;
                    imageType = ImageType.Primary;
                }
                else
                {
                    _logger.LogWarning("[Posterizarr WS] Could not find Season {0} for series '{1}'", seasonNum, series.Name);
                    return;
                }
            }
            // Handle TV Show Episode Title Cards
            else if ((assetTypeLower.Contains("titlecard") || assetTypeLower.Contains("episode")) && targetItem is Series showSeries)
            {
                int sNum = payload.GetSeasonNumber() ?? 1;
                int eNum = payload.GetEpisodeNumber() ?? 1;

                var epQuery = new InternalItemsQuery
                {
                    AncestorIds = new[] { showSeries.Id },
                    IncludeItemTypes = new[] { BaseItemKind.Episode },
                    Recursive = true
                };

                var epItem = _libraryManager.GetItemList(epQuery)
                    .OfType<Episode>()
                    .FirstOrDefault(e => (e.ParentIndexNumber ?? 0) == sNum && (e.IndexNumber ?? 0) == eNum);

                if (epItem != null)
                {
                    targetItem = epItem;
                    imageType = ImageType.Primary;
                }
                else
                {
                    _logger.LogWarning("[Posterizarr WS] Could not find Episode S{0:02}E{1:02} for series '{2}'", sNum, eNum, showSeries.Name);
                    return;
                }
            }
            // Handle Backdrops / Backgrounds
            else if (assetTypeLower.Contains("background") || assetTypeLower.Contains("backdrop"))
            {
                imageType = ImageType.Backdrop;
            }
            // Handle Thumbnails
            else if (assetTypeLower.Contains("thumbnail") || assetTypeLower.Contains("thumb"))
            {
                imageType = ImageType.Thumb;
            }

            // Determine mime type
            var ext = sourceFileInfo.Extension.ToLowerInvariant();
            string mimeType = ext switch
            {
                ".png" => "image/png",
                ".webp" => "image/webp",
                ".bmp" => "image/bmp",
                _ => "image/jpeg"
            };

            // Stream and save image directly to Jellyfin item
            using (var stream = new FileStream(sourceFileInfo.FullName, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.SequentialScan))
            {
                await _providerManager.SaveImage(targetItem, stream, mimeType, imageType, 0, ct).ConfigureAwait(false);
            }

            var parent = targetItem.ParentId != Guid.Empty ? _libraryManager.GetItemById(targetItem.ParentId) : null;
            await _libraryManager.UpdateItemAsync(targetItem, parent ?? targetItem, ItemUpdateType.ImageUpdate, ct).ConfigureAwait(false);

            // Update persistent cache so scheduled task skips this item
            var dataFolder = Plugin.Instance?.DataFolderPath ?? Path.Combine(AppContext.BaseDirectory, "data");
            var syncCache = new SyncCacheManager(dataFolder, _loggerFactory.CreateLogger<SyncCacheManager>());
            syncCache.Load();

            var updatedImage = targetItem.GetImageInfo(imageType, 0);
            if (updatedImage != null)
            {
                syncCache.Update(targetItem.Id, imageType, sourceFileInfo, updatedImage);
                syncCache.Save();
            }

            _logger.LogInformation("[Posterizarr WS] SUCCESS: Real-time image update applied to '{0}' ({1}) in Jellyfin!",
                targetItem.Name, imageType);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Posterizarr WS] Error applying real-time asset update for '{0}'", payload.FolderName);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts?.Cancel();
        _cts?.Dispose();
    }
}
