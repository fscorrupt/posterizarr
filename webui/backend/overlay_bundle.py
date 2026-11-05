import io
import fnmatch
import hashlib
import json
import os
import re
import stat
import threading
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qsl, quote, quote_plus, urlencode, urlsplit, urlunsplit

import yaml
import httpx

SCHEMA_VERSION = 1
MAX_BUNDLE_BYTES = 128 * 1024 * 1024
MAX_EXPANDED_BYTES = 256 * 1024 * 1024
MAX_FILES = 2048
ASSET_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".ttf", ".otf"}
SETTINGS_FIELDS = {
    "enabled", "auto_sync_on_startup", "sync_mode", "backdrop_overlays_enabled",
    "rating_sources", "rating_slots", "rating_alignment", "rating_position",
    "rating_contrast_box", "season_rating_libraries", "rating_cache_ttl_days",
    "ratings_auto_refresh_enabled", "ratings_auto_refresh_interval_hours",
    "debug_logging", "concurrency", "change_detection_enabled",
    "change_detection_interval_minutes", "auto_resync_on_change",
    "change_detection_dry_run", "fast_bulk_query_enabled",
}
PRIVATE_BLOCKS = {
    "plex", "jellyfin", "emby", "silo", "tmdb", "mdblist", "omdb", "tautulli",
    "radarr", "sonarr", "credentials", "connections", "servers", "authentication",
    "authorization", "webhooks", "notifications", "api", "apis", "keys",
}
ANIME_FIELDS = {
    "enabled", "target_libraries", "overlay_categories", "overlay_threshold_mode",
    "overlay_threshold_value", "labels", "colors", "aesthetic", "mal_enabled",
}
LIBRARY_FIELDS = {"overlay_files", "overlays", "template_variables", "remove_overlays", "reapply_overlays", "reset_overlays"}
IMPORT_LOCK = threading.Lock()
OFFICIAL_CATALOG_LOCK = threading.Lock()
OFFICIAL_CATALOG_CACHE = None
KOMETA_RAW = "https://raw.githubusercontent.com/Kometa-Team/Kometa/master/"


class BundleError(ValueError):
    def __init__(self, message, code="invalidBundle"):
        super().__init__(message)
        self.code = code


def official_local_path(source):
    try:
        path = bundle_path(source)
    except BundleError:
        return None
    prefix = "defaults/overlays/images/"
    if source.startswith(prefix) and path.suffix.lower() in ASSET_EXTENSIONS:
        return "assets/" + source[len(prefix):]
    if source.startswith("fonts/") and path.suffix.lower() in {".ttf", ".otf"}:
        return source
    prefix = "defaults/overlays/"
    if source.startswith(prefix) and path.suffix.lower() in {".yml", ".yaml"}:
        return "defaults/" + source[len(prefix):]
    return None


def load_official_catalog():
    global OFFICIAL_CATALOG_CACHE
    with OFFICIAL_CATALOG_LOCK:
        if OFFICIAL_CATALOG_CACHE and time.monotonic() - OFFICIAL_CATALOG_CACHE[0] < 900:
            return OFFICIAL_CATALOG_CACHE[1]
        try:
            response = httpx.get(
                "https://api.github.com/repos/Kometa-Team/Kometa/git/trees/master?recursive=1",
                headers={"Accept": "application/vnd.github+json", "User-Agent": "Posterizarr-overlay-bundle"},
                timeout=30, follow_redirects=False,
            )
            response.raise_for_status()
            data = response.json()
            if data.get("truncated") or not isinstance(data.get("tree"), list):
                raise ValueError("Incomplete official file catalog")
            catalog = {entry["path"]: entry["sha"] for entry in data["tree"]
                       if entry.get("type") == "blob" and official_local_path(entry["path"])}
            if not catalog:
                raise ValueError("Empty official file catalog")
        except (httpx.HTTPError, ValueError, KeyError) as error:
            raise BundleError("The official Kometa catalog could not be verified. Retry when GitHub is reachable.", "officialCatalogUnavailable") from error
        OFFICIAL_CATALOG_CACHE = (time.monotonic(), catalog)
        return catalog


