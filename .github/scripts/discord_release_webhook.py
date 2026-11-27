"""Format GitHub release notes cleanly and post them to a Discord webhook."""

from __future__ import annotations

from datetime import datetime, timezone
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_USER_AGENT = "Posterizarr-Release-Webhook/1.0"
DISCORD_MAX_DESCRIPTION = 4096
DISCORD_MAX_TITLE = 256
DISCORD_MAX_FOOTER = 2048
DISCORD_MAX_EMBED_TOTAL = 5900

_CODE_BLOCK_RE = re.compile(r"(?m)^```[^\n]*\n[\s\S]*?^```[ \t]*$")
_HTML_IMG_RE = re.compile(r"<img\b[^>]*\bsrc=[\"'](https?://[^\"']+)[\"'][^>]*>", re.IGNORECASE)
_ANY_HTML_IMG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_MD_STANDALONE_IMG_RE = re.compile(r"(?m)^[ \t]*!\[[^\]]*\]\((https?://[^)\s]+)\)[ \t]*$")
_HTML_ANCHOR_RE = re.compile(
    r"<a\b[^>]*\bhref=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>",
    re.IGNORECASE | re.DOTALL,
)
_HTML_P_BLOCK_RE = re.compile(r"<p\b[^>]*>(.*?)</p>", re.IGNORECASE | re.DOTALL)
_HTML_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_HTML_HR_RE = re.compile(r"<hr\b[^>]*/?>", re.IGNORECASE)
_HTML_STRONG_RE = re.compile(r"<(?:strong|b)\b[^>]*>(.*?)</(?:strong|b)>", re.IGNORECASE | re.DOTALL)
_HTML_EM_RE = re.compile(r"<(?:em|i)\b[^>]*>(.*?)</(?:em|i)>", re.IGNORECASE | re.DOTALL)
_HTML_CODE_RE = re.compile(r"<code\b[^>]*>(.*?)</code>", re.IGNORECASE | re.DOTALL)
_HTML_LI_OPEN_RE = re.compile(r"<li\b[^>]*>", re.IGNORECASE)
_HTML_ALLOWED_STRIP_RE = re.compile(
    r"</?(?:p|div|span|details|summary|center|table|thead|tbody|tr|td|th|ul|ol|li|strong|b|em|i|code|h[1-6]|hr)\b[^>]*>",
    re.IGNORECASE,
)
_TABLE_SEP_RE = re.compile(r"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$")
_HR_LINE_RE = re.compile(r"^\s*([-*_])(?:\s*\1){2,}\s*$")
_H1_LINE_RE = re.compile(r"^#\s+(.+)$")
_H2_LINE_RE = re.compile(r"^##\s+(.+)$")
_ANY_HEADING_RE = re.compile(r"^#{1,6}\s+.*$")
_FENCE_LINE_RE = re.compile(r"^\s*```")


def _strip_inner_tags(raw: str) -> str:
    return re.sub(r"<[^>]+>", "", raw)


def _protect_code_blocks(text: str) -> tuple[str, list[str]]:
    blocks: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        token = f"\x00CODEBLOCK_{len(blocks)}\x00"
        blocks.append(match.group(0))
        return token

    return _CODE_BLOCK_RE.sub(_replace, text), blocks


def _restore_code_blocks(text: str, blocks: list[str]) -> str:
    for idx, block in enumerate(blocks):
        text = text.replace(f"\x00CODEBLOCK_{idx}\x00", block)
    return text


def _extract_banner_and_strip_images(text: str) -> tuple[str, str | None]:
    html_match = _HTML_IMG_RE.search(text)
    md_match = _MD_STANDALONE_IMG_RE.search(text)

    banner_url: str | None = None
    if html_match and md_match:
        banner_url = html_match.group(1) if html_match.start() <= md_match.start() else md_match.group(1)
    elif html_match:
        banner_url = html_match.group(1)
    elif md_match:
        banner_url = md_match.group(1)

    if banner_url:
        banner_url = html.unescape(banner_url).strip()

    cleaned = _ANY_HTML_IMG_RE.sub("", text)
    cleaned = _MD_STANDALONE_IMG_RE.sub("", cleaned)
    return cleaned, banner_url


