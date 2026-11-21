import argparse
import html
import json
import re
from pathlib import Path
from urllib.parse import quote

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ARTWORK = ROOT / "docs" / "images" / "artwork"
OUTPUT = ROOT / "docs" / "includes" / "artwork-gallery.md"
LEGACY_ORDER = {
    "native-movie-poster.jpg": 1,
    "native-show-poster.jpg": 2,
    "native-season-poster.jpg": 3,
    "collection-poster-example.jpg": 4,
    "native-titlecard.jpg": 5,
}


def sort_key(path):
    prefix = re.match(r"^(\d+)(?:[-_]|$)", path.stem)
    number = int(prefix[1]) if prefix else LEGACY_ORDER.get(path.name, float("inf"))
    return number, path.name.casefold()


def build_gallery():
    groups = {"portrait": [], "landscape": []}
    credits_path = ARTWORK / "credits.json"
    credits = json.loads(credits_path.read_text(encoding="utf-8")) if credits_path.exists() else {}
    paths = sorted((path for path in ARTWORK.iterdir() if path.is_file() and path.name != "native-background.jpg" and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}), key=sort_key)
    for number, path in enumerate(paths, 1):
        with Image.open(path) as image:
            width, height = image.size
        source = "images/artwork/" + quote(path.name, safe="")
        artwork = credits.get("artworks", {}).get(path.name, {})
        contributor = credits.get("contributors", {}).get(artwork.get("contributor"), {})
        metadata = {
            "author": contributor.get("name") or "Contributor not specified",
            "title": artwork.get("title") or f"Artwork {number}",
            "format": artwork.get("format") or ("Landscape artwork" if width > height else "Portrait artwork"),
            "source": contributor.get("overlay_url", ""),
            "source-label": contributor.get("overlay_name", ""),
            "note": contributor.get("note", ""),
        }
        attributes = " ".join(f'data-artwork-{key}="{html.escape(str(value), quote=True)}"' for key, value in metadata.items())
        figure = f'<figure {attributes} markdown="1">\n[![Artwork {number}]({source})]({source})\n</figure>'
        groups["landscape" if width > height else "portrait"].append(figure)

    sections = []
    for orientation, figures in groups.items():
        if not figures:
            continue
        classes = "pz-editions" + (" pz-editions--landscape" if orientation == "landscape" else "")
        sections.append(
            f'<section class="{classes}" data-gallery aria-label="Artwork gallery" markdown="1">\n'
            f'<div class="pz-editions-track" tabindex="0" role="region" aria-label="{orientation.title()} artwork" markdown="1">\n'
            + "\n".join(figures) + "\n</div>\n</section>"
        )
    return "\n\n".join(sections) + "\n", len(paths)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    content, count = build_gallery()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != content:
            raise SystemExit("Artwork gallery is stale. Run docs/tools/build_artwork_gallery.py.")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(content, encoding="utf-8")
    print(f"Artwork gallery: {count} images, no captions or controls.")


if __name__ == "__main__":
    main()