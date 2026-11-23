"""Unit tests for Community Gallery GitHub-only global download counters."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

import httpx

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import community_gallery as cg  # noqa: E402

COMMUNITY_REPO_DIR = Path(r"C:\Github\posterizarr-community")
SYNC_SCRIPT_PATH = COMMUNITY_REPO_DIR / "scripts" / "sync_releases_and_stats.py"
VALIDATE_SCRIPT_PATH = COMMUNITY_REPO_DIR / "scripts" / "validate_and_index.py"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_minimal_overlay_bundle(name: str = "Test") -> bytes:
    cfg = b"libraries:\n  Movies:\n    overlay_files: []\n"
    manifest = {
        "kind": "posterizarr-overlay-bundle",
        "version": 1,
        "name": name,
        "libraries": [{"name": "Movies", "media_type": "movie", "rule_count": 0}],
        "checksums": {"files/configs/config.yml": hashlib.sha256(cfg).hexdigest()},
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("files/configs/config.yml", cfg)
    return buf.getvalue()


class _FakeResponse:
    def __init__(self, status_code: int, body: bytes = b"", headers: dict[str, str] | None = None):
        self.status_code = status_code
        self._body = body
        self.headers = headers or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            req = httpx.Request("GET", "https://example.invalid/")
            resp = httpx.Response(self.status_code, request=req)
            raise httpx.HTTPStatusError(f"HTTP {self.status_code}", request=req, response=resp)

    def iter_bytes(self):
        if self._body:
            yield self._body[: max(1, len(self._body) // 2)]
            if len(self._body) > 1:
                yield self._body[max(1, len(self._body) // 2) :]


class _FakeHttpxClient:
    def __init__(self, routes: dict[str, list[tuple[int, bytes, dict[str, str]]]], calls: list[str] | None = None):
        self._routes = routes
        self._calls = calls if calls is not None else []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    @contextmanager
    def stream(self, method: str, url: str, headers=None):
        self._calls.append(url)
        handler = self._routes.get(url)
        if handler is None:
            yield _FakeResponse(404)
            return
        if isinstance(handler, Exception):
            raise handler
        status, body, resp_headers = handler
        yield _FakeResponse(status, body=body, headers=resp_headers)


class FakeGitHubReleaseClient:
    """In-memory mock mimicking GitHubReleaseClient with pagination support."""

    def __init__(self) -> None:
        self._next_release_id = 100
        self._next_asset_id = 1000
        self.releases_by_tag: dict[str, dict] = {}
        self.assets_by_release: dict[int, list[dict]] = {}
        self.deleted_asset_ids: list[int] = []
        self.uploaded_assets: list[tuple[int, str, bytes]] = []

    def get_release_by_tag(self, tag: str) -> dict | None:
        rel = self.releases_by_tag.get(tag)
        return dict(rel) if rel is not None else None

    def ensure_release(self, tag: str, title: str, body: str, target_commitish: str = "main") -> dict:
        existing = self.get_release_by_tag(tag)
        if existing is not None:
            return existing
        rel_id = self._next_release_id
        self._next_release_id += 1
        rel = {"id": rel_id, "tag_name": tag, "name": title, "body": body}
        self.releases_by_tag[tag] = rel
        self.assets_by_release[rel_id] = []
        return dict(rel)

    def list_release_assets(self, release_id: int) -> list[dict]:
        # Simulate pagination slice behavior cleanly while returning full list.
        return [dict(item) for item in self.assets_by_release.get(release_id, [])]

    def delete_asset(self, asset_id: int) -> None:
        self.deleted_asset_ids.append(asset_id)
        for assets in self.assets_by_release.values():
            assets[:] = [a for a in assets if a["id"] != asset_id]

    def upload_asset(self, release_id: int, asset_name: str, data: bytes, content_type: str) -> dict:
        aid = self._next_asset_id
        self._next_asset_id += 1
        asset = {
            "id": aid,
            "name": asset_name,
            "download_count": 0,
            "digest": f"sha256:{hashlib.sha256(data).hexdigest()}",
            "content_type": content_type,
        }
        self.assets_by_release.setdefault(release_id, []).append(asset)
        self.uploaded_assets.append((release_id, asset_name, data))
        return dict(asset)

    def bump_downloads(self, tag: str, asset_name: str, count: int) -> None:
        rel = self.releases_by_tag[tag]
        for asset in self.assets_by_release[rel["id"]]:
            if asset["name"] == asset_name:
                asset["download_count"] = count
                return
        raise KeyError(f"Asset {asset_name} not found in {tag}")


@unittest.skipUnless(COMMUNITY_REPO_DIR.exists(), "Local posterizarr-community repo not present")
class ValidateAndIndexReleaseFieldsTests(unittest.TestCase):
    def test_release_asset_names_are_collision_free_and_indexed(self):
        mod = _load_module("validate_and_index", VALIDATE_SCRIPT_PATH)
        index, errors = mod.build_index()
        self.assertEqual(errors, [])

        for bp in index["blueprints"]:
            self.assertEqual(bp["release_tag"], "gallery-blueprints")
            self.assertTrue(bp["release_asset"].endswith((".json", ".zip")))
            self.assertRegex(bp["release_asset"], r"^[a-z0-9][a-z0-9._-]+\.(json|zip)$")

        for ov in index["dynamic_overlays"]:
            self.assertEqual(ov["release_tag"], "gallery-dynamic-overlays")
            self.assertTrue(ov["release_asset"].endswith(".zip"))
            self.assertRegex(ov["release_asset"], r"^[a-z0-9][a-z0-9._-]+\.zip$")

        # Verify distinct asset filenames even for colliding normalization candidates.
        n1 = mod.build_release_asset_name("blueprint", "a/b", ".json")
        n2 = mod.build_release_asset_name("blueprint", "a--b", ".json")
        n3 = mod.build_release_asset_name("blueprint", "Alice", ".json")
        n4 = mod.build_release_asset_name("blueprint", "alice", ".json")
        self.assertEqual(len({n1, n2, n3, n4}), 4)


@unittest.skipUnless(SYNC_SCRIPT_PATH.exists(), "sync_releases_and_stats.py not present")
class SyncReleasesAndStatsTests(unittest.TestCase):
    def setUp(self):
        self.sync_mod = _load_module("sync_releases_and_stats", SYNC_SCRIPT_PATH)
        self.val_mod = _load_module("validate_and_index", VALIDATE_SCRIPT_PATH)
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.repo_dir = self.root / "repo"
        self.repo_dir.mkdir()
        self.stats_path = self.root / "stats" / "stats.json"

    def tearDown(self):
        self.tmp.cleanup()

    def _write_entry(self, entry_id: str, payload: bytes, ext: str = ".json") -> dict:
        bp_file = self.repo_dir / "blueprints" / entry_id / f"blueprint{ext}"
        bp_file.parent.mkdir(parents=True, exist_ok=True)
        bp_file.write_bytes(payload)
        return {
            "id": entry_id,
            "file": f"blueprints/{entry_id}/blueprint{ext}",
            "sha256": hashlib.sha256(payload).hexdigest(),
            "release_tag": "gallery-blueprints",
            "release_asset": self.val_mod.build_release_asset_name("blueprint", entry_id, ext),
        }

    def test_sync_preserves_counts_across_updates_removals_and_120_entries(self):
        entries = [
            self._write_entry(f"user-{i:03d}", json.dumps({"idx": i}).encode("utf-8"))
            for i in range(120)
        ]
        index_path = self.repo_dir / "index.json"
        index_path.write_text(
            json.dumps({"schema_version": 1, "blueprints": entries, "dynamic_overlays": []}),
            encoding="utf-8",
        )

        client = FakeGitHubReleaseClient()
        changed = self.sync_mod.run_sync(
            client=client,
            repo_root=self.repo_dir,
            index_path=index_path,
            stats_path=self.stats_path,
            sync_assets=True,
            update_stats=True,
            now_iso="2026-11-23T18:00:00Z",
        )
        self.assertTrue(changed)
        stats = json.loads(self.stats_path.read_text(encoding="utf-8"))
        self.assertEqual(len(stats["blueprints"]), 120)
        self.assertEqual(stats["blueprints"]["user-000"], 0)
        self.assertEqual(len(client.assets_by_release[client.releases_by_tag["gallery-blueprints"]["id"]]), 120)

        # Simulate downloads on GitHub Release assets and run update-stats.
        client.bump_downloads("gallery-blueprints", entries[0]["release_asset"], 42)
        client.bump_downloads("gallery-blueprints", entries[119]["release_asset"], 7)

        changed = self.sync_mod.run_sync(
            client=client,
            repo_root=self.repo_dir,
            index_path=index_path,
            stats_path=self.stats_path,
            sync_assets=False,
            update_stats=True,
            now_iso="2026-11-23T18:30:00Z",
        )
        self.assertTrue(changed)
        stats = json.loads(self.stats_path.read_text(encoding="utf-8"))
        self.assertEqual(stats["blueprints"]["user-000"], 42)
        self.assertEqual(stats["blueprints"]["user-119"], 7)

        # Unchanged stats should be a no-op and retain prior timestamp.
        changed_again = self.sync_mod.run_sync(
            client=client,
            repo_root=self.repo_dir,
            index_path=index_path,
            stats_path=self.stats_path,
            sync_assets=False,
            update_stats=True,
            now_iso="2026-11-23T19:00:00Z",
        )
        self.assertFalse(changed_again)
        stats_unchanged = json.loads(self.stats_path.read_text(encoding="utf-8"))
        self.assertEqual(stats_unchanged["updated_at"], "2026-11-23T18:30:00Z")

        # Update user-000 after 3 more unrecorded downloads (45 total) AND change extension to .zip!
        client.bump_downloads("gallery-blueprints", entries[0]["release_asset"], 45)
        entries[0] = self._write_entry("user-000", b"PK\x03\x04zip-updated", ext=".zip")
        index_path.write_text(
            json.dumps({"schema_version": 1, "blueprints": entries, "dynamic_overlays": []}),
            encoding="utf-8",
        )
        changed = self.sync_mod.run_sync(
            client=client,
            repo_root=self.repo_dir,
            index_path=index_path,
            stats_path=self.stats_path,
            sync_assets=True,
            update_stats=True,
            now_iso="2026-11-23T19:15:00Z",
        )
        self.assertTrue(changed)
        stats = json.loads(self.stats_path.read_text(encoding="utf-8"))
        self.assertEqual(stats["blueprints"]["user-000"], 45)
        self.assertEqual(stats["_tracking"]["blueprints"]["user-000"]["baseline"], 45)
        self.assertEqual(stats["_tracking"]["blueprints"]["user-000"]["last_release_count"], 0)

        # Downloads on the new .zip asset accumulate onto the preserved 45 baseline.
        client.bump_downloads("gallery-blueprints", entries[0]["release_asset"], 5)
        self.sync_mod.run_sync(
            client=client,
            repo_root=self.repo_dir,
            index_path=index_path,
            stats_path=self.stats_path,
            sync_assets=False,
            update_stats=True,
            now_iso="2026-11-23T19:30:00Z",
        )
        stats = json.loads(self.stats_path.read_text(encoding="utf-8"))
        self.assertEqual(stats["blueprints"]["user-000"], 50)

        # Remove entry user-119 -> orphan asset deleted, historical baseline retained in _tracking.
        entries_without_last = entries[:-1]
        index_path.write_text(
            json.dumps({"schema_version": 1, "blueprints": entries_without_last, "dynamic_overlays": []}),
            encoding="utf-8",
        )
        self.sync_mod.run_sync(
            client=client,
            repo_root=self.repo_dir,
            index_path=index_path,
            stats_path=self.stats_path,
            sync_assets=True,
            update_stats=True,
            now_iso="2026-11-23T20:00:00Z",
        )
        stats = json.loads(self.stats_path.read_text(encoding="utf-8"))
        self.assertNotIn("user-119", stats["blueprints"])
        self.assertEqual(stats["_tracking"]["blueprints"]["user-119"]["baseline"], 7)

        # Missing release during stats-only run exits cleanly without failing.
        empty_client = FakeGitHubReleaseClient()
        fresh_stats = self.root / "fresh" / "stats.json"
        self.assertTrue(
            self.sync_mod.run_sync(
                client=empty_client,
                repo_root=self.repo_dir,
                index_path=index_path,
                stats_path=fresh_stats,
                sync_assets=False,
                update_stats=True,
                now_iso="2026-11-23T20:05:00Z",
            )
        )

    def test_external_asset_replacement_and_github_pagination(self):
        # 1) External asset replacement during stats-only update folds previous last_release_count into baseline.
        single_entry = self._write_entry("alice", b'{"a": 1}')
        index_path = self.repo_dir / "index.json"
        index_path.write_text(
            json.dumps({"schema_version": 1, "blueprints": [single_entry], "dynamic_overlays": []}),
            encoding="utf-8",
        )
        client = FakeGitHubReleaseClient()
        self.sync_mod.run_sync(
            client=client,
            repo_root=self.repo_dir,
            index_path=index_path,
            stats_path=self.stats_path,
            sync_assets=True,
            update_stats=True,
            now_iso="2026-11-23T18:00:00Z",
        )
        client.bump_downloads("gallery-blueprints", single_entry["release_asset"], 18)
        self.sync_mod.run_sync(
            client=client,
            repo_root=self.repo_dir,
            index_path=index_path,
            stats_path=self.stats_path,
            sync_assets=False,
            update_stats=True,
            now_iso="2026-11-23T18:30:00Z",
        )
        # Simulate external delete + re-upload giving a new numeric asset ID with download_count=4.
        rel_id = client.releases_by_tag["gallery-blueprints"]["id"]
        old_id = client.assets_by_release[rel_id][0]["id"]
        client.assets_by_release[rel_id] = [
            {
                "id": old_id + 500,
                "name": single_entry["release_asset"],
                "download_count": 4,
            }
        ]
        self.sync_mod.run_sync(
            client=client,
            repo_root=self.repo_dir,
            index_path=index_path,
            stats_path=self.stats_path,
            sync_assets=False,
            update_stats=True,
            now_iso="2026-11-23T19:00:00Z",
        )
        stats = json.loads(self.stats_path.read_text(encoding="utf-8"))
        self.assertEqual(stats["blueprints"]["alice"], 22)
        self.assertEqual(stats["_tracking"]["blueprints"]["alice"]["baseline"], 18)
        self.assertEqual(stats["_tracking"]["blueprints"]["alice"]["last_release_count"], 4)

        # 2) Real GitHubReleaseClient paginates per_page=100 until batch < 100.
        real_client = self.sync_mod.GitHubReleaseClient("fscorrupt/posterizarr-community", token="tok")
        seen_urls: list[str] = []

        class _FakeUrlResp:
            def __init__(self, data: bytes):
                self.status = 200
                self._data = data

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return self._data

        def _fake_urlopen(req, timeout=60):
            seen_urls.append(req.full_url)
            if req.full_url.endswith("&page=1"):
                batch = [{"id": i, "name": f"asset-{i}.json", "download_count": i} for i in range(100)]
            else:
                batch = [{"id": 100 + i, "name": f"asset-{100 + i}.json", "download_count": i} for i in range(5)]
            return _FakeUrlResp(json.dumps(batch).encode("utf-8"))

        with mock.patch.object(self.sync_mod.urllib.request, "urlopen", side_effect=_fake_urlopen):
            all_assets = real_client.list_release_assets(99)
        self.assertEqual(len(all_assets), 105)
        self.assertEqual(len(seen_urls), 2)
        self.assertIn("per_page=100&page=1", seen_urls[0])
        self.assertIn("per_page=100&page=2", seen_urls[1])


class CommunityGalleryStatsBackendTests(unittest.TestCase):
    def setUp(self):
        self._orig_env = os.environ.get("POSTERIZARR_COMMUNITY_LOCAL_DIR")
        cg._CATALOG_CACHE = None
        cg._BUNDLE_CACHE.clear()
        cg._BLUEPRINT_BUNDLE_CACHE.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.tmp.name)

    def tearDown(self):
        if self._orig_env is None:
            os.environ.pop("POSTERIZARR_COMMUNITY_LOCAL_DIR", None)
        else:
            os.environ["POSTERIZARR_COMMUNITY_LOCAL_DIR"] = self._orig_env
        cg._CATALOG_CACHE = None
        cg._BUNDLE_CACHE.clear()
        cg._BLUEPRINT_BUNDLE_CACHE.clear()
        self.tmp.cleanup()

    def _build_sample_index(self) -> tuple[dict, bytes, bytes]:
        bp_bytes = json.dumps(
            {"name": "Demo BP", "updates": {"nested": {"PosterOverlayPart": {"AddBorder": "true"}}}}
        ).encode("utf-8")
        ov_bytes = _make_minimal_overlay_bundle("Demo Overlay")
        index = {
            "schema_version": 1,
            "blueprints": [
                {
                    "id": "alice",
                    "name": "Alice BP",
                    "description": "Nice border blueprint.",
                    "author": "alice",
                    "tags": ["clean"],
                    "path": "blueprints/alice",
                    "file": "blueprints/alice/blueprint.json",
                    "previews": ["blueprints/alice/preview.png"],
                    "sha256": hashlib.sha256(bp_bytes).hexdigest(),
                    "release_tag": "gallery-blueprints",
                    "release_asset": "alice-12345678.json",
                }
            ],
            "dynamic_overlays": [
                {
                    "id": "bob",
                    "name": "Bob Overlay",
                    "description": "Nice overlay pack.",
                    "author": "bob",
                    "tags": ["ratings"],
                    "path": "dynamic-overlays/bob",
                    "file": "dynamic-overlays/bob/bundle.zip",
                    "previews": ["dynamic-overlays/bob/preview.png"],
                    "bundle_sha256": hashlib.sha256(ov_bytes).hexdigest(),
                    "release_tag": "gallery-dynamic-overlays",
                    "release_asset": "bob-87654321.zip",
                }
            ],
        }
        return index, bp_bytes, ov_bytes

    def test_local_catalog_merges_stats_when_present_and_omits_when_missing(self):
        index, _, _ = self._build_sample_index()
        (self.repo_root / "index.json").write_text(json.dumps(index), encoding="utf-8")
        os.environ["POSTERIZARR_COMMUNITY_LOCAL_DIR"] = str(self.repo_root)

        catalog_no_stats = cg.fetch_community_catalog(refresh=True)
        self.assertIsNone(catalog_no_stats["stats_updated_at"])
        self.assertNotIn("downloads", catalog_no_stats["blueprints"][0])
        self.assertNotIn("downloads", catalog_no_stats["dynamic_overlays"][0])

        (self.repo_root / "stats.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "updated_at": "2026-11-23T18:00:00Z",
                    "blueprints": {"alice": 128},
                    "dynamic_overlays": {"bob": 64},
                }
            ),
            encoding="utf-8",
        )
        catalog_with_stats = cg.fetch_community_catalog(refresh=True)
        self.assertEqual(catalog_with_stats["stats_updated_at"], "2026-11-23T18:00:00Z")
        self.assertEqual(catalog_with_stats["blueprints"][0]["downloads"], 128)
        self.assertEqual(catalog_with_stats["dynamic_overlays"][0]["downloads"], 64)

    def test_remote_stats_graceful_fallback_on_404_and_invalid_json(self):
        os.environ.pop("POSTERIZARR_COMMUNITY_LOCAL_DIR", None)
        index, _, _ = self._build_sample_index()
        routes = {
            f"{cg.COMMUNITY_RAW_BASE}index.json": (200, json.dumps(index).encode("utf-8"), {}),
            cg.COMMUNITY_STATS_URL: (404, b"Not Found", {}),
        }
        with mock.patch.object(cg.httpx, "Client", side_effect=lambda *a, **kw: _FakeHttpxClient(routes)):
            cat = cg.fetch_community_catalog(refresh=True)
        self.assertEqual(len(cat["blueprints"]), 1)
        self.assertNotIn("downloads", cat["blueprints"][0])

        routes[cg.COMMUNITY_STATS_URL] = (200, b"{not valid json", {})
        with mock.patch.object(cg.httpx, "Client", side_effect=lambda *a, **kw: _FakeHttpxClient(routes)):
            cat_bad = cg.fetch_community_catalog(refresh=True)
        self.assertNotIn("downloads", cat_bad["blueprints"][0])

    def test_release_download_follows_allowed_redirect_and_blocks_disallowed_hosts(self):
        os.environ.pop("POSTERIZARR_COMMUNITY_LOCAL_DIR", None)
        start_url = f"{cg.COMMUNITY_RELEASE_BASE}gallery-blueprints/alice-12345678.json"
        cdn_url = "https://objects.githubusercontent.com/github-production-release-asset/12345"

        routes = {
            start_url: (302, b"", {"Location": cdn_url}),
            cdn_url: (200, b'{"ok": true}', {}),
        }
        calls: list[str] = []
        with mock.patch.object(cg.httpx, "Client", side_effect=lambda *a, **kw: _FakeHttpxClient(routes, calls)):
            data = cg._download_release_asset("gallery-blueprints", "alice-12345678.json", 1024)
        self.assertEqual(data, b'{"ok": true}')
        self.assertEqual(calls, [start_url, cdn_url])

        # Reject external host redirect
        evil_routes = {start_url: (302, b"", {"Location": "https://evil.example/payload.json"})}
        with mock.patch.object(cg.httpx, "Client", side_effect=lambda *a, **kw: _FakeHttpxClient(evil_routes)):
            with self.assertRaises(cg.CommunityGalleryError) as ctx:
                cg._download_release_asset("gallery-blueprints", "alice-12345678.json", 1024)
        self.assertEqual(ctx.exception.code, "downloadFailed")

        # Reject plain HTTP downgrade redirect
        http_routes = {start_url: (302, b"", {"Location": "http://objects.githubusercontent.com/item"})}
        with mock.patch.object(cg.httpx, "Client", side_effect=lambda *a, **kw: _FakeHttpxClient(http_routes)):
            with self.assertRaises(cg.CommunityGalleryError) as ctx2:
                cg._download_release_asset("gallery-blueprints", "alice-12345678.json", 1024)
        self.assertEqual(ctx2.exception.code, "downloadFailed")

        # Enforce size limit
        big_routes = {start_url: (200, b"x" * 200, {})}
        with mock.patch.object(cg.httpx, "Client", side_effect=lambda *a, **kw: _FakeHttpxClient(big_routes)):
            with self.assertRaises(cg.CommunityGalleryError) as ctx3:
                cg._download_release_asset("gallery-blueprints", "alice-12345678.json", 100)
        self.assertEqual(ctx3.exception.code, "sizeLimit")

    def test_blueprint_and_bundle_prefer_release_and_fallback_to_raw(self):
        os.environ.pop("POSTERIZARR_COMMUNITY_LOCAL_DIR", None)
        index, bp_bytes, ov_bytes = self._build_sample_index()

        bp_rel_url = f"{cg.COMMUNITY_RELEASE_BASE}gallery-blueprints/alice-12345678.json"
        bp_cdn_url = "https://objects.githubusercontent.com/bp-asset"
        bp_raw_url = f"{cg.COMMUNITY_RAW_BASE}blueprints/alice/blueprint.json"

        ov_rel_url = f"{cg.COMMUNITY_RELEASE_BASE}gallery-dynamic-overlays/bob-87654321.zip"
        ov_raw_url = f"{cg.COMMUNITY_RAW_BASE}dynamic-overlays/bob/bundle.zip"

        # 1) Release URL succeeds and avoids raw file fetch
        calls: list[str] = []
        routes_happy = {
            f"{cg.COMMUNITY_RAW_BASE}index.json": (200, json.dumps(index).encode("utf-8"), {}),
            cg.COMMUNITY_STATS_URL: (200, json.dumps({"blueprints": {"alice": 9}, "dynamic_overlays": {"bob": 4}}).encode("utf-8"), {}),
            bp_rel_url: (302, b"", {"Location": bp_cdn_url}),
            bp_cdn_url: (200, bp_bytes, {}),
            bp_raw_url: (500, b"should not be called", {}),
        }
        with mock.patch.object(cg.httpx, "Client", side_effect=lambda *a, **kw: _FakeHttpxClient(routes_happy, calls)):
            res = cg.fetch_community_blueprint("alice")
        self.assertEqual(res["entry"]["downloads"], 9)
        self.assertIn(bp_cdn_url, calls)
        self.assertNotIn(bp_raw_url, calls)

        # 2) Stale Release asset (SHA mismatch) falls back transparently to raw file
        calls_stale: list[str] = []
        routes_stale = {
            f"{cg.COMMUNITY_RAW_BASE}index.json": (200, json.dumps(index).encode("utf-8"), {}),
            cg.COMMUNITY_STATS_URL: (404, b"", {}),
            bp_rel_url: (200, b'{"stale": true}', {}),
            bp_raw_url: (200, bp_bytes, {}),
            ov_rel_url: (404, b"", {}),
            ov_raw_url: (200, ov_bytes, {}),
        }
        with mock.patch.object(cg.httpx, "Client", side_effect=lambda *a, **kw: _FakeHttpxClient(routes_stale, calls_stale)):
            bp_fallback = cg.fetch_community_blueprint("alice")
            ov_entry, ov_payload, token = cg.fetch_community_bundle("bob")
        self.assertEqual(bp_fallback["blueprint_name"], "Demo BP")
        self.assertIn(bp_raw_url, calls_stale)
        self.assertEqual(ov_entry["id"], "bob")
        self.assertEqual(ov_payload, ov_bytes)
        self.assertTrue(token)


if __name__ == "__main__":
    unittest.main()
