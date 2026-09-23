import fs from "fs";
import path from "path";
import { Game, DownloadSource, LinuxSupportInfo } from "../src/types";
import { fetchSteamDetails, fetchProtonSummary } from "./metadataService";
import { normalizeClassicFlag } from "./normalize";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SourceConfig {
  name: string;
  url?: string;
  filePath?: string; // local JSON (e.g. manually downloaded) — read instead of fetch
  originalUrl?: string;
  category: "repacker" | "classic";
  enabled: boolean;
  note?: string;
}

export interface SourceRunResult {
  name: string;
  category: string;
  ok: boolean;
  rawCount: number;
  uniqueCount: number;
  error?: string;
}

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  error?: string;
  sources: SourceRunResult[];
  totals: {
    added: number;
    updated: number;
    unchanged: number;
    totalGames: number;
    downloadSourceCount: number;
  };
}

const ERA_CLASSIC = "classic";
const ERA_MODERN = "modern";

interface ParsedEntry {
  rawTitle: string;
  cleanTitle: string;
  normalizedTitle: string;
  fileSize: string;
  uploadDate: string;
  uploadDateParsed: number;
  repacker: string;
  platform: string;
  downloads: DownloadSource[];
  gogId?: string;
  gogUrl?: string;
  developer?: string;
  genres?: string[];
  rating?: number;
  releaseDate?: string;
}

interface MergedKey {
  cleanTitle: string;
  sources: Map<string, DownloadSource>;
  uploadDate: string;
  uploadDateParsed: number;
  isClassic: boolean;
  hasSteamId: boolean;
  platforms: Set<string>;
  gogId?: string;
  gogUrl?: string;
  developer?: string;
  genres?: string[];
  rating?: number;
  releaseDate?: string;
}

const PLATFORM_GENRES: Record<string, string> = {
  ps1: "PS1",
  ps2: "PS2",
  ps3: "PS3",
  ps4: "PS4",
  psp: "PSP",
  psvita: "PS Vita",
  n64: "N64",
  snes: "SNES",
  nes: "NES",
  gb: "GB",
  gbc: "GBC",
  gba: "GBA",
  ds: "DS",
  "3ds": "3DS",
  gamecube: "GameCube",
  wii: "Wii",
  wiiu: "Wii U",
  switch: "Switch",
  dreamcast: "Dreamcast",
  saturn: "Saturn",
  megadrive: "Mega Drive",
  genesis: "Genesis",
  pce: "PCE",
  msx: "MSX",
  xbox: "Xbox",
  "xbox360": "Xbox 360",
};

// ── Title normalization (ported from build_database.py) ───────────────────────

const STRIP_PATTERNS = [
  /\[.*?\]/,
  /\(password:\s*[^)]*\)/,
  /\(senha:\s*[^)]*\)/,
  /(?:password|senha)\s*=\s*[^)\]\s]+/i,
  /\(\s*[bB]\d+[^)]*\)/,
  /\b[bB]\d{3,}\b/,
  /\b\d{5,}\b/,
  /\([^)]*\b(?:gog|steam)\b[^)]*\)/,
  /\(\s*\d+\s*\)/,
  /(?:direct play|no install|selective download)/,
  /\([^)]*(?:super\s+)?fast\s+install[^)]*\)/,
  /\(.*?MULTi\d+.*?\)/,
  /\(v[\d\.]+[^)]*\)/,
  /\bv[\d]+\.[\d][\d\.]*\b/,
  /\(Build\s[\d\.]+[^)]*\)/,
  /\bBuild\s+\d+\b/,
  /\bPatch\s+\d+\b/,
  /\bHotfix\s+\d+\b/,
  /\bUpdate\s+\d+\b/,
  /\(\d{4}(?:[/-]\d{2}){0,2}\)/,
  /\(\d{4}-\d{4}\)/,
  /\+\s*\d+\s*DLCs?[^,\n]*/,
  /\+\s*(?:All\s+)?DLCs?/,
  /\+\s*Bonus\s+\w+/,
  /\+\s*(?:Online\s+)?Multiplayer/,
  /\+\s*OST\b/,
  /\(All DLCs[^)]*\)/,
  /\([^)]*DLCs?[^)]*\)/,
  /\(Fast Install[^)]*\)/,
  /\(Hypervisor\)/,
  /[:\s]+Digital\s+Deluxe\s+Edition/,
  /[:\s]+Digital\s+Edition/,
  /[:\s]+Digital\b/,
  /[:\s]+Deluxe\s+Edition/,
  /[:\s]+Complete\s+Edition/,
  /[:\s]+Ultimate\s+Edition/,
  /[:\s]+Gold\s+Edition/,
  /[:\s]+GOTY\s+Edition/,
  /[:\s]+Game\s+of\s+the\s+Year\s+Edition/,
  /[:\s]+Premium\s+Edition/,
  /[:\s]+Definitive\s+Edition/,
  /[:\s]+Enhanced\s+Edition/,
  /[:\s]+Anniversary\s+Edition/,
  /[:\s]+Collector[s']?\s+Edition/,
  /[:\s]+Director[s']?\s+Cut/,
  /[:\s]+Standard\s+Edition/,
  /[:\s]+Special\s+Edition/,
  /[:\s]+Extended\s+Edition/,
  /[–—\-]\s*v[\d\.]+.*/,
  /,\s*v[\d\.]+.*/,
  /RePack\s+(?:от|by|from)\s+\w+/,
  /RePack\b.*/,
  /Repack\b.*/,
  /\bFree\s+Download\b/,
  /PC\s*\|\s*Лицензия/,
  /PC\s*\|\s*RePack.*/,
  /\[Архив\]/,
  /\[Папка игры[^\]]*\]/,
  /\[Акелла\]/,
  /\(Early Access\)/,
  /&\s*.+Bundle/,
];

function stripPatterns(title: string): string {
  let t = title;
  for (const pattern of STRIP_PATTERNS) {
    const g = new RegExp(pattern.source, "gi");
    t = t.replace(g, " ");
  }
  return t;
}

