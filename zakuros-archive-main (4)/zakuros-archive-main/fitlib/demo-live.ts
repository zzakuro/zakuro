// Temporary one-off demo (deleted after use): run a full source sync ingesting
// the Scrapling-fetched live hydralinks.cloud feeds (data/live/*.json).
// Mirrors server.ts's syncSources call but disables network metadata enrichment
// so the run stays fast and offline-ish (Steam ID backfill/validation still run).
import fs from "fs";
import path from "path";
import { readGames, writeGames } from "./server/catalogIO";
import { readSourcesConfig, syncSources } from "./server/sources";

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const LIVE_DIR = path.join(process.cwd(), "data", "live");

function snapshotPreRun(games: unknown[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const f = path.join(process.cwd(), "data", "snapshots", `catalog-pre-live-${stamp}.json`);
  fs.writeFileSync(f, JSON.stringify(games));
  return f;
}

async function main() {
  const config = readSourcesConfig(path.join(process.cwd(), "data", "sources.json"));

  const remapped: Array<{ name: string; kind: string; target: string }> = [];
  for (const s of config) {
    const liveFile = path.join(LIVE_DIR, `${slug(s.name)}.json`);
    if (fs.existsSync(liveFile)) {
      s.filePath = liveFile;
      s.url = undefined;
      delete s.headers;
      remapped.push({ name: s.name, kind: "LIVE", target: path.relative(process.cwd(), liveFile) });
    } else if (s.filePath) {
      remapped.push({ name: s.name, kind: "LOCAL", target: s.filePath });
    } else {
      remapped.push({ name: s.name, kind: "FETCH", target: s.url || "" });
    }
  }

  console.log("Source plan:");
  for (const r of remapped) console.log(`  [${r.kind.padEnd(5)}] ${r.name}: ${r.target}`);
  console.log();

  const games = readGames<any>();
  const snap = snapshotPreRun(games);
  console.log(`Pre-run catalog: ${games.length} games. Snapshot saved: ${path.basename(snap)}\n`);

  const result = await syncSources({
    sources: config,
    getCatalog: () => games,
    setCatalog: (next) => writeGames(next),
    enrich: false,
  });

  console.log(
    `[Demo] done in ${Date.parse(result.finishedAt) - Date.parse(result.startedAt)}ms — ` +
      `+${result.totals.added} added, ${result.totals.updated} updated, ` +
      `${result.totals.unchanged} unchanged, catalog is now ${result.totals.totalGames} games.`
  );
  for (const s of result.sources) {
    if (s.ok) console.log(`  [ok ] ${s.name}: ${s.uniqueCount} titles`);
    else console.log(`  [err] ${s.name}: ${s.error}`);
  }

  const after = readGames<any>();
  console.log(`\nSilent Hill matches in catalog (${after.length} games):`);
  for (const g of after.filter((g: any) => /silent hill|townfall/i.test(g.title || ""))) {
    console.log(`  - ${g.title} | ${g.fileSize || "n/a"} | id=${g.id} | sources=${(g.downloadSources || []).length}`);
  }

  const townfall = after.find((g: any) => /townfall/i.test(g.title || ""));
  if (townfall) {
    console.log(`\nTownfall entry downloadSources:`);
    for (const s of townfall.downloadSources || []) {
      console.log(`  - repacker=${s.repacker} | url=${String(s.url).slice(0, 120)}`);
    }
  } else {
    console.log("\nTownfall NOT found in catalog after sync!");
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});