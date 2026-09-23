import React, { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useScroll, useTransform } from "motion/react";
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
import { Reveal } from "../components/PageHero";
import { Game } from "../types";

/* ---------- helpers ---------- */
const daysSince = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 86_400_000;
};
const isUpdated = (g: Game) => daysSince(g.stats.updatedAt) <= 30;
const NSFW_GENRES = ["nsfw", "porn", "hentai", "adult", "eroge", "erotic"];
const hideNsfw = (list: Game[], showNSFW: boolean): Game[] =>
  showNSFW
    ? list
    : list.filter((g) => !(g.genres || []).some((x) => NSFW_GENRES.includes(x.toLowerCase().trim())));

// Pinned hero carousel — the site's "top games" showcase. Kept in display order;
// each id is a catalog game id (see server catalog). Titles with no catalog
// entry simply drop out and the slot falls back to rated highlights below.
const FEATURED_IDS = [
  "grand-theft-auto-v",
  "wonderful-everyday-down-the-rabbit-hole",
  "cyberpunk-2077",
  "elden-ring",
  "sekiro-shadows-die-twice",
];

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
  const { games, loading, error, getGameSummary, serverBrowse, getFacets, searchGames, showNSFW } =
    useGame();
  const navigate = useNavigate();
  // Server-browse: rails + catalog pulse come from the server query API instead
  // of the (partial) in-memory featured slice.
  const [facets, setFacets] = useState<Awaited<ReturnType<typeof getFacets>> | null>(null);
  const [srv, setSrv] = useState<{
    carousel: Game[];
    rated: Game[];
    popular: Game[];
    newReleases: Game[];
    latest: Game[];
  }>({ carousel: [], rated: [], popular: [], newReleases: [], latest: [] });

  useEffect(() => {
    if (!serverBrowse) return;
    let alive = true;
    Promise.all([
      searchGames({ sort: "rating", limit: 8, nsfw: true }),
      searchGames({ sort: "popular", limit: 8, nsfw: true }),
      searchGames({ sort: "newest", limit: 12, nsfw: true }),
      searchGames({ sort: "updated", limit: 12, nsfw: true }),
      searchGames({ ids: FEATURED_IDS, nsfw: true }),
      getFacets().catch(() => null),
    ])
      .then(([rated, popular, newest, updated, featured, f]) => {
        if (!alive) return;
        if (f) setFacets(f);
        const byId = new Map(featured.games.map((g) => [g.id, g]));
        const carousel: Game[] = FEATURED_IDS
          .map((id) => byId.get(id))
          .filter((g): g is Game => !!g);
        setSrv({
          carousel: hideNsfw(carousel, showNSFW),
          rated: hideNsfw(rated.games, showNSFW),
          popular: hideNsfw(popular.games, showNSFW),
          newReleases: hideNsfw(newest.games, showNSFW),
          latest: hideNsfw(updated.games, showNSFW),
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [serverBrowse, searchGames, getFacets, showNSFW]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  // Cinematic hero: the backdrop drifts slower than the page and the text
  // fades out as you scroll away from the top, so the intro reads as depth.
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroBgY = useTransform(scrollYProgress, [0, 1], ["0%", "24%"]);
  const heroContentOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.12]);

  // Collapse repack-variant duplicates in the showcase rows: same Steam appid
  // (or near-identical title when no appid) appears once, keeping the richest,
  // most recent entry so we don't show 3× "Baldur's Gate" style repeats.
  const uniqueShowcase = (list: Game[]): Game[] => {
    const seen = new Map<string, Game>();
    const key = (g: Game) =>
      typeof g.steamId === "number"
        ? `steam:${g.steamId}`
        : `title:${(g.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim()}`;
    const score = (g: Game) =>
      (g.rating || 0) +
      (g.sourceCount ?? g.downloadSources?.length ?? 0) * 0.01 +
      (g.screenshotCount ?? g.screenshots?.length ?? 0) * 0.001;
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

  const carouselGames = useMemo(() => {
    if (serverBrowse) return srv.carousel;
    const byId = new Map(games.map((g) => [g.id, g] as const));
    const pinned = FEATURED_IDS.map((id) => byId.get(id)).filter((g): g is Game => !!g);
    if (pinned.length) return pinned;
    return [...games].filter((g) => g.rating > 0).sort((a, b) => b.rating - a.rating).slice(0, 5);
  }, [games, serverBrowse, srv]);
  const activeCarouselGame = carouselGames[carouselIndex];

  // Reset the image-failure flag whenever the hero game changes.
  useEffect(() => {
    setHeroImgFailed(false);
  }, [activeCarouselGame?.id]);

  // Descriptions are omitted from the list payload; hydrate the active slide.
  const [carouselSummary, setCarouselSummary] = useState<string>("");
  useEffect(() => {
    const g = activeCarouselGame;
    if (!g) {
      setCarouselSummary("");
      return;
    }
    if (g.summary) {
      setCarouselSummary(g.summary);
      return;
    }
    if (!g.hasSummary) {
      setCarouselSummary("");
      return;
    }
    let cancelled = false;
    getGameSummary(g.id)
      .then((s) => {
        if (!cancelled) setCarouselSummary(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeCarouselGame?.id, getGameSummary]);

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
    () =>
      serverBrowse
        ? srv.latest
        : [...games].sort((a, b) => b.stats.updatedAt.localeCompare(a.stats.updatedAt)).slice(0, 12),
    [games, serverBrowse, srv]
  );
  const popularGames = useMemo(
    () =>
      serverBrowse
        ? uniqueShowcase(srv.popular).slice(0, 8)
        : uniqueShowcase([...games].sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0))).slice(0, 8),
    [games, serverBrowse, srv]
  );
  const topRated = useMemo(
    () =>
      serverBrowse
        ? uniqueShowcase(srv.rated).slice(0, 4)
        : uniqueShowcase([...games].filter((g) => g.rating > 0).sort((a, b) => b.rating - a.rating)).slice(0, 4),
    [games, serverBrowse, srv]
  );
  const newReleases = useMemo(() => {
    if (serverBrowse) return srv.newReleases;
    const parseTime = (d: string) => {
      const t = Date.parse(d || "");
      return Number.isNaN(t) ? -Infinity : t;
    };
    const withDate = games.filter((g) => !Number.isNaN(parseTime(g.releaseDate)));
    return [...withDate].sort((a, b) => parseTime(b.releaseDate) - parseTime(a.releaseDate)).slice(0, 12);
  }, [games, serverBrowse, srv]);

  const genreCounts = useMemo(() => {
    if (serverBrowse && facets) return facets.genres.slice(0, 6).map((g) => [g.name, g.count] as [string, number]);
    const map = new Map<string, number>();
    games.forEach((g) => (g.genres || []).forEach((x) => map.set(x, (map.get(x) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [games, serverBrowse, facets]);

  // Marquee ticker band uses a wider genre sweep, doubled for the loop.
  const marqueeGenres = useMemo(() => {
    if (serverBrowse && facets) return facets.genres.slice(0, 24).map((g) => [g.name, g.count] as [string, number]);
    const map = new Map<string, number>();
    games.forEach((g) => (g.genres || []).forEach((x) => map.set(x, (map.get(x) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
  }, [games, serverBrowse, facets]);

  // Live catalog pulse — numbers computed from the loaded index (or the server
  // facets in server-browse mode).
  const catalogStats = useMemo(() => {
    if (serverBrowse && facets) {
      return {
        games: facets.total,
        genres: facets.genreCount ?? facets.genres.length,
        downloads: facets.downloads ?? 0,
        updated30: facets.updated30 ?? 0,
      };
    }
    const genres = new Set<string>();
    let downloads = 0;
    let updated30 = 0;
    for (const g of games) {
      (g.genres || []).forEach((x) => genres.add(x));
      downloads += g.stats?.downloads ?? 0;
      if (isUpdated(g)) updated30++;
    }
    return { games: games.length, genres: genres.size, downloads, updated30 };
  }, [games, serverBrowse, facets]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-10 px-4 py-14 sm:px-6 lg:px-8">
        <div className="skeleton h-[60vh] w-full rounded-2xl" />
        <div className="skeleton h-6 w-64" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[3/4]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div id="home_view" className="relative pb-16">
      {/* 1. Hero carousel */}
      {activeCarouselGame && (
        <section
          ref={heroRef}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          className="relative -mt-17 h-[78vh] min-h-[520px] w-full overflow-hidden border-b border-white/5 bg-black"
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
              <div className="absolute inset-0 z-10 bg-gradient-to-t from-[var(--color-dark-bg)] via-[var(--color-dark-bg)]/35 via-45% to-transparent" />
              <div className="absolute inset-0 z-10 bg-gradient-to-r from-[var(--color-dark-bg)]/85 via-[var(--color-dark-bg)]/20 via-40% to-[var(--color-dark-bg)]/10" />
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
                  decoding="async"
                  initial={{ scale: 1.06 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 9, ease: "easeOut" }}
                  style={{ y: heroBgY }}
                  onError={() => setHeroImgFailed(true)}
                  className="h-full w-full object-cover opacity-60 saturate-[0.9]"
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* Ambient color wash — long, diffuse fade so it reads as atmosphere, not a patch */}
          <div className="aurora-blob aurora-blob-soft bottom-[-30%] left-[-14%] h-[55vh] w-[48vw] bg-rose-600/10" />
          <div className="aurora-blob aurora-blob-soft right-[-18%] top-[-38%] h-[65vh] w-[42vw] bg-rose-500/[0.08]" />

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

          <motion.div className="absolute inset-0 z-20 mx-auto flex max-w-7xl flex-col justify-end px-4 pb-20 sm:px-6 lg:px-8" style={{ opacity: heroContentOpacity }}>
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
              className="max-w-3xl font-display text-4xl font-extrabold uppercase leading-[1.05] tracking-tight text-gradient text-gradient-animate md:text-6xl line-clamp-2"
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
              {carouselSummary}
            </motion.p>

            <motion.div
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.42 }}
              className="mt-8 flex flex-wrap gap-3"
            >
              <Link
                to={`/game/${activeCarouselGame.id}`}
                className="btn-sheen cta-breathe flex items-center gap-2 rounded-full bg-rose-500 px-7 py-3 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-rose-400"
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
          </motion.div>

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
                  <img src={g.coverImage} alt={g.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <PlaceholderCover title={g.title} className="p-2 [&_span:first-child]:text-sm" />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Genre ticker band */}
      {marqueeGenres.length > 0 && (
        <section className="marquee-paused marquee-mask relative overflow-hidden border-b border-white/5 bg-[#0b0b0e]/80 py-3">
          <div className="animate-marquee flex w-max items-center gap-8 whitespace-nowrap px-4">
            {[...marqueeGenres, ...marqueeGenres].map(([genre, count], i) => (
              <button
                key={`${genre}-${i}`}
                onClick={() => navigate(`/browse?genre=${encodeURIComponent(genre)}`)}
                className="group flex items-center gap-2 font-mono text-xs text-zinc-500 transition hover:text-rose-400"
              >
                <span className="font-bold uppercase tracking-widest">{genre}</span>
                <span className="text-[10px] text-zinc-700 transition group-hover:text-rose-500/70">
                  {count.toLocaleString()}
                </span>
                <span className="text-rose-500/40">✦</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Live catalog pulse — a data strip beneath the hero */}
      <section className="border-b border-white/5 bg-[#0b0b0d]/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-4 sm:px-6 lg:px-8">
          <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live index
          </span>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <span className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">Indexed games</span>
              <span className="font-display text-lg font-bold text-white">
                {catalogStats.games.toLocaleString()}
              </span>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">Genres</span>
              <span className="font-display text-lg font-bold text-white">
                {catalogStats.genres.toLocaleString()}
              </span>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">Updated 30d</span>
              <span className="font-display text-lg font-bold text-emerald-400">
                {catalogStats.updated30.toLocaleString()}
              </span>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">Downloads (indexed)</span>
              <span className="font-display text-lg font-bold text-rose-400">
                {catalogStats.downloads.toLocaleString()}
              </span>
            </span>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* 2. Latest releases rail */}
        <Reveal>
          <section className="mt-14">
            <SectionHeader
              eyebrow="✦ Latest Games"
              title="Latest Releases"
              action={{ label: "View all games", to: "/browse" }}
            />
            <Rail>
              {latestGames.map((g) => (
                <div key={g.id} className="w-48 shrink-0 sm:w-52">
                  <GameCard game={g} />
                </div>
              ))}
            </Rail>
          </section>
        </Reveal>

        {/* 3. Trending grid */}
        <Reveal delay={0.05}>
          <section className="mt-16">
            <SectionHeader
              eyebrow="✦ Trending Games"
              title="Trending Now"
              action={{ label: "Browse top", to: "/browse?sort=popular" }}
            />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {popularGames.map((g) => (
                <GameCard key={g.id} game={g} />
              ))}
            </div>
          </section>
        </Reveal>

        {/* 4. Top rated leaderboard */}
        <Reveal delay={0.05}>
          <section className="mt-16">
          <SectionHeader
            eyebrow="✦ Critically Acclaimed"
            title="Top Rated"
            action={{ label: "Highest rated", to: "/browse?sort=rating" }}
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
                      decoding="async"
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
        </Reveal>

        {/* 5. Featured Collections */}
        <Reveal delay={0.05}>
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
                  onClick={() => navigate(`/browse?genre=${encodeURIComponent(genre)}`)}
                  className="group relative h-36 overflow-hidden rounded-2xl text-left ring-1 ring-white/[0.06] transition hover:-translate-y-0.5 hover:ring-rose-500/40 hover:shadow-2xl hover:shadow-black"
                  style={{
                    background: `linear-gradient(135deg, hsl(${hue} 55% 24%), hsl(${hue2} 60% 9%) 65%)`,
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[radial-gradient(120%_120%_at_20%_0%,rgba(255,255,255,0.16),transparent_55%)]" />
                  <div className="absolute -inset-px opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[conic-gradient(from_180deg_at_50%_-20%,transparent_0deg,rgba(244,63,94,0.35)_120deg,transparent_260deg)]" />
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
        </Reveal>

        {/* 6. New releases rail */}
        <Reveal delay={0.05}>
          <section className="mt-16">
            <SectionHeader
              eyebrow="✦ Fresh Off The Press"
              title="New Releases"
              action={{ label: "View all", to: "/browse" }}
            />
            <Rail>
              {newReleases.map((g) => (
                <div key={g.id} className="w-48 shrink-0 sm:w-52">
                  <GameCard game={g} />
                </div>
              ))}
            </Rail>
          </section>
        </Reveal>
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