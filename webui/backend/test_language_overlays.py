import sys
import tempfile
import unittest
from pathlib import Path
from xml.etree.ElementTree import fromstring

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import overlay_preview  # noqa: E402
from overlay_cache import compute_metadata_hash  # noqa: E402
from overlay_resolver import OverlayConfigEngine, language_base_code, normalize_language_tag  # noqa: E402
from overlay_sync_service import (  # noqa: E402
    _emby_episode_stream_summary,
    _extract_stream_overlay_metadata,
    _parse_jellyfin_item,
    _plex_episode_stream_summary,
    _rules_use_regional_languages,
    aggregate_episode_streams,
    build_overlay_layers_for_item,
)


CUSTOM_FR_CA_YAML = """
overlays:
  french_canada:
    plex_search:
      any:
        audio_language: fr-CA
    overlay:
      name: french_canada
      default: flag/round/ca
      horizontal_align: left
      vertical_align: bottom
      horizontal_offset: 15
      vertical_offset: 15
"""

CUSTOM_SUB_PT_BR_YAML = """
overlays:
  portuguese_brazil_sub:
    plex_search:
      any:
        subtitle_language: pt-BR
    overlay:
      name: portuguese_brazil_sub
      default: flag/round/br
      horizontal_align: right
      vertical_align: bottom
      horizontal_offset: 15
      vertical_offset: 15
"""


def _write_custom_yaml(root: Path, filename: str, content: str) -> Path:
    cfg_dir = root / "Overlayfiles" / "dynamic_overlays" / "configs"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    path = cfg_dir / filename
    path.write_text(content, encoding="utf-8")
    return path


def _plex_movie_audio_meta(xml_text: str) -> dict:
    root = fromstring(xml_text)
    meta = _extract_stream_overlay_metadata(root)
    summary = _plex_episode_stream_summary(root)
    return {
        "title": "Test Movie",
        "media_type": "movie",
        "audio_languages": summary["audio_languages"],
        "audio_language_tags": summary["audio_language_tags"],
        "subtitle_languages": meta["subtitle_languages"],
        "subtitle_language_tags": meta["subtitle_language_tags"],
    }


