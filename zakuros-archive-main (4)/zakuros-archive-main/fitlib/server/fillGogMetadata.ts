// Fill GOG-derived metadata (covers, genres, rating, developer, release date,
// summary, screenshots) for catalog games that carry a gogId/gogUrl but still
// lack artwork. Two tiers:
//   1. Offline — the gog-games.to SQL dump (repo-root/gog-games.to-database.sql)
//      maps its 60-hex asset hashes straight to https://images.gog.com/{hash}.png
//      with zero API traffic, and throws in genres/rating/release-date for free.
//   2. Online — api.gog.com/products/{id} (no auth) via fetchGogDetails(), for
//      games the dump can't cover. Covers come from images.background.
//
// Run: npm run fill:gog [-- --dry] [-- --limit N] [-- --dump <path>]
import fs from "fs";
import path from "path";
import { Game } from "../src/types";
import { readGames, writeGames } from "./catalogIO";
import { selfHealCatalog, summaryIsPlaceholder, devIsPlaceholder } from "./sources";
import { fetchGogDetails } from "./metadataService";

const DRY = process.argv.includes("--dry");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Math.max(0, Number(process.argv[i + 1]) || 0) : 0;
})();
const DUMP_ARG = (() => {
  const i = process.argv.indexOf("--dump");
  return i >= 0 ? process.argv[i + 1] : "";
})();

const DATA_DIR = path.join(process.cwd(), "data");
const GRIND_LOCK = path.join(DATA_DIR, ".grind-active");
const PROGRESS_PATH = path.join(DATA_DIR, "gog_fill_progress.json");

const has = (v: unknown): boolean => v !== undefined && v !== null && v !== "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GogDumpRec {
  gogId: string;
  slug: string;
  title: string;
  developer: string;
  publisher: string;
  gogUrl: string;
  image: string; // 60-hex GOG CDN asset hash ('' when NULL)
  releaseDate: string; // YYYY-MM-DD
  rating?: number;
  genres?: string[];
}

// Repo-root dump (fitlib/server -> fitlib -> zakuro) or overrides.
function resolveDumpPath(): string {
  const candidates = [
    DUMP_ARG,
    process.env.GOG_DUMP || "",
    path.join(process.cwd(), "..", "..", "..", "gog-games.to-database.sql"),
    path.join(process.cwd(), "..", "..", "gog-games.to-database.sql"),
    path.join(process.cwd(), "..", "gog-games.to-database.sql"),
    path.join(process.cwd(), "gog-games.to-database.sql"),
  ].filter(Boolean);
  return candidates.find((c) => {
    try {
      return fs.statSync(c).size > 0;
    } catch {
      return false;
    }
  }) || "";
}

