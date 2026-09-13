#!/usr/bin/env python3
"""
resolve_steam_ids.py — Offline Steam appid resolver
====================================================
Fills missing `steamId` fields in merged_enriched.json by matching game
titles against a locally-cached copy of Steam's full app list.

No per-game API calls: the app list is downloaded ONCE (cached to
steam_applist.json) and matches happen locally.

Strategy per game (missing steamId only):
  1. Exact match on normalized title            (fast path, most games)
  2. Exact match on "sort name"                 (The/The-and-articles)
  3. Fuzzy match (difflib ratio >= threshold) over token-overlap candidates

Everything under the confidence threshold is left untouched — the later
IGDB pass (igdb_enrich_missing.py) is the right tool for those.

Usage:
    python resolve_steam_ids.py [path/to/merged_enriched.json] [--min-ratio 0.85] [--dry-run] [--refresh-applist]

Outputs:
    steam_applist.json          cached Steam app list
    steam_resolve_report.json   per-game match decisions (for review)
"""

import difflib
import json
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

DEFAULT_INPUT = Path("public/merged_enriched.json")
APPLIST_CACHE = Path("steam_applist.json")
REPORT_FILE = Path("steam_resolve_report.json")
APPLIST_URLS = [
    "https://raw.githubusercontent.com/Austrum-lab/steam-appdb/master/data/applist.json",
    "https://api.steampowered.com/ISteamApps/GetAppList/v2/",
    "https://store.steampowered.com/api/apps/",
]
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ZakuroArchive/1.0"
ARTICLES = ("the ", "an ", "a ")


# ── Title normalization ───────────────────────────────────────────────────────

def normalize_title(s: str) -> str:
    """Lowercase, strip accents + punctuation/symbols, collapse whitespace."""
    s = str(s)
    # Drop symbols/punctuation/controls FIRST — NFKD would otherwise expand
    # them into letters (e.g. U+2122 TRADE MARK SIGN -> "tm"), corrupting keys.
    s = "".join(c for c in s if unicodedata.category(c)[0] not in "SPC")
    # Fold accents precomposed chars -> base letters, then keep letters/numbers.
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if unicodedata.category(c)[0] in "LN" or c == " ")
    s = s.lower()
    s = re.sub(r"\s+", " ", s).strip()
    return s


def sortname(s: str) -> str:
    """Normalized name minus leading article; also un-reverses 'X, The'."""
    n = normalize_title(s)
    m = re.match(r"^(.+),\s*(the|an|a)$", n)
    if m:
        n = f"{m.group(2)} {m.group(1)}"
    for art in ARTICLES:
        if n.startswith(art) and len(n) > len(art):
            return n[len(art):]
    return n


def first_tokens(n: str) -> list:
    """Derives candidate-gathering tokens from a normalized name."""
    toks = n.split()
    if not toks:
        return []
    keys = [toks[0]] if toks[0] else []
    if len(toks) > 1:
        keys.append(toks[1])
    # single-letter acronyms (R.E.P.O -> "r e p o") collapse to one token
    if len(toks) >= 2 and all(len(t) == 1 for t in toks):
        keys.append("".join(toks))
    return [k for k in keys if len(k) >= 3]


# ── Steam app list download/cache ─────────────────────────────────────────────

def fetch_applist() -> list | None:
    for url in APPLIST_URLS:
        try:
            print(f"[AppList] Downloading: {url}")
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=90) as r:
                raw = r.read().decode("utf-8", errors="replace")
            data = json.loads(raw)
            apps = (data.get("applist") or {}).get("apps") or data.get("apps")
            if apps:
                print(f"[AppList] OK: {len(apps)} apps")
                return apps
        except Exception as e:
            print(f"[AppList] ! {url} failed: {e}")
    return None


def load_applist(force_refresh: bool) -> list:
    if not force_refresh and APPLIST_CACHE.exists():
        try:
            apps = json.loads(APPLIST_CACHE.read_text(encoding="utf-8"))
            print(f"[AppList] Using cached {APPLIST_CACHE} ({len(apps)} apps)")
            return apps
        except Exception:
            print("[AppList] Cached file unreadable, re-downloading.")
    apps = fetch_applist()
    if apps is None:
        print("ERROR: could not obtain Steam app list. Check network and retry.")
        sys.exit(1)
    APPLIST_CACHE.write_text(json.dumps(apps), encoding="utf-8")
    return apps


# ── Index ─────────────────────────────────────────────────────────────────────

def build_index(apps: list):
    exact: dict[str, list] = {}      # normalized name -> [appids]
    sort: dict[str, list] = {}       # sortname          -> [appids]
    by_token: dict[str, list] = {}   # first word        -> [(norm, name, appid)]
    canonical: dict[str, str] = {}   # normalized name   -> original display name

    for app in apps:
        appid = app.get("appid")
        name = app.get("name")
        if not appid or not name:
            continue
        n = normalize_title(name)
        if not n:
            continue
        exact.setdefault(n, []).append(appid)
        sort.setdefault(sortname(name), []).append(appid)
        if n not in canonical:
            canonical[n] = name
        first = n.split()[0]
        if len(first) >= 3:
            by_token.setdefault(first, []).append((n, name, appid))

    return exact, sort, by_token, canonical


