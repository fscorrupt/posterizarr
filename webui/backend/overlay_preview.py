import copy
import re
from collections import Counter
from pathlib import Path

from overlay_engine import DynamicOverlayCompositor, PORTRAIT_DIM, LANDSCAPE_DIM, get_coordinates


def _position_compound_preview_layers(layers, placements, canvas_box):
    groups = {}
    for index, layer in enumerate(layers):
        groups.setdefault(layer["preview_key"], []).append((index, layer))
    result = list(layers)
    for key, group in groups.items():
        placement = placements.get(key)
        if not placement or len(group) < 2:
            continue
        rendered = []
        for index, layer in group:
            image = DynamicOverlayCompositor._render_layer(layer, canvas_box, abort_on_missing=True)
            bounds = image.getbbox() if image is not None else None
            if bounds:
                rendered.append((index, layer, image, bounds))
        if not rendered:
            continue
        left = min(part[3][0] for part in rendered)
        top = min(part[3][1] for part in rendered)
        right = max(part[3][2] for part in rendered)
        bottom = max(part[3][3] for part in rendered)
        target_left, target_top = get_coordinates(
            canvas_box, (right - left, bottom - top),
            horizontal_align=placement["align"], horizontal_offset=placement["x"],
            vertical_align=placement["valign"], vertical_offset=placement["y"],
        )
        for index, layer, image, bounds in rendered:
            result[index] = {
                "name": layer.get("name"), "preview_key": key, "type": "preview",
                "image_element": image.crop(bounds),
                "horizontal_offset": bounds[0] + target_left - left,
                "vertical_offset": bounds[1] + target_top - top,
            }
    return result


def preview_layer_key(layer):
    name = str(layer.get("name") or "").lower()
    path = str(layer.get("image_path") or "").lower().replace("\\", "/")
    if "audio_codec" in name or "/audio_codec/" in path:
        return "audio_codec"
    if "video_format" in name:
        return "video_format"
    if "commonsense" in name or "content_rating" in name or "age_rating" in name or "commonsense" in path or "/content_rating/" in path:
        return "age_rating"
    if "rating" in name:
        return "rating"
    if "runtime" in name:
        return "runtime"
    if "language" in name or "flag" in name or "/flag" in path:
        return "languages"
    if "status" in name or re.match(r"^(airing|returning|ended|canceled|cancelled)(?:$|[ _-])", name):
        return "status"
    if "network" in name or "/network/" in path:
        return "network"
    if "anime" in name or name in ("canon", "filler", "mixed"):
        return "anime"
    if "resolution" in name or "banner" in name or re.match(r"^(4k|1080|720|576|480|dv|hdr)", name):
        return "resolution"
    return layer.get("name") or "overlay"


def _animetafill_preview_layer(options, config):
    if not config or not config.get("enabled") or options["template_type"] not in ("episode_card", "titlecard"):
        return None
    library = str(options.get("library_name") or "").strip().casefold()
    libraries = config.get("target_libraries", config.get("plex_libraries", [])) or []
    if not library or library not in {str(name).strip().casefold() for name in libraries}:
        return None
    category = str(options.get("anime_tag") or "").strip().casefold()
    if category not in ("canon", "filler", "mixed"):
        return None
    aesthetic = config.get("aesthetic") or {}
    label = str((config.get("labels") or {}).get(category) or category.title())
    if aesthetic.get("uppercase"):
        label = label.upper()
    return {
        "name": "anime", "type": "text", "text": label,
        "font_path": aesthetic.get("font") or "Colus-Regular.ttf",
        "font_size": int(aesthetic.get("font_size", 70)),
        "font_color": (config.get("colors") or {}).get(category) or {
            "canon": "#27C24CB3", "filler": "#FF0000B3", "mixed": "#FFA500B3",
        }[category],
        "back_color": aesthetic.get("back_color", "#000000BF"),
        "back_width": int(aesthetic.get("back_width", 300)),
        "back_height": int(aesthetic.get("back_height", 100)),
        "horizontal_align": aesthetic.get("horizontal_align", "left"),
        "vertical_align": aesthetic.get("vertical_align", "top"),
        "horizontal_offset": int(aesthetic.get("horizontal_offset", 0)),
        "vertical_offset": int(aesthetic.get("vertical_offset", 15)),
    }


