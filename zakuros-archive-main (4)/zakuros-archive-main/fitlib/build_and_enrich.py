#!/usr/bin/env python3
"""
Zakuro's Archive — Build + Enrich (All-in-One)
======================================
1. Merges all 8 repacker JSONs into one deduplicated database
2. Cleans titles aggressively
3. Deduplicates after title cleaning
4. Enriches with IGDB (primary) + Steam (fallback)
5. Computes a popularityScore (Steam review count + source count) and
   sorts most-popular-first
6. Writes to public/merged_enriched.json

Usage (run from fitlib/ directory):
    python3 build_and_enrich.py

Requirements:
    pip install requests

Setup:
    Add to fitlib/.env:
        IGDB_CLIENT_ID=your_twitch_client_id
        IGDB_CLIENT_SECRET=your_twitch_client_secret
"""

import re
import json
import math
import os
import sys
import time
import requests
from pathlib import Path
from datetime import datetime
from difflib import SequenceMatcher

# ── Config ────────────────────────────────────────────────────────────────────

SOURCE_FILES = [
    "fitgirl.json",
    "dodi.json",
    "gog.json",
    "xatab.json",
    "steamrip.json",
    "onlinefix.json",
    "atop-games.json",
    "rexagames.json",
]

OUTPUT_FILE      = "public/merged_enriched.json"
CHECKPOINT_FILE  = "build_enrich_checkpoint.json"
CHECKPOINT_EVERY = 100
IGDB_DELAY       = 0.25
STEAM_DELAY      = 1.0
RETRY_DELAY      = 15
MAX_RETRIES      = 3

# ── Load .env ─────────────────────────────────────────────────────────────────

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
    print("ERROR: IGDB_CLIENT_ID and IGDB_CLIENT_SECRET must be set in .env")
    print("  Get them from https://dev.twitch.tv/console")
    sys.exit(1)

# ── Title cleaning ────────────────────────────────────────────────────────────

STRIP_PATTERNS = [
    r"\[.*?\]",
    r"\(.*?MULTi\d+.*?\)",
    r"\(v[\d\.]+[^)]*\)",
    r"\(Build[s]?\s[\d\.a-z\+\-]+[^)]*\)",
    r"\(From\s[\d\.]+ ?GB\)",
    r"\(All DLCs[^)]*\)",
    r"\(Fast Install[^)]*\)",
    r"\(Hypervisor\)",
    r"\(RUS[^)]*\)",
    r"\(ENG[^)]*\)",
    r"\(Bonus Content[^)]*\)",
    r"\(\d{4}(?:[/-]\d{2}){0,2}\)",
    r"\(\d{4}-\d{4}\)",
    r"\([^)]*(?:Company|Лицензия|Edition)[^)]*\)",
    r"\([^)]*(?:mod)[^)]*\)",
    r"\(\s*\)",
    r"\bv\.?[\d]+\.[\d][\d\.]*\b",
    r"\b\d+\.\d+\.\d+[\d\.a-z\+\-]*\b",
    r",\s*Builds?\s*[\d/]+",
    r"-rc\d+\+rel\.[\d\-]+",
    r"\bBuild\s+\d+\b",
    r"\bPatch\s+\d+\b",
    r"\bHotfix\s+\d+\b",
    r"\bUpdate\s+\d+\b",
    r",?\s*From\s+[\d\.]+\s*GB",
    r"\+\s*\d+\*?\s*DLCs?[^,\n]*",
    r"\+\s*(?:All\s+)?DLCs?",
    r"\+\s*\d+\s*Bonus\s+\w+",
    r"\+\s*Bonus\s+\w+",
    r"\+\s*(?:Online\s+)?Multiplayer",
    r"\+\s*OST\b",
    r"\+\s*Windows\s+\d+\s+Fix",
    r"\+\s*HR\s+Content\s+Pack\s*\d*",
    r"\+\s*(?:Additional\s+)?Art\s*&?\s*Music[^,\n]*",
    r"\+\s*English\s*/\s*Japanese",
    r"\+\s*\d+\s*Soundtracks?",
    r"\(Butcher[^)]*\)",
    r"[:\s,]+Digital\s+Deluxe\s+Edition",
    r"[:\s,]+Digital\s+Edition",
    r"[:\s,]+Digital\b",
    r"[:\s,]+Deluxe\s+Month\s+One\s+Edition",
    r"[:\s,]+Deluxe\s+Edition",
    r"[:\s,]+Complete\s+Edition",
    r"[-\s]+Complete\s+the\s+Set\s+Bundle",
    r"\([^,)]{0,80},[^)]{0,80}\)",
    r"[:\s,]+Ultimate\s+(?:Duty\s+)?Edition",
    r"[:\s,]+Gold\s+Edition",
    r"[:\s,]+GOTY\s+Edition",
    r"[:\s,]+Game\s+of\s+the\s+Year\s+Edition",
    r"[:\s,]+Premium\s+Edition",
    r"[:\s,]+Definitive\s+Edition",
    r"[:\s,]+Enhanced\s+Edition",
    r"[:\s,]+Anniversary\s+Edition",
    r"[:\s,]+Collector[s']?\s+Edition",
    r"[:\s,]+Director[s']?\s+Cut",
    r"[:\s,]+Standard\s+Edition",
    r"[:\s,]+Special\s+Edition",
    r"[:\s,]+Extended\s+Edition",
    r"\s+[\u2013\-]\s+\+.*",
    r"\s+[\u2013\-]\s+v[\d\.]+.*",
    r"\s+[\u2013\-]\s+\d+.*DLC.*",
    r"\s+[\u2013\-]\s+/.*",
    r",\s*/.*",
    r",\s*\+.*",
    r"\s+\+\s+\w[^+]+ (?:HD|Reworked|Project|mod|patch|fix).*",
    r"RePack\s+(?:от|by|from)\s+\w+",
    r"RePack\b.*",
    r"Repack\b.*",
    r"\bот\s+xatab\b",
    r"\bby\s+xatab\b",
    r"\bFree\s+Download\b",
    r"PC\s*\|\s*Лицензия",
    r"PC\s*\|\s*RePack.*",
    r"PC\s*\|.*$",
    r"\(Early Access\)",
    r"\s+\d+\.\d+[\d\.]*$",
    r"\s+\d{4}\s+Final$",
    r"\s+\d+\s+Final$",
    r"&\s*.+Bundle",
    r"\s+\(All\s+\d+\s+games?\)",
    r"RUSENG",
    r"\s+от\s+\w+$",
    r',\s*/\s*"[^"]*"\s+Edition',
    r"\s+Лицензия\s*$",
    r"\s*\+\s*$",
    r"\s*\|\s*$",
]
def clean_title(title: str) -> str:
    t = title
    for pat in STRIP_PATTERNS:
        t = re.sub(pat, " ", t, flags=re.IGNORECASE)
    # Second pass — remove empty parens left after stripping content
    t = re.sub(r"\(\s*\)", " ", t)
    t = re.sub(r"\(\s*,+\s*\)", " ", t)
    return re.sub(r"\s{2,}", " ", t).strip().strip(":-–,+|. ")

