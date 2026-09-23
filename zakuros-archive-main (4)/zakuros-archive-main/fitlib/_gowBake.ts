// One-off (temp): give the CLASSIC God of War (2005 PS2, id=god-of-war) its
// IGDB cover via title search, strictly rejecting the modern 2018 PC entry.
// Mirrors the earlier deleted fitlib/gowClassicCoverOneoff.ts shape (same IGDB
// v4 search + era guard: PS2 platform id 9 + first_release_date ~2004-2006),
// but reads the creds from fitlib/.env at runtime instead of process.env so it
// does not depend on how the process was launched. Writes via catalogIO.
// Run: npx tsx _gowBake.ts [--dry]
import fs from "fs";
import path from "path";
import { readGames, writeGames } from "./server/catalogIO";
import { Game } from "./src/types";

const DRY = process.argv.includes("--dry");
const PS2_PLATFORM_ID = 9;

function loadEnvCreds(): { clientId: string; clientSecret: string } | null {
  const envPath = path.join(process.cwd(), ".env");
  let text: string;
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch {
    return null;
  }
  let clientId = "";
  let clientSecret = "";
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(IGDB_CLIENT_ID|IGDB_CLIENT_SECRET)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (m[1] === "IGDB_CLIENT_ID") clientId = m[2];
    else clientSecret = m[2];
  }
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function isPS2(platforms: any[] | undefined): boolean {
  return (
    !!platforms &&
    platforms.some(
      (p) => p && (p.id === PS2_PLATFORM_ID || /playstation 2/i.test(String(p.name || "")))
    )
  );
}

function isEra2005(p: any): boolean {
  const y = p && p.first_release_date
    ? new Date((p.first_release_date as number) * 1000).getFullYear()
    : 0;
  return y >= 2004 && y <= 2006;
}

async function main() {
  const creds = loadEnvCreds();
  if (!creds) {
    console.log("IGDB creds not present in fitlib/.env — aborting.");
    return;
  }
  const { clientId, clientSecret } = creds;

  const auth = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
  });
  if (!auth.ok) throw new Error(`IGDB auth ${auth.status}`);
  const authJ: any = await auth.json();
  const token = authJ.access_token;
  if (!token) throw new Error("IGDB auth returned no access_token");

  const q = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: 'search "God of War"; fields name, first_release_date, platforms.id, platforms.name, cover.url, summary; limit 25;',
  });
  if (!q.ok) throw new Error(`IGDB search ${q.status}`);
  const rows: any[] = await q.json();

  console.log("IGDB candidates:", rows.length);
  for (const x of rows) {
    const y = x.first_release_date
      ? new Date((x.first_release_date as number) * 1000).getFullYear()
      : "?";
    console.log(
      `  IGDB#${x.id} | ${x.name} | ${y} | PS2:${isPS2(x.platforms) ? "Y" : "N"} | ${(x.platforms || [])
        .map((p: any) => p?.name || p?.id)
        .join(",")
        .slice(0, 60)}`
    );
  }

  const ps2Era = rows.filter((x) => isPS2(x.platforms) && isEra2005(x));
  console.log("PS2 + 2004-2006 matches:", ps2Era.length);
  if (ps2Era.length === 0) {
    console.log("no 2005 PS2 IGDB entry matched — leaving classic cover as-is.");
    return;
  }

  const target = ps2Era[0];
  const cover = target.cover?.url
    ? ("https:" + target.cover.url)
        .replace("//images.igdb.com/", "https://images.igdb.com/")
        .replace("t_thumb", "t_cover_big_2x")
    : "";
  if (!cover) {
    console.log("matched entry has no cover URL — leaving as-is.");
    return;
  }
  console.log(`MATCH: IGDB#${target.id} ${target.name} -> ${cover}`);

  const modern2018 = rows.find(
    (x) =>
      (x.name || "").trim() === "God of War" &&
      x.first_release_date &&
      new Date(x.first_release_date * 1000).getFullYear() === 2018
  );
  console.log(
    modern2018
      ? `REJECTED by era guard: IGDB#${modern2018.id} ${modern2018.name} 2018 (not PS2-era)`
      : "2018 God of War not among top-25 candidates (no reject case to show)."
  );

  const games = readGames();
  const gow = games.find((g: Game) => g.id === "god-of-war" && g.classic);
  if (!gow) {
    console.log("classic god-of-war row not found in catalog — no write.");
    return;
  }
  const gow3 = games.find((g: Game) => g.id === "god-of-war-3");
  const gow3Before = gow3
    ? JSON.stringify({ classic: !!gow3.classic, steamId: gow3.steamId, coverImage: gow3.coverImage })
    : "not found";

  console.log(
    `BEFORE god-of-war: title="${gow.title}" classic=${gow.classic} steamId=${String(gow.steamId)} cover=${String(gow.coverImage || "NONE").slice(0, 45)}`
  );

  if (DRY) {
    console.log("DRY RUN — not persisting.");
    return;
  }

  gow.coverImage = cover;
  if (gow.classic !== true) throw new Error("refusing: god-of-war row is not classic");
  if (typeof gow.steamId === "number") throw new Error("refusing: god-of-war row has a steamId");

  writeGames(games);
  const afterGames = readGames();
  const gowAfter = afterGames.find((g: Game) => g.id === "god-of-war");
  const gow3After = afterGames.find((g: Game) => g.id === "god-of-war-3");
  console.log(
    `AFTER  god-of-war: classic=${gowAfter?.classic} steamId=${String(gowAfter?.steamId)} cover=${String(gowAfter?.coverImage || "NONE").slice(0, 45)}`
  );
  console.log(
    `AFTER  god-of-war-3: unchanged=${gow3Before === (gow3After ? JSON.stringify({ classic: !!gow3After.classic, steamId: gow3After.steamId, coverImage: gow3After.coverImage }) : "not found")}`
  );
  console.log("persisted.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});