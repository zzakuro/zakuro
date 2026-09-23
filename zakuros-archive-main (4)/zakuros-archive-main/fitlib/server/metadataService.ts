import Redis from "ioredis";
import { GameMetadataExtended, GameSystemRequirements, LinuxSupportInfo, PlatformRequirements } from "../src/types";
import { igdbBestMatch, normalizeSearchTitle } from "./igdbMatch";

// In-Memory Fallback Cache if Redis is unavailable
const memoryCache = new Map<string, { value: GameMetadataExtended; expires: number }>();

// Lazy-initialized Redis connection with event error handling
let redis: Redis | null = null;
let redisHealthy = false;

function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) {
    return null;
  }
  if (redis === null) {
    const redisUrl = process.env.REDIS_URL;
    try {
      console.log(`[Cache] Initializing Redis client on ${redisUrl}...`);
      redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 1500,
        lazyConnect: true,
      });

      redis.on("error", (err) => {
        if (redisHealthy) {
          console.warn("[Cache] Redis connection lost. Falling back to in-memory store.");
          redisHealthy = false;
        }
      });

      redis.on("connect", () => {
        console.log("[Cache] Successfully connected to Redis.");
        redisHealthy = true;
      });

      // Trigger lazy connect
      redis.connect().catch((e) => {
        console.warn("[Cache] Redis initial connection failed. Using in-memory fallback.");
        redisHealthy = false;
      });
    } catch (error) {
      console.error("[Cache] Failed to construct Redis client:", error);
      redisHealthy = false;
    }
  }
  return redisHealthy ? redis : null;
}

// Memory Cache Utility
function getMemoryCache(key: string): GameMetadataExtended | null {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) {
    memoryCache.delete(key);
    return null;
  }
  return item.value;
}

function setMemoryCache(key: string, value: GameMetadataExtended, ttlSeconds: number) {
  memoryCache.set(key, {
    value,
    expires: Date.now() + ttlSeconds * 1000,
  });
}

// Rate limit helper: simple tracker to prevent client abusing Steam API
const rateLimitWindowMs = 60000;
const maxRequestsPerWindow = 30;
const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();

export function checkBackendRateLimit(ip: string): boolean {
  const now = Date.now();
  const user = ipRequestCounts.get(ip);
  if (!user || now > user.resetTime) {
    ipRequestCounts.set(ip, { count: 1, resetTime: now + rateLimitWindowMs });
    return true;
  }
  user.count += 1;
  return user.count <= maxRequestsPerWindow;
}

// 1. Steam API Fetcher (Using the public store appdetails API)

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Steam returns e.g. "18 Jun, 2024" or "Jun 18, 2024" which breaks the
// catalog's ISO-date conventions (Browse year filter + newest sort). Normalize
// any recognisable month-date form to ISO (YYYY-MM-DD).
export function normalizeSteamDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]{3,9}),\s*(\d{4})/) || raw.match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return raw;
  const [, a, b, y] = m as unknown as [string, string, string, string];
  const num = /^\d/.test(a) ? a : b;
  const mon = /^\d/.test(a) ? b : a;
  const month = MONTHS[mon.slice(0, 3).toLowerCase()];
  if (!month) return raw;
  return `${y}-${String(month).padStart(2, "0")}-${String(num).padStart(2, "0")}`;
}

// Steam "pc_requirements" comes as BBCode/HTML (e.g. "OS: Windows 10\n
// Processor: Intel i5..."). Parse the common label/value lines into the
// catalog's minimum requirements shape. Returns undefined when unusable.
export function parseSteamPcRequirements(spec: string | undefined): PlatformRequirements | undefined {
  if (!spec || !spec.trim()) return undefined;
  const text = spec
    .replace(/\[[^\]]*\]/g, "")           // [b], [/b], [h1], [/*], ...
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[•▪*]/g, " ");
  const minimum: GameSystemRequirements = { os: "", processor: "", memory: "", storage: "" };
  let gotAnything = false;
  for (const line of text.split(/[\n]+/)) {
    const m = line.match(/^\s*(?:minimum|recommended)?\s*(?:[-:•]?\s*)?(os|processor|memory|graphics|storage|network|sound card|additional notes)\s*:\s*(.+?)\s*$/i);
    if (!m) continue;
    const label = m[1].toLowerCase();
    const value = m[2].replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (label === "os") minimum.os = value.replace(/^(windows|linux|mac).*\*?\s*/i, "");
    else if (label === "processor") minimum.processor = value;
    else if (label === "memory") minimum.memory = value;
    else if (label === "graphics" && !minimum.graphics) minimum.graphics = value;
    else if (label === "storage") minimum.storage = value;
    if (["os", "processor", "memory", "storage"].includes(label)) gotAnything = true;
  }
  if (!gotAnything) return undefined;
  return { minimum };
}

