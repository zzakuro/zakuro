import { readGames } from "./server/catalogIO";
import { selfHealCatalog } from "./server/sources";
import { Game } from "./src/types";

const gs = readGames<Game>();
const h = selfHealCatalog(gs);
console.log("pass0", JSON.stringify(h));
const idCounts = new Map<string, number>();
for (const g of gs) idCounts.set(g.id, (idCounts.get(g.id) || 0) + 1);
console.log("dup ids after pass0:", [...idCounts.values()].filter((n) => n > 1).length);

// drill into one surviving dup group to see why it wasn't merged
const bId = new Map<string, Game[]>();
for (const g of gs) {
  const a = bId.get(g.id) || [];
  a.push(g);
  bId.set(g.id, a);
}
for (const [id, arr] of bId) {
  if (arr.length < 2) continue;
  console.log("UNMERGED GROUP:", JSON.stringify(arr.map((g) => ({ id: g.id, title: g.title, steamId: g.steamId, classic: g.classic }))));
  break;
}