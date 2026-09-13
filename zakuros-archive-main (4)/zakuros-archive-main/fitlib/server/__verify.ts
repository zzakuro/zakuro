import { fetchSteamDetails } from "./metadataService";

async function main() {
  for (const appid of [2728070, 668550, 1525640, 427410, 1904480, 876650, 2407270, 1412760]) {
    const d = await fetchSteamDetails(appid);
    console.log(`${appid}: "${d.title}" | dev: ${d.developer?.split(",")[0]}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });