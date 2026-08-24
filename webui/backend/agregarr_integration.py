"""Persistence and environment override handling for the Agregarr callback."""

from __future__ import annotations

import json
import os
import urllib.parse
from pathlib import Path
from typing import Any, Optional


def parse_bool(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def normalize_agregarr_url(value: Any) -> str:
    url = str(value or "").strip().rstrip("/")
    if not url:
        return ""

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Agregarr URL must be a valid http:// or https:// address")
    if parsed.username or parsed.password:
        raise ValueError("Agregarr URL must not contain credentials")
    if parsed.path not in {"", "/"} or parsed.params or parsed.query or parsed.fragment:
        raise ValueError(
            "Agregarr URL must be a base address without a path, query, or fragment"
        )
    return url


class AgregarrIntegrationStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    def load(self) -> dict:
        settings = {"enabled": False, "url": "", "api_key": ""}
        if not self.path.exists():
            return settings

        with open(self.path, "r", encoding="utf-8") as f:
            stored = json.load(f)
        if not isinstance(stored, dict):
            raise ValueError("Agregarr integration settings must be a JSON object")

        settings["enabled"] = parse_bool(stored.get("enabled"))
        settings["url"] = normalize_agregarr_url(stored.get("url"))
        settings["api_key"] = str(stored.get("api_key") or "").strip()
        return settings

    def effective(self, stored: Optional[dict] = None) -> dict:
        stored = stored or self.load()
        env_enabled = os.getenv("AGREGARR_TRIGGER_ENABLED")
        env_url = os.getenv("AGREGARR_URL")
        env_api_key = os.getenv("AGREGARR_API_KEY")

        enabled_override = env_enabled is not None and env_enabled.strip() != ""
        url_override = env_url is not None and env_url.strip() != ""
        api_key_override = env_api_key is not None and env_api_key.strip() != ""

        return {
            "enabled": parse_bool(env_enabled)
            if enabled_override
            else bool(stored.get("enabled")),
            "url": normalize_agregarr_url(env_url)
            if url_override
            else str(stored.get("url") or ""),
            "api_key": str(env_api_key).strip()
            if api_key_override
            else str(stored.get("api_key") or ""),
            "environment_overrides": {
                "enabled": enabled_override,
                "url": url_override,
                "api_key": api_key_override,
            },
        }

    @staticmethod
    def public(settings: dict) -> dict:
        return {
            "enabled": bool(settings.get("enabled")),
            "url": str(settings.get("url") or ""),
            "api_key_configured": bool(settings.get("api_key")),
            "environment_overrides": settings.get("environment_overrides", {}),
        }

    def save(self, settings: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.path.with_suffix(".json.tmp")
        with open(temporary_path, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary_path, self.path)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass
