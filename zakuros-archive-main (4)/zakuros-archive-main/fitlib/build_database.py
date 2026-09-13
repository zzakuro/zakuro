#!/usr/bin/env python3
"""
Zakuro's Archive — Repacker Converter + Merger (Strict Edition)
======================================================
Merges all repacker JSON files into one deduplicated database.
For each repacker, only the MOST RECENT release of a game is kept.
Across repackers, all sources are stacked on one game entry.

Usage (run from fitlib/ directory):
    python3 build_database.py
    python3 build_database.py --input-dir . --output public/merged.json
    python3 build_database.py --files fitgirl.json dodi.json gog.json ...
"""

import re
import json
import argparse
from pathlib import Path
from datetime import datetime


# ── Strip patterns applied before matching ────────────────────────────────────
# Order matters — more specific patterns first.

STRIP_PATTERNS = [
    # Bracket tags: [FitGirl Repack], [DODI Repack], [GOG], [1С], etc.
    r"\[.*?\]",

    # MULTi language tags: (MULTi14), (MULTi2)
    r"\(.*?MULTi\d+.*?\)",

    # Version tags: (v1.0.0), (v1.04.81402), v2.1.3 standalone
    r"\(v[\d\.]+[^)]*\)",
    r"\bv[\d]+\.[\d][\d\.]*\b",

    # Build numbers: (Build 16031108), Build 12345
    r"\(Build\s[\d\.]+[^)]*\)",
    r"\bBuild\s+\d+\b",

    # Patch tags: Patch 8, Hotfix 1, Update 3
    r"\bPatch\s+\d+\b",
    r"\bHotfix\s+\d+\b",
    r"\bUpdate\s+\d+\b",

    # Year ranges and dates in parens: (2024), (2007-2015), (2024/11/06)
    r"\(\d{4}(?:[/-]\d{2}){0,2}\)",
    r"\(\d{4}-\d{4}\)",

    # DLC / bonus content suffixes
    r"\+\s*\d+\s*DLCs?[^,\n]*",
    r"\+\s*(?:All\s+)?DLCs?",
    r"\+\s*Bonus\s+\w+",
    r"\+\s*(?:Online\s+)?Multiplayer",
    r"\+\s*OST\b",
    r"\(All DLCs[^)]*\)",
    r"\(Fast Install[^)]*\)",
    r"\(Hypervisor\)",

    # Edition suffixes (colon or space before)
    r"[:\s]+Digital\s+Deluxe\s+Edition",
    r"[:\s]+Digital\s+Edition",
    r"[:\s]+Digital\b",
    r"[:\s]+Deluxe\s+Edition",
    r"[:\s]+Complete\s+Edition",
    r"[:\s]+Ultimate\s+Edition",
    r"[:\s]+Gold\s+Edition",
    r"[:\s]+GOTY\s+Edition",
    r"[:\s]+Game\s+of\s+the\s+Year\s+Edition",
    r"[:\s]+Premium\s+Edition",
    r"[:\s]+Definitive\s+Edition",
    r"[:\s]+Enhanced\s+Edition",
    r"[:\s]+Anniversary\s+Edition",
    r"[:\s]+Collector[s']?\s+Edition",
    r"[:\s]+Director[s']?\s+Cut",
    r"[:\s]+Standard\s+Edition",
    r"[:\s]+Special\s+Edition",
    r"[:\s]+Extended\s+Edition",

    # Version suffix after dash/comma
    r"[–\-]\s*v[\d\.]+.*",
    r",\s*v[\d\.]+.*",

    # Repack attribution
    r"RePack\s+(?:от|by|from)\s+\w+",
    r"RePack\b.*",
    r"Repack\b.*",

    # Free download tag
    r"\bFree\s+Download\b",

    # Russian platform/license tags
    r"PC\s*\|\s*Лицензия",
    r"PC\s*\|\s*RePack.*",
    r"\[Архив\]",
    r"\[Папка игры[^\]]*\]",
    r"\[Акелла\]",

    # Early Access
    r"\(Early Access\)",

    # Bundle suffix
    r"&\s*.+Bundle",

    # Trailing punctuation after stripping
]


