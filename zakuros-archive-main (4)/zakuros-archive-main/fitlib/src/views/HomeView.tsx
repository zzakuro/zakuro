import React, { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Star,
  Download,
  ChevronRight,
  ChevronLeft,
  Play,
  Globe,
  Flame,
  Database,
  ArrowRight,
  Sparkles,
  Layers,
} from "lucide-react";
import { useGame } from "../lib/gameContext";
import { GameCard } from "../components/GameCard";
import { Game } from "../types";

/* ---------- helpers ---------- */
const daysSince = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 86_400_000;
};
const isNew = (g: Game) => daysSince(g.releaseDate) <= 120;
const isUpdated = (g: Game) => daysSince(g.stats.updatedAt) <= 30;

const compactNum = (v: number): string => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(0)}k`;
  return v.toLocaleString();
};

const AnimatedNumber: React.FC<{ value: number; compact?: boolean; duration?: number }> = ({
  value,
  compact = false,
  duration = 900,
}) => {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    let start: number | null = null;
    let raf = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      setCurrent(Math.floor(progress * value));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span>{compact ? compactNum(current) : current.toLocaleString()}</span>;
};

const SectionHeader: React.FC<{
  eyebrow: string;
  title: React.ReactNode;
  action?: { label: string; to: string };
}> = ({ eyebrow, title, action }) => (
  <div className="mb-5 flex items-end justify-between gap-4">
    <div>
      <p className="mb-1.5 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-rose-400">
        <span className="h-1 w-1 rounded-full bg-rose-400" />
        {eyebrow}
      </p>
      <h2 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">{title}</h2>
    </div>
    {action && (
      <Link
        to={action.to}
        className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-3.5 py-1.5 text-[11px] font-bold text-zinc-400 transition hover:border-rose-500/40 hover:text-white"
      >
        {action.label}
        <ArrowRight className="h-3 w-3" />
      </Link>
    )}
  </div>
);

const Rail: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
    {children}
  </div>
);

/* ---------- view ---------- */
export const HomeView: React.FC = () => {
  const { games, loading, error } = useGame();
  const navigate = useNavigate();
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const stats = useMemo(() => {
    const downloads = games.reduce((s, g) => s + (g.stats?.downloads || 0), 0);
    const views = games.reduce((s, g) => s + (g.stats?.views || 0), 0);
    const sources = games.reduce((s, g) => s + (g.downloadSources?.length || 0), 0);
    const genres = new Set<string>();
    const repackers = new Set<string>();
    games.forEach((g) => (g.genres || []).forEach((x) => genres.add(x)));
    games.forEach((g) => (g.downloadSources || []).forEach((ds) => ds.repacker && repackers.add(ds.repacker)));
    return { games: games.length, downloads, views, sources, genres: genres.size, repackers: repackers.size };
  }, [games]);

  // Collapse repack-variant duplicates in the showcase rows: same Steam appid
  // (or near-identical title when no appid) appears once, keeping the richest,
  // most recent entry so we don't show 3× "Baldur's Gate" style repeats.
  const uniqueShowcase = (list: Game[]): Game[] => {
    const seen = new Map<string, Game>();
    const key = (g: Game) =>
      typeof g.steamId === "number"
        ? `steam:${g.steamId}`
        : `title:${g.title.toLowerCase().replace(/[^a-z0-9]+/g, "").trim()}`;
    const score = (g: Game) =>
      (g.rating || 0) + (g.downloadSources?.length || 0) * 0.01 + (g.screenshots?.length || 0) * 0.001;
    for (const g of list) {
      const k = key(g);
      const prev = seen.get(k);
      if (!prev) {
        seen.set(k, g);
        continue;
      }
      const prevWhen = Date.parse(prev.stats?.updatedAt || "");
      const curWhen = Date.parse(g.stats?.updatedAt || "");
      if (score(g) > score(prev) || (score(g) === score(prev) && curWhen > prevWhen)) {
        seen.set(k, g);
      }
    }
    return [...seen.values()];
  };

  const carouselGames = useMemo(
    () =>
      uniqueShowcase([...games].filter((g) => g.rating > 0).sort((a, b) => b.rating - a.rating)).slice(0, 5),
    [games]
  );
  const activeCarouselGame = carouselGames[carouselIndex];

  // If the pool shrinks (catalog poll), never let the index dangle out of range.
  useEffect(() => {
    if (carouselGames.length === 0) return;
    setCarouselIndex((i) => Math.min(i, carouselGames.length - 1));
  }, [carouselGames.length]);

  useEffect(() => {
    if (carouselGames.length === 0 || paused) return;
    const id = setInterval(() => setCarouselIndex((p) => (p + 1) % carouselGames.length), 6000);
    return () => clearInterval(id);
  }, [carouselGames.length, paused]);

  const latestGames = useMemo(
    () => [...games].sort((a, b) => b.stats.updatedAt.localeCompare(a.stats.updatedAt)).slice(0, 12),
    [games]
  );
  const popularGames = useMemo(
    () =>
      uniqueShowcase([...games].sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0))).slice(0, 8),
    [games]
  );
  const topRated = useMemo(
    () =>
      uniqueShowcase([...games].filter((g) => g.rating > 0).sort((a, b) => b.rating - a.rating)).slice(0, 4),
    [games]
  );
  const newReleases = useMemo(() => {
    const parseTime = (d: string) => {
      const t = Date.parse(d || "");
      return Number.isNaN(t) ? -Infinity : t;
    };
    const withDate = games.filter((g) => !Number.isNaN(parseTime(g.releaseDate)));
    return [...withDate].sort((a, b) => parseTime(b.releaseDate) - parseTime(a.releaseDate)).slice(0, 12);
  }, [games]);

  const genreCounts = useMemo(() => {
    const map = new Map<string, number>();
    games.forEach((g) => (g.genres || []).forEach((x) => map.set(x, (map.get(x) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [games]);

  const sourceNames = ["FitGirl Repacks", "DODI", "GOG", "Xatab", "SteamRip", "OnlineFix", "ATOP Games", "Rexa Games"];

  if (loading) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-zinc-800 border-t-rose-500" />
        <p className="font-mono text-xs font-semibold tracking-widest text-zinc-500">LOADING ZAKURO'S ARCHIVE…</p>
      </div>
    );
  }

  const statItems = [
    { label: "Games Indexed", value: stats.games, icon: Database },
    { label: "Downloads", value: stats.downloads, icon: Download },
    { label: "Total Views", value: stats.views, icon: Globe },
    { label: "Genres", value: stats.genres, icon: Flame },
    { label: "Repackers", value: stats.repackers, icon: Layers },
    { label: "Sources", value: stats.sources, icon: Database },
  ];

  return (
    <div id="home_view" className="relative pb-16">
      {/* 1. Hero carousel */}
      {activeCarouselGame && (
        <section
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          className="relative h-[80vh] min-h-[540px] w-full overflow-hidden border-b border-white/5 bg-black"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCarouselGame.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute inset-0"
            >
              <div className="absolute inset-0 z-10 bg-gradient-to-t from-[#09090b] via-[#09090b]/40 to-transparent" />
              <div className="absolute inset-0 z-10 bg-gradient-to-r from-[#09090b]/90 via-transparent to-[#09090b]/20" />
              <motion.img
                src={
                  activeCarouselGame.steamId
                    ? `https://cdn.akamai.steamstatic.com/steam/apps/${activeCarouselGame.steamId}/library_hero.jpg`
                    : activeCarouselGame.screenshot
                }
                alt={activeCarouselGame.title}
                referrerPolicy="no-referrer"
                initial={{ scale: 1.06 }}
                animate={{ scale: 1 }}
                transition={{ duration: 9, ease: "easeOut" }}
                className="h-full w-full object-cover opacity-60 saturate-[0.9]"
              />
            </motion.div>
          </AnimatePresence>

          <button
            onClick={() => setCarouselIndex((p) => (p - 1 + carouselGames.length) % carouselGames.length)}
            className="absolute left-4 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-zinc-300 backdrop-blur-md transition hover:border-rose-500/50 hover:text-rose-400 md:flex"
            aria-label="Previous game"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => setCarouselIndex((p) => (p + 1) % carouselGames.length)}
            className="absolute right-4 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-zinc-300 backdrop-blur-md transition hover:border-rose-500/50 hover:text-rose-400 md:flex"
            aria-label="Next game"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="absolute inset-0 z-20 mx-auto flex max-w-7xl flex-col justify-end px-4 pb-24 sm:px-6 lg:px-8">
            <motion.div
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.08 }}
              className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-rose-400"
            >
              <Sparkles className="h-3 w-3" />
              Featured Release
            </motion.div>

            <motion.h1
              initial={{ y: 22, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.16 }}
              className="max-w-3xl font-display text-4xl font-bold uppercase leading-[1.05] tracking-tight text-white md:text-6xl line-clamp-2"
            >
              {activeCarouselGame.title}
            </motion.h1>

            <motion.div
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.26 }}
              className="mt-5 flex flex-wrap items-center gap-2"
            >
              <span className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] font-bold text-rose-400 ring-1 ring-white/10">
                <Star className="h-3 w-3 fill-rose-400" />
                {activeCarouselGame.rating > 0 ? `${activeCarouselGame.rating}%` : "—"}
              </span>
              {activeCarouselGame.releaseDate && (
                <span className="rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] font-bold text-zinc-300 ring-1 ring-white/10">
                  {activeCarouselGame.releaseDate.match(/(19|20)\d{2}/)?.[0] ?? activeCarouselGame.releaseDate}
                </span>
              )}
              <span className="rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-zinc-400 ring-1 ring-white/10">
                {activeCarouselGame.developer}
              </span>
              {activeCarouselGame.fileSize && (
                <span className="rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-zinc-400 ring-1 ring-white/10">
                  {activeCarouselGame.fileSize}
                </span>
              )}
            </motion.div>

            <motion.p
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.34 }}
              className="mt-4 max-w-xl text-xs leading-relaxed text-zinc-400 line-clamp-2 md:text-sm"
            >
              {activeCarouselGame.summary}
            </motion.p>

            <motion.div
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.42 }}
              className="mt-8 flex flex-wrap gap-3"
            >
              <Link
                to={`/game/${activeCarouselGame.id}`}
                className="flex items-center gap-2 rounded-full bg-rose-500 px-7 py-3 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-rose-500/25 transition hover:bg-rose-400"
              >
                <Download className="h-4 w-4" />
                Download Now
              </Link>
              <Link
                to={`/game/${activeCarouselGame.id}`}
                className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-7 py-3 text-xs font-bold uppercase tracking-wide text-zinc-200 backdrop-blur-sm transition hover:border-rose-500/40 hover:text-white"
              >
                <Play className="h-3.5 w-3.5" />
                More Details
              </Link>
            </motion.div>
          </div>

          {/* Progress dots */}
          <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-2">
            {carouselGames.map((g, idx) => (
              <button
                key={g.id}
                onClick={() => setCarouselIndex(idx)}
                aria-label={`Show ${g.title}`}
                className={`relative h-1 overflow-hidden rounded-full transition-all duration-300 ${
                  idx === carouselIndex ? "w-10 bg-white/15" : "w-3 bg-white/15 hover:bg-white/30"
                }`}
              >
                {idx === carouselIndex && !paused && (
                  <motion.span
                    key={`fill_${carouselIndex}_${paused}`}
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 6, ease: "linear" }}
                    className="absolute inset-y-0 left-0 bg-rose-500"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Thumb rail */}
          <div className="absolute bottom-6 right-10 z-30 hidden items-center gap-2.5 lg:flex">
            {carouselGames.map((g, idx) => (
              <button
                key={g.id}
                onClick={() => setCarouselIndex(idx)}
                className={`h-20 w-14 overflow-hidden rounded-lg ring-1 transition-all duration-300 ${
                  idx === carouselIndex
                    ? "scale-105 ring-rose-500"
                    : "opacity-50 ring-white/10 hover:opacity-100"
                }`}
              >
                <img src={g.coverImage} alt={g.title} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 2. Stats bar */}
      <section className="border-b border-white/5 bg-[#0c0c0e]/80">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-3 gap-x-6 gap-y-6 py-6 md:grid-cols-6">
            {statItems.map((it) => (
              <div key={it.label}>
                <p className="font-display text-xl font-bold text-white sm:text-2xl">
                  <AnimatedNumber value={it.value} compact />
                </p>
                <p className="mt-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                  {it.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Sources strip */}
      <section className="border-b border-white/5">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-1.5 px-4 py-3.5 sm:justify-between sm:px-6 lg:px-8">
          <span className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.25em] text-zinc-600">
            <Layers className="h-3 w-3" /> Indexing from
          </span>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
            {sourceNames.map((s) => (
              <span key={s} className="font-mono text-[11px] font-semibold text-zinc-500 transition hover:text-rose-400/80">
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* 4. Latest releases rail */}
        <section className="mt-14">
          <SectionHeader
            eyebrow="Just updated"
            title="Latest Releases"
            action={{ label: "View all", to: "/browse" }}
          />
          <Rail>
            {latestGames.map((g) => (
              <div key={g.id} className="w-48 shrink-0 sm:w-52">
                <GameCard game={g} badge={isNew(g) ? "NEW" : isUpdated(g) ? "UPDATED" : undefined} />
              </div>
            ))}
          </Rail>
        </section>

        {/* 5. Most popular grid */}
        <section className="mt-16">
          <SectionHeader
            eyebrow="Most wanted"
            title="Most Popular"
            action={{ label: "Browse top", to: "/browse?sort=Most%20Popular" }}
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {popularGames.map((g) => (
              <GameCard key={g.id} game={g} badge="HOT" />
            ))}
          </div>
        </section>

        {/* 6. Top rated leaderboard */}
        <section className="mt-16">
          <SectionHeader
            eyebrow="Critically acclaimed"
            title="Top Rated"
            action={{ label: "Highest rated", to: "/browse?sort=Highest%20Rated" }}
          />
          <div className="overflow-hidden rounded-2xl bg-[#0d0d10] ring-1 ring-white/[0.06]">
            {topRated.map((g, index) => (
              <Link
                key={g.id}
                to={`/game/${g.id}`}
                className="group flex items-center gap-4 border-b border-white/[0.05] px-4 py-3.5 transition last:border-0 hover:bg-white/[0.03] sm:px-6"
              >
                <span className="w-7 shrink-0 text-center font-display text-lg font-bold text-zinc-700 transition group-hover:text-rose-400">
                  {index + 1}
                </span>
                <span className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-900 ring-1 ring-white/5">
                  {g.coverImage && (
                    <img
                      src={g.coverImage}
                      alt={g.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-110"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-semibold text-zinc-100 transition group-hover:text-rose-400">
                    {g.title}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-500">
                    {g.genres[0] ?? "Game"} · {g.publisher || g.developer}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 rounded-md bg-rose-500/10 px-2 py-1 font-mono text-[11px] font-bold text-rose-400 ring-1 ring-rose-500/20">
                  <Star className="h-3 w-3 fill-rose-400" />
                  {g.rating > 0 ? `${g.rating}%` : "—"}
                </span>
                <ChevronRight className="hidden h-4 w-4 shrink-0 text-zinc-700 transition group-hover:text-rose-400 sm:block" />
              </Link>
            ))}
          </div>
        </section>

        {/* 7. Browse by genre */}
        <section className="mt-16">
          <SectionHeader eyebrow="Discover" title="Browse by Genre" action={{ label: "All genres", to: "/browse" }} />
          <div className="flex flex-wrap gap-2">
            {genreCounts.map(([genre, count]) => (
              <button
                key={genre}
                onClick={() => navigate(`/browse?q=${encodeURIComponent(genre)}`)}
                className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-zinc-300 transition hover:border-rose-500/40 hover:text-white"
              >
                {genre}
                <span className="font-mono text-[10px] text-zinc-600 transition group-hover:text-rose-400">
                  {count}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 8. New releases rail */}
        <section className="mt-16">
          <SectionHeader
            eyebrow="Fresh off the press"
            title="New Releases"
            action={{ label: "View all", to: "/browse" }}
          />
          <Rail>
            {newReleases.map((g) => (
              <div key={g.id} className="w-48 shrink-0 sm:w-52">
                <GameCard game={g} badge={isNew(g) ? "NEW" : undefined} />
              </div>
            ))}
          </Rail>
        </section>
      </main>

      {error && !loading && (
        <div className="relative z-10 mx-auto mt-10 max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-red-500/20 bg-red-950/20 px-4 py-3 font-mono text-xs text-red-400">
            Catalog sync problem: {error}
          </div>
        </div>
      )}
    </div>
  );
};