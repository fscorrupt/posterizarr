import hashlib
import importlib.util
import io
import json
import sys
import zipfile
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


def _minimal_png_bytes(marker: bytes = b"PNGDATA") -> bytes:
    return b"\x89PNG\r\n\x1a\n" + marker


def _minimal_ttf_bytes(marker: bytes = b"TTFDATA") -> bytes:
    return b"\x00\x01\x00\x00" + marker


def test_export_blueprint_package_json_for_builtins_and_zip_for_custom(tmp_path):
    overlayfiles_dir = tmp_path / "Overlayfiles"
    overlayfiles_dir.mkdir()
    custom_bg = _minimal_png_bytes(b"innerglow2")
    custom_res = _minimal_png_bytes(b"unused4k")
    custom_font = _minimal_ttf_bytes(b"customfont")
    (overlayfiles_dir / "backgroundoverlay-innerglow2.png").write_bytes(custom_bg)
    (overlayfiles_dir / "custom-4k.png").write_bytes(custom_res)
    (overlayfiles_dir / "CustomDisplay.ttf").write_bytes(custom_font)

    builtin_only = {
        "name": "Builtins",
        "updates": {
            "nested": {
                "PrerequisitePart": {
                    "overlayfile": "overlay-innerglow.png",
                    "backgroundoverlayfile": "backgroundoverlay-innerglow.png",
                    "font": "Colus-Regular.ttf",
                    "UsePosterResolutionOverlays": "false",
                    "poster4k": "custom-4k.png",
                },
                "PosterOverlayPart": {"AddOverlay": "true"},
            }
        },
    }
    json_pkg = cg.export_blueprint_package(builtin_only, overlayfiles_dir)
    assert json_pkg["format"] == "json"
    assert json_pkg["filename"] == "custom_blueprint.json"
    assert json_pkg["asset_names"] == []
    assert json_pkg["missing_assets"] == []

    with_custom = {
        "name": "Custom Suite",
        "updates": {
            "nested": {
                "PrerequisitePart": {
                    "overlayfile": "overlay-innerglow.png",
                    "backgroundoverlayfile": "backgroundoverlay-innerglow2.png",
                    "showbackgroundoverlayfile": "backgroundoverlay-innerglow2.png",
                    "titlecardoverlayfile": "backgroundoverlay-innerglow2.png",
                    "Poster1080p": "missing-overlay.png",
                    "UsePosterResolutionOverlays": "false",
                    "collectionoverlayfile": "missing-collection.png",
                },
                "PosterOverlayPart": {"AddOverlay": "true"},
                "CollectionPosterOverlayPart": {"AddOverlay": "true"},
            }
        },
    }
    zip_pkg = cg.export_blueprint_package(
        with_custom,
        overlayfiles_dir,
        config_fonts={"font": "CustomDisplay.ttf", "backgroundfont": "Colus-Regular.ttf"},
    )
    assert zip_pkg["format"] == "bundle"
    assert zip_pkg["filename"] == "custom_blueprint.zip"
    assert zip_pkg["asset_names"] == ["CustomDisplay.ttf", "backgroundoverlay-innerglow2.png"]
    assert zip_pkg["missing_assets"] == ["missing-collection.png"]

    unpacked = cg.unpack_blueprint_bundle(zip_pkg["payload"])
    assert unpacked["blueprint_name"] == "Custom Suite"
    assert unpacked["updates"]["nested"]["PrerequisitePart"]["font"] == "CustomDisplay.ttf"
    assert unpacked["assets"]["backgroundoverlay-innerglow2.png"] == custom_bg
    assert unpacked["assets"]["CustomDisplay.ttf"] == custom_font


