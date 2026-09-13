"""
Zakuro's Archive Game Enrichment Script
------------------------------
Selects the most popular games from merged.json (priority titles first,
then by number of download sources), enriches them with Steam + IGDB
metadata, and outputs an enriched JSON matching the target format.

Usage:
    python3 enrich_games.py \
        --input  public/merged.json \
        --output public/enriched.json \
        --limit  200 \
        --igdb-client-id YOUR_CLIENT_ID \
        --igdb-client-secret YOUR_CLIENT_SECRET

IGDB credentials: https://api-docs.igdb.com/#getting-started
Steam API: No key needed.
"""

import re
import sys
import json
import time
import argparse
import urllib.request
import urllib.parse
import urllib.error

# ---------------------------------------------------------------------------
# Title Cleaning
# ---------------------------------------------------------------------------

CLEAN_PATTERNS = [
    r"\(Build\s[\d\.]+[^)]*\)",
    r"\(v[\d\.]+[^)]*\)",
    r"\bv[\d]+\.[\d]+[\d\.]*\b",
    r"\(Early Access\)",
    r"\(MULTi\d+\)",
    r",\s*MULTi\d+",
    r"\(All DLCs[^)]*\)",
    r"\(Fast Install[^)]*\)",
    r"\(Hypervisor\)",
    r"RePack\s+[от]+\s+\w+",
    r"RePack\b.*",
    r"\(\d{4}\)\s*$",
    r"\(\d{4}/\d{2}/\d{2}\)",
    r"\s*[:\-–]\s*Deluxe Edition",
    r"\s*[:\-–]\s*Complete Edition",
    r"\s*[:\-–]\s*GOTY Edition",
    r"\s*[:\-–]\s*Gold Edition",
    r"\s*&\s*.*Bundle",
    r"\s*PC\s*\|\s*Лицензия",
    r"\s*PC\s*\|\s*RePack.*",
]

def clean_title(raw: str) -> str:
    title = raw
    for pat in CLEAN_PATTERNS:
        title = re.sub(pat, "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s{2,}", " ", title).strip().strip("()-–,")
    return title


# ---------------------------------------------------------------------------
# Popularity Ranking
# ---------------------------------------------------------------------------

PRIORITY_TITLES = [
    "Elden Ring", "Cyberpunk 2077", "Baldur's Gate 3", "The Witcher 3",
    "Red Dead Redemption 2", "GTA V", "Grand Theft Auto V", "GTA",
    "Dark Souls", "Sekiro", "Lies of P", "Black Myth",
    "Hollow Knight", "Hades", "Celeste", "Terraria",
    "Stardew Valley", "Among Us", "Minecraft", "Rust", "Valheim",
    "Deep Rock Galactic", "Monster Hunter", "Devil May Cry 5",
    "Resident Evil", "Doom Eternal", "Half-Life", "Portal",
    "Left 4 Dead", "Counter-Strike", "Team Fortress",
    "Mass Effect", "Dragon Age", "Fallout 4", "Fallout New Vegas",
    "Skyrim", "Oblivion", "Bloodborne", "Armored Core",
    "Persona 4", "Persona 5", "Final Fantasy", "Kingdom Hearts",
    "Nier Automata", "Death Stranding", "God of War",
    "Ghost of Tsushima", "Horizon Zero Dawn", "Horizon Forbidden West",
    "Spider-Man", "Batman Arkham", "Assassin's Creed",
    "Far Cry", "Watch Dogs", "Rainbow Six", "The Division",
    "Dishonored", "Prey", "Deathloop", "Bioshock", "Deus Ex",
    "XCOM", "Civilization", "Total War", "Age of Empires",
    "Diablo", "Path of Exile", "Torchlight",
    "Hades II", "Pyre", "Transistor", "Bastion",
    "Ori and the Blind Forest", "Cuphead", "Shovel Knight",
    "Dead Cells", "Rogue Legacy", "Slay the Spire",
    "Into the Breach", "FTL", "Hotline Miami", "Disco Elysium",
    "Divinity Original Sin", "Pillars of Eternity",
    "Mount and Blade", "Kingdom Come Deliverance",
    "Euro Truck Simulator", "American Truck Simulator",
    "Cities Skylines", "Factorio", "Satisfactory",
    "Subnautica", "The Forest", "Sons of the Forest",
    "No Man's Sky", "Kerbal Space Program", "Space Engineers",
    "RimWorld", "Dwarf Fortress", "Oxygen Not Included",
    "Don't Starve", "Darkest Dungeon", "Vampire Survivors",
    "Risk of Rain", "Control", "Alan Wake",
    "Wolfenstein", "Quake", "Ultrakill", "Dusk",
    "007 First Light", "James Bond",
    "Call of Duty", "Battlefield", "Medal of Honor",
    "Forza Horizon", "Need for Speed", "Burnout",
    "Tekken", "Street Fighter", "Mortal Kombat", "Guilty Gear",
    "Dragon Ball", "Sonic", "Crash Bandicoot",
    "Tomb Raider", "Uncharted", "Indiana Jones",
    "LEGO", "South Park", "Ghostrunner", "Katana Zero",
    "Outer Wilds", "Outer Worlds", "Firewatch", "Stray",
    "Warhammer", "Vermintide", "Helldivers", "Darktide",
    "Payday", "Back 4 Blood", "Phasmophobia", "Lethal Company",
    "Little Nightmares", "Limbo", "Inside", "A Plague Tale",
    "Spec Ops The Line", "Gunfire Reborn", "Returnal",
    "Loop Hero", "Deep Rock", "Five Nights", "FNAF",
]

