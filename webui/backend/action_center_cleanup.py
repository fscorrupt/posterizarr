"""
Cleanup helpers for removing deleted media server items from Action Center (imagechoices / skipped_items)
and media export databases without touching artwork files on disk.
"""

from __future__ import annotations

import logging
from pathlib import Path
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set, Tuple
from xml.etree.ElementTree import ParseError, fromstring

import httpx

logger = logging.getLogger(__name__)

_VIDEO_FILE_EXTS = {
    ".mkv", ".mp4", ".avi", ".m4v", ".ts", ".m2ts", ".mov", ".wmv", ".flv", ".webm", ".iso", ".strm", ".mpg", ".mpeg",
}


def extract_rootfolder(item_path: Optional[str], library_paths: Optional[List[str]] = None) -> Optional[str]:
    """
    Replicate Posterizarr's Rootfolder extraction logic from NormalMode.ps1 / EmbyJellyMode.ps1.
    """
    raw_path = str(item_path or "").strip()
    if not raw_path:
        return None
    if raw_path.startswith("\\\\?\\"):
        raw_path = raw_path[4:]

    clean_lib_paths = sorted(
        {str(lp or "").strip().rstrip("\\/") for lp in (library_paths or []) if str(lp or "").strip()},
        key=len,
        reverse=True,
    )
    path_lower = raw_path.lower()

    for lib_clean in clean_lib_paths:
        if path_lower.startswith(lib_clean.lower() + "/") or path_lower.startswith(lib_clean.lower() + "\\"):
            relative = raw_path[len(lib_clean):].lstrip("\\/")
            segments = [seg for seg in re.split(r"[\\/]+", relative) if seg]
            if len(segments) > 2:
                return segments[-2]
            if segments:
                return segments[0]

    # Fallback if container mount paths differ from media server root paths
    segments = [seg for seg in re.split(r"[\\/]+", raw_path) if seg]
    if not segments:
        return None
    if Path(segments[-1]).suffix.lower() in _VIDEO_FILE_EXTS and len(segments) >= 2:
        return segments[-2]
    return segments[-1]


def prune_action_center_from_export(
    db: Any,
    media_export_db: Any,
    server_type: str,
    run_timestamp: Optional[str] = None,
) -> Dict[str, int]:
    """Prune stale Action Center rows using the freshly imported library export snapshot."""
    if db is None or media_export_db is None:
        return {"imagechoices_deleted": 0, "skipped_deleted": 0, "libraries_checked": 0}
    active = media_export_db.get_active_rootfolders_by_library(server_type, run_timestamp=run_timestamp)
    if not active:
        return {"imagechoices_deleted": 0, "skipped_deleted": 0, "libraries_checked": 0}
    return db.prune_missing_from_libraries(active, prune_skipped=True)


