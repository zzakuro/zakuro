#!/usr/bin/env python3
"""Build a hydralinks-style source file (data/local/gog-games.json) from a
gog-games.to MariaDB dump (gog-games.to-database.sql).

The dump is a mysqldump-style text file of 5 tables (files, games, hosters,
jobs, links). This script streams the SQL, extracts the games that actually
have downloadable content (at least one `links` row or a torrent infohash), and
writes one downloads[] entry per game carrying:

  - gogId    the gog-games.to / GOG product id (games.id)
  - gogUrl   the official gog.com store page (games.gog_url)
  - slug     gog-games.to slug
  - genres   GOG genre tags
  - rating   GOG 0-5 rating scaled to 0-100
  - infohash / torrent name for magnet links
  - uris     every download link (game/goodie/patch across all hosters),
             each with its label so the site can name mirrors properly, and a
             kind field ("game" | "patch" | "goodie") mirroring the dump's
             links.type column so the UI can split installers vs patches/fixes
             vs extra goodies

Regenerate with:
    python build_gog_games.py
"""

import re
import sys
import json
import os
import math

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SQL = os.path.join(os.path.dirname(SCRIPT_DIR), "..", "..", "gog-games.to-database.sql")
DEFAULT_SQL = os.path.abspath(DEFAULT_SQL)
DEFAULT_OUT = os.path.join(SCRIPT_DIR, "data", "local", "gog-games.json")

# Column order from the dump's CREATE TABLE statements.
GAMES_COLS = [
    "id", "slug", "title", "developer", "publisher",
    "views_all_time", "views_monthly", "views_weekly", "popularity_ranking",
    "release_timestamp", "genres", "tags", "rating", "age_rating_18",
    "release_date", "image", "background", "gog_url", "md5_filename",
    "torrent_filename", "torrent_size", "torrent_date", "is_indev",
    "is_outdated", "outdated_date", "current_version", "outdated_reason",
    "skip_version", "gog_version", "last_checked_gog_version",
    "gog_installer_size", "is_mod", "is_new", "is_updated", "is_queued",
    "is_uploading", "voted_on", "vote_counts", "last_upload", "last_update",
    "hidden", "created_at", "updated_at", "infohash",
]
LINKS_COLS = [
    "id", "link", "label", "type", "game_id", "hoster_id",
    "is_hidden", "created_at", "updated_at",
]
HOSTERS_COLS = ["id", "name", "order_column", "is_active", "created_at", "updated_at"]
FILES_COLS = ["id", "type", "name", "game_id", "size", "created_at", "updated_at"]

TABLE_COLS = {
    "games": GAMES_COLS,
    "links": LINKS_COLS,
    "hosters": HOSTERS_COLS,
    "files": FILES_COLS,
}

INSERT_RE = re.compile(r"INSERT INTO `(\w+)` VALUES")


def mysql_unescape(raw: str) -> str:
    out = []
    i = 0
    n = len(raw)
    while i < n:
        c = raw[i]
        if c == "\\" and i + 1 < n:
            nxt = raw[i + 1]
            mapping = {
                "0": "\0", "n": "\n", "r": "\r", "t": "\t", "Z": "\x1a",
                "b": "\b", "f": "\f", "'": "'", '"': '"', "\\": "\\",
            }
            out.append(mapping.get(nxt, nxt))
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


