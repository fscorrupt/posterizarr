"""Client, cache, and strict sanitization for the Posterizarr Community Gallery."""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import stat
import threading
import time
import uuid
import zipfile
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

BLUEPRINT_BUNDLE_KIND = "posterizarr-blueprint-bundle"
BLUEPRINT_BUNDLE_VERSION = 1
MAX_BLUEPRINT_BUNDLE_BYTES = 25 * 1024 * 1024
MAX_BLUEPRINT_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
MAX_BLUEPRINT_ASSET_BYTES = 10 * 1024 * 1024
MAX_BLUEPRINT_BUNDLE_FILES = 64
BLUEPRINT_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
BLUEPRINT_FONT_EXTS = {".ttf", ".otf", ".woff", ".woff2"}
BLUEPRINT_ASSET_EXTS = BLUEPRINT_IMAGE_EXTS | BLUEPRINT_FONT_EXTS
FONT_FILENAME_KEYS = ("font", "collectionfont", "RTLFont", "backgroundfont", "titlecardfont")
_WINDOWS_RESERVED_STEMS = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"{prefix}{n}" for prefix in ("COM", "LPT") for n in range(1, 10)),
}

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

_BLUEPRINT_BUNDLE_CACHE_LOCK = threading.Lock()
_BLUEPRINT_BUNDLE_CACHE: OrderedDict[str, dict] = OrderedDict()


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


def _is_valid_asset_filename(name: object) -> bool:
    if not isinstance(name, str) or not _is_safe_filename_value(name):
        return False
    text = name.strip()
    if not text or text != name or text in {".", ".."}:
        return False
    if text.endswith((".", " ")):
        return False
    stem = text.split(".", 1)[0].upper()
    if stem in _WINDOWS_RESERVED_STEMS:
        return False
    return Path(text).suffix.lower() in BLUEPRINT_ASSET_EXTS


def _validate_asset_magic_bytes(filename: str, data: bytes) -> bool:
    if not data:
        return False
    ext = Path(filename).suffix.lower()
    if ext == ".png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in {".jpg", ".jpeg"}:
        return data.startswith(b"\xff\xd8\xff")
    if ext == ".webp":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if ext == ".ttf":
        return len(data) >= 4 and data[:4] in (b"\x00\x01\x00\x00", b"true", b"typ1", b"ttcf")
    if ext == ".otf":
        return data.startswith(b"OTTO")
    if ext == ".woff":
        return data.startswith(b"wOFF")
    if ext == ".woff2":
        return data.startswith(b"wOF2")
    return False


def _asset_kind(filename: str) -> str:
    return "font" if Path(filename).suffix.lower() in BLUEPRINT_FONT_EXTS else "overlay"


def _section_flag_disabled(nested: dict, section_name: str, field_name: str) -> bool:
    section = nested.get(section_name)
    if not isinstance(section, dict) or field_name not in section:
        return False
    return str(section.get(field_name)).strip().lower() == "false"


def _prereq_flag_enabled(prereq: dict, field_name: str) -> bool:
    return str(prereq.get(field_name, "")).strip().lower() == "true"


def collect_active_blueprint_filenames(nested: dict) -> set[str]:
    prereq = nested.get("PrerequisitePart")
    if not isinstance(prereq, dict):
        return set()

    candidates: set[str] = set()
    layer_mappings = (
        (("overlayfile", "showoverlayfile"), "PosterOverlayPart", "AddOverlay"),
        (("seasonoverlayfile",), "SeasonPosterOverlayPart", "AddOverlay"),
        (("backgroundoverlayfile", "showbackgroundoverlayfile"), "BackgroundOverlayPart", "AddOverlay"),
        (("titlecardoverlayfile",), "TitleCardOverlayPart", "AddOverlay"),
        (("collectionoverlayfile",), "CollectionPosterOverlayPart", "AddOverlay"),
    )
    resolution_mappings = (
        ("UsePosterResolutionOverlays", ("poster4k", "Poster1080p", "4KDoVi", "4KHDR10", "4KDoViHDR10")),
        ("UseBackgroundResolutionOverlays", ("Background4k", "Background1080p", "4KDoViBackground", "4KHDR10Background", "4KDoViHDR10Background")),
        ("UseTCResolutionOverlays", ("TC4k", "TC1080p", "4KDoViTC", "4KHDR10TC", "4KDoViHDR10TC")),
    )

    for key in FONT_FILENAME_KEYS:
        val = prereq.get(key)
        if val not in (None, "") and _is_safe_filename_value(val):
            candidates.add(str(val).strip())

    for keys, section_name, flag_name in layer_mappings:
        if _section_flag_disabled(nested, section_name, flag_name):
            continue
        for key in keys:
            val = prereq.get(key)
            if val not in (None, "") and _is_safe_filename_value(val):
                candidates.add(str(val).strip())

    for flag_key, keys in resolution_mappings:
        if not _prereq_flag_enabled(prereq, flag_key):
            continue
        for key in keys:
            val = prereq.get(key)
            if val not in (None, "") and _is_safe_filename_value(val):
                candidates.add(str(val).strip())

    return {name for name in candidates if name}


