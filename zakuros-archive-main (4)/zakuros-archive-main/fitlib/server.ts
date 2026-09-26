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
  SourceRunResult,
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

// Track when the next scheduled (or boot) sync will actually fire, so the status
// endpoint and the secret sources page can show a real countdown instead of the
// previous "now + interval" guess.
let nextSyncAtMs = Date.now() + SOURCE_SYNC_INTERVAL_MS;

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
  nextSyncAtMs = Date.now() + SOURCE_SYNC_INTERVAL_MS;
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

// ── Secret sources page ───────────────────────────────────────────────────────
// Hidden admin page (no links anywhere in the UI) showing the state of every
// configured source, the local scraped .json files we hold for them, when the
// next sync fires, and last-run health. Deliberately plain HTML.
function secEsc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

function fmtBytes(n: number | undefined | null): string {
  if (!n || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(2)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function fmtDur(ms: number): string {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtAge(iso: string | undefined, nowMs: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  const diff = nowMs - t;
  if (diff < 0) return "in the future";
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ${Math.floor((diff % 3600_000) / 60_000)}m ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function localFileFor(s: { filePath?: string; scraper?: string }): string | null {
  if (s.filePath) return s.filePath;
  if (typeof s.scraper === "string" && s.scraper.startsWith("cfg:")) {
    return path.join("data", "scraped", `${s.scraper.slice(4).replace(/\.json$/i, "")}.json`);
  }
  return null;
}

function readScrapedStats(rel: string): { count: number; uris: number; name?: string } {
  const abs = path.join(process.cwd(), rel);
  try {
    if (!fs.existsSync(abs)) return { count: 0, uris: 0 };
    const j = JSON.parse(fs.readFileSync(abs, "utf8")) as any;
    const dl = Array.isArray(j?.downloads) ? j.downloads : [];
    const uris = dl.reduce((n: number, x: any) => n + (Array.isArray(x?.uris) ? x.uris.length : 0), 0);
    return { count: dl.length, uris, name: typeof j?.name === "string" ? j.name : undefined };
  } catch {
    return { count: -1, uris: 0 };
  }
}

function renderSecretSources(): string {
  const nowMs = Date.now();
  const sources = readSourcesConfig(SOURCES_CONFIG_PATH);
  const interval = SOURCE_SYNC_INTERVAL_MS;
  const nextIn = Math.max(0, nextSyncAtMs - nowMs);
  const sync = syncState.lastRun;

  const lastByName = new Map<string, SourceRunResult>();
  if (sync) for (const s of sync.sources) lastByName.set(s.name, s);

  let snap: { generatedAt?: string; catalogBytes?: number; total?: number; placeholders?: Record<string, number> } = {};
  try {
    const p = path.join(process.cwd(), "data", "snapshots", "latest.json");
    if (fs.existsSync(p)) snap = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    /* ignore snapshot failures */
  }

  const rows = sources.map((s) => {
    const rel = localFileFor(s);
    let info: { kind: "file"; rel: string; exists: boolean; sizeBytes?: number; mtime?: string; entries: number; uris: number } | { kind: "remote" } = { kind: "remote" };
    if (rel) {
      const abs = path.join(process.cwd(), rel);
      if (!fs.existsSync(abs)) {
        info = { kind: "file", rel, exists: false, entries: 0, uris: 0 };
      } else {
        const stats = readScrapedStats(rel);
        const st = fs.statSync(abs);
        info = {
          kind: "file",
          rel,
          exists: true,
          sizeBytes: st.size,
          mtime: st.mtime.toISOString(),
          entries: stats.count,
          uris: stats.uris,
        };
      }
    }
    return { s, info, last: lastByName.get(s.name) };
  });

  const stale = (mtime?: string) => (mtime ? nowMs - Date.parse(mtime) > interval : false);

  const part = `\
<!doctype html>
<html>
<head><meta charset="utf-8"><title>secret sources</title>
<style>
 body{font-family:monospace;font-size:12px;background:#111;color:#ddd;padding:16px;}
 h1,h2{color:#fff} table{border-collapse:collapse;width:100%;margin-top:8px}
 th,td{text-align:left;padding:3px 8px;border:1px solid #333;vertical-align:top}
 th{background:#222;color:#9cf} tr.bad{background:#3a1414} tr.remote{color:#888}
 .ok{color:#6f6}.err{color:#f66}.dim{color:#888}.warn{color:#fa0}
 .chip{display:inline-block;padding:0 5px;border-radius:3px;background:#222;border:1px solid #444;margin:2px 4px 2px 0}
 a{color:#8cf}
</style>
</head>
<body>
<h1>secret sources</h1>
<p><a href="/secret-sources/file?rel=${encodeURIComponent("data/sources.json")}">view sources.json</a> · <a href="/secret-sources/file?rel=${encodeURIComponent("data/scraper-sites.json")}">view scraper-sites.json</a> · <a href="/secret-scraper">live scraper panel</a></p>
<p class="chip">catalog: <b>${gamesCatalog.length}</b> games</p>
<p class="chip">interval: every <b>${Math.round(interval / 3600_000)}h</b></p>
<p class="chip">next sync in: <b class="${nextIn === 0 ? "warn" : "ok"}">${fmtDur(nextIn)}</b> (at ${new Date(nextSyncAtMs).toISOString()})</p>
<p class="chip">sync running: <b>${syncState.running ? "YES" : "no"}</b></p>
<p class="chip">config sources: <b>${sources.length}</b> (enabled: ${sources.filter((s) => s.enabled).length})</p>
<h2>sync</h2>
${
  sync
    ? `\
<p>last run: <b class="${sync.ok ? "ok" : "err"}">${sync.ok ? "OK" : "FAILED"}</b> started ${fmtAge(sync.startedAt, nowMs)} — finished ${fmtAge(sync.finishedAt, nowMs)} (${fmtDur(Date.parse(sync.finishedAt) - Date.parse(sync.startedAt))})${sync.error ? ` <span class="err">error: ${secEsc(sync.error)}</span>` : ""}</p>
<p>totals: <b>+${sync.totals.added}</b> added · <b>+${sync.totals.updated}</b> updated · <b>${sync.totals.unchanged}</b> unchanged · catalog now <b>${sync.totals.totalGames}</b> games · downloading sources <b>${sync.totals.downloadSourceCount}</b></p>`
    : '<p class="dim">no sync run yet this boot.</p>'
}
<h2>health snapshot (data/snapshots/latest.json)</h2>
${snap.total
  ? `\
<p class="chip">generated: ${fmtAge(snap.generatedAt, nowMs)}</p>
<p class="chip">total: <b>${snap.total}</b></p>
<p class="chip">catalog on disk: ${fmtBytes(snap.catalogBytes)}</p>
<p class="chip">placeholder summaries: ${snap.placeholders?.summaries ?? "—"}</p>
<p class="chip">placeholder developers: ${snap.placeholders?.developers ?? "—"}</p>
<p class="chip">placeholder screenshots: ${snap.placeholders?.screenshots ?? "—"}</p>`
  : '<p class="dim">no snapshot yet.</p>'}
<h2>sources</h2>
<table>
<tr><th>name</th><th>cat</th><th>enabled</th><th>type</th><th>local file</th><th>file state</th><th>entries / links</th><th>last run</th><th>note</th></tr>
${rows
  .map(({ s, info, last }) => {
    const isRemote = info.kind === "remote";
    const missing = info.kind === "file" && !info.exists;
    const isBad = missing || last?.ok === false;
    const entries =
      info.kind === "file" ? (info.entries < 0 ? '<span class="err">parse error</span>' : `${info.entries}`) : '<span class="dim">n/a</span>';
    const links = info.kind === "file" ? (info.entries < 0 ? "—" : `${info.uris}`) : '<span class="dim">n/a</span>';
    const fileCell =
      info.kind === "remote"
        ? `<a href="/secret-sources/fetch?url=${encodeURIComponent(s.url || "")}">fetch remote</a>`
        : `<code>${secEsc(info.rel)}</code> <a href="/secret-sources/file?rel=${encodeURIComponent(info.rel)}">view</a>`;
    const stateCell = isRemote
      ? '<span class="dim">—</span>'
      : info.exists
        ? `exists · ${fmtBytes(info.sizeBytes)} · <span class="${stale(info.mtime) ? "warn" : "dim"}">${fmtAge(info.mtime, nowMs)}</span>${stale(info.mtime) ? ' <b class="warn">STALE</b>' : ""}`
        : '<span class="err">MISSING FILE</span>';
    const runCell = !last
      ? '<span class="dim">no run this boot</span>'
      : `${last.ok ? `<b class="ok">ok</b>` : `<b class="err">fail</b>`} · raw ${last.rawCount} · unique ${last.uniqueCount}${last.error ? ` <span class="err">${secEsc(last.error)}</span>` : ""}`;
    const typeCell = isRemote ? `<span class="dim">${s.scraper ? `cfg:${secEsc(String(s.scraper))}` : "remote url"}</span>` : `<span>${secEsc(s.scraper || "file")}</span>`;
    return `\
<tr class="${isBad ? "bad" : isRemote ? "remote" : ""}">
<td><b>${secEsc(s.name)}</b></td>
<td>${secEsc(s.category)}</td>
<td>${s.enabled ? '<span class="ok">yes</span>' : '<span class="err">no</span>'}</td>
<td>${typeCell}</td>
<td>${fileCell}</td>
<td>${stateCell}</td>
<td>${entries} / ${links}</td>
<td>${runCell}</td>
<td class="dim">${secEsc(s.note || "")}</td>
</tr>`;
  })
  .join("\n")}
</table>
</body>
</html>`;

  return part;
}

// ── Secret JSON viewer ────────────────────────────────────────────────────────
// Allow-list of local files that the secret page may display. Built from the
// sources config (local filePath or cfg: scraper files) plus the two config
// files the page links to. Nothing else may be read via ?rel=.
function sourceLocalFiles(): Set<string> {
  const set = new Set<string>();
  for (const s of readSourcesConfig(SOURCES_CONFIG_PATH)) {
    const lf = localFileFor(s);
    if (lf) set.add(path.normalize(lf));
  }
  set.add(path.normalize("data/sources.json"));
  set.add(path.normalize("data/scraper-sites.json"));
  // Scraper output files can be browsed too (data/scraped/<key>.json).
  try {
    for (const f of fs.readdirSync(path.join(process.cwd(), "data", "scraped"))) {
      if (f.endsWith(".json")) set.add(path.normalize(path.join("data", "scraped", f)));
    }
  } catch {}
  return set;
}

const JSON_VIEW_STYLES =
  "body{font-family:monospace;font-size:12px;background:#111;color:#ddd;padding:16px;}h1{color:#fff}a{color:#8cf}" +
  "pre{background:#0c0c0c;border:1px solid #333;padding:10px;overflow:auto;max-height:88vh;white-space:pre-wrap;word-break:break-all;}" +
  ".chip{display:inline-block;padding:0 5px;border-radius:3px;background:#222;border:1px solid #444;margin:2px 4px 2px 0}" +
  ".err{color:#f66}";

function jsonViewShell(title: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>${JSON_VIEW_STYLES}</style></head><body>${inner}</body></html>`;
}

function renderFileView(relNorm: string, st: fs.Stats, body: string): string {
  return jsonViewShell(
    `json: ${path.basename(relNorm)}`,
    `<h1>json view</h1><p><a href="/secret-sources">&larr; secret sources</a></p>` +
      `<p class="chip"><code>${secEsc(relNorm)}</code></p>` +
      `<p class="chip">${fmtBytes(st.size)}</p>` +
      `<p class="chip">modified ${fmtAge(st.mtime.toISOString(), Date.now())}</p>` +
      `<p class="chip">${body.length.toLocaleString()} chars</p>` +
      `<pre>${secEsc(body)}</pre>`,
  );
}

function renderRemoteView(url: string, status: number, body: string): string {
  return jsonViewShell(
    `remote json: ${url.slice(0, 60)}`,
    `<h1>remote json view</h1><p><a href="/secret-sources">&larr; secret sources</a></p>` +
      `<p class="chip"><code>${secEsc(url)}</code></p>` +
      `<p class="chip">status ${status}</p>` +
      `<pre>${secEsc(body)}</pre>`,
  );
}

const DATA_PAGE_SIZE = 300;

function entriesOfScraped(data: Record<string, unknown> | unknown[]): { title?: string; fileSize?: string; uris?: { url: string; name?: string }[] }[] {
  if (Array.isArray(data)) return data as any[];
  const d = data as { downloads?: any[] };
  if (d && Array.isArray(d.downloads)) return d.downloads;
  return [];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

// Browsable paginated view of a scraper's output file (data/scraped/<key>.json),
// e.g. every game pulled from GoG Revived with each download link.
function renderScrapedDataView(key: string, st: fs.Stats, data: Record<string, unknown> | unknown[], page: number, q: string): string {
  const all = entriesOfScraped(data);
  let rows = all;
  if (q) {
    const needle = q.toLowerCase();
    rows = all.filter((e) => String(e.title || "").toLowerCase().includes(needle));
  }
  const pages = Math.max(1, Math.ceil(rows.length / DATA_PAGE_SIZE));
  const cur = Math.min(Math.max(1, page), pages);
  const start = (cur - 1) * DATA_PAGE_SIZE;
  const slice = rows.slice(start, start + DATA_PAGE_SIZE);
  const esc = (s: string) => secEsc(s);

  const body = slice
    .map((e, i) => {
      const idx = start + i + 1;
      const uris = e.uris || [];
      const chips = uris
        .map(
          (u) =>
            `<a class="u" target="_blank" rel="noopener" href="${esc(u.url)}" title="${esc(u.name || u.url)}">${esc(hostOf(u.url))}<span class="fn">${esc((u.name || "").replace(/^[^ ]+ ·\s*/, ""))}</span></a>`,
        )
        .join("");
      return (
        `<div class="g">` +
        `<span class="n">${idx}</span><span class="t">${esc(e.title || "<no title>")}</span>` +
        `<span class="s">${esc(e.fileSize || "")}</span>` +
        `<span class="c">${uris.length} link${uris.length === 1 ? "" : "s"}</span>` +
        `<div class="urow">${chips || '<span class="dim">no links</span>'}</div>` +
        `</div>`
      );
    })
    .join("");

  const pag =
    `<a href="/secret-scraper/data/${enc(key)}?page=${Math.max(1, cur - 1)}${q ? "&q=" + enc(q) : ""}">prev</a> ` +
    `<span>page ${cur} / ${pages}</span> ` +
    `<a href="/secret-scraper/data/${enc(key)}?page=${Math.min(pages, cur + 1)}${q ? "&q=" + enc(q) : ""}">next</a>`;

  return jsonViewShell(
    `scraped: ${key}`,
    `<h1>scraped data</h1><p><a href="/secret-scraper">&larr; live scraper</a> · <a href="/secret-sources">&larr; secret sources</a></p>` +
      `<p><span class="chip"><code>${esc(key)}</code></span><span class="chip">${fmtBytes(st.size)}</span>` +
      `<span class="chip">${all.length.toLocaleString()} entries</span>` +
      (q ? `<span class="chip">${rows.length.toLocaleString()} match "&lt;${esc(q)}&gt;"</span>` : ``) + `</p>` +
      `<form method="get" class="f">` +
      `<input type="hidden" name="page" value="1">` +
      `<input type="text" name="q" value="${esc(q)}" placeholder="filter by title">` +
      `<button>filter</button></form>` +
      `<p>${pag}</p>` +
      `<style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#d7d9dc;padding:16px;font-size:13px}` +
      `h1{color:#fff;font-size:18px}a{color:#7ab1ff}.chip{display:inline-block;padding:0 5px;border-radius:3px;background:#1b212b;border:1px solid #2c3545;margin:2px 4px 2px 0}` +
      `.g{border:1px solid #262c38;border-radius:6px;padding:7px 9px;margin:6px 0;background:#131722}` +
      `.n{color:#5b667a;margin-right:8px}.t{color:#fff;font-weight:600}` +
      `.s{color:#8ae08a;margin-left:10px}.c{color:#ffd479;margin-left:8px}` +
      `.urow{margin-top:6px;display:flex;flex-wrap:wrap;gap:5px}` +
      `.u{display:inline-block;padding:2px 7px;border-radius:12px;background:#1b2533;border:1px solid #2d4155;color:#8fc0ff;text-decoration:none;font-size:11px}` +
      `.fn{margin-left:6px;color:#9aa7b8;font-weight:400}.dim{color:#5d6878}.f{margin:8px 0}.f input{background:#111722;border:1px solid #2c3545;color:#ddd;padding:3px 6px}` + `</style>` +
      body,
  );
}

// ── Live scraping panel ────────────────────────────────────────────────────────
// Hidden admin page (no links anywhere in the UI) that streams a scraper run
// from /api/scraper/live-stream/:key via SSE and shows per-title progress.
function renderScraperPanel(): string {
  let dataLinks = "";
  try {
    dataLinks = fs
      .readdirSync(path.join(process.cwd(), "data", "scraped"))
      .filter((f) => f.endsWith(".json") && f !== "_live.json")
      .map((f) => f.replace(/\.json$/, ""))
      .sort()
      .map((k) => `<a href="/secret-scraper/data/${enc(k)}">${secEsc(k)}</a>`)
      .join(" · ");
  } catch {}
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>live scraper</title>
<style>
 body{font-family:monospace;font-size:12px;background:#111;color:#ddd;padding:16px;}
 h1{color:#fff} a{color:#8cf}
 select,button{font-family:monospace;font-size:12px;background:#222;color:#ddd;border:1px solid #555;padding:3px 6px;cursor:pointer}
 .row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
 .chip{display:inline-block;padding:0 5px;border-radius:3px;background:#222;border:1px solid #444;margin:2px 4px 2px 0}
 #stats{min-height:1.4em;margin:6px 0;color:#9cf}
 pre#log{background:#0c0c0c;border:1px solid #333;padding:8px;height:58vh;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:11px}
 .st{color:#fa0}.ok{color:#6f6}.err{color:#f66}.dim{color:#888}.warn{color:#fa0}
 .bar{background:#1c1c1c;border:1px solid #333;height:10px;width:100%;margin:4px 0}
 .bar>div{background:#4c8;height:10px;width:0%}
 .run{display:inline-block;border:1px solid #444;padding:2px 6px;margin:2px;border-radius:3px;cursor:pointer}
 .run.running{border-color:#6f6;color:#6f6}
 .run.done{border-color:#666}
 .run.fail{border-color:#f66}
</style>
</head>
<body>
<h1>live scraper</h1>
<p><a href="/secret-sources">&larr; secret sources</a> · <a href="/secret-sources/file?rel=${encodeURIComponent("data/scraper-sites.json")}">view scraper-sites.json</a> · <span>data: </span>${dataLinks || "none"}</p>
<div class="row">
<select id="site"></select>
<button id="run">run</button>
<button id="stop" disabled>stop feed</button>
</div>
<div id="runs"></div>
<div id="stats"></div>
<div class="bar"><div id="bar"></div></div>
<pre id="log"></pre>
<script>
(() => {
  var $ = function (s) { return document.querySelector(s); };
  var logEl = $("#log"), statsEl = $("#stats"), barEl = $("#bar"), runBtn = $("#run"), stopBtn = $("#stop");
  var es = null;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function keyEsc(s) { return encodeURIComponent(s); }
  function line(text, cls) {
    var d = document.createElement("div");
    d.className = cls || "";
    d.textContent = text;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.childNodes.length > 2000) logEl.removeChild(logEl.firstChild);
  }
  function age(ts) {
    if (!ts) return "";
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m" + (s % 60) + "s ago";
    return Math.floor(s / 3600) + "h ago";
  }
  function onLine(text) {
    if (text.indexOf("PROGRESS\t") === 0) {
      var evt = null;
      try { evt = JSON.parse(text.slice(9)); } catch (err) {}
      if (!evt) return;
      if (evt.event === "listing") {
        statsEl.innerHTML = "listing: found <b>" + esc(evt.posts) + "</b> entries (mode " + esc(evt.mode) + (evt.sitemap ? " · sitemap" : "") + ")";
        return;
      }
      if (evt.event === "post") {
        var pct = evt.total ? (100 * (evt.i + 1) / evt.total) : 0;
        barEl.style.width = pct.toFixed(1) + "%";
        if (evt.title) line("(" + (evt.i + 1) + "/" + evt.total + ") [" + (evt.links || 0) + " links] " + evt.title, "st");
        else line("(" + (evt.i + 1) + "/" + evt.total + ") <no title> parts=" + (evt.links || 0), "err");
        return;
      }
      if (evt.event === "done") { barEl.style.width = "100%"; line("done: " + evt.total + " entries", "ok"); return; }
      return;
    }
    if (text.indexOf("error:") === 0) return line(text, "err");
    if (text.indexOf("ok total=") === 0) return line(text, "ok");
    line(text, "dim");
  }
  function closeFeed() { if (es) { es.close(); es = null; } stopBtn.disabled = true; }
  function connect(key) {
    closeFeed();
    logEl.textContent = "";
    statsEl.innerHTML = "connecting to <b>" + esc(key) + "</b> ...";
    barEl.style.width = "0%";
    es = new EventSource("/api/scraper/live-stream/" + keyEsc(key));
    es.addEventListener("hello", function (e) {
      var m = JSON.parse(e.data);
      statsEl.innerHTML = "feed: <b>" + esc(m.key) + "</b>" + (m.running ? " <span class=ok>RUNNING</span>" : " <span class=dim>idle</span>") +
        " · total " + (m.total == null ? "?" : m.total) + " · done " + (m.done == null ? 0 : m.done) +
        (m.lastTitle ? " · last: " + esc(m.lastTitle) : "");
      stopBtn.disabled = false;
    });
    es.addEventListener("start", function (e) { var m = JSON.parse(e.data); line(">> started " + m.name, "ok"); stopBtn.disabled = false; });
    es.addEventListener("line", function (e) { try { onLine(JSON.parse(e.data).text); } catch (err) {} });
    es.addEventListener("done", function (e) {
      var m = JSON.parse(e.data);
      stopBtn.disabled = true;
      statsEl.innerHTML = "done: " + (m.ok ? "OK" : "FAILED") + " code=" + (m.code == null ? "-" : m.code) + " total=" + (m.total == null ? "?" : m.total) + (m.error ? " err=" + esc(m.error) : "");
      line("== done ok=" + m.ok + " code=" + (m.code == null ? "-" : m.code) + " elapsed=" + (m.ms / 1000).toFixed(1) + "s total=" + (m.total == null ? "?" : m.total), m.ok ? "ok" : "err");
    });
  }
  function refreshRuns() {
    fetch("/api/scraper/live-runs").then(function (r) { return r.json(); }).then(function (d) {
      var box = $("#runs"); box.textContent = "";
      var autoKey = null;
      (d.runs || []).forEach(function (run) {
        var el = document.createElement("span");
        el.className = "run " + (run.running ? "running" : (run.code === 0 ? "done" : "fail"));
        el.textContent = run.key + " · " + (run.running ? "running" : (run.done + " / " + (run.total == null ? "?" : run.total))) + (run.running ? "" : " · " + age(run.startedAt));
        el.onclick = function () { connect(run.key); };
        box.appendChild(el);
        if (run.running && !autoKey) autoKey = run.key;
      });
      // Auto-attach to a running feed so live output streams without a click.
      if (autoKey && (!es || es.url.indexOf("/" + encodeURIComponent(autoKey)) < 0)) connect(autoKey);
    }).catch(function () {});
  }
  function init() {
    var sel = $("#site");
    fetch("/api/scraper/sites").then(function (r) { return r.json(); }).then(function (d) {
      Object.keys(d.sites || {}).sort().forEach(function (k) {
        var nm = d.sites[k].name;
        var o = document.createElement("option");
        o.value = k;
        o.textContent = k + (nm && nm !== k ? " (" + nm + ")" : "");
        sel.appendChild(o);
      });
    }).catch(function () { line("no sites configured in scraper-sites.json", "err"); });
    runBtn.onclick = function () {
      var key = sel.value; if (!key) return;
      logEl.textContent = ""; barEl.style.width = "0%";
      fetch("/api/scraper/live-run/" + keyEsc(key), { method: "POST" }).then(function (r) {
        if (r.status === 409) line("already running — connecting to existing feed", "warn");
        return r.json();
      }).then(function () { connect(key); }).catch(function (err) { line("run failed: " + err, "err"); });
      refreshRuns();
    };
    stopBtn.onclick = closeFeed;
    refreshRuns();
    setInterval(refreshRuns, 5000);
  }
  init();
})();
</script>
</body>
</html>`;
}

async function startServer() {
  gamesCatalog = loadGames();

  const app = express();
  app.use(compression({
    // Never compress SSE streams (text/event-stream): compression buffers the
    // whole response and events wouldn't flush until the run ends.
    filter: (req, res) => !String(res.getHeader("Content-Type") || "").includes("text/event-stream"),
  }));
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
      nextRunAt: new Date(nextSyncAtMs).toISOString(),
      nextRunInMs: Math.max(0, nextSyncAtMs - Date.now()),
      intervalMs: SOURCE_SYNC_INTERVAL_MS,
    });
  });

  // Secret sources page — hidden admin view (no links anywhere in the UI).
  app.get("/secret-sources", (_req, res) => {
    res.type("text/html").send(renderSecretSources());
  });

  // Live scraping panel — hidden admin view (SSE progress from scraper_api.py).
  app.get("/secret-scraper", (_req, res) => {
    res.type("text/html").send(renderScraperPanel());
  });

  // Browsable paginated view of a scraper's output file (data/scraped/<key>.json).
  app.get("/secret-scraper/data/:key", (req, res) => {
    const key = path.basename(String(req.params.key || "")).replace(/\.json$/, "");
    if (!/^[a-z_-]+$/i.test(key)) {
      return res.status(400).type("text/plain").send("Bad key.");
    }
    const rel = path.normalize(path.join("data", "scraped", `${key}.json`));
    const abs = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(abs)) return res.status(404).type("text/plain").send(`No scraped data for "${key}".`);
    const st = fs.statSync(abs);
    let data: Record<string, unknown> | unknown[];
    try {
      data = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch {
      return res.status(500).type("text/plain").send("Invalid JSON in file.");
    }
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const q = String(req.query.q || "").slice(0, 120);
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    res.type("text/html").send(renderScrapedDataView(key, st, data, page, q));
  });

  // JSON viewer for a local source file (allow-listed by sources config).
  app.get("/secret-sources/file", (req, res) => {
    const rel = typeof req.query.rel === "string" ? req.query.rel : "";
    const norm = path.normalize(rel);
    if (!sourceLocalFiles().has(norm)) {
      return res.status(403).type("text/plain").send("Not an allowed source file.");
    }
    const abs = path.resolve(process.cwd(), norm);
    if (!fs.existsSync(abs)) return res.status(404).type("text/plain").send("File not found.");
    const st = fs.statSync(abs);
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    // Big files: serve the raw JSON inline (browser renders it natively) instead
    // of pretty-printing many MB into HTML.
    if (st.size > 1_500_000 || req.query.raw === "1") {
      res.set("Content-Disposition", `inline; filename="${path.basename(norm)}"`);
      res.type("application/json");
      return res.send(fs.readFileSync(abs));
    }
    let body: string;
    try {
      body = JSON.stringify(JSON.parse(fs.readFileSync(abs, "utf8")), null, 2);
    } catch {
      body = fs.readFileSync(abs, "utf8");
    }
    res.type("text/html").send(renderFileView(norm, st, body));
  });

  // Live fetch of a remote (url-only) source, allow-listed by config.
  app.get("/secret-sources/fetch", async (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url : "";
    const found = readSourcesConfig(SOURCES_CONFIG_PATH).find((s) => s.url === url);
    if (!found) return res.status(403).type("text/plain").send("Not a configured source URL.");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", ...(found.headers ?? {}) },
        signal: ac.signal,
      });
      const raw = await r.text();
      res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      let body: string;
      try {
        body = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        body = raw;
      }
      res.type("text/html").send(renderRemoteView(url, r.status, body));
    } catch (e: any) {
      res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      res.type("text/html").send(renderRemoteView(url, 0, `ERROR: ${e?.message ?? String(e)}`));
    } finally {
      clearTimeout(timer);
    }
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