async def fetch_active_rootfolders_from_servers(
    config_path: Path,
    client: Optional[httpx.AsyncClient] = None,
) -> Tuple[Dict[str, Dict[str, Set[str]]], List[str]]:
    """Query enabled media servers (Plex, Jellyfin, Emby) for all active item rootfolders by library."""
    from overlay_sync_service import get_server_credentials

    credentials = get_server_credentials(config_path)
    per_server_active: Dict[str, Dict[str, Set[str]]] = {}
    warnings: List[str] = []

    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(timeout=30.0)

    try:
        # 1. Plex
        plex_cfg = credentials.get("plex") or {}
        if plex_cfg.get("enabled") and plex_cfg.get("url") and plex_cfg.get("token"):
            base_url = str(plex_cfg["url"]).rstrip("/")
            headers = {"X-Plex-Token": plex_cfg["token"], "Accept": "application/xml"}
            excluded = {str(name).strip().lower() for name in (plex_cfg.get("excluded_libs") or []) if name}
            try:
                sec_resp = await client.get(f"{base_url}/library/sections", headers=headers)
                if sec_resp.status_code != 200:
                    warnings.append(f"Plex sections HTTP {sec_resp.status_code}")
                else:
                    sec_root = fromstring(sec_resp.content)
                    plex_libs: Dict[str, Set[str]] = {}
                    for directory in sec_root.findall(".//Directory"):
                        sec_type = str(directory.get("type") or "").strip().lower()
                        lib_title = str(directory.get("title") or "").strip()
                        lib_key = str(directory.get("key") or "").strip()
                        if sec_type not in ("movie", "show") or not lib_title or not lib_key:
                            continue
                        if lib_title.lower() in excluded:
                            continue
                        lib_paths = [
                            loc.get("path")
                            for loc in directory.findall("Location")
                            if loc.get("path")
                        ]
                        try:
                            items_resp = await client.get(
                                f"{base_url}/library/sections/{lib_key}/all",
                                headers=headers,
                            )
                            if items_resp.status_code != 200:
                                warnings.append(f"Plex '{lib_title}' HTTP {items_resp.status_code}")
                                continue
                            items_root = fromstring(items_resp.content)
                            active_roots: Set[str] = set()
                            for node in (*items_root.findall("Directory"), *items_root.findall("Video")):
                                candidates: List[str] = [
                                    loc.get("path")
                                    for loc in node.findall("Location")
                                    if loc.get("path")
                                ]
                                candidates.extend(
                                    part.get("file")
                                    for part in node.findall(".//Part")
                                    if part.get("file")
                                )
                                for cand in candidates:
                                    rf = extract_rootfolder(cand, lib_paths)
                                    if rf:
                                        active_roots.add(rf)
                            if active_roots:
                                plex_libs[lib_title] = active_roots
                            else:
                                warnings.append(
                                    f"Skipped Plex library '{lib_title}': 0 active items returned"
                                )
                        except (httpx.HTTPError, ParseError) as err:
                            warnings.append(f"Plex '{lib_title}' failed: {type(err).__name__}")
                    if plex_libs:
                        per_server_active["plex"] = plex_libs
            except (httpx.HTTPError, ParseError) as err:
                warnings.append(f"Plex request failed: {type(err).__name__}")

        # 2. Jellyfin & Emby
        for server_type in ("jellyfin", "emby"):
            srv_cfg = credentials.get(server_type) or {}
            if not srv_cfg.get("enabled") or not srv_cfg.get("url") or not srv_cfg.get("api_key"):
                continue
            base_url = str(srv_cfg["url"]).rstrip("/")
            headers = {"X-Emby-Token": srv_cfg["api_key"], "Accept": "application/json"}
            excluded = {str(name).strip().lower() for name in (srv_cfg.get("excluded_libs") or []) if name}
            try:
                vf_resp = await client.get(f"{base_url}/Library/VirtualFolders", headers=headers)
                if vf_resp.status_code != 200:
                    warnings.append(f"{server_type.capitalize()} VirtualFolders HTTP {vf_resp.status_code}")
                    continue
                folders = vf_resp.json()
                srv_libs: Dict[str, Set[str]] = {}
                for folder in folders if isinstance(folders, list) else []:
                    col_type = str(folder.get("CollectionType") or "").strip().lower()
                    lib_name = str(folder.get("Name") or "").strip()
                    item_id = str(folder.get("ItemId") or "").strip()
                    if col_type not in ("", "movies", "tvshows", "mixed") or not lib_name or not item_id:
                        continue
                    if lib_name.lower() in excluded:
                        continue
                    lib_paths = [str(p) for p in (folder.get("Locations") or []) if p]
                    try:
                        items_resp = await client.get(
                            f"{base_url}/Items",
                            headers=headers,
                            params={
                                "ParentId": item_id,
                                "Recursive": "true",
                                "IncludeItemTypes": "Movie,Series",
                                "Fields": "Path",
                            },
                        )
                        if items_resp.status_code != 200:
                            warnings.append(f"{server_type.capitalize()} '{lib_name}' HTTP {items_resp.status_code}")
                            continue
                        payload = items_resp.json()
                        active_roots: Set[str] = set()
                        for item in payload.get("Items", []) if isinstance(payload, dict) else []:
                            rf = extract_rootfolder(item.get("Path"), lib_paths)
                            if rf:
                                active_roots.add(rf)
                        if active_roots:
                            srv_libs[lib_name] = active_roots
                        else:
                            warnings.append(
                                f"Skipped {server_type.capitalize()} library '{lib_name}': 0 active items returned"
                            )
                    except (httpx.HTTPError, ValueError) as err:
                        warnings.append(f"{server_type.capitalize()} '{lib_name}' failed: {type(err).__name__}")
                if srv_libs:
                    per_server_active[server_type] = srv_libs
            except (httpx.HTTPError, ValueError) as err:
                warnings.append(f"{server_type.capitalize()} request failed: {type(err).__name__}")
    finally:
        if owns_client:
            await client.aclose()

    return per_server_active, warnings


async def prune_stale_action_center_entries(
    db: Any,
    media_export_db: Any,
    config_path: Path,
    server_fetcher: Optional[
        Callable[[Path], Awaitable[Tuple[Dict[str, Dict[str, Set[str]]], List[str]]]]
    ] = None,
) -> Dict[str, Any]:
    """Query configured media servers and prune orphaned DB records from Action Center & export DBs."""
    if server_fetcher is not None:
        per_server_active, warnings = await server_fetcher(config_path)
    else:
        per_server_active, warnings = await fetch_active_rootfolders_from_servers(config_path)

    if not per_server_active:
        err_msg = (
            "; ".join(warnings)
            if warnings
            else "No active media server libraries available for cleanup"
        )
        return {
            "success": False,
            "error": err_msg,
            "warnings": warnings,
            "imagechoices_deleted": 0,
            "skipped_deleted": 0,
            "export_deleted": 0,
            "libraries_checked": [],
        }

    export_deleted = 0
    combined_active: Dict[str, Set[str]] = {}
    checked_display_names: Dict[str, str] = {}

    for server_type, libs_map in per_server_active.items():
        if media_export_db is not None:
            export_deleted += media_export_db.prune_missing_from_libraries(server_type, libs_map)
        for lib_name, roots in libs_map.items():
            lib_lower = lib_name.strip().lower()
            checked_display_names.setdefault(lib_lower, lib_name.strip())
            combined_active.setdefault(lib_lower, set()).update(roots)

    prune_result = db.prune_missing_from_libraries(combined_active, prune_skipped=True)
    return {
        "success": True,
        "imagechoices_deleted": prune_result["imagechoices_deleted"],
        "skipped_deleted": prune_result["skipped_deleted"],
        "export_deleted": export_deleted,
        "libraries_checked": sorted(checked_display_names.values(), key=str.lower),
        "warnings": warnings,
    }
