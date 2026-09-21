import fs from "fs";
import path from "path";
import { readGames, writeGames } from "./server/catalogIO";
import { selfHealCatalog } from "./server/sources";
import { Game } from "./src/types";

const GZ = path.join(process.cwd(), "data", "merged_enriched.json.gz");

// 1) heal in memory loop until convergence
const gs = readGames<Game>();
let pass = 0;
for (let i = 0; i < 5; i++) {
  const h = selfHealCatalog(gs);
  console.log("pass", i, JSON.stringify(h));
  pass++;
  if (h.bilingual + h.merged + h.classic + h.covers + h.filler === 0) break;
}
const idCounts = new Map<string, number>();
for (const g of gs) idCounts.set(g.id, (idCounts.get(g.id) || 0) + 1);
console.log("dup ids after heal:", [...idCounts.values()].filter((n) => n > 1).length);

// 2) capture pre-write mtime/hash
const beforeStat = fs.statSync(GZ);

// 3) write converged catalog
writeGames(gs);
console.log("written, games:", gs.length);

// 4) start a watcher: log any access/change to the gz with timestamp, for 90s
console.log("watching file for 90s...");
const watcher = fs.watch(GZ, (event, filename) => {
  const s = fs.statSync(GZ);
  console.log(new Date().toISOString(), "FS-EVENT", event, filename, "size", s.size, "mtime", s.mtime.toISOString());
});

setTimeout(() => {
  watcher.close();
  const finalStat = fs.statSync(GZ);
  console.log("done. pre-write mtime", beforeStat.mtime.toISOString(), "now", finalStat.mtime.toISOString(), "size", finalStat.size);
  const afterStat = fs.statSync(GZ);
  if (afterStat.mtime.toISOString() !== beforeStat.mtime.toISOString()) {
    console.log("FILE WAS REWRITTEN by another process!");
  }
  process.exit(0);
}, 90000);