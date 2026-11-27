"""External list, chart, award, and TMDb keyword resolvers for Dynamic Overlays."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import urllib.parse
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

import httpx
import yaml

logger = logging.getLogger("overlay_external_lists")

IMDB_GRAPHQL_URL = "https://api.graphql.imdb.com/"
KOMETA_IMDB_AWARDS_BASE = "https://raw.githubusercontent.com/Kometa-Team/IMDb-Awards/master/events"
EXTERNAL_BUILDER_KEYS = ("imdb_chart", "imdb_award", "mdblist_list")
_NATIVE_ONLY_DEFAULTS = frozenset({"resolution", "ratings", "rating", "single_rating", "streaming"})

IMDB_CHART_GRAPHQL_MAP: Dict[str, Dict[str, Any]] = {
    "top_movies": {"query": "chartTitles", "chartType": "TOP_RATED_MOVIES", "first": 250},
    "top_shows": {"query": "chartTitles", "chartType": "TOP_RATED_TV_SHOWS", "first": 250},
    "popular_movies": {"query": "chartTitles", "chartType": "MOST_POPULAR_MOVIES", "first": 100},
    "popular_shows": {"query": "chartTitles", "chartType": "MOST_POPULAR_TV_SHOWS", "first": 100},
    "lowest_rated": {"query": "chartTitles", "chartType": "LOWEST_RATED_MOVIES", "first": 100},
    "top_english": {"query": "chartTitles", "chartType": "TOP_RATED_ENGLISH_MOVIES", "first": 250},
    "top_indian": {"query": "chartTitles", "chartType": "TOP_RATED_INDIAN_MOVIES", "first": 250},
    "top_tamil": {"query": "chartTitles", "chartType": "TOP_RATED_TAMIL_MOVIES", "first": 250},
    "top_telugu": {"query": "chartTitles", "chartType": "TOP_RATED_TELUGU_MOVIES", "first": 250},
    "top_malayalam": {"query": "chartTitles", "chartType": "TOP_RATED_MALAYALAM_MOVIES", "first": 250},
    "box_office": {"query": "boxOfficeWeekendChart"},
    "trending_india": {"query": "topTrendingSetsPredefined", "predefined": "INDIA_TITLE_TRENDS_UPCOMING", "first": 50},
    "trending_tamil": {"query": "topTrendingSetsPredefined", "predefined": "INDIA_TITLE_TRENDS_RELEASED_TAMIL", "first": 200},
    "trending_telugu": {"query": "topTrendingSetsPredefined", "predefined": "INDIA_TITLE_TRENDS_RELEASED_TELUGU", "first": 200},
}

EVENT_ID_RE = re.compile(r"^ev\d{7,10}$")
_MDBLIST_SEGMENT_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_IMDB_ID_RE = re.compile(r"^tt\d+$", re.IGNORECASE)
_LIBRARY_TYPE_ALIASES = {
    "movie": "movie",
    "movies": "movie",
    "show": "show",
    "shows": "show",
    "series": "show",
}
_MDBLIST_ALLOWED_HOSTS = frozenset({"mdblist.com", "www.mdblist.com", "api.mdblist.com"})


def _has_unresolved_placeholder(value: Any) -> bool:
    return isinstance(value, str) and "<<" in value and ">>" in value


def normalize_mdblist_url(raw_url: str) -> Optional[Tuple[str, str, str]]:
    """Validate an MDBList list URL and return (canonical_url, user, slug)."""
    if not isinstance(raw_url, str):
        return None
    cleaned = raw_url.strip()
    if not cleaned or _has_unresolved_placeholder(cleaned):
        return None
    try:
        parsed = urllib.parse.urlparse(cleaned)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme.lower() != "https"
        or host not in _MDBLIST_ALLOWED_HOSTS
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
        or parsed.port is not None
    ):
        return None
    segments = [seg for seg in parsed.path.split("/") if seg]
    if len(segments) not in (3, 4) or segments[0] != "lists":
        return None
    if len(segments) == 4 and segments[3] not in ("json", "items"):
        return None
    user, slug = segments[1], segments[2]
    if user in (".", "..") or slug in (".", ".."):
        return None
    if not _MDBLIST_SEGMENT_RE.fullmatch(user) or not _MDBLIST_SEGMENT_RE.fullmatch(slug):
        return None
    return (f"https://mdblist.com/lists/{user}/{slug}", user, slug)


def normalize_tmdb_keywords_response(data: Any) -> List[str]:
    """Extract sorted, lowercased keyword names and numeric string IDs from TMDb JSON."""
    if not isinstance(data, dict):
        return []
    raw_list = data.get("keywords") if isinstance(data.get("keywords"), list) else data.get("results")
    if not isinstance(raw_list, list):
        return []
    tokens: Set[str] = set()
    for entry in raw_list:
        if isinstance(entry, dict):
            name = str(entry.get("name") or "").strip().lower()
            if name:
                tokens.add(name)
            kw_id = entry.get("id")
            if kw_id is not None and not isinstance(kw_id, bool):
                id_str = str(kw_id).strip()
                if id_str.isdigit():
                    tokens.add(id_str)
        elif isinstance(entry, (str, int)) and not isinstance(entry, bool):
            val = str(entry).strip().lower()
            if val:
                tokens.add(val)
    return sorted(tokens)


async def resolve_tmdb_keywords(
    tmdb_id: Any,
    media_type: str,
    tmdb_token: Optional[str],
    http_client: httpx.AsyncClient,
    ratings_cache: Any,
) -> List[str]:
    """Fetch and cache TMDb keywords for a movie or TV series."""
    clean_id = str(tmdb_id).strip() if tmdb_id is not None else ""
    if not clean_id or not clean_id.isdigit():
        return []

    endpoint_type = "tv" if str(media_type or "").strip().lower() in ("show", "series", "season", "episode") else "movie"
    cached = ratings_cache.get_tmdb_keywords(endpoint_type, clean_id)
    if cached is not None:
        return cached

    token = str(tmdb_token or "").strip()
    if not token:
        stale = ratings_cache.get_tmdb_keywords(endpoint_type, clean_id, allow_stale=True)
        if stale is not None:
            return stale
        logger.warning("[OverlaySync] TMDb token not configured; skipping keywords lookup for %s %s", endpoint_type, clean_id)
        return []

    headers = {"Authorization": f"Bearer {token}"} if len(token) > 40 else {}
    params = {} if headers else {"api_key": token}
    try:
        response = await http_client.get(
            f"https://api.themoviedb.org/3/{endpoint_type}/{clean_id}/keywords",
            headers=headers,
            params=params,
            timeout=10.0,
        )
        response.raise_for_status()
        keywords = normalize_tmdb_keywords_response(response.json())
        ratings_cache.save_tmdb_keywords(endpoint_type, clean_id, keywords, ttl_days=7)
        return keywords
    except (httpx.HTTPError, ValueError):
        stale = ratings_cache.get_tmdb_keywords(endpoint_type, clean_id, allow_stale=True)
        if stale is not None:
            logger.warning("[OverlaySync] Using expired TMDb keywords cache for %s %s after lookup failure", endpoint_type, clean_id)
            return stale
        raise RuntimeError("TMDb keywords lookup failed; artwork left untouched") from None


def _build_imdb_chart_graphql_query(cfg: Dict[str, Any]) -> str:
    query_type = cfg["query"]
    if query_type == "chartTitles":
        return (
            "{ chartTitles(chart: { chartType: %s }, first: %d) "
            "{ edges { node { id } } total } }" % (cfg["chartType"], cfg["first"])
        )
    if query_type == "boxOfficeWeekendChart":
        return "{ boxOfficeWeekendChart(limit: 50) { entries { title { id } } } }"
    if query_type == "topTrendingSetsPredefined":
        return (
            "{ topTrendingSetsPredefined(first: %d, input: "
            "{ topTrendingSetPredefined: %s }) "
            "{ edges { node { item { ... on Title { id } } } } } }"
            % (cfg["first"], cfg["predefined"])
        )
    raise ValueError(f"Unsupported IMDb chart query type: {query_type}")


def _extract_chart_ids(cfg: Dict[str, Any], payload: Any) -> List[str]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        raise ValueError("Invalid IMDb GraphQL response payload")
    data = payload["data"]
    query_type = cfg["query"]
    raw_ids: List[Any] = []
    if query_type == "chartTitles":
        edges = ((data.get("chartTitles") or {}).get("edges")) or []
        raw_ids = [((edge or {}).get("node") or {}).get("id") for edge in edges]
    elif query_type == "boxOfficeWeekendChart":
        entries = ((data.get("boxOfficeWeekendChart") or {}).get("entries")) or []
        raw_ids = [((entry or {}).get("title") or {}).get("id") for entry in entries]
    elif query_type == "topTrendingSetsPredefined":
        edges = ((data.get("topTrendingSetsPredefined") or {}).get("edges")) or []
        raw_ids = [(((edge or {}).get("node") or {}).get("item") or {}).get("id") for edge in edges]

    seen: Set[str] = set()
    ordered: List[str] = []
    for raw_id in raw_ids:
        iid = str(raw_id or "").strip().lower()
        if _IMDB_ID_RE.fullmatch(iid) and iid not in seen:
            seen.add(iid)
            ordered.append(iid)
    return ordered


async def fetch_imdb_chart(
    chart_name: str,
    http_client: httpx.AsyncClient,
    ratings_cache: Any,
) -> List[str]:
    """Fetch and cache an IMDb chart's IMDb IDs via IMDb's public GraphQL endpoint."""
    chart = str(chart_name or "").strip().lower()
    cfg = IMDB_CHART_GRAPHQL_MAP.get(chart)
    if cfg is None:
        logger.warning("[OverlaySync] Unsupported IMDb chart '%s'", chart_name)
        return []

    cache_key = f"imdb_chart:{chart}"
    cached = ratings_cache.get_external_list(cache_key)
    if isinstance(cached, list):
        return [str(x).strip().lower() for x in cached if _IMDB_ID_RE.fullmatch(str(x or "").strip())]

    gql = _build_imdb_chart_graphql_query(cfg)
    try:
        response = await http_client.post(
            IMDB_GRAPHQL_URL,
            json={"query": gql},
            headers={
                "content-type": "application/json",
                "x-imdb-client-name": "imdb-web-next",
                "user-agent": "Posterizarr-DynamicOverlays/1.0",
            },
            timeout=15.0,
        )
        response.raise_for_status()
        ids = _extract_chart_ids(cfg, response.json())
        if ids:
            ratings_cache.save_external_list(cache_key, ids, ttl_hours=24)
        return ids
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        stale = ratings_cache.get_external_list(cache_key, allow_stale=True)
        if isinstance(stale, list):
            logger.warning("[OverlaySync] Using expired IMDb chart cache for '%s' after error: %s", chart, exc)
            return [str(x).strip().lower() for x in stale if _IMDB_ID_RE.fullmatch(str(x or "").strip())]
        logger.warning("[OverlaySync] Failed fetching IMDb chart '%s': %s", chart, exc)
        return []


async def fetch_imdb_award_event(
    event_id: str,
    http_client: httpx.AsyncClient,
    ratings_cache: Any,
) -> Dict[str, Any]:
    """Fetch and cache Kometa's IMDb-Awards YAML dataset for a validated event_id."""
    clean_ev = str(event_id or "").strip().lower()
    if not EVENT_ID_RE.fullmatch(clean_ev):
        logger.warning("[OverlaySync] Invalid IMDb award event_id '%s'", event_id)
        return {}

    cache_key = f"imdb_award:{clean_ev}"
    cached = ratings_cache.get_external_list(cache_key)
    if isinstance(cached, dict):
        return cached

    url = f"{KOMETA_IMDB_AWARDS_BASE}/{clean_ev}.yml"
    try:
        response = await http_client.get(
            url,
            headers={"user-agent": "Posterizarr-DynamicOverlays/1.0"},
            timeout=20.0,
            follow_redirects=False,
        )
        response.raise_for_status()
        parsed = yaml.safe_load(response.text)
        if not isinstance(parsed, dict):
            raise ValueError("Award YAML root must be a mapping")
        ratings_cache.save_external_list(cache_key, parsed, ttl_hours=168)
        return parsed
    except (httpx.HTTPError, yaml.YAMLError, ValueError) as exc:
        stale = ratings_cache.get_external_list(cache_key, allow_stale=True)
        if isinstance(stale, dict):
            logger.warning("[OverlaySync] Using expired IMDb award cache for '%s' after error: %s", clean_ev, exc)
            return stale
        logger.warning("[OverlaySync] Failed fetching IMDb award event '%s': %s", clean_ev, exc)
        return {}


