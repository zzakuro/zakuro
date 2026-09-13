#!/usr/bin/env python3
"""
Re-run dedup/merge fixes on an ALREADY-ENRICHED database.
=============================================================
Use this when you already have a merged_enriched.json built by an OLDER
version of build_and_enrich.py (before the duplicate-card fixes), and you
want to apply the fixes WITHOUT throwing away the steamId / reviewCount /
cover art / IGDB data you already gathered.

What it does, on your existing game objects (NOT raw source JSONs):
  1. Exact-match pass: re-groups games by match_key(title) - the same
     "cut at the first version marker, alias GTA<->Grand Theft Auto" key
     used in build_and_enrich.py. Catches any version-number duplicates
     that slipped through under the old logic (e.g. multiple Xatab
     point-releases of the same game that were never merged before).
  2. Ambiguous-pair pass: re-uses build_and_enrich.py's
     find_ambiguous_pairs() + identify_game() + the same merge logic from
     verify_and_merge_ambiguous(), so "Far Cry" vs "Far Cry 4" stays
     separate while "Mafia" vs "Mafia: Definitive Edition" merges -
     using your EXISTING steamId first (free, instant), falling back to
     live IGDB/Steam lookups only for games that don't have one yet.
  3. Recomputes popularityScore and sorts most-popular-first.

This imports directly from build_and_enrich.py so the merge rules stay
in exactly one place - no duplicated logic that could drift out of sync.

Usage (run from fitlib/ directory, same folder as build_and_enrich.py):
    python3 dedup_existing.py [path/to/merged_enriched.json]

Defaults to public/merged_enriched.json if no path given.
"""
import json
import math
import sys
from pathlib import Path

# Reuse the exact same merge logic already validated in build_and_enrich.py,
# rather than re-implementing it here and risking the two falling out of sync.
import build_and_enrich as bae

INPUT_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public/merged_enriched.json")


def merge_by_exact_key(games: list[dict]) -> list[dict]:
    """Re-group already-merged game objects by match_key(title). Two
    existing games whose titles collapse to the same key (e.g. version-
    number variants that slipped through under the old merge logic) get
    their downloadSources combined into one card."""
    groups: dict[str, dict] = {}
    order: list[str] = []  # preserve first-seen order for stable output

    for g in games:
        key = bae.match_key(g.get("title", ""))
        if not key:
            # Shouldn't happen for already-cleaned titles, but don't drop
            # the game if it does - keep it under its own unique key.
            key = f"__nokeymatch__:{g.get('id', id(g))}"

        if key not in groups:
            groups[key] = dict(g)  # shallow copy, safe to mutate below
            groups[key]["downloadSources"] = list(g.get("downloadSources", []))
            order.append(key)
        else:
            existing = groups[key]
            existing_urls = {s["url"] for s in existing["downloadSources"]}
            for src in g.get("downloadSources", []):
                if src["url"] not in existing_urls:
                    existing["downloadSources"].append(src)
                    existing_urls.add(src["url"])
            # Prefer keeping whichever steamId/reviewCount/coverImage is
            # already non-empty; don't let a later duplicate's blanks
            # overwrite good data the first one already had.
            for field in ("steamId", "reviewCount", "coverImage", "screenshot",
                           "summary", "developer", "rating", "releaseDate", "genres"):
                if not existing.get(field) and g.get(field):
                    existing[field] = g[field]
            # Recombine publisher list from the merged sources
            repackers = list(dict.fromkeys(
                s["repacker"] for s in existing["downloadSources"]
            ))
            existing["publisher"] = ", ".join(repackers)

    return [groups[k] for k in order]


