import fs from "fs";
import path from "path";
import { resolveMissingSteamIds, normalizeForMatch } from "./sources";
import { fetchSteamDetails, fetchProtonSummary, normalizeSteamDate } from "./metadataService";
import { Game } from "../src/types";

async function main() {
  const games = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "merged_enriched.json"), "utf8")) as Game[];
const unmatched = games.filter((g) => !g.classic && !g.steamId && g.title);
console.log("unmatched total:", unmatched.length);

// 1) Offline-only pass over the whole backlog (no network)
const offline = await resolveMissingSteamIds(unmatched, { online: false });
console.log("OFFLINE:", JSON.stringify(offline));
const newly = unmatched.filter((g) => g.steamId);
console.log("sample newly matched offline:", newly.slice(0, 8).map((g) => `${g.title} -> ${g.steamId}`));
const still = unmatched.filter((g) => !g.steamId);
console.log("still unmatched after offline:", still.length);

// 2) Online store-search on a small slice of the hard leftovers
const trick = still.filter((g) =>
  ["100% Orange Juice: All Stars Collection", "13 Sentinels: Aegis Rim", "171 Game", "112 Operator: Water Operations"].includes(g.title)
);
const online = await resolveMissingSteamIds(trick, { online: true });
console.log("ONLINE(Trick titles):", JSON.stringify(online));
for (const g of trick) if (g.steamId) console.log(`  ${g.title} -> appid ${g.steamId}`);

// sanity: normalized keys for a few
for (const t of ["112 Operator v.0.220428.110w-cb", "Baldur's Gate III", "60 Seconds!"]) {
  console.log("  key:", JSON.stringify(t), "->", JSON.stringify(normalizeForMatch(t)));
}

// 3) ProtonDB + native-linux + date normalization probes
for (const appid of [1245620, 570, 105600, 252490]) {
  const [details, proton] = await Promise.all([fetchSteamDetails(appid), fetchProtonSummary(appid)]);
  console.log(
    `appid ${appid}: linux=${details.linuxNative} date=${details.releaseDate} dev=${details.developer?.split(",")[0]} | proton=${JSON.stringify(proton)}`
  );
}
console.log("date checks:", normalizeSteamDate("18 Jun, 2024"), "|", normalizeSteamDate("Jun 18, 2024"), "|", normalizeSteamDate("Q4 2023"));
}

main().catch((e) => { console.error(e); process.exit(1); });