// Backfill IGDB summaries/covers/ratings for non-classic games that have no
// Steam/GOG id and still carry placeholder metadata. IGDB creds come from .env
// (loaded here — the server env doesn't carry them). The search is gated inside
// fetchIGDBDetails (>=0.75 title match + era pick), so only solid hits apply.
// Resumable via data/igdb_fill_progress.json; --limit bounds one pass.
// Run: npx tsx server/_fillIgdb.ts [--limit N]
import fs from "fs";
import path from "path";
import { Game } from "../src/types";
import { readGames, writeGames } from "./catalogIO";
import { selfHealCatalog, summaryIsPlaceholder, shouldUpgradeSummary } from "./sources";
import { fetchIGDBDetails } from "./metadataService";

const PROGRESS_PATH = path.join(process.cwd(), "data", "igdb_fill_progress.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const argLimit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]);

// pull IGDB creds from the repo .env without echoing them
try {
  for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(".*?"|'.*?'|[^\r\n]*?)\s*$/.exec(line);
    if (m && !m[1].startsWith("#")) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* environment may already have them */ }

let gamesRef: Game[] = [];
function persist(): void {
  const h = selfHealCatalog(gamesRef);
  if (h.filler || h.bilingual || h.merged || h.covers) console.log(`[IGDB] self-heal on save: ${JSON.stringify(h)}`);
  writeGames(gamesRef);
}
function loadAttempted(): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8")).attempted); } catch { return new Set(); }
}
function saveAttempted(s: Set<string>): void {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ attempted: Array.from(s) }), "utf8");
}

const noSumm = (g: Game) => !g.summary || summaryIsPlaceholder(g.summary);

async function main() {
  const games = readGames<Game>();
  gamesRef = games;
  const attempted = loadAttempted();
  let targets = games.filter(
    (g) => !g.classic && !g.steamId && !g.gogId && g.title && (noSumm(g) || !g.coverImage) && !attempted.has(g.id)
  );
  const total = games.filter((g) => !g.classic && !g.steamId && !g.gogId && g.title && (noSumm(g) || !g.coverImage)).length;
  if (Number.isFinite(argLimit)) targets = targets.slice(0, argLimit);
  console.log(`[IGDB] targets=${total} | this pass=${targets.length} | attempted=${attempted.size} | creds=${!!process.env.IGDB_CLIENT_ID}`);
  if (!targets.length) return;

  let done = 0, hit = 0, miss = 0, fields = 0, rateLimited = 0;
  const startedAt = Date.now();
  for (const g of targets) {
    let res: any = null;
    try {
      res = await fetchIGDBDetails(g.title || "");
    } catch (e: any) {
      if (e?.message === "RATE_LIMIT_EXCEEDED") {
        rateLimited++;
        await sleep(15000);
        continue;
      }
    }
    let n = 0;
    if (res && res.summary && shouldUpgradeSummary(g.summary, res.summary)) { g.summary = res.summary; n++; }
    if (res && res.coverImage && !g.coverImage) { g.coverImage = res.coverImage; if (!g.screenshot) g.screenshot = res.coverImage; n++; }
    if (res && res.rating && !g.rating) { g.rating = res.rating; n++; }
    if (n > 0) hit++; else miss++;
    fields += n;
    attempted.add(g.id);
    done++;
    if (done % 25 === 0) {
      const min = ((Date.now() - startedAt) / 60000).toFixed(1);
      console.log(`[IGDB] ${done}/${targets.length} hit=${hit} miss=${miss} fields=${fields} rate=${rateLimited} | ${min} min`);
      persist();
      saveAttempted(attempted);
    }
    await sleep(350);
  }
  persist();
  saveAttempted(attempted);
  console.log(`[IGDB] DONE: this pass ${done} | hit=${hit} miss=${miss} fields=${fields} rateLimited=${rateLimited}`);
}

main().catch((e) => { console.error("FATAL:", e?.message || e); process.exit(1); });