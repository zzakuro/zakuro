#!/usr/bin/env python3
"""
IGDB enrichment for games with no steamId and missing metadata.
================================================================
Targets games where steamId is None AND metadata is missing.
Uses IGDB to find cover art, screenshots, description, rating,
genres, developer, and release date.

Also extracts Steam appids from IGDB's external_games data,
so running this may also fill in steamId for previously-unknown
games, making backfill_covers.py able to get covers for them too.

Checkpoints every 50 games - safe to Ctrl+C and re-run.

Usage (run from fitlib/ directory):
    python3 igdb_enrich_missing.py [path/to/merged_enriched.json]
"""
import json
import os
import sys
import time
import re
from pathlib import Path
from difflib import SequenceMatcher

import requests
from dotenv import load_dotenv

load_dotenv()

INPUT_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public/merged_enriched.json")
CHECKPOINT_EVERY = 50
REQUEST_DELAY = 0.25
MAX_RETRIES = 3
CONFIDENCE_THRESHOLD = 0.6

IGDB_CLIENT_ID = os.getenv("IGDB_CLIENT_ID")
IGDB_CLIENT_SECRET = os.getenv("IGDB_CLIENT_SECRET")

if not IGDB_CLIENT_ID or not IGDB_CLIENT_SECRET:
    print("ERROR: IGDB_CLIENT_ID and IGDB_CLIENT_SECRET must be set in .env")
    sys.exit(1)

session = requests.Session()
igdb_token = None
igdb_token_expires = 0


def get_igdb_token() -> str:
    global igdb_token, igdb_token_expires
    if igdb_token and time.time() < igdb_token_expires:
        return igdb_token
    r = session.post(
        "https://id.twitch.tv/oauth2/token",
        params={
            "client_id": IGDB_CLIENT_ID,
            "client_secret": IGDB_CLIENT_SECRET,
            "grant_type": "client_credentials",
        },
        timeout=10,
    )
    r.raise_for_status()
    data = r.json()
    igdb_token = data["access_token"]
    igdb_token_expires = time.time() + data["expires_in"] - 60
    return igdb_token


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def clean_query(title: str) -> str:
    """Strip version/edition noise before searching IGDB."""
    t = re.split(r"\s[–\-:]\s", title)[0]
    t = re.sub(r"[™®©]", "", t).strip()
    return t


def igdb_search(title: str) -> dict:
    """Search IGDB for a game by title. Returns enrichment dict or {}."""
    token = get_igdb_token()
    q = clean_query(title).replace('"', '\\"')
    body = (
        f'search "{q}"; '
        f'fields name,summary,rating,first_release_date,'
        f'cover.url,screenshots.url,genres.name,'
        f'involved_companies.company.name,involved_companies.developer,'
        f'involved_companies.publisher,'
        f'external_games.uid,external_games.category;'
        f'limit 3;'
    )
    for attempt in range(MAX_RETRIES):
        try:
            r = session.post(
                "https://api.igdb.com/v4/games",
                headers={
                    "Client-ID": IGDB_CLIENT_ID,
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "text/plain",
                },
                data=body,
                timeout=10,
            )
            if r.status_code == 429:
                time.sleep(0.5 * (attempt + 1))
                continue
            if not r.ok:
                return {}
            results = r.json()
            if not results:
                return {}
            # Pick best match by title similarity
            best = max(results, key=lambda x: similarity(title, x.get("name", "")))
            if similarity(title, best.get("name", "")) < CONFIDENCE_THRESHOLD:
                return {}
            return best
        except (requests.RequestException, ValueError):
            time.sleep(2)
    return {}