// Parse the games table rows of a MariaDB dump. Row shape (id is a quoted
// varchar, hence the opening '(''):  ('<id>','<slug>','<title>','<dev>','<pub>',
// <views…>, '<genres JSON>', '<tags JSON>', <rating>,<age>,'<release_dt>',
// '<image60>','<background60>','https://www.gog.com/game/<slug>', <md5>…).
function parseGogDump(file: string): Map<string, GogDumpRec> {
  const out = new Map<string, GogDumpRec>();
  if (!file) return out;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  const rowRe = /^\('(\d+)','((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)'/;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("(")) continue;
    const m = t.match(rowRe);
    if (!m) continue;
    const tail = t.slice(m[0].length);

    const rec: GogDumpRec = {
      gogId: m[1],
      slug: m[2].replace(/\\'/g, "'"),
      title: m[3].replace(/\\'/g, "'"),
      developer: m[4].replace(/\\'/g, "'"),
      publisher: m[5].replace(/\\'/g, "'"),
      gogUrl: "",
      image: "",
      releaseDate: "",
    };

    const date = tail.match(/,[01],'(\d{4}-\d{2}-\d{2})/);
    if (date) rec.releaseDate = date[1];
    const rating = tail.match(/,([0-9]+(?:\.[0-9])?),[01],'\d{4}/);
    if (rating) rec.rating = Number(rating[1]);
    const gogUrl = tail.match(/'((?:https?:)?\/\/www\.gog\.com\/game\/[a-z0-9_-]+)'/);
    if (gogUrl) rec.gogUrl = gogUrl[1];
    // First two 60-hex quoted tokens are the image and background asset hashes.
    const hex = tail.match(/'([0-9a-f]{60})'/g) ?? [];
    const hexFirst = hex[0];
    if (hex.length > 0 && hexFirst) rec.image = hexFirst.slice(1, -1);
    const hexSecond = hex[1];
    if (hex.length > 1 && !rec.image && hexSecond) rec.image = hexSecond.slice(1, -1);
    // genres/tags are the only quoted tokens that start with '['.
    const jsonArr = tail.match(/'\[((?:\\.|[^'\\])*)\]'/g) ?? [];
    const rawGenres = jsonArr.length > 0 && jsonArr[0] ? jsonArr[0].slice(1, -1) : "";
    if (rawGenres) {
      try {
        rec.genres = JSON.parse(rawGenres.replace(/\\(["\\])/g, "$1"));
      } catch {
        rec.genres = rawGenres.split(",").map((s) => s.replace(/\\"/g, "").trim()).filter(Boolean);
      }
    }

    if (!out.has(rec.gogId)) out.set(rec.gogId, rec);
  }
  return out;
}

function norm(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[™®]|[:;,!.]+$/g, "");
}

let gamesRef: Game[] = [];
function persist(): void {
  const h = selfHealCatalog(gamesRef);
  if (h.filler || h.bilingual || h.merged || h.covers || h.classic) {
    console.log(`[GOG] self-heal on save: ${JSON.stringify(h)}`);
  }
  writeGames(gamesRef);
}

function loadTried(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8")).tried);
  } catch {
    return new Set();
  }
}
function saveTried(s: Set<string>): void {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ tried: Array.from(s) }), "utf8");
}

// Offline tier: dump record -> covers/genres/rating/dev/release with no network.
function applyDump(g: Game, rec: GogDumpRec): number {
  let n = 0;
  if (!g.coverImage && rec.image) {
    g.coverImage = `https://images.gog.com/${rec.image}.png`;
    if (!g.screenshot) g.screenshot = g.coverImage;
    n++;
  }
  if (rec.genres?.length) {
    const have = new Set((g.genres || []).map((x) => x.toLowerCase()));
    const fresh = rec.genres.filter((x) => !have.has(x.toLowerCase()));
    if (fresh.length) {
      g.genres = [...(g.genres || []), ...fresh].slice(0, 12);
      n++;
    }
  }
  if (rec.rating && !g.rating) {
    g.rating = rec.rating;
    n++;
  }
  if (devIsPlaceholder(g.developer) && rec.developer) {
    g.developer = rec.developer;
    n++;
  }
  if (!g.releaseDate && rec.releaseDate) {
    g.releaseDate = rec.releaseDate;
    n++;
  }
  return n;
}

// Online tier: keyless api.gog.com as a last resort for covers/metadata.
async function applyApi(g: Game): Promise<{ status: "ok" | "miss" | "transient"; filled: number }> {
  const gogId = String(g.gogId || "");
  if (!gogId || !/^\d{6,10}$/.test(gogId)) return { status: "miss", filled: 0 };
  let data;
  try {
    data = await fetchGogDetails(gogId);
  } catch (e: any) {
    if (/GOG API responded with code: 404/.test(e?.message || "")) return { status: "miss", filled: 0 };
    if (e?.message === "RATE_LIMIT_EXCEEDED" || /5\d\d|fetch failed/i.test(e?.message || "")) {
      return { status: "transient", filled: 0 };
    }
    return { status: "miss", filled: 0 };
  }
  if (!data || !data.title) return { status: "miss", filled: 0 };

  let n = 0;
  if (!g.coverImage && data.coverImage) {
    g.coverImage = data.coverImage;
    if (!g.screenshot) g.screenshot = data.coverImage;
    n++;
  }
  if (summaryIsPlaceholder(g.summary) && data.summary) {
    g.summary = data.summary;
    n++;
  }
  if (!g.releaseDate && data.releaseDate) {
    g.releaseDate = data.releaseDate;
    n++;
  }
  if (data.screenshots?.length && !(g.screenshots || []).length) {
    g.screenshots = data.screenshots;
    if (!g.screenshot) g.screenshot = data.screenshots[0];
    n++;
  }
  return { status: "ok", filled: n };
}

async function main() {
  const games = readGames<Game>();
  gamesRef = games;
  const dumpFile = resolveDumpPath();
  const recs = parseGogDump(dumpFile);
  console.log(
    `catalog=${games.length} | dump=${dumpFile ? `${recs.size} games` : "NOT FOUND (API-only)"}`
  );

  const byGogId = recs;
  const bySlug = new Map<string, GogDumpRec>();
  const byTitle = new Map<string, GogDumpRec>();
  for (const rec of recs.values()) {
    const slugKey = norm(rec.slug.replace(/-/g, " "));
    if (!bySlug.has(slugKey)) bySlug.set(slugKey, rec);
    const titleKey = norm(rec.title);
    if (!byTitle.has(titleKey)) byTitle.set(titleKey, rec);
  }

  const tried = loadTried();
  const isMissing = (g: Game) => !g.coverImage && !g.classic && !!g.title;

  let targets = games.filter((g) => isMissing(g) && (has(g.gogId) || has(g.gogUrl)) && !tried.has(g.id));
  const total = games.filter((g) => isMissing(g) && (has(g.gogId) || has(g.gogUrl))).length;
  if (LIMIT) targets = targets.slice(0, LIMIT);

  console.log(`gog-tagged cover-less=${total} | this run=${targets.length} | already tried=${tried.size}`);
  if (!targets.length) return;

  if (fs.existsSync(GRIND_LOCK) && !DRY) {
    console.error("ABORT: grind lock present — do not modify the catalog while the grind is running");
    process.exit(2);
  }

  let done = 0,
    offlineHit = 0,
    apiHit = 0,
    miss = 0,
    transient = 0,
    fields = 0;
  const samples: string[] = [];

  for (const g of targets) {
    let n = 0;
    const gogId = String(g.gogId || "");
    const slug = g.gogUrl ? String(g.gogUrl).split("/game/")[1] || "" : "";
    const rec =
      byGogId.get(gogId) ||
      bySlug.get(norm(slug.replace(/-/g, " "))) ||
      byTitle.get(norm(g.title || ""));

    if (rec) {
      const before = n;
      n += applyDump(g, rec);
      if (n > before) offlineHit++;
    }

    if (!g.coverImage) {
      if (!g.gogId && rec) g.gogId = rec.gogId;
      const api = await applyApi(g);
      if (api.status === "ok") {
        if (api.filled > 0) apiHit++;
        n += api.filled;
      } else if (api.status === "transient") {
        transient++;
        await sleep(2000);
        continue;
      } else {
        miss++;
      }
    }

    fields += n;
    if (n > 0 && samples.length < 15) samples.push(`${String(g.title).slice(0, 40)} -> gogId ${gogId} (+${n})`);
    tried.add(g.id);
    done++;

    if (done % 25 === 0) {
      console.log(
        `[GOG] ${done}/${targets.length} offline=${offlineHit} api=${apiHit} miss=${miss} transient=${transient} fields=${fields}`
      );
      if (!DRY) {
        saveTried(tried);
        persist();
      }
      await sleep(150);
    }
  }

  if (!DRY) {
    saveTried(tried);
    persist();
  }
  console.log(
    `DONE: processed=${done} offlineCovers=${offlineHit} apiCovers=${apiHit} miss=${miss} transient=${transient} fields=${fields}${DRY ? " (dry-run)" : ""}`
  );
  for (const s of samples) console.log("  " + s);
}

main().catch((e) => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});