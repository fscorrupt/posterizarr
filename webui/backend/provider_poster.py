import asyncio
import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

import httpx
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

_TVDB_LANGUAGE_ALIASES = {
    "en": ("eng",), "de": ("deu", "ger"), "fr": ("fra", "fre"), "es": ("spa",),
    "it": ("ita",), "pt": ("por",), "ja": ("jpn",), "ko": ("kor",), "zh": ("zho", "chi"),
    "ru": ("rus",), "nl": ("nld", "dut"), "sv": ("swe",), "no": ("nor",), "da": ("dan",),
    "fi": ("fin",), "pl": ("pol",), "cs": ("ces", "cze"), "hu": ("hun",), "tr": ("tur",),
    "ar": ("ara",), "he": ("heb",), "el": ("ell", "gre"), "uk": ("ukr",),
}


def provider_order(config, media_type):
    api = config.get("ApiPart") or config
    available = {"TMDB", "TVDB"}
    mode = str(api.get("ProviderPriorityMode") or "Simple").casefold()
    if mode == "global":
        order = api.get("ProviderOrder") or ["TMDB", "TVDB"]
    elif mode == "permediatype":
        key = "MovieProviderOrder" if media_type == "movie" else "ShowProviderOrder"
        order = api.get(key) or api.get("ProviderOrder") or ["TMDB", "TVDB"]
    else:
        order = [api.get("FavProvider") or "TMDB", "TMDB", "TVDB"]
    result = []
    for name in order:
        normalized = str(name).strip().upper()
        if normalized in available and normalized not in result:
            result.append(normalized)
    return result or ["TMDB"]


def language_order(config, asset_type):
    api = config.get("ApiPart") or config
    standard = api.get("PreferredLanguageOrder") or ["xx", "en", "de"]
    key = {
        "poster": "PreferredLanguageOrder",
        "season": "PreferredSeasonLanguageOrder",
        "titlecard": "PreferredTCLanguageOrder",
        "background": "PreferredBackgroundLanguageOrder",
    }[asset_type]
    configured = api.get(key) or standard
    if configured == ["PleaseFillMe"] or configured == "PleaseFillMe":
        configured = standard
    if isinstance(configured, str):
        configured = [part.strip() for part in configured.split(",") if part.strip()]
    result = []
    for value in configured:
        lang = str(value).strip().lower()
        if lang and lang != "pleasefillme" and lang not in result:
            result.append(lang)
    return result or ["xx", "en", "de"]


def choose_language_asset(images, languages, *, tvdb=False, min_width=0, min_height=0, vote_sort="vote_average"):
    images = [image for image in images if isinstance(image, dict)]
    if min_width and min_height:
        images = [image for image in images if int(image.get("width") or 0) >= min_width and int(image.get("height") or 0) >= min_height]
    for language in languages:
        if language in ("xx", "null"):
            candidates = [image for image in images if (not image.get("iso_639_1") and not image.get("language")) or
                          image.get("iso_639_1") == "xx" or image.get("iso_3166_1") == "XX" or
                          str(image.get("language") or "").lower() in ("null", "xx")]
        else:
            code = language.split("-")[0]
            candidates = [image for image in images if
                          str(image.get("iso_639_1") or image.get("language") or "").lower().startswith(code)]
        if candidates:
            if tvdb:
                candidates.sort(key=lambda image: float(image.get("score") or 0), reverse=True)
            elif vote_sort != "primary":
                candidates.sort(key=lambda image: float(image.get(vote_sort) or 0), reverse=True)
            return candidates[0]
    return None


def poster_cache_path(cache_root, asset_type, media_type, tmdb_id, tvdb_id, season_number, episode_number, config, provider=None):
    signature = {"config": config, "provider_override": provider}
    digest = hashlib.sha256(json.dumps(signature, sort_keys=True, default=str).encode()).hexdigest()[:12]
    identity = f"tmdb-{tmdb_id}" if tmdb_id else f"tvdb-{tvdb_id}"
    suffix = f"-s{season_number}" if season_number is not None else ""
    suffix += f"-e{episode_number}" if episode_number is not None else ""
    return Path(cache_root) / f"{media_type}-{asset_type}-{identity}{suffix}-{digest}.jpg"


def _api_config(config):
    return config.get("ApiPart") or config


def _tmdb_context(token):
    token = str(token or "").strip()
    headers = {"Authorization": f"Bearer {token}"} if token.startswith("ey") or len(token) > 40 else {}
    return headers, {} if headers or not token else {"api_key": token}


