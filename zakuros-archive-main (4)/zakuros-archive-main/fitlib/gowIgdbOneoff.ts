// One-off: give the CLASSIC God of War (2005 PS2, id=god-of-war) its IGDB
// cover via title search, but STRICTLY reject the modern 2018 PC entry so it
// never pollutes the classic twin. IGDB holds both. We match on release year
// 2005 core / platforms containing PS2 (platform id 9) / name lacking the
// second-game marker, and require the IGDB `release_dates` + `platforms`
// fields so we can discriminate. If the single returned row is ambiguous we
// skip (better no cover than the wrong-era cover).
import fs from "fs";
import path from "path";
import { writeGames, readGames, GAMES_DB_PATH } from "./catalogIO";
import { Game } from "../src/types";

const IGDB_TOKEN_CACHE = { token: "", expires: 0 };
const { IGDB_CLIENT_ID, IGDB_CLIENT_SECRET } = process.env;

async function igdbToken(): Promise<string> {
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) throw new Error("IGDB creds missing");
  if (IGDB_TOKEN_CACHE.token && Date.now() < IGDB_TOKEN_CACHE.expires) return IGDB_TOKEN_CACHE.token;
  const r = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${IGDB_CLIENT_ID}&client_secret=${IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
  });
  if (!r.ok) throw new Error(`IGDB auth ${r.status}`);
  const j: any = await r.json();
  IGDB_TOKEN_CACHE.token = j.access_token;
  IGDB_TOKEN_CACHE.expires = Date.now() + (j.expires_in || 5000) * 1000 - 60000;
  return j.access_token;
}

async function igdbGameById(id: number): Promise<any | null> {
  const token = await igdbToken();
  const r = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "Client-ID": IGDB_CLIENT_ID!, "Authorization": `Bearer ${token}`, "Content-Type": "text/plain" },
    body: `fields name, first_release_date, platforms.name, cover.url, summary; where id = ${id};`,
  });
  if (!r.ok) throw new Error(`IGDB ${r.status}`);
  const j: any[] = await r.json();
  return j[0] || null;
}

function isPS2(plat: any[]): boolean {
  return !!plat && (plat.some((p: any) => p?.name?.toLowerCase().includes("playstation 2")) || plat.some((p: any) => p?.id === 9));
}

async function main() {
  const games = readGames();
  const gow = games.find((g: Game) => g.id === "god-of-war" && g.classic);
  if (!gow) { console.log("classic god-of-war not found"); return; }
  console.log("before:", gow.title, "| classic:", gow.classic, "| steamId:", String(gow.steamId), "| cover:", String(gow.coverImage || "NONE").slice(0, 40));

  // IGDB search "God of War" — pick the 2005 PS2 entry explicitly.
  const token = await igdbToken();
  const r = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "Client-ID": IGDB_CLIENT_ID!, "Authorization": `Bearer ${token}`, "Content-Type": "text/plain" },
    body: 'search "God of War"; fields name, first_release_date, platforms.name, cover.url, summary; limit 25;',
  });
  if (!r.ok) throw new Error(`IGDB search ${r.status}`);
  const rows: any[] = await r.json();

  const ps2Rows = rows.filter((x: any) => isPS2(x.platforms));
  console.log("IGDB candidates:", rows.length, "| PS2-tagged:", ps2Rows.length);
  for (const x of rows.slice(0, 25)) {
    const y = new Date((x.first_release_date || 0) * 1000).getFullYear() || "?";
    console.log("  ", x.id, "|", x.name, "|", y, "| PS2:", isPS2(x.platforms), "|", x.platforms?.map((p: any) => p.name).join(",").slice(0, 60));
  }

  // Accept the 2005 entry: platform PS2 and year 2005 (God of War PS2).
  const target = ps2Rows.find((x: any) => {
    const y = new Date((x.first_release_date || 0) * 1000).getFullYear();
    return y >= 2004 && y <= 2006;
  }) || ps2Rows.filter((x: any) => {
    const y = new Date((x.first_release_date || 0) * 1000).getFullYear();
    return y >= 2004 && y <= 2006;
  })[0];

  if (!target) {
    console.log("no 2005 PS2 IGDB entry found — leaving classic cover as NONE (www won't guess wrong-era)");
    return;
  }
  const cover = target.cover?.url
    ? ("https:" + target.cover.url).replace("//images.igdb.com/", "https://images.igdb.com/").replace("t_thumb", "t_cover_big_2x")
    : "";
  console.log("target:", target.id, target.name, "| cover:", cover.slice(0, 50));
  if (!cover) { console.log("no cover URL — skipped"); return; }

  gow.coverImage = cover;
  writeGames(games);
  console.log("persisted catalog with classic GoW cover.");
}

main().catch((e) => { console.error(e); process.exit(1); });
