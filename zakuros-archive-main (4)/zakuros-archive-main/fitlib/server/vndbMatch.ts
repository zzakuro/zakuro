// Matching + mapping helpers for the VNDB (Visual Novel Database) adult/doujin
// metadata source. VNDB's anonymous API (POST https://api.vndb.org/kana/vn)
// returns relevance-ranked hits, so — exactly like the IGDB matcher — only a
// strongly-matching hit is accepted; a wrong cover/summary is worse than none.
import { titleMatchScore } from "./igdbMatch";

export const VNDB_FIELDS =
  "title,alttitle,released,image.url,description,developers.name,tags.name," +
  "titles.title,titles.lang,titles.main";

export interface VndbResult {
  id?: string;
  title?: string;
  alttitle?: string | null;
  released?: string | null;
  image?: { url?: string } | null;
  description?: string | null;
  developers?: { name?: string }[];
  tags?: { name?: string }[];
  titles?: { title?: string; lang?: string; main?: boolean }[];
}

// VNDB descriptions are BBCode; the catalog shows plain text.
export function stripVndbBbcode(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\[url=[^\]]*\]/gi, "")
    .replace(/\[\/url\]/gi, "")
    .replace(/\[\/?(?:b|i|u|s|spoiler|quote|code|raw|center|preview|obsolete)\]/gi, "")
    .replace(/\[\/?(?:size=\d+|color=[^\]]*|font=[^\]]*)\]/gi, "")
    .replace(/\[[^\]]{0,40}\]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Every name a VNDB entry is known by (main title, original title, all locale
// titles) so a match can be confirmed against the English release name.
export function vndbCandidateTitles(r: VndbResult | undefined | null): string[] {
  if (!r) return [];
  const out = [r.title || "", r.alttitle || ""];
  for (const t of r.titles || []) if (t?.title) out.push(t.title);
  return out.filter(Boolean);
}

export function vndbBestMatch(query: string, results: VndbResult[] | undefined): VndbResult | null {
  let best: VndbResult | null = null;
  let bestScore = 0;
  for (const r of results || []) {
    for (const cand of vndbCandidateTitles(r)) {
      const score = titleMatchScore(query, cand);
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
  }
  return bestScore >= 0.75 ? best : null;
}

// VNDB dates may be exact, partial ("2009", "2009-12") or "tba".
export function vndbReleaseDate(released: string | null | undefined): string {
  if (typeof released !== "string") return "";
  const m = released.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return "";
  const [, y, mo, d] = m;
  if (!mo) return y;
  if (!d) return `${y}-${mo}`;
  return `${y}-${mo}-${d}`;
}
