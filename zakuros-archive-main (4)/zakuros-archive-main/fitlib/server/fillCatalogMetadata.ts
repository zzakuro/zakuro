// Full metadata grind:
//   Stage A (match)  — steamId for every non-classic game still missing one:
//                      offline Steam index (clean + junk-stripped keys, fuzzy),
//                      then an online Steam store-search sweep for leftovers.
//   Stage B (steam+proton) — for every game with a steamId that lacks Linux
//                      info: fetch Steam appdetails (summary/developer/date/
//                      rating/screenshots + native-linux flag) and the ProtonDB
//                      report in parallel, then record the Linux badge.
//
// Resumable via data/steam_grind_state.json; writes through to
// data/merged_enriched.json atomically every ~15s. While running it drops a
// data/.grind-active lock so the dev server's catalog persistence defers.
//
// Usage:
//   npx tsx server/fillCatalogMetadata.ts               # full run
//   npx tsx server/fillCatalogMetadata.ts --limit=300   # bounded run (verify)
//   npx tsx server/fillCatalogMetadata.ts --no-online   # skip store-search stage
//   npx tsx server/fillCatalogMetadata.ts --skip-stage-a
//            # only enrich existing steamIds (skip the missing-id resolution),
//            # for when you don't want the ~20 min online search sweep first.
// Order is always Stage A (id resolution) then Stage B (details+ProtonDB);
// Stage A's attemptedMatch state makes it fully resumable.
import fs from "fs";
import path from "path";
import { Game } from "../src/types";
import { GAMES_DB_PATH, readGames, writeGames } from "./catalogIO";
import { normalizeGame } from "./normalize";
import {
  fetchSteamDetails,
  fetchProtonSummary,
  parseSteamPcRequirements,
} from "./metadataService";
import {
  resolveMissingSteamIds,
  steamTitleMismatch,
  screenshotsArePlaceholder,
  setRealScreenshots,
  summaryIsPlaceholder,
  devIsPlaceholder,
  shouldUpgradeSummary,
  stabilizeCatalog,
  pruneForeignFiller,
} from "./sources";

const STATE_PATH = path.join(process.cwd(), "data", "steam_grind_state.json");
const LOCK_PATH = path.join(process.cwd(), "data", ".grind-active");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what + " timed out")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
const argLimit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]);
const noOnline = process.argv.includes("--no-online");
const skipStageA = process.argv.includes("--skip-stage-a");

interface GrindState {
  attemptedMatch: string[]; // game ids already online-searched
  protonDone: number[]; // steam appids already resolved against ProtonDB
}

function loadState(): GrindState {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return {
      attemptedMatch: Array.isArray(s.attemptedMatch) ? s.attemptedMatch : [],
      protonDone: Array.isArray(s.protonDone) ? s.protonDone : [],
    };
  } catch {
    return { attemptedMatch: [], protonDone: [] };
  }
}

function saveState(state: GrindState): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state), "utf8");
}

function saveCatalog(games: Game[]): void {
  // Drop re-imported foreign filler, then collapse same-appid/edition dupes,
  // in place before writing so the long-lived `games` array stays authoritative.
  const pruned = pruneForeignFiller(games);
  if (pruned > 0) console.log(`[Grind] prune-on-save dropped ${pruned} foreign filler rows.`);
  const { games: stabilized, merged } = stabilizeCatalog(games);
  if (merged > 0) {
    console.log(`[Grind] stabilize-on-save merged ${merged} duplicate rows.`);
    games.length = 0;
    for (const g of stabilized) games.push(g);
  }
  writeGames(games);
}

function stillMissingMeta(g: Game): boolean {
  return !g.classic && typeof g.steamId === "number" && !g.summary;
}

