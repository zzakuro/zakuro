import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Layers3 } from "lucide-react";
import { PageHero, Reveal } from "../components/PageHero";
import { PlaceholderCover } from "../components/GameCard";
import { useGame } from "../lib/gameContext";
import { SeriesSummary } from "../types";

type FilterTab = "all" | "featured";

export const CollectionsView: React.FC = () => {
  const { getSeries } = useGame();
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getSeries();
      setSeries(list);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load collections.");
      setSeries(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    if (!series) return [];
    const list = tab === "featured" ? series.filter((s) => s.curated) : series;
    // Keep the server's order (curated first, then largest auto-series).
    return list;
  }, [series, tab]);

  const curatedCount = useMemo(
    () => (series ? series.filter((s) => s.curated).length : 0),
    [series]
  );
  const gameCount = useMemo(
    () => (series ? series.reduce((acc, s) => acc + s.count, 0) : 0),
    [series]
  );

  const tabCls =
    "rounded-full border px-4 py-1.5 font-mono text-[11px] font-bold transition";
  const tabActiveCls = "border-rose-500/40 bg-rose-500/10 text-rose-400";
  const tabIdleCls = "border-white/10 bg-[#0d0d10] text-zinc-400 hover:border-white/25 hover:text-white";

  return (
    <div id="collections_view" className="mx-auto max-w-7xl space-y-12 px-4 py-12 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="✦ Series & Collections"
        title={
          <>
            Explore <span className="text-gradient">Series</span>
          </>
        }
        lead="Every franchise in the archive, grouped under one roof — from Grand Theft Auto and Call of Duty to the auto-detected series that keep appearing across the index."
      >
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => setTab("all")}
            className={`${tabCls} ${tab === "all" ? tabActiveCls : tabIdleCls}`}
          >
            All
          </button>
          <button
            onClick={() => setTab("featured")}
            className={`${tabCls} ${tab === "featured" ? tabActiveCls : tabIdleCls}`}
          >
            Featured <span className="ml-1 opacity-60">{curatedCount}</span>
          </button>
        </div>
      </PageHero>

      {/* Quick stats strip */}
      {!loading && !error && series && series.length > 0 && (
        <section className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 border-b border-white/5 pb-8 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          <span>
            <span className="font-display text-lg font-bold text-white">{series.length}</span> collections
          </span>
          <span>
            <span className="font-display text-lg font-bold text-rose-400">{gameCount.toLocaleString()}</span> grouped titles
          </span>
          <span>
            <span className="font-display text-lg font-bold text-white">{curatedCount}</span> featured franchises
          </span>
        </section>
      )}

      {loading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[3/4]" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="mx-auto max-w-md rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-6 text-center">
          <p className="font-mono text-xs text-amber-400">Couldn't load collections: {error}</p>
          <button
            onClick={load}
            className="mt-4 rounded-full bg-rose-500 px-5 py-2 font-mono text-xs font-bold text-white transition hover:bg-rose-400"
          >
            TRY AGAIN
          </button>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <p className="py-16 text-center font-mono text-xs text-zinc-500">
          No collections match this filter yet.
        </p>
      )}

      {!loading && !error && visible.length > 0 && (
        <Reveal>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((s, i) => (
              <div key={s.id} className="card-enter h-full" style={{ animationDelay: `${(i % 12) * 28}ms` }}>
                <SeriesCard series={s} />
              </div>
            ))}
          </div>
        </Reveal>
      )}
    </div>
  );
};

const SeriesCard: React.FC<{ series: SeriesSummary }> = ({ series }) => {
  const covers = (series.covers || []).slice(0, 4);
  return (
    <Link
      to={`/collections/${series.id}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-[#0d0d10] ring-1 ring-white/[0.06] transition duration-300 hover:-translate-y-1 hover:ring-rose-500/50 hover:shadow-2xl hover:shadow-rose-950/20"
    >
      {/* Cover collage — lead cover as a backdrop, secondary covers stacked */}
      <div className="relative aspect-[3/2] w-full overflow-hidden bg-zinc-900">
        {covers[0] ? (
          <img
            src={covers[0]}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 transition duration-500 group-hover:scale-125"
          />
        ) : (
          <PlaceholderCover title={series.name} className="p-5" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0d0d10] via-[#0d0d10]/35 to-transparent" />

        {series.badge && (
          <span className="absolute left-3 top-3 rounded-md bg-rose-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white ring-1 ring-black/20">
            {series.badge}
          </span>
        )}
        {!series.curated && (
          <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-300 ring-1 ring-white/10 backdrop-blur-sm">
            Auto
          </span>
        )}

        {/* Secondary cover stack */}
        {covers.length > 1 && (
          <div className="absolute bottom-3 right-3 flex -space-x-3">
            {covers.slice(1).map((c) => (
              <span
                key={c}
                className="h-16 w-11 overflow-hidden rounded-md bg-zinc-900 ring-2 ring-[#0d0d10]"
              >
                <img
                  src={c}
                  alt=""
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 font-display text-sm font-bold text-zinc-100 transition group-hover:text-rose-400 sm:text-base">
            {series.name}
          </h3>
        </div>
        <p className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500">
          <Layers3 className="h-3 w-3 text-rose-400" />
          {series.count} title{series.count === 1 ? "" : "s"}
        </p>
        {series.description && (
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">
            {series.description}
          </p>
        )}
        <span className="mt-auto flex items-center gap-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-rose-400 transition group-hover:gap-2">
          Open series
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
};