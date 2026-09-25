import { syncSources, readSourcesConfig } from "./server/sources";

async function main() {
  const cfg = readSourcesConfig("data/sources.json");
  const fit = cfg.find((s) => s.name === "FitGirl");
  console.log("config entry read by readSourcesConfig:");
  console.log(JSON.stringify(fit, null, 2));

  let out: any[] = [];
  const result = await syncSources({
    sources: [
      {
        name: "FitGirl",
        url: "file:///C:/Users/Mfree/AppData/Local/Temp/opencode/fitgirl-snapshot.json",
        category: "repacker",
        enabled: true,
      },
    ],
    getCatalog: () => [],
    setCatalog: (games) => {
      out = games;
    },
    enrich: false,
  });

  console.log("\nsync totals:", JSON.stringify(result.totals));
  console.log(
    "source runs:",
    result.sources.map((s) => `${s.name}: ok=${s.ok} count=${s.uniqueCount}${s.error ? " err=" + s.error : ""}`)
  );

  const sh = out.filter((g) => /silent\s*-?\s*hill/i.test(g.title));
  console.log("\nSilent Hill entries produced by parseSourcePayload + buildGame:");
  for (const g of sh) {
    console.log("---");
    console.log(`title=${g.title}`);
    console.log(`fileSize=${g.fileSize} | releaseDate=${g.releaseDate} | classic=${g.classic}`);
    console.log(
      `downloadSources=${(g.downloadSources || []).length} | repackers=${Array.from(new Set((g.downloadSources || []).map((s) => s.repacker))).join(",")}`
    );
    console.log(`magnetLink=${(g.magnetLink || "").slice(0, 60)}...`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});