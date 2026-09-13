import { fetchSteamDetails } from "./metadataService";

async function main() {
  for (const appid of [1055360, 11020, 4000]) {
    const d = await fetchSteamDetails(appid);
    console.log(`${appid}: "${d.title}"`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });