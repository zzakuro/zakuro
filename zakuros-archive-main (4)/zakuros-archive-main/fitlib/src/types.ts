export interface GameSystemRequirements {
  os: string;
  processor: string;
  memory: string;
  graphics?: string;
  storage: string;
}

export interface PlatformRequirements {
  minimum: GameSystemRequirements;
  recommended?: GameSystemRequirements;
}

export interface GameRequirements {
  windows?: PlatformRequirements;
  linux?: PlatformRequirements;
  mac?: PlatformRequirements;
}

export interface GameStats {
  downloads: number;
  views: number;
  updatedAt: string;
}

// Linux compatibility: native Steam support and/or ProtonDB tier report.
export interface LinuxSupportInfo {
  native?: boolean; // Steam platforms.linux === true
  tier?: string; // Proton tier: platinum | gold | silver | bronze | borked | pending | unknown
  confidence?: string; // strong | moderate | weak | preliminary | unavailable
  votes?: number; // ProtonDB report voters
}

export interface DownloadSource {
  name: string;
  url: string;
  type?: string;       // "torrent" | "direct" | "magnet"
  repacker?: string;   // e.g. "FitGirl", "DODI", "ElAmigos"
  fileSize?: string;   // repacker-specific size
  uploadDate?: string; // ISO date string
}

export interface Game {
  id: string;
  title: string;
  developer: string;
  publisher: string;
  genres: string[];
  releaseDate: string;
  rating: number;
  fileSize: string;
  magnetLink: string;
  coverImage: string;
 screenshot: string;
  screenshots?: string[];
  summary: string;
  systemRequirements: GameRequirements;
  stats: GameStats;
  steamId?: number;
  igdbId?: number;
  reviewCount?: number;
  popularityScore?: number;
  linux?: LinuxSupportInfo;
  downloadSources?: DownloadSource[];
  classic?: boolean; // retro/classic titles (e.g. PSX ROMs) — used by the Classic filter
}

export interface UserSession {
  username: string;
  role: "User" | "Admin" | "Uploader";
  wishlist: string[]; // game IDs
  liked: string[]; // game IDs
  bookmarks?: string[]; // game IDs
}

export interface GameMetadataExtended {
  title: string;
  summary: string;
  rating: number;
  releaseDate: string;
  developer: string;
  publisher: string;
  screenshots: string[];
  screenshot: string;
  steamDetails?: {
    headerImage?: string;
    background?: string;
    pcSpecs?: string;
  };
  igdbDetails?: {
    storyline?: string;
    videos?: string[];
  };
  linux?: LinuxSupportInfo;
  linuxNative?: boolean; // Steam platforms.linux === true (before merging into linux)
  _ratingReal?: boolean; // true when rating comes from a real source (Metacritic/IGDB), not a placeholder
}

export interface GameComment {
  id: string;
  gameId: string;
  authorKey: string; // "u:<username>" or "v:<visitorId>"
  author: string; // display name
  text: string;
  likes: string[];
  reported: boolean;
  pinned?: boolean;
  parentId?: string;
  createdAt: string;
}

export interface GameRating {
  id: string;
  gameId: string;
  authorKey: string;
  value: number; // 1-5
  platform?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface RatingSummary {
  count: number;
  average: number;
  distribution: Record<number, number>;
  platforms: Record<string, number>;
  mine: { value: number; platform?: string } | null;
}
