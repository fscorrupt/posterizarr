"""Fast, non-blocking global search helpers across cached assets, overlays, logs, and blueprints."""

from __future__ import annotations

from pathlib import Path, PurePosixPath
import re

_CAMEL_RE = re.compile(r"([a-z0-9])([A-Z])")


def tokenize_query(query: str) -> list[str]:
    """Normalize a search query into unique lowercase whitespace tokens."""
    if not isinstance(query, str):
        return []
    tokens: list[str] = []
    seen: set[str] = set()
    for part in query.strip().lower().split():
        if part and part not in seen:
            seen.add(part)
            tokens.append(part)
            if len(tokens) >= 8:
                break
    return tokens


def _camel_words(text: str) -> str:
    return _CAMEL_RE.sub(r"\1 \2", text or "").replace("_", " ").replace("-", " ")


def score_text(tokens: list[str], primary: str, secondary: str = "", full_query: str = "") -> int:
    """Return relevance score > 0 when every token matches primary or secondary text."""
    if not tokens:
        return 0
    prim_low = (primary or "").lower()
    sec_low = (secondary or "").lower()
    combined = f"{prim_low} {sec_low}"
    if not all(tok in combined for tok in tokens):
        return 0

    score = 1
    q_low = (full_query or "").strip().lower()
    if q_low:
        if prim_low == q_low:
            score += 120
        elif prim_low.startswith(q_low):
            score += 75
        elif q_low in prim_low:
            score += 45

    for tok in tokens:
        if tok in prim_low:
            score += 25
        elif tok in sec_low:
            score += 10
    return score


def extract_asset_display(asset: dict, category: str) -> tuple[str, str, str]:
    """Extract (display_title, top_library_folder, gallery_search_term) from a cached asset."""
    raw_path = str(asset.get("path") or "").replace("\\", "/")
    name = str(asset.get("name") or "")
    parts = [p for p in PurePosixPath(raw_path).parts if p not in ("", "/")]

    library_folder = parts[0] if len(parts) >= 2 else ""
    stem = PurePosixPath(name).stem if name else ""
    media_folder = parts[-2] if len(parts) >= 3 else ""

    if category in ("posters", "backgrounds"):
        title = media_folder or (f"{library_folder} — {stem}" if library_folder and stem else stem or name or raw_path)
    else:
        if media_folder and stem:
            title = f"{media_folder} — {stem}"
        elif library_folder and stem:
            title = f"{library_folder} — {stem}"
        else:
            title = stem or name or raw_path

    gallery_search_term = media_folder or stem or name
    return title, library_folder, gallery_search_term


_ASSET_CATEGORIES = (
    ("posters", "/gallery/posters", "Poster", 4),
    ("backgrounds", "/gallery/backgrounds", "Background", 3),
    ("seasons", "/gallery/seasons", "Season", 2),
    ("titlecards", "/gallery/titlecards", "Title Card", 1),
)


def search_cached_assets(cache: dict, tokens: list[str], limit: int = 8, full_query: str = "") -> list[dict]:
    """Search the already-populated in-memory asset cache without touching disk."""
    if not tokens or not isinstance(cache, dict):
        return []

    matches: list[tuple[tuple[int, int, float], dict]] = []
    for cat_key, route, kind_label, priority in _ASSET_CATEGORIES:
        items = cache.get(cat_key) or []
        if not isinstance(items, list):
            continue
        for asset in items:
            if not isinstance(asset, dict):
                continue
            title, folder, search_term = extract_asset_display(asset, cat_key)
            raw_path = str(asset.get("path") or "").replace("\\", "/")
            asset_type = str(asset.get("type") or kind_label)
            secondary = f"{folder} {asset.get('name', '')} {raw_path} {asset_type} {kind_label}"
            score = score_text(tokens, title, secondary, full_query=full_query)
            if score <= 0:
                continue
            modified = float(asset.get("modified") or 0)
            subtitle = f"{kind_label} · {folder}" if folder else kind_label
            matches.append(
                (
                    (score, priority, modified),
                    {
                        "id": f"asset:{cat_key}:{raw_path}",
                        "kind": cat_key,
                        "kind_label": kind_label,
                        "title": title,
                        "subtitle": subtitle,
                        "folder": folder,
                        "search_term": search_term,
                        "path": raw_path,
                        "url": asset.get("url") or "",
                        "route": route,
                        "asset_type": asset_type,
                    },
                )
            )

    matches.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in matches[:limit]]


def search_log_files(
    logs_dir: Path | None,
    ui_logs_dir: Path | None,
    tokens: list[str],
    limit: int = 6,
    full_query: str = "",
) -> list[dict]:
    """Search available *.log filenames across Logs and UILogs directories."""
    if not tokens:
        return []

    candidates: list[tuple[tuple[int, float], dict]] = []
    seen_names: set[str] = set()
    roots = ((logs_dir, "Logs"), (ui_logs_dir, "UILogs"))

    for directory, dir_label in roots:
        if not isinstance(directory, Path) or not directory.is_dir():
            continue
        try:
            for log_path in directory.glob("*.log"):
                if not log_path.is_file() or log_path.name in seen_names:
                    continue
                seen_names.add(log_path.name)
                try:
                    st = log_path.stat()
                    size = st.st_size
                    modified = st.st_mtime
                except OSError:
                    size = 0
                    modified = 0.0
                friendly = _camel_words(log_path.stem)
                score = score_text(
                    tokens,
                    log_path.name,
                    f"{friendly} {dir_label} log logs",
                    full_query=full_query,
                )
                if score <= 0:
                    continue
                candidates.append(
                    (
                        (score, modified),
                        {
                            "id": f"log:{log_path.name}",
                            "name": log_path.name,
                            "title": log_path.name,
                            "subtitle": dir_label,
                            "directory": dir_label,
                            "size": size,
                            "modified": modified,
                            "route": "/logs",
                        },
                    )
                )
        except OSError:
            continue

    candidates.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in candidates[:limit]]