def normalize_for_match(title: str) -> str:
    """
    Aggressively strip all repacker noise, then return a lowercase
    alphanumeric-only string for matching.
    """
    t = title
    for pat in STRIP_PATTERNS:
        t = re.sub(pat, " ", t, flags=re.IGNORECASE)
    # Collapse whitespace and strip trailing punctuation
    t = re.sub(r"\s{2,}", " ", t).strip().strip(":-–,. ")
    # Lowercase, keep only word chars and spaces
    t = t.lower()
    t = re.sub(r"[^\w\s]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def clean_title(raw: str) -> str:
    """Human-readable display title — strip noise but keep case and punctuation."""
    t = raw
    for pat in STRIP_PATTERNS:
        t = re.sub(pat, " ", t, flags=re.IGNORECASE)
    t = re.sub(r"\s{2,}", " ", t).strip().strip(":-–,. ")
    return t


def make_id(title: str) -> str:
    t = title.lower()
    t = re.sub(r"[^\w\s-]", "", t)
    t = re.sub(r"[\s_]+", "-", t).strip("-")
    return t


def parse_date(date_str: str) -> datetime:
    if not date_str:
        return datetime.min
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(date_str[:len(fmt)], fmt)
        except ValueError:
            continue
    return datetime.min


# ── Repacker file loader ──────────────────────────────────────────────────────

def load_repacker_file(path: Path) -> list[dict]:
    """
    Load a repacker JSON, normalize titles, and for duplicate normalized titles
    within the same repacker keep only the MOST RECENT entry.
    """
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    repacker_name = data.get("name", path.stem.title())
    downloads = data.get("downloads", [])

    # First pass: build all entries
    raw_entries = []
    for item in downloads:
        raw_title = item.get("title", "").strip()
        if not raw_title:
            continue

        file_size = (item.get("fileSize") or "").strip()
        upload_date = (item.get("uploadDate") or "")[:10]

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

        ct = clean_title(raw_title)
        norm = normalize_for_match(raw_title)
        if not norm:
            continue

        raw_entries.append({
            "rawTitle": raw_title,
            "cleanTitle": ct,
            "normalizedTitle": norm,
            "fileSize": file_size,
            "uploadDate": upload_date,
            "uploadDateParsed": parse_date(upload_date),
            "repacker": repacker_name,
            "downloadSources": sources,
        })

    # Second pass: for each normalized title within this repacker,
    # keep only the most recent entry (by uploadDate)
    by_norm: dict[str, dict] = {}
    for entry in raw_entries:
        key = entry["normalizedTitle"]
        if key not in by_norm:
            by_norm[key] = entry
        else:
            existing_date = by_norm[key]["uploadDateParsed"]
            new_date = entry["uploadDateParsed"]
            if new_date > existing_date:
                by_norm[key] = entry

    result = list(by_norm.values())
    print(f"  {repacker_name:<15} {len(downloads):>5} raw  →  {len(result):>5} unique  ({path.name})")
    return result


# ── Merge all repackers ───────────────────────────────────────────────────────

def merge_all(repacker_files: list[Path]) -> list[dict]:
    print(f"\nLoading {len(repacker_files)} repacker file(s)...\n")

    # Global index: normalized_title → { cleanTitle, sources[] }
    index: dict[str, dict] = {}

    for path in repacker_files:
        entries = load_repacker_file(path)
        for entry in entries:
            key = entry["normalizedTitle"]
            if not key:
                continue

            if key not in index:
                index[key] = {
                    "cleanTitle": entry["cleanTitle"],
                    "sources": [],
                    "uploadDate": entry["uploadDate"],
                }

            # Add sources, deduplicating by URL
            existing_urls = {s["url"] for s in index[key]["sources"]}
            for src in entry["downloadSources"]:
                if src["url"] not in existing_urls:
                    index[key]["sources"].append(src)
                    existing_urls.add(src["url"])

            # Keep the most recent uploadDate across repackers
            if entry["uploadDate"] > index[key]["uploadDate"]:
                index[key]["uploadDate"] = entry["uploadDate"]
                # Prefer the cleaner title from more recent/metadata-rich sources
                if entry["cleanTitle"] and len(entry["cleanTitle"]) < len(index[key]["cleanTitle"]) + 20:
                    index[key]["cleanTitle"] = entry["cleanTitle"]

    print(f"\nUnique titles after merge: {len(index)}")

    # Build final game objects
    results = []
    for key, data in index.items():
        sources = data["sources"]
        clean = data["cleanTitle"]

        # Pick file size from the most recent source that has one
        sorted_sources = sorted(
            sources,
            key=lambda s: parse_date(s.get("uploadDate", "")),
            reverse=True
        )
        file_size = next((s["fileSize"] for s in sorted_sources if s.get("fileSize")), "")
        magnet = next((s["url"] for s in sources if s["type"] == "torrent"), "")
        repackers = list(dict.fromkeys(s["repacker"] for s in sources))
        upload_date = data["uploadDate"]

        results.append({
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
            "summary": f"Available via: {', '.join(repackers)}",
            "systemRequirements": {
                "windows": {
                    "minimum": {
                        "os": "Windows 10 64-bit",
                        "processor": "Check original game requirements",
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

    results.sort(key=lambda g: g["title"].lower())
    return results


# ── Stats ─────────────────────────────────────────────────────────────────────

def print_stats(games: list[dict]):
    multi = [g for g in games if len(g["downloadSources"]) > 1]
    repacker_counts: dict[str, int] = {}
    for g in games:
        for src in g["downloadSources"]:
            r = src.get("repacker", "Unknown")
            repacker_counts[r] = repacker_counts.get(r, 0) + 1

    print(f"\n{'='*50}")
    print(f"  Total unique games    : {len(games)}")
    print(f"  Games with 2+ sources : {len(multi)}")
    print(f"\n  Sources per repacker:")
    for repacker, count in sorted(repacker_counts.items(), key=lambda x: -x[1]):
        print(f"    {repacker:<20} {count:>5} sources")
    print(f"{'='*50}\n")



# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Build Zakuro's Archive merged database.")
    parser.add_argument("--input-dir", default=".", help="Directory containing repacker JSON files")
    parser.add_argument("--files", nargs="*", help="Explicit list of repacker JSON files")
    parser.add_argument("--output", default="public/merged.json", help="Output path")
    args = parser.parse_args()

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

    if args.files:
        repacker_files = [Path(f) for f in args.files]
    else:
        base = Path(args.input_dir)
        repacker_files = [base / f for f in SOURCE_FILES]

    if not repacker_files:
        print("No repacker JSON files found.")
        return

    missing = [str(p) for p in repacker_files if not p.exists()]
    if missing:
        print(f"Error: files not found: {', '.join(missing)}")
        return

    print(f"Files to merge: {[p.name for p in repacker_files]}")

    games = merge_all(repacker_files)
    print_stats(games)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(games, f, indent=2, ensure_ascii=False)

    print(f"✓ Written {len(games)} games to {output}")
    print(f"\nNext: python3 enrich_steam_ids.py")


if __name__ == "__main__":
    main()
