import { readGames } from "./server/catalogIO";
import { Game } from "./src/types";

const gs = readGames<Game>();
const idCounts = new Map<string, number>();
for (const g of gs) idCounts.set(g.id, (idCounts.get(g.id) || 0) + 1);
const dups = [...idCounts.entries()].filter(([, n]) => n > 1);
console.log("total", gs.length, "dup id groups", dups.length);
const byId = new Map<string, Game[]>();
for (const g of gs) {
  const a = byId.get(g.id) || [];
  a.push(g);
  byId.set(g.id, a);
}
let shown = 0;
for (const [id, arr] of byId) {
  if (arr.length < 2) continue;
  if (shown++ >= 5) break;
  console.log(JSON.stringify({ id: arr[0].id, titles: arr.map((g) => g.title), steam: arr.map((g) => g.steamId) }));
}
const sameTitle = dups.reduce((n, [id]) => {
  const arr = byId.get(id)!;
  const keys = new Set(arr.map((g) => (g.title || "").toLowerCase().normalize("NFC")));
  return n + (keys.size === 1 ? 1 : 0);
}, 0);
console.log("dup groups with identical title:", sameTitle, "of", dups.length);