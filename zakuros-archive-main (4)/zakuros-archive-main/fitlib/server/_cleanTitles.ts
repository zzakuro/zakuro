// Normalize display titles (strip No-Intro/Redump region+language tags, ROM
// junk, repack patch/version suffixes; Title-Case all-caps names) then merge
// rows that resolve to the SAME real game into one card.
//   * Same base title + same classic flag + same variant flag (remake/demake/remaster/redux)
//     => merge; hero keeps ids + best metadata; per-source labels carry the
//       edition (Deluxe/Standard/Director's Cut...) and region/language info
//       that the URL alone would otherwise hide.
//   * remake/remastered/demake/redux rows never merge with the original.
//   * A wordless store-listed row (known steam/gog id) joins the variant card
//     instead if the variant card exists and release years don't conflict (>10y).
//   * Multi-game pack rows (Collection/Bundle/Set or >=2 commas) are left alone.
// Run: npx tsx server/_cleanTitles.ts
import path from "path";
import { Game } from "../src/types";
import { readGames, writeGames } from "./catalogIO";
import { selfHealCatalog } from "./sources";

const REGIONS =
  /^(?:europe|usa|u\.?s\.?a?|japan|world|korea|australia|germany|spain|france|italy|netherlands|poland|russia|new\s*zealand|canada|mexico|brasil|brazil|asia|china|hong\s*kong|taiwan|scandinavia|sweden|norway|denmark|finland|pal|ntsc(?:-?[ju])?|by|europe\s*,\s*japan)$/i;
const JUNK_TOKENS =
  /\b(?:password|psxroms(?:\.pro)?|aftermarket|unl|unlicensed|proto|beta|demo|taikenban|trial|tentou\s*houei[- ]*you|movie[- ]?ban|sample|rev(?:ision)?|check\s*disk|gb\s*compatible|alt|hack)\b/i;
const VARIANT_RE = /\b(?:remake|remaster(?:ed)?|redux|demake)\b/i;
const EDITION_RE =
  /\b(?:director'?s\s*cut|restless\s*dreams|deluxe(?:\s*edition)?|standard(?:\s*edition)?|gold(?:\s*edition)?|special\s*edition|new\s*edition|enhanced(?:\s*edition)?|complete(?:\s*edition)?|definitive(?:\s*edition)?|ultimate(?:\s*edition)?|anniversary(?:\s*edition)?|collector'?s(?:\s*edition)?|limited(?:\s*edition)?|game\s*of\s*the\s*year|goty(?:\s*edition)?|greatest\s*hits|hd(?:\s*edition)?|playstation\s*hits|triple\s*pack|premium(?:\s*edition)?|classic(?:\s*edition)?|digital(?:\s*edition)?|update\d*|birthday\s*edition|survival\s*edition)\b/i;
const VERSION_SUFFIX = /\s*[-(–—]\s*v?\d+(?:\.\d+){1,3}(?:\s*\([^)]*\))?\s*$/i;
const PATCH_SUFFIX = /\s*\+\s*(?:patch[- ]?a?e?n?g?|eng\s*patch|update|repack)\s*$/i;
const PACK_RE = /\b(?:collection|bundle|pack|set|anthology|megapack|multipack)\b/i;

const SMALL = new Set(["a", "an", "and", "or", "but", "of", "the", "for", "in", "on", "with", "to", "at", "as", "by", "is", "de"]);
const UPPER_ACRO = /^(?:pc|dlc|xbox|snes|nes|n64|wii|amiga|c64|dos|hd|dvd|cd|gbc|gba|nds|3ds)$/i;