def normalize_for_match(title: str) -> str:
    t = clean_title(title).lower()
    t = re.sub(r"[^\w\s]", "", t)
    return re.sub(r"\s+", " ", t).strip()

# ── Improved merge key (fixes duplicate-card bug) ──────────────────────────────
#
# The original normalize_for_match() depends entirely on STRIP_PATTERNS
# catching every possible version/build format. New or unanticipated formats
# (e.g. Xatab's "v.3725.0", "v.3570.0/1.71") slip through untouched and each
# distinct version string ends up as its own "unique" game card.
#
# match_key() instead CUTS the title at the first version-looking marker, so
# unanticipated version formats are excluded by construction rather than by
# ever-growing regex denylist. It also resolves common numeral/abbreviation
# aliases (GTA <-> Grand Theft Auto, "V" <-> "5", etc.) so the same release
# advertised with different shorthand still merges into one card.
#
# This intentionally does NOT try to merge different editions/builds (e.g.
# "Enhanced" vs "Legacy" vs "Redux") into the base game — those stay as
# separate cards for now. That long-tail classification (which edition
# keywords mean "same game, repackaged" vs "genuinely different release")
# is a follow-up pass, not part of this fix.

_CUT_MARKERS = re.compile(
    r"""(
        \s*[\[\(]                                  # any bracket/paren opens
        | \s+v\.?\s*\d                               # " v1.2", " v.3725", " v. 1.5.78"
        | \s+[\u2013\-]\s*v\.?\s*\d                  # " - v1.2", " – v.3725"
        | \s+[\u2013\-]\s*/\d                        # " – /1.70" slash-version Xatab style
        | \s+(?:Build|Patch|Hotfix|Update)\s+\d      # " Build 3725"
        | \s+Update\s+From\b                         # Xatab "Update From X To Y"
        | \s+\d{1,3}(?:\.\d{1,5}){2,}                # bare dotted version "1.0.3725"
        | \s+\d+[a-f]{4,}                            # build hash e.g. " 11833a", " a5122"
        | \s+[a-f0-9]{6,}\b                          # pure hex build hash
        | \s+From\s+[\d\.]+\s*(?:MB|GB)             # Xatab size tag " From 848 MB"
        | \s+\u041b\u0438\u0446\u0435\u043d\u0437\u0438\u044f  # Cyrillic "Лицензия"
        | \s+Free\s+Download                        # scene-site filler
        | \s+RePack\b | \s+Repack\b
    )""",
    re.IGNORECASE | re.VERBOSE,
)

# Trailing noise words that appear after the real title and add no meaning
# to the merge key - stripped AFTER base_name extraction, during normalization.
_TRAILING_NOISE = re.compile(
    r"\s+\b(pc game|pc|for pc)\s*$",
    re.IGNORECASE,
)

# Repeated-phrase collapse for "X / Y" slash-alt-name titles where both
# sides alias to the same canonical string after numeral aliasing.
_SLASH_ALT = re.compile(r"\s*/\s*")

_NUMERAL_ALIASES = [
    (re.compile(r"\bgta\s*v\b", re.IGNORECASE), "grand theft auto v"),
    (re.compile(r"\bgta\s*5\b", re.IGNORECASE), "grand theft auto v"),
    (re.compile(r"\bgta\s*iv\b", re.IGNORECASE), "grand theft auto iv"),
    (re.compile(r"\bgta\s*4\b", re.IGNORECASE), "grand theft auto iv"),
    (re.compile(r"\bgta\s*iii\b", re.IGNORECASE), "grand theft auto iii"),
    (re.compile(r"\bgta\s*3\b", re.IGNORECASE), "grand theft auto iii"),
    (re.compile(r"\bgta\s*ii\b", re.IGNORECASE), "grand theft auto ii"),
    (re.compile(r"\bgta\s*2\b", re.IGNORECASE), "grand theft auto ii"),
    (re.compile(r"\bgta\b(?!\s*\w)", re.IGNORECASE), "grand theft auto"),
]