// Steam "about_the_game" is BBCode/HTML ( "[h1]Plot[/h1] text<br>more text" ).
// Convert it to readable multi-paragraph plain text for the detail page.
function cleanSteamDescription(html: string | undefined): string | undefined {
  if (!html) return undefined;
  let t = html
    .replace(/\[\*\]/g, "\n• ")                   // [*] bullets → bullet lines
    .replace(/\[(?:\/?)(?:h1|h2|h3)\]/gi, "\n")
    .replace(/\[\/?[a-z0-9]+\]/gi, "")               // [h1], [/b], ...
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|li|ul|ol|strong|em)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  if (t.length > 2200) t = t.slice(0, 2200).replace(/\s+\S*$/, "");
  return t || undefined;
}

export async function fetchSteamDetails(steamId: number): Promise<Partial<GameMetadataExtended>> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${steamId}&l=english`;
  
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ZakurosArchive/1.0",
      },
    });

    if (response.status === 429) {
      throw new Error("RATE_LIMIT_EXCEEDED");
    }

    if (!response.ok) {
      // Transient server/network failures (5xx etc.) must propagate — the grind
      // treats a swallowed error + empty details as "dead appid" and would wipe
      // a perfectly valid steamId on a one-off 503.
      throw new Error(`Steam API responded with high-level code: ${response.status}`);
    }

    const json = await response.json() as any;
    const appInfo = json[steamId.toString()];

    // Only success:false / missing data is a *definitive* no-match (delisted,
    // wrong appid). Genuine network/parse problems already threw above.
    if (!appInfo || !appInfo.success || !appInfo.data) {
      console.warn(`[Steam API] Steam could not resolve details for appID: ${steamId}`);
      return {};
    }

    const data = appInfo.data;

    // Build the structural partial metadata
    const genres = data.genres
      ? data.genres.map((g: any) => g.description).filter(Boolean)
      : [];
    const screenshotUrls = data.screenshots 
      ? data.screenshots.map((s: any) => s.path_full) 
      : [];
    const trailers = Array.isArray(data.movies)
      ? data.movies
          .map((m: any) => {
            const pick = (ratio: any) =>
              (ratio && (ratio.max || ratio["480"] || ratio["360"])) || undefined;
            const src =
              pick(m.webm) ||
              pick(m.mp4) ||
              (m && m.id
                ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${m.id}/movie_max.mp4`
                : undefined);
            return src ? { name: m.name, thumb: m.thumbnail, src } : undefined;
          })
          .filter((t: any): t is { name: string; thumb: string; src: string } => !!t)
      : [];

    return {
      title: data.name,
      summary: cleanSteamDescription(data.about_the_game) || data.short_description,
      rating: data.metacritic ? data.metacritic.score : undefined,
      releaseDate: normalizeSteamDate(data.release_date ? data.release_date.date : ""),
      developer: data.developers ? data.developers.join(", ") : "",
      publisher: data.publishers ? data.publishers.join(", ") : "",
      screenshots: screenshotUrls,
      genres,
      trailers,
      linuxNative: !!(data.platforms && data.platforms.linux),
      steamDetails: {
        headerImage: data.header_image,
        background: data.background_raw || data.background,
        pcSpecs: data.pc_requirements ? data.pc_requirements.minimum : undefined,
        macSpecs: data.mac_requirements ? data.mac_requirements.minimum : undefined,
        linuxSpecs: data.linux_requirements ? data.linux_requirements.minimum : undefined,
      }
    };
  } catch (error: any) {
    console.error(`[Steam API Error] Failed fetching appID ${steamId}:`, error.message);
    if (error.message === "RATE_LIMIT_EXCEEDED" || error.message.startsWith("Steam API responded with high-level code")) {
      // Rate limits and transient 5xx must reach the caller so it knows the
      // appid was NOT verified (and must not unassign / skip it permanently).
      throw error;
    }
    // Anything else (success:false already returned {} above, unexpected parse
    // shapes) — treat as unverifiable and surface rather than silently acting
    // like a confirmed dead app.
    throw new Error(`Steam appdetails unverifiable for appID ${steamId}`);
  }
}

