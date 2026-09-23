import fs from "fs";
import path from "path";
import { readGames } from "./catalogIO";
import { titlesLookLikeSameGame } from "./sources";
import { Game } from "../src/types";

const games = readGames<Game>();
let apps: any[] = [];
try { apps = JSON.parse(fs.readFileSync(path.join("data", "steam_apps.json"), "utf8"))?.applist?.apps ?? []; } catch {}
const appName = new Map(apps.map((a) => [Number(a.appid), String(a.name || "")]));
const nameOf = (id: number) => appName.get(id) ?? "(not in steam_apps.json)";

// classic rows carrying a gogId
const classicWithGog = games.filter((g) => g.classic && g.gogId != null);
console.log(`=== classic rows with gogId: ${classicWithGog.length} ===`);
console.log("top titles:", classicWithGog.slice(0, 12).map((g) => `${g.title} [gogId=${g.gogId}]`).join("\n        "));

// steamId true collisions with real app names
const bySteam = new Map<number, Game[]>();
for (const g of games) { if (g.steamId == null) continue; const a = bySteam.get(g.steamId); if (a) a.push(g); else bySteam.set(g.steamId, [g]); }
console.log(`\n=== steamId collision appid → real Steam name ===`);
let collisionCount = 0;
for (const [steamId, group] of bySteam) {
  if (group.length < 2) continue;
  const titles = group.map((g) => g.title);
  let distinct = false;
  for (let i = 0; i < titles.length && !distinct; i++)
    for (let j = i + 1; j < titles.length; j++)
      if (!titlesLookLikeSameGame(titles[i], titles[j])) { distinct = true; break; }
  if (!distinct) continue;
  collisionCount++;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const uniq = [...new Set(titles.map(norm).filter(Boolean))];
  if (uniq.length < 2) continue;
  console.log(`appid ${steamId} = "${nameOf(steamId)}"`);
  for (const g of group) console.log(`    ${g.classic ? "C" : "M"} ${g.title.slice(0, 70)} · date=${g.releaseDate} · dev=${(g.developer || "").slice(0, 30)} · summ[${(g.summary || "").slice(0, 50)}]`);
}
console.log(`collision groups: ${collisionCount}`);

// duplicate download URLs with truly dissimilar titles
console.log(`\n=== duplicate download URLs, dissimilar titles ===`);
const urlOwner = new Map<string, Game>();
const seen = new Set<string>();
let dissimUrlCount = 0;
for (const g of games) {
  for (const s of g.downloadSources || []) {
    if (!s?.url || seen.has(s.url)) continue;
    seen.add(s.url);
    const prev = urlOwner.get(s.url);
    if (prev && !titlesLookLikeSameGame(prev.title, g.title)) dissimUrlCount++;
    else if (!prev) urlOwner.set(s.url, g);
  }
}
console.log(`dissimilar-title dup URLs: ${dissimUrlCount}`);