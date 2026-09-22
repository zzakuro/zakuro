import { readGames } from "./server/catalogIO";
import { readSourcesConfig, syncSources } from "./server/sources";
import { Game } from "./src/types";

const cfg = readSourcesConfig("data/sources.json");
const before = readGames();

let replay: Game[] | null = null;
let saved = false;

(async () => {
  const result = await syncSources({
    sources: cfg,
    getCatalog: () => before,
    setCatalog: (games) => {
      if (saved) throw new Error("double save?!");
      saved = true;
      replay = games;
    },
    enrich: false,
  });
  console.log("SYNC OK:", result.ok);
  console.log("totals:", JSON.stringify(result.totals));
  if (!replay) {
    console.log("no catalog produced");
    return;
  }
  const gow = replay.filter((g) => g.id.startsWith("god-of-war") || g.title.toLowerCase().includes("god of war"));
  console.log("god of war entries AFTER split:", gow.length);
  for (const g of gow) {
    console.log(
      `  id=${g.id} classic=${g.classic} steamId=${g.steamId} gogId=${g.gogId} sources=${g.downloadSources?.length}`,
      `repackers=${[...new Set((g.downloadSources || []).map((s) => s.repacker).filter(Boolean))].join(",")}`
    );
  }
  const classicCount = replay.filter((g) => g.classic).length;
  const modernCount = replay.length - classicCount;
  const idSet = new Set(replay.map((g) => g.id));
  const dupIds = replay.length - idSet.size;
  const dualTitles = new Map<string, { classic: number; modern: number }>();
  for (const g of replay) {
    const n = g.title.trim().toLowerCase();
    const rec = dualTitles.get(n) || { classic: 0, modern: 0 };
    if (g.classic) rec.classic++;
    else rec.modern++;
    dualTitles.set(n, rec);
  }
  const twins = [...dualTitles.entries()].filter(([, r]) => r.classic > 0 && r.modern > 0);
  console.log("after-split totals:", replay.length, "classic:", classicCount, "modern:", modernCount);
  console.log("dup ids:", dupIds);
  console.log("titles present in BOTH eras (twins):", twins.length);
  let classicWithSteam = 0;
  for (const g of replay) if (g.classic && typeof g.steamId === "number") classicWithSteam++;
  console.log("classic games WITH steamId (should be ~0):", classicWithSteam);
  const modernGow = replay.find((g) => g.id !== "god-of-war" && g.title?.toLowerCase() === "god of war" && !g.classic);
  console.log("modern God of War twin:", modernGow ? `id=${modernGow.id} classic=${modernGow.classic} steamId=${modernGow.steamId} sources=${modernGow.downloadSources?.length}` : "ABSENT");
  const classicGow = replay.find((g) => g.id === "god-of-war");
  console.log("classic God of War:", classicGow ? `classic=${classicGow.classic} steamId=${classicGow.steamId} gogId=${classicGow.gogId} sources=${classicGow.downloadSources?.length} repackers=${[...new Set((classicGow.downloadSources || []).map((s) => s.repacker).filter(Boolean))].join(",")}` : "ABSENT");
  console.log("sample twins:", twins.slice(0, 10).map(([t, r]) => `${t} (classic ${r.classic} / modern ${r.modern})`));
})().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});