def _convert_html_to_markdown(text: str) -> str:
    def _anchor_repl(match: re.Match[str]) -> str:
        href = html.unescape(match.group(1)).strip()
        raw_label = _strip_inner_tags(match.group(2))
        label = re.sub(r"\s+", " ", html.unescape(raw_label)).strip()
        return f"[{label}]({href})" if label else href

    text = _HTML_ANCHOR_RE.sub(_anchor_repl, text)

    def _link_bar_repl(match: re.Match[str]) -> str:
        inner = match.group(1).strip()
        if "\n\n" not in inner and inner.count("](http") >= 2 and ("·" in inner or "|" in inner):
            return re.sub(r"\s+", " ", inner).strip()
        return match.group(0)

    text = _HTML_P_BLOCK_RE.sub(_link_bar_repl, text)
    text = _HTML_BR_RE.sub("\n", text)
    text = _HTML_HR_RE.sub("\n", text)
    text = _HTML_STRONG_RE.sub(lambda m: f"**{m.group(1).strip()}**" if m.group(1).strip() else "", text)
    text = _HTML_EM_RE.sub(lambda m: f"*{m.group(1).strip()}*" if m.group(1).strip() else "", text)
    text = _HTML_CODE_RE.sub(lambda m: f"`{m.group(1).strip()}`" if m.group(1).strip() else "", text)
    text = _HTML_LI_OPEN_RE.sub("- ", text)
    text = _HTML_ALLOWED_STRIP_RE.sub("", text)
    text = html.unescape(text).replace("\xa0", " ")
    return text


def _split_table_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|") and not stripped.endswith("\\|"):
        stripped = stripped[:-1]
    cells = re.split(r"(?<!\\)\|", stripped)
    return [cell.replace("\\|", "|").strip() for cell in cells]


def _convert_markdown_tables(lines: list[str]) -> list[str]:
    result: list[str] = []
    idx = 0
    total = len(lines)

    while idx < total:
        if (
            idx + 2 < total
            and "|" in lines[idx]
            and _TABLE_SEP_RE.match(lines[idx + 1])
            and "|" in lines[idx + 2]
            and lines[idx + 2].strip()
        ):
            idx += 2  # Skip table header and separator lines.
            while idx < total and lines[idx].strip() and "|" in lines[idx]:
                cells = _split_table_row(lines[idx])
                non_empty = [c for c in cells if c]
                if len(cells) == 2:
                    if len(non_empty) == 2:
                        result.append(f"- {non_empty[0]} — {non_empty[1]}")
                    elif len(non_empty) == 1:
                        result.append(f"- {non_empty[0]}")
                elif non_empty:
                    result.append(f"- {' · '.join(non_empty)}")
                idx += 1
            continue

        result.append(lines[idx])
        idx += 1

    return result


def _version_candidates(release_name: str, tag_name: str) -> list[str]:
    candidates: list[str] = []
    for raw in (tag_name, release_name):
        cleaned = raw.strip()
        if not cleaned:
            continue
        normalized = re.sub(r"^[vV]\.?\s*", "", cleaned).strip()
        for value in (normalized, cleaned):
            if value and value.lower() not in {c.lower() for c in candidates}:
                candidates.append(value)
    return candidates


def _transform_headings_and_hrs(lines: list[str], release_name: str, tag_name: str) -> list[str]:
    versions = _version_candidates(release_name, tag_name)
    dropped_first_h1 = False
    seen_non_empty = False
    out: list[str] = []

    for line in lines:
        if _HR_LINE_RE.match(line):
            continue

        stripped = line.strip()
        if not seen_non_empty and stripped:
            seen_non_empty = True
            h1_match = _H1_LINE_RE.match(stripped)
            if h1_match and not dropped_first_h1:
                h1_lower = h1_match.group(1).lower()
                if any(ver.lower() in h1_lower for ver in versions):
                    dropped_first_h1 = True
                    continue

        if _H1_LINE_RE.match(line):
            out.append(_H1_LINE_RE.sub(r"## \1", line))
        elif _H2_LINE_RE.match(line):
            out.append(_H2_LINE_RE.sub(r"### \1", line))
        else:
            out.append(line)

    return out


