import { readGames } from "./catalogIO";
import { titlesLookLikeSameGame } from "./sources";
import { Game } from "../src/types";

const games = readGames<Game>();

// Remaining shared-appid groups
const bySteam = new Map<number, Game[]>();
for (const g of games) { if (g.steamId == null) continue; const a = bySteam.get(g.steamId); if (a) a.push(g); else bySteam.set(g.steamId, [g]); }
console.log("=== remaining shared-appid groups (dissimilar) ===");
let n = 0;
for (const [steamId, group] of bySteam) {
  if (group.length < 2) continue;
  const titles = group.map((g) => g.title);
  let distinct = false;
  for (let i = 0; i < titles.length && !distinct; i++)
    for (let j = i + 1; j < titles.length; j++)
      if (!titlesLookLikeSameGame(titles[i], titles[j])) { distinct = true; break; }
  if (!distinct) continue;
  n++;
  for (const g of group) console.log(`  ${steamId} | ${g.classic ? "C" : "M"} ${g.title.slice(0, 70)} · date=${g.releaseDate}`);
}
console.log(`count: ${n}`);

// Classic rows: date plausibility per console generation end (last commercial releases)
const ERA_END: Record<string, number> = {
  PS1: 2004, PSX: 2004, PS2: 2013, NES: 1995, SNES: 1999, "Mega Drive": 1998, Genesis: 1998,
  Game Gear: 1997, GB: 2001, GBC: 2001, GBA: 2011, "Neo Geo": 2004, Saturn: 1998,
  Dreamcast: 2002, PCE: 1995, MSX: 1995, DS: 2014, PSP: 2015, GameCube: 2008, Xbox: 2009, N64: 2003, "PC Engine": 1995,
};
function platformOf(g: Game): string | undefined {
  const candidates = [g.eraPlatform, ...(g.genres || [])];
  for (const c of candidates) if (c && ERA_END[c]) return c;
  return undefined;
}
let odd = 0;
const oddRows: { title: string; plat: string; date: string }[] = [];
for (const g of games) {
  if (!g.classic) continue;
  const plat = platformOf(g);
  const y = Number((g.releaseDate || "").match(/\d{4}/)?.[0]);
  if (plat && Number.isFinite(y) && y > ERA_END[plat] + 3) {
    odd++;
    if (oddRows.length < 12) oddRows.push({ title: g.title, plat, date: g.releaseDate || "" });
  }
}
console.log(`\n=== classic rows dated >${"era end +3y"} (upload-date leaks): ${odd} ===`);
for (const r of oddRows) console.log(`  [${r.plat}] ${r.title.slice(0, 60)} · ${r.date}`);
const classicTotal = games.filter((g) => g.classic).length;
const classicWithOldDate = games.filter((g) => g.classic && /(19|20)\d{2}/.test(g.releaseDate || "")).length;
console.log(`classic total ${classicTotal} · with a 4-digit year ${classicWithOldDate}`);