def _normalize_filter_set(value: Any) -> Optional[Set[str]]:
    if value is None or value == "":
        return None
    if isinstance(value, (list, tuple, set)):
        items = {str(x).strip().lower() for x in value if x is not None and str(x).strip()}
        return items or None
    if isinstance(value, str):
        items = {x.strip().lower() for x in value.split(",") if x.strip()}
        return items or None
    val = str(value).strip().lower()
    return {val} if val else None


def _select_award_year_keys(event_data: Dict[str, Any], raw_year: Any) -> List[Any]:
    if raw_year is None or str(raw_year).strip().lower() == "all":
        return list(event_data.keys())

    if str(raw_year).strip().lower() == "latest":
        non_empty = [
            k for k, v in event_data.items()
            if isinstance(v, dict) and len(v) > 0
        ]
        if not non_empty:
            return []

        def _year_sort_key(key: Any) -> Tuple[int, str]:
            s = str(key).strip()
            return (int(s), s) if s.isdigit() else (-1, s)

        return [max(non_empty, key=_year_sort_key)]

    if isinstance(raw_year, (list, tuple, set)):
        targets = {str(x).strip() for x in raw_year if x is not None and str(x).strip()}
    elif isinstance(raw_year, str):
        targets = {x.strip() for x in raw_year.split(",") if x.strip()}
    else:
        targets = {str(raw_year).strip()}

    return [k for k in event_data.keys() if str(k).strip() in targets]


