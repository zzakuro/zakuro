import fs from "fs";
import path from "path";
import { Game } from "../src/types";

export interface CuratedCollectionConfig {
  id: string;
  name: string;
  description?: string;
  cover?: string;
  badge?: string;
  match?: {
    keys?: string[];     // normalized series key prefixes (e.g. "grand theft auto", "gta")
    search?: string[];   // raw title substrings (case-insensitive)
    games?: string[];    // explicit game IDs
    exclude?: string[];  // game IDs to exclude
  };
}

export interface SeriesSummary {
  id: string;
  name: string;
  description?: string;
  count: number;
  covers: string[];
  curated?: boolean;
  badge?: string;
}

export interface SeriesGroup {
  id: string;
  name: string;
  description?: string;
  curated?: boolean;
  badge?: string;
  games: Game[];
}

const COLLECTIONS_CONFIG_PATH = path.join(process.cwd(), "data", "collections.json");

const ROMAN_NUMERAL_REGEX =
  /\s+(xl|xlv|liv|lv|xlix|lix|lx|l|li{0,3}|iv|v|vi{0,3}|ix|x[ivxl]{0,3}|i{1,3})\s*$/i;

const EDITION_NOISE_REGEX =
  /\s*(editions?|collections?|collector[s']?s edition|game of the year|goty|complete|deluxe|gold|ultimate|premium|remaster(ed)?|definitive|hd|anniversary|unofficial|repack|backday|multi)\s*$/i;

/**
 * Normalize title into a franchise/series key.
 * e.g. "Grand Theft Auto: San Andreas (v1.0)" -> "grand theft auto"
 *      "Grand Theft Auto III" -> "grand theft auto"
 *      "Need for Speed: Most Wanted" -> "need for speed"
 */
export function normalizeSeriesKey(title: string): string | null {
  if (!title) return null;
  let t = title.toLowerCase();

  // Strip parenthetical/bracketed content
  t = t.replace(/\([^)]*\)/g, " ");
  t = t.replace(/\[[^\]]*\]/g, " ");
  t = t.replace(/\{[^}]*\}/g, " ");
  // Cut from any unclosed/truncated paren or bracket
  t = t.replace(/[([{\[].*$/, " ");
  // Strip URLs
  t = t.replace(/http\S+|www\.\S+/g, " ");

  // Cut subtitle at colon / em-dash / en-dash if present
  const colonIdx = t.search(/[:\u2013\u2014]/);
  if (colonIdx !== -1) {
    t = t.slice(0, colonIdx);
  }

  // Replace punctuation/separators with space
  t = t.replace(/[\s\-_/&|+.,;•~`!@#$%^*=<>?/\\]+/g, " ");
  t = t.replace(/\s{2,}/g, " ").trim();

  // Strip leading "the "
  t = t.replace(/^the\s+/, "");

  // Strip trailing numbers (e.g. 1, 2, 3, 2004)
  t = t.replace(/\s+\d+(\.\d+)*\s*$/, "");
  // Strip trailing Roman numerals (I, II, III, IV, V, etc.)
  t = t.replace(ROMAN_NUMERAL_REGEX, "");
  // Strip trailing edition words
  t = t.replace(EDITION_NOISE_REGEX, "");

  t = t.trim();
  if (t.length < 3) return null;
  return t;
}

/**
 * Format a series key into a human-friendly display name.
 */
function toDisplayName(key: string): string {
  return key
    .split(" ")
    .map((word) => {
      if (["gta", "rpg", "fps", "vr", "mmo", "wwe", "nba", "nfl", "nhl", "fifa", "f1", "pga"].includes(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Generate a URL-safe slug from a series key or name.
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Load curated collections configuration from data/collections.json.
 */
export function readCuratedCollections(): CuratedCollectionConfig[] {
  try {
    if (!fs.existsSync(COLLECTIONS_CONFIG_PATH)) return [];
    const content = fs.readFileSync(COLLECTIONS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    console.error("[Series] Failed to read collections config:", err.message);
    return [];
  }
}

/**
 * Build the full series groups mapping and summary list.
 */
export function buildSeriesCatalog(
  games: Game[],
  curatedConfigs: CuratedCollectionConfig[]
): {
  groups: Map<string, SeriesGroup>;
  index: SeriesSummary[];
} {
  const groups = new Map<string, SeriesGroup>();
  const autoBuckets = new Map<string, Game[]>();

  // 1. Group all games by normalized series key
  for (const game of games) {
    const key = normalizeSeriesKey(game.title);
    if (!key) continue;
    let list = autoBuckets.get(key);
    if (!list) {
      list = [];
      autoBuckets.set(key, list);
    }
    list.push(game);
  }

  // 2. Track which games and auto-keys are claimed by curated collections
  const claimedAutoKeys = new Set<string>();
  const gameToCuratedId = new Map<string, string>();

  // 3. Process curated collections first
  for (const config of curatedConfigs) {
    const matchedGames = new Map<string, Game>();
    const excludeSet = new Set(config.match?.exclude || []);

    // Match by explicit IDs
    if (config.match?.games) {
      for (const gid of config.match.games) {
        const found = games.find((g) => g.id === gid);
        if (found && !excludeSet.has(found.id)) {
          matchedGames.set(found.id, found);
        }
      }
    }

    // Match by normalized key prefixes
    if (config.match?.keys) {
      for (const prefix of config.match.keys) {
        const pLower = prefix.toLowerCase().trim();
        for (const [autoKey, bucket] of autoBuckets.entries()) {
          if (autoKey === pLower || autoKey.startsWith(pLower + " ") || autoKey.startsWith(pLower)) {
            claimedAutoKeys.add(autoKey);
            for (const g of bucket) {
              if (!excludeSet.has(g.id)) {
                matchedGames.set(g.id, g);
              }
            }
          }
        }
      }
    }

    // Match by raw title search substrings
    if (config.match?.search) {
      for (const sub of config.match.search) {
        const sLower = sub.toLowerCase();
        for (const g of games) {
          if (g.title.toLowerCase().includes(sLower) && !excludeSet.has(g.id)) {
            matchedGames.set(g.id, g);
          }
        }
      }
    }

    const gameList = Array.from(matchedGames.values());
    if (gameList.length > 0) {
      // Sort games by rating / release date / popularity
      gameList.sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0));
      groups.set(config.id, {
        id: config.id,
        name: config.name,
        description: config.description,
        curated: true,
        badge: config.badge || "FEATURED",
        games: gameList,
      });

      for (const g of gameList) {
        gameToCuratedId.set(g.id, config.id);
      }
    }
  }

  // 4. Create auto-series for any unmerged groups with >= 2 games
  for (const [autoKey, bucket] of autoBuckets.entries()) {
    if (claimedAutoKeys.has(autoKey)) continue;
    if (bucket.length < 2) continue;

    const slug = slugify(autoKey);
    // Don't overwrite curated collection if slug collides
    if (groups.has(slug)) continue;

    // Filter out games that were already curated into another collection
    const uncuratedGames = bucket.filter((g) => !gameToCuratedId.has(g.id));
    if (uncuratedGames.length < 2) continue;

    uncuratedGames.sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0));

    groups.set(slug, {
      id: slug,
      name: toDisplayName(autoKey),
      curated: false,
      games: uncuratedGames,
    });
  }

  // 5. Generate index summary
  const index: SeriesSummary[] = [];
  for (const group of groups.values()) {
    const covers: string[] = [];
    for (const g of group.games) {
      if (g.coverImage && !covers.includes(g.coverImage)) {
        covers.push(g.coverImage);
        if (covers.length >= 4) break;
      }
    }

    index.push({
      id: group.id,
      name: group.name,
      description: group.description,
      count: group.games.length,
      covers,
      curated: group.curated,
      badge: group.badge,
    });
  }

  // Sort index: curated first (by count desc), then auto-series by count desc
  index.sort((a, b) => {
    if (a.curated && !b.curated) return -1;
    if (!a.curated && b.curated) return 1;
    return b.count - a.count;
  });

  return { groups, index };
}
