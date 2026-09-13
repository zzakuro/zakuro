#!/usr/bin/env python3
"""
Backfill coverImage for games that have a steamId but empty coverImage.
=======================================================================
Steam's library cover image URL is purely deterministic from the appid:
  https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg

So we can fill this in for every game with a steamId and no coverImage,
with zero API calls needed.

Also backfills screenshot using Steam's header image URL as a fallback
when screenshot is also empty and steamId is known.

Usage (run from fitlib/ directory):
    python3 backfill_covers.py [path/to/merged_enriched.json]

Defaults to public/merged_enriched.json if no path given.
"""
import json
import sys
from pathlib import Path

INPUT_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public/merged_enriched.json")


def main():
    if not INPUT_PATH.exists():
        print(f"ERROR: {INPUT_PATH} not found.")
        sys.exit(1)

    print(f"Loading {INPUT_PATH}...")
    games = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    print(f"  {len(games)} games loaded")

    cover_fixed = 0
    screenshot_fixed = 0
    already_had_cover = 0
    no_steam_id = 0

    for g in games:
        steam_id = g.get("steamId")
        if not steam_id:
            no_steam_id += 1
            continue

        # Fill in coverImage if missing
        if not g.get("coverImage"):
            g["coverImage"] = f"https://cdn.akamai.steamstatic.com/steam/apps/{steam_id}/library_600x900.jpg"
            cover_fixed += 1
        else:
            already_had_cover += 1

        # Fill in screenshot if missing (use Steam header image as a
        # reasonable single-screenshot fallback - 460x215 landscape format)
        if not g.get("screenshot"):
            g["screenshot"] = f"https://cdn.akamai.steamstatic.com/steam/apps/{steam_id}/header.jpg"
            screenshot_fixed += 1

        # Fill in screenshots array if missing or empty
        if not g.get("screenshots"):
            g["screenshots"] = [
                f"https://cdn.akamai.steamstatic.com/steam/apps/{steam_id}/header.jpg"
            ]

    print(f"\n  cover_fixed:       {cover_fixed}")
    print(f"  screenshot_fixed:  {screenshot_fixed}")
    print(f"  already_had_cover: {already_had_cover}")
    print(f"  no_steamId:        {no_steam_id} (can't auto-fill these)")

    print(f"\nSaving to {INPUT_PATH}...")
    INPUT_PATH.write_text(json.dumps(games, ensure_ascii=False), encoding="utf-8")
    print("Done.")

    # Spot check
    print("\nSpot check — first 5 games with fixed covers:")
    fixed = [g for g in games if g.get("steamId") and "steamstatic" in g.get("coverImage", "")]
    for g in fixed[:5]:
        print(f"  {g['title']!r}: {g['coverImage']}")


if __name__ == "__main__":
    main()