def git_blob_hash(payload):
    return hashlib.sha1(b"blob " + str(len(payload)).encode("ascii") + b"\0" + payload).hexdigest()


def private_key(key):
    normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
    return normalized in PRIVATE_BLOCKS or any(
        part in normalized for part in ("apikey", "password", "secret", "token", "clientid", "webhook")
    ) or normalized in {"authorization", "username", "userid", "serverurl", "serverid"}


def sanitize(value, secrets=(), depth=0):
    if depth > 32:
        raise BundleError("Bundle configuration is nested too deeply.")
    if isinstance(value, dict):
        result = {}
        for key, child in value.items():
            if private_key(key):
                continue
            if key == "libraries" and isinstance(child, dict):
                result[key] = {name: sanitize(settings, secrets, depth + 1) for name, settings in child.items()}
            else:
                result[key] = sanitize(child, secrets, depth + 1)
        return result
    if isinstance(value, list):
        return [sanitize(child, secrets, depth + 1) for child in value]
    if isinstance(value, str):
        if value.startswith(("https://", "http://")):
            parsed = urlsplit(value)
            query = [(key, child) for key, child in parse_qsl(parsed.query, keep_blank_values=True)
                     if not private_key(key) and key.lower() not in {"key", "auth", "access_token"}]
            value = urlunsplit((parsed.scheme, parsed.netloc.rsplit("@", 1)[-1], parsed.path, urlencode(query), ""))
        candidates = {
            variant for secret in secrets if secret and len(str(secret)) >= 4
            for variant in (str(secret), quote(str(secret), safe=""), quote_plus(str(secret)))
        }
        if candidates:
            pattern = "|".join(re.escape(secret) for secret in sorted(candidates, key=lambda secret: (-len(secret), secret)))
            value = re.sub(pattern, lambda match: "[REDACTED]", value)
    return value


def portable_settings(settings):
    return sanitize({key: value for key, value in settings.items() if key in SETTINGS_FIELDS})


def bundle_path(name):
    if not isinstance(name, str) or not name or "\\" in name or ":" in name or any(ord(character) < 32 for character in name):
        raise BundleError("Bundle contains an invalid file path.")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or path.as_posix() != name:
        raise BundleError("Bundle contains an unsafe file path.")
    reserved = {"CON", "PRN", "AUX", "NUL"} | {f"{prefix}{number}" for prefix in ("COM", "LPT") for number in range(1, 10)}
    if any(part.endswith((".", " ")) or part.split(".", 1)[0].upper() in reserved for part in path.parts):
        raise BundleError("Bundle contains a nonportable file name.")
    return path


def unpack_bundle(payload):
    if len(payload) > MAX_BUNDLE_BYTES:
        raise BundleError("Bundle exceeds the 128 MiB upload limit.", "sizeLimit")
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            members = archive.infolist()
            if len(members) > MAX_FILES or sum(member.file_size for member in members) > MAX_EXPANDED_BYTES:
                raise BundleError("Bundle exceeds the file count or expanded-size limit.", "sizeLimit")
            files = {}
            seen_paths = set()
            for member in members:
                if member.is_dir():
                    continue
                path = bundle_path(member.orig_filename)
                if stat.S_ISLNK(member.external_attr >> 16) or member.flag_bits & 1:
                    raise BundleError("Links and encrypted files are not allowed in bundles.")
                if path.as_posix().casefold() in seen_paths:
                    raise BundleError("Bundle contains duplicate file paths.")
                seen_paths.add(path.as_posix().casefold())
                if path.as_posix() != "manifest.json" and not (
                    path.parts[0] == "files" and path.suffix.lower() in ASSET_EXTENSIONS | {".yml", ".yaml"}
                ):
                    raise BundleError("Bundle contains an unsupported file.")
                if member.file_size > 1024 * 1024 and member.file_size > max(1, member.compress_size) * 200:
                    raise BundleError("Bundle contains excessive compression.")
                files[path.as_posix()] = archive.read(member)
    except (zipfile.BadZipFile, RuntimeError, EOFError) as error:
        raise BundleError("Invalid ZIP bundle.") from error
    try:
        manifest = json.loads(files.pop("manifest.json").decode("utf-8"))
    except (KeyError, ValueError, UnicodeError) as error:
        raise BundleError("Bundle manifest is missing or invalid.") from error
    if not isinstance(manifest, dict) or manifest.get("kind") != "posterizarr-overlay-bundle" or manifest.get("version") != SCHEMA_VERSION:
        raise BundleError("Unsupported overlay bundle format.", "unsupportedBundle")
    return sanitize(manifest), files


