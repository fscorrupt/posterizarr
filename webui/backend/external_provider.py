from typing import Callable, Literal, Optional
from pathlib import Path
import asyncio
from collections import OrderedDict
import hashlib
import json
import os
import re
import time

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import FileResponse, Response

from provider_poster import poster_cache_path, render_poster


def find_existing_posters(root, choices, media_type, asset_type, tmdb_id, tvdb_id, season_number, episode_number, library):
    root = Path(root).resolve()
    matches = set()
    type_aliases = {
        "poster": {media_type, "poster"},
        "background": {"background", f"{media_type} background", "tv background", "series background"},
        "season": {"season"},
        "titlecard": {"episode", "titlecard", "title_card"},
    }[asset_type]
    if asset_type == "poster":
        file_names = ["poster.jpg"]
    elif asset_type == "background":
        file_names = ["background.jpg"]
    elif asset_type == "season":
        file_names = [f"Season{int(season_number):02d}.jpg"]
    else:
        file_names = [f"S{int(season_number):02d}E{int(episode_number):02d}.jpg"]
    for choice in choices:
        choice = dict(choice)
        if str(choice.get("Type") or "").strip().lower() not in type_aliases:
            continue
        name, folder = choice.get("LibraryName"), choice.get("Rootfolder")
        if not name or not folder or (library is not None and name != library):
            continue
        folder_text = str(folder)
        ids_match = False
        for key, requested in (("tmdb", tmdb_id), ("tvdb", tvdb_id)):
            if not requested:
                continue
            stored = str(choice.get(f"{key}id") or "").lower()
            tagged = re.search(r"[\[{]" + re.escape(key) + r"(?:id)?[-=](\d+)[\]}]", folder_text, re.IGNORECASE)
            if stored == str(requested) or (stored in ("", "false", "none") and tagged and tagged.group(1) == str(requested)):
                ids_match = True
                break
        if not ids_match:
            continue
        found = False
        flat_names = [f"{folder}.jpg"] if asset_type == "poster" else [f"{folder}_{Path(file_name).stem}.jpg" for file_name in file_names]
        candidates = [root / name / folder / file_name for file_name in file_names]
        candidates.extend(root / flat_name for flat_name in flat_names)
        for candidate in candidates:
            path = candidate.resolve()
            if path.is_relative_to(root) and path.is_file():
                matches.add(path)
                found = True
        library_root = (root / name).resolve()
        if not found and library_root.is_relative_to(root) and library_root.is_dir() and Path(folder_text).name == folder_text:
            for current, directories, files in os.walk(library_root, followlinks=False):
                directories[:] = [directory for directory in directories if directory != "@eaDir"]
                if Path(current).name == folder:
                    for file_name in file_names:
                        if file_name in files:
                            path = (Path(current) / file_name).resolve()
                            if path.is_relative_to(root) and path.is_file():
                                matches.add(path)
    return matches


def _tmdb_auth(token):
    token = str(token or "").strip()
    headers = {"Authorization": f"Bearer {token}"} if token.startswith("ey") or len(token) > 40 else {}
    params = {} if headers or not token else {"api_key": token}
    return headers, params


def _ids_from_tvdb_remote_ids(data, tmdb_id=None, tvdb_id=None, imdb_id=None):
    remote_ids = data.get("remoteIds") or data.get("remote_ids") or [] if isinstance(data, dict) else []
    for item in remote_ids if isinstance(remote_ids, list) else []:
        source = str(item.get("sourceName") or item.get("source") or "").casefold()
        value = str(item.get("id") or item.get("remoteId") or "").strip()
        if not value:
            continue
        if "imdb" in source or re.fullmatch(r"tt\d{7,12}", value, re.IGNORECASE):
            imdb_id = imdb_id or value
        elif "moviedb" in source or "tmdb" in source:
            if value.isdigit():
                tmdb_id = tmdb_id or int(value)
        elif "tvdb" in source and value.isdigit():
            tvdb_id = tvdb_id or int(value)
    return tmdb_id, tvdb_id, imdb_id


