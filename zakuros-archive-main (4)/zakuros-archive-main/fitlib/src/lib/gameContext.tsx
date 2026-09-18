import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Game,
  UserSession,
  GameComment,
  RatingSummary,
} from "../types";

// ── Deployment config ────────────────────────────────────────────────────────
// The catalog (games list) and the community API can live on different origins
// so the UI can be served statically while the catalog sits on a CDN and the
// comments/ratings API on a small host. All three default to same-origin.
//   VITE_CATALOG_URL          absolute URL of the games JSON (default /api/games)
//   VITE_CATALOG_VERSION_URL  absolute URL of the tiny version string; set to
//                             "off" to disable change-polling (static catalog)
//   VITE_API_BASE_URL         origin for the comments/ratings API (default "")
const VITE_ENV = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
const API_BASE = String(VITE_ENV.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
const CUSTOM_CATALOG_URL = VITE_ENV.VITE_CATALOG_URL ? String(VITE_ENV.VITE_CATALOG_URL) : "";
const CATALOG_URL = CUSTOM_CATALOG_URL || `${API_BASE}/api/games`;
const CATALOG_VERSION_URL =
  VITE_ENV.VITE_CATALOG_VERSION_URL !== undefined
    ? String(VITE_ENV.VITE_CATALOG_VERSION_URL)
    : CUSTOM_CATALOG_URL
      ? ""
      : `${API_BASE}/api/catalog/version`;
const API = (path: string) => `${API_BASE}${path}`;

// Cookie helper functions
const getCookie = (name: string): string => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return decodeURIComponent(parts.pop()?.split(';').shift() || "");
  return "";
};

