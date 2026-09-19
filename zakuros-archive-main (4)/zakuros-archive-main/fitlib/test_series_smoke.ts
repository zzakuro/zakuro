import { readGames } from "./server/catalogIO";
import { buildSeriesCatalog, readCuratedCollections, normalizeSeriesKey } from "./server/series";
import { Game } from "./src/types";

const start = Date.now();
const games = readGames<Game>();
console.log(`[smoke] catalog loaded: ${games.length} games in ${Date.now() - start}ms`);

const curated = readCuratedCollections();
console.log(`[smoke] curated configs: ${curated.length}`);

console.log("[smoke] sample normalized keys:");
for (const t of [
  "Grand Theft Auto: San Andreas (v1.0)",
  "Grand Theft Auto III",
  "Grand Theft Auto V",
  "Need for Speed: Most Wanted",
  "Call of Duty: Black Ops 2",
  "The Elder Scrolls V: Skyrim",
]) {
  console.log(`  "${t}" -> "${normalizeSeriesKey(t)}"`);
}

const { groups, index } = buildSeriesCatalog(games, curated);
console.log(`[smoke] series groups: ${groups.size}, index rows: ${index.length}`);
const top = index.slice(0, 8);
for (const s of top) {
  console.log(`  [${s.curated ? "curated" : "auto"}] ${s.name}: ${s.count} games, covers=${s.covers.length}${s.badge ? ` (${s.badge})` : ""}`);
}
const gta = groups.get("grand-theft-auto");
console.log(`[smoke] GTA group: ${gta?.games.length ?? 0} games`);
if (gta) {
  for (const g of gta.games.slice(0, 5)) console.log(`    - ${g.title} [${g.rating}]`);
}