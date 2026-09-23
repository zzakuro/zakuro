import { readGames, writeGames } from "./catalogIO";
import { Game } from "../src/types";

const games = readGames<Game>();
const norm = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// ── steamId wrong-appid table ─────────────────────────────────────────────────
// key: appid → list of normalized-title patterns to clear steamId from.
// clearFull: also wipe summary/developer/publisher that were carried in from the
// wrong appid's metadata.
const CLEAR_STEAM: { appid: number; match: string; clearFull?: boolean; all?: boolean }[] = [
  { appid: 2824750, match: "", all: true, clearFull: true }, // appid literally named "Collector's Edition" (garbage)
  { appid: 3679080, match: "", all: true, clearFull: true }, // "The Seven Deadly Sins: Origin" ≠ 7 Sins / Seven Enhanced
  { appid: 371550, match: "a knights tale", clearFull: true }, // A Bastard's Tale appid
  { appid: 280040, match: "a wizards curse" }, // A Wizard's Lizard appid
  { appid: 1988360, match: "amazing wildlife", clearFull: true }, // Adventure Trip: London appid
  { appid: 757030, match: "little prince" }, // A Christmas Carol appid
  { appid: 565600, match: "by candlelight" }, // Nutcracker appid
  { appid: 723920, match: "excitements prisoner" }, // Illusionist appid
  { appid: 956380, match: "blade master" }, // Homecoming appid
  { appid: 1273920, match: "winter lily" }, // Ashville appid
  { appid: 2366600, match: "beyond time" }, // Origins appid
  { appid: 2514850, match: "dungeon maid", clearFull: true }, // "Maid Slaves and Golden Dungeon" ≠ Dungeon & Maid
  { appid: 1908720, match: "mod sayan", clearFull: true }, // Half-Life: VR Mod appid
  { appid: 995900, match: "ancient bane" }, // Eclipse appid
  { appid: 995900, match: "death sentence" },
  { appid: 805030, match: "deaths embrace" }, // Salvation appid
  { appid: 887960, match: "", all: true }, // "Mystery Case Files: Rewind" — none of the 4 rows is Rewind
  { appid: 282400, match: "omsi", clearFull: true }, // SuperPower 2 appid
  { appid: 282400, match: "stronghold", clearFull: true },
  { appid: 3590, match: "android" }, // PvZ GOTY appid
  { appid: 322910, match: "gladius", clearFull: true }, // Regicide appid
  { appid: 91320, match: "beat up" }, // WWTBAM appid
  { appid: 2565130, match: "2 linux" }, // Златогорье 2 ≠ base appid
];

let steamCleared = 0;
let fullCleared = 0;
for (const g of games) {
  if (g.steamId == null) continue;
  const hit = CLEAR_STEAM.find(
    (r) => r.appid === g.steamId && (r.all || norm(g.title).includes(r.match))
  );
  if (!hit) continue;
  delete g.steamId;
  steamCleared++;
  if (hit.clearFull) {
    delete g.summary;
    delete g.developer;
    delete g.publisher;
    fullCleared++;
  }
}

// ── classic rows: drop the modern-PC GOG product id (retro leak class) ────────
let classicGogCleared = 0;
for (const g of games) {
  if (g.classic && g.gogId != null) {
    g.gogId = undefined;
    delete g.gogUrl;
    classicGogCleared++;
  }
}

// ── junk releaseDates ─────────────────────────────────────────────────────────
const JUNK_DATES = new Map<string, string>([
  ["Darkest Sex Dungeon: Final Version", "25688"],
  ["The Lustland Adventure", "0034.1"],
  ["Factory Tower", "December 2026"],
]);
let junkDatesFixed = 0;
for (const g of games) {
  if (JUNK_DATES.get(g.title) === g.releaseDate) {
    delete g.releaseDate;
    junkDatesFixed++;
  }
}

console.log(`steamId cleared: ${steamCleared} (${fullCleared} with wrong summary/dev/pub wiped)`);
console.log(`classic gogId cleared: ${classicGogCleared}`);
console.log(`junk dates removed: ${junkDatesFixed}`);

// ── summary of remaining collision state ──────────────────────────────────────
const bySteam = new Map<number, Game[]>();
for (const g of games) { if (g.steamId == null) continue; const a = bySteam.get(g.steamId); if (a) a.push(g); else bySteam.set(g.steamId, [g]); }
let stillColliding = 0;
for (const [, group] of bySteam) {
  if (group.length < 2) continue;
  const titles = group.map((x) => x.title);
  let distinct = false;
  for (let i = 0; i < titles.length && !distinct; i++)
    for (let j = i + 1; j < titles.length; j++) {
      const A = new Set(titles[i].toLowerCase().split(" ").filter((t) => t.length > 2));
      const B = new Set(titles[j].toLowerCase().split(" ").filter((t) => t.length > 2));
      let common = 0;
      for (const t of A) if (B.has(t)) common++;
      const overlap = common / Math.min(A.size, B.size);
      if (overlap < 0.5) { distinct = true; break; }
    }
  if (distinct) stillColliding++;
}
console.log(`remaining dissimilar shared-appid groups: ${stillColliding}`);

writeGames(games);