// One-off: era-guarded IGDB cover for the CLASSIC God of War (2005 PS2).
// Queries IGDB for "God of War", then only accepts the entry whose
// first_release_date is ~2004-2006 AND whose platforms include PS2 (id 9).
// This is the era guard: it deliberately rejects the 2018 PC entry so the
// classic twin never inherits the modern-era cover. Writes via the same
// catalogIO used everywhere else. Run: npx tsx gowClassicCoverOneoff.ts
import readline from "readline";
import fs from "fs";
import path from "path";
import { readGames, writeGames, GAMES_DB_PATH } from "./server/catalogIO";
import { Game } from "./src/types";

const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID;
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET;

async function igdbToken(): Promise<string | null> {
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) return null;
  const r = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${IGDB_CLIENT_ID}&client_secret=${IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
  });
  if (!r.ok) throw new Error(`IGDB auth ${r.status}`);
  const j: any = await r.json();
  return j.access_token;
}

const PS2_PLATFORM_ID = 9;

function isYearInRange(p: any): boolean {
  const y = p && p.first_release_date ? new Date((p.first_release_date as number) * 1000).getFullYear() : 0;
  return y >= 2004 && y <= 2006;
}

function isPS2(platforms: any[] | undefined): boolean {
  return !!platforms && platforms.some((p) => p && (p.id === PS2_PLATFORM_ID || /playstation 2/i.test(String(p.name || ""))));
}

async function main() {
  const token = await igdbToken();
  if (!token) {
    console.log("IGDB not configured — aborting (no creds).");
    return;
  }
  const games = readGames();
  const gow = games.find((g: Game) => g.id === "god-of-war");
  if (!gow) {
    console.log("classic god-of-war not found in catalog.");
    return;
  }
  console.log(`before: title="${gow.title}" classic=${gow.classic} steamId=${String(gow.steamId)} cover=${String(gow.coverImage || "NONE").slice(0, 45)}`);

  const q = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "Client-ID": IGDB_CLIENT_ID!, Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: `search "God of War"; fields name, first_release_date, platforms.name, platforms.id, cover.url; where platforms = (9) & first_release_date != null; limit 20;`,
  });
  if (!q.ok && q.status !== 403) throw new Error(`IGDB search ${q.status}`);
  if (q.status === 403) {
    console.log("IGDB returned 403 — check IGDB_CLIENT_ID/SECRET / client permissions. Aborting (no write).");
    return;
  }
  const rows: any[] = await q.json();
  console.log("IGDB rows (PS2-era only):", rows.length);
  for (const x of rows.slice(0, 8)) {
    const y = x.first_release_date ? new Date(x.first_release_date * 1000).getFullYear() : "?";
    console.log("  ", x.id, "|", x.name, "|", y, "| PS2:", isPS2(x.platforms));
  }

  const target = rows.find((x) => isYearInRange(x) && isPS2(x.platforms));
  if (!target) {
    console.log("no 2005-era PS2 IGDB entry matched — leaving cover as-is.");
    return;
  }
  const url = target.cover && target.cover.url
    ? ("https:" + target.cover.url).replace("//images.igdb.com/", "https://images.igdb.com/").replace("t_thumb", "t_cover_big_2x")
    : "";
  if (!url) {
    console.log("matched entry has no cover URL — leaving as-is.");
    return;
  }
  console.log(`matched: IGDB#${target.id} ${target.name} -> ${url.slice(0, 60)}`);
  gow.coverImage = url;
  writeGames(games);
  console.log("persisted classic god-of-war cover.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
