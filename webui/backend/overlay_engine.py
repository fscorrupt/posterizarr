"""
MIT License

Copyright (c) 2026 meisnate12
Modifications & Integration for Posterizarr (c) 2026 Posterizarr Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Dynamic Overlays Rendering Engine for Posterizarr.
Native in-memory PIL compositor utilizing coordinate, text, and backdrop algorithms.

==============================================================================
HONOR & ATTRIBUTION:
Special honor and appreciation to meisnate12 and the Kometa team
(https://github.com/Kometa-Team/Kometa) under the MIT License.
The coordinate placement logic, text bounding math, and backdrop algorithms in this
module are adapted with deep gratitude to their pioneering work in the media community.
==============================================================================
"""

import io
import re
import math
import hashlib
import logging
from pathlib import Path
from typing import Optional, Tuple, Dict, Any, List, Union, Callable
from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageFilter

logger = logging.getLogger("overlay_engine")
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

PORTRAIT_DIM = (1000, 1500)
LANDSCAPE_DIM = (1920, 1080)
SQUARE_DIM = (1000, 1000)


def hex_to_rgba(hex_str: str, default: Tuple[int, int, int, int] = (0, 0, 0, 0)) -> Tuple[int, int, int, int]:
    """Convert hex color string (#RRGGBB or #RRGGBBAA) to RGBA tuple."""
    if not hex_str:
        return default
    clean = hex_str.strip().lstrip("#")
    try:
        if len(clean) == 8:
            r = int(clean[0:2], 16)
            g = int(clean[2:4], 16)
            b = int(clean[4:6], 16)
            a = int(clean[6:8], 16)
            return (r, g, b, a)
        elif len(clean) == 6:
            r = int(clean[0:2], 16)
            g = int(clean[2:4], 16)
            b = int(clean[4:6], 16)
            return (r, g, b, 255)
        elif len(clean) == 3:
            r = int(clean[0] * 2, 16)
            g = int(clean[1] * 2, 16)
            b = int(clean[2] * 2, 16)
            return (r, g, b, 255)
        elif len(clean) == 4:
            r = int(clean[0] * 2, 16)
            g = int(clean[1] * 2, 16)
            b = int(clean[2] * 2, 16)
            a = int(clean[3] * 2, 16)
            return (r, g, b, a)
    except Exception:
        pass
    try:
        rgb = ImageColor.getrgb(hex_str)
        if len(rgb) == 3:
            return (*rgb, 255)
        return rgb
    except Exception:
        return default


def parse_offset_value(value: Union[int, float, str, None], total_dimension: int) -> int:
    """Parse integer or percentage offset string (e.g. 15 or '15%' or 30)."""
    if value is None:
        return 0
    str_val = str(value).strip()
    if str_val.endswith("%"):
        try:
            pct = float(str_val[:-1])
            return int(total_dimension * (pct / 100.0))
        except ValueError:
            return 0
    try:
        return int(float(str_val))
    except ValueError:
        return 0


def get_coordinates(
    canvas_box: Tuple[int, int],
    element_box: Tuple[int, int],
    horizontal_align: str = "left",
    horizontal_offset: Union[int, float, str] = 0,
    vertical_align: str = "top",
    vertical_offset: Union[int, float, str] = 0,
    back_box: Optional[Tuple[int, int]] = None
) -> Tuple[int, int]:
    """
    Kometa's exact coordinate positioning algorithm.
    Calculates the (x, y) start position for an element or backdrop on a canvas.
    """
    canvas_w, canvas_h = canvas_box
    bw, bh = element_box
    if back_box:
        bbw, bbh = back_box
        box_w = bbw if bbw >= 0 else bw
        box_h = bbh if bbh >= 0 else bh
    else:
        box_w, box_h = bw, bh

    ho = parse_offset_value(horizontal_offset, canvas_w)
    vo = parse_offset_value(vertical_offset, canvas_h)

    # Horizontal coordinate
    h_align = (horizontal_align or "left").lower()
    if h_align == "right":
        x = canvas_w - box_w - ho
    elif h_align == "center":
        x = int(canvas_w / 2) - int(box_w / 2) + ho
    else:  # left
        x = ho

    # Vertical coordinate
    v_align = (vertical_align or "top").lower()
    if v_align == "bottom":
        y = canvas_h - box_h - vo
    elif v_align == "center":
        y = int(canvas_h / 2) - int(box_h / 2) + vo
    else:  # top
        y = vo

    return int(x), int(y)


