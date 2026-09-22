import { readGames } from "./server/catalogIO";
const g = readGames();
for (const id of ["god-of-war","god-of-war-3","god-of-war-ragnark","god-of-war-1hrnv0j"]) {
  const it = g.filter(x=>x.id===id)[0];
  if (!it) { console.log(id, "MISSING"); continue; }
  const eras = {};
  for (const s of it.downloadSources||[]) eras[s.repacker]=(eras[s.repacker]||0)+1;
  console.log(id, "| title:", JSON.stringify(it.title), "| classic:", it.classic, "| steamId:", it.steamId, "| gogId:", it.gogId, "| release:", it.releaseDate, "| dev:", it.developer, "| genres:", JSON.stringify(it.genres||[]).slice(0,120));
  console.log("   repackers:", JSON.stringify(eras));
}