async def resolve_rating_ids(media_type, tmdb_id, tvdb_id, imdb_id, credentials, config, client):
    api = config.get("ApiPart") or config
    tmdb_token = credentials.get("tmdb_token") or api.get("tmdbtoken")
    if tmdb_token and tmdb_id and (not imdb_id or not tvdb_id):
        headers, params = _tmdb_auth(tmdb_token)
        kind = "movie" if media_type == "movie" else "tv"
        try:
            response = await client.get(f"https://api.themoviedb.org/3/{kind}/{tmdb_id}/external_ids",
                                        headers=headers, params=params, timeout=6.0)
            if response.status_code == 200:
                external = response.json()
                imdb_id = imdb_id or external.get("imdb_id")
                tvdb_id = tvdb_id or external.get("tvdb_id")
        except (httpx.HTTPError, ValueError):
            pass

    if imdb_id and not tmdb_id and tmdb_token:
        headers, params = _tmdb_auth(tmdb_token)
        try:
            response = await client.get(f"https://api.themoviedb.org/3/find/{imdb_id}", headers=headers,
                                        params={**params, "external_source": "imdb_id"}, timeout=6.0)
            if response.status_code == 200:
                results = response.json().get("movie_results" if media_type == "movie" else "tv_results", [])
                if results:
                    tmdb_id = results[0].get("id")
        except (httpx.HTTPError, ValueError):
            pass

    tvdb_key = api.get("tvdbapi") or api.get("tvdbapikey")
    if tvdb_id and tvdb_key and (not tmdb_id or not imdb_id):
        key = str(tvdb_key).strip()
        body = {"apikey": key.split("#", 1)[0]}
        if "#" in key and key.split("#", 1)[1]:
            body["pin"] = key.split("#", 1)[1]
        try:
            login = await client.post("https://api4.thetvdb.com/v4/login", json=body, timeout=8.0)
            token = login.json().get("data", {}).get("token") if login.status_code == 200 else None
            if token:
                entity = "movies" if media_type == "movie" else "series"
                response = await client.get(f"https://api4.thetvdb.com/v4/{entity}/{tvdb_id}/extended",
                                            headers={"Authorization": f"Bearer {token}"}, timeout=8.0)
                if response.status_code == 200:
                    tmdb_id, tvdb_id, imdb_id = _ids_from_tvdb_remote_ids(
                        response.json().get("data", {}), tmdb_id, tvdb_id, imdb_id)
        except (httpx.HTTPError, ValueError):
            pass
    return tmdb_id, tvdb_id, imdb_id


