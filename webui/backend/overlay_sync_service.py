"""
Dynamic Overlays Sync Service for Posterizarr
==============================================
Executes separately from Posterizarr image creation mode:
1. Keeps clean original assets on disk (AssetPath, e.g. P:\\assetstest) 100% untouched.
2. Queries media servers (Plex, Jellyfin, Emby) for media items across included libraries.
3. Matches media items with clean local assets on disk.
4. Detects changes using OverlayCache (compares clean asset hash/mtime + applied overlay recipe hash).
5. If changed or new (or if full sync is requested):
   - Reads clean base image into RAM.
   - Resolves active overlay rules (resolution, rating, status, runtime, languages, network, anime).
   - Composites dynamic overlays onto the clean image in RAM via DynamicOverlayCompositor.
   - Pushes the resulting JPEG directly to the media server REST API (Plex / Jellyfin / Emby).
   - Updates overlay_cache.db with status 'synced'.
6. Prevents double-pushing: Posterizarr creates clean images with PlexUpload=false;
   Dynamic Overlay Sync then pushes the final overlaid artwork.
"""

import os
import io
import re
import json
import time
import base64
import socket
import ipaddress
import sqlite3
import hashlib
import logging
import asyncio
import threading
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple, Union
import urllib.parse
from xml.etree.ElementTree import fromstring
from PIL import Image, ImageFont
import httpx

from overlay_cache import OverlayCache, compute_metadata_hash
from overlay_engine import DynamicOverlayCompositor, OverlayAssetMissingError, PORTRAIT_DIM, LANDSCAPE_DIM
from ratings_service import resolve_media_ratings, build_multi_rating_layers, ratings_cache
from dynamic_overlays_service import get_dynamic_overlays_settings

EDITION_PATTERNS = [
    (r"(?i)\b(?:director'?s|directors)\s*cut\b", "Director's Cut"),
    (r"(?i)\bextended\s*(?:cut|edition)?\b", "Extended Cut"),
    (r"(?i)\btheatrical\s*(?:cut|edition)?\b", "Theatrical Cut"),
    (r"(?i)\bunrated(?:\s*cut)?\b", "Unrated"),
    (r"(?i)\bremastered\b", "Remastered"),
    (r"(?i)\bspecial\s*edition\b", "Special Edition"),
    (r"(?i)\bfinal\s*cut\b", "Final Cut"),
    (r"(?i)\bultimate\s*(?:cut|edition)\b", "Ultimate Edition"),
    (r"(?i)\bimax(?:\s*enhanced)?\b", "IMAX"),
    (r"(?i)\buncensored\b", "Uncensored"),
]

def extract_edition(*candidates: Optional[str]) -> Optional[str]:
    """Extract canonical edition or cut title from media filenames, paths, or item titles."""
    for cand in candidates:
        if not cand:
            continue
        cand_str = str(cand).strip()
        for pat, canonical in EDITION_PATTERNS:
            if re.search(pat, cand_str):
                return canonical
    return None

AUDIO_CODEC_PATTERNS = [
    ("truehd_atmos", re.compile(r'(?i)^(?=.*\btrue[ ._-]?hd(\b|\d))(?=.*\batmos(\b|\d))')),
    ("dtsx", re.compile(r'(?i)\b(dts[-_. ]?x7?)\b(?![-_. ]?(26[456]))')),
    ("plus_atmos", re.compile(r'(?i)^(?=.*\b((dd[p+])|(dolby[ ._-]digital[ ._-]plus)|(e[ ._-]?ac3)\b))(?=.*\batmos(\b|\d))')),
    ("dolby_atmos", re.compile(r'(?i)\batmos(\b|\d)')),
    ("truehd", re.compile(r'(?i)\btrue[ ._-]?hd(\b|\d)')),
    ("ma", re.compile(r'(?i)\bdts[ ._-]?(hd[ ._-])?(ma|xll|hd)(\b|\d)(?![ ._-]hra)')),
    ("flac", re.compile(r'(?i)\bflac(\b|\d)')),
    ("pcm", re.compile(r'(?i)\bl?pcm(\b|\d)')),
    ("hra", re.compile(r'(?i)\bdts[ ._-]?(hd[ ._-])?(hr|hra|hi|ra)(\b|\d)')),
    ("plus", re.compile(r'(?i)\b(dd[p+])|(dolby[ ._-]digital[ ._-]plus)|(e[ ._-]?ac3)\b')),
    ("dtses", re.compile(r'(?i)\bdts[ ._-]?es(\b|\d)')),
    ("dts", re.compile(r'(?i)\bdts(\b|\d)')),
    ("digital", re.compile(r'(?i)\b(dd)|(ac3)|(dolby)(\b|\d)')),
    ("aac", re.compile(r'(?i)\b(aac|stereo|2\.0)\b')),
    ("mp3", re.compile(r'(?i)\bmp3(\b|\d)')),
    ("opus", re.compile(r'(?i)\b(?<!-)OPUS(\b|\d)')),
]

VIDEO_FORMAT_PATTERNS = [
    ("REMUX", re.compile(r'(?i)\bremux\b')),
    ("BLU-RAY", re.compile(r'(?i)\b(blu[ ._-]?ray|bd|br|hd[ ._-]?dvd)\b')),
    ("WEB", re.compile(r'(?i)web[ ._-]?(dl|rip)')),
    ("HDTV", re.compile(r'(?i)\bhd[ ._-]?tv\b')),
    ("DVD", re.compile(r'(?i)\bdvd\b')),
    ("SDTV", re.compile(r'(?i)\bsd[ ._-]?tv\b')),
    ("TELESYNC", re.compile(r'(?i)\b(TS|HDTS|TELESYNC)\b')),
    ("CAM", re.compile(r'(?i)\b(HQ|HD)?CAM\b')),
]

def compute_layers_recipe_hash(layers: List[Dict[str, Any]]) -> str:
    """Compute recipe hash while omitting raw in-memory PIL image elements."""
    serializable = []
    for l in layers:
        item = {}
        for k, v in l.items():
            if k == "image_element":
                continue
            item[k] = v
        serializable.append(item)
    return hashlib.md5(json.dumps(serializable, sort_keys=True).encode()).hexdigest()

# ==============================================================================
# DYNAMIC OVERLAY SYNC ENGINE:
# Renders in-memory dynamic badges and overlays onto media assets for Plex/Jellyfin/Emby.
# Original artwork remains untouched; overlaid artwork is synced non-destructively.
# ==============================================================================

logger = logging.getLogger("overlay_sync_service")


# ==============================================================================
# LANGUAGE, FLAG & RATING MAPPINGS
# ==============================================================================

LANGUAGE_MAP = {
    # 3-letter ISO-639-2 codes to 2-letter
    "deu": "de", "ger": "de",
    "eng": "en",
    "jpn": "ja",
    "zho": "zh", "chi": "zh",
    "kor": "ko",
    "fra": "fr", "fre": "fr",
    "spa": "es",
    "ita": "it",
    "rus": "ru",
    "por": "pt",
    "pol": "pl",
    "nld": "nl", "dut": "nl",
    "dan": "da",
    "swe": "sv",
    "nor": "no",
    "fin": "fi",
    "ukr": "uk",
    "tur": "tr",
    "ara": "ar",
    "hin": "hi",
    "ell": "el", "gre": "el",
    "ces": "cs", "cze": "cs",
    "hun": "hu",
    "ron": "ro", "rum": "ro",
    "vie": "vi",
    "tha": "th",
    "ind": "id",
    "heb": "he",
    # Common full language names
    "german": "de", "deutsch": "de",
    "english": "en",
    "japanese": "ja",
    "chinese": "zh",
    "korean": "ko",
    "french": "fr", "français": "fr",
    "spanish": "es", "español": "es",
    "italian": "it", "italiano": "it",
    "russian": "ru",
    "portuguese": "pt",
    "polish": "pl",
    "dutch": "nl",
    "danish": "da",
    "swedish": "sv",
    "norwegian": "no",
    "finnish": "fi",
    "ukrainian": "uk",
    "turkish": "tr",
    "arabic": "ar",
    "hindi": "hi",
    "greek": "el",
    "czech": "cs",
    "hungarian": "hu",
    "romanian": "ro",
    "vietnamese": "vi",
    "thai": "th",
    "indonesian": "id",
    "hebrew": "he",
}

LANGUAGE_TO_FLAG_MAP = {
    "de": "de.png",
    "en": "us.png",
    "ja": "jp.png",
    "zh": "cn.png",
    "ko": "kr.png",
    "fr": "fr.png",
    "es": "es.png",
    "it": "it.png",
    "ru": "ru.png",
    "pt": "pt.png",
    "pl": "pl.png",
    "nl": "nl.png",
    "da": "dk.png",
    "sv": "se.png",
    "no": "no.png",
    "fi": "fi.png",
    "uk": "ua.png",
    "tr": "tr.png",
    "ar": "sa.png",
    "hi": "in.png",
    "el": "gr.png",
    "cs": "cz.png",
    "hu": "hu.png",
    "ro": "ro.png",
    "vi": "vn.png",
    "th": "th.png",
    "id": "id.png",
    "he": "il.png",
}

COMMONSENSE_RATING_MAP = {
    "0": "0+",
    "0+": "0+",
    "FSK-0": "0+",
    "FSK 0": "0+",
    "FSK0": "0+",
    "DE/0": "0+",
    "G": "1+",
    "TV-G": "1+",
    "TV-Y": "1+",
    "TV-Y7": "7+",
    "PG": "6+",
    "TV-PG": "7+",
    "6": "6+",
    "FSK-6": "6+",
    "FSK 6": "6+",
    "12": "12+",
    "12A": "12+",
    "FSK-12": "12+",
    "FSK 12": "12+",
    "PG-13": "13+",
    "TV-14": "14+",
    "14": "14+",
    "15": "15+",
    "16": "16+",
    "FSK-16": "16+",
    "FSK 16": "16+",
    "R": "17+",
    "NC-17": "17+",
    "TV-MA": "17+",
    "18": "18+",
    "FSK-18": "18+",
    "FSK 18": "18+",
    "M": "15+",
    "MA15+": "15+",
}


def normalize_commonsense_rating(raw_rating: Optional[str]) -> Optional[str]:
    """Map Plex / TMDb / IMDb contentRating into Common Sense age badge string."""
    if not raw_rating:
        return None
    cleaned = str(raw_rating).strip()
    if not cleaned or cleaned.lower() in ("none", "off", "false", "unknown", "null"):
        return None
    # Strip prefix like "gb/", "us/", "de/", etc.
    if "/" in cleaned:
        cleaned = cleaned.split("/")[-1].strip()
    cleaned_upper = cleaned.upper()
    if cleaned_upper in COMMONSENSE_RATING_MAP:
        return COMMONSENSE_RATING_MAP[cleaned_upper]
    # Check digits directly (e.g. "0", "15", "16", "18", "6", "12")
    digits = "".join(ch for ch in cleaned if ch.isdigit())
    if digits:
        return f"{digits}+"
    return None