def extract_imdb_award_ids(event_data: Dict[str, Any], award_spec: Dict[str, Any]) -> Set[str]:
    """Extract matching IMDb tt-IDs from an IMDb-Awards event dict for an award_spec."""
    if not isinstance(event_data, dict) or not isinstance(award_spec, dict):
        return set()

    award_filter = _normalize_filter_set(award_spec.get("award_filter"))
    category_filter = _normalize_filter_set(award_spec.get("category_filter"))
    winning = str(award_spec.get("winning", False)).strip().lower() in ("true", "1", "yes")
    year_keys = _select_award_year_keys(event_data, award_spec.get("event_year", "all"))

    matched_ids: Set[str] = set()
    for y_key in year_keys:
        year_block = event_data.get(y_key)
        if not isinstance(year_block, dict):
            continue
        for award_name, categories in year_block.items():
            if award_filter is not None and str(award_name).strip().lower() not in award_filter:
                continue
            if not isinstance(categories, dict):
                continue
            for cat_name, cat_data in categories.items():
                if category_filter is not None and str(cat_name).strip().lower() not in category_filter:
                    continue
                if not isinstance(cat_data, dict):
                    continue
                buckets = [cat_data.get("winner")] if winning else [cat_data.get("nominee"), cat_data.get("winner")]
                for bucket in buckets:
                    if not isinstance(bucket, list):
                        continue
                    for raw_id in bucket:
                        iid = str(raw_id or "").strip().lower()
                        if _IMDB_ID_RE.fullmatch(iid):
                            matched_ids.add(iid)
    return matched_ids