// ── ProtonDB (Linux compatibility tiers) ─────────────────────────────────────

// Process-lifetime cache keyed by Steam appid. A null entry means the app has
// no ProtonDB report (404) — don't re-hit it within this process.
const protonCache = new Map<number, LinuxSupportInfo | null>();

// Public ProtonDB summary per app (https://www.protondb.com/api/v1/reports/summaries)
// Returns { tier, confidence, votes } when a report exists, otherwise null.
export async function fetchProtonSummary(appid: number): Promise<LinuxSupportInfo | null> {
  if (protonCache.has(appid)) return protonCache.get(appid)!;
  try {
    const url = `https://www.protondb.com/api/v1/reports/summaries/${appid}.json`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ZakurosArchive/1.0",
      },
    });

    // 404 = genuinely no reports; 429/5xx = temporary — don't cache so a later
    // pass can retry, but don't throw either (treat as unknown).
    if (response.status === 404 || response.status === 429) {
      if (response.status === 404) protonCache.set(appid, null);
      return null;
    }
    if (!response.ok) return null;

    const data = await response.json() as any;
    if (!data || typeof data !== "object" || data.error) {
      protonCache.set(appid, null);
      return null;
    }

    const tier = String(data.best || data.tier || "").toLowerCase();
    if (!tier || tier === "unknown" || tier === "unrated") {
      protonCache.set(appid, null);
      return null;
    }

    const info: LinuxSupportInfo = {
      tier,
      confidence: data.confidence ? String(data.confidence).toLowerCase() : undefined,
      votes: typeof data.n_votes === "number" ? data.n_votes : undefined,
    };
    protonCache.set(appid, info);
    return info;
  } catch {
    protonCache.set(appid, null);
    return null;
  }
}

// 2. IGDB API fetcher (Using Twitch Developer OAuth Credentials if available)
let igdbToken: { token: string; expires: number } | null = null;

// Process-lifetime IGDB result cache. Values are null when IGDB returned no
// strongly-matching title (don't re-ask this boot); TTL refreshes the cache on
// an interval so long-lived processes still see metadata fixes.
const igdbCache = new Map<string, { value: Partial<GameMetadataExtended> | null; fetchedAt: number }>();
const IGDB_CACHE_TTL_MS = 24 * 3600 * 1000;

async function getIGDBAccessToken(): Promise<string | null> {
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null; // IGDB not configured
  }

  const now = Date.now();
  if (igdbToken && now < igdbToken.expires) {
    return igdbToken.token;
  }

  try {
    const authUrl = `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`;
    const response = await fetch(authUrl, { method: "POST" });
    if (!response.ok) {
      throw new Error(`Auth failed with status ${response.status}`);
    }
    const data = await response.json() as any;
    igdbToken = {
      token: data.access_token,
      expires: now + (data.expires_in - 60) * 1000,
    };
    return data.access_token;
  } catch (err: any) {
    console.error("[IGDB Auth Error] Failed to obtain IGDB OAuth access token:", err.message);
    return null;
  }
}