def _language_locale(language, mappings):
    mapped = next((value for key, value in mappings.items() if str(key).lower() == language.lower()), None)
    return str(mapped or language)


def _tvdb_language_matches(raw_language, preferred):
    if preferred in ("xx", "null"):
        return raw_language is None or str(raw_language).strip().lower() in ("", "null", "xx")
    lang = str(raw_language or "").lower()
    code = preferred.split("-")[0].lower()
    return lang.startswith(code) or lang in _TVDB_LANGUAGE_ALIASES.get(code, ())


def _artwork_title(data, language):
    if not isinstance(data, dict):
        return None
    for key in ("translations", "nameTranslations", "aliases"):
        translations = data.get(key)
        if isinstance(translations, dict):
            for locale in (language, language.split("-")[0]):
                candidate = translations.get(locale)
                if isinstance(candidate, dict):
                    candidate = candidate.get("name") or candidate.get("title")
                if isinstance(candidate, str) and candidate.strip():
                    return candidate.strip()
        elif isinstance(translations, list):
            for item in translations:
                if isinstance(item, dict) and str(item.get("language") or item.get("languageCode") or "").lower().startswith(language.split("-")[0].lower()):
                    candidate = item.get("name") or item.get("title")
                    if candidate:
                        return str(candidate).strip()
    for key in ("name", "title", "originalName", "originalTitle"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


async def _tvdb_title(client, headers, entity, item_id, languages, metadata=None):
    for language in languages:
        if language in ("xx", "null"):
            continue
        code = language.split("-")[0].lower()
        for language_code in (*_TVDB_LANGUAGE_ALIASES.get(code, ()), language):
            try:
                response = await client.get(f"https://api4.thetvdb.com/v4/{entity}/{item_id}/translations/{language_code}", headers=headers)
                if response.status_code == 200:
                    payload = response.json().get("data", {})
                    title = _artwork_title(payload, language)
                    if title:
                        return title
            except (httpx.HTTPError, ValueError):
                continue
        translations = metadata.get("translations") if isinstance(metadata, dict) else None
        if isinstance(translations, dict):
            translation = next((value for key, value in translations.items()
                                if str(key).lower().startswith(code) or str(key).lower() in _TVDB_LANGUAGE_ALIASES.get(code, ())), None)
            title = _artwork_title({"translations": {language: translation}}, language) if translation else None
            if title:
                return title
    return None


async def _get_tmdb_title(client, token, media_type, tmdb_id, languages, mappings):
    if not token or not tmdb_id:
        return None, None
    headers, params = _tmdb_context(token)
    kind = "movie" if media_type == "movie" else "tv"
    preferred = [lang for lang in languages if lang not in ("xx", "null")]
    preferred.extend(language for language in ("en-US",) if language not in preferred)
    fallback = None
    for language in preferred:
        try:
            response = await client.get(f"https://api.themoviedb.org/3/{kind}/{tmdb_id}", headers=headers,
                                        params={**params, "language": _language_locale(language, mappings)})
            if response.status_code != 200:
                continue
            data = response.json()
            title = data.get("title") or data.get("name")
            if title and fallback is None:
                fallback = (str(title), data)
            if title:
                return str(title), data
        except (httpx.HTTPError, ValueError):
            continue
    return fallback or (None, None)


async def _tmdb_asset(client, token, media_type, asset_type, tmdb_id, season_number, episode_number,
                      languages, mappings, vote_sort, min_width, min_height, width_filter):
    if not token or not tmdb_id:
        return None
    headers, base_params = _tmdb_context(token)
    kind = "movie" if media_type == "movie" else "tv"
    details_path = f"/{kind}/{tmdb_id}"
    if asset_type in ("season", "titlecard"):
        details_path += f"/season/{season_number}"
        if asset_type == "titlecard":
            details_path += f"/episode/{episode_number}"
    title = None
    details = None
    preferred = [lang for lang in languages if lang not in ("xx", "null")] or ["en-US"]
    for language in preferred:
        try:
            response = await client.get(f"https://api.themoviedb.org/3{details_path}", headers=headers,
                                        params={**base_params, "language": _language_locale(language, mappings)})
            if response.status_code == 200:
                details = response.json()
                title = details.get("title") or details.get("name")
                if title:
                    break
        except (httpx.HTTPError, ValueError):
            continue
    if not details:
        return None
    if asset_type == "season":
        series_title, _ = await _get_tmdb_title(client, token, "show", tmdb_id, languages, mappings)
        title = series_title or title
    if asset_type == "titlecard":
        images_path = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{season_number}/episode/{episode_number}/images"
        list_key = "stills"
    elif asset_type == "season":
        images_path = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{season_number}/images"
        list_key = "posters"
    else:
        images_path = f"https://api.themoviedb.org/3/{kind}/{tmdb_id}/images"
        list_key = "backdrops" if asset_type == "background" else "posters"
    image_langs = [_language_locale(lang, mappings) if lang not in ("xx", "null") else "null" for lang in languages]
    try:
        image_response = await client.get(images_path, headers=headers,
                                          params={**base_params, "include_image_language": ",".join(image_langs)})
        images = image_response.json().get(list_key, []) if image_response.status_code == 200 else []
    except (httpx.HTTPError, ValueError):
        images = []
    selected = choose_language_asset(images, languages, min_width=min_width if width_filter else 0,
                                     min_height=min_height if width_filter else 0, vote_sort=vote_sort)
    image_path = (selected or {}).get("file_path")
    if not image_path and asset_type in ("poster", "background") and not width_filter:
        image_path = details.get("backdrop_path" if asset_type == "background" else "poster_path")
        if image_path:
            selected = {"iso_639_1": "xx" if asset_type == "background" else "en"}
    if not isinstance(image_path, str) or not re.fullmatch(r"/[A-Za-z0-9_-]+\.(?:jpg|png)", image_path):
        return None
    return {"url": f"https://image.tmdb.org/t/p/original{image_path}", "title": title,
            "language": (selected or {}).get("iso_639_1"), "provider": "TMDB",
            "poster_with_text": bool((selected or {}).get("iso_639_1") not in (None, "", "xx"))}


async def _tvdb_login(client, api_key):
    api_key = str(api_key or "").strip()
    if not api_key:
        return None
    if "#" in api_key:
        api_key, pin = api_key.split("#", 1)
    else:
        pin = None
    payload = {"apikey": api_key}
    if pin:
        payload["pin"] = pin
    try:
        response = await client.post("https://api4.thetvdb.com/v4/login", json=payload)
        return response.json().get("data", {}).get("token") if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None


async def _tvdb_asset(client, token, media_type, asset_type, tvdb_id, season_number, episode_number,
                      languages, min_width, min_height, width_filter):
    if not token or not tvdb_id:
        return None
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    try:
        if asset_type == "titlecard":
            for page in range(50):
                response = await client.get(f"https://api4.thetvdb.com/v4/series/{tvdb_id}/episodes/default",
                                            headers=headers, params={"page": page})
                if response.status_code != 200:
                    return None
                data = response.json().get("data", {})
                episodes = data.get("episodes", [])
                episode = next((item for item in episodes if str(item.get("seasonNumber")) == str(season_number)
                                and str(item.get("number")) == str(episode_number)), None)
                if episode:
                    image = episode.get("image")
                    localized_title = await _tvdb_title(client, headers, "episodes", episode.get("id"), languages, episode)
                    return {"url": image, "title": localized_title, "language": None, "provider": "TVDB",
                            "poster_with_text": False} if image else None
                if not episodes:
                    break
            return None

        if asset_type == "season":
            series_response = await client.get(f"https://api4.thetvdb.com/v4/series/{tvdb_id}/extended", headers=headers)
            if series_response.status_code != 200:
                return None
            series_data = series_response.json().get("data", {})
            seasons = series_data.get("seasons", [])
            show_title = await _tvdb_title(client, headers, "series", tvdb_id, languages, series_data)
            target = next((item for item in seasons if str(item.get("number")) == str(season_number)
                           and (item.get("type") or {}).get("type") == "official"), None)
            target = target or next((item for item in seasons if str(item.get("number")) == str(season_number)), None)
            if not target or not target.get("id"):
                return None
            season_response = await client.get(f"https://api4.thetvdb.com/v4/seasons/{target['id']}/extended", headers=headers)
            if season_response.status_code != 200:
                return None
            season_data = season_response.json().get("data", {})
            artworks = [item for item in season_data.get("artwork", []) if str(item.get("type")) == "7"]
            art = _choose_tvdb_art(artworks, languages, min_width, min_height, width_filter)
            if art:
                return {"url": art.get("image"), "title": show_title, "language": art.get("language"),
                    "provider": "TVDB", "poster_with_text": not _tvdb_language_matches(art.get("language"), "xx")}
            return None

        entity = "movies" if media_type == "movie" else "series"
        metadata_response = await client.get(f"https://api4.thetvdb.com/v4/{entity}/{tvdb_id}/extended", headers=headers)
        metadata = metadata_response.json().get("data", {}) if metadata_response.status_code == 200 else {}
        if media_type == "movie":
            data = metadata
        else:
            response = await client.get(f"https://api4.thetvdb.com/v4/series/{tvdb_id}/artworks", headers=headers)
            if response.status_code != 200:
                return None
            payload = response.json().get("data", {})
            data = payload if isinstance(payload, dict) else {}
        artworks = data.get("artworks", [])
        if asset_type == "background":
            type_codes = {"15"} if media_type == "movie" else {"3"}
        else:
            type_codes = {"14"} if media_type == "movie" else {"2"}
        artworks = [item for item in artworks if str(item.get("type")) in type_codes]
        art = _choose_tvdb_art(artworks, languages, min_width, min_height, width_filter)
        if not art:
            return None
        title = await _tvdb_title(client, headers, entity, tvdb_id, languages, metadata)
        return {"url": art.get("image"), "title": title, "language": art.get("language"),
            "provider": "TVDB", "poster_with_text": not _tvdb_language_matches(art.get("language"), "xx")}
    except (httpx.HTTPError, ValueError, TypeError):
        return None


def _choose_tvdb_art(artworks, languages, min_width, min_height, width_filter):
    candidates = artworks
    if width_filter:
        candidates = [art for art in candidates if int(art.get("width") or 0) >= min_width and int(art.get("height") or 0) >= min_height]
    for language in languages:
        matches = [art for art in candidates if _tvdb_language_matches(art.get("language"), language)]
        if matches:
            return max(matches, key=lambda art: float(art.get("score") or 0))
    return None


def _remote_tmdb_id(data):
    remote_ids = data.get("remoteIds") or data.get("remote_ids") or [] if isinstance(data, dict) else []
    for remote in remote_ids if isinstance(remote_ids, list) else []:
        source = str(remote.get("sourceName") or remote.get("source") or "").casefold()
        candidate = remote.get("id") or remote.get("remoteId")
        if "moviedb" in source or "tmdb" in source:
            try:
                value = int(candidate)
                return value if value > 0 else None
            except (TypeError, ValueError):
                continue
    return None


async def resolve_provider_asset(media_type, asset_type, tmdb_id, tvdb_id, credentials, config, season_number=None, episode_number=None, provider=None):
    api = _api_config(config)
    languages = language_order(config, asset_type)
    mappings = api.get("TmdbLanguageMappings") or {}
    if not isinstance(mappings, dict):
        mappings = {}
    width_filter = str(api.get("WidthHeightFilter") or "false").lower() == "true"
    if asset_type in ("background", "titlecard"):
        min_width = int(api.get("BgTcMinWidth") or 0)
        min_height = int(api.get("BgTcMinHeight") or 0)
    else:
        min_width = int(api.get("PosterMinWidth") or 0)
        min_height = int(api.get("PosterMinHeight") or 0)
    tmdb_token = credentials.get("tmdb_token") or api.get("tmdbtoken")
    tvdb_key = api.get("tvdbapi") or api.get("tvdbapikey") or credentials.get("tvdb_api_key")
    vote_sort = str(api.get("tmdb_vote_sorting") or "vote_average")
    kind = "movie" if media_type == "movie" else "show"
    order = provider_order(config, kind)
    if provider:
        order = [provider.upper()] + [name for name in order if name != provider.upper()]

    async with httpx.AsyncClient(timeout=12.0, follow_redirects=False) as client:
        tmdb_title, _ = await _get_tmdb_title(client, tmdb_token, media_type, tmdb_id, languages, mappings)
        tvdb_token = await _tvdb_login(client, tvdb_key) if "TVDB" in order and tvdb_id else None
        if tvdb_token and not tmdb_id and tvdb_id:
            entity = "movies" if media_type == "movie" else "series"
            try:
                response = await client.get(f"https://api4.thetvdb.com/v4/{entity}/{tvdb_id}/extended",
                                            headers={"Authorization": f"Bearer {tvdb_token}"})
                if response.status_code == 200:
                    tmdb_id = _remote_tmdb_id(response.json().get("data", {}))
                    if tmdb_id:
                        tmdb_title, _ = await _get_tmdb_title(client, tmdb_token, media_type, tmdb_id, languages, mappings)
            except (httpx.HTTPError, ValueError):
                pass
        if "TVDB" in order and not tvdb_id and tmdb_id and tvdb_key and media_type == "show":
            if not tvdb_token:
                tvdb_token = await _tvdb_login(client, tvdb_key)
            if tvdb_token:
                headers = {"Authorization": f"Bearer {tvdb_token}"}
                try:
                    ids_response = await client.get(f"https://api.themoviedb.org/3/tv/{tmdb_id}/external_ids",
                                                    headers=_tmdb_context(tmdb_token)[0],
                                                    params=_tmdb_context(tmdb_token)[1])
                    if ids_response.status_code == 200:
                        tvdb_id = ids_response.json().get("tvdb_id")
                except (httpx.HTTPError, ValueError):
                    pass
        for source in order:
            if source == "TMDB":
                result = await _tmdb_asset(client, tmdb_token, media_type, asset_type, tmdb_id, season_number, episode_number,
                                            languages, mappings, vote_sort, min_width, min_height, width_filter)
            elif source == "TVDB":
                result = await _tvdb_asset(client, tvdb_token, media_type, asset_type, tvdb_id, season_number, episode_number,
                                            languages, min_width, min_height, width_filter)
            else:
                result = None
            if result and result.get("url"):
                result["title"] = result.get("title") or tmdb_title
                if not result.get("title"):
                    result["title"] = f"TMDb {tmdb_id}" if tmdb_id else f"TVDB {tvdb_id}"
                return result
    if tmdb_title:
        return {"title": tmdb_title, "url": None, "provider": "TMDB", "poster_with_text": False}
    return None


def _trusted_image_url(url, provider):
    from urllib.parse import urlparse
    parsed = urlparse(str(url or ""))
    hosts = {"TMDB": {"image.tmdb.org"}, "TVDB": {"artworks.thetvdb.com"}}
    return parsed.scheme == "https" and parsed.hostname in hosts.get(provider, set())


async def render_poster(media_type, tmdb_id, credentials, config, script_path, overlay_path, cache_root,
                        *, asset_type="poster", tvdb_id=None, season_number=None, episode_number=None, provider=None):
    if asset_type in ("season", "titlecard") and (season_number is None or int(season_number) < 0):
        raise HTTPException(status_code=400, detail="A non-negative season_number is required")
    if asset_type == "titlecard" and (episode_number is None or int(episode_number) < 1):
        raise HTTPException(status_code=400, detail="A positive episode_number is required")
    if not tmdb_id and not tvdb_id:
        raise HTTPException(status_code=400, detail="A TMDb or TVDB ID is required")
    resolved = await resolve_provider_asset(media_type, asset_type, tmdb_id, tvdb_id, credentials, config,
                                            season_number, episode_number, provider)
    if not resolved:
        raise HTTPException(status_code=404, detail="No provider title or artwork was found")
    if not resolved.get("url"):
        raise HTTPException(status_code=404, detail="TMDb title was found but no artwork was available")
    if not _trusted_image_url(resolved["url"], resolved["provider"]):
        raise HTTPException(status_code=502, detail="Provider returned an untrusted artwork URL")
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            async with client.stream("GET", resolved["url"]) as image_response:
                image_response.raise_for_status()
                data = bytearray()
                async for chunk in image_response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 20 * 1024 * 1024:
                        raise HTTPException(status_code=502, detail="Provider artwork exceeds the size limit")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Provider artwork download failed") from None
    try:
        with Image.open(BytesIO(data)) as image:
            image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=502, detail="Provider returned an invalid image") from None
    return await asyncio.to_thread(_render, media_type, asset_type, tmdb_id, tvdb_id, season_number, episode_number,
                                   resolved["title"], resolved["poster_with_text"], bytes(data), config,
                                   Path(script_path), Path(overlay_path), Path(cache_root))


