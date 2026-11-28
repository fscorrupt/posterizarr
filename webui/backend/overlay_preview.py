import copy
from datetime import date
import logging
import re
from collections import Counter
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageOps

from overlay_engine import DynamicOverlayCompositor, PORTRAIT_DIM, LANDSCAPE_DIM, get_coordinates
from overlay_resolver import language_base_code, normalize_language_tag

logger = logging.getLogger(__name__)

LEGACY_AUDIENCE_RATING_LAYERS = {
    "rating_high", "rating_mid", "rating_low", "user_rating", "user_rating_black",
}


def _enabled(value):
    return value is True or str(value).strip().lower() == "true"


def apply_asset_creation_overlay(base, template, config, overlay_dir, resolution=None, media_type=None):
    landscape = template in ("episode_card", "titlecard", "backdrop", "background")
    reference = LANDSCAPE_DIM if landscape else PORTRAIT_DIM
    base = ImageOps.fit(base.convert("RGBA"), reference, Image.Resampling.LANCZOS)
    if not config or not _enabled((config.get("OverlayPart") or {}).get("ImageProcessing", "true")):
        return base

    files = config.get("PrerequisitePart") or {}
    show = media_type == "show" or template in ("show_poster", "season_poster", "episode_card", "titlecard")
    if template in ("episode_card", "titlecard"):
        section, overlay, flag, tiers = "TitleCardOverlayPart", files.get("titlecardoverlayfile"), "UseTCResolutionOverlays", ("TC4k", "TC1080p")
    elif template in ("backdrop", "background"):
        overlay = (files.get("showbackgroundoverlayfile") if show else None) or files.get("backgroundoverlayfile")
        section, flag, tiers = "BackgroundOverlayPart", "UseBackgroundResolutionOverlays", ("Background4k", "Background1080p")
    elif template == "season_poster":
        section, overlay, flag, tiers = "SeasonPosterOverlayPart", files.get("seasonoverlayfile"), None, None
    else:
        overlay = (files.get("showoverlayfile") if show else None) or files.get("overlayfile")
        section, flag, tiers = "PosterOverlayPart", "UsePosterResolutionOverlays", ("poster4k", "Poster1080p")
    sample_resolution = str(resolution or "").lower()
    if flag and _enabled(files.get(flag)):
        if "4k" in sample_resolution or "2160" in sample_resolution:
            overlay = files.get(tiers[0]) or overlay
        elif "1080" in sample_resolution:
            overlay = files.get(tiers[1]) or overlay

    part = config.get(section) or {}
    # Posterizarr composes at 2000x3000 / 3840x2160; preview canvases are exactly half that size.
    scale = 0.5
    if _enabled(part.get("AddOverlay")) and overlay:
        overlay_path = Path(overlay_dir) / Path(str(overlay)).name
        if overlay_path.is_file():
            with Image.open(overlay_path) as source:
                layer = source.convert("RGBA")
            layer = layer.resize((max(1, round(layer.width * scale)), max(1, round(layer.height * scale))), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", reference, (0, 0, 0, 0))
            canvas.paste(layer, ((reference[0] - layer.width) // 2, reference[1] - layer.height))
            base = Image.alpha_composite(base, canvas)
        else:
            logger.warning("Preview overlay file '%s' was not found in %s.", overlay_path.name, overlay_dir)

    if _enabled(part.get("AddBorder")):
        try:
            width = round(float(part.get("borderwidth") or 0) * scale)
        except (TypeError, ValueError):
            width = 0
        if width > 0:
            color = str(part.get("bordercolor") or "black")
            try:
                ImageColor.getrgb(color)
            except ValueError:
                color = "black"
            ImageDraw.Draw(base).rectangle((0, 0, reference[0] - 1, reference[1] - 1), outline=color, width=width)
    return base


def _numeric_offset(value):
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if text.endswith("%"):
        return None
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


def _can_pad_compound_group(group):
    for _, layer in group:
        if layer.get("type") == "preview":
            return False
        if _numeric_offset(layer.get("horizontal_offset")) is None or _numeric_offset(layer.get("vertical_offset")) is None:
            return False
        if str(layer.get("scale_width") or "").strip().endswith("%") or str(layer.get("scale_height") or "").strip().endswith("%"):
            return False
    return True


def _render_padded_compound_group(group, canvas_box, pad_x, pad_y):
    work_box = (canvas_box[0] + 2 * pad_x, canvas_box[1] + 2 * pad_y)
    rendered = []
    for index, layer in group:
        padded_layer = dict(layer)
        h_align = (padded_layer.get("horizontal_align") or "left").lower()
        v_align = (padded_layer.get("vertical_align") or "top").lower()
        if pad_x and h_align != "center":
            padded_layer["horizontal_offset"] = _numeric_offset(padded_layer.get("horizontal_offset")) + pad_x
        if pad_y and v_align != "center":
            padded_layer["vertical_offset"] = _numeric_offset(padded_layer.get("vertical_offset")) + pad_y
        image = DynamicOverlayCompositor._render_layer(padded_layer, work_box, abort_on_missing=True)
        work_bounds = image.getbbox() if image is not None else None
        if work_bounds:
            canvas_bounds = (
                work_bounds[0] - pad_x,
                work_bounds[1] - pad_y,
                work_bounds[2] - pad_x,
                work_bounds[3] - pad_y,
            )
            rendered.append((index, layer, image.crop(work_bounds), canvas_bounds))
    return rendered


def _position_compound_preview_layers(layers, placements, canvas_box):
    canvas_w, canvas_h = canvas_box
    groups = {}
    for index, layer in enumerate(layers):
        groups.setdefault(layer["preview_key"], []).append((index, layer))
    result = list(layers)
    for key, group in groups.items():
        placement = placements.get(key)
        if not placement or len(group) < 2:
            continue
        rendered = []
        clipped_x = False
        clipped_y = False
        for index, layer in group:
            image = DynamicOverlayCompositor._render_layer(layer, canvas_box, abort_on_missing=True)
            bounds = image.getbbox() if image is not None else None
            if bounds:
                rendered.append((index, layer, image.crop(bounds), bounds))
                if bounds[0] == 0 or bounds[2] == canvas_w:
                    clipped_x = True
                if bounds[1] == 0 or bounds[3] == canvas_h:
                    clipped_y = True
            else:
                clipped_x = True
                clipped_y = True
        if (clipped_x or clipped_y) and _can_pad_compound_group(group):
            max_abs_x = max(abs(_numeric_offset(layer.get("horizontal_offset")) or 0) for _, layer in group)
            max_abs_y = max(abs(_numeric_offset(layer.get("vertical_offset")) or 0) for _, layer in group)
            pad_x = min(max(canvas_w, max_abs_x + 600), 4000) if clipped_x else 0
            pad_y = min(max(canvas_h // 2, max_abs_y + 400), 3000) if clipped_y else 0
            padded_rendered = _render_padded_compound_group(group, canvas_box, pad_x, pad_y)
            if padded_rendered:
                rendered = padded_rendered
        if not rendered:
            continue
        left = min(part[3][0] for part in rendered)
        top = min(part[3][1] for part in rendered)
        right = max(part[3][2] for part in rendered)
        bottom = max(part[3][3] for part in rendered)
        size = (right - left, bottom - top)
        # The recipe layers render at their exact coordinates; drags shift relative to their bounding box.
        original_left, original_top = left, top
        target_left, target_top = get_coordinates(
            canvas_box, size,
            horizontal_align=placement["align"], horizontal_offset=placement["x"],
            vertical_align=placement["valign"], vertical_offset=placement["y"],
        )
        shift_x = target_left - original_left
        shift_y = target_top - original_top
        for index, layer, cropped_img, bounds in rendered:
            result[index] = {
                "name": layer.get("name"), "preview_key": key, "type": "preview",
                "image_element": cropped_img,
                "horizontal_offset": bounds[0] + shift_x,
                "vertical_offset": bounds[1] + shift_y,
            }
    return result


def preview_layer_key(layer):
    name = str(layer.get("name") or "").lower()
    path = str(layer.get("image_path") or "").lower().replace("\\", "/")
    if name.startswith("streaming_") or "/streaming/" in path:
        return "streaming"
    if "mediastinger" in name or "mediastinger" in path:
        return "mediastinger"
    if "/ribbon/" in path or name.startswith("ribbon"):
        return "ribbon"
    if name.startswith("subtitle_languages_"):
        return "subtitle_languages"
    if name.startswith("aspect_"):
        return "aspect"
    if "studio" in name or "/studio/" in path:
        return "studio"
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
    runtime = str(options.get("runtime") or "").strip()[:64]
    hours = re.search(r"(?<!\d)(\d{1,4})[ \t]{0,3}h", runtime, re.IGNORECASE)
    minutes = re.search(r"(?<!\d)(\d{1,5})[ \t]{0,3}m", runtime, re.IGNORECASE)
    runtime_mins = (int(hours[1]) * 60 if hours else 0) + (int(minutes[1]) if minutes else 0)
    if not hours and not minutes and runtime.isdigit():
        runtime_mins = int(runtime)
    status = str(options.get("status_label") or "").lower().replace(" series", "").strip()
    is_backdrop = template in ("backdrop", "background")
    is_aggregated_parent_preview = bool(options.get("languages") and not episode and (show or is_backdrop))
    try:
        imdb_sample = f"{float(options.get('rating')):.1f}"
    except (TypeError, ValueError):
        imdb_sample = "8.4"
    ribbon_opt = options.get("ribbon", "imdb")
    ribbon_preview_key = str(ribbon_opt).strip().lower() if ribbon_opt else ""
    mediastinger_enabled = options.get("mediastinger", True) not in ("", False, None) if "mediastinger" in options else True
    metadata = {
        "title": "Preview", "media_type": "episode" if episode else options.get("media_type") or ("show" if show else "movie"),
        "is_episode": episode, "is_season": season,
        "is_landscape": landscape,
        "is_backdrop": is_backdrop,
        "_aggregated_episode_streams": is_aggregated_parent_preview,
        "rating": options.get("rating"), "audience_rating": options.get("rating"),
        "multi_ratings": {
            "imdb": imdb_sample, "tomatoes": "93", "tomatoesaudience": "88", "tmdb": "8.1",
            "trakt": "85", "letterboxd": "4.1", "metacritic": "78",
            "simkl": "8.3", "mal": "8.6",
        } if options.get("rating") else None,
        "runtime_mins": runtime_mins, "status": status,
        "last_episode_air_date": date.today().isoformat() if status == "airing" else None,
        "resolution": options.get("resolution"),
        "languages": [language_base_code(code) or code.strip().lower() for code in str(options.get("languages") or "").split(",") if code.strip()],
        "audio_languages": [language_base_code(code) or code.strip().lower() for code in str(options.get("languages") or "").split(",") if code.strip()],
        "audio_language_tags": [tag for tag in (normalize_language_tag(code) for code in str(options.get("languages") or "").split(",") if code.strip()) if tag],
        "subtitle_languages": [language_base_code(code) or code.strip().lower() for code in str(options.get("subtitle_languages") or "").split(",") if code.strip()],
        "subtitle_language_tags": [tag for tag in (normalize_language_tag(code) for code in str(options.get("subtitle_languages") or "").split(",") if code.strip()) if tag],
        "aspect_ratio": options.get("aspect_ratio"),
        "studio": options.get("studio"),
        "network": options.get("network"), "networks": [options["network"]] if options.get("network") else [],
        "content_rating": options.get("age_rating"),
        "audio_codec": options.get("audio_codec"),
        "filepath": str(options.get("video_format") or ""),
        "anime_tag": options.get("anime_tag"),
        "tmdb_keywords": ["aftercreditsstinger", "duringcreditsstinger"] if (not show and mediastinger_enabled) else [],
        "_preview_ribbon_key": ribbon_preview_key,
    }
    if options.get("streaming"):
        from overlay_sync_service import STREAMING_PROVIDER_BADGES
        requested = {value.strip().lower() for value in str(options["streaming"]).split(",")}
        providers = [{"provider_id": min(identifiers)} for key, _, identifiers in STREAMING_PROVIDER_BADGES if key in requested]
        region = str((options.get("streaming_options") or {}).get("region") or "US").upper()
        metadata["streaming_providers"] = {region: {availability: providers for availability in ("flatrate", "free", "ads", "rent", "buy")}}
    if season:
        metadata["season_number"] = 1
    if episode:
        metadata.update({"season_number": 1, "episode_number": 1})
    defaults = {
        "rating": "single_rating" if options.get("rating_mode") == "single" else "ratings", "status": "status", "runtime": "runtimes",
        "resolution": "resolution", "languages": "languages", "network": "network",
        "age_rating": options.get("age_rating_source") or "commonsense",
        "audio_codec": "audio_codec", "video_format": "video_format", "anime": "anime",
        "subtitle_languages": "languages", "aspect": "aspect", "studio": "studio",
        "streaming": "streaming", "ribbon": "ribbon", "mediastinger": "mediastinger",
    }
    rules = copy.deepcopy(library_rules) if library_rules is not None else [
        {"default": default, "template_variables": {"builder_level": "all", **({"use_subtitles": True} if key == "subtitle_languages" else {})}}
        for key, default in defaults.items() if key in placements
    ]
    if options.get("rating_mode") in ("single", "providers") and "rating" in placements:
        for rule in rules:
            if isinstance(rule, dict) and rule.get("default") in ("ratings", "rating", "single_rating"):
                rule["default"] = defaults["rating"]
    if "resolution" in placements and options.get("resolution_mode"):
        resolution_mode = "corner_badge" if options["resolution_mode"] == "badge" else options["resolution_mode"]
        for rule in rules:
            if isinstance(rule, dict) and any(name in str(rule.get("file") or "") for name in ("overlays_movies.yml", "overlays_tv.yml")):
                variables = rule.setdefault("template_variables", {})
                for key in ("4K_banner", "1080p_banner", "720p_banner", "4K", "1080p", "720p"):
                    variables[key] = False
        resolution_rules = [rule for rule in rules if isinstance(rule, dict) and rule.get("default") == "resolution"]
        if not resolution_rules and library_rules is None:
            resolution_rules = [{"default": "resolution", "template_variables": {"builder_level": "all"}}]
            rules.extend(resolution_rules)
        for rule in resolution_rules:
            rule.setdefault("template_variables", {}).update({"mode": resolution_mode, "4K_banner": resolution_mode == "banner"})
            variables = rule["template_variables"]
            for key in ("back_color", "back_radius", "back_width", "back_height"):
                value = options.get("resolution_" + key)
                if value is not None:
                    variables[key] = value
    for key in ("subtitle_languages", "aspect", "studio", "streaming", "audio_codec", "ribbon", "mediastinger"):
        if key not in placements:
            continue
        matching = any(
            isinstance(rule, dict) and rule.get("default") == defaults[key]
            and (key != "subtitle_languages" or str((rule.get("template_variables") or {}).get("use_subtitles", False)).lower() in ("true", "1"))
            for rule in rules
        )
        if not matching and library_rules is None:
            rules.append({"default": defaults[key], "template_variables": {"builder_level": "all", **({"use_subtitles": True} if key == "subtitle_languages" else {})}})
    rating_options = options.get("rating_options") or {}
    allowed_rating_options = {"sources", "theme", "orientation", "contrast_box", "spacing", "score_size_mode", "score_width", "score_position", "score_alignment"}
    for rule in rules:
        default_name = str(rule.get("default", "")).lower() if isinstance(rule, dict) else ""
        if isinstance(rule, dict) and options.get("rating_mode") in ("single", "providers") and any(name in str(rule.get("file") or "") for name in ("overlays_movies.yml", "overlays_tv.yml")):
            rule.setdefault("template_variables", {})["audience_rating"] = False
        if default_name in ("runtimes", "runtime"):
            variables = rule.setdefault("template_variables", {})
            if options.get("runtime_prefix") is not None:
                variables["text"] = options["runtime_prefix"]
            if options.get("runtime_format"):
                variables["format"] = options["runtime_format"]
        if default_name == "audio_codec" and options.get("audio_codec_style"):
            rule.setdefault("template_variables", {})["style"] = options["audio_codec_style"]
        if default_name == "languages":
            variables = rule.setdefault("template_variables", {})
            subtitle = str(variables.get("use_subtitles", False)).lower() in ("true", "1")
            selected_langs = options.get("subtitle_languages" if subtitle else "languages")
            if selected_langs:
                parsed_langs = [
                    normalize_language_tag(code) or code.strip().lower()
                    for code in str(selected_langs).split(",")
                    if code.strip()
                ]
                if parsed_langs:
                    variables["languages"] = parsed_langs
            selected_style = options.get("subtitle_style" if subtitle else "language_style")
            if selected_style in ("round", "square", "half"):
                variables["style"] = selected_style
            if not subtitle and options.get("language_limit") is not None:
                variables["overlay_limit"] = int(options["language_limit"])
            label_option = "subtitle_labels" if subtitle else "language_labels"
            if options.get(label_option) is not None:
                variables["hide_text"] = not options[label_option]
                variables["final_name"] = "text(<<final_text>>)"
                variables["font_color"] = "#FFFFFF"
        if isinstance(rule, dict) and str(rule.get("default", "")).lower() in ("ratings", "rating"):
            rating_vars = rule.setdefault("template_variables", {})
            rating_vars.update({key: value for key, value in rating_options.items() if key in allowed_rating_options})
            rating_placement = placements.get("rating")
            if rating_placement:
                rating_vars["horizontal_align"] = rating_placement["align"]
                rating_vars["horizontal_position"] = rating_placement["align"]
                rating_vars["vertical_align"] = rating_placement["valign"]
                rating_vars["vertical_position"] = rating_placement["valign"]
                rating_vars["horizontal_offset"] = rating_placement["x"]
                rating_vars["vertical_offset"] = rating_placement["y"]
                if rating_placement.get("font_size"):
                    rating_vars["font_size"] = int(rating_placement["font_size"])
                if rating_placement.get("font"):
                    rating_vars["font"] = rating_placement["font"]
        if isinstance(rule, dict) and str(rule.get("default", "")).lower() == "streaming":
            allowed_streaming_options = {"region", "availability_types", "style", "overlay_limit", "spacing", "orientation"}
            rule.setdefault("template_variables", {}).update({key: value for key, value in (options.get("streaming_options") or {}).items() if key in allowed_streaming_options})
        if isinstance(rule, dict) and default_name == "ribbon":
            if options.get("ribbon_style") in ("yellow", "red", "black", "gray"):
                rule.setdefault("template_variables", {})["style"] = options["ribbon_style"]
        if isinstance(rule, dict) and default_name == "mediastinger":
            variables = rule.setdefault("template_variables", {})
            for opt_key, var_key in (
                ("mediastinger_back_color", "back_color"),
                ("mediastinger_back_width", "back_width"),
                ("mediastinger_back_height", "back_height"),
            ):
                if options.get(opt_key) is not None:
                    variables[var_key] = options[opt_key]
    layers = builder(metadata, rules, Path(overlays_dir), is_landscape=landscape)
    if options.get("rating_mode") == "providers":
        layers = [
            layer for layer in layers
            if str(layer.get("name") or "").lower() not in LEGACY_AUDIENCE_RATING_LAYERS
        ]
    elif any(str(layer.get("name") or "").lower() in ("user_rating", "user_rating_black") for layer in layers):
        layers = [layer for layer in layers if str(layer.get("name") or "").lower() != "single_rating"]
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
            if key not in ("ribbon", "mediastinger") or library_rules is None or key in options:
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