export async function fetchIGDBDetails(title: string): Promise<Partial<GameMetadataExtended>> {
  const clientId = process.env.IGDB_CLIENT_ID;
  const token = await getIGDBAccessToken();

  if (!clientId || !token) {
    // Gracefully bypass if credentials are not in environment
    return {};
  }

  // IGDB metadata is long-lived (reviews/covers don't shuffle daily). Cache the
  // trip per normalized title for the process lifetime so re-visits to the same
  // game don't burn quota; a null entry means "no strong IGDB match, don't ask
  // again this boot".
  const key = normalizeSearchTitle(title);
  const cached = igdbCache.get(key);
  if (cached) {
    if (Date.now() - cached.fetchedAt < IGDB_CACHE_TTL_MS) return cached.value || {};
    igdbCache.delete(key);
  }
  const recordCache = (value: Partial<GameMetadataExtended> | null) => {
    igdbCache.set(key, { value, fetchedAt: Date.now() });
    return value || {};
  };

  try {
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": clientId,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body: `search "${title}"; fields name, summary, storyline, rating, release_dates.human, cover.url, screenshots.url; limit 8;`,
    });

    if (response.status === 429) {
      throw new Error("RATE_LIMIT_EXCEEDED");
    }

    if (!response.ok) {
      throw new Error(`IGDB API responded with code: ${response.status}`);
    }

    const games = await response.json() as any[];
    if (!games || games.length === 0) {
      return recordCache(null);
    }

    // IGDB `search` is relevance-ranked and frequently returns the wrong game
    // for a repack-style title. Accept only a hit the strict title matcher
    // confirms; a wrong cover/summary is worse than leaving the field blank.
    const best = igdbBestMatch(title, games);
    if (!best) return recordCache(null);
    const game = best as any;
    const rating = game.rating ? Math.round(game.rating) : undefined;
    const storyline = game.storyline || "";
    let coverImage: string | undefined;
    if (typeof game.cover?.url === "string") {
      coverImage = game.cover.url
        .replace("//images.igdb.com/", "https://images.igdb.com/")
        .replace("t_thumb", "t_cover_big_2x");
    }

    const res = {
      summary: game.summary,
      rating,
      coverImage,
      igdbDetails: {
        storyline,
        videos: [],
      },
    };
    return recordCache(res);
  } catch (error: any) {
    console.error(`[IGDB API Error] Failed querying metadata for "${title}":`, error.message);
    if (error.message === "RATE_LIMIT_EXCEEDED") {
      throw error;
    }
    return {};
  }
}

// ── GOG (last-resort backup keyed by gog.com product id) ─────────────────────
// Used ONLY when Steam/IGDB produced no usable metadata for a game that has a
// gogId (delisted or region-blocked Steam app, IGDB down, whatever). The public
// api.gog.com/products/{id} endpoint needs no auth.
const GOG_SCREENSHOT_FMT = "ggvgm_2x"; // decent-size GOG screenshot formatter

function gogScreenshotUrl(screen: any): string {
  if (!screen) return "";
  const imgs = Array.isArray(screen.formatted_images) ? screen.formatted_images : [];
  const chosen =
    imgs.find((f: any) => f && f.formatter_name === GOG_SCREENSHOT_FMT) ||
    imgs.find((f: any) => f && f.formatter_name === "ggvgm") ||
    imgs[0];
  return (chosen && chosen.image_url) || "";
}

export async function fetchGogDetails(gogId: string): Promise<Partial<GameMetadataExtended>> {
  const url = `https://api.gog.com/products/${encodeURIComponent(gogId)}?expand=description,screenshots,images`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ZakurosArchive/1.0" },
    });
    if (!response.ok) {
      // 404 = no such product (definitive no-match); 429/5xx = transient.
      if (response.status === 404) return {};
      throw new Error(`GOG API responded with code: ${response.status}`);
    }
    const data = await response.json() as any;
    if (!data || !data.id) return {};
    const screenshots = (Array.isArray(data.screenshots) ? data.screenshots : [])
      .map(gogScreenshotUrl)
      .filter(Boolean);
    const full = cleanSteamDescription(data.description && data.description.full);
    const releaseDateRaw = typeof data.release_date === "string" ? data.release_date : "";
    // Product "hero" art (protocol-relative like //images-1.gog-statics.com/...).
    const bg = data.images && (data.images.background || data.images.logo);
    return {
      title: String(data.title || ""),
      summary: (data.description && data.description.lead) || full || "",
      rating: undefined,
      releaseDate: releaseDateRaw ? new Date(releaseDateRaw).toISOString().slice(0, 10) : undefined,
      screenshots,
      coverImage: bg ? `https:${bg}` : undefined,
      linuxNative: !!(data.content_system_compatibility && data.content_system_compatibility.linux),
    };
  } catch (error: any) {
    // Keep our own readable errors; harden anything unexpected without lying
    // about which backend this came from.
    if (error && error.message === "RATE_LIMIT_EXCEEDED") throw error;
    if (error && error.message.startsWith("GOG API responded with code")) throw error;
    throw new Error(`GOG product info unverifiable for gogId ${gogId}: ${error && error.message}`);
  }
}

