import fs from "fs";
const games = JSON.parse(fs.readFileSync("data/merged_enriched.json", "utf8"));
const titles = ["Elden Ring", "Cyberpunk 2077", "Baldur", "Grand Theft Auto V", "The Witcher 3", "Red Dead Redemption 2", "Hogwarts Legacy", "Palworld", "Black Myth", "Helldivers 2", "Dota 2", "Counter", "Portal 2", "Hades", "Stardew Valley", "Terraria"];
for (const t of titles) {
  const g = games.find(x => x.title && x.title.toLowerCase().includes(t.toLowerCase()));
  if (g) console.log(`${g.title} | id:${g.id} | steamId:${g.steamId ?? "-"} | dev:"${g.developer}" | shots:${(g.screenshots || []).length} | cover:${g.coverImage ? "YES" : "NO"} | linux:${JSON.stringify(g.linux || null)}`);
  else console.log(`NOT FOUND: ${t}`);
}
let noShots = 0, noCover = 0, noDev = 0, noSummary = 0;
for (const g of games) {
  if (g.classic) continue;
  if (!g.screenshots || !g.screenshots.length) noShots++;
  if (!g.coverImage) noCover++;
  if (!g.developer) noDev++;
  if (!g.summary || g.summary.includes("Available via")) noSummary++;
}
console.log(`non-classic total=${games.filter(g=>!g.classic).length} noShots=${noShots} noCover=${noCover} noDev=${noDev} noSummary=${noSummary}`);