def build_preview_layers(options, placements, library_rules, overlays_dir, builder, animetafill_config=None):
    template = options["template_type"]
    landscape = template in ("episode_card", "titlecard", "backdrop", "background")
    episode = template in ("episode_card", "titlecard")
    season = template == "season_poster"
    show = template == "show_poster" or season or episode
    runtime = str(options.get("runtime") or "")
    hours = re.search(r"(\d+)\s*h", runtime)
    minutes = re.search(r"(\d+)\s*m", runtime)
    runtime_mins = (int(hours[1]) * 60 if hours else 0) + (int(minutes[1]) if minutes else 0)
    if not hours and not minutes and runtime.isdigit():
        runtime_mins = int(runtime)
    status = str(options.get("status_label") or "").lower().replace(" series", "").strip()
    metadata = {
        "title": "Preview", "media_type": "episode" if episode else "show" if show else "movie",
        "is_episode": episode, "is_season": season,
        "is_landscape": landscape,
        "is_backdrop": template in ("backdrop", "background"),
        "rating": options.get("rating"), "audience_rating": options.get("rating"),
        "runtime_mins": runtime_mins, "status": status,
        "resolution": options.get("resolution"),
        "languages": [code.strip() for code in str(options.get("languages") or "").split(",") if code.strip()],
        "audio_languages": [code.strip() for code in str(options.get("languages") or "").split(",") if code.strip()],
        "network": options.get("network"), "networks": [options["network"]] if options.get("network") else [],
        "content_rating": options.get("age_rating"),
        "audio_codec": options.get("audio_codec"),
        "filepath": str(options.get("video_format") or ""),
        "anime_tag": options.get("anime_tag"),
    }
    if season:
        metadata["season_number"] = 1
    if episode:
        metadata.update({"season_number": 1, "episode_number": 1})
    defaults = {
        "rating": "ratings", "status": "status", "runtime": "runtimes",
        "resolution": "resolution", "languages": "languages", "network": "network",
        "age_rating": options.get("age_rating_source") or "commonsense",
        "audio_codec": "audio_codec", "video_format": "video_format", "anime": "anime",
    }
    rules = copy.deepcopy(library_rules) if library_rules is not None else [
        {"default": default, "template_variables": {"builder_level": "all"}}
        for key, default in defaults.items() if key in placements
    ]
    layers = builder(metadata, rules, Path(overlays_dir), is_landscape=landscape)
    anime_layer = _animetafill_preview_layer(options, animetafill_config)
    if anime_layer:
        layers = [layer for layer in layers if preview_layer_key(layer) != "anime"]
        layers.append(anime_layer)
    counts = Counter(preview_layer_key(layer) for layer in layers)
    result = []
    for original in layers:
        layer = dict(original)
        key = preview_layer_key(layer)
        if key in defaults and key not in placements:
            continue
        layer["preview_key"] = key
        placement = placements.get(key)
        if placement:
            if counts[key] == 1:
                layer["horizontal_offset"] = placement["x"]
                layer["vertical_offset"] = placement["y"]
                layer["horizontal_align"] = placement["align"]
                layer["vertical_align"] = placement["valign"]
            if placement.get("font_size"):
                layer["font_size"] = placement["font_size"]
                if key == "runtime" and int(layer["font_size"]) in (40, 55):
                    layer["font_size"] = 52 if landscape else 50
            if placement.get("font"):
                layer["font_path"] = placement["font"]
            if key == "status" and options.get("status_color"):
                layer["font_color"] = options["status_color"]
        result.append(layer)
    return _position_compound_preview_layers(result, placements, LANDSCAPE_DIM if landscape else PORTRAIT_DIM)