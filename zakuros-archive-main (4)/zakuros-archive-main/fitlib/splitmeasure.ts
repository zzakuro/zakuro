import fs from "fs";
import { readGames } from "./server/catalogIO";
import { readSourcesConfig } from "./server/sources";
import { Game, DownloadSource } from "./src/types";

const cfg = readSourcesConfig("data/sources.json");
const eraByName = new Map<string, string>();
for (const s of cfg) eraByName.set(s.name, s.category);

const games: Game[] = readGames();
let bothEras = 0;
const detail: { id: string; title: string; classic: boolean; classicLinks: number; modernLinks: number; repackers: string[] }[] = [];
let mixedClassicFlag = 0;

for (const g of games) {
  const links = g.downloadSources || [];
  let classicLinks = 0, modernLinks = 0;
  const repackers = new Set<string>();
  for (const s of links) {
    const era = eraByName.get(s.repacker || "");
    if (era === "classic") classicLinks++;
    else modernLinks++;
    if (s.repacker) repackers.add(s.repacker);
  }
  const hasClassic = classicLinks > 0;
  const hasModern = modernLinks > 0;
  if (hasClassic && hasModern) {
    bothEras++;
    detail.push({ id: g.id, title: g.title, classic: !!g.classic, classicLinks, modernLinks, repackers: [...repackers] });
  }
  if (hasClassic && !g.classic && g.steamId === undefined) mixedClassicFlag++;
  if (hasModern && g.classic) mixedClassicFlag++;
}

console.log("total games:", games.length);
console.log("games with BOTH classic-era and modern-era downloads:", bothEras);
console.log("games whose entries disagree with source era (classic flag mismatch):", mixedClassicFlag);
console.log("worst offenders (most links):");
console.log(JSON.stringify(detail.sort((a,b)=>(b.classicLinks+b.modernLinks)-(a.classicLinks+a.modernLinks)).slice(0,15), null, 1));
