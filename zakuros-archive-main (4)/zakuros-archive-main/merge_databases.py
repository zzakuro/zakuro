#!/usr/bin/env python3
"""
FitLib — Multi-Database Merger
================================
Merges multiple game JSON databases into one. When the same game appears
in more than one database, their downloadSources are stacked so the game
page shows all available repackers side by side.

Usage:
  python3 merge_databases.py db1.json db2.json db3.json -o merged.json

  # Or merge a whole folder:
  python3 merge_databases.py databases/*.json -o merged.json

Options:
  -o / --output   Output file (default: merged.json)
  --prefer        Which DB's metadata to prefer for title/cover/etc
                  when duplicates exist. Pass the filename. Defaults to
                  the first file that has Steam metadata (non-empty coverImage).

Requirements:
  Python 3.10+, no extra packages needed.

Matching logic:
  Games are matched by normalized title (lowercase, stripped punctuation).
  If a match is found, only the downloadSources list is merged — the base
  metadata (cover art, description, etc.) is kept from the preferred source.
"""

import json
import re
import sys
import argparse
from pathlib import Path


# ── Helpers ──────────────────────────────────────────────────────────────────

def normalize(title: str) -> str:
    """Lowercase, strip punctuation and extra whitespace for fuzzy matching."""
    t = title.lower()
    t = re.sub(r"[^\w\s]", "", t)   # remove punctuation
    t = re.sub(r"\s+", " ", t)      # collapse whitespace
    return t.strip()


def load_db(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f"{path}: expected a top-level JSON array, got {type(data).__name__}")
    print(f"  Loaded {len(data):>5} games from {Path(path).name}")
    return data


def extract_repacker(game: dict, fallback_name: str) -> str:
    """Guess the repacker name from existing data or filename."""
    # Check if any downloadSource already has a repacker set
    for src in game.get("downloadSources") or []:
        if src.get("repacker"):
            return src["repacker"]
    # Fall back to publisher field if it looks like a repacker tag
    publisher = game.get("publisher", "")
    if publisher and publisher not in ("Unknown", ""):
        return publisher
    return fallback_name


def game_to_sources(game: dict, repacker: str) -> list[dict]:
    """Build a normalised downloadSources list from a game entry."""
    sources = []

    # Existing downloadSources
    for src in game.get("downloadSources") or []:
        sources.append({
            "name":       src.get("name", "Download"),
            "url":        src.get("url", ""),
            "type":       src.get("type", "torrent"),
            "repacker":   src.get("repacker") or repacker,
            "fileSize":   src.get("fileSize") or game.get("fileSize", ""),
            "uploadDate": src.get("uploadDate") or game.get("stats", {}).get("updatedAt", ""),
        })

    # If no downloadSources but there's a magnetLink, synthesise one
    if not sources and game.get("magnetLink"):
        sources.append({
            "name":       f"{repacker} Magnet",
            "url":        game["magnetLink"],
            "type":       "torrent",
            "repacker":   repacker,
            "fileSize":   game.get("fileSize", ""),
            "uploadDate": game.get("stats", {}).get("updatedAt", ""),
        })

    return sources


def pick_best_base(candidates: list[dict]) -> dict:
    """
    From a list of duplicate game entries, return the one with the richest
    metadata (prefers Steam cover art > any cover > first entry).
    """
    # Prefer entry with a real Steam cover image
    for c in candidates:
        if c.get("coverImage") and "steamstatic" in c["coverImage"]:
            return c
    # Then any non-empty cover
    for c in candidates:
        if c.get("coverImage"):
            return c
    return candidates[0]


# ── Main merge logic ──────────────────────────────────────────────────────────

def merge(db_paths: list[str], output: str):
    print(f"\nLoading {len(db_paths)} database(s)...")

    # key: normalized title → {"base": best_game_dict, "sources": [all DownloadSources]}
    merged: dict[str, dict] = {}
    # key: normalized title → list of all candidate game dicts (for picking best base)
    candidates: dict[str, list[dict]] = {}

    total_dupes = 0

    for path in db_paths:
        db = load_db(path)
        # Derive a human-readable repacker name from filename if not in data
        stem = Path(path).stem
        # e.g. "fitgirl_converted" → "FitGirl", "dodi_repacks" → "DODI"
        db_repacker_hint = stem.split("_")[0].title()

        for game in db:
            if not game.get("title"):
                continue

            repacker = extract_repacker(game, db_repacker_hint)
            key = normalize(game["title"])
            sources = game_to_sources(game, repacker)

            if key not in merged:
                merged[key] = {"base": game, "sources": sources}
                candidates[key] = [game]
            else:
                # Duplicate — stack sources, collect candidate for base selection
                existing_urls = {s["url"] for s in merged[key]["sources"]}
                new_sources = [s for s in sources if s["url"] not in existing_urls]
                merged[key]["sources"].extend(new_sources)
                candidates[key].append(game)
                total_dupes += 1

    print(f"\nUnique titles:   {len(merged)}")
    print(f"Duplicate merges: {total_dupes}")

    # Build final list
    result = []
    for key, entry in merged.items():
        # Pick the richest base metadata
        base = pick_best_base(candidates[key])
        game_out = dict(base)
        game_out["downloadSources"] = entry["sources"]

        # If magnetLink is blank but we have sources, fill from first torrent
        if not game_out.get("magnetLink"):
            for src in entry["sources"]:
                if src["type"] == "torrent" or src["url"].startswith("magnet:"):
                    game_out["magnetLink"] = src["url"]
                    break

        result.append(game_out)

    # Sort by title
    result.sort(key=lambda g: g.get("title", "").lower())

    with open(output, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Saved {len(result)} games to {output}")
    print(f"\nDrop '{output}' into your FitLib /public folder and set:")
    print(f"  VITE_GAMES_JSON=/{Path(output).name}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Merge multiple FitLib-format JSON databases into one."
    )
    parser.add_argument(
        "databases",
        nargs="+",
        help="Paths to JSON database files (e.g. fitgirl.json dodi.json)"
    )
    parser.add_argument(
        "-o", "--output",
        default="merged.json",
        help="Output file path (default: merged.json)"
    )
    args = parser.parse_args()

    missing = [p for p in args.databases if not Path(p).exists()]
    if missing:
        print(f"Error: file(s) not found: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    merge(args.databases, args.output)


if __name__ == "__main__":
    main()
