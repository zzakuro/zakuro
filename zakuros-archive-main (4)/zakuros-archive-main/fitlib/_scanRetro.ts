import { readGames } from "./server/catalogIO";
import { normalizeForMatch } from "./server/sources";
import type { Game } from "./src/types";

const CONSOLE_GENRES = new Set([
  "PS1", "PSX", "PS2", "PS3", "PSP", "PS Vita", "N64", "SNES", "NES",
  "GB", "GBC", "GBA", "DS", "3DS", "GameCube", "Wii", "Wii U", "Switch",
  "Dreamcast", "Saturn", "Mega Drive", "Genesis", "PCE", "MSX", "Xbox",
  "Xbox 360",
]);

function eraOf(g: Game): "retro" | "modern" | "unknown" {
  const genres = (g.genres || []).map((x) => x.toLowerCase());
  const hasConsole = genres.some((x) => CONSOLE_GENRES.has(x) || x === "classic" || x === "retro");
  const hasPC = typeof g.steamId === "number" || genres.includes("pc game");
  if (g.classic) return hasPC ? "unknown" : "retro";
  if (hasPC && !hasConsole) return "modern";
  if (hasConsole && !hasPC) return "retro";
  if (hasConsole && hasPC) return "unknown";
  if (!hasPC && !hasConsole) return "modern";
  return "unknown";
}

const games = readGames<Game>();
const byNorm = new Map<string, Game[]>();
for (const g of games) {
  const norm = normalizeForMatch(g.title || "");
  if (!norm) continue;
  const arr = byNorm.get(norm) ?? [];
  arr.push(g);
  byNorm.set(norm, arr);
}

let dualEra = 0;
let retroOnly = 0;
let modernOnly = 0;
let unknownMixed = 0;
let single = 0;
const samples: string[] = [];
for (const [norm, rows] of byNorm) {
  if (rows.length === 1) { single++; continue; }
  const eras = rows.map(eraOf);
  const hasRetro = eras.includes("retro");
  const hasModern = eras.includes("modern");
  const hasUnknown = eras.includes("unknown");
  if (hasRetro && hasModern) { dualEra++; samples.push(`[DUAL] ${norm} :: ${rows.map((r) => `${r.id} {classic=${!!r.classic}, steam=${r.steamId ?? "-"}, era=${eraOf(r)}${r.classic ? "" : ", year=" + (r.releaseDate || "?")}}`).join(" | ")}`); }
  else if (hasRetro) retroOnly++;
  else if (hasModern) modernOnly++;
  else unknownMixed++;
}

console.log(`total games: ${games.length}`);
console.log(`normalized titles: ${byNorm.size}`);
console.log(`single-row titles: ${single}`);
console.log(`multi-row collision groups: ${byNorm.size - single}`);
console.log(`  dual-era (retro + modern same name): ${dualEra}`);
console.log(`  retro-only collisions: ${retroOnly}`);
console.log(`  modern-only collisions: ${modernOnly}`);
console.log(`  unknown/mixed eras: ${unknownMixed}`);
console.log("");
console.log("=== DUAL-ERA SAMPLES ===");
for (const s of samples.slice(0, 40)) console.log(s);