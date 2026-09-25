import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileP = promisify(execFile);

// ── Scraper framework ─────────────────────────────────────────────────────────
// Origin-scraper sources ("sources.json" entries with a `scraper` field) fetch
// a repacker's own site every sync and emit the same { name, downloads[] } shape
// the HydraLinks payload parser already understands.

export interface ScrapedDownload {
  title: string;
  fileSize?: string;
  uploadDate?: string;
  uris: Array<string | { url: string; name?: string; kind?: string }>;
}

export interface ScrapedPayload {
  name: string;
  downloads: ScrapedDownload[];
}

export interface ScrapeContext {
  name: string;
  httpGet: (url: string) => Promise<string>;
}

export type OriginScraper = (ctx: ScrapeContext) => Promise<ScrapedPayload>;

const HTTP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ZakurosArchive/1.0";

const MAX_BODY = 24 * 1024 * 1024;

export async function httpGet(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": HTTP_UA,
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const text = await response.text();
    if (text.length > MAX_BODY) throw new Error(`Body too large (${text.length}) for ${url}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

const firstMatch = (html: string, re: RegExp): string => {
  const m = html.match(re);
  return m ? m[1].trim() : "";
};

const unique = <T>(items: T[]): T[] => Array.from(new Set(items));

const decodeEntities = (s: string): string =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/\s+/g, " ");

const SIZE_TOKEN = /(?:from\s+)?[\d.,]+\s*(?:GB|MB|TB)/i;

// ── FitGirl ───────────────────────────────────────────────────────────────────

const FITGIRL_HOME = "https://fitgirl-repacks.site/";
const FITGIRL_NAV_SLUGS = [
  "upcoming-repacks",
  "updates-list",
  "dates-digest",
  "rules",
  "faq",
  "how-to-download",
  "donate",
  "about",
  "privacy",
  "gift",
  "torrents",
  "support",
  "get-the-team",
  "login",
  "cart",
  "store",
  "instagram",
  "twitter",
  "youtube",
  "patreon",
];

async function scrapeFitGirl(ctx: ScrapeContext): Promise<ScrapedPayload> {
  const home = await ctx.httpGet(FITGIRL_HOME);
  const posts = new Map<string, string>();
  const titleTag =
    /<h(?:1|2)[^>]*class="[^"]*entry-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of home.matchAll(titleTag)) {
    const url = m[1];
    if (!url.startsWith(FITGIRL_HOME)) continue;
    const slug = url.slice(FITGIRL_HOME.length).replace(/\/+$/, "").toLowerCase();
    if (!slug || FITGIRL_NAV_SLUGS.some((s) => slug.startsWith(s))) continue;
    const rawTitle = m[2]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (rawTitle && !posts.has(url)) posts.set(url, rawTitle);
  }

  const downloads: ScrapedDownload[] = [];
  for (const [url, listedTitle] of posts) {
    let post: string;
    try {
      post = await ctx.httpGet(url);
    } catch {
      continue;
    }
    const title = decodeEntities(
      listedTitle || firstMatch(post, /<title>([^<]+)<\/title>/i).replace(/\s+-\s*FitGirl Repacks\s*$/i, ""),
    );
    if (!title) continue;
    const repackSize = firstMatch(post, new RegExp(`Repack Size:\\s*(${SIZE_TOKEN.source})`, "i"));
    const originalSize = firstMatch(post, new RegExp(`Original Size:\\s*(${SIZE_TOKEN.source})`, "i"));
    const magnets = unique(
      post.match(/magnet:\?xt=urn:btih:[A-Za-z0-9]+(?:&[^"'\s<>]+)?/g) || [],
    );
    const uploadDate = firstMatch(post, /<time[^>]*datetime="([^"]+)"/i).slice(0, 10);
    if (!magnets.length) continue;
    downloads.push({
      title,
      fileSize: decodeEntities(
        repackSize && originalSize ? `${repackSize} / ${originalSize}` : repackSize || originalSize,
      ) || undefined,
      uploadDate: uploadDate || undefined,
      uris: magnets.map((m) => ({ url: m, name: "FitGirl Magnet", kind: "game" })),
    });
  }

  return { name: ctx.name, downloads };
}

// ── Registry + runner ─────────────────────────────────────────────────────────

export const SCRAPERS: Record<string, { home: string; run: OriginScraper }> = {
  fitgirl: { home: FITGIRL_HOME, run: scrapeFitGirl },
};

// ── Config-driven engine (data/scraper-sites.json) ────────────────────────────
// Sources with `"scraper": "cfg:<key>"` are scraped by the Python/Scrapling
// engine (scraper_api.py), which writes data/scraped/<key>.json in the same
// { name, downloads[] } shape. Override the interpreter with SCRAPLING_PY.

const SCRAPLING_PY =
  process.env.SCRAPLING_PY ||
  "C:\\Users\\Mfree\\AppData\\Local\\Temp\\opencode\\scr-venv\\Scripts\\python.exe";
const ENGINE_SCRIPT = path.join(process.cwd(), "scraper_api.py");
const SCRAPED_DIR = path.join(process.cwd(), "data", "scraped");

async function runConfigScraper(key: string, maxPosts?: number): Promise<ScrapedPayload> {
  const safeKey = key.replace(/[^a-z0-9_-]/gi, "");
  if (!safeKey) throw new Error(`Invalid scraper config key: ${key}`);
  const args = [ENGINE_SCRIPT, safeKey];
  if (maxPosts && maxPosts > 0) args.push("--max-posts", String(maxPosts));
  await execFileP(SCRAPLING_PY, args, {
    cwd: process.cwd(),
    timeout: 6 * 60 * 1000,
    maxBuffer: 5 * 1024 * 1024,
  });
  const outPath = path.join(SCRAPED_DIR, `${safeKey}.json`);
  if (!fs.existsSync(outPath)) throw new Error(`Engine produced no output for ${safeKey}`);
  return JSON.parse(fs.readFileSync(outPath, "utf-8")) as ScrapedPayload;
}

export async function runScraper(source: {
  name: string;
  scraper?: string;
}): Promise<unknown> {
  if (!source.scraper) throw new Error(`No scraper configured for ${source.name}`);
  if (source.scraper.startsWith("cfg:")) {
    return runConfigScraper(source.scraper.slice(4));
  }
  const impl = SCRAPERS[source.scraper];
  if (!impl) throw new Error(`No scraper registered: ${source.scraper}`);
  return impl.run({ name: source.name, httpGet });
}

// ── CLI harness ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const arg = process.argv[2] || "fitgirl";
  const started = Date.now();
  let key = arg;
  let payload: ScrapedPayload;
  if (arg.startsWith("cfg:")) {
    key = arg.slice(4);
    payload = await runConfigScraper(key);
  } else {
    const impl = SCRAPERS[key];
    if (!impl) {
      console.error(`Known scrapers: ${Object.keys(SCRAPERS).join(", ")}; also cfg:<key> from data/scraper-sites.json`);
      process.exit(1);
    }
    payload = await impl.run({ name: key, httpGet });
  }
  console.log(`${key}: ${payload.downloads.length} entries in ${Date.now() - started}ms`);
  for (const d of payload.downloads.slice(0, 8)) {
    const n = Array.isArray(d.uris) ? d.uris.length : 0;
    console.log(`- ${d.title} | ${d.fileSize || ""} | ${d.uploadDate || ""} | uris=${n}`);
  }
  const outDir = path.join(process.cwd(), "data", "scraped");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${key}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`saved: ${outPath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}