def pack_bundle(manifest, files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(sanitize(manifest), indent=2))
        for name, payload in sorted(files.items()):
            archive.writestr(bundle_path(name).as_posix(), payload)
    result = stream.getvalue()
    unpack_bundle(result)
    return result


def read_document(path):
    if not path.exists():
        return {}
    try:
        text = path.read_text(encoding="utf-8-sig")
        value = json.loads(text) if path.suffix == ".json" else yaml.safe_load(text)
    except (ValueError, UnicodeError, yaml.YAMLError) as error:
        raise BundleError(f"Invalid configuration file: {path.name}") from error
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise BundleError(f"Expected a configuration object in {path.name}.")
    return value


def transform_strings(value, transform, depth=0):
    if depth > 32:
        raise BundleError("Bundle configuration is nested too deeply.")
    if isinstance(value, dict):
        return {key: transform_strings(child, transform, depth + 1) for key, child in value.items()}
    if isinstance(value, list):
        return [transform_strings(child, transform, depth + 1) for child in value]
    return transform(value) if isinstance(value, str) else value


def credential_values(value):
    result = []
    if isinstance(value, dict):
        for key, child in value.items():
            if private_key(key) and isinstance(child, str) and len(child.strip()) >= 4:
                result.append(child.strip())
            else:
                result.extend(credential_values(child))
    elif isinstance(value, list):
        for child in value:
            result.extend(credential_values(child))
    return result