def create_provider_router(validate_key: Callable, get_credentials: Callable, get_settings: Callable,
                           get_choices: Callable, get_asset_root: Callable, get_config: Callable,
                           get_script_path: Callable, get_overlay_path: Callable, get_cache_root: Callable) -> APIRouter:
    router = APIRouter(prefix="/api/provider/v1", tags=["External provider"])
    render_lock = asyncio.Lock()
    rating_cache = OrderedDict()

    def authorize(x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
        token = x_api_key or (authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else None)
        if not token or not validate_key(token):
            raise HTTPException(status_code=401, detail="A valid Posterizarr API key is required")

    @router.get("/asset/{media_type}/{item_id}", dependencies=[Depends(authorize)])
    @router.get("/poster/{media_type}/{item_id}", dependencies=[Depends(authorize)])
    async def poster(
        media_type: Literal["movie", "show"],
        item_id: int,
        asset_type: Literal["poster", "background", "season", "titlecard"] = Query("poster"),
        provider: Literal["auto", "tmdb", "tvdb"] = Query("auto"),
        tmdb_id: Optional[int] = Query(default=None, ge=1),
        tvdb_id: Optional[int] = Query(default=None, ge=1),
        season_number: Optional[int] = Query(default=None, ge=0),
        episode_number: Optional[int] = Query(default=None, ge=1),
        library: Optional[str] = Query(default=None, max_length=255),
        create: bool = True,
    ):
        if asset_type in ("season", "titlecard") and media_type != "show":
            raise HTTPException(status_code=400, detail="Season and titlecard assets require media_type=show")
        if asset_type in ("season", "titlecard") and season_number is None:
            raise HTTPException(status_code=400, detail="season_number is required for this asset_type")
        if asset_type == "titlecard" and episode_number is None:
            raise HTTPException(status_code=400, detail="episode_number is required for titlecard assets")
        if provider == "tvdb":
            tvdb_id = tvdb_id or item_id
            tmdb_id = tmdb_id
        else:
            tmdb_id = tmdb_id or item_id
        if provider == "tmdb" and not tmdb_id:
            raise HTTPException(status_code=400, detail="A TMDb ID is required")
        if provider == "tvdb" and not tvdb_id:
            raise HTTPException(status_code=400, detail="A TVDB ID is required")
        matches = await asyncio.to_thread(lambda: find_existing_posters(
            get_asset_root(), get_choices(), media_type, asset_type, tmdb_id, tvdb_id, season_number, episode_number, library))
        if len(matches) > 1:
            raise HTTPException(status_code=409, detail="Multiple assets match; specify a library")
        if matches:
            return FileResponse(next(iter(matches)), media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})
        if library is not None:
            raise HTTPException(status_code=404, detail="No matching asset found in the requested library")
        config = get_config() or {}
        provider_override = None if provider == "auto" else provider
        cached = poster_cache_path(get_cache_root(), asset_type, media_type, tmdb_id, tvdb_id, season_number, episode_number, config, provider_override)
        if cached.is_file():
            return FileResponse(cached, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})
        if not create:
            raise HTTPException(status_code=404, detail="No matching existing asset found")
        async with render_lock:
            if cached.is_file():
                return FileResponse(cached, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})
            content = await render_poster(media_type, tmdb_id, get_credentials(), config, get_script_path(), get_overlay_path(),
                                          get_cache_root(), asset_type=asset_type, tvdb_id=tvdb_id,
                                          season_number=season_number, episode_number=episode_number,
                                          provider=provider_override)
            return Response(content, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})

    @router.get("/ratings/{media_type}/{item_id}", dependencies=[Depends(authorize)])
    async def ratings(
        media_type: Literal["movie", "show"],
        item_id: str,
        provider: Literal["auto", "tmdb", "tvdb", "imdb"] = Query("auto"),
        tmdb_id: Optional[int] = Query(default=None, ge=1),
        tvdb_id: Optional[int] = Query(default=None, ge=1),
        imdb_id: Optional[str] = Query(default=None, pattern=r"^tt\d{7,12}$"),
    ):
        import ratings_service

        requested_provider = provider
        if provider == "auto":
            provider = "imdb" if re.fullmatch(r"tt\d{7,12}", item_id, re.IGNORECASE) else "tmdb"
        if provider == "imdb":
            if not re.fullmatch(r"tt\d{7,12}", item_id, re.IGNORECASE):
                raise HTTPException(status_code=400, detail="IMDb IDs must use the tt1234567 format")
            imdb_id = item_id.lower()
        elif provider in ("tmdb", "tvdb"):
            if not item_id.isdigit() or int(item_id) <= 0:
                raise HTTPException(status_code=400, detail=f"{provider.upper()} IDs must be positive integers")
            if provider == "tmdb":
                tmdb_id = int(item_id)
            else:
                tvdb_id = int(item_id)
        credentials = get_credentials()
        settings = get_settings()
        config = get_config() or {}
        api = config.get("ApiPart") or config
        provider_keys = [credentials.get("tmdb_token") or api.get("tmdbtoken"), settings.get("mdblist_api_key"),
                         settings.get("simkl_client_id"), settings.get("omdb_api_key")]
        if not any(provider_keys):
            raise HTTPException(status_code=503, detail="No rating providers are configured")
        scores = {}
        sources = {}
        outcomes = {}

        def merge(values, provider):
            for name, value in ratings_service.normalize_provider_ratings(values).items():
                if value is not None and name not in scores:
                    scores[name] = value
                    sources[name] = provider

        async with httpx.AsyncClient(timeout=10.0) as client:
            tmdb_key = credentials.get("tmdb_token") or api.get("tmdbtoken")
            tmdb_id, tvdb_id, imdb_id = await resolve_rating_ids(
                media_type, tmdb_id, tvdb_id, imdb_id, credentials, config, client)
            provider_keys.append(api.get("tvdbapi") or api.get("tvdbapikey"))
            fingerprint = hashlib.sha256(json.dumps(provider_keys, default=str).encode()).hexdigest()
            cache_key = (media_type, tmdb_id, tvdb_id, imdb_id, fingerprint)
            cached = rating_cache.get(cache_key)
            if cached and cached[0] > time.monotonic():
                rating_cache.move_to_end(cache_key)
                return cached[1]
            if tmdb_key:
                value = await ratings_service.fetch_tmdb_rating(tmdb_id, tmdb_key, client, media_type, outcomes=outcomes) if tmdb_id else None
                merge({"tmdb": value}, "tmdb")
            if settings.get("mdblist_api_key"):
                merge(await ratings_service.fetch_mdblist_ratings(imdb_id, tmdb_id, settings["mdblist_api_key"], client,
                                                                  media_type, outcomes=outcomes), "mdblist")
            if settings.get("simkl_client_id"):
                merge(await ratings_service.fetch_simkl_ratings(imdb_id, tmdb_id, settings["simkl_client_id"], client,
                                                                media_type, outcomes=outcomes, tvdb_id=str(tvdb_id) if tvdb_id else None), "simkl")
            if settings.get("omdb_api_key") and imdb_id:
                merge(await ratings_service.fetch_omdb_ratings(imdb_id, settings["omdb_api_key"], client, outcomes), "omdb")

        values = {name: {"value": value, "source": sources[name]} for name, value in scores.items()}
        statuses = {name: result.get("status") for name, result in outcomes.items()}
        if not values and statuses and all(status == "failed" for status in statuses.values()):
            raise HTTPException(status_code=502, detail="Configured rating providers are unavailable")
        result = {"media_type": media_type, "requested_id": item_id, "requested_provider": requested_provider,
              "tmdb_id": tmdb_id, "tvdb_id": tvdb_id, "imdb_id": imdb_id, "scale": 10, "ratings": values,
                  "providers": statuses}
        if values and not any(status in ("failed", "skipped") for status in statuses.values()):
            rating_cache[cache_key] = (time.monotonic() + 900, result)
            rating_cache.move_to_end(cache_key)
            if len(rating_cache) > 256:
                rating_cache.popitem(last=False)
        return result

    return router