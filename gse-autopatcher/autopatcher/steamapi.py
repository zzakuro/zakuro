"""Optional Steam store lookups (app id <-> name). Stdlib only, best effort."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from .util import log

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
)
STORE = "https://store.steampowered.com"
SUGGEST = f"{STORE}/search/suggest"
APPDETAILS = f"{STORE}/api/appdetails"
TIMEOUT = 20


@dataclass
class StoreApp:
    appid: int
    name: str
    type: str = ""
    extra: dict | None = None


def _get_json(url: str, timeout: int = TIMEOUT) -> dict | None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
        log.debug(f"request failed: {exc}")
        return None
    try:
        return json.loads(payload.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return None


def app_details(appid: int) -> StoreApp | None:
    data = _get_json(f"{APPDETAILS}?appids={int(appid)}&filters=basic")
    if not data:
        return None
    entry = data.get(str(appid)) or {}
    if not entry.get("success"):
        return None
    body = entry.get("data") or {}
    if not body.get("name"):
        return None
    return StoreApp(
        appid=int(body.get("steam_appid") or appid),
        name=body["name"],
        type=body.get("type", ""),
        extra=body,
    )


def is_game(appid: int) -> bool:
    info = app_details(appid)
    return bool(info and info.type == "game")


def search(query: str, limit: int = 6) -> list[StoreApp]:
    """Name -> candidate app ids, best match first."""
    params = {
        "term": query,
        "f": "games",
        "cc": "US",
        "l": "english",
        "v": "Steam",
        "ignore_preferences": "1",
    }
    data = _get_json(f"{SUGGEST}?{urllib.parse.urlencode(params)}")
    if not data:
        return []
    results: list[StoreApp] = []
    for entry in (data.get("ids") or [])[: limit * 3]:
        raw_id = entry.get("id")
        if not raw_id or not str(raw_id).isdigit():
            continue
        appid = int(raw_id)
        name = entry.get("name") or ""
        if app_details(appid) is None:
            continue
        results.append(StoreApp(appid=appid, name=name))
        if len(results) >= limit:
            break
    return results


def resolve(query: str) -> StoreApp | None:
    """Accept either an app id or a game name and return the best match."""
    query = (query or "").strip()
    if not query:
        return None
    if re.fullmatch(r"\d+", query):
        info = app_details(int(query))
        if info:
            return info
        log.warn(f"app id {query} not found on the store")
    for candidate in search(query):
        if candidate.name.lower() == query.lower():
            return candidate
    candidates = search(query)
    return candidates[0] if candidates else None