async def _safe_mdblist_get(
    url: str,
    http_client: httpx.AsyncClient,
    params: Optional[Dict[str, Any]] = None,
) -> httpx.Response:
    """Follow redirects only inside validated MDBList hosts."""
    current_url = url
    current_params = params
    for _ in range(4):
        parsed = urllib.parse.urlparse(current_url)
        if parsed.scheme.lower() != "https" or (parsed.hostname or "").lower() not in _MDBLIST_ALLOWED_HOSTS:
            raise ValueError(f"Blocked non-MDBList redirect target: {current_url}")
        response = await http_client.get(
            current_url,
            params=current_params,
            headers={"user-agent": "Posterizarr-DynamicOverlays/1.0", "accept": "application/json"},
            timeout=15.0,
            follow_redirects=False,
        )
        if response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get("location") or response.headers.get("Location")
            if not location:
                break
            current_url = urllib.parse.urljoin(current_url, location.strip())
            current_params = None
            continue
        return response
    raise ValueError("Too many redirects fetching MDBList")


def _extract_mdblist_ids(payload: Any) -> Dict[str, List[str]]:
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        items = []
        for key in ("movies", "shows", "items"):
            val = payload.get(key)
            if isinstance(val, list):
                items.extend(val)
    else:
        raise ValueError("Unexpected MDBList response shape")

    imdb_ids: Set[str] = set()
    tmdb_ids: Set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        iid = str(item.get("imdb_id") or "").strip().lower()
        if _IMDB_ID_RE.fullmatch(iid):
            imdb_ids.add(iid)
        tmdb_raw = item.get("id") if item.get("id") is not None else item.get("tmdbid")
        if tmdb_raw is not None and not isinstance(tmdb_raw, bool):
            tmdb_str = str(tmdb_raw).strip()
            if tmdb_str.isdigit():
                tmdb_ids.add(tmdb_str)
    return {"imdb_ids": sorted(imdb_ids), "tmdb_ids": sorted(tmdb_ids)}


