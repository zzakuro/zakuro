import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Layers3, Search } from "lucide-react";
import { PageHero, Reveal } from "../components/PageHero";
import { PlaceholderCover } from "../components/GameCard";
import { useGame } from "../lib/gameContext";
import { SeriesSummary } from "../types";

type FilterTab = "all" | "featured";
type SortMode = "auto" | "alpha";

const ITEMS_PER_PAGE = 10;

const tabActiveCls =
  "border-rose-500/40 bg-rose-500/10 text-rose-400";
const tabIdleCls =
  "border-white/10 bg-[#0d0d10] text-zinc-400 hover:border-white/25 hover:text-white";
const cellCls =
  "aspect-[3/4] w-full rounded-lg border border-white/5 bg-[#0d0d10] object-cover";

export const CollectionsView: React.FC = () => {
  const { getSeries } = useGame();
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>("all");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<SortMode>("auto");
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetchSeq = useRef(0);

  const hasMore = series.length < serverTotal;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const loadFirst = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getSeries({
        limit: ITEMS_PER_PAGE,
        offset: 0,
        curated: tab === "featured",
        q: debouncedQ || undefined,
      });
      if (seq !== fetchSeq.current) return;
      setSeries(Array.isArray(res.series) ? res.series : []);
      setServerTotal(res.total ?? 0);
    } catch (e: any) {
      if (seq !== fetchSeq.current) return;
      setError(e?.message ?? "Failed to load collections.");
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, debouncedQ]);

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore) return;
    if (series.length >= serverTotal) return;
    const seq = fetchSeq.current;
    setLoadingMore(true);
    try {
      const res = await getSeries({
        limit: ITEMS_PER_PAGE,
        offset: series.length,
        curated: tab === "featured",
        q: debouncedQ || undefined,
      });
      if (seq !== fetchSeq.current) return;
      const more = Array.isArray(res.series) ? res.series : [];
      setServerTotal(res.total ?? serverTotal);
      setSeries((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...more.filter((s) => !seen.has(s.id))];
      });
    } catch (e: any) {
      if (seq !== fetchSeq.current) return;
      // keep existing rows on load-more failure
    } finally {
      if (seq === fetchSeq.current) setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingMore, series.length, serverTotal, tab, debouncedQ]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || loading) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, series.length, tab, debouncedQ]);

  const visible = useMemo(() => {
    let list = series;
    if (sort === "alpha") {
      list = [...series].sort((a, b) => a.name.localeCompare(b.name, "en"));
    }
    return list;
  }, [series, sort]);

  const formatCount = (n: number) => n.toLocaleString();

  return (
    <div id="collections_view" className="mx-auto max-w-7xl space-y-12 px-4 py-12 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="🎮 Series & Collections"
        title={
          <>
            Explore <span className="text-gradient">Series</span>
          </>
        }
        lead="Every franchise in the archive, grouped under one roof — from Grand Theft Auto and Call of Duty to the auto-detected series that keep appearing across the index."
      >
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <div className="inline-flex rounded-full border border-white/10 bg-[#0d0d10] p-1">
            {(["all", "featured"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-full border px-4 py-1.5 font-mono text-[11px] font-bold transition ${
                  tab === t ? tabActiveCls : tabIdleCls
                }`}
              >
                {t === "all" ? "All Series" : "Featured"}
              </button>
            ))}
          </div>
        </div>
      </PageHero>

      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <label className="relative w-full max-w-md">
          <span className="sr-only">Search series</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search series…"
            className="w-full rounded-lg border border-white/10 bg-[#0d0d10] py-2 pl-9 pr-3 font-mono text-xs text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-rose-500/40"
          />
        </label>
        <button
          onClick={() => setSort(sort === "alpha" ? "auto" : "alpha")}
          className="rounded-lg border border-white/10 bg-[#0d0d10] px-3 py-2 font-mono text-xs font-bold text-zinc-400 transition hover:text-white"
        >
          {sort === "alpha" ? "Sort: A–Z" : "Sort: Auto"}
        </button>
      </div>

      <p className="text-center font-mono text-[11px] text-zinc-500">
        {formatCount(serverTotal)} series
      </p>

      {loading && (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-rose-500/40 border-t-rose-400" />
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-center font-mono text-xs text-rose-300">
          {error}
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <p className="text-center font-mono text-sm text-zinc-500">
          {query ? `No series match “${query}”.` : "No series found."}
        </p>
      )}

      {!loading && visible.length > 0 && (
        <div id="series_grid" className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {visible.map((s, i) => (
            <Reveal key={s.id} delay={(i % 8) * 25}>
              <SeriesCard s={s} />
            </Reveal>
          ))}

          <div ref={sentinelRef} id="series_sentinel" className="h-1" aria-hidden="true" />

          {loadingMore && (
            <div className="col-span-full flex justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-rose-500/40 border-t-rose-400" />
            </div>
          )}

          {!hasMore && series.length > 0 && (
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="col-span-full mx-auto rounded-lg border border-white/10 bg-[#0d0d10] px-4 py-2 font-mono text-xs font-bold text-zinc-400 transition hover:text-white"
            >
              {formatCount(serverTotal)} series loaded — back to top ↑
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const SeriesCard: React.FC<{ s: SeriesSummary }> = ({ s }) => {
  const covers = Array.isArray(s.covers) ? s.covers : [];
  return (
    <Link
      to={`/collections/${s.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[#101015] transition hover:border-rose-500/40 hover:bg-[#141419]"
    >
      <div className="grid grid-cols-2 overflow-hidden">
        {covers.length > 0 ? (
          covers.slice(0, 4).map((c, i) => (
            <img key={i} src={c} alt="" loading="lazy" className={cellCls} />
          ))
        ) : (
          <>
            <PlaceholderCover title={s.name} className={cellCls} />
            <PlaceholderCover title={s.name} className={cellCls} />
          </>
        )}
      </div>
      {covers.length === 3 && (
        <PlaceholderCover title={s.name} className={cellCls} />
      )}
      <div className="flex flex-1 flex-col gap-1.5 p-4 pt-3">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-zinc-100">
            {s.name}
          </span>
          {s.curated && (
            <span className="shrink-0 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
              ★
            </span>
          )}
        </div>
        {s.badge && (
          <span className="w-fit rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-300">
            {s.badge}
          </span>
        )}
        <span className="font-mono text-[11px] text-zinc-500">
          {s.count} {s.count === 1 ? "game" : "games"}
        </span>
        <span className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-rose-400 opacity-0 transition group-hover:opacity-100">
          View series <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
};