def test_unpack_blueprint_bundle_rejects_bad_entries(tmp_path):
    overlayfiles_dir = tmp_path / "Overlayfiles"
    overlayfiles_dir.mkdir()
    (overlayfiles_dir / "backgroundoverlay-innerglow2.png").write_bytes(_minimal_png_bytes(b"good"))

    pkg = cg.export_blueprint_package(
        {
            "name": "Valid",
            "updates": {
                "nested": {
                    "PrerequisitePart": {"backgroundoverlayfile": "backgroundoverlay-innerglow2.png"},
                    "BackgroundOverlayPart": {"AddOverlay": "true"},
                }
            },
        },
        overlayfiles_dir,
    )
    assert pkg["format"] == "bundle"

    # Bad magic bytes for PNG
    bad_magic_stream = io.BytesIO()
    fake_png = b"NOT_A_PNG"
    with zipfile.ZipFile(bad_magic_stream, "w") as zf:
        zf.writestr(
            "blueprint.json",
            json.dumps(
                {
                    "kind": cg.BLUEPRINT_BUNDLE_KIND,
                    "version": 1,
                    "name": "Bad",
                    "updates": {"nested": {"PrerequisitePart": {"backgroundoverlayfile": "bad.png"}}},
                    "assets": {"bad.png": {"sha256": hashlib.sha256(fake_png).hexdigest(), "size": len(fake_png), "kind": "overlay"}},
                }
            ),
        )
        zf.writestr("assets/bad.png", fake_png)
    with pytest.raises(cg.CommunityGalleryError):
        cg.unpack_blueprint_bundle(bad_magic_stream.getvalue())

    # Checksum mismatch
    bad_hash_stream = io.BytesIO()
    real_png = _minimal_png_bytes(b"abc")
    with zipfile.ZipFile(bad_hash_stream, "w") as zf:
        zf.writestr(
            "blueprint.json",
            json.dumps(
                {
                    "kind": cg.BLUEPRINT_BUNDLE_KIND,
                    "version": 1,
                    "name": "BadHash",
                    "updates": {"nested": {"PrerequisitePart": {"backgroundoverlayfile": "bg.png"}}},
                    "assets": {"bg.png": {"sha256": "0" * 64, "size": len(real_png), "kind": "overlay"}},
                }
            ),
        )
        zf.writestr("assets/bg.png", real_png)
    with pytest.raises(cg.CommunityGalleryError):
        cg.unpack_blueprint_bundle(bad_hash_stream.getvalue())

    # Unreferenced bundled asset
    unref_stream = io.BytesIO()
    with zipfile.ZipFile(unref_stream, "w") as zf:
        zf.writestr(
            "blueprint.json",
            json.dumps(
                {
                    "kind": cg.BLUEPRINT_BUNDLE_KIND,
                    "version": 1,
                    "name": "Unref",
                    "updates": {"nested": {"PosterOverlayPart": {"AddBorder": "true"}}},
                    "assets": {"orphan.png": {"sha256": hashlib.sha256(real_png).hexdigest(), "size": len(real_png), "kind": "overlay"}},
                }
            ),
        )
        zf.writestr("assets/orphan.png", real_png)
    with pytest.raises(cg.CommunityGalleryError):
        cg.unpack_blueprint_bundle(unref_stream.getvalue())

    # Disallowed path / traversal inside ZIP
    evil_path_stream = io.BytesIO()
    with zipfile.ZipFile(evil_path_stream, "w") as zf:
        zf.writestr("blueprint.json", json.dumps({"kind": cg.BLUEPRINT_BUNDLE_KIND, "version": 1, "updates": {"nested": {"PosterOverlayPart": {"AddBorder": "true"}}}, "assets": {}}))
        zf.writestr("../evil.png", real_png)
    with pytest.raises(cg.CommunityGalleryError):
        cg.unpack_blueprint_bundle(evil_path_stream.getvalue())

    # Forbidden config section
    evil_cfg_stream = io.BytesIO()
    with zipfile.ZipFile(evil_cfg_stream, "w") as zf:
        zf.writestr("blueprint.json", json.dumps({"kind": cg.BLUEPRINT_BUNDLE_KIND, "version": 1, "updates": {"nested": {"ApiPart": {"tmdbtoken": "secret"}}}, "assets": {}}))
    with pytest.raises(cg.CommunityGalleryError):
        cg.unpack_blueprint_bundle(evil_cfg_stream.getvalue())


