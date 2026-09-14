import Redis from "ioredis";
import { GameMetadataExtended, GameSystemRequirements, LinuxSupportInfo, PlatformRequirements } from "../src/types";

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
    .replace(/\[\/?[a-z0-9]+\]/gi, "")               // [h1], [/b], [*], ...
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|li|ul|ol|strong|em)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  if (t.length > 5000) t = t.slice(0, 5000).replace(/\s+\S*$/, "");
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
      throw new Error(`Steam API responded with high-level code: ${response.status}`);
    }

    const json = await response.json() as any;
    const appInfo = json[steamId.toString()];

    if (!appInfo || !appInfo.success || !appInfo.data) {
      console.warn(`[Steam API] Steam could not resolve details for appID: ${steamId}`);
      return {};
    }

    const data = appInfo.data;

    // Build the structural partial metadata
    const genres = data.genres ? data.genres.map((g: any) => g.description) : [];
    const screenshotUrls = data.screenshots 
      ? data.screenshots.map((s: any) => s.path_full) 
      : [];

    return {
      title: data.name,
      summary: cleanSteamDescription(data.about_the_game) || data.short_description,
      rating: data.metacritic ? data.metacritic.score : undefined,
      releaseDate: normalizeSteamDate(data.release_date ? data.release_date.date : ""),
      developer: data.developers ? data.developers.join(", ") : "",
      publisher: data.publishers ? data.publishers.join(", ") : "",
      screenshots: screenshotUrls,
      linuxNative: !!(data.platforms && data.platforms.linux),
      steamDetails: {
        headerImage: data.header_image,
        background: data.background_raw || data.background,
        pcSpecs: data.pc_requirements ? data.pc_requirements.minimum : undefined,
      }
    };
  } catch (error: any) {
    console.error(`[Steam API Error] Failed fetching appID ${steamId}:`, error.message);
    if (error.message === "RATE_LIMIT_EXCEEDED") {
      throw error;
    }
    return {};
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

  try {
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": clientId,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body: `search "${title}"; fields name, summary, storyline, rating, release_dates.human, cover.url, screenshots.url; limit 1;`,
    });

    if (response.status === 429) {
      throw new Error("RATE_LIMIT_EXCEEDED");
    }

    if (!response.ok) {
      throw new Error(`IGDB API responded with code: ${response.status}`);
    }

    const games = await response.json() as any[];
    if (!games || games.length === 0) {
      return {};
    }

    const game = games[0];
    const rating = game.rating ? Math.round(game.rating) : undefined;
    const storyline = game.storyline || "";
    
    return {
      summary: game.summary,
      rating,
      igdbDetails: {
        storyline,
        videos: [],
      }
    };
  } catch (error: any) {
    console.error(`[IGDB API Error] Failed querying metadata for "${title}":`, error.message);
    if (error.message === "RATE_LIMIT_EXCEEDED") {
      throw error;
    }
    return {};
  }
}

// 3. Orchestrated Fetching with Caching Layer (Redis + In-Memory Fallback)
export async function getGameMetadata(
  gameId: string,
  title: string,
  steamId?: number
): Promise<GameMetadataExtended> {
  const cacheKey = `game:metadata:${gameId}`;
  const ttl = 3600; // 1 hour caching TTL

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

    // Parallel fetch for speed
    const fetchers: Promise<any>[] = [];

    if (steamId) {
      fetchers.push(fetchSteamDetails(steamId).then(res => {
        steamData = res;
        if (res.linuxNative) linuxNative = true;
      }));
      fetchers.push(fetchProtonSummary(steamId).then(p => proton = p));
    }
    if (process.env.IGDB_CLIENT_ID) {
      fetchers.push(fetchIGDBDetails(title).then(res => igdbData = res));
    }

    await Promise.all(fetchers);

    // Merge outputs (Steam details take priority, then IGDB, then base defaults)
    finalMetadata = {
      title,
      summary: steamData.summary || igdbData.summary || finalMetadata.summary,
      rating: steamData.rating !== undefined ? steamData.rating : (igdbData.rating || finalMetadata.rating),
      releaseDate: steamData.releaseDate || finalMetadata.releaseDate,
      developer: steamData.developer || finalMetadata.developer,
      publisher: steamData.publisher || finalMetadata.publisher,
      screenshots: (steamData.screenshots && steamData.screenshots.length > 0)
        ? steamData.screenshots
        : (finalMetadata.screenshots),
      screenshot: steamData.screenshot || finalMetadata.screenshot,
      steamDetails: steamData.steamDetails,
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
    if (fetchError.message === "RATE_LIMIT_EXCEEDED") {
      console.warn(`[API Rate Limited] High frequency requests for game ${gameId}. Serving stale/default.`);
      throw fetchError;
    }
    console.error(`[Enrichment Error] Critical error during fallback extraction for ${gameId}:`, fetchError);
  }

  return finalMetadata;
}
