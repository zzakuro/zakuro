// Resolve Steam-appid quality issues in the catalog. Two classes of problem:
//
//   1. Edition mismatches — one steamId shared by dissimilar titles (a store
//      search matched the wrong game). The real Steam app name decides which
//      title cluster owns the id; the other clusters have it cleared.
//   2. Unknown appids — a steamId absent from data/steam_apps.json. With
//      --online each is checked against the live store; dead ids are cleared.
//
// Dry-run by default. Pass --apply to write. Writing is refused while the grind
// lock (data/.grind-active) exists, and the catalog is backed up first.
// Run: npx tsx server/fixAppidIssues.ts [--apply] [--online] [--resolve] [--limit N]
import fs from "fs";
import path from "path";
import { Game } from "../src/types";
import { readGames, writeGames, GAMES_DB_PATH } from "./catalogIO";
import {
  roughTitleKey,
  titlesLookLikeSameGame,
  selfHealCatalog,
  resolveMissingSteamIds,
} from "./sources";

const APPLY = process.argv.includes("--apply");
const ONLINE = process.argv.includes("--online");
const RESOLVE = process.argv.includes("--resolve");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Math.max(0, Number(process.argv[i + 1]) || 0) : 0;
})();
const BUDGET = LIMIT || Infinity;

const DATA_DIR = path.join(process.cwd(), "data");
const STEAM_APPS_PATH = path.join(DATA_DIR, "steam_apps.json");
const GRIND_LOCK = path.join(DATA_DIR, ".grind-active");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadOfflineNames(): Map<number, string> {
  const map = new Map<number, string>();
  try {
    const raw = JSON.parse(fs.readFileSync(STEAM_APPS_PATH, "utf8"));
    for (const a of raw?.applist?.apps ?? []) {
      if (typeof a?.appid === "number" && a.name) map.set(a.appid, String(a.name));
    }
  } catch (e: any) {
    console.warn(`[AppidFix] Could not read steam_apps.json: ${e.message}`);
  }
  return map;
}

