#!/usr/bin/env python3
"""Scrape gamebounty.world into a Hydra/Zakuro-compatible source feed.

The site is a Next.js App Router app. Listing pages (?page=N) embed 48-game
arrays (`initialPosts`) in RSC flight chunks (~108 pages => ~5,184 games).
Each game's real download links live on its detail page (/<slug>-free-pc-download)
inside `recommended`/`others` host-link arrays as:
    https://gamebounty.world/api/dl/<slug>/<base64-of-real-host-url>

Usage:
  python scrape_gamebounty.py                   # listing only  -> data/local/gamebounty_games.json
  python scrape_gamebounty.py --detail          # listing + detail crawl -> data/local/gamebounty.json
  python scrape_gamebounty.py --pages 3         # cap listing pages (quick test)
  python scrape_gamebounty.py --slugs a,b       # detail-crawl only these slugs (debug)

Resumable: already-crawled slugs are skipped, and the feed is rewritten after
every game, so an interrupted run continues where it left off.
"""
import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import quote

# Windows consoles default to cp1252 and crash on non-ASCII titles; force UTF-8
# output with lossy replacement so a weird title can never kill the crawl.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://gamebounty.world"
LIST_OUT = Path(__file__).parent / "data" / "local" / "gamebounty_games.json"
FEED_OUT = Path(__file__).parent / "data" / "local" / "gamebounty.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def log(msg: str) -> None:
    print(msg, flush=True)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=45) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_payload(html: str) -> str:
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    if not chunks:
        raise RuntimeError("No Next.js RSC chunks found (site layout changed?)")
    joined = "".join(chunks)
    return json.loads('"' + joined + '"')


