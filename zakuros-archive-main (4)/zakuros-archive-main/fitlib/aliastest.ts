import { readGames, writeGames } from "./server/catalogIO";
import { selfHealCatalog, stabilizeCatalog } from "./server/sources";

async function main() {
  const games = await readGames();
  console.log(`loaded ${games.length}`);

  const aliasGame = games.find((g) => g.id === "101-cats-hidden-build-1pvt4zx-1")!;
  const dup = [...games, aliasGame];
  console.log(`after injecting alias copy: ${dup.length}`);

  const r1 = stabilizeCatalog(dup);
  console.log(`stabilizeCatalog => merged ${r1.merged}, regen ${r1.regen}, out ${r1.games.length}`);

  const r2 = stabilizeCatalog([...games]);
  let dupAfter = 0;
  const seen = new Set<string>();
  for (const g of r2.games) {
    if (seen.has(g.id)) dupAfter++;
    seen.add(g.id);
  }
  console.log(`real file after heal: ${r2.games.length}, dup ids: ${dupAfter}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});