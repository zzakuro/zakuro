// Load-time normalization for the catalog. These are pure, offline, idempotent
// transforms (no network) applied whenever the catalog is read from disk — by
// the dev server at boot/hot-reload AND by the metadata grind on resume — so
// the fixes both serve instantly and get persisted back to disk on the next
// catalog write.
import { Game } from "../src/types";
import { normalizeSteamDate } from "./metadataService";
import { classifyEra } from "./eraClassify";

// Distinct repacking groups for a game (same logic the build's
// backfill_popularity.py uses): repacker label when present, else source name,
// never counting "Direct"-style mirrors.
function repackerCountFor(g: Game): number {
  const names = new Set<string>();
  for (const s of g.downloadSources || []) {
    const n = (s.repacker || s.name || "").trim();
    if (n && n.toLowerCase() !== "direct") names.add(n);
  }
  return names.size;
}

// Matching backfill_popularity.py's formula: log10(reviewCount+1)*2 + repacker
// count. When reviews are absent, score = distinct repackers only (same as the
// build script's fallback for review-less games). Returns null when the game
// already has a score.
export function popularityScoreFor(g: Game): number | null {
  if (typeof g.popularityScore === "number") return null;
  const repackers = repackerCountFor(g);
  if (g.reviewCount != null) {
    return Math.round((Math.log10(g.reviewCount + 1) * 2 + repackers) * 1000) / 1000;
  }
  return repackers;
}

export function normalizedReleaseDate(d: string | undefined): string | undefined {
  if (!d) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return normalizeSteamDate(d);
}

// A Steam appid means a native PC release, so the game is not a ROM/emulated
// "classic". The console-dump sources (Redump, No-Intro, RT PS) match by title
// and otherwise mis-tag same-named 7th-gen/PC titles (e.g. Alien: Isolation,
// Batman: Arkham City) as classic. Idempotent.
export function normalizeClassicFlag(g: Game): boolean {
  if (!g.classic || typeof g.steamId !== "number") return false;
  g.classic = false;
  if (g.genres?.length) {
    const next = g.genres.filter((x) => x !== "Classic" && x !== "Retro");
    if (next.length !== g.genres.length) g.genres = next;
  }
  return true;
}

export function normalizeGame(g: Game): boolean {
  let changed = false;
  const pop = popularityScoreFor(g);
  if (pop !== null && pop !== g.popularityScore) {
    g.popularityScore = pop;
    changed = true;
  }
  const rd = normalizedReleaseDate(g.releaseDate);
  if (rd && rd !== g.releaseDate) {
    g.releaseDate = rd;
    changed = true;
  }
  if (normalizeClassicFlag(g)) changed = true;
  return changed;
}