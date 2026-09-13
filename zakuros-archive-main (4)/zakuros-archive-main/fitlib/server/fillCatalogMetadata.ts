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
//   npx tsx server/fillCatalogMetadata.ts --stage-b-first
//            # enrich high-popularity games (Stage B) before the slow online
//            # store-search sweep (Stage A), so the most visible titles get
//            # real screenshots + linux badges sooner.
import fs from "fs";
import path from "path";
import { Game } from "../src/types";
import {
  fetchSteamDetails,
  fetchProtonSummary,
} from "./metadataService";
import { resolveMissingSteamIds, steamTitleMismatch } from "./sources";

const GAMES_DB_PATH = path.join(process.cwd(), "data", "merged_enriched.json");
const STATE_PATH = path.join(process.cwd(), "data", "steam_grind_state.json");
const LOCK_PATH = path.join(process.cwd(), "data", ".grind-active");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const argLimit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]);
const noOnline = process.argv.includes("--no-online");
const stageBFirst = process.argv.includes("--stage-b-first");

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
  const tmp = `${GAMES_DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(games), "utf8");
  fs.renameSync(tmp, GAMES_DB_PATH);
}

function stillMissingMeta(g: Game): boolean {
  return !g.classic && typeof g.steamId === "number" && !g.summary;
}

async function main() {
  const limit = Number.isFinite(argLimit) ? argLimit : Infinity;
  fs.writeFileSync(LOCK_PATH, "grinding", "utf8");
  const games = JSON.parse(fs.readFileSync(GAMES_DB_PATH, "utf8")) as Game[];
  const state = loadState();
  const attemptedMatch = new Set(state.attemptedMatch);
  const protonDone = new Set(state.protonDone);
  const startedAt = Date.now();

  console.log(
    `[Grind] games: ${games.length} | match attempted: ${attemptedMatch.size} | proton appids: ${protonDone.size} | order: ${stageBFirst ? "B-then-A" : "A-then-B"}`
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
    const candidates = games
      .filter(
        (g) =>
          !g.classic &&
          typeof g.steamId === "number"
      )
      .filter((g) => !g.linux || (g.linux.native === undefined && !g.linux.tier))
      .filter((g) => !protonDone.has(g.steamId as number))
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
          fetchSteamDetails(appid),
          fetchProtonSummary(appid),
        ]);

        // Live-title verification: drop dead/stale/mislabeled dump matches so we
        // never ship a wrong cover. For title mismatches only unassign games that
        // are still unenriched (freshly matched) — a name mismatch on an already
        // enriched id is more likely a subtitle/locale variant than an error.
        if (
          !details.title ||
          (steamTitleMismatch(game.title, details.title) && (!game.developer || !game.summary))
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

        // Fill any still-missing real fields (incomplete/mis-marked entries).
        if (details.summary && !game.summary) game.summary = details.summary;
        if (details.releaseDate && (!game.releaseDate || game.releaseDate.includes("Unknown"))) {
          game.releaseDate = details.releaseDate;
        }
        if (details.developer && !game.developer) game.developer = details.developer;
        if (details.publisher && !game.publisher) game.publisher = details.publisher;
        if (details.rating !== undefined && (game.rating === 0 || !game.rating)) {
          game.rating = details.rating;
        }
        if (details.screenshots?.length && (!game.screenshots || !game.screenshots.length)) {
          game.screenshots = details.screenshots;
        }

        game.linux = {
          ...(game.linux || {}),
          native: !!details.linuxNative,
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
        bNoReport++;
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
  if (stageBFirst) {
    bRes = await runStageB();
    await runStageA();
  } else {
    await runStageA();
    bRes = await runStageB();
  }

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