def _truncate_cleanly(text: str, max_length: int, release_url: str) -> str:
    limit = min(max_length, DISCORD_MAX_DESCRIPTION)
    if len(text) <= limit:
        return text

    suffix = f"\n\n… [Read full release notes on GitHub]({release_url})" if release_url else "\n\n…"
    if limit <= len(suffix):
        return text[:limit]

    budget = limit - len(suffix)
    head = text[:budget]

    cut_nl = head.rfind("\n")
    if cut_nl > 0:
        head = head[:cut_nl]
    else:
        cut_sp = head.rfind(" ")
        if cut_sp > 0:
            head = head[:cut_sp]

    # Never leave an unclosed fenced code block behind after truncation.
    fence_lines = [i for i, line in enumerate(head.splitlines()) if _FENCE_LINE_RE.match(line)]
    if len(fence_lines) % 2 == 1:
        head = "\n".join(head.splitlines()[: fence_lines[-1]])

    lines = head.splitlines()
    while lines:
        tail = lines[-1].strip()
        if not tail or _ANY_HEADING_RE.match(tail) or tail in {">", "-", "*"}:
            lines.pop()
            continue
        break

    trimmed = "\n".join(lines).rstrip()
    if not trimmed:
        return text[:budget].rstrip() + suffix
    return trimmed + suffix


def format_release_body_for_discord(
    body: str,
    release_name: str = "",
    tag_name: str = "",
    release_url: str = "",
    max_length: int = 3900,
) -> tuple[str, str | None]:
    """Convert GitHub release Markdown/HTML into a Discord-friendly embed description."""
    normalized = (body or "").replace("\r\n", "\n").replace("\r", "\n")
    protected, code_blocks = _protect_code_blocks(normalized)
    without_images, banner_url = _extract_banner_and_strip_images(protected)
    markdown_text = _convert_html_to_markdown(without_images)

    lines = [line.rstrip() for line in markdown_text.split("\n")]
    lines = _convert_markdown_tables(lines)
    lines = _transform_headings_and_hrs(lines, release_name=release_name, tag_name=tag_name)

    restored = _restore_code_blocks("\n".join(lines), code_blocks)
    cleaned_lines = [line.rstrip() for line in restored.split("\n")]
    collapsed = re.sub(r"\n{3,}", "\n\n", "\n".join(cleaned_lines)).strip()

    final_text = _truncate_cleanly(collapsed, max_length=max_length, release_url=release_url)
    return final_text, banner_url


def build_discord_payload(
    release: dict,
    *,
    username: str = "",
    avatar_url: str = "",
    color: int = 2105893,
    content: str = "",
    footer_title: str = "",
    footer_icon_url: str = "",
    footer_timestamp: bool = True,
    max_description: int = 3900,
) -> dict:
    """Build a Discord webhook JSON payload for a GitHub release object."""
    tag_name = str(release.get("tag_name") or "").strip()
    title = (str(release.get("name") or "").strip() or tag_name or "New Release")[:DISCORD_MAX_TITLE]
    release_url = str(release.get("html_url") or "").strip()
    raw_body = str(release.get("body") or "")
    footer_text = footer_title[:DISCORD_MAX_FOOTER]

    max_desc_budget = min(int(max_description), DISCORD_MAX_DESCRIPTION)
    embed_budget = DISCORD_MAX_EMBED_TOTAL - len(title) - len(footer_text)
    effective_limit = max(0, min(max_desc_budget, embed_budget))

    description, banner_url = format_release_body_for_discord(
        raw_body,
        release_name=title,
        tag_name=tag_name,
        release_url=release_url,
        max_length=effective_limit,
    )

    embed: dict = {
        "title": title,
        "color": int(color),
    }
    if description:
        embed["description"] = description
    if release_url:
        embed["url"] = release_url
    if banner_url:
        embed["image"] = {"url": banner_url}
    if footer_text:
        footer: dict = {"text": footer_text}
        if footer_icon_url:
            footer["icon_url"] = footer_icon_url
        embed["footer"] = footer
    if footer_timestamp:
        timestamp = (
            str(release.get("published_at") or "").strip()
            or str(release.get("created_at") or "").strip()
            or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        )
        embed["timestamp"] = timestamp

    payload: dict = {"embeds": [embed]}
    if username:
        payload["username"] = username
    if avatar_url:
        payload["avatar_url"] = avatar_url
    if content:
        payload["content"] = content
    return payload


