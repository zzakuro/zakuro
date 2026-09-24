#!/usr/bin/env python3
"""
Surgical metadata cleanup for the Silent Hill franchise in merged_enriched.json.gz.

This is the per-series follow-up to fix_gta.py, targeting the Silent Hill cards
that accumulated junk from the raw source scrapes:

  * REMOVE non-game artifacts: cheat discs (Action Replay), DLC costume packs,
    trial/demo/proto/promo-movie ROMs, and multi-game ISO collections / combo
    torrents (Scene ISO Collection, "Silent Hill & The Fifth Element", etc.).
  * MERGE every region/duplicate card of the same game into one canonical card
    (SH1, SH2, SH3, SH4, Origins, Shattered Memories, Downpour, HD Collection,
    Alchemilla). Sources are unioned by URL; the metadata-richest card is the
    hero; repackers are folded back into `publisher`; `popularityScore` is
    recomputed with the same formula as build_and_enrich.py.
  * RENAME mislabelled/truncated titles so each card says what it actually is
    (e.g. "silent-hill-1" contains SILENT HILL: Townfall metadata, "SILENT HILL f"
    -> "Silent Hill f").
  * STRIP junk genres (Racing/Fighting/Sports/Free To Play/WINDOWS) that leaked
    in from Steam appid cross-matching, and clear the wrong remake-dev name
    ("Bloober Team SA") from the classic SH2 card.

Run from fitlib/ directory:
    python3 fix_silent_hill.py
"""
import gzip
import json
import math
import shutil
import sys
import time
from pathlib import Path

DATA_DIR = Path("data")
INPUT  = DATA_DIR / "merged_enriched.json.gz"
BACKUP_DIR = Path("../..") / ("_backups/%s-silenthillfix" % time.strftime("%Y%m%d-%H%M%S"))
# Repo-root _backups live one level above fitlib/ (zakuros-archive-main/{fitlib,..}),
# but when run from the repo root the catalog is nested. Resolve robustly:
BACKUP_DIR = Path(__file__).resolve().parent.parent.parent / "_backups" / (
    time.strftime("%Y%m%d-%H%M%S") + "-silenthillfix"
)

JUNK_GENRES = {"Racing", "Fighting", "Sports", "Free To Play", "WINDOWS", "Windows"}


def load():
    print(f"Loading {INPUT}...")
    with gzip.open(INPUT, "rt", encoding="utf-8") as f:
        games = json.load(f)
    print(f"  {len(games)} games loaded")
    return games