async function main() {
  const limit = Number.isFinite(argLimit) ? argLimit : Infinity;
  fs.writeFileSync(
    LOCK_PATH,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    "utf8"
  );
  const games = readGames<Game>();
  let normalized = 0;
  for (const g of games) if (normalizeGame(g)) normalized++;
  if (normalized) {
    console.log(`[Grind] normalized ${normalized} games (release dates / popularity scores)`);
    saveCatalog(games);
  }
  const state = loadState();
  const attemptedMatch = new Set(state.attemptedMatch);
  const protonDone = new Set(state.protonDone);
  const startedAt = Date.now();

  console.log(
    `[Grind] games: ${games.length} | match attempted: ${attemptedMatch.size} | proton appids: ${protonDone.size}`
  );

  const syncBack = () =>
    saveState({ attemptedMatch: Array.from(attemptedMatch), protonDone: Array.from(protonDone) });

  // ── Stage A: resolve missing steamIds (resumable — online search only hits
  //     games that haven't been attempted yet) ───────────────────────────────
  const runStageA = async () => {
    const matchCandidates = games.filter(
      (g) => !g.classic && !g.steamId && g.title && !attemptedMatch.has(g.id)
    );
    console.log(`[Grind][A] games needing steamId resolution: ${matchCandidates.length}`);

    if (matchCandidates.length === 0 || limit === 0) {
      return { filled: 0, unmatched: matchCandidates.length, onlineSearched: 0 };
    }

    const matchRes = await resolveMissingSteamIds(matchCandidates, {
      online: !noOnline,
      onReachedOnline: (n) => {
        if (n % 100 === 0) {
          console.log(`[Grind][A] online store-search: ${n} searched`);
        }
      },
    });
    for (const g of matchCandidates) attemptedMatch.add(g.id);
    console.log(
      `[Grind][A] match done: +${matchRes.filled} filled, ${matchRes.unmatched} unmatched (online searched: ${matchRes.onlineSearched})`
    );
    saveCatalog(games);
    syncBack();
    return matchRes;
  };

  // ── Stage B: steam details + ProtonDB for every steamId missing Linux info ─
  // (re-derives the candidate list each resume; already-enriched games lacking
  // linux still count, so this is what backfills the whole catalog's badges.)
  const runStageB = async () => {
    // A game needs re-visiting when a field is placeholder OR its summary is
    // just a short blurb (<300 chars) — so the full Steam description upgrades it.
    const needsTextUpgrade = (g: any) =>
      summaryIsPlaceholder(g.summary) || (!!g.summary && g.summary.trim().length < 300);
    const candidates = games
      .filter((
        g
      ) =>
        !g.classic &&
        typeof g.steamId === "number"
      )
      .filter((g) => !g.linux || (g.linux.native === undefined && !g.linux.tier) || screenshotsArePlaceholder(g) || needsTextUpgrade(g) || devIsPlaceholder(g.developer) || devIsPlaceholder(g.publisher))
      .filter((g) => !protonDone.has(g.steamId as number) || screenshotsArePlaceholder(g) || needsTextUpgrade(g) || devIsPlaceholder(g.developer) || devIsPlaceholder(g.publisher))
      .sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0))
      .slice(0, limit);

    console.log(`[Grind][B] candidates needing Steam+ProtonDB: ${candidates.length}`);

    let bDone = 0;
    let bEnriched = 0;
    let bNoReport = 0;
    let lastCatalogSave = Date.now();
    for (const game of candidates) {
      const appid = game.steamId as number;
      await sleep(1250);
      try {
        const [details, proton] = await Promise.all([
          withTimeout(fetchSteamDetails(appid), 20000, `steam ${appid}`),
          withTimeout(fetchProtonSummary(appid), 20000, `proton ${appid}`),
        ]);

// Live-title verification: drop dead/stale/mislabeled dump matches so we
      // never ship a wrong cover. Only unassign games that are STILL UNENRICHED
      // (freshly matched) — an already-enriched id is far more likely a legit
      // but delisted title (e.g. GTA IV) whose appdetails no longer resolve,
      // or a subtitle/locale variant, than an error.
      const unenriched = !game.developer && !game.summary;
      if (
        unenriched &&
        (!details.title || steamTitleMismatch(game.title, details.title))
      ) {
        game.steamId = undefined;
        game.coverImage = "";
        game.screenshot = "";
        game.screenshots = [];
        game.developer = "";
        game.summary = "";
        game.linux = undefined;
        bNoReport++;
        protonDone.add(appid);
        continue;
      }

      if (details.title) {
        // Fill any still-missing OR placeholder fields (incomplete/mis-marked
        // entries plus repack placeholders like "Available via: ...").
        if (details.summary && shouldUpgradeSummary(game.summary, details.summary)) game.summary = details.summary;
        if (details.releaseDate && (!game.releaseDate || game.releaseDate.includes("Unknown"))) {
          game.releaseDate = details.releaseDate;
        }
        if (details.developer && devIsPlaceholder(game.developer)) game.developer = details.developer;
        if (details.publisher && devIsPlaceholder(game.publisher)) game.publisher = details.publisher;
        if (details.rating !== undefined && (game.rating === 0 || !game.rating)) {
          game.rating = details.rating;
        }
        if (details.screenshots?.length) {
          setRealScreenshots(game, details.screenshots);
        }
        // Steam genre tags: append any we don't already have (repack genres
        // stay, deduped), capped so cards don't overflow.
        if (details.genres?.length) {
          const have = new Set((game.genres || []).map((g) => g.toLowerCase()));
          const fresh = details.genres.filter((g) => !have.has(g.toLowerCase()));
          if (fresh.length) game.genres = [...(game.genres || []), ...fresh].slice(0, 12);
        }
        // Trailers: only when Steam has movies.
        if (details.trailers?.length) {
          game.trailers = details.trailers;
        }
        // Covers were assigned title-based and can disagree with the VERIFIED
        // appid (e.g. Baldur's Gate II showing BG3's art). Only when this fetch
        // confirms the appid truly belongs to this title do we align the cover
        // to the game's own library art — never otherwise.
        if (!steamTitleMismatch(game.title, details.title)) {
          const ownCover = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;
          const coverAppid = (game.coverImage || "").match(/\/apps\/(\d+)\//)?.[1];
          if (coverAppid && coverAppid !== String(appid) && game.coverImage !== ownCover) {
            game.coverImage = ownCover;
          }
        }
        // System requirements from Steam's per-platform specs (only when we
        // have none for that platform yet).
        const applyPlatform = (spec: string | undefined, key: "windows" | "mac" | "linux") => {
          const parsed = parseSteamPcRequirements(spec);
          if (parsed && !game.systemRequirements?.[key]?.minimum?.os) {
            game.systemRequirements = game.systemRequirements || {};
            game.systemRequirements[key] = parsed;
          }
        };
        applyPlatform(details.steamDetails?.pcSpecs, "windows");
        applyPlatform(details.steamDetails?.macSpecs, "mac");
        applyPlatform(details.steamDetails?.linuxSpecs, "linux");
      }

      // Always record the Linux verdict. When appdetails were unavailable
      // (delisted/removed) we keep the existing id/fields and only merge Proton.
      game.linux = {
        ...(game.linux || {}),
        ...(details.title ? { native: !!details.linuxNative } : {}),
        ...(proton || {}),
      };
      if (proton) bEnriched++;
      else bNoReport++;
      } catch (e: any) {
        if (e?.message === "RATE_LIMIT_EXCEEDED") {
          console.warn(`[Grind][B] Steam rate-limited at "${game.title}"; backing off 45s...`);
          await sleep(45000);
          continue; // don't mark the appid done so it retries next pass
        }
        // Transient 5xx/network — do NOT mark this appid done (it wasn't
        // verified, so the next pass retries instead of permanently skipping a
        // perfectly valid steamId).
        console.warn(`[Grind][B] Transient failure at "${game.title}" (${appid}): ${e?.message ?? e}`);
        continue;
      }
      protonDone.add(appid);
      bDone++;

      if (bDone % 25 === 0) {
        const min = ((Date.now() - startedAt) / 60000).toFixed(1);
        console.log(
          `[Grind][B] ${bDone}/${candidates.length} | +${bEnriched} tiered, ${bNoReport} no-report | ${min} min elapsed`
        );
      }
      if (Date.now() - lastCatalogSave > 15000) {
        saveCatalog(games);
        syncBack();
        lastCatalogSave = Date.now();
        console.log(`[Grind] progress saved (${bDone}/${candidates.length})`);
      }
    }

    saveCatalog(games);
    syncBack();
    return { bDone, bEnriched, bNoReport };
  };

  let bRes = { bDone: 0, bEnriched: 0, bNoReport: 0 };
  if (!skipStageA) await runStageA();
  bRes = await runStageB();

  const withLinux = games.filter((g) => !g.classic && g.linux && (g.linux.tier || g.linux.native)).length;
  const stillNoSteam = games.filter((g) => !g.classic && !g.steamId).length;
  const stillNoSumm = games.filter(stillMissingMeta).length;
  console.log(
    `[Grind] done: ${bRes.bDone} appids visited | +${bRes.bEnriched} proton tiers | catalog now has Linux support for ${withLinux} games`
  );
  console.log(`[Grind] after: still no steamId: ${stillNoSteam} | still no summary: ${stillNoSumm}`);
  console.log(`[Grind] catalog + state saved.`);

  fs.rmSync(LOCK_PATH, { force: true });
  console.log(`[Grind] lock released.`);
}

main()
  .catch((e) => {
    console.error(e);
    try {
      fs.rmSync(LOCK_PATH, { force: true });
    } catch {}
    process.exit(1);
  });