def parse_flight_array(payload: str, key: str):
    """Return the JSON array assigned to `"<key>":` in the decoded flight string."""
    idx = payload.find(key)
    if idx < 0:
        return None
    start = payload.find("[", idx)
    if start < 0:
        return None
    # Balanced-bracket scan that respects JSON string literals.
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(payload)):
        c = payload[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return json.loads(payload[start : i + 1])
    return None


def crawl_listing(pages: int | None) -> list[dict]:
    games: dict[str, dict] = {}
    page = 1
    total_pages = None
    while True:
        if pages is not None and page > pages:
            break
        url = f"{BASE}/?page={page}"
        try:
            html = fetch(url)
        except Exception as e:
            log(f"  [listing] page {page} fetch failed: {e} - retrying in 3s")
            time.sleep(3)
            continue
        payload = extract_payload(html)
        batch = parse_flight_array(payload, '"initialPosts"')
        m = re.search(r'"totalPages":(\d+)', payload)
        if m:
            total_pages = int(m.group(1))
        if not batch:
            log(f"  [listing] page {page}: no initialPosts (stopping)")
            break
        for g in batch:
            if isinstance(g, dict) and g.get("slug"):
                games[g["slug"]] = g
        log(f"  [listing] page {page}: {len(batch)} games (total seen {len(games)})")
        if len(batch) < 48 or (total_pages and page >= total_pages):
            break
        page += 1
        time.sleep(0.15)
    return list(games.values())


def crawl_detail(slug: str):
    # Drop lone surrogates (which quote() cannot encode) while keeping real
    # non-ASCII characters intact.
    safe_slug = slug.encode("utf-8", "ignore").decode("utf-8", "ignore")
    url = f"{BASE}/{quote(safe_slug)}-free-pc-download"
    html = fetch(url)
    payload = extract_payload(html)
    urls = list(
        dict.fromkeys(re.findall(r'"url":"(https://gamebounty\.world/api/dl/[^"]+)"', payload))
    )
    m_size = re.search(r'"sizeHuman":"([^"]+)"', payload)
    m_date = re.search(r'"createdAt":"([0-9]{4}-[0-9]{2}-[0-9]{2})', payload)
    return {
        "slug": slug,
        "uris": urls,
        "fileSize": m_size.group(1) if m_size else "",
        "uploadDate": m_date.group(1) if m_date else "",
    }


def build_feed_from_cache() -> dict:
    """Load the feed built so far (for resume)."""
    if FEED_OUT.exists():
        try:
            return json.loads(FEED_OUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"name": "GameBounty", "downloads": []}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--detail", action="store_true", help="also crawl every game's detail page")
    ap.add_argument("--pages", type=int, default=None, help="cap listing pages (testing)")
    ap.add_argument("--slugs", type=str, default="", help="comma-separated slugs to detail-crawl only")
    args = ap.parse_args()

    LIST_OUT.parent.mkdir(parents=True, exist_ok=True)

    # Optional quick detail pass on specific slugs.
    if args.slugs:
        feed = build_feed_from_cache()
        names = {d["title"] for d in feed["downloads"]}
        for slug in [s.strip() for s in args.slugs.split(",") if s.strip()]:
            try:
                info = crawl_detail(slug)
            except Exception as e:
                log(f"[detail] {slug}: FAILED {e}")
                continue
            title = slug.replace("-", " ").title()
            names.add(title)
            feed["downloads"] = [d for d in feed["downloads"] if d["title"] != title]
            if info["uris"]:
                feed["downloads"].append({
                    "title": title,
                    "uris": info["uris"],
                    "uploadDate": info["uploadDate"],
                    "fileSize": info["fileSize"],
                })
            log(f"[detail] {slug}: uris={len(info['uris'])} size={info['fileSize']}")
            time.sleep(0.15)
        FEED_OUT.write_text(json.dumps(feed, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"[GameBounty] Wrote {len(feed['downloads'])} downloads -> {FEED_OUT}")
        return 0

    games = crawl_listing(args.pages)
    if not games:
        log("[GameBounty] No games collected. Aborting.")
        return 1
    log(f"[GameBounty] Listing complete: {len(games)} games")

    # Persist a raw listing snapshot (useful for debugging / rebuilds).
    LIST_OUT.write_text(json.dumps(games, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"[GameBounty] Wrote listing -> {LIST_OUT}")

    if not args.detail:
        log("[GameBounty] Listing only. Use --detail to crawl download links too.")
        return 0

    # Detail crawl with resume.
    feed = build_feed_from_cache()
    have = {d["title"]: d for d in feed["downloads"]}
    done = 0
    skipped = 0
    t0 = time.time()
    for i, g in enumerate(games, 1):
        title = str(g.get("title") or "").strip()
        slug = str(g.get("slug") or "").strip()
        if not title or not slug:
            skipped += 1
            continue
        if title in have:
            done += 1
            continue
        try:
            info = crawl_detail(slug)
        except Exception as e:
            log(f"[detail] {slug}: FAILED {e} (will retry next run)")
            skipped += 1
            time.sleep(2)
            continue
        if not info["uris"]:
            skipped += 1
        else:
            have[title] = {
                "title": title,
                "uris": info["uris"],
                "uploadDate": info["uploadDate"],
                "fileSize": info["fileSize"],
            }
            done += 1
        # Rewrite incrementally so interruptions never lose progress.
        feed["downloads"] = list(have.values())
        FEED_OUT.write_text(json.dumps(feed, ensure_ascii=False, indent=2), encoding="utf-8")
        if i % 25 == 0 or i == len(games):
            el = time.time() - t0
            rate = i / el if el else 0
            eta = (len(games) - i) / rate if rate else 0
            log(f"[detail] {i}/{len(games)} ({done} done, {skipped} skipped, "
                f"in-feed {len(feed['downloads'])}; {rate:.1f} games/s, ETA {eta/60:.0f} min)")
        time.sleep(0.15)

    feed["downloads"] = list(have.values())
    FEED_OUT.write_text(json.dumps(feed, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"[GameBounty] Done: {done} games with links, {skipped} skipped, written -> {FEED_OUT}")
    sample = next((d for d in feed["downloads"] if d["uris"]), None)
    if sample:
        log(f"[GameBounty] Sample: {sample['title']} | {sample['fileSize']} | {sample['uris'][0]} | {sample['uploadDate']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())