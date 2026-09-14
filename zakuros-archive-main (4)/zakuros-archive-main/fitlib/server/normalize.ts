// Load-time normalization for the catalog. These are pure, offline, idempotent
// transforms (no network) applied whenever the catalog is read from disk — by
// the dev server at boot/hot-reload AND by the metadata grind on resume — so
// the fixes both serve instantly and get persisted back to disk on the next
// catalog write.
import { Game } from "../src/types";
import { normalizeSteamDate } from "./metadataService";

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
  return changed;
}