def _api_get_json(url: str, token: str = "") -> dict:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": DEFAULT_USER_AGENT,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_release_from_api(repo: str, tag: str, token: str = "") -> dict:
    """Fetch a GitHub release by tag (with v-prefix fallback) or latest release."""
    clean_tag = tag.strip()
    if not clean_tag:
        return _api_get_json(f"https://api.github.com/repos/{repo}/releases/latest", token=token)

    encoded = urllib.parse.quote(clean_tag, safe="")
    try:
        return _api_get_json(f"https://api.github.com/repos/{repo}/releases/tags/{encoded}", token=token)
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        alt_tag = clean_tag[1:] if clean_tag.startswith(("v", "V")) else f"v{clean_tag}"
        alt_encoded = urllib.parse.quote(alt_tag, safe="")
        return _api_get_json(f"https://api.github.com/repos/{repo}/releases/tags/{alt_encoded}", token=token)


def load_release_from_env() -> dict | None:
    """Load the target release object from GitHub Actions environment context."""
    event_name = os.environ.get("GITHUB_EVENT_NAME", "").strip()
    if event_name == "workflow_dispatch":
        repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
        if not repo:
            raise RuntimeError("GITHUB_REPOSITORY is required for workflow_dispatch.")
        tag = os.environ.get("RELEASE_TAG", "").strip()
        token = os.environ.get("GITHUB_TOKEN", "").strip()
        return fetch_release_from_api(repo, tag, token=token)

    event_path = os.environ.get("GITHUB_EVENT_PATH", "").strip()
    if not event_path:
        return None
    with open(event_path, encoding="utf-8") as handle:
        event_payload = json.load(handle)
    release = event_payload.get("release")
    return release if isinstance(release, dict) else None


def post_to_discord(webhook_url: str, payload: dict) -> None:
    """Post formatted release embed payload to a Discord webhook URL."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": DEFAULT_USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status not in (200, 204):
                raise RuntimeError(f"Unexpected Discord HTTP status: {resp.status}")
    except urllib.error.HTTPError as exc:
        err_text = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Discord webhook request failed with HTTP {exc.code}: {err_text}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Discord webhook connection failed: {exc.reason}") from None


def _is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def main() -> int:
    release = load_release_from_env()
    if not release:
        print("No release payload found; nothing to post.")
        return 0

    if release.get("draft") and not _is_truthy(os.environ.get("ALLOW_DRAFT")):
        print("Skipping draft release.")
        return 0

    payload = build_discord_payload(
        release,
        username=os.environ.get("DISCORD_USERNAME", "").strip(),
        avatar_url=os.environ.get("DISCORD_AVATAR_URL", "").strip(),
        color=int(os.environ.get("DISCORD_COLOR", "2105893").strip() or "2105893"),
        content=os.environ.get("DISCORD_CONTENT", "").strip(),
        footer_title=os.environ.get("DISCORD_FOOTER_TITLE", "").strip(),
        footer_icon_url=os.environ.get("DISCORD_FOOTER_ICON_URL", "").strip(),
        footer_timestamp=_is_truthy(os.environ.get("DISCORD_FOOTER_TIMESTAMP", "true")),
        max_description=int(os.environ.get("MAX_DESCRIPTION", "3900").strip() or "3900"),
    )

    if _is_truthy(os.environ.get("DRY_RUN")):
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    webhook_url = os.environ.get("WEBHOOK_URL", "").strip()
    if not webhook_url:
        print("Error: WEBHOOK_URL environment variable is not set.", file=sys.stderr)
        return 1

    post_to_discord(webhook_url, payload)
    print(f"Posted release '{payload['embeds'][0]['title']}' to Discord.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