def _base_name(raw_title: str) -> str:
    """Title text before the first version/build marker."""
    cut = _CUT_MARKERS.split(raw_title, maxsplit=1)[0]
    return cut.strip(" -–:|,")

def _collapse_slash_alt(norm_text: str) -> str:
    """Resolve numeral aliases, then collapse 'X / Y' slash-alt-name titles.

    Handles two cases:
    1. Both sides alias to identical string: 'GTA 5 / Grand Theft Auto V'
       -> 'grand theft auto v grand theft auto v' -> 'grand theft auto v'
    2. One side is clearly a prefix of the other after aliasing:
       'Grand Theft Auto V / GTA 5 – /1.70 + NVE' -> take the shortest
       canonical side as the key."""
    t = norm_text
    for pattern, canon in _NUMERAL_ALIASES:
        t = pattern.sub(canon, t)

    # If there's a slash in the normalized text, take only the part before
    # the first slash as the key (after alias resolution, the pre-slash part
    # is the canonical title; anything after is an alt-name or annotation).
    if " / " in t:
        t = t.split(" / ")[0].strip()

    # Exact token-level repeat collapse (e.g. after alias both halves are same)
    tokens = t.split()
    half = len(tokens) // 2
    if half > 0 and tokens[:half] == tokens[half:half * 2]:
        tokens = tokens[:half] + tokens[half * 2:]
    return " ".join(tokens)


def match_key(raw_title: str) -> str:
    """The actual merge key used to group entries into one game card."""
    base = _base_name(raw_title)
    norm = re.sub(r"[:\-–]", " ", base.lower())
    norm = re.sub(r"[^\w\s/]", " ", norm)   # keep / for slash-alt collapse
    norm = re.sub(r"\s+", " ", norm).strip()
    norm = _TRAILING_NOISE.sub("", norm).strip()
    # Strip leading articles so "The Witcher 3" and "Witcher 3" share a key
    norm = re.sub(r"^(the|a|an)\s+", "", norm)
    norm = re.sub(r"[^\w\s]", " ", norm)    # now strip the / after collapse
    norm = re.sub(r"\s+", " ", norm).strip()
    return _collapse_slash_alt(norm)


def repacker_count_for(game: dict) -> int:
    """Number of DISTINCT repackers offering this game (FitGirl, DODI,
    GOG, Xatab, ...) - NOT the raw length of downloadSources.

    Some repackers (Xatab especially) re-upload the identical release
    under several different magnet hashes over time, so downloadSources
    can contain many entries from a SINGLE repacker for one real release
    (e.g. 6 separate Xatab magnet links, all the same "House Flipper"
    release, just re-seeded with different torrent hashes). Counting
    raw list length as "sources" for popularity purposes badly distorts
    rankings - a game could falsely outrank genuinely more popular games
    purely because one repacker re-uploaded it many times. All the
    mirrors are still kept and shown on the card; this only affects what
    the popularity MATH counts."""
    return len({s.get("repacker") for s in game.get("downloadSources", []) if s.get("repacker")})


def make_id(title: str) -> str:
    t = title.lower()
    t = re.sub(r"[^\w\s-]", "", t)
    return re.sub(r"[\s_]+", "-", t).strip("-")

def parse_date(date_str: str) -> datetime:
    if not date_str:
        return datetime.min
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(date_str[:19], fmt)
        except ValueError:
            continue
    return datetime.min

# ── Step 1: Build + merge + dedup ─────────────────────────────────────────────

