// One-shot offline backfill: fix wrong/placeholder Steam IDs, then fill
// steamId (and missing covers) for every non-classic game using the local
// Steam app index.
// Run: npx tsx server/backfillSteamIds.ts
import { Game } from "../src/types";
import { validateSteamIds, backfillSteamIds } from "./sources";
import { GAMES_DB_PATH, readGames, writeGames } from "./catalogIO";

const games = readGames<Game>();

const valid = validateSteamIds(games);
const before = games.filter((g) => !g.classic && !g.steamId).length;
const result = backfillSteamIds(games);
const after = games.filter((g) => !g.classic && !g.steamId).length;

writeGames(games);

console.log(
  `Validation: ${valid.fixed} fixed, ${valid.unassigned} unassigned, ${valid.kept} kept`
);
console.log(
  `Missing before: ${before} | filled: ${result.filled} | unmatched: ${result.unmatched} | already: ${result.already} | missing after: ${after}`
);
console.log(`Catalog saved to ${GAMES_DB_PATH}`);