#!/usr/bin/env python3
"""Scrape UnionCrax's preserved-games index into a Hydra/Zakuro-compatible source feed.

The site is a Next.js SSR app; the entire catalog (260 games) is embedded in the
HTML as JSON inside `self.__next_f.push([1,"..."])` chunks. We concat those
chunks, un-JSON-unescape the combined string, and lift the games array.

Output: data/local/unioncrax.json  ({ "name": "UnionCrax", "downloads": [...] })
Re-run any time to refresh.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

URL = "https://union-crax.xyz/"
OUT_PATH = Path(__file__).parent / "data" / "local" / "unioncrax.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=45) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_payload(html: str) -> str:
    # Each self.__next_f.push([1,"..."]) arg is a JS string literal containing
    # JSON-escaped text. Concatenate all chunks, then decode as one JSON string.
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    if not chunks:
        raise RuntimeError("No Next.js RSC chunks found (site layout changed?)")
    joined = "".join(chunks)
    return json.loads('"' + joined + '"')


def extract_games(payload: str) -> list[dict]:
    # The games array immediately precedes "initialReactions".
    m = re.search(
        r'(\[\{"id":\d+,"appid".*?\}\]),"initialReactions"', payload, re.S
    )
    if not m:
        raise RuntimeError("Games array not found in payload (site layout changed?)")
    games = json.loads(m.group(1))
    for g in games:  # sanity shape check
        if not isinstance(g, dict) or "name" not in g or "links" not in g:
            raise RuntimeError("Unexpected game entry shape")
        # links may be null/none in the JSON
        if g["links"] is None:
            g["links"] = []
    return games


def to_feed(games: list[dict]) -> dict:
    downloads = []
    for g in games:
        title = str(g.get("name") or "").strip()
        if not title:
            continue
        version = str(g.get("version") or "").strip().replace("(?)", "").strip()
        if version:
            title = f"{title} ({version})"
        uris = []
        for link in g.get("links", []):
            url = str(link.get("url") or "").strip()
            if url and url not in uris:
                uris.append(url)
        if not uris:
            continue
        size = str(g.get("size") or "").strip()
        release_date = str(g.get("release_date") or "")
        downloads.append(
            {
                "title": title,
                "uris": uris,
                "uploadDate": release_date + "T00:00:00.000Z" if release_date else "",
                "fileSize": size,
            }
        )
    return {"name": "UnionCrax", "downloads": downloads}


def main() -> int:
    print(f"[UnionCrax] Fetching {URL}")
    html = fetch(URL)
    print(f"[UnionCrax] HTML {len(html):,} chars")
    payload = extract_payload(html)
    games = extract_games(payload)
    print(f"[UnionCrax] Found {len(games)} game entries")
    feed = to_feed(games)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(feed, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[UnionCrax] Wrote {len(feed['downloads'])} downloads -> {OUT_PATH}")
    sample = feed["downloads"][0]
    print(f"[UnionCrax] Sample: {sample['title']} | {sample['fileSize']} | {sample['uris'][0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())