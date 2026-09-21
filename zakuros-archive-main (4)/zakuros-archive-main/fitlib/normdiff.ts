import { readGames } from "./server/catalogIO";

// Same pipeline as normalizeForMatch but using the PRE-edit pattern
// (closing paren required) for the canonicalTitle paren-strip line.
function oldCanonical(raw: string): string {
  let s = raw
    .replace(/[\u{FFFD}\u200B-\u200D\uFEFF\x00-\x1F]/gu, " ")
    .replace(/[™®©]/g, " ")
    .trim();
  for (let i = 0; i < 3; i++) {
    s = s
      .replace(/\s*\|\s*$/gi, "")
      .replace(/[\s]*[–—-]+\s*\+?\s*[^–—-]*?\bdlc\b[^–—-]*$/gi, "")
      .replace(/\s+\+\s*[^–—-]*?\bdlc\b[^–—-]*$/gi, "")
      .replace(/(?<=[\w)\]]|[-,–—:])\s*\(?\s*[bB]uild\s+\d+(?:\.[\d]+)*[^)]*\)?\s*$/gi, "")
      .replace(/[\(\[]\s*from\s+[\d.,]+\s*(gb|mb|tb|kb)[^)\]]*[\)\]]/gi, "")
      .replace(/\s+from\s+[\d.,]+\s*(gb|mb|tb|kb)\b[^\w]*/gi, "")
      .replace(/\s+-\s*(?:goty(?: edition)?|game of the year(?: edition)?|deluxe(?: edition)?|digital deluxe|definitive edition|complete edition|ultimate edition|royal edition|collector's? edition)\s*$/gi, "")
      .replace(/\s+(?:goty|goty edition)\s*$/gi, "")
      .replace(/\s+-\s*(?:v\.?\s*[\d.]+[\w.\-]*|[\d]+\.[\d]+(?:\.[\d]+)*)\s*$/gi, "")
      .replace(/\s+v\.?\s*[\d.]+[\w.\-]*\s*$/gi, "")
      .replace(/\s+[\d]+\.[\d]+(?:\.[\d]+)*\s*$/gi, "")
      .replace(/\s*\([^)]*(?:\b\d[\d./,\-x]*\b|v\s*[\d.]+|b\s*\d+|build|release|update|patch|hot\s?fix|early access|alpha|beta|eng|ger|rus|multi|\bdlc\b|soundtrack|ost|bonus|digital content)[^)]*\)\s*$/gi, "")
      .replace(/\s+\+\s*windows\s+(?:7|8|10|11|x)\s*fix\s*$/gi, "")
      .replace(/\s+-\s*pc\s*$/gi, "")
      .replace(/\s+pc\s*$/gi, "")
      .replace(/\s+(?:лицензия|репак|русская версия|русская)\s*$/gi, "")
      .replace(/[\s–—-]+$/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+:/g, ":")
      .trim();
  }
  return s;
}

const _TOKENS = (s: string) =>
  oldCanonical(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

import { normalizeForMatch, canonicalTitle } from "./server/sources";

async function main() {
  const games = await readGames();
  let changed = 0;
  let samples: string[] = [];
  for (const g of games) {
    const t = g.title || "";
    const oldKey = _TOKENS(t);
    const newKey = normalizeForMatch(t);
    if (oldKey !== newKey) {
      changed++;
      if (samples.length < 25) samples.push(`"${t}"\n   old=${oldKey}\n   new=${newKey}`);
    }
  }
  console.log(`total ${games.length}, keys changed by normalize edit: ${changed}`);
  console.log(samples.join("\n---\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});