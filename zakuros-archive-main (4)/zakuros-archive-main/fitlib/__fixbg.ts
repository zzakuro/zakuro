import { readGames, writeGames } from "./server/catalogIO";
import { Game } from "./src/types";

const games = readGames<Game>();
const before = games.length;

const removed = [];
const fixed = [];

for (let i = games.length - 1; i >= 0; i--) {
  const g = games[i];
  if (g.id === "baldurs-gate-2") {
    removed.push(g.title);
    games.splice(i, 1);
    continue;
  }
  if (g.id === "baldurs-gate-ii" && /1086940/.test(g.coverImage || "")) {
    g.coverImage = "https://cdn.akamai.steamstatic.com/steam/apps/257350/library_600x900.jpg";
    fixed.push(g.title);
  }
}

writeGames(games);
console.log(`before=${before} after=${games.length} | removed: ${removed.join(", ")} | cover-fixed: ${fixed.join(", ")}`);