def collect_all_blueprint_filenames(nested: dict) -> set[str]:
    prereq = nested.get("PrerequisitePart")
    if not isinstance(prereq, dict):
        return set()
    result: set[str] = set()
    for key in FILENAME_KEYS:
        val = prereq.get(key)
        if val not in (None, "") and _is_safe_filename_value(val):
            text = str(val).strip()
            if text:
                result.add(text)
    return result


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


def _find_local_asset(overlayfiles_dir: Path, filename: str) -> bytes | None:
    search_roots = [Path(overlayfiles_dir)]
    if _asset_kind(filename) == "font":
        search_roots.extend(
            [
                Path(overlayfiles_dir) / "fonts",
                Path(overlayfiles_dir) / "dynamic_overlays" / "fonts",
            ]
        )

    for root in search_roots:
        if not root.is_dir():
            continue
        resolved_root = root.resolve()
        candidate = root / filename
        if not candidate.exists():
            folded = filename.casefold()
            candidate = next(
                (entry for entry in root.iterdir() if entry.name.casefold() == folded),
                candidate,
            )
        if not candidate.exists():
            continue
        if candidate.is_symlink() or not candidate.is_file():
            raise CommunityGalleryError(f"Asset '{filename}' is not a regular file.", "invalidBlueprint")
        resolved_candidate = candidate.resolve()
        if resolved_candidate.parent != resolved_root or not resolved_candidate.is_relative_to(resolved_root):
            raise CommunityGalleryError(f"Asset '{filename}' resolves outside Overlayfiles.", "invalidBlueprint")
        size = resolved_candidate.stat().st_size
        if size == 0 or size > MAX_BLUEPRINT_ASSET_BYTES:
            raise CommunityGalleryError(
                f"Asset '{filename}' must be between 1 byte and 10 MiB to bundle.",
                "sizeLimit",
            )
        payload = resolved_candidate.read_bytes()
        if not _validate_asset_magic_bytes(filename, payload):
            raise CommunityGalleryError(f"Asset '{filename}' failed file format verification.", "invalidBlueprint")
        return payload

    return None


def _validate_zip_member_path(name: str) -> PurePosixPath:
    if not isinstance(name, str) or not name or "\\" in name or ":" in name or any(ord(ch) < 32 for ch in name):
        raise CommunityGalleryError("Blueprint bundle contains an invalid file path.", "invalidBlueprint")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or path.as_posix() != name:
        raise CommunityGalleryError("Blueprint bundle contains an unsafe file path.", "invalidBlueprint")
    return path