def save(games):
    print(f"Saving {INPUT} ({len(games)} games)...")
    raw = json.dumps(games, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    tmp = str(INPUT) + ".tmp"
    with open(tmp, "wb") as f:
        f.write(gzip.compress(raw, compresslevel=6, mtime=0))
    Path(tmp).replace(INPUT)
    print("  saved.")


def merge_sources(hero, donor):
    """Union donor's downloadSources into hero by URL."""
    have = {s["url"] for s in hero.get("downloadSources", [])}
    moved = 0
    for s in donor.get("downloadSources", []):
        if s["url"] in have:
            continue
        hero["downloadSources"].append(s)
        have.add(s["url"])
        moved += 1
    # Adopt metadata the hero is missing.
    for field in ("steamId", "gogId", "coverImage", "screenshot", "summary",
                  "developer", "rating", "releaseDate", "reviewCount", "screenshots"):
        if not hero.get(field) and donor.get(field):
            hero[field] = donor[field]
    cur = {g.lower() for g in hero.get("genres", [])}
    for g in donor.get("genres", []):
        if g.lower() not in cur:
            hero.setdefault("genres", []).append(g)
            cur.add(g.lower())
    hero["genres"] = hero.get("genres", [])[:12]
    return moved


def fold_publisher(hero):
    repackers = list(dict.fromkeys(
        s.get("repacker") for s in hero.get("downloadSources", []) if s.get("repacker")))
    if repackers:
        hero["publisher"] = ", ".join(repackers)


def repop(hero):
    reviews = hero.get("reviewCount") or 0
    repackers = len({s.get("repacker") for s in hero.get("downloadSources", []) if s.get("repacker")})
    hero["popularityScore"] = round(math.log10(reviews + 1) * 2 + repackers, 3)


def strip_junk_genres(g):
    if g.get("genres"):
        g["genres"] = [x for x in g["genres"] if x not in JUNK_GENRES]


def main():
    games = load()
    by_id = {g["id"]: g for g in games}
    missing = [i for i in list(REMOVE) + list(MERGE_INTO) + list(RENAME) if i not in by_id]
    if missing:
        print("ERROR: expected ids not found in catalog:")
        for i in missing:
            print("  ", i)
        sys.exit(1)

    # ── Pass 1: merge region / duplicate cards into canonical heroes ─────────
    total_moved = 0
    for hero_id, donors in MERGE_INTO.items():
        hero = by_id[hero_id]
        for donor_id in donors:
            moved = merge_sources(hero, by_id[donor_id])
            total_moved += moved
            print(f"  merged {moved:3d} sources  {donor_id:<72} -> {hero_id}")
        fold_publisher(hero)
        repop(hero)

    # ── Pass 2: title / metadata renames ─────────────────────────────────────
    for id_, (title, fields) in RENAME.items():
        g = by_id[id_]
        old = g.get("title")
        g["title"] = title
        for k, v in fields.items():
            g[k] = v
        print(f"  renamed: {old!r} -> {title!r}")

    # ── Pass 3: drop junk cards ──────────────────────────────────────────────
    dropped = [i for i in REMOVE if i in by_id]
    games = [g for g in games if g["id"] not in REMOVE and g["id"] not in MERGE_INTO]

    # ── Pass 4: genre hygiene across every remaining Silent Hill card ────────
    touched = 0
    for g in games:
        t = (g.get("title") or "").lower()
        if "silent hill" in t or "alchemilla" in t or "play novel" in t or "townfall" in t:
            before = list(g.get("genres", []))
            strip_junk_genres(g)
            if before != g.get("genres", []):
                touched += 1
    print(f"  stripped junk genres on {touched} card(s)")

    # ── Final printout of every remaining Silent Hill card ──────────────────
    print("\nFinal Silent Hill cards:")
    for g in sorted(games, key=lambda x: (x.get("title") or "").lower()):
        t = (g.get("title") or "").lower()
        i = (g.get("id") or "").lower()
        if "silent hill" in t or "silent-hill" in i or "townfall" in t or "alchemilla" in t or "play novel" in t:
            print("  %-52s | classic=%s | steamId=%s | gogId=%s | sources=%3d | genres=%s" % (
                (g.get("title") or "")[:52], g.get("classic"), g.get("steamId"),
                g.get("gogId"), len(g.get("downloadSources", [])),
                [x for x in g.get("genres", []) if x in {"Racing", "Fighting", "Sports", "Free To Play", "WINDOWS"}]
            ))

    # ── Backup + write ───────────────────────────────────────────────────────
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(INPUT, BACKUP_DIR / INPUT.name)
    print(f"\nBacked up original to {BACKUP_DIR / INPUT.name}")

    print(f"Removed {len(dropped)} junk card(s), merged {total_moved} sources.")
    save(games)
    print(f"\nDone. {len(dropped) + len(MERGE_INTO)} cards dropped, "
          f"{total_moved} duplicate sources folded in.")


# ── The curation table ─────────────────────────────────────────────────────────

# merge donors INTO the hero (donors are removed afterwards)
MERGE_INTO = {
    # Silent Hill (PS1) canonical; all-regions compilation is still SH1.
    "silent-hill": [
        "silent-hill-all-regions-compilation",
    ],
    # Silent Hill 2 classic — absorbs the PC Director's Cut / Restless Dreams
    # ("Saigo no Uta" is the Japanese Director's Cut of the same game).
    "silent-hill-2-1uoxany": [
        "silent-hill-2-directors-cut-1f8wce",
        "silent-hill-2---saigo-no-uta-japan-enja",
    ],
    # Silent Hill 3 — absorbs the PC ("| Lus") and truncated "Silent Hill 3 -" repacks.
    "silent-hill-3": [
        "silent-hill-3-pc-lus",
        "silent-hill-3-new-edition",
    ],
    # Silent Hill 4 — modern PC/GOG card absorbs the classic PS2 ROM card.
    "silent-hill-4-the-room-0cix8w": [
        "silent-hill-4-the-room",
    ],
    # Shattered Memories — all region cards + the vague "Silent Hill PSP" (2010 PSP cap).
    "silent-hill---shattered-memories-europe-enfrdeesit": [
        "silent-hill---shattered-memories-japan",
        "silent-hill---shattered-memories-usa",
        "silent-hill-shattered-memories",
        "silent-hill-shattered-memories-ps2",
        "silent-hill-psp",
    ],
    # Origins — region/dup cards + Japan's "Silent Hill Zero".
    "silent-hill-origins-europe-enfrdeesit": [
        "silent-hill-origins-1q6o21n",
        "silent-hill-origins-psp",
        "silent-hill-zero-japan",
    ],
    # Downpour — every region/console variant.
    "silent-hill-downpour-aps92o": [
        "silent-hill-downpour-pc--a",
        "silent-hill-downpour-ps3",
        "silent-hill-downpour-51-unofficial-psycho-a",
        "silent-hill-downpour-xbox360",
    ],
    # HD Collection — the five PS3/360 region cards (+ Japanese "HD Edition").
    "silent-hill---hd-collection-europe-enfrdeesit": [
        "silent-hill---hd-collection-usa-enfres",
        "silent-hill---hd-edition-japan",
        "silent-hill-hd-collection",
        "silent-hill-hd-collection-classics-hd",
        "silent-hill-hd-collection-xbox360",
    ],
    # Alchemilla — metadata-rich IGDB card absorbs the repack-magnet duplicates.
    "alchemilla": [
        "silent-hill-alchemilla",
        "silent-hill-alchemilla-pc-g-freedom",
    ],
}

# junk cards to drop entirely
REMOVE = [
    "action-replay-ultimate-codes-for-use-with-silent-hill-3-usa-unl",   # cheat-code disc
    "army-men-silent-hill-syphon-filter",                                  # 3 games in one torrent
    "fatal-frame-ii-crimson-butterfly-remake---silent-hill-f-costume-set",# DLC costume pack
    "silent-hill-deception-3-kagero-deception-ii",                         # 3 games in one torrent
    "silent-hill-the-city-of-lost-children",                               # 2 games in one torrent
    "silent-hill-the-fifth-element",                                       # 2 games in one torrent
    "scene-iso-collection-armed-and-dangerous-call-of-duty-chaser-command-conquer-generals-deus-ex-invisible-war-enter-the-matrix-gothic-ii-grand-theft-auto-vice-city-max-payne-2-silent-hill-3-tom-clancys-splinter-cell-warcr",
    "scene-iso-collection-crusader-kings-doom-3-far-cry-half-life-2-harry-potter-and-the-prisoner-of-azkaban-hitman-contracts-rome-total-war-sacred-silent-hill-4-the-room-sims-2-sonic-adventure-dx-directors-cut-vampire-the-m",
    "scene-iso-collection-grand-theft-auto-3-harry-potter-and-the-chamber-of-secrets-heroes-of-might-magic-4-hitman-2-silent-assassin-no-one-lives-forever-2-silent-hill-2-stronghold-crusader-the-elder-scrolls-3-morrowind-warcraft",
    "silent-hill-2---tentou-houei-you-movie-ban-japan",                    # promotional movie disc
    "silent-hill-2---20th-anniversary-demake-world-proto-gb-compatible-aftermarket-unl",  # proto homebrew
    "silent-hill-2---born-from-a-wish-world-demo-aftermarket-unl",         # demo homebrew
    "silent-hill-2-trial-version",
    "silent-hill-2-directors-cut-3-4-the-room-stubbs-the-zombie-in-rebel-without-a-pulse-land-of-the-dead-road-to-fiddlers-green",
    "silent-hill-2-directors-cut-3-4-the-room",                            # SH2+3+4 combo torrent
    "silent-hill-2-directors-cut-3-4-the-room-5-homecoming",               # franchise collection
    "silent-hill-silent-hill-2-directors-cut-silent-hill-3-silent-hill-4-the-room-silent-hill-5-homecoming",
    "silent-hill-3-trial-version",
    "silent-hill-3-trial-version-428up9",
    "silent-hill-4-trial-version",
    "silent-hill-4-the-room-trial-version-2004",
    "silent-hill-ps2-collection",                                          # SH2+3+4 compilation
    "silent-hill-the-gallows",                                             # poisoned entry (bogus shared gogId, wrong metadata)
]

# id -> (new title, {field overrides})
RENAME = {
    # This card's steamId/developer/summary/release date are all SILENT HILL: Townfall.
    "silent-hill-1": (
        "Silent Hill: Townfall",
        {"developer": "Screen Burn", "classic": False},
    ),
    "silent-hill-f": (
        "Silent Hill f",
        {"classic": False},
    ),
    "play-novel---silent-hill-japan": (
        "Play Novel: Silent Hill",
        {"releaseDate": "2001-03-21"},
    ),
    # canonical-card identity fixes
    "silent-hill-2-1uoxany": (
        "Silent Hill 2",
        {"developer": "Team Silent", "classic": True, "releaseDate": "2001-09-24"},
    ),
    "silent-hill-3": (
        "Silent Hill 3",
        {"developer": "Team Silent", "classic": True, "releaseDate": "2003-05-23"},
    ),
    "silent-hill-4-the-room-0cix8w": (
        "Silent Hill 4: The Room",
        {"developer": "Team Silent", "classic": True},
    ),
    "silent-hill---shattered-memories-europe-enfrdeesit": (
        "Silent Hill: Shattered Memories",
        {"developer": "Climax Studios", "classic": True, "releaseDate": "2009-12-08"},
    ),
    "silent-hill-origins-europe-enfrdeesit": (
        "Silent Hill: Origins",
        {"developer": "Climax Studios", "classic": True, "releaseDate": "2007-11-06"},
    ),
    "silent-hill-downpour-aps92o": (
        "Silent Hill: Downpour",
        {"classic": False, "releaseDate": "2012-03-13"},
    ),
    "silent-hill---hd-collection-europe-enfrdeesit": (
        "Silent Hill HD Collection",
        {"classic": False, "releaseDate": "2012-03-20"},
    ),
    "silent-hill": (
        "Silent Hill",
        {"developer": "Team Silent", "classic": True, "releaseDate": "1999-02-23"},
    ),
    "alchemilla": (
        "Silent Hill: Alchemilla",
        {"classic": False},
    ),
}


if __name__ == "__main__":
    main()