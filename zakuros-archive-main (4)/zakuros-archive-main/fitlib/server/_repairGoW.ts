import fs from "fs";
import path from "path";
import { readGames, writeGames } from "./catalogIO";
import { titleMatchScore, normalizeSearchTitle } from "./igdbMatch";

function loadCreds(): { id: string; secret: string } {
  const envPath = path.join(process.cwd(), "..", ".env");
  let id = "", secret = "";
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^IGDB_CLIENT_ID\s*=\s*(.+)$/);
      if (m) id = m[1].trim();
      const s = line.match(/^IGDB_CLIENT_SECRET\s*=\s*(.+)$/);
      if (s) secret = s[1].trim();
    }
  } catch {}
  return { id, secret };
}

async function igdbSearch(title: string, reretro: boolean): Promise<any> {
  const { id, secret } = loadCreds();
  const tok = await (await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`,
    { method: "POST" }
  )).json();
  const res = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "Client-ID": id, Authorization: `Bearer ${tok.access_token}`, "Content-Type": "text/plain" },
    body: `search "${title}"; fields name, summary, rating, first_release_date, cover.url; limit 8;`,
  });
  const raw = await res.json();
  if (!Array.isArray(raw)) {
    console.log("IGDB non-array response status", res.status, ":", JSON.stringify(raw).slice(0, 300));
  }
  const games = ((raw as any[] | undefined) || []).map((g) => ({
    ...g,
    year: typeof g.first_release_date === "number" ? new Date(g.first_release_date * 1000).getUTCFullYear() : undefined,
  }));
  const scored = games.map((g) => ({ g, score: titleMatchScore(title, g.name) })).filter((s) => s.score >= 0.75);
  if (!scored.length) return games;
  let best = scored[0];
  for (const s of scored) {
    if (s.score > best.score) { best = s; continue; }
    if (s.score < best.score) continue;
    if (s.g.year === undefined || best.g.year === undefined) continue;
    if (reretro ? s.g.year < best.g.year : s.g.year > best.g.year) best = s;
  }
  return { chosen: best.g, candidates: scored.map((s) => ({ name: s.g.name, year: s.g.year, score: s.score })) };
}

async function main() {
  const retro = await igdbSearch("God of War", true);
  console.log("RETRO pick:", JSON.stringify(retro.chosen ? { name: retro.chosen.name, year: retro.chosen.year, cover: retro.chosen.cover && retro.chosen.cover.url } : null, null, 2));
  console.log("RETRO candidates:", JSON.stringify(retro.candidates, null, 2));
  console.log("RETRO summary head:", String((retro.chosen && retro.chosen.summary) || "").slice(0, 120));

  const games = readGames<{ id: string }>();
  const g: any = games.find((x: any) => x.id === "god-of-war");
  if (!g) { console.log("row missing"); return; }
  if (retro.chosen) {
    g.summary = retro.chosen.summary || g.summary;
    if (typeof retro.chosen.rating === "number") g.rating = Math.round(retro.chosen.rating);
    if (retro.chosen.year) g.releaseDate = `${retro.chosen.year}-03-22`;
    const keep = ["Classic", "Retro", "PS2", "Action", "Adventure"];
    g.genres = (g.genres || []).filter((x: string) => keep.includes(x));
    g.gogId = undefined;
    g.gogUrl = undefined;
    console.log("patched:", JSON.stringify({ summary: g.summary.slice(0, 60), rating: g.rating, releaseDate: g.releaseDate, genres: g.genres, gogId: g.gogId }));
  } else {
    console.log("NO retro candidate — not patching");
  }
  writeGames(games as any);
  console.log("written");
}

main().catch((e) => { console.error(e); process.exit(1); });