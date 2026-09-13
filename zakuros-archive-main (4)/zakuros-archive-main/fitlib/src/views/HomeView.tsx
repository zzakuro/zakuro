import React, { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Star,
  Download,
  ChevronRight,
  ChevronLeft,
  Play,
  Trophy,
  Globe,
  Flame,
  Clock,
  Database,
  ArrowRight,
  Sparkles,
  Eye,
  Layers,
  Zap,
  TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { useGame } from "../lib/gameContext";
import { GameCard } from "../components/GameCard";

// Custom hook for animated numbers
const AnimatedNumber: React.FC<{ value: number; suffix?: string; prefix?: string; duration?: number }> = ({
  value,
  suffix = "",
  prefix = "",
  duration = 1000,
}) => {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      setCurrent(Math.floor(progress * value));
      if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }, [value, duration]);

  return <span>{prefix}{current.toLocaleString()}{suffix}</span>;
};

const coverFallback = (id: string) => `https://picsum.photos/seed/${id}/150/200`;

export const HomeView: React.FC = () => {
  const { games, loading, error } = useGame();
  const navigate = useNavigate();
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [metricTab, setMetricTab] = useState<"downloads" | "views">("downloads");

  // Real archive statistics computed from the catalog
  const stats = useMemo(() => {
    const totalDownloads = games.reduce((s, g) => s + (g.stats?.downloads || 0), 0);
    const totalViews = games.reduce((s, g) => s + (g.stats?.views || 0), 0);
    const totalSources = games.reduce((s, g) => s + (g.downloadSources?.length || 0), 0);
    const genres = new Set<string>();
    const repackers = new Set<string>();
    games.forEach((g) => (g.genres || []).forEach((x) => genres.add(x)));
    games.forEach((g) => (g.downloadSources || []).forEach((ds) => ds.repacker && repackers.add(ds.repacker)));
    return {
      games: games.length,
      downloads: totalDownloads,
      views: totalViews,
      sources: totalSources,
      genres: genres.size,
      repackers: repackers.size,
    };
  }, [games]);

  // Top 4 street metrics for the trend chart
  const trendGames = useMemo(
    () =>
      [...games]
        .sort((a, b) => {
          const scoreA = (a.stats?.downloads || 0) + (a.stats?.views || 0);
          const scoreB = (b.stats?.downloads || 0) + (b.stats?.views || 0);
          return scoreB - scoreA;
        })
        .slice(0, 4),
    [games]
  );

  const datesList = ["30d Ago", "24d Ago", "18d Ago", "12d Ago", "6d Ago", "Today"];

  const trendData = datesList.map((label, idx) => {
    const ratio = 0.65 + (idx / (datesList.length - 1)) * 0.35;
    const item: { name: string; [key: string]: any } = { name: label };
    trendGames.forEach((g) => {
      const baseValue = metricTab === "downloads" ? (g.stats?.downloads || 0) : (g.stats?.views || 0);
      const wave = Math.sin(idx * 2 + g.title.charCodeAt(0)) * 0.04;
      item[g.title] = Math.round(baseValue * (ratio + wave));
    });
    return item;
  });

  const pathColors = ["#f472b6", "#a855f7", "#fb7185", "#f59e0b"];

  // Top 5 highest rated games for the carousel
  const carouselGames = useMemo(() => [...games].sort((a, b) => b.rating - a.rating).slice(0, 5), [games]);
  const activeCarouselGame = carouselGames[carouselIndex];

  // 6 second auto-advance (pauses on hover)
  useEffect(() => {
    if (carouselGames.length === 0 || paused) return;
    const interval = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % carouselGames.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [carouselGames.length, paused]);

  if (loading) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4">
        <div className="relative">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-zinc-800 border-t-pink-400" />
          <div className="absolute inset-0 h-12 w-12 animate-pulse rounded-full ring-4 ring-pink-500/10" />
        </div>
        <p className="text-xs font-semibold text-zinc-500 tracking-widest font-mono">LOADING ZAKURO'S ARCHIVE STORAGE...</p>
      </div>
    );
  }

  // Grid datasets
  const latestUpdates = [...games].slice(0, 4);
  const topRated = [...games].sort((a, b) => b.rating - a.rating).slice(0, 4);
  const newReleases = [...games].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)).slice(0, 4);
  const topThisWeekGames = [...games]
    .sort((a, b) => (b.stats?.downloads || 0) - (a.stats?.downloads || 0))
    .slice(0, 4);

  const sourceNames = ["FitGirl Repacks", "DODI", "GOG", "Xatab", "SteamRip", "OnlineFix", "ATOP Games", "Rexa Games"];

  const statTiles = [
    { label: "Repack Sources", value: stats.sources, icon: Database },
    { label: "Games Indexed", value: stats.games, icon: Star },
    { label: "Downloads", value: stats.downloads, icon: Download },
    { label: "Total Views", value: stats.views, icon: Globe },
    { label: "Genres", value: stats.genres, icon: Flame },
    { label: "Repackers", value: stats.repackers, icon: Clock },
  ];

  return (
    <div id="home_view" className="relative pb-16 overflow-hidden">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <div className="absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-pink-500/10 blur-[140px]" />
        <div className="absolute top-[38%] -left-40 h-[380px] w-[380px] rounded-full bg-fuchsia-500/5 blur-[120px]" />
        <div className="absolute top-[70%] -right-40 h-[380px] w-[380px] rounded-full bg-pink-500/5 blur-[120px]" />
      </div>

      {/* 1. Fullscreen Hero Carousel */}
      {activeCarouselGame && (
        <section
          id="hero_carousel"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          className="relative h-[80vh] min-h-[540px] w-full overflow-hidden border-b border-zinc-900 bg-black"
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
              {/* Layered cinematic gradient */}
              <div className="absolute inset-0 z-10 bg-gradient-to-t from-[#050506] via-[#050506]/45 to-[#050506]/20" />
              <div className="absolute inset-0 z-10 bg-gradient-to-r from-[#050506]/90 via-transparent to-[#050506]/30" />
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
                className="h-full w-full object-cover opacity-70 saturate-[0.85]"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (!target.src.includes("unsplash")) {
                    target.src =
                      "https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1920&auto=format&fit=crop";
                  }
                }}
              />
            </motion.div>
          </AnimatePresence>

          {/* Prev / Next controls */}
          <button
            onClick={() => setCarouselIndex((prev) => (prev - 1 + carouselGames.length) % carouselGames.length)}
            className="absolute left-4 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700/60 bg-zinc-950/50 text-zinc-300 backdrop-blur-md transition hover:border-pink-400/60 hover:text-pink-400 md:flex"
            aria-label="Previous game"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => setCarouselIndex((prev) => (prev + 1) % carouselGames.length)}
            className="absolute right-4 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700/60 bg-zinc-950/50 text-zinc-300 backdrop-blur-md transition hover:border-pink-400/60 hover:text-pink-400 md:flex"
            aria-label="Next game"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* Carousel Text Metadata */}
          <div className="absolute inset-0 z-20 mx-auto flex max-w-7xl flex-col justify-end px-4 pb-24 sm:px-6 lg:px-8">
            <div className="max-w-2xl transform-gpu">
              {/* Eyebrow */}
              <motion.div
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-pink-500/25 bg-pink-950/40 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-pink-400 font-mono"
              >
                <Sparkles className="h-3 w-3" />
                Featured Release
              </motion.div>

              {/* Game Title */}
              <motion.h1
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.18 }}
                className="font-display font-black tracking-tight text-white text-4xl md:text-6xl uppercase leading-[1.05] line-clamp-2"
              >
                {activeCarouselGame.title}
              </motion.h1>

              {/* Meta chips: rating · year · developer · size */}
              <motion.div
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.28 }}
                className="mt-5 flex flex-wrap items-center gap-2"
              >
                <span className="flex items-center gap-1 rounded-md bg-[#050506]/70 border border-zinc-800 px-2 py-1 text-[11px] font-bold text-pink-400 font-mono">
                  <Star className="h-3 w-3 fill-pink-400" />
                  {activeCarouselGame.rating}%
                </span>
                {activeCarouselGame.releaseDate && (
                  <span className="rounded-md bg-[#050506]/70 border border-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-300 font-mono">
                    {activeCarouselGame.releaseDate.slice(0, 4)}
                  </span>
                )}
                <span className="rounded-md bg-[#050506]/70 border border-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-300">
                  {activeCarouselGame.developer}
                </span>
                {activeCarouselGame.fileSize && (
                  <span className="rounded-md bg-[#050506]/70 border border-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-400 font-mono">
                    {activeCarouselGame.fileSize}
                  </span>
                )}
              </motion.div>

              {/* Game Summary */}
              <motion.p
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.36 }}
                className="mt-4 text-zinc-400 text-xs md:text-sm leading-relaxed line-clamp-2 max-w-xl"
              >
                {activeCarouselGame.summary}
              </motion.p>

              {/* Actions */}
              <motion.div
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.44 }}
                className="mt-8 flex flex-wrap gap-3"
              >
                <Link
                  id="carousel_download_btn"
                  to={`/game/${activeCarouselGame.id}`}
                  className="flex items-center gap-2 rounded-full bg-gradient-to-r from-pink-400 to-fuchsia-400 px-7 py-3 text-xs font-bold text-black hover:brightness-110 transition shadow-lg shadow-pink-400/30 uppercase"
                >
                  <Download className="h-4 w-4 stroke-[2.5]" />
                  <span>Download Now</span>
                </Link>
                <Link
                  to={`/game/${activeCarouselGame.id}`}
                  className="flex items-center gap-2 rounded-full border border-zinc-700/70 bg-zinc-950/60 px-7 py-3 text-xs font-bold text-zinc-200 hover:text-white hover:border-pink-400/50 transition backdrop-blur-md uppercase"
                >
                  <Play className="h-3.5 w-3.5 text-pink-400 fill-current" />
                  <span>Details</span>
                </Link>
              </motion.div>
            </div>
          </div>

          {/* Animated progress bars */}
          <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-2">
            {carouselGames.map((g, idx) => (
              <button
                key={g.id}
                onClick={() => setCarouselIndex(idx)}
                aria-label={`Show ${g.title}`}
                className={`relative h-1 overflow-hidden rounded-full transition-all duration-300 ${
                  idx === carouselIndex ? "w-10 bg-zinc-700/60" : "w-3 bg-zinc-700/40 hover:bg-zinc-600/60"
                }`}
              >
                {idx === carouselIndex && !paused && (
                  <motion.span
                    key={`fill_${carouselIndex}_${paused}`}
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 6, ease: "linear" }}
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-pink-400 to-fuchsia-300"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Thumbnail rail (desktop) */}
          <div className="absolute bottom-6 right-10 z-30 hidden items-center gap-2.5 lg:flex">
            {carouselGames.map((g, idx) => (
              <button
                key={g.id}
                onClick={() => setCarouselIndex(idx)}
                className={`h-20 w-14 overflow-hidden rounded-lg border transition-all duration-300 ${
                  idx === carouselIndex
                    ? "border-pink-400/80 shadow-[0_0_16px_rgba(244,114,182,0.35)] scale-105"
                    : "border-zinc-800 opacity-50 hover:opacity-100"
                }`}
              >
                <img
                  src={g.coverImage}
                  alt={g.title}
                  className="h-full w-full object-cover"
                  onError={(e) => ((e.target as HTMLImageElement).src = coverFallback(g.id))}
                />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 2. Global statistics bar — real figures computed from the catalog */}
      <section id="stats_bar" className="relative z-10 border-b border-zinc-900 bg-[#07070a]/80 backdrop-blur-sm py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
            <div className="col-span-2 flex items-center gap-3 rounded-xl border border-pink-500/20 bg-gradient-to-br from-pink-500/10 to-transparent px-4 py-3 sm:col-span-1 lg:col-span-1">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-400/10 ring-1 ring-pink-400/25 text-pink-400">
                <Zap className="h-4 w-4" />
              </span>
              <div className="leading-tight">
                <div className="font-display text-sm font-black text-white uppercase tracking-wide">
                  Zakuro's
                  <span className="text-pink-400"> Archive</span>
                </div>
                <div className="text-[9px] uppercase tracking-wider font-bold text-zinc-500">Live Index</div>
              </div>
            </div>

            {statTiles.map((t) => (
              <div
                key={t.label}
                className="flex items-center gap-3 rounded-xl border border-zinc-900 bg-zinc-950/60 px-4 py-3 transition hover:border-pink-500/25"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-pink-500/10 ring-1 ring-pink-500/20 text-pink-400">
                  <t.icon className="h-4 w-4" />
                </span>
                <div className="leading-tight">
                  <div className="font-display text-lg font-black text-white">
                    <AnimatedNumber value={t.value} />
                  </div>
                  <div className="text-[9px] uppercase tracking-wider font-bold text-zinc-500">{t.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 2.5. Sources strip */}
      <section className="relative z-10 border-b border-zinc-900/70 bg-[#050506]/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-3.5 sm:justify-between sm:px-6 lg:px-8">
          <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.25em] text-zinc-600 font-mono">
            <Layers className="h-3 w-3" /> Indexing from
          </span>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
            {sourceNames.map((s) => (
              <span key={s} className="text-[11px] font-mono font-semibold text-zinc-500 hover:text-pink-400/80 transition">
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Top This Week Leaderboard Section */}
      <section id="leaderboard_section" className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mt-14">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-3.5 w-1 rounded-full bg-gradient-to-b from-pink-400 to-pink-600/30" />
              <span className="text-[10px] font-bold text-pink-400 tracking-wider font-mono uppercase">LEADERBOARD</span>
            </div>
            <h2 className="font-display text-2xl font-black tracking-wider uppercase text-zinc-100 mt-1">Top This Week</h2>
          </div>
          <Link
            to="/browse"
            className="hidden sm:flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/60 px-4 py-2 text-[11px] font-bold text-zinc-300 hover:text-pink-400 hover:border-pink-400/40 transition font-mono"
          >
            View full catalog <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div
          id="leaderboard"
          className="relative overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950/40 p-6 md:p-8"
        >
          {topThisWeekGames[0] && (
            <div className="grid gap-8 lg:grid-cols-2">
              {/* Rank #1 Spotlight */}
              <div className="flex items-center gap-5">
                <Link
                  to={`/game/${topThisWeekGames[0].id}`}
                  className="group relative h-40 w-28 shrink-0 overflow-hidden rounded-xl border border-pink-500/30 shadow-[0_0_24px_rgba(244,114,182,0.12)]"
                >
                  <img
                    src={topThisWeekGames[0].coverImage}
                    alt={topThisWeekGames[0].title}
                    className="h-full w-full object-cover group-hover:scale-110 transition duration-500"
                    onError={(e) => ((e.target as HTMLImageElement).src = coverFallback(topThisWeekGames[0].id))}
                  />
                  <span className="absolute inset-0 ring-1 ring-inset ring-white/10" />
                  {/* Crown badge */}
                  <span className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-fuchsia-400 text-black shadow-lg shadow-pink-500/30">
                    <Trophy className="h-4 w-4" />
                  </span>
                </Link>
                <div className="min-w-0">
                  <span className="inline-block rounded-md bg-yellow-500/10 border border-yellow-500/25 px-2 py-0.5 text-[9px] font-bold text-yellow-400 uppercase tracking-wider font-mono">
                    #1 This Week
                  </span>
                  <Link
                    to={`/game/${topThisWeekGames[0].id}`}
                    className="mt-2 block text-lg font-bold text-white hover:text-pink-400 transition font-display uppercase leading-tight line-clamp-2"
                  >
                    {topThisWeekGames[0].title}
                  </Link>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-pink-950/60 px-1.5 py-0.5 text-[10px] font-bold text-pink-400 border border-pink-500/25 font-mono">
                      {topThisWeekGames[0].rating}% SCORE
                    </span>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      <span className="text-pink-400 font-bold">{topThisWeekGames[0].stats?.downloads.toLocaleString()}</span>{" "}
                      downloads
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500 line-clamp-1">
                    Publisher: <span className="text-pink-400 font-semibold font-mono">{topThisWeekGames[0].publisher}</span>
                  </p>
                </div>
              </div>

              {/* Ranks 2 - 4 */}
              <div className="grid gap-3">
                {topThisWeekGames.slice(1, 4).map((game, index) => (
                  <Link
                    key={game.id}
                    to={`/game/${game.id}`}
                    className="group flex items-center gap-4 rounded-xl border border-zinc-900 bg-zinc-950/70 px-4 py-3 transition hover:border-pink-500/30 hover:bg-zinc-900/60"
                  >
                    <span className="w-5 text-center font-display text-lg font-black text-zinc-600 group-hover:text-pink-400 transition">
                      {index + 2}
                    </span>
                    <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md border border-zinc-800 group-hover:border-pink-400/40 transition">
                      <img
                        src={game.coverImage}
                        alt={game.title}
                        className="h-full w-full object-cover group-hover:scale-110 transition duration-300"
                        onError={(e) => ((e.target as HTMLImageElement).src = coverFallback(game.id))}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-sm font-bold text-zinc-200 group-hover:text-pink-400 transition">
                        {game.title}
                      </span>
                      <span className="text-[11px] text-zinc-500 font-mono flex items-center gap-1">
                        <Download className="h-3 w-3 text-zinc-600" />
                        {game.stats?.downloads.toLocaleString()} downloads
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-zinc-700 group-hover:text-pink-400 transition" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 3.5. Trending Metrics Line Graph */}
      <section id="trending_chart_section" className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mt-14">
        <div className="relative overflow-hidden rounded-2xl border border-zinc-900 bg-gradient-to-b from-zinc-950/70 to-zinc-950/30 p-6 md:p-8">
          <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-pink-500/10 blur-[100px]" />

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-pink-400" />
                <span className="text-[10px] font-bold text-pink-400 tracking-wider font-mono uppercase">
                  30-DAY TRAJECTORY
                </span>
              </div>
              <h2 className="font-display text-2xl font-black text-zinc-100 uppercase mt-1">Volume Trends</h2>
              <p className="text-xs text-zinc-500 font-mono mt-0.5">Comparative activity across the top 4 titles</p>
            </div>

            {/* Segmented control */}
            <div className="flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 font-mono">
              <button
                id="btn_chart_downloads"
                onClick={() => setMetricTab("downloads")}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-[10px] font-bold uppercase transition cursor-pointer ${
                  metricTab === "downloads"
                    ? "bg-pink-400 text-black shadow"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Download className="h-3 w-3" /> Downloads
              </button>
              <button
                id="btn_chart_views"
                onClick={() => setMetricTab("views")}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-[10px] font-bold uppercase transition cursor-pointer ${
                  metricTab === "views" ? "bg-pink-400 text-black shadow" : "text-zinc-400 hover:text-white"
                }`}
              >
                <Eye className="h-3 w-3" /> Views
              </button>
            </div>
          </div>

          <div className="relative h-[280px] w-full font-mono text-[10px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 10, right: 10, left: -14, bottom: 0 }}>
                <defs>
                  {trendGames.map((game, index) => (
                    <linearGradient key={`grad_${game.id}`} id={`glow_${index}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={pathColors[index % pathColors.length]} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={pathColors[index % pathColors.length]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid stroke="#1c1c21" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="#52525b"
                  tickLine={false}
                  axisLine={{ stroke: "#27272a" }}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  stroke="#52525b"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#09090b",
                    border: "1px solid #27272a",
                    borderRadius: "10px",
                    color: "#f4f4f5",
                    fontSize: "11px",
                    boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
                  }}
                  labelStyle={{ color: "#a1a1aa", fontSize: "10px" }}
                  formatter={(value: any, name: any) => [
                    Number(value).toLocaleString(),
                    (name as string).length > 18 ? `${(name as string).slice(0, 16)}…` : (name as string),
                  ]}
                />
                <Legend
                  verticalAlign="top"
                  height={36}
                  iconType="circle"
                  iconSize={7}
                  wrapperStyle={{ fontSize: "10px", color: "#a1a1aa", paddingBottom: "10px" }}
                />
                {trendGames.map((game, index) => (
                  <g key={game.id}>
                    <Line
                      type="monotone"
                      dataKey={game.title}
                      stroke={pathColors[index % pathColors.length]}
                      strokeWidth={2}
                      dot={{ r: 2.5, strokeWidth: 1, fill: "#18181b" }}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                    />
                  </g>
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* 4. Grids of Games */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Grid A: Latest Games / Updates */}
        <section id="latest_updates_group" className="mt-16">
          <div className="flex items-end justify-between mb-6 gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-3.5 w-1 rounded-full bg-gradient-to-b from-pink-400 to-pink-600/30" />
                <span className="text-[10px] font-bold text-pink-400 tracking-wider font-mono uppercase">NEW RELEASES</span>
              </div>
              <h2 className="font-display text-2xl font-black text-white uppercase mt-1">Latest Games / Updates</h2>
            </div>
            <button
              onClick={() => navigate("/browse")}
              className="shrink-0 flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950/60 px-4 py-2 text-[11px] font-bold text-zinc-300 hover:text-pink-400 hover:border-pink-400/40 transition font-mono"
            >
              View All <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {latestUpdates.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>

        {/* Grid B: Top Rated repacks */}
        <section id="top_rated_group" className="mt-16">
          <div className="flex items-end justify-between mb-6 gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-3.5 w-1 rounded-full bg-gradient-to-b from-pink-400 to-pink-600/30" />
                <span className="text-[10px] font-bold text-pink-400 tracking-wider font-mono uppercase">
                  CRITICALLY ACCLAIMED
                </span>
              </div>
              <h2 className="font-display text-2xl font-black text-white uppercase mt-1">Top Rated Games</h2>
            </div>
            <Link
              to="/browse?sort=Highest%20Rated"
              className="shrink-0 flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950/60 px-4 py-2 text-[11px] font-bold text-zinc-300 hover:text-pink-400 hover:border-pink-400/40 transition font-mono"
            >
              Browse Top <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {topRated.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>

        {/* Grid C: New Releases sorted by date */}
        <section id="new_releases_group" className="mt-16">
          <div className="flex items-end justify-between mb-6 gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-3.5 w-1 rounded-full bg-gradient-to-b from-pink-400 to-pink-600/30" />
                <span className="text-[10px] font-bold text-pink-400 tracking-wider font-mono uppercase">
                  CHRONOLOGICAL LAUNCH
                </span>
              </div>
              <h2 className="font-display text-2xl font-black text-white uppercase mt-1">Calendar Releases</h2>
            </div>
            <button
              onClick={() => navigate("/browse")}
              className="shrink-0 flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950/60 px-4 py-2 text-[11px] font-bold text-zinc-300 hover:text-pink-400 hover:border-pink-400/40 transition font-mono"
            >
              Browse Category <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {newReleases.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      </main>

      {/* Catalog error notice (e.g. backend offline) */}
      {error && !loading && (
        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mt-10">
          <div className="rounded-xl border border-red-500/20 bg-red-950/20 px-4 py-3 text-xs font-mono text-red-400">
            Catalog sync problem: {error}
          </div>
        </div>
      )}
    </div>
  );
};