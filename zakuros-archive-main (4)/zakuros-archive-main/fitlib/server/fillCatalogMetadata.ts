// Grind metadata (summary/developer/releaseDate/rating/screenshots) for every
// game that has a steamId but still lacks a summary. Resumable via a state
// file so you can stop/restart freely. Paced to respect Steam's rate limits.
//
// Usage:
//   npx tsx server/fillCatalogMetadata.ts            # unlimited grind
//   npx tsx server/fillCatalogMetadata.ts --limit 80 # bounded run (verify)
import fs from "fs";
import path from "path";
import { Game } from "../src/types";
import { fetchSteamDetails } from "./metadataService";

const GAMES_DB_PATH = path.join(process.cwd(), "data", "merged_enriched.json");
const STATE_PATH = path.join(process.cwd(), "data", "steam_meta_done.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const argLimit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]);

async function main() {
  const limit = Number.isFinite(argLimit) ? argLimit : Infinity;

const games = JSON.parse(fs.readFileSync(GAMES_DB_PATH, "utf8")) as Game[];
let done: string[] = [];
try {
  done = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) || [];
} catch {
  done = [];
}
const doneSet = new Set(done);

const candidates = games
  .filter(
    (g) =>
      !g.classic &&
      typeof g.steamId === "number" &&
      g.title &&
      (!g.summary || !g.developer || !g.rating || !g.screenshots || g.screenshots.length === 0)
  )
  .filter((g) => !doneSet.has(g.id));

console.log(`[Meta] games: ${games.length} | backlog (missing real metadata, not tried): ${candidates.length}`);

let enriched = 0;
let failed = 0;
let startedAt = Date.now();
let lastSave = Date.now();

for (const game of candidates) {
  if (enriched + failed >= limit) break;
  await sleep(1250);
  try {
    const details = await fetchSteamDetails(game.steamId as number);
    if (details.summary) game.summary = details.summary;
    if (details.releaseDate) game.releaseDate = details.releaseDate;
    if (details.developer) game.developer = details.developer;
    if (details.publisher) game.publisher = details.publisher;
    if (details.rating !== undefined && (game.rating === 0 || !game.rating)) {
      game.rating = details.rating;
    }
    if (
      details.screenshots &&
      details.screenshots.length > 0 &&
      (!game.screenshots || game.screenshots.length === 0)
    ) {
      game.screenshots = details.screenshots;
    }
    if (game.summary) enriched++;
    else failed++;
  } catch (e: any) {
    if (e?.message === "RATE_LIMIT_EXCEEDED") {
      console.warn(`[Meta] Steam rate-limited at "${game.title}"; backing off 45s...`);
      await sleep(45000);
      failed++;
      continue;
    }
    failed++;
  }
  doneSet.add(game.id);
  done.push(game.id);

  if ((enriched + failed) % 20 === 0) {
    const elapsed = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(
      `[Meta] ${enriched + failed}/${candidates.length} | +${enriched} enriched, ${failed} failed | ${elapsed} min`
    );
  }
  if (Date.now() - lastSave > 20000) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(done), "utf8");
    const tmp = `${GAMES_DB_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(games), "utf8");
    fs.renameSync(tmp, GAMES_DB_PATH);
    lastSave = Date.now();
    console.log(`[Meta] progress saved (${done.length} tried)`);
  }
}

fs.writeFileSync(STATE_PATH, JSON.stringify(done), "utf8");
const tmp = `${GAMES_DB_PATH}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(games), "utf8");
fs.renameSync(tmp, GAMES_DB_PATH);

const stillMissing = games.filter(
  (g) =>
    !g.classic &&
    typeof g.steamId === "number" &&
    (!g.summary || !g.developer || !g.rating || !g.screenshots || g.screenshots.length === 0)
).length;
console.log(
  `[Meta] done: +${enriched} enriched, ${failed} failed | tried total: ${done.length} | still missing metadata: ${stillMissing}`
);
console.log(`[Meta] catalog + state saved.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});