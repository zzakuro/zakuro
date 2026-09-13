import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Filter, SlidersHorizontal, Grid, Search, X, ChevronDown, RotateCcw, HelpCircle } from "lucide-react";
import { useGame } from "../lib/gameContext";
import { GameCard } from "../components/GameCard";
import { Game } from "../types";

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

  // Reset to page 1 on any filter change
  useEffect(() => { setPage(1); }, [searchQuery, selectedGenre, selectedDeveloper, selectedYear, selectedMinRating, sortBy, showClassic]);

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
  const yearsList = ["2022", "2023", "2024", "2025", "2026"];

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
    const matchesSearch = searchQuery
      ? game.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        game.developer.toLowerCase().includes(searchQuery.toLowerCase()) ||
        game.genres.some(g => g.toLowerCase().includes(searchQuery.toLowerCase()))
      : true;
    const matchesGenre = selectedGenre
      ? game.genres.some((g) => g.toLowerCase() === selectedGenre.toLowerCase())
      : true;
    const matchesDeveloper = selectedDeveloper ? game.developer === selectedDeveloper : true;
    const matchesYear = selectedYear ? game.releaseDate.startsWith(selectedYear) : true;
    const matchesRating = selectedMinRating ? game.rating >= selectedMinRating : true;
    const matchesClassic = showClassic ? game.classic === true : true;
    const matchesCover = showClassic ? true : showNoCover ? true : !!game.coverImage;
    return matchesSearch && matchesGenre && matchesDeveloper && matchesYear && matchesRating && matchesClassic && matchesCover;
  });

  const sortedGames = [...filteredGames].sort((a, b) => {
    if (sortBy === "Most Popular") return (b.popularityScore ?? 0) - (a.popularityScore ?? 0);
    if (sortBy === "Newest") return b.releaseDate.localeCompare(a.releaseDate);
    if (sortBy === "Highest Rated") return b.rating - a.rating;
    if (sortBy === "A–Z") return a.title.localeCompare(b.title);
    if (sortBy === "File Size") {
      const parseSize = (s: string) => {
        const v = parseFloat(s);
        if (s.includes("TB")) return v * 1024;
        return v;
      };
      return parseSize(b.fileSize) - parseSize(a.fileSize);
    }
    return 0;
  });

  const totalPages = Math.ceil(sortedGames.length / ITEMS_PER_PAGE);
  const pagedGames = sortedGames.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  // Build page number list with ellipsis
  const pageNumbers: (number | string)[] = [];
  Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
    .forEach((p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) pageNumbers.push("...");
      pageNumbers.push(p);
    });

  return (
    <div id="browse_view" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-zinc-900 pb-5 mb-8 gap-4">
        <div>
          <span className="text-[10px] font-bold text-pink-400 tracking-wider font-mono uppercase">ZAKURO'S ARCHIVE INTERNAL INDEX</span>
          <h1 className="font-display text-3xl font-black text-white uppercase mt-0.5">Browse games</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white hover:border-zinc-700 transition"
          >
            <SlidersHorizontal className="h-4 w-4 text-pink-400" />
            <span>{sidebarOpen ? "Hide Filters" : "Show Filters"}</span>
          </button>
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="appearance-none rounded-full border border-zinc-800 bg-zinc-950 py-2 pl-4 pr-10 text-xs font-semibold text-zinc-300 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500/30"
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

      <div className="flex gap-8 items-start">

        {/* Sidebar */}
        {sidebarOpen && (
          <aside id="filters_sidebar" className="w-64 shrink-0 rounded-xl border border-zinc-900 bg-zinc-950/40 p-5 sticky top-24 hidden md:block">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-3 mb-5">
              <span className="text-xs font-bold font-display tracking-wider text-white uppercase">Filter Options</span>
              <button onClick={handleClearFilters} className="text-[10px] font-bold text-zinc-500 hover:text-pink-400 font-mono transition flex items-center gap-1">
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>

            <div className="mb-6">
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Search Match</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 pl-3 pr-8 text-xs font-medium text-white transition placeholder-zinc-600 focus:border-pink-500/50 focus:outline-none"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Genres</label>
              <select value={selectedGenre} onChange={(e) => setSelectedGenre(e.target.value)} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 px-3 text-xs text-zinc-300 focus:border-pink-500/50 focus:outline-none">
                <option value="">All Genres</option>
                {genresList.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
              </select>
            </div>

            <div className="mb-6">
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Developer</label>
              <select value={selectedDeveloper} onChange={(e) => setSelectedDeveloper(e.target.value)} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 px-3 text-xs text-zinc-300 focus:border-pink-500/50 focus:outline-none">
                <option value="">All Developers</option>
                {developersList.map((dev) => <option key={dev} value={dev}>{dev}</option>)}
              </select>
            </div>

            <div className="mb-6">
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Release Year</label>
              <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 px-3 text-xs text-zinc-300 focus:border-pink-500/50 focus:outline-none">
                <option value="">All Years</option>
                {yearsList.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Minimum Rating</label>
              <div className="flex flex-col gap-2">
                {[70, 80, 90].map((rating) => (
                  <button
                    key={rating}
                    onClick={() => setSelectedMinRating(selectedMinRating === rating ? "" : rating)}
                    className={`w-full text-left rounded-lg py-1.5 px-3 text-xs font-semibold border transition ${
                      selectedMinRating === rating
                        ? "bg-pink-950/40 border-pink-500/40 text-pink-400"
                        : "bg-zinc-950 border-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-white"
                    }`}
                  >
                    {rating}+ Rating Score
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-zinc-900">
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Library</label>
              <button
                onClick={() => setShowClassic(!showClassic)}
                className={`w-full text-left rounded-lg py-1.5 px-3 text-xs font-semibold border transition mb-2 ${
                  showClassic
                    ? "bg-pink-950/40 border-pink-500/40 text-pink-400"
                    : "bg-zinc-950 border-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-white"
                }`}
              >
                {showClassic ? "✓ Classic & Retro only" : "Classic & Retro"}
              </button>
            </div>

            <div className="mt-6 pt-5 border-t border-zinc-900">
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Cover Art</label>
              <button
                onClick={() => setShowNoCover(!showNoCover)}
                className={`w-full text-left rounded-lg py-1.5 px-3 text-xs font-semibold border transition ${
                  showNoCover
                    ? "bg-pink-950/40 border-pink-500/40 text-pink-400"
                    : "bg-zinc-950 border-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-white"
                }`}
              >
                {showNoCover ? "✓ Showing all games" : "Show games without cover"}
              </button>
            </div>
          </aside>
        )}

        {/* Game Grid */}
        <section className="flex-1">
          <div className="flex items-center justify-between mb-6">
            <p className="text-xs text-zinc-500 font-mono">
              Showing <span className="font-bold text-pink-400">{sortedGames.length}</span> of {games.length} Games Indexed
              {totalPages > 1 && <span className="text-zinc-600"> · Page {page}/{totalPages}</span>}
            </p>
            {sortedGames.length < games.length && (
              <button onClick={handleClearFilters} className="text-xs font-bold text-pink-500 hover:text-pink-400 underline font-mono cursor-pointer">
                Clear all filters
              </button>
            )}
          </div>

          {sortedGames.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 text-center">
              <Search className="h-10 w-10 text-zinc-600 mb-4" />
              <h3 className="font-display font-bold text-zinc-300 text-sm">No Game Found</h3>
              <p className="text-xs text-zinc-500 mt-2 max-w-sm">No indexed files matched your tracking criteria. Try clearing criteria, adjusting filters, or submitting a request.</p>
              <button onClick={handleClearFilters} className="mt-5 rounded-full bg-zinc-900 border border-zinc-800 px-4 py-2 text-xs font-bold text-white hover:border-pink-500/40 transition">
                Reset Search Filters
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {pagedGames.map((game) => (
                  <GameCard key={game.id} game={game} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-10 flex-wrap">
                  <button
                    onClick={() => { setPage(1); scrollTop(); }}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >«</button>
                  <button
                    onClick={() => { setPage(p => Math.max(1, p - 1)); scrollTop(); }}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >‹ Prev</button>

                  {pageNumbers.map((p, i) =>
                    p === "..." ? (
                      <span key={`e${i}`} className="px-2 text-zinc-600 text-xs font-mono">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => { setPage(p as number); scrollTop(); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition ${
                          page === p
                            ? "bg-pink-950 border-pink-500/40 text-pink-400"
                            : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:border-zinc-600"
                        }`}
                      >{p}</button>
                    )
                  )}

                  <button
                    onClick={() => { setPage(p => Math.min(totalPages, p + 1)); scrollTop(); }}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >Next ›</button>
                  <button
                    onClick={() => { setPage(totalPages); scrollTop(); }}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >»</button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
};
