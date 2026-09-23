// GOG id assignment from offline databases with fuzzy-but-safe title matching.
// For each catalog row missing real metadata: match its rough title key against
// dump titles via word-jaccard. Assign only when the best match is >= 0.60 AND
// at least 0.05 ahead of the runner-up (avoids ambiguous picks like two
// editions/series). Exact-key matches always win (jaccard 1.0).
// Run: npx tsx server/_assignGog.ts [--dry]
import fs from "fs";
import { Game } from "../src/types";
import { readGames, writeGames } from "./catalogIO";
import { roughTitleKey, selfHealCatalog } from "./sources";
import { parseGogDump, resolveDumpPath } from "./gogDump";

const DRY = process.argv.includes("--dry");

function main() {
  const games = readGames<Game>();
  const dumpRecs = parseGogDump(resolveDumpPath());
  console.log(`[GogAssign] dump records: ${dumpRecs.size}`);

  // index dump keys -> recs
  const byKey = new Map<string, { gogId: string; gogUrl: string; slug: string }>();
  const wordIndex = new Map<string, Set<string>>(); // word -> dump keys
  for (const r of dumpRecs.values()) {
    const k = roughTitleKey(r.title);
    if (!k) continue;
    if (!byKey.has(k)) {
      byKey.set(k, { gogId: r.gogId, gogUrl: r.gogUrl || `https://www.gog.com/game/${r.slug}`, slug: r.slug });
      for (const w of k.split(" ")) {
        if (w.length > 1) {
          const s = wordIndex.get(w) ?? new Set<string>();
          s.add(k);
          wordIndex.set(w, s);
        }
      }
    }
  }
  console.log(`[GogAssign] index: ${byKey.size} keys`);

  const candidates = games.filter(
    (g) => !g.classic && !g.gogId && g.title &&
      (!g.summary || !g.coverImage || !g.developer) // only metadata-starved rows
  );
  console.log(`[GogAssign] candidates: ${candidates.length}${DRY ? " (dry)" : ""}`);

  const wordSet = (k: string) => {
    const s = new Set<string>();
    for (const w of k.split(" ")) if (w.length > 1) s.add(w);
    return s;
  };
  const jaccard = (a: Set<string>, b: Set<string>) => {
    let i = 0;
    for (const w of a) if (b.has(w)) i++;
    const u = a.size + b.size - i;
    return u ? i / u : 0;
  };

  let assigned = 0;
  let exactCnt = 0;
  const scored: { title: string; gogId: string; score: number; match: string }[] = [];
  for (const g of candidates) {
    const k = roughTitleKey(g.title);
    if (!k) continue;
    const exact = byKey.get(k);
    if (exact) {
      exactCnt++;
      if (!DRY) { g.gogId = exact.gogId; if (exact.gogUrl) g.gogUrl = exact.gogUrl; }
      assigned++;
      continue;
    }
    // candidate dump keys sharing any significant word
    const candKeys = new Set<string>();
    for (const w of k.split(" ")) {
      if (w.length < 3) continue;
      for (const dk of wordIndex.get(w) ?? []) candKeys.add(dk);
    }
    if (!candKeys.size) continue;
    const selfWords = wordSet(k);
    let best = 0, second = 0, bestKey = "", bestTitle = "";
    for (const dk of candKeys) {
      const j = jaccard(selfWords, wordSet(dk));
      if (j > best) { second = best; best = j; bestKey = dk; }
      else if (j > second) { second = j; }
    }
    if (best >= 0.6 && best - second >= 0.05) {
      const rec = byKey.get(bestKey)!;
      if (!DRY) { g.gogId = rec.gogId; if (rec.gogUrl) g.gogUrl = rec.gogUrl; }
      assigned++;
      scored.push({ title: g.title, gogId: rec.gogId, score: best, match: bestTitle });
    }
  }
  console.log(`[GogAssign] assigned: ${assigned} (exact-key ${exactCnt})${DRY ? " [dry]" : ""}`);
  for (const s of scored.slice(0, 20)) {
    console.log(`    "${s.title.slice(0, 50)}" -> gog ${s.gogId} (${s.score.toFixed(2)})`);
  }
  if (!DRY && assigned) {
    const h = selfHealCatalog(games);
    console.log(`[GogAssign] self-heal: ${JSON.stringify(h)}`);
    writeGames(games);
    console.log(`[GogAssign] catalog saved`);
  }
}
main();