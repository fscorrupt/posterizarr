"""Release notes fetching, caching, and post-update What's New evaluation."""

import asyncio
from datetime import datetime, timezone
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

GITHUB_RELEASES_URL = "https://api.github.com/repos/fscorrupt/posterizarr/releases?per_page=15"
RELEASES_CACHE_TTL_OK = 1800
RELEASES_CACHE_TTL_FAIL = 300

_STABLE_SEMVER_RE = re.compile(r"^(\d+)\.(\d+)(?:\.(\d+))?$")

_releases_cache: Dict[str, Any] = {
    "ts": 0.0,
    "releases": None,
    "error": None,
}
_releases_lock = asyncio.Lock()


def normalize_version_tag(version_str: Optional[str]) -> Optional[str]:
    """Trim whitespace and strip a single leading 'v' or 'V' prefix."""
    if not version_str or not isinstance(version_str, str):
        return None
    cleaned = version_str.strip()
    if cleaned.lower().startswith("v"):
        cleaned = cleaned[1:].strip()
    return cleaned or None


def parse_stable_semver(version_str: Optional[str]) -> Optional[Tuple[int, int, int]]:
    """Parse strict stable semver (X.Y or X.Y.Z); suffixes like -dev/-beta return None."""
    normalized = normalize_version_tag(version_str)
    if not normalized:
        return None
    match = _STABLE_SEMVER_RE.fullmatch(normalized)
    if not match:
        return None
    major = int(match.group(1))
    minor = int(match.group(2))
    patch = int(match.group(3) or 0)
    return (major, minor, patch)


def is_version_strictly_newer(candidate: Optional[str], baseline: Optional[str]) -> bool:
    """Return True if both versions are valid stable semvers and candidate > baseline."""
    cand_tuple = parse_stable_semver(candidate)
    base_tuple = parse_stable_semver(baseline)
    if cand_tuple is None or base_tuple is None:
        return False
    return cand_tuple > base_tuple


def find_matching_stable_release(
    releases: Optional[List[Dict[str, Any]]],
    version: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Find the published non-draft, non-prerelease GitHub release matching version."""
    target_tuple = parse_stable_semver(version)
    if target_tuple is None or not releases:
        return None

    for release in releases:
        if not isinstance(release, dict):
            continue
        if release.get("is_draft") or release.get("is_prerelease"):
            continue
        rel_tuple = parse_stable_semver(release.get("version"))
        if rel_tuple is not None and rel_tuple == target_tuple:
            return release
    return None


def evaluate_whats_new(
    raw_local_version: Optional[str],
    display_local_version: Optional[str],
    last_seen_version: Optional[str],
    onboarding_completed: bool,
    releases: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """Decide whether to show the post-update What's New modal for the installed release."""
    normalized_raw = normalize_version_tag(raw_local_version)
    normalized_last_seen = normalize_version_tag(last_seen_version)
    display_version = display_local_version or raw_local_version

    result: Dict[str, Any] = {
        "should_show": False,
        "installed_version": normalized_raw,
        "display_version": display_version,
        "last_seen_version": normalized_last_seen,
        "release": None,
    }

    if not onboarding_completed:
        return result

    # Never pop up on -dev / prerelease builds (even if raw_local is stable)
    if parse_stable_semver(display_local_version) is None:
        return result

    installed_tuple = parse_stable_semver(normalized_raw)
    if installed_tuple is None:
        return result

    matched_release = find_matching_stable_release(releases, normalized_raw)
    if not matched_release:
        return result

    result["release"] = matched_release

    if normalized_last_seen:
        # Show only when installed version is strictly newer than last seen version
        if not is_version_strictly_newer(normalized_raw, normalized_last_seen):
            return result

    result["should_show"] = True
    return result


def resolve_next_seen_version(
    current_seen: Optional[str],
    dismissed_version: Optional[str],
) -> Optional[str]:
    """Return the higher normalized stable version so dismissals never move backwards."""
    norm_current = normalize_version_tag(current_seen)
    norm_dismissed = normalize_version_tag(dismissed_version)
    current_tuple = parse_stable_semver(norm_current)
    dismissed_tuple = parse_stable_semver(norm_dismissed)

    if dismissed_tuple is None:
        return norm_current if current_tuple is not None else None
    if current_tuple is None:
        return norm_dismissed
    return norm_dismissed if dismissed_tuple >= current_tuple else norm_current


def format_github_releases(
    raw_releases: List[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """Format GitHub Releases API records into Posterizarr's frontend schema."""
    formatted: List[Dict[str, Any]] = []
    reference_now = now or datetime.now(timezone.utc)

    for release in raw_releases[:15]:
        if not isinstance(release, dict) or release.get("draft"):
            continue
        published_at = release.get("published_at") or ""
        days_ago = 0
        if published_at:
            try:
                published_date = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
                if published_date.tzinfo is None:
                    published_date = published_date.replace(tzinfo=timezone.utc)
                ref = reference_now.astimezone(published_date.tzinfo)
                days_ago = max(0, (ref - published_date).days)
            except (ValueError, TypeError):
                days_ago = 0

        tag_name = release.get("tag_name") or ""
        formatted.append(
            {
                "version": tag_name,
                "name": release.get("name") or tag_name,
                "published_at": published_at,
                "days_ago": days_ago,
                "is_prerelease": bool(release.get("prerelease")),
                "is_draft": bool(release.get("draft")),
                "html_url": release.get("html_url") or "",
                "body": release.get("body") or "",
            }
        )

    return formatted


async def fetch_github_releases_cached(force_refresh: bool = False) -> Dict[str, Any]:
    """Fetch GitHub releases with TTL caching to respect GitHub rate limits."""
    async with _releases_lock:
        now_mono = time.monotonic()
        cached_releases = _releases_cache.get("releases")
        cached_error = _releases_cache.get("error")
        cached_ts = float(_releases_cache.get("ts") or 0.0)

        if not force_refresh and cached_ts > 0:
            ttl = RELEASES_CACHE_TTL_OK if cached_releases is not None else RELEASES_CACHE_TTL_FAIL
            if now_mono - cached_ts < ttl:
                if cached_releases is not None:
                    return {"success": True, "releases": cached_releases, "cached": True}
                return {
                    "success": False,
                    "error": cached_error or "Could not fetch releases from GitHub",
                    "releases": [],
                }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    GITHUB_RELEASES_URL,
                    headers={
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "Posterizarr-WebUI",
                    },
                    timeout=10.0,
                )
                response.raise_for_status()
                raw_releases = response.json()
                formatted = format_github_releases(
                    raw_releases if isinstance(raw_releases, list) else []
                )
                _releases_cache["ts"] = time.monotonic()
                _releases_cache["releases"] = formatted
                _releases_cache["error"] = None
                return {"success": True, "releases": formatted, "cached": False}
        except httpx.RequestError as exc:
            logger.error(f"Could not fetch releases from GitHub: {exc}")
            error_msg = "Could not fetch releases from GitHub"
        except Exception as exc:
            logger.error(f"Error fetching releases: {exc}")
            error_msg = str(exc)

        _releases_cache["ts"] = time.monotonic()
        if not force_refresh and cached_releases is not None:
            return {"success": True, "releases": cached_releases, "cached": True, "stale": True}
        if force_refresh and cached_releases is not None:
            return {"success": True, "releases": cached_releases, "cached": True, "stale": True}
        _releases_cache["error"] = error_msg
        return {"success": False, "error": error_msg, "releases": []}
