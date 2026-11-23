import asyncio
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import overlay_preview  # noqa: E402
import overlay_resolver  # noqa: E402
import overlay_sync_service  # noqa: E402
import ratings_service  # noqa: E402
from overlay_resolver import OverlayConfigEngine, matches_episode_air_date  # noqa: E402
from overlay_sync_service import build_overlay_layers_for_item, resolve_tmdb_show_info  # noqa: E402
from ratings_service import RatingsCacheManager  # noqa: E402


class _FakeHttpResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeAsyncHttpClient:
    def __init__(self, payload: dict, status_code: int = 200):
        self.payload = payload
        self.status_code = status_code
        self.calls = []

    async def get(self, url, headers=None, params=None, timeout=None):
        self.calls.append(url)
        return _FakeHttpResponse(self.status_code, self.payload)


class TestStatusOverlays(unittest.TestCase):
    def setUp(self):
        self.engine = OverlayConfigEngine(PROJECT_ROOT)
        self.overlays_dir = PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays"
        self.localized_rules = [
            {
                "default": "status",
                "template_variables": {
                    "horizontal_align": "center",
                    "vertical_align": "top",
                    "text_airing": "EN COURS",
                    "text_returning": "BIENTOT",
                    "text_canceled": "ANNULEE",
                    "text_ended": "TERMINE",
                },
            }
        ]

    def test_issue_703_localized_status_and_episode_air_date(self):
        today = date.today()
        d_12 = (today - timedelta(days=12)).isoformat()
        d_9 = (today - timedelta(days=9)).isoformat()
        d_300 = (today - timedelta(days=300)).isoformat()
        d_5 = (today - timedelta(days=5)).isoformat()

        # Returning Series with episode within last 14 days -> AIRING (localized EN COURS)
        layers = self.engine.evaluate_item(
            {"title": "Chicago Fire", "media_type": "show", "status": "Returning Series", "last_episode_air_date": d_12},
            self.localized_rules,
        )
        self.assertEqual(len(layers), 1)
        self.assertEqual(layers[0]["name"], "airing_shows")
        self.assertEqual(layers[0]["text"], "EN COURS")
        self.assertEqual(layers[0]["vertical_align"], "top")
        self.assertEqual(layers[0]["horizontal_align"], "center")

        layers = build_overlay_layers_for_item(
            {"title": "Black Clover", "media_type": "show", "status": "returning", "last_episode_air_date": d_9},
            self.localized_rules,
            self.overlays_dir,
        )
        self.assertEqual([(l["name"], l["text"]) for l in layers], [("airing_shows", "EN COURS")])

        # Returning Series on hiatus (300 days ago) or missing air date -> RETURNING (BIENTOT)
        layers = self.engine.evaluate_item(
            {"title": "Tokyo Revengers", "media_type": "show", "status": "Returning Series", "last_episode_air_date": d_300},
            self.localized_rules,
        )
        self.assertEqual([(l["name"], l["text"]) for l in layers], [("returning_shows", "BIENTOT")])

        layers = self.engine.evaluate_item(
            {"title": "Tokyo Revengers", "media_type": "show", "status": "returning"},
            self.localized_rules,
        )
        self.assertEqual([(l["name"], l["text"]) for l in layers], [("returning_shows", "BIENTOT")])

        # Ended & Canceled with old episodes
        layers = self.engine.evaluate_item(
            {"title": "Ended Show", "media_type": "show", "status": "ended", "last_episode_air_date": d_300},
            self.localized_rules,
        )
        self.assertEqual([(l["name"], l["text"]) for l in layers], [("ended_shows", "TERMINE")])

        layers = self.engine.evaluate_item(
            {"title": "Canceled Show", "media_type": "show", "status": "canceled", "last_episode_air_date": d_300},
            self.localized_rules,
        )
        self.assertEqual([(l["name"], l["text"]) for l in layers], [("canceled_shows", "ANNULEE")])

        # Recently ended show (finale 5 days ago) -> airing_shows (weight 40 > ended weight 10)
        layers = self.engine.evaluate_item(
            {"title": "Just Ended", "media_type": "show", "status": "ended", "last_episode_air_date": d_5},
            self.localized_rules,
        )
        self.assertEqual([(l["name"], l["text"]) for l in layers], [("airing_shows", "EN COURS")])

        # Unreleased shows (In Production, Planned, Pilot) without aired episodes -> no status banner
        for raw_status in ("In Production", "Planned", "Pilot", "in production", "planned", "pilot"):
            meta = {"title": "Upcoming", "media_type": "show", "status": raw_status}
            self.assertEqual(self.engine.evaluate_item(meta, self.localized_rules), [])
            self.assertEqual(build_overlay_layers_for_item(meta, self.localized_rules, self.overlays_dir), [])

    def test_default_english_labels_and_font_colors_preserved(self):
        today = date.today().isoformat()
        rules = [
            {
                "default": "status",
                "template_variables": {
                    "font_color_airing": "#112233",
                    "font_color_returning": "#445566",
                    "font_color_canceled": "#778899",
                    "font_color_ended": "#AABBCC",
                },
            }
        ]
        airing = self.engine.evaluate_item(
            {"title": "A", "media_type": "show", "status": "returning", "last_episode_air_date": today},
            rules,
        )
        self.assertEqual([(l["name"], l["text"], l["font_color"]) for l in airing], [("airing_shows", "AIRING", "#112233")])

        returning = self.engine.evaluate_item(
            {"title": "B", "media_type": "show", "status": "returning"},
            rules,
        )
        self.assertEqual([(l["name"], l["text"], l["font_color"]) for l in returning], [("returning_shows", "RETURNING", "#445566")])

        canceled = self.engine.evaluate_item(
            {"title": "C", "media_type": "show", "status": "canceled"},
            rules,
        )
        self.assertEqual([(l["name"], l["text"], l["font_color"]) for l in canceled], [("canceled_shows", "CANCELED", "#778899")])

        ended = self.engine.evaluate_item(
            {"title": "D", "media_type": "show", "status": "ended"},
            rules,
        )
        self.assertEqual([(l["name"], l["text"], l["font_color"]) for l in ended], [("ended_shows", "ENDED", "#AABBCC")])

    def test_episode_air_date_boundaries_and_parsing(self):
        ref = date(2026, 11, 23)
        self.assertTrue(matches_episode_air_date(14, {"last_episode_air_date": "2026-11-23"}, today=ref))
        self.assertTrue(matches_episode_air_date(14, {"last_episode_air_date": "2026-11-09"}, today=ref))
        self.assertFalse(matches_episode_air_date(14, {"last_episode_air_date": "2026-11-08"}, today=ref))
        self.assertFalse(matches_episode_air_date(14, {"last_episode_air_date": "2026-11-25"}, today=ref))
        self.assertTrue(matches_episode_air_date("14d", {"last_episode_air_date": "2026-11-15T20:00:00Z"}, today=ref))
        self.assertTrue(matches_episode_air_date("today", {"episode_air_date": "2026-11-23"}, today=ref))
        self.assertFalse(matches_episode_air_date("today", {"episode_air_date": "2026-11-22"}, today=ref))
        self.assertTrue(matches_episode_air_date("2026-11-01", {"latest_episode_air_date": "2026-11-10"}, today=ref))
        self.assertFalse(matches_episode_air_date(14, {"last_episode_air_date": None}, today=ref))
        self.assertFalse(matches_episode_air_date(14, {"last_episode_air_date": ""}, today=ref))
        self.assertFalse(matches_episode_air_date(14, {"last_episode_air_date": "not-a-date"}, today=ref))
        self.assertFalse(matches_episode_air_date("<<last_days>>", {"last_episode_air_date": "2026-11-23"}, today=ref))

    def test_unresolved_placeholder_filters_and_other_defaults(self):
        meta = {"title": "Show", "media_type": "show", "last_episode_air_date": "2026-11-23"}
        # Unresolved plex_search must NOT match
        self.assertFalse(self.engine._match_filters({"any": {"episode_air_date": "<<last_days>>"}}, meta, empty_match=False))
        # Unresolved secondary filters impose no restriction
        self.assertTrue(self.engine._match_filters({"tmdb_status": "<<tmdb>>"}, meta, empty_match=True))

        # aspect.yml text_<key> override & matching
        aspect_rules = [{"default": "aspect", "template_variables": {"text_1.78": "16:9"}}]
        aspect_layers = self.engine.evaluate_item(
            {"title": "Movie", "media_type": "movie", "aspect_ratio": 1.78},
            aspect_rules,
        )
        self.assertEqual([(l["name"], l["text"]) for l in aspect_layers], [("aspect_1.78", "16:9")])

        # network.yml & commonsense.yml still match cleanly
        net_layers = self.engine.evaluate_item(
            {"title": "Show", "media_type": "show", "networks": ["NBC"], "network": "NBC"},
            [{"default": "network"}],
        )
        self.assertEqual([l["name"] for l in net_layers], ["NBC"])

        cs_layers = self.engine.evaluate_item(
            {"title": "Movie", "media_type": "movie", "content_rating": "PG-13"},
            [{"default": "commonsense"}],
        )
        self.assertTrue(len(cs_layers) >= 1)

    def test_overlay_preview_airing_and_returning(self):
        placements = {"status": {"x": 0, "y": 23, "align": "center", "valign": "bottom"}}
        airing_layers = overlay_preview.build_preview_layers(
            {"template_type": "show_poster", "status_label": "Airing"},
            placements,
            self.localized_rules,
            self.overlays_dir,
            build_overlay_layers_for_item,
        )
        self.assertEqual([(l["name"], l["text"]) for l in airing_layers], [("airing_shows", "EN COURS")])

        returning_layers = overlay_preview.build_preview_layers(
            {"template_type": "show_poster", "status_label": "Returning"},
            placements,
            self.localized_rules,
            self.overlays_dir,
            build_overlay_layers_for_item,
        )
        self.assertEqual([(l["name"], l["text"]) for l in returning_layers], [("returning_shows", "BIENTOT")])

    def test_sync_fallback_when_status_yml_absent(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            empty_overlays = tmp_root / "Overlayfiles" / "dynamic_overlays"
            (empty_overlays / "defaults").mkdir(parents=True)
            (empty_overlays / "assets").mkdir(parents=True)
            (empty_overlays / "fonts").mkdir(parents=True)
            recent = (date.today() - timedelta(days=3)).isoformat()
            old = (date.today() - timedelta(days=90)).isoformat()

            with (
                patch.object(overlay_resolver, "PROJECT_ROOT", tmp_root),
                patch.object(overlay_sync_service, "PROJECT_ROOT", tmp_root),
                patch.object(overlay_sync_service, "_CACHED_CONFIG_ENGINE", None, create=True),
                patch.object(overlay_sync_service, "_CACHED_CONFIG_ENGINE_ROOT", None, create=True),
            ):
                layers_airing = build_overlay_layers_for_item(
                    {"title": "Show", "media_type": "show", "status": "returning", "last_episode_air_date": recent},
                    self.localized_rules,
                    empty_overlays,
                )
                self.assertEqual(len(layers_airing), 1)
                self.assertEqual(layers_airing[0]["name"], "status")
                self.assertEqual(layers_airing[0]["text"], "EN COURS")
                self.assertEqual(layers_airing[0]["vertical_align"], "top")

                layers_ret = build_overlay_layers_for_item(
                    {"title": "Show", "media_type": "show", "status": "returning", "last_episode_air_date": old},
                    self.localized_rules,
                    empty_overlays,
                )
                self.assertEqual(len(layers_ret), 1)
                self.assertEqual(layers_ret[0]["name"], "status")
                self.assertEqual(layers_ret[0]["text"], "BIENTOT")
                self.assertEqual(layers_ret[0]["vertical_align"], "top")

    def test_ratings_cache_migration_and_air_date_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "ratings_cache.db"
            # Seed a legacy table without last_episode_air_date
            conn = sqlite3.connect(db_path)
            future_exp = (datetime.utcnow() + timedelta(days=5)).isoformat()
            now_iso = datetime.utcnow().isoformat()
            conn.execute("""
                CREATE TABLE media_ratings_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    server_type TEXT NOT NULL,
                    item_id TEXT NOT NULL,
                    media_type TEXT DEFAULT 'movie',
                    title TEXT,
                    year INTEGER,
                    imdb_id TEXT,
                    tmdb_id INTEGER,
                    imdb_rating REAL,
                    tmdb_rating REAL,
                    rt_critic_rating INTEGER,
                    rt_audience_rating INTEGER,
                    trakt_rating REAL,
                    metacritic_rating INTEGER,
                    letterboxd_rating REAL,
                    mdblist_rating REAL,
                    show_status TEXT,
                    network TEXT,
                    content_rating TEXT,
                    source TEXT DEFAULT 'plex',
                    cached_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    UNIQUE(server_type, item_id)
                )
            """)
            conn.execute(
                "INSERT INTO media_ratings_cache (server_type, item_id, media_type, title, tmdb_id, show_status, cached_at, expires_at) "
                "VALUES ('plex', '101', 'show', 'Legacy Show', '555', 'returning', ?, ?)",
                (now_iso, future_exp),
            )
            conn.commit()
            conn.close()

            cache = RatingsCacheManager(db_path=db_path)
            legacy = cache.get_show_status("plex", "101", "555")
            self.assertIsNotNone(legacy)
            self.assertIsNone(legacy["last_episode_air_date"])

            # Save non-empty air date -> round-trips
            cache.save_show_status(
                server_type="plex",
                item_id="101",
                title="Legacy Show",
                year=2020,
                tmdb_id="555",
                status="returning",
                last_episode_air_date="2026-11-11",
            )
            updated = cache.get_show_status("plex", "101", "555")
            self.assertEqual(updated["last_episode_air_date"], "2026-11-11")

            # Save empty string (TMDb returned no last_episode_to_air) -> distinct from None
            cache.save_show_status(
                server_type="plex",
                item_id="102",
                title="Upcoming Show",
                year=2026,
                tmdb_id="556",
                status="in production",
                last_episode_air_date="",
            )
            upcoming = cache.get_show_status("plex", "102", "556")
            self.assertEqual(upcoming["last_episode_air_date"], "")
            self.assertEqual(upcoming["status"], "in production")

    def test_resolve_tmdb_show_info_extracts_air_date_and_statuses(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            temp_cache = RatingsCacheManager(db_path=Path(tmpdir) / "tmdb_test.db")
            overlay_sync_service._TMDB_SHOW_CACHE.clear()

            async def _run():
                with patch.object(ratings_service, "ratings_cache", temp_cache):
                    client_ret = _FakeAsyncHttpClient({
                        "status": "Returning Series",
                        "networks": [{"name": "NBC"}],
                        "last_episode_to_air": {"air_date": "2026-11-11"},
                        "content_ratings": {"results": []},
                    })
                    info_ret = await resolve_tmdb_show_info(
                        tmdb_id="900001",
                        tmdb_token="dummy",
                        http_client=client_ret,
                        server_type="plex",
                        item_id="900001",
                        title="Chicago Fire",
                    )
                    self.assertEqual(info_ret["status"], "returning")
                    self.assertEqual(info_ret["last_episode_air_date"], "2026-11-11")
                    self.assertEqual(len(client_ret.calls), 1)

                    # Second call hits SQLite cache without HTTP call
                    overlay_sync_service._TMDB_SHOW_CACHE.clear()
                    client_cached = _FakeAsyncHttpClient({})
                    info_cached = await resolve_tmdb_show_info(
                        tmdb_id="900001",
                        tmdb_token="dummy",
                        http_client=client_cached,
                        server_type="plex",
                        item_id="900001",
                        title="Chicago Fire",
                    )
                    self.assertEqual(info_cached["last_episode_air_date"], "2026-11-11")
                    self.assertEqual(len(client_cached.calls), 0)

                    # Unreleased statuses map to themselves, and missing last_episode_to_air -> ""
                    for idx, (tmdb_status, expected_norm) in enumerate(
                        [("In Production", "in production"), ("Planned", "planned"), ("Pilot", "pilot")],
                        start=900010,
                    ):
                        client_u = _FakeAsyncHttpClient({
                            "status": tmdb_status,
                            "networks": [],
                            "last_episode_to_air": None,
                            "content_ratings": {"results": []},
                        })
                        info_u = await resolve_tmdb_show_info(
                            tmdb_id=str(idx),
                            tmdb_token="dummy",
                            http_client=client_u,
                            server_type="plex",
                            item_id=str(idx),
                            title=tmdb_status,
                        )
                        self.assertEqual(info_u["status"], expected_norm)
                        self.assertEqual(info_u["last_episode_air_date"], "")

            asyncio.run(_run())
            overlay_sync_service._TMDB_SHOW_CACHE.clear()


if __name__ == "__main__":
    unittest.main()