def unpack_blueprint_bundle(payload: bytes) -> dict:
    if not payload or len(payload) > MAX_BLUEPRINT_BUNDLE_BYTES:
        raise CommunityGalleryError("Blueprint bundle exceeds the 25 MiB limit.", "sizeLimit")

    blueprint_raw: bytes | None = None
    asset_bytes: dict[str, bytes] = {}
    seen_paths: set[str] = set()

    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            members = archive.infolist()
            if len(members) > MAX_BLUEPRINT_BUNDLE_FILES or sum(m.file_size for m in members) > MAX_BLUEPRINT_UNCOMPRESSED_BYTES:
                raise CommunityGalleryError("Blueprint bundle exceeds file count or uncompressed size limit.", "sizeLimit")
            for member in members:
                if member.is_dir():
                    continue
                path = _validate_zip_member_path(member.orig_filename)
                if stat.S_ISLNK(member.external_attr >> 16) or (member.flag_bits & 1):
                    raise CommunityGalleryError("Symlinks and encrypted files are not allowed in blueprint bundles.", "invalidBlueprint")
                folded = path.as_posix().casefold()
                if folded in seen_paths:
                    raise CommunityGalleryError("Blueprint bundle contains duplicate file paths.", "invalidBlueprint")
                seen_paths.add(folded)
                if member.file_size > 1024 * 1024 and member.file_size > max(1, member.compress_size) * 200:
                    raise CommunityGalleryError("Blueprint bundle contains excessive compression.", "invalidBlueprint")

                if path.as_posix() == "blueprint.json":
                    if member.file_size == 0 or member.file_size > MAX_BLUEPRINT_BYTES:
                        raise CommunityGalleryError("Bundled blueprint.json exceeds size limit.", "sizeLimit")
                    blueprint_raw = archive.read(member)
                elif len(path.parts) == 2 and path.parts[0] == "assets" and _is_valid_asset_filename(path.parts[1]):
                    asset_name = path.parts[1]
                    if member.file_size == 0 or member.file_size > MAX_BLUEPRINT_ASSET_BYTES:
                        raise CommunityGalleryError(f"Bundled asset '{asset_name}' exceeds 10 MiB limit.", "sizeLimit")
                    data = archive.read(member)
                    if len(data) == 0 or len(data) > MAX_BLUEPRINT_ASSET_BYTES or not _validate_asset_magic_bytes(asset_name, data):
                        raise CommunityGalleryError(f"Bundled asset '{asset_name}' is invalid or corrupted.", "invalidBlueprint")
                    asset_bytes[asset_name] = data
                else:
                    raise CommunityGalleryError(f"Blueprint bundle contains an unsupported entry '{path.as_posix()}'.", "invalidBlueprint")
    except CommunityGalleryError:
        raise
    except (zipfile.BadZipFile, RuntimeError, EOFError) as exc:
        raise CommunityGalleryError("Invalid blueprint ZIP archive.", "invalidBlueprint") from exc

    if blueprint_raw is None:
        raise CommunityGalleryError("Blueprint bundle is missing blueprint.json.", "invalidBlueprint")

    try:
        parsed = json.loads(blueprint_raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CommunityGalleryError("Bundled blueprint.json is not valid JSON.", "invalidBlueprint") from exc

    if not isinstance(parsed, dict):
        raise CommunityGalleryError("Bundled blueprint.json must be a JSON object.", "invalidBlueprint")
    if parsed.get("kind") != BLUEPRINT_BUNDLE_KIND or parsed.get("version") != BLUEPRINT_BUNDLE_VERSION:
        raise CommunityGalleryError("Unsupported blueprint bundle kind or version.", "invalidBlueprint")

    sanitized = sanitize_blueprint_updates(parsed)

    manifest_assets = parsed.get("assets")
    if not isinstance(manifest_assets, dict) or set(manifest_assets.keys()) != set(asset_bytes.keys()):
        raise CommunityGalleryError("Blueprint bundle asset manifest does not match archived files.", "invalidBlueprint")

    for asset_name, data in asset_bytes.items():
        meta = manifest_assets.get(asset_name)
        if not isinstance(meta, dict) or meta.get("sha256") != hashlib.sha256(data).hexdigest():
            raise CommunityGalleryError(f"Checksum mismatch for bundled asset '{asset_name}'.", "checksumMismatch")

    referenced_folded = {name.casefold() for name in collect_all_blueprint_filenames(sanitized["nested"])}
    for asset_name in asset_bytes:
        if asset_name.casefold() not in referenced_folded:
            raise CommunityGalleryError(
                f"Bundled asset '{asset_name}' is not referenced in blueprint settings.",
                "invalidBlueprint",
            )

    return {
        "blueprint_name": parsed.get("name") or "Custom Blueprint",
        "updates": {"nested": sanitized["nested"]},
        "flat_preview": sanitized["flat_preview"],
        "stripped_keys": sanitized["stripped_keys"],
        "assets": asset_bytes,
    }


def export_blueprint_package(
    raw_payload: object,
    overlayfiles_dir: Path,
    config_fonts: dict[str, str] | None = None,
) -> dict:
    sanitized = sanitize_blueprint_updates(raw_payload)
    nested = {section: dict(fields) for section, fields in sanitized["nested"].items()}
    blueprint_name = (
        str(raw_payload.get("name")).strip()
        if isinstance(raw_payload, dict) and isinstance(raw_payload.get("name"), str) and raw_payload.get("name").strip()
        else "Custom Blueprint Export"
    )

    if isinstance(config_fonts, dict) and config_fonts:
        prereq = nested.setdefault("PrerequisitePart", {})
        for key in FONT_FILENAME_KEYS:
            if prereq.get(key):
                continue
            font_val = config_fonts.get(key)
            if isinstance(font_val, str) and font_val.strip() and _is_valid_asset_filename(font_val.strip()):
                prereq[key] = font_val.strip()

    active_files = collect_active_blueprint_filenames(nested)
    bundled_assets: dict[str, bytes] = {}
    missing_assets: list[str] = []
    expanded_total = 0

    for fname in sorted(active_files):
        if not _is_valid_asset_filename(fname):
            continue
        asset_data = _find_local_asset(Path(overlayfiles_dir), fname)
        if asset_data is None:
            missing_assets.append(fname)
            continue
        expanded_total += len(asset_data)
        if expanded_total > MAX_BLUEPRINT_UNCOMPRESSED_BYTES:
            raise CommunityGalleryError("Bundled blueprint assets exceed size limits.", "sizeLimit")
        bundled_assets[fname] = asset_data

    if bundled_assets:
        blueprint_doc = {
            "kind": BLUEPRINT_BUNDLE_KIND,
            "version": BLUEPRINT_BUNDLE_VERSION,
            "name": blueprint_name,
            "updates": {"nested": nested},
            "assets": {
                name: {
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "size": len(data),
                    "kind": _asset_kind(name),
                }
                for name, data in sorted(bundled_assets.items())
            },
        }
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "blueprint.json",
                json.dumps(blueprint_doc, indent=2, ensure_ascii=False).encode("utf-8"),
            )
            for name, data in sorted(bundled_assets.items()):
                archive.writestr(f"assets/{name}", data)
        zip_bytes = stream.getvalue()
        unpack_blueprint_bundle(zip_bytes)
        return {
            "format": "bundle",
            "filename": "custom_blueprint.zip",
            "media_type": "application/zip",
            "payload": zip_bytes,
            "asset_names": sorted(bundled_assets),
            "missing_assets": missing_assets,
        }

    blueprint_doc = {
        "name": blueprint_name,
        "updates": {"nested": nested},
    }
    return {
        "format": "json",
        "filename": "custom_blueprint.json",
        "media_type": "application/json",
        "payload": json.dumps(blueprint_doc, indent=2, ensure_ascii=False).encode("utf-8"),
        "asset_names": [],
        "missing_assets": missing_assets,
    }


