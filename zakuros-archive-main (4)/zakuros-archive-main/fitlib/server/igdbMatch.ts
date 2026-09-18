// Strict title matching for IGDB search results.
//
// IGDB's `search` returns relevance-ranked hits that are frequently *not* the
// same game ("Aeons End" -> "Aeon's End" is fine, but generic query words pull
// in unrelated titles). Writing a wrong cover/summary is worse than writing
// nothing, so `igdbBestMatch` only accepts a hit when the cleaned titles match
// exactly, one contains the other, or their token sets overlap strongly.

// Tags that repacker/ROM titles carry but IGDB names never do.
const SEARCH_NOISE =
  /\b(rom|iso|repack|portable|multi\d*|rus|eng|ger|fre|ita|spa|rip|unl|pirate|proto|beta|demo|usa|europe|japan|asia|world|jpn|chs|cht|kor)\b/gi;

export function cleanForSearch(s: string): string {
  return (s || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(SEARCH_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSearchTitle(s: string): string {
  return cleanForSearch(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function searchTokens(s: string): Set<string> {
  return new Set(
    normalizeSearchTitle(s)
      .split(" ")
      .filter((t) => t && !/^\d{4}$/.test(t))
  );
}

export function igdbBestMatch<T extends { name?: string }>(query: string, results: T[] | undefined): T | null {
  const a = normalizeSearchTitle(query);
  if (a.replace(/\s/g, "").length < 3) return null;
  const at = searchTokens(query);
  let best: T | null = null;
  let bestScore = 0;

  for (const r of results || []) {
    if (!r?.name) continue;
    const b = normalizeSearchTitle(r.name);
    if (!b) continue;

    let score = 0;
    if (a === b) score = 1;
    else if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 5) score = 0.85;
    else {
      const bt = searchTokens(r.name);
      let inter = 0;
      for (const t of at) if (bt.has(t)) inter++;
      const uni = at.size + bt.size - inter;
      score = uni ? inter / uni : 0;
    }
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  return bestScore >= 0.75 ? best : null;
}
