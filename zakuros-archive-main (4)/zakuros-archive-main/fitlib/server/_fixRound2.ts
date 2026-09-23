import { readGames, writeGames } from "./catalogIO";
import { Game } from "../src/types";

const games = readGames<Game>();

// ── 1. Garbage appid batches: one phantom appid shared by many unrelated games
//       (wrong app's date carried in too). ──────────────────────────────────────
const BATCH_CLEAR_DATE = new Set<number>([2562060, 2565140]); // date came from the wrong app
const BATCH_CLEAR_ID = new Set<number>([4566690, 4151970, 2562060, 2565140, 371550]);
// 371550: only the "A Knight's Tale" row (the earlier fix missed it via apostrophe)
const ONLY_TITLE = new Map<number, string>([[371550, "a knight s tale"]]);

let steamCleared = 0, datesCleared = 0;
for (const g of games) {
  const sid = g.steamId;
  if (sid == null) continue;
  const only = ONLY_TITLE.get(sid);
  const inBatch = BATCH_CLEAR_ID.has(sid) && (only ? only === g.title.toLowerCase() : true);
  if (!inBatch) continue;
  delete g.steamId;
  steamCleared++;
  if (BATCH_CLEAR_DATE.has(sid) || ONLY_TITLE.has(sid)) {
    delete g.releaseDate;
    datesCleared++;
  }
}
console.log(`batch wrong appids cleared: ${steamCleared} (dates cleared: ${datesCleared})`);

// ── 2. A Knight's Tale junk date ("0.36 SE") ─────────────────────────────────
for (const g of games) {
  if (g.title === "A Knight's Tale" && /^\d/.test(g.releaseDate || "") && !/^\d{4}/.test(g.releaseDate || "")) {
    delete g.releaseDate;
    datesCleared++;
  }
}

// ── 3. Classic console rows dated beyond their platform's commercial lifetime
//       (archive-upload year masquerading as a release date). ─────────────────
const ERA_END: Record<string, number> = {
  PS1: 2004, PSX: 2004, PS2: 2013, NES: 1995, SNES: 1999, "Mega Drive": 1998, Genesis: 1998,
  "Game Gear": 1997, GB: 2001, GBC: 2001, GBA: 2011, "Neo Geo": 2004, Saturn: 1998,
  Dreamcast: 2002, PCE: 1995, "PC Engine": 1995, MSX: 1995, DS: 2014, PSP: 2015,
  GameCube: 2008, Xbox: 2009, N64: 2003,
};
function platformOf(g: Game): string | undefined {
  for (const c of [g.eraPlatform, ...(g.genres || [])]) if (c && ERA_END[c]) return c;
  return undefined;
}
let implausible = 0;
for (const g of games) {
  if (!g.classic) continue;
  const plat = platformOf(g);
  const y = Number((g.releaseDate || "").match(/\d{4}/)?.[0]);
  if (plat && Number.isFinite(y) && y > ERA_END[plat] + 3) {
    delete g.releaseDate;
    implausible++;
  }
}
console.log(`classic rows with implausible (upload-era) dates cleared: ${implausible}`);

writeGames(games);