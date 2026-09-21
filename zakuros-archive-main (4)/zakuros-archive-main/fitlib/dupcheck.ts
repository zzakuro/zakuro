import { readGames } from "./server/catalogIO";
import { normalizeForMatch, stabilizeCatalog, selfHealCatalog } from "./server/sources";
import { Game } from "./src/types";

const gs = readGames<Game>();
console.log("loaded", gs.length);

// find one dup pair and inspect the objects deeply
const byId = new Map<string, Game[]>();
for (const g of gs) {
  const a = byId.get(g.id) || [];
  a.push(g);
  byId.set(g.id, a);
}
for (const [id, arr] of byId) {
  if (arr.length < 2) continue;
  console.log("PAIR id:", id);
  arr.forEach((g, i) => {
    console.log(`  [${i}] title=${JSON.stringify(g.title)}`);
    console.log(`      normalizedForMatch=${JSON.stringify(normalizeForMatch(g.title || ""))}`);
    console.log(`      steamId=${g.steamId} classic=${g.classic} cover=${(g.coverImage || "").slice(0, 60)}`);
    console.log(`      key fields: genres=${JSON.stringify(g.genres)} pub=${JSON.stringify(g.publisher)}`);
    console.log("      full keys:", Object.keys(g).join(","));
    console.log("      summaryLen", (g.summary || "").length);
  });
  console.log("identity same?", arr[0] === arr[1], "deep-equal?", JSON.stringify(arr[0]) === JSON.stringify(arr[1]));
  break;
}

// run stabilizeCatalog alone on a clone and report what it does to that pair
const clone = JSON.parse(JSON.stringify(gs)) as Game[];
const out = stabilizeCatalog(clone);
console.log("stabilizeCatalog merged", out.merged, "regen", out.regen, "->", out.games.length);
const idCounts = new Map<string, number>();
for (const g of out.games) idCounts.set(g.id, (idCounts.get(g.id) || 0) + 1);
console.log("dup ids after stabilizeCatalog:", [...idCounts.values()].filter((n) => n > 1).length);