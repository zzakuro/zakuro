import React, { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Star,
  Download,
  ChevronRight,
  ChevronLeft,
  Play,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useGame } from "../lib/gameContext";
import { GameCard, PlaceholderCover } from "../components/GameCard";
import { Game } from "../types";

/* ---------- helpers ---------- */
const daysSince = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 86_400_000;
};
const isNew = (g: Game) => daysSince(g.releaseDate) <= 120;
const isUpdated = (g: Game) => daysSince(g.stats.updatedAt) <= 30;

const SectionHeader: React.FC<{
  eyebrow: string;
  title: React.ReactNode;
  action?: { label: string; to: string };
}> = ({ eyebrow, title, action }) => (
  <div className="mb-5 flex items-end justify-between gap-4">
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-rose-400">
        <Sparkles className="h-3 w-3" />
        {eyebrow}
      </p>
      <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
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
  const [heroImgFailed, setHeroImgFailed] = useState(false);

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

  // Reset the image-failure flag whenever the hero game changes.
  useEffect(() => {
    setHeroImgFailed(false);
  }, [activeCarouselGame?.id]);

  const heroSrc = activeCarouselGame?.steamId
    ? `https://cdn.akamai.steamstatic.com/steam/apps/${activeCarouselGame.steamId}/library_hero.jpg`
    : activeCarouselGame?.screenshot || activeCarouselGame?.coverImage || "";
  const showHeroBackdrop = !heroSrc || heroImgFailed;

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
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [games]);

  if (loading) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-zinc-800 border-t-rose-500" />
        <p className="font-mono text-xs font-semibold tracking-widest text-zinc-500">LOADING ZAKURO'S ARCHIVE…</p>
      </div>
    );
  }

  return (
    <div id="home_view" className="relative pb-16">
      {/* 1. Hero carousel */}
      {activeCarouselGame && (
        <section
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          className="relative h-[78vh] min-h-[520px] w-full overflow-hidden border-b border-white/5 bg-black"
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
              {showHeroBackdrop ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.8 }}
                  className="absolute inset-0 scale-105 opacity-70 blur-[2px] saturate-[0.9]"
                >
                  <PlaceholderCover title={activeCarouselGame.title} />
                </motion.div>
              ) : (
                <motion.img
                  src={heroSrc}
                  alt={activeCarouselGame.title}
                  referrerPolicy="no-referrer"
                  initial={{ scale: 1.06 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 9, ease: "easeOut" }}
                  onError={() => setHeroImgFailed(true)}
                  className="h-full w-full object-cover opacity-60 saturate-[0.9]"
                />
              )}
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

          <div className="absolute inset-0 z-20 mx-auto flex max-w-7xl flex-col justify-end px-4 pb-20 sm:px-6 lg:px-8">
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
                {g.coverImage ? (
                  <img src={g.coverImage} alt={g.title} className="h-full w-full object-cover" />
                ) : (
                  <PlaceholderCover title={g.title} className="p-2 [&_span:first-child]:text-sm" />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* 2. Latest releases rail */}
        <section className="mt-14">
          <SectionHeader
            eyebrow="✦ Latest Games"
            title="Latest Releases"
            action={{ label: "View all games", to: "/browse" }}
          />
          <Rail>
            {latestGames.map((g) => (
              <div key={g.id} className="w-48 shrink-0 sm:w-52">
                <GameCard game={g} badge={isNew(g) ? "NEW" : isUpdated(g) ? "UPDATED" : undefined} />
              </div>
            ))}
          </Rail>
        </section>

        {/* 3. Trending grid */}
        <section className="mt-16">
          <SectionHeader
            eyebrow="✦ Trending Games"
            title="Trending Now"
            action={{ label: "Browse top", to: "/browse?sort=Most%20Popular" }}
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {popularGames.map((g) => (
              <GameCard key={g.id} game={g} badge="HOT" />
            ))}
          </div>
        </section>

        {/* 4. Top rated leaderboard */}
        <section className="mt-16">
          <SectionHeader
            eyebrow="✦ Critically Acclaimed"
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
                {g.coverImage ? (
                  <span className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-900 ring-1 ring-white/5">
                    <img
                      src={g.coverImage}
                      alt={g.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-110"
                    />
                  </span>
                ) : (
                  <span className="h-14 w-10 shrink-0 overflow-hidden rounded-md ring-1 ring-white/5">
                    <PlaceholderCover title={g.title} className="p-1.5 [&_span:first-child]:text-[10px] [&_span:last-child]:text-[9px]" />
                  </span>
                )}
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

        {/* 5. Featured Collections */}
        <section className="mt-16">
          <SectionHeader
            eyebrow="✦ Featured Collections"
            title="Browse by Genre"
            action={{ label: "All genres", to: "/browse" }}
          />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {genreCounts.map(([genre, count], i) => {
              const hue = (i * 61 + 8) % 360;
              const hue2 = (hue + 42) % 360;
              return (
                <button
                  key={genre}
                  onClick={() => navigate(`/browse?q=${encodeURIComponent(genre)}`)}
                  className="group relative h-36 overflow-hidden rounded-2xl text-left ring-1 ring-white/[0.06] transition hover:-translate-y-0.5 hover:ring-rose-500/40 hover:shadow-2xl hover:shadow-black"
                  style={{
                    background: `linear-gradient(135deg, hsl(${hue} 55% 24%), hsl(${hue2} 60% 9%) 65%)`,
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <div className="relative z-10 flex h-full flex-col justify-between p-5">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">
                      Collection
                    </span>
                    <div>
                      <h3 className="font-display text-xl font-bold text-white">{genre}</h3>
                      <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-white/60">
                        {count.toLocaleString()} games
                        <ArrowRight className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-1" />
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 6. New releases rail */}
        <section className="mt-16">
          <SectionHeader
            eyebrow="✦ Fresh Off The Press"
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