def score_game(game: dict) -> tuple:
    title = game.get("title", "").lower()
    sources = len(game.get("downloadSources", []))
    is_priority = any(p.lower() in title for p in PRIORITY_TITLES)
    return (-int(is_priority), -sources)

def rank_games(games: list) -> list:
    return sorted(games, key=score_game)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def http_get(url: str, headers: dict = None, timeout: int = 10):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"    [HTTP GET ERROR] {url[:80]} -> {e}")
        return None

def http_post(url: str, body: str, headers: dict, timeout: int = 10):
    data = body.encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"    [HTTP POST ERROR] {url[:80]} -> {e}")
        return None


# ---------------------------------------------------------------------------
# Steam
# ---------------------------------------------------------------------------

def steam_search(title: str):
    q = urllib.parse.quote(title)
    url = f"https://store.steampowered.com/api/storesearch/?term={q}&l=english&cc=US"
    data = http_get(url)
    if not data or not data.get("items"):
        return None
    title_lower = title.lower()
    for item in data["items"]:
        if item.get("name", "").lower() == title_lower:
            return item["id"]
    return data["items"][0]["id"]

def steam_details(appid: int) -> dict:
    url = f"https://store.steampowered.com/api/appdetails?appids={appid}&l=english"
    raw = http_get(url)
    if not raw:
        return {}
    info = raw.get(str(appid), {})
    if not info.get("success") or not info.get("data"):
        return {}
    d = info["data"]
    genres = [g["description"] for g in d.get("genres", [])]
    screenshots = [s["path_full"] for s in d.get("screenshots", [])]
    cover = f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"
    screenshot = screenshots[0] if screenshots else f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/page_bg_generated_v6b.jpg"
    sys_req = {}
    win = d.get("pc_requirements", {})
    if isinstance(win, list):
        win = win[0] if win else {}
    if isinstance(win, dict) and win.get("minimum"):
        sys_req["windows"] = {"minimum": {"raw": win["minimum"]}}
        if win.get("recommended"):
            sys_req["windows"]["recommended"] = {"raw": win["recommended"]}
    return {
        "title": d.get("name", ""),
        "developer": ", ".join(d.get("developers", [])),
        "publisher": ", ".join(d.get("publishers", [])),
        "summary": d.get("short_description") or d.get("about_the_game", ""),
        "releaseDate": d.get("release_date", {}).get("date", ""),
        "rating": d.get("metacritic", {}).get("score", 0) or 0,
        "genres": genres,
        "coverImage": cover,
        "screenshot": screenshot,
        "systemRequirements": sys_req,
        "steamId": appid,
    }


# ---------------------------------------------------------------------------
# IGDB
# ---------------------------------------------------------------------------

_igdb_token_cache = {"token": None, "expires": 0}

def get_igdb_token(client_id: str, client_secret: str):
    now = time.time()
    if _igdb_token_cache["token"] and now < _igdb_token_cache["expires"]:
        return _igdb_token_cache["token"]
    url = f"https://id.twitch.tv/oauth2/token?client_id={client_id}&client_secret={client_secret}&grant_type=client_credentials"
    data = http_post(url, "", {"Content-Type": "application/x-www-form-urlencoded"})
    if not data or "access_token" not in data:
        print("    [IGDB] Failed to get OAuth token.")
        return None
    _igdb_token_cache["token"] = data["access_token"]
    _igdb_token_cache["expires"] = now + data.get("expires_in", 3600) - 60
    return data["access_token"]