def pick_appid(appids: list, display_name: str, apps_by_norm: dict, norm: str) -> int:
    """Among apps sharing the same normalized name, prefer a display-name
    that exactly equals the game title; otherwise the lowest appid."""
    if len(appids) == 1:
        return appids[0]
    target = normalize_title(display_name)
    exact_display = [a for a in appids if normalize_title(apps_by_norm.get(a, "")) == target] if apps_by_norm else []
    if exact_display:
        return exact_display[0]
    return min(appids)


def resolve_game(game_title: str, game_id: str, exact, sort, by_token, canonical, apps_by_norm,
                 min_ratio: float) -> tuple:
    """Returns (appid or None, method, ratio or None)."""
    norm = normalize_title(game_title)
    if not norm:
        return None, "empty-title", None

    # 1. exact
    if norm in exact:
        return pick_appid(exact[norm], game_title, apps_by_norm, norm), "exact", 1.0

    # 2. sort exact
    sn = sortname(game_title)
    if sn in sort:
        return pick_appid(sort[sn], game_title, apps_by_norm, norm), "sort-exact", 0.999

    # 3. fuzzy over token-overlap candidates
    candidates: dict[str, str] = {}   # norm -> display
    for tok in first_tokens(norm):
        for (cn, cname, cappid) in by_token.get(tok, []):
            candidates[cn] = cn
    if not candidates:
        return None, "no-candidates", None

    cand_norms = list(candidates.keys())
    best = difflib.get_close_matches(norm, cand_norms, n=1, cutoff=min_ratio)
    if not best:
        return None, "fuzzy-low", None

    best_norm = best[0]
    ratio = difflib.SequenceMatcher(None, norm, best_norm).ratio()
    appids = exact.get(best_norm)
    if not appids:
        return None, "fuzzy-no-id", ratio
    return pick_appid(appids, game_title, apps_by_norm, norm), "fuzzy", ratio


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    input_path = Path(args[0]) if args and not args[0].startswith("--") else DEFAULT_INPUT
    min_ratio = 0.86
    dry_run = False
    force_refresh = False

    for a in args:
        if a == "--dry-run":
            dry_run = True
        elif a == "--refresh-applist":
            force_refresh = True
        elif a.startswith("--min-ratio"):
            min_ratio = float(a.split("=")[1] if "=" in a else args[args.index(a) + 1])

    if not input_path.exists():
        print(f"ERROR: {input_path} not found.")
        sys.exit(1)

    print(f"[Resolve] Loading {input_path}...")
    games = json.loads(input_path.read_text(encoding="utf-8"))
    total = len(games)

    apps = load_applist(force_refresh)
    exact, sort, by_token, canonical = build_index(apps)

    # display-name map: appid -> display name, for duplicate-resolution tiebreaks
    apps_by_norm: dict[int, str] = {}
    for app in apps:
        if app.get("appid") and app.get("name"):
            apps_by_norm.setdefault(app["appid"], app["name"])

    missing = [g for g in games if not g.get("steamId")]
    before = len(missing)
    print(f"[Resolve] {total} games, {before} missing steamId. Matching...")

    resolved = 0
    report = []
    t0 = time.time()

    for i, g in enumerate(missing):
        appid, method, ratio = resolve_game(
            g.get("title", ""), g.get("id", ""), exact, sort, by_token, canonical,
            apps_by_norm, min_ratio
        )
        if appid:
            g["steamId"] = appid
            resolved += 1
        report.append({
            "id": g.get("id"),
            "title": g.get("title"),
            "steamId": appid,
            "method": method,
            "ratio": round(ratio, 4) if ratio is not None else None,
            "steam_name": canonical.get(normalize_title(g.get("title", ""))) if method == "exact" else None,
        })
        if (i + 1) % 500 == 0:
            el = time.time() - t0
            print(f"  [{i + 1}/{before}] resolved so far: {resolved}  ({el:.1f}s)")

    after = len([g for g in games if not g.get("steamId")])
    print(f"\n[Resolve] Done in {time.time() - t0:.1f}s")
    print(f"  BEFORE: {before} missing steamId")
    print(f"  AFTER:  {after} missing  ({before - after} resolved)")

    if dry_run:
        print("[Resolve] Dry run — not writing changes.")
    else:
        input_path.write_text(json.dumps(games, ensure_ascii=False), encoding="utf-8")
        print(f"[Resolve] Saved to {input_path}")

    REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[Resolve] Report written to {REPORT_FILE}")


if __name__ == "__main__":
    main()