import copy
import re
from pathlib import Path


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


def build_preview_layers(options, placements, library_rules, overlays_dir, builder):
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
    anchors = {}
    result = []
    for original in layers:
        layer = dict(original)
        key = preview_layer_key(layer)
        if key in defaults and key not in placements:
            continue
        layer["preview_key"] = key
        placement = placements.get(key)
        if placement:
            anchor = anchors.setdefault(key, {
                "x": layer.get("horizontal_offset", 0), "y": layer.get("vertical_offset", 0),
            })
            for axis, field in (("x", "horizontal_offset"), ("y", "vertical_offset")):
                try:
                    layer[field] = float(layer.get(field, 0)) + float(placement[axis]) - float(anchor[axis])
                except (ValueError, TypeError):
                    pass
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
    return result