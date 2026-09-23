// stabilize — re-run the persist-path self-heal against the catalog and write
// the result, exactly like every sync/grind catalog write does. Use after a
// classification bake (e.g. `npm run retro:audit -- --apply`) so rows that are
// no longer distinct (same name + same era) collapse to one entry and
// `check:catalog` returns to zero residual.
//
//   npx tsx server/stabilize.ts
import { readGames, writeGames } from "./catalogIO";
import { selfHealCatalog } from "./sources";
import type { Game } from "../src/types";

const games = readGames<Game>();
const before = games.length;
const heal = selfHealCatalog(games);
console.log("self-heal:", JSON.stringify(heal));
console.log(`catalog: ${before} → ${games.length} games`);
writeGames(games);
console.log("Catalog saved.");