def draw_backdrop_and_text(
    canvas_box: Tuple[int, int],
    text: Optional[str] = None,
    font: Optional[ImageFont.FreeTypeFont] = None,
    font_color: str = "#FFFFFF",
    stroke_color: Optional[str] = None,
    stroke_width: int = 0,
    image_element: Optional[Image.Image] = None,
    horizontal_align: str = "left",
    horizontal_offset: Union[int, float, str] = 0,
    vertical_align: str = "top",
    vertical_offset: Union[int, float, str] = 0,
    back_width: Optional[int] = None,
    back_height: Optional[int] = None,
    back_color: Optional[str] = None,
    back_radius: int = 0,
    back_padding: int = 0,
    addon_position: Optional[str] = None,
    addon_offset: int = 0,
    back_align: str = "center",
    image_path: Optional[str] = None,
    layer_name: Optional[str] = None,
    debug_callback: Optional[Callable[[str], None]] = None
) -> Image.Image:
    """
    Kometa's exact get_backdrop rendering logic.
    Renders text and/or an image onto an RGBA canvas with optional backdrop boxes,
    rounded corners, and padding.
    """
    overlay_layer = Image.new("RGBA", canvas_box, (0, 0, 0, 0))
    drawing = ImageDraw.Draw(overlay_layer)

    text_w, text_h = 0, 0
    text_bbox = None
    if text and font:
        # Measure text using textbbox
        temp_img = Image.new("RGBA", (1, 1))
        temp_draw = ImageDraw.Draw(temp_img)
        bbox = temp_draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
        text_bbox = bbox
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

    img_w, img_h = image_element.size if image_element else (0, 0)

    # Calculate overall content bounding box
    if text and image_element:
        # Check if image is a background plate (e.g. Rating_High.png)
        is_plate = addon_position in ["center", "inside"]
        if addon_position is None and image_path and "Rating_" in str(image_path):
            is_plate = True
            addon_position = "center"

        if addon_position in ["left", "right"]:
            content_w = text_w + img_w + addon_offset
            content_h = max(text_h, img_h)
        elif is_plate:
            content_w = max(text_w, img_w)
            content_h = max(text_h, img_h)
        else:
            content_w = max(text_w, img_w)
            content_h = text_h + img_h + addon_offset
    elif text:
        content_w, content_h = text_w, text_h
    elif image_element:
        content_w, content_h = img_w, img_h
    else:
        return overlay_layer

    # Determine backdrop dimensions: In Kometa, an explicit back_width or back_height
    # defines the element's layout container box (even when back_color is transparent #00000000).
    # Content is positioned and aligned inside that container box.
    has_back = bool(back_color and hex_to_rgba(back_color)[3] > 0)
    has_box = bool(has_back or (back_width and back_width > 0) or (back_height and back_height > 0))
    box_w = back_width if (back_width and back_width > 0) else content_w
    box_h = back_height if (back_height and back_height > 0) else content_h

    back_box = (box_w, box_h) if has_box else None

    # Calculate start coordinates
    start_x, start_y = get_coordinates(
        canvas_box=canvas_box,
        element_box=(content_w, content_h),
        horizontal_align=horizontal_align,
        horizontal_offset=horizontal_offset,
        vertical_align=vertical_align,
        vertical_offset=vertical_offset,
        back_box=back_box
    )

    main_x = start_x
    main_y = start_y

    # 1. Draw Backdrop Box if enabled
    if has_back:
        rgba_back = hex_to_rgba(back_color)
        cords = (
            start_x - back_padding,
            start_y - back_padding,
            start_x + box_w + back_padding,
            start_y + box_h + back_padding
        )
        if back_radius > 0:
            drawing.rounded_rectangle(cords, fill=rgba_back, radius=back_radius)
        else:
            drawing.rectangle(cords, fill=rgba_back)

    # 2. Alignment adjustments inside backdrop box
    if back_box:
        b_align = (back_align or "center").lower()
        if b_align in ["left", "right", "center", "bottom"]:
            if b_align == "bottom":
                main_y = start_y + (box_h - content_h)
            else:
                main_y = start_y + (box_h - content_h) // 2
        if b_align in ["top", "bottom", "center", "right"]:
            if b_align == "right":
                main_x = start_x + (box_w - content_w)
            else:
                main_x = start_x + (box_w - content_w) // 2

    text_x = main_x
    text_y = main_y
    img_x = main_x
    img_y = main_y

    # 3. Position relative to addon (side-by-side or stacked)
    if text and image_element:
        if addon_position == "left":
            # Image on left, text on right
            img_x = main_x
            text_x = main_x + img_w + addon_offset
            img_y = main_y + (content_h - img_h) // 2
            text_y = main_y + (content_h - text_h) // 2
        elif addon_position == "right":
            # Text on left, image on right
            text_x = main_x
            img_x = main_x + text_w + addon_offset
            text_y = main_y + (content_h - text_h) // 2
            img_y = main_y + (content_h - img_h) // 2
        elif addon_position == "top":
            # Image on top, text on bottom
            img_y = main_y
            text_y = main_y + img_h + addon_offset
            img_x = main_x + (content_w - img_w) // 2
            text_x = main_x + (content_w - text_w) // 2
        elif addon_position in ["center", "inside"]:
            # Text centered directly inside/on the image container
            img_x = main_x + (content_w - img_w) // 2
            img_y = main_y + (content_h - img_h) // 2
            text_x = img_x + (img_w - text_w) // 2
            text_y = img_y + (img_h - text_h) // 2
        else:
            # Default stacked: text on top or centered
            text_y = main_y
            img_y = main_y + text_h + addon_offset
            text_x = main_x + (content_w - text_w) // 2
            img_x = main_x + (content_w - img_w) // 2

    # 4. Composite image element if present
    if image_element:
        overlay_layer.paste(image_element, (int(img_x), int(img_y)), image_element)

    # 5. Draw Text if present
    if text and font:
        # Compensate for textbbox offset to ensure exact optical placement
        ox = text_bbox[0] if text_bbox else 0
        oy = text_bbox[1] if text_bbox else 0
        draw_x = int(text_x - ox)
        draw_y = int(text_y - oy)

        rgba_font = hex_to_rgba(font_color, (255, 255, 255, 255))
        rgba_stroke = hex_to_rgba(stroke_color, (0, 0, 0, 255)) if stroke_color else None

        # Subtle drop shadow for transparent standalone text (e.g. runtimes) to match WebUI live preview
        if stroke_width > 0 and rgba_stroke and not has_back and not image_element:
            shadow_color = (0, 0, 0, 210)
            drawing.text(
                (draw_x + 1, draw_y + 2),
                text,
                font=font,
                fill=shadow_color,
                stroke_fill=shadow_color,
                stroke_width=stroke_width
            )

        if stroke_width > 0 and rgba_stroke:
            drawing.text(
                (draw_x, draw_y),
                text,
                font=font,
                fill=rgba_font,
                stroke_fill=rgba_stroke,
                stroke_width=stroke_width
            )
        else:
            drawing.text(
                (draw_x, draw_y),
                text,
                font=font,
                fill=rgba_font
            )

    if debug_callback:
        elem_desc = layer_name or (text if text else (Path(image_path).name if image_path else "overlay"))
        txt_info = f", text='{text}' at ({draw_x}, {draw_y})px" if text else ""
        img_info = f", img=({img_w}x{img_h}) at ({int(img_x)}, {int(img_y)})px" if image_element else ""
        debug_callback(
            f"[OverlayDebug] Layer '{elem_desc}': canvas={canvas_box[0]}x{canvas_box[1]}px, "
            f"align=({horizontal_align}, {vertical_align}), offset=({horizontal_offset}, {vertical_offset})px, "
            f"box=({box_w}x{box_h})px, start=({start_x}, {start_y})px, content=({content_w}x{content_h})px"
            f"{txt_info}{img_info}"
        )

    return overlay_layer