async def fetch_mdblist_list(
    raw_url: str,
    http_client: httpx.AsyncClient,
    ratings_cache: Any,
    mdblist_api_key: str = "",
) -> Dict[str, List[str]]:
    """Fetch and cache IMDb/TMDb IDs from a public or API-keyed MDBList list URL."""
    parsed = normalize_mdblist_url(raw_url)
    if parsed is None:
        logger.warning("[OverlaySync] Ignoring unsupported MDBList URL '%s'", raw_url)
        return {"imdb_ids": [], "tmdb_ids": []}

    canonical_url, user, slug = parsed
    cache_key = f"mdblist_list:{canonical_url}"
    cached = ratings_cache.get_external_list(cache_key)
    if isinstance(cached, dict):
        return {
            "imdb_ids": [str(x).strip().lower() for x in (cached.get("imdb_ids") or [])],
            "tmdb_ids": [str(x).strip() for x in (cached.get("tmdb_ids") or [])],
        }

    public_url = f"https://mdblist.com/lists/{user}/{slug}/json"
    api_key = str(mdblist_api_key or "").strip()
    try:
        response = await _safe_mdblist_get(public_url, http_client)
        if response.status_code != 200 and api_key:
            response = await _safe_mdblist_get(
                f"https://api.mdblist.com/lists/{user}/{slug}/items/",
                http_client,
                params={"apikey": api_key, "limit": 2000},
            )
        response.raise_for_status()
        extracted = _extract_mdblist_ids(response.json())
        if extracted["imdb_ids"] or extracted["tmdb_ids"]:
            ratings_cache.save_external_list(cache_key, extracted, ttl_hours=24)
        return extracted
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        stale = ratings_cache.get_external_list(cache_key, allow_stale=True)
        if isinstance(stale, dict):
            logger.warning("[OverlaySync] Using expired MDBList cache for '%s' after error: %s", canonical_url, exc)
            return {
                "imdb_ids": [str(x).strip().lower() for x in (stale.get("imdb_ids") or [])],
                "tmdb_ids": [str(x).strip() for x in (stale.get("tmdb_ids") or [])],
            }
        logger.warning("[OverlaySync] Failed fetching MDBList '%s': %s", canonical_url, exc)
        return {"imdb_ids": [], "tmdb_ids": []}


def _matches_library_type_value(allowed_value: Any, library_type: str) -> bool:
    if allowed_value is None or _has_unresolved_placeholder(allowed_value):
        return True
    tokens = (
        [str(x).strip().lower() for x in allowed_value if str(x).strip()]
        if isinstance(allowed_value, (list, tuple, set))
        else [x.strip().lower() for x in str(allowed_value).split(",") if x.strip()]
    )
    if not tokens:
        return True
    normalized = {_LIBRARY_TYPE_ALIASES.get(tok, tok) for tok in tokens}
    if not normalized.issubset({"movie", "show"}):
        return True
    return library_type in normalized


def _overlay_enabled_for_library(expanded_ov: Dict[str, Any], library_type: str) -> bool:
    if not _matches_library_type_value(expanded_ov.get("allowed_libraries"), library_type):
        return False
    run_def = expanded_ov.get("run_definition")
    if run_def is None:
        return True
    items = run_def if isinstance(run_def, list) else [run_def]
    for item in items:
        if item is False:
            return False
        if isinstance(item, str):
            low = item.strip().lower()
            if low in ("false", "none", "", "0"):
                return False
            if _has_unresolved_placeholder(item):
                continue
        if not _matches_library_type_value(item, library_type):
            return False
    return True


