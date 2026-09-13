#!/usr/bin/env python3
"""
Backfill popularity data onto an already-enriched database.
=============================================================
Use this INSTEAD of re-running the full build_and_enrich.py pipeline when
you already have a merged_enriched.json with steamId filled in, and just
want to add reviewCount + popularityScore (most-popular-first sorting)
without redoing every IGDB/Steam enrichment call from scratch.

What it does:
  1. Loads an existing enriched database (e.g. public/merged_enriched.json)
  2. For every game with a steamId, fetches its Steam review count
     (skipping games that already have reviewCount, so this is safe to
     re-run / resume)
  3. Computes popularityScore = log10(reviewCount + 1) * 2 + repackerCount
     (repackerCount = number of DISTINCT repackers, not raw downloadSources
     length - see repacker_count_for() in build_and_enrich.py for why)
  4. Re-sorts the whole list most-popular-first
  5. Saves progress every 200 games (so an interrupted run can resume)

Usage (run from fitlib/ directory, same folder as build_and_enrich.py):
    python3 backfill_popularity.py [path/to/merged_enriched.json]

Defaults to public/merged_enriched.json if no path given.
"""
import json
import math
import sys
import time
from pathlib import Path

import requests

# Reuse the same repacker-counting logic as build_and_enrich.py /
# dedup_existing.py, so all three scripts always agree on what counts as
# a "source" for popularity purposes.
import build_and_enrich as bae

INPUT_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public/merged_enriched.json")
CHECKPOINT_EVERY = 200
MAX_RETRIES = 3
RETRY_DELAY = 5
REQUEST_DELAY = 0.6  # be polite to Steam's unauthenticated endpoint

session = requests.Session()
session.headers.update({"User-Agent": "Mozilla/5.0"})


def steam_review_count(appid: int) -> int | None:
    """Total Steam review count for an appid. Returns None on failure so
    the caller can distinguish 'genuinely zero reviews' from 'fetch failed'
    and skip (rather than wrongly cache a 0) on a transient error."""
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
            total = data.get("query_summary", {}).get("total_reviews")
            return int(total) if total is not None else None
        except (requests.RequestException, ValueError):
            time.sleep(2)
    return None


def main():
    if not INPUT_PATH.exists():
        print(f"ERROR: {INPUT_PATH} not found.")
        sys.exit(1)

    print(f"Loading {INPUT_PATH}...")
    games = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    print(f"  {len(games)} games loaded")

    needs_review = [
        i for i, g in enumerate(games)
        if g.get("steamId") and "reviewCount" not in g
    ]
    already_have = sum(1 for g in games if "reviewCount" in g)
    no_steam_id = sum(1 for g in games if not g.get("steamId"))
    print(f"  Already have reviewCount: {already_have}")
    print(f"  No steamId (will use source count only): {no_steam_id}")
    print(f"  Need fetching: {len(needs_review)}")

    fetched = 0
    failed = 0
    for n, i in enumerate(needs_review):
        appid = games[i]["steamId"]
        title = games[i].get("title", "")[:40]
        pct = (n + 1) / len(needs_review) * 100 if needs_review else 100
        print(f"\r  [{int(pct/2)*'█'}{(50-int(pct/2))*'░'}] {pct:5.1f}%  "
              f"{n+1}/{len(needs_review)}  {title:<40}", end="", flush=True)

        count = steam_review_count(appid)
        time.sleep(REQUEST_DELAY)
        if count is not None:
            games[i]["reviewCount"] = count
            fetched += 1
        else:
            failed += 1
            # Don't mark as done on failure - leave reviewCount absent so
            # a re-run will retry it, rather than permanently treating a
            # transient API error as "zero reviews".

        if (n + 1) % CHECKPOINT_EVERY == 0:
            INPUT_PATH.write_text(json.dumps(games, ensure_ascii=False), encoding="utf-8")

    print(f"\n  Fetched {fetched} review counts, {failed} failed (will retry on next run)")

    # Compute popularityScore for every game (including ones with no
    # steamId at all - they just get repackerCount as their whole score).
    for g in games:
        review_count = g.get("reviewCount") or 0
        repacker_count = bae.repacker_count_for(g)
        g["popularityScore"] = round(math.log10(review_count + 1) * 2 + repacker_count, 3)

    games.sort(key=lambda g: -g["popularityScore"])

    print(f"  Saving sorted database to {INPUT_PATH}...")
    INPUT_PATH.write_text(json.dumps(games, ensure_ascii=False), encoding="utf-8")

    print("\nDone. Top 10 most popular:")
    for g in games[:10]:
        print(f"  [{g['popularityScore']:6.2f}]  {g['title']}  "
              f"(reviews={g.get('reviewCount', 0)}, repackers={bae.repacker_count_for(g)}, "
              f"total links={len(g.get('downloadSources', []))})")


if __name__ == "__main__":
    main()
