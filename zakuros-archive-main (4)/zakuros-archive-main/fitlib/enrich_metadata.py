#!/usr/bin/env python3
"""
Zakuro's Archive — Metadata Enricher
============================
Enriches merged.json with real metadata from IGDB (primary) and Steam (fallback).
Pulls: cover art, screenshots, description, genres, rating, developer, publisher,
       release date, system requirements.

Usage:
    python3 enrich_metadata.py

Requirements:
    pip install requests tqdm

Setup:
    Copy your .env file next to this script, or just set these two env vars:
        IGDB_CLIENT_ID=your_twitch_client_id
        IGDB_CLIENT_SECRET=your_twitch_client_secret

    Both come from https://dev.twitch.tv/console — create an app there,
    the Client ID and Secret are on that page.

Resume:
    If interrupted, just re-run. Progress is saved every 100 games to
    enrich_checkpoint.json and the output file is written incrementally.

Output:
    merged_enriched.json — drop this into your fitlib/public/ folder and set
    VITE_GAMES_JSON=/merged_enriched.json in your .env
"""

import json
import os
import re
import sys
import time
import requests
from pathlib import Path
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────────
INPUT_FILE = "public/merged.json"
OUTPUT_FILE = "public/merged_enriched.json"
CHECKPOINT_FILE  = "enrich_checkpoint.json"
CHECKPOINT_EVERY = 100      # save progress every N games
IGDB_DELAY       = 0.25     # seconds between IGDB calls (4 req/s, limit is 4/s)
STEAM_DELAY      = 1.5      # seconds between Steam calls
RETRY_DELAY      = 15       # seconds to wait after a 429
MAX_RETRIES      = 3
# ─────────────────────────────────────────────────────────────────────────────

# Load env from .env file if present
def load_env():
    env_path = Path(".env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"'))

load_env()

IGDB_CLIENT_ID     = os.environ.get("IGDB_CLIENT_ID", "")
IGDB_CLIENT_SECRET = os.environ.get("IGDB_CLIENT_SECRET", "")

if not IGDB_CLIENT_ID or not IGDB_CLIENT_SECRET:
    print("ERROR: IGDB_CLIENT_ID and IGDB_CLIENT_SECRET must be set.")
    print("  Either set them in your .env file or export them as environment variables.")
    print("  Get them from https://dev.twitch.tv/console")
    sys.exit(1)

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 Zakuro-Enricher/1.0",
    "Accept-Language": "en-US,en;q=0.9",
})

# ── IGDB Auth ─────────────────────────────────────────────────────────────────
igdb_token = None
igdb_token_expires = 0

def get_igdb_token() -> str:
    global igdb_token, igdb_token_expires
    if igdb_token and time.time() < igdb_token_expires:
        return igdb_token
    print("  [IGDB] Fetching OAuth token...")
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
    print("  [IGDB] Token obtained.")
    return igdb_token


# ── IGDB Fetch ────────────────────────────────────────────────────────────────
def clean_title_for_search(title: str) -> str:
    t = re.split(r"\s[–\-:]\s", title)[0]
    t = re.sub(r"[™®©]", "", t)
    # escape quotes for IGDB query
    t = t.replace('"', '\\"')
    return t.strip()


