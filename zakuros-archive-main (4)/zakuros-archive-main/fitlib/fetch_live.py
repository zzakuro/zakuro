"""Manual one-off: fetch all Cloudflare-gated live source feeds via Scrapling.

Reads ../data/sources.json, fetches every enabled source hosted on a CF-gated
host (hydralinks.cloud / davidkazumisource.com) using a single StealthySession
with solve_cloudflare=True (cookies reused across fetches), and writes the raw
JSON to ../data/live/<slug>.json.

Not wired into the server -- run manually to refresh the live copies.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
LIVE_DIR = DATA / "live"
CONFIG = DATA / "sources.json"

CF_HOSTS = ("hydralinks.cloud", "davidkazumisource.com")


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main() -> None:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    targets = [
        s
        for s in config
        if s.get("enabled") and s.get("url") and any(h in s["url"] for h in CF_HOSTS)
    ]
    if not targets:
        print("no CF-gated targets found in sources.json")
        return

    LIVE_DIR.mkdir(parents=True, exist_ok=True)

    from scrapling.fetchers import StealthySession

    print(f"fetching {len(targets)} feeds with one stealth session...\n")
    ok = fail = 0
    with StealthySession(headless=True, solve_cloudflare=True) as session:
        for s in targets:
            name, url = s["name"], s["url"]
            out = LIVE_DIR / f"{slug(name)}.json"
            try:
                page = session.fetch(url, google_search=False, timeout=90000)
                if page.status >= 400 or len(page.body) < 16:
                    print(f"  FAIL {name:<22} status={page.status} bytes={len(page.body)}")
                    fail += 1
                    continue
                out.write_bytes(page.body)
                print(f"  OK   {name:<22} status={page.status} bytes={len(page.body):>9} -> {out.name}")
                ok += 1
            except Exception as e:  # noqa: BLE001
                print(f"  ERR  {name:<22} {e}")
                fail += 1
    print(f"\ndone: {ok} ok, {fail} failed")

    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()