export function canonicalTitle(raw: string): string {
  // Removes identity-clutter so title variants of the same game
  // ("... 1.06", "... (From 8.5 GB)", "... - GotY Edition", "... - PC")
  // collapse onto a single entry.
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
      .replace(/\s*\(\s*(?:с\s+)?(?:русскими\s+)?(?:сабами|субтитрами)\s*\)?\s*$/gi, "")
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

// Raw source titles arrive with leading encoding garbage ("???? Banner of the
// Maid"), dangling scene/repacker tags ("1000xRESIST-TiNYiSO", "1.8192-
// (TENOKE", "DRIVE Rally (1.3.24.0)") and stray punctuation that makes them
// unmatchable against Steam/IGDB. Scrub those first; unlike canonicalTitle
// this keeps editions/versions in the middle of the name intact.
const TITLE_SCENE_TAG =
  "TENOKE|TiNYiSO|RUNE|SKIDROW|CODEX|DODI|FitGirl|ElAmigos|GoldBerg|Empress|P2P|Repack|" +
  "Scene|KaOs|Xatab|Steam-?Rip|OnlineFix|GOG|Steam|License|Multilang|Multi\\d*|ENG|RUS|GER|Build|Portable";

export function repairTitle(raw: string): string {
  let t = (raw || "").replace(/[\u{FFFD}\u200B-\u200D\uFEFF]/gu, " ").trim();
  // leading garbage only — keep meaningful prefixes like "#BLUD", ".hack", "!Ω"
  t = t.replace(/^[\s?؟|•·_\-–—]+/u, "");
  const parenTag = new RegExp(
    `[\\s._-]*\\((?:[^)]*\\b(?:${TITLE_SCENE_TAG})\\b[^)]*|v?\\d[\\d.]*[a-z]?|\\d+[.,]?\\d*\\s*(?:gb|mb))[^)]*\\)?\\s*$`,
    "i"
  );
  const trailTag = new RegExp(`[\\s._:–—,()|/+-]+(?:${TITLE_SCENE_TAG})[\\s._:–—,()|/+-]*$`, "i");
  for (let i = 0; i < 4; i++) {
    t = t
      .replace(parenTag, "")
      .replace(trailTag, "")
      .replace(/\s*[-–—]\s*v?\.?\s*[\d.]+[a-z]*\s*$/i, "")
      .replace(/[\s._:–—,()|/+\-]+$/u, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return t;
}

export function cleanTitle(raw: string): string {
  return canonicalTitle(stripPatterns(repairTitle(raw)))
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[\s:–—,.()|/]+|[\s:–—,.()|/]+$/g, "");
}

export function normalizeForMatch(title: string): string {
  const tokens = canonicalTitle(stripPatterns(repairTitle(title)))
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return tokens
    .replace(/\s+from\s+(?:[\d.]+\s*)+\s*(?:gb|mb|tb|kb)\b/g, "")
    .replace(/\s+(?:v|ver)(?:\s*[\d.]+)+\s*$/, "")
    .replace(/^(.+\S)\s+(?:\d+(?:\s+\d+)+)$/, "$1")
    .replace(/\s+(?:goty|goty edition|game of the year|game of the year edition|deluxe|deluxe edition|digital deluxe|definitive edition|complete edition|ultimate edition|royal edition|collectors? edition)\s*$/, "")
    .replace(/\s+(?:pc|windows|win)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Release residue that repacker titles carry but Steam store names never do
// ("Build 110", "R34294", "MULTi12", "FitGirl Repack", language tags, DLC
// notes…). Used to build a *secondary* matching key so version-heavy titles
// like "112 Operator v.0.220428.110w-cb" still resolve to their base app.
const RELEASE_JUNK_TOKENS = new Set([
  "repack", "repackage", "repacks", "dodi", "dodis", "fitgirl", "xatab", "codex",
  "razor1911", "elamigos", "steamrip", "onlinefix", "online-fix", "gog",
  "magnet", "torrent", "download", "full", "setup", "installer", "install",
  "preinstalled", "crack", "cracked", "noinstall", "portable", "redist",
  "eng", "rus", "ger", "fre", "ita", "spa", "pol", "jp", "jpn", "chn", "chs",
  "ptbr", "bra", "latam", "multi", "multilang", "multilingual", "multilingualver",
  "windows", "win", "win64", "win32", "win10", "win11", "winxp", "x64", "x86",
  "64bit", "32bit", "pc", "mac", "macos", "linux", "unix", "steamos",
  "dlc", "dlcs", "bundle", "updated", "version", "hotfix", "works",
]);

function stripReleaseJunk(key: string): string {
  if (!key) return "";
  const out: string[] = [];
  for (const t of key.split(" ")) {
    if (!t) continue;
    if (RELEASE_JUNK_TOKENS.has(t)) continue;
    if (/^\d+(?:\.\d+)*[a-z]*$/i.test(t)) continue; // 1.31, 34294, 110w
    if (/^v\d/.test(t)) continue; // v1, v0220428
    if (/^r\d{2,}$/i.test(t)) continue; // r34294 (release/build tag)
    if (/^b\d{3,}$/i.test(t)) continue; // b12345
    if (/^(multi|m)\d{1,3}$/i.test(t)) continue; // multi12
    out.push(t);
  }
  return out.join(" ");
}

function makeId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const MIN_DATE_MS = -62135596800000;

function parseDateToMs(dateStr: string): number {
  if (!dateStr) return MIN_DATE_MS;
  const cleaned = dateStr.trim();
  const formats: RegExp[] = [
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{4}\/\d{2}\/\d{2}$/,
  ];
  for (const fmt of formats) {
    if (fmt.test(cleaned)) {
      const ms = Date.parse(cleaned);
      if (!isNaN(ms)) return ms;
    }
  }
  return MIN_DATE_MS;
}

// ── Repacker payload parsing (ported from build_database.py load_repacker_file) ──

function parseSourcePayload(data: unknown, repackerName: string): ParsedEntry[] {
  if (!data || typeof data !== "object") return [];
  const payload = data as { name?: unknown; downloads?: unknown[] };
  const downloads = Array.isArray(payload.downloads) ? payload.downloads : [];
  if (!downloads.length) return [];

  const rawEntries: ParsedEntry[] = [];
  for (const item of downloads) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { title?: unknown; fileSize?: unknown; uploadDate?: unknown; uris?: unknown[]; platform?: unknown; gogId?: unknown; gogUrl?: unknown; developer?: unknown; genres?: unknown; rating?: unknown; releaseDate?: unknown };
    const rawTitle = String(entry.title || "").trim();
    if (!rawTitle) continue;

    const fileSize = String(entry.fileSize || "").trim();
    const uploadDate = String(entry.uploadDate || "").slice(0, 10);
    const platform = String(entry.platform || "").trim().toLowerCase();
    const gogId = entry.gogId ? String(entry.gogId).trim() : undefined;
    const gogUrl = entry.gogUrl ? String(entry.gogUrl).trim() : undefined;
    const developer = entry.developer ? String(entry.developer).trim() : undefined;
    const genres = Array.isArray(entry.genres)
      ? Array.from(new Set(entry.genres.map((g) => String(g).trim()).filter(Boolean)))
      : undefined;
    const rating = typeof entry.rating === "number" && isFinite(entry.rating)
      ? Math.max(0, Math.min(100, Math.round(entry.rating)))
      : entry.rating !== undefined && entry.rating !== "" && entry.rating !== null
        ? Math.max(0, Math.min(100, Math.round(Number(entry.rating))))
        : undefined;
    const releaseDate = entry.releaseDate ? String(entry.releaseDate).trim().slice(0, 10) : undefined;

    const sources: DownloadSource[] = [];
    for (const uri of Array.isArray(entry.uris) ? entry.uris : []) {
      // A uri may be a plain URL string or an object { url, name, type, fileSize }
      // (used by sources like gog-games.to to keep a per-mirror label).
      const url = uri && typeof uri === "object"
        ? String((uri as any).url || "").trim()
        : String(uri || "").trim();
      if (!url) continue;
      const isTorrent = url.startsWith("magnet:") || url.endsWith(".torrent");
      const uriName = uri && typeof uri === "object" ? String((uri as any).name || "") : "";
      const uriKind = uri && typeof uri === "object" ? String((uri as any).kind || "").trim() : "";
      sources.push({
        name: uriName || `${repackerName} ${isTorrent ? "Magnet" : "Direct"}`,
        url,
        type: uri && typeof uri === "object" && (uri as any).type ? String((uri as any).type) : isTorrent ? "torrent" : "direct",
        repacker: repackerName,
        fileSize: uri && typeof uri === "object" && (uri as any).fileSize ? String((uri as any).fileSize) : fileSize,
        uploadDate,
        kind: uriKind && (uriKind === "game" || uriKind === "patch" || uriKind === "goodie") ? uriKind : undefined,
      });
    }
    if (!sources.length) continue;

    const norm = normalizeForMatch(rawTitle);
    if (!norm) continue;

    rawEntries.push({
      rawTitle,
      cleanTitle: cleanTitle(rawTitle),
      normalizedTitle: norm,
      fileSize,
      uploadDate,
      uploadDateParsed: parseDateToMs(uploadDate),
      repacker: repackerName,
      platform,
      downloads: sources,
      gogId,
      gogUrl,
      developer,
      genres,
      rating,
      releaseDate,
    });
  }

  // Keep only the most recent entry per normalized title within this repacker
  const byNorm = new Map<string, ParsedEntry>();
  for (const entry of rawEntries) {
    const existing = byNorm.get(entry.normalizedTitle);
    if (!existing || entry.uploadDateParsed > existing.uploadDateParsed) {
      byNorm.set(entry.normalizedTitle, entry);
    }
  }
  return Array.from(byNorm.values());
}

// ── Source config loading ─────────────────────────────────────────────────────

export function readSourcesConfig(configPath: string): SourceConfig[] {
  try {
    if (!fs.existsSync(configPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as SourceConfig[];
    return Array.isArray(parsed)
      ? parsed.filter((s) => s && (s.url || s.filePath))
      : [];
  } catch (e: any) {
    console.error(`[Sources] Failed to read ${configPath}:`, e.message);
    return [];
  }
}

const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ZakurosArchive/1.0";

async function fetchSourceJson(source: SourceConfig): Promise<unknown> {
  // Local file source (manually downloaded copy — re-download to update).
  if (source.filePath) {
    const filePath = path.resolve(process.cwd(), source.filePath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Local file not found: ${source.filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }
  if (source.url?.startsWith("file:")) {
    const filePath = source.url.replace(/^file:\/\//, "");
    if (!fs.existsSync(filePath)) {
      throw new Error(`Local file not found: ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }

  const url = source.url;
  if (!url) throw new Error("No url or filePath configured.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": FETCH_UA,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${(text || "").slice(0, 60)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Game building (ported shape from build_database.py merge_all output) ────

const GENRE_RULES: ReadonlyArray<{ genre: string; test: RegExp }> = [
  { genre: "Visual Novel", test: /(visual\s?novel|dating\s?sim|otome|eroge)/i },
  { genre: "Metroidvania", test: /metroidvania/i },
  { genre: "Souls-like", test: /souls\s?-?like|soulsborne/i },
  { genre: "Roguelike", test: /roguel(?:ike|ite)/i },
  { genre: "JRPG", test: /\bjrpg\b|\bj-rpg\b/i },
  { genre: "CRPG", test: /\bcrpg\b|c-rpg|baldur/i },
  { genre: "ARPG", test: /\barpg\b|action\s?rpg/i },
  { genre: "Deckbuilder", test: /deck\s?-?builder|deck\s?building|card\s?battler/i },
  { genre: "Card Game", test: /card\s?game|solitaire|poker|black\s?jack/i },
  { genre: "Board Game", test: /board\s?game|monopoly|chess|checkers/i },
  { genre: "Rhythm", test: /rhythm|beat\s?saber|dj\b/i },
  { genre: "Racing", test: /racing|formula\s?1|need\s?for\s?speed|rally|gran\s?turismo|forza/i },
  { genre: "Sports", test: /football|soccer|basketball|hockey|tennis|baseball|golf/i },
  { genre: "Fighting", test: /fighting|mortal\s?kombat|street\s?fighter|tekken|smash\s?bros/i },
  { genre: "Stealth", test: /stealth/i },
  { genre: "Survival", test: /survival|survivor/i },
  { genre: "Horror", test: /horror|creepy|backrooms/i },
  { genre: "Open World", test: /open\s?-?world/i },
  { genre: "Sandbox", test: /sandbox/i },
  { genre: "Strategy", test: /strategy|\brts\b|real\s?-?time\s?strategy|\b4x\b|grand\s?strategy|paradox/i },
  { genre: "Turn-based", test: /turn\s?-?based|\btbs\b/i },
  { genre: "Tower Defense", test: /tower\s?defense/i },
  { genre: "Idle", test: /\bidle\b|incremental|clicker/i },
  { genre: "Bullet Hell", test: /bullet\s?hell|danmaku|twin\s?-?stick/i },
  { genre: "Platformer", test: /platformer|platforming/i },
  { genre: "Puzzle", test: /puzzle/i },
  { genre: "Point-and-click", test: /point\s?-?\s?and\s?-?\s?click/i },
  { genre: "MOBA", test: /\bmoba\b|league\s?of\s?legends|\bdota\b/i },
  { genre: "MMO", test: /\bmmo\b|mmorpg|massively\s?multiplayer/i },
  { genre: "Battle Royale", test: /battle\s?royale/i },
  { genre: "City Builder", test: /city\s?-?builder|tycoon|simcity/i },
  { genre: "Farming", test: /farming|\bstardew\b/i },
  { genre: "Co-op", test: /co-?op|local\s?multiplayer/i },
  { genre: "Cozy", test: /cozy|wholesome/i },
  { genre: "Walking Sim", test: /walking\s?sim(?:ulator)?/i },
  { genre: "Story-rich", test: /story\s?-?rich|narrative|choices\s?matter/i },
  { genre: "Cyberpunk", test: /cyber\s?punk/i },
  { genre: "Fantasy", test: /fantasy/i },
  { genre: "Sci-Fi", test: /\bscifi\b|sci-?fi|science\s?fiction/i },
  { genre: "Post-apocalyptic", test: /post\s?-?apocalyptic|apocalyptic/i },
  { genre: "Retro", test: /retro|\b8-?bit\b|16-?bit|pixel\s?art/i },
  { genre: "Arcade", test: /arcade/i },
  { genre: "Pinball", test: /pinball/i },
  { genre: "Management", test: /management|store\s?management|\bshop\b/i },
  { genre: "Simulator", test: /\bsimulator\b|\bsimulation\b/i },
  { genre: "Space", test: /\bspace\b|interstellar|orbital/i },
  { genre: "Zombie", test: /zombie/i },
  { genre: "VR", test: /\bvr\b|virtual\s?reality/i },
  { genre: "Hidden Object", test: /hidden\s?object/i },
  { genre: "NSFW", test: /hentai|\bnsfw\b|adult\s?only|18\+|sexual\s?content|eroge/i },
];

function consoleGenres(platforms: Set<string>): string[] {
  return Array.from(
    new Set(
      Array.from(platforms).map((p) => PLATFORM_GENRES[p] || p.toUpperCase()).filter(Boolean)
    )
  );
}

export function matchGenres(text: string, existing: string[]): string[] {
  const t = ` ${text.toLowerCase()} `;
  const out = new Set<string>();
  for (const rule of GENRE_RULES) {
    if (rule.test.test(t) && !existing.includes(rule.genre)) out.add(rule.genre);
  }
  return Array.from(out);
}

function inferExtraGenres(title: string, existing: string[]): string[] {
  return matchGenres(title, existing);
}

function buildGame(merged: MergedKey, repackers: string[], id?: string): Game {
  const sortedSources = Array.from(merged.sources.values()).sort(
    (a, b) => parseDateToMs(b.uploadDate || "") - parseDateToMs(a.uploadDate || "")
  );
  const fileSize = sortedSources.find((s) => s.fileSize)?.fileSize || "";
  const magnet = Array.from(merged.sources.values()).find((s) => s.type === "torrent")?.url || "";
  const uniqueRepackers = Array.from(
    new Set(Array.from(merged.sources.values()).map((s) => s.repacker || "Unknown").filter(Boolean))
  );

  const baseGenres = merged.isClassic
      ? ["Classic", "Retro", ...consoleGenres(merged.platforms)]
      : ["PC Game"];
  const sourceGenres = (merged.genres || []).filter((g) => !baseGenres.includes(g));

  return {
    id: id || makeId(merged.cleanTitle),
    title: merged.cleanTitle,
    developer: merged.developer || "",
    publisher: repackers.join(", "),
    genres: [...baseGenres, ...sourceGenres, ...inferExtraGenres(merged.cleanTitle, [...baseGenres, ...sourceGenres])],
    releaseDate: merged.releaseDate || merged.uploadDate,
    rating: merged.rating || 0,
    fileSize,
    magnetLink: magnet,
    coverImage: "",
    screenshot: "",
    summary: merged.isClassic
      ? "Retro / classic title — emulated console release."
      : `Available via: ${uniqueRepackers.join(", ")}`,
    systemRequirements: {
      windows: {
        minimum: {
          os: "Windows 10 64-bit",
          processor: "Check original game requirements",
          memory: "8 GB RAM",
          storage: fileSize || "See download page",
        },
      },
    },
    stats: {
      downloads: 0,
      views: 0,
      updatedAt: merged.uploadDate,
    },
    downloadSources: Array.from(merged.sources.values()),
    gogId: merged.gogId,
    gogUrl: merged.gogUrl,
    classic: merged.isClassic,
  };
}

// ── Catalog stabilization: fix broken ids + collapse duplicate games ─────────
// Source feeds carry junk/numeric/colliding ids and duplicate rows (same title,
// title variants under one Steam appid, or identical rows from a giant dump).
// Ids are regenerated deterministically (idempotent across runs), and every
// duplicate group is folded into the most complete survivor, keeping a union of
// download links and the best metadata.

const HASH_BASE36 = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(6, "0");
};

function stabilizeScore(g: Game): number {
  return (
    (g.coverImage ? 10 : 0) +
    (typeof g.steamId === "number" ? 8 : 0) +
    (g.summary && g.summary.length > 40 ? 4 : g.summary ? 1 : 0) +
    (g.developer ? 3 : 0) +
    (g.releaseDate && !/unknown/i.test(g.releaseDate) ? 1 : 0) +
    (g.linux && (g.linux.tier || g.linux.native) ? 2 : 0) +
    Math.min(g.downloadSources?.length || 0, 6) +
    (g.classic ? -1 : 0) +
    (g.id ? 2 : 0)
  );
}

function foldInto(winner: Game, other: Game): void {
  if (!winner.coverImage && other.coverImage) winner.coverImage = other.coverImage;
  if (!winner.screenshot && other.screenshot) winner.screenshot = other.screenshot;
  if (!winner.screenshots?.length && other.screenshots?.length) winner.screenshots = other.screenshots;
  if (typeof winner.steamId !== "number" && typeof other.steamId === "number") winner.steamId = other.steamId;
  if (!winner.gogId && other.gogId) winner.gogId = other.gogId;
  if (!winner.gogUrl && other.gogUrl) winner.gogUrl = other.gogUrl;
  if (!winner.developer && other.developer) winner.developer = other.developer;
  if (!winner.publisher && other.publisher) winner.publisher = other.publisher;
  if (other.summary && (!winner.summary || winner.summary.length < other.summary.length)) winner.summary = other.summary;
  if (!winner.linux && other.linux) winner.linux = other.linux;
  if ((!winner.releaseDate || /unknown/i.test(winner.releaseDate)) && other.releaseDate && !/unknown/i.test(other.releaseDate)) {
    winner.releaseDate = other.releaseDate;
  }
  if (!winner.rating && other.rating) winner.rating = other.rating;
  if (!winner.magnetLink && other.magnetLink) winner.magnetLink = other.magnetLink;
  if (!winner.fileSize && other.fileSize) winner.fileSize = other.fileSize;
  // Never carry "classic" onto a game that has a Steam id (native PC release).
  if (other.classic && !winner.classic && typeof winner.steamId !== "number") winner.classic = true;

  if (other.downloadSources?.length) {
    const urls = new Set((winner.downloadSources || []).map((s) => s.url));
    for (const s of other.downloadSources) {
      if (!urls.has(s.url)) {
        winner.downloadSources = winner.downloadSources || [];
        winner.downloadSources.push(s);
        urls.add(s.url);
      }
    }
  }
  if (other.genres?.length) {
    const have = new Set((winner.genres || []).map((x) => x.toLowerCase()));
    for (const g of other.genres) {
      if (!have.has(g.toLowerCase())) {
        winner.genres = winner.genres || [];
        winner.genres.push(g);
        have.add(g.toLowerCase());
      }
    }
    winner.genres = winner.genres.slice(0, 12);
  }
  if (other.trailers?.length) {
    const have = new Set((winner.trailers || []).map((t) => t.src));
    for (const t of other.trailers) {
      if (!have.has(t.src)) {
        winner.trailers = winner.trailers || [];
        winner.trailers.push(t);
        have.add(t.src);
      }
    }
  }
  if (other.stats) {
    const a = Date.parse(winner.stats?.updatedAt || "");
    const b = Date.parse(other.stats.updatedAt || "");
    if (isNaN(a) || (b > a)) {
      winner.stats = { ...(winner.stats || { downloads: 0, views: 0, updatedAt: "" }), ...other.stats };
    }
  }
}

// A Steam appid is the canonical identity of a game, but enrichment sometimes
// assigns the same appid to two unrelated titles (bad fuzzy match, shared
// "Collector's Edition" batches, etc). Before folding a same-appid group, make
// sure the titles actually read like the same game so we never delete a real
// entry. Release tags/version numbers are stripped first.
export function roughTitleKey(title: string): string {
  return (title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(repack|repacks|fitgirl|dodi|xatab|codex|elamigos|steamrip|onlinefix|gog|tenoke|rune|scene|build|updated|multi\d*|multilang|v\d[\d.]*|goty|deluxe|edition|definitive|complete|ultimate|remastered|remake|collector|collectors)\b/g,
      " "
    )
    .replace(/\b\d+(\.\d+)*\w*\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const STEAM_MERGE_SIMILARITY = 0.5;

export function titlesLookLikeSameGame(a: string, b: string): boolean {
  const ra = roughTitleKey(a);
  const rb = roughTitleKey(b);
  if (!ra || !rb) return false;
  if (ra === rb) return true;
  if (ra.length > 3 && rb.length > 3 && (ra.includes(rb) || rb.includes(ra))) return true;
  const A = new Set(ra.split(" ").filter((t) => t.length > 1));
  const B = new Set(rb.split(" ").filter((t) => t.length > 1));
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter) >= STEAM_MERGE_SIMILARITY;
}

export function stabilizeCatalog(games: Game[]): { games: Game[]; merged: number; regen: number } {
  let merged = 0;
  const doomed = new Set<Game>();

  const processGroup = (group: Game[]) => {
    if (group.length < 2) return;
    let best = group[0];
    let bestScore = -1;
    for (const g of group) {
      const s = stabilizeScore(g);
      if (s > bestScore) {
        bestScore = s;
        best = g;
      }
    }
    for (const g of group) {
      if (g === best || doomed.has(g)) continue;
      foldInto(best, g);
      doomed.add(g);
    }
  };

  // 1) exact title duplicates (normalized key, era-aware: a retro console dump
  //    and the modern PC release of the same name are DIFFERENT games and must
  //    never be folded together)
  const byKey = new Map<string, Game[]>();
  for (const g of games) {
    const k = normalizeForMatch(g.title || "");
    if (!k) continue;
    const era = g.classic ? ERA_CLASSIC : ERA_MODERN;
    const arr = byKey.get(`${k}::${era}`) ?? [];
    arr.push(g);
    byKey.set(`${k}::${era}`, arr);
  }
  for (const [, group] of byKey) processGroup(group);

  // 2) cross-title duplicates that share one Steam appid (edition/locale/punct
  //    variants). Cluster by title similarity first: a mis-assigned appid can be
  //    shared by genuinely different games, and those must stay separate.
  const bySteam = new Map<number, Game[]>();
  for (const g of games) {
    if (g.classic || typeof g.steamId !== "number") continue;
    const arr = bySteam.get(g.steamId) ?? [];
    arr.push(g);
    bySteam.set(g.steamId, arr);
  }
  for (const [, group] of bySteam) {
    const live = group.filter((g) => !doomed.has(g));
    if (live.length < 2) continue;
    const clusters: Game[][] = [];
    for (const g of live) {
      const hit = clusters.find((c) => titlesLookLikeSameGame(c[0].title || "", g.title || ""));
      if (hit) hit.push(g);
      else clusters.push([g]);
    }
    for (const c of clusters) processGroup(c);
  }

  // Build output: drop doomed rows AND aliased rows (the same object reference
  // appearing more than once — the array holds one entry per title, so a
  // repeated reference is the same game serialized twice; processGroup's
  // `g === best` guard can't fold identical references, so we dedupe here).
  const out: Game[] = [];
  const outRefs = new Set<Game>();
  for (const g of games) {
    if (doomed.has(g) || outRefs.has(g)) continue;
    outRefs.add(g);
    out.push(g);
  }
  merged = games.length - out.length;

  // 3) deterministic unique ids (idempotent: stable order + content-derived suffixes)
  let regen = 0;
  const seen = new Set<string>();
  for (const g of out) {
    const id = (g.id || "").trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      continue;
    }
    const base = makeId(g.title || "") || "game";
    const h = HASH_BASE36(g.title || g.id || "");
    let candidate = `${base}-${h}`;
    let suffix = 1;
    while (seen.has(candidate)) candidate = `${base}-${h}-${suffix++}`;
    g.id = candidate;
    seen.add(candidate);
    regen++;
  }

  return { games: out, merged, regen };
}

// Filler detection for un-enriched foreign-language imports (chiefly the
// Rutracker/Rutor "all categories" feeds): a game with no Steam metadata and a
// non-Latin title (or a bilingual title carrying Cyrillic) is repack-runoff
// with nothing to show. Kept out-of-catalog on every write so a source sync
// can't re-introduce it. Games that acquire metadata (steamId/cover) are kept.
export function isForeignFiller(g: Game): boolean {
  if (g.classic || g.steamId || g.gogId || g.coverImage) return false;
  const t = g.title || "";
  if (!t) return false;
  if (/[\u0400-\u04ff]/.test(t)) return true;
  return !/[A-Za-z]/.test(t) && /[^\x00-\x7f]/.test(t);
}

export function pruneForeignFiller(games: Game[]): number {
  let removed = 0;
  for (let i = games.length - 1; i >= 0; i--) {
    if (isForeignFiller(games[i])) {
      games.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

// ── Persist-time self-heal ───────────────────────────────────────────────────
// The corrections applied by the one-time cleanup scripts must survive future
// source syncs and grind writes, otherwise a re-import re-introduces the same
// problems. These run before every catalog write.

const STEAM_LIBRARY_COVER = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;

// A cover fetched for a *different* app than the game's resolved steamId (e.g.
// "Resident Evil" wearing RE4's library art) is a title-match artifact. When a
// numeric steamId is present, trust it over the stale cover appid. Games with no
// steamId are left untouched (the cover may be their only art).
export function alignCoverAppids(games: Game[]): number {
  let fixed = 0;
  for (const g of games) {
    if (g.classic || typeof g.steamId !== "number") continue;
    const coverAppid = (g.coverImage || "").match(/\/apps\/(\d+)\//)?.[1];
    if (!coverAppid || coverAppid === String(g.steamId)) continue;
    g.coverImage = STEAM_LIBRARY_COVER(g.steamId);
    fixed++;
  }
  return fixed;
}

// Import titles of the form "English / Русский" are the same game listed twice.
// Fold the bilingual row into its Latin-only original (sources + any metadata),
// but only when the Latin half matches exactly AND the two agree on Steam
// identity — so sequels ("Crazy Machines 2" vs "… 3"), bundles ("… Дилогия")
// and localised-subtitle variants stay separate.
const BILINGUAL_BUNDLE =
  /дилоги|трилоги|антолог|аддон|addon|antholog|collect|компил|все части|\btrilogy\b|\bdilogy\b|\bbundle\b|\bcomplete\b/i;

function latinSegment(title: string): string {
  let best = "";
  let bestScore = -1;
  for (const seg of (title || "").split(/\s*[/|]\s*/)) {
    const score = (seg.match(/[A-Za-z]/g) || []).length;
    if (score > bestScore) {
      bestScore = score;
      best = seg;
    }
  }
  return best;
}

function keyLooksSubstantial(key: string): boolean {
  const t = key.split(" ").filter(Boolean);
  return t.length >= 2 || (t.length === 1 && t[0].length >= 5);
}

export function mergeBilingualDuplicates(games: Game[]): number {
  const isBilingual = (g: Game) =>
    /[A-Za-z]/.test(g.title || "") && /[\u0400-\u04ff]/.test(g.title || "");
  const targets = games.filter(isBilingual);
  if (!targets.length) return 0;

  const targetSet = new Set(targets);
  const byKey = new Map<string, Game[]>();
  for (const g of games) {
    if (targetSet.has(g)) continue;
    const k = normalizeForMatch(g.title || "");
    if (!k) continue;
    const arr = byKey.get(k) ?? [];
    arr.push(g);
    byKey.set(k, arr);
  }

  const doomed = new Set<Game>();
  let merged = 0;
  for (const g of targets) {
    if (g.classic || BILINGUAL_BUNDLE.test(g.title || "")) continue;
    const key = normalizeForMatch(latinSegment(g.title || ""));
    if (!keyLooksSubstantial(key)) continue;
    const keeper = (byKey.get(key) || []).find((h) => !targetSet.has(h) && !doomed.has(h) && !h.classic);
    if (!keeper) continue;
    if (
      typeof keeper.steamId === "number" &&
      typeof g.steamId === "number" &&
      keeper.steamId !== g.steamId
    ) {
      continue;
    }
    foldInto(keeper, g);
    doomed.add(g);
    merged++;
  }

  if (merged) {
    for (let i = games.length - 1; i >= 0; i--) {
      if (doomed.has(games[i])) games.splice(i, 1);
    }
  }
  return merged;
}

// One entry point for every persist path (dev server, grind, IGDB filler) so a
// single call keeps the catalog clean: drop re-imported filler, fold bilingual
// dupes, collapse same-appid/edition dupes, then re-align mismatched covers.
// Collapse case/whitespace duplicate genre tags ("Sci-fi" vs "Sci-Fi",
// "Turn-based" vs "Turn-based ") introduced by later source merges. Keeps
// order and the first spelling. Idempotent.
function cleanGenres(g: Game): boolean {
  const cur = g.genres || [];
  if (cur.length === 0) return false;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of cur) {
    const x = String(raw ?? "").trim();
    const key = x.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  if (out.length === cur.length) return false;
  g.genres = out;
  return true;
}

// Drop header/page_bg placeholder screenshots from a game that also carries
// real artwork (a stale mix arrives from old merges). All-placeholder games
// are left alone — screenshotsArePlaceholder treats them as "not yet filled".
const PLACEHOLDER_SHOT = /header\.jpg|page_bg|unsplash/;
function cleanPlaceholderShots(g: Game): boolean {
  const cur = g.screenshots || [];
  if (cur.length === 0) return false;
  const real = cur.filter((u) => u && !PLACEHOLDER_SHOT.test(u));
  if (real.length === 0 || real.length === cur.length) return false;
  g.screenshots = real;
  if (g.screenshot && PLACEHOLDER_SHOT.test(g.screenshot)) g.screenshot = real[0];
  return true;
}

export function selfHealCatalog(games: Game[]): {
  filler: number;
  bilingual: number;
  merged: number;
  covers: number;
  classic: number;
  genres: number;
  shots: number;
} {
  const filler = pruneForeignFiller(games);
  const bilingual = mergeBilingualDuplicates(games);
  const { games: stabilized, merged } = stabilizeCatalog(games);
  if (merged > 0) {
    games.length = 0;
    for (const g of stabilized) games.push(g);
  }
  // Strip mis-tagged classics before cover alignment so newly non-classic PC
  // games get their covers aligned in the same pass.
  let classic = 0;
  for (const g of games) if (normalizeClassicFlag(g)) classic++;
  const covers = alignCoverAppids(games);
  // Payload hygiene: no duplicate genres, no placeholder frames mixed into
  // real screenshot sets. Both idempotent (second pass reports 0).
  let genres = 0;
  let shots = 0;
  for (const g of games) {
    if (cleanGenres(g)) genres++;
    if (cleanPlaceholderShots(g)) shots++;
  }
  return { filler, bilingual, merged, covers, classic, genres, shots };
}

// ── Steam enrichment for newly added PC titles ───────────────────────────────

const STEAM_SEARCH_URL = (term: string) =>
  `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=US&l=en`;

// Titles we've already tried to resolve against Steam (so each sync keeps
// making forward progress through the un-enriched backlog rather than
// re-attempting the same unresolvable titles forever).
const enrichTried = new Set<string>();

async function steamSearchFirstHit(title: string): Promise<{ appid: number; name: string } | null> {
  const gameKey = normalizeForMatch(title);
  const gameStripped = stripReleaseJunk(gameKey);
  // Search the raw title first, then the junk-stripped variant (helps titles
  // like "171 Game" whose Steam name is just "171").
  const queries = [title, gameStripped && gameStripped !== gameKey ? gameStripped : ""].filter(Boolean);
  try {
    for (const query of queries) {
      const response = await fetch(STEAM_SEARCH_URL(query), {
        headers: { "User-Agent": FETCH_UA },
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { items?: { id: number; name: string }[] };
      const items = data?.items || [];
      if (!items.length) continue;
      for (const item of items.slice(0, 6)) {
        const hitKey = normalizeForMatch(item.name);
        const hitStripped = stripReleaseJunk(hitKey);
        if (
          hitKey === gameKey ||
          (hitStripped && hitStripped === gameKey) ||
          (gameStripped && (hitKey === gameStripped || (hitStripped && hitStripped === gameStripped))) ||
          titlesCompatible(gameKey, hitKey) ||
          (gameStripped && titlesCompatible(gameStripped, hitKey)) ||
          titlesCompatible(gameKey, hitStripped)
        ) {
          return { appid: item.id, name: item.name };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function enrichNewGames(
  games: Game[],
  maxItems = 20
): Promise<{ enriched: number; skipped: number }> {
  let enriched = 0;
  let skipped = 0;
  const candidates = games.filter(
    (g) => !g.classic && !g.steamId && !g.coverImage && g.title && (!g.summary || !g.developer)
  ).filter((g) => !enrichTried.has(g.id)).slice(0, maxItems);

  for (const game of candidates) {
    const hit = await steamSearchFirstHit(game.title);
    if (!hit) {
      enrichTried.add(game.id);
      skipped++;
      await sleep(500);
      continue;
    }

    game.steamId = hit.appid;
    game.coverImage = `https://cdn.akamai.steamstatic.com/steam/apps/${hit.appid}/library_600x900.jpg`;
    game.screenshot = `https://cdn.akamai.steamstatic.com/steam/apps/${hit.appid}/header.jpg`;

    // Steam appdetails is aggressively rate-limited; pace requests gently.
    await sleep(1200);
    try {
      const [details, proton] = await Promise.all([
        fetchSteamDetails(hit.appid),
        fetchProtonSummary(hit.appid),
      ]);
      if (details.summary) game.summary = details.summary;
      if (details.releaseDate) game.releaseDate = details.releaseDate;
      if (details.developer) game.developer = details.developer;
      if (details.publisher) game.publisher = details.publisher;
      if (details.rating !== undefined) game.rating = details.rating;
      if (details.screenshots && details.screenshots.length > 0) {
        game.screenshots = details.screenshots;
      }
      game.linux = {
        ...(game.linux || {}),
        native: !!details.linuxNative,
        ...(proton || {}),
      };
      enrichTried.add(game.id);
      enriched++;
    } catch (e: any) {
      if (e?.message === "RATE_LIMIT_EXCEEDED") {
        console.warn(`[Sync] Steam appdetails rate-limited for "${game.title}"; backing off 10s.`);
        await sleep(10000);
        skipped++;
        continue; // don't mark as tried, so the next sync retries this title
      }
      enrichTried.add(game.id);
      enriched++;
    }
    await sleep(500);
  }
  return { enriched, skipped };
}

// ── Steam AppID bulk index (keyless dump: Austrum-lab/steam-appdb) ────────────

const STEAM_APPS_PATH = path.join(process.cwd(), "data", "steam_apps.json");

let steamAppsIndex: Map<string, number[]> | null = null;
let steamAppsTokens: Map<string, Set<string>> | null = null;
let steamAppsInvert: Map<string, Set<string>> | null = null;
let steamAppsAppName: Map<number, string> | null = null;

function tokenizeKey(key: string): Set<string> {
  const tokens = key.split(/\s+/).filter(Boolean);
  return new Set(tokens);
}

// Live-compatibility check between a catalog title and a Steam store title.
// Used to reject stale/mislabeled Steam-app-dump matches (e.g. a dump that
// renamed "171" to "Infested Inside Multiplayer Online"). Liberal enough for
// subtitle/edition/DLC variants, strict enough to drop unrelated games.
export function titlesCompatible(gameTitle: string, steamTitle: string | undefined): boolean {
  if (!steamTitle) return false;
  const gT = tokenizeKey(normalizeForMatch(gameTitle || ""));
  const sT = tokenizeKey(normalizeForMatch(steamTitle));
  if (gT.size === 0 || sT.size === 0) return false;
  let matched = 0;
  for (const t of gT) if (sT.has(t)) matched++;
  if (gT.size === 1 || sT.size === 1) {
    return matched === Math.min(gT.size, sT.size) && matched >= 1;
  }
  return matched >= 2 && matched / gT.size >= 0.4 && matched / sT.size >= 0.5;
}

// Replace any current screenshots that are pure placeholders (single header
// banner, page_bg fallback, unsplash curated image) with real Steam
// screenshots. Returns true when something changed.
export function screenshotsArePlaceholder(game: Game): boolean {
  const cur = game.screenshots || [];
  return cur.length === 0 || cur.every((u) => PLACEHOLDER_SHOT.test(u));
}

export function setRealScreenshots(game: Game, shots: string[] | undefined): boolean {
  const real = (shots || []).filter((u) => u && !PLACEHOLDER_SHOT.test(u));
  if (real.length === 0) return false;
  const cur = game.screenshots || [];
  if (!screenshotsArePlaceholder(game) && real.length <= cur.length) return false;
  game.screenshots = real;
  game.screenshot = real[0];
  return true;
}

// Text placeholder detection for description-ish fields: repack summaries
// ("Available via: FitGirl..."), curated fallbacks ("fantastic game curated"),
// and unknown dev/publisher labels. Grind/live-enrichment treats these as
// "missing" so the real values replace them.
export function summaryIsPlaceholder(s: string | undefined | null): boolean {
  return (
    !s ||
    /^Available via:|fantastic game curated|unknown description|no description available|no summary|^retro \/ classic title/i.test(
      s
    )
  );
}

export function devIsPlaceholder(s: string | undefined | null): boolean {
  return !s || /unknown (developer|publisher|company|studio)|^unknown$/i.test(s);
}

// Should a game's stored description be replaced by a freshly-pulled one?
// True when the old text is a placeholder, or the new text is substantially
// fuller (Steam's long "About this Game" beats the short blurb).
export function shouldUpgradeSummary(oldS: string | undefined | null, newS: string | undefined | null): boolean {
  if (!newS || !newS.trim()) return false;
  const o = (oldS || "").trim();
  const n = newS.trim();
  if (!o) return true;
  if (summaryIsPlaceholder(oldS)) return true;
  return n.length >= o.length * 1.5 && n.length >= 250;
}

// Much gentler "should this appid be UNassigned?" predicate used by the grind
// to drop dead/stale/mislabeled Steam-app-dump matches. Keeps CJK/non-Latin
// titles (whose Steam names often differ in script), acronym expansions
// (A.I.L.A vs AILA) and subtitle variants; only flags clearly unrelated names.
const COMPAT_STOP_WORDS = new Set([
  "the", "and", "of", "a", "an", "or", "to", "in", "for", "with", "on", "at",
  "s", "edition", "game", "games", "pc", "deluxe", "gog", "steam", "version",
  "dlc", "dlcs", "bundle", "mini", "demo", "chapter", "pack",
]);

export function steamTitleMismatch(gameTitle: string, steamTitle: string | undefined): boolean {
  if (!steamTitle) return true; // app doesn't exist / was removed
  const latinish = (t: string) => /[A-Za-z]{2,}/.test(t);
  if (!latinish(gameTitle) || !latinish(steamTitle)) return false; // CJK/etc: can't token-verify
  const g = normalizeForMatch(gameTitle || "").split(" ");
  const s = normalizeForMatch(steamTitle).split(" ");
  if (g.length === 0 || s.length === 0) return false;
  // Acronym-style titles (A.I.L.A → "a i l a") can't be token-compared safely.
  const hasAcronym = g.some((t) => t.length === 1) || s.some((t) => t.length === 1);
  if (hasAcronym) return false;
  const gT = g.filter((t) => !COMPAT_STOP_WORDS.has(t));
  const sT = s.filter((t) => !COMPAT_STOP_WORDS.has(t));
  if (gT.length === 0 || sT.length === 0) return false;
  if (gT.length === 1 && sT.length === 1) return gT[0] !== sT[0];
  let matched = 0;
  for (const t of gT) if (sT.includes(t)) matched++;
  return matched < 2 || matched / Math.min(gT.length, sT.length) < 0.5;
}

// Normalized game-title → candidate Steam appids. Built once from the local
// full Steam app list so we can fill steamId for every catalog game offline.
function loadSteamAppsIndex(): Map<string, number[]> {
  if (steamAppsIndex) return steamAppsIndex;
  try {
    const raw = JSON.parse(fs.readFileSync(STEAM_APPS_PATH, "utf8")) as {
      applist?: { apps?: { appid: number; name: string }[] };
    };
    const apps = raw?.applist?.apps ?? [];
    const index = new Map<string, number[]>();
    const tokens = new Map<string, Set<string>>();
    const invert = new Map<string, Set<string>>();
    const appName = new Map<number, string>();
    for (const app of apps) {
      if (!app || typeof app?.appid !== "number" || !app.name) continue;
      const key = normalizeForMatch(String(app.name));
      appName.set(app.appid, key);
      if (!key) continue;
      const list = index.get(key);
      if (list) list.push(app.appid);
      else index.set(key, [app.appid]);
      let tk = tokens.get(key);
      if (!tk) {
        tk = tokenizeKey(key);
        tokens.set(key, tk);
      }
      for (const t of tk) {
        let keys = invert.get(t);
        if (!keys) {
          keys = new Set();
          invert.set(t, keys);
        }
        keys.add(key);
      }
    }
    steamAppsIndex = index;
    steamAppsTokens = tokens;
    steamAppsInvert = invert;
    steamAppsAppName = appName;
    console.log(
      `[SteamIndex] Indexed ${apps.length} Steam apps -> ${index.size} normalized titles`
    );
  } catch (e: any) {
    steamAppsIndex = new Map();
    steamAppsTokens = new Map();
    steamAppsInvert = new Map();
    steamAppsAppName = new Map();
    console.warn(
      `[SteamIndex] Failed to load Steam apps index from ${STEAM_APPS_PATH}:`,
      e.message
    );
  }
  return steamAppsIndex;
}

// Fuzzy (token-coverage) match used as a second offline pass for titles that
// didn't normalize-identically (e.g. "X r34294" vs "X", subtitle/edition junk).
// Only returns a candidate when the game's stripped title is dominated by a
// single Steam title, so ambiguous/weak matches stay unassigned.
function fuzzyScan(gameKey: string, candidatesMax = 20000): number | undefined {
  if (!steamAppsIndex || !steamAppsInvert || !steamAppsTokens) return undefined;
  const gameTokens = tokenizeKey(gameKey);
  if (gameTokens.size < 2) return undefined;
  const candidateKeys = new Set<string>();
  for (const t of gameTokens) {
    const keys = steamAppsInvert.get(t);
    if (keys) for (const k of keys) if (k !== gameKey) candidateKeys.add(k);
  }
  if (candidateKeys.size === 0 || candidateKeys.size > candidatesMax) {
    return undefined;
  }
  let bestKey: string | null = null;
  let bestCoverage = 0;
  let bestAppJunk = Infinity;
  for (const key of candidateKeys) {
    const appTokens = steamAppsTokens.get(key);
    if (!appTokens) continue;
    let matched = 0;
    for (const t of gameTokens) if (appTokens.has(t)) matched++;
    const coverage = matched / gameTokens.size;
    if (coverage < 0.7) continue;
    const appJunk = appTokens.size - matched;
    const gameJunk = gameTokens.size - matched;
    // Reject when the app is a much bigger name that merely *contains* the
    // game tokens ("Accident" ⊂ "Plane Accident", "1849" ⊂ "Broadway: 1849")
    // or when the game has a large junk tail that swamps the shared tokens.
    if (appJunk > 1) continue;
    if (gameTokens.size >= 3 && gameJunk > 2) continue;
    // Two-word game keys need a practically clean overlap to stay safe.
    if (gameTokens.size === 2 && (appJunk > 0 || gameJunk > 0)) continue;
    if (
      coverage > bestCoverage ||
      (coverage === bestCoverage && appJunk < bestAppJunk)
    ) {
      bestCoverage = coverage;
      bestAppJunk = appJunk;
      bestKey = key;
    }
  }
  if (bestKey === null) return undefined;
  const ids = steamAppsIndex.get(bestKey);
  return ids && ids.length ? ids[0] : undefined;
}

// Tries the clean key first, then the junk-stripped variant — the two-word
// guard above stays intact so stripping release residue can't create the
// "Baldur's Gate III → BALDUR's GATE" style false positives.
function fuzzySteamMatch(gameKey: string, candidatesMax = 20000): number | undefined {
  const candidates = [gameKey];
  const stripped = stripReleaseJunk(gameKey);
  if (stripped && stripped !== gameKey && tokenizeKey(stripped).size >= 2) {
    candidates.push(stripped);
  }
  for (const key of candidates) {
    const id = fuzzyScan(key, candidatesMax);
    if (id) return id;
  }
  return undefined;
}

const STEAM_COVER = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;
const STEAM_HEADER = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

function applySteamId(g: Game, appid: number): void {
  g.steamId = appid;
  if (!g.coverImage) g.coverImage = STEAM_COVER(appid);
  if (!g.screenshot) g.screenshot = STEAM_HEADER(appid);
}

// Try exact matches (clean + junk-stripped keys), then fuzzy on each.
function resolveBestSteamId(key: string, stripped?: string): number | undefined {
  const keys: string[] = [];
  for (const k of [key, stripped]) {
    if (k && !keys.includes(k)) keys.push(k);
  }
  for (const k of keys) {
    const ids = steamAppsIndex!.get(k);
    if (ids && ids.length > 0) return ids[0];
  }
  for (const k of keys) {
    const id = fuzzySteamMatch(k);
    if (id) return id;
  }
  return undefined;
}

// Fill steamId (+ cover/screenshot when missing) for every non-classic game
// using the local Steam app index instead of hammering the rate-limited API.
export function backfillSteamIds(
  games: Game[]
): { filled: number; already: number; unmatched: number; fuzzy: number } {
  const stat = { filled: 0, already: 0, unmatched: 0, fuzzy: 0 };
  // Load index + fuzzy indexes up-front once.
  loadSteamAppsIndex();
  for (const g of games) {
    if (g.classic || !g.title) continue;
    if (g.steamId) {
      stat.already++;
      continue;
    }
    const key = normalizeForMatch(g.title);
    const stripped = stripReleaseJunk(key);
    const exactHit =
      (key ? steamAppsIndex!.get(key) : undefined) ??
      (stripped ? steamAppsIndex!.get(stripped) : undefined);
    const appid = exactHit?.length
      ? exactHit[0]
      : resolveBestSteamId(key, stripped);
    if (!appid) {
      stat.unmatched++;
      continue;
    }
    applySteamId(g, appid);
    if (!exactHit?.length) stat.fuzzy++;
    stat.filled++;
  }
  return stat;
}

// Offline-first steamId resolution for the whole unmatched backlog, with an
// optional online Steam store-search sweep for the leftovers (the grind uses
// this). `onReachedOnline` lets the caller throttle/measure the online phase.
export async function resolveMissingSteamIds(
  games: Game[],
  opts: {
    online?: boolean;
    onReachedOnline?: (searched: number) => void;
  } = {}
): Promise<{ filled: number; unmatched: number; onlineSearched: number }> {
  const stat = { filled: 0, unmatched: 0, onlineSearched: 0 };
  loadSteamAppsIndex();
  const pending: Game[] = [];
  for (const g of games) {
    if (g.classic || !g.title || g.steamId) continue;
    const key = normalizeForMatch(g.title);
    const stripped = stripReleaseJunk(key);
    const appid = resolveBestSteamId(key, stripped);
    if (appid) {
      applySteamId(g, appid);
      stat.filled++;
    } else {
      pending.push(g);
    }
  }
  if (!opts.online || pending.length === 0) {
    stat.unmatched = pending.length;
    return stat;
  }
  for (const g of pending) {
    const hit = await steamSearchFirstHit(g.title);
    if (hit) {
      applySteamId(g, hit.appid);
      stat.filled++;
    } else {
      stat.unmatched++;
    }
    stat.onlineSearched++;
    if (opts.onReachedOnline) opts.onReachedOnline(stat.onlineSearched);
    await sleep(300);
  }
  return stat;
}

// Repair corrupted/wrong Steam IDs that came from blind store-search hits
// (e.g. "1849" → "Broadway: 1849"). Rules:
//   1. If a title exact-matches a Steam app key and the current id isn't in
//      that key's appid list, replace with the exact id (confident fix).
//   2. Single-token titles whose id's own Steam name doesn't normalize to the
//      title are unassigned (a single game word matching nothing on Steam is
//      ambiguous; better no id than a wrong one). Multi-token mismatches are
//      kept (legit subtitle/edition/colon variants).
export function validateSteamIds(
  games: Game[]
): { fixed: number; unassigned: number; kept: number } {
  const stat = { fixed: 0, unassigned: 0, kept: 0 };
  loadSteamAppsIndex();
  for (const g of games) {
    if (g.classic || !g.title || !g.steamId) continue;
    const key = normalizeForMatch(g.title);
    if (!key) {
      stat.kept++;
      continue;
    }
    const exact = steamAppsIndex!.get(key);
    if (exact && exact.length > 0 && exact.includes(g.steamId)) {
      stat.kept++;
      continue;
    }
    if (exact && exact.length > 0) {
      g.steamId = exact[0];
      if (!g.coverImage || g.coverImage.includes("steamstatic.akamaihd.net")) {
        g.coverImage = STEAM_COVER(g.steamId);
      }
      if (!g.screenshot) g.screenshot = STEAM_HEADER(g.steamId);
      stat.fixed++;
      continue;
    }
    // No exact key. Keep the id: single-token mismatches are as likely to be
    // genuine subtitle/format variants on Steam (ABZÛ, MEMORIA POLIS,
    // PowerSlave Exhumed) as blind-search artifacts, so don't destroy them —
    // the exact-replace path above already cleans every clear-cut case.
    stat.kept++;
    continue;
  }
  return stat;
}

// Pull real metadata (summary/developer/releaseDate/rating/screenshots) for
// games that have a steamId but still lack real Steam details. Paced and
// resumable across boots via the in-memory `metadataTried` set.
const metadataTried = new Set<string>();

export async function enrichCatalogMetadata(
  games: Game[],
  maxItems = 25
): Promise<{ enriched: number; failed: number }> {
  const candidates = games
    .filter(
      (g) =>
        !g.classic &&
        typeof g.steamId === "number" &&
        g.title &&
        (!g.summary || !g.developer || !g.screenshots || g.screenshots.length === 0)
    )
    .filter((g) => !metadataTried.has(g.id))
    .slice(0, maxItems);
  let enriched = 0;
  let failed = 0;

  for (const game of candidates) {
    await sleep(1200);
    try {
      const [details, proton] = await Promise.all([
        fetchSteamDetails(game.steamId as number),
        fetchProtonSummary(game.steamId as number),
      ]);
      if (details.summary) game.summary = details.summary;
      if (details.releaseDate) game.releaseDate = details.releaseDate;
      if (details.developer) game.developer = details.developer;
      if (details.publisher) game.publisher = details.publisher;
      if (details.rating !== undefined && (game.rating === 0 || !game.rating)) {
        game.rating = details.rating;
      }
      if (details.screenshots && details.screenshots.length > 0 && (!game.screenshots || game.screenshots.length === 0)) {
        game.screenshots = details.screenshots;
      }
      game.linux = {
        ...(game.linux || {}),
        native: !!details.linuxNative,
        ...(proton || {}),
      };
      metadataTried.add(game.id);
      if (game.summary) enriched++;
      else failed++;
    } catch (e: any) {
      if (e?.message === "RATE_LIMIT_EXCEEDED") {
        console.warn(
          `[Sync] Steam appdetails rate-limited for "${game.title}"; backing off 10s.`
        );
        await sleep(10000);
        failed++;
        continue; // don't mark tried, so the next sync retries
      }
      metadataTried.add(game.id);
      failed++;
    }
  }
  return { enriched, failed };
}

// ── Main sync ────────────────────────────────────────────────────────────────

export async function syncSources(params: {
  sources: SourceConfig[];
  getCatalog: () => Game[];
  setCatalog: (games: Game[]) => void;
  enrich?: boolean;
  maxEnrich?: number;
}): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const result: SyncResult = {
    startedAt,
    finishedAt: startedAt,
    ok: false,
    sources: [],
    totals: { added: 0, updated: 0, unchanged: 0, totalGames: 0, downloadSourceCount: 0 },
  };

  const catalog = [...params.getCatalog()];

  // A title can be BOTH a retro console dump AND a modern PC release ("God of
  // War" = 2005 PS2 + 2018 PC). The merge index is keyed by era so those two
  // are kept apart: classic-category sources (Redump/No-Intro/RT PS/PSX ROMs)
  // feed the classic bucket, repacker sources the modern bucket. A title with
  // downloads in both buckets yields two separate catalog entries — the retro
  // one stays `classic`, the modern one gets a Steam id/cover like any PC game.
  const categoryOfRepacker = new Map<string, SourceConfig["category"]>();
  for (const s of params.sources) categoryOfRepacker.set(s.name, s.category);
  const eraOfCategory = (cat: string | undefined) =>
    cat === "classic" ? ERA_CLASSIC : ERA_MODERN;
  const eraOfRepacker = (repacker: string | undefined, defaultClassic: boolean) => {
    if (!repacker) return defaultClassic ? ERA_CLASSIC : ERA_MODERN;
    return eraOfCategory(categoryOfRepacker.get(repacker));
  };
  const eraKeyOf = (norm: string, era: string) => `${norm}::${era}`;
  const baseNormOf = (key: string, era: string) => key.slice(0, key.length - 2 - era.length);

  // Seed the merge index with the existing catalog (preserves existing sources,
  // e.g. from an older build). Key: normalizedTitle + era → merged blob.
  const index = new Map<string, MergedKey>();
  const eraByKey = new Map<string, string>();
  const mkMerged = (era: string, game: Game): MergedKey => ({
    cleanTitle: game.title || "",
    sources: new Map<string, DownloadSource>(),
    uploadDate: game.releaseDate || "",
    uploadDateParsed: parseDateToMs(game.releaseDate || ""),
    isClassic: era === ERA_CLASSIC,
    hasSteamId: era === ERA_MODERN && typeof game.steamId === "number",
    platforms: new Set(),
    gogId: game.gogId,
    gogUrl: game.gogUrl,
    developer: game.developer,
    genres: game.genres,
    rating: game.rating,
    releaseDate: game.releaseDate,
  });
  for (const game of catalog) {
    const norm = normalizeForMatch(game.title || "");
    if (!norm) continue;
    const classicSrc: DownloadSource[] = [];
    const modernSrc: DownloadSource[] = [];
    for (const s of game.downloadSources || []) {
      if (!s?.url) continue;
      const era = eraOfRepacker(s.repacker, !!game.classic);
      (era === ERA_CLASSIC ? classicSrc : modernSrc).push(s);
    }
    // Orphan row (no downloads): keep it in its declared era so it survives.
    if (!classicSrc.length && !modernSrc.length) {
      (game.classic ? classicSrc : modernSrc).push(...(game.downloadSources || []));
    }
    for (const [era, srcs] of [
      [ERA_CLASSIC, classicSrc],
      [ERA_MODERN, modernSrc],
    ] as const) {
      if (!srcs.length) continue;
      const key = eraKeyOf(norm, era);
      const merged = index.get(key) ?? mkMerged(era, game);
      for (const s of srcs) merged.sources.set(s.url, s);
      index.set(key, merged);
      eraByKey.set(key, era);
    }
  }

  // Track games that already exist (id → Game) so we can rebuild + compare.
  const existingById = new Map<string, Game>();
  for (const game of catalog) existingById.set(game.id, game);

  for (const source of params.sources) {
    if (!source.enabled) continue;
    try {
      const payload = await fetchSourceJson(source);
      const entries = parseSourcePayload(payload, source.name);
      let addedHere = 0;
      for (const entry of entries) {
        const era = eraOfCategory(source.category);
        const merged = index.get(eraKeyOf(entry.normalizedTitle, era));
        if (merged) {
          for (const src of entry.downloads) {
            // Upsert by URL so a fresh parse (e.g. refreshed gog-games.json with
            // per-link `kind`) refreshes the existing persisted entry too.
            if (!src?.url) continue;
            merged.sources.set(src.url, src);
          }
          if (entry.uploadDateParsed > merged.uploadDateParsed) {
            merged.uploadDate = entry.uploadDate;
            merged.uploadDateParsed = entry.uploadDateParsed;
            if (
              entry.cleanTitle &&
              entry.cleanTitle.length < merged.cleanTitle.length + 20
            ) {
              merged.cleanTitle = entry.cleanTitle;
            }
          }
          // A console-dump source must not re-tag a title that already has a
          // native PC (Steam) release as classic.
          if (source.category === "classic" && !merged.hasSteamId) merged.isClassic = true;
          if (entry.platform) merged.platforms.add(entry.platform);
          if (entry.gogId && !merged.gogId) merged.gogId = entry.gogId;
          if (entry.gogUrl && !merged.gogUrl) merged.gogUrl = entry.gogUrl;
          if (entry.developer && !merged.developer) merged.developer = entry.developer;
          if (entry.releaseDate && !merged.releaseDate) merged.releaseDate = entry.releaseDate;
          if (entry.rating && !merged.rating) merged.rating = entry.rating;
          if (entry.genres?.length) {
            const have = new Set((merged.genres || []).map((g) => g.toLowerCase()));
            const fresh = entry.genres.filter((g) => !have.has(g.toLowerCase()));
            if (fresh.length) merged.genres = [...(merged.genres || []), ...fresh].slice(0, 12);
          }
        } else {
          const merged = {
            cleanTitle: entry.cleanTitle,
            sources: new Map(entry.downloads.map((s) => [s.url, s])),
            uploadDate: entry.uploadDate,
            uploadDateParsed: entry.uploadDateParsed,
            isClassic: source.category === "classic",
            hasSteamId: false,
            platforms: new Set<string>(entry.platform ? [entry.platform] : []),
            gogId: entry.gogId,
            gogUrl: entry.gogUrl,
            developer: entry.developer,
            genres: entry.genres,
            rating: entry.rating,
            releaseDate: entry.releaseDate,
          };
          index.set(eraKeyOf(entry.normalizedTitle, era), merged);
          eraByKey.set(eraKeyOf(entry.normalizedTitle, era), era);
          addedHere++;
        }
      }
      result.sources.push({
        name: source.name,
        category: source.category,
        ok: true,
        rawCount: entries.length,
        uniqueCount: entries.length,
      });
    } catch (e: any) {
      result.sources.push({
        name: source.name,
        category: source.category,
        ok: false,
        rawCount: 0,
        uniqueCount: 0,
        error: e.message,
      });
    }
  }

  // Rebuild the catalog from the merged index.
  let rebuilt: Game[] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let newTitles: Game[] = [];

  // Track rare dual-era titles (same normalized title in both the classic and
  // the modern bucket) so each twin gets a distinct, stable id.
  const dualEraNorms = new Set<string>();
  {
    const seenEra = new Map<string, Set<string>>();
    for (const key of index.keys()) {
      const era = eraByKey.get(key) ?? ERA_MODERN;
      const norm = baseNormOf(key, era);
      const s = seenEra.get(norm) ?? new Set<string>();
      s.add(era);
      seenEra.set(norm, s);
    }
    for (const [norm, eras] of seenEra) {
      if (eras.size > 1) dualEraNorms.add(norm);
    }
  }
  const existingClassicOfId = new Map<string, boolean>();
  for (const game of catalog) existingClassicOfId.set(game.id, !!game.classic);

  for (const [key, merged] of index.entries()) {
    const era = eraByKey.get(key) ?? ERA_MODERN;
    const repackers = Array.from(new Set(
      Array.from(merged.sources.values()).map((s) => s.repacker || "Unknown").filter(Boolean)
    ));
    const base = makeId(merged.cleanTitle);
    // Dual-era twins share the same base title, so they must get different ids.
    // The era of the persisted game (if any) keeps the bare id so existing links
    // keep pointing at that entry; the other twin gets a stable content-derived
    // suffix. Generic new dual-era titles default the classic twin to the bare id.
    let id = base;
    if (dualEraNorms.has(baseNormOf(key, era))) {
      const prior = existingById.get(base);
      const bareEra = prior ? (prior.classic ? ERA_CLASSIC : ERA_MODERN) : ERA_CLASSIC;
      if (era !== bareEra) id = `${base}-${HASH_BASE36(merged.cleanTitle || base)}`;
    }
    const rebuiltGame = buildGame(merged, repackers, id);
    const allExisting = existingById.get(rebuiltGame.id);
    const existing = allExisting && !!allExisting.classic === !!merged.isClassic ? allExisting : undefined;
    if (!existing) {
      newTitles.push(rebuiltGame);
      rebuilt.push(rebuiltGame);
      added++;
      continue;
    }

    // Overlay ONLY merge-derived fields so we never clobber enriched metadata
    // (coverImage, developer, rating, steamId, releaseDate, summary, etc.).
    const mergedGame: Game = {
      ...existing,
      title: merged.cleanTitle && merged.cleanTitle.length <= existing.title.length + 20 ? merged.cleanTitle : existing.title,
      publisher: repackers.join(", "),
      fileSize: rebuiltGame.fileSize || existing.fileSize,
      magnetLink: rebuiltGame.magnetLink || existing.magnetLink,
      stats: {
        ...(existing.stats || { downloads: 0, views: 0, updatedAt: "" }),
        updatedAt: merged.uploadDate > (existing.releaseDate || "") ? merged.uploadDate : existing.stats?.updatedAt || existing.releaseDate || "",
      },
      releaseDate: existing.releaseDate || merged.releaseDate || merged.uploadDate,
      downloadSources: Array.from(merged.sources.values()),
      gogId: existing.gogId || merged.gogId,
      gogUrl: existing.gogUrl || merged.gogUrl,
      developer: (merged.developer && devIsPlaceholder(existing.developer)) ? merged.developer : existing.developer,
      rating: existing.rating || merged.rating || existing.rating,
    };
    if (merged.isClassic) {
      mergedGame.classic = true;
      const extra = consoleGenres(merged.platforms);
      mergedGame.genres = [
        "Classic",
        "Retro",
        ...extra,
        ...(mergedGame.genres || []).filter((g) => g !== "Classic" && g !== "Retro" && !extra.includes(g)),
      ];
    }
    const preInferGenres = mergedGame.genres || [];
    if (merged.genres?.length) {
      const have = new Set(preInferGenres.map((g) => g.toLowerCase()));
      const fresh = merged.genres.filter((g) => !have.has(g.toLowerCase()));
      if (fresh.length) mergedGame.genres = [...preInferGenres, ...fresh].slice(0, 12);
    }
    const inferred = matchGenres(mergedGame.title || "", mergedGame.genres || []);
    const fromSummary = matchGenres(
      mergedGame.summary || "",
      [...(mergedGame.genres || []), ...inferred]
    );
    mergedGame.genres = [...(mergedGame.genres || []), ...inferred, ...fromSummary];

    const changed =
      existing.classic !== mergedGame.classic ||
      existing.publisher !== mergedGame.publisher ||
      existing.fileSize !== mergedGame.fileSize ||
      existing.magnetLink !== mergedGame.magnetLink ||
      existing.developer !== mergedGame.developer ||
      existing.rating !== mergedGame.rating ||
      (existing.downloadSources?.length ?? 0) !== mergedGame.downloadSources?.length ||
      JSON.stringify(existing.downloadSources) !== JSON.stringify(mergedGame.downloadSources) ||
      JSON.stringify(existing.genres || []) !== JSON.stringify(mergedGame.genres || []);

    if (changed) {
      rebuilt.push(mergedGame);
      updated++;
    } else {
      rebuilt.push(existing);
      unchanged++;
    }
  }

  // Collapse duplicate rows + regenerate broken/colliding ids (deterministic).
  const stabilized = stabilizeCatalog(rebuilt);
  rebuilt = stabilized.games;
  if (stabilized.merged > 0 || stabilized.regen > 0) {
    console.log(
      `[Sync] Clean: ${stabilized.merged} duplicate rows merged, ${stabilized.regen} ids regenerated`
    );
  }

  rebuilt.sort((a, b) => a.title.localeCompare(b.title));
  const downloadSourceCount = rebuilt.reduce((n, g) => n + (g.downloadSources?.length || 0), 0);

  // Enrich newly added PC titles with Steam IDs + covers (bounded).
  let enrichResult: { enriched: number; skipped: number } | null = null;
  if (params.enrich && added > 0) {
    enrichResult = await enrichNewGames(newTitles);
  }

  const fill = backfillSteamIds(rebuilt);
  if (fill.filled > 0 || fill.unmatched > 0) {
    console.log(
      `[Sync] Steam IDs: +${fill.filled} filled, ${fill.unmatched} unmatched, ${fill.already} already set`
    );
  }

  const valid = validateSteamIds(rebuilt);
  if (valid.fixed > 0 || valid.unassigned > 0) {
    console.log(
      `[Sync] Steam ID validation: ${valid.fixed} fixed, ${valid.unassigned} unassigned, ${valid.kept} kept`
    );
  }

  let metaResult: { enriched: number; failed: number } | null = null;
  if (params.enrich) {
    metaResult = await enrichCatalogMetadata(rebuilt, 25);
    if (metaResult.enriched > 0 || metaResult.failed > 0) {
      console.log(
        `[Sync] Metadata enrich: +${metaResult.enriched} detailed, ${metaResult.failed} failed/skipped`
      );
    }
  }

  params.setCatalog(rebuilt);
  result.ok = true;
  result.finishedAt = new Date().toISOString();
  result.totals = {
    added,
    updated,
    unchanged,
    totalGames: rebuilt.length,
    downloadSourceCount,
  };
  if (enrichResult) {
    console.log(
      `[Sync] Enriched ${enrichResult.enriched} new titles, ${enrichResult.skipped} unresolved.`
    );
  }
  return result;
}