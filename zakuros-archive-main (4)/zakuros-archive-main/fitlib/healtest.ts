import { readGames } from "./server/catalogIO";
import { selfHealCatalog } from "./server/sources";

const gs = readGames();
console.log("loaded", gs.length);
for (let i = 0; i < 5; i++) {
  const h = selfHealCatalog(gs);
  console.log("pass", i, JSON.stringify(h));
  if (h.bilingual + h.merged + h.classic + h.covers + h.filler === 0) break;
}
const idCounts = new Map<string, number>();
for (const g of gs) idCounts.set(g.id, (idCounts.get(g.id) || 0) + 1);
console.log("dup ids after loop:", [...idCounts.values()].filter((n) => n > 1).length);