const setCookie = (name: string, value: string, days = 365) => {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = `; expires=${date.toUTCString()}`;
  }
  document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/; SameSite=Lax`;
};

interface CatalogSearchParams {
  q?: string;
  limit?: number;
  offset?: number;
  sort?: string;
  genre?: string;
  developer?: string;
  year?: string;
  minRating?: number;
}

interface GameContextType {
  user: UserSession | null;
  games: Game[];
  loading: boolean;
  error: string | null;
  showNSFW: boolean;
  setShowNSFW: (v: boolean) => void;
  nsfwCount: number;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  loginUser: (username: string) => void;
  registerUser: (username: string) => void;
  logoutUser: () => void;
  toggleWishlist: (gameId: string) => void;
  toggleLike: (gameId: string) => void;
  bookmarks: string[];
  toggleBookmark: (gameId: string) => void;
  refreshGames: () => Promise<void>;
  visitorId: string;
  authorKey: string;
  authorName: string;
  searchGames: (params: CatalogSearchParams) => Promise<{ games: Game[]; total: number }>;
  getGameSummary: (gameId: string) => Promise<string>;
  getComments: (gameId: string) => Promise<GameComment[]>;
  addComment: (
    gameId: string,
    text: string,
    parentId?: string
  ) => Promise<GameComment>;
  deleteComment: (gameId: string, commentId: string) => Promise<void>;
  toggleCommentLike: (
    gameId: string,
    commentId: string,
    liked: boolean
  ) => Promise<{ likes: number; liked: boolean }>;
  reportComment: (gameId: string, commentId: string) => Promise<void>;
  getRatings: (gameId: string) => Promise<RatingSummary>;
  submitRating: (
    gameId: string,
    value: number,
    platform?: string
  ) => Promise<RatingSummary>;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSession | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [showNSFW, setShowNSFWRaw] = useState<boolean>(() => localStorage.getItem("zakuro_nsfw") === "1");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [visitorId, setVisitorId] = useState<string>("");

  // Generate/resolve a stable anonymous visitor id (guest identity for community)
  useEffect(() => {
    let vid = localStorage.getItem("zakuro_visitor");
    if (!vid) {
      vid = `guest_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("zakuro_visitor", vid);
    }
    setVisitorId(vid);
  }, []);

  // Persist the NSFW visibility preference (default: hidden)
  useEffect(() => {
    localStorage.setItem("zakuro_nsfw", showNSFW ? "1" : "0");
  }, [showNSFW]);

  const setShowNSFW = useCallback((v: boolean) => setShowNSFWRaw(v), []);

  // NSFW games are hidden by default app-wide; the navbar toggle opts back in.
  // Kept in the context so every surface (rails, grids, search, top genres)
  // respects the same switch automatically.
  const NSFW_GENRES = ["nsfw", "porn", "hentai", "adult"];
  const visibleGames = useMemo(
    () =>
      showNSFW
        ? games
        : games.filter((g) => !(g.genres || []).some((x) => NSFW_GENRES.includes(x.toLowerCase().trim()))),
    [games, showNSFW]
  );
  const nsfwCount = games.length - visibleGames.length;

  const authorKey = user ? `u:${user.username}` : `v:${visitorId}`;
  const authorName = user ? user.username : `Guest`;

  // Community helpers — comment/rating payloads carry the author identity
  const jsonFetch = async (url: string, init?: RequestInit) => {
    const res = await fetch(url.startsWith("/api/") ? API(url) : url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).error ?? `Request failed (${res.status})`);
    }
    return res.json();
  };

  const getComments = useCallback(
    (gameId: string) =>
      jsonFetch(`/api/games/${encodeURIComponent(gameId)}/comments`) as Promise<GameComment[]>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const addComment = useCallback(
    (gameId: string, text: string, parentId?: string) =>
      jsonFetch(`/api/games/${encodeURIComponent(gameId)}/comments`, {
        method: "POST",
        body: JSON.stringify({ text, parentId, authorKey, author: authorName }),
      }) as Promise<GameComment>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authorKey, authorName]
  );

  const deleteComment = useCallback(
    (gameId: string, commentId: string) =>
      jsonFetch(
        `/api/games/${encodeURIComponent(gameId)}/comments/${commentId}?authorKey=${encodeURIComponent(authorKey)}`,
        { method: "DELETE" }
      ) as Promise<void>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authorKey]
  );

  const toggleCommentLike = useCallback(
    (gameId: string, commentId: string, liked: boolean) =>
      jsonFetch(`/api/games/${encodeURIComponent(gameId)}/comments/${commentId}/like`, {
        method: "POST",
        body: JSON.stringify({ authorKey, liked }),
      }) as Promise<{ likes: number; liked: boolean }>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authorKey]
  );

  const reportComment = useCallback(
    (gameId: string, commentId: string) =>
      jsonFetch(`/api/games/${encodeURIComponent(gameId)}/comments/${commentId}/report`, {
        method: "POST",
        body: JSON.stringify({ authorKey }),
      }) as Promise<void>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authorKey]
  );

  const getRatings = useCallback(
    (gameId: string) =>
      jsonFetch(
        `/api/games/${encodeURIComponent(gameId)}/ratings?authorKey=${encodeURIComponent(authorKey)}`
      ) as Promise<RatingSummary>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authorKey]
  );

  const submitRating = useCallback(
    (gameId: string, value: number, platform?: string) =>
      jsonFetch(`/api/games/${encodeURIComponent(gameId)}/ratings`, {
        method: "POST",
        body: JSON.stringify({ value, platform, authorKey, author: authorName }),
      }) as Promise<RatingSummary>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authorKey, authorName]
  );

  // Detail-only fields (notably summary) are omitted from the list payload to
  // keep the catalog small; hydrate them lazily per game and cache in memory.
  const summaryCache = useRef<Map<string, string>>(new Map());
  const summaryInflight = useRef<Map<string, Promise<string>>>(new Map());
  const getGameSummary = useCallback((gameId: string): Promise<string> => {
    const cached = summaryCache.current.get(gameId);
    if (cached !== undefined) return Promise.resolve(cached);
    const inflight = summaryInflight.current.get(gameId);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        const data = (await jsonFetch(API(`/api/games/${encodeURIComponent(gameId)}/summary`))) as {
          summary?: string;
        };
        const summary = typeof data?.summary === "string" ? data.summary : "";
        summaryCache.current.set(gameId, summary);
        return summary;
      } catch {
        summaryCache.current.set(gameId, "");
        return "";
      } finally {
        summaryInflight.current.delete(gameId);
      }
    })();
    summaryInflight.current.set(gameId, p);
    return p;
  }, []);

  const searchGames = useCallback(async (params: CatalogSearchParams) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const res = await fetch(`${API_BASE}/api/games?${qs.toString()}`);
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const data = await res.json();
    return { games: data.games ?? [], total: data.total ?? 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load bookmarks from cookie (and local profile state) on mount
  useEffect(() => {
    const savedBookmarks = getCookie("zakuro_bookmarks");
    if (savedBookmarks) {
      try {
        setBookmarks(JSON.parse(savedBookmarks));
      } catch (e) {
        console.warn("Failed parsing bookmarks from cookie");
      }
    } else {
      const savedUser = localStorage.getItem("zakuro_user");
      if (savedUser) {
        try {
          const parsed = JSON.parse(savedUser);
          if (parsed.bookmarks) {
            setBookmarks(parsed.bookmarks);
            setCookie("zakuro_bookmarks", JSON.stringify(parsed.bookmarks), 365);
          }
        } catch (e) {}
      }
    }
  }, []);

  // Load User from LocalStorage on mount
  useEffect(() => {
    const savedUser = localStorage.getItem("zakuro_user");
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser) as UserSession;
        setUser(parsed);
        if (parsed.bookmarks) {
          setBookmarks(parsed.bookmarks);
          setCookie("zakuro_bookmarks", JSON.stringify(parsed.bookmarks), 365);
        }
      } catch (e) {
        localStorage.removeItem("zakuro_user");
      }
    }
  }, []);

  // Fetch games — tries backend API first, then falls back to a local JSON database.
  // To use a custom JSON file: set VITE_GAMES_JSON in your .env (e.g. VITE_GAMES_JSON=/mydb.json)
  // The file must be placed in the /public folder and match the Game[] schema.
  const fetchGamesFromBackend = async () => {
    setLoading(true);

    // 1. Try the catalog endpoint (backend API by default, or a remote URL)
    try {
      const res = await fetch(CATALOG_URL);
      if (res.ok) {
        const data = await res.json();
        const games: Game[] = Array.isArray(data) ? data : (data.games ?? []);
        setGames(games);
        setError(null);
        setLoading(false);
        return;
      }
    } catch {
      // Backend unavailable — fall through to JSON
    }

    // 2. Fall back to a local JSON database file
    const jsonPath: string =
      (import.meta as any).env?.VITE_GAMES_JSON ?? "/games.json";

    try {
      console.info(`[Zakuro's Archive] Backend offline — loading JSON database: ${jsonPath}`);
      const res = await fetch(jsonPath);
      if (!res.ok) {
        throw new Error(`JSON database not found at "${jsonPath}" (Status: ${res.status})`);
      }
      const data: Game[] = await res.json();
      if (!Array.isArray(data)) {
        throw new Error(`JSON database at "${jsonPath}" must export a top-level array of games.`);
      }
      setGames(data);
      setError(null);
    } catch (err: any) {
      console.error("[Zakuro's Archive] Failed to load JSON database:", err);
      setGames([]);
      setError(err.message ?? "Failed to load game catalog.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGamesFromBackend();
  }, []);

  // Light poll: ask the backend for a tiny catalog version string and only
  // re-download the (large) catalog when it actually changed. This replaces
  // the old behaviour of re-fetching the entire catalog every few minutes.
  useEffect(() => {
    // No version endpoint (e.g. a static catalog) — nothing to poll.
    if (!CATALOG_VERSION_URL) return;
    let lastVersion: string | null = null;
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch(CATALOG_VERSION_URL);
        if (!res.ok) return;
        const { version } = await res.json();
        if (typeof version !== "string") return;
        if (lastVersion === null) {
          lastVersion = version;
          return;
        }
        if (version === lastVersion) return;
        lastVersion = version;
        const g = await fetch(CATALOG_URL);
        if (!g.ok) return;
        const data = await g.json();
        if (stopped) return;
        const next: Game[] = Array.isArray(data) ? data : (data.games ?? []);
        setGames(next);
        setError(null);
      } catch {
        // backend offline; keep current data
      }
    }, 180000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loginUser = (username: string) => {
    let savedBookmarks: string[] = [];
    const cookieBms = getCookie("zakuro_bookmarks");
    if (cookieBms) {
      try {
        savedBookmarks = JSON.parse(cookieBms);
      } catch (e) {}
    }

    const freshUser: UserSession = {
      username,
      role: "User",
      wishlist: [],
      liked: [],
      bookmarks: savedBookmarks,
    };
    // Sync with existing saved preferences if available
    const savedKeys = localStorage.getItem(`zakuro_prefs_${username}`);
    if (savedKeys) {
      try {
        const parsed = JSON.parse(savedKeys);
        freshUser.wishlist = parsed.wishlist || [];
        freshUser.liked = parsed.liked || [];
        if (parsed.bookmarks && parsed.bookmarks.length > 0) {
          const combined = Array.from(new Set([...savedBookmarks, ...parsed.bookmarks]));
          freshUser.bookmarks = combined;
          setBookmarks(combined);
          setCookie("zakuro_bookmarks", JSON.stringify(combined), 365);
        }
      } catch (e) {}
    } else {
      setBookmarks(savedBookmarks);
    }
    setUser(freshUser);
    localStorage.setItem("zakuro_user", JSON.stringify(freshUser));
  };

  const registerUser = (username: string) => {
    // Treat register as login
    loginUser(username);
  };

  const logoutUser = () => {
    setUser(null);
    localStorage.removeItem("zakuro_user");
  };

  const toggleWishlist = (gameId: string) => {
    if (!user) return;
    const isWishlisted = user.wishlist.includes(gameId);
    const updatedWishlist = isWishlisted
      ? user.wishlist.filter((id) => id !== gameId)
      : [...user.wishlist, gameId];

    const updatedUser: UserSession = {
      ...user,
      wishlist: updatedWishlist,
    };
    setUser(updatedUser);
    localStorage.setItem("zakuro_user", JSON.stringify(updatedUser));
    localStorage.setItem(`zakuro_prefs_${user.username}`, JSON.stringify({
      wishlist: updatedWishlist,
      liked: user.liked,
      bookmarks: bookmarks,
    }));
  };

  const toggleLike = (gameId: string) => {
    if (!user) return;
    const isLiked = user.liked.includes(gameId);
    const updatedLiked = isLiked
      ? user.liked.filter((id) => id !== gameId)
      : [...user.liked, gameId];

    const updatedUser: UserSession = {
      ...user,
      liked: updatedLiked,
    };
    setUser(updatedUser);
    localStorage.setItem("zakuro_user", JSON.stringify(updatedUser));
    localStorage.setItem(`zakuro_prefs_${user.username}`, JSON.stringify({
      wishlist: user.wishlist,
      liked: updatedLiked,
      bookmarks: bookmarks,
    }));
  };

  const toggleBookmark = (gameId: string) => {
    setBookmarks((prev) => {
      const isBookmarked = prev.includes(gameId);
      const updated = isBookmarked ? prev.filter((id) => id !== gameId) : [...prev, gameId];
      
      // Save in cookie (365 days)
      setCookie("zakuro_bookmarks", JSON.stringify(updated), 365);
      
      // Also sync to localStorage
      localStorage.setItem("zakuro_bookmarks", JSON.stringify(updated));

      // If user is logged in, also sync into local user profile state!
      if (user) {
        const updatedUser: UserSession = {
          ...user,
          bookmarks: updated,
        };
        setUser(updatedUser);
        localStorage.setItem("zakuro_user", JSON.stringify(updatedUser));
        localStorage.setItem(`zakuro_prefs_${user.username}`, JSON.stringify({
          wishlist: user.wishlist,
          liked: user.liked,
          bookmarks: updated,
        }));
      }
      return updated;
    });
  };

  return (
    <GameContext.Provider
      value={{
        user,
        games: visibleGames,
        loading,
        error,
        showNSFW,
        setShowNSFW,
        nsfwCount,
        searchQuery,
        setSearchQuery,
        loginUser,
        registerUser,
        logoutUser,
        toggleWishlist,
        toggleLike,
        bookmarks,
        toggleBookmark,
        refreshGames: fetchGamesFromBackend,
        visitorId,
        authorKey,
        authorName,
        searchGames,
        getGameSummary,
        getComments,
        addComment,
        deleteComment,
        toggleCommentLike,
        reportComment,
        getRatings,
        submitRating,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (context === undefined) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
};
