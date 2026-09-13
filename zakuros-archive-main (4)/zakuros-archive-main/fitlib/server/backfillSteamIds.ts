// One-shot offline backfill: fix wrong/placeholder Steam IDs, then fill
// steamId (and missing covers) for every non-classic game using the local
// Steam app index.
// Run: npx tsx server/backfillSteamIds.ts
import fs from "fs";
import path from "path";
import { Game } from "../src/types";
import { validateSteamIds, backfillSteamIds } from "./sources";

const GAMES_DB_PATH = path.join(process.cwd(), "data", "merged_enriched.json");
const games = JSON.parse(fs.readFileSync(GAMES_DB_PATH, "utf8")) as Game[];

const valid = validateSteamIds(games);
const before = games.filter((g) => !g.classic && !g.steamId).length;
const result = backfillSteamIds(games);
const after = games.filter((g) => !g.classic && !g.steamId).length;

const tmpPath = `${GAMES_DB_PATH}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(games), "utf8");
fs.renameSync(tmpPath, GAMES_DB_PATH);

console.log(
  `Validation: ${valid.fixed} fixed, ${valid.unassigned} unassigned, ${valid.kept} kept`
);
console.log(
  `Missing before: ${before} | filled: ${result.filled} | unmatched: ${result.unmatched} | already: ${result.already} | missing after: ${after}`
);
console.log(`Catalog saved to ${GAMES_DB_PATH}`);