def igdb_search(title: str, client_id: str, token: str) -> dict:
    safe = title.replace('"', '\\"')
    body = (
        f'search "{safe}"; '
        f'fields id, name, summary, rating, first_release_date, '
        f'genres.name, cover.url, screenshots.url, '
        f'involved_companies.company.name, involved_companies.developer, involved_companies.publisher; '
        f'limit 1;'
    )
    result = http_post(
        "https://api.igdb.com/v4/games",
        body,
        {"Client-ID": client_id, "Authorization": f"Bearer {token}", "Content-Type": "text/plain"},
    )
    if not result or not isinstance(result, list) or len(result) == 0:
        return {}
    g = result[0]
    igdb_id = g.get("id")
    rating = round(g["rating"]) if g.get("rating") else 0
    genres = [genre["name"] for genre in g.get("genres", [])]
    cover_url = ""
    if g.get("cover", {}).get("url"):
        cover_url = "https:" + g["cover"]["url"].replace("t_thumb", "t_cover_big")
    screenshot_url = ""
    if g.get("screenshots"):
        screenshot_url = "https:" + g["screenshots"][0]["url"].replace("t_thumb", "t_screenshot_big")
    developers, publishers = [], []
    for ic in g.get("involved_companies", []):
        co = ic.get("company", {}).get("name", "")
        if ic.get("developer"):
            developers.append(co)
        if ic.get("publisher"):
            publishers.append(co)
    release_ts = g.get("first_release_date")
    release_date = ""
    if release_ts:
        import datetime
        release_date = datetime.datetime.utcfromtimestamp(release_ts).strftime("%Y-%m-%d")
    return {
        "igdbId": igdb_id,
        "rating": rating,
        "genres": genres,
        "summary": g.get("summary", ""),
        "releaseDate": release_date,
        "developer": ", ".join(developers),
        "publisher": ", ".join(publishers),
        "coverImage": cover_url,
        "screenshot": screenshot_url,
    }


# ---------------------------------------------------------------------------
# Parse Steam HTML sysreqs
# ---------------------------------------------------------------------------