def test_inspect_and_install_blueprint_assets(tmp_path):
    dest_dir = tmp_path / "Overlayfiles"
    dest_dir.mkdir()
    same_bytes = _minimal_png_bytes(b"same")
    old_bytes = _minimal_png_bytes(b"old")
    new_conflict_bytes = _minimal_png_bytes(b"new-conflict")
    fresh_bytes = _minimal_ttf_bytes(b"fresh")

    (dest_dir / "same.png").write_bytes(same_bytes)
    (dest_dir / "conflict.png").write_bytes(old_bytes)

    assets = {
        "same.png": same_bytes,
        "conflict.png": new_conflict_bytes,
        "fresh.ttf": fresh_bytes,
    }
    inspected = {row["name"]: row for row in cg.inspect_blueprint_assets(assets, dest_dir)}
    assert inspected["same.png"]["status"] == "existing_same"
    assert inspected["conflict.png"]["status"] == "conflict"
    assert inspected["fresh.ttf"]["status"] == "new"
    assert inspected["fresh.ttf"]["kind"] == "font"

    no_replace = cg.install_blueprint_assets(assets, dest_dir, replace_existing=False)
    assert no_replace["installed"] == ["fresh.ttf"]
    assert no_replace["skipped_same"] == ["same.png"]
    assert no_replace["skipped_conflicts"] == ["conflict.png"]
    assert no_replace["replaced"] == []
    assert (dest_dir / "conflict.png").read_bytes() == old_bytes
    assert (dest_dir / "fresh.ttf").read_bytes() == fresh_bytes

    do_replace = cg.install_blueprint_assets(assets, dest_dir, replace_existing=True)
    assert do_replace["replaced"] == ["conflict.png"]
    assert (dest_dir / "conflict.png").read_bytes() == new_conflict_bytes


@pytest.mark.skipif(not COMMUNITY_REPO_DIR.exists(), reason="Local posterizarr-community repo not present")
def test_community_blueprint_bundle_validator_and_fetcher(monkeypatch, tmp_path):
    script_path = COMMUNITY_REPO_DIR / "scripts" / "validate_and_index.py"
    spec = importlib.util.spec_from_file_location("validate_and_index", script_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    src_overlays = tmp_path / "src_overlays"
    src_overlays.mkdir()
    bg_bytes = _minimal_png_bytes(b"innerglow2")
    (src_overlays / "backgroundoverlay-innerglow2.png").write_bytes(bg_bytes)
    pkg = cg.export_blueprint_package(
        {
            "name": "Community InnerGlow2",
            "updates": {
                "nested": {
                    "PrerequisitePart": {
                        "backgroundoverlayfile": "backgroundoverlay-innerglow2.png",
                        "titlecardoverlayfile": "backgroundoverlay-innerglow2.png",
                    },
                    "BackgroundOverlayPart": {"AddOverlay": "true"},
                    "TitleCardOverlayPart": {"AddOverlay": "true"},
                }
            },
        },
        src_overlays,
    )
    assert pkg["format"] == "bundle"

    repo_root = tmp_path / "repo"
    entry_dir = repo_root / "blueprints" / "corecomplex"
    entry_dir.mkdir(parents=True)
    (entry_dir / "preview.png").write_bytes(_minimal_png_bytes(b"preview"))
    (entry_dir / "meta.json").write_text(
        json.dumps({"name": "CoreComplex Style", "description": "Custom background overlay bundle exported from Builder."}),
        encoding="utf-8",
    )
    (entry_dir / "custom_blueprint.zip").write_bytes(pkg["payload"])

    errs = []
    indexed = mod.validate_blueprint_entry(
        "corecomplex",
        "blueprints/corecomplex",
        entry_dir,
        errs,
        default_author="corecomplex",
    )
    assert errs == []
    assert indexed["is_bundle"] is True
    assert indexed["asset_count"] == 1
    assert indexed["assets"] == ["backgroundoverlay-innerglow2.png"]
    assert indexed["file"] == "blueprints/corecomplex/custom_blueprint.zip"

    (repo_root / "index.json").write_text(
        json.dumps({"schema_version": 1, "blueprints": [indexed], "dynamic_overlays": []}),
        encoding="utf-8",
    )

    monkeypatch.setenv("POSTERIZARR_COMMUNITY_LOCAL_DIR", str(repo_root))
    target_overlays = tmp_path / "dest_overlays"
    target_overlays.mkdir()
    fetched = cg.fetch_community_blueprint("corecomplex", target_overlays)
    assert fetched["is_bundle"] is True
    assert fetched["blueprint_token"]
    assert len(fetched["assets"]) == 1
    assert fetched["assets"][0]["name"] == "backgroundoverlay-innerglow2.png"
    assert fetched["assets"][0]["status"] == "new"

    resolved_assets = cg.resolve_cached_blueprint_assets(fetched["blueprint_token"], "corecomplex")
    install_res = cg.install_blueprint_assets(resolved_assets, target_overlays, replace_existing=False)
    assert install_res["installed"] == ["backgroundoverlay-innerglow2.png"]
    assert (target_overlays / "backgroundoverlay-innerglow2.png").read_bytes() == bg_bytes
