import express from "express";
import path from "path";
import fs from "fs";
import compression from "compression";
import { createServer as createViteServer } from "vite";
import { getGameMetadata, checkBackendRateLimit, parseSteamPcRequirements } from "./server/metadataService";
import { setRealScreenshots, summaryIsPlaceholder, devIsPlaceholder, shouldUpgradeSummary, steamTitleMismatch, selfHealCatalog } from "./server/sources";
import {
  communityRouter,
} from "./server/community";
import {
  readSourcesConfig,
  syncSources,
  SyncResult,
  matchGenres,
} from "./server/sources";
import { Game } from "./src/types";
import { scraperRouter } from "./server/scraperApi";
import { buildSeriesCatalog, readCuratedCollections, SeriesSummary, SeriesGroup } from "./server/series";
import { platformOfGame, classifyEra } from "./server/eraClassify";

// Housed under data/ (not public/) so Vite's public-dir watcher doesn't force
// a full browser page reload every time the debounced catalog write fires.
import { GAMES_DB_PATH, readGames, writeGames } from "./server/catalogIO";
import { normalizeGame } from "./server/normalize";
const SOURCES_CONFIG_PATH = path.join(process.cwd(), "data", "sources.json");
const GRIND_LOCK_PATH = path.join(process.cwd(), "data", ".grind-active");
const PORT = 3000;

// Whether the detached metadata grind is mid-run. When it is, the server must
// not persist its (possibly stale) in-memory catalog over the grind's fresh
// writes, and should skip auto source-syncs so they don't clobber new ids.
// The lock records the grind's pid; a left-behind lock whose pid is gone is
// stale and auto-cleared so a hard-killed grind can never deadlock the server's
// persistence.
function grindActive(): boolean {
  try {
    if (!fs.existsSync(GRIND_LOCK_PATH)) return false;
    const parsed = JSON.parse(fs.readFileSync(GRIND_LOCK_PATH, "utf8"));
    const pid = typeof parsed?.pid === "number" ? parsed.pid : null;
    if (pid !== null && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return true; // process alive → grind genuinely running
      } catch (e: any) {
        if (e?.code === "EPERM") return true; // exists but not ours → alive
        fs.rmSync(GRIND_LOCK_PATH, { force: true });
        console.log("[DB] Stale grind lock (dead pid) cleared.");
        return false;
      }
    }
    // Legacy plain-text lock (no pid): treat as active briefly, stale after 15m.
    const age = Date.now() - fs.statSync(GRIND_LOCK_PATH).mtimeMs;
    if (age < 15 * 60 * 1000) return true;
    fs.rmSync(GRIND_LOCK_PATH, { force: true });
    console.log("[DB] Stale grind lock (old) cleared.");
    return false;
  } catch {
    return false;
  }
}
const SOURCE_SYNC_INTERVAL_MS =
  (process.env.SOURCE_SYNC_INTERVAL_HOURS
    ? Number(process.env.SOURCE_SYNC_INTERVAL_HOURS)
    : 6) * 60 * 60 * 1000;

// ── In-memory catalog ─────────────────────────────────────────────────────────
// The catalog JSON is ~50MB. Parse it ONCE at startup and serve from memory.
// Every earlier request did a synchronous 50MB read + parse, which froze the
// event loop. gamesCatalog is the single source of truth while the process runs;
// file writes (POST /bulk, POST /) re-sync it to disk.
let gamesCatalog: Game[] = [];

function loadGames(): Game[] {
  try {
    console.log("[DB] Loading catalog into memory...");
    const start = Date.now();
    const games = readGames<Game>();
    let normalized = 0;
    for (const g of games) if (normalizeGame(g)) normalized++;
    if (normalized) console.log(`[DB] Normalized ${normalized} games (dates/popularity).`);
    console.log(`[DB] Loaded ${games.length} games in ${Date.now() - start}ms`);
    return Array.isArray(games) ? games : [];
  } catch (e: any) {
    console.error("[DB] Failed to load catalog:", e.message);
    return [];
  }
}

let catalogDirty = false;
let catalogRevision = 0;
let catalogSaveTimer: NodeJS.Timeout | null = null;
let catalogSaving: Promise<void> | null = null;

// Fold genuine duplicate rows back together before every write. Enrichment
// (live detail fetches here, the grind in fillCatalogMetadata) assigns Steam
// metadata incrementally, which can re-introduce same-appid/edition dupes that
// the sync-time stabilize pass already collapsed. Mutating in place keeps the
// long-lived gamesCatalog reference valid for every request handler.
function stabilizeInPlace(): void {
  const { filler, bilingual, merged, covers } = selfHealCatalog(gamesCatalog);
  // One heal pass can leave residual duplicates (a merged row's survivor may
  // itself collide downstream); iterate until a pass reports nothing.
  let extraPasses = 0;
  let residual = selfHealCatalog(gamesCatalog);
  while (
    residual.bilingual > 0 ||
    residual.merged > 0 ||
    residual.classic > 0 ||
    residual.covers > 0
  ) {
    extraPasses++;
    if (extraPasses > 10) {
      console.warn("[DB] stabilize-on-persist did not converge after 10 passes.");
      break;
    }
    residual = selfHealCatalog(gamesCatalog);
  }
  if (filler > 0) console.log(`[DB] prune-on-persist dropped ${filler} foreign filler rows.`);
  if (bilingual > 0) console.log(`[DB] bilingual-merge-on-persist folded ${bilingual} duplicate rows.`);
  if (merged > 0) console.log(`[DB] stabilize-on-persist merged ${merged} duplicate rows.`);
  if (covers > 0) console.log(`[DB] cover-realign-on-persist fixed ${covers} mismatched covers.`);
  if (extraPasses > 0) console.log(`[DB] stabilize-on-persist converged after +${extraPasses} extra pass(es).`);
}