def _as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def collect_external_builders_for_rules(
    engine: Any,
    lib_rules: List[Dict[str, Any]],
    library_type: str,
) -> Dict[str, Set[str]]:
    """Collect active imdb_chart, imdb_award event_ids, and mdblist_list URLs for a library."""
    charts: Set[str] = set()
    award_events: Set[str] = set()
    mdblist_urls: Set[str] = set()

    for rule_entry in lib_rules:
        if not isinstance(rule_entry, dict):
            continue
        default_name = str(rule_entry.get("default") or "").strip().lower()
        if default_name in _NATIVE_ONLY_DEFAULTS:
            continue
        res = engine.load_overlay_file(rule_entry)
        if not res or len(res) < 4:
            continue
        file_overlays, _, file_templates, file_vars = res
        eff_vars = {**file_vars, "library_type": library_type}
        for ov_key, ov_def in (file_overlays or {}).items():
            if not isinstance(ov_def, dict):
                continue
            expanded_ov = engine._expand_overlay_definition(
                str(ov_key), dict(ov_def), file_templates, eff_vars
            )
            if not expanded_ov or not _overlay_enabled_for_library(expanded_ov, library_type):
                continue

            for chart in _as_list(expanded_ov.get("imdb_chart")):
                if isinstance(chart, str) and chart.strip() and not _has_unresolved_placeholder(chart):
                    charts.add(chart.strip().lower())

            for award in _as_list(expanded_ov.get("imdb_award")):
                if isinstance(award, dict):
                    ev = str(award.get("event_id") or "").strip().lower()
                    if EVENT_ID_RE.fullmatch(ev):
                        award_events.add(ev)

            for m_url in _as_list(expanded_ov.get("mdblist_list")):
                if isinstance(m_url, str) and not _has_unresolved_placeholder(m_url):
                    norm = normalize_mdblist_url(m_url)
                    if norm:
                        mdblist_urls.add(norm[0])

    return {
        "charts": charts,
        "award_events": award_events,
        "mdblist_urls": mdblist_urls,
    }


