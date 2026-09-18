import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Search, User, LogOut, X, TrendingUp, CornerDownLeft, ChevronDown, Eye, EyeOff } from "lucide-react";
import { useGame } from "../lib/gameContext";
import { Game } from "../types";
import { motion, AnimatePresence } from "motion/react";
import ThemeSwitcher from "./ThemeSwitcher";

const NSFW_GENRES = ["nsfw", "porn", "hentai", "adult", "eroge", "erotic"];

/* ------------------------------------------------------------------ */
/*  Search overlay — Cracked-Games style command palette for games.    */
/* ------------------------------------------------------------------ */
const SearchOverlay: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { games, setSearchQuery, serverBrowse, searchGames, totalGames, showNSFW } = useGame();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [serverResults, setServerResults] = useState<Game[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Server-browse: debounce the query and hit the search API instead of the
  // (partial) in-memory slice.
  useEffect(() => {
    if (!serverBrowse) return;
    const q = query.trim();
    if (!q) {
      setServerResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      searchGames({ q, limit: 8, nsfw: true })
        .then((r) => alive && setServerResults(r.games))
        .catch(() => alive && setServerResults([]));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, serverBrowse, searchGames]);

  const trending = useMemo(
    () => [...games].sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0)).slice(0, 6),
    [games]
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    if (serverBrowse) {
      const pool = showNSFW
        ? serverResults
        : serverResults.filter(
            (g) => !(g.genres || []).some((x) => NSFW_GENRES.includes(x.toLowerCase().trim()))
          );
      return pool.slice(0, 8);
    }
    return games
      .filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          g.developer.toLowerCase().includes(q) ||
          g.genres.some((x) => x.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [query, games, serverBrowse, serverResults, showNSFW]);

  const goToGame = (g: Game) => {
    setSearchQuery("");
    onClose();
    navigate(`/game/${g.id}`);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(query);
    onClose();
    navigate(`/browse?q=${encodeURIComponent(query)}`);
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]">
          <motion.button
            aria-label="Close search"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-black/80 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d10] shadow-2xl shadow-black"
          >
            <form onSubmit={submit} className="flex items-center gap-3 border-b border-white/10 px-5">
              <Search className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search games, genres, developers…"
                className="h-14 flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="rounded-full p-1 text-zinc-500 hover:text-white transition"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <kbd className="hidden rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 sm:block">
                ESC
              </kbd>
            </form>

            <div className="max-h-[420px] overflow-y-auto">
              {query.trim() ? (
                results.length > 0 ? (
                  <div className="p-2">
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 font-mono">
                        Results
                      </span>
                      <span className="text-[10px] font-mono text-zinc-600">{results.length} shown</span>
                    </div>
                    <ul className="space-y-0.5">
                      {results.map((g) => (
                        <li key={g.id}>
                          <button
                            onClick={() => goToGame(g)}
                            className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/5 transition"
                          >
                            {g.coverImage ? (
                              <span className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-zinc-900 ring-1 ring-white/5">
                                <img
                                  src={g.coverImage}
                                  alt=""
                                  referrerPolicy="no-referrer"
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                  onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0")}
                                />
                              </span>
                            ) : null}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-white">{g.title}</span>
                              <span className="block truncate text-[11px] text-zinc-500">
                                {g.genres[0] ?? "Game"}
                                {g.fileSize ? ` · ${g.fileSize}` : ""}
                              </span>
                            </span>
                            <span className="flex items-center gap-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-bold text-zinc-400">
                              <span className="text-rose-400">{g.rating}%</span>
                              <span className="hidden sm:inline text-zinc-600">rating</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={submit}
                      className="mt-2 flex w-full items-center justify-between rounded-xl border border-white/5 px-4 py-2.5 text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition"
                    >
                      <span className="font-mono">
                        Search catalog for <span className="text-rose-400">"{query.trim()}"</span>
                      </span>
                      <CornerDownLeft className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="px-5 py-10 text-center">
                    <p className="text-sm text-zinc-400">No matches for "{query}"</p>
                    <button
                      onClick={submit}
                      className="mt-3 rounded-full border border-white/10 px-4 py-1.5 text-xs text-zinc-300 hover:text-white hover:border-rose-500/40 transition"
                    >
                      Browse catalog instead
                    </button>
                  </div>
                )
              ) : (
                <div className="p-4">
                  <div className="flex items-center gap-1.5 px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 font-mono">
                    <TrendingUp className="h-3 w-3" /> Trending now
                  </div>
                  <div className="flex flex-wrap gap-2 px-3 pb-3">
                    {trending.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => goToGame(g)}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 hover:border-rose-500/40 hover:text-white transition"
                      >
                        {g.title}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={submit}
                    className="mx-3 flex w-[calc(100%-24px)] items-center justify-center gap-2 rounded-xl border border-white/5 bg-black/30 px-4 py-2.5 text-xs font-bold text-zinc-300 hover:text-white transition font-mono"
                  >
                    <Search className="h-3.5 w-3.5 text-rose-400" />
                    Full library — {(serverBrowse ? totalGames : games.length).toLocaleString()} games
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

/* ------------------------------------------------------------------ */
/*  Navbar                                                             */
/* ------------------------------------------------------------------ */
export const Navbar: React.FC = () => {
  const { games, user, logoutUser, nsfwCount, showNSFW, setShowNSFW, serverBrowse, getFacets } =
    useGame();
  const [facetGenres, setFacetGenres] = useState<[string, number][] | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [genresOpen, setGenresOpen] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  const navItems = [
    { label: "Games", path: "/browse" },
    { label: "Sources", path: "/sources" },
    { label: "Donate", path: "/donate", highlighted: true },
  ];

  // Server-browse: the genre dropdown needs whole-catalog counts, not the slice.
  useEffect(() => {
    if (!serverBrowse) return;
    let alive = true;
    getFacets()
      .then((f) => {
        if (alive) setFacetGenres(f.genres.slice(0, 14).map((g) => [g.name, g.count] as [string, number]));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [serverBrowse, getFacets]);

  const topGenres = useMemo(() => {
    if (serverBrowse && facetGenres) return facetGenres;
    const map = new Map<string, number>();
    games.forEach((g) => (g.genres || []).forEach((x) => map.set(x, (map.get(x) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [games, serverBrowse, facetGenres]);

  const goBrowser = (genre: string) => {
    setGenresOpen(false);
    if (genre) {
      navigate(`/browse?genre=${encodeURIComponent(genre)}`);
    } else {
      navigate(`/browse`);
    }
  };

  // Global Ctrl/Cmd+K shortcut opens the search overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the genres dropdown on any navigation
  useEffect(() => {
    setGenresOpen(false);
  }, [location.pathname, location.search]);

  // Shrink + reading-progress bar while scrolling
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 8);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(max > 0 ? Math.min(1, Math.max(0, y / max)) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full">
      {/* Reading progress — a hairline along the very top of the viewport */}
      <span
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-gradient-to-r from-rose-500 via-rose-400 to-transparent"
        style={{ transform: `scaleX(${scrollProgress})` }}
      />

      {/* Floating glass pill nav — the site chrome in one seated capsule */}
      <div className="mx-auto flex w-full max-w-[1200px] items-center gap-3 px-3 pt-4 pb-1 sm:px-5">
        <div
          className={`flex h-12 w-full items-center justify-between gap-2 rounded-full border bg-[#0a0a0c]/85 px-2.5 backdrop-blur-2xl transition-all duration-300 sm:gap-3 sm:px-3 ${
            scrolled
              ? "border-white/10 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.85)]"
              : "border-white/[0.07] shadow-[0_8px_30px_-16px_rgba(0,0,0,0.6)]"
          }`}
        >
          {/* Brand */}
          <Link to="/" className="flex items-center gap-2.5 rounded-full pr-1 transition hover:opacity-90">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-700 text-sm font-black text-white shadow-lg shadow-rose-500/25">
              Z
            </span>
            <span className="hidden font-display text-sm font-bold tracking-widest text-white md:block">
              ZAKURO'S<span className="text-rose-400"> ARCHIVE</span>
            </span>
          </Link>

          {/* Nav center */}
          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive =
                location.pathname === item.path ||
                (item.path !== "/" && location.pathname.startsWith(item.path));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`relative rounded-full px-3.5 py-1.5 text-sm transition ${
                    item.highlighted
                      ? "font-bold text-rose-400 hover:text-rose-300"
                      : isActive
                      ? "text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 -z-10 rounded-full bg-white/[0.06] ring-1 ring-white/10"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  {item.label}
                </Link>
              );
            })}

            {/* Genres dropdown */}
            <div className="relative">
              <button
                onClick={() => setGenresOpen((v) => !v)}
                className={`relative flex items-center gap-1 rounded-full px-3.5 py-1.5 text-sm transition ${
                  genresOpen ? "text-white" : "text-zinc-400 hover:text-white"
                }`}
              >
                Genres
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${genresOpen ? "rotate-180" : ""}`}
                />
                {genresOpen && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 -z-10 rounded-full bg-white/[0.06] ring-1 ring-white/10"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </button>

              <AnimatePresence>
                {genresOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setGenresOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute left-1/2 mt-2 z-20 w-72 -translate-x-1/2 rounded-2xl border border-white/10 bg-[#101013] p-2 shadow-2xl shadow-black"
                    >
                      <div className="grid grid-cols-2 gap-0.5">
                        {topGenres.map(([genre, count]) => (
                          <button
                            key={genre}
                            onClick={() => goBrowser(genre)}
                            className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/[0.05] hover:text-white"
                          >
                            <span className="truncate">{genre}</span>
                            <span className="font-mono text-[10px] text-zinc-600">{count.toLocaleString()}</span>
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => goBrowser("")}
                        className="mt-1 w-full rounded-lg border border-white/5 px-3 py-2 text-center font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500 transition hover:text-rose-400"
                      >
                        Browse all genres
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <button
              onClick={() => setSearchOpen(true)}
              className="group flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2 text-xs text-zinc-500 transition hover:border-rose-500/40 hover:text-zinc-300 sm:px-3"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden items-center gap-0.5 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 xl:flex">
                Ctrl&nbsp;K
              </kbd>
            </button>

            <button
              onClick={() => setShowNSFW(!showNSFW)}
              title={
                showNSFW
                  ? "NSFW games are currently visible — click to hide them"
                  : `${nsfwCount.toLocaleString()} NSFW titles hidden — click to show them`
              }
              aria-pressed={showNSFW}
              className={`relative flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-bold transition sm:px-3 ${
                showNSFW
                  ? "border-rose-500/50 bg-rose-500/15 text-rose-300"
                  : "border-amber-500/50 bg-amber-500/10 text-amber-300"
              }`}
            >
              {showNSFW ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              <span className="hidden md:inline">{showNSFW ? "NSFW On" : "NSFW Hidden"}</span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${showNSFW ? "bg-rose-400" : "bg-amber-400"}`}
              />
            </button>

            <ThemeSwitcher />

            {user ? (
              <div className="relative">
                <button
                  onClick={() => setShowDropdown((v) => !v)}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-white transition hover:border-rose-500/40"
                >
                  <User className="h-3.5 w-3.5 text-rose-400" />
                  <span className="hidden sm:inline">{user.username}</span>
                </button>

                <AnimatePresence>
                  {showDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="absolute right-0 mt-2 z-20 w-44 rounded-xl border border-white/10 bg-[#101013] p-1.5 shadow-2xl shadow-black"
                      >
                        <div className="border-b border-white/5 px-3 py-2 text-xs">
                          <p className="text-zinc-500">Account status</p>
                          <p className="font-semibold text-rose-400">{user.role}</p>
                        </div>
                        <button
                          onClick={() => {
                            logoutUser();
                            setShowDropdown(false);
                            navigate("/");
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-zinc-400 hover:bg-white/5 hover:text-rose-400 transition"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          Logout
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <Link
                to="/login"
                className="flex h-8 items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3.5 text-xs font-semibold text-rose-400 transition hover:bg-rose-500/20"
              >
                <User className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sign In</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
};