function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^a-zA-Z]/g, "");
  return letters.length > 2 && letters === letters.toUpperCase();
}
function titleCaseSmart(s: string): string {
  if (!isAllCaps(s)) return s;
  return s
    .split(/\b/)
    .map((w) => {
      if (!/[a-zA-Z]/.test(w)) return w;
      const lower = w.toLowerCase();
      if (UPPER_ACRO.test(lower)) return lower.toUpperCase();
      if (lower.length <= 2) return lower.toUpperCase();
      if (SMALL.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

interface ParseResult {
  base: string;
  edition: string[];
  variant: string;
  region: string[];
  language: string[];
}

function displayRegion(r: string): string {
  const map: Record<string, string> = { "ntsc-u": "NTSC-U", "ntsc-j": "NTSC-J", usa: "USA", pal: "PAL", ntsc: "NTSC" };
  return map[r.toLowerCase()] || r.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
function displayVariant(v: string): string {
  const low = v.toLowerCase();
  if (low === "remake") return "Remake";
  if (low === "demake") return "Demake";
  if (/^remaster/.test(low)) return "Remastered";
  if (low === "redux") return "Redux";
  return "";
}
function cleanEdition(e: string): string {
  return e.replace(/\b(edition|game)\b/gi, " ").replace(/\s+/g, " ").trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
function parseTitle(raw: string): ParseResult | null {
  if (!raw) return null;
  let title = raw.replace(/\s+/g, " ").trim();
  const region: string[] = [];
  const language: string[] = [];
  let variant = "";
  let loop = 0;
  while (loop++ < 12) {
    const m = /\(([^()]*)\)/.exec(title);
    if (!m) break;
    const inner = m[1].trim();
    const isLangCodes = /^[a-z]{2}(,\s*[a-z]{2})+$/i.test(inner);
    if (isLangCodes) {
      for (const c of inner.split(/,\s*/)) if (/^[a-z]{2}$/i.test(c.trim())) language.push(c.trim().toUpperCase());
    } else if (REGIONS.test(inner)) {
      region.push(displayRegion(inner));
    } else if (JUNK_TOKENS.test(inner) && inner.length < 40) {
      // silent drop
    } else if (VARIANT_RE.test(inner) && inner.length < 30) {
      variant = displayVariant(inner.match(VARIANT_RE)?.[0] || "");
    } else if (EDITION_RE.test(inner) && inner.length < 40) {
      // edition in parens: label but drop text
    } else {
      title = title.replace(`(${m[1]})`, " "); // keep inner text, drop parens
      continue;
    }
    title = `${title.slice(0, m.index)} ${title.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim();
  }
  title = title.replace(/\[[^\]]*\]/g, " ").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();

  // source-truncated titles end in unbalanced junk parens like "(En,Ja / (Europe"
  for (let i = 0; i < 8; i++) {
    const dm = /\(([^()]*)$/.exec(title);
    if (!dm) break;
    const inner = dm[1].trim();
    const tokens = inner.split(/[\s,]+/).filter(Boolean);
    const junkish =
      tokens.length > 0 &&
      tokens.every((t) => /^[a-z]{2}$/i.test(t) || JUNK_TOKENS.test(t) || REGIONS.test(t)) &&
      !/^\d+$/.test(tokens[0]);
    const editionPhrase = EDITION_RE.test(inner) || VARIANT_RE.test(inner);
    if (!junkish && !editionPhrase) break;
    if (!variant && editionPhrase) {
      const vm2 = inner.match(VARIANT_RE);
      if (vm2) variant = displayVariant(vm2[0]);
    }
    title = title.slice(0, dm.index).replace(/\s+/g, " ").trim();
  }

  // source-truncated inline junk tails: "…En,Ja", "…Beta", "…Unl", "…Taikenban"
  const TAIL_JUNK = /\b(?:unl|proto|beta|demo|rev|taikenban|trial|sample|hack|alt|unlicensed|aftermarket|homebrew|gb\s*compatible|psxroms\.pro|password)\b/i;
  for (let i = 0; i < 8; i++) {
    const words = title.split(/\s+/);
    const last = words[words.length - 1] || "";
    const langList = /^[a-z]{2}(?:,[a-z]{2})+$/i.test(last);
    const singleLang = /^[a-z]{2}$/i.test(last);
    const junkWord = last.length > 1 && TAIL_JUNK.test(last);
    const ordinal = /^\d{1,2}(?:st|nd|rd|th)$/i.test(last);
    const drop = langList || (junkWord && last.length > 1) || (words.length >= 3 && title.length > 12 && (singleLang || ordinal));
    if (!drop) break;
    title = title.slice(0, title.length - last.length).replace(/\s+$/g, " ").trim();
  }

  title = title.replace(VERSION_SUFFIX, " ").replace(PATCH_SUFFIX, " ").replace(/\s+(?:19|20)\d{2}$/, " ").replace(/\s+/g, " ").trim();

  const edition: string[] = [];
  let em = EDITION_RE.exec(title);
  while (em) {
    edition.push(cleanEdition(em[0]));
    title = `${title.slice(0, em.index)} ${title.slice(em.index + em[0].length)}`.replace(/\s+/g, " ").trim();
    em = EDITION_RE.exec(title);
  }
  const vm = VARIANT_RE.exec(title);
  if (vm) {
    variant = displayVariant(vm[0]);
    title = `${title.slice(0, vm.index)} ${title.slice(vm.index + vm[0].length)}`.replace(/\s+/g, " ").trim();
  }
  title = titleCaseSmart(title.replace(/[:\s]+$/g, "").trim());
  if (!title || title.length < 2) return null;
  return { base: title, edition, variant, region, language };
}

function normKey(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function isPackLike(raw: string): boolean {
  if (PACK_RE.test(raw)) return true;
  // collapse "En,Ja,Fr,De" language-list runs (ROM tags) before counting delimiters
  const s = raw.replace(/(?:^|[(),\s])(?:[a-z]{2}(?:,|$))+/gi, " ");
  return (s.match(/,/g) || []).length >= 2;
}
function titleFor(p: ParseResult, editions: string[][], variantOverride = ""): string {
  const distinct = new Set<string>();
  for (const x of editions) for (const y of x) distinct.add(y);
  let e = p.edition;
  if (e.length === 0 && distinct.size === 1) e = [Array.from(distinct)[0]];
  const variant = variantOverride || p.variant;
  let t = p.base;
  if (e.length === 1 && !variant) t = e[0].split(/\s+/).length === 1 ? `${p.base} ${e[0]}` : `${p.base}: ${e[0]}`;
  if (variant) t = `${p.base} (${variant})`;
  return t;
}
function yearOf(releaseDate: string | undefined): number | undefined {
  if (!releaseDate) return undefined;
  const m = String(releaseDate).match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : undefined;
}
function hasStoreId(g: Game): boolean {
  return !!(g.gogId) || (!!g.steamId && steamKnown.has(g.steamId));
}
let steamKnown: Set<number> = new Set();
function steamAppsSet(): Set<number> {
  try {
    const list = JSON.parse(require("fs").readFileSync(path.join(process.cwd(), "data", "steam_apps.json"), "utf8"));
    return new Set((Array.isArray(list) ? list : []).filter((a: any) => a && typeof a.appid === "number").map((a: any) => a.appid));
  } catch { return new Set(); }
}

function mergeInto(hero: Game, f: Game, classic: boolean, mixed: boolean): void {
  const p = parseTitle(f.title || "");
  const label = p ? labelFor(p, classic, mixed) : "";
  const fSources = (f.downloadSources || []).map((s) => ({ ...s }));
  for (const s of fSources) if (label) s.name = `[${label}] ${s.name}`;
  const adoptSteam = f.steamId && steamKnown.has(f.steamId) ? f.steamId : undefined;
  if (!hero.steamId && adoptSteam !== undefined) hero.steamId = adoptSteam;
  if (!hero.gogId && f.gogId) hero.gogId = f.gogId;
  if (!hero.coverImage && f.coverImage) { hero.coverImage = f.coverImage; if (!hero.screenshot) hero.screenshot = f.coverImage; }
  if (!hero.screenshot && f.screenshot) hero.screenshot = f.screenshot;
  if ((!hero.summary || /^Available via:|^Retro \/ classic/i.test(hero.summary)) && f.summary && !/^Available via:|^Retro \/ classic/i.test(f.summary)) hero.summary = f.summary;
  if (!hero.developer && f.developer) hero.developer = f.developer;
  if (!hero.publisher && f.publisher) hero.publisher = f.publisher;
  if (!hero.releaseDate && f.releaseDate && !/To be announced|Coming soon/i.test(f.releaseDate)) hero.releaseDate = f.releaseDate;
  if (!hero.rating && f.rating) hero.rating = f.rating;
  if (!hero.screenshots?.length && f.screenshots?.length) hero.screenshots = f.screenshots;
  const have = new Set((hero.downloadSources || []).map((s) => (s.url || "").trim()));
  for (const s of fSources) {
    const u = (s.url || "").trim();
    if (!u || have.has(u)) continue;
    have.add(u);
    hero.downloadSources = [...(hero.downloadSources || []), s];
  }
  const cur = new Set((hero.genres || []).map((x) => x.toLowerCase()));
  const fresh = (f.genres || []).filter((x) => !cur.has(x.toLowerCase()));
  if (fresh.length) hero.genres = [...(hero.genres || []), ...fresh].slice(0, 12);
}
function labelFor(p: ParseResult, classic: boolean, mixed: boolean): string {
  const parts: string[] = [];
  if (p.edition.length) parts.push(p.edition.join(" "));
  else if (p.region.length || p.language.length) {
    let s = p.region.join(" ");
    if (p.language.length) s += (s ? " · " : "") + p.language.join(", ");
    parts.push(s);
    if (classic && !p.region.length) parts[0] = p.language.join(", ");
  }
  if (!parts.length && mixed) parts.push(classic ? "Original" : "Standard");
  return parts.join(" ") || "";
}

const games = readGames<Game>();
steamKnown = steamAppsSet();

interface Entry { g: Game; p: ParseResult; classic: boolean; baseKey: string; variant: string; junk: boolean; rowTitle: string; }
const entries: Entry[] = [];
for (const g of games) {
  const p = parseTitle(g.title || "");
  if (!p) { entries.push({ g, p: { base: g.title || "", edition: [], variant: "", region: [], language: [] }, classic: !!g.classic, baseKey: normKey(g.title || ""), variant: "", junk: true, rowTitle: g.title || "" }); continue; }
  entries.push({ g, p, classic: !!g.classic, baseKey: normKey(p.base), variant: p.variant, junk: isPackLike(g.title || ""), rowTitle: titleFor(p, [p.edition]) });
}

// partition by base+classic, then variant-level
const partitions = new Map<string, { plain: Entry[]; variants: Map<string, Entry[]> }>();
for (const e of entries) {
  if (e.junk) continue;
  const pkey = `${e.baseKey}|${e.classic ? "c" : "m"}`;
  if (!partitions.has(pkey)) partitions.set(pkey, { plain: [], variants: new Map() });
  const part = partitions.get(pkey)!;
  if (e.variant) {
    if (!part.variants.has(e.variant)) part.variants.set(e.variant, []);
    part.variants.get(e.variant)!.push(e);
  } else part.plain.push(e);
}

// redeploy store-listed wordless rows into their base's variant card (remake etc.)
for (const part of partitions.values()) {
  if (!part.variants.size) continue;
  const plainId = part.plain.filter((e) => hasStoreId(e.g));
  if (!plainId.length) continue;
  for (const v of part.variants.values()) {
    const vId = v.find((e) => hasStoreId(e.g));
    if (!vId && !plainId.length) continue;
    if (!vId) continue; // wordless page can join an id-less variant card only via id proof below
    const yrV = yearOf(vId.g.releaseDate);
    for (const e of plainId) {
      const yrP = yearOf(e.g.releaseDate);
      if (yrV !== undefined && yrP !== undefined && Math.abs(yrV - yrP) > 10) continue; // year conflict: keep separate
      e.variant = vId.variant; // re-home into the variant card
    }
  }
}
// one-sided id proof: a wordless id row whose variant card peers are all
// id-less (e.g. junk-titled `(Remake` with a bogus steamId) — merge anyway.
for (const part of partitions.values()) {
  if (!part.variants.size) continue;
  const plainId = part.plain.filter((e) => hasStoreId(e.g));
  if (!plainId.length) continue;
  for (const v of part.variants.values()) {
    if (v.some((e) => hasStoreId(e.g))) continue; // handled above
    for (const e of plainId) e.variant = v[0].variant;
  }
}

// rebuild clean groups
const groups = new Map<string, Entry[]>();
for (const e of entries) {
  if (e.junk) continue;
  const base = normKey(e.p.base);
  const key = `${base}|${e.classic ? "c" : "m"}|${e.variant || "-"}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(e);
}

const score = (g: Game) =>
  (g.steamId && steamKnown.has(g.steamId) ? 6 : g.steamId ? 2 : 0) +
  (g.gogId ? 4 : 0) +
  (g.summary && !/Available via:|Retro \/ classic/i.test(g.summary) ? 2 : 0) +
  (g.coverImage ? 2 : 0) + (g.releaseDate ? 1 : 0) + (g.developer ? 1 : 0) +
  (g.downloadSources ? g.downloadSources.length * 0.01 : 0);

const out: Game[] = [];
const mergedIds = new Set<string>();
let mergedRows = 0, groupsMerged = 0, titlesChanged = 0;

for (const [key, group] of groups) {
  const classic = !!group[0].classic;
  group.sort((a, b) => score(b.g) - score(a.g));
  const hero = group[0].g;
  const editions = group.map((e) => e.p.edition);
  const editionLabels = new Set(group.map((e) => labelFor(e.p, classic, false)));
  const mixed = editionLabels.size > 1;

  const hp = group[0].p;
  const vname = group[0].variant || hp.variant;
  const baseTitle = vname ? `${hp.base} (${vname})` : hp.base;
  hero.title = mixed || group.length === 1 ? baseTitle : titleFor(hp, editions, vname);
  if (hero.title !== group[0].rowTitle) titlesChanged++;

  for (let i = 1; i < group.length; i++) {
    mergeInto(hero, group[i].g, classic, mixed);
    mergedRows++;
    mergedIds.add(group[i].g.id);
  }
  if (group.length > 1) groupsMerged++;
  out.push(hero);
}

// singleton rows not yet in `out` (junk/pack rows) keep original title untouched
const outIds = new Set(out.map((o) => o.id));
for (const g of games) if (!outIds.has(g.id) && !mergedIds.has(g.id)) out.push(g);

console.log(`[Clean] groups=${groups.size} | mergedRows=${mergedRows} groupsMerged=${groupsMerged} titlesChanged=${titlesChanged} | mergedIds=${mergedIds.size}`);
const heal = selfHealCatalog(out);
console.log(`[Clean] self-heal: ${JSON.stringify(heal)}`);
writeGames(out);
console.log(`[Clean] saved ${out.length} games (was ${games.length}, net ${out.length - games.length})`);