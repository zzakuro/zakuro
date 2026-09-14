import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { SlidersHorizontal, Search, X, ChevronDown, RotateCcw } from "lucide-react";
import { useGame } from "../lib/gameContext";
import { GameCard } from "../components/GameCard";

export const BrowseView: React.FC = () => {
  const { games, searchQuery, setSearchQuery } = useGame();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedGenre, setSelectedGenre] = useState<string>("");
  const [selectedDeveloper, setSelectedDeveloper] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedMinRating, setSelectedMinRating] = useState<number | "">("");
  const [sortBy, setSortBy] = useState<string>("Most Popular");
  const [showNoCover, setShowNoCover] = useState<boolean>(false);
  const [showClassic, setShowClassic] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const ITEMS_PER_PAGE = 60;

  const queryParam = searchParams.get("q") || "";
  useEffect(() => {
    if (queryParam) setSearchQuery(queryParam);
  }, [queryParam, setSearchQuery]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedGenre, selectedDeveloper, selectedYear, selectedMinRating, sortBy, showClassic]);

  const genresList = Array.from(new Set([
    "Visual Novel", "Metroidvania", "Souls-like", "Roguelike", "Rhythm", "Racing",
    "Fighting", "JRPG", "CRPG", "ARPG", "Deckbuilder", "Card Game", "Board Game",
    "Stealth", "Survival", "Horror", "Open World", "Sandbox", "Strategy",
    "Turn-based", "Tower Defense", "Idle", "Bullet Hell", "Platformer", "Puzzle",
    "Point-and-click", "MOBA", "MMO", "Battle Royale", "City Builder", "Farming",
    "Co-op", "Cozy", "Walking Sim", "Story-rich", "Cyberpunk", "Fantasy", "Sci-Fi",
    "Post-apocalyptic", "Retro", "Arcade", "Pinball", "Management", "Simulator",
    "Space", "Zombie", "VR", "Hidden Object", "NSFW",
    "Action", "Adventure", "RPG", "Indie", "Simulation", "Casual", "Shooter",
    "Sports", "Puzzle",
    ...[...games].sort((a, b) => a.title.localeCompare(b.title)).flatMap((g) => g.genres || []),
  ]));

  const developersList = Array.from(new Set(games.map((g) => g.developer))).sort();
  // Data-derived years (matches ISO, "Dec 11 2015", "Q3 2026", ...) so the
  // filter is honest about what's actually in the catalog.
  const yearsList = Array.from(new Set(
    games
      .map((g) => g.releaseDate.match(/(19|20)\d{2}/)?.[0])
      .filter((y): y is string => !!y)
  )).sort((a, b) => Number(b) - Number(a));

  const handleClearFilters = () => {
    setSelectedGenre("");
    setSelectedDeveloper("");
    setSelectedYear("");
    setSelectedMinRating("");
    setSortBy("Most Popular");
    setShowNoCover(false);
    setShowClassic(false);
    setSearchQuery("");
    setSearchParams({});
    setPage(1);
  };

  const filteredGames = games.filter((game) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = searchQuery
      ? game.title.toLowerCase().includes(q) ||
        game.developer.toLowerCase().includes(q) ||
        game.genres.some((g) => g.toLowerCase().includes(q))
      : true;
    const matchesGenre = selectedGenre
      ? game.genres.some((g) => g.toLowerCase() === selectedGenre.toLowerCase())
      : true;
    const matchesDeveloper = selectedDeveloper ? game.developer === selectedDeveloper : true;
    const matchesYear = selectedYear
      ? (game.releaseDate || "").match(/(19|20)\d{2}/)?.[0] === selectedYear
      : true;
    const matchesRating = selectedMinRating ? game.rating >= selectedMinRating : true;
    const matchesClassic = showClassic ? game.classic === true : true;
    const matchesCover = showClassic ? true : showNoCover ? true : !!game.coverImage;
    return matchesSearch && matchesGenre && matchesDeveloper && matchesYear && matchesRating && matchesClassic && matchesCover;
  });

  const parseTime = (d: string) => {
    const t = Date.parse(d || "");
    return Number.isNaN(t) ? -Infinity : t;
  };

  const sortedGames = [...filteredGames].sort((a, b) => {
    if (sortBy === "Most Popular") return (b.popularityScore ?? 0) - (a.popularityScore ?? 0);
    if (sortBy === "Newest") return parseTime(b.releaseDate) - parseTime(a.releaseDate);
    if (sortBy === "Highest Rated") return b.rating - a.rating;
    if (sortBy === "A–Z") return a.title.localeCompare(b.title);
    if (sortBy === "File Size") {
      const parseSize = (s: string) => {
        const v = parseFloat(s);
        if (Number.isNaN(v)) return -Infinity;
        if (s.includes("TB")) return v * 1024;
        return v;
      };
      return parseSize(b.fileSize) - parseSize(a.fileSize);
    }
    return 0;
  });

  const totalPages = Math.ceil(sortedGames.length / ITEMS_PER_PAGE);
  // Clamp the page whenever the result set shrinks (filter/data poll change),
  // so we never render an empty slice while showing "Page 4/2".
  useEffect(() => {
    setPage((p) => Math.max(1, Math.min(p, Math.max(1, totalPages))));
  }, [totalPages]);
  const safePage = Math.max(1, Math.min(page, Math.max(1, totalPages)));
  const pagedGames = sortedGames.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const pageNumbers: (number | string)[] = [];
  Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
    .forEach((p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) pageNumbers.push("...");
      pageNumbers.push(p);
    });

  const selectCls =
    "w-full rounded-lg border border-white/10 bg-[#0d0d10] py-2 pl-3 pr-8 text-xs text-zinc-300 outline-none transition focus:border-rose-500/50";
  const activeFilterCls = "bg-rose-500/10 border-rose-500/40 text-rose-400";
  const idleFilterCls = "bg-[#0d0d10] border-white/10 text-zinc-400 hover:border-white/25 hover:text-white";

  return (
    <div id="browse_view" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 border-b border-white/5 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-1.5 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-rose-400">
            <span className="h-1 w-1 rounded-full bg-rose-400" />
            Library
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">
            Browse Games
          </h1>
          <p className="mt-1.5 font-mono text-xs text-zinc-500">
            {sortedGames.length.toLocaleString()} of {games.length.toLocaleString()} titles indexed
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
              sidebarOpen ? "border-rose-500/40 bg-rose-500/10 text-rose-400" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {sidebarOpen ? "Hide Filters" : "Show Filters"}
          </button>

          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="appearance-none rounded-full border border-white/10 bg-[#0d0d10] py-2 pl-4 pr-10 text-xs font-semibold text-zinc-300 outline-none transition focus:border-rose-500/50"
            >
              <option value="Most Popular">Sort: Most Popular</option>
              <option value="Newest">Sort: Newest</option>
              <option value="Highest Rated">Sort: Highest Rated</option>
              <option value="A–Z">Sort: A–Z</option>
              <option value="File Size">Sort: File Size</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-start gap-8 lg:flex-row">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside id="filters_sidebar" className="w-full shrink-0 rounded-2xl bg-[#0d0d10] p-5 ring-1 ring-white/[0.06] lg:sticky lg:top-24 lg:w-64">
            <div className="mb-5 flex items-center justify-between border-b border-white/5 pb-3">
              <span className="font-display text-xs font-bold uppercase tracking-widest text-white">Filters</span>
              <button
                onClick={handleClearFilters}
                className="flex items-center gap-1 font-mono text-[10px] font-bold text-zinc-500 transition hover:text-rose-400"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>

            <FilterGroup label="Search Match">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter title…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#0d0d10] py-2 pl-3 pr-8 text-xs text-white outline-none transition placeholder-zinc-600 focus:border-rose-500/50"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 transition hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </FilterGroup>

            <FilterGroup label="Genres">
              <select value={selectedGenre} onChange={(e) => setSelectedGenre(e.target.value)} className={selectCls}>
                <option value="">All Genres</option>
                {genresList.map((genre) => (
                  <option key={genre} value={genre}>{genre}</option>
                ))}
              </select>
            </FilterGroup>

            <FilterGroup label="Developer">
              <select value={selectedDeveloper} onChange={(e) => setSelectedDeveloper(e.target.value)} className={selectCls}>
                <option value="">All Developers</option>
                {developersList.map((dev) => (
                  <option key={dev} value={dev}>{dev}</option>
                ))}
              </select>
            </FilterGroup>

            <FilterGroup label="Release Year">
              <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className={selectCls}>
                <option value="">All Years</option>
                {yearsList.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </FilterGroup>

            <FilterGroup label="Minimum Rating">
              <div className="flex flex-col gap-2">
                {[70, 80, 90].map((rating) => (
                  <button
                    key={rating}
                    onClick={() => setSelectedMinRating(selectedMinRating === rating ? "" : rating)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
                      selectedMinRating === rating ? activeFilterCls : idleFilterCls
                    }`}
                  >
                    {rating}+ Rating Score
                  </button>
                ))}
              </div>
            </FilterGroup>

            <FilterGroup label="Library">
              <button
                onClick={() => setShowClassic(!showClassic)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
                  showClassic ? activeFilterCls : idleFilterCls
                }`}
              >
                {showClassic ? "✓ Classic & Retro only" : "Classic & Retro"}
              </button>
            </FilterGroup>

            <FilterGroup label="Cover Art" last>
              <button
                onClick={() => setShowNoCover(!showNoCover)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
                  showNoCover ? activeFilterCls : idleFilterCls
                }`}
              >
                {showNoCover ? "✓ Showing all games" : "Show games without cover"}
              </button>
            </FilterGroup>
          </aside>
        )}

        {/* Grid */}
        <section className="flex-1">
          <div className="mb-6 flex items-center justify-between">
            <p className="font-mono text-xs text-zinc-500">
              Showing <span className="font-bold text-rose-400">{sortedGames.length.toLocaleString()}</span>
              {totalPages > 1 && <span className="text-zinc-600"> · Page {page}/{totalPages}</span>}
            </p>
            {sortedGames.length < games.length && (
              <button
                onClick={handleClearFilters}
                className="font-mono text-xs font-bold text-rose-500 underline transition hover:text-rose-400"
              >
                Clear all filters
              </button>
            )}
          </div>

          {sortedGames.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
              <Search className="mb-4 h-10 w-10 text-zinc-700" />
              <h3 className="font-display text-sm font-bold text-zinc-300">No Game Found</h3>
              <p className="mt-2 max-w-sm text-xs text-zinc-500">
                No indexed titles matched your criteria. Try clearing filters or adjusting your search.
              </p>
              <button
                onClick={handleClearFilters}
                className="mt-5 rounded-full border border-white/10 bg-[#0d0d10] px-4 py-2 text-xs font-bold text-white transition hover:border-rose-500/40"
              >
                Reset Search Filters
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {pagedGames.map((game) => (
                  <GameCard key={game.id} game={game} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={() => { setPage((p) => Math.max(1, p - 1)); scrollTop(); }}
                    disabled={page === 1}
                    className="rounded-lg border border-white/10 bg-[#0d0d10] px-3.5 py-1.5 font-mono text-xs font-bold text-zinc-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ‹ Prev
                  </button>

                  {pageNumbers.map((p, i) =>
                    p === "..." ? (
                      <span key={`e${i}`} className="px-1 font-mono text-xs text-zinc-600">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => { setPage(p as number); scrollTop(); }}
                        className={`rounded-lg px-3.5 py-1.5 font-mono text-xs font-bold transition ${
                          page === p
                            ? "bg-rose-500 text-white shadow-lg shadow-rose-500/20"
                            : "border border-white/10 bg-[#0d0d10] text-zinc-400 hover:text-white"
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}

                  <button
                    onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); scrollTop(); }}
                    disabled={page === totalPages}
                    className="rounded-lg border border-white/10 bg-[#0d0d10] px-3.5 py-1.5 font-mono text-xs font-bold text-zinc-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next ›
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
};

const FilterGroup: React.FC<{ label: string; children: React.ReactNode; last?: boolean }> = ({
  label,
  children,
  last,
}) => (
  <div className={last ? "" : "mb-5"}>
    <label className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
      {label}
    </label>
    {children}
  </div>
);