def main():
    if not INPUT_PATH.exists():
        print(f"ERROR: {INPUT_PATH} not found.")
        sys.exit(1)

    print(f"Loading {INPUT_PATH}...")
    games = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    before_count = len(games)
    print(f"  {before_count} games loaded")

    # Apply manual overrides FIRST, before any merging.
    overrides_path = INPUT_PATH.parent.parent / "steam_id_overrides.json"
    if not overrides_path.exists():
        overrides_path = Path("steam_id_overrides.json")
    if overrides_path.exists():
        overrides = json.loads(overrides_path.read_text(encoding="utf-8"))
        overrides = {k: v for k, v in overrides.items() if not k.startswith("_")}

        # Build lookup by id for merge_into resolution
        games_by_id = {g["id"]: g for g in games}

        steam_id_fixes = 0
        merge_into_fixes = 0
        drop_ids = set()

        for game_id, directive in overrides.items():
            if game_id not in games_by_id:
                continue
            g = games_by_id[game_id]

            if directive == "remove":
                # Remove this card entirely
                drop_ids.add(game_id)
                print(f"  Removing card: {g.get('title', game_id)!r}")
            elif isinstance(directive, str):
                # merge_into: absorb this game's sources into the target
                target_id = directive
                if target_id in games_by_id:
                    target = games_by_id[target_id]
                    existing_urls = {s["url"] for s in target["downloadSources"]}
                    for src in g.get("downloadSources", []):
                        if src["url"] not in existing_urls:
                            target["downloadSources"].append(src)
                            existing_urls.add(src["url"])
                    drop_ids.add(game_id)
                    merge_into_fixes += 1
            else:
                # steamId fix: int or None
                old = g.get("steamId")
                g["steamId"] = directive
                if old != directive:
                    g["coverImage"] = ""
                    g["screenshot"] = ""
                    g["screenshots"] = []
                steam_id_fixes += 1

        # Remove games that were merged into others
        if drop_ids:
            games = [g for g in games if g["id"] not in drop_ids]

        print(f"  Applied {steam_id_fixes} steamId fix(es) and {merge_into_fixes} merge_into directive(s)")
    else:
        print(f"  No steam_id_overrides.json found (skipping override pass)")

    print("\n" + "=" * 55)
    print("  PASS 1: Exact-match re-merge (match_key)")
    print("=" * 55)
    games = merge_by_exact_key(games)
    after_pass1 = len(games)
    print(f"  {before_count} -> {after_pass1} games "
          f"({before_count - after_pass1} version-number duplicates merged)")

    # PASS 2: ambiguous-pair merge, reusing build_and_enrich.py's own
    # verify_and_merge_ambiguous() directly so the logic can't drift.
    games = bae.verify_and_merge_ambiguous(games)
    after_pass2 = len(games)
    print(f"\n  {after_pass1} -> {after_pass2} games after ambiguous-pair merge "
          f"({after_pass1 - after_pass2} additional merges)")

    # Recompute popularityScore (same formula as build_and_enrich.py) and sort.
    for g in games:
        review_count = g.get("reviewCount") or 0
        repacker_count = bae.repacker_count_for(g)
        g["popularityScore"] = round(math.log10(review_count + 1) * 2 + repacker_count, 3)
    games.sort(key=lambda g: -g["popularityScore"])

    backup_path = INPUT_PATH.with_suffix(".json.bak")
    print(f"\nBacking up original to {backup_path} before overwriting...")
    backup_path.write_text(json.dumps(json.loads(INPUT_PATH.read_text(encoding="utf-8")),
                                        ensure_ascii=False), encoding="utf-8")

    print(f"Saving deduplicated database to {INPUT_PATH}...")
    INPUT_PATH.write_text(json.dumps(games, ensure_ascii=False), encoding="utf-8")

    print(f"\nDone. {before_count} -> {len(games)} games "
          f"({before_count - len(games)} total duplicates removed).")
    print(f"Original backed up at {backup_path} in case anything looks wrong.")
    print("\nTop 10 most popular after dedup:")
    for g in games[:10]:
        print(f"  [{g['popularityScore']:6.2f}]  {g['title']}  "
              f"(reviews={g.get('reviewCount', 0)}, repackers={bae.repacker_count_for(g)}, "
              f"total links={len(g.get('downloadSources', []))})")


if __name__ == "__main__":
    main()