def igdb_fetch(title: str) -> dict:
    token = get_igdb_token()
    query = clean_title_for_search(title)

    body = (
        f'search "{query}"; '
        f'fields name, summary, storyline, rating, first_release_date, '
        f'cover.url, screenshots.url, genres.name, '
        f'involved_companies.company.name, involved_companies.developer, involved_companies.publisher; '
        f'limit 1;'
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
                print(f"\n  [IGDB 429] Rate limited, waiting {RETRY_DELAY}s...")
                time.sleep(RETRY_DELAY)
                continue
            if r.status_code == 401:
                # Token expired mid-run, refresh
                igdb_token = None
                token = get_igdb_token()
                continue
            if not r.ok:
                return {}
            games = r.json()
            if not games:
                return {}
            return games[0]
        except requests.RequestException as e:
            print(f"\n  [IGDB Error] {e}")
            time.sleep(2)
    return {}


def parse_igdb(raw: dict, game: dict) -> dict:
    if not raw:
        return game

    out = dict(game)

    if raw.get("name"):
        out["title"] = raw["name"]

    if raw.get("summary"):
        out["summary"] = raw["summary"]
    elif raw.get("storyline"):
        out["summary"] = raw["storyline"]

    if raw.get("rating"):
        out["rating"] = round(raw["rating"])

    if raw.get("first_release_date"):
        ts = raw["first_release_date"]
        out["releaseDate"] = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")

    if raw.get("genres"):
        out["genres"] = [g["name"] for g in raw["genres"]]

    # Cover art — IGDB returns //images.igdb.com/... URLs
    if raw.get("cover", {}).get("url"):
        url = raw["cover"]["url"]
        # Upgrade to high-res (t_cover_big = 264x374, t_1080p for bg)
        url = url.replace("//", "https://").replace("t_thumb", "t_cover_big")
        out["coverImage"] = url

    # Screenshots
    if raw.get("screenshots"):
        out["screenshots"] = [
            s["url"].replace("//", "https://").replace("t_thumb", "t_screenshot_big")
            for s in raw["screenshots"][:6]
        ]
        if out["screenshots"]:
            out["screenshot"] = out["screenshots"][0]

    # Developer / Publisher
    devs, pubs = [], []
    for ic in raw.get("involved_companies") or []:
        company = (ic.get("company") or {}).get("name", "")
        if company:
            if ic.get("developer"):
                devs.append(company)
            if ic.get("publisher"):
                pubs.append(company)
    if devs:
        out["developer"] = ", ".join(devs)
    if pubs:
        out["publisher"] = ", ".join(pubs)

    out["_enriched_by"] = "igdb"
    return out


# ── Steam Search + Fetch ──────────────────────────────────────────────────────
from difflib import SequenceMatcher

def similarity(a, b):
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def steam_search_appid(title: str) -> int | None:
    query = clean_title_for_search(title)
    for attempt in range(MAX_RETRIES):
        try:
            r = session.get(
                "https://store.steampowered.com/api/storesearch/",
                params={"term": query, "l": "english", "cc": "US"},
                timeout=10,
            )
            if r.status_code == 429:
                time.sleep(RETRY_DELAY)
                continue
            if not r.ok:
                return None
            items = r.json().get("items", [])
            if not items:
                return None
            best_id, best_score = None, 0.0
            for item in items[:5]:
                score = similarity(title, item.get("name", ""))
                if score > best_score:
                    best_score = score
                    best_id = item.get("id")
            return best_id if best_score > 0.5 else None
        except requests.RequestException:
            time.sleep(2)
    return None


def steam_appdetails(appid: int) -> dict:
    for attempt in range(MAX_RETRIES):
        try:
            r = session.get(
                "https://store.steampowered.com/api/appdetails",
                params={"appids": appid, "l": "english"},
                timeout=10,
            )
            if r.status_code == 429:
                time.sleep(RETRY_DELAY)
                continue
            if not r.ok:
                return {}
            data = r.json().get(str(appid), {})
            if not data.get("success"):
                return {}
            return data.get("data", {})
        except requests.RequestException:
            time.sleep(2)
    return {}


def parse_steam(raw: dict, game: dict, appid: int) -> dict:
    if not raw:
        return game
    out = dict(game)
    out["steamId"] = appid

    if raw.get("name") and not out.get("title"):
        out["title"] = raw["name"]
    if raw.get("short_description"):
        out["summary"] = raw["short_description"]
    if raw.get("metacritic", {}).get("score"):
        out["rating"] = raw["metacritic"]["score"]
    if raw.get("developers"):
        out["developer"] = ", ".join(raw["developers"])
    if raw.get("publishers"):
        out["publisher"] = ", ".join(raw["publishers"])
    if raw.get("release_date", {}).get("date"):
        out["releaseDate"] = raw["release_date"]["date"]
    if raw.get("genres"):
        out["genres"] = [g["description"] for g in raw["genres"]]

    # Cover — Steam library portrait
    out["coverImage"] = f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"

    # Background / screenshot
    bg = raw.get("background_raw") or raw.get("background") or \
         f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/page_bg_generated_v6b.jpg"
    out["screenshot"] = bg

    if raw.get("screenshots"):
        out["screenshots"] = [s["path_full"] for s in raw["screenshots"][:6]]

    # System requirements
    pc = raw.get("pc_requirements", {})
    if isinstance(pc, dict):
        def strip_html(h):
            if not h:
                return {}
            clean = re.sub(r"<br\s*/?>", "\n", h)
            clean = re.sub(r"<[^>]+>", "", clean)
            result = {}
            for line in clean.split("\n"):
                if ":" in line:
                    k, _, v = line.partition(":")
                    k = k.strip().lower()
                    v = v.strip()
                    if "os" in k:          result["os"] = v
                    elif "processor" in k: result["processor"] = v
                    elif "memory" in k:    result["memory"] = v
                    elif "graphics" in k:  result["graphics"] = v
                    elif "storage" in k or "disk" in k: result["storage"] = v
            return result
        mn = strip_html(pc.get("minimum", ""))
        rc = strip_html(pc.get("recommended", ""))
        if not mn.get("storage") and out.get("fileSize"):
            mn["storage"] = out["fileSize"]
        if not mn.get("os"):
            mn["os"] = "Windows 10 64-bit"
        out["systemRequirements"] = {"windows": {"minimum": mn}}
        if rc:
            out["systemRequirements"]["windows"]["recommended"] = rc

    out["_enriched_by"] = out.get("_enriched_by", "") + "+steam"
    return out


# ── Checkpoint ────────────────────────────────────────────────────────────────
def load_checkpoint():
    if Path(CHECKPOINT_FILE).exists():
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {"done": {}, "last_index": 0}


def save_checkpoint(cp, games):
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(cp, f)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(games, f, indent=2, ensure_ascii=False)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 55)
    print("  Zakuro's Archive Metadata Enricher")
    print("  IGDB (primary) + Steam (fallback)")
    print("=" * 55)

    with open(INPUT_FILE, encoding="utf-8") as f:
        games = json.load(f)

    total = len(games)
    print(f"\n  Total games:  {total}")

    cp = load_checkpoint()
    done = cp.get("done", {})
    start = cp.get("last_index", 0)

    if start > 0:
        print(f"  Resuming from #{start} ({len(done)} already done)")

    igdb_hits   = 0
    steam_hits  = 0
    misses      = 0

    # Pre-fetch IGDB token once
    get_igdb_token()

    print()
    for i, game in enumerate(games):
        if i < start:
            continue

        gid   = game.get("id", str(i))
        title = game.get("title", "")

        if not title:
            continue

        # Already done in a previous run
        if gid in done:
            continue

        # Progress line
        pct = (i + 1) / total * 100
        bar = "█" * int(pct / 2) + "░" * (50 - int(pct / 2))
        print(f"\r[{bar}] {pct:5.1f}%  {i+1}/{total}  {title[:45]:<45}", end="", flush=True)

        enriched = False

        # ── Step 1: IGDB ──────────────────────────────────────────
        igdb_raw = igdb_fetch(title)
        time.sleep(IGDB_DELAY)

        if igdb_raw:
            games[i] = parse_igdb(igdb_raw, game)
            igdb_hits += 1
            enriched = True

        # ── Step 2: Steam fallback (or supplement) ────────────────
        # Use Steam if no cover yet, or if game has a steamId already
        needs_steam = not games[i].get("coverImage")

        if needs_steam or games[i].get("steamId"):
            appid = games[i].get("steamId") or steam_search_appid(title)
            time.sleep(STEAM_DELAY)
            if appid:
                steam_raw = steam_appdetails(appid)
                time.sleep(0.5)
                if steam_raw:
                    games[i] = parse_steam(steam_raw, games[i], appid)
                    steam_hits += 1
                    enriched = True

        if not enriched:
            misses += 1

        done[gid] = True

        # Checkpoint
        if (i + 1) % CHECKPOINT_EVERY == 0:
            cp["done"] = done
            cp["last_index"] = i + 1
            save_checkpoint(cp, games)

    # Final save
    print(f"\n\n  Saving {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(games, f, indent=2, ensure_ascii=False)

    if Path(CHECKPOINT_FILE).exists():
        os.remove(CHECKPOINT_FILE)

    print()
    print("=" * 55)
    print(f"  Done!")
    print(f"  IGDB matches:  {igdb_hits}")
    print(f"  Steam matches: {steam_hits}")
    print(f"  Not found:     {misses}")
    print(f"  Output:        {OUTPUT_FILE}")
    print()
    print("  Next steps:")
    print(f"  1. cp {OUTPUT_FILE} fitlib/public/")
    print(f"  2. Set VITE_GAMES_JSON=/merged_enriched.json in .env")
    print("=" * 55)


if __name__ == "__main__":
    main()