def build_merged() -> list[dict]:
    print("\n" + "="*55)
    print("  STEP 1: Building merged database")
    print("="*55)

    index: dict[str, dict] = {}  # normalized_title -> entry

    for filename in SOURCE_FILES:
        path = Path(filename)
        if not path.exists():
            print(f"  WARNING: {filename} not found, skipping")
            continue

        with open(path, encoding="utf-8") as f:
            data = json.load(f)

        repacker_name = data.get("name", path.stem.title())
        downloads = data.get("downloads", [])

        # Within each repacker, keep only the most recent entry per normalized title
        repacker_index: dict[str, dict] = {}
        for item in downloads:
            raw_title = item.get("title", "").strip()
            if not raw_title:
                continue

            file_size = (item.get("fileSize") or "").strip()
            upload_date = (item.get("uploadDate") or "")[:10]
            norm = match_key(raw_title)
            if not norm:
                continue

            sources = []
            for uri in item.get("uris", []):
                if not uri:
                    continue
                is_torrent = uri.startswith("magnet:") or uri.endswith(".torrent")
                sources.append({
                    "name": f"{repacker_name} {'Magnet' if is_torrent else 'Direct'}",
                    "url": uri,
                    "type": "torrent" if is_torrent else "direct",
                    "repacker": repacker_name,
                    "fileSize": file_size,
                    "uploadDate": upload_date,
                })

            if not sources:
                continue

            entry = {
                "cleanTitle": clean_title(raw_title),
                "normalizedTitle": norm,
                "fileSize": file_size,
                "uploadDate": upload_date,
                "uploadDateParsed": parse_date(upload_date),
                "downloadSources": sources,
            }

            if norm not in repacker_index:
                repacker_index[norm] = entry
            else:
                # Keep most recent within same repacker
                if entry["uploadDateParsed"] > repacker_index[norm]["uploadDateParsed"]:
                    repacker_index[norm] = entry

        # Merge into global index
        for norm, entry in repacker_index.items():
            if norm not in index:
                index[norm] = {
                    "cleanTitle": entry["cleanTitle"],
                    "sources": [],
                    "uploadDate": entry["uploadDate"],
                }
            existing_urls = {s["url"] for s in index[norm]["sources"]}
            for src in entry["downloadSources"]:
                if src["url"] not in existing_urls:
                    index[norm]["sources"].append(src)
                    existing_urls.add(src["url"])
            if entry["uploadDate"] > index[norm]["uploadDate"]:
                index[norm]["uploadDate"] = entry["uploadDate"]

        print(f"  {repacker_name:<15} {len(repacker_index):>5} unique titles")

    print(f"\n  Total unique titles before post-dedup: {len(index)}")

    # Post-dedup: re-key cleaned titles to catch any remaining dupes
    post_index: dict[str, dict] = {}
    for norm, data in index.items():
        clean = data["cleanTitle"]
        post_norm = match_key(clean)
        if post_norm not in post_index:
            post_index[post_norm] = {"cleanTitle": clean, "sources": data["sources"], "uploadDate": data["uploadDate"]}
        else:
            existing_urls = {s["url"] for s in post_index[post_norm]["sources"]}
            for src in data["sources"]:
                if src["url"] not in existing_urls:
                    post_index[post_norm]["sources"].append(src)

    print(f"  Total unique titles after post-dedup:  {len(post_index)}")

    # Build game objects
    games = []
    for norm, data in post_index.items():
        sources = data["sources"]
        clean = data["cleanTitle"]
        sorted_srcs = sorted(sources, key=lambda s: parse_date(s.get("uploadDate", "")), reverse=True)
        file_size = next((s["fileSize"] for s in sorted_srcs if s.get("fileSize")), "")
        magnet = next((s["url"] for s in sources if s["type"] == "torrent"), "")
        repackers = list(dict.fromkeys(s["repacker"] for s in sources))
        upload_date = data["uploadDate"]

        games.append({
            "id": make_id(clean),
            "title": clean,
            "developer": "",
            "publisher": ", ".join(repackers),
            "genres": ["PC Game"],
            "releaseDate": upload_date,
            "rating": 0,
            "fileSize": file_size,
            "magnetLink": magnet,
            "coverImage": "",
            "screenshot": "",
            "screenshots": [],
            "summary": f"Available via: {', '.join(repackers)}",
            "steamId": None,
            "systemRequirements": {
                "windows": {
                    "minimum": {
                        "os": "Windows 10 64-bit",
                        "processor": "See original game requirements",
                        "memory": "8 GB RAM",
                        "storage": file_size or "See download page",
                    }
                }
            },
            "stats": {
                "downloads": 0,
                "views": 0,
                "updatedAt": upload_date,
            },
            "downloadSources": sources,
        })

    games.sort(key=lambda g: g["title"].lower())

    multi = sum(1 for g in games if len(g["downloadSources"]) > 1)
    print(f"  Games with 2+ sources: {multi}")
    return games

# ── Step 1.5: ID-verified merge for ambiguous "base vs base+suffix" pairs ──────
#
# build_merged() already fixes the version-number duplication bug safely
# (e.g. all of Xatab's "GTA V Legacy v.3725.0 / v.3570.0 / v.3521..." collapse
# into one card). What it does NOT do is decide whether two DIFFERENT titles
# are the same underlying game, e.g.:
#
#     "Reus 2"   vs  "Reus 2: Complete Edition"     <- same game, merge
#     "Far Cry"  vs  "Far Cry 3"                    <- different games, keep separate
#     "Far Cry 3" vs "Far Cry 3: Deluxe Edition"    <- same game, merge
#
# A title-string rule can't tell these apart reliably ("3" could be a sequel
# number OR part of an edition name). IGDB's own game IDs already encode
# this distinction correctly, so this step finds title-pairs that LOOK like
# they might be base-game/edition-of-the-same-game, asks IGDB what each one
# actually is, and only merges when IGDB confirms it's the same game ID.
#
# If IGDB has no confident match for either side, the pair is left UNMERGED
# (safe default - better to show two cards than to silently fuse two
# different games together).

