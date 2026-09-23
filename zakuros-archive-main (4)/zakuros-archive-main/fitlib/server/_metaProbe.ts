import { readGames } from "./catalogIO";
import { titlesLookLikeSameGame } from "./sources";
import { Game } from "../src/types";

const games = readGames<Game>();
const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// ── 1. steamId collisions, bucketed ────────────────────────────────────────────
const bySteam = new Map<number, Game[]>();
for (const g of games) {
  if (g.steamId == null) continue;
  const arr = bySteam.get(g.steamId);
  if (arr) arr.push(g);
  else bySteam.set(g.steamId, [g]);
}
const steamPunctTwins: { steamId: number; titles: string[] }[] = [];
const steamTrueCollisions: { steamId: number; titles: string[]; norms: string[] }[] = [];
for (const [steamId, group] of bySteam) {
  if (group.length < 2) continue;
  const titles = group.map((g) => g.title);
  let distinct = false;
  for (let i = 0; i < titles.length && !distinct; i++)
    for (let j = i + 1; j < titles.length; j++)
      if (!titlesLookLikeSameGame(titles[i], titles[j])) { distinct = true; break; }
  const norms = new Set(group.map((g) => norm(g.title)));
  if (!distinct) continue; // same game variants — fine
  (norms.size === 1 ? steamPunctTwins : steamTrueCollisions).push({ steamId, titles, norms: [...norms] });
}

// ── 2. gogId collisions across dissimilar titles ───────────────────────────────
const byGog = new Map<number, Game[]>();
for (const g of games) {
  if (g.gogId == null) continue;
  const arr = byGog.get(g.gogId);
  if (arr) arr.push(g);
  else byGog.set(g.gogId, [g]);
}
const gogCollisions: { gogId: number; titles: string[]; records: { title: string; classic: boolean; releaseDate: string | undefined }[] }[] = [];
for (const [gogId, group] of byGog) {
  if (group.length < 2) continue;
  const titles = group.map((g) => g.title);
  let distinct = false;
  for (let i = 0; i < titles.length && !distinct; i++)
    for (let j = i + 1; j < titles.length; j++)
      if (!titlesLookLikeSameGame(titles[i], titles[j])) { distinct = true; break; }
  if (distinct)
    gogCollisions.push({ gogId, titles, records: group.map((g) => ({ title: g.title, classic: !!g.classic, releaseDate: g.releaseDate })) });
}

// ── 3. classic rows carrying a modern-only GOG product (retro leak class) ──────
const classicWithGog = games.filter((g) => g.classic && g.gogId != null);
const classicWithSteam = games.filter((g) => g.classic && g.steamId != null);

// ── 4. rows whose releaseDate is more than 60 days in the future ──────────────
const now = Date.now();
const futureDated = games
  .filter((g) => {
    const ms = Date.parse(g.releaseDate || "");
    return Number.isFinite(ms) && ms > now + 60 * 86400 * 1000;
  })
  .map((g) => ({ title: g.title, releaseDate: g.releaseDate }));

// ── 5. duplicate download URLs (same url on two different games) ───────────────
const urlOwner = new Map<string, string>();
const dupUrls: { url: string; a: string; b: string }[] = [];
for (const g of games) {
  for (const s of g.downloadSources || []) {
    if (!s?.url) continue;
    const prev = urlOwner.get(s.url);
    if (prev) {
      if (prev !== g.title) dupUrls.push({ url: s.url, a: prev, b: g.title });
    } else urlOwner.set(s.url, g.title);
  }
}

console.log(`total ${games.length} · classic ${games.filter((g) => g.classic).length}`);
console.log(`steamId punct-twins (same game, dup rows): ${steamPunctTwins.length}`);
console.log(`steamId TRUE collisions: ${steamTrueCollisions.length}`);
for (const c of steamTrueCollisions) console.log("  ", JSON.stringify(c));
console.log(`gogId collisions: ${gogCollisions.length}`);
for (const c of gogCollisions.slice(0, 60)) console.log("  ", c.gogId, JSON.stringify(c.titles), c.records.map((r) => `${r.classic ? "C" : "M"}·${r.releaseDate}`).join(" | "));
console.log(`classic rows with gogId: ${classicWithGog.length}`);
console.log(`classic rows with steamId: ${classicWithSteam.length}`);
console.log(`future-dated releaseDate (>now+60d): ${futureDated.length}`);
for (const f of futureDated.slice(0, 20)) console.log("  ", f.title, "→", f.releaseDate);
console.log(`duplicate download URLs across different titles: ${dupUrls.length}`);
for (const d of dupUrls.slice(0, 20)) console.log("  ", d.url.slice(0, 90), "| a:", d.a.slice(0, 40), "| b:", d.b.slice(0, 40));