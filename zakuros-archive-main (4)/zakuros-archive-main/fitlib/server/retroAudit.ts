// retro:audit — report (and optionally bake) evidence-based era corrections.
//
//   npx tsx server/retroAudit.ts            # dry-run: print report, change nothing
//   npx tsx server/retroAudit.ts --apply    # persist the era corrections
//
// The report groups same-named titles (normalized title collisions) so you can
// see — per row — which side is retro vs new and why. The fix it bakes is the
// same evidence-based `classic` reclassification the server already applies at
// boot/sync via normalizeClassicFlag, so after --apply the on-disk catalog and
// the runtime agree and check:catalog stays green.
import fs from "fs";
import path from "path";
import { readGames, writeGames } from "./catalogIO";
import { normalizeForMatch } from "./sources";
import { classifyEra, yearOfGame, type EraInfo } from "./eraClassify";
import type { Game } from "../src/types";

const APPLY = process.argv.includes("--apply");
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG >= 0 ? Number(process.argv[LIMIT_ARG + 1]) || 0 : 0;

const games = readGames<Game>();

function eraLabel(g: Game): string {
  return g.classic ? "retro" : "modern";
}

// Summary of what the classifier would change (does not mutate the source rows).
const flipRows: { game: Game; info: EraInfo }[] = [];
let retroAfter = 0;
for (const g of games) {
  const info = classifyEra(g);
  if (g.classic) retroAfter++;
  if (g.classic && info.era === "modern") flipRows.push({ game: g, info });
}

const retroBefore = games.filter((g) => g.classic).length;

// Same-name collision groups.
const byNorm = new Map<string, Game[]>();
for (const g of games) {
  const norm = normalizeForMatch(g.title || "");
  if (!norm) continue;
  const arr = byNorm.get(norm) ?? [];
  arr.push(g);
  byNorm.set(norm, arr);
}

function displayRow(g: Game): string {
  const info = classifyEra(g);
  const year = yearOfGame(g);
  return [
    g.id,
    `classic=${g.classic ? "yes" : "no"}`,
    `era=${eraLabel(g)}`,
    info.platform ? `platform=${info.platform}` : "",
    year ? `year=${year}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const report: string[] = [];
report.push(`Total games: ${games.length}`);
report.push(`Classic before: ${retroBefore}  → after: ${retroAfter}  (${flipRows.length} would flip)`);
report.push("");
report.push("Collision groups (same normalized title, >1 row):");
let shown = 0;
for (const [norm, rows] of byNorm) {
  if (rows.length <= 1) continue;
  if (LIMIT && shown >= LIMIT) break;
  shown++;
  report.push(`  ${norm}:`);
  for (const g of rows) report.push(`    ${displayRow(g)}`);
}
report.push("");
report.push(`Flips by evidence (${flipRows.length}):`);
const byEvidence = new Map<string, number>();
for (const { info } of flipRows) byEvidence.set(info.evidence, (byEvidence.get(info.evidence) ?? 0) + 1);
for (const [evidence, count] of [...byEvidence.entries()].sort((a, b) => b[1] - a[1])) {
  report.push(`  ${count}× ${evidence}`);
}
report.push("");
report.push("Flip samples (first 50):");
for (const { game, info } of flipRows.slice(0, 50)) {
  report.push(`  ${game.id}  [${game.title}]  ${info.evidence}`);
}

const out = report.join("\n");
console.log(out);

const reportPath = path.join(process.cwd(), "data", "retro_audit_report.txt");
fs.writeFileSync(reportPath, out, "utf8");
console.log(`\nReport written to ${reportPath}`);

if (APPLY) {
  let flipped = 0;
  for (const g of games) {
    const era = classifyEra(g).era;
    if (g.classic && era === "modern") {
      g.classic = false;
      if (g.genres?.length) {
        const next = g.genres.filter((x) => x !== "Classic" && x !== "Retro");
        if (next.length !== g.genres.length) g.genres = next;
      }
      flipped++;
    }
  }
  console.log(`Applying: flipped ${flipped} classic → modern.`);
  writeGames(games);
  console.log("Catalog saved.");
} else {
  console.log("\nDry-run only. Re-run with --apply to persist these corrections.");
}