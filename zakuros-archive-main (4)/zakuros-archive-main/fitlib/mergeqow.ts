import { readGames, writeGames } from "./server/catalogIO";

async function main() {
  const games = await readGames();
  const base = games.find((g) => g.id === "god-of-war");
  const variant = games.find((g) => g.id === "god-of-war-1hrnv0j");
  if (!base || !variant) {
    console.log(`base=${!!base} variant=${!!variant} — nothing to do`);
    return;
  }
  const have = new Set((base.downloadSources || []).map((s) => s.url));
  let folded = 0;
  for (const s of variant.downloadSources || []) {
    if (s?.url && !have.has(s.url)) {
      base.downloadSources = base.downloadSources || [];
      base.downloadSources.push(s);
      have.add(s.url);
      folded++;
    }
  }
  if (variant.summary && !base.summary) base.summary = variant.summary;
  const next = games.filter((g) => g.id !== "god-of-war-1hrnv0j");
  await writeGames(next);
  console.log(`merged variant into ${base.id}: folded ${folded} downloads, now ${next.length} games`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});