def _collect_library_overlay_keywords(lib_cfg: dict) -> tuple[list[str], str]:
    enabled_badges: list[str] = []
    search_parts: list[str] = []
    badges = lib_cfg.get("badges")
    if isinstance(badges, dict):
        for badge_name, badge_cfg in badges.items():
            if not isinstance(badge_cfg, dict):
                continue
            words = _camel_words(str(badge_name))
            search_parts.append(str(badge_name))
            search_parts.append(words)
            if badge_cfg.get("enabled"):
                enabled_badges.append(words.strip())
                for extra_key in ("sources", "tiers", "languages", "text"):
                    val = badge_cfg.get(extra_key)
                    if isinstance(val, list):
                        search_parts.extend(str(x) for x in val)
                    elif isinstance(val, str) and val:
                        search_parts.append(val)

    for extra_list_key in ("overlay_files", "custom_overlays"):
        extra = lib_cfg.get(extra_list_key)
        if isinstance(extra, list):
            for entry in extra:
                if isinstance(entry, dict):
                    for k in ("default", "name", "file"):
                        if entry.get(k):
                            search_parts.append(str(entry[k]))
                elif isinstance(entry, str):
                    search_parts.append(entry)

    media_type = str(lib_cfg.get("media_type") or "").strip()
    if media_type:
        search_parts.append(media_type)

    summary = ", ".join(enabled_badges[:4]) if enabled_badges else media_type or "Dynamic Overlays"
    return search_parts, summary


def search_overlay_profiles(
    visual_config: dict | None,
    tokens: list[str],
    limit: int = 6,
    full_query: str = "",
) -> list[dict]:
    """Search configured Dynamic Overlay library profiles and active badges."""
    if not tokens or not isinstance(visual_config, dict):
        return []
    libraries = visual_config.get("libraries")
    if not isinstance(libraries, dict):
        return []

    scored: list[tuple[int, dict]] = []
    for lib_name, lib_cfg in libraries.items():
        if not isinstance(lib_name, str) or not isinstance(lib_cfg, dict):
            continue
        keywords, summary = _collect_library_overlay_keywords(lib_cfg)
        media_type = str(lib_cfg.get("media_type") or "").strip()
        secondary = f"{media_type} dynamic overlay {' '.join(keywords)}"
        score = score_text(tokens, lib_name, secondary, full_query=full_query)
        if score <= 0:
            continue
        subtitle = f"{media_type.upper()} · {summary}" if media_type else summary
        scored.append(
            (
                score,
                {
                    "id": f"overlay-lib:{lib_name}",
                    "library": lib_name,
                    "title": lib_name,
                    "subtitle": subtitle,
                    "media_type": media_type or None,
                    "route": "/dynamic-overlays?tab=rules",
                    "tab": "rules",
                },
            )
        )

    scored.sort(key=lambda pair: (-pair[0], pair[1]["title"].lower()))
    return [item for _, item in scored[:limit]]


def search_custom_blueprints(
    custom_blueprints: list[dict] | None,
    tokens: list[str],
    limit: int = 5,
    full_query: str = "",
) -> list[dict]:
    """Search user-saved Custom Blueprints stored in the config DB."""
    if not tokens or not isinstance(custom_blueprints, list):
        return []

    scored: list[tuple[int, dict]] = []
    for bp in custom_blueprints:
        if not isinstance(bp, dict):
            continue
        bp_id = str(bp.get("id") or "")
        title = str(bp.get("customTitle") or bp.get("name") or bp_id).strip()
        if not title:
            continue
        desc = str(bp.get("description") or "").strip()
        score = score_text(tokens, title, f"{bp_id} {desc} blueprint preset", full_query=full_query)
        if score <= 0:
            continue
        scored.append(
            (
                score,
                {
                    "id": f"blueprint:{bp_id or title}",
                    "blueprint_id": bp_id,
                    "title": title,
                    "subtitle": desc or "Custom Blueprint",
                    "route": "/blueprints",
                    "tab": "presets",
                },
            )
        )

    scored.sort(key=lambda pair: (-pair[0], pair[1]["title"].lower()))
    return [item for _, item in scored[:limit]]


def run_global_search(
    query: str,
    *,
    asset_cache: dict,
    logs_dir: Path | None,
    ui_logs_dir: Path | None,
    visual_config: dict | None = None,
    custom_blueprints: list[dict] | None = None,
    limit: int = 8,
) -> dict:
    """Execute global search across runtime caches/configs without exposing local disk paths."""
    clean_query = (query or "").strip()
    tokens = tokenize_query(clean_query)
    if not tokens:
        return {
            "success": True,
            "query": clean_query,
            "assets": [],
            "overlays": [],
            "logs": [],
            "blueprints": [],
        }

    return {
        "success": True,
        "query": clean_query,
        "assets": search_cached_assets(asset_cache, tokens, limit=limit, full_query=clean_query),
        "overlays": search_overlay_profiles(visual_config, tokens, limit=min(limit, 6), full_query=clean_query),
        "logs": search_log_files(logs_dir, ui_logs_dir, tokens, limit=min(limit, 6), full_query=clean_query),
        "blueprints": search_custom_blueprints(custom_blueprints, tokens, limit=min(limit, 5), full_query=clean_query),
    }