def export_profile(config_root, overlays_dir, settings, visual, anime, library_types=None, imdb_enabled=False, private_config=None, official_catalog=None):
    config_root, overlays_dir = Path(config_root).resolve(), Path(overlays_dir).resolve()
    primary = overlays_dir / "configs" / "config.yml"
    if not primary.is_file():
        raise BundleError("No overlay config.yml exists to export.", "missingConfig")
    catalog = load_official_catalog() if official_catalog is None else official_catalog
    official_by_hash, official_by_local = {}, {}
    for source, checksum in sorted(catalog.items()):
        local = official_local_path(source)
        if local:
            official_by_hash.setdefault(checksum, []).append(source)
            official_by_local[local] = source
    secrets = credential_values([settings, anime, private_config or {}])
    sources = {}
    roots = [(overlays_dir, "")]
    seen_roots = {overlays_dir}
    for folder, prefix in (
        (config_root / "overlays", "resources/overlays/"),
        (config_root / "fonts", "resources/fonts/"),
        (config_root / "Overlayfiles", "resources/Overlayfiles/"),
        (overlays_dir.parent, "resources/active-Overlayfiles/"),
    ):
        if folder.is_dir() and folder.resolve() not in seen_roots:
            roots.append((folder, prefix))
            seen_roots.add(folder.resolve())
    for folder, prefix in roots:
        for path in folder.rglob("*"):
            if path.is_symlink() or not path.is_file() or path.suffix.lower() not in ASSET_EXTENSIONS | {".yml", ".yaml"}:
                continue
            relative = path.relative_to(folder)
            if any(part.lower() in {"cache", "backups", "backup", ".git", "custom_previews"} for part in relative.parts):
                continue
            if folder != overlays_dir and path.is_relative_to(overlays_dir):
                continue
            sources[prefix + relative.as_posix()] = path
    aliases, basenames = {}, {}
    for relative, path in sources.items():
        aliases[path.as_posix()] = relative
        aliases[relative] = relative
        if relative.startswith("configs/"):
            aliases["config/" + relative[len("configs/"):]] = relative
        if path.is_relative_to(config_root):
            root_relative = path.relative_to(config_root).as_posix()
            aliases[root_relative] = relative
            aliases["config/" + root_relative] = relative
            aliases["/config/" + root_relative] = relative
        basenames.setdefault(path.name, []).append(relative)

    selected, replacements, official_dependencies, documents = set(), {}, {}, {}
    pending = []

    def official_reference(source):
        local = official_local_path(source)
        official_dependencies[local] = {"source": source, "sha": catalog[source]}
        return "kometa://" + local

    def include(relative):
        if relative in replacements:
            return replacements[relative]
        path = sources[relative]
        payload = path.read_bytes()
        matches = official_by_hash.get(git_blob_hash(payload), []) if relative != "configs/config.yml" else []
        if matches:
            source = min(matches, key=lambda source: (official_local_path(source) != relative, source))
            reference = official_reference(source)
        else:
            selected.add(relative)
            reference = "bundle://" + relative
        replacements[relative] = reference
        if path.suffix.lower() in {".yml", ".yaml"}:
            documents[relative] = sanitize(read_document(path), secrets)
            pending.append(relative)
        return reference

    def referenced_official(text):
        candidates = [text, "assets/" + text]
        for marker in ("assets/", "fonts/", "defaults/"):
            if "/" + marker in text:
                candidates.append(marker + text.rsplit("/" + marker, 1)[1])
        if PurePosixPath(text).suffix.lower() in {".ttf", ".otf"}:
            candidates.append("fonts/" + PurePosixPath(text).name)
        if "/" not in text:
            candidates.extend(("defaults/" + text, "assets/resolution/" + text))
        return next((official_by_local[name] for name in candidates if name in official_by_local), None)

    def select_reference(value):
        text = value.replace("\\", "/")
        if text.startswith(("http://", "https://")):
            return value
        if text in aliases:
            return include(aliases[text])
        if "<<" in text and "/" in text:
            pattern = re.sub(r"<<[^>]+>>", "*", text)
            patterns = [pattern] if PurePosixPath(pattern).suffix else [pattern + extension for extension in (".png", ".yml", ".yaml")]
            for alias, relative in aliases.items():
                if any(fnmatch.fnmatchcase(alias, candidate) or fnmatch.fnmatchcase(alias, "*/" + candidate) for candidate in patterns):
                    include(relative)
            return value
        if PurePosixPath(text).suffix.lower() in ASSET_EXTENSIONS | {".yml", ".yaml"}:
            candidates = basenames.get(PurePosixPath(text).name, [])
            if len(candidates) == 1:
                return include(candidates[0])
            source = referenced_official(text)
            if source:
                return official_reference(source)
            if text.startswith("/") or re.match(r"^[A-Za-z]:/", text):
                raise BundleError("A local asset reference is outside the exportable overlay folders or is missing.", "missingAsset")
        return value

    native_families = set()

    def select_defaults(value):
        if isinstance(value, dict):
            default = value.get("default")
            if isinstance(default, str) and re.fullmatch(r"[a-zA-Z0-9_-]+", default):
                native_families.add({"ratings": "rating", "single_rating": "rating", "languages": "flag"}.get(default, default))
                local = next((name for name in (f"defaults/{default}.yml", f"defaults/{default}.yaml") if name in sources), None)
                if local:
                    include(local)
                else:
                    select_reference(default + ".yml")
            for child in value.values():
                select_defaults(child)
        elif isinstance(value, list):
            for child in value:
                select_defaults(child)

    for relative, path in sources.items():
        if path.suffix.lower() in {".yml", ".yaml"} and "defaults" not in PurePosixPath(relative).parts:
            include(relative)
    for metadata in (settings, visual, anime):
        transform_strings(sanitize(metadata, secrets), select_reference)
    while pending:
        relative = pending.pop()
        document = documents[relative]
        transform_strings(document, select_reference)
        select_defaults(document)
    if settings.get("rating_sources"):
        native_families.add("rating")
    for relative, path in sources.items():
        parts = set(PurePosixPath(relative).parts)
        if path.suffix.lower() in ASSET_EXTENSIONS and (parts & native_families):
            include(relative)
        elif path.name == "Inter-Bold.ttf" and native_families:
            include(relative)

    def portable_reference(value):
        text = value.replace("\\", "/")
        if text in aliases and aliases[text] in replacements:
            return replacements[aliases[text]]
        if "<<" in text and "/" in text:
            prefix = text[:text.index("<<")].rsplit("/", 1)[0] + "/"
            for alias, relative in aliases.items():
                if alias.startswith(prefix) and relative in selected:
                    local = relative[:len(relative) - len(alias) + len(prefix)] + text[len(prefix):]
                    return "bundle://" + local
            for alias, relative in aliases.items():
                if alias.startswith(prefix) and relative in replacements:
                    suffix = alias[len(prefix):]
                    replacement = replacements[relative]
                    if suffix and replacement.endswith(suffix):
                        return replacement[:-len(suffix)] + text[len(prefix):]
            return value
        candidates = basenames.get(PurePosixPath(text).name, [])
        if not text.startswith(("http://", "https://")) and len(candidates) == 1 and candidates[0] in replacements:
            return replacements[candidates[0]]
        source = referenced_official(text)
        return official_reference(source) if source else value

    sources = {relative: path for relative, path in sources.items() if relative in selected}
    if len(sources) > MAX_FILES - 1:
        raise BundleError("Custom overlay dependencies exceed the bundle file-count limit.", "sizeLimit")
    files = {}
    expanded = 0
    for relative, path in sources.items():
        expanded += path.stat().st_size
        if expanded > MAX_EXPANDED_BYTES:
            raise BundleError("Overlay files exceed the 256 MiB expanded-size limit.", "sizeLimit")
        if path.suffix.lower() in {".yml", ".yaml"}:
            document = transform_strings(documents[relative], portable_reference)
            files["files/" + relative] = yaml.safe_dump(document, sort_keys=False, allow_unicode=True).encode("utf-8")
        else:
            payload = path.read_bytes()
            if any(secret.encode() in payload for secret in secrets):
                raise BundleError("An asset contains a credential value. Remove its metadata before exporting.", "credentials")
            files["files/" + relative] = payload
    main = yaml.safe_load(files["files/configs/config.yml"])
    source_libraries = main.get("libraries") or {}
    portable_anime = sanitize({key: value for key, value in anime.items() if key in ANIME_FIELDS}, secrets)
    profiles = []
    names = set(source_libraries) | set(anime.get("target_libraries") or []) | set(settings.get("season_rating_libraries") or [])
    for name in sorted(names):
        library = source_libraries.get(name) or {}
        profiles.append({
            "name": name,
            "media_type": (library_types or {}).get(name) or ((visual.get("libraries") or {}).get(name) or {}).get("media_type"),
            "rule_count": len(library.get("overlay_files") or library.get("overlays") or []),
            "animetafill": name in (anime.get("target_libraries") or []) and bool(anime.get("enabled")),
            "season_ratings": name in (settings.get("season_rating_libraries") or []),
        })
    manifest = {
        "kind": "posterizarr-overlay-bundle", "version": SCHEMA_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "libraries": profiles,
        "settings": transform_strings(portable_settings(settings), portable_reference),
        "visual": transform_strings(sanitize(visual, secrets), portable_reference),
        "animetafill": transform_strings(portable_anime, portable_reference),
        "imdb_dataset": bool(imdb_enabled),
        "official_dependencies": official_dependencies,
        "checksums": {name: hashlib.sha256(payload).hexdigest() for name, payload in files.items()},
    }
    return pack_bundle(manifest, files)


