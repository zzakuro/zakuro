"""Incremental ZeiGames crawler.

Each run fetches the single /all-games/ listing and fetches only topics whose
URL is not already in data/scraped/zeigames.json (keyed on srcUrl), so repeat
runs cost one page fetch and pick up only newly posted games.

Safe to stop and resume: the output file is checkpointed every 50 entries.
"""

import json
import pathlib
import re
import sys
import time
from urllib.parse import urljoin

FITLIB = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(FITLIB))
import scraper_api as sa
from scrapling.fetchers import StealthySession

OUT = FITLIB / "data" / "scraped" / "zeigames.json"
BASE = "https://zeigames.com/"
SKIP = ("how-to-download-game-from-zeigames", "gamerequest")


def is_challenge(html: str) -> bool:
    return "<title>Just a moment" in html or ("cf-challenge" in html and "og:title" not in html)


def save(downloads):
    sa.write_payload("zeigames", "ZeiGames", downloads)
    print(f"[save] wrote {len(downloads)} entries", flush=True)


def main() -> int:
    existing = {}
    if OUT.exists():
        try:
            for d in json.loads(OUT.read_text(encoding="utf-8")).get("downloads", []):
                if d.get("srcUrl"):
                    existing[d["srcUrl"]] = d
            print(f"resume with {len(existing)} existing", flush=True)
        except Exception:
            pass

    topics: list[str] = []
    new_topics: list[str] = []
    with StealthySession(headless=True, solve_cloudflare=True) as session:
        home = sa.fetch_text(session, BASE + "all-games/")
        print(f"home bytes: {len(home)}", flush=True)
        for href, _ in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', home, re.I):
            u = urljoin(BASE, re.split(r"[#]", href)[0])
            if "/topic/" not in u or any(p in u for p in SKIP) or u in topics:
                continue
            topics.append(u)
        new_topics = [u for u in topics if u not in existing]
        print(f"topics found: {len(topics)} | new: {len(new_topics)}", flush=True)

        if not new_topics:
            print("nothing new; leaving file untouched", flush=True)
            return 0

        downloads = list(existing.values())
        ok = fail = 0
        total = len(new_topics)
        for i, url in enumerate(new_topics):
            t0 = time.time()
            html = None
            for attempt in range(5):
                try:
                    cur = sa.fetch_text(session, url)
                except Exception:
                    cur = None
                    if attempt < 4:
                        time.sleep(3 + attempt * 4)
                        continue
                    break
                if cur and not is_challenge(cur):
                    html = cur
                    break
                if attempt < 4:
                    time.sleep(3 + attempt * 4)
            if html is None:
                fail += 1
                continue
            title = sa.default_title(html, None, "og")
            size = sa.extract_size(html, "DOWNLOAD AREA[\\s\\S]{0,300}?([\\d.,]+\\s*(?:GB|MB|TB))")
            zl = [{"url": h, "name": "ZeiLink"} for h, _ in sa.anchor_links(html, None) if "zeilink.net/c/" in h]
            if not title or not zl:
                fail += 1
                continue
            ok += 1
            downloads.append({"title": title, "fileSize": size, "uploadDate": None, "uris": zl, "srcUrl": url})
            if len(downloads) % 50 == 0:
                save(downloads)
            print(f"[{i + 1}/{total}] ok={ok} fail={fail} last={title[:50]!r} size={size} ms={int((time.time() - t0) * 1000)}", flush=True)
            time.sleep(1.2)
        save(downloads)
    print(f"DONE ok={ok} fail={fail} new={total} total_in_file={len(downloads)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())