def _find_existing_dest(overlayfiles_dir: Path, filename: str) -> Path | None:
    if not overlayfiles_dir.is_dir():
        return None
    direct = overlayfiles_dir / filename
    if direct.exists() or direct.is_symlink():
        return direct
    folded = filename.casefold()
    for entry in overlayfiles_dir.iterdir():
        if entry.name.casefold() == folded:
            return entry
    return None


def inspect_blueprint_assets(assets: dict[str, bytes], overlayfiles_dir: Path | None) -> list[dict]:
    items: list[dict] = []
    target_dir = Path(overlayfiles_dir) if overlayfiles_dir is not None else None

    for name, data in sorted(assets.items()):
        digest = hashlib.sha256(data).hexdigest()
        status = "new"
        if target_dir is not None:
            existing = _find_existing_dest(target_dir, name)
            if existing is not None and not existing.is_symlink() and existing.is_file():
                existing_digest = hashlib.sha256(existing.read_bytes()).hexdigest()
                status = "existing_same" if existing_digest == digest else "conflict"
            elif existing is not None:
                status = "conflict"

        items.append(
            {
                "name": name,
                "size": len(data),
                "sha256": digest,
                "kind": _asset_kind(name),
                "status": status,
            }
        )
    return items


def install_blueprint_assets(
    assets: dict[str, bytes],
    overlayfiles_dir: Path,
    replace_existing: bool = False,
) -> dict:
    if not assets:
        return {"installed": [], "replaced": [], "skipped_same": [], "skipped_conflicts": []}

    target_dir = Path(overlayfiles_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    root = target_dir.resolve()

    installed: list[str] = []
    replaced: list[str] = []
    skipped_same: list[str] = []
    skipped_conflicts: list[str] = []

    for name, data in sorted(assets.items()):
        if not _is_valid_asset_filename(name):
            raise CommunityGalleryError("Invalid asset filename in blueprint bundle.", "invalidBlueprint")
        if len(data) == 0 or len(data) > MAX_BLUEPRINT_ASSET_BYTES or not _validate_asset_magic_bytes(name, data):
            raise CommunityGalleryError(f"Asset '{name}' is invalid or exceeds size limits.", "invalidBlueprint")

        dest = root / name
        resolved_dest = dest.resolve()
        if resolved_dest.parent != root or not resolved_dest.is_relative_to(root):
            raise CommunityGalleryError("Asset path escapes Overlayfiles directory.", "invalidBlueprint")
        if dest.is_symlink():
            raise CommunityGalleryError(f"Refusing to overwrite symlinked file '{name}'.", "invalidBlueprint")

        digest = hashlib.sha256(data).hexdigest()
        existing = _find_existing_dest(root, name)
        existed = False
        if existing is not None:
            if existing.is_symlink() or not existing.is_file():
                raise CommunityGalleryError(f"Refusing to overwrite non-regular file '{name}'.", "invalidBlueprint")
            existing_digest = hashlib.sha256(existing.read_bytes()).hexdigest()
            if existing_digest == digest:
                skipped_same.append(name)
                continue
            if not replace_existing:
                skipped_conflicts.append(name)
                continue
            dest = existing
            existed = True

        tmp_path = root / f".blueprint-tmp-{uuid.uuid4().hex}"
        try:
            tmp_path.write_bytes(data)
            os.replace(tmp_path, dest)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

        if existed:
            replaced.append(name)
        else:
            installed.append(name)

    return {
        "installed": installed,
        "replaced": replaced,
        "skipped_same": skipped_same,
        "skipped_conflicts": skipped_conflicts,
    }


def cache_blueprint_bundle(assets: dict[str, bytes], entry_id: str | None = None) -> str:
    token = uuid.uuid4().hex
    now = time.monotonic()
    with _BLUEPRINT_BUNDLE_CACHE_LOCK:
        stale = [k for k, v in _BLUEPRINT_BUNDLE_CACHE.items() if (now - v["ts"]) >= PREVIEW_CACHE_TTL_SECONDS]
        for k in stale:
            _BLUEPRINT_BUNDLE_CACHE.pop(k, None)
        _BLUEPRINT_BUNDLE_CACHE[token] = {
            "entry_id": entry_id,
            "assets": dict(assets),
            "ts": now,
        }
        while len(_BLUEPRINT_BUNDLE_CACHE) > PREVIEW_CACHE_MAX_ITEMS:
            _BLUEPRINT_BUNDLE_CACHE.popitem(last=False)
    return token


def resolve_cached_blueprint_assets(
    blueprint_token: str | None,
    community_entry_id: str | None = None,
) -> dict[str, bytes]:
    if blueprint_token:
        now = time.monotonic()
        with _BLUEPRINT_BUNDLE_CACHE_LOCK:
            cached = _BLUEPRINT_BUNDLE_CACHE.get(blueprint_token)
            if (
                cached
                and (now - cached["ts"]) < PREVIEW_CACHE_TTL_SECONDS
                and (not community_entry_id or cached["entry_id"] in (None, community_entry_id))
            ):
                _BLUEPRINT_BUNDLE_CACHE.move_to_end(blueprint_token)
                return dict(cached["assets"])

    if community_entry_id:
        fetched = fetch_community_blueprint(community_entry_id, None)
        refreshed_token = fetched.get("blueprint_token")
        if not fetched.get("is_bundle") or not refreshed_token:
            return {}
        with _BLUEPRINT_BUNDLE_CACHE_LOCK:
            cached = _BLUEPRINT_BUNDLE_CACHE.get(refreshed_token)
            if cached:
                return dict(cached["assets"])

    raise CommunityGalleryError(
        "Blueprint bundle session expired. Please re-select or re-upload the blueprint.",
        "entryNotFound",
    )


def inspect_uploaded_blueprint(
    filename: str,
    payload: bytes,
    overlayfiles_dir: Path | None = None,
) -> dict:
    if not payload or len(payload) > MAX_BLUEPRINT_BUNDLE_BYTES:
        raise CommunityGalleryError("Uploaded blueprint file is empty or exceeds the 25 MiB limit.", "sizeLimit")

    lower_name = (filename or "").lower()
    is_zip = lower_name.endswith(".zip") or (
        not lower_name.endswith(".json") and payload.startswith((b"PK\x03\x04", b"PK\x05\x06"))
    )

    if is_zip:
        unpacked = unpack_blueprint_bundle(payload)
        token = cache_blueprint_bundle(unpacked["assets"], entry_id=None)
        asset_list = inspect_blueprint_assets(unpacked["assets"], overlayfiles_dir)
        return {
            "blueprint_name": unpacked["blueprint_name"],
            "updates": unpacked["updates"],
            "flat_preview": unpacked["flat_preview"],
            "stripped_keys": unpacked["stripped_keys"],
            "is_bundle": True,
            "blueprint_token": token,
            "assets": asset_list,
            "has_conflicts": any(a["status"] == "conflict" for a in asset_list),
        }

    if len(payload) > MAX_BLUEPRINT_BYTES:
        raise CommunityGalleryError("Uploaded blueprint JSON exceeds the 512 KiB limit.", "sizeLimit")
    try:
        parsed = json.loads(payload.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CommunityGalleryError("Uploaded blueprint is not valid JSON.", "invalidBlueprint") from exc

    sanitized = sanitize_blueprint_updates(parsed)
    fallback_name = Path(filename).stem if filename else "Imported Blueprint"
    return {
        "blueprint_name": parsed.get("name") or fallback_name,
        "updates": {"nested": sanitized["nested"]},
        "flat_preview": sanitized["flat_preview"],
        "stripped_keys": sanitized["stripped_keys"],
        "is_bundle": False,
        "blueprint_token": None,
        "assets": [],
        "has_conflicts": False,
    }


def fetch_community_blueprint(entry_id: str, overlayfiles_dir: Path | None = None) -> dict:
    entry = _lookup_entry(entry_id, "blueprint")
    is_zip = entry["file"].lower().endswith(".zip")
    max_bytes = MAX_BLUEPRINT_BUNDLE_BYTES if is_zip else MAX_BLUEPRINT_BYTES
    raw_bytes = _read_repo_bytes(entry["file"], entry["path"] + "/", max_bytes)

    expected_sha = entry.get("sha256")
    if isinstance(expected_sha, str) and expected_sha:
        if hashlib.sha256(raw_bytes).hexdigest() != expected_sha:
            raise CommunityGalleryError("Blueprint checksum verification failed.", "checksumMismatch")

    if is_zip:
        unpacked = unpack_blueprint_bundle(raw_bytes)
        token = cache_blueprint_bundle(unpacked["assets"], entry_id=entry_id)
        asset_list = inspect_blueprint_assets(unpacked["assets"], overlayfiles_dir)
        return {
            "entry": entry,
            "blueprint_name": unpacked["blueprint_name"] or entry["name"],
            "updates": unpacked["updates"],
            "flat_preview": unpacked["flat_preview"],
            "stripped_keys": unpacked["stripped_keys"],
            "is_bundle": True,
            "blueprint_token": token,
            "assets": asset_list,
            "has_conflicts": any(a["status"] == "conflict" for a in asset_list),
        }

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
        "is_bundle": False,
        "blueprint_token": None,
        "assets": [],
        "has_conflicts": False,
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
