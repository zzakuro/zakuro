// Fill metadata for adult/doujin titles that no Steam/IGDB pass can cover, using
// the VNDB (Visual Novel Database) anonymous API. Targets games with no steamId
// and no cover that came from the EroTorrent source (plus anything tagged NSFW),
// then writes cover/description/developer/release date/genres back into the
// catalog through the same persist-time self-heal as the other writers.
//
// Run: npx tsx server/fillVndbMetadata.ts [--dry] [--limit N]
import fs from "fs";
import path from "path";
import { Game } from "../src/types";
import { readGames, writeGames } from "./catalogIO";
import { selfHealCatalog, summaryIsPlaceholder, devIsPlaceholder } from "./sources";
import { VNDB_FIELDS, vndbBestMatch, stripVndbBbcode, vndbReleaseDate, VndbResult } from "./vndbMatch";
import { cleanForSearch } from "./igdbMatch";

const DRY = process.argv.includes("--dry");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Math.max(0, Number(process.argv[i + 1]) || 0) : 0;
})();

const DATA_DIR = path.join(process.cwd(), "data");
const GRIND_LOCK = path.join(DATA_DIR, ".grind-active");
const PROGRESS_PATH = path.join(DATA_DIR, "vndb_fill_progress.json");

const NSFW_GENRE = /^(nsfw|porn|hentai|adult|eroge|erotic)$/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const srcNames = (g: Game) =>
  (g.downloadSources || []).map((s) => s.repacker || s.name || "").filter(Boolean);
const isEro = (g: Game) => srcNames(g).some((n) => /erotorrent/i.test(n));
const isNsfw = (g: Game) => (g.genres || []).some((x) => NSFW_GENRE.test(x));
const isVN = (g: Game) => (g.genres || []).some((x) => /visual novel/i.test(x));

// Adult / doujin / visual-novel rows no Steam/IGDB/GOG pass can reach, that
// still miss a summary or a cover — VNDB is their canonical source.
const isTarget = (g: Game) =>
  !g.steamId && !!g.title && (isEro(g) || isNsfw(g) || isVN(g)) &&
  (!g.coverImage || !g.summary || summaryIsPlaceholder(g.summary));

let gamesRef: Game[] = [];
function persist(): void {
  const h = selfHealCatalog(gamesRef);
  if (h.filler || h.bilingual || h.merged || h.covers || h.classic) {
    console.log(`[VNDB] self-heal on save: ${JSON.stringify(h)}`);
  }
  writeGames(gamesRef);
}

let rateLimited = 0;
async function vndbSearch(title: string): Promise<VndbResult[]> {
  const q = cleanForSearch(title).slice(0, 80) || title.slice(0, 80);
  const res = await fetch("https://api.vndb.org/kana/vn", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "zakuro-archive/1.0 (catalog metadata indexer)",
    },
    body: JSON.stringify({ filters: ["search", "=", q], fields: VNDB_FIELDS, results: 8 }),
  });
  if (res.status === 429) {
    const e: any = new Error("RATE_LIMIT");
    e.rate = true;
    throw e;
  }
  if (!res.ok) throw new Error(`vndb ${res.status}`);
  const j: any = await res.json();
  return (j?.results as VndbResult[]) ?? [];
}

function applyVndb(g: Game, r: VndbResult): number {
  let n = 0;
  const cover = r.image?.url;
  if (!g.coverImage && cover) {
    g.coverImage = cover;
    if (!g.screenshot) g.screenshot = cover;
    n++;
  }
  const desc = stripVndbBbcode(r.description);
  if (summaryIsPlaceholder(g.summary) && desc) {
    g.summary = desc;
    n++;
  }
  const dev = (r.developers || []).map((d) => d?.name).find(Boolean);
  if (dev) {
    if (devIsPlaceholder(g.developer)) {
      g.developer = dev;
      n++;
    }
    if (!g.publisher || devIsPlaceholder(g.publisher)) g.publisher = dev;
  }
  if (!g.releaseDate) {
    const d = vndbReleaseDate(r.released);
    if (d) {
      g.releaseDate = d;
      n++;
    }
  }
  if (!(g.genres || []).some((x) => /visual novel/i.test(x))) {
    g.genres = [...(g.genres || []), "Visual Novel"];
    n++;
  }
  const idNum = parseInt(String(r.id || "").replace(/\D/g, ""), 10);
  if (Number.isFinite(idNum) && !g.vndbId) g.vndbId = idNum;
  return n;
}

function loadAttempted(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8")).attempted);
  } catch {
    return new Set();
  }
}
function saveAttempted(s: Set<string>): void {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ attempted: Array.from(s) }), "utf8");
}

async function main() {
  const games = readGames<Game>();
  gamesRef = games;
  const attempted = loadAttempted();
  let targets = games.filter((g) => isTarget(g) && !attempted.has(g.id));
  const totalTargets = games.filter(isTarget).length;
  if (LIMIT) targets = targets.slice(0, LIMIT);

  console.log(
    `catalog=${games.length} | adult targets=${totalTargets} | this run=${targets.length} | already attempted=${attempted.size}`
  );
  if (!targets.length) return;

  if (fs.existsSync(GRIND_LOCK) && !DRY) {
    console.error("ABORT: grind lock present — do not modify the catalog while the grind is running");
    process.exit(2);
  }

  let done = 0,
    matched = 0,
    fieldsFilled = 0,
    missed = 0,
    failed = 0;
  const samples: string[] = [];

  for (const g of targets) {
    let results: VndbResult[] | null = null;
    for (let attempt = 0; attempt < 3 && !results; attempt++) {
      try {
        results = await vndbSearch(g.title);
      } catch (e: any) {
        failed++;
        if (e.rate) {
          rateLimited++;
          await sleep(4000 * (attempt + 1));
        } else {
          break;
        }
      }
    }
    if (results) {
      const r = vndbBestMatch(g.title, results);
      if (r) {
        matched++;
        const filled = applyVndb(g, r);
        fieldsFilled += filled;
        if (filled > 0 && samples.length < 20) {
          samples.push(`${g.title.slice(0, 42)} -> ${(r.title || "").slice(0, 42)} (+${filled})`);
        }
      } else {
        missed++;
      }
    }
    attempted.add(g.id);
    done++;
    if (done % 25 === 0) {
      console.log(`[VNDB] ${done}/${targets.length} matched=${matched} missed=${missed} fields=${fieldsFilled} failed=${failed}`);
      if (!DRY) {
        saveAttempted(attempted);
        persist();
      }
    }
    await sleep(350);
  }

  if (!DRY) {
    saveAttempted(attempted);
    persist();
  }
  console.log(
    `DONE: attempted=${done} matched=${matched} missed=${missed} fieldsFilled=${fieldsFilled} failed=${failed} rateLimited=${rateLimited}${DRY ? " (dry-run)" : ""}`
  );
  for (const s of samples) console.log("  " + s);
}

main().catch((e) => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});