// 3. Orchestrated Fetching with Caching Layer (Redis + In-Memory Fallback)
export async function getGameMetadata(
  gameId: string,
  title: string,
  steamId?: number,
  gogId?: string,
  skipIgdb = false
): Promise<GameMetadataExtended> {
  const cacheKey = `game:metadata:${gameId}`;
  // Metadata is stable enough that a day-old cached envelope beats re-hitting
  // Steam/IGDB/GOG on every view of an already-known game.
  const ttl = 86400; // 24 hours caching TTL

  // A. Check Redis or Memory Cache
  try {
    const client = getRedisClient();
    if (client) {
      const cached = await client.get(cacheKey);
      if (cached) {
        console.log(`[Cache Hit] Serving metadata for ${gameId} from Redis.`);
        return JSON.parse(cached) as GameMetadataExtended;
      }
    } else {
      const cached = getMemoryCache(cacheKey);
      if (cached) {
        console.log(`[Cache Hit] Serving metadata for ${gameId} from Space Memory.`);
        return cached;
      }
    }
  } catch (cacheError) {
    console.warn("[Cache Read Error] Error querying cache layer, moving to fetch:", cacheError);
  }

  // B. Cache Miss: Fetch metadata
  console.log(`[Cache Miss] Fetching live metadata for game ${title} (AppID: ${steamId || "N/A"})...`);

  let fetchFailed: any = null; // remembers a rate-limit/transient error so we
                               // can still serve a GOG fallback if available.

  let finalMetadata: GameMetadataExtended = {
    title,
    summary: `${title} is a fantastic game curated on Zakuro's Archive. Loading detailed system notes and downloads.`,
    rating: 88,
    releaseDate: "Unknown",
    developer: "Unknown Developer",
    publisher: "Unknown Publisher",
    screenshots: [],
    screenshot: "",
  };

  try {
    let steamData: Partial<GameMetadataExtended> = {};
    let igdbData: Partial<GameMetadataExtended> = {};
    let linuxNative = false;
    let proton: LinuxSupportInfo | null = null;

    // Parallel fetch for speed. Errors are recorded, not thrown, so a single
    // dead backend never blocks the Steam/IGDB/GOG fallback chain.
    const fetchers: Promise<void>[] = [];

    if (steamId) {
      fetchers.push(fetchSteamDetails(steamId).then(res => {
        steamData = res;
        if (res.linuxNative) linuxNative = true;
      }).catch((e) => {
        console.warn(`[Steam API Error] ${title}:`, e.message);
        fetchFailed = fetchFailed || e;
      }));
      fetchers.push(fetchProtonSummary(steamId).then(p => { proton = p; }).catch(() => {}));
    }
    // IGDB is gated: consulted only when the caller says so (server.ts only
    // sends non-Steam or coverless games there — Steam appdetails already
    // supplies every field below except a cover, and verified Steam covers are
    // derived straight from the appid). Skipping it for fully-covered Steam
    // games cuts the largest quotastic backend pressure in the hot path.
    if (process.env.IGDB_CLIENT_ID && !skipIgdb) {
      fetchers.push(fetchIGDBDetails(title).then(res => { igdbData = res; }).catch((e) => {
        console.warn(`[IGDB API Error] ${title}:`, e.message);
        fetchFailed = fetchFailed || e;
      }));
    }

    await Promise.all(fetchers);

    const hasSteamMeta = !!(steamData.summary || steamData.developer || steamData.releaseDate || (steamData.screenshots && steamData.screenshots.length > 0));
    const hasIgdbMeta = !!(igdbData.summary || igdbData.developer || (igdbData.screenshots && igdbData.screenshots.length > 0) || igdbData.coverImage);

    // GOG is a strict last resort — used only when neither Steam nor IGDB
    // produced usable metadata (missing/dead appid, API down, rate-limited).
    let gogData: Partial<GameMetadataExtended> = {};
    if (gogId && !hasSteamMeta && !hasIgdbMeta) {
      console.log(`[GOG Fallback] Steam/IGDB produced nothing for "${title}", trying gogId ${gogId}...`);
      try {
        gogData = await fetchGogDetails(gogId);
        if (gogData.linuxNative) linuxNative = true;
      } catch (e: any) {
        console.warn(`[GOG API Error] fallback for gogId ${gogId}:`, e.message);
        fetchFailed = fetchFailed || e;
      }
    }

    // Merge outputs (Steam > IGDB > GOG > base defaults; GOG only ever has data
    // when the first two are empty, so it cannot shadow them).
    finalMetadata = {
      title,
      verifiedTitle: steamData.title || undefined,
      summary: steamData.summary || igdbData.summary || gogData.summary || finalMetadata.summary,
      rating: steamData.rating !== undefined ? steamData.rating : (igdbData.rating || gogData.rating || finalMetadata.rating),
      releaseDate: steamData.releaseDate || gogData.releaseDate || finalMetadata.releaseDate,
      developer: steamData.developer || finalMetadata.developer,
      publisher: steamData.publisher || finalMetadata.publisher,
      screenshots: (steamData.screenshots && steamData.screenshots.length > 0)
        ? steamData.screenshots
        : ((gogData.screenshots && gogData.screenshots.length > 0)
          ? gogData.screenshots
          : finalMetadata.screenshots),
      screenshot: steamData.screenshot || finalMetadata.screenshot,
      genres: steamData.genres || finalMetadata.genres,
      trailers: steamData.trailers || finalMetadata.trailers,
      steamDetails: steamData.steamDetails,
      coverImage: steamData.coverImage || igdbData.coverImage || gogData.coverImage || finalMetadata.coverImage,
      igdbDetails: igdbData.igdbDetails,
      _ratingReal: steamData.rating !== undefined || igdbData.rating !== undefined,
      linux: { native: linuxNative, ...(proton || {}) },
      linuxNative,
    };

    // If screenshots still empty, populate some beautiful default fallback screenshots based on ID
    if (!finalMetadata.screenshots || finalMetadata.screenshots.length === 0) {
      finalMetadata.screenshots = [
        `https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=800&auto=format&fit=crop`,
        `https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=800&auto=format&fit=crop`,
        `https://images.unsplash.com/photo-1553481187-be93c21490a9?q=80&w=800&auto=format&fit=crop`,
      ];
    }

    // Save to Cache (Redis or Memory)
    try {
      const client = getRedisClient();
      if (client) {
        await client.setex(cacheKey, ttl, JSON.stringify(finalMetadata));
        console.log(`[Cache Set] Cached metadata for ${gameId} in Redis.`);
      } else {
        setMemoryCache(cacheKey, finalMetadata, ttl);
        console.log(`[Cache Set] Cached metadata for ${gameId} in Space Memory.`);
      }
    } catch (saveError) {
      console.warn("[Cache Write Error] Failed saving metadata to cache:", saveError);
    }

  } catch (fetchError: any) {
    if (fetchError && fetchError.message === "RATE_LIMIT_EXCEEDED") {
      console.warn(`[API Rate Limited] High frequency requests for game ${gameId}. Serving stale/default.`);
      throw fetchError;
    }
    console.error(`[Enrichment Error] Critical error during fallback extraction for ${gameId}:`, fetchError?.message || fetchError);
  }

  // Preserve the old 429 contract when a backend was rate-limited and nothing
  // real (Steam/IGDB/GOG) could be assembled as a fallback.
  if (
    fetchFailed &&
    fetchFailed.message === "RATE_LIMIT_EXCEEDED" &&
    finalMetadata.summary.includes("fantastic game curated")
  ) {
    console.warn(`[API Rate Limited] No usable fallback metadata for ${gameId}. Surfacing 429.`);
    throw fetchFailed;
  }

  return finalMetadata;
}
