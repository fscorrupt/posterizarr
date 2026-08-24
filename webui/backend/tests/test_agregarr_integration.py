import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from webui.backend.agregarr_integration import (
    AgregarrIntegrationStore,
    normalize_agregarr_url,
)


class AgregarrIntegrationStoreTests(unittest.TestCase):
    def test_save_load_and_public_response_do_not_expose_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agregarr_integration.json"
            store = AgregarrIntegrationStore(path)
            store.save(
                {
                    "enabled": True,
                    "url": "http://agregarr:7171",
                    "api_key": "top-secret",
                }
            )

            loaded = store.load()
            self.assertEqual(loaded["api_key"], "top-secret")
            public = store.public(store.effective(loaded))
            self.assertTrue(public["api_key_configured"])
            self.assertNotIn("api_key", public)

            on_disk = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(on_disk["url"], "http://agregarr:7171")

    def test_environment_values_override_file_independently(self):
        store = AgregarrIntegrationStore(Path("unused.json"))
        stored = {
            "enabled": False,
            "url": "http://file-value:7171",
            "api_key": "file-key",
        }
        with patch.dict(
            os.environ,
            {
                "AGREGARR_TRIGGER_ENABLED": "true",
                "AGREGARR_URL": "http://environment-value:7171/",
            },
            clear=False,
        ):
            effective = store.effective(stored)

        self.assertTrue(effective["enabled"])
        self.assertEqual(effective["url"], "http://environment-value:7171")
        self.assertEqual(effective["api_key"], "file-key")
        self.assertTrue(effective["environment_overrides"]["enabled"])
        self.assertFalse(effective["environment_overrides"]["api_key"])

    def test_url_validation_accepts_base_urls_only(self):
        self.assertEqual(
            normalize_agregarr_url("https://agregarr.example:7171/"),
            "https://agregarr.example:7171",
        )
        for invalid in (
            "ftp://agregarr",
            "http://user:password@agregarr:7171",
            "http://agregarr:7171/api/v1/status",
            "http://agregarr:7171?token=secret",
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    normalize_agregarr_url(invalid)


if __name__ == "__main__":
    unittest.main()
