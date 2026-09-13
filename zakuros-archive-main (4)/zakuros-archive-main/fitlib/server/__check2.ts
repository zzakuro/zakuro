import fs from "fs";
const games = JSON.parse(fs.readFileSync("data/merged_enriched.json", "utf8"));
const pops = [...games].sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0)).slice(0, 200);
let noShot = 0, noCover = 0, noDev = 0, noSummary = 0, noRating = 0, oneShotOnly = 0;
for (const g of pops) {
  if (!g.screenshots || !g.screenshots.length) noShot++;
  if (g.screenshots?.length === 1) oneShotOnly++;
  if (!g.coverImage) noCover++;
  if (!g.developer) noDev++;
  if (!g.summary || g.summary.includes("Available via")) noSummary++;
  if (!g.rating) noRating++;
}
console.log(`TOP-200 by popularity: total=${pops.length}`);
console.log(` noScreenshots=${noShot}  oneShotOnly=${oneShotOnly}  noCover=${noCover}  noDev=${noDev}  noSummary=${noSummary}  noRating=${noRating}`);
for (const g of pops.filter(x => !x.screenshots?.length).slice(0, 12)) {
  console.log(`   MISSING-SHOT: ${g.title} | id=${g.id} | steamId=${g.steamId ?? "-"} | dev="${g.developer || ""}" | pop=${g.popularityScore}`);
}