def inspect_profile(payload, overlays_dir, local_libraries):
    manifest, files = unpack_bundle(payload)
    dependencies = manifest.get("official_dependencies") or {}
    if not isinstance(dependencies, dict):
        raise BundleError("Official dependency metadata is invalid.")
    for local, dependency in dependencies.items():
        if not isinstance(dependency, dict) or official_local_path(dependency.get("source", "")) != local or not re.fullmatch(r"[a-f0-9]{40}", str(dependency.get("sha", ""))):
            raise BundleError("Official dependency metadata is invalid.")
    primary = files.get("files/configs/config.yml")
    if primary is None:
        raise BundleError("Bundle has no primary overlay configuration.")
    for name, data in files.items():
        if (manifest.get("checksums") or {}).get(name) != hashlib.sha256(data).hexdigest():
            raise BundleError("Bundle checksum validation failed.")
    profiles = manifest.get("libraries")
    if not isinstance(profiles, list) or not all(isinstance(profile, dict) and isinstance(profile.get("name"), str) for profile in profiles):
        raise BundleError("Bundle library profiles are invalid.")
    if len({profile["name"] for profile in profiles}) != len(profiles):
        raise BundleError("Bundle has duplicate library profiles.")
    conflicts = []
    for name, data in files.items():
        relative = bundle_path(name).relative_to("files")
        destination = Path(overlays_dir) / relative
        if destination.exists() and name != "files/configs/config.yml" and destination.read_bytes() != data:
            conflicts.append(relative.as_posix())
    return {
        "libraries": profiles, "local_libraries": local_libraries,
        "file_count": len(files), "asset_count": sum(PurePosixPath(name).suffix.lower() in ASSET_EXTENSIONS for name in files),
        "official_dependency_count": len(dependencies),
        "conflicts": conflicts,
        "features": {
            "dynamic_overlays": bool((manifest.get("settings") or {}).get("enabled")),
            "animetafill": bool((manifest.get("animetafill") or {}).get("enabled")),
            "imdb_dataset": bool(manifest.get("imdb_dataset")),
            "rating_sources": (manifest.get("settings") or {}).get("rating_sources") or [],
        },
    }