def find_ambiguous_pairs(games: list[dict]) -> list[tuple[int, int]]:
    """Find (shorter_idx, longer_idx) pairs where the longer title starts
    with the shorter title's full text (a real word boundary, not a
    substring mid-word), suggesting 'same base name + extra qualifier'.

    Bucketed by FIRST MEANINGFUL WORD (skipping leading "the"/"a"/"an").
    Bucketing by two words would silently miss every single-word base title
    with a multi-word edition variant - e.g. "Mafia" (1 word, bucket key
    "mafia") vs "Mafia: Definitive Edition" (bucket key "mafia definitive")
    would land in different buckets and never even be compared. Single-word
    game titles are common enough (Mafia, Doom, Control, Hades, Celeste...)
    that this isn't an edge case. Skipping leading articles matters too -
    "The Witcher 3" and "The Last of Us" share nothing but "the" and
    shouldn't be lumped into one ~900-title bucket together."""
    _LEADING_ARTICLES = {"the", "a", "an"}
    by_first_word: dict[str, list[int]] = {}
    for i, g in enumerate(games):
        words = re.sub(r"[^\w\s]", "", g["title"].lower()).split()
        while words and words[0] in _LEADING_ARTICLES:
            words = words[1:]
        key = words[0] if words else ""
        by_first_word.setdefault(key, []).append(i)

    pairs = []
    for bucket in by_first_word.values():
        if len(bucket) < 2:
            continue
        titles = [(idx, games[idx]["title"]) for idx in bucket]
        titles.sort(key=lambda t: len(t[1]))
        for a in range(len(titles)):
            for b in range(a + 1, len(titles)):
                idx_short, t_short = titles[a]
                idx_long, t_long = titles[b]
                if len(t_short) == len(t_long):
                    continue
                # Require the shorter title to be at least 2 words.
                # A single-word title (e.g. "Hollow", "Control", "Doom")
                # being a "prefix" of a longer title (e.g. "Hollow Knight",
                # "Control: Ultimate Edition", "Doom Eternal") is almost
                # never a genuine base-game/edition relationship - they're
                # almost always completely different games that happen to
                # share one word. The IGDB check would catch this, but
                # requiring 2+ words avoids the candidate being generated
                # at all, which also prevents wrong merges if IGDB has no
                # confident match for the obscure shorter title.
                short_words = t_short.strip().split()
                if len(short_words) < 2:
                    continue
                lower_short, lower_long = t_short.lower(), t_long.lower()
                if lower_long.startswith(lower_short):
                    # must be a real word boundary, e.g. "Far Cry" + " 3" not "Far" + "Cry3"
                    rest = t_long[len(t_short):]
                    if rest and (rest[0] == " " or not rest[0].isalnum()):
                        pairs.append((idx_short, idx_long))
    return pairs


def igdb_identify(title: str) -> tuple[int | None, str | None, float]:
    """Lightweight IGDB lookup for merge-decision purposes only.
    Returns (igdb_id, igdb_name, similarity_score) or (None, None, 0.0)."""
    global igdb_token
    token = get_igdb_token()
    q = re.split(r"\s[–\-:]\s", title)[0]
    q = re.sub(r"[™®©]", "", q).replace('"', '\\"').strip()
    body = f'search "{q}"; fields id,name; limit 1;'
    for _ in range(MAX_RETRIES):
        try:
            r = session.post(
                "https://api.igdb.com/v4/games",
                headers={"Client-ID": IGDB_CLIENT_ID, "Authorization": f"Bearer {token}", "Content-Type": "text/plain"},
                data=body, timeout=10,
            )
            if r.status_code == 429:
                time.sleep(RETRY_DELAY)
                continue
            if r.status_code == 401:
                igdb_token = None
                token = get_igdb_token()
                continue
            if not r.ok:
                return None, None, 0.0
            results = r.json()
            if not results:
                return None, None, 0.0
            res = results[0]
            score = SequenceMatcher(None, title.lower(), res.get("name", "").lower()).ratio()
            return res.get("id"), res.get("name"), score
        except requests.RequestException:
            time.sleep(2)
    return None, None, 0.0


# Minimum confidence before we trust a match enough to use it as the basis
# for a MERGE decision. Higher than what's used for cosmetic enrichment,
# since a wrong merge here fuses two potentially different games together
# (worse than just showing a duplicate card).
MERGE_CONFIDENCE_THRESHOLD = 0.6

def steam_identify(title: str) -> tuple[int | None, str | None, float]:
    """Lightweight Steam lookup for merge-decision purposes only — same
    shape as igdb_identify() so verify_and_merge_ambiguous() can fall back
    to this when IGDB has no confident match. Steam's own search often
    indexes scene-release-style titles that IGDB's search misses, and a
    matching Steam appid is just as reliable a 'same game' signal as a
    matching IGDB id.
    Returns (steam_appid, steam_name, similarity_score) or (None, None, 0.0)."""
    q = re.split(r"\s[–\-:]\s", title)[0]
    q = re.sub(r"[™®©]", "", q).strip()
    for _ in range(MAX_RETRIES):
        try:
            r = session.get(
                "https://store.steampowered.com/api/storesearch/",
                params={"term": q, "l": "english", "cc": "US"}, timeout=10,
            )
            if r.status_code == 429:
                time.sleep(RETRY_DELAY)
                continue
            if not r.ok:
                return None, None, 0.0
            items = r.json().get("items", [])
            best_id, best_name, best_score = None, None, 0.0
            for item in items[:5]:
                score = SequenceMatcher(None, title.lower(), item.get("name", "").lower()).ratio()
                if score > best_score:
                    best_score = score
                    best_id = item.get("id")
                    best_name = item.get("name")
            return best_id, best_name, best_score
        except requests.RequestException:
            time.sleep(2)
    return None, None, 0.0


