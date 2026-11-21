import argparse
import asyncio
import hashlib
import io
import json
import sys
import tempfile
from pathlib import Path

import httpx
import yaml
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "webui" / "backend"))

import overlay_sync_service
from overlay_engine import DynamicOverlayCompositor
from overlay_preview import build_preview_layers, preview_layer_key
from overlay_resolver import OverlayResolver

EDITIONS = [
    ("poster-cinema", "gallery", "Dune (2021)", "poster.jpg"),
    ("poster-vault", "gallery", "Alien (1979)", "poster.jpg"),
    ("poster-scoreboard", "gallery", "Interstellar (2014)", "poster.jpg"),
    ("poster-polyglot", "gallery", "Dune Part Two (2024)", "poster.jpg"),
    ("show-languages", "gallery", "Arcane (2021)", "poster.jpg"),
    ("show-audio", "gallery", "Breaking Bad (2008)", "poster.jpg"),
    ("show-minimal", "gallery", "Severance (2022)", "poster.jpg"),
    ("season-premiere", "seasons-gallery", "Arcane (2021)", "Season01.jpg"),
    ("season-scoreboard", "seasons-gallery", "Breaking Bad (2008)", "Season01.jpg"),
    ("season-languages", "seasons-gallery", "Severance (2022)", "Season01.jpg"),
    ("season-spotlight", "seasons-gallery", "The Last of Us (2023)", "Season01.jpg"),
    ("titlecard-cinema", "titlecards-gallery", "Arcane (2021)", "S01E01.jpg"),
    ("titlecard-scoreboard", "titlecards-gallery", "Breaking Bad (2008)", "S01E01.jpg"),
    ("titlecard-languages", "titlecards-gallery", "Arcane (2021)", "S01E02.jpg"),
    ("titlecard-minimal", "titlecards-gallery", "Breaking Bad (2008)", "S01E02.jpg"),
    ("titlecard-anime-canon", "assets-folder-images/titlecards/Anime Shows/Naruto (2002)", "Naruto (2002)", "S01E01.jpg"),
    ("titlecard-anime-filler", "assets-folder-images/titlecards/Anime Shows/Naruto (2002)", "Naruto (2002)", "S01E02.jpg"),
    ("titlecard-anime-mixed", "assets-folder-images/titlecards/Anime Shows/Naruto (2002)", "Naruto (2002)", "S01E03.jpg"),
]


