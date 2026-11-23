"""Client, cache, and strict sanitization for the Posterizarr Community Gallery."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import uuid
from collections import OrderedDict
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import httpx

COMMUNITY_REPO = "fscorrupt/posterizarr-community"
COMMUNITY_BRANCH = "main"
COMMUNITY_RAW_BASE = f"https://raw.githubusercontent.com/{COMMUNITY_REPO}/{COMMUNITY_BRANCH}/"
COMMUNITY_REPO_URL = f"https://github.com/{COMMUNITY_REPO}"

CATALOG_TTL_SECONDS = 900
PREVIEW_CACHE_TTL_SECONDS = 900
PREVIEW_CACHE_MAX_ITEMS = 8

MAX_CATALOG_BYTES = 2 * 1024 * 1024
MAX_BLUEPRINT_BYTES = 512 * 1024
MAX_BUNDLE_BYTES = 50 * 1024 * 1024

FORBIDDEN_BLUEPRINT_SECTIONS = {
    "WebUI",
    "ApiPart",
    "PlexPart",
    "JellyfinPart",
    "EmbyPart",
    "SiloPart",
    "Notification",
    "SchedulingPart",
}

ALLOWED_BLUEPRINT_SECTIONS = {
    "OverlayPart",
    "PrerequisitePart",
    "PosterOverlayPart",
    "SeasonPosterOverlayPart",
    "ShowTitleOnSeasonPosterPart",
    "BackgroundOverlayPart",
    "TitleCardOverlayPart",
    "TitleCardTitleTextPart",
    "TitleCardEPTextPart",
    "CollectionPosterOverlayPart",
    "CollectionTitlePosterPart",
    "LogoPart",
}

ALLOWED_OVERLAY_PART_KEYS = {"ImageProcessing", "outputQuality"}

ALLOWED_PREREQUISITE_VISUAL_KEYS = {
    "SkipAddText",
    "SkipAddTextAndOverlay",
    "SkipAddTextAndBorder",
    "SkipLocalPosterTextAdd",
    "SkipLocalBackgroundTextAdd",
    "SkipLocalSeasonTextAdd",
    "SkipLocalTCTextAdd",
    "font",
    "collectionfont",
    "RTLFont",
    "backgroundfont",
    "titlecardfont",
    "overlayfile",
    "showoverlayfile",
    "seasonoverlayfile",
    "collectionoverlayfile",
    "backgroundoverlayfile",
    "showbackgroundoverlayfile",
    "titlecardoverlayfile",
    "poster4k",
    "Poster1080p",
    "Background4k",
    "Background1080p",
    "TC4k",
    "TC1080p",
    "4KDoVi",
    "4KHDR10",
    "4KDoViHDR10",
    "4KDoViBackground",
    "4KHDR10Background",
    "4KDoViHDR10Background",
    "4KDoViTC",
    "4KHDR10TC",
    "4KDoViHDR10TC",
    "UsePosterResolutionOverlays",
    "UseBackgroundResolutionOverlays",
    "UseTCResolutionOverlays",
    "Posters",
    "SeasonPosters",
    "BackgroundPosters",
    "TitleCards",
    "NewLineOnSpecificSymbols",
    "NewLineSymbols",
    "NewLineOnSpecificWords",
    "NewLineWords",
    "SymbolsToKeepOnNewLine",
    "AutoCreateSeasonTemplate",
    "AutoUpdateExistingSeasonPosters",
    "UseLogo",
    "UseBGLogo",
    "UseClearlogo",
    "UseClearart",
    "LogoTextFallback",
    "LogoExifCheck",
    "TextlessPosterBypass",
    "ConvertLogoColor",
    "LogoFlatColor",
    "PreserveMultiColorLogos",
    "UseOriginalTitle",
}

DANGEROUS_PREREQUISITE_KEYS = {
    "AssetPath",
    "ManualAssetPath",
    "BackupPath",
    "magickinstalllocation",
    "AutoUpdatePosterizarr",
    "AutoUpdateIM",
    "ForceRunningDeletion",
    "FollowSymlink",
    "telemetry",
    "ParallelJobs",
    "maxLogs",
    "logLevel",
    "PlexUpload",
    "AssetCleanup",
    "FileTestOnTrigger",
    "LibraryFolders",
}

FILENAME_KEYS = {
    "font",
    "collectionfont",
    "RTLFont",
    "backgroundfont",
    "titlecardfont",
    "overlayfile",
    "showoverlayfile",
    "seasonoverlayfile",
    "collectionoverlayfile",
    "backgroundoverlayfile",
    "showbackgroundoverlayfile",
    "titlecardoverlayfile",
    "poster4k",
    "Poster1080p",
    "Background4k",
    "Background1080p",
    "TC4k",
    "TC1080p",
    "4KDoVi",
    "4KHDR10",
    "4KDoViHDR10",
    "4KDoViBackground",
    "4KHDR10Background",
    "4KDoViHDR10Background",
    "4KDoViTC",
    "4KHDR10TC",
    "4KDoViHDR10TC",
}

_CATALOG_LOCK = threading.Lock()
_CATALOG_CACHE: tuple[float, dict] | None = None

_BUNDLE_CACHE_LOCK = threading.Lock()
_BUNDLE_CACHE: OrderedDict[str, dict] = OrderedDict()


class CommunityGalleryError(ValueError):
    def __init__(self, message: str, code: str = "catalogUnavailable"):
        super().__init__(message)
        self.code = code


def validate_repo_relative_path(path_str: str, allowed_prefix: str = "") -> str:
    if not isinstance(path_str, str) or not path_str:
        raise CommunityGalleryError("Invalid repository path.", "invalidEntry")
    if "\\" in path_str or "://" in path_str or "?" in path_str or "#" in path_str or ":" in path_str:
        raise CommunityGalleryError("Unsafe characters in repository path.", "invalidEntry")
    if any(ord(ch) < 32 for ch in path_str):
        raise CommunityGalleryError("Control characters in repository path.", "invalidEntry")
    posix = PurePosixPath(path_str)
    if posix.is_absolute() or ".." in posix.parts or posix.as_posix() != path_str:
        raise CommunityGalleryError("Non-canonical repository path.", "invalidEntry")
    if allowed_prefix and not path_str.startswith(allowed_prefix):
        raise CommunityGalleryError("Repository path escapes expected directory.", "invalidEntry")
    return path_str


def build_raw_url(rel_path: str, allowed_prefix: str = "") -> str:
    clean = validate_repo_relative_path(rel_path, allowed_prefix)
    return COMMUNITY_RAW_BASE + quote(clean, safe="/-_.~")


def _is_safe_filename_value(value: object) -> bool:
    if value is None or value == "":
        return True
    text = str(value)
    return not ("/" in text or "\\" in text or ".." in text or ":" in text or any(ord(ch) < 32 for ch in text))


def _read_repo_bytes(rel_path: str, allowed_prefix: str, max_bytes: int) -> bytes:
    clean = validate_repo_relative_path(rel_path, allowed_prefix)
    local_dir = os.environ.get("POSTERIZARR_COMMUNITY_LOCAL_DIR", "").strip()
    if local_dir:
        root = Path(local_dir).resolve()
        target = (root / clean).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise CommunityGalleryError("Requested file was not found in the community catalog.", "entryNotFound")
        size = target.stat().st_size
        if size > max_bytes:
            raise CommunityGalleryError("Community file exceeds the maximum allowed size.", "sizeLimit")
        return target.read_bytes()

    url = build_raw_url(clean, allowed_prefix)
    try:
        with httpx.Client(timeout=25.0, follow_redirects=False) as client:
            with client.stream(
                "GET",
                url,
                headers={"User-Agent": "Posterizarr-Community-Gallery"},
            ) as response:
                if response.status_code == 404:
                    code = "catalogNotPublished" if clean == "index.json" else "entryNotFound"
                    raise CommunityGalleryError("The requested community catalog file was not found.", code)
                response.raise_for_status()
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise CommunityGalleryError("Community download exceeds size limit.", "sizeLimit")
                    chunks.append(chunk)
                return b"".join(chunks)
    except CommunityGalleryError:
        raise
    except httpx.HTTPError as exc:
        raise CommunityGalleryError(
            "Unable to reach the Posterizarr Community Gallery on GitHub.",
            "catalogUnavailable",
        ) from exc


def sanitize_blueprint_updates(raw_payload: object) -> dict:
    if not isinstance(raw_payload, dict):
        raise CommunityGalleryError("Blueprint payload must be a JSON object.", "invalidBlueprint")

    updates = raw_payload.get("updates")
    if isinstance(updates, dict) and isinstance(updates.get("nested"), dict):
        sections = updates["nested"]
    else:
        sections = {k: v for k, v in raw_payload.items() if k != "name" and isinstance(v, dict)}

    if not isinstance(sections, dict):
        raise CommunityGalleryError("Blueprint payload contains no valid configuration sections.", "invalidBlueprint")

    nested: dict[str, dict] = {}
    flat_preview: dict[str, object] = {}
    stripped_keys: list[str] = []

    for section_name, section_fields in sections.items():
        if section_name in FORBIDDEN_BLUEPRINT_SECTIONS or section_name not in ALLOWED_BLUEPRINT_SECTIONS or not isinstance(section_fields, dict):
            stripped_keys.append(str(section_name))
            continue

        clean_section: dict[str, object] = {}
        for key, value in section_fields.items():
            if section_name == "OverlayPart" and key not in ALLOWED_OVERLAY_PART_KEYS:
                stripped_keys.append(f"{section_name}.{key}")
                continue
            if section_name == "PrerequisitePart" and key not in ALLOWED_PREREQUISITE_VISUAL_KEYS:
                stripped_keys.append(f"{section_name}.{key}")
                continue
            if key in FILENAME_KEYS and not _is_safe_filename_value(value):
                stripped_keys.append(f"{section_name}.{key}")
                continue
            clean_section[key] = value
            flat_preview[f"{section_name}.{key}"] = value

        if clean_section:
            nested[section_name] = clean_section

    if not nested:
        raise CommunityGalleryError("Blueprint contains no valid visual configuration settings.", "invalidBlueprint")

    return {
        "nested": nested,
        "flat_preview": flat_preview,
        "stripped_keys": stripped_keys,
    }


def sanitize_manual_config_import(raw_payload: object) -> dict:
    """Sanitize a manual /api/config/import payload while preserving exported non-sensitive config."""
    if not isinstance(raw_payload, dict):
        raise CommunityGalleryError("Imported configuration must be a JSON object.", "invalidBlueprint")

    updates = raw_payload.get("updates")
    if isinstance(updates, dict) and isinstance(updates.get("nested"), dict):
        source = updates["nested"]
    else:
        source = {k: v for k, v in raw_payload.items() if k != "name"}

    if not isinstance(source, dict):
        raise CommunityGalleryError("Imported configuration sections must be objects.", "invalidBlueprint")

    cleaned: dict[str, object] = {}
    for section_name, section_value in source.items():
        if section_name in FORBIDDEN_BLUEPRINT_SECTIONS:
            continue
        if isinstance(section_value, dict):
            filtered_fields: dict[str, object] = {}
            for key, value in section_value.items():
                if section_name == "PrerequisitePart" and key in DANGEROUS_PREREQUISITE_KEYS:
                    continue
                if key in FILENAME_KEYS and not _is_safe_filename_value(value):
                    continue
                filtered_fields[key] = value
            if filtered_fields:
                cleaned[section_name] = filtered_fields
        else:
            cleaned[section_name] = section_value

    return cleaned


def _normalize_catalog_entry(raw_entry: object, expected_prefix: str, expected_kind: str) -> dict | None:
    if not isinstance(raw_entry, dict):
        return None
    entry_id = raw_entry.get("id")
    path = raw_entry.get("path")
    rel_file = raw_entry.get("file")
    name = raw_entry.get("name")
    if not all(isinstance(v, str) and v for v in (entry_id, path, rel_file, name)):
        return None

    try:
        clean_path = validate_repo_relative_path(path, expected_prefix)
        clean_file = validate_repo_relative_path(rel_file, clean_path + "/")
        raw_previews = raw_entry.get("previews") or []
        preview_urls = [
            build_raw_url(preview_path, clean_path + "/")
            for preview_path in raw_previews
            if isinstance(preview_path, str)
        ]
    except CommunityGalleryError:
        return None

    normalized = dict(raw_entry)
    normalized["kind"] = expected_kind
    normalized["path"] = clean_path
    normalized["file"] = clean_file
    normalized["preview_urls"] = preview_urls
    normalized["repo_url"] = f"{COMMUNITY_REPO_URL}/tree/{COMMUNITY_BRANCH}/{clean_path}"
    return normalized


def fetch_community_catalog(refresh: bool = False) -> dict:
    global _CATALOG_CACHE
    now = time.monotonic()
    with _CATALOG_LOCK:
        if not refresh and _CATALOG_CACHE and (now - _CATALOG_CACHE[0]) < CATALOG_TTL_SECONDS:
            return _CATALOG_CACHE[1]

    raw_bytes = _read_repo_bytes("index.json", "", MAX_CATALOG_BYTES)
    try:
        data = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CommunityGalleryError("Community catalog index.json is invalid.", "catalogUnavailable") from exc

    if not isinstance(data, dict):
        raise CommunityGalleryError("Community catalog format is invalid.", "catalogUnavailable")

    blueprints = [
        item
        for raw in (data.get("blueprints") or [])
        if (item := _normalize_catalog_entry(raw, "blueprints/", "blueprint")) is not None
    ]
    dynamic_overlays = [
        item
        for raw in (data.get("dynamic_overlays") or [])
        if (item := _normalize_catalog_entry(raw, "dynamic-overlays/", "dynamic-overlay")) is not None
    ]

    catalog = {
        "schema_version": int(data.get("schema_version") or 1),
        "repo": COMMUNITY_REPO,
        "repo_url": COMMUNITY_REPO_URL,
        "submit_url": f"{COMMUNITY_REPO_URL}/blob/{COMMUNITY_BRANCH}/CONTRIBUTING.md",
        "blueprints": blueprints,
        "dynamic_overlays": dynamic_overlays,
    }
    with _CATALOG_LOCK:
        _CATALOG_CACHE = (time.monotonic(), catalog)
    return catalog


def _lookup_entry(entry_id: str, kind: str) -> dict:
    catalog = fetch_community_catalog(refresh=False)
    items = catalog["blueprints"] if kind == "blueprint" else catalog["dynamic_overlays"]
    for item in items:
        if item.get("id") == entry_id:
            return item
    catalog = fetch_community_catalog(refresh=True)
    items = catalog["blueprints"] if kind == "blueprint" else catalog["dynamic_overlays"]
    for item in items:
        if item.get("id") == entry_id:
            return item
    raise CommunityGalleryError("The requested community preset was not found.", "entryNotFound")


def fetch_community_blueprint(entry_id: str) -> dict:
    entry = _lookup_entry(entry_id, "blueprint")
    raw_bytes = _read_repo_bytes(entry["file"], entry["path"] + "/", MAX_BLUEPRINT_BYTES)

    expected_sha = entry.get("sha256")
    if isinstance(expected_sha, str) and expected_sha:
        if hashlib.sha256(raw_bytes).hexdigest() != expected_sha:
            raise CommunityGalleryError("Blueprint checksum verification failed.", "checksumMismatch")

    try:
        parsed = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CommunityGalleryError("Community blueprint is not valid JSON.", "invalidBlueprint") from exc

    sanitized = sanitize_blueprint_updates(parsed)
    return {
        "entry": entry,
        "blueprint_name": parsed.get("name") or entry["name"],
        "updates": {"nested": sanitized["nested"]},
        "flat_preview": sanitized["flat_preview"],
        "stripped_keys": sanitized["stripped_keys"],
    }


def fetch_community_bundle(entry_id: str) -> tuple[dict, bytes, str]:
    entry = _lookup_entry(entry_id, "dynamic-overlay")
    payload = _read_repo_bytes(entry["file"], entry["path"] + "/", MAX_BUNDLE_BYTES)
    actual_sha = hashlib.sha256(payload).hexdigest()
    expected_sha = entry.get("bundle_sha256")
    if isinstance(expected_sha, str) and expected_sha and actual_sha != expected_sha:
        raise CommunityGalleryError("Overlay bundle checksum verification failed.", "checksumMismatch")

    token = uuid.uuid4().hex
    now = time.monotonic()
    with _BUNDLE_CACHE_LOCK:
        stale = [k for k, v in _BUNDLE_CACHE.items() if (now - v["ts"]) >= PREVIEW_CACHE_TTL_SECONDS]
        for k in stale:
            _BUNDLE_CACHE.pop(k, None)
        _BUNDLE_CACHE[token] = {
            "entry_id": entry_id,
            "entry": entry,
            "payload": payload,
            "sha256": actual_sha,
            "ts": now,
        }
        while len(_BUNDLE_CACHE) > PREVIEW_CACHE_MAX_ITEMS:
            _BUNDLE_CACHE.popitem(last=False)

    return entry, payload, token


def resolve_community_bundle_payload(entry_id: str, bundle_token: str | None) -> tuple[dict, bytes]:
    if bundle_token:
        now = time.monotonic()
        with _BUNDLE_CACHE_LOCK:
            cached = _BUNDLE_CACHE.get(bundle_token)
            if cached and cached["entry_id"] == entry_id and (now - cached["ts"]) < PREVIEW_CACHE_TTL_SECONDS:
                _BUNDLE_CACHE.move_to_end(bundle_token)
                return cached["entry"], cached["payload"]

    entry, payload, _ = fetch_community_bundle(entry_id)
    return entry, payload