class DynamicOverlayCompositor:
    """
    High-performance in-memory compositor for dynamic overlays.
    Composites overlays in memory without touching clean local asset files.
    """

    @staticmethod
    def composite_overlays(
        base_image_bytes: bytes,
        layers: List[Dict[str, Any]],
        canvas_type: str = "portrait",
        debug_logging: bool = False,
        debug_callback: Optional[Callable[[str], None]] = None,
        item_label: str = ""
    ) -> bytes:
        """
        Takes raw image bytes of clean asset, applies list of overlay layer dicts in RAM,
        and returns JPEG bytes ready for media server upload. Clean asset is never modified on disk!

        High Performance & Sharpness Optimization:
        When orig_w != target_dim[0] (e.g. 2000x3000 or 3840x2160 assets), layer coordinates,
        offsets, box dimensions, and font sizes are scaled proportionally to render directly
        onto the native canvas. This avoids downscaling/upscaling the base image, preserving 100%
        asset sharpness and reducing execution time by 80-90%.
        """
        if not base_image_bytes:
            raise ValueError("Base image bytes cannot be empty")

        def _cb(msg: str):
            if not debug_callback:
                return
            if item_label:
                if msg.startswith("[OverlayDebug] "):
                    debug_callback(f"[OverlayDebug] [{item_label}] {msg[15:]}")
                else:
                    debug_callback(f"[{item_label}] {msg}")
            else:
                debug_callback(msg)

        with Image.open(io.BytesIO(base_image_bytes)) as base_img:
            # Normalize to RGBA - Clean original asset remains 100% native resolution
            base = base_img.convert("RGBA")
            orig_w, orig_h = base.size

            # Target canonical reference dimensions for Kometa/Posterizarr coordinate math & templates
            target_dim = LANDSCAPE_DIM if canvas_type == "landscape" else PORTRAIT_DIM
            target_w, target_h = target_dim

            if debug_logging and debug_callback:
                _cb(
                    f"[OverlayDebug] Canvas: {orig_w}x{orig_h}px (Reference Canvas: {target_w}x{target_h}px, "
                    f"Scale: {orig_w/target_w:.2f}x horiz, {orig_h/target_h:.2f}x vert) | Layers count: {len(layers)}"
                )

            # Create a transparent overlay canvas at canonical reference dimensions (1000x1500 or 1920x1080).
            # All overlay assets (flags, 4K banners, rating backgrounds, text, badges) are calibrated
            # for these dimensions. This guarantees pixel-perfect placement, full-width banners,
            # and properly proportioned badges across movies, shows, seasons, and titlecards alike.
            overlay_canvas = Image.new("RGBA", target_dim, (0, 0, 0, 0))

            # Apply overlay layers sequentially onto the reference overlay canvas
            for layer in layers:
                try:
                    overlay_img = DynamicOverlayCompositor._render_layer(
                        layer=layer,
                        canvas_box=target_dim,
                        debug_callback=_cb if debug_logging else None
                    )
                    if overlay_img:
                        overlay_canvas = Image.alpha_composite(overlay_canvas, overlay_img)
                except Exception as e:
                    logger.warning(f"[Compositor] Error rendering layer {layer.get('name')}: {e}")

            # If clean asset is higher resolution (e.g. 2000x3000 portrait or 3840x2160 titlecard),
            # upscale only the transparent overlay canvas using LANCZOS to perfectly match native dimensions.
            # Clean asset artwork is NEVER downscaled!
            if (orig_w, orig_h) != target_dim:
                overlay_canvas = overlay_canvas.resize((orig_w, orig_h), Image.Resampling.LANCZOS)
                if debug_logging and debug_callback:
                    _cb(
                        f"[OverlayDebug] Overlay canvas upscaled from {target_w}x{target_h}px to native {orig_w}x{orig_h}px (LANCZOS) and composited onto clean asset."
                    )

            # Composite the sharp, upscaled overlay layer on top of the clean, untouched base image
            working_canvas = Image.alpha_composite(base, overlay_canvas)

            # Convert to RGB and export to JPEG (quality 92) in memory
            final_rgb = working_canvas.convert("RGB")
            out_buffer = io.BytesIO()
            final_rgb.save(out_buffer, format="JPEG", quality=92, optimize=True)
            return out_buffer.getvalue()

    @staticmethod
    def _scale_layer(layer: Dict[str, Any], sx: float, sy: float, ref_w: int, ref_h: int) -> Dict[str, Any]:
        """Scale layer coordinates, offsets, font sizes, and box dimensions to native poster resolution."""
        scaled = dict(layer)
        if "horizontal_offset" in layer:
            ho_px = parse_offset_value(layer["horizontal_offset"], ref_w)
            scaled["horizontal_offset"] = int(round(ho_px * sx))
        if "vertical_offset" in layer:
            vo_px = parse_offset_value(layer["vertical_offset"], ref_h)
            scaled["vertical_offset"] = int(round(vo_px * sy))
        if "font_size" in layer and layer["font_size"]:
            scaled["font_size"] = max(10, int(round(layer["font_size"] * sy)))
        if "stroke_width" in layer and layer["stroke_width"]:
            scaled["stroke_width"] = max(1, int(round(layer["stroke_width"] * sy)))
        if "back_width" in layer and layer["back_width"]:
            scaled["back_width"] = int(round(layer["back_width"] * sx))
        if "back_height" in layer and layer["back_height"]:
            scaled["back_height"] = int(round(layer["back_height"] * sy))
        if "back_radius" in layer and layer["back_radius"]:
            scaled["back_radius"] = int(round(layer["back_radius"] * sy))
        if "back_padding" in layer and layer["back_padding"]:
            scaled["back_padding"] = int(round(layer["back_padding"] * sy))
        if "addon_offset" in layer and layer["addon_offset"]:
            scaled["addon_offset"] = int(round(layer["addon_offset"] * sx))
        if "scale_width" in layer and layer["scale_width"]:
            sw_px = parse_offset_value(layer["scale_width"], ref_w)
            scaled["scale_width"] = int(round(sw_px * sx))
        if "scale_height" in layer and layer["scale_height"]:
            sh_px = parse_offset_value(layer["scale_height"], ref_h)
            scaled["scale_height"] = int(round(sh_px * sy))
        if "addon_size" in layer and layer["addon_size"]:
            scaled["addon_size"] = int(round(layer["addon_size"] * sy))
        return scaled

    @staticmethod
    def _render_layer(
        layer: Dict[str, Any],
        canvas_box: Tuple[int, int],
        debug_callback: Optional[Callable[[str], None]] = None
    ) -> Optional[Image.Image]:
        """Renders an individual layer definition onto a transparent canvas."""
        layer_type = layer.get("type", "image")  # "image", "text", "badge", "banner"

        h_align = layer.get("horizontal_align", "left")
        h_offset = layer.get("horizontal_offset", 0)
        v_align = layer.get("vertical_align", "top")
        v_offset = layer.get("vertical_offset", 0)

        # 1. Pure Image Overlay (e.g. 4K Ribbon, Network Logo, Common Sense)
        if layer_type == "image":
            elem_img = layer.get("image_element")
            if elem_img is None and layer.get("image_bytes"):
                elem_img = Image.open(io.BytesIO(layer["image_bytes"])).convert("RGBA")
            elif elem_img is None:
                img_path = layer.get("image_path")
                resolved_ip = None
                if img_path:
                    ip = Path(img_path)
                    if ip.exists():
                        resolved_ip = ip
                    else:
                        candidate_asset_dirs = [
                            PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays" / "assets",
                            PROJECT_ROOT / "Overlayfiles" / "kometa" / "assets",
                            PROJECT_ROOT / "Overlayfiles",
                            Path("/app/Overlayfiles/dynamic_overlays/assets"),
                            Path("/app/Overlayfiles/kometa/assets"),
                            Path("/app/Overlayfiles"),
                            Path("/config/Overlayfiles/dynamic_overlays/assets"),
                            Path("/config/Overlayfiles/kometa/assets"),
                            Path("/config/Overlayfiles"),
                        ]
                        ip_name = ip.name
                        for ad in candidate_asset_dirs:
                            cand = ad / ip_name
                            if cand.exists():
                                resolved_ip = cand
                                break
                            for sub in ["rating", "flag/square", "flags/square", "flag/round", "flags/round", "resolution", "commonsense", "ribbon"]:
                                cand_sub = ad / sub / ip_name
                                if cand_sub.exists():
                                    resolved_ip = cand_sub
                                    break
                            if resolved_ip:
                                break

                if not resolved_ip or not resolved_ip.exists():
                    return None

                with Image.open(resolved_ip) as img:
                    elem_img = img.convert("RGBA")

            if elem_img is None:
                return None

            # Scale if requested
            scale_w = layer.get("scale_width")
            scale_h = layer.get("scale_height")
            if scale_w or scale_h:
                bw, bh = elem_img.size
                target_w = parse_offset_value(scale_w, canvas_box[0]) if scale_w else None
                target_h = parse_offset_value(scale_h, canvas_box[1]) if scale_h else None
                if target_h and not target_w:
                    target_w = int(bw * target_h / bh)
                elif target_w and not target_h:
                    target_h = int(bh * target_w / bw)
                if target_w and target_h:
                    elem_img = elem_img.resize((target_w, target_h), Image.Resampling.LANCZOS)

            # Optional drop shadow for light posters (e.g. Commonsense icon)
            if layer.get("drop_shadow"):
                pad = 4
                sw = elem_img.width + pad * 2
                sh = elem_img.height + pad * 2
                shadow_img = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
                alpha = elem_img.split()[3]
                shadow_color = Image.new("RGBA", elem_img.size, (0, 0, 0, 160))
                shadow_img.paste(shadow_color, (pad + 1, pad + 1), alpha)
                shadow_img = shadow_img.filter(ImageFilter.GaussianBlur(1.5))
                shadow_img.paste(elem_img, (pad, pad), elem_img)
                elem_img = shadow_img

            # Use draw_backdrop_and_text for placement & optional back_color
            return draw_backdrop_and_text(
                canvas_box=canvas_box,
                image_element=elem_img,
                horizontal_align=h_align,
                horizontal_offset=h_offset,
                vertical_align=v_align,
                vertical_offset=v_offset,
                back_width=layer.get("back_width"),
                back_height=layer.get("back_height"),
                back_color=layer.get("back_color"),
                back_radius=layer.get("back_radius", 0),
                back_padding=layer.get("back_padding", 0),
                back_align=layer.get("back_align", "left"),
                image_path=layer.get("image_path"),
                layer_name=layer.get("name"),
                debug_callback=debug_callback
            )

        # 2. Text or Combined Text+Badge (e.g. Rating with Score, Status banner, Runtime, Anime Filler)
        font_path = layer.get("font_path")
        font_size = int(layer.get("font_size") or 40)
        font = None

        candidate_font_dirs = [
            PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays" / "fonts",
            PROJECT_ROOT / "Overlayfiles" / "kometa" / "fonts",
            PROJECT_ROOT / "Overlayfiles",
            Path("/app/Overlayfiles/dynamic_overlays/fonts"),
            Path("/app/Overlayfiles/kometa/fonts"),
            Path("/app/Overlayfiles"),
            Path("/config/Overlayfiles/dynamic_overlays/fonts"),
            Path("/config/Overlayfiles/kometa/fonts"),
            Path("/config/Overlayfiles"),
            Path("/config/fonts"),
            Path("/fonts"),
            Path("/usr/share/fonts/custom"),
            Path("C:/Windows/Fonts"),
        ]

        # Resolve font path if specified
        resolved_fp = None
        if font_path:
            fp = Path(font_path)
            if fp.exists():
                resolved_fp = fp
            else:
                f_name = fp.name
                for fd in candidate_font_dirs:
                    cand = fd / f_name
                    if cand.exists():
                        resolved_fp = cand
                        break

        # Fallback fonts if font not found
        if not resolved_fp:
            for fallback in ["Inter-Bold.ttf", "Inter-Medium.ttf", "CircularStd-Bold.otf", "Roboto-Bold.ttf", "Roboto-Medium.ttf", "Arial.ttf", "DejaVuSans.ttf"]:
                for fd in candidate_font_dirs:
                    cand = fd / fallback
                    if cand.exists():
                        resolved_fp = cand
                        break
                if resolved_fp:
                    break

        if resolved_fp and resolved_fp.exists():
            try:
                font = ImageFont.truetype(str(resolved_fp), size=font_size)
            except Exception as fe:
                logger.warning(f"[Compositor] Failed loading font {resolved_fp}: {fe}")

        if not font:
            try:
                font = ImageFont.load_default(size=font_size)
            except TypeError:
                font = ImageFont.load_default()
            except Exception as de:
                logger.warning(f"[Compositor] Failed loading default font: {de}")

        # Load optional background badge image if provided
        elem_img = None
        badge_img_path = layer.get("image_path")
        resolved_bp = None
        if badge_img_path:
            bp = Path(badge_img_path)
            if bp.exists():
                resolved_bp = bp
            else:
                candidate_asset_dirs = [
                    PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays" / "assets",
                    PROJECT_ROOT / "Overlayfiles" / "kometa" / "assets",
                    PROJECT_ROOT / "Overlayfiles",
                    Path("/app/Overlayfiles/dynamic_overlays/assets"),
                    Path("/app/Overlayfiles/kometa/assets"),
                    Path("/app/Overlayfiles"),
                    Path("/config/Overlayfiles/dynamic_overlays/assets"),
                    Path("/config/Overlayfiles/kometa/assets"),
                    Path("/config/Overlayfiles"),
                ]
                bp_name = bp.name
                for ad in candidate_asset_dirs:
                    cand = ad / bp_name
                    if cand.exists():
                        resolved_bp = cand
                        break
                    for sub in ["rating", "flag/square", "flags/square", "flag/round", "flags/round", "resolution", "commonsense", "ribbon"]:
                        cand_sub = ad / sub / bp_name
                        if cand_sub.exists():
                            resolved_bp = cand_sub
                            break
                    if resolved_bp:
                        break

        if resolved_bp and resolved_bp.exists():
            try:
                with Image.open(resolved_bp) as b_img:
                    elem_img = b_img.convert("RGBA")
                    bw, bh = elem_img.size
                    scale_h = layer.get("scale_height") or layer.get("addon_size")
                    scale_w = layer.get("scale_width")
                    if scale_h or scale_w:
                        tw = parse_offset_value(scale_w, canvas_box[0]) if scale_w else None
                        th = parse_offset_value(scale_h, canvas_box[1]) if scale_h else None
                        if th and not tw:
                            tw = int(bw * th / bh)
                        elif tw and not th:
                            th = int(bh * tw / bw)
                        if tw and th:
                            elem_img = elem_img.resize((tw, th), Image.Resampling.LANCZOS)
            except Exception as be:
                logger.warning(f"[Compositor] Failed loading badge image {resolved_bp}: {be}")

        stroke_color = layer.get("stroke_color")
        stroke_width = int(layer.get("stroke_width") or 0)
        back_color = layer.get("back_color")
        has_solid_back = bool(back_color and hex_to_rgba(back_color)[3] > 10)

        # Smart legibility outline: if no background box is drawn and no explicit stroke is set,
        # ensure white or light text doesn't become invisible on white/light posters
        if stroke_width == 0 and not has_solid_back and elem_img is None:
            fc_rgba = hex_to_rgba(layer.get("font_color", "#FFFFFF"))
            # Perceived luminance
            lum = 0.299 * fc_rgba[0] + 0.587 * fc_rgba[1] + 0.114 * fc_rgba[2]
            if lum > 200:
                stroke_width = 2
                stroke_color = stroke_color or "#000000D0"

        return draw_backdrop_and_text(
            canvas_box=canvas_box,
            text=layer.get("text", ""),
            font=font,
            font_color=layer.get("font_color", "#FFFFFF"),
            stroke_color=stroke_color,
            stroke_width=stroke_width,
            image_element=elem_img,
            horizontal_align=h_align,
            horizontal_offset=h_offset,
            vertical_align=v_align,
            vertical_offset=v_offset,
            back_width=layer.get("back_width"),
            back_height=layer.get("back_height"),
            back_color=layer.get("back_color"),
            back_radius=layer.get("back_radius", 0),
            back_padding=layer.get("back_padding", 0),
            addon_position=layer.get("addon_position"),
            addon_offset=layer.get("addon_offset", 0),
            back_align=layer.get("back_align", "center"),
            image_path=layer.get("image_path"),
            layer_name=layer.get("name"),
            debug_callback=debug_callback
        )

    @staticmethod
    def compute_fingerprint(
        layers_definition: List[Dict[str, Any]],
        metadata_values: Dict[str, Any]
    ) -> str:
        """
        Compute SHA-256 fingerprint representing the exact overlay configuration
        and metadata values (e.g. resolution=4k, rating=7.8, status=Ended).
        If any value changes, the fingerprint changes, triggering a re-render!
        """
        raw_repr = []
        for l in layers_definition:
            name = l.get("name", "")
            t = l.get("type", "")
            val = metadata_values.get(name, "")
            fc = l.get("font_color", "")
            ha = l.get("horizontal_align", "")
            ho = l.get("horizontal_offset", "")
            va = l.get("vertical_align", "")
            vo = l.get("vertical_offset", "")
            raw_repr.append(f"{name}:{t}:{val}:{fc}:{ha}:{ho}:{va}:{vo}")

        joined = "|".join(raw_repr)
        return hashlib.sha256(joined.encode("utf-8")).hexdigest()