def _render(media_type, asset_type, tmdb_id, tvdb_id, season_number, episode_number, title, poster_with_text,
            data, config, script_path, overlay_path, cache_root):
    if not script_path.is_file() or not isinstance(config, dict):
        raise HTTPException(status_code=503, detail="Poster renderer or configuration is unavailable")
    shell = shutil.which("pwsh")
    if not shell:
        raise HTTPException(status_code=503, detail="PowerShell 7 is required to create posters")
    with tempfile.TemporaryDirectory(prefix="posterizarr-api-") as temporary:
        work = Path(temporary)
        for directory in ("assets", "manualassets", "backup", "Overlayfiles"):
            (work / directory).mkdir()
        if overlay_path.is_dir():
            for asset in overlay_path.iterdir():
                if asset.is_file() and asset.suffix.lower() in (".png", ".ttf", ".otf", ".ttc", ".otc"):
                    shutil.copy2(asset, work / "Overlayfiles" / asset.name)
        isolated = copy.deepcopy(config)
        prerequisites = isolated.setdefault("PrerequisitePart", {})
        prerequisites.update({"AssetPath": str(work / "assets"), "ManualAssetPath": str(work / "manualassets"),
                              "BackupPath": str(work / "backup"), "LibraryFolders": "true", "PlexUpload": "false",
                              "AutoUpdatePosterizarr": "false", "AutoUpdateIM": "false", "AutoCreateSeasonTemplate": "false"})
        for group, key in (("PlexPart", "UsePlex"), ("JellyfinPart", "UseJellyfin"), ("EmbyPart", "UseEmby"), ("SiloPart", "UseSilo")):
            isolated.setdefault(group, {})[key] = "false"
        isolated.setdefault("Notification", {}).update({"SendNotification": "false", "UseUptimeKuma": "false"})
        if os.name == "nt":
            magick = Path(str(prerequisites.get("magickinstalllocation") or ""))
            if not magick.is_absolute():
                magick = script_path.parent / magick
            if magick.is_dir():
                magick = magick / "magick.exe"
            if not magick.is_file():
                raise HTTPException(status_code=503, detail="Configured ImageMagick executable is unavailable")
            prerequisites["magickinstalllocation"] = str(magick)
        elif not os.environ.get("POWERSHELL_DISTRIBUTION_CHANNEL", "").startswith("PSDocker"):
            magick = script_path.parent / "magick"
            if not magick.is_file():
                raise HTTPException(status_code=503, detail="Configured ImageMagick executable is unavailable")
            shutil.copy2(magick, work / "magick")
        (work / "config.json").write_text(json.dumps(isolated), encoding="utf-8")
        source = work / "source.jpg"
        source.write_bytes(data)
        provider_id = f"tmdb-{tmdb_id}" if tmdb_id else f"tvdb-{tvdb_id}"
        folder = provider_id
        command = [shell, "-NoProfile", "-NonInteractive", "-File", str(script_path), "-Manual", "-PicturePath", str(source),
                   "-Titletext", title, "-FolderName", folder, "-LibraryName", "API"]
        if asset_type == "season":
            command.extend(["-SeasonPoster", "-SeasonPosterName", str(season_number)])
        elif asset_type == "titlecard":
            command.extend(["-TitleCard", "-SeasonPosterName", str(season_number), "-EpisodeNumber", str(episode_number), "-EPTitleName", title])
        else:
            if asset_type == "background":
                command.append("-BackgroundCard")
            command.append("-MoviePosterCard" if media_type == "movie" else "-ShowPosterCard")
        if poster_with_text:
            command.append("-PosterWithText")
        environment = {**os.environ, "POSTERIZARR_API_WORK_ROOT": str(work), "APP_DATA": str(work)}
        try:
            result = subprocess.run(command, cwd=str(script_path.parent), env=environment, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, timeout=180, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise HTTPException(status_code=503, detail="Poster renderer could not complete") from None
        file_name = "poster.jpg" if asset_type == "poster" else "background.jpg" if asset_type == "background" else f"Season{int(season_number):02d}.jpg" if asset_type == "season" else f"S{int(season_number):02d}E{int(episode_number):02d}.jpg"
        poster = work / "assets" / "API" / folder / file_name
        if result.returncode != 0 or not poster.is_file():
            raise HTTPException(status_code=502, detail="Poster renderer did not produce an image")
        try:
            with Image.open(poster) as image:
                if image.format != "JPEG":
                    raise OSError("Expected JPEG output")
                image.verify()
            content = poster.read_bytes()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            raise HTTPException(status_code=502, detail="Poster renderer produced an invalid image") from None
        cache_root.mkdir(parents=True, exist_ok=True)
        target = poster_cache_path(cache_root, asset_type, media_type, tmdb_id, tvdb_id, season_number, episode_number, config)
        with tempfile.NamedTemporaryFile(dir=cache_root, prefix="poster-", suffix=".tmp", delete=False) as temporary_file:
            temporary_path = Path(temporary_file.name)
            try:
                temporary_file.write(content)
            except BaseException:
                temporary_path.unlink(missing_ok=True)
                raise
        try:
            os.replace(temporary_path, target)
        finally:
            temporary_path.unlink(missing_ok=True)
        return content