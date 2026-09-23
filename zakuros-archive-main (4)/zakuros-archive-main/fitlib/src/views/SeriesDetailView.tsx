import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronDown, Search, X, Layers3, Star } from "lucide-react";
import { useGame } from "../lib/gameContext";
import { GameCard, PlaceholderCover } from "../components/GameCard";
import { SeriesGroup } from "../types";

const NSFW_GENRES = ["nsfw", "porn", "hentai", "adult", "eroge", "erotic"];

type SortKey = "popular" | "rating" | "newest" | "az";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "popular", label: "Most Popular" },
  { key: "rating", label: "Highest Rated" },
  { key: "newest", label: "Newest" },
  { key: "az", label: "A–Z" },
];

const SORT_KEY_TO_LABEL: Record<SortKey, string> = Object.fromEntries(
  SORT_OPTIONS.map((o) => [o.key, o.label])
) as Record<SortKey, string>;

export const SeriesDetailView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { getSeriesGames, showNSFW } = useGame();
  const [group, setGroup] = useState<SeriesGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("popular");
  const [heroCoverFailed, setHeroCoverFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setGroup(null);
    getSeriesGames(id)
      .then((g) => {
        if (alive) setGroup(g);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, getSeriesGames]);

  const covers = useMemo(() => {
    if (!group) return [] as string[];
    const seen: string[] = [];
    for (const g of group.games) {
      if (g.coverImage && !seen.includes(g.coverImage)) {
        seen.push(g.coverImage);
        if (seen.length >= 4) break;
      }
    }
    return seen;
  }, [group]);

  const visibleGames = useMemo(() => {
    if (!group) return [];
    const list = showNSFW
      ? group.games
      : group.games.filter(
          (g) => !(g.genres || []).some((x) => NSFW_GENRES.includes(x.toLowerCase().trim()))
        );
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (g) =>
            (g.title || "").toLowerCase().includes(q) ||
            (g.developer || "").toLowerCase().includes(q) ||
            (g.genres || []).some((x) => x.toLowerCase().includes(q))
        )
      : list;
    const parseTime = (d: string) => {
      const t = Date.parse(d || "");
      return Number.isNaN(t) ? -Infinity : t;
    };
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "rating":
          return (b.rating ?? 0) - (a.rating ?? 0);
        case "newest":
          return parseTime(b.releaseDate) - parseTime(a.releaseDate);
        case "az":
          return a.title.localeCompare(b.title);
        default:
          return (b.popularityScore ?? 0) - (a.popularityScore ?? 0);
      }
    });
  }, [group, query, sortBy, showNSFW]);

  const nsfwHidden = useMemo(() => {
    if (!group || showNSFW) return 0;
    return group.games.filter((g) =>
      (g.genres || []).some((x) => NSFW_GENRES.includes(x.toLowerCase().trim()))
    ).length;
  }, [group, showNSFW]);

  const heroSrc = covers[0] || "";
  const showHeroBackdrop = !heroSrc || heroCoverFailed;

  const featured = visibleGames[0];

  return (
    <div id="series_detail_view" className="relative pb-16">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-white/5 bg-black">
        {showHeroBackdrop ? (
          <div className="absolute inset-0 opacity-60 blur-[2px]">
            <div className="h-full w-full bg-[radial-gradient(120%_140%_at_50%_0%,hsl(350_70%_22%),transparent_60%),radial-gradient(80%_80%_at_80%_90%,hsl(260_60%_18%),transparent_50%)]" />
            {featured && <PlaceholderCover title={featured.title} className="opacity-40" />}
          </div>
        ) : (
          <img
            src={heroSrc}
            alt=""
            referrerPolicy="no-referrer"
            decoding="async"
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 saturate-[0.85]"
            onError={() => setHeroCoverFailed(true)}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-dark-bg)] via-[var(--color-dark-bg)]/55 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-dark-bg)]/80 via-transparent to-[var(--color-dark-bg)]/30" />
        <div className="aurora-blob aurora-blob-soft left-[-16%] top-[-30%] h-[55vh] w-[44vw] bg-rose-500/[0.1]" />
        <div className="aurora-blob aurora-blob-soft right-[-18%] bottom-[-40%] h-[55vh] w-[40vw] bg-violet-500/[0.07]" />

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-6 px-4 py-16 sm:px-6 lg:px-8">
          <Link
            to="/collections"
            className="flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3.5 py-1.5 font-mono text-[11px] font-bold text-zinc-400 backdrop-blur-sm transition hover:border-rose-500/40 hover:text-white"
          >
            <ArrowLeft className="h-3 w-3" />
            All collections
          </Link>

          <div className="flex items-center gap-2">
            {group?.curated && group.badge ? (
              <span className="rounded-md bg-rose-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white ring-1 ring-black/20">
                {group.badge}
              </span>
            ) : null}
            {group && !group.curated ? (
              <span className="rounded-md bg-black/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-300 ring-1 ring-white/10 backdrop-blur-sm">
                Auto grouped
              </span>
            ) : null}
            <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 font-mono text-[10px] font-bold text-zinc-300 ring-1 ring-white/10">
              <Layers3 className="h-3 w-3 text-rose-400" />
              {group ? `${group.total ?? group.games.length} titles` : "\u00a0"}
            </span>
          </div>

          {loading ? (
            <>
              <div className="skeleton h-12 w-72 max-w-full" />
              <div className="skeleton h-4 w-full max-w-xl" />
            </>
          ) : group ? (
            <>
              <h1 className="max-w-3xl font-display text-4xl font-black uppercase leading-[1.05] tracking-tight text-gradient sm:text-6xl">
                {group.name}
              </h1>
              {group.description && (
                <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">{group.description}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {featured && (
                  <>
                    <span className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] font-bold text-rose-400 ring-1 ring-white/10">
                      <Star className="h-3 w-3 fill-rose-400" />
                      {featured.rating > 0 ? `${featured.rating}%` : "—"}
                    </span>
                    <span className="rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-zinc-400 ring-1 ring-white/10">
                      {featured.genres?.[0] ?? "Game"}
                    </span>
                    {featured.fileSize && (
                      <span className="rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-zinc-400 ring-1 ring-white/10">
                        {featured.fileSize}
                      </span>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <p className="font-mono text-sm text-zinc-500">Series not found.</p>
          )}
        </div>
      </section>

      {loading && (
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton aspect-[3/4]" />
            ))}
          </div>
        </div>
      )}

      {!loading && !group && (
        <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-4 py-20 text-center">
          <Layers3 className="h-10 w-10 text-zinc-700" />
          <h2 className="font-display text-xl font-bold text-white">Series not found</h2>
          <p className="text-xs text-zinc-500">
            That collection doesn't exist — it may have been renamed or merged.
          </p>
          <Link
            to="/collections"
            className="mt-2 flex items-center gap-1.5 rounded-full bg-rose-500 px-5 py-2 font-mono text-xs font-bold text-white transition hover:bg-rose-400"
          >
            Back to collections
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      {!loading && group && (
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          {/* Controls */}
          <div className="mb-8 flex flex-col gap-4 border-b border-white/5 pb-6 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-xs">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${group.name}…`}
                className="focus-glow w-full rounded-full border border-white/10 bg-[#0d0d10] py-2.5 pl-10 pr-9 text-xs text-white outline-none transition placeholder-zinc-600 focus:border-rose-500/50"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-4">
              <p className="font-mono text-xs text-zinc-500">
                Showing <span className="font-bold text-rose-400">{visibleGames.length}</span>
                {group.total ? ` of ${group.total}` : ""}
                {!query && nsfwHidden > 0 ? (
                  <span className="text-zinc-600"> · {nsfwHidden} NSFW hidden</span>
                ) : null}
              </p>

              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  aria-label="Sort series"
                  className="focus-glow appearance-none rounded-full border border-white/10 bg-[#0d0d10] py-2.5 pl-4 pr-10 text-xs font-semibold text-zinc-300 outline-none transition focus:border-rose-500/50"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      Sort: {SORT_KEY_TO_LABEL[o.key]}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              </div>
            </div>
          </div>

          {visibleGames.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
              <Search className="mb-4 h-10 w-10 text-zinc-700" />
              <h3 className="font-display text-sm font-bold text-zinc-300">No matches</h3>
              <p className="mt-2 max-w-sm text-xs text-zinc-500">
                No titles in this series matched "{query}". Try a different search term.
              </p>
              <button
                onClick={() => setQuery("")}
                className="mt-5 rounded-full border border-white/10 bg-[#0d0d10] px-4 py-2 text-xs font-bold text-white transition hover:border-rose-500/40"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {visibleGames.map((game, i) => (
                <div key={game.id} className="card-enter h-full" style={{ animationDelay: `${(i % 12) * 28}ms` }}>
                  <GameCard game={game} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};