def identify_game(game: dict, igdb_cache: dict, steam_cache: dict) -> tuple[str | None, str | None, float, str]:
    """Identify which real game a card refers to, for merge-decision purposes.

    Priority order:
      1. Existing steamId already on the game object (from a prior
         enrich_steam_ids.py run) - used directly, zero API calls, and
         more reliable than a fresh fuzzy search since it was presumably
         already verified/accepted once.
      2. IGDB search (if no existing steamId, or as an independent check -
         see note below).
      3. Steam search as a fallback when IGDB has no confident match.

    Returns (merge_id, matched_name, score, source). merge_id is prefixed
    ('igdb:1234' / 'steam:5678') so the two ID spaces never collide - an
    IGDB id of 5678 and a Steam appid of 5678 must never be treated as the
    same game by coincidence."""
    title = game["title"]
    existing_steam_id = game.get("steamId")
    if existing_steam_id is not None:
        # Already resolved by enrich_steam_ids.py - trust it directly,
        # skip any live API call for this title entirely.
        return f"steam:{existing_steam_id}", title, 1.0, "existing"

    if title not in igdb_cache:
        igdb_cache[title] = igdb_identify(title)
        time.sleep(IGDB_DELAY)
    igdb_id, igdb_name, igdb_score = igdb_cache[title]

    if igdb_id is not None and igdb_score >= MERGE_CONFIDENCE_THRESHOLD:
        return f"igdb:{igdb_id}", igdb_name, igdb_score, "igdb"

    # IGDB missed or wasn't confident enough -> try Steam as a fallback
    if title not in steam_cache:
        steam_cache[title] = steam_identify(title)
        time.sleep(STEAM_DELAY)
    steam_id, steam_name, steam_score = steam_cache[title]

    if steam_id is not None and steam_score >= MERGE_CONFIDENCE_THRESHOLD:
        return f"steam:{steam_id}", steam_name, steam_score, "steam"

    # Neither source found a confident match -> leave unmerged (safe default)
    best_score = max(igdb_score, steam_score)
    return None, None, best_score, "none"


def verify_and_merge_ambiguous(games: list[dict]) -> list[dict]:
    print("\n" + "=" * 55)
    print("  STEP 1.5: Verifying ambiguous title pairs (IGDB, Steam fallback)")
    print("=" * 55)

    pairs = find_ambiguous_pairs(games)
    print(f"  Found {len(pairs)} candidate pairs to verify")
    if not pairs:
        return games

    get_igdb_token()
    igdb_cache: dict[str, tuple[int | None, str | None, float]] = {}
    steam_cache: dict[str, tuple[int | None, str | None, float]] = {}

    to_drop: set[int] = set()
    merged_count = 0
    merged_via_existing = 0
    merged_via_steam = 0
    decisions_log: list[dict] = []

    for n, (idx_short, idx_long) in enumerate(pairs):
        if idx_short in to_drop or idx_long in to_drop:
            continue  # already merged via another pair in this pass

        pct = (n + 1) / len(pairs) * 100
        print(f"\r  [{int(pct/2)*'█'}{(50-int(pct/2))*'░'}] {pct:5.1f}%  {n+1}/{len(pairs)}", end="", flush=True)

        t_short = games[idx_short]["title"]
        t_long = games[idx_long]["title"]

        id_short, name_short, score_short, src_short = identify_game(games[idx_short], igdb_cache, steam_cache)
        id_long, name_long, score_long, src_long = identify_game(games[idx_long], igdb_cache, steam_cache)

        verdict = "left_separate"
        if id_short is not None and id_short == id_long:
            # Same game (matched on either IGDB or Steam, both sides agree)
            # -> merge longer entry's sources into shorter one
            existing_urls = {s["url"] for s in games[idx_short]["downloadSources"]}
            for src in games[idx_long]["downloadSources"]:
                if src["url"] not in existing_urls:
                    games[idx_short]["downloadSources"].append(src)
                    existing_urls.add(src["url"])
            repackers = list(dict.fromkeys(
                s["repacker"] for s in games[idx_short]["downloadSources"]
            ))
            games[idx_short]["publisher"] = ", ".join(repackers)
            to_drop.add(idx_long)
            merged_count += 1
            verdict = "merged"
            if src_short == "existing" or src_long == "existing":
                merged_via_existing += 1
            elif src_short == "steam" or src_long == "steam":
                merged_via_steam += 1
        # else: different games, or not confident enough -> leave both as-is

        decisions_log.append({
            "a_title": t_short, "b_title": t_long,
            "a_match": name_short, "b_match": name_long,
            "a_source": src_short, "b_source": src_long,
            "a_id": id_short, "b_id": id_long,
            "a_score": round(score_short, 3), "b_score": round(score_long, 3),
            "verdict": verdict,
        })

    merged_via_igdb = merged_count - merged_via_existing - merged_via_steam
    print(f"\n  Merged {merged_count} ambiguous pairs "
          f"({merged_via_existing} via existing steamId, {merged_via_igdb} via IGDB, "
          f"{merged_via_steam} via fresh Steam search)")
    print(f"  Left separate: {len(pairs) - merged_count} (different game or inconclusive match)")

    log_path = Path("merge_decisions.json")
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(decisions_log, f, indent=2, ensure_ascii=False)
    print(f"  Full decision log written to {log_path} ({len(decisions_log)} entries) — "
          f"review this to spot-check real merge/no-merge calls")

    return [g for i, g in enumerate(games) if i not in to_drop]



session = requests.Session()
session.headers.update({"User-Agent": "Mozilla/5.0 ZakurosArchive/1.0"})

igdb_token = None
igdb_token_expires = 0