def apply_igdb(raw: dict, game: dict) -> dict:
    """Apply IGDB data onto an existing game dict."""
    if not raw:
        return game

    # Developer / publisher
    companies = raw.get("involved_companies", [])
    devs = [c["company"]["name"] for c in companies
            if c.get("developer") and c.get("company")]
    pubs = [c["company"]["name"] for c in companies
            if c.get("publisher") and c.get("company")]
    if devs and not game.get("developer"):
        game["developer"] = ", ".join(devs)
    if pubs:
        existing_pubs = set(game.get("publisher", "").split(", "))
        new_pubs = [p for p in pubs if p not in existing_pubs]
        if new_pubs:
            all_pubs = [p for p in existing_pubs if p] + new_pubs
            game["publisher"] = ", ".join(all_pubs)

    # Genres
    genres = [g["name"] for g in raw.get("genres", [])]
    if genres:
        game["genres"] = genres

    # Rating
    if raw.get("rating") and not game.get("rating"):
        game["rating"] = round(raw["rating"])

    # Summary
    if raw.get("summary") and (not game.get("summary") or
            game.get("summary", "").startswith("Available via:")):
        game["summary"] = raw["summary"]

    # Release date
    if raw.get("first_release_date") and not game.get("releaseDate"):
        import datetime
        ts = raw["first_release_date"]
        game["releaseDate"] = datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")

    # Cover image
    cover = raw.get("cover", {})
    if cover.get("url") and not game.get("coverImage"):
        url = cover["url"].replace("//", "https://").replace("t_thumb", "t_cover_big")
        game["coverImage"] = url

    # Screenshots
    screens = raw.get("screenshots", [])
    if screens and not game.get("screenshots"):
        urls = [s["url"].replace("//", "https://").replace("t_thumb", "t_screenshot_big")
                for s in screens[:6]]
        game["screenshots"] = urls
    if screens and not game.get("screenshot"):
        game["screenshot"] = screens[0]["url"].replace("//", "https://").replace(
            "t_thumb", "t_screenshot_big")

    # Extract Steam appid from external_games (category 1 = Steam)
    if not game.get("steamId"):
        for ext in raw.get("external_games", []):
            if ext.get("category") == 1:  # 1 = Steam
                try:
                    game["steamId"] = int(ext["uid"])
                    # Also set Steam cover as it's usually higher quality
                    if not game.get("coverImage"):
                        game["coverImage"] = (
                            f"https://cdn.akamai.steamstatic.com/steam/apps/"
                            f"{game['steamId']}/library_600x900.jpg"
                        )
                except (ValueError, KeyError):
                    pass
                break

    return game


def needs_igdb_enrichment(g: dict) -> bool:
    """True if game has no steamId and is missing real metadata."""
    if g.get("steamId"):
        return False  # already handled by reenrich_missing.py
    if g.get("developer") and g.get("rating", 0) > 0:
        return False  # already enriched
    if g.get("coverImage") and g.get("developer"):
        return False
    return True


def main():
    if not INPUT_PATH.exists():
        print(f"ERROR: {INPUT_PATH} not found.")
        sys.exit(1)

    print(f"Loading {INPUT_PATH}...")
    games = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    print(f"  {len(games)} games total")

    targets = [i for i, g in enumerate(games) if needs_igdb_enrichment(g)]
    print(f"  {len(targets)} games need IGDB enrichment")
    print(f"  Estimated time: ~{len(targets) * REQUEST_DELAY / 60:.0f} minutes")
    print(f"  Safe to Ctrl+C and re-run (checkpoints every {CHECKPOINT_EVERY} games)\n")

    get_igdb_token()

    enriched = 0
    failed = 0
    steam_ids_found = 0

    for n, idx in enumerate(targets):
        g = games[idx]
        title = g.get("title", "")[:45]
        pct = (n + 1) / len(targets) * 100
        bar = int(pct / 2) * "█" + (50 - int(pct / 2)) * "░"
        print(f"\r  [{bar}] {pct:5.1f}%  {n+1}/{len(targets)}  {title:<45}",
              end="", flush=True)

        raw = igdb_search(g.get("title", ""))
        time.sleep(REQUEST_DELAY)

        if raw:
            had_steam = bool(games[idx].get("steamId"))
            games[idx] = apply_igdb(raw, games[idx])
            enriched += 1
            if not had_steam and games[idx].get("steamId"):
                steam_ids_found += 1
        else:
            failed += 1

        if (n + 1) % CHECKPOINT_EVERY == 0:
            INPUT_PATH.write_text(json.dumps(games, ensure_ascii=False),
                                   encoding="utf-8")

    INPUT_PATH.write_text(json.dumps(games, ensure_ascii=False), encoding="utf-8")

    print(f"\n\nDone.")
    print(f"  Successfully enriched: {enriched}")
    print(f"  New steamIds found:    {steam_ids_found}")
    print(f"  No match found:        {failed}")

    print("\nSpot check — first 5 IGDB-enriched games:")
    igdb_enriched = [games[i] for i in targets if games[i].get("developer")]
    for g in igdb_enriched[:5]:
        print(f"  {g['title']!r}: dev={g['developer']!r}, "
              f"rating={g.get('rating')}, steamId={g.get('steamId')}")


if __name__ == "__main__":
    main()