async def prepare_dependencies(engine):
    await engine.import_defaults_from_github()
    result = await engine.fetch_all_missing()
    codec = await engine.fetch_asset("audio_codec/compact/truehd_atmos.png", "image")
    if not codec.get("success"):
        raise RuntimeError(f"Audio codec dependency unavailable: {codec}")
    print(f"Fetched {result['downloaded_count']} missing overlay dependencies", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--only", choices=[edition[0] for edition in EDITIONS])
    args = parser.parse_args()
    output = ROOT / "docs" / "images" / "artwork"
    output.mkdir(parents=True, exist_ok=True)
    recipes = yaml.safe_load((ROOT / "docs" / "examples" / "overlay-editions.yml").read_text(encoding="utf-8"))
    anime_config = json.loads((ROOT / "docs" / "examples" / "animetafill-editions.json").read_text(encoding="utf-8"))
    editions = [(number, edition) for number, edition in enumerate(EDITIONS, 7) if not args.only or edition[0] == args.only]
    overlay_sync_service.get_dynamic_overlays_settings = lambda: {}
    report = []

    with tempfile.TemporaryDirectory(prefix="posterizarr-gallery-") as temporary:
        engine = OverlayResolver(Path(temporary))
        (engine.configs_dir / "config.yml").write_text(yaml.safe_dump(recipes), encoding="utf-8")
        asyncio.run(prepare_dependencies(engine))
        anime_config["aesthetic"]["font"] = str(engine.fonts_dir / "Inter-Bold.ttf")
        galleries = {}
        with httpx.Client(base_url=args.base_url, trust_env=False, timeout=60, follow_redirects=True) as client:
            for number, (name, endpoint, title, filename) in editions:
                if endpoint not in galleries:
                    response = client.get(f"/api/{endpoint}")
                    response.raise_for_status()
                    galleries[endpoint] = response.json()["images"]
                source = next(image for image in galleries[endpoint] if title in image["path"] and image["name"] == filename)
                response = client.get(source["url"])
                response.raise_for_status()
                base = Image.open(io.BytesIO(response.content)).convert("RGB")
                landscape = name.startswith("titlecard-")
                base.thumbnail((1440, 810) if landscape else (800, 1200), Image.Resampling.LANCZOS)
                buffer = io.BytesIO()
                base.save(buffer, format="PNG")
                metadata = {
                    "title": title, "media_type": "episode" if landscape else "show" if name.startswith(("season-", "show-")) else "movie",
                    "is_episode": landscape, "is_season": name.startswith("season-"),
                    "is_landscape": landscape, "season_number": 1 if name.startswith(("season-", "titlecard-")) else None,
                    "episode_number": 1 if landscape else None,
                    "_aggregated_episode_streams": name.startswith(("season-", "show-")),
                    "rating": 8.6, "audience_rating": 8.6,
                    "multi_ratings": {"imdb": 8.6, "tmdb": 8.1, "tomatoes": 93, "letterboxd": 4.1, "mal": 8.6},
                    "resolution": "4k", "has_hdr": name.endswith(("cinema", "polyglot")),
                    "has_dolby_vision": name.endswith("cinema"),
                    "runtime_mins": 47 if landscape else 128,
                    "audio_languages": ["de", "en", "ja"], "languages": ["de", "en", "ja"],
                    "audio_codec": "truehd_atmos",
                    "studio": "20th Century Fox" if title == "Alien (1979)" else None,
                    "status": "returning",
                    "network": "Netflix" if "Arcane" in title else "Apple TV+" if "Severance" in title else "HBO",
                    "networks": ["Netflix" if "Arcane" in title else "Apple TV+" if "Severance" in title else "HBO"],
                }
                rules = recipes["libraries"][name]["overlay_files"]
                layers = overlay_sync_service.build_overlay_layers_for_item(metadata, rules, engine.overlays_dir, is_landscape=landscape)
                if name.startswith("titlecard-anime-"):
                    layers.extend(build_preview_layers(
                        {"template_type": "episode_card", "library_name": "Gallery Anime", "anime_tag": name.rsplit("-", 1)[1]},
                        {"anime": {}}, [], engine.overlays_dir, overlay_sync_service.build_overlay_layers_for_item,
                        animetafill_config=anime_config,
                    ))
                    if not any(layer.get("name") == "anime" for layer in layers):
                        raise RuntimeError(f"AniMetaFill layer missing for {name}")
                for default in ("languages", "audio_codec", "studio", "network", "status"):
                    if any(rule.get("default") == default for rule in rules) and not any(preview_layer_key(layer) == default for layer in layers):
                        raise RuntimeError(f"{default} layer missing for {name}")
                if not layers:
                    raise RuntimeError(f"No layers generated for {name}")
                rendered = DynamicOverlayCompositor.composite_overlays(buffer.getvalue(), layers, "landscape" if landscape else "portrait", abort_on_missing_asset=True)
                image = Image.open(io.BytesIO(rendered)).convert("RGB")
                if ImageChops.difference(base, image).getbbox() is None:
                    raise RuntimeError(f"No visible overlays generated for {name}")
                image.save(output / f"{number}.webp", "WEBP", quality=88, method=6)
                report.append({"file": f"{number}.webp", "edition": name, "title": title, "asset": filename, "dimensions": list(image.size),
                               "source_sha256": hashlib.sha256(response.content).hexdigest(),
                               "layers": [layer.get("name") for layer in layers], "metadata": "illustrative, not measured media metadata"})
                print(f"Rendered {name}: {len(layers)} layers at {image.width}x{image.height}", flush=True)
    report_path = ROOT / "docs" / "examples" / ("overlay-render-report-single.json" if args.only else "overlay-render-report.json")
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()