#!/usr/bin/env python3
"""
Create resolution overlay badges for Posterizarr
Creates 4K, 1080P, and 720P badges styled like the reference image
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_resolution_badge(resolution_text, subtitle_text, output_path,
                           poster_size=(2000, 3000), badge_position='top-left'):
    """
    Create a resolution badge overlay for posters

    Args:
        resolution_text: Main text (e.g., "4K", "1080P")
        subtitle_text: Subtitle (e.g., "ULTRA HD", "FULL HD")
        output_path: Where to save the PNG
        poster_size: Size of the poster (width, height)
        badge_position: Where to place the badge
    """
    # Create transparent canvas matching poster size
    overlay = Image.new('RGBA', poster_size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Badge dimensions and styling
    badge_width = 280
    badge_height = 180
    corner_radius = 15

    # Colors - gold/yellow badge style
    badge_bg_color = (50, 50, 50, 255)  # Dark background
    badge_border_color = (255, 193, 7, 255)  # Gold/amber color
    text_color = (255, 193, 7, 255)  # Gold text
    subtitle_bg_color = (255, 193, 7, 255)  # Gold subtitle background
    subtitle_text_color = (50, 50, 50, 255)  # Dark subtitle text
    border_width = 8

    # Position badge in top-left corner with margin
    margin = 40
    badge_x = margin
    badge_y = margin

    # Draw badge background with rounded corners
    bbox = [badge_x, badge_y, badge_x + badge_width, badge_y + badge_height]

    # Draw outer border (gold)
    draw.rounded_rectangle(bbox, radius=corner_radius,
                          fill=badge_border_color, outline=None)

    # Draw inner background (dark)
    inner_bbox = [bbox[0] + border_width,
                  bbox[1] + border_width,
                  bbox[2] - border_width,
                  bbox[3] - border_width]
    draw.rounded_rectangle(inner_bbox, radius=corner_radius - 4,
                          fill=badge_bg_color, outline=None)

    # Calculate text positioning
    main_text_y = badge_y + 35
    subtitle_y = badge_y + badge_height - 55

    # Try to load a bold font, fallback to default if not available
    try:
        # Try common font locations
        font_paths = [
            '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
            '/System/Library/Fonts/Helvetica.ttc',
            'C:\\Windows\\Fonts\\arialbd.ttf',
            '/workspaces/posterizarr/Overlayfiles/Comfortaa-Bold.ttf'
        ]
        font_path = None
        for path in font_paths:
            if os.path.exists(path):
                font_path = path
                break

        if font_path:
            main_font = ImageFont.truetype(font_path, 72)
            subtitle_font = ImageFont.truetype(font_path, 28)
        else:
            main_font = ImageFont.load_default()
            subtitle_font = ImageFont.load_default()
    except Exception as e:
        print(f"Warning: Could not load custom font: {e}")
        main_font = ImageFont.load_default()
        subtitle_font = ImageFont.load_default()

    # Draw main resolution text (centered horizontally in badge)
    # Get text bounding box for centering
    main_bbox = draw.textbbox((0, 0), resolution_text, font=main_font)
    main_text_width = main_bbox[2] - main_bbox[0]
    main_text_x = badge_x + (badge_width - main_text_width) // 2

    draw.text((main_text_x, main_text_y), resolution_text,
             fill=text_color, font=main_font)

    # Draw subtitle background rectangle
    subtitle_rect_height = 42
    subtitle_rect = [badge_x + border_width + 5,
                     subtitle_y - 8,
                     badge_x + badge_width - border_width - 5,
                     subtitle_y + subtitle_rect_height - 8]
    draw.rounded_rectangle(subtitle_rect, radius=5,
                          fill=subtitle_bg_color, outline=None)

    # Draw subtitle text (centered)
    subtitle_bbox = draw.textbbox((0, 0), subtitle_text, font=subtitle_font)
    subtitle_text_width = subtitle_bbox[2] - subtitle_bbox[0]
    subtitle_text_x = badge_x + (badge_width - subtitle_text_width) // 2

    draw.text((subtitle_text_x, subtitle_y), subtitle_text,
             fill=subtitle_text_color, font=subtitle_font)

    # Save the overlay
    overlay.save(output_path, 'PNG')
    print(f"Created: {output_path}")
    return output_path


def main():
    """Create all resolution overlays"""
    output_dir = "/workspaces/posterizarr/Overlayfiles"

    # Create badges
    overlays = [
        ("8K", "ULTRA HD", "overlay-8k.png"),
        ("4K", "ULTRA HD", "overlay-4k.png"),
        ("1080P", "FULL HD", "overlay-1080p.png"),
        ("720P", "HD", "overlay-720p.png"),
    ]

    for resolution, subtitle, filename in overlays:
        output_path = os.path.join(output_dir, filename)
        create_resolution_badge(resolution, subtitle, output_path)

    print("\nAll resolution overlay badges created successfully!")
    print(f"Overlays saved to: {output_dir}")
    print("\nTo use these overlays in Posterizarr:")
    print("1. Update config.json PrerequisitePart section:")
    print('   "poster4k": "overlay-4k.png"')
    print('   "Poster1080p": "overlay-1080p.png"')
    print('   "UsePosterResolutionOverlays": "true"')
    print("\n2. You can also create 720p configuration if needed")

if __name__ == "__main__":
    main()
