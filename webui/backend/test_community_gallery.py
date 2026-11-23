import importlib.util
import json
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import community_gallery as cg  # noqa: E402
import overlay_bundle as ob  # noqa: E402

COMMUNITY_REPO_DIR = Path(r"C:\Github\posterizarr-community")


def test_validate_repo_relative_path_guards():
    assert cg.validate_repo_relative_path("blueprints/fscorrupt/innerglow-classic/blueprint.json", "blueprints/") == "blueprints/fscorrupt/innerglow-classic/blueprint.json"
    for bad in (
        "",
        "../secret.json",
        "/etc/passwd",
        "blueprints\\fscorrupt\\blueprint.json",
        "https://evil.example/payload.json",
        "blueprints/foo?bar=1",
        "blueprints/foo#frag",
        "dynamic-overlays/foo/bundle.zip",
    ):
        with pytest.raises(cg.CommunityGalleryError):
            cg.validate_repo_relative_path(bad, "blueprints/")


def test_sanitize_blueprint_strips_sensitive_sections_and_paths():
    payload = {
        "name": "Malicious Test",
        "updates": {
            "nested": {
                "ApiPart": {"tmdbtoken": "secret-token"},
                "WebUI": {"basicAuthPassword": "hacked"},
                "SiloPart": {"SiloUrl": "http://192.168.1.99:8080"},
                "PlexPart": {"PlexUrl": "http://192.168.1.93:32400"},
                "Notification": {"Discord": "https://discord.com/api/webhooks/1/2"},
                "OverlayPart": {"ImageProcessing": "true", "outputQuality": "95%", "UnknownEvil": "1"},
                "PrerequisitePart": {
                    "AssetPath": "/evil",
                    "PlexUpload": "true",
                    "AssetCleanup": "true",
                    "font": "../../evil.ttf",
                    "overlayfile": "overlay-innerglow.png",
                    "UseClearlogo": "true",
                },
                "PosterOverlayPart": {"AddBorder": "true", "borderwidth": "25"},
            }
        },
    }
    sanitized = cg.sanitize_blueprint_updates(payload)
    nested = sanitized["nested"]
    assert set(nested.keys()) == {"OverlayPart", "PrerequisitePart", "PosterOverlayPart"}
    assert nested["OverlayPart"] == {"ImageProcessing": "true", "outputQuality": "95%"}
    assert nested["PrerequisitePart"] == {
        "overlayfile": "overlay-innerglow.png",
        "UseClearlogo": "true",
    }
    assert "ApiPart" in sanitized["stripped_keys"]
    assert "PrerequisitePart.AssetPath" in sanitized["stripped_keys"]
    assert "PrerequisitePart.font" in sanitized["stripped_keys"]


def test_sanitize_manual_config_import_blocks_sensitive_sections_and_paths():
    raw = {
        "WebUI": {"basicAuthEnabled": False},
        "ApiPart": {"tmdbtoken": "evil"},
        "SiloPart": {"SiloUrl": "http://evil"},
        "PrerequisitePart": {
            "AssetPath": "/tmp/evil",
            "AutoUpdatePosterizarr": "true",
            "font": "../bad.ttf",
            "overlayfile": "overlay.png",
        },
        "PosterOverlayPart": {"AddBorder": "false"},
    }
    cleaned = cg.sanitize_manual_config_import(raw)
    assert "WebUI" not in cleaned
    assert "ApiPart" not in cleaned
    assert "SiloPart" not in cleaned
    assert cleaned["PrerequisitePart"] == {"overlayfile": "overlay.png"}
    assert cleaned["PosterOverlayPart"] == {"AddBorder": "false"}


def test_sanitize_portable_main_config_strips_floppy_and_trakt():
    doc = {
        "libraries": {
            "Movies": {
                "overlay_files": [{"default": "resolution"}],
                "schedule": "daily",
                "radarr_url": "http://192.168.1.93:7878",
            }
        },
        "templates": {"MyTpl": {"x": 1}},
        "settings": {"playlist_exclude_users": "Alice"},
        "trakt": {"pin": "1234"},
        "floppy": {"url": "http://192.168.1.93:8011"},
    }
    cleaned = ob.sanitize_portable_main_config(doc)
    assert list(cleaned.keys()) == ["libraries", "templates"]
    assert list(cleaned["libraries"]["Movies"].keys()) == ["overlay_files"]


