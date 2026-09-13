import fs from "fs";
import path from "path";
import { titlesCompatible, normalizeForMatch, stripReleaseJunk } from "./sources";
import { Game } from "../src/types";

const games = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "merged_enriched.json"), "utf8")) as Game[];
const apps = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "steam_apps.json"), "utf8")).applist.apps;
const dumpName = new Map(apps.filter(a => a?.appid && a.name).map(a => [String(a.appid), a.name]));

// Check known-good assignments: how many pass titlesCompatible against the dump name?
let reject = 0, sample = 0;
const rejects: string[] = [];
for (const g of games) {
  if (g.classic || !g.steamId || !g.developer) continue;
  const sn = dumpName.get(String(g.steamId));
  if (!sn) continue;
  sample++;
  if (!titlesCompatible(g.title, sn)) {
    reject++;
    if (rejects.length < 10) rejects.push(`${g.title} [${g.steamId}] vs "${sn}"`);
  }
}
console.log(`known-good passes: ${sample - reject}/${sample} (${(((sample - reject) / sample) * 100).toFixed(1)}%)`);
for (const r of rejects) console.log("  REJECT:", r);

// Fuzzy rough? no import for fuzzy; print junk-strip behavior for samples
for (const t of ["The Witcher 3: Wild Hunt - GOTY Edition", "Halo: The Master Chief Collection", "Dragon Age: Origins - Ultimate Edition", "Left 4 Dead 2", "Dark Souls III"]) {
  const k = normalizeForMatch(t);
  console.log(`strip: "${t}" -> clean "${k}" -> junkstrip "${stripReleaseJunk(k)}"`);
}