// Era classification for the catalog: decide whether a game is a retro/classic
// title or a modern/new one, using only offline evidence (platform genres,
// Steam presence, PC genres). This is the single source of truth behind:
//   • normalizeClassicFlag (boot normalization + sync self-heal)
//   • the era chip on cards (server.ts toCardGame)
//   • the retro:audit report + bake (server/retroAudit.ts)
//
// Platform is authoritative because ROM-dump feeds carry their console platform
// as a genre (e.g. "PS1", "PS2", "SNES" on classic twins, "PS3"/"Xbox 360" on
// 7th-gen titles), while `releaseDate` on those rows is often just the upload
// date and therefore NOT reliable as an era signal.

export interface EraInfo {
  era: "retro" | "modern";
  year?: number;
  platform?: string;
  evidence: string;
}

interface PlatformEntry {
  display: string;
  era: "retro" | "modern";
}

// Console generations. Retro = console era through the PS2/Xbox/GameCube
// generation plus old handhelds (NES..PSP/DS). Modern = 7th gen onward
// (PS3/360/Wii/3DS/Vita) plus everything since.
const PLATFORM_MAP: Record<string, PlatformEntry> = {
  // Retro consoles & handhelds
  nes: { display: "NES", era: "retro" },
  snes: { display: "SNES", era: "retro" },
  n64: { display: "N64", era: "retro" },
  gb: { display: "GB", era: "retro" },
  gbc: { display: "GBC", era: "retro" },
  gba: { display: "GBA", era: "retro" },
  gg: { display: "Game Gear", era: "retro" },
  ps1: { display: "PS1", era: "retro" },
  psx: { display: "PSX", era: "retro" },
  pson: { display: "PS1", era: "retro" },
  ps2: { display: "PS2", era: "retro" },
  psp: { display: "PSP", era: "retro" },
  ds: { display: "DS", era: "retro" },
  dreamcast: { display: "Dreamcast", era: "retro" },
  saturn: { display: "Saturn", era: "retro" },
  megadrive: { display: "Mega Drive", era: "retro" },
  genesis: { display: "Genesis", era: "retro" },
  pce: { display: "PCE", era: "retro" },
  msx: { display: "MSX", era: "retro" },
  neogeo: { display: "Neo Geo", era: "retro" },
  gamecube: { display: "GameCube", era: "retro" },
  xbox: { display: "Xbox", era: "retro" }, // original Xbox (2001)
  // Modern (7th generation onward)
  ps3: { display: "PS3", era: "modern" },
  ps4: { display: "PS4", era: "modern" },
  ps5: { display: "PS5", era: "modern" },
  xbox360: { display: "Xbox 360", era: "modern" },
  xboxone: { display: "Xbox One", era: "modern" },
  wii: { display: "Wii", era: "modern" },
  wiiu: { display: "Wii U", era: "modern" },
  switch: { display: "Switch", era: "modern" },
  "3ds": { display: "3DS", era: "modern" },
  psvita: { display: "PS Vita", era: "modern" },
};

const PC_GENRE_KEYS = new Set(["pcgame", "windows", "pc", "steamos", "microsooftwindows"]);

function genreKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&|and|\.|\/| |-/g, "")
    .trim();
}

export function yearOfGame(g: { releaseDate?: string }): number | undefined {
  const d = g.releaseDate;
  if (!d) return undefined;
  const m = /(\d{4})/.exec(d);
  if (!m) return undefined;
  const y = Number(m[1]);
  if (y < 1970 || y > 2100) return undefined;
  return y;
}

// Extract the first platform mentioned in the game's genres (current classic
// bias first if `preferRetro` is set, which is the display behaviour: a game
// tagged classic shows the retro platform it was dumped from).
export function platformOfGame(g: { genres?: string[] }, preferRetro = false): string | undefined {
  let first: PlatformEntry | undefined;
  let retro: PlatformEntry | undefined;
  for (const raw of g.genres || []) {
    const entry = PLATFORM_MAP[genreKey(raw)];
    if (!entry) continue;
    if (!first) first = entry;
    if (entry.era === "retro" && !retro) retro = entry;
  }
  if (preferRetro && retro) return retro.display;
  return first?.display;
}

export function hasPCGenre(g: { genres?: string[] }): boolean {
  return (g.genres || []).some((raw) => PC_GENRE_KEYS.has(genreKey(raw)));
}

interface GameLike {
  classic?: boolean;
  steamId?: number;
  genres?: string[];
  releaseDate?: string;
}

// The evidence ordering that matters:
//   1. native PC (Steam appid)     → modern, always
//   2. a retro-consoles genre       → retro (even if a 7th-gen genre also appears)
//   3. a modern-consoles genre      → modern
//   4. a PC/windows genre           → modern
//   5. no evidence                  → preserve the existing label
export function classifyEra(g: GameLike): EraInfo {
  const year = yearOfGame(g);
  let retro: PlatformEntry | undefined;
  let modern: PlatformEntry | undefined;
  for (const raw of g.genres || []) {
    const entry = PLATFORM_MAP[genreKey(raw)];
    if (!entry) continue;
    if (entry.era === "retro" && !retro) retro = entry;
    else if (entry.era === "modern" && !modern) modern = entry;
  }

  if (typeof g.steamId === "number") {
    return {
      era: "modern",
      year,
      platform: retro?.display ?? modern?.display,
      evidence: "Steam appid — native PC release",
    };
  }
  if (retro) {
    return { era: "retro", year, platform: retro.display, evidence: `${retro.display} — retro-generation console` };
  }
  if (modern) {
    return { era: "modern", year, platform: modern.display, evidence: `${modern.display} — 7th-gen+ console, not retro` };
  }
  if (hasPCGenre(g)) {
    return { era: "modern", year, platform: "PC", evidence: "PC release" };
  }
  return {
    era: g.classic ? "retro" : "modern",
    year,
    platform: undefined,
    evidence: "no era evidence — preserved existing label",
  };
}