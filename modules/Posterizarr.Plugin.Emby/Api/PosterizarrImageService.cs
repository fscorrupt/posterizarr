using System;
using System.Collections.Generic;
using System.IO;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Services;

namespace Posterizarr.Plugin.Api
{
    [Route("/Posterizarr/Image", "GET")]
    [Unauthenticated]
    public class GetPosterizarrImage : IReturn<object>
    {
        public string Path { get; set; } = string.Empty;
    }

    public class PosterizarrImageService : IService, IRequiresRequest
    {
        public IRequest Request { get; set; } = null!;

        private static string ResolveLinks(string path, HashSet<string> resolvingLinks)
        {
            var fullPath = Path.GetFullPath(path);
            var pathRoot = Path.GetPathRoot(fullPath)!;
            var currentPath = pathRoot;
            var segments = fullPath.Substring(pathRoot.Length).Split(
                new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar },
                StringSplitOptions.RemoveEmptyEntries);

            foreach (var segment in segments)
            {
                var candidate = Path.Combine(currentPath, segment);
                FileSystemInfo info = Directory.Exists(candidate)
                    ? new DirectoryInfo(candidate)
                    : new FileInfo(candidate);
                var target = info.ResolveLinkTarget(false);
                if (target == null)
                {
                    currentPath = candidate;
                    continue;
                }

                var linkPath = Path.GetFullPath(candidate);
                if (!resolvingLinks.Add(linkPath))
                {
                    throw new IOException("A symbolic link cycle was detected.");
                }

                try
                {
                    var targetPath = target.FullName;
                    if (!Path.IsPathRooted(targetPath))
                    {
                        targetPath = Path.Combine(Path.GetDirectoryName(linkPath)!, targetPath);
                    }
                    currentPath = ResolveLinks(targetPath, resolvingLinks);
                }
                finally
                {
                    resolvingLinks.Remove(linkPath);
                }
            }

            return Path.GetFullPath(currentPath);
        }

        private static bool TryResolveSafeAssetPath(string assetFolder, string path, out string resolvedPath)
        {
            resolvedPath = string.Empty;
            try
            {
                var comparison = Path.DirectorySeparatorChar == '\\'
                    ? StringComparison.OrdinalIgnoreCase
                    : StringComparison.Ordinal;
                var linkComparer = Path.DirectorySeparatorChar == '\\'
                    ? StringComparer.OrdinalIgnoreCase
                    : StringComparer.Ordinal;
                var resolvedRoot = ResolveLinks(assetFolder, new HashSet<string>(linkComparer));
                var candidate = ResolveLinks(path, new HashSet<string>(linkComparer));
                var rootPrefix = Path.EndsInDirectorySeparator(resolvedRoot)
                    ? resolvedRoot
                    : resolvedRoot + Path.DirectorySeparatorChar;

                if (!candidate.StartsWith(rootPrefix, comparison) || !File.Exists(candidate))
                {
                    return false;
                }

                resolvedPath = candidate;
                return true;
            }
            catch (Exception ex) when (ex is ArgumentException or IOException or UnauthorizedAccessException or NotSupportedException)
            {
                return false;
            }
        }

        public object Get(GetPosterizarrImage request)
        {
            var response = Request.Response;
            var assetFolder = Plugin.Instance?.Configuration?.AssetFolderPath ?? string.Empty;
            var path = request.Path;

            if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(assetFolder))
            {
                response.StatusCode = 400;
                return null!;
            }

            string normalizedPath;
            try
            {
                normalizedPath = Path.GetFullPath(path);
            }
            catch (Exception ex) when (ex is ArgumentException or IOException or NotSupportedException)
            {
                response.StatusCode = 404;
                return null!;
            }

            if (!TryResolveSafeAssetPath(assetFolder, normalizedPath, out var resolvedPath))
            {
                response.StatusCode = 404;
                return null!;
            }

            var ext = Path.GetExtension(normalizedPath).ToLowerInvariant();
            response.ContentType = ext switch
            {
                ".png" => "image/png",
                ".webp" => "image/webp",
                ".bmp" => "image/bmp",
                _ => "image/jpeg"
            };

            return new FileStream(resolvedPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, true);
        }
    }
}