let liveCalls = 0;
const nameCache = new Map<number, string | null>();
async function liveAppName(appid: number): Promise<string | null> {
  if (nameCache.has(appid)) return nameCache.get(appid)!;
  if (liveCalls >= BUDGET) return null;
  liveCalls++;
  let name: string | null = null;
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=US&l=en`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const j: any = await r.json();
    const entry = j?.[String(appid)];
    if (entry?.success && entry?.data?.name) name = String(entry.data.name);
  } catch {
    name = null;
  }
  nameCache.set(appid, name);
  await sleep(250);
  return name;
}

function simScore(a: string, b: string): number {
  const ra = roughTitleKey(a);
  const rb = roughTitleKey(b);
  if (!ra || !rb) return 0;
  if (ra === rb) return 1;
  if (ra.length > 3 && rb.length > 3 && (ra.includes(rb) || rb.includes(ra))) return 1;
  const A = new Set(ra.split(" ").filter((t) => t.length > 1));
  const B = new Set(rb.split(" ").filter((t) => t.length > 1));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const APPID_ART = (appid: number) => new RegExp(`steam/apps/${appid}(/|\\.|$|\\?)`);

// Clear a wrong appid plus any Steam art that clearly came from it. Text fields
// (summary/dev/rating) are left for self-heal / IGDB to re-fill.
function clearAppid(g: Game, appid: number): void {
  g.steamId = undefined;
  const re = APPID_ART(appid);
  if (g.coverImage && re.test(g.coverImage)) g.coverImage = "";
  if (g.screenshot && re.test(g.screenshot)) g.screenshot = "";
  if (g.screenshots?.length) {
    g.screenshots = g.screenshots.filter((u) => !re.test(u));
  }
}

function findBackupRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "_backups");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), "data", "_backups");
}

async function main() {
  const games = readGames<Game>();
  console.log(
    `[AppidFix] ${games.length.toLocaleString()} games loaded${APPLY ? " (APPLY)" : " (dry-run)"}`
  );
  const names = loadOfflineNames();
  console.log(`[AppidFix] offline Steam names: ${names.size.toLocaleString()}`);
  const known = new Set(names.keys());

  // ── 1. Shared appid across dissimilar title clusters ──────────────────────
  const bySteam = new Map<number, Game[]>();
  for (const g of games) {
    if (g.classic || typeof g.steamId !== "number") continue;
    const arr = bySteam.get(g.steamId);
    if (arr) arr.push(g);
    else bySteam.set(g.steamId, [g]);
  }

  let groups = 0,
    fixedGroups = 0,
    rowsCleared = 0,
    skipped = 0;
  const cleared: Game[] = [];
  for (const [appid, arr] of bySteam) {
    if (arr.length < 2) continue;
    const clusters: Game[][] = [];
    for (const g of arr) {
      const hit = clusters.find((c) => titlesLookLikeSameGame(c[0].title || "", g.title || ""));
      if (hit) hit.push(g);
      else clusters.push([g]);
    }
    if (clusters.length < 2) continue;
    groups++;
    let canonical = names.get(appid) ?? null;
    if (!canonical && ONLINE) canonical = await liveAppName(appid);
    if (!canonical) {
      skipped++;
      continue;
    }
    let bestIdx = -1,
      best = 0;
    clusters.forEach((c, i) => {
      const s = Math.max(...c.map((m) => simScore(m.title || "", canonical as string)));
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (bestIdx < 0 || best < 0.5) {
      skipped++;
      continue;
    }
    fixedGroups++;
    for (let i = 0; i < clusters.length; i++) {
      if (i === bestIdx) continue;
      for (const m of clusters[i]) {
        clearAppid(m, appid);
        cleared.push(m);
        rowsCleared++;
      }
    }
  }
  console.log(
    `[AppidFix] shared appids: ${groups} groups · fixed ${fixedGroups} · rows cleared ${rowsCleared} · skipped ${skipped}`
  );

  // ── 2. Unknown appids (not in steam_apps.json) ────────────────────────────
  const unknown = games.filter((g) => typeof g.steamId === "number" && !known.has(g.steamId as number));
  console.log(`[AppidFix] unknown appids: ${unknown.length}`);
  let verifiedValid = 0,
    clearedUnknown = 0;
  for (const g of unknown) {
    if (!ONLINE) break;
    const name = await liveAppName(g.steamId as number);
    if (name) {
      verifiedValid++;
      continue;
    }
    clearAppid(g, g.steamId as number);
    cleared.push(g);
    clearedUnknown++;
  }
  console.log(
    `[AppidFix] unknown appids: verified-valid ${verifiedValid} · cleared ${clearedUnknown}` +
      (ONLINE ? "" : " (offline: report only — pass --online to verify)")
  );

  // ── 3. Optional re-resolution of cleared rows ─────────────────────────────
  if (RESOLVE && cleared.length) {
    const r = await resolveMissingSteamIds(cleared, {
      online: ONLINE,
      onReachedOnline: (n) => {
        if (n % 25 === 0) console.log(`  re-resolve searched ${n}`);
      },
    });
    console.log(`[AppidFix] re-resolve: filled ${r.filled} · unmatched ${r.unmatched}`);
  }

  // ── 4. Self-heal + write ──────────────────────────────────────────────────
  const heal = selfHealCatalog(games);
  console.log(`[AppidFix] self-heal: ${JSON.stringify(heal)}`);

  if (!APPLY) {
    console.log(`[AppidFix] dry-run — nothing written${ONLINE ? ` · live calls ${liveCalls}` : ""}.`);
    return;
  }
  if (fs.existsSync(GRIND_LOCK)) {
    console.error(`[AppidFix] Refusing to write: grind lock present (${GRIND_LOCK}).`);
    process.exit(1);
  }
  const anything =
    rowsCleared ||
    clearedUnknown ||
    heal.filler ||
    heal.bilingual ||
    heal.merged ||
    heal.covers ||
    heal.classic;
  if (!anything) {
    console.log("[AppidFix] No changes — skipping write.");
    return;
  }

  const backupRoot = findBackupRoot();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, `${stamp}-appidfix`);
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(GAMES_DB_PATH)) {
    fs.copyFileSync(GAMES_DB_PATH, path.join(backupDir, path.basename(GAMES_DB_PATH)));
  }
  writeGames(games);
  console.log(`[AppidFix] wrote ${games.length.toLocaleString()} games · backup: ${backupDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
