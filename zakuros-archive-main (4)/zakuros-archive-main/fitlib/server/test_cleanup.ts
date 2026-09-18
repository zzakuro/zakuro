// Offline regression tests for the catalog-cleanup/matching logic. No network,
// no catalog writes — run with:  npx tsx server/test_cleanup.ts
import {
  repairTitle,
  cleanTitle,
  normalizeForMatch,
  titlesLookLikeSameGame,
  isForeignFiller,
  pruneForeignFiller,
  mergeBilingualDuplicates,
  alignCoverAppids,
  selfHealCatalog,
  summaryIsPlaceholder,
  devIsPlaceholder,
} from "./sources";
import { igdbBestMatch, cleanForSearch, normalizeSearchTitle } from "./igdbMatch";
import { normalizeClassicFlag } from "./normalize";
import { clearAppid, simScore } from "./fixAppidIssues";
import { stripVndbBbcode, vndbBestMatch, vndbCandidateTitles, vndbReleaseDate } from "./vndbMatch";
import { titleMatchScore } from "./igdbMatch";
import { Game } from "../src/types";

let passed = 0;
let failed = 0;
function ok(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed++;
    console.log(`[PASS] ${name}`);
  } else {
    failed++;
    console.error(`[FAIL] ${name}${detail ? " — " + detail : ""}`);
  }
}
const eq = (actual: any, expected: any, name: string) =>
  ok(actual === expected, name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

let nextId = 0;
const mk = (partial: Partial<Game>): Game =>
  ({
    id: `t${nextId++}`,
    title: "",
    developer: "",
    publisher: "",
    genres: [],
    releaseDate: "",
    rating: 0,
    fileSize: "",
    magnetLink: "",
    coverImage: "",
    screenshot: "",
    summary: "",
    systemRequirements: {},
    stats: { downloads: 0, views: 0, updatedAt: "" },
    ...partial,
  }) as Game;

console.log("\n--- repairTitle / cleanTitle ---");
eq(repairTitle("???? Banner of the Maid"), "Banner of the Maid", "repairTitle strips leading encoding garbage");
eq(repairTitle("#BLUD"), "#BLUD", "repairTitle keeps meaningful '#' prefix");
eq(repairTitle(".hack//G.U. Last Recode"), ".hack//G.U. Last Recode", "repairTitle keeps '.hack' prefix");
eq(repairTitle("!Ω Factorial Omega"), "!Ω Factorial Omega", "repairTitle keeps '!Ω' prefix");
eq(repairTitle("?8 (Japan"), "8 (Japan", "repairTitle keeps a leading numeral");
eq(cleanTitle("1000xRESIST-TiNYiSO"), "1000xRESIST", "cleanTitle drops scene tag");
eq(cleanTitle("DRIVE Rally (1.3.24.0)"), "DRIVE Rally", "cleanTitle drops version paren");

console.log("\n--- normalizeForMatch ---");
eq(normalizeForMatch("The Witcher 3 GOTY"), "the witcher 3", "normalizeForMatch drops GOTY, keeps sequel number");
eq(
  normalizeForMatch("Assassin's Creed Brotherhood"),
  normalizeForMatch("Assassin's Creed: Brotherhood"),
  "normalizeForMatch equates punctuation variants"
);

console.log("\n--- titlesLookLikeSameGame ---");
eq(titlesLookLikeSameGame("Game Name Repack", "Game Name"), true, "same game across repack tag");
eq(titlesLookLikeSameGame("The Witcher 3", "Totally Different Game"), false, "unrelated titles rejected");
eq(titlesLookLikeSameGame("", "x"), false, "empty title rejected");
eq(titlesLookLikeSameGame("Assassin's Creed Brotherhood", "Assassin's Creed: Brotherhood"), true, "punctuation variant accepted");

console.log("\n--- isForeignFiller ---");
eq(isForeignFiller(mk({ title: "Ведьмак 3" })), true, "bare Cyrillic filler pruned");
eq(isForeignFiller(mk({ title: "Ведьмак 3", steamId: 292030 })), false, "Cyrillic with steamId kept");
eq(isForeignFiller(mk({ title: "Ведьмак 3", coverImage: "https://x/y.jpg" })), false, "Cyrillic with cover kept");
eq(isForeignFiller(mk({ title: "The Witcher 3" })), false, "Latin title kept");
eq(isForeignFiller(mk({ title: "Witcher 3 / Ведьмак 3" })), true, "bilingual bare filler pruned");
eq(isForeignFiller(mk({ title: "ゲーム" })), true, "bare CJK filler pruned");
eq(isForeignFiller(mk({ title: "ゲーム", classic: true })), false, "classic titles exempt");

{
  const games = [mk({ title: "Ведьмак 3" }), mk({ title: "The Witcher 3" })];
  eq(pruneForeignFiller(games), 1, "pruneForeignFiller removes only filler");
  eq(games.length, 1, "pruneForeignFiller mutates in place");
}

console.log("\n--- mergeBilingualDuplicates ---");
{
  const keeper = mk({ title: "Assassin's Creed Brotherhood", steamId: 48190 });
  const dup = mk({
    title: "Assassin's Creed: Brotherhood / Братство Крови",
    steamId: 48190,
    downloadSources: [{ name: "Rutor", url: "https://rutor/x" }],
  });
  const games = [keeper, dup];
  eq(mergeBilingualDuplicates(games), 1, "bilingual duplicate folded");
  eq(games.length, 1, "duplicate removed");
  eq(games[0].downloadSources?.length, 1, "downloads transferred to keeper");
}
{
  const games = [
    mk({ title: "Crazy Machines 3" }),
    mk({ title: "Crazy Machines 2 / Заработало! 2" }),
  ];
  eq(mergeBilingualDuplicates(games), 0, "sequel numbers not collapsed");
  eq(games.length, 2, "sequel kept separate");
}
{
  const games = [
    mk({ title: "Command & Conquer: Red Alert 3" }),
    mk({ title: "Command & Conquer: Red Alert 3 - Дилогия" }),
  ];
  eq(mergeBilingualDuplicates(games), 0, "bundle marker (Дилогия) not merged");
}
{
  const games = [
    mk({ title: "Some Game", steamId: 111 }),
    mk({ title: "Some Game / Разное", steamId: 222 }),
  ];
  eq(mergeBilingualDuplicates(games), 0, "conflicting steamIds not merged");
}

console.log("\n--- alignCoverAppids ---");
{
  const g = mk({ title: "Resident Evil", steamId: 304240, coverImage: "https://cdn.akamai.steamstatic.com/steam/apps/2050650/library_600x900.jpg" });
  eq(alignCoverAppids([g]), 1, "mismatched cover realigned to steamId");
  ok(g.coverImage.includes("/apps/304240/"), "cover now points at the game's own appid");
}
{
  const g = mk({ title: "No Id", coverImage: "https://cdn.akamai.steamstatic.com/steam/apps/999/library_600x900.jpg" });
  eq(alignCoverAppids([g]), 0, "game without steamId left untouched");
}
{
  const g = mk({ title: "Fine", steamId: 100, coverImage: "https://cdn.akamai.steamstatic.com/steam/apps/100/library_600x900.jpg" });
  eq(alignCoverAppids([g]), 0, "already-aligned cover untouched");
}

console.log("\n--- selfHealCatalog ---");
{
  const games = [
    mk({ title: "The Witcher 3", steamId: 292030, coverImage: "https://cdn.akamai.steamstatic.com/steam/apps/999/library_600x900.jpg" }),
    mk({ title: "The Witcher 3 / Ведьмак 3", steamId: 292030 }),
    mk({ title: "Ведьмак 3" }),
  ];
  const res = selfHealCatalog(games);
  eq(res.filler, 1, "selfHeal prunes filler");
  eq(res.bilingual, 1, "selfHeal folds bilingual dupe");
  eq(res.covers, 1, "selfHeal realigns covers");
  eq(games.length, 1, "selfHeal collapses to a single row");
}

console.log("\n--- normalizeClassicFlag ---");
{
  const pc = mk({ title: "Alien: Isolation", classic: true, steamId: 214490, genres: ["Classic", "Retro", "PS3", "Action"] });
  eq(normalizeClassicFlag(pc), true, "classic stripped when a Steam id is present");
  eq(pc.classic, false, "mis-tagged classic flag cleared");
  eq(JSON.stringify(pc.genres), JSON.stringify(["PS3", "Action"]), "Classic/Retro genres removed");

  const rom = mk({ title: "Super Mario Bros", classic: true, genres: ["Classic", "Retro", "NES"] });
  eq(normalizeClassicFlag(rom), false, "genuine ROM classic untouched");
  eq(rom.classic, true, "ROM classic flag intact");

  const games = [
    mk({ title: "Batman: Arkham City", classic: true, steamId: 200260, genres: ["Classic", "Retro", "PS3"] }),
    mk({ title: "Pokemon Red", classic: true, genres: ["Classic", "Retro", "GB"] }),
  ];
  const res = selfHealCatalog(games);
  eq(res.classic, 1, "selfHeal strips the one mis-tagged classic");
  eq(games[0].classic, false, "PC title is no longer classic");
  eq(games[1].classic, true, "ROM title stays classic");
}

console.log("\n--- appid resolver helpers ---");
eq(simScore("Alien: Isolation", "Alien Isolation"), 1, "simScore matches near-identical titles");
ok(simScore("Alien: Isolation", "Aliens: Colonial Marines") < 0.5, "simScore rejects unrelated titles");
{
  const g = mk({
    title: "Aliens: Colonial Marines",
    steamId: 49540,
    coverImage: "https://cdn.cloudflare.steamstatic.com/steam/apps/214490/library_600x900.jpg",
    screenshot: "https://cdn.cloudflare.steamstatic.com/steam/apps/214490/header.jpg",
    screenshots: [
      "https://cdn.cloudflare.steamstatic.com/steam/apps/214490/ss_1.jpg",
      "https://images.igdb.com/igdb/image/upload/t_1080p/abc.jpg",
    ],
  });
  clearAppid(g, 214490);
  eq(g.steamId, undefined, "clearAppid drops the wrong appid");
  eq(g.coverImage, "", "clearAppid clears matching Steam cover");
  eq(g.screenshot, "", "clearAppid clears matching Steam screenshot");
  eq(
    JSON.stringify(g.screenshots),
    JSON.stringify(["https://images.igdb.com/igdb/image/upload/t_1080p/abc.jpg"]),
    "clearAppid keeps non-Steam screenshots"
  );
}
{
  const g = mk({
    title: "X",
    steamId: 1,
    coverImage: "https://images.igdb.com/x.jpg",
    screenshot: "https://images.igdb.com/y.jpg",
  });
  clearAppid(g, 999);
  eq(g.coverImage, "https://images.igdb.com/x.jpg", "clearAppid keeps unrelated cover art");
  eq(g.screenshot, "https://images.igdb.com/y.jpg", "clearAppid keeps unrelated screenshot");
}

console.log("\n--- titleMatchScore ---");
eq(titleMatchScore("Alien Isolation", "Alien Isolation"), 1, "titleMatchScore exact match");
ok(titleMatchScore("Aeons End", "Aeon's End") >= 0.75, "titleMatchScore tolerates punctuation");
ok(titleMatchScore("Super Mario Bros", "Grand Theft Auto V") < 0.3, "titleMatchScore rejects unrelated");

console.log("\n--- vndbMatch ---");
eq(stripVndbBbcode("[b]Hello[/b] [url=/v1]link[/url] world[spoiler]x[/spoiler]"), "Hello link worldx", "stripVndbBbcode removes tags");
eq(stripVndbBbcode("A\r\n\r\n\r\nB"), "A\n\nB", "stripVndbBbcode normalizes newlines");
eq(stripVndbBbcode(""), "", "stripVndbBbcode handles empty");
eq(vndbReleaseDate("2009-12-10"), "2009-12-10", "vndbReleaseDate exact");
eq(vndbReleaseDate("2009-12"), "2009-12", "vndbReleaseDate month precision");
eq(vndbReleaseDate("2009"), "2009", "vndbReleaseDate year only");
eq(vndbReleaseDate("tba"), "", "vndbReleaseDate rejects tba");
eq(
  JSON.stringify(vndbCandidateTitles({ title: "A", alttitle: "B", titles: [{ title: "C" }] })),
  JSON.stringify(["A", "B", "C"]),
  "vndbCandidateTitles collects all names"
);
{
  const results = [
    { id: "v1", title: "Some Other Game" },
    { id: "v2", title: "9-nine- Kokonotsu Kokonoka Kokonoiro", titles: [{ title: "9-nine-:Episode 1", lang: "en" }] },
  ];
  eq(vndbBestMatch("9-nine-:Episode 1", results)?.id, "v2", "vndbBestMatch matches a localized title");
  eq(vndbBestMatch("Totally Unrelated Query", results), null, "vndbBestMatch rejects unrelated hit");
}

console.log("\n--- placeholders ---");
eq(summaryIsPlaceholder("Available via: FitGirl"), true, "repack placeholder detected");
eq(summaryIsPlaceholder("Retro / classic title - emulated console release."), true, "retro placeholder detected");
eq(summaryIsPlaceholder("A real, descriptive summary."), false, "real summary not placeholder");
eq(summaryIsPlaceholder(undefined), true, "missing summary is placeholder");
eq(devIsPlaceholder("Unknown Developer"), true, "unknown developer detected");
eq(devIsPlaceholder("unknown"), true, "bare 'unknown' detected");
eq(devIsPlaceholder("CD Projekt Red"), false, "real developer kept");

console.log("\n--- igdbMatch ---");
eq(cleanForSearch("007 - Agent Under Fire (USA)"), "007 - Agent Under Fire", "cleanForSearch drops region tag");
eq(normalizeSearchTitle("0 A.D."), "0 a d", "normalizeSearchTitle strips punctuation");
eq(
  igdbBestMatch("Aeons End", [{ name: "Aeon's End" }])?.name,
  "Aeon's End",
  "igdbBestMatch accepts close spelling"
);
eq(igdbBestMatch("Super Mario Bros", [{ name: "Grand Theft Auto V" }]), null, "igdbBestMatch rejects unrelated hit");
eq(
  igdbBestMatch("Symmetry", [{ name: "symmetry" }])?.name,
  "symmetry",
  "igdbBestMatch accepts exact (case-insensitive)"
);

console.log(`\n========================================`);
console.log(`passed=${passed} failed=${failed}`);
console.log(`========================================`);
if (failed > 0) process.exit(1);