function persistCatalogSync(): void {
  if (grindActive()) {
    console.log("[DB] Grind active — skipping catalog persist on exit.");
    return;
  }
  try {
    stabilizeInPlace();
    writeGames(gamesCatalog);
  } catch (e: any) {
    console.error("[DB] Failed to persist catalog:", e.message);
  }
}

async function flushCatalogAsync(): Promise<void> {
  catalogDirty = false;
  if (grindActive()) {
    console.log("[DB] Grind active — deferring catalog persist.");
    return;
  }
  try {
    stabilizeInPlace();
    writeGames(gamesCatalog);
    console.log("[DB] Catalog persisted (async, atomic).");
  } catch (e: any) {
    console.error("[DB] Failed to persist catalog:", e.message);
  }
}

// Debounced, coalesced, non-blocking persistence. Bursts of edits (e.g.
// browsing several detail pages in a row) collapse into at most one write
// every ~10s; the write itself is async and atomic (tmp + rename) so the
// event loop and OneDrive never see a half-written ~45MB file.
function scheduleCatalogSave(): void {
  catalogDirty = true;
  catalogRevision++;
  if (catalogSaveTimer) clearTimeout(catalogSaveTimer);
  catalogSaveTimer = setTimeout(() => {
    catalogSaveTimer = null;
    if (!catalogDirty) return;
    catalogSaving = catalogSaving?.then(flushCatalogAsync) ?? flushCatalogAsync();
  }, 10000);
}

process.on("exit", () => {
  if (catalogDirty) persistCatalogSync();
});

// ── Query helpers ─────────────────────────────────────────────────────────────

interface CatalogQuery {
  q?: string;
  ids?: string[];
  limit?: number;
  offset?: number;
  sort?: string;
  genre?: string;
  developer?: string;
  year?: string;
  minRating?: number;
  classic?: boolean;
  coverless?: boolean;
  // undefined = include NSFW (back-compat); false = hide NSFW.
  nsfw?: boolean;
}

// Genres that mark a title as adult. Mirrors the client's NSFW_GENRES so the
// server can offer a pre-filtered catalog slice without the client downloading
// everything just to hide a small subset.
const NSFW_GENRES = new Set(["nsfw", "porn", "hentai", "adult", "eroge", "erotic"]);
function isNsfwGame(g: Game): boolean {
  return (g.genres || []).some((x) => NSFW_GENRES.has(x.toLowerCase().trim()));
}

function parseSizeMb(s: string): number {
  const v = parseFloat(s || "");
  if (Number.isNaN(v)) return -Infinity;
  return /tb/i.test(s) ? v * 1024 : v;
}

function applyQuery(
  games: Game[],
  query: CatalogQuery
): { games: Game[]; total: number } {
  let result = games;

  // Explicit id selection — lets clients pin a curated set (e.g. hero carousel)
  // without re-deriving the order or fetching the whole catalog.
  if (query.ids && query.ids.length) {
    const wanted = new Set(query.ids);
    result = games.filter((g) => wanted.has(g.id));
  }

  // Adult filter — callers opt out with nsfw=false
  if (query.nsfw === false) {
    result = result.filter((g) => !isNsfwGame(g));
  }

  // Classic / retro filter (classic=true keeps only tagged titles)
  if (query.classic === true) {
    result = result.filter((g) => g.classic === true);
  }

  // Coverless-only filter
  if (query.coverless === true) {
    result = result.filter((g) => !g.coverImage);
  }

  // Server-side text search across title / developer / genres
  const q = typeof query.q === "string" ? query.q.trim().toLowerCase() : "";
  if (q) {
    result = result.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        (g.developer || "").toLowerCase().includes(q) ||
        (g.genres || []).some((genre) => genre.toLowerCase().includes(q))
    );
  }

  // Genre filter (comma-separated, any-match)
  if (typeof query.genre === "string" && query.genre.trim()) {
    const wanted = query.genre
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (wanted.length) {
      result = result.filter((g) =>
        (g.genres || []).some((genre) => wanted.includes(genre.toLowerCase()))
      );
    }
  }

  // Developer filter
  if (typeof query.developer === "string" && query.developer.trim()) {
    const dev = query.developer.trim().toLowerCase();
    result = result.filter((g) => (g.developer || "").toLowerCase().includes(dev));
  }

  // Release-year filter — matches the *year* wherever it appears in the date
  // (ISO, "Dec 11 2015", "Q3 2026", ...), never dropping valid dates.
  if (typeof query.year === "string" && query.year.trim()) {
    const year = query.year.trim();
    const yearOnly = (d: string) => (d || "").match(/(19|20)\d{2}/)?.[0];
    result = result.filter((g) => yearOnly(g.releaseDate) === year);
  }

  // Minimum editorial rating filter
  const minRating = query.minRating ? Number(query.minRating) : undefined;
  if (minRating && !isNaN(minRating)) {
    result = result.filter((g) => (g.rating ?? 0) >= minRating);
  }

  // Sort (default: as-is / popularity order already in the source file)
  const parseTime = (d: string) => {
    const t = Date.parse(d || "");
    return Number.isNaN(t) ? -Infinity : t;
  };
  switch (query.sort) {
    case "popular":
    case "popularity":
      result = [...result].sort(
        (a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0)
      );
      break;
    case "newest":
      result = [...result].sort((a, b) => parseTime(b.releaseDate) - parseTime(a.releaseDate));
      break;
    case "downloads":
      result = [...result].sort((a, b) => (b.stats?.downloads ?? 0) - (a.stats?.downloads ?? 0));
      break;
    case "rating":
      result = [...result].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      break;
    case "az":
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "filesize":
      result = [...result].sort((a, b) => parseSizeMb(b.fileSize) - parseSizeMb(a.fileSize));
      break;
    case "updated":
      result = [...result].sort((a, b) =>
        (b.stats?.updatedAt ?? "").localeCompare(a.stats?.updatedAt ?? "")
      );
      break;
  }

  const total = result.length;
  const offset = Math.max(0, query.offset ?? 0);
  const limit = query.limit && query.limit > 0 ? query.limit : total;
  return { games: result.slice(offset, offset + limit), total };
}