class SqlParser:
    """Extract tuples of SQL string/number/NULL literals from VALUES blocks."""

    def __init__(self, text: str):
        self.text = text
        self.pos = 0
        self.n = len(text)

    def _skip_ws(self):
        while self.pos < self.n and self.text[self.pos].isspace():
            self.pos += 1

    def _read_string(self):
        # text[self.pos] == "'"
        self.pos += 1
        out = []
        while self.pos < self.n:
            c = self.text[self.pos]
            if c == "\\":
                if self.pos + 1 < self.n:
                    out.append(self.text[self.pos : self.pos + 2])
                    self.pos += 2
                    continue
            if c == "'":
                # '' is an escaped quote inside the literal
                if self.pos + 1 < self.n and self.text[self.pos + 1] == "'":
                    out.append("''")
                    self.pos += 2
                    continue
                self.pos += 1
                return mysql_unescape("".join(out))
            out.append(c)
            self.pos += 1
        return mysql_unescape("".join(out))

    def _read_value(self):
        self._skip_ws()
        if self.pos >= self.n:
            return None
        c = self.text[self.pos]
        if c == "'":
            return self._read_string()
        # bare token: number, NULL, or keyword. read until , ) or whitespace
        start = self.pos
        while self.pos < self.n and self.text[self.pos] not in ",)":
            c = self.text[self.pos]
            if c.isspace():
                break
            self.pos += 1
        tok = self.text[start : self.pos]
        return tok

    def parse(self):
        """Parse tuples starting right after `VALUES` until the statement `;`."""
        rows = []
        self._skip_ws()
        while self.pos < self.n:
            c = self.text[self.pos]
            if c == ";":
                self.pos += 1
                break
            if c == "(":
                self.pos += 1
                row = []
                while self.pos < self.n:
                    self._skip_ws()
                    cur = self.text[self.pos]
                    if cur == ")":
                        self.pos += 1
                        # allow '), (' rows
                        break
                    val = self._read_value()
                    row.append(val)
                    self._skip_ws()
                    if self.pos < self.n and self.text[self.pos] == ",":
                        self.pos += 1
                rows.append(row)
                continue
            # stray char (usually ',' between tuples) — skip
            self.pos += 1
        return rows


def human_size(num: int) -> str:
    if not num or num <= 0:
        return ""
    num = float(num)
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if num < 1024 or unit == "TB":
            if unit == "B":
                return f"{int(num)} B"
            if unit == "KB":
                return f"{num:.1f} {unit}"
            return f"{num:.1f} {unit}"
        num /= 1024
    return f"{num:.1f} TB"


def parse_json_list(raw):
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    if not isinstance(raw, str):
        return []
    try:
        data = json.loads(raw)
    except Exception:
        return []
    return data if isinstance(data, list) else []


def magnet_from_infohash(infohash: str, name: str) -> str:
    from urllib.parse import quote
    if not infohash:
        return ""
    infohash = infohash.lower().strip()
    if not re.fullmatch(r"[0-9a-f]{40}", infohash):
        return ""
    trackers = [
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.demonii.com:1337/announce",
        "udp://tracker.openbittorrent.com:6969/announce",
        "udp://tracker.torrent.eu.org:451/announce",
    ]
    params = [f"xt=urn:btih:{infohash}"]
    if name:
        params.append(f"dn={quote(name)}")
    for tr in trackers:
        params.append(f"tr={quote(tr)}")
    return "magnet:?" + "&".join(params)


def parse_sql(sql_path: str):
    hosters = {}
    games = {}
    files_by_game = {}
    links_by_game = {}

    with open(sql_path, "r", encoding="utf-8", errors="replace") as fh:
        content = fh.read()

    for match in INSERT_RE.finditer(content):
        table = match.group(1)
        cols = TABLE_COLS.get(table)
        if not cols or table == "jobs":
            continue
        parser = SqlParser(content[match.end() :])
        for row in parser.parse():
            if not row:
                continue
            # convert NULL tokens to None
            rec = {}
            for idx, col in enumerate(cols):
                raw = row[idx] if idx < len(row) else None
                if raw is None:
                    rec[col] = None
                elif isinstance(raw, str):
                    rec[col] = None if raw.upper() == "NULL" else raw
                else:
                    rec[col] = raw
            if table == "hosters":
                hosters[rec["id"]] = rec.get("name") or rec["id"]
            elif table == "games":
                games[rec["id"]] = rec
            elif table == "files":
                files_by_game.setdefault(rec["game_id"], []).append(rec)
            elif table == "links":
                links_by_game.setdefault(rec["game_id"], []).append(rec)

    return hosters, games, files_by_game, links_by_game


