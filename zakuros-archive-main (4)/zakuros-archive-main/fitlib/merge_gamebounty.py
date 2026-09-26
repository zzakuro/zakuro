"""Merge the BITO21 GameBounty JSON backup into data/scraped/gamebounty.json.

Complements the live gamebounty.world crawl: the backup is the same catalog
with a different mirror mix (datanodes.to / rootz.so links the crawl does not
see, plus games the crawl misses). Merging is additive and idempotent -- it
only ever adds games/links, never removes what the crawl found.

Safe to run on a schedule: if the fetch fails the local file is left untouched
(write happens only after a successful parse).

Usage:
    python merge_gamebounty.py            # merge + report
    python merge_gamebounty.py --quiet    # for scheduled runs
"""

import gzip
import json
import pathlib
import re
import sys
import urllib.request
from urllib.parse import urlparse

FITLIB = pathlib.Path(__file__).resolve().parent
SCRAPED = FITLIB / "data" / "scraped"
TARGET = SCRAPED / "gamebounty.json"
BACKUP_URL = "https://raw.githubusercontent.com/BITO21/BITO_sources/refs/heads/master/GameBounty.json"

WB = re.compile(r"^https?://web\.archive\.org/web/\d+[a-z_]*/", re.I)
# Host suffixes that are just CDN mirrors of one another.
MIRROR_ALIASES = {"fileditchfiles.st": "fileditchfiles", "fileditchfiles.me": "fileditchfiles"}


def dewayback(u: str) -> str:
    return WB.sub("", u or "").strip()


def base_title(t: str) -> str:
    t = (t or "").lower()
    t = re.sub(r"\((?:[^)]*)\)", " ", t)
    t = re.sub(r"\b(build|repack|free|download|pc|version|v\d+|update|multi\d*|gog|steam)\b", " ", t)
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def link_key(url: str) -> str:
    """Dedupe key: two links to the same path on mirrored hosts collapse."""
    u = dewayback(url)
    host = urlparse(u).netloc.lower()
    return MIRROR_ALIASES.get(host, host) + "|" + (urlparse(u).path or u)


def fetch_backup() -> dict:
    req = urllib.request.Request(BACKUP_URL, headers={"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read()
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return json.loads(body.decode("utf-8", "replace"))


def main() -> int:
    quiet = "--quiet" in sys.argv
    say = (lambda *a: None) if quiet else print

    payload = json.loads(TARGET.read_text(encoding="utf-8")) if TARGET.exists() else {"name": "GameBounty", "downloads": []}
    downloads = payload.get("downloads", [])

    backup = fetch_backup()  # network failure -> abort before any write
    entries = backup.get("downloads", [])
    say(f"backup: {len(entries)} entries | local before: {len(downloads)}")

    by_title: dict[str, list[int]] = {}
    for i, e in enumerate(downloads):
        by_title.setdefault(base_title(e.get("title", "")), []).append(i)

    added_games = added_links = dup_links = mirror_dupes = 0

    def attach(idx: int, links: list[str], size=None, date=None):
        nonlocal added_links, dup_links, mirror_dupes
        target = downloads[idx]
        existing = {u.get("url") for u in target.get("uris") or []}
        seen_keys = {link_key(u.get("url", "")) for u in target.get("uris") or []}
        for u in links:
            u = dewayback(u)
            if not u or u in existing:
                dup_links += 1
                continue
            k = link_key(u)
            if k in seen_keys:
                mirror_dupes += 1
                continue
            seen_keys.add(k)
            existing.add(u)
            target.setdefault("uris", []).append({"url": u, "name": "Magnet" if u.startswith("magnet:") else None})
            added_links += 1
        if not target.get("fileSize") and size:
            target["fileSize"] = size
        if not target.get("uploadDate") and date:
            target["uploadDate"] = date

    for e in entries:
        title = (e.get("title") or "").strip()
        links = [u for u in (e.get("uris") or []) if isinstance(u, str) and u.strip()]
        if not title or not links:
            continue
        key = base_title(title)
        hits = by_title.get(key)
        if hits:
            attach(hits[0], links, e.get("fileSize"), e.get("uploadDate"))
        else:
            downloads.append(
                {
                    "title": title,
                    "fileSize": e.get("fileSize") or None,
                    "uploadDate": e.get("uploadDate") or None,
                    "uris": [{"url": dewayback(u), "name": "Magnet" if u.startswith("magnet:") else None} for u in links],
                    "srcUrl": "gamebounty.world",
                }
            )
            by_title.setdefault(key, []).append(len(downloads) - 1)
            added_games += 1

    payload["name"] = payload.get("name") or "GameBounty"
    payload["downloads"] = downloads
    payload.pop("partial", None)
    SCRAPED.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    total_links = sum(len(d.get("uris") or []) for d in downloads)
    say(f"merged: +{added_games} games, +{added_links} new links ({dup_links} exact dupes, {mirror_dupes} mirror dupes collapsed)")
    say(f"gamebounty now: {len(downloads)} games / {total_links} links")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())