def prepare_import(payload, overlays_dir, local_libraries, mapping, anime_libraries, season_libraries, import_settings=True, replace_files=False):
    summary = inspect_profile(payload, overlays_dir, local_libraries)
    manifest, files = unpack_bundle(payload)
    known = {library["name"]: library for library in local_libraries}
    profiles = {profile["name"]: profile for profile in summary["libraries"]}
    if not isinstance(mapping, dict) or set(mapping) - set(profiles):
        raise BundleError("Library mapping contains an unknown source library.", "invalidMapping")
    if not all(isinstance(source, str) and isinstance(target, str) for source, target in mapping.items()):
        raise BundleError("Library mapping values must be library names.", "invalidMapping")
    selected = {source: target for source, target in mapping.items() if target}
    if not selected:
        raise BundleError("Choose at least one destination library.", "invalidMapping")
    if len(set(selected.values())) != len(selected):
        raise BundleError("Map each profile to a different destination library.", "invalidMapping")
    for source, target in selected.items():
        if target not in known:
            raise BundleError("A mapped destination library does not exist on the selected server.", "missingLibrary")
        source_type = profiles[source].get("media_type")
        target_type = known[target].get("type")
        if source_type in {"movie", "show"} and target_type in {"movie", "show"} and source_type != target_type:
            raise BundleError("Movie and show library types cannot be mixed.", "invalidMapping")
    chosen = set(selected.values())
    if not isinstance(anime_libraries, list) or not isinstance(season_libraries, list) or (set(anime_libraries) | set(season_libraries)) - chosen:
        raise BundleError("Feature targets must be mapped destination libraries.", "invalidMapping")
    if any(known[name].get("type") != "show" for name in set(anime_libraries) | set(season_libraries)):
        raise BundleError("AniMetaFill and season ratings require show libraries.", "invalidMapping")
    if summary["conflicts"] and not replace_files:
        raise BundleError("Confirm replacement of the conflicting shared YAML/assets before importing.", "conflicts")
    root = Path(overlays_dir).resolve()

    def local_reference(value):
        if value.startswith("kometa://"):
            relative = bundle_path(value[len("kometa://"):])
            dependencies = manifest.get("official_dependencies") or {}
            pattern = re.sub(r"<<[^>]+>>", "*", relative.as_posix())
            if relative.as_posix() not in dependencies and not ("<<" in value and any(fnmatch.fnmatchcase(name, pattern) for name in dependencies)):
                raise BundleError("An official dependency reference is missing from the bundle manifest.", "missingAsset")
            destination = root / relative
            if not destination.resolve().is_relative_to(root):
                raise BundleError("An official dependency points outside the overlay directory.")
            return destination.as_posix()
        if not value.startswith("bundle://"):
            text = value.replace("\\", "/")
            if (text.startswith("/") or re.match(r"^[A-Za-z]:/", text)) and PurePosixPath(text).suffix.lower() in ASSET_EXTENSIONS | {".yaml", ".yml"}:
                raise BundleError("Bundle contains a nonportable absolute file reference.", "missingAsset")
            return value
        relative = bundle_path(value[len("bundle://"):])
        if "<<" not in str(relative) and "files/" + relative.as_posix() not in files:
            raise BundleError("Bundle references a missing asset or YAML file.", "missingAsset")
        return (root / relative).as_posix()

    def map_libraries(value):
        if isinstance(value, dict):
            result = {}
            for key, child in value.items():
                if key == "libraries" and isinstance(child, dict):
                    result[key] = {selected[name]: map_libraries(data) for name, data in child.items() if name in selected}
                elif key in {"target_libraries", "plex_libraries", "season_rating_libraries"} and isinstance(child, list):
                    result[key] = [selected[name] for name in child if name in selected]
                else:
                    result[key] = map_libraries(child)
            return result
        if isinstance(value, list):
            return [map_libraries(child) for child in value]
        return value

    writes = {}
    imported_main = {}
    for name, data in files.items():
        relative = bundle_path(name).relative_to("files")
        destination = root / relative
        if not destination.resolve().is_relative_to(root):
            raise BundleError("An import destination points outside the overlay directory.")
        if relative.suffix.lower() in {".yaml", ".yml"}:
            try:
                document = yaml.safe_load(data.decode("utf-8")) or {}
                if not isinstance(document, dict):
                    raise BundleError("Bundled YAML files must contain configuration objects.")
                document = map_libraries(transform_strings(sanitize(document), local_reference))
            except (UnicodeError, yaml.YAMLError) as error:
                raise BundleError("Bundle contains invalid YAML.") from error
            if name == "files/configs/config.yml":
                imported_main = document
                continue
            data = yaml.safe_dump(document, sort_keys=False, allow_unicode=True).encode("utf-8")
        writes[destination] = data
    main_path = root / "configs" / "config.yml"
    current = read_document(main_path)
    destination_libraries = current.setdefault("libraries", {})
    for source, target in selected.items():
        if target not in (imported_main.get("libraries") or {}):
            continue
        library = (imported_main.get("libraries") or {}).get(target) or {}
        portable_library = {key: value for key, value in library.items() if key in LIBRARY_FIELDS}
        existing = dict(destination_libraries.get(target) or {})
        existing.pop("overlay_files", None)
        existing.pop("overlays", None)
        destination_libraries[target] = {**existing, **portable_library}
    for key in ("templates", "queues"):
        if isinstance(imported_main.get(key), dict):
            current[key] = {**(current.get(key) or {}), **imported_main[key]}
    if imported_main.get("external_templates"):
        current["external_templates"] = imported_main["external_templates"]
    writes[main_path] = yaml.safe_dump(current, sort_keys=False, allow_unicode=True).encode("utf-8")
    visual = map_libraries(transform_strings(sanitize(manifest.get("visual") or {}), local_reference))
    for library in (visual.get("libraries") or {}).values():
        for variants in (library.get("asset_overrides") or {}).values():
            for variant, value in variants.items():
                asset = Path(value)
                if asset.is_absolute() and asset.is_relative_to(root / "assets"):
                    variants[variant] = asset.relative_to(root / "assets").as_posix()
    anime = {key: value for key, value in (manifest.get("animetafill") or {}).items() if key in ANIME_FIELDS}
    anime = transform_strings(sanitize(anime), local_reference)
    anime["target_libraries"] = anime_libraries
    anime["enabled"] = bool(anime_libraries)
    settings = portable_settings(manifest.get("settings") or {}) if import_settings else {}
    if import_settings:
        settings["season_rating_libraries"] = season_libraries
    settings["change_detection_dry_run"] = True
    return {"writes": writes, "settings": settings, "visual": visual,
            "animetafill": anime if import_settings else {}, "imdb_dataset": bool(manifest.get("imdb_dataset")) if import_settings else None,
            "libraries": list(selected.values()), "summary": summary}


