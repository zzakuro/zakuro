import express from "express";
import path from "path";
import fs from "fs";
import compression from "compression";
import { createServer as createViteServer } from "vite";
import { getGameMetadata, checkBackendRateLimit } from "./server/metadataService";
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

// Housed under data/ (not public/) so Vite's public-dir watcher doesn't force
// a full browser page reload every time the debounced catalog write fires.
const GAMES_DB_PATH = path.join(process.cwd(), "data", "merged_enriched.json");
const SOURCES_CONFIG_PATH = path.join(process.cwd(), "data", "sources.json");
const GRIND_LOCK_PATH = path.join(process.cwd(), "data", ".grind-active");
const PORT = 3000;

// Whether the detached metadata grind is mid-run. When it is, the server must
// not persist its (possibly stale) in-memory catalog over the grind's fresh
// writes, and should skip auto source-syncs so they don't clobber new ids.
function grindActive(): boolean {
  try {
    return fs.existsSync(GRIND_LOCK_PATH);
  } catch {
    return false;
  }
}
const SOURCE_SYNC_INTERVAL_MS =
  (process.env.SOURCE_SYNC_INTERVAL_HOURS
    ? Number(process.env.SOURCE_SYNC_INTERVAL_HOURS)
    : 6) * 60 * 60 * 1000;

// â”€â”€ In-memory catalog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The catalog JSON is ~50MB. Parse it ONCE at startup and serve from memory.
// Every earlier request did a synchronous 50MB read + parse, which froze the
// event loop. gamesCatalog is the single source of truth while the process runs;
// file writes (POST /bulk, POST /) re-sync it to disk.
let gamesCatalog: Game[] = [];

function loadGames(): Game[] {
  try {
    if (!fs.existsSync(GAMES_DB_PATH)) {
      console.error(`[DB] Catalog file missing at ${GAMES_DB_PATH}`);
      return [];
    }
    console.log("[DB] Loading catalog into memory...");
    const start = Date.now();
    const games = JSON.parse(fs.readFileSync(GAMES_DB_PATH, "utf-8")) as Game[];
    console.log(`[DB] Loaded ${games.length} games in ${Date.now() - start}ms`);
    return Array.isArray(games) ? games : [];
  } catch (e: any) {
    console.error("[DB] Failed to load catalog:", e.message);
    return [];
  }
}

let catalogDirty = false;
let catalogSaveTimer: NodeJS.Timeout | null = null;
let catalogSaving: Promise<void> | null = null;

function persistCatalogSync(): void {
  if (grindActive()) {
    console.log("[DB] Grind active — skipping catalog persist on exit.");
    return;
  }
  try {
    fs.writeFileSync(GAMES_DB_PATH, JSON.stringify(gamesCatalog), "utf-8");
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
  const tmpPath = `${GAMES_DB_PATH}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(gamesCatalog), "utf-8");
    await fs.promises.rename(tmpPath, GAMES_DB_PATH);
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

// â”€â”€ Query helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface CatalogQuery {
  q?: string;
  limit?: number;
  offset?: number;
  sort?: string;
  genre?: string;
  developer?: string;
  year?: string;
  minRating?: number;
  classic?: boolean;
}

function applyQuery(
  games: Game[],
  query: CatalogQuery
): { games: Game[]; total: number } {
  let result = games;

  // Classic / retro filter (classic=true keeps only tagged titles)
  if (query.classic === true) {
    result = result.filter((g) => g.classic === true);
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

  // Release-year filter
  if (typeof query.year === "string" && query.year.trim()) {
    const year = query.year.trim();
    result = result.filter((g) => (g.releaseDate || "").startsWith(year));
  }

  // Minimum editorial rating filter
  const minRating = query.minRating ? Number(query.minRating) : undefined;
  if (minRating && !isNaN(minRating)) {
    result = result.filter((g) => (g.rating ?? 0) >= minRating);
  }

  // Sort (default: as-is / popularity order already in the source file)
  switch (query.sort) {
    case "popular":
      result = [...result].sort(
        (a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0)
      );
      break;
    case "newest":
      result = [...result].sort((a, b) =>
        (b.releaseDate || "").localeCompare(a.releaseDate || "")
      );
      break;
    case "rating":
      result = [...result].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      break;
    case "az":
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
      break;
  }

  const total = result.length;
  const offset = Math.max(0, query.offset ?? 0);
  const limit = query.limit && query.limit > 0 ? query.limit : total;
  return { games: result.slice(offset, offset + limit), total };
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
  app.use(express.json());

  // Community layer: comments + ratings (persisted to data/)
  app.use("/api", communityRouter());

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

  // A. Get Games Catalog (served from in-memory cache, with search/pagination)
  app.get("/api/games", (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
      const { games, total } = applyQuery(gamesCatalog, {
        q: req.query.q as string | undefined,
        limit,
        offset,
        sort: req.query.sort as string | undefined,
        genre: req.query.genre as string | undefined,
        developer: req.query.developer as string | undefined,
        year: req.query.year as string | undefined,
        minRating: req.query.minRating
          ? parseInt(req.query.minRating as string, 10)
          : undefined,
        classic: req.query.classic === "1" || req.query.classic === "true",
      });
      res.json({ total, offset: offset ?? 0, limit: limit ?? total, games });
    } catch (e: any) {
      console.error("[Backend Games Load Error]:", e.message);
      res.status(500).json({ error: "Failed to load game collection." });
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
      // Fetch dynamic metadata asynchronously via Steam Store App Details or IGDB API
      const metadata = await getGameMetadata(game.id, game.title, game.steamId);

      // Persist newly-pulled metadata back into the catalog so a single visit
      // makes the enrichment permanent instead of re-fetching it forever.
      let mutated = false;
      if (metadata.summary && !metadata.summary.includes("fantastic game curated") && metadata.summary !== game.summary) {
        game.summary = metadata.summary;
        mutated = true;
      }
      if (metadata.developer && !metadata.developer.includes("Unknown Developer") && metadata.developer !== game.developer) {
        game.developer = metadata.developer;
        mutated = true;
      }
      if (metadata.publisher && !metadata.publisher.includes("Unknown Publisher") && metadata.publisher !== game.publisher) {
        game.publisher = metadata.publisher;
        mutated = true;
      }
      if (metadata.releaseDate && !metadata.releaseDate.includes("Unknown") && metadata.releaseDate !== game.releaseDate) {
        game.releaseDate = metadata.releaseDate;
        mutated = true;
      }
      if (metadata._ratingReal && metadata.rating && game.rating === 0) {
        game.rating = metadata.rating;
        mutated = true;
      }
      const realScreenshots = (metadata.screenshots || []).filter((u) => !u.includes("unsplash"));
      if (realScreenshots.length > 0 && !game.screenshots?.length) {
        game.screenshots = realScreenshots;
        mutated = true;
      }
      if (metadata.linux && (metadata.linux.native || metadata.linux.tier) && JSON.stringify(game.linux || {}) !== JSON.stringify(metadata.linux)) {
        game.linux = { ...(game.linux || {}), ...metadata.linux };
        mutated = true;
      }
      const extraGenres = matchGenres(metadata.summary || "", game.genres || []);
      if (extraGenres.length > 0) {
        game.genres = [...(game.genres || []), ...extraGenres];
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
        const regex = new RegExp(`${keyword}\\s*:\\s*([^:\\n\\râ€¢]+)`, "i");
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
    void runSourceSync();
    setInterval(() => {
      void runSourceSync();
    }, SOURCE_SYNC_INTERVAL_MS);
  });
}

startServer().catch((e) => {
  console.error("[Server Boot Failure]:", e);
  process.exit(1);
});