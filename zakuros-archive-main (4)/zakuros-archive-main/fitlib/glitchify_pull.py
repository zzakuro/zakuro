"""Scrape glitchify.org into data/scraped/glitchify.json.

Download links ship as obfuscated tokens in `data-r-<hash>` attributes that the
site's own JS decodes client-side; we port that same decoder here, so the URLs
come out as plain direct links. The runtime key array is read from the page on
every run (its global name is deploy-specific), so this survives redeploys.
"""

import base64
import concurrent.futures as cf
import json
import pathlib
import re
import sys

FITLIB = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(FITLIB))
import scraper_api as sa

SCRAPED = FITLIB / "data" / "scraped"
OUT = SCRAPED / "glitchify.json"
SITEMAP = "https://glitchify.org/sitemap-0.xml"


def rot(b: int, r: int) -> int:
    t = r & 7
    return b & 255 if t == 0 else ((b >> t) | (b << (8 - t))) & 255


def decode_token(tok: str, g: list[int]) -> str:
    r = tok.replace("-", "+").replace("_", "/")
    r = r + "=" * ((4 - len(r) % 4) % 4)
    try:
        n = base64.b64decode(r)
    except Exception:
        return ""
    if len(n) < 15 or n[0] != 1:
        return ""
    a = n[1]
    if a < 8 or len(n) <= 2 + a:
        return ""
    c, i, out = n[2:2 + a], n[2 + a:], bytearray()
    for o in range(len(i)):
        d = (c[(o + 4) % len(c)] + o) % 7 + 1
        s = rot(i[o], d)
        p = (o + c[o % len(c)] + (c[(o * 5 + 3) % len(c)] & 31)) % len(g)
        x = g[p] ^ c[(o * 7 + 1) % len(c)] ^ ((o * 29 + 17) & 255)
        out.append(s ^ x)
    return out.decode("utf-8", "replace")


def page_runtime(html: str):
    """Return (key_array, attr_name) or (None, None)."""
    m = re.search(r'window\["(__gv_[A-Za-z0-9_]+)"\]=\[([0-9,\s]+)\]', html)
    a = re.search(r'data-glitch-attr="([^"]+)"', html)
    if not m or not a:
        return None, None
    return [int(x) for x in m.group(2).split(",") if x.strip()], a.group(1)


def parse_game(url: str, g: list[int], attr: str) -> dict | None:
    try:
        html = sa.http_text(url)
    except Exception:
        return None
    if "data-download-type" not in html:
        return None
    # per-page runtime (key array can differ per deploy/page)
    pg, pa = page_runtime(html)
    g2, attr2 = (pg, pa) if pg and pa else (g, attr)

    title = None
    t = re.search(r"<h1[^>]*>([\s\S]{0,300}?)</h1>", html)
    if t:
        title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t.group(1))).strip()
    if not title:
        og = re.search(r'property="og:title"[^>]*content="([^"]+)"', html)
        title = og.group(1).strip() if og else None

    size = None
    sm = re.search(r'side-size-badge[^>]*>[\s\S]{0,200}?([\d.,]+\s*[GMK]?B)', html, re.I)
    if sm:
        size = sm.group(1).strip()

    uris, seen = [], set()
    for m in re.finditer(
        rf'{re.escape(attr2)}="([^"]+)"[\s\S]{{0,500}}?data-download-type="([^"]+)"', html
    ):
        tok, dtype = m.group(1), m.group(2)
        url_out = decode_token(tok, g2)
        if url_out and url_out not in seen:
            seen.add(url_out)
            uris.append({"url": url_out, "name": dtype})
    # magnets, if the page offers any
    for m in re.finditer(rf'class="[^"]*magnet[^"]*slink[^"]*"[\s\S]{{0,300}}?{re.escape(attr2)}="([^"]+)"', html):
        u = decode_token(m.group(1), g2)
        if u.startswith("magnet:") and u not in seen:
            seen.add(u)
            uris.append({"url": u, "name": "Magnet"})

    if not title or not uris:
        return None
    return {"title": title, "fileSize": size, "uploadDate": None, "uris": uris, "srcUrl": url}


def main() -> int:
    locs = re.findall(r"<loc>([^<]+)</loc>", sa.http_text(SITEMAP))
    games = sorted({l for l in locs if re.search(r"/games/[^/]+/?$", l)})
    print(f"game urls: {len(games)}", flush=True)

    seed = sa.http_text(games[0])
    g, attr = page_runtime(seed)
    if not g:
        print("could not read runtime key; aborting")
        return 1
    print(f"runtime key len={len(g)} attr={attr}", flush=True)

    downloads, done = [], 0
    with cf.ThreadPoolExecutor(max_workers=12) as ex:
        for res in ex.map(lambda u: parse_game(u, g, attr), games):
            done += 1
            if res:
                downloads.append(res)
            if done % 25 == 0:
                print(f"  {done}/{len(games)} ok={len(downloads)}", flush=True)

    SCRAPED.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"name": "Glitchify", "downloads": downloads}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    links = sum(len(d["uris"]) for d in downloads)
    print(f"DONE games={len(downloads)} links={links} -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())