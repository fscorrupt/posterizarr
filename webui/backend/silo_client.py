"""Native Silo API v2 transport. Artwork writes are never retried automatically."""

from pathlib import PurePosixPath
from urllib.parse import quote, urljoin, urlsplit

import httpx


class SiloError(RuntimeError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class SiloClient:
    def __init__(self, client, url, api_key, profile_id=None):
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise SiloError("Silo requires an HTTP(S) server URL without credentials, query or fragment")
        self.client = client
        self.url = url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {api_key}"}
        self.profile_id = profile_id

    async def request(self, method, path, **kwargs):
        headers = dict(self.headers)
        headers.update(kwargs.pop("headers", {}))
        try:
            response = await self.client.request(
                method, self.url + "/api/v2" + path, headers=headers,
                follow_redirects=False, **kwargs
            )
        except httpx.HTTPError:
            raise SiloError("Silo request failed; writes with an uncertain outcome must not be replayed automatically") from None
        if not response.is_success:
            raise SiloError(f"Silo API returned HTTP {response.status_code}", status=response.status_code)
        try:
            return response.json()
        except ValueError:
            raise SiloError("Silo returned an invalid JSON response") from None

    async def collection(self, path, params=None, headers=None):
        query = dict(params or {})
        result = []
        cursors = set()
        while True:
            body = await self.request("GET", path, params=query, headers=headers or {})
            if not isinstance(body, dict) or not isinstance(body.get("items"), list):
                raise SiloError("Silo returned an invalid collection")
            result.extend(body["items"])
            page = body.get("page") or {}
            if not page.get("has_more"):
                return result
            cursor = page.get("next_cursor")
            if not isinstance(cursor, str) or not cursor or cursor in cursors:
                raise SiloError("Silo returned an invalid continuation cursor")
            cursors.add(cursor)
            query["cursor"] = cursor

    async def info(self):
        info = await self.request("GET", "/system/info")
        if info.get("api_major") != 2:
            raise SiloError("Silo API v2 is required")
        return info

    async def libraries(self):
        rows = await self.collection("/user/libraries")
        return [
            {"id": str(row["id"]), "key": str(row["id"]), "name": row["name"],
             "type": "movie" if row["type"] == "movies" else "show"}
            for row in rows if row.get("type") in ("movies", "series")
        ]

    async def catalog(self, library_id=None, media_type=None, item_id=None):
        params = {"limit": 200}
        if library_id is not None:
            params["library_id"] = str(library_id)
        if media_type:
            params["type"] = "series" if media_type == "show" else media_type
        if item_id:
            params["content_ids"] = str(item_id)
        return await self.collection("/admin/catalog/items", params)

    async def profile_headers(self):
        if not self.profile_id:
            profiles = await self.collection("/profiles")
            primary = [profile for profile in profiles if profile.get("is_primary")]
            candidates = primary or (profiles if len(profiles) == 1 else [])
            if len(candidates) != 1:
                raise SiloError("Set SiloProfileId to the account's primary profile ID")
            self.profile_id = str(candidates[0]["id"])
        return {"X-Profile-Id": str(self.profile_id)}

    async def item(self, item_id):
        return await self.request(
            "GET", f"/catalog/items/{quote(str(item_id), safe='')}",
            params={"image_size": "original"}, headers=await self.profile_headers()
        )

    async def seasons(self, series_id):
        return await self.collection(
            f"/catalog/series/{quote(str(series_id), safe='')}/seasons",
            {"image_size": "original"}, headers=await self.profile_headers()
        )

    async def files(self, item_id):
        return await self.collection(f"/admin/items/{quote(str(item_id), safe='')}/files", {"limit": 200})

    async def versions(self, item_id):
        return await self.collection(
            f"/catalog/items/{quote(str(item_id), safe='')}/versions", headers=await self.profile_headers()
        )

    async def poster(self, item_id):
        detail = await self.item(item_id)
        reference = detail.get("poster_url")
        if not reference:
            raise SiloError("Silo item has no poster")
        image_url = self.url + reference if reference.startswith("/api/v2/") else urljoin(self.url + "/", reference)
        origin = urlsplit(self.url)
        target = urlsplit(image_url)
        if (target.scheme, target.netloc) != (origin.scheme, origin.netloc) or target.username or target.password:
            raise SiloError("Silo artwork must be served by the configured server")
        try:
            response = await self.client.get(image_url, follow_redirects=False)
        except httpx.HTTPError:
            raise SiloError("Silo poster request failed") from None
        if not response.is_success:
            raise SiloError(f"Silo artwork returned HTTP {response.status_code}")
        return response.content, response.headers.get("content-type", "image/jpeg")

    async def stream_metadata(self, row, library_id=None):
        catalog_versions = [entry for entry in row.get("versions", []) if library_id is None or str(entry.get("library_id")) == str(library_id)]
        catalog_version = catalog_versions[0] if catalog_versions else {}
        versions = await self.versions(row["content_id"])
        selected = next((entry for entry in versions if entry.get("file_id") == catalog_version.get("file_id")), {})
        tracks = selected.get("video_tracks") or []
        video = tracks[0] if tracks else {}
        audios = selected.get("audio_tracks") or []
        audio = next((track for track in audios if track.get("default")), audios[0] if audios else {})
        resolution = catalog_version.get("resolution") or selected.get("resolution")
        dynamic_range = catalog_version.get("dynamic_range")
        return {
            "resolution": "4K" if resolution in ("2160p", "4k", "4K") else resolution,
            "audio_languages": sorted({track["language"].lower() for track in audios if track.get("language")}),
            "subtitle_languages": sorted({track["language"].lower() for track in selected.get("subtitle_tracks", []) if track.get("language")}),
            "audio_codec": audio.get("codec") or catalog_version.get("codec_audio"),
            "audio_profile": audio.get("profile"), "audio_track_title": "Dolby Atmos" if catalog_version.get("atmos") else audio.get("title"),
            "has_hdr": bool(selected.get("hdr")) or dynamic_range in ("hdr10", "hdr10_plus", "hlg", "hdr_unknown"),
            "has_dolby_vision": bool(video.get("dv_config_present")) or dynamic_range == "dolby_vision",
            "aspect_ratio": video["width"] / video["height"] if video.get("width") and video.get("height") else None,
            "filepath": selected.get("file_path"), "runtime_mins": selected.get("duration", 0) // 60 or None,
            "streams_verified": bool(selected),
        }

    async def normalized_item(self, row, library_name, library_id=None):
        detail = await self.item(row["content_id"])
        files = await self.files(row["content_id"])
        files = [entry for entry in files if library_id is None or str(entry.get("library_id")) == str(library_id)]
        versions = [entry for entry in row.get("versions", []) if library_id is None or str(entry.get("library_id")) == str(library_id)]
        version = versions[0] if versions else {}
        media_type = "show" if row["type"] == "series" else row["type"]
        filepath = (files[-1].get("file_path") if files else "") or ""
        roots = detail.get("folder_paths") or []
        root = (files[-1].get("observed_root_path") if files else "") or (roots[0] if media_type == "show" and roots else "")
        if not root and filepath:
            root = str(PurePosixPath(filepath.replace("\\", "/")).parent)
        dynamic_range = version.get("dynamic_range")
        networks = detail.get("networks") or []
        studios = detail.get("studios") or []
        item = {
            "id": str(row["content_id"]), "title": row.get("title") or detail.get("title") or "",
            "year": row.get("year"), "media_type": media_type, "library_name": library_name,
            "library_id": str(library_id) if library_id is not None else None,
            "imdb_id": row.get("imdb_id"), "tmdb_id": row.get("tmdb_id"), "tvdb_id": row.get("tvdb_id"),
            "root_folder": PurePosixPath(str(root or "").replace("\\", "/")).name or row.get("title", ""),
            "filepath": str(root) if media_type == "show" else filepath,
            "media_file_path": filepath if media_type != "show" else None,
            "resolution": "4K" if version.get("resolution") in ("2160p", "4k", "4K") else version.get("resolution"),
            "audio_codec": version.get("codec_audio"), "audio_track_title": "Dolby Atmos" if version.get("atmos") else None,
            "has_hdr": dynamic_range in ("hdr10", "hdr10_plus", "hlg", "hdr_unknown"),
            "has_dolby_vision": dynamic_range == "dolby_vision",
            "audio_languages": [], "subtitle_languages": sorted({entry["language"] for entry in detail.get("subtitles", []) if entry.get("language")}),
            "content_rating": detail.get("content_rating"), "status": detail.get("status") or None,
            "runtime_mins": detail.get("runtime") or None, "edition": version.get("edition"), "server_updated_at": None,
            "rating": None, "critic_rating": detail.get("rating_rt_critic"),
            "studio": studios[0] if studios else None, "network": networks[0] if networks else None,
            "networks": networks, "poster_url": detail.get("poster_url"), "backdrop_url": detail.get("backdrop_url"),
        }
        if media_type == "movie":
            metadata = await self.stream_metadata(row, library_id)
            item.update({key: value for key, value in metadata.items() if value is not None})
            if metadata.get("filepath"):
                item["media_file_path"] = metadata["filepath"]
                item["root_folder"] = PurePosixPath(metadata["filepath"].replace("\\", "/")).parent.name
        return item

    async def library_items(self, library, item_id=None):
        rows = await self.catalog(library["id"], library["type"], item_id)
        return [await self.normalized_item(row, library["name"], library["id"]) for row in rows]

    async def collections(self, library_id=None):
        rows = await self.collection("/admin/collections", {"limit": 200})
        return [row for row in rows if library_id in (None, "all") or str(library_id) in
                {str(identifier) for identifier in [row.get("library_id"), *(row.get("library_ids") or [])]}]

    async def upload_collection(self, collection_id, content, image_type="poster"):
        if image_type not in ("poster", "backdrop") or not content or len(content) > 10 * 1024 * 1024:
            raise SiloError("Silo collection artwork requires a poster/backdrop of at most 10 MiB")
        return await self.request("PUT", f"/admin/collections/{quote(str(collection_id), safe='')}/{image_type}",
                                  files={"image": ("artwork.jpg", content, "image/jpeg")})

    async def upload(self, item_id, content, image_type="poster", media_type="movie"):
        if media_type not in ("movie", "show", "series", "season"):
            raise SiloError("Silo does not support episode artwork uploads")
        allowed = ("poster", "backdrop") if media_type == "season" else ("poster", "backdrop", "logo")
        if image_type not in allowed:
            raise SiloError("Unsupported Silo artwork slot")
        if not content or len(content) > 10 * 1024 * 1024:
            raise SiloError("Silo artwork must contain between 1 byte and 10 MiB")
        return await self.request(
            "POST", f"/admin/items/{quote(str(item_id), safe='')}/images/upload",
            data={"type": image_type}, files={"image": ("artwork.jpg", content, "image/jpeg")}
        )


def get_silo_credentials(config):
    section = config.get("SiloPart") or {}
    api = config.get("ApiPart") or {}
    return {
        "url": config.get("SiloUrl") or section.get("SiloUrl") or "",
        "api_key": config.get("SiloAPIKey") or api.get("SiloAPIKey") or "",
        "profile_id": config.get("SiloProfileId") or section.get("SiloProfileId") or None,
        "enabled": str(config.get("UseSilo", section.get("UseSilo", False))).lower() == "true",
        "excluded": config.get("SiloLibstoExclude", section.get("LibstoExclude", [])),
    }