"""Config-driven site scraper engine (Python/Scrapling half of the scraper API).

The Node server (server/scrapers.ts + server/scraperApi.ts) spawns this for each
site run. Uses a single stealthy browser session per run so Cloudflare-challenged
sites are handled, then extracts from the rendered HTML with per-site regex hints
from data/scraper-sites.json. Output is written to data/scraped/<key>.json in the
same { name, downloads[] } shape the catalog's payload parser understands.

Usage:
  python scraper_api.py <site-key> [--max-posts N]     scrape a defined site
  python scraper_api.py --url <url> [--name X]         best-effort single-page scrape
"""
import argparse
import base64
import json
import pathlib
import re
import sys
import time
from urllib.parse import urljoin, urlparse

ROOT = pathlib.Path(__file__).resolve().parent
SITES_FILE = ROOT / "data" / "scraper-sites.json"
SCRAPED_DIR = ROOT / "data" / "scraped"

DEFAULT_TITLE_RE = re.compile(r"<h1[^>]*>([\s\S]*?)</h1>", re.I)
DEFAULT_SIZE_RE = re.compile(r"([\d.,]+\s*(?:GB|MB|TB|KB))(?=\s*\d+\s+host)", re.I)
FALLBACK_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)

TAG_RE = re.compile(r"<[^>]+>")


def get_text(html: str) -> str:
    return re.sub(r"\s+", " ", TAG_RE.sub("", html)).strip()


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def find_hrefs(html: str) -> list[str]:
    return re.findall(r'<a[^>]+href="([^"]+)"', html)


def b64_decode_maybe(s: str) -> str | None:
    s = s.strip().replace("-", "+").replace("_", "/")
    pad = "=" * (-len(s) % 4)
    try:
        return base64.b64decode(s + pad).decode("utf-8", "replace")
    except Exception:
        return None


def default_title(html: str, strip_re: str | None = None) -> str:
    m = DEFAULT_TITLE_RE.search(html)
    t = get_text(m.group(1)) if m else ""
    if not t:
        m = FALLBACK_TITLE_RE.search(html)
        t = get_text(m.group(1)) if m else ""
    if t and strip_re:
        t = re.sub(strip_re, "", t).strip()
    return t


def fetch_text(session, url: str) -> str:
    page = session.fetch(url, google_search=False, timeout=90000)
    if page.status >= 400:
        raise RuntimeError(f"HTTP {page.status} for {url}")
    return page.body.decode("utf-8", "replace")


def resolve_href(site: dict, href: str) -> str:
    if site.get("resolver") == "base64-decode":
        m = re.search(r"/api/dl/([^/]+)/([A-Za-z0-9_\-=]+)", href)
        if m:
            dec = b64_decode_maybe(m.group(2))
            if dec:
                return dec
    return href


def part_label(url: str, pattern: str | None) -> str | None:
    if not pattern:
        return None
    m = re.search(pattern, url, re.I)
    return m.group(1) if m else None


def part_from_anchor_text(text: str, pattern: str | None) -> str | None:
    if not text:
        return None
    m = re.search(pattern or r"Part\s*(\d+)", text, re.I)
    return m.group(1) if m else None


def anchor_links(html: str, link_pat: str) -> list[tuple[str, str]]:
    """(href, visible text) pairs for anchors whose href contains link_pat."""
    out = []
    for href, inner in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', html, re.I):
        if link_pat.lower() in href.lower():
            out.append((href, get_text(inner)))
    return out


def uri(name: str | None, url: str, part: str | None = None) -> dict:
    host = urlparse(url).netloc
    label = name or (host or "link")
    if part:
        label = f"{label} · Part {part}"
    return {"url": url, "name": label}


def load_sites() -> dict:
    if not SITES_FILE.exists():
        return {}
    return json.loads(SITES_FILE.read_text(encoding="utf-8"))


