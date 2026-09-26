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
from urllib.parse import unquote, urljoin, urlparse

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


def b2human(num) -> str:
    n = float(num)
    units = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    while n >= 1024 and i < len(units) - 1:
        n /= 1024
        i += 1
    return f"{n:.0f} {units[i]}" if n >= 100 else f"{n:.1f} {units[i]}"


def _b64u_bytes(s: str) -> bytes:
    s = s.strip().replace("-", "+").replace("_", "/")
    pad = "=" * (-len(s) % 4)
    return base64.b64decode(s + pad)


def _unseal(token: str, key: list[int]) -> str | None:
    def rotl255(val: int, r: int) -> int:
        r = r & 7
        if r == 0:
            return val & 255
        return ((val >> r) | (val << (8 - r))) & 255

    try:
        t = list(_b64u_bytes(token))
    except Exception:
        return None
    if len(t) < 4 or t[0] != 1:
        return None
    n = t[1]
    a = 2 + n
    if n < 8 or a >= len(t):
        return None
    c = t[2:a]
    s = t[a:]
    o = bytearray(len(s))
    for i in range(len(s)):
        l = key[(i + c[i % len(c)]) % len(key)]
        u = c[(i * 5 + 3) % len(c)]
        f = (l + u + ((i * 31 + 17) & 255)) & 255
        o[i] = rotl255(s[i] ^ f, i % 5 + 1)
    try:
        out = bytes(o).decode("utf-8", "replace")
    except Exception:
        return None
    if not out.startswith(("http://", "https://")):
        return None
    return out


def glitch_seal_links(html: str) -> list[tuple[str, str, str | None]]:
    m = re.search(r"linkKey\s*=\s*\[([^\]]+)\]", html)
    if not m:
        return []
    key = [int(x) for x in m.group(1).split(",") if x.strip().lstrip("-").isdigit()]
    am = re.search(r'linkPayloadAttribute\s*=\s*"([^"]+)"', html)
    attr = am.group(1) if am else "data-anl3cgehmr"
    out: list[tuple[str, str, str | None]] = []
    for a in re.finditer(r'<a\b[^>]*' + re.escape(attr) + r'="([^"]+)"[^>]*>', html, re.I):
        hm = re.search(r'data-host="([^"]*)"', a.group(0))
        host = hm.group(1) if hm else ""
        url = _unseal(a.group(1), key)
        if not url:
            continue
        tail = html[a.end(): a.end() + 2500]
        sm = re.search(r"download-size-badge[^>]*>[\s\S]{0,2500}?([\d.,]+\s*(?:GB|MB|TB))", tail)
        size = sm.group(1) if sm else None
        fm = re.search(r"([A-Za-z0-9_ .'()\-]+\.(?:rar|zip|7z))", tail)
        label = host or urlparse(url).netloc
        if fm:
            label = f"{label} · {fm.group(1)}"
        out.append((url, label, size))
    return out


def text_links(html: str, link_pat: str) -> list[tuple[str, str | None, str | None]]:
    pat = link_pat.lower()
    h = html.replace("\\/", "/").replace('\\"', '"')
    best: dict[str, tuple[int, str | None, str | None]] = {}
    for m in re.finditer(r"https?://[^\s\"'<>\\]+", h):
        u = m.group(0).rstrip(".,;:})]\"'")
        if pat not in u.lower():
            continue
        pre = h[max(0, m.start() - 3000):m.start()]
        nm = re.findall(r'"name"\s*:\s*"([^"]+)"', pre)
        sz = re.findall(r'"size"\s*:\s*"([^"]+)"', pre)
        label = nm[-1] if nm else None
        size = sz[-1] if sz else None
        score = (1 if label else 0) + (1 if size else 0)
        cur = best.get(u)
        if cur is None or score > cur[0]:
            best[u] = (score, label, size)
    return [(u, v[1], v[2]) for u, v in best.items()]


def magnet_parts(href: str) -> tuple[str, str | None]:
    dn = re.search(r"&dn=([^&\s]+)", href)
    xl = re.search(r"&xl=(\d+)", href)
    title = unquote(dn.group(1)) if dn else "(no title)"
    size = b2human(int(xl.group(1))) if xl else None
    return title, size


GENERIC_LABELS = {"click here", "download", "download here", "download now", "here", "view"}
ALIAS_NAMES = {"tpi.li": "OvaGames", "oii.la": "OvaGames", "srnky.com": "OvaGames", "shrinkme.click": "OvaGames"}


def link_label(site: dict, url: str, anchor_label: str | None) -> str:
    s = (anchor_label or "").strip() if anchor_label else ""
    low = s.lower()
    if low in GENERIC_LABELS or low.endswith("click here") or not s:
        aliases = site.get("linkAliases") or {}
        for pat, label in aliases.items():
            if re.search(pat, url, re.I):
                return label
        host = urlparse(url).netloc
        return ALIAS_NAMES.get(host, host or "link")
    return s


def default_title(html: str, strip_re: str | None = None, title_source: str | None = None) -> str:
    if title_source == "og":
        m = re.search(r'property="og:title"\s+content="([^"]+)"', html) or re.search(
            r'content="([^"]+)"\s+property="og:title"', html
        )
        t = get_text(m.group(1)) if m else ""
    else:
        h1s = re.findall(r"<h1[^>]*>([\s\S]*?)</h1>", html, re.I)
        if title_source == "last" and h1s:
            h1s = h1s[-1:]
        t = get_text(h1s[0]) if h1s else ""
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
    try:
        return page.body.decode("utf-8")
    except UnicodeDecodeError:
        return page.body.decode("latin-1", "replace")