def get_igdb_token() -> str:
    global igdb_token, igdb_token_expires
    if igdb_token and time.time() < igdb_token_expires:
        return igdb_token
    r = session.post(
        "https://id.twitch.tv/oauth2/token",
        params={"client_id": IGDB_CLIENT_ID, "client_secret": IGDB_CLIENT_SECRET, "grant_type": "client_credentials"},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json()
    igdb_token = data["access_token"]
    igdb_token_expires = time.time() + data["expires_in"] - 60
    return igdb_token

def igdb_search(title: str) -> dict:
    global igdb_token
    token = get_igdb_token()
    q = re.split(r"\s[–\-:]\s", title)[0]
    q = re.sub(r"[™®©]", "", q).replace('"', '\\"').strip()
    body = (
        f'search "{q}"; '
        f'fields name,summary,storyline,rating,first_release_date,'
        f'cover.url,screenshots.url,genres.name,'
        f'involved_companies.company.name,involved_companies.developer,involved_companies.publisher;'
        f'limit 1;'
    )
    for _ in range(MAX_RETRIES):
        try:
            r = session.post(
                "https://api.igdb.com/v4/games",
                headers={"Client-ID": IGDB_CLIENT_ID, "Authorization": f"Bearer {token}", "Content-Type": "text/plain"},
                data=body, timeout=10,
            )
            if r.status_code == 429:
                time.sleep(RETRY_DELAY)
                continue
            if r.status_code == 401:
                igdb_token = None
                token = get_igdb_token()
                continue
            if not r.ok:
                return {}
            results = r.json()
            return results[0] if results else {}
        except requests.RequestException:
            time.sleep(2)
    return {}

def apply_igdb(raw: dict, game: dict) -> dict:
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
        out["releaseDate"] = datetime.utcfromtimestamp(raw["first_release_date"]).strftime("%Y-%m-%d")
    if raw.get("genres"):
        out["genres"] = [g["name"] for g in raw["genres"]]
    if raw.get("cover", {}).get("url"):
        url = raw["cover"]["url"].replace("//", "https://").replace("t_thumb", "t_cover_big")
        out["coverImage"] = url
    if raw.get("screenshots"):
        out["screenshots"] = [
            s["url"].replace("//", "https://").replace("t_thumb", "t_screenshot_big")
            for s in raw["screenshots"][:6]
        ]
        if out["screenshots"]:
            out["screenshot"] = out["screenshots"][0]
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
    out["_igdb"] = True
    return out

# ── Step 3: Steam ─────────────────────────────────────────────────────────────

def similarity(a, b):
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()

def steam_search(title: str) -> int | None:
    q = re.split(r"\s[–\-:]\s", title)[0]
    q = re.sub(r"[™®©]", "", q).strip()
    for _ in range(MAX_RETRIES):
        try:
            r = session.get(
                "https://store.steampowered.com/api/storesearch/",
                params={"term": q, "l": "english", "cc": "US"}, timeout=10,
            )
            if r.status_code == 429:
                time.sleep(RETRY_DELAY)
                continue
            if not r.ok:
                return None
            items = r.json().get("items", [])
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

def steam_details(appid: int) -> dict:
    for _ in range(MAX_RETRIES):
        try:
            r = session.get(
                "https://store.steampowered.com/api/appdetails",
                params={"appids": appid, "l": "english"}, timeout=10,
            )
            if r.status_code == 429:
                time.sleep(RETRY_DELAY)
                continue
            if not r.ok:
                return {}
            data = r.json().get(str(appid), {})
            return data.get("data", {}) if data.get("success") else {}
        except requests.RequestException:
            time.sleep(2)
    return {}

def steam_review_count(appid: int) -> int | None:
    """Total Steam review count for an appid, used as the primary
    popularity signal. Steam's appdetails endpoint doesn't expose this -
    it lives on the separate appreviews endpoint. Returns None on any
    failure so the caller can fall back to source-count popularity
    instead of treating a fetch error as 'zero reviews'."""
    for _ in range(MAX_RETRIES):
        try:
            r = session.get(
                f"https://store.steampowered.com/appreviews/{appid}",
                params={"json": 1, "language": "all", "purchase_type": "all",
                        "num_per_page": 0},
                timeout=10,
            )
            if r.status_code == 429:
                time.sleep(RETRY_DELAY)
                continue
            if not r.ok:
                return None
            data = r.json()
            if data.get("success") != 1:
                return None
            summary = data.get("query_summary", {})
            total = summary.get("total_reviews")
            return int(total) if total is not None else None
        except (requests.RequestException, ValueError):
            time.sleep(2)
    return None

def apply_steam(raw: dict, game: dict, appid: int) -> dict:
    if not raw:
        return game
    out = dict(game)
    out["steamId"] = appid
    if raw.get("short_description") and not out.get("_igdb"):
        out["summary"] = raw["short_description"]
    if raw.get("metacritic", {}).get("score") and not out.get("rating"):
        out["rating"] = raw["metacritic"]["score"]
    if raw.get("developers") and not out.get("developer"):
        out["developer"] = ", ".join(raw["developers"])
    if raw.get("publishers") and not out.get("_igdb"):
        out["publisher"] = ", ".join(raw["publishers"])
    if raw.get("release_date", {}).get("date") and not out.get("_igdb"):
        out["releaseDate"] = raw["release_date"]["date"]
    if raw.get("genres") and not out.get("_igdb"):
        out["genres"] = [g["description"] for g in raw["genres"]]
    # Always use Steam cover since it's high quality
    out["coverImage"] = f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"
    bg = raw.get("background_raw") or raw.get("background") or \
         f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/page_bg_generated_v6b.jpg"
    out["screenshot"] = bg
    if raw.get("screenshots") and not out.get("screenshots"):
        out["screenshots"] = [s["path_full"] for s in raw["screenshots"][:6]]
    # System requirements
    pc = raw.get("pc_requirements", {})
    if isinstance(pc, dict):
        def strip_html(h):
            if not h:
                return {}
            c = re.sub(r"<br\s*/?>", "\n", h)
            c = re.sub(r"<[^>]+>", "", c)
            result = {}
            for line in c.split("\n"):
                if ":" in line:
                    k, _, v = line.partition(":")
                    k = k.strip().lower()
                    v = v.strip()
                    if "os" in k:            result["os"] = v
                    elif "processor" in k:   result["processor"] = v
                    elif "memory" in k:      result["memory"] = v
                    elif "graphics" in k:    result["graphics"] = v
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
    return out

# ── Step 4: Checkpoint ────────────────────────────────────────────────────────

def load_checkpoint():
    if Path(CHECKPOINT_FILE).exists():
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {"done": {}, "games": None}

def save_checkpoint(done: dict, games: list):
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump({"done": done, "games": games}, f)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 55)
    print("  Zakuro's Archive — Build + Enrich (All-in-One)")
    print("=" * 55)

    cp = load_checkpoint()
    done = cp.get("done", {})

    # If checkpoint has games, resume from there — otherwise rebuild
    if cp.get("games"):
        games = cp["games"]
        print(f"\n  Resuming from checkpoint ({len(done)} games already enriched)")
    else:
        games = build_merged()
        print(f"\n  Built {len(games)} unique games")
        games = verify_and_merge_ambiguous(games)
        print(f"  {len(games)} games remain after ambiguous-pair verification")

    print("\n" + "="*55)
    print("  STEP 2: Enriching with IGDB + Steam")
    print("="*55 + "\n")

    get_igdb_token()

    total = len(games)
    igdb_hits = steam_hits = misses = 0

    for i, game in enumerate(games):
        gid = game.get("id", str(i))
        title = game.get("title", "")

        if not title or gid in done:
            continue

        pct = (i + 1) / total * 100
        print(f"\r  [{int(pct/2)*'█'}{(50-int(pct/2))*'░'}] {pct:5.1f}%  {i+1}/{total}  {title[:40]:<40}", end="", flush=True)

        enriched = False

        # IGDB first
        igdb_raw = igdb_search(title)
        time.sleep(IGDB_DELAY)
        if igdb_raw:
            games[i] = apply_igdb(igdb_raw, game)
            igdb_hits += 1
            enriched = True

        # Steam — use existing steamId or search
        appid = games[i].get("steamId")
        if not appid:
            appid = steam_search(title)
            time.sleep(STEAM_DELAY)

        if appid:
            raw = steam_details(appid)
            time.sleep(0.5)
            if raw:
                games[i] = apply_steam(raw, games[i], appid)
                steam_hits += 1
                enriched = True
            review_count = steam_review_count(appid)
            time.sleep(0.5)
            if review_count is not None:
                games[i]["reviewCount"] = review_count

        if not enriched:
            misses += 1

        done[gid] = True

        if (i + 1) % CHECKPOINT_EVERY == 0:
            save_checkpoint(done, games)

    # Compute popularityScore and sort most-popular-first.
    # Formula: log10(reviewCount + 1) * 2 + repackerCount
    #   - Steam review count is log-scaled because it's extremely skewed
    #     (a handful of games have 100k+ reviews, most have under 100) -
    #     a raw linear blend would let review count totally swamp source
    #     count, which we don't want.
    #   - repackerCount (number of DISTINCT repackers offering the game,
    #     e.g. FitGirl/DODI/GOG/Xatab - NOT raw downloadSources length)
    #     adds real signal for games Steam has no/few reviews for. Using
    #     raw downloadSources length instead would badly distort this:
    #     some repackers (Xatab especially) re-upload the same release
    #     under several different magnet hashes over time, so a game
    #     could show 50+ "sources" that are really just one repacker's
    #     repeated re-uploads of the identical release, not 50 different
    #     groups actually offering it. All those mirrors are still kept
    #     and shown to the user - only the popularity MATH counts
    #     distinct repackers, not raw link count.
    for g in games:
        review_count = g.get("reviewCount") or 0
        repacker_count = repacker_count_for(g)
        g["popularityScore"] = round(math.log10(review_count + 1) * 2 + repacker_count, 3)

    games.sort(key=lambda g: -g["popularityScore"])

    print(f"\n\n  Saving to {OUTPUT_FILE}...")
    Path(OUTPUT_FILE).parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(games, f, indent=2, ensure_ascii=False)

    if Path(CHECKPOINT_FILE).exists():
        Path(CHECKPOINT_FILE).unlink()

    print("\n" + "="*55)
    print(f"  Done!")
    print(f"  Total games:   {total}")
    print(f"  IGDB matches:  {igdb_hits}")
    print(f"  Steam matches: {steam_hits}")
    print(f"  Not found:     {misses}")
    print(f"  Output:        {OUTPUT_FILE}")
    print("="*55)


if __name__ == "__main__":
    main()
