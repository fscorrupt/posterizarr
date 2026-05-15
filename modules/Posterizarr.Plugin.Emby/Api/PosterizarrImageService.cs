using System;
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

            var normalizedPath = System.IO.Path.GetFullPath(path);
            var normalizedAssetFolder = System.IO.Path.GetFullPath(assetFolder)
                .TrimEnd(System.IO.Path.DirectorySeparatorChar) + System.IO.Path.DirectorySeparatorChar;

            if (!normalizedPath.StartsWith(normalizedAssetFolder, StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(normalizedPath))
            {
                response.StatusCode = 404;
                return null!;
            }

            var ext = System.IO.Path.GetExtension(normalizedPath).ToLowerInvariant();
            response.ContentType = ext switch
            {
                ".png" => "image/png",
                ".webp" => "image/webp",
                ".bmp" => "image/bmp",
                _ => "image/jpeg"
            };

            return new FileStream(normalizedPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, true);
        }
    }
}