def build_source(hosters, games, files_by_game, links_by_game):
    downloads = []
    skipped = {"no_content": 0, "no_title": 0}

    for gid, rec in games.items():
        title = (rec.get("title") or "").strip()
        if not title:
            skipped["no_title"] += 1
            continue

        links = links_by_game.get(gid) or []
        infohash = rec.get("infohash") or ""
        torrent_name = rec.get("torrent_filename") or ""
        has_link = any(l.get("link") for l in links)
        if not has_link and not infohash:
            skipped["no_content"] += 1
            continue

        uris = []
        seen = set()
        for link in links:
            url = (link.get("link") or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            label = (link.get("label") or "").strip()
            hoster = hosters.get(link.get("hoster_id")) or link.get("hoster_id") or "Mirror"
            name = label + f" · {hoster}" if label else hoster
            kind = (link.get("type") or "").strip().lower()
            uris.append({
                "url": url,
                "name": name,
                "type": "direct",
                "kind": kind if kind in ("game", "patch", "goodie") else "game",
            })

        if infohash or torrent_name:
            magnet = magnet_from_infohash(infohash, torrent_name)
            if magnet:
                if not uris:
                    # display name fallback for torrent-only games
                    uris.append({
                        "url": magnet,
                        "name": f"{torrent_name} · Torrent" if torrent_name else "GOG Torrent",
                        "type": "torrent",
                        "kind": "game",
                    })
                else:
                    uris.append({
                        "url": magnet,
                        "name": f"{torrent_name} · Torrent" if torrent_name else "GOG Torrent",
                        "type": "torrent",
                        "kind": "game",
                    })

        # file size: prefer the GOG installer size, else the torrent size
        installer_size = rec.get("gog_installer_size")
        torrent_size = rec.get("torrent_size")
        size_bytes = None
        for cand in (installer_size, torrent_size):
            if cand:
                try:
                    v = int(cand)
                    if v > 0:
                        size_bytes = v
                        break
                except (TypeError, ValueError):
                    continue

        upload_date = ""
        for cand in (rec.get("last_upload"), rec.get("last_update"), rec.get("updated_at")):
            if cand:
                upload_date = str(cand)[:10]
                break

        genres = parse_json_list(rec.get("genres"))

        rating = 0
        try:
            gog_rating = float(rec.get("rating"))
            rating = int(round(gog_rating * 20)) if gog_rating else 0
        except (TypeError, ValueError):
            pass

        entry = {
            "title": title,
            "uris": uris,
            "uploadDate": upload_date,
            "fileSize": human_size(size_bytes) if size_bytes else "",
            "platform": "windows",
            "gogId": gid,
            "gogUrl": rec.get("gog_url") or "",
            "slug": rec.get("slug") or "",
            "developer": rec.get("developer") or "",
            "publisher": rec.get("publisher") or "",
            "genres": genres,
            "rating": rating,
            "releaseDate": str(rec.get("release_date") or "")[:10] or "",
            "infohash": infohash or "",
        }
        downloads.append(entry)

    return downloads, skipped


def main():
    sql_path = DEFAULT_SQL
    out_path = DEFAULT_OUT
    if len(sys.argv) > 1:
        sql_path = os.path.abspath(sys.argv[1])
    if len(sys.argv) > 2:
        out_path = os.path.abspath(sys.argv[2])

    if not os.path.exists(sql_path):
        print(f"SQL dump not found: {sql_path}")
        sys.exit(1)

    print(f"Parsing {sql_path} …")
    hosters, games, files_by_game, links_by_game = parse_sql(sql_path)
    print(
        f"  hosters={len(hosters)} games={len(games)} "
        f"games_with_files={len(files_by_game)} games_with_links={len(links_by_game)}"
    )

    downloads, skipped = build_source(hosters, games, files_by_game, links_by_game)
    print(
        f"Built {len(downloads)} downloadable game entries "
        f"(skipped: {skipped})"
    )

    payload = {"name": "GOG Games", "downloads": downloads}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    total_links = sum(len(d.get("uris", [])) for d in downloads)
    total_torrents = sum(
        1 for d in downloads if any(u.get("type") == "torrent" for u in d.get("uris", []))
    )
    print(f"Wrote {out_path} ({os.path.getsize(out_path)/1e6:.1f} MB)")
    print(f"  total links: {total_links}, games with magnet torrent: {total_torrents}")


if __name__ == "__main__":
    main()