import { readGames } from "./server/catalogIO";
import { buildSeriesCatalog, readCuratedCollections, SeriesGroup } from "./server/series";
import { Game } from "./types";

const games = readGames<Game>();

const curated = readCuratedCollections();
const { index, groups } = buildSeriesCatalog(games, curated);
console.log("[size] index rows:", index.length, "groups:", groups.size);

const covers = index.reduce((n, s) => n + s.covers.length, 0);
console.log("[size] total covers in index:", covers);

// How many series have >= 4 games, 3, 2 (an auto-series needs >= 2)?
for (const t of [1, 2, 3, 4, 5]) {
  console.log(`[size] series with >= ${t} games:`, index.filter((s) => s.count >= t).length);
}

// Rough serialized payload estimate (JSON.stringify of first 400).
const sample = index.slice(0, 400);
const bytes = JSON.stringify(sample).length;
console.log(`[size] approx payload for 400 ≈ ${(bytes / 1024).toFixed(1)} KB → full ≈ ${((bytes / 400) * index.length / 1024).toFixed(1)} KB`);
