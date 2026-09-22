import { readGames } from "./server/catalogIO";
import { Game } from "./src/types";

const gs = readGames();
const ids = new Set<string>();
let dupIds = 0;
for (const g of gs) {
  if (ids.has(g.id)) dupIds++;
  ids.add(g.id);
}
const classicWithSteam = gs.filter((g: Game) => g.classic && typeof g.steamId === "number").length;
const modernCoverless = gs.filter((g: Game) => !g.classic && !g.coverImage).length;
const classicTot = gs.filter((g: Game) => g.classic).length.;
