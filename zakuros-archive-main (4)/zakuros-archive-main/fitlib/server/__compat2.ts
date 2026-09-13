import fs from "fs";
import path from "path";
import { steamTitleMismatch } from "./sources";
import { Game } from "../src/types";

const games = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "merged_enriched.json"), "utf8")) as Game[];
const apps = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "steam_apps.json"), "utf8")).applist.apps;
const dumpName = new Map(apps.filter(a => a?.appid && a.name).map(a => [String(a.appid), a.name]));

let flagged = 0, sample = 0;
const flags: string[] = [];
for (const g of games) {
  if (g.classic || !g.steamId || !g.developer) continue;
  const sn = dumpName.get(String(g.steamId));
  if (!sn) continue;
  sample++;
  if (steamTitleMismatch(g.title, sn)) {
    flagged++;
    if (flags.length < 14) flags.push(`${g.title} [${g.steamId}] vs "${sn}"`);
  }
}
console.log(`flag rate on known-good: ${flagged}/${sample} (${((flagged / sample) * 100).toFixed(2)}%)`);
for (const f of flags) console.log("  FLAG:", f);

// Now the previously-detected bad offline candidates:
for (const [t, s] of [["99Vidas: The", "The Build And Race Hotrod Game"], ["171 Game", "Infested Inside Multiplayer Online"], ["A.I.L.A", "AILA"], ["8-Bit Adventures 1: Bundle", "8-Bit Adventures 1: The Forgotten Journey Remastered Edition"]]) {
  console.log(`mismatch(${t}) = ${steamTitleMismatch(t, s)}`);
}