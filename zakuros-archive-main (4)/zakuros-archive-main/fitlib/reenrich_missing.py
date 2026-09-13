#!/usr/bin/env python3
"""
Re-enrich games that have a steamId but are missing real metadata.
===================================================================
Targets only games where developer is empty, rating is 0, and genres
is just ['PC Game'] - meaning the original enrichment run never
successfully fetched real data for them despite having a steamId.

Fetches from Steam appdetails only (no IGDB calls needed since we
already have steamId). Saves progress every 100 games so it's safe
to interrupt and re-run - it skips games that already have real data.

Runtime: ~0.5s per game, so ~9000 games = ~75 minutes.
Safe to Ctrl+C and re-run at any time.

Usage (run from fitlib/ directory):
    python3 reenrich_missing.py [path/to/merged_enriched.json]
"""
import json
import sys
import time
from pathlib import Path

import requests

INPUT_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public/merged_enriched.json")
CHECKPOINT_EVERY = 100
REQUEST_DELAY = 0.5
MAX_RETRIES = 3
RETRY_DELAY = 10

session = requests.Session()
session.headers.update({"User-Agent": "Mozilla/5.0"})


def needs_enrichment(g: dict) -> bool:
    """True if this game has a steamId but is missing real metadata."""
    if not g.get("steamId"):
        return False
    if g.get("developer") and g.get("rating", 0) > 0:
        return False
    if g.get("genres") and g.get("genres") != ["PC Game"] and g.get("developer"):
        return False
    return True


def fetch_steam_details(appid: int) -> dict:
    for attempt in range(MAX_RETRIES):
        try:
            r = session.get(
                "https://store.steampowered.com/api/appdetails",
                params={"appids": appid, "l": "english"},
                timeout=15,
            )
            if r.status_code == 429:
                wait = RETRY_DELAY * (attempt + 1)
                print(f"\n  Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            if not r.ok:
                return {}
            data = r.json().get(str(appid), {})
            return data.get("data", {}) if data.get("success") else {}
        except (requests.RequestException, ValueError):
            time.sleep(3)
    return {}


def apply_steam_data(raw: dict, game: dict, appid: int) -> dict:
    """Apply Steam appdetails data onto an existing game dict."""
    if not raw:
        return game

    game["developer"] = ", ".join(raw.get("developers", [])) or game.get("developer", "")
    game["publisher"] = ", ".join(raw.get("publishers", [])) or game.get("publisher", "")

    genres = [g["description"] for g in raw.get("genres", [])]
    if genres:
        game["genres"] = genres

    metacritic = raw.get("metacritic", {})
    if metacritic.get("score"):
        game["rating"] = metacritic["score"]

    if raw.get("short_description") and not game.get("summary"):
        game["summary"] = raw["short_description"]
    elif raw.get("short_description") and game.get("summary", "").startswith("Available via:"):
        game["summary"] = raw["short_description"]

    release = raw.get("release_date", {})
    if release.get("date") and not game.get("releaseDate"):
        game["releaseDate"] = release["date"]

    # Cover image - use Steam library format (portrait, 600x900)
    if not game.get("coverImage"):
        game["coverImage"] = f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"

    # Screenshots
    steam_screens = raw.get("screenshots", [])
    if steam_screens and not game.get("screenshots"):
        game["screenshots"] = [s["path_full"] for s in steam_screens[:6]]
    if steam_screens and not game.get("screenshot"):
        game["screenshot"] = steam_screens[0]["path_full"]

    # System requirements
    pc_reqs = raw.get("pc_requirements", {})
    if isinstance(pc_reqs, dict) and (pc_reqs.get("minimum") or pc_reqs.get("recommended")):
        if not game.get("systemRequirements"):
            game["systemRequirements"] = {}
        if pc_reqs.get("minimum"):
            game["systemRequirements"]["minimum"] = pc_reqs["minimum"]
        if pc_reqs.get("recommended"):
            game["systemRequirements"]["recommended"] = pc_reqs["recommended"]

    return game


def main():
    if not INPUT_PATH.exists():
        print(f"ERROR: {INPUT_PATH} not found.")
        sys.exit(1)

    print(f"Loading {INPUT_PATH}...")
    games = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    print(f"  {len(games)} games total")

    targets = [i for i, g in enumerate(games) if needs_enrichment(g)]
    print(f"  {len(targets)} games need re-enrichment")
    print(f"  Estimated time: ~{len(targets) * REQUEST_DELAY / 60:.0f} minutes")
    print(f"  Safe to Ctrl+C and re-run at any time (checkpoints every {CHECKPOINT_EVERY} games)\n")

    fetched = 0
    failed = 0
    skipped = 0

    for n, idx in enumerate(targets):
        g = games[idx]
        appid = g["steamId"]
        title = g.get("title", "")[:45]
        pct = (n + 1) / len(targets) * 100
        bar = int(pct / 2) * "█" + (50 - int(pct / 2)) * "░"
        print(f"\r  [{bar}] {pct:5.1f}%  {n+1}/{len(targets)}  {title:<45}", end="", flush=True)

        raw = fetch_steam_details(appid)
        time.sleep(REQUEST_DELAY)

        if raw:
            games[idx] = apply_steam_data(raw, g, appid)
            fetched += 1
        else:
            failed += 1

        if (n + 1) % CHECKPOINT_EVERY == 0:
            INPUT_PATH.write_text(json.dumps(games, ensure_ascii=False), encoding="utf-8")

    # Final save
    INPUT_PATH.write_text(json.dumps(games, ensure_ascii=False), encoding="utf-8")

    print(f"\n\nDone.")
    print(f"  Successfully enriched: {fetched}")
    print(f"  Failed / no data:      {failed} (Steam may not have data for these)")
    print(f"  Already had data:      {skipped}")

    # Spot check
    print("\nSpot check — first 5 re-enriched games:")
    enriched = [games[i] for i in targets if games[i].get("developer")]
    for g in enriched[:5]:
        print(f"  {g['title']!r}: dev={g['developer']!r}, rating={g.get('rating')}, genres={g.get('genres')}")


if __name__ == "__main__":
    main()