def commit_import(plan, config_root):
    config_root = Path(config_root)
    settings_dir = config_root / "dynamic_overlays"
    writes = dict(plan["writes"])
    for filename, updates in (("dynamic_overlays_settings.json", plan["settings"]),
                              ("animetafill_config.json", plan["animetafill"]),
                              ("dynamic_overlays_visual_config.json", plan["visual"])):
        if not updates:
            continue
        path = settings_dir / filename
        current = read_document(path)
        if filename == "dynamic_overlays_visual_config.json":
            current["libraries"] = {**(current.get("libraries") or {}), **(updates.get("libraries") or {})}
        else:
            current.update(updates)
        writes[path] = json.dumps(current, indent=2, ensure_ascii=False).encode("utf-8")
    backup_dir = settings_dir / "bundle_backups" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8])
    originals = {}
    staged = {}
    backup_index = []
    try:
        for index, (path, data) in enumerate(writes.items()):
            path.parent.mkdir(parents=True, exist_ok=True)
            originals[path] = path.read_bytes() if path.exists() else None
            if originals[path] is not None:
                backup_dir.mkdir(parents=True, exist_ok=True)
                (backup_dir / f"{index}-{path.name}").write_bytes(originals[path])
                backup_index.append({"backup": f"{index}-{path.name}", "destination": str(path)})
            temporary = path.with_name(path.name + ".bundle-" + uuid.uuid4().hex)
            temporary.write_bytes(data)
            staged[path] = temporary
        if backup_index:
            (backup_dir / "index.json").write_text(json.dumps(backup_index, indent=2), encoding="utf-8")
        for path, temporary in staged.items():
            os.replace(temporary, path)
    except Exception:
        for path, original in originals.items():
            if original is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(original)
        raise
    finally:
        for temporary in staged.values():
            temporary.unlink(missing_ok=True)
    return {"imported_libraries": plan["libraries"], "file_count": len(writes), "backup": backup_dir.name,
            "dry_run": bool(plan["settings"].get("change_detection_dry_run"))}