class TestLanguageOverlays(unittest.TestCase):
    def setUp(self):
        self.overlays_dir = PROJECT_ROOT / "Overlayfiles" / "dynamic_overlays"
        self.engine = OverlayConfigEngine(PROJECT_ROOT)

    def test_language_tag_normalization(self):
        for raw in ("fr-CA", "fr-ca", "fra-CA", "fre-CA", "fr_CA", "Français (Canada)", "French (Canada)"):
            self.assertEqual(normalize_language_tag(raw), "fr-ca", msg=f"Failed for {raw!r}")
            self.assertEqual(language_base_code(raw), "fr", msg=f"Base failed for {raw!r}")

        self.assertEqual(normalize_language_tag("pt-BR"), "pt-br")
        self.assertEqual(normalize_language_tag("por-BR"), "pt-br")
        self.assertEqual(normalize_language_tag("es-419"), "es-419")
        self.assertEqual(normalize_language_tag("zh-Hant"), "zh-hant")
        self.assertEqual(normalize_language_tag("Chinese (Traditional)"), "zh-hant")
        self.assertEqual(normalize_language_tag("fra"), "fr")
        self.assertEqual(normalize_language_tag("fre"), "fr")
        self.assertIsNone(normalize_language_tag("und"))
        self.assertIsNone(normalize_language_tag("unknown"))
        self.assertIsNone(normalize_language_tag(""))

    def test_plex_xml_stream_extraction_preserves_language_tag(self):
        meta_fr_ca = _plex_movie_audio_meta("""
            <MediaContainer>
                <Video ratingKey="1" title="Movie">
                    <Media>
                        <Part>
                            <Stream streamType="2" languageCode="fra" languageTag="fr-CA" language="Français (Canada)" />
                        </Part>
                    </Media>
                </Video>
            </MediaContainer>
        """)
        self.assertEqual(meta_fr_ca["audio_languages"], ["fr"])
        self.assertEqual(meta_fr_ca["audio_language_tags"], ["fr-ca"])

        meta_fr = _plex_movie_audio_meta("""
            <MediaContainer>
                <Video ratingKey="2" title="Movie">
                    <Media>
                        <Part>
                            <Stream streamType="2" languageCode="fra" languageTag="fr" />
                        </Part>
                    </Media>
                </Video>
            </MediaContainer>
        """)
        self.assertEqual(meta_fr["audio_languages"], ["fr"])
        self.assertEqual(meta_fr["audio_language_tags"], ["fr"])

        meta_multi = _plex_movie_audio_meta("""
            <MediaContainer>
                <Video ratingKey="3" title="Movie">
                    <Media>
                        <Part>
                            <Stream streamType="2" languageCode="eng" languageTag="en-US" />
                            <Stream streamType="2" languageCode="fra" languageTag="fr-CA" />
                            <Stream streamType="3" languageCode="por" languageTag="pt-BR" />
                        </Part>
                    </Media>
                </Video>
            </MediaContainer>
        """)
        self.assertEqual(meta_multi["audio_languages"], ["en", "fr"])
        self.assertEqual(meta_multi["audio_language_tags"], ["en-us", "fr-ca"])
        self.assertEqual(meta_multi["subtitle_languages"], ["pt"])
        self.assertEqual(meta_multi["subtitle_language_tags"], ["pt-br"])

    def test_jellyfin_emby_extraction_preserves_region(self):
        jf_item = _parse_jellyfin_item(
            {
                "Id": "10",
                "Name": "Movie",
                "Type": "Movie",
                "MediaStreams": [
                    {"Type": "Audio", "Language": "fr-CA", "DisplayLanguage": "French"},
                    {"Type": "Audio", "Language": "fre", "DisplayLanguage": "French (Canada)"},
                    {"Type": "Subtitle", "Language": "pt-BR", "DisplayLanguage": "Portuguese (Brazil)"},
                ],
            },
            "Movies",
        )
        self.assertEqual(jf_item["audio_languages"], ["fr"])
        self.assertEqual(jf_item["audio_language_tags"], ["fr-ca"])
        self.assertEqual(jf_item["subtitle_languages"], ["pt"])
        self.assertEqual(jf_item["subtitle_language_tags"], ["pt-br"])

        ep_summary = _emby_episode_stream_summary({
            "MediaStreams": [
                {"Type": "Audio", "Language": "fre", "DisplayLanguage": "French (Canada)"},
            ]
        })
        self.assertEqual(ep_summary["audio_languages"], ["fr"])
        self.assertEqual(ep_summary["audio_language_tags"], ["fr-ca"])

    def test_issue_704_fr_ca_matches_and_suppresses_generic_fr(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            _write_custom_yaml(tmp_root, "custom_fr_ca.yml", CUSTOM_FR_CA_YAML)
            engine = OverlayConfigEngine(tmp_root)

            lang_rule = {"default": "languages", "template_variables": {"builder_level": "movie", "languages": ["en", "fr"], "overlay_limit": 2}}
            ca_rule = {"file": "config/custom_fr_ca.yml"}

            # 1. Movie with ONLY fr-CA + both rules (tested in BOTH orders): only Canadian flag renders
            only_fr_ca = {"title": "Quebec Film", "media_type": "movie", "audio_languages": ["fr"], "audio_language_tags": ["fr-ca"]}
            for rules in ([lang_rule, ca_rule], [ca_rule, lang_rule]):
                layers = engine.evaluate_item(only_fr_ca, rules)
                self.assertEqual([l["name"] for l in layers], ["french_canada"])

            # 2. Target aliases fr-CA, fr-ca, fra-CA, fre-CA, Français (Canada) all match fr-CA
            for target_val in ("fr-CA", "fr-ca", "fra-CA", "fre-CA", "Français (Canada)"):
                self.assertTrue(engine._check_condition("audio_language", target_val, only_fr_ca), msg=f"Failed for {target_val!r}")

            # 3. Backwards compatibility: default: languages ALONE still shows French flag for fr-CA
            layers_legacy = engine.evaluate_item(only_fr_ca, [lang_rule])
            self.assertEqual([l["name"] for l in layers_legacy], ["french"])

            # 4. Movie with BOTH fr-CA and fr tracks -> BOTH Canadian and French flags render
            both_fr = {"title": "Dual FR Film", "media_type": "movie", "audio_languages": ["fr"], "audio_language_tags": ["fr-ca", "fr"]}
            layers_both = engine.evaluate_item(both_fr, [lang_rule, ca_rule])
            self.assertEqual({l["name"] for l in layers_both}, {"french_canada", "french"})

            both_fr_fr = {"title": "Dual FR-FR Film", "media_type": "movie", "audio_languages": ["fr"], "audio_language_tags": ["fr-ca", "fr-fr"]}
            layers_both_regional = engine.evaluate_item(both_fr_fr, [lang_rule, ca_rule])
            self.assertEqual({l["name"] for l in layers_both_regional}, {"french_canada", "french"})

            # 5. Movie with ONLY fr or fr-FR -> only French flag renders (fr-CA does NOT match)
            only_fr = {"title": "Paris Film", "media_type": "movie", "audio_languages": ["fr"], "audio_language_tags": ["fr-fr"]}
            layers_fr = engine.evaluate_item(only_fr, [lang_rule, ca_rule])
            self.assertEqual([l["name"] for l in layers_fr], ["french"])

            # 6. en-US + fr-CA with overlay_limit=2 -> English + Canadian (suppressed fr doesn't waste a slot)
            en_and_fr_ca = {"title": "Bilingual Film", "media_type": "movie", "audio_languages": ["en", "fr"], "audio_language_tags": ["en-us", "fr-ca"]}
            layers_bilingual = engine.evaluate_item(en_and_fr_ca, [lang_rule, ca_rule])
            self.assertEqual({l["name"] for l in layers_bilingual}, {"french_canada", "english"})

            # 7. Regional rule detector catches custom YAML file
            self.assertTrue(_rules_use_regional_languages(tmp_root / "Overlayfiles" / "dynamic_overlays", [lang_rule, ca_rule]))
            self.assertFalse(_rules_use_regional_languages(tmp_root / "Overlayfiles" / "dynamic_overlays", [lang_rule]))

    def test_language_count_and_metadata_hash_unchanged(self):
        # Single fr-CA track keeps len(audio_languages) == 1 so languages_count.gte: 2 is False
        single_fr_ca = {"title": "Film", "media_type": "movie", "audio_languages": ["fr"], "audio_language_tags": ["fr-ca"]}
        self.assertEqual(len(single_fr_ca["audio_languages"]), 1)
        self.assertFalse(self.engine._check_condition("languages_count.gte", 2, single_fr_ca))

        # compute_metadata_hash uses canonical base audio_languages so hashes stay identical
        self.assertEqual(
            compute_metadata_hash(languages=["en", "fr"]),
            compute_metadata_hash(languages=single_fr_ca["audio_languages"] + ["en"]),
        )

    def test_parent_show_aggregation_and_precedence(self):
        episodes = [
            {"audio_languages": ["fr"], "audio_language_tags": ["fr-ca"], "subtitle_languages": [], "subtitle_language_tags": []},
            {"audio_languages": ["fr"], "audio_language_tags": ["fr-ca"], "subtitle_languages": [], "subtitle_language_tags": []},
        ]
        agg = aggregate_episode_streams(episodes, language_order=["en", "fr"])
        self.assertEqual(agg["audio_languages"], ["fr"])
        self.assertEqual(agg["audio_language_tags"], ["fr-ca"])

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            show_ca_yaml = CUSTOM_FR_CA_YAML.replace("  french_canada:", "  french_canada:\n    builder_level: show")
            _write_custom_yaml(tmp_root, "custom_fr_ca.yml", show_ca_yaml)

            rules = [
                {"default": "languages", "template_variables": {"builder_level": "show", "languages": ["en", "fr"]}},
                {"file": "config/custom_fr_ca.yml"},
            ]
            show_meta = {
                "title": "Quebec Series",
                "media_type": "show",
                "audio_languages": agg["audio_languages"],
                "audio_language_tags": agg["audio_language_tags"],
                "_aggregated_episode_streams": True,
                "_language_order_precomputed": True,
            }
            layers = build_overlay_layers_for_item(show_meta, rules, tmp_root / "Overlayfiles" / "dynamic_overlays")
            names = [l["name"] for l in layers]
            self.assertIn("french_canada", names)
            self.assertNotIn("language_flag_fr", names)

    def test_subtitle_regional_rule_and_preview(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            _write_custom_yaml(tmp_root, "custom_pt_br.yml", CUSTOM_SUB_PT_BR_YAML)
            _write_custom_yaml(tmp_root, "custom_fr_ca.yml", CUSTOM_FR_CA_YAML)
            flag_dir = tmp_root / "Overlayfiles" / "dynamic_overlays" / "assets" / "flag" / "round"
            flag_dir.mkdir(parents=True, exist_ok=True)
            for fname in ("ca.png", "us.png", "fr.png", "br.png"):
                Image.new("RGBA", (8, 8), (255, 0, 0, 255)).save(flag_dir / fname)
            engine = OverlayConfigEngine(tmp_root)

            sub_rule = {"default": "languages", "template_variables": {"builder_level": "movie", "use_subtitles": True, "languages": ["en", "pt"]}}
            br_rule = {"file": "config/custom_pt_br.yml"}

            only_pt_br = {"title": "BR Sub Film", "media_type": "movie", "subtitle_languages": ["pt"], "subtitle_language_tags": ["pt-br"]}
            layers = engine.evaluate_item(only_pt_br, [sub_rule, br_rule])
            self.assertEqual([l["name"] for l in layers], ["portuguese_brazil_sub"])

            # Live Preview with regional code parses base + tag cleanly
            preview_layers = overlay_preview.build_preview_layers(
                {"template_type": "movie_poster", "languages": "en,fr-CA"},
                {"languages": {"x": 30, "y": 35, "align": "left", "valign": "bottom"}},
                [{"default": "languages", "template_variables": {"builder_level": "movie", "languages": ["en", "fr"]}}, {"file": "config/custom_fr_ca.yml"}],
                tmp_root / "Overlayfiles" / "dynamic_overlays",
                build_overlay_layers_for_item,
            )
            self.assertEqual({l["name"] for l in preview_layers}, {"english", "french_canada"})


if __name__ == "__main__":
    unittest.main()
