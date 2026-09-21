import { readGames, writeGames } from "./server/catalogIO";
import { selfHealCatalog } from "./server/sources";

async function main() {
  const games = await readGames();
  console.log(`loaded ${games.length}`);
  let pass = 0;
  let total = 0;
  while (pass < 10) {
    const r = selfHealCatalog(games);
    total += r.bilingual + r.merged + r.classic + r.covers;
    console.log(`pass ${pass} :: ${JSON.stringify(r)}`);
    if (r.filler + r.bilingual + r.merged + r.classic + r.covers === 0) break;
    pass++;
  }
  await writeGames(games);
  console.log(`done, total merged ${total}, now ${games.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});