def parse_steam_sysreq(raw_html: str) -> dict:
    text = re.sub(r"<[^>]+>", " ", raw_html)
    text = re.sub(r"\s{2,}", " ", text).strip()
    fields = {"raw_text": text}
    for key, pattern in [
        ("os", r"OS[:\*\s]+([^\n<]+)"),
        ("processor", r"Processor[:\*\s]+([^\n<]+)"),
        ("memory", r"Memory[:\*\s]+([^\n<]+)"),
        ("graphics", r"Graphics[:\*\s]+([^\n<]+)"),
        ("storage", r"Storage[:\*\s]+([^\n<]+)"),
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            fields[key] = m.group(1).strip().rstrip(";").strip()
    return fields


# ---------------------------------------------------------------------------
# Download source cleaning
# ---------------------------------------------------------------------------

def clean_download_sources(sources: list) -> list:
    seen_urls = set()
    cleaned = []
    for src in sources:
        url = src.get("url", "")
        if url in seen_urls:
            continue
        seen_urls.add(url)
        repacker = src.get("repacker")
        if not repacker:
            name = src.get("name", "")
            repacker = name.split()[0] if name else "Unknown"
        cleaned.append({**src, "repacker": repacker})
    return cleaned


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

def build_enriched_entry(raw: dict, steam: dict, igdb: dict) -> dict:
    def pick(*values):
        for v in values:
            if v:
                return v
        return ""

    def pick_num(*values):
        for v in values:
            if v and v > 0:
                return v
        return 0

    sys_req = raw.get("systemRequirements", {})
    if steam.get("systemRequirements", {}).get("windows", {}).get("minimum", {}).get("raw"):
        win = steam["systemRequirements"]["windows"]
        parsed_min = parse_steam_sysreq(win["minimum"]["raw"])
        parsed_rec = parse_steam_sysreq(win.get("recommended", {}).get("raw", "")) if win.get("recommended") else None
        sys_req = {"windows": {"minimum": parsed_min}}
        if parsed_rec:
            sys_req["windows"]["recommended"] = parsed_rec

    cover = pick(steam.get("coverImage"), igdb.get("coverImage"), raw.get("coverImage", ""))
    screenshot = pick(steam.get("screenshot"), igdb.get("screenshot"), raw.get("screenshot", ""))

    return {
        "id": raw["id"],
        "title": pick(steam.get("title"), raw["title"]),
        "developer": pick(steam.get("developer"), igdb.get("developer"), raw.get("developer", "")),
        "publisher": pick(steam.get("publisher"), igdb.get("publisher"), raw.get("publisher", "")),
        "genres": steam.get("genres") or igdb.get("genres") or raw.get("genres", []),
        "releaseDate": pick(steam.get("releaseDate"), igdb.get("releaseDate"), raw.get("releaseDate", "")),
        "rating": pick_num(steam.get("rating"), igdb.get("rating"), raw.get("rating", 0)),
        "fileSize": raw.get("fileSize", ""),
        "magnetLink": raw.get("magnetLink", ""),
        "coverImage": cover,
        "screenshot": screenshot,
        "summary": pick(steam.get("summary"), igdb.get("summary"), raw.get("summary", "")),
        "systemRequirements": sys_req,
        "stats": raw.get("stats", {"downloads": 0, "views": 0, "updatedAt": ""}),
        "steamId": steam.get("steamId") or raw.get("steamId"),
        "igdbId": igdb.get("igdbId") or raw.get("igdbId"),
        "downloadSources": clean_download_sources(raw.get("downloadSources", [])),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Enrich Zakuro's Archive game entries with Steam + IGDB metadata.")
    parser.add_argument("--input",  default="public/merged.json", help="Path to merged.json")
    parser.add_argument("--output", default="public/enriched.json", help="Output path")
    parser.add_argument("--limit",  type=int, default=200, help="Number of games to process")
    parser.add_argument("--igdb-client-id",     default="", help="Twitch/IGDB Client ID")
    parser.add_argument("--igdb-client-secret", default="", help="Twitch/IGDB Client Secret")
    parser.add_argument("--delay", type=float, default=1.2, help="Seconds to wait between games (rate limiting)")
    args = parser.parse_args()

    use_igdb = bool(args.igdb_client_id and args.igdb_client_secret)

    with open(args.input, encoding="utf-8") as f:
        all_games = json.load(f)

    print(f"Ranking {len(all_games)} games by popularity...")
    ranked = rank_games(all_games)

    print(f"\nTop 10 selected games:")
    for g in ranked[:10]:
        sources = len(g.get("downloadSources", []))
        print(f"  [{sources} sources] {g['title']}")
    print()

    batch = ranked[:args.limit]
    print(f"Processing {len(batch)} games...")

    if use_igdb:
        print("IGDB enrichment: ENABLED")
        igdb_token = get_igdb_token(args.igdb_client_id, args.igdb_client_secret)
    else:
        print("IGDB enrichment: DISABLED (no credentials provided — Steam only)")
        igdb_token = None

    results = []
    for i, entry in enumerate(batch, 1):
        raw_title = entry.get("title", "")
        clean = clean_title(raw_title)
        print(f"\n[{i}/{len(batch)}] \"{raw_title}\" -> searching as \"{clean}\"")

        steam_data = {}
        appid = steam_search(clean)
        if appid:
            print(f"    Steam appid: {appid}")
            steam_data = steam_details(appid)
            print(f"    Steam title: {steam_data.get('title', '?')}")
        else:
            print(f"    Steam: not found")

        igdb_data = {}
        if use_igdb and igdb_token:
            igdb_data = igdb_search(clean, args.igdb_client_id, igdb_token)
            if igdb_data.get("igdbId"):
                print(f"    IGDB id: {igdb_data['igdbId']}")
            else:
                print(f"    IGDB: not found")

        enriched = build_enriched_entry(entry, steam_data, igdb_data)
        results.append(enriched)

        if i < len(batch):
            time.sleep(args.delay)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    found_steam = sum(1 for r in results if r.get("steamId"))
    found_igdb  = sum(1 for r in results if r.get("igdbId"))
    print(f"\nDone! {len(results)} games written to {args.output}")
    print(f"  Steam matched: {found_steam}/{len(results)}")
    if use_igdb:
        print(f"  IGDB  matched: {found_igdb}/{len(results)}")


if __name__ == "__main__":
    main()
