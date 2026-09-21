import { readGames } from "./server/catalogIO";
import { normalizeForMatch } from "./server/sources";

async function main() {
  const games = await readGames();
  const hits = games.filter(
    (g) => g.id === "god-of-war" || g.id === "god-of-war-1hrnv0j"
  );
  for (const g of hits) {
    const dl = (g.downloadSources || []).map((s) => ({
      url: s.url,
      repacker: s.repacker,
      kind: s.kind,
    }));
    console.log(JSON.stringify(
      {
        id: g.id,
        title: g.title,
        normalized: normalizeForMatch(g.title || ""),
        steamId: g.steamId,
        classic: g.classic,
        developer: g.developer,
        publisher: g.publisher,
        releaseDate: g.releaseDate,
        coverImage: g.coverImage,
        summaryLen: (g.summary || "").length,
        downloads: dl,
        dlCount: dl.length,
      },
      null,
      2
    ));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});