def resolve_library_rules(
    library_name: str,
    media_type: str,
    library_rules_map: Dict[str, Any]
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Resolve active overlay rules from config.yml for a given media server library.
    Handles matching Plex/Jellyfin/Emby library names (e.g. PosterizarrTestMovies)
    against rules configured for 'Movies', 'TV Shows', '4K Movies', etc.
    """
    if not library_rules_map:
        return "none", []

    clean_lib = library_name.strip().lower()

    # 1. Exact match
    if clean_lib in library_rules_map:
        return clean_lib, library_rules_map[clean_lib]

    # 2. Check canonical category match based on media type & library name hints
    is_4k = "4k" in clean_lib or "uhd" in clean_lib or "2160" in clean_lib
    is_kids = "kid" in clean_lib or "children" in clean_lib or "family" in clean_lib
    is_anime = "anime" in clean_lib or "manga" in clean_lib

    if media_type == "movie" or "movie" in clean_lib or "film" in clean_lib:
        if is_4k and "4k movies" in library_rules_map:
            return "4k movies", library_rules_map["4k movies"]
        if is_kids and "kids movies" in library_rules_map:
            return "kids movies", library_rules_map["kids movies"]
        if is_anime and "anime" in library_rules_map:
            return "anime", library_rules_map["anime"]
        if not is_kids and not is_anime and not is_4k and "movies" in library_rules_map:
            return "movies", library_rules_map["movies"]

    if media_type == "show" or "show" in clean_lib or "series" in clean_lib or "tv" in clean_lib:
        if is_4k and "4k tv shows" in library_rules_map:
            return "4k tv shows", library_rules_map["4k tv shows"]
        if is_anime and "anime" in library_rules_map:
            return "anime", library_rules_map["anime"]
        if not is_anime and not is_4k and "tv shows" in library_rules_map:
            return "tv shows", library_rules_map["tv shows"]

    # 3. Substring matching (only if match key is specific enough)
    for k, v in library_rules_map.items():
        if k and (k == clean_lib or (len(k) >= 3 and (k in clean_lib or clean_lib in k))):
            return k, v

    # Fallback to default only if explicitly configured
    if "default" in library_rules_map:
        return "default", library_rules_map["default"]

    return "none", []


# ==============================================================================
# SECURITY UTILITIES
# ==============================================================================

def is_safe_url(url: str, allow_private: bool = True, allow_loopback: bool = True) -> bool:
    """Validate that URL is using http/https and blocks metadata/multicast."""
    if not url:
        return False
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ["http", "https"]:
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        if hostname.lower() in ["localhost", "127.0.0.1", "::1"]:
            return allow_loopback
        try:
            ip_addr = socket.gethostbyname(hostname)
            ip = ipaddress.ip_address(ip_addr)
            if ip.is_link_local or ip.is_multicast:
                return False
            if not allow_private and ip.is_private:
                return False
            return True
        except Exception:
            return False
    except Exception:
        return False


# ==============================================================================
# CONFIG & CREDENTIAL HELPERS
# ==============================================================================

def has_asset_files(dir_path: Path) -> bool:
    """Check if a directory contains image assets (posters, backgrounds) either directly or in subfolders."""
    if not dir_path or not dir_path.is_dir():
        return False
    try:
        for p in dir_path.iterdir():
            if p.is_file() and p.suffix.lower() in ('.jpg', '.png', '.webp', '.jpeg'):
                return True
            if p.is_dir():
                try:
                    for sub in p.iterdir():
                        if sub.is_file() and sub.suffix.lower() in ('.jpg', '.png', '.webp', '.jpeg'):
                            return True
                        if sub.is_dir():
                            for sub2 in sub.iterdir():
                                if sub2.is_file() and sub2.suffix.lower() in ('.jpg', '.png', '.webp', '.jpeg'):
                                    return True
                except (PermissionError, OSError):
                    pass
    except (PermissionError, OSError):
        pass
    return False


def resolve_configured_asset_path(raw_path: Optional[Union[str, Path]]) -> Path:
    """
    Intelligently resolve the configured AssetPath across platforms.
    On Windows host environments, configs often contain Linux/Docker style paths like '/assets',
    which Python resolves to 'C:\\assets'. If C:\\assets is empty or nonexistent while the actual
    assets reside on another drive (e.g. 'P:\\assets'), this automatically detects and resolves to
    the correct host directory with asset files.
    """
    if not raw_path:
        default_dir = Path(__file__).resolve().parent.parent.parent / "assets"
        return default_dir

    p = Path(raw_path)
    if p.exists() and has_asset_files(p):
        return p

    if os.name == "nt":
        raw_str = str(raw_path).replace("\\", "/").strip()
        parts = [part for part in raw_str.split("/") if part and not part.endswith(":")]
        rel_subpath = "/".join(parts) if parts else "assets"

        candidate_drives = ["P", "D", "E", "F", "G", "C", "M", "V"]
        for drive in candidate_drives:
            cand = Path(f"{drive}:/{rel_subpath}")
            if cand.exists() and has_asset_files(cand):
                return cand

        for drive in candidate_drives:
            cand = Path(f"{drive}:/{rel_subpath}")
            if cand.exists() and cand.is_dir():
                return cand

    return p


def get_server_credentials(config_path: Path) -> Dict[str, Any]:
    """Extract credentials and enabled statuses for Plex, Jellyfin, and Emby."""
    info = {
        "plex": {"enabled": False, "url": None, "token": None, "excluded_libs": []},
        "jellyfin": {"enabled": False, "url": None, "api_key": None, "excluded_libs": []},
        "emby": {"enabled": False, "url": None, "api_key": None, "excluded_libs": []},
        "asset_path": None,
    }
    if not config_path.exists():
        return info

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)

        # Asset path
        ap = cfg.get("AssetPath") or cfg.get("PrerequisitePart", {}).get("AssetPath")
        if ap:
            info["asset_path"] = resolve_configured_asset_path(ap)

        # Plex
        p_url = cfg.get("PlexUrl") or cfg.get("PlexPart", {}).get("PlexUrl")
        p_tok = cfg.get("PlexToken") or cfg.get("ApiPart", {}).get("PlexToken")
        p_use = cfg.get("UsePlex") or cfg.get("PlexPart", {}).get("UsePlex")
        p_ex = cfg.get("PlexLibstoExclude") or cfg.get("PlexPart", {}).get("LibstoExclude", [])
        if p_url and is_safe_url(p_url):
            info["plex"] = {
                "enabled": str(p_use).lower() in ["true", "1", "yes"],
                "url": p_url.rstrip('/'),
                "token": p_tok,
                "excluded_libs": p_ex or []
            }

        # Jellyfin
        jf_url = cfg.get("JellyfinUrl") or cfg.get("JellyfinPart", {}).get("JellyfinUrl")
        jf_key = (
            cfg.get("JellyfinAPIKey")
            or cfg.get("JellyfinApiKey")
            or cfg.get("ApiPart", {}).get("JellyfinAPIKey")
            or cfg.get("ApiPart", {}).get("JellyfinApiKey")
        )
        jf_use = cfg.get("UseJellyfin") or cfg.get("JellyfinPart", {}).get("UseJellyfin")
        jf_ex = cfg.get("JellyfinLibstoExclude") or cfg.get("JellyfinPart", {}).get("LibstoExclude", [])
        if jf_url and is_safe_url(jf_url):
            info["jellyfin"] = {
                "enabled": str(jf_use).lower() in ["true", "1", "yes"],
                "url": jf_url.rstrip('/'),
                "api_key": jf_key,
                "excluded_libs": jf_ex or []
            }

        # Emby
        em_url = cfg.get("EmbyUrl") or cfg.get("EmbyPart", {}).get("EmbyUrl")
        em_key = (
            cfg.get("EmbyAPIKey")
            or cfg.get("EmbyApiKey")
            or cfg.get("ApiPart", {}).get("EmbyAPIKey")
            or cfg.get("ApiPart", {}).get("EmbyApiKey")
        )
        em_use = cfg.get("UseEmby") or cfg.get("EmbyPart", {}).get("UseEmby")
        em_ex = cfg.get("EmbyLibstoExclude") or cfg.get("EmbyPart", {}).get("LibstoExclude", [])
        if em_url and is_safe_url(em_url):
            info["emby"] = {
                "enabled": str(em_use).lower() in ["true", "1", "yes"],
                "url": em_url.rstrip('/'),
                "api_key": em_key,
                "excluded_libs": em_ex or []
            }
        # TMDb Token
        tmdb_tok = cfg.get("tmdbtoken") or cfg.get("ApiPart", {}).get("tmdbtoken")
        info["tmdb_token"] = tmdb_tok
        if "plex" in info and isinstance(info["plex"], dict):
            info["plex"]["tmdb_token"] = tmdb_tok
        if "jellyfin" in info and isinstance(info["jellyfin"], dict):
            info["jellyfin"]["tmdb_token"] = tmdb_tok
        if "emby" in info and isinstance(info["emby"], dict):
            info["emby"]["tmdb_token"] = tmdb_tok
    except Exception as e:
        logger.error(f"[OverlaySync] Failed parsing credentials: {e}")

    return info


_TMDB_SHOW_CACHE: Dict[str, Dict[str, Any]] = {}
_TMDB_MOVIE_CR_CACHE: Dict[str, Optional[str]] = {}

async def resolve_tmdb_show_info(
    tmdb_id: Optional[str],
    tmdb_token: Optional[str],
    http_client: httpx.AsyncClient,
    server_type: Optional[str] = None,
    item_id: Optional[str] = None,
    title: str = "",
    year: Optional[int] = None
) -> Dict[str, Any]:
    """
    Fetches show status, networks, and age/content rating from persistent cache or TMDb API.
    Maps status to lowercase canonical values: 'ended', 'returning', 'canceled', 'airing'.
    Results are cached in SQLite media_ratings_cache with tiered TTL so changes are picked up on schedule.
    """
    clean_id = str(tmdb_id).strip() if tmdb_id else ""

    # 1. Check persistent SQLite ratings/status cache first
    try:
        from ratings_service import ratings_cache
        if server_type and item_id:
            cached_status = ratings_cache.get_show_status(server_type, str(item_id), clean_id or None)
            if cached_status and cached_status.get("status"):
                return cached_status
    except Exception as cache_read_err:
        logger.debug(f"[OverlaySync] Persistent show cache read error: {cache_read_err}")

    # 2. Check in-memory session cache
    if clean_id and clean_id in _TMDB_SHOW_CACHE:
        return _TMDB_SHOW_CACHE[clean_id]

    if not clean_id:
        return {}

    # Try user token, fallback to Kometa public key
    token_to_use = tmdb_token or "9999d4f11f041b789816ccd53798b525"
    headers = {}
    params = {"append_to_response": "content_ratings"}
    if len(str(token_to_use)) > 40:
        headers["Authorization"] = f"Bearer {token_to_use}"
    else:
        params["api_key"] = token_to_use

    try:
        url = f"https://api.themoviedb.org/3/tv/{clean_id}"
        resp = await http_client.get(url, headers=headers, params=params, timeout=10.0)
        if resp.status_code == 200:
            data = resp.json()
            raw_st = str(data.get("status") or "").strip().lower()
            status_map = {
                "ended": "ended",
                "concluded": "ended",
                "returning series": "returning",
                "returning": "returning",
                "continuing": "returning",
                "canceled": "canceled",
                "cancelled": "canceled",
                "in production": "airing",
                "planned": "airing",
                "pilot": "airing",
            }
            norm_st = status_map.get(raw_st, raw_st)
            nets = [n.get("name") for n in data.get("networks", []) if n.get("name")]

            # Extract content rating
            content_rating = None
            cr_list = data.get("content_ratings", {}).get("results", [])
            for pref in ["DE", "US", "GB"]:
                for r_item in cr_list:
                    if r_item.get("iso_3166_1") == pref and r_item.get("rating"):
                        content_rating = r_item.get("rating")
                        break
                if content_rating:
                    break
            if not content_rating and cr_list:
                for r_item in cr_list:
                    if r_item.get("rating"):
                        content_rating = r_item.get("rating")
                        break

            info = {
                "status": norm_st,
                "networks": nets,
                "network": nets[0] if nets else None,
                "content_rating": content_rating
            }
            _TMDB_SHOW_CACHE[clean_id] = info

            # Save to persistent SQLite ratings & status cache
            try:
                from ratings_service import ratings_cache
                if server_type and item_id:
                    ratings_cache.save_show_status(
                        server_type=server_type,
                        item_id=str(item_id),
                        title=title,
                        year=year,
                        tmdb_id=clean_id,
                        status=norm_st,
                        network=info["network"],
                        content_rating=content_rating,
                        source="tmdb"
                    )
            except Exception as cache_save_err:
                logger.debug(f"[OverlaySync] Persistent show cache save error: {cache_save_err}")

            return info
    except Exception as e:
        logger.debug(f"[OverlaySync] TMDb lookup error for TV show {clean_id}: {e}")
    return {}



async def resolve_tmdb_movie_content_rating(
    tmdb_id: str,
    tmdb_token: Optional[str],
    http_client: httpx.AsyncClient
) -> Optional[str]:
    """Fetches movie certification / age rating from TMDb API release_dates."""
    if not tmdb_id:
        return None
    clean_id = str(tmdb_id).strip()
    if clean_id in _TMDB_MOVIE_CR_CACHE:
        return _TMDB_MOVIE_CR_CACHE[clean_id]

    token_to_use = tmdb_token or "9999d4f11f041b789816ccd53798b525"
    headers = {}
    params = {}
    if len(str(token_to_use)) > 40:
        headers["Authorization"] = f"Bearer {token_to_use}"
    else:
        params["api_key"] = token_to_use

    try:
        url = f"https://api.themoviedb.org/3/movie/{clean_id}/release_dates"
        resp = await http_client.get(url, headers=headers, params=params, timeout=10.0)
        if resp.status_code == 200:
            results = resp.json().get("results", [])
            found_cert = None
            for pref in ["DE", "US", "GB"]:
                for r in results:
                    if r.get("iso_3166_1") == pref:
                        for rd in r.get("release_dates", []):
                            cert = str(rd.get("certification") or "").strip()
                            if cert:
                                found_cert = cert
                                break
                    if found_cert:
                        break
                if found_cert:
                    break
            if not found_cert and results:
                for r in results:
                    for rd in r.get("release_dates", []):
                        cert = str(rd.get("certification") or "").strip()
                        if cert:
                            found_cert = cert
                            break
                    if found_cert:
                        break
            _TMDB_MOVIE_CR_CACHE[clean_id] = found_cert
            return found_cert
    except Exception as e:
        logger.debug(f"[OverlaySync] TMDb release_dates lookup error for movie {clean_id}: {e}")
    return None


# ==============================================================================
# ASSET DISCOVERY & MATCHING HELPERS
# ==============================================================================

def compute_file_fingerprint(file_path: Path) -> Tuple[float, int, str]:
    """Compute (mtime, size, md5_hash) for change detection."""
    stat = file_path.stat()
    mtime = stat.st_mtime
    size = stat.st_size
    fast_str = f"{mtime}_{size}_{file_path.name}"
    md5_hash = hashlib.md5(fast_str.encode()).hexdigest()
    return mtime, size, md5_hash


_DIR_SUBDIRS_CACHE: Dict[str, Tuple[float, List[Path]]] = {}
_DIR_CACHE_TTL_SECS = 60.0

def get_cached_subdirs(parent_dir: Path, dir_cache: Optional[Dict[str, Any]] = None) -> List[Path]:
    """Retrieve subdirectories with in-memory caching to eliminate massive filesystem disk overhead."""
    if not parent_dir or not parent_dir.exists():
        return []
    p_key = str(parent_dir.resolve())
    if dir_cache is not None and "subdirs" in dir_cache and p_key in dir_cache["subdirs"]:
        return dir_cache["subdirs"][p_key]

    now = time.time()
    if p_key in _DIR_SUBDIRS_CACHE:
        cached_time, subdirs = _DIR_SUBDIRS_CACHE[p_key]
        if (now - cached_time) < _DIR_CACHE_TTL_SECS:
            if dir_cache is not None:
                dir_cache.setdefault("subdirs", {})[p_key] = subdirs
            return subdirs

    try:
        subdirs = [d for d in parent_dir.iterdir() if d.is_dir()]
        _DIR_SUBDIRS_CACHE[p_key] = (now, subdirs)
        if dir_cache is not None:
            dir_cache.setdefault("subdirs", {})[p_key] = subdirs
        return subdirs
    except Exception:
        return []


class DirectoryIndex:
    """High-speed in-memory directory index for O(1) asset directory matching."""
    __slots__ = (
        "parent_dir", "subdirs", "by_name", "by_clean", "by_imdb", "by_tmdb",
        "by_tvdb", "by_stripped", "by_stripped_noyear"
    )

    def __init__(self, parent_dir: Path):
        self.parent_dir = parent_dir
        try:
            self.subdirs = [d for d in parent_dir.iterdir() if d.is_dir()]
        except Exception:
            self.subdirs = []

        self.by_name: Dict[str, Path] = {}
        self.by_clean: Dict[str, Path] = {}
        self.by_imdb: Dict[str, Path] = {}
        self.by_tmdb: Dict[str, Path] = {}
        self.by_tvdb: Dict[str, Path] = {}
        self.by_stripped: Dict[str, Path] = {}
        self.by_stripped_noyear: Dict[Tuple[str, str], Path] = {}

        id_regex = re.compile(r'\s*[\[\{](?:imdb|tmdb|tvdb)-[^\]\}]+[\]\}]', flags=re.I)
        imdb_regex = re.compile(r'(?i)imdb-([a-z0-9]+)')
        tmdb_regex = re.compile(r'(?i)tmdb-([0-9]+)')
        tvdb_regex = re.compile(r'(?i)tvdb-([0-9]+)')
        year_regex = re.compile(r'\(?(\d{4})\)?')
        non_alnum = re.compile(r'[\W_]+')

        for d in self.subdirs:
            d_name = d.name
            d_lower = d_name.lower()
            self.by_name[d_lower] = d
            clean_d = non_alnum.sub('', d_lower)
            if clean_d:
                self.by_clean[clean_d] = d

            m_imdb = imdb_regex.search(d_name)
            if m_imdb:
                self.by_imdb[m_imdb.group(1).lower()] = d
            m_tmdb = tmdb_regex.search(d_name)
            if m_tmdb:
                self.by_tmdb[m_tmdb.group(1).lower()] = d
            m_tvdb = tvdb_regex.search(d_name)
            if m_tvdb:
                self.by_tvdb[m_tvdb.group(1).lower()] = d

            stripped = id_regex.sub('', d_name).strip()
            stripped_clean = non_alnum.sub('', stripped.lower())
            if stripped_clean:
                self.by_stripped[stripped_clean] = d

            y_match = year_regex.search(stripped)
            if y_match:
                y_val = y_match.group(1)
                s_noyear = non_alnum.sub('', stripped.replace(y_val, '').lower())
                if s_noyear:
                    self.by_stripped_noyear[(s_noyear, y_val)] = d


def find_clean_asset(
    assets_dir: Path,
    library_name: str,
    root_folder: str,
    title: str,
    asset_type: str = "poster",
    imdb_id: Optional[str] = None,
    tmdb_id: Optional[str] = None,
    tvdb_id: Optional[str] = None,
    year: Optional[Union[int, str]] = None,
    dir_cache: Optional[Dict[str, Any]] = None
) -> Optional[Path]:
    """Locate clean asset file on disk inside AssetPath/LibraryName/RootFolder/ or AssetPath/RootFolder/ with O(1) indexed directory matching."""
    target_dirs = []

    # 1. Look inside library folder if it exists
    lib_dir = assets_dir / library_name
    if not lib_dir.exists():
        for cand in get_cached_subdirs(assets_dir, dir_cache):
            if cand.name.lower() == library_name.lower():
                lib_dir = cand
                break

    # Build candidates
    folder_candidates = [root_folder, title]
    clean_no_year = re.sub(r'\s*\(\d{4}\)', '', root_folder).strip()
    if clean_no_year and clean_no_year not in folder_candidates:
        folder_candidates.append(clean_no_year)
    title_no_year = re.sub(r'\s*\(\d{4}\)', '', title).strip()
    if title_no_year and title_no_year not in folder_candidates:
        folder_candidates.append(title_no_year)

    def _search_in_directory(parent_dir: Path) -> List[Path]:
        if not parent_dir or not parent_dir.exists():
            return []

        idx_key = str(parent_dir.resolve())
        idx = None
        if dir_cache is not None:
            idx = dir_cache.setdefault("dir_indices", {}).get(idx_key)
        if idx is None:
            idx = DirectoryIndex(parent_dir)
            if dir_cache is not None:
                dir_cache.setdefault("dir_indices", {})[idx_key] = idx

        # Priority 1: Match by external ID tag in folder name (O(1))
        if imdb_id:
            m_d = idx.by_imdb.get(str(imdb_id).lower().strip())
            if m_d:
                return [m_d]
        if tmdb_id:
            m_d = idx.by_tmdb.get(str(tmdb_id).lower().strip())
            if m_d:
                return [m_d]
        if tvdb_id:
            m_d = idx.by_tvdb.get(str(tvdb_id).lower().strip())
            if m_d:
                return [m_d]

        # Priority 2: Direct folder candidate match (O(1))
        for cand in folder_candidates:
            if not cand:
                continue
            cand_l = cand.lower()
            if cand_l in idx.by_name:
                return [idx.by_name[cand_l]]

        # Priority 3: Match stripped folder name (removing [imdb-xxx], etc.) (O(1))
        non_alnum = re.compile(r'[\W_]+')
        for cand in folder_candidates:
            if not cand:
                continue
            cand_clean = non_alnum.sub('', cand.lower())
            if cand_clean in idx.by_stripped:
                return [idx.by_stripped[cand_clean]]
            if cand_clean in idx.by_clean:
                return [idx.by_clean[cand_clean]]

        # Priority 4: Match with year stripped if year is known (O(1))
        if year:
            y_str = str(year)
            for cand in folder_candidates:
                if not cand:
                    continue
                c_noyear = non_alnum.sub('', cand.replace(y_str, '').lower())
                if (c_noyear, y_str) in idx.by_stripped_noyear:
                    return [idx.by_stripped_noyear[(c_noyear, y_str)]]

        # Fallback linear scan if index had an unforeseen edge case
        subdirs = idx.subdirs
        for d in subdirs:
            dl = d.name.lower()
            if imdb_id and f"imdb-{str(imdb_id).lower()}" in dl:
                return [d]
            if tmdb_id and f"tmdb-{str(tmdb_id).lower()}" in dl:
                return [d]
            if tvdb_id and f"tvdb-{str(tvdb_id).lower()}" in dl:
                return [d]

        for cand in folder_candidates:
            if not cand:
                continue
            p = parent_dir / cand
            if p.exists() and p.is_dir():
                return [p]

        for d in subdirs:
            stripped = re.sub(r'\s*[\[\{](?:imdb|tmdb|tvdb)-[^\]\}]+[\]\}]', '', d.name, flags=re.I).strip()
            stripped_clean = non_alnum.sub('', stripped.lower())
            for cand in folder_candidates:
                if not cand:
                    continue
                cand_clean = non_alnum.sub('', cand.lower())
                if stripped == cand or stripped_clean == cand_clean:
                    return [d]

        if year:
            y_str = str(year)
            for d in subdirs:
                stripped = re.sub(r'\s*[\[\{](?:imdb|tmdb|tvdb)-[^\]\}]+[\]\}]', '', d.name, flags=re.I).strip()
                if y_str in stripped:
                    s_noyear = non_alnum.sub('', stripped.replace(y_str, '').lower())
                    for cand in folder_candidates:
                        if not cand:
                            continue
                        c_noyear = non_alnum.sub('', cand.replace(y_str, '').lower())
                        if s_noyear and s_noyear == c_noyear:
                            return [d]

        return []

    # Search inside library directory
    if lib_dir and lib_dir.exists():
        target_dirs = _search_in_directory(lib_dir)

    # Search directly in assets_dir (flat structure fallback)
    if not target_dirs:
        target_dirs = _search_in_directory(assets_dir)

    if not target_dirs:
        return None

    target_dir = target_dirs[0]

    # Fast cached file scan within target_dir
    td_key = f"files_{target_dir.resolve()}"
    files_map = None
    if dir_cache is not None:
        files_map = dir_cache.get(td_key)
    if files_map is None:
        try:
            files_map = {f.name.lower(): f for f in target_dir.iterdir() if f.is_file()}
        except Exception:
            files_map = {}
        if dir_cache is not None:
            dir_cache[td_key] = files_map

    exts = [".jpg", ".png", ".webp", ".jpeg"]
    if asset_type == "poster":
        stems = ["poster", "cover", "folder", f"{target_dir.name}_poster", f"{target_dir.name}", "show", "default"]
    elif asset_type == "background":
        stems = ["background", "fanart", "backdrop", "art", f"{target_dir.name}_background"]
    else:
        stems = ["poster", "cover"]

    for ext in exts:
        for stem in stems:
            cand_fname = f"{stem}{ext}".lower()
            if cand_fname in files_map:
                cand_file = files_map[cand_fname]
                try:
                    if cand_file.resolve().is_relative_to(assets_dir.resolve()):
                        return cand_file
                except Exception:
                    return cand_file

    return None


def find_season_poster(
    show_dir: Path,
    s_num: int,
    r_folder: str = "",
    dir_cache: Optional[Dict[str, Any]] = None
) -> Optional[Path]:
    """Find matching season poster on disk for season number s_num with fast in-memory caching."""
    if not show_dir or not show_dir.exists():
        return None

    show_key = f"files_{show_dir.resolve()}"
    files_map = None
    if dir_cache is not None:
        files_map = dir_cache.get(show_key)

    if files_map is None:
        try:
            files_map = {f.name.lower(): f for f in show_dir.iterdir() if f.is_file()}
        except Exception:
            files_map = {}
        if dir_cache is not None:
            dir_cache[show_key] = files_map

    allowed_exts = [".jpg", ".png", ".webp", ".jpeg"]
    stems = [
        f"Season{s_num:02d}",
        f"Season{s_num}",
        f"Season {s_num:02d}",
        f"Season {s_num}",
        f"season{s_num:02d}",
        f"season{s_num}",
        f"season {s_num:02d}",
        f"season {s_num}",
    ]
    clean_r = re.sub(r'[\W_]+', '', str(r_folder))
    if clean_r:
        stems.extend([f"{clean_r}_Season{s_num:02d}", f"{clean_r}_Season{s_num}"])
    if s_num == 0:
        stems.extend(["Specials", "specials"])
        if clean_r:
            stems.extend([f"{clean_r}_Specials", f"{clean_r}_specials"])

    for stem in stems:
        for ext in allowed_exts:
            fname = f"{stem}{ext}".lower()
            if fname in files_map:
                return files_map[fname]
    return None


def find_titlecard(
    show_dir: Path,
    s_num: int,
    ep_num: int,
    dir_cache: Optional[Dict[str, Any]] = None
) -> Optional[Path]:
    """
    Locates clean episode titlecard image file on disk in show asset folder.
    Supports standard S01E01, padded, unpadded, and season subdirectory layouts.
    Uses cached titlecard index to prevent catastrophic recursive disk scans.
    """
    if not show_dir or not show_dir.exists():
        return None

    show_key = f"tc_{show_dir.resolve()}"
    tc_map = None
    if dir_cache is not None:
        tc_map = dir_cache.get(show_key)

    if tc_map is None:
        tc_map = {}
        tag_re = re.compile(r'(?i)\bs?(\d{1,3})[ex](\d{1,3})\b')
        img_exts = {".jpg", ".jpeg", ".png", ".webp"}

        try:
            # 1. Direct files in show_dir
            for f in show_dir.iterdir():
                if f.is_file() and f.suffix.lower() in img_exts:
                    m = tag_re.search(f.name)
                    if m:
                        s_idx = int(m.group(1))
                        e_idx = int(m.group(2))
                        k = f"s{s_idx:02d}e{e_idx:02d}"
                        if k not in tc_map:
                            tc_map[k] = f

            # 2. Season subfolders in show_dir (e.g. "Season 01", "Season 1")
            for d in show_dir.iterdir():
                if d.is_dir() and "season" in d.name.lower():
                    for f in d.iterdir():
                        if f.is_file() and f.suffix.lower() in img_exts:
                            m = tag_re.search(f.name)
                            if m:
                                s_idx = int(m.group(1))
                                e_idx = int(m.group(2))
                                k = f"s{s_idx:02d}e{e_idx:02d}"
                                if k not in tc_map:
                                    tc_map[k] = f
        except Exception:
            pass

        if dir_cache is not None:
            dir_cache[show_key] = tc_map

    target_tag = f"s{s_num:02d}e{ep_num:02d}"
    if target_tag in tc_map:
        return tc_map[target_tag]

    # Standard fallback patterns
    patterns = [
        f"S{s_num:02d}E{ep_num:02d}.jpg",
        f"S{s_num:02d}E{ep_num:02d}.png",
        f"s{s_num:02d}e{ep_num:02d}.jpg",
        f"s{s_num:02d}e{ep_num:02d}.png",
        f"S{s_num}E{ep_num}.jpg",
        f"S{s_num}E{ep_num}.png",
    ]
    for p in patterns:
        cand = show_dir / p
        if cand.exists() and cand.is_file():
            return cand

    season_subdirs = [
        f"Season {s_num:02d}",
        f"Season {s_num}",
        f"Season{s_num:02d}",
        f"Season{s_num}",
    ]
    for sub in season_subdirs:
        s_folder = show_dir / sub
        if s_folder.exists() and s_folder.is_dir():
            for p in patterns:
                cand = s_folder / p
                if cand.exists() and cand.is_file():
                    return cand

    return None


# ==============================================================================
# MULTI-RATING BADGE CLUSTER BUILDER
# ==============================================================================

def build_multi_rating_layers(
    ratings: Dict[str, Any],
    dyn_settings: Optional[Dict[str, Any]] = None,
    canvas_type: str = "landscape",
    assets_dir: Optional[Path] = None,
    fonts_dir: Optional[Path] = None,
    is_landscape: Optional[bool] = None,
    is_backdrop: Optional[bool] = None,
    sources: Optional[List[str]] = None,
    alignment: Optional[str] = None,
    position: Optional[str] = None,
    contrast_box: Optional[bool] = None
) -> List[Dict[str, Any]]:
    """
    Constructs overlay layers for multi-rating badges (IMDb, RT Critics, RT Audience, TMDb, Trakt, Letterboxd, Metacritic).
    Renders official provider logos, clean formatted scores, and optional translucent dark contrast pill boxes.
    """
    if is_backdrop:
        canvas_type = "landscape"
    elif is_landscape is not None:
        canvas_type = "landscape" if is_landscape else "portrait"

    if dyn_settings is None:
        from dynamic_overlays_service import get_dynamic_overlays_settings
        dyn_settings = get_dynamic_overlays_settings()
    else:
        dyn_settings = dict(dyn_settings)

    if sources is not None:
        dyn_settings["rating_sources"] = sources
    if alignment is not None:
        dyn_settings["rating_alignment"] = alignment
    if position is not None:
        dyn_settings["rating_position"] = position
    if contrast_box is not None:
        dyn_settings["rating_contrast_box"] = contrast_box

    if not ratings:
        return []

    if assets_dir is None:
        assets_dir = Path(__file__).resolve().parent.parent.parent / "Overlayfiles" / "dynamic_overlays" / "assets" / "rating"
    if fonts_dir is None:
        fonts_dir = Path(__file__).resolve().parent.parent.parent / "Overlayfiles" / "dynamic_overlays" / "fonts"

    inter_font = fonts_dir / "Inter-Bold.ttf"
    font_to_use = str(inter_font) if inter_font.exists() else None

    # Retrieve settings
    active_sources = dyn_settings.get("sources") or dyn_settings.get("rating_sources") or ["imdb", "tomatoes", "tmdb"]
    alignment = dyn_settings.get("orientation") or dyn_settings.get("rating_alignment", "horizontal")  # "horizontal" or "vertical"
    position = dyn_settings.get("position") or dyn_settings.get("rating_position", "top-right")
    contrast_box = dyn_settings.get("contrast_box", dyn_settings.get("rating_contrast_box", True))
    back_radius = int(dyn_settings.get("back_radius", 8))
    back_padding = int(dyn_settings.get("back_padding", 6))
    spacing = int(dyn_settings.get("spacing", 15))

    is_land = canvas_type == "landscape"
    font_size = int(dyn_settings.get("font_size", 28 if is_land else 44))
    scale_h = int(dyn_settings.get("scale_height", 36 if is_land else 52))
    badge_step_h = int(dyn_settings.get("badge_step_h", (120 + spacing) if is_land else (160 + spacing)))
    badge_step_v = int(dyn_settings.get("badge_step_v", (scale_h + spacing)))

    # Determine corners
    if "left" in position:
        h_align = "left"
        default_h_offset = 40
    elif "center" in position:
        h_align = "center"
        default_h_offset = 0
    else:
        h_align = "right"
        default_h_offset = 40

    if "bottom" in position:
        v_align = "bottom"
        default_v_offset = 50
    elif "center" in position:
        v_align = "center"
        default_v_offset = 0
    else:
        v_align = "top"
        default_v_offset = 40

    base_h_offset = int(dyn_settings.get("offset_x", dyn_settings.get("horizontal_offset", default_h_offset)))
    base_v_offset = int(dyn_settings.get("offset_y", dyn_settings.get("vertical_offset", default_v_offset)))

    # Ordered list of ratings to display for all requested sources (no 3-slot limitation!)
    ordered_items = []
    seen_sources = set()

    for raw_src in active_sources:
        src = str(raw_src).strip().lower()
        val = None
        canon_src = src
        if src in ratings:
            val = ratings.get(src)
        elif src in ["tomatoes", "rt", "rotten_tomatoes", "rt_critic"]:
            val = ratings.get("rt_critic") or ratings.get("tomatoes")
            canon_src = "tomatoes"
        elif src in ["tomatoesaudience", "rt_audience", "audience", "popcorn"]:
            val = ratings.get("rt_audience") or ratings.get("tomatoesaudience")
            canon_src = "tomatoesaudience"

        if canon_src not in seen_sources and val is not None and str(val).strip() not in ("", "0", "None"):
            ordered_items.append((canon_src, str(val).strip()))
            seen_sources.add(canon_src)

    if not ordered_items:
        return []

    layers = []
    for idx, (src, raw_val) in enumerate(ordered_items):
        # Format score and pick logo
        logo_file = None
        score_text = raw_val

        try:
            num = float(raw_val.replace("%", "").strip())
        except ValueError:
            num = None

        if src == "imdb":
            logo_file = assets_dir / "IMDb.png"
            if num is not None:
                if num > 10:
                    num /= 10.0
                score_text = f"{num:.1f}"
        elif src == "tomatoes":
            if num is not None:
                if num <= 1.0:
                    num *= 100.0
                score_text = f"{int(round(num))}%"
                logo_file = assets_dir / ("RT-Crit-Fresh.png" if num >= 60 else "RT-Crit-Rotten.png")
            else:
                logo_file = assets_dir / "Critic.png"
        elif src == "tomatoesaudience":
            if num is not None:
                if num <= 1.0:
                    num *= 100.0
                score_text = f"{int(round(num))}%"
                logo_file = assets_dir / ("RT-Aud-Fresh.png" if num >= 60 else "RT-Aud-Rotten.png")
            else:
                logo_file = assets_dir / "Audience.png"
        elif src == "tmdb":
            logo_file = assets_dir / "TMDb.png"
            if num is not None:
                if num > 10:
                    num /= 10.0
                score_text = f"{num:.1f}"
        elif src == "trakt":
            logo_file = assets_dir / "Trakt.png"
            if num is not None:
                if num <= 10.0:
                    score_text = f"{int(round(num * 10))}%"
                else:
                    score_text = f"{int(round(num))}%"
        elif src == "letterboxd":
            logo_file = assets_dir / "Letterboxd.png"
            if num is not None:
                score_text = f"{num:.1f}"
        elif src == "metacritic":
            logo_file = assets_dir / "Metacritic.png"
            if num is not None:
                score_text = f"{int(round(num))}"
        else:
            cand = assets_dir / f"{src.capitalize()}.png"
            logo_file = cand if cand.exists() else None

        # Calculate position for this badge
        if alignment == "vertical":
            cur_h_offset = base_h_offset
            cur_v_offset = base_v_offset + (idx * badge_step_v)
        else:
            # Horizontal row: step horizontally
            cur_h_offset = base_h_offset + (idx * badge_step_h)
            cur_v_offset = base_v_offset

        layer_def = {
            "name": f"multi_rating_{src}",
            "type": "badge",
            "text": score_text,
            "image_path": str(logo_file) if (logo_file and logo_file.exists()) else None,
            "font_path": font_to_use,
            "font_size": font_size,
            "font_color": "#FFFFFF",
            "horizontal_align": h_align,
            "horizontal_offset": cur_h_offset,
            "vertical_align": v_align,
            "vertical_offset": cur_v_offset,
            "addon_position": "left",
            "addon_offset": 8,
            "scale_height": scale_h,
        }

        if contrast_box:
            layer_def["back_color"] = "#000000B3"
            layer_def["back_radius"] = 8
            layer_def["back_padding"] = 6

        layers.append(layer_def)

    return layers


# ==============================================================================
# OVERLAY RECIPE BUILDER
# ==============================================================================

def build_overlay_layers_for_item(
    item_metadata: Dict[str, Any],
    library_rules: List[Dict[str, Any]],
    overlays_dir: Path,
    is_landscape: bool = False
) -> List[Dict[str, Any]]:
    """
    Constructs in-memory overlay layers for an individual media item based on active
    overlay configuration rules and item attributes (languages, commonsense, runtime, status, etc.).
    Uses the OverlayConfigEngine to resolve templates, queues, groups,
    and conditionals with high precision.
    """
    try:
        from overlay_resolver import OverlayConfigEngine, PROJECT_ROOT
        global _CACHED_CONFIG_ENGINE, _CACHED_CONFIG_ENGINE_ROOT
        project_root = overlays_dir.parent.parent
        if not (project_root / "Overlayfiles" / "dynamic_overlays").exists() and not (project_root / "defaults").exists():
            project_root = PROJECT_ROOT
        if "_CACHED_CONFIG_ENGINE" not in globals() or _CACHED_CONFIG_ENGINE is None or _CACHED_CONFIG_ENGINE_ROOT != project_root:
            _CACHED_CONFIG_ENGINE = OverlayConfigEngine(project_root)
            _CACHED_CONFIG_ENGINE_ROOT = project_root
        engine = _CACHED_CONFIG_ENGINE
        layers = engine.evaluate_item(item_metadata, library_rules)

        if layers:
            if is_landscape:
                layers = [l for l in layers if l.get("name") not in ("4K_banner", "resolution_banner")]
            else:
                has_banner = any(l.get("name") in ("4K_banner", "resolution_banner") for l in layers)
                if has_banner:
                    layers = [
                        l for l in layers
                        if str(l.get("name") or "").lower() not in (
                            "4k", "1080p", "720p", "576p", "480p", "dv", "hdr", "plus", "hlg", "force-filter", "resolution"
                        )
                    ]
            layers = [l for l in layers if str(l.get("name") or "").lower() != "force-filter"]
            item_level = "backdrop" if item_metadata.get("is_backdrop") else (
                "season" if item_metadata.get("is_season") else (
                    "episode" if (item_metadata.get("is_episode") or (is_landscape and not item_metadata.get("is_backdrop"))) else (
                        "show" if item_metadata.get("media_type") == "show" else "movie"
                    )
                )
            )
            # Find rating rule in library_rules
            ratings_rule = None
            for lr in library_rules:
                if isinstance(lr, dict) and str(lr.get("default", "")).lower() in ("ratings", "rating"):
                    ratings_rule = lr.get("template_variables") or {}
                    break

            if ratings_rule is not None and item_metadata.get("multi_ratings"):
                target_lvl = str(ratings_rule.get("builder_level", "all")).lower()
                lvl_match = (
                    target_lvl in ("all", item_level)
                    or (target_lvl == "movie" and item_level in ("movie", "backdrop"))
                    or (target_lvl == "show" and item_level in ("show", "backdrop"))
                )
                if lvl_match and not any(l.get("name", "").startswith("multi_rating_") for l in layers):
                    dyn_settings = {**get_dynamic_overlays_settings(), **ratings_rule}
                    r_layers = build_multi_rating_layers(
                        ratings=item_metadata["multi_ratings"],
                        dyn_settings=dyn_settings,
                        canvas_type="landscape" if is_landscape else "portrait",
                        assets_dir=overlays_dir / "assets" / "rating",
                        fonts_dir=overlays_dir / "fonts"
                    )
                    layers.extend(r_layers)
            return layers
    except Exception as e:
        logger.warning(f"[OverlaySync] OverlayConfigEngine evaluation error: {e}. Falling back to standard rules.")

    # 2. Safety Fallback: Direct rule construction
    layers = []
    assets_dir = overlays_dir / "assets"
    flags_dirs = [
        assets_dir / "flag" / "square",
        assets_dir / "flags" / "square",
        assets_dir / "flag" / "round",
        assets_dir / "flags" / "round",
        assets_dir / "flag",
        assets_dir / "flags",
        assets_dir,
        overlays_dir / "defaults" / "images" / "flag" / "square",
        overlays_dir / "defaults" / "images" / "flags" / "square",
        PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays" / "assets" / "flag" / "square",
        PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays" / "assets" / "flags" / "square",
        Path("/config/Overlayfiles/dynamic_overlays/assets/flag/square"),
        Path("/config/Overlayfiles/dynamic_overlays/assets/flags/square"),
        Path("/app/Overlayfiles/dynamic_overlays/assets/flag/square"),
    ]

    def resolve_flag_path(c_code: str) -> Path:
        f_file = LANGUAGE_TO_FLAG_MAP.get(c_code, f"{c_code}.png")
        for fd in flags_dirs:
            cand = fd / f_file
            if cand.exists():
                return cand
        return assets_dir / "flag" / "square" / f_file

    fonts_dir = overlays_dir / "fonts"

    # Select font
    inter_font = fonts_dir / "Inter-Bold.ttf"
    colus_font = fonts_dir / "Colus-Regular.ttf"
    if not colus_font.exists():
        colus_font = overlays_dir.parent / "Colus-Regular.ttf"
    circ_font = fonts_dir / "CircularStd-Bold.otf"
    font_to_use = str(inter_font) if inter_font.exists() else (str(circ_font) if circ_font.exists() else str(colus_font))

    # Flatten rule names and variables
    rule_names: Dict[str, Dict[str, Any]] = {}
    for r in library_rules:
        if not isinstance(r, dict):
            continue
        r_name = str(r.get("default") or r.get("file") or r.get("name") or "").lower()
        base_name = Path(r_name).stem.lower()
        vars_dict = r.get("template_variables") or r.get("variables") or {}
        if r_name:
            rule_names[r_name] = vars_dict
        if base_name:
            rule_names[base_name] = vars_dict
        for vk, vv in vars_dict.items():
            if vv is True or str(vv).lower() == "true":
                rule_names[vk.lower()] = vars_dict

    media_type = item_metadata.get("media_type", "movie")
    is_season = (item_metadata.get("season_number") is not None)

    # 1. 4K / Resolution Ribbon / Banner / Corner Badges
    resolution = str(item_metadata.get("resolution") or "").strip().lower()
    has_4k_banner = "4k_banner" in rule_names
    has_res_rule = "resolution" in rule_names or "4k" in rule_names or has_4k_banner

    if resolution and resolution not in ("none", "off", "false", "", "unknown"):
        if has_res_rule or "4k" in resolution:
            is_4k = ("4k" in resolution or "3840" in resolution or "2160" in resolution or "uhd" in resolution)
            if has_4k_banner and is_4k and (assets_dir / "4K_banner.png").exists() and not is_landscape:
                layers.append({
                    "name": "resolution_banner",
                    "type": "image",
                    "image_path": str(assets_dir / "4K_banner.png"),
                    "horizontal_align": "center",
                    "horizontal_offset": 0,
                    "vertical_align": "top",
                    "vertical_offset": 0
                })
            elif "resolution" in rule_names or has_res_rule:
                res_vars = rule_names.get("resolution", {})
                h_pos = res_vars.get("horizontal_align") or res_vars.get("horizontal_position", "left")
                v_pos = res_vars.get("vertical_align") or res_vars.get("vertical_position", "top")
                h_off = int(res_vars.get("horizontal_offset", 15))
                v_off = int(res_vars.get("vertical_offset", 15))

                tier = "1080p"
                if is_4k:
                    tier = "4k"
                elif "1080" in resolution or "fhd" in resolution:
                    tier = "1080p"
                elif "720" in resolution or "hd" in resolution:
                    tier = "720p"
                elif "576" in resolution or "pal" in resolution:
                    tier = "576p"
                elif "480" in resolution or "sd" in resolution or "ntsc" in resolution:
                    tier = "480p"

                has_dv = bool(item_metadata.get("has_dolby_vision"))
                has_hdr = bool(item_metadata.get("has_hdr"))

                badge_cands = []
                if has_dv and has_hdr:
                    badge_cands.extend([f"{tier}dvhdr.png", f"{tier}dvhdrplus.png"])
                elif has_dv:
                    badge_cands.append(f"{tier}dv.png")
                elif has_hdr:
                    badge_cands.append(f"{tier}hdr.png")
                badge_cands.extend([f"{tier}.png", f"{tier.upper()}.png"])

                badge_file = None
                for cand in badge_cands:
                    p1 = assets_dir / "resolution" / cand
                    p2 = assets_dir / cand
                    if p1.exists():
                        badge_file = p1
                        break
                    elif p2.exists():
                        badge_file = p2
                        break

                if badge_file:
                    layers.append({
                        "name": "resolution",
                        "type": "image",
                        "image_path": str(badge_file),
                        "horizontal_align": h_pos,
                        "horizontal_offset": h_off,
                        "vertical_align": v_pos,
                        "vertical_offset": v_off
                    })

    # 2. Audio Languages (Country Flags)
    if "languages" in rule_names:
        lang_vars = rule_names["languages"]
        builder_level = str(lang_vars.get("builder_level", "")).lower()
        # If builder_level is episode, it does not apply to movie or show posters
        if not (builder_level == "episode" and media_type in ["show", "season"]):
            allowed_langs = [str(l).lower() for l in lang_vars.get("languages", ["de", "en", "ja", "zh", "ko"])]
            item_langs = item_metadata.get("audio_languages") or []
            # Normalize detected languages to 2-letter codes
            clean_detected = []
            for raw_l in item_langs:
                code_l = str(raw_l).strip().lower()
                norm_l = LANGUAGE_MAP.get(code_l, code_l)
                if norm_l in allowed_langs and norm_l not in clean_detected:
                    clean_detected.append(norm_l)

            limit = int(lang_vars.get("overlay_limit", 5))
            clean_detected = clean_detected[:limit]

            if clean_detected:
                flag_w = 46
                flag_h = 28
                v_offset = int(lang_vars.get("vertical_offset", 37))
                h_offset = int(lang_vars.get("horizontal_offset", 48))

                if len(clean_detected) == 1:
                    code = clean_detected[0]
                    flag_path = resolve_flag_path(code)
                    layers.append({
                        "name": f"language_flag_{code}",
                        "type": "image",
                        "image_path": str(flag_path),
                        "scale_width": flag_w,
                        "scale_height": flag_h,
                        "horizontal_align": "left",
                        "horizontal_offset": h_offset,
                        "vertical_align": "bottom",
                        "vertical_offset": v_offset
                    })
                elif len(clean_detected) >= 2:
                    # Stack flags vertically: first flag on top, second flag on bottom (Image 2 style)
                    code_top = clean_detected[0]
                    code_bottom = clean_detected[1]
                    top_flag_file = resolve_flag_path(code_top)
                    bot_flag_file = resolve_flag_path(code_bottom)

                    layers.append({
                        "name": f"language_flag_{code_bottom}",
                        "type": "image",
                        "image_path": str(bot_flag_file),
                        "scale_width": flag_w,
                        "scale_height": flag_h,
                        "horizontal_align": "left",
                        "horizontal_offset": h_offset,
                        "vertical_align": "bottom",
                        "vertical_offset": v_offset
                    })
                    layers.append({
                        "name": f"language_flag_{code_top}",
                        "type": "image",
                        "image_path": str(top_flag_file),
                        "scale_width": flag_w,
                        "scale_height": flag_h,
                        "horizontal_align": "left",
                        "horizontal_offset": h_offset,
                        "vertical_align": "bottom",
                        "vertical_offset": v_offset + flag_h + 4
                    })

    # 3. Common Sense Media Rating Badge
    if "commonsense" in rule_names:
        cs_vars = rule_names["commonsense"]
        raw_cr = item_metadata.get("content_rating") or item_metadata.get("rating")
        cs_rating = normalize_commonsense_rating(raw_cr)
        cs_icon_path = assets_dir / "Commonsense.png"

        if cs_rating and cs_icon_path.exists():
            cs_v_offset = int(cs_vars.get("vertical_offset", 37))
            cs_h_offset = int(cs_vars.get("horizontal_offset", 255))
            cs_h_align = str(cs_vars.get("horizontal_align", "left")).lower()
            cs_v_align = str(cs_vars.get("vertical_align", "bottom")).lower()
            cs_h = 44 if not is_landscape else 36

            # Unified compound badge layer: icon + text placed side-by-side with exact math (cannot overlap)
            layers.append({
                "name": "commonsense",
                "type": "badge",
                "text": cs_rating,
                "image_path": str(cs_icon_path),
                "scale_height": cs_h,
                "addon_position": "left",
                "addon_offset": 12,
                "font_path": font_to_use,
                "font_size": cs_h,
                "font_color": "#FFFFFF",
                "stroke_width": 2,
                "stroke_color": "#000000D0",
                "horizontal_align": cs_h_align,
                "horizontal_offset": cs_h_offset,
                "vertical_align": cs_v_align,
                "vertical_offset": cs_v_offset,
                "back_width": int(cs_vars["back_width"]) if cs_vars.get("back_width") else None,
                "back_height": int(cs_vars["back_height"]) if cs_vars.get("back_height") else None,
                "back_color": cs_vars.get("back_color", "#00000000"),
                "drop_shadow": True
            })

    # 4. Runtime Badge
    runtime_mins = item_metadata.get("runtime_mins")
    if runtime_mins and "runtimes" in rule_names:
        rt_vars = rule_names["runtimes"]
        builder_level = str(rt_vars.get("builder_level", "")).lower()
        level_match = True
        if builder_level == "episode" and media_type in ["show", "season", "movie"]:
            level_match = False
        elif builder_level == "movie" and media_type in ["show", "season", "episode"]:
            level_match = False
        elif builder_level in ["show", "season"] and media_type in ["episode", "movie"]:
            level_match = False
        if level_match:
            hours = runtime_mins // 60
            mins = runtime_mins % 60
            rt_str = f"{hours}h {mins}m" if hours > 0 else f"{mins}m"
            rt_v_offset = int(rt_vars.get("vertical_offset", 37))
            rt_h_offset = int(rt_vars.get("horizontal_offset", 140))
            rt_h_align = str(rt_vars.get("horizontal_align", "center")).lower()

            rt_back_col = rt_vars.get("back_color", "#00000000")
            is_rt_trans = (rt_back_col in ("#00000000", "transparent", None)) or (isinstance(rt_back_col, str) and rt_back_col.endswith("00") and len(rt_back_col) == 9)

            layers.append({
                "name": "runtimes",
                "type": "text",
                "text": rt_str,
                "font_path": font_to_use,
                "font_size": 50 if not is_landscape else 36,
                "font_color": "#FFFFFF",
                "stroke_width": 2,
                "stroke_color": "#000000D0",
                "horizontal_align": rt_h_align,
                "horizontal_offset": rt_h_offset,
                "vertical_align": "bottom",
                "vertical_offset": rt_v_offset,
                "back_color": rt_back_col,
                "back_width": None if is_rt_trans else (int(rt_vars["back_width"]) if rt_vars.get("back_width") else (180 if is_landscape else 205)),
                "back_height": None if is_rt_trans else (int(rt_vars["back_height"]) if rt_vars.get("back_height") else (65 if is_landscape else 80)),
                "back_align": str(rt_vars.get("back_align", "center")).lower()
            })

    # 5. Series Status Banner (TV Shows)
    series_status = str(item_metadata.get("status") or "").strip()
    if series_status and "status" in rule_names and media_type == "show" and not is_season:
        if series_status.lower() in ["airing", "returning", "ended", "canceled"]:
            status_vars = rule_names["status"]
            status_colors = {
                "airing": status_vars.get("font_color_airing", "#27C24C"),
                "returning": status_vars.get("font_color_returning", "#FFA500"),
                "ended": status_vars.get("font_color_ended", "#FF0000"),
                "canceled": status_vars.get("font_color_canceled", "#ED1F1F"),
            }
            color = status_colors.get(series_status.lower(), "#FF0000")
            layers.append({
                "name": "status",
                "type": "text",
                "text": series_status.upper(),
                "font_path": str(colus_font) if colus_font.exists() else font_to_use,
                "font_size": int(status_vars.get("font_size", 80 if not is_landscape else 50)),
                "font_color": color,
                "back_color": status_vars.get("back_color", "#00000000"),
                "back_width": int(status_vars.get("back_width", 965)),
                "back_height": int(status_vars.get("back_height", 149)),
                "horizontal_align": status_vars.get("horizontal_align", "center"),
                "horizontal_offset": int(status_vars.get("horizontal_offset", 0)),
                "vertical_align": "bottom",
                "vertical_offset": int(status_vars.get("vertical_offset", 23))
            })

    # 6. Ratings Badge (Audience/Critic Score - ONLY if explicitly configured in rules!)
    if "ratings" in rule_names or "rating" in rule_names:
        raw_rating = item_metadata.get("rating")
        if raw_rating and str(raw_rating).strip().lower() not in ("none", "off", "false", "", "0"):
            try:
                score = float(raw_rating)
            except ValueError:
                score = None

            if score is not None:
                if score >= 6.5:
                    badge_file = assets_dir / "Rating_High.png"
                elif score >= 4.5:
                    badge_file = assets_dir / "Rating_Mid.png"
                else:
                    badge_file = assets_dir / "Rating_Low.png"

                score_str = f"{score:.1f}" if score < 10 else "10"
                rating_vars = rule_names.get("ratings") or rule_names.get("rating") or {}
                layers.append({
                    "name": "rating",
                    "type": "badge",
                    "text": score_str,
                    "image_path": str(badge_file) if badge_file.exists() else None,
                    "font_path": font_to_use,
                    "font_size": 42 if is_landscape else 70,
                    "font_color": "#282a2d" if (4.5 <= score < 6.5) else "#FFFFFF",
                    "horizontal_align": rating_vars.get("horizontal_align", "right"),
                    "horizontal_offset": int(rating_vars.get("horizontal_offset", 30)),
                    "vertical_align": rating_vars.get("vertical_align", "top"),
                    "vertical_offset": int(rating_vars.get("vertical_offset", 30))
                })

    # 7. Multi-Rating Badges Cluster (IMDb, RT, TMDb, Trakt, Metacritic, Letterboxd)
    ratings_rule = rule_names.get("ratings") or rule_names.get("rating")
    if ratings_rule is not None and item_metadata.get("multi_ratings"):
        item_level = "backdrop" if item_metadata.get("is_backdrop") else (
            "season" if item_metadata.get("is_season") else (
                "episode" if (item_metadata.get("is_episode") or (is_landscape and not item_metadata.get("is_backdrop"))) else (
                    "show" if item_metadata.get("media_type") == "show" else "movie"
                )
            )
        )
        target_lvl = str(ratings_rule.get("builder_level", "all")).lower()
        lvl_match = (
            target_lvl in ("all", item_level)
            or (target_lvl == "movie" and item_level in ("movie", "backdrop"))
            or (target_lvl == "show" and item_level in ("show", "backdrop"))
        )
        if lvl_match and not any(l.get("name", "").startswith("multi_rating_") for l in layers):
            dyn_settings = {**get_dynamic_overlays_settings(), **ratings_rule}
            r_layers = build_multi_rating_layers(
                ratings=item_metadata["multi_ratings"],
                dyn_settings=dyn_settings,
                canvas_type="landscape" if is_landscape else "portrait",
                assets_dir=assets_dir / "rating",
                fonts_dir=fonts_dir
            )
            layers.extend(r_layers)

    # 8. Audio Codec Badges (Dolby Atmos, TrueHD, DTS:X, DTS-HD MA, EAC3, AAC, FLAC, etc.)
    if "audio_codec" in rule_names:
        ac_vars = rule_names["audio_codec"]
        ac_style = str(ac_vars.get("style", "compact")).lower()
        ac_dir = assets_dir / "audio_codec" / ac_style
        if not ac_dir.exists():
            ac_dir = assets_dir / "audio_codec" / "compact"

        matched_codec = None
        cands = [
            str(item_metadata.get("audio_track_title") or ""),
            str(item_metadata.get("audio_title") or ""),
            str(item_metadata.get("audio_codec") or ""),
            str(item_metadata.get("audio_profile") or ""),
            str(item_metadata.get("filepath") or ""),
            str(item_metadata.get("clean_tc") or ""),
            str(item_metadata.get("title") or "")
        ]
        test_str = " ".join(c for c in cands if c)
        for key, pat in AUDIO_CODEC_PATTERNS:
            if pat.search(test_str):
                matched_codec = key
                break

        if matched_codec:
            codec_img = ac_dir / f"{matched_codec}.png"
            if not codec_img.exists() and (assets_dir / "audio_codec" / "standard" / f"{matched_codec}.png").exists():
                codec_img = assets_dir / "audio_codec" / "standard" / f"{matched_codec}.png"

            if codec_img.exists():
                h_pos = ac_vars.get("horizontal_align") or ac_vars.get("horizontal_position", "center")
                v_pos = ac_vars.get("vertical_align") or ac_vars.get("vertical_position", "top")
                layers.append({
                    "name": f"audio_codec_{matched_codec}",
                    "type": "image",
                    "image_path": str(codec_img),
                    "back_color": "#00000099",
                    "back_width": 305,
                    "back_height": 105,
                    "back_radius": 12,
                    "horizontal_align": h_pos,
                    "horizontal_offset": int(ac_vars.get("horizontal_offset", 0)),
                    "vertical_align": v_pos,
                    "vertical_offset": int(ac_vars.get("vertical_offset", 15))
                })

    # 9. Video Format Badges (Telesync, CAM, Remux, Blu-ray, Web-DL, HDTV, DVD)
    if "video_format" in rule_names:
        vf_vars = rule_names["video_format"]
        vf_cands = [
            str(item_metadata.get("filepath") or ""),
            str(item_metadata.get("file") or ""),
            str(item_metadata.get("edition") or ""),
            str(item_metadata.get("clean_tc") or ""),
            str(item_metadata.get("title") or "")
        ]
        vf_test_str = " ".join(c for c in vf_cands if c)
        matched_vf = None
        for name, pat in VIDEO_FORMAT_PATTERNS:
            if pat.search(vf_test_str):
                matched_vf = name
                break

        if matched_vf:
            h_pos = vf_vars.get("horizontal_align") or vf_vars.get("horizontal_position", "left")
            v_pos = vf_vars.get("vertical_align") or vf_vars.get("vertical_position", "bottom")
            layers.append({
                "name": f"video_format_{matched_vf}",
                "type": "text",
                "text": matched_vf,
                "font_path": font_to_use,
                "font_size": 38 if not is_landscape else 32,
                "font_color": "#FFFFFF",
                "back_color": "#00000099",
                "back_width": 305,
                "back_height": 105,
                "back_radius": 12,
                "horizontal_align": h_pos,
                "horizontal_offset": int(vf_vars.get("horizontal_offset", 15)),
                "vertical_align": v_pos,
                "vertical_offset": int(vf_vars.get("vertical_offset", 15))
            })

    return layers


# ==============================================================================
# MAIN SYNC WORKER
# ==============================================================================# Global execution state
_is_sync_running = False
_cancel_requested = False
_last_sync_result = None


def is_overlay_sync_running() -> bool:
    return _is_sync_running


def stop_overlay_sync() -> bool:
    global _cancel_requested
    _cancel_requested = True
    return True


def reset_overlay_sync_state() -> bool:
    global _is_sync_running, _cancel_requested
    _is_sync_running = False
    _cancel_requested = False
    return True


def get_last_sync_result() -> Optional[Dict[str, Any]]:
    return _last_sync_result


def _parse_plex_item(it, sec_title: str, sec_type: str) -> Optional[Dict[str, Any]]:
    rk = it.get("ratingKey")
    if not rk:
        return None
    t = it.get("title", "")
    rf = None
    part = it.find(".//Part")
    part_file = part.get("file") if part is not None else None
    if part_file:
        rf = Path(part_file).parent.name
    loc = it.find(".//Location")
    if not rf and loc is not None and loc.get("path"):
        rf = Path(loc.get("path")).name
    if not rf:
        rf = t

    res_val = "1080p"
    audio_c = None
    video_f = None
    med_elem = it.find(".//Media")
    if med_elem is not None:
        w = int(med_elem.get("width") or 0)
        vr = med_elem.get("videoResolution")
        if w >= 3840 or vr in ["4k", "2160"]:
            res_val = "4K"
        elif vr:
            res_val = f"{vr}p"
        audio_c = med_elem.get("audioCodec")
        video_f = med_elem.get("videoProfile")
    elif any(k in (sec_title or "").lower() or k in (rf or "").lower() or (part_file and k in part_file.lower()) for k in ["4k", "uhd", "2160"]):
        res_val = "4K"

    if any(k in (sec_title or "").lower() for k in ["4k", "uhd", "2160"]):
        res_val = "4K"

    dur = int(it.get("duration") or 0)
    aud_rating = it.get("audienceRating") or it.get("rating")

    year_val = None
    if it.get("year"):
        try:
            year_val = int(it.get("year"))
        except Exception:
            pass

    ed_val = it.get("editionTitle") or it.get("edition") or extract_edition(part_file, rf, t)
    s_up_at = it.get("updatedAt") or it.get("addedAt")

    p_imdb = None
    p_tmdb = None
    p_tvdb = None
    for g_node in it.findall(".//Guid"):
        gid = g_node.get("id", "")
        if gid.startswith("imdb://"):
            p_imdb = gid[7:]
        elif gid.startswith("tmdb://"):
            p_tmdb = gid[7:]
        elif gid.startswith("tvdb://"):
            p_tvdb = gid[7:]

    return {
        "id": rk,
        "title": t,
        "year": year_val,
        "library_name": sec_title,
        "media_type": sec_type,
        "root_folder": rf,
        "filepath": part_file,
        "edition": ed_val,
        "server_updated_at": s_up_at,
        "resolution": res_val,
        "rating": aud_rating,
        "audience_rating": aud_rating,
        "content_rating": it.get("contentRating"),
        "runtime_mins": dur // 60000 if dur > 0 else None,
        "studio": it.get("studio"),
        "audio_codec": audio_c,
        "video_format": video_f,
        "imdb_id": p_imdb,
        "tmdb_id": p_tmdb,
        "tvdb_id": p_tvdb
    }


def _parse_jellyfin_item(item_obj: dict, lib_name: str) -> Optional[Dict[str, Any]]:
    it_id = item_obj.get("Id")
    if not it_id:
        return None
    it_name = item_obj.get("Name", "")
    it_type = "movie" if item_obj.get("Type") == "Movie" else "show"
    it_path = item_obj.get("Path", "")
    it_p = Path(it_path) if it_path else None
    if it_p:
        rf = it_p.name if (it_type == "show" or not it_p.suffix) else it_p.parent.name
    else:
        rf = it_name
    streams = item_obj.get("MediaStreams", [])
    if not streams and item_obj.get("MediaSources"):
        for ms in item_obj.get("MediaSources", []):
            streams.extend(ms.get("MediaStreams", []))

    audio_langs = []
    item_audio_c = None
    item_audio_t = None
    item_has_dv = False
    item_has_hdr = False
    vid_w = item_obj.get("Width") or 0
    vid_h = item_obj.get("Height") or 0
    for s in streams:
        stype = s.get("Type")
        if stype == "Audio":
            lc = s.get("Language") or s.get("DisplayLanguage")
            if lc:
                norm_l = LANGUAGE_MAP.get(lc.lower(), lc.lower())
                if norm_l not in audio_langs:
                    audio_langs.append(norm_l)
            if not item_audio_c and s.get("Codec"):
                item_audio_c = s.get("Codec")
            if not item_audio_t:
                item_audio_t = s.get("Title") or s.get("DisplayTitle")
        elif stype == "Video":
            sw = s.get("Width") or 0
            sh = s.get("Height") or 0
            if sw > vid_w:
                vid_w = sw
            if sh > vid_h:
                vid_h = sh
            v_range = str(s.get("VideoRange") or "").lower()
            v_title = str(s.get("VideoDoViTitle") or s.get("DisplayTitle") or "").lower()
            if "dovi" in v_title or "dolby vision" in v_title or s.get("VideoDoViTitle"):
                item_has_dv = True
            if "hdr" in v_range or "hdr" in v_title or s.get("VideoRange") == "HDR":
                item_has_hdr = True

    res_val = "1080p"
    if any(k in (lib_name or "").lower() for k in ["4k", "uhd", "2160"]):
        res_val = "4K"
    elif vid_w >= 3800 or vid_h >= 2000:
        res_val = "4K"
    elif any(k in (it_path or "").lower() or k in (rf or "").lower() for k in ["4k", "uhd", "2160"]):
        res_val = "4K"
    elif vid_w >= 1900 or vid_h >= 1000:
        res_val = "1080p"
    elif vid_w >= 1200 or vid_h >= 700:
        res_val = "720p"
    elif vid_w > 0:
        res_val = f"{vid_h}p" if vid_h else f"{vid_w}p"
    else:
        res_val = "1080p"

    p_ids = item_obj.get("ProviderIds") or {}
    studios_list = [st.get("Name") for st in item_obj.get("Studios", []) if st.get("Name")]
    primary_network = studios_list[0] if studios_list else None
    ed_val = item_obj.get("Edition") or item_obj.get("Version") or extract_edition(it_path, it_name)
    s_up_at = item_obj.get("DateModified") or item_obj.get("DateCreated")

    return {
        "id": it_id,
        "title": it_name,
        "year": item_obj.get("ProductionYear"),
        "imdb_id": p_ids.get("Imdb"),
        "tmdb_id": p_ids.get("Tmdb"),
        "tvdb_id": p_ids.get("Tvdb"),
        "library_name": lib_name,
        "media_type": it_type,
        "root_folder": rf,
        "filepath": it_path,
        "edition": ed_val,
        "server_updated_at": s_up_at,
        "resolution": res_val,
        "rating": item_obj.get("CommunityRating"),
        "critic_rating": item_obj.get("CriticRating"),
        "content_rating": item_obj.get("OfficialRating") or item_obj.get("CustomRating"),
        "runtime_mins": (item_obj.get("RunTimeTicks", 0) // 600000000) or None,
        "status": item_obj.get("Status"),
        "audio_languages": audio_langs,
        "audio_codec": item_audio_c,
        "audio_track_title": item_audio_t,
        "has_dolby_vision": item_has_dv,
        "has_hdr": item_has_hdr,
        "network": primary_network,
        "networks": studios_list,
        "studio": primary_network
    }


async def run_overlay_sync_task(
    target_server: str = "all",
    scope: str = "incremental",
    library: str = "all",
    base_dir: Optional[Path] = None,
    assets_dir: Optional[Path] = None,
    config_path: Optional[Path] = None,
    log_file_path: Optional[Path] = None,
    target_items: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Main execution worker for Dynamic Overlay Sync.
    Executes in-memory compositing of clean assets and uploads overlaid artwork to media servers.
    Supports instant target mode when newly generated assets are passed via target_items.
    """
    global _is_sync_running, _last_sync_result, _cancel_requested

    if _is_sync_running:
        return {"success": False, "error": "A dynamic overlay sync task is already running."}

    _is_sync_running = True
    _cancel_requested = False

    if not base_dir:
        base_dir = Path(".")
    if not config_path:
        config_path = base_dir / "config.json"
    if not assets_dir:
        assets_dir = base_dir / "assets"
    if not log_file_path:
        log_file_path = base_dir / "UILogs" / "DynamicOverlaysSync.log"

    log_file_path.parent.mkdir(parents=True, exist_ok=True)

    def write_log(msg: str):
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{now_str}] {msg}\n"
        try:
            with open(log_file_path, "a", encoding="utf-8") as lf:
                lf.write(line)
        except Exception:
            pass
        logger.info(f"[OverlaySync] {msg}")

    # Check Master Feature Toggle (Disabled by default)
    try:
        from dynamic_overlays_service import is_dynamic_overlays_enabled
        if not is_dynamic_overlays_enabled():
            write_log("Notice: Dynamic Overlays is currently disabled. Enable it in the WebUI to run sync.")
            res = {"success": False, "error": "Dynamic Overlays is disabled in settings.", "is_enabled": False}
            _last_sync_result = res
            return res
    except Exception as check_err:
        logger.debug(f"Could not verify dynamic overlays enabled state: {check_err}")

    # Fast targeted item handling
    is_target_mode = bool(target_items)
    target_libs = set()
    target_roots = set()
    target_titles = set()
    if is_target_mode:
        for t_item in target_items:
            lib_v = str(t_item.get("LibraryName") or t_item.get("library_name") or "").strip().lower()
            if lib_v and lib_v != "all":
                target_libs.add(lib_v)
            root_v = str(t_item.get("Rootfolder") or t_item.get("root_folder") or "").strip().lower()
            if root_v:
                target_roots.add(root_v)
            title_v = str(t_item.get("Title") or t_item.get("title") or "").strip().lower()
            if title_v:
                target_titles.add(title_v)

        target_roots = {r for r in target_roots if r}
        target_titles = {t for t in target_titles if t}

    # Pre-sync: if AniMetaFill is enabled, trigger quick anime classification first (skip on fast single-item targeted runs)
    if not is_target_mode:
        try:
            from animetafill_service import is_animetafill_enabled, run_animetafill_sync
            if is_animetafill_enabled():
                with open(log_file_path, "a", encoding="utf-8") as f:
                    f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Notice: Running AniMetaFill anime classification prior to overlay compositing...\n")
                run_animetafill_sync(force=False)
        except Exception as a_err:
            logger.debug(f"[OverlaySync] AniMetaFill pre-run skipped: {a_err}")

    overlays_dir = base_dir / "Overlayfiles" / "dynamic_overlays"
    if not overlays_dir.exists():
        legacy = base_dir / "Overlayfiles" / "kometa"
        if legacy.exists():
            overlays_dir = legacy
        elif (PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays").exists():
            overlays_dir = PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays"
        elif Path("/app/Overlayfiles/dynamic_overlays").exists():
            overlays_dir = Path("/app/Overlayfiles/dynamic_overlays")
    cache = OverlayCache(base_dir / "database" / "overlay_cache.db")

    # Rotate log if exceeds 10MB
    if log_file_path.exists():
        try:
            if log_file_path.stat().st_size > 10 * 1024 * 1024:
                old_log = log_file_path.with_name("DynamicOverlaysSync.log.old")
                if old_log.exists():
                    old_log.unlink()
                log_file_path.rename(old_log)
        except Exception:
            pass

    try:
        write_log("=" * 70)
        write_log("STARTING DYNAMIC OVERLAYS SYNC TASK")
        write_log(f"Target Server: {target_server.upper()} | Scope: {('TARGETED' if is_target_mode else scope).upper()} | Target Library: {library}")
        if is_target_mode:
            write_log(f"Instant Target Mode Active: Processing {len(target_items)} newly generated item(s).")
            if target_libs:
                write_log(f"Target Library Filter: {', '.join(target_libs)}")
        write_log("Clean originals in AssetPath remain untouched. Overlays composited in RAM.")
        write_log("=" * 70)

        # 1. Parse credentials
        server_creds = get_server_credentials(config_path)
        real_asset_path = server_creds.get("asset_path") or resolve_configured_asset_path(assets_dir)
        write_log(f"Asset Path: '{real_asset_path}' (clean originals)")
        if not real_asset_path.exists():
            err = f"Asset directory '{real_asset_path}' does not exist. Aborting sync."
            write_log(f"ERROR: {err}")
            write_log("=" * 70)
            res = {"success": False, "error": err}
            _last_sync_result = res
            return res

        # 2. Parse active rules from config.yml
        library_rules_map = {}
        config_yml = overlays_dir / "configs" / "config.yml"
        if config_yml.exists():
            try:
                import yaml
                with open(config_yml, "r", encoding="utf-8") as yf:
                    raw_cfg = yaml.safe_load(yf) or {}
                    raw_libs = raw_cfg.get("libraries", {})
                    for l_name, l_data in raw_libs.items():
                        if isinstance(l_data, dict):
                            rules = l_data.get("overlay_files") or l_data.get("overlays") or []
                            if rules:
                                library_rules_map[l_name.lower()] = rules
                write_log(f"Loaded dynamic overlay rules for {len(library_rules_map)} library(ies) from config.yml.")
            except Exception as ye:
                write_log(f"Warning loading config.yml: {ye}")

        if not library_rules_map:
            msg = "No libraries configured with dynamic overlay rules in config.yml. Sync skipped."
            write_log(f"Notice: {msg}")
            write_log("=" * 70)
            res = {"success": True, "message": msg, "stats": {"synced": 0, "skipped": 0, "failed": 0}}
            _last_sync_result = res
            return res

        if library != "all":
            matched_k, matched_rules = resolve_library_rules(library, "movie", library_rules_map)
            if matched_k == "none" or not matched_rules:
                msg = f"Target library '{library}' has no dynamic overlay rules configured. Sync skipped."
                write_log(f"Notice: {msg}")
                write_log("=" * 70)
                res = {"success": True, "message": msg, "stats": {"synced": 0, "skipped": 0, "failed": 0}}
                _last_sync_result = res
                return res

        # 3. Determine active servers
        servers_to_run = []
        if target_server in ["all", "plex"] and server_creds["plex"]["enabled"] and server_creds["plex"]["url"]:
            servers_to_run.append("plex")
        if target_server in ["all", "jellyfin"] and server_creds["jellyfin"]["enabled"] and server_creds["jellyfin"]["url"]:
            servers_to_run.append("jellyfin")
        if target_server in ["all", "emby"] and server_creds["emby"]["enabled"] and server_creds["emby"]["url"]:
            servers_to_run.append("emby")

        if not servers_to_run:
            msg = f"No media servers are enabled or configured matching target '{target_server}'."
            write_log(f"Notice: {msg}")
            write_log("=" * 70)
            res = {"success": True, "message": msg, "stats": {"synced": 0, "skipped": 0, "failed": 0}}
            _last_sync_result = res
            return res

        total_synced = 0
        total_skipped = 0
        total_failed = 0

        async with httpx.AsyncClient(timeout=45.0) as http_client:
            for s_type in servers_to_run:
                write_log(f"\n>>> Processing Server: {s_type.upper()} <<<")
                creds = server_creds[s_type]
                s_url = creds["url"]
                excluded = creds.get("excluded_libs", [])

                # Discover items
                media_items = []
                if s_type == "plex":
                    token = creds.get("token")
                    try:
                        # Query Plex library sections
                        sec_resp = await http_client.get(
                            f"{s_url}/library/sections",
                            headers={"X-Plex-Token": token, "Accept": "application/xml"}
                        )
                        if sec_resp.status_code == 200:
                            sec_root = fromstring(sec_resp.content)
                            for d_sec in sec_root.findall(".//Directory"):
                                sec_title = d_sec.get("title", "")
                                sec_type = d_sec.get("type", "")
                                sec_key = d_sec.get("key", "")
                                if sec_type not in ["movie", "show"]:
                                    continue
                                if library != "all" and sec_title.lower() != library.lower():
                                    continue
                                if library == "all" and sec_title in excluded:
                                    continue
                                if is_target_mode and target_libs and sec_title.lower() not in target_libs and not any(tl in sec_title.lower() for tl in target_libs):
                                    continue
                                matched_k, matched_rules = resolve_library_rules(sec_title, sec_type, library_rules_map)
                                if matched_k == "none" or not matched_rules:
                                    write_log(f"  [>] Library '{sec_title}' is not configured for dynamic overlays. Skipping.")
                                    continue

                                sec_media_items = []
                                if is_target_mode and (target_titles or target_roots):
                                    searched_terms = target_titles | target_roots
                                    for s_term in searched_terms:
                                        clean_term = re.sub(r"\s*\(\d{4}\)$", "", s_term).strip()
                                        terms_to_try = [s_term]
                                        if clean_term and clean_term != s_term:
                                            terms_to_try.append(clean_term)
                                        for term in terms_to_try:
                                            try:
                                                search_url = f"{s_url}/library/sections/{sec_key}/all?title={urllib.parse.quote(term)}&includeGuids=1"
                                                search_resp = await http_client.get(search_url, headers={"X-Plex-Token": token, "Accept": "application/xml"})
                                                if search_resp.status_code == 200:
                                                    sr_root = fromstring(search_resp.content)
                                                    tag = ".//Directory" if sec_type == "show" else ".//Video"
                                                    for it in sr_root.findall(tag):
                                                        parsed_it = _parse_plex_item(it, sec_title, sec_type)
                                                        if parsed_it:
                                                            sec_media_items.append(parsed_it)
                                            except Exception as se_err:
                                                logger.debug(f"[OverlaySync] Targeted Plex search error for '{term}': {se_err}")

                                if not sec_media_items and not is_target_mode:
                                    # Query section items with bulk GUIDs (IMDb, TMDb, TVDb)
                                    items_resp = await http_client.get(
                                        f"{s_url}/library/sections/{sec_key}/all?includeGuids=1",
                                        headers={"X-Plex-Token": token, "Accept": "application/xml"}
                                    )
                                    if items_resp.status_code == 200:
                                        i_root = fromstring(items_resp.content)
                                        tag = ".//Directory" if sec_type == "show" else ".//Video"
                                        for it in i_root.findall(tag):
                                            parsed_it = _parse_plex_item(it, sec_title, sec_type)
                                            if parsed_it:
                                                sec_media_items.append(parsed_it)
                                elif not sec_media_items and is_target_mode:
                                    # Fallback if targeted title search missed: fetch section XML and filter
                                    items_resp = await http_client.get(
                                        f"{s_url}/library/sections/{sec_key}/all?includeGuids=1",
                                        headers={"X-Plex-Token": token, "Accept": "application/xml"}
                                    )
                                    if items_resp.status_code == 200:
                                        i_root = fromstring(items_resp.content)
                                        tag = ".//Directory" if sec_type == "show" else ".//Video"
                                        for it in i_root.findall(tag):
                                            parsed_it = _parse_plex_item(it, sec_title, sec_type)
                                            if parsed_it:
                                                sec_media_items.append(parsed_it)

                                media_items.extend(sec_media_items)
                    except Exception as pe:
                        write_log(f"Error querying Plex API: {pe}")

                elif s_type in ["jellyfin", "emby"]:
                    api_key = creds.get("api_key")
                    headers = {
                        "X-Emby-Token": api_key,
                        "Authorization": f'MediaBrowser Token="{api_key}"',
                        "Accept": "application/json"
                    }
                    try:
                        vf_resp = await http_client.get(f"{s_url}/Library/VirtualFolders", headers=headers)
                        if vf_resp.status_code == 200:
                            vfolders = vf_resp.json()
                            write_log(f"Connected to {s_type.upper()}. Found {len(vfolders)} library folder(s).")
                            for lib_obj in vfolders:
                                lib_name = lib_obj.get("Name", "")
                                lib_id = lib_obj.get("ItemId") or lib_obj.get("Id", "")
                                if library != "all" and lib_name.lower() != library.lower():
                                    continue
                                if library == "all" and any(lib_name.lower() == str(ex).lower() for ex in excluded):
                                    write_log(f"  [>] Library '{lib_name}' is in exclude list. Skipping.")
                                    continue
                                if is_target_mode and target_libs and lib_name.lower() not in target_libs and not any(tl in lib_name.lower() for tl in target_libs):
                                    continue
                                matched_k, matched_rules = resolve_library_rules(lib_name, "movie", library_rules_map)
                                if matched_k == "none" or not matched_rules:
                                    write_log(f"  [>] Library '{lib_name}' is not configured for dynamic overlays. Skipping.")
                                    continue

                                sec_media_items = []
                                if is_target_mode and (target_titles or target_roots):
                                    searched_terms = target_titles | target_roots
                                    for s_term in searched_terms:
                                        clean_term = re.sub(r"\s*\(\d{4}\)$", "", s_term).strip()
                                        terms_to_try = [s_term]
                                        if clean_term and clean_term != s_term:
                                            terms_to_try.append(clean_term)
                                        for term in terms_to_try:
                                            try:
                                                items_url = f"{s_url}/Items?ParentId={lib_id}&Recursive=true&IncludeItemTypes=Movie,Series&SearchTerm={urllib.parse.quote(term)}&Fields=MediaStreams,MediaSources,Width,Height,OfficialRating,CustomRating,RunTimeTicks,Status,ProviderIds,ProductionYear,Studios,CommunityRating,CriticRating,DateModified,DateCreated,Path,Overview"
                                                it_resp = await http_client.get(items_url, headers=headers)
                                                if it_resp.status_code == 200:
                                                    lib_items = it_resp.json().get("Items", [])
                                                    for item_obj in lib_items:
                                                        parsed_it = _parse_jellyfin_item(item_obj, lib_name)
                                                        if parsed_it:
                                                            sec_media_items.append(parsed_it)
                                            except Exception as je:
                                                pass

                                if not sec_media_items and not is_target_mode:
                                    items_url = f"{s_url}/Items?ParentId={lib_id}&Recursive=true&IncludeItemTypes=Movie,Series&Fields=MediaStreams,MediaSources,Width,Height,OfficialRating,CustomRating,RunTimeTicks,Status,ProviderIds,ProductionYear,Studios,CommunityRating,CriticRating,DateModified,DateCreated,Path,Overview"
                                    it_resp = await http_client.get(items_url, headers=headers)
                                    if it_resp.status_code == 200:
                                        lib_items = it_resp.json().get("Items", [])
                                        write_log(f"  [+] Library '{lib_name}': Discovered {len(lib_items)} items.")
                                        for item_obj in lib_items:
                                            parsed_it = _parse_jellyfin_item(item_obj, lib_name)
                                            if parsed_it:
                                                sec_media_items.append(parsed_it)
                                    else:
                                        write_log(f"  [-] Failed to fetch items for library '{lib_name}' ({it_resp.status_code}): {it_resp.text[:120]}")
                                elif not sec_media_items and is_target_mode:
                                    items_url = f"{s_url}/Items?ParentId={lib_id}&Recursive=true&IncludeItemTypes=Movie,Series&Fields=MediaStreams,MediaSources,Width,Height,OfficialRating,CustomRating,RunTimeTicks,Status,ProviderIds,ProductionYear,Studios,CommunityRating,CriticRating,DateModified,DateCreated,Path,Overview"
                                    it_resp = await http_client.get(items_url, headers=headers)
                                    if it_resp.status_code == 200:
                                        lib_items = it_resp.json().get("Items", [])
                                        for item_obj in lib_items:
                                            parsed_it = _parse_jellyfin_item(item_obj, lib_name)
                                            if parsed_it:
                                                sec_media_items.append(parsed_it)

                                media_items.extend(sec_media_items)
                        else:
                            write_log(f"  [-] Failed to fetch virtual folders on {s_type.upper()} ({vf_resp.status_code}): {vf_resp.text[:120]}")
                    except Exception as je:
                        write_log(f"Error querying {s_type} API: {je}")

                if is_target_mode:
                    matched_items = []
                    seen_ids = set()
                    for it in media_items:
                        it_id = str(it.get("id"))
                        if it_id in seen_ids:
                            continue
                        rf_l = (it.get("root_folder") or "").strip().lower()
                        t_l = (it.get("title") or "").strip().lower()
                        if (
                            rf_l in target_roots
                            or t_l in target_titles
                            or any(tr in rf_l for tr in target_roots if len(tr) >= 3)
                            or any(tt in t_l for tt in target_titles if len(tt) >= 3)
                        ):
                            seen_ids.add(it_id)
                            matched_items.append(it)
                    media_items = matched_items
                    write_log(f"Instant Target Mode: Filtered to {len(media_items)} item(s) on {s_type.upper()}.")

                write_log(f"Discovered {len(media_items)} items on {s_type.upper()}. Evaluating clean assets and cache...")

                if scope == "changed":
                    write_log(f"Fast change detection active. Checking for media attribute modifications on {s_type.upper()}...")
                    change_report = await detect_media_changes(
                        target_server=s_type,
                        library=library,
                        base_dir=base_dir,
                        config_path=config_path
                    )
                    changed_ids = {str(c["id"]) for c in change_report.get("changes", [])}
                    media_items = [it for it in media_items if str(it["id"]) in changed_ids]
                    write_log(f"Fast Change Detection: {len(media_items)} items identified with changes (Languages, Cuts, Status, or Assets).")
                    if not media_items:
                        write_log(f"All dynamic overlays on {s_type.upper()} are 100% current. Nothing to update.")

                # Master Dynamic Overlay Settings & Concurrency
                dyn_settings = get_dynamic_overlays_settings()
                backdrop_enabled = dyn_settings.get("backdrop_overlays_enabled", True)
                rating_sources = dyn_settings.get("rating_sources", ["imdb", "tmdb", "tomatoes", "tomatoesaudience"])
                mdblist_key = dyn_settings.get("mdblist_api_key") or ""
                omdb_key = dyn_settings.get("omdb_api_key") or ""
                debug_log_enabled = bool(dyn_settings.get("debug_logging", False))
                concurrency = max(1, min(32, int(dyn_settings.get("concurrency", 4))))

                write_log(f"Processing {len(media_items)} items on {s_type.upper()} (Concurrency: {concurrency}, Debug Logging: {debug_log_enabled})...")

                dir_cache: Dict[str, Any] = {}
                server_stats = {"synced": 0, "skipped": 0, "failed": 0}
                stats_lock = asyncio.Lock()

                async def _inc_stats(synced=0, skipped=0, failed=0):
                    async with stats_lock:
                        server_stats["synced"] += synced
                        server_stats["skipped"] += skipped
                        server_stats["failed"] += failed

                async def _process_sync_item(item, worker_id: int = 1):
                    if _cancel_requested:
                        return
                    item_id = item["id"]
                    title = item["title"]
                    lib_name = item["library_name"]
                    m_type = item["media_type"]
                    root_f = item.get("root_folder") or title

                    # 1. Resolve library rules immediately. If not configured, skip right away
                    matched_rule_key, lib_rules = resolve_library_rules(lib_name, m_type, library_rules_map)
                    if matched_rule_key == "none" or not lib_rules:
                        await _inc_stats(skipped=1)
                        return

                    w_tag = f"[Worker {worker_id}] " if concurrency > 1 else ""
                    item_label = f"Worker {worker_id} | '{title}'" if concurrency > 1 else f"'{title}'"

                    # Master Dynamic Overlay Settings
                    dyn_settings = get_dynamic_overlays_settings()
                    backdrop_enabled = dyn_settings.get("backdrop_overlays_enabled", True)
                    rating_sources = dyn_settings.get("rating_sources", ["imdb", "tmdb", "tomatoes", "tomatoesaudience"])
                    mdblist_key = dyn_settings.get("mdblist_api_key") or ""
                    omdb_key = dyn_settings.get("omdb_api_key") or ""

                    # Inspect active rules to identify what metadata domains are actually required
                    rules_str = json.dumps([r for r in lib_rules if isinstance(r, dict)]).lower()
                    needs_languages = any(k in rules_str for k in ["language", "flag", "lang_"])
                    needs_audio = any(k in rules_str for k in ["audio", "atmos", "truehd", "dts", "codec", "surround"])
                    needs_hdr_dv = any(k in rules_str for k in ["hdr", "dovi", "dolby_vision", "dv"])
                    needs_ratings = any(
                        (isinstance(r, dict) and str(r.get("default", "")).lower() in ("ratings", "rating"))
                        or "rating" in str(r).lower()
                        for r in lib_rules
                    )
                    needs_status = any(k in rules_str for k in ["status", "ended", "airing", "returning", "canceled"])

                    # Fast cache lookup for poster & backdrop paths
                    cached_entry = cache.get_entry(s_type, str(item_id), "poster") if scope in ("incremental", "changed") else None
                    cached_backdrop_entry = cache.get_entry(s_type, str(item_id), "background") if (backdrop_enabled and scope in ("incremental", "changed")) else None

                    # Locate clean assets on disk (reuse known cached path or search disk with indexed dir_cache)
                    clean_asset = None
                    if cached_entry and cached_entry.get("clean_asset_path"):
                        c_p = Path(cached_entry["clean_asset_path"])
                        if c_p.is_file():
                            clean_asset = c_p

                    if not clean_asset:
                        clean_asset = find_clean_asset(
                            assets_dir=real_asset_path,
                            library_name=lib_name,
                            root_folder=root_f,
                            title=title,
                            asset_type="poster",
                            imdb_id=item.get("imdb_id"),
                            tmdb_id=item.get("tmdb_id"),
                            tvdb_id=item.get("tvdb_id"),
                            year=item.get("year"),
                            dir_cache=dir_cache
                        )

                    clean_backdrop = None
                    if backdrop_enabled:
                        if cached_backdrop_entry and cached_backdrop_entry.get("clean_asset_path"):
                            cb_p = Path(cached_backdrop_entry["clean_asset_path"])
                            if cb_p.is_file():
                                clean_backdrop = cb_p
                        if not clean_backdrop:
                            clean_backdrop = find_clean_asset(
                                assets_dir=real_asset_path,
                                library_name=lib_name,
                                root_folder=root_f,
                                title=title,
                                asset_type="background",
                                imdb_id=item.get("imdb_id"),
                                tmdb_id=item.get("tmdb_id"),
                                tvdb_id=item.get("tvdb_id"),
                                year=item.get("year"),
                                dir_cache=dir_cache
                            )

                    if not clean_asset and not clean_backdrop:
                        write_log(f"  [>] {w_tag}'{title}' ({lib_name}): No clean original asset found in '{real_asset_path}'. Skipping.")
                        await _inc_stats(skipped=1)
                        return  # No clean asset created yet by Posterizarr, skip

                    # Query Plex detailed metadata for audio streams, guids, and native ratings only if required
                    plex_xml_bytes = None
                    if s_type == "plex":
                        # Fast incremental check: if server_updated_at matches cache, reuse cached detected_languages & attributes
                        need_plex_detail = (scope not in ("incremental", "changed"))
                        if not need_plex_detail:
                            if not cached_entry or cached_entry.get("status") != "synced":
                                need_plex_detail = True
                            elif str(cached_entry.get("server_updated_at") or "") != str(item.get("server_updated_at") or ""):
                                need_plex_detail = True
                            elif not cached_entry.get("detected_languages") and (needs_languages or needs_audio):
                                need_plex_detail = True
                            else:
                                c_langs = [l.strip().lower() for l in (cached_entry.get("detected_languages") or "").split(",") if l.strip()]
                                if c_langs:
                                    item["audio_languages"] = c_langs
                                if cached_entry.get("edition") and not item.get("edition"):
                                    item["edition"] = cached_entry["edition"]
                                if cached_entry.get("show_status") and not item.get("status"):
                                    item["status"] = cached_entry["show_status"]
                                if cached_entry.get("runtime_mins") and not item.get("runtime_mins"):
                                    item["runtime_mins"] = cached_entry["runtime_mins"]
                                if cached_entry.get("detected_audio_codec") and not item.get("audio_codec"):
                                    item["audio_codec"] = cached_entry["detected_audio_codec"]
                                if cached_entry.get("detected_video_format") and not item.get("video_format"):
                                    item["video_format"] = cached_entry["detected_video_format"]
                                if cached_entry.get("detected_resolution") and not item.get("resolution"):
                                    item["resolution"] = cached_entry["detected_resolution"]

                        # Skip detailed XML fetch if rules do NOT require audio streams, languages, HDR, or ratings
                        if need_plex_detail and not (needs_languages or needs_audio or needs_hdr_dv or needs_ratings):
                            need_plex_detail = False

                        if need_plex_detail:
                            try:
                                meta_resp = await http_client.get(
                                    f"{s_url}/library/metadata/{item_id}",
                                    headers={"X-Plex-Token": creds.get("token"), "Accept": "application/xml"}
                                )
                                if meta_resp.status_code == 200:
                                    plex_xml_bytes = meta_resp.content
                                    m_root = fromstring(meta_resp.content)
                                    audio_langs = []
                                    for s in m_root.findall(".//Stream"):
                                        if s.get("streamType") == "2":
                                            lc = s.get("languageCode") or s.get("languageTag") or s.get("language")
                                            if lc:
                                                clean_code = str(lc).lower().split("-")[0].split("_")[0].strip()
                                                norm_l = LANGUAGE_MAP.get(clean_code, LANGUAGE_MAP.get(str(lc).lower(), clean_code))
                                                if norm_l not in audio_langs:
                                                    audio_langs.append(norm_l)
                                            if not item.get("audio_codec") and s.get("codec"):
                                                item["audio_codec"] = s.get("codec")
                                            a_title = s.get("title") or s.get("displayTitle") or ""
                                            if a_title and not item.get("audio_track_title"):
                                                item["audio_track_title"] = a_title
                                                item["audio_title"] = a_title
                                        elif s.get("streamType") == "1":
                                            dovi = s.get("DOVIPresent") or s.get("doviPresent")
                                            if dovi == "1" or "dovi" in str(s.get("displayTitle", "")).lower():
                                                item["has_dolby_vision"] = True
                                            cp = s.get("colorPrimaries")
                                            if cp == "bt2020" or "hdr" in str(s.get("displayTitle", "")).lower():
                                                item["has_hdr"] = True
                                    if audio_langs:
                                        item["audio_languages"] = audio_langs

                                    for v_node in m_root.findall(".//Video"):
                                        if v_node.get("editionTitle"):
                                            item["edition"] = v_node.get("editionTitle")
                                        dur_node = int(v_node.get("duration") or 0)
                                        if dur_node > 0:
                                            item["runtime_mins"] = dur_node // 60000

                                    if not item.get("content_rating"):
                                        for v_node in m_root.findall(".//Video"):
                                            if v_node.get("contentRating"):
                                                item["content_rating"] = v_node.get("contentRating")
                                                break
                                    if not item.get("studio"):
                                        for d_node in m_root.findall(".//Directory"):
                                            if d_node.get("studio"):
                                                item["studio"] = d_node.get("studio")
                                                break

                                    # Extract TMDb and IMDb IDs from Guids if not already resolved
                                    if not item.get("tmdb_id") or not item.get("imdb_id"):
                                        for g_node in m_root.findall(".//Guid"):
                                            gid = g_node.get("id", "")
                                            if gid.startswith("tmdb://") and not item.get("tmdb_id"):
                                                item["tmdb_id"] = gid[7:]
                                            elif gid.startswith("imdb://") and not item.get("imdb_id"):
                                                item["imdb_id"] = gid[7:]

                                    if not item.get("status"):
                                        for d_node in m_root.findall(".//Directory"):
                                            if d_node.get("status"):
                                                item["status"] = d_node.get("status")
                                                break
                            except Exception as m_err:
                                logger.debug(f"Metadata stream query error for {title}: {m_err}")

                    # For TV Shows across all server types: resolve canonical status, networks, and content rating from TMDb API
                    if m_type == "show" and needs_status:
                        if item.get("tmdb_id"):
                            tmdb_token = creds.get("tmdb_token")
                            show_info = await resolve_tmdb_show_info(
                                tmdb_id=item["tmdb_id"],
                                tmdb_token=tmdb_token,
                                http_client=http_client,
                                server_type=s_type,
                                item_id=str(item_id),
                                title=title,
                                year=item.get("year")
                            )
                            if show_info.get("status"):
                                item["status"] = show_info["status"]
                            if show_info.get("networks"):
                                item["networks"] = show_info["networks"]
                                if not item.get("network"):
                                    item["network"] = show_info.get("network")
                            if show_info.get("content_rating") and not item.get("content_rating"):
                                item["content_rating"] = show_info["content_rating"]
                        # Normalize status string if raw (e.g. from Emby / Jellyfin)
                        raw_st = str(item.get("status") or "").strip().lower()
                        if "continu" in raw_st or "return" in raw_st:
                            item["status"] = "returning"
                        elif "end" in raw_st:
                            item["status"] = "ended"
                        elif "cancel" in raw_st:
                            item["status"] = "canceled"
                        elif "air" in raw_st or "product" in raw_st:
                            item["status"] = "airing"

                        # Ensure show status is persistently saved to SQLite cache for scheduled updates
                        if item.get("status") and s_type and item_id:
                            try:
                                from ratings_service import ratings_cache
                                ratings_cache.save_show_status(
                                    server_type=s_type,
                                    item_id=str(item_id),
                                    title=title,
                                    year=item.get("year"),
                                    tmdb_id=item.get("tmdb_id"),
                                    status=item["status"],
                                    network=item.get("network"),
                                    content_rating=item.get("content_rating"),
                                    source="server" if not item.get("tmdb_id") else "tmdb"
                                )
                            except Exception as st_save_err:
                                logger.debug(f"[OverlaySync] Failed to persist show status for {title}: {st_save_err}")
                    elif m_type == "movie" and needs_status:
                        if not item.get("content_rating") and item.get("tmdb_id"):
                            tmdb_token = creds.get("tmdb_token")
                            m_cr = await resolve_tmdb_movie_content_rating(item["tmdb_id"], tmdb_token, http_client)
                            if m_cr:
                                item["content_rating"] = m_cr

                    # Resolve multi-source ratings only if ratings overlays are configured for this library
                    multi_ratings = {}
                    if needs_ratings:
                        multi_ratings = await resolve_media_ratings(
                            server_type=s_type,
                            item_id=str(item_id),
                            title=title,
                            year=item.get("year"),
                            media_type=m_type,
                            imdb_id=item.get("imdb_id"),
                            tmdb_id=item.get("tmdb_id"),
                            plex_xml_bytes=plex_xml_bytes,
                            tmdb_api_key=creds.get("tmdb_token"),
                            mdblist_api_key=mdblist_key,
                            omdb_api_key=omdb_key,
                            enabled_sources=rating_sources,
                            client=http_client,
                            force_refresh=(scope == "full"),
                            server_community_rating=item.get("rating"),
                            server_critic_rating=item.get("critic_rating")
                        )
                    item["multi_ratings"] = multi_ratings

                    # -------------------------------------------------------------
                    # 2A. PROCESS POSTER OVERLAYS
                    # -------------------------------------------------------------
                    if clean_asset:
                        mtime, size, clean_asset_hash = compute_file_fingerprint(clean_asset)
                        overlay_layers = build_overlay_layers_for_item(item, lib_rules, overlays_dir, is_landscape=False)
                        recipe_hash = compute_layers_recipe_hash(overlay_layers)
                        meta_hash = compute_metadata_hash(
                            languages=item.get("audio_languages"),
                            runtime_mins=item.get("runtime_mins"),
                            edition=item.get("edition"),
                            status=item.get("status"),
                            resolution=item.get("resolution"),
                            content_rating=item.get("content_rating"),
                            network=item.get("network"),
                            multi_ratings=multi_ratings,
                            audio_codec=item.get("audio_codec"),
                            video_format=item.get("video_format"),
                            has_hdr=item.get("has_hdr"),
                            has_dolby_vision=item.get("has_dolby_vision")
                        )

                        is_current = cache.is_cached_and_current(
                            server_type=s_type,
                            item_id=str(item_id),
                            asset_type="poster",
                            clean_asset_hash=clean_asset_hash,
                            overlay_recipe_hash=recipe_hash,
                            metadata_hash=meta_hash,
                            server_updated_at=item.get("server_updated_at"),
                            cached_entry=cached_entry
                        )

                        if scope != "incremental" or not is_current or is_target_mode:
                            try:
                                with open(clean_asset, "rb") as cf:
                                    base_bytes = cf.read()

                                if overlay_layers:
                                    composited_jpeg = await asyncio.to_thread(
                                        DynamicOverlayCompositor.composite_overlays,
                                        base_image_bytes=base_bytes,
                                        layers=overlay_layers,
                                        canvas_type="portrait",
                                        abort_on_missing_asset=True,
                                        debug_logging=debug_log_enabled,
                                        debug_callback=write_log,
                                        item_label=f"{item_label} (Poster)"
                                    )
                                else:
                                    # Check if this item previously had an overlay applied by us
                                    cached_entry = cache.get_entry(s_type, str(item_id), "poster")
                                    was_previously_overlaid = (
                                        cached_entry
                                        and cached_entry.get("status") == "synced"
                                        and cached_entry.get("overlay_recipe_hash") not in (None, "", "none")
                                    )
                                    if not was_previously_overlaid:
                                        # Never overlaid and no overlays apply -> leave server completely untouched!
                                        await _inc_stats(skipped=1)
                                        cache.record_push(
                                            server_type=s_type,
                                            item_id=str(item_id),
                                            asset_type="poster",
                                            clean_asset_hash=clean_asset_hash,
                                            clean_asset_mtime=mtime,
                                            clean_asset_size=size,
                                            overlay_recipe_hash="none",
                                            metadata_hash=meta_hash,
                                            status="skipped",
                                            server_updated_at=item.get("server_updated_at")
                                        )
                                        return
                                    composited_jpeg = base_bytes

                                upload_success = False
                                if s_type == "plex":
                                    upload_url = f"{s_url}/library/metadata/{item_id}/posters"
                                    headers = {
                                        "X-Plex-Token": creds.get("token"),
                                        "Content-Type": "image/jpeg"
                                    }
                                    resp = await http_client.post(upload_url, headers=headers, content=composited_jpeg)
                                    upload_success = (resp.status_code in [200, 201])
                                elif s_type in ["jellyfin", "emby"]:
                                    upload_url = f"{s_url}/Items/{item_id}/Images/Primary"
                                    headers = {
                                        "X-Emby-Token": creds.get("api_key"),
                                        "Authorization": f'MediaBrowser Token="{creds.get("api_key")}"',
                                        "Content-Type": "image/jpeg"
                                    }
                                    b64_img = base64.b64encode(composited_jpeg)
                                    resp = await http_client.post(upload_url, headers=headers, content=b64_img)
                                    upload_success = (resp.status_code in [200, 201, 204])

                                if upload_success:
                                    cache.record_push(
                                        server_type=s_type,
                                        server_url=s_url,
                                        item_id=str(item_id),
                                        asset_type="poster",
                                        clean_asset_path=str(clean_asset),
                                        clean_asset_mtime=mtime,
                                        clean_asset_size=size,
                                        clean_asset_hash=clean_asset_hash,
                                        overlay_recipe_hash=recipe_hash,
                                        item_title=title,
                                        library_name=lib_name,
                                        media_type=m_type,
                                        status="synced",
                                        server_updated_at=item.get("server_updated_at"),
                                        detected_languages=",".join(sorted(item.get("audio_languages", []))) if item.get("audio_languages") else None,
                                        runtime_mins=item.get("runtime_mins"),
                                        edition=item.get("edition"),
                                        show_status=item.get("status"),
                                        metadata_hash=meta_hash,
                                        detected_audio_codec=item.get("audio_codec"),
                                        detected_video_format=item.get("video_format"),
                                        detected_resolution=item.get("resolution")
                                    )
                                    await _inc_stats(synced=1)
                                    if overlay_layers:
                                        write_log(f"  [+] {w_tag}Overlaid & Synced: '{title}' ({lib_name}) -> {s_type.upper()}")
                                    else:
                                        write_log(f"  [+] {w_tag}Overlays Removed & Clean Poster Restored: '{title}' ({lib_name}) -> {s_type.upper()}")
                                else:
                                    await _inc_stats(failed=1)
                                    write_log(f"  [-] {w_tag}Failed uploading '{title}' to {s_type.upper()}: Status {getattr(resp, 'status_code', 'error')}")

                            except OverlayAssetMissingError as ame:
                                await _inc_stats(failed=1)
                                write_log(f"  [!] Aborted overlay for '{title}' (Poster): {ame.message}. Server artwork left untouched.")
                                logger.warning(f"[OverlaySync] Aborted overlay for '{title}' (Poster): {ame.message}")
                            except Exception as comp_err:
                                await _inc_stats(failed=1)
                                write_log(f"  [-] Error compositing/uploading '{title}': {comp_err}")
                        else:
                            await _inc_stats(skipped=1)
                            if item.get("server_updated_at"):
                                cache.update_server_updated_at(s_type, str(item_id), "poster", item.get("server_updated_at"))

                        if _cancel_requested:
                            return

                    # -------------------------------------------------------------
                    # 2B. PROCESS BACKDROP OVERLAYS (16:9 Landscape)
                    # -------------------------------------------------------------
                    if clean_backdrop:
                        bmtime, bsize, bclean_hash = compute_file_fingerprint(clean_backdrop)
                        b_item_meta = {**item, "is_backdrop": True, "canvas_type": "landscape"}
                        b_layers = build_overlay_layers_for_item(b_item_meta, lib_rules, overlays_dir, is_landscape=True)
                        b_recipe_hash = compute_layers_recipe_hash(b_layers)

                        b_cached_entry = cache.get_entry(s_type, str(item_id), "background")
                        b_is_current = cache.is_cached_and_current(
                            server_type=s_type,
                            item_id=str(item_id),
                            asset_type="background",
                            clean_asset_hash=bclean_hash,
                            overlay_recipe_hash=b_recipe_hash,
                            metadata_hash=meta_hash if clean_asset else compute_metadata_hash(
                                languages=item.get("audio_languages"),
                                runtime_mins=item.get("runtime_mins"),
                                edition=item.get("edition"),
                                status=item.get("status"),
                                resolution=item.get("resolution"),
                                content_rating=item.get("content_rating"),
                                network=item.get("network"),
                                multi_ratings=multi_ratings,
                                audio_codec=item.get("audio_codec"),
                                video_format=item.get("video_format"),
                                has_hdr=item.get("has_hdr"),
                                has_dolby_vision=item.get("has_dolby_vision")
                            ),
                            server_updated_at=item.get("server_updated_at"),
                            cached_entry=b_cached_entry
                        )

                        if scope != "incremental" or not b_is_current or is_target_mode:
                            try:
                                with open(clean_backdrop, "rb") as bf:
                                    b_base_bytes = bf.read()

                                if b_layers:
                                    b_comp = await asyncio.to_thread(
                                        DynamicOverlayCompositor.composite_overlays,
                                        base_image_bytes=b_base_bytes,
                                        layers=b_layers,
                                        canvas_type="landscape",
                                        abort_on_missing_asset=True,
                                        debug_logging=debug_log_enabled,
                                        debug_callback=write_log,
                                        item_label=f"{item_label} (Backdrop)"
                                    )
                                else:
                                    b_was_previously_overlaid = (
                                        b_cached_entry
                                        and b_cached_entry.get("status") == "synced"
                                        and b_cached_entry.get("overlay_recipe_hash") not in (None, "", "none")
                                    )
                                    if not b_was_previously_overlaid:
                                        cache.record_push(
                                            server_type=s_type,
                                            item_id=str(item_id),
                                            asset_type="background",
                                            clean_asset_hash=bclean_hash,
                                            clean_asset_mtime=bmtime,
                                            clean_asset_size=bsize,
                                            overlay_recipe_hash="none",
                                            metadata_hash=b_recipe_hash,
                                            status="skipped",
                                            server_updated_at=item.get("server_updated_at")
                                        )
                                        b_comp = None
                                    else:
                                        b_comp = b_base_bytes

                                b_upload_success = False
                                if b_comp is not None:
                                    if s_type == "plex":
                                        b_url = f"{s_url}/library/metadata/{item_id}/arts"
                                        b_headers = {
                                            "X-Plex-Token": creds.get("token"),
                                            "Content-Type": "image/jpeg"
                                        }
                                        b_resp = await http_client.post(b_url, headers=b_headers, content=b_comp)
                                        b_upload_success = (b_resp.status_code in [200, 201])
                                    elif s_type in ["jellyfin", "emby"]:
                                        b_url = f"{s_url}/Items/{item_id}/Images/Backdrop"
                                        b_headers = {
                                            "X-Emby-Token": creds.get("api_key"),
                                            "Authorization": f'MediaBrowser Token="{creds.get("api_key")}"',
                                            "Content-Type": "image/jpeg"
                                        }
                                        b64_b_comp = base64.b64encode(b_comp)
                                        b_resp = await http_client.post(b_url, headers=b_headers, content=b64_b_comp)
                                        b_upload_success = (b_resp.status_code in [200, 201, 204])

                                if b_upload_success:
                                    cache.record_push(
                                        server_type=s_type,
                                        server_url=s_url,
                                        item_id=str(item_id),
                                        asset_type="background",
                                        clean_asset_path=str(clean_backdrop),
                                        clean_asset_mtime=bmtime,
                                        clean_asset_size=bsize,
                                        clean_asset_hash=bclean_hash,
                                        overlay_recipe_hash=b_recipe_hash,
                                        item_title=f"{title} (Backdrop)",
                                        library_name=lib_name,
                                        media_type=m_type,
                                        status="synced",
                                        server_updated_at=item.get("server_updated_at"),
                                        detected_languages=",".join(sorted(item.get("audio_languages", []))) if item.get("audio_languages") else None,
                                        runtime_mins=item.get("runtime_mins"),
                                        edition=item.get("edition"),
                                        show_status=item.get("status"),
                                        metadata_hash=meta_hash if clean_asset else None,
                                        detected_audio_codec=item.get("audio_codec"),
                                        detected_video_format=item.get("video_format"),
                                        detected_resolution=item.get("resolution")
                                    )
                                    await _inc_stats(synced=1)
                                    if b_layers:
                                        write_log(f"  [+] {w_tag}Overlaid & Synced Backdrop: '{title}' ({lib_name}) -> {s_type.upper()}")
                                    else:
                                        write_log(f"  [+] {w_tag}Overlays Removed & Clean Backdrop Restored: '{title}' ({lib_name}) -> {s_type.upper()}")
                                else:
                                    await _inc_stats(failed=1)
                                    write_log(f"  [-] {w_tag}Failed uploading backdrop for '{title}' to {s_type.upper()}: Status {getattr(b_resp, 'status_code', 'error')}")
                            except OverlayAssetMissingError as ame:
                                await _inc_stats(failed=1)
                                write_log(f"  [!] Aborted overlay for '{title}' (Backdrop): {ame.message}. Server artwork left untouched.")
                                logger.warning(f"[OverlaySync] Aborted overlay for '{title}' (Backdrop): {ame.message}")
                            except Exception as b_err:
                                await _inc_stats(failed=1)
                                write_log(f"  [-] Error compositing/uploading backdrop for '{title}': {b_err}")
                        else:
                            await _inc_stats(skipped=1)
                            if item.get("server_updated_at"):
                                cache.update_server_updated_at(s_type, str(item_id), "background", item.get("server_updated_at"))

                    if _cancel_requested:
                        return

                    # 7. If Show, also evaluate and sync Seasons & Titlecards if clean assets present on disk
                    show_parent = (clean_asset.parent if clean_asset else (clean_backdrop.parent if clean_backdrop else None))
                    if m_type == "show" and show_parent and show_parent.exists():
                        try:
                            # Fast disk scan: check if this show has any season posters or titlecards on disk
                            show_key = f"files_{show_parent.resolve()}"
                            files_map = dir_cache.get(show_key)
                            if files_map is None:
                                try:
                                    files_map = {f.name.lower(): f for f in show_parent.iterdir() if f.is_file()}
                                except Exception:
                                    files_map = {}
                                dir_cache[show_key] = files_map

                            tc_key = f"tc_{show_parent.resolve()}"
                            tc_map = dir_cache.get(tc_key)
                            if tc_map is None:
                                find_titlecard(show_parent, 1, 1, dir_cache=dir_cache)
                                tc_map = dir_cache.get(tc_key, {})

                            has_season_posters = any("season" in fn or "specials" in fn for fn in files_map)
                            has_titlecards = bool(tc_map)

                            # If no season posters and no titlecards exist on disk for this show, skip all season/episode calls!
                            if not has_season_posters and not has_titlecards:
                                return

                            seasons_to_process = []
                            if s_type == "plex":
                                ch_resp = await http_client.get(
                                    f"{s_url}/library/metadata/{item_id}/children",
                                    headers={"X-Plex-Token": creds.get("token"), "Accept": "application/xml"}
                                )
                                if ch_resp.status_code == 200:
                                    ch_root = fromstring(ch_resp.content)
                                    for s_dir in ch_root.findall(".//Directory"):
                                        s_rk = s_dir.get("ratingKey")
                                        s_idx = s_dir.get("index")
                                        if s_rk and s_idx and s_idx.isdigit():
                                            seasons_to_process.append({"id": str(s_rk), "season_number": int(s_idx)})
                            elif s_type in ["jellyfin", "emby"]:
                                em_s_resp = await http_client.get(
                                    f"{s_url}/Shows/{item_id}/Seasons",
                                    headers=headers
                                )
                                if em_s_resp.status_code == 200:
                                    for s_obj in em_s_resp.json().get("Items", []):
                                        s_rk = s_obj.get("Id")
                                        s_idx = s_obj.get("IndexNumber")
                                        if s_rk and s_idx is not None:
                                            try:
                                                seasons_to_process.append({"id": str(s_rk), "season_number": int(s_idx)})
                                            except (ValueError, TypeError):
                                                pass

                            for s_info in seasons_to_process:
                                if _cancel_requested:
                                    return
                                s_rk = s_info["id"]
                                s_num = s_info["season_number"]
                                clean_season = find_season_poster(show_parent, s_num, root_f, dir_cache=dir_cache) if has_season_posters else None
                                if clean_season:
                                    smtime, ssize, sclean_hash = compute_file_fingerprint(clean_season)
                                    s_item_meta = {
                                        **item,
                                        "media_type": "season",
                                        "is_season": True,
                                        "season_number": s_num,
                                        "studio": item.get("studio"),
                                        "network": item.get("network"),
                                        "networks": item.get("networks", []),
                                        "status": item.get("status")
                                    }
                                    s_layers = build_overlay_layers_for_item(s_item_meta, lib_rules, overlays_dir, is_landscape=False)
                                    s_recipe_hash = compute_layers_recipe_hash(s_layers)
                                    s_meta_hash = compute_metadata_hash(
                                        languages=item.get("audio_languages"),
                                        runtime_mins=None,
                                        edition=None,
                                        status=item.get("status"),
                                        resolution=item.get("resolution"),
                                        content_rating=item.get("content_rating"),
                                        network=item.get("network"),
                                        multi_ratings=None,
                                        audio_codec=item.get("audio_codec"),
                                        video_format=item.get("video_format")
                                    )

                                    s_cached_entry = cache.get_entry(s_type, str(s_rk), "season")
                                    s_current = cache.is_cached_and_current(
                                        server_type=s_type,
                                        item_id=str(s_rk),
                                        asset_type="season",
                                        clean_asset_hash=sclean_hash,
                                        overlay_recipe_hash=s_recipe_hash,
                                        metadata_hash=s_meta_hash,
                                        server_updated_at=item.get("server_updated_at"),
                                        cached_entry=s_cached_entry
                                    )

                                    if scope != "incremental" or not s_current:
                                        try:
                                            with open(clean_season, "rb") as csf:
                                                s_base_bytes = csf.read()

                                            if s_layers:
                                                s_comp = await asyncio.to_thread(
                                                    DynamicOverlayCompositor.composite_overlays,
                                                    base_image_bytes=s_base_bytes,
                                                    layers=s_layers,
                                                    canvas_type="portrait",
                                                    abort_on_missing_asset=True,
                                                    debug_logging=debug_log_enabled,
                                                    debug_callback=write_log,
                                                    item_label=f"Worker {worker_id} | '{title}' S{s_num:02d} (Season)" if concurrency > 1 else f"'{title}' S{s_num:02d} (Season)"
                                                )
                                            else:
                                                s_comp = s_base_bytes

                                            s_success = False
                                            if s_type == "plex":
                                                s_resp = await http_client.post(
                                                    f"{s_url}/library/metadata/{s_rk}/posters",
                                                    headers={"X-Plex-Token": creds.get("token"), "Content-Type": "image/jpeg"},
                                                    content=s_comp
                                                )
                                                s_success = (s_resp.status_code in [200, 201])
                                            elif s_type in ["jellyfin", "emby"]:
                                                b64_s = base64.b64encode(s_comp)
                                                s_resp = await http_client.post(
                                                    f"{s_url}/Items/{s_rk}/Images/Primary",
                                                    headers=headers,
                                                    content=b64_s
                                                )
                                                s_success = (s_resp.status_code in [200, 201, 204])

                                            if s_success:
                                                cache.record_push(
                                                    server_type=s_type,
                                                    server_url=s_url,
                                                    item_id=str(s_rk),
                                                    asset_type="season",
                                                    clean_asset_path=str(clean_season),
                                                    clean_asset_mtime=smtime,
                                                    clean_asset_size=ssize,
                                                    clean_asset_hash=sclean_hash,
                                                    overlay_recipe_hash=s_recipe_hash,
                                                    item_title=f"{title} - Season {s_num}",
                                                    library_name=lib_name,
                                                    media_type="season",
                                                    status="synced",
                                                    server_updated_at=item.get("server_updated_at"),
                                                    detected_languages=",".join(sorted(item.get("audio_languages", []))) if item.get("audio_languages") else None,
                                                    runtime_mins=None,
                                                    edition=None,
                                                    show_status=item.get("status"),
                                                    metadata_hash=s_meta_hash,
                                                    detected_audio_codec=item.get("audio_codec"),
                                                    detected_video_format=item.get("video_format"),
                                                    detected_resolution=item.get("resolution")
                                                )
                                                await _inc_stats(synced=1)
                                                write_log(f"  [+] {w_tag}Overlaid & Synced Season: '{title} S{s_num:02d}' -> {s_type.upper()}")
                                            else:
                                                await _inc_stats(failed=1)
                                        except OverlayAssetMissingError as ame:
                                            await _inc_stats(failed=1)
                                            write_log(f"  [!] Aborted overlay for '{title} S{s_num:02d}' (Season): {ame.message}. Server artwork left untouched.")
                                            logger.warning(f"[OverlaySync] Aborted overlay for '{title} S{s_num:02d}' (Season): {ame.message}")
                                        except Exception as s_comp_err:
                                            await _inc_stats(failed=1)
                                            write_log(f"  [-] Error compositing/uploading season '{title} S{s_num:02d}': {s_comp_err}")
                                    else:
                                        await _inc_stats(skipped=1)
                                        if item.get("server_updated_at"):
                                            cache.update_server_updated_at(s_type, f"{item_id}_s{s_num}", "season", item.get("server_updated_at"))

                                # 8. Discover and sync Titlecards (Episodes) for this Season
                                if has_titlecards:
                                    try:
                                        episodes_to_process = []
                                        if s_type == "plex":
                                            ep_resp = await http_client.get(
                                                f"{s_url}/library/metadata/{s_rk}/children",
                                                headers={"X-Plex-Token": creds.get("token"), "Accept": "application/xml"}
                                            )
                                            if ep_resp.status_code == 200:
                                                ep_root = fromstring(ep_resp.content)
                                                for ep_elem in ep_root.findall(".//Video"):
                                                    ep_rk = ep_elem.get("ratingKey")
                                                    ep_idx = ep_elem.get("index")
                                                    if not ep_rk or not ep_idx or not ep_idx.isdigit():
                                                        continue
                                                    ep_num = int(ep_idx)
                                                    clean_tc = find_titlecard(show_parent, s_num, ep_num, dir_cache=dir_cache)
                                                    if not clean_tc:
                                                        continue

                                                    ep_title = ep_elem.get("title", f"Episode {ep_num}")

                                                    dur_ms = int(ep_elem.get("duration") or 0)
                                                    ep_dur_mins = dur_ms // 60000 if dur_ms > 0 else None
                                                    ep_res = "1080p"
                                                    ep_audio_c = None
                                                    ep_has_dv = False
                                                    ep_has_hdr = False
                                                    for med in ep_elem.findall(".//Media"):
                                                        w_val = int(med.get("width") or 0)
                                                        vr_val = med.get("videoResolution")
                                                        if w_val >= 3840 or vr_val in ["4k", "2160"]:
                                                            ep_res = "4K"
                                                        elif vr_val:
                                                            ep_res = f"{vr_val}p"
                                                        if med.get("audioCodec"):
                                                            ep_audio_c = med.get("audioCodec")

                                                    ep_langs = []
                                                    for st_node in ep_elem.findall(".//Stream"):
                                                        if st_node.get("streamType") == "2":
                                                            lc_code = st_node.get("languageCode") or st_node.get("languageTag") or st_node.get("language")
                                                            if lc_code:
                                                                clean_code = str(lc_code).lower().split("-")[0].split("_")[0].strip()
                                                                norm_lang = LANGUAGE_MAP.get(clean_code, LANGUAGE_MAP.get(str(lc_code).lower(), clean_code))
                                                                if norm_lang not in ep_langs:
                                                                    ep_langs.append(norm_lang)
                                                        elif st_node.get("streamType") == "1":
                                                            if st_node.get("DOVIPresent") == "1":
                                                                ep_has_dv = True
                                                            if st_node.get("colorPrimaries") == "bt2020":
                                                                ep_has_hdr = True

                                                    if not ep_langs and needs_languages:
                                                        try:
                                                            ep_det_resp = await http_client.get(
                                                                f"{s_url}/library/metadata/{ep_rk}",
                                                                headers={"X-Plex-Token": creds.get("token"), "Accept": "application/xml"}
                                                            )
                                                            if ep_det_resp.status_code == 200:
                                                                ep_det_root = fromstring(ep_det_resp.content)
                                                                for st_node in ep_det_root.findall(".//Stream"):
                                                                    if st_node.get("streamType") == "2":
                                                                        lc_code = st_node.get("languageCode") or st_node.get("language")
                                                                        if lc_code:
                                                                            norm_lang = LANGUAGE_MAP.get(lc_code.lower(), lc_code.lower())
                                                                            if norm_lang not in ep_langs:
                                                                                ep_langs.append(norm_lang)
                                                                    elif st_node.get("streamType") == "1":
                                                                        if st_node.get("DOVIPresent") == "1":
                                                                            ep_has_dv = True
                                                                        if st_node.get("colorPrimaries") == "bt2020":
                                                                            ep_has_hdr = True
                                                        except Exception:
                                                            pass

                                                    ep_filepath = None
                                                    part_elem = ep_elem.find(".//Part")
                                                    if part_elem is not None and part_elem.get("file"):
                                                        ep_filepath = part_elem.get("file")

                                                    episodes_to_process.append({
                                                        "id": ep_rk,
                                                        "episode_number": ep_num,
                                                        "title": ep_title,
                                                        "runtime_mins": ep_dur_mins,
                                                        "resolution": ep_res,
                                                        "audio_codec": ep_audio_c,
                                                        "audio_languages": ep_langs,
                                                        "has_hdr": ep_has_hdr,
                                                        "has_dolby_vision": ep_has_dv,
                                                        "filepath": ep_filepath,
                                                        "clean_tc": clean_tc
                                                    })
                                        elif s_type in ["jellyfin", "emby"]:
                                            em_ep_resp = await http_client.get(
                                                f"{s_url}/Shows/{item_id}/Episodes?SeasonId={s_rk}&Fields=MediaStreams,OfficialRating,RunTimeTicks,Status,ProviderIds,Path",
                                                headers=headers
                                            )
                                            if em_ep_resp.status_code == 200:
                                                for ep_obj in em_ep_resp.json().get("Items", []):
                                                    ep_rk = ep_obj.get("Id")
                                                    ep_idx = ep_obj.get("IndexNumber")
                                                    if not ep_rk or ep_idx is None:
                                                        continue
                                                    try:
                                                        ep_num = int(ep_idx)
                                                    except (ValueError, TypeError):
                                                        continue
                                                    clean_tc = find_titlecard(show_parent, s_num, ep_num, dir_cache=dir_cache)
                                                    if not clean_tc:
                                                        continue

                                                    ep_title = ep_obj.get("Name", f"Episode {ep_num}")
                                                    dur_ticks = ep_obj.get("RunTimeTicks") or 0
                                                    ep_dur_mins = (dur_ticks // 600000000) if dur_ticks > 0 else None

                                                    ep_res = "1080p"
                                                    ep_audio_c = None
                                                    ep_has_dv = False
                                                    ep_has_hdr = False
                                                    ep_langs = []

                                                    for s in ep_obj.get("MediaStreams", []):
                                                        stype = s.get("Type")
                                                        if stype == "Audio":
                                                            lc = s.get("Language") or s.get("DisplayLanguage")
                                                            if lc:
                                                                norm_lang = LANGUAGE_MAP.get(lc.lower(), lc.lower())
                                                                if norm_lang not in ep_langs:
                                                                    ep_langs.append(norm_lang)
                                                            if not ep_audio_c and s.get("Codec"):
                                                                ep_audio_c = s.get("Codec")
                                                        elif stype == "Video":
                                                            w_val = s.get("Width") or 0
                                                            if w_val >= 3840:
                                                                ep_res = "4K"
                                                            dovi = s.get("VideoDoViTitle") or ("dovi" in str(s.get("DisplayTitle", "")).lower())
                                                            if dovi:
                                                                ep_has_dv = True
                                                            hdr = (s.get("VideoRange") == "HDR") or ("hdr" in str(s.get("DisplayTitle", "")).lower())
                                                            if hdr:
                                                                ep_has_hdr = True

                                                    episodes_to_process.append({
                                                        "id": str(ep_rk),
                                                        "episode_number": ep_num,
                                                        "title": ep_title,
                                                        "runtime_mins": ep_dur_mins,
                                                        "resolution": ep_res,
                                                        "audio_codec": ep_audio_c,
                                                        "audio_languages": ep_langs,
                                                        "has_hdr": ep_has_hdr,
                                                        "has_dolby_vision": ep_has_dv,
                                                        "filepath": ep_obj.get("Path"),
                                                        "clean_tc": clean_tc
                                                    })

                                        for ep_data in episodes_to_process:
                                            if _cancel_requested:
                                                return
                                            ep_rk = ep_data["id"]
                                            ep_num = ep_data["episode_number"]
                                            ep_title = ep_data["title"]
                                            clean_tc = ep_data.get("clean_tc") or find_titlecard(show_parent, s_num, ep_num, dir_cache=dir_cache)
                                            if not clean_tc:
                                                continue

                                            tc_mtime, tc_size, tc_clean_hash = compute_file_fingerprint(clean_tc)
                                            ep_meta = {
                                                "media_type": "episode",
                                                "is_episode": True,
                                                "season_number": s_num,
                                                "episode_number": ep_num,
                                                "title": ep_title,
                                                "show_title": title,
                                                "runtime_mins": ep_data["runtime_mins"],
                                                "resolution": ep_data["resolution"],
                                                "audio_codec": ep_data["audio_codec"],
                                                "audio_languages": ep_data["audio_languages"],
                                                "has_hdr": ep_data["has_hdr"],
                                                "has_dolby_vision": ep_data["has_dolby_vision"],
                                                "studio": item.get("studio"),
                                                "network": item.get("network"),
                                                "networks": item.get("networks", []),
                                                "status": item.get("status"),
                                                "content_rating": item.get("content_rating"),
                                                "filepath": ep_data["filepath"] or str(clean_tc),
                                                "clean_tc": str(clean_tc),
                                            }

                                            effective_ep_rules = list(lib_rules)
                                            anime_cfg = overlays_dir / "configs" / "anime_overlays.yml"
                                            if anime_cfg.exists():
                                                try:
                                                    from animetafill_service import is_animetafill_enabled
                                                    anim_enabled = is_animetafill_enabled()
                                                except Exception:
                                                    anim_enabled = False

                                                has_anime_rule = any(
                                                    str(r.get("file", "")).endswith("anime_overlays.yml")
                                                    for r in effective_ep_rules if isinstance(r, dict)
                                                )
                                                if anim_enabled and not has_anime_rule:
                                                    effective_ep_rules.append({"file": "config/anime_overlays.yml"})

                                            ep_layers = build_overlay_layers_for_item(
                                                ep_meta, effective_ep_rules, overlays_dir, is_landscape=True
                                            )
                                            ep_recipe_hash = compute_layers_recipe_hash(ep_layers)
                                            ep_meta_hash = compute_metadata_hash(
                                                languages=ep_data.get("audio_languages"),
                                                runtime_mins=ep_data.get("runtime_mins"),
                                                edition=None,
                                                status=item.get("status"),
                                                resolution=ep_data.get("resolution"),
                                                content_rating=item.get("content_rating"),
                                                network=item.get("network"),
                                                multi_ratings=None,
                                                audio_codec=ep_data.get("audio_codec"),
                                                video_format=ep_data.get("video_format"),
                                                has_hdr=ep_data.get("has_hdr"),
                                                has_dolby_vision=ep_data.get("has_dolby_vision")
                                            )

                                            ep_cached_entry = cache.get_entry(s_type, str(ep_rk), "titlecard")
                                            ep_current = cache.is_cached_and_current(
                                                server_type=s_type,
                                                item_id=str(ep_rk),
                                                asset_type="titlecard",
                                                clean_asset_hash=tc_clean_hash,
                                                overlay_recipe_hash=ep_recipe_hash,
                                                metadata_hash=ep_meta_hash,
                                                server_updated_at=item.get("server_updated_at"),
                                                cached_entry=ep_cached_entry
                                            )

                                            if scope == "incremental" and ep_current:
                                                await _inc_stats(skipped=1)
                                                if item.get("server_updated_at"):
                                                    cache.update_server_updated_at(s_type, f"{item_id}_s{s_num}e{ep_num}", "episode", item.get("server_updated_at"))
                                                continue

                                            with open(clean_tc, "rb") as tcf:
                                                tc_base_bytes = tcf.read()

                                            if ep_layers:
                                                tc_comp = await asyncio.to_thread(
                                                    DynamicOverlayCompositor.composite_overlays,
                                                    base_image_bytes=tc_base_bytes,
                                                    layers=ep_layers,
                                                    canvas_type="landscape",
                                                    abort_on_missing_asset=True,
                                                    debug_logging=debug_log_enabled,
                                                    debug_callback=write_log,
                                                    item_label=f"Worker {worker_id} | '{title}' S{s_num:02d}E{ep_num:02d} (Titlecard)" if concurrency > 1 else f"'{title}' S{s_num:02d}E{ep_num:02d} (Titlecard)"
                                                )
                                            else:
                                                tc_comp = tc_base_bytes

                                        tc_success = False
                                        if s_type == "plex":
                                            tc_resp = await http_client.post(
                                                f"{s_url}/library/metadata/{ep_rk}/posters",
                                                headers={"X-Plex-Token": creds.get("token"), "Content-Type": "image/jpeg"},
                                                content=tc_comp
                                            )
                                            tc_success = (tc_resp.status_code in [200, 201])
                                        elif s_type in ["jellyfin", "emby"]:
                                            b64_tc = base64.b64encode(tc_comp)
                                            tc_resp = await http_client.post(
                                                f"{s_url}/Items/{ep_rk}/Images/Primary",
                                                headers=headers,
                                                content=b64_tc
                                            )
                                            tc_success = (tc_resp.status_code in [200, 201, 204])

                                        if tc_success:
                                            cache.record_push(
                                                server_type=s_type,
                                                server_url=s_url,
                                                item_id=str(ep_rk),
                                                asset_type="titlecard",
                                                clean_asset_path=str(clean_tc),
                                                clean_asset_mtime=tc_mtime,
                                                clean_asset_size=tc_size,
                                                clean_asset_hash=tc_clean_hash,
                                                overlay_recipe_hash=ep_recipe_hash,
                                                item_title=f"{title} S{s_num:02d}E{ep_num:02d} - {ep_title}",
                                                library_name=lib_name,
                                                media_type="episode",
                                                status="synced",
                                                server_updated_at=item.get("server_updated_at"),
                                                detected_languages=",".join(sorted(ep_data.get("audio_languages", []))) if ep_data.get("audio_languages") else None,
                                                runtime_mins=ep_data.get("runtime_mins"),
                                                edition=None,
                                                show_status=item.get("status"),
                                                metadata_hash=ep_meta_hash,
                                                detected_audio_codec=ep_data.get("audio_codec"),
                                                detected_video_format=ep_data.get("video_format"),
                                                detected_resolution=ep_data.get("resolution")
                                            )
                                            await _inc_stats(synced=1)
                                            write_log(f"  [+] {w_tag}Overlaid & Synced Titlecard: '{title} S{s_num:02d}E{ep_num:02d}' -> {s_type.upper()}")
                                        else:
                                            await _inc_stats(failed=1)
                                            write_log(f"  [-] {w_tag}Failed uploading Titlecard '{title} S{s_num:02d}E{ep_num:02d}' to {s_type.upper()}: Status {getattr(tc_resp, 'status_code', 'error')}")
                                    except OverlayAssetMissingError as ame:
                                        await _inc_stats(failed=1)
                                        write_log(f"  [!] Aborted overlay for '{title} S{s_num:02d}E{ep_num:02d}' (Titlecard): {ame.message}. Server artwork left untouched.")
                                        logger.warning(f"[OverlaySync] Aborted overlay for '{title} S{s_num:02d}E{ep_num:02d}': {ame.message}")
                                    except Exception as ep_err:
                                        logger.debug(f"Episode sync error for {title} S{s_num:02d}: {ep_err}")
                                        write_log(f"  [-] {w_tag}Error syncing episodes for {title} S{s_num:02d}: {ep_err}")
                        except Exception as season_err:
                            logger.debug(f"Season sync error for {title}: {season_err}")

                worker_pool = asyncio.Queue()
                for wid in range(1, concurrency + 1):
                    worker_pool.put_nowait(wid)

                async def _worker(it):
                    if _cancel_requested:
                        return
                    wid = await worker_pool.get()
                    try:
                        if _cancel_requested:
                            return
                        await _process_sync_item(it, worker_id=wid)
                    except Exception as it_err:
                        logger.error(f"[OverlaySync] Unhandled error processing {it.get('title')}: {it_err}")
                        await _inc_stats(failed=1)
                    finally:
                        worker_pool.put_nowait(wid)

                await asyncio.gather(*[_worker(it) for it in media_items], return_exceptions=True)

                total_synced += server_stats["synced"]
                total_skipped += server_stats["skipped"]
                total_failed += server_stats["failed"]

                if _cancel_requested:
                    write_log("Dynamic overlay sync was stopped by user. Halting.")
                    break

        if _cancel_requested:
            write_log("=" * 70)
            write_log("DYNAMIC OVERLAYS SYNC STOPPED BY USER")
            write_log(f"Summary: {total_synced} Synced | {total_skipped} Skipped (Unmodified) | {total_failed} Failed")
            write_log("=" * 70)
            res = {
                "success": True,
                "stopped": True,
                "total_synced": total_synced,
                "total_skipped": total_skipped,
                "total_failed": total_failed,
                "message": "Dynamic overlay sync was stopped by user.",
                "log_file": "DynamicOverlaysSync.log"
            }
            _last_sync_result = res
            return res

        write_log("=" * 70)
        write_log(f"DYNAMIC OVERLAYS SYNC COMPLETE")
        write_log(f"Summary: {total_synced} Synced | {total_skipped} Skipped (Unmodified) | {total_failed} Failed")
        write_log("=" * 70)

        res = {
            "success": True,
            "total_synced": total_synced,
            "total_skipped": total_skipped,
            "total_failed": total_failed,
            "log_file": "DynamicOverlaysSync.log"
        }
        _last_sync_result = res
        return res

    except Exception as e:
        write_log(f"FATAL ERROR in overlay sync task: {e}")
        res = {"success": False, "error": str(e)}
        _last_sync_result = res
        return res
    finally:
        _is_sync_running = False

# ==============================================================================
# FAST BULK CHANGE AUTODETECTION
# ==============================================================================

async def detect_media_changes(
    target_server: str = "all",
    library: str = "all",
    base_dir: Optional[Path] = None,
    config_path: Optional[Path] = None
) -> Dict[str, Any]:
    """
    High-speed bulk change autodetection for media items across Plex, Jellyfin, and Emby.
    Fast-scans in bulk:
    - Audio language updates (e.g. ['en'] -> ['de', 'en'])
    - Edition / Cut upgrades (e.g. Theatrical -> Director's Cut)
    - Runtime / Duration modifications (e.g. 105m -> 135m)
    - TV Show status transitions (e.g. returning -> ended / canceled / airing)
    - Clean artwork file modifications on disk
    - Uncached / newly added media items
    Returns summary counters and list of items with changes.
    """
    if not base_dir:
        base_dir = Path(".")
    if not config_path:
        config_path = base_dir / "config.json"

    server_info = get_server_credentials(config_path)
    real_asset_path = server_info.get("asset_path") or resolve_configured_asset_path(base_dir / "assets")
    cache = OverlayCache(base_dir / "database" / "overlay_cache.db")

    summary = {
        "languages": 0,
        "editions": 0,
        "runtimes": 0,
        "status": 0,
        "new": 0,
        "asset_modified": 0
    }

    try:
        from dynamic_overlays_service import is_dynamic_overlays_enabled
        if not is_dynamic_overlays_enabled():
            return {
                "success": False,
                "error": "Dynamic Overlays is disabled in Master Switch.",
                "total_scanned": 0,
                "changed_count": 0,
                "changes": [],
                "summary": summary
            }
    except Exception:
        pass

    creds_map = {}
    for s_name in ["plex", "jellyfin", "emby"]:
        s_data = server_info.get(s_name)
        if s_data and s_data.get("url") and s_data.get("enabled"):
            creds_map[s_name] = {
                "url": s_data.get("url"),
                "token": s_data.get("token"),
                "api_key": s_data.get("api_key"),
                "excluded": s_data.get("excluded_libs", [])
            }

    # Load dynamic overlay rules from config.yml
    library_rules_map = {}
    overlays_dir = base_dir / "Overlayfiles" / "dynamic_overlays"
    if not overlays_dir.exists():
        legacy = base_dir / "Overlayfiles" / "kometa"
        if legacy.exists():
            overlays_dir = legacy
    config_yml = overlays_dir / "configs" / "config.yml"
    if config_yml.exists():
        try:
            import yaml
            with open(config_yml, "r", encoding="utf-8") as yf:
                raw_cfg = yaml.safe_load(yf) or {}
                raw_libs = raw_cfg.get("libraries", {})
                for l_name, l_data in raw_libs.items():
                    if isinstance(l_data, dict):
                        rules = l_data.get("overlay_files") or l_data.get("overlays") or []
                        if rules:
                            library_rules_map[l_name.lower()] = rules
        except Exception as ye:
            logger.debug(f"[DetectChanges] Error loading config.yml: {ye}")

    if not library_rules_map:
        return {
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "target_server": target_server,
            "library": library,
            "total_scanned": 0,
            "changed_count": 0,
            "unchanged_count": 0,
            "changes": [],
            "summary": summary
        }

    total_scanned = 0
    changed_items = []
    dir_cache: Dict[str, Any] = {}

    servers_to_scan = []
    if target_server == "all":
        servers_to_scan = [s for s in ["plex", "jellyfin", "emby"] if s in creds_map]
    elif target_server.lower() in creds_map:
        servers_to_scan = [target_server.lower()]

    async with httpx.AsyncClient(timeout=15.0, verify=False) as http_client:
        for s_type in servers_to_scan:
            creds = creds_map[s_type]
            s_url = creds["url"]
            excluded = [str(x).lower() for x in creds.get("excluded", [])]

            if s_type == "plex":
                token = creds.get("token")
                try:
                    sec_resp = await http_client.get(
                        f"{s_url}/library/sections",
                        headers={"X-Plex-Token": token, "Accept": "application/xml"}
                    )
                    if sec_resp.status_code == 200:
                        sec_root = fromstring(sec_resp.content)
                        for d in sec_root.findall(".//Directory"):
                            sec_title = d.get("title", "")
                            sec_type = d.get("type", "")
                            sec_key = d.get("key", "")
                            if sec_type not in ["movie", "show"]:
                                continue
                            if library != "all" and sec_title.lower() != library.lower():
                                continue
                            if library == "all" and sec_title.lower() in excluded:
                                continue
                            matched_k, matched_rules = resolve_library_rules(sec_title, sec_type, library_rules_map)
                            if matched_k == "none" or not matched_rules:
                                continue

                            items_resp = await http_client.get(
                                f"{s_url}/library/sections/{sec_key}/all",
                                headers={"X-Plex-Token": token, "Accept": "application/xml"}
                            )
                            if items_resp.status_code == 200:
                                i_root = fromstring(items_resp.content)
                                tag = ".//Directory" if sec_type == "show" else ".//Video"
                                for it in i_root.findall(tag):
                                    if total_scanned % 5 == 0:
                                        await asyncio.sleep(0)
                                    rk = it.get("ratingKey")
                                    t = it.get("title", "")
                                    part = it.find(".//Part")
                                    part_file = part.get("file") if part is not None else None
                                    rf = Path(part_file).parent.name if part_file else t
                                    dur = int(it.get("duration") or 0)
                                    rt_mins = dur // 60000 if dur > 0 else None
                                    ed_val = it.get("editionTitle") or it.get("edition") or extract_edition(part_file, rf, t)
                                    s_up_at = it.get("updatedAt") or it.get("addedAt")
                                    status_val = it.get("status")

                                    clean_asset = find_clean_asset(
                                        assets_dir=real_asset_path,
                                        library_name=sec_title,
                                        root_folder=rf,
                                        title=t,
                                        asset_type="poster",
                                        year=it.get("year"),
                                        dir_cache=dir_cache
                                    )
                                    if not clean_asset:
                                        continue

                                    total_scanned += 1
                                    cached = cache.get_entry(s_type, str(rk), "poster")
                                    item_changes = []
                                    detail_notes = []

                                    if not cached or cached.get("status") not in ("synced", "skipped"):
                                        summary["new"] += 1
                                        changed_items.append({
                                            "id": str(rk),
                                            "title": t,
                                            "library": sec_title,
                                            "server_type": s_type,
                                            "media_type": sec_type,
                                            "change_types": ["new"],
                                            "details": "New item (overlay not yet cached)",
                                            "cached": None,
                                            "current": {
                                                "edition": ed_val,
                                                "runtime_mins": rt_mins,
                                                "server_updated_at": s_up_at,
                                                "status": status_val
                                            }
                                        })
                                        continue

                                    # Check base artwork modification on disk
                                    try:
                                        disk_mtime = clean_asset.stat().st_mtime
                                        cached_mtime = float(cached.get("clean_asset_mtime") or 0.0)
                                        if abs(disk_mtime - cached_mtime) > 1.0:
                                            item_changes.append("asset_modified")
                                            detail_notes.append("Clean base artwork modified on disk")
                                            summary["asset_modified"] += 1
                                    except Exception:
                                        pass

                                    # Check server updated timestamp
                                    cached_up = cached.get("server_updated_at")
                                    if s_up_at and cached_up and str(s_up_at) != str(cached_up):
                                        # Query metadata XML to detect exact changes (languages, cut, runtime)
                                        try:
                                            m_resp = await http_client.get(
                                                f"{s_url}/library/metadata/{rk}",
                                                headers={"X-Plex-Token": token, "Accept": "application/xml"}
                                            )
                                            if m_resp.status_code == 200:
                                                m_root = fromstring(m_resp.content)
                                                cur_langs = []
                                                for s in m_root.findall(".//Stream"):
                                                    if s.get("streamType") == "2":
                                                        lc = s.get("languageCode") or s.get("language")
                                                        if lc:
                                                            nl = LANGUAGE_MAP.get(lc.lower(), lc.lower())
                                                            if nl not in cur_langs:
                                                                cur_langs.append(nl)
                                                for v_node in m_root.findall(".//Video"):
                                                    if v_node.get("editionTitle"):
                                                        ed_val = v_node.get("editionTitle")
                                                    dur_node = int(v_node.get("duration") or 0)
                                                    if dur_node > 0:
                                                        rt_mins = dur_node // 60000
                                                    if not status_val and v_node.get("status"):
                                                        status_val = v_node.get("status")

                                                cached_langs = sorted([l.strip().lower() for l in (cached.get("detected_languages") or "").split(",") if l.strip()])
                                                cur_langs = sorted(cur_langs)
                                                if cur_langs != cached_langs:
                                                    item_changes.append("languages")
                                                    detail_notes.append(f"Audio languages: {cached_langs or '[]'} -> {cur_langs or '[]'}")
                                                    summary["languages"] += 1

                                                cached_rt = cached.get("runtime_mins")
                                                if rt_mins and cached_rt and abs(rt_mins - cached_rt) > 1:
                                                    item_changes.append("runtime")
                                                    detail_notes.append(f"Runtime: {cached_rt}m -> {rt_mins}m")
                                                    summary["runtimes"] += 1

                                                cached_ed = cached.get("edition")
                                                if ed_val and str(ed_val).strip().lower() != str(cached_ed or "").strip().lower():
                                                    item_changes.append("edition")
                                                    detail_notes.append(f"Edition: '{cached_ed or 'Standard'}' -> '{ed_val}'")
                                                    summary["editions"] += 1

                                                cached_st = cached.get("show_status")
                                                if status_val and cached_st and status_val.strip().lower() != cached_st.strip().lower():
                                                    item_changes.append("status")
                                                    detail_notes.append(f"Status: '{cached_st}' -> '{status_val}'")
                                                    summary["status"] += 1
                                        except Exception as m_e:
                                            logger.debug(f"[DetectChanges] Plex item {rk} detail query error: {m_e}")

                                    # Check TV show status cached in ratings_cache
                                    if sec_type == "show" and "status" not in item_changes:
                                        try:
                                            st_cached = ratings_cache.get_show_status(s_type, str(rk))
                                            if st_cached and st_cached.get("status"):
                                                cur_status = st_cached["status"].strip().lower()
                                                cached_st = str(cached.get("show_status") or "").strip().lower()
                                                if cached_st and cur_status and cur_status != cached_st:
                                                    item_changes.append("status")
                                                    detail_notes.append(f"Show status changed: '{cached_st}' -> '{cur_status}'")
                                                    summary["status"] += 1
                                        except Exception:
                                            pass

                                    if item_changes:
                                        changed_items.append({
                                            "id": str(rk),
                                            "title": t,
                                            "library": sec_title,
                                            "server_type": s_type,
                                            "media_type": sec_type,
                                            "change_types": item_changes,
                                            "details": "; ".join(detail_notes) if detail_notes else "Media attributes updated",
                                            "cached": {
                                                "edition": cached.get("edition"),
                                                "runtime_mins": cached.get("runtime_mins"),
                                                "detected_languages": cached.get("detected_languages"),
                                                "show_status": cached.get("show_status"),
                                                "server_updated_at": cached.get("server_updated_at")
                                            },
                                            "current": {
                                                "edition": ed_val,
                                                "runtime_mins": rt_mins,
                                                "status": status_val,
                                                "server_updated_at": s_up_at
                                            }
                                        })
                except Exception as pe:
                    logger.warning(f"[DetectChanges] Plex detection error: {pe}")

            elif s_type in ["jellyfin", "emby"]:
                api_key = creds.get("api_key")
                headers = {
                    "X-Emby-Token": api_key,
                    "Authorization": f'MediaBrowser Token="{api_key}"',
                    "Accept": "application/json"
                }
                try:
                    vf_resp = await http_client.get(f"{s_url}/Library/VirtualFolders", headers=headers)
                    if vf_resp.status_code == 200:
                        vfolders = vf_resp.json()
                        for lib_obj in vfolders:
                            lib_name = lib_obj.get("Name", "")
                            lib_id = lib_obj.get("ItemId") or lib_obj.get("Id", "")
                            if library != "all" and lib_name.lower() != library.lower():
                                continue
                            if library == "all" and any(lib_name.lower() == str(ex).lower() for ex in excluded):
                                continue
                            matched_k, matched_rules = resolve_library_rules(lib_name, "movie", library_rules_map)
                            if matched_k == "none" or not matched_rules:
                                continue

                            items_url = f"{s_url}/Items?ParentId={lib_id}&Recursive=true&IncludeItemTypes=Movie,Series&Fields=MediaStreams,MediaSources,Width,Height,OfficialRating,CustomRating,RunTimeTicks,Status,ProviderIds,ProductionYear,Studios,CommunityRating,CriticRating,DateModified,DateCreated,Path,Overview"
                            it_resp = await http_client.get(items_url, headers=headers)
                            if it_resp.status_code == 200:
                                lib_items = it_resp.json().get("Items", [])
                                for item_obj in lib_items:
                                    it_id = item_obj.get("Id")
                                    it_name = item_obj.get("Name", "")
                                    it_type = "movie" if item_obj.get("Type") == "Movie" else "show"
                                    it_path = item_obj.get("Path", "")
                                    it_p = Path(it_path) if it_path else None
                                    if it_p:
                                        rf = it_p.name if (it_type == "show" or not it_p.suffix) else it_p.parent.name
                                    else:
                                        rf = it_name
                                    streams = item_obj.get("MediaStreams", [])
                                    if not streams and item_obj.get("MediaSources"):
                                        for ms in item_obj.get("MediaSources", []):
                                            streams.extend(ms.get("MediaStreams", []))

                                    cur_langs = []
                                    vid_w = item_obj.get("Width") or 0
                                    vid_h = item_obj.get("Height") or 0
                                    for s in streams:
                                        stype = s.get("Type")
                                        if stype == "Audio":
                                            lc = s.get("Language") or s.get("DisplayLanguage")
                                            if lc:
                                                norm_l = LANGUAGE_MAP.get(lc.lower(), lc.lower())
                                                if norm_l not in cur_langs:
                                                    cur_langs.append(norm_l)
                                        elif stype == "Video":
                                            sw = s.get("Width") or 0
                                            sh = s.get("Height") or 0
                                            if sw > vid_w:
                                                vid_w = sw
                                            if sh > vid_h:
                                                vid_h = sh

                                    cur_langs = sorted(cur_langs)
                                    res_val = "1080p"
                                    if any(k in (lib_name or "").lower() for k in ["4k", "uhd", "2160"]):
                                        res_val = "4K"
                                    elif vid_w >= 3800 or vid_h >= 2000:
                                        res_val = "4K"
                                    elif any(k in (it_path or "").lower() or k in (rf or "").lower() for k in ["4k", "uhd", "2160"]):
                                        res_val = "4K"
                                    elif vid_w >= 1900 or vid_h >= 1000:
                                        res_val = "1080p"
                                    elif vid_w >= 1200 or vid_h >= 700:
                                        res_val = "720p"
                                    elif vid_w > 0:
                                        res_val = f"{vid_h}p" if vid_h else f"{vid_w}p"
                                    else:
                                        res_val = "1080p"

                                    ed_val = item_obj.get("Edition") or item_obj.get("Version") or extract_edition(it_path, it_name)
                                    s_up_at = item_obj.get("DateModified") or item_obj.get("DateCreated")
                                    rt_mins = (item_obj.get("RunTimeTicks", 0) // 600000000) or None
                                    status_val = item_obj.get("Status")

                                    if total_scanned % 5 == 0:
                                        await asyncio.sleep(0)

                                    p_ids = item_obj.get("ProviderIds") or {}
                                    clean_asset = find_clean_asset(
                                        assets_dir=real_asset_path,
                                        library_name=lib_name,
                                        root_folder=rf,
                                        title=it_name,
                                        asset_type="poster",
                                        year=item_obj.get("ProductionYear"),
                                        imdb_id=p_ids.get("Imdb"),
                                        tmdb_id=p_ids.get("Tmdb"),
                                        tvdb_id=p_ids.get("Tvdb"),
                                        dir_cache=dir_cache
                                    )
                                    if not clean_asset:
                                        continue

                                    total_scanned += 1
                                    cached = cache.get_entry(s_type, str(it_id), "poster")
                                    item_changes = []
                                    detail_notes = []

                                    if not cached or cached.get("status") not in ("synced", "skipped"):
                                        summary["new"] += 1
                                        changed_items.append({
                                            "id": str(it_id),
                                            "title": it_name,
                                            "library": lib_name,
                                            "server_type": s_type,
                                            "media_type": it_type,
                                            "change_types": ["new"],
                                            "details": "New item (overlay not yet cached)",
                                            "cached": None,
                                            "current": {
                                                "edition": ed_val,
                                                "runtime_mins": rt_mins,
                                                "detected_languages": cur_langs,
                                                "status": status_val,
                                                "resolution": res_val,
                                                "server_updated_at": s_up_at
                                            }
                                        })
                                        continue

                                    try:
                                        disk_mtime = clean_asset.stat().st_mtime
                                        cached_mtime = float(cached.get("clean_asset_mtime") or 0.0)
                                        if abs(disk_mtime - cached_mtime) > 1.0:
                                            item_changes.append("asset_modified")
                                            detail_notes.append("Clean base artwork modified on disk")
                                            summary["asset_modified"] += 1
                                    except Exception:
                                        pass

                                    cached_langs = sorted([l.strip().lower() for l in (cached.get("detected_languages") or "").split(",") if l.strip()])
                                    if cur_langs != cached_langs:
                                        item_changes.append("languages")
                                        detail_notes.append(f"Audio languages: {cached_langs or '[]'} -> {cur_langs or '[]'}")
                                        summary["languages"] += 1

                                    cached_rt = cached.get("runtime_mins")
                                    if rt_mins and cached_rt and abs(rt_mins - cached_rt) > 1:
                                        item_changes.append("runtime")
                                        detail_notes.append(f"Runtime: {cached_rt}m -> {rt_mins}m")
                                        summary["runtimes"] += 1

                                    cached_ed = cached.get("edition")
                                    if ed_val and str(ed_val).strip().lower() != str(cached_ed or "").strip().lower():
                                        item_changes.append("edition")
                                        detail_notes.append(f"Edition: '{cached_ed or 'Standard'}' -> '{ed_val}'")
                                        summary["editions"] += 1

                                    cached_st = cached.get("show_status")
                                    if status_val and cached_st and str(status_val).strip().lower() != str(cached_st).strip().lower():
                                        item_changes.append("status")
                                        detail_notes.append(f"Status: '{cached_st}' -> '{status_val}'")
                                        summary["status"] += 1

                                    if item_changes:
                                        changed_items.append({
                                            "id": str(it_id),
                                            "title": it_name,
                                            "library": lib_name,
                                            "server_type": s_type,
                                            "media_type": it_type,
                                            "change_types": item_changes,
                                            "details": "; ".join(detail_notes) if detail_notes else "Media attributes updated",
                                            "cached": {
                                                "edition": cached.get("edition"),
                                                "runtime_mins": cached.get("runtime_mins"),
                                                "detected_languages": cached.get("detected_languages"),
                                                "show_status": cached.get("show_status"),
                                                "server_updated_at": cached.get("server_updated_at")
                                            },
                                            "current": {
                                                "edition": ed_val,
                                                "runtime_mins": rt_mins,
                                                "detected_languages": cur_langs,
                                                "status": status_val,
                                                "server_updated_at": s_up_at
                                            }
                                        })
                except Exception as je:
                    logger.warning(f"[DetectChanges] {s_type} detection error: {je}")

    result_report = {
        "success": True,
        "timestamp": datetime.now().isoformat(),
        "target_server": target_server,
        "library": library,
        "total_scanned": total_scanned,
        "changed_count": len(changed_items),
        "unchanged_count": max(0, total_scanned - len(changed_items)),
        "changes": changed_items,
        "summary": summary
    }

    try:
        db_dir = base_dir / "database"
        db_dir.mkdir(parents=True, exist_ok=True)
        report_file = db_dir / "last_change_detection_report.json"
        with open(report_file, "w", encoding="utf-8") as f:
            json.dump(result_report, f, indent=2)
    except Exception as save_err:
        logger.warning(f"[DetectChanges] Could not persist last change detection report: {save_err}")

    return result_report


def get_last_detection_report(base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Retrieve the most recent saved change detection report from disk."""
    if not base_dir:
        base_dir = Path(".")
    report_file = base_dir / "database" / "last_change_detection_report.json"
    if report_file.exists():
        try:
            with open(report_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"[DetectChanges] Error reading last report from {report_file}: {e}")
    return {
        "success": True,
        "timestamp": None,
        "target_server": "all",
        "library": "all",
        "total_scanned": 0,
        "changed_count": 0,
        "unchanged_count": 0,
        "changes": [],
        "summary": {
            "languages": 0,
            "editions": 0,
            "runtimes": 0,
            "status": 0,
            "new": 0,
            "asset_modified": 0
        }
    }


# ==============================================================================
# BACKGROUND CHANGE DETECTOR DAEMON
# ==============================================================================

_change_detector_running = False
_change_detector_thread = None

def _background_change_detector_loop(
    base_dir: Optional[Path] = None,
    config_path: Optional[Path] = None,
    logs_dir: Optional[Path] = None
):
    """Background daemon loop that periodically autodetects media language, cut, runtime, and status changes."""
    logger.info("[OverlayChangeDetector] Background media change monitor loop started.")
    if not base_dir:
        base_dir = Path(".")
    if not config_path:
        config_path = base_dir / "config.json"
    if not logs_dir:
        logs_dir = base_dir / "UILogs"

    from dynamic_overlays_service import save_dynamic_overlays_settings

    while _change_detector_running:
        try:
            settings = get_dynamic_overlays_settings()
            if not settings.get("enabled", False) or not settings.get("change_detection_enabled", True):
                for _ in range(30):
                    if not _change_detector_running:
                        break
                    time.sleep(1)
                continue

            # Verify that libraries are actually configured in config.yml
            overlays_dir = base_dir / "Overlayfiles" / "dynamic_overlays"
            if not overlays_dir.exists():
                legacy = base_dir / "Overlayfiles" / "kometa"
                if legacy.exists():
                    overlays_dir = legacy
            config_yml = overlays_dir / "configs" / "config.yml"
            has_configured_libs = False
            if config_yml.exists():
                try:
                    import yaml
                    with open(config_yml, "r", encoding="utf-8") as yf:
                        raw_cfg = yaml.safe_load(yf) or {}
                        raw_libs = raw_cfg.get("libraries", {})
                        if isinstance(raw_libs, dict):
                            for _, l_data in raw_libs.items():
                                if isinstance(l_data, dict) and (l_data.get("overlay_files") or l_data.get("overlays")):
                                    has_configured_libs = True
                                    break
                except Exception:
                    pass

            if not has_configured_libs:
                for _ in range(30):
                    if not _change_detector_running:
                        break
                    time.sleep(1)
                continue

            interval_mins = max(5, int(settings.get("change_detection_interval_minutes", 60)))
            last_run_str = settings.get("last_change_detection_at")
            should_run = False

            if not last_run_str:
                # First run after enabling: record timestamp so we do not trigger an immediate sync
                save_dynamic_overlays_settings({
                    "last_change_detection_at": datetime.now().isoformat()
                })
                should_run = False
            else:
                try:
                    last_run_dt = datetime.fromisoformat(last_run_str)
                    elapsed_secs = (datetime.now() - last_run_dt).total_seconds()
                    if elapsed_secs >= (interval_mins * 60):
                        should_run = True
                except Exception:
                    should_run = True

            if should_run:
                if is_overlay_sync_running():
                    logger.debug("[OverlayChangeDetector] Sync task already active; skipping iteration.")
                    for _ in range(30):
                        if not _change_detector_running:
                            break
                        time.sleep(1)
                    continue

                logger.info("[OverlayChangeDetector] Running scheduled bulk change detection...")
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                report = {}
                try:
                    report = loop.run_until_complete(
                        detect_media_changes(
                            target_server="all",
                            library="all",
                            base_dir=base_dir,
                            config_path=config_path
                        )
                    )
                finally:
                    loop.close()

                save_dynamic_overlays_settings({
                    "last_change_detection_at": datetime.now().isoformat(),
                    "last_change_detection_summary": report.get("summary")
                })

                changed_count = report.get("changed_count", 0)
                if changed_count > 0 and settings.get("auto_resync_on_change", True):
                    logger.info(f"[OverlayChangeDetector] Detected {changed_count} updated media item(s). Auto-triggering resync...")
                    resync_loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(resync_loop)
                    try:
                        resync_loop.run_until_complete(
                            run_overlay_sync_task(
                                target_server="all",
                                scope="changed",
                                library="all",
                                base_dir=base_dir,
                                config_path=config_path,
                                log_file_path=logs_dir / "DynamicOverlaysSync.log"
                            )
                        )
                        logger.info(f"[OverlayChangeDetector] Auto-resync completed for {changed_count} item(s).")
                    finally:
                        resync_loop.close()
                else:
                    logger.debug(f"[OverlayChangeDetector] Scan complete. {changed_count} changed item(s) found.")

        except Exception as e:
            logger.error(f"[OverlayChangeDetector] Error in background monitor loop: {e}", exc_info=True)

        for _ in range(30):
            if not _change_detector_running:
                break
            time.sleep(1)

    logger.info("[OverlayChangeDetector] Background media change monitor loop stopped.")


def start_overlay_change_detector_background(
    base_dir: Optional[Path] = None,
    config_path: Optional[Path] = None,
    logs_dir: Optional[Path] = None
):
    """Start background change detection daemon thread."""
    global _change_detector_running, _change_detector_thread
    if _change_detector_thread is not None and _change_detector_thread.is_alive():
        return
    _change_detector_running = True
    _change_detector_thread = threading.Thread(
        target=_background_change_detector_loop,
        args=(base_dir, config_path, logs_dir),
        daemon=True,
        name="DynamicOverlaysChangeDetector"
    )
    _change_detector_thread.start()
    logger.info("Dynamic overlays background change detector daemon started.")


def stop_overlay_change_detector_background():
    """Stop background change detection daemon thread."""
    global _change_detector_running
    _change_detector_running = False


# ==============================================================================
# BACKWARD COMPATIBILITY ALIASES
# ==============================================================================
run_kometa_overlay_sync_task = run_overlay_sync_task
is_kometa_sync_running = is_overlay_sync_running