// ── Card projection ───────────────────────────────────────────────────────────
// The list/search surfaces only need a compact subset of each Game. Shipping
// full screenshots[], downloadSources[], systemRequirements{}, trailers[] and
// magnetLink for all 82k titles inflates the catalog-wide payload to ~46MB gz.
// Those detail-only fields are served per-game by /api/games/:id instead.
// Descriptions are the single largest remaining field (~35% of the payload) and
// are only ever shown for a few cards at a time, so the list ships `hasSummary`
// and the client hydrates the text lazily via /api/games/:id/summary.
const SUMMARY_CARD_CAP = 220;

function toCardGame(g: Game) {
  return {
    id: g.id,
    title: g.title || "",
    developer: g.developer || "",
    publisher: g.publisher || "",
    genres: Array.isArray(g.genres) ? g.genres : [],
    releaseDate: g.releaseDate,
    rating: g.rating,
    fileSize: g.fileSize,
    coverImage: g.coverImage,
    screenshot: g.screenshot,
    steamId: g.steamId,
    gogId: g.gogId,
    gogUrl: g.gogUrl,
    igdbId: g.igdbId,
    reviewCount: g.reviewCount,
    popularityScore: g.popularityScore,
    linux: g.linux,
    classic: g.classic,
    era: classifyEra(g).era,
    eraPlatform: platformOfGame(g, true),
    stats: g.stats,
    hasSummary: !!g.summary,
    screenshotCount: g.screenshots ? g.screenshots.length : 0,
    sourceCount: g.downloadSources ? g.downloadSources.length : 0,
  };
}

// ── Remote source sync state ──────────────────────────────────────────────────
let syncState: {
  lastRun: SyncResult | null;
  running: boolean;
} = { lastRun: null, running: false };

async function runSourceSync(): Promise<SyncResult> {
  if (grindActive()) {
    console.log("[Sync] Metadata grind active — skipping auto source sync.");
    return syncState.lastRun || {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ok: true,
      sources: [],
      totals: { added: 0, updated: 0, unchanged: 0, totalGames: gamesCatalog.length, downloadSourceCount: 0 },
    };
  }
  if (syncState.running) {
    console.log("[Sync] Already running, skipping.");
    return syncState.lastRun || {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ok: false,
      sources: [],
      totals: { added: 0, updated: 0, unchanged: 0, totalGames: 0, downloadSourceCount: 0 },
    };
  }
  syncState.running = true;
  const startedAt = new Date().toISOString();
  console.log(`[Sync] Starting remote source sync (${startedAt})...`);
  try {
    const sources = readSourcesConfig(SOURCES_CONFIG_PATH);
    if (!sources.length) {
      console.log(`[Sync] No sources configured at ${SOURCES_CONFIG_PATH}`);
      syncState.lastRun = {
        startedAt,
        finishedAt: new Date().toISOString(),
        ok: true,
        sources: [],
        totals: { added: 0, updated: 0, unchanged: 0, totalGames: gamesCatalog.length, downloadSourceCount: 0 },
      };
      return syncState.lastRun;
    }
    const result = await syncSources({
      sources,
      getCatalog: () => gamesCatalog,
      setCatalog: (next) => {
        gamesCatalog = next;
        scheduleCatalogSave();
      },
      enrich: true,
      maxEnrich: 60,
    });
    syncState.lastRun = result;
    console.log(
      `[Sync] Done in ${Date.parse(result.finishedAt) - Date.parse(result.startedAt)}ms — ` +
        `+${result.totals.added} added, ${result.totals.updated} updated, ` +
        `${result.totals.unchanged} unchanged, catalog is now ${result.totals.totalGames} games.`
    );
    for (const s of result.sources) {
      if (s.ok) {
        console.log(`[Sync]   ✓ ${s.name}: ${s.uniqueCount} titles`);
      } else {
        console.log(`[Sync]   ✗ ${s.name}: ${s.error}`);
      }
    }
    return result;
  } catch (e: any) {
    console.error(`[Sync] Failed:`, e.message);
    syncState.lastRun = {
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      error: e.message,
      sources: [],
      totals: { added: 0, updated: 0, unchanged: 0, totalGames: gamesCatalog.length, downloadSourceCount: 0 },
    };
    return syncState.lastRun;
  } finally {
    syncState.running = false;
  }
}