async def resolve_external_lists_for_library(
    engine: Any,
    lib_rules: List[Dict[str, Any]],
    media_type: str,
    http_client: httpx.AsyncClient,
    ratings_cache: Any,
    *,
    mdblist_api_key: str = "",
    run_state: Optional[Dict[str, Any]] = None,
    run_lock: Optional[asyncio.Lock] = None,
    write_log: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Fetch and deduplicate all external charts/awards/MDBLists required by a library's rules."""
    library_type = "show" if str(media_type or "").strip().lower() in ("show", "series", "season", "episode") else "movie"

    state = run_state if run_state is not None else {}
    charts_store: Dict[str, Set[str]] = state.setdefault("imdb_chart", {})
    events_store: Dict[str, Dict[str, Any]] = state.setdefault("imdb_award_events", {})
    mdblist_store: Dict[str, Dict[str, Set[str]]] = state.setdefault("mdblist_list", {})
    award_eval_cache: Dict[Tuple[str, str], Set[str]] = state.setdefault("_award_cache", {})
    resolved_cache: Dict[Tuple[str, str], Dict[str, Any]] = state.setdefault("_resolved_cache", {})
    rules_cache_key = (library_type, json.dumps(lib_rules, sort_keys=True, default=str))

    if rules_cache_key in resolved_cache:
        return resolved_cache[rules_cache_key]

    async def _ensure_loaded() -> Dict[str, Any]:
        if rules_cache_key in resolved_cache:
            return resolved_cache[rules_cache_key]

        needed = collect_external_builders_for_rules(engine, lib_rules, library_type)
        missing_charts = sorted(c for c in needed["charts"] if c not in charts_store)
        missing_events = sorted(ev for ev in needed["award_events"] if ev not in events_store)
        missing_mdbs = sorted(u for u in needed["mdblist_urls"] if u not in mdblist_store)
        if missing_charts or missing_events or missing_mdbs:
            if write_log:
                write_log(
                    f"  [i] Loading external overlay lists for {library_type}: "
                    f"{len(missing_charts)} IMDb chart(s), {len(missing_events)} IMDb award event(s), "
                    f"{len(missing_mdbs)} MDBList(s)"
                )

            for chart in missing_charts:
                ids = await fetch_imdb_chart(chart, http_client, ratings_cache)
                charts_store[chart] = set(ids)

            for ev in missing_events:
                events_store[ev] = await fetch_imdb_award_event(ev, http_client, ratings_cache)

            for m_url in missing_mdbs:
                data = await fetch_mdblist_list(m_url, http_client, ratings_cache, mdblist_api_key=mdblist_api_key)
                mdblist_store[m_url] = {
                    "imdb_ids": set(data.get("imdb_ids") or []),
                    "tmdb_ids": set(data.get("tmdb_ids") or []),
                }

        result = {
            "imdb_chart": {c: charts_store[c] for c in needed["charts"] if c in charts_store},
            "imdb_award_events": {ev: events_store[ev] for ev in needed["award_events"] if ev in events_store},
            "mdblist_list": {u: mdblist_store[u] for u in needed["mdblist_urls"] if u in mdblist_store},
            "_award_cache": award_eval_cache,
        }
        resolved_cache[rules_cache_key] = result
        return result

    if run_lock is not None:
        async with run_lock:
            return await _ensure_loaded()
    return await _ensure_loaded()


def overlay_has_external_builders(expanded_ov: Dict[str, Any]) -> bool:
    """Return True if an expanded overlay rule defines at least one valid external builder."""
    if not isinstance(expanded_ov, dict):
        return False
    for chart in _as_list(expanded_ov.get("imdb_chart")):
        if isinstance(chart, str) and chart.strip() and not _has_unresolved_placeholder(chart):
            return True
    for award in _as_list(expanded_ov.get("imdb_award")):
        if isinstance(award, dict) and EVENT_ID_RE.fullmatch(str(award.get("event_id") or "").strip().lower()):
            return True
    for m_url in _as_list(expanded_ov.get("mdblist_list")):
        if isinstance(m_url, str) and normalize_mdblist_url(m_url) is not None:
            return True
    return False


def _normalize_item_imdb_id(raw_value: Any) -> str:
    raw = str(raw_value or "").strip().lower()
    if raw.startswith("imdb://"):
        raw = raw[7:].split("?", 1)[0].strip()
    if raw.isdigit():
        raw = f"tt{raw}"
    return raw if _IMDB_ID_RE.fullmatch(raw) else ""


def matches_external_builders(expanded_ov: Dict[str, Any], item_metadata: Dict[str, Any]) -> bool:
    """Evaluate imdb_chart, imdb_award, and mdblist_list builders for a single media item."""
    preview_key = str(item_metadata.get("_preview_ribbon_key") or "").strip().lower()
    if preview_key:
        ov_var_key = str(((expanded_ov.get("variables") or {}).get("key")) or expanded_ov.get("_overlay_key") or "").strip().lower()
        return ov_var_key == preview_key

    item_imdb = _normalize_item_imdb_id(item_metadata.get("imdb_id"))
    raw_tmdb = str(item_metadata.get("tmdb_id") or "").strip()
    item_tmdb = raw_tmdb if raw_tmdb.isdigit() else ""
    if not item_imdb and not item_tmdb:
        return False

    ext = item_metadata.get("_external_lists") or {}
    if not isinstance(ext, dict):
        return False

    if item_imdb:
        charts = ext.get("imdb_chart") or {}
        for chart in _as_list(expanded_ov.get("imdb_chart")):
            if isinstance(chart, str) and not _has_unresolved_placeholder(chart):
                if item_imdb in charts.get(chart.strip().lower(), ()):
                    return True

        events = ext.get("imdb_award_events") or {}
        award_cache = ext.setdefault("_award_cache", {})
        for award in _as_list(expanded_ov.get("imdb_award")):
            if not isinstance(award, dict):
                continue
            ev = str(award.get("event_id") or "").strip().lower()
            event_data = events.get(ev)
            if not isinstance(event_data, dict):
                continue
            spec_key = json.dumps(award, sort_keys=True, default=str)
            cache_key = (ev, spec_key)
            if cache_key not in award_cache:
                award_cache[cache_key] = extract_imdb_award_ids(event_data, award)
            if item_imdb in award_cache[cache_key]:
                return True

    mdblists = ext.get("mdblist_list") or {}
    for m_url in _as_list(expanded_ov.get("mdblist_list")):
        if not isinstance(m_url, str):
            continue
        norm = normalize_mdblist_url(m_url)
        if norm is None:
            continue
        entry = mdblists.get(norm[0]) or {}
        if item_imdb and item_imdb in (entry.get("imdb_ids") or ()):
            return True
        if item_tmdb and item_tmdb in (entry.get("tmdb_ids") or ()):
            return True

    return False