def write_payload(key: str, name: str, downloads: list) -> pathlib.Path:
    SCRAPED_DIR.mkdir(parents=True, exist_ok=True)
    out = SCRAPED_DIR / f"{key}.json"
    out.write_text(
        json.dumps({"name": name, "downloads": downloads}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return out


def scrape_site(site: dict, key: str, max_posts: int) -> pathlib.Path:
    from scrapling.fetchers import StealthySession

    pattern = site.get("postLinkPattern", "")
    link_pat = site.get("linkPattern", "/")
    strip_re = site.get("titleStrip") or None
    part_pat = site.get("partPattern") or None
    base = site.get("home", "")
    if base and not base.endswith("/"):
        base += "/"

    downloads: list = []
    with StealthySession(headless=True, solve_cloudflare=True) as session:
        home_html = fetch_text(session, site["home"])
        anchors = re.findall(r'<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', home_html, re.I)

        seen, posts = set(), []
        for href, inner in anchors:
            h = re.split(r"[#?]", href)[0]
            if pattern and pattern not in h:
                continue
            if h.startswith(("mailto:", "tel:", "javascript:")):
                continue
            if h in seen:
                continue
            seen.add(h)
            posts.append((urljoin(base, h), get_text(inner)))

        posts = posts[:max_posts]
        if not posts:
            raise RuntimeError("no post links found (check postLinkPattern)")

        for url, anchor_text in posts:
            try:
                html = fetch_text(session, url)
            except Exception:
                continue
            title = default_title(html, strip_re)
            if not title:
                continue
            links = anchor_links(html, link_pat)
            if not links:
                continue
            m = DEFAULT_SIZE_RE.search(anchor_text)
            size = m.group(1).strip() if m else None
            uris = []
            seen_hrefs: set[str] = set()
            for h, label in links:
                if h in seen_hrefs:
                    continue
                seen_hrefs.add(h)
                resolved = resolve_href(site, h)
                part = part_from_anchor_text(label, site.get("partLabelPattern") or None) or part_label(
                    resolved, part_pat
                )
                uris.append(uri(None, resolved, part))
            downloads.append(
                {
                    "title": title,
                    "fileSize": size,
                    "uploadDate": None,
                    "uris": uris,
                }
            )

    if not downloads:
        raise RuntimeError("no entries extracted from posts")

    out = write_payload(key, site.get("name") or key, downloads)
    return out


def scrape_url(url: str, name: str) -> pathlib.Path:
    from scrapling.fetchers import StealthySession

    downloads: list = []
    with StealthySession(headless=True, solve_cloudflare=True) as session:
        html = fetch_text(session, url)
        title = default_title(html)
        uris = []
        seen: set[str] = set()
        for h, label in anchor_links(html, "/"):
            if h in seen or h.startswith(("mailto:", "tel:", "javascript:", "#")) or h == "":
                if h not in seen:
                    seen.add(h)
                continue
            seen.add(h)
            part = part_from_anchor_text(label, None)
            uris.append(uri(label or None, resolve_href({"resolver": None}, h), part))
        downloads.append(
            {
                "title": title or url,
                "fileSize": None,
                "uploadDate": None,
                "uris": uris[:20],
            }
        )
    return write_payload("_live", name or "live", downloads)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("key", nargs="?", help="site key defined in data/scraper-sites.json")
    ap.add_argument("--max-posts", type=int, default=None)
    ap.add_argument("--url", default=None)
    ap.add_argument("--name", default=None)
    args = ap.parse_args()

    key = args.key or ""
    if args.url:
        out = scrape_url(args.url, args.name or "live")
    else:
        key = re.sub(r"[^a-z0-9_-]", "", key.lower())
        if not key:
            print("usage: scraper_api.py <site-key> | --url <url> [--name X]")
            return 2
        sites = load_sites()
        if key not in sites:
            print(f"unknown site key '{key}'. defined: {', '.join(sorted(sites)) or '(none)'}")
            return 1
        site = sites[key]
        out = scrape_site(site, key, args.max_posts or site.get("maxPosts") or 20)

    payload = json.loads(out.read_text(encoding="utf-8"))
    print(f"ok total={len(payload['downloads'])} file={out}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)