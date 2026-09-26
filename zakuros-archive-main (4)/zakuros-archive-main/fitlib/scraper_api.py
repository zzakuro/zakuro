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
import html as _html
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
    return _html.unescape(re.sub(r"\s+", " ", TAG_RE.sub("", html))).strip()


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
        t = re.sub(strip_re, "", t, flags=re.I).strip()
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


def extract_size(text: str, size_pat: str | None) -> str | None:
    if size_pat:
        m = re.search(size_pat, text)
        if m:
            return m.group(1).strip()
        return None
    m = DEFAULT_SIZE_RE.search(text)
    return m.group(1).strip() if m else None


def direct_title(label: str, strip_re: str | None, strip_nums: bool, size_pat: str | None) -> str:
    t = label
    if strip_nums:
        t = re.sub(r"^\s*\d+\s*[-.)]?\s+", "", t).strip()
    if size_pat:
        t = re.sub(r"\s*\[(?:From\s+)?[\d.,]+\s*(?:GB|MB|TB)\]\s*$", "", t).strip()
    if strip_re:
        t = re.sub(strip_re, "", t, flags=re.I).strip()
    return t


def discover_pages(home_html: str, base: str, page_pat: str | None, pages: int) -> list[str]:
    """Absolute URL list of listing pages beyond the home page (max `pages` total)."""
    if not page_pat or pages <= 1:
        return []
    found: dict[str, int] = {}
    for h in find_hrefs(home_html):
        h = _html.unescape(h)
        if page_pat not in h:
            continue
        u = urljoin(base, re.split(r"[#]", h)[0])
        if not u or u in found:
            continue
        m = re.search(r"(\d+)(?:\.html)?$", u)
        found[u] = int(m.group(1)) if m else 10**9
    ordered = sorted(found, key=lambda u: found[u])
    return ordered[: pages - 1]


def scrape_site(site: dict, key: str, max_posts: int) -> pathlib.Path:
    from scrapling.fetchers import StealthySession

    mode = site.get("mode", "post")
    pattern = site.get("postLinkPattern", "")
    entry_pat = site.get("entryPattern") or None
    link_pat = site.get("linkPattern", "/")
    strip_re = site.get("titleStrip") or None
    part_pat = site.get("partPattern") or None
    part_label_pat = site.get("partLabelPattern") or None
    size_pat = site.get("sizePattern") or None
    skip_pats = site.get("skipLinkPatterns") or None
    strip_nums = bool(site.get("stripListNumbers"))
    pages = int(site.get("pages") or 1)
    base = site.get("home", "")
    if base and not base.endswith("/"):
        base += "/"

    downloads: list = []
    with StealthySession(headless=True, solve_cloudflare=True) as session:
        home_html = fetch_text(session, site["home"])
        listing_urls = [site["home"]] + discover_pages(home_html, base, site.get("pageLinkPattern"), pages)

        seen, posts = set(), []
        for lu in listing_urls:
            html = home_html if lu == site["home"] else fetch_text(session, lu)
            for href, inner in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', html, re.I):
                raw = _html.unescape(href)
                if raw.startswith(("mailto:", "tel:", "javascript:")):
                    continue
                if mode == "direct":
                    if entry_pat and entry_pat not in raw:
                        continue
                elif pattern and pattern not in raw:
                    continue
                if skip_pats and any(p in raw for p in skip_pats):
                    continue
                u = urljoin(base, re.split(r"[#]", raw)[0])
                if u in seen:
                    continue
                seen.add(u)
                if mode == "direct":
                    posts.append(("", get_text(inner), u))
                else:
                    posts.append((u, get_text(inner)))
            if len(posts) >= max_posts:
                break

        posts = posts[:max_posts]
        if not posts:
            raise RuntimeError("no entries found (check postLinkPattern/entryPattern)")

        for item in posts:
            if mode == "direct":
                _, anchor_text, url = item
                title = direct_title(anchor_text, strip_re, strip_nums, size_pat)
                if not title:
                    continue
                uris = [uri(None, url, part_from_anchor_text(anchor_text, part_label_pat))]
                size = extract_size(anchor_text, size_pat)
            else:
                url, anchor_text = item
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
                size = extract_size(anchor_text, size_pat)
                uris = []
                seen_hrefs: set[str] = set()
                for h, label in links:
                    if h in seen_hrefs:
                        continue
                    seen_hrefs.add(h)
                    resolved = resolve_href(site, h)
                    part = part_from_anchor_text(label, part_label_pat) or part_label(resolved, part_pat)
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