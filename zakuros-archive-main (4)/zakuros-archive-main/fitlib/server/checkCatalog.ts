import fs from "fs";
import path from "path";
import { readGames } from "./catalogIO";
import {
  selfHealCatalog,
  summaryIsPlaceholder,
  devIsPlaceholder,
  screenshotsArePlaceholder,
  titlesLookLikeSameGame,
} from "./sources";
import { Game } from "../src/types";

// ── Catalog snapshot + invariant checker ─────────────────────────────────────
// Read-only audit of data/merged_enriched.json.gz. Re-runs the persist-time
// self-heal on a throwaway clone (so any would-be change is a regression) and
// records field-coverage stats. Writes data/snapshots/catalog-<stamp>.json plus
// data/snapshots/latest.json, and exits non-zero if a hard invariant fails.
// Run: npx tsx server/checkCatalog.ts   (safe while the grind is writing)

const DATA_DIR = path.join(process.cwd(), "data");
const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshots");
const STEAM_APPS_PATH = path.join(DATA_DIR, "steam_apps.json");
const GAMES_DB_PATH = path.join(DATA_DIR, "merged_enriched.json.gz");

const problems: string[] = [];
const warnings: string[] = [];

function loadSteamAppIds(): Set<number> {
  try {
    const raw = JSON.parse(fs.readFileSync(STEAM_APPS_PATH, "utf8"));
    const apps: any[] = raw?.applist?.apps ?? [];
    return new Set(apps.map((a) => Number(a.appid)).filter((n) => Number.isFinite(n)));
  } catch {
    warnings.push("steam_apps.json unavailable — skipping unknown-appid check");
    return new Set();
  }
}

const games = readGames<Game>();
const total = games.length;
if (!total) {
  console.error("[Check] Catalog is empty — aborting.");
  process.exit(1);
}

const pct = (n: number) => Math.round((n / total) * 1000) / 10;
const count = (pred: (g: Game) => boolean) => games.filter(pred).length;

// ── Duplicate ids ────────────────────────────────────────────────────────────
const idCounts = new Map<string, number>();
for (const g of games) idCounts.set(g.id, (idCounts.get(g.id) || 0) + 1);
const dupIds = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
if (dupIds.length) problems.push(`duplicate ids: ${dupIds.length} (e.g. ${dupIds.slice(0, 3).join(", ")})`);

// ── Shared steamId across dissimilar titles ──────────────────────────────────
const bySteam = new Map<number, string[]>();
for (const g of games) {
  if (g.steamId == null) continue;
  const arr = bySteam.get(g.steamId);
  if (arr) arr.push(g.title);
  else bySteam.set(g.steamId, [g.title]);
}
const sharedAppIds: { steamId: number; titles: string[] }[] = [];
for (const [steamId, titles] of bySteam) {
  if (titles.length < 2) continue;
  let distinct = false;
  for (let i = 0; i < titles.length && !distinct; i++) {
    for (let j = i + 1; j < titles.length; j++) {
      if (!titlesLookLikeSameGame(titles[i], titles[j])) {
        distinct = true;
        break;
      }
    }
  }
  if (distinct) sharedAppIds.push({ steamId, titles });
}
if (sharedAppIds.length) {
  // Known edition-mismatch backlog, not structural corruption — tracked, not fatal.
  warnings.push(`shared steamIds across dissimilar titles: ${sharedAppIds.length}`);
}

// ── Unknown appids (not present in the offline Steam app list) ───────────────
const knownAppIds = loadSteamAppIds();
const knownAppIdsUsable = knownAppIds.size > 0;
const unknownAppIds = knownAppIdsUsable
  ? games.filter((g) => g.steamId != null && !knownAppIds.has(g.steamId))
  : [];
if (unknownAppIds.length) {
  warnings.push(`steamIds not in steam_apps.json: ${unknownAppIds.length}`);
}

// ── Self-heal dry run on a clone ─────────────────────────────────────────────
const clone = JSON.parse(JSON.stringify(games)) as Game[];
const heal = selfHealCatalog(clone);
if (heal.filler || heal.bilingual || heal.merged || heal.covers) {
  problems.push(`self-heal would still change the catalog: ${JSON.stringify(heal)}`);
}

// ── Field coverage ───────────────────────────────────────────────────────────
const coverage = {
  cover: pct(count((g) => !!g.coverImage)),
  steamId: pct(count((g) => g.steamId != null)),
  igdbId: pct(count((g) => g.igdbId != null)),
  summary: pct(count((g) => !!g.summary)),
  realSummary: pct(count((g) => !!g.summary && !summaryIsPlaceholder(g.summary))),
  genres: pct(count((g) => !!g.genres?.length)),
  developer: pct(count((g) => !!g.developer)),
  realDeveloper: pct(count((g) => !!g.developer && !devIsPlaceholder(g.developer))),
  publisher: pct(count((g) => !!g.publisher)),
  releaseDate: pct(count((g) => !!g.releaseDate)),
  screenshots: pct(count((g) => !!g.screenshots?.length && !screenshotsArePlaceholder(g))),
  rating: pct(count((g) => (g.rating ?? 0) > 0)),
};

const placeholders = {
  summaries: count((g) => summaryIsPlaceholder(g.summary)),
  developers: count((g) => devIsPlaceholder(g.developer)),
  screenshots: count((g) => screenshotsArePlaceholder(g)),
};

const snapshot = {
  generatedAt: new Date().toISOString(),
  catalogBytes: fs.existsSync(GAMES_DB_PATH) ? fs.statSync(GAMES_DB_PATH).size : null,
  total,
  classic: count((g) => !!g.classic),
  coverage,
  placeholders,
  steamIdAudit: {
    withId: bySteam.size,
    unknownAppIds: unknownAppIds.length,
    unknownSample: unknownAppIds.slice(0, 10).map((g) => ({ title: g.title, steamId: g.steamId })),
    sharedAppIds: sharedAppIds.length,
    sharedSample: sharedAppIds.slice(0, 10),
  },
  duplicateIds: dupIds.length,
  selfHeal: heal,
  problems,
  warnings,
};

fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
const stamp = snapshot.generatedAt.replace(/[:.]/g, "-");
const snapPath = path.join(SNAPSHOT_DIR, `catalog-${stamp}.json`);
fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
fs.writeFileSync(path.join(SNAPSHOT_DIR, "latest.json"), JSON.stringify(snapshot, null, 2));

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`[Check] ${total.toLocaleString()} games`);
console.log(
  `[Check] coverage: cover ${coverage.cover}% · steamId ${coverage.steamId}% · igdbId ${coverage.igdbId}% · ` +
    `real summary ${coverage.realSummary}% · genres ${coverage.genres}% · dev ${coverage.realDeveloper}% · ` +
    `date ${coverage.releaseDate}% · shots ${coverage.screenshots}% · rating ${coverage.rating}%`
);
console.log(`[Check] placeholders: ${JSON.stringify(placeholders)} · self-heal ${JSON.stringify(heal)}`);
console.log(`[Check] snapshot: ${snapPath}`);
for (const w of warnings) console.log(`[Check]  ⚠ ${w}`);
if (problems.length) {
  for (const p of problems) console.error(`[Check]  ✗ ${p}`);
  console.error(`[Check] FAILED (${problems.length} invariant${problems.length === 1 ? "" : "s"})`);
  process.exit(1);
}
console.log("[Check] OK — no invariant failures.");
