import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Layers3, Search } from "lucide-react";
import { PageHero, Reveal } from "../components/PageHero";
import { PlaceholderCover } from "../components/GameCard";
import { useGame } from "../lib/gameContext";
import { SeriesSummary } from "../types";

type FilterTab = "all" | "featured";

const ITEMS_PER_PAGE = 10;

export const CollectionsView: React.FC = () => {
  const { getSeries } = useGame();
  const [serverSeries, setServerSeries] = useState<SeriesSummary[] | null>(null);
  const [serverTotal, setServerTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>("all");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState<number>(1);
  const [sort, setSort] = useState<"auto" | "alpha">("auto");
  const lastNonEmptySeries = useRef<SeriesSummary[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [tab, debouncedQ, sort]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const offset = (page - 1) * ITEMS_PER_PAGE;
    (async () => {
      try {
        const res = await getSeries({
          limit: ITEMS_PER_PAGE,
          offset,
          curated: tab === "featured",
          q: debouncedQ || undefined,
        });
        if (!active) return;
        const list = res.series ?? [];
        setServerSeries(list);
        setServerTotal(res.total ?? 0);
        lastNonEmptySeries.current = list;
        setError(null);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message ?? "Failed to load collections.");
        setServerSeries(lastNonEmptySeries.current);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, tab, debouncedQ, sort]);

  const curatedCount = serverTotal;
  const displayTotal = serverSeries ? serverTotal : lastNonEmptySeries.current.length;
  const totalPages = Math.max(1, Math.ceil(serverTotal / ITEMS_PER_PAGE));

  useEffect(() => {
    setPage((p) => Math.max(1, Math.min(p, totalPages)));
  }, [totalPages]);

  const safePage = Math.max(1, Math.min(page, totalPages));
  const effectiveList = serverSeries ?? lastNonEmptySeries.current;

  const visible = useMemo(() => {
    let list = effectiveList;
    if (sort === "alpha") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name, "en"));
    }
    return list;
  }, [effectiveList, sort]);

  const scrollTop = () => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "auto" });
  };

  const tabCls =
    "rounded-full border px-4 py-1.5 font-mono text-[11px] font-bold transition";
  const tabActiveCls = "border-rose-500/40 bg-rose-500/10 text-rose-400";
  const tabIdleCls = "border-white/10 bg-[#0d0d10] text-zinc-400 hover:border-white/25 hover:text-white";

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
                className={`rounded-full px-4 py-1.5 font-mono text-[11px] font-bold transition ${
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
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "auto" | "alpha")}
          className="rounded-lg border border-white/10 bg-[#0d0d10] px-3 py-2 font-mono text-xs font-bold text-zinc-300 outline-none transition focus:border-rose-500/40"
          aria-label="Sort series"
        >
          <option value="auto">Sort: Auto</option>
          <option value="alpha">Sort: A–Z</option>
        </select>
      </div>

      <p className="text-center font-mono text-[11px] text-zinc-500">
        {displayTotal.toLocaleString()} series
      </p>

      {loading && serverSeries === null && (
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
          {debouncedQ ? `No series match “${debouncedQ}”.` : "No series found."}
        </p>
      )}

      {visible.length > 0 && (
        <div id="series_grid" className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {visible.map((s, i) => (
            <Reveal key={s.id} delay={(i % 8) * 25}>
              <SeriesCard s={s} />
            </Reveal>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <button
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
              scrollTop();
            }}
            disabled={page === 1}
            className="rounded-lg border border-white/10 bg-[#0d0d10] px-3.5 py-1.5 font-mono text-xs font-bold text-zinc-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
            .map((p, idx, arr) => {
              const prev = arr[idx - 1];
              if (prev !== undefined && p - prev > 1) {
                return (
                  <span key={`gap-${p}`} className="px-1 font-mono text-xs text-zinc-600">
                    …
                  </span>
                );
              }
              return (
                <button
                  key={p}
                  onClick={() => {
                    setPage(p);
                    scrollTop();
                  }}
                  className={`rounded-lg border px-3.5 py-1.5 font-mono text-xs font-bold transition ${
                    p === page
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
                      : "border-white/10 bg-[#0d0d10] text-zinc-400 hover:text-white"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          <button
            onClick={() => {
              setPage((p) => Math.min(totalPages, p + 1));
              scrollTop();
            }}
            disabled={page === totalPages}
            className="rounded-lg border border-white/10 bg-[#0d0d10] px-3.5 py-1.5 font-mono text-xs font-bold text-zinc-400 transition hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
};

const SeriesCard: React.FC<{ s: SeriesSummary }> = ({ s }) => {
  const covers = Array.isArray(s.covers) ? s.covers : [];
  const cellCls =
    "aspect-[3/4] w-full rounded-lg border border-white/5 bg-[#0d0d10] object-cover";
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