async function startServer() {
  gamesCatalog = loadGames();

  const app = express();
  app.use(compression());
  app.use(express.json({ limit: "50mb" }));

  // Static-catalog fallback: lets a static/offline build of the frontend load
  // the enriched catalog without the /api surface (gameContext falls back to
  // this when /api/games is unreachable).
  app.get("/games.json", (_req, res) => {
    try {
      // Short cache: the catalog only changes when the grind/enrichment writes,
      // so a 60s browser cache is safe and saves re-downloading the fallback.
      res.set("Cache-Control", "public, max-age=60");
      res.type("application/json").send(JSON.stringify(gamesCatalog));
    } catch (e: any) {
      res.status(500).json({ error: "Failed to serialize catalog fallback." });
    }
  });

  // Community layer: comments + ratings (persisted to data/)
  app.use("/api", communityRouter());

  // Scraper API (config-driven site scraping via Python/Scrapling engine)
  app.use("/api/scraper", scraperRouter());

  // Source sync control + status
  app.post("/api/admin/sync", async (_req, res) => {
    const result = await runSourceSync();
    res.json(result);
  });

  app.get("/api/admin/sync/status", (_req, res) => {
    const sources = readSourcesConfig(SOURCES_CONFIG_PATH).map((s) => ({
      name: s.name,
      category: s.category,
      enabled: s.enabled,
      url: s.url,
      filePath: s.filePath,
      note: s.note,
    }));
    res.json({
      running: syncState.running,
      lastRun: syncState.lastRun,
      sources,
      catalogSize: gamesCatalog.length,
      nextRunAt: new Date(Date.now() + SOURCE_SYNC_INTERVAL_MS).toISOString(),
      intervalMs: SOURCE_SYNC_INTERVAL_MS,
    });
  });

  // Public list of indexed sources — names only (no URLs exposed).
  app.get("/api/sources", (_req, res) => {
    try {
      const sources = readSourcesConfig(SOURCES_CONFIG_PATH)
        .filter((s) => s.enabled)
        .map((s) => ({ name: s.name, category: s.category }));
      res.json({ total: sources.length, sources });
    } catch (e: any) {
      console.error("[Sources] Failed to list sources:", e.message);
      res.status(500).json({ error: "Failed to list sources." });
    }
  });

  // A. Get Games Catalog (served from in-memory cache, with search/pagination)
  app.get("/api/games", (req, res) => {
    try {
      const numParam = (v: string | undefined): number | undefined => {
        if (v === undefined) return undefined;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : undefined;
      };
      const limit = numParam(req.query.limit as string | undefined);
      const offset = numParam(req.query.offset as string | undefined);
      const minRating = numParam(req.query.minRating as string | undefined);
      // `nsfw` is opt-out: omitting it keeps the historical "include" behaviour.
      const nsfw =
        req.query.nsfw === undefined
          ? undefined
          : req.query.nsfw === "1" || req.query.nsfw === "true";
      const { games, total } = applyQuery(gamesCatalog, {
        q: req.query.q as string | undefined,
        ids:
          typeof req.query.ids === "string" && req.query.ids.trim()
            ? req.query.ids.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined,
        limit,
        offset,
        sort: req.query.sort as string | undefined,
        genre: req.query.genre as string | undefined,
        developer: req.query.developer as string | undefined,
        year: req.query.year as string | undefined,
        minRating,
        classic: req.query.classic === "1" || req.query.classic === "true",
        coverless: req.query.coverless === "1" || req.query.coverless === "true",
        nsfw,
      });
      // `full=1` opts out of the card projection (e.g. debugging / tooling).
      const full = req.query.full === "1" || req.query.full === "true";
      res.json({
        total,
        offset: offset ?? 0,
        limit: limit ?? total,
        games: full ? games : games.map(toCardGame),
      });
    } catch (e: any) {
      console.error("[Backend Games Load Error]:", e.message);
      res.status(500).json({ error: "Failed to load game collection." });
    }
  });

  // A1b. Facets — the dropdown/filter taxonomies (genres + counts, developers,
  // years) plus catalog totals. Computed once per catalog revision and cached,
  // so a client in server-browse mode never has to hold the full catalog just
  // to populate its filter sidebar.
  const DEV_FACET_CAP = 2000;
  let facetsCache: { key: string; body: unknown } | null = null;
  app.get("/api/games/facets", (req, res) => {
    try {
      const nsfw =
        req.query.nsfw === undefined
          ? true
          : req.query.nsfw === "1" || req.query.nsfw === "true";
      // Facets are recomputed only when the catalog revision changes, so a
      // 60s browser cache is safe and spares repeated clients the scan.
      res.set("Cache-Control", "public, max-age=60");
      const key = `${catalogRevision}:${nsfw}`;
      if (facetsCache && facetsCache.key === key) return res.json(facetsCache.body);

      const genreMap = new Map<string, number>();
      const devMap = new Map<string, number>();
      const years = new Set<string>();
      let nsfwCount = 0;
      for (const g of gamesCatalog) {
        if (isNsfwGame(g)) nsfwCount++;
      }
      const pool = nsfw ? gamesCatalog : gamesCatalog.filter((g) => !isNsfwGame(g));
      const now = Date.now();
      const daysSince = (iso: string) => {
        const t = Date.parse(iso || "");
        return Number.isNaN(t) ? Infinity : (now - t) / 86_400_000;
      };
      let downloads = 0;
      let updated30 = 0;
      for (const g of pool) {
        for (const genre of g.genres || []) genreMap.set(genre, (genreMap.get(genre) || 0) + 1);
        if (g.developer) devMap.set(g.developer, (devMap.get(g.developer) || 0) + 1);
        const y = (g.releaseDate || "").match(/(19|20)\d{2}/)?.[0];
        if (y) years.add(y);
        downloads += g.stats?.downloads ?? 0;
        if (daysSince(g.stats?.updatedAt || "") <= 30) updated30++;
      }
      const body = {
        total: pool.length,
        nsfwCount,
        revision: catalogRevision,
        genreCount: genreMap.size,
        downloads,
        updated30,
        genres: [...genreMap.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        developers: [...devMap.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, DEV_FACET_CAP)
          .map(([name, count]) => ({ name, count })),
        years: [...years].sort((a, b) => Number(b) - Number(a)),
      };
      facetsCache = { key, body };
      res.json(body);
    } catch (e: any) {
      console.error("[Facets Error]:", e.message);
      res.status(500).json({ error: "Failed to compute catalog facets." });
    }
  });

  // A1c. Series / Collections — franchises grouped from data/collections.json
  // (curated) plus auto-detected series derived from normalized titles. The
  // whole catalog is scanned once per revision and cached; the index payload
  // stays covers+counts, and a follow-up call fetches a single series' games.
  const SERIES_GAME_CAP = 500;
  let seriesCache: {
    key: string;
    index: SeriesSummary[];
    groups: {
      id: string;
      name: string;
      description?: string;
      curated?: boolean;
      badge?: string;
      total: number;
      games: ReturnType<typeof toCardGame>[];
    }[];
    groupCount: number;
  } | null = null;
  function getSeriesCatalog() {
    const key = `${catalogRevision}`;
    if (seriesCache && seriesCache.key === key) return seriesCache;
    const { groups, index } = buildSeriesCatalog(gamesCatalog, readCuratedCollections());
    const groupList = Array.from(groups.values()).map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      curated: group.curated,
      badge: group.badge,
      total: group.games.length,
      games: group.games.slice(0, SERIES_GAME_CAP).map(toCardGame),
    }));
    seriesCache = { key, index, groups: groupList, groupCount: groupList.length };
    return seriesCache;
  }

  app.get("/api/series", (req, res) => {
    try {
      res.set("Cache-Control", "public, max-age=60");
      const numParam = (v: string | undefined): number | undefined => {
        if (v === undefined) return undefined;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : undefined;
      };
      const limit = numParam(req.query.limit as string | undefined);
      const offset = numParam(req.query.offset as string | undefined);
      const minCount = numParam(req.query.minCount as string | undefined);
      // `curated=1` narrows the index to featured franchises only.
      const curated = req.query.curated === "1" || req.query.curated === "true";
      const q = (req.query.q as string | undefined)?.trim().toLowerCase();

      let list = getSeriesCatalog().index;
      // Curated-only / featured toggle.
      if (curated) list = list.filter((s) => s.curated);
      // Size floor — drops the noisy 2-game auto-series when requested.
      if (minCount !== undefined && minCount > 0) {
        list = list.filter((s) => s.count >= minCount);
      }
      if (q) {
        list = list.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.description || "").toLowerCase().includes(q) ||
            (s.badge || "").toLowerCase().includes(q)
        );
      }

      const total = list.length;
      const page = list.slice(offset ?? 0, (offset ?? 0) + (limit ?? total));
      res.json({ total, offset: offset ?? 0, limit: limit ?? total, series: page });
    } catch (e: any) {
      console.error("[Series Error]:", e.message);
      res.status(500).json({ error: "Failed to compute series index." });
    }
  });

  app.get("/api/series/:id", (req, res) => {
    try {
      res.set("Cache-Control", "public, max-age=60");
      const { groups } = getSeriesCatalog();
      const group = groups.find((s) => s.id === req.params.id);
      if (!group) return res.status(404).json({ error: "Series not found." });
      res.json(group);
    } catch (e: any) {
      console.error("[Series Error]:", e.message);
      res.status(500).json({ error: "Failed to load series." });
    }
  });

  // A2. Lightweight catalog version — lets clients detect changes without
  // re-downloading the entire catalog. Bumps whenever the catalog is mutated.
  app.get("/api/catalog/version", (_req, res) => {
    res.json({ version: `${gamesCatalog.length}:${catalogRevision}` });
  });

  // A2b. Catalog health — the last invariant-checker snapshot (field coverage,
  // placeholder counts, warnings). Read-only; powers the Sources health panel.
  const HEALTH_SNAPSHOT_PATH = path.join(process.cwd(), "data", "snapshots", "latest.json");
  let healthCache: { mtime: number; body: string } | null = null;
  app.get("/api/catalog/health", (_req, res) => {
    try {
      if (!fs.existsSync(HEALTH_SNAPSHOT_PATH)) {
        return res
          .status(404)
          .json({ error: "No catalog snapshot yet — run `npm run check:catalog`." });
      }
      const { mtimeMs } = fs.statSync(HEALTH_SNAPSHOT_PATH);
      if (!healthCache || healthCache.mtime !== mtimeMs) {
        healthCache = { mtime: mtimeMs, body: fs.readFileSync(HEALTH_SNAPSHOT_PATH, "utf8") };
      }
      res.type("application/json").send(healthCache.body);
    } catch (e: any) {
      console.error("[Health] Failed to read snapshot:", e.message);
      res.status(500).json({ error: "Failed to read catalog health." });
    }
  });

  // A3. Lazy description for card hovers — the list payload omits summaries.
  app.get("/api/games/:id/summary", (req, res) => {
    const game = gamesCatalog.find((g) => g.id === req.params.id);
    if (!game) return res.status(404).json({ error: `Game with ID '${req.params.id}' not found.` });
    const summary = typeof game.summary === "string" ? game.summary.slice(0, SUMMARY_CARD_CAP) : "";
    res.json({ id: game.id, summary });
  });

  // A4. Related games — same-genre neighbours ranked by shared genres and
  // popularity. Lets the detail page avoid loading the whole catalog.
  app.get("/api/games/:id/related", (req, res) => {
    try {
      const game = gamesCatalog.find((g) => g.id === req.params.id);
      if (!game) return res.status(404).json({ error: `Game with ID '${req.params.id}' not found.` });
      const nsfw = req.query.nsfw === "1" || req.query.nsfw === "true";
      const requested = Number(req.query.limit);
      const limit = Number.isFinite(requested) && requested > 0 ? Math.min(60, requested) : 12;
      const genres = new Set((game.genres || []).map((x) => x.toLowerCase().trim()));
      const ranked = gamesCatalog
        .filter((g) => g.id !== game.id && (nsfw || !isNsfwGame(g)))
        .map((g) => {
          let shared = 0;
          for (const x of g.genres || []) if (genres.has(x.toLowerCase().trim())) shared++;
          return { g, shared };
        })
        .filter((s) => s.shared > 0)
        .sort((a, b) => b.shared - a.shared || (b.g.popularityScore ?? 0) - (a.g.popularityScore ?? 0))
        .slice(0, limit)
        .map((s) => toCardGame(s.g));
      res.set("Cache-Control", "public, max-age=60");
      res.json({ id: game.id, games: ranked });
    } catch (e: any) {
      console.error("[Related Error]:", e.message);
      res.status(500).json({ error: "Failed to compute related games." });
    }
  });

  // B. Get specific Game
  app.get("/api/games/:id", (req, res) => {
    const game = gamesCatalog.find((g) => g.id === req.params.id);
    if (game) {
      res.json(game);
    } else {
      res.status(404).json({ error: `Game with ID '${req.params.id}' not found.` });
    }
  });

  // C. Fetch Enriched Real-time Metadata from Steam/IGDB APIs
  app.get("/api/games/:id/metadata", async (req, res) => {
    const gameId = req.params.id;
    const clientIp = req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "127.0.0.1";

    // Rate Limiting Control Check
    if (!checkBackendRateLimit(clientIp)) {
      console.warn(`[Rate Limit Hook] Rate limit exceeded for client IP: ${clientIp}`);
      return res.status(429).json({
        error: "Too Many Requests",
        message: "You are making metadata requests too frequently. Please wait a minute and load again to protect Steam/IGDB bandwidth limit."
      });
    }

    const game = gamesCatalog.find((g) => g.id === gameId);
    if (!game) {
      return res.status(404).json({ error: "Enrichment request game target not found." });
    }

    try {
      // Fetch dynamic metadata asynchronously via Steam Store App Details or IGDB API.
      // IGDB is skipped for Steam-tagged games that already carry a cover: Steam
      // supplies every textual field and the cover is derived from the appid, so
      // consulting IGDB there would only burn quota to re-prove a known title.
      // Retro rows (classic PS2/SNES-era) go to IGDB in "retro" mode so an
      // exact-title tie picks the original-era entry, never a same-named modern
      // sequel (e.g. "God of War" PS2 vs the 2018 Norse game).
      const rowEra = game.classic ? "retro" : classifyEra(game).era;
      const preferRetro = rowEra === "retro";
      const skipIgdb = Boolean(!preferRetro && game.steamId && game.coverImage && !(game.coverImage.includes("placeholder") || game.coverImage.includes("coming-soon")));
      const metadata = await getGameMetadata(game.id, game.title, game.steamId, game.gogId, { skipIgdb, preferRetro, igdbId: game.igdbId });

      // Persist newly-pulled metadata back into the catalog so a single visit
      // makes the enrichment permanent instead of re-fetching it forever.
      let mutated = false;
      if (metadata.summary && !metadata.summary.includes("fantastic game curated") && shouldUpgradeSummary(game.summary, metadata.summary) && metadata.summary !== game.summary) {
        game.summary = metadata.summary;
        mutated = true;
      }
      if (metadata.developer && !metadata.developer.includes("Unknown Developer") && devIsPlaceholder(game.developer) && metadata.developer !== game.developer) {
        game.developer = metadata.developer;
        mutated = true;
      }
      if (metadata.publisher && !metadata.publisher.includes("Unknown Publisher") && devIsPlaceholder(game.publisher) && metadata.publisher !== game.publisher) {
        game.publisher = metadata.publisher;
        mutated = true;
      }
      if (metadata.releaseDate && !metadata.releaseDate.includes("Unknown") && !metadata.releaseDate.includes("Coming soon") && (!game.releaseDate || game.releaseDate.includes("Unknown") || game.releaseDate.includes("Coming soon")) && metadata.releaseDate !== game.releaseDate) {
        game.releaseDate = metadata.releaseDate;
        mutated = true;
      }
      if (metadata._ratingReal && metadata.rating && game.rating === 0) {
        game.rating = metadata.rating;
        mutated = true;
      }
      const realScreenshots = (metadata.screenshots || []).filter((u) => !u.includes("unsplash"));
      if (realScreenshots.length > 0 && setRealScreenshots(game, realScreenshots)) {
        mutated = true;
      }
      const reqs = parseSteamPcRequirements(metadata.steamDetails?.pcSpecs);
      if (reqs && !game.systemRequirements?.windows?.minimum?.os) {
        game.systemRequirements = game.systemRequirements || {};
        game.systemRequirements.windows = reqs;
        mutated = true;
      }
      const macReqs = parseSteamPcRequirements(metadata.steamDetails?.macSpecs);
      if (macReqs && !game.systemRequirements?.mac?.minimum?.os) {
        game.systemRequirements = game.systemRequirements || {};
        game.systemRequirements.mac = macReqs;
        mutated = true;
      }
      const linuxReqs = parseSteamPcRequirements(metadata.steamDetails?.linuxSpecs);
      if (linuxReqs && !game.systemRequirements?.linux?.minimum?.os) {
        game.systemRequirements = game.systemRequirements || {};
        game.systemRequirements.linux = linuxReqs;
        mutated = true;
      }
      const extraGenres = matchGenres(metadata.summary || "", game.genres || []);
      if (extraGenres.length > 0) {
        game.genres = [...(game.genres || []), ...extraGenres].slice(0, 12);
        mutated = true;
      }
      const steamGenres = (metadata.genres || []).filter(
        (g: string) => !(game.genres || []).some((x: string) => x.toLowerCase() === g.toLowerCase())
      );
      if (steamGenres.length > 0) {
        game.genres = [...(game.genres || []), ...steamGenres].slice(0, 12);
        mutated = true;
      }
      if (metadata.trailers?.length && JSON.stringify(game.trailers || []) !== JSON.stringify(metadata.trailers)) {
        game.trailers = metadata.trailers;
        mutated = true;
      }
      // Align the cover to the game's own Steam art when (and only when) this
      // live fetch VERIFIED the appid belongs to this title (metadata.verifiedTitle
      // is Steam's own reported name — title-with-itself guards are no-ops).
      if (
        game.steamId != null &&
        metadata.verifiedTitle &&
        !steamTitleMismatch(game.title, metadata.verifiedTitle)
      ) {
        const coverAppid = (game.coverImage || "").match(/\/apps\/(\d+)\//)?.[1];
        if (coverAppid && coverAppid !== String(game.steamId)) {
          game.coverImage = `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamId}/library_600x900.jpg`;
          mutated = true;
        }
      }
      if (metadata.linux && (metadata.linux.native || metadata.linux.tier) && JSON.stringify(game.linux || {}) !== JSON.stringify(metadata.linux)) {
        game.linux = { ...(game.linux || {}), ...metadata.linux };
        mutated = true;
      }
      if (mutated) scheduleCatalogSave();

      res.json(metadata);
    } catch (error: any) {
      if (error.message === "RATE_LIMIT_EXCEEDED") {
        return res.status(429).json({
          error: "Rate Limit Exceeded",
          message: "The Steam/IGDB database API returned rate limit constraints. Serving high-fidelity fallback details."
        });
      }
      console.error(`[Metadata Route Error] Failed to enrich metadata for ${gameId}:`, error);
      res.status(500).json({ error: "Failed to fetch metadata from Steam/IGDB APIs." });
    }
  });

  // Steam Search Endpoint
  app.get("/api/steam/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ error: "Missing search term 'q'." });
      }

      console.log(`[Steam Search] Searching store for: "${query}"`);
      const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=US&l=en`;
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ZakurosArchive/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`Steam responded with status code: ${response.status}`);
      }

      const data = await response.json() as any;
      if (data && data.items) {
        res.json(data.items);
      } else {
        res.json([]);
      }
    } catch (e: any) {
      console.error("[Steam Search Error]:", e.message);
      res.status(500).json({ error: "Failed to query Steam Search API." });
    }
  });

  // Steam App Details Extractor
  app.get("/api/steam/details/:appid", async (req, res) => {
    try {
      const appid = parseInt(req.params.appid, 10);
      if (isNaN(appid)) {
        return res.status(400).json({ error: "Invalid Steam App ID." });
      }

      console.log(`[Steam Details] Extracting details for appID: ${appid}`);
      const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`;
      const response = await fetch(detailsUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ZakurosArchive/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`Steam responded with status: ${response.status}`);
      }

      const json = await response.json() as any;
      const appInfo = json[appid.toString()];

      if (!appInfo || !appInfo.success || !appInfo.data) {
        return res.status(404).json({ error: "Steam returned no details for this App ID." });
      }

      const data = appInfo.data;

      // Extract system requirements HTML and parse it
      const pcRequirements = data.pc_requirements || {};
      const minHtml = pcRequirements.minimum || "";
      
      const parseField = (html: string, keyword: string): string => {
        if (!html) return "";
        const cleanHtml = html.replace(/<[^>]+>/g, " ");
        const regex = new RegExp(`${keyword}\\s*:\\s*([^:\\n\\r•]+)`, "i");
        const match = cleanHtml.match(regex);
        if (match && match[1]) {
          return match[1].trim().replace(/\s+/g, " ");
        }
        return "";
      };

      const os = parseField(minHtml, "OS") || "Windows 10 64-bit";
      const processor = parseField(minHtml, "Processor") || "Intel Core i5 / AMD Ryzen 5";
      const memory = parseField(minHtml, "Memory") || "8 GB RAM";
      const graphics = parseField(minHtml, "Graphics") || "NVIDIA GTX 1060 / AMD RX 580";
      const storage = parseField(minHtml, "Storage") || "50 GB available space";

      // Format response ready for client pre-fills
      const mappedGame = {
        title: data.name,
        developer: data.developers ? data.developers.join(", ") : "Unknown",
        publisher: data.publishers ? data.publishers.join(", ") : "Unknown",
        genres: data.genres ? data.genres.map((g: any) => g.description) : ["Action"],
        releaseDate: data.release_date ? data.release_date.date : "",
        rating: data.metacritic ? data.metacritic.score : 85,
        summary: data.short_description || data.about_the_game || "",
        coverImage: `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
        screenshot: data.screenshots && data.screenshots.length > 0 ? data.screenshots[0].path_full : `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
        systemRequirements: {
          windows: {
            minimum: {
              os,
              processor,
              memory,
              graphics,
              storage
            }
          }
        },
        steamId: appid
      };

      res.json(mappedGame);
    } catch (e: any) {
      console.error("[Steam Details Error]:", e.message);
      res.status(500).json({ error: "Failed to extract dynamic details from Steam." });
    }
  });

  // POST Create Game
  app.post("/api/games", (req, res) => {
    try {
      const newGame: Game = req.body;
      if (!newGame.id || !newGame.title) {
        return res.status(400).json({ error: "Missing required fields (id, title)." });
      }

      // Check duplicate
      if (gamesCatalog.some(g => g.id === newGame.id)) {
        return res.status(400).json({ error: `Game with ID "${newGame.id}" already exists.` });
      }

      // Default ratings/views/downloads
      if (!newGame.stats) {
        newGame.stats = {
          downloads: Math.floor(Math.random() * 450) + 12,
          views: Math.floor(Math.random() * 2000) + 50,
          updatedAt: new Date().toISOString().split("T")[0]
        };
      }

      gamesCatalog = [newGame, ...gamesCatalog];
      scheduleCatalogSave();
      res.status(201).json(newGame);
    } catch (e: any) {
      console.error("[Post Game Error]:", e.message);
      res.status(500).json({ error: "Failed to add game to catalog." });
    }
  });

  // POST Bulk Import Games
  app.post("/api/games/bulk", (req, res) => {
    try {
      const payload = req.body;
      const { replace, games: importedGames } = payload;

      if (!Array.isArray(importedGames)) {
        return res.status(400).json({ error: "Invalid payload. 'games' field must be an array." });
      }

      // Check structure of each game
      const validated: Game[] = [];
      for (const item of importedGames) {
        if (!item.id || !item.title) {
          return res.status(400).json({ error: `Game validation failed. Missing required fields (id, title) on item: ${JSON.stringify(item).slice(0, 80)}...` });
        }
        
        // Ensure standard properties exist
        const gameItem: Game = {
          id: item.id.toString(),
          title: item.title.toString(),
          developer: item.developer ? item.developer.toString() : "Unknown",
          publisher: item.publisher ? item.publisher.toString() : "Unknown",
          genres: Array.isArray(item.genres) ? item.genres : ["Action"],
          releaseDate: item.releaseDate ? item.releaseDate.toString() : "",
          rating: typeof item.rating === "number" ? item.rating : 85,
          fileSize: item.fileSize ? item.fileSize.toString() : "Unknown Size",
          magnetLink: item.magnetLink ? item.magnetLink.toString() : "",
          coverImage: item.coverImage ? item.coverImage.toString() : "",
          screenshot: item.screenshot ? item.screenshot.toString() : "",
          summary: item.summary ? item.summary.toString() : "",
          systemRequirements: item.systemRequirements || {
            windows: {
              minimum: {
                os: "Windows 10 64-bit",
                processor: "Intel Core i5 / AMD Ryzen 5",
                memory: "8 GB RAM",
                graphics: "NVIDIA GTX 1060 / AMD RX 580",
                storage: "50 GB"
              }
            }
          },
          stats: item.stats || {
            downloads: Math.floor(Math.random() * 450) + 12,
            views: Math.floor(Math.random() * 2000) + 50,
            updatedAt: new Date().toISOString().split("T")[0]
          },
          steamId: typeof item.steamId === "number" ? item.steamId : undefined,
          igdbId: typeof item.igdbId === "number" ? item.igdbId : undefined,
          downloadSources: Array.isArray(item.downloadSources) ? item.downloadSources : undefined
        };
        validated.push(gameItem);
      }

      let finalGames: Game[];
      if (replace) {
        finalGames = validated;
      } else {
        // Merge - avoid duplicate ids by mapping
        const gameMap = new Map<string, Game>();
        gamesCatalog.forEach(g => gameMap.set(g.id, g));
        validated.forEach(g => gameMap.set(g.id, g)); // overwrites existing IDs on match
        finalGames = Array.from(gameMap.values());
      }

      gamesCatalog = finalGames;
      scheduleCatalogSave();
      res.json({ success: true, count: validated.length, total: finalGames.length });
    } catch (e: any) {
      console.error("[Bulk Import Error]:", e.message);
      res.status(500).json({ error: "Failed to persist bulk imported games." });
    }
  });

  // Integrated Vite Middleware for development SPA Fallbacks
  if (process.env.NODE_ENV !== "production") {
    console.log("[Vite] Attaching Vite Development Server Middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[Production] Hosting client assets in production static mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Zakuro's Archive App running on http://0.0.0.0:${PORT}`);
    console.log(`[Sync] Background source sync scheduled every ${SOURCE_SYNC_INTERVAL_MS / 60000} minutes.`);
    if (process.env.SKIP_BOOT_SYNC === "1") {
      console.log("[Sync] SKIP_BOOT_SYNC=1 — skipping boot-time source sync.");
    } else {
      void runSourceSync();
    }
    setInterval(() => {
      void runSourceSync();
    }, SOURCE_SYNC_INTERVAL_MS);
    // While the metadata grind holds the lock, reload the enriched catalog from
    // disk every ~2 min so new steam/proton/screenshot fields show up live
    // (persistence stays disabled; only reads happen here). When the grind ENDS
    // (lock released) reload once more so we never persist a pre-grind snapshot
    // over its final output.
    let grindWasActive = grindActive();
    setInterval(() => {
      const active = grindActive();
      if (active) {
        console.log("[Sync] Grind active — hot-reloading catalog from disk.");
        gamesCatalog = loadGames();
      } else if (grindWasActive) {
        console.log("[Sync] Grind finished — reloading final catalog from disk.");
        gamesCatalog = loadGames();
      }
      grindWasActive = active;
    }, 120000);
  });
}

startServer().catch((e) => {
  console.error("[Server Boot Failure]:", e);
  process.exit(1);
});