def resolve_href(site: dict, href: str) -> str:
    if site.get("resolver") == "base64-decode":
        m = re.search(r"/api/dl/([^/]+)/([A-Za-z0-9_\-=]+)", href)
        if m:
            dec = b64_decode_maybe(m.group(2))
            if dec:
                return dec
    if site.get("resolver") == "clk-base64":
        m = re.search(r"[?&]url=([A-Za-z0-9_\-+=]+)", href)
        if m:
            dec = b64_decode_maybe(m.group(1))
            if dec and dec.startswith("http"):
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


def anchor_links(html: str, link_pat: str | None) -> list[tuple[str, str]]:
    """(href, visible text) pairs for anchors whose href contains link_pat
    (None = no filter)."""
    out = []
    for href, inner in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', html, re.I):
        if link_pat is not None and link_pat.lower() not in href.lower():
            continue
        out.append((href, get_text(inner)))
    return out


def href_matches(pat: str | None, href: str) -> bool:
    if not pat:
        return True
    if "|" in pat or pat.startswith("^"):
        return re.search(pat, href, re.I) is not None
    return pat.lower() in href.lower()


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


def fetch_post(session, url: str, site: dict) -> tuple[str, list[str]]:
    """Fetch a post page; returns (html, extra_links). Extra links are minted
    per-page via a browser step (e.g. the AnkerGames signed-download flow)."""
    held: list[str] = []
    if site.get("resolver") == "anker-mint":
        def action(page):
            try:
                token = page.evaluate(
                    "(document.querySelector('meta[name=csrf-token]')||{}).content||''"
                )
                if not token:
                    return
                ids = sorted(set(re.findall(r"generateDownloadUrl\((\d+)\)", page.content())))
                for dlid in ids:
                    js = (
                        "(async()=>{try{const t=document.querySelector('meta[name=csrf-token]').content;"
                        f"const r=await fetch('/generate-download-url/{dlid}',{{method:'POST',headers:{{'X-CSRF-TOKEN':t,'X-Requested-With':'XMLHttpRequest','Accept':'application/json'}}}});"
                        "return r.status+'$$'+(await r.text());}catch(e){return 'ERR$$'+String(e);}})()"
                    )
                    try:
                        out = page.evaluate(js)
                    except Exception:
                        continue
                    status, _, body = out.partition("$$")
                    if status == "200":
                        try:
                            dl = json.loads(body).get("download_url")
                            if dl:
                                held.append(dl)
                        except Exception:
                            pass
            except Exception:
                pass
        page = session.fetch(url, google_search=False, timeout=90000, page_action=action)
        try:
            return page.body.decode("utf-8"), held
        except UnicodeDecodeError:
            return page.body.decode("latin-1", "replace"), held
    return fetch_text(session, url), []


def post_links(html: str, site: dict) -> list[tuple[str, str, str | None]]:
    """(url, label, size) pairs for one post page, per the site's link strategy."""
    link_pat = site.get("linkPattern")
    out: list[tuple[str, str, str | None]] = []
    seen: set[str] = set()

    frm = site.get("linkSectionFrom")
    to = site.get("linkSectionTo")
    if frm and to and frm in html and to in html and html.find(frm) < html.find(to):
        html = html[html.find(frm):html.find(to)]

    if site.get("resolver") == "anker-mint":
        return []

    if site.get("resolver") == "glitch-seal":
        for url, label, size in glitch_seal_links(html):
            if url in seen:
                continue
            seen.add(url)
            out.append((url, label, size))
        return out

    if site.get("linkSource") == "text":
        for url, label, size in text_links(html, link_pat):
            if url in seen:
                continue
            seen.add(url)
            out.append((url, link_label(site, url, label), size))
        return out

    for h, label in anchor_links(html, None):
        h = _html.unescape(h)
        if not href_matches(link_pat, h):
            continue
        if h.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        if any(p in h for p in (site.get("linkSkipPatterns") or [])):
            continue
        resolved = resolve_href(site, h)
        if resolved.startswith("//"):
            resolved = "https:" + resolved
        if resolved in seen:
            continue
        seen.add(resolved)
        out.append((resolved, link_label(site, resolved, label), None))
    return out


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
                if u == base or u.rstrip("/") == site["home"].rstrip("/"):
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
                if url.startswith("magnet:"):
                    title, msize = magnet_parts(url)
                    if strip_re:
                        title = re.sub(strip_re, "", title, flags=re.I).strip()
                    part = None
                    links = [(url, "Magnet", msize)]
                else:
                    title = direct_title(anchor_text, strip_re, strip_nums, size_pat)
                    msize = extract_size(anchor_text, size_pat)
                    part = part_from_anchor_text(anchor_text, part_label_pat)
                    links = [(url, None, None)]
                if not title:
                    continue
                uris = [uri(label, url, part) for label, _, _ in links]
                size = msize or extract_size(anchor_text, size_pat)
            else:
                url, anchor_text = item
                try:
                    html, extra = fetch_post(session, url, site)
                except Exception:
                    continue
                title = default_title(html, strip_re, site.get("titleSource"))
                if not title:
                    continue
                links = post_links(html, site)
                for u in extra:
                    links.append((u, "AnkerGames", None))
                if not links:
                    continue
                size = extract_size(html, size_pat) or extract_size(anchor_text, size_pat)
                uris = []
                for h, label, lsize in links:
                    part = part_from_anchor_text(label, part_label_pat) or part_label(h, part_pat)
                    uris.append(uri(label, h, part))
                    if not size and lsize:
                        size = lsize
                delay = site.get("interPostDelay")
                if delay:
                    time.sleep(delay)
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