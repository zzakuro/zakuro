import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Layers3, Search, Loader2 } from "lucide-react";
import { PageHero, Reveal } from "../components/PageHero";
import { PlaceholderCover } from "../components/GameCard";
import { useGame } from "../lib/gameContext";
import { SeriesSummary } from "../types";

type FilterTab = "all" | "featured";

const ITEMS_PER_PAGE = 10;

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
  const [sort, setSort] = useState<"auto" | "alpha">("auto");
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetchSeq = useRef(0);
  const resetting = useRef(falseprop);
  const hasMore = series.length < serverTotal;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [tab, debouncedQ, sort]);

  const loadFirstPage = useCallback(async () => {
    const seq = ++fetchSeq.current;
    resetting.current = true;
    setLoading(true);
    setError(null);
    setSeries([]);
    setServerTotal(0);
    try {
      const res = await getSeries({
        limit: ITEMS_PER_PAGE,
        offset: 0,
        curated: tab === "featured",
        minCount: 1,
        q: debouncedQ || undefined,
      });
      if (seq !== fetchSeq.current) return;
      setSeries(Array.isArray(res.series) ? res.series : []);
      setServerTotal(res.total ?? 0);
      setError(null);
    } catch (e: any) {
      if (seq !== fetchSeq.current) return;
      setError(e?.message ?? "Failed to load collections.");
      setSeries([]);
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, debouncedQ, sort]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (resetting.current || loadingMore || !hasMore || loading) return;
    const seq = fetchSeq.current;
    setLoadingMore(true);
    try {
      const res = await getSeries({
        limit: ITEMS_PER_PAGE,
        offset: series.length,
        curated: tab === "featured",
        minCount: 1,
        q: debouncedQ || undefined,
      });
      if (seq !== fetchSeq.current) return;
      const more = Array.isArray(res.series) ? res.series : [];
      setServerTotal(res.total ?? serverTotal);
      setSeries((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...more.filter((x) => !seen.has(x.id))];
      });
    } catch {
      // silently retry on next sentinel hit
    } finally {
      if (seq === fetchSeq.current) setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, hasMore, loading, series.length, tab, debouncedQ, serverTotal]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const visibleList = useMemo(() => {
    let list = series;
    if (sort === "alpha") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name, "en"));
    }
    return list;
  }, [series, sort]);

  const scrollTop = () => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "auto" });
  };

  const tabCls =
    "rounded-full border px-4 py-1.5 font-mono text-[11px] font-bold transition";
  const tabActiveCls = "border-rose-500/40 bg-rose-500/10 text-rose-400";
  const tabIdleCls = "border-white/10 bg-[#0d0d10] text-zinc-400 hover:border-white/25 hover:text-white";

  return (
    <div id="collections_view" className="mx-auto max-w-7xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="🕹️ Series & Collections"
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
                onClick={() => {
                  setTab(t);
                  scrollTop();
                }}
                className={`${tabCls} ${tab === t ? tabActiveCls : tabIdleCls}`}
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSort(sort === "alpha" ? "auto" : "alpha");
              scrollTop();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0d0d10] px-3 py-2 font-mono text-xs font-bold text-zinc-400 transition hover:text-white"
            title="Toggle A–Z sort"
          >
            <Layers3 className="h-3.5 w-3.5" />
            {sort === "alpha" ? "A–Z" : "Auto"}
          </button>
        </div>
      </div>

      <p className="text-center font-mono text-[11px] text-zinc-500">
        {serverTotal.toLocaleString()} series
        {hasMore ? (
          <span className="text-zinc-600"> · showing {series.length.toLocaleString()}</span>
        ) : null}
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

      {!loading && !error && visibleList.length === 0 && (
        <p className="text-center font-mono text-sm text-zinc-500">
          {debouncedQ ? `No series match “${debouncedQ}”.` : "No series found."}
        </p>
      )}

      {visibleList.length > 0 && (
        <div id="series_grid" className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {visibleList.map((s, i) => (
            <Reveal key={s.id} delay={(i % 8) * 25}>
              <SeriesCard s={s} />
            </Reveal>
          ))}

          <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

          {loadingMore && (
            <div className="col-span-full flex items-center justify-center gap-2 py-8 font-mono text-[11px] text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading more…
            </div>
          )}

          {!hasMore && series.length > 0 && (
            <button
              onClick={scrollTop}
              className="col-span-full my-4 mx-auto flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d0d10] px-5 py-3 font-mono text-xs font-bold text-zinc-300 transition hover:border-rose-500/40 hover:text-white"
            >
              All {serverTotal.toLocaleString()} series loaded <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const cellCls =
  "aspect-[3/4] w-full rounded-lg border border-white/5 bg-[#0d0d10] object-cover";

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
      {covers.length === 3 && <PlaceholderCover title={s.name} className={cellCls} />}
      {covers.length === 2 && (
        <div className="grid grid-cols-2">
          <PlaceholderCover title={s.name} className={cellCls} />
          <PlaceholderCover title={s.name} className={cellCls} />
        </div>
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