@pytest.mark.skipif(not COMMUNITY_REPO_DIR.exists(), reason="Local posterizarr-community repo not present")
def test_local_community_repo_end_to_end(monkeypatch, tmp_path):
    monkeypatch.setenv("POSTERIZARR_COMMUNITY_LOCAL_DIR", str(COMMUNITY_REPO_DIR))
    catalog = cg.fetch_community_catalog(refresh=True)
    assert len(catalog["blueprints"]) >= 1
    assert len(catalog["dynamic_overlays"]) >= 1

    bp_result = cg.fetch_community_blueprint("fscorrupt")
    assert bp_result["updates"]["nested"]["PosterOverlayPart"]["AddBorder"] == "true"
    assert bp_result["stripped_keys"] == []

    entry, payload, token = cg.fetch_community_bundle("fscorrupt")
    assert entry["id"] == "fscorrupt"
    assert token

    resolved_entry, resolved_payload = cg.resolve_community_bundle_payload("fscorrupt", token)
    assert resolved_entry["id"] == entry["id"]
    assert resolved_payload == payload

    overlays_dir = tmp_path / "dynamic_overlays"
    overlays_dir.mkdir(parents=True)
    summary = ob.inspect_profile(
        payload,
        overlays_dir,
        [{"name": "Movies", "type": "movie"}, {"name": "TV Shows", "type": "show"}],
    )
    assert len(summary["libraries"]) == 8
    assert summary["features"]["animetafill"] is True


@pytest.mark.skipif(not COMMUNITY_REPO_DIR.exists(), reason="Local posterizarr-community repo not present")
def test_community_validator_script_accepts_repo_and_rejects_bad_blueprint(tmp_path):
    script_path = COMMUNITY_REPO_DIR / "scripts" / "validate_and_index.py"
    spec = importlib.util.spec_from_file_location("validate_and_index", script_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    index, errors = mod.build_index()
    assert errors == []
    assert len(index["blueprints"]) >= 1
    assert len(index["dynamic_overlays"]) >= 1

    bad_dir = tmp_path / "bad-entry"
    bad_dir.mkdir()
    (bad_dir / "preview.png").write_bytes(b"fake")
    (bad_dir / "meta.json").write_text(json.dumps({
        "name": "Bad Blueprint",
        "description": "Contains forbidden ApiPart section and webhook.",
        "author": "tester",
        "tags": ["test"],
        "previews": ["preview.png"],
    }), encoding="utf-8")
    (bad_dir / "blueprint.json").write_text(json.dumps({
        "updates": {
            "nested": {
                "ApiPart": {"tmdbtoken": "secret"},
                "PosterOverlayPart": {"AddBorder": "true"},
            }
        }
    }), encoding="utf-8")

    bad_errors = []
    assert mod.validate_blueprint_entry("tester/bad-entry", "blueprints/tester/bad-entry", bad_dir, bad_errors) is None
    assert any("ApiPart" in err for err in bad_errors)

    flat_ok = tmp_path / "flat-user"
    flat_ok.mkdir()
    (flat_ok / "preview.png").write_bytes(b"fake")
    (flat_ok / "meta.json").write_text(json.dumps({
        "name": "Flat Blueprint",
        "description": "Valid flat blueprint layout without slug subfolder.",
        "author": "flat-user",
        "tags": ["clean"],
        "previews": ["preview.png"],
    }), encoding="utf-8")
    (flat_ok / "blueprint.json").write_text(json.dumps({
        "updates": {"nested": {"PosterOverlayPart": {"AddBorder": "true"}}}
    }), encoding="utf-8")
    flat_errors = []
    flat_item = mod.validate_blueprint_entry("flat-user", "blueprints/flat-user", flat_ok, flat_errors)
    assert flat_errors == []
    assert flat_item["id"] == "flat-user"
    assert flat_item["file"] == "blueprints/flat-user/blueprint.json"

    minimal_dir = tmp_path / "browser-user"
    minimal_dir.mkdir()
    (minimal_dir / "screenshot.png").write_bytes(b"fake-png")
    (minimal_dir / "meta.json").write_text(json.dumps({
        "name": "Browser Uploaded Style",
        "description": "Uploaded straight from the browser with default export filename.",
    }), encoding="utf-8")
    (minimal_dir / "custom_blueprint.json").write_text(json.dumps({
        "updates": {"nested": {"PosterOverlayPart": {"AddBorder": "true"}}}
    }), encoding="utf-8")
    min_errors = []
    min_item = mod.validate_blueprint_entry("browser-user", "blueprints/browser-user", minimal_dir, min_errors, default_author="browser-user")
    assert min_errors == []
    assert min_item["author"] == "browser-user"
    assert min_item["author_url"] == "https://github.com/browser-user"
    assert min_item["tags"] == []
    assert min_item["previews"] == ["blueprints/browser-user/screenshot.png"]
    assert min_item["file"] == "blueprints/browser-user/custom_blueprint.json"
