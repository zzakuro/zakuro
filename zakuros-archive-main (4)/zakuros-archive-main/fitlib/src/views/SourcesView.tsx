import React, { useEffect, useState } from "react";
import { Layers, Database, Package, Disc3, RefreshCw, Activity } from "lucide-react";
import { PageHero, Reveal } from "../components/PageHero";

interface SourceEntry {
  name: string;
  category: string;
}

interface HealthSnapshot {
  generatedAt: string;
  total: number;
  classic?: number;
  coverage: Record<string, number>;
  placeholders?: { summaries?: number; developers?: number; screenshots?: number };
}

// Field coverage the checker reports, in the order most meaningful to readers.
const COVERAGE_ROWS: [string, string][] = [
  ["cover", "Cover art"],
  ["realSummary", "Real description"],
  ["genres", "Genres"],
  ["realDeveloper", "Developer"],
  ["releaseDate", "Release date"],
  ["screenshots", "Screenshots"],
  ["steamId", "Steam reference"],
  ["rating", "Rating"],
];

const CATEGORY_META: Record<string, { label: string; blurb: string; icon: React.ElementType }> = {
  repacker: {
    label: "Repackers & Direct Download",
    blurb: "Groups whose repacks, direct downloads and magnets are indexed in the catalog.",
    icon: Package,
  },
  classic: {
    label: "Classic & Retro Archives",
    blurb: "Retro console and disc-image archives surfaced with the Classic filter.",
    icon: Disc3,
  },
  software: {
    label: "Software & Utilities",
    blurb: "Non-game software releases indexed alongside the game catalog.",
    icon: Database,
  },
};

export const SourcesView: React.FC = () => {
  const [sources, setSources] = useState<SourceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sources");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setSources(Array.isArray(data?.sources) ? data.sources : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load sources.");
      setSources([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Best-effort: the health snapshot is optional (it only exists once the
  // catalog checker has run), so failures are silent.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/catalog/health");
        if (!res.ok) return;
        const data = (await res.json()) as HealthSnapshot;
        if (alive && data?.coverage) setHealth(data);
      } catch {
        // ignore — the panel simply stays hidden
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const grouped = sources.reduce<Record<string, SourceEntry[]>>((acc, s) => {
    const key = s.category || "repacker";
    (acc[key] ||= []).push(s);
    return acc;
  }, {});

  const order = ["repacker", "classic", "software", ...Object.keys(grouped).filter((k) => !["repacker", "classic", "software"].includes(k))];

  return (
    <div id="sources_view" className="mx-auto max-w-7xl space-y-16 px-4 py-12 sm:px-6 lg:px-8">
      {/* Hero */}
      <PageHero
        eyebrow="Every group we index"
        title={
          <>
            Our <span className="text-gradient animate">Sources</span>
          </>
        }
        lead="These are the release groups and archives whose catalogs are indexed here. We host metadata only — never game files — and we're not affiliated with any of them."
      />

      {loading && (
        <div className="flex flex-col items-center gap-4 py-10">
          <div className="flex items-center gap-2 font-mono text-xs text-zinc-500">
            <RefreshCw className="h-4 w-4 animate-spin text-rose-400" />
            Loading sources…
          </div>
          <div className="grid w-full max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-14 w-full" />
            ))}
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="mx-auto max-w-md rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-6 text-center">
          <p className="font-mono text-xs text-amber-400">Couldn't load sources: {error}</p>
          <button
            onClick={load}
            className="mt-4 rounded-full bg-rose-500 px-5 py-2 font-mono text-xs font-bold text-white transition hover:bg-rose-400"
          >
            TRY AGAIN
          </button>
        </div>
      )}

      {!loading && !error && sources.length === 0 && (
        <p className="py-16 text-center font-mono text-xs text-zinc-500">
          No sources are currently configured.
        </p>
      )}

      {!loading && !error && order.map((category) => {
        const list = grouped[category];
        if (!list || list.length === 0) return null;
        const meta = CATEGORY_META[category] ?? {
          label: category,
          blurb: "",
          icon: Layers,
        };
        const Icon = meta.icon;
        return (
          <section key={category} className="space-y-6">
            <div className="flex items-center gap-3 border-b border-white/5 pb-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-rose-400">
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-display text-lg font-bold uppercase tracking-wide text-white">
                  {meta.label}
                </h2>
                {meta.blurb && <p className="text-xs text-zinc-500">{meta.blurb}</p>}
              </div>
              <span className="ml-auto font-mono text-[10px] text-zinc-600">
                {list.length} source{list.length > 1 ? "s" : ""}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((src) => (
                <div
                  key={src.name}
                  className="panel panel-hover flex items-center gap-2.5 p-4"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span className="truncate font-mono text-xs font-bold text-white">{src.name}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {health && (
        <section className="space-y-6">
          <div className="flex items-center gap-3 border-b border-white/5 pb-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-rose-400">
              <Activity className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-lg font-bold uppercase tracking-wide text-white">
                Catalog health
              </h2>
              <p className="text-xs text-zinc-500">
                Metadata coverage across {health.total.toLocaleString()} indexed releases
                {health.classic ? `, including ${health.classic.toLocaleString()} classic titles` : ""}.
              </p>
            </div>
            <span className="ml-auto font-mono text-[10px] text-zinc-600">
              updated {new Date(health.generatedAt).toLocaleDateString()}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {COVERAGE_ROWS.map(([key, label]) => {
              const v = Math.max(0, Math.min(100, Math.round(health.coverage[key] ?? 0)));
              return (
                <div key={key} className="panel rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      {label}
                    </span>
                    <span className="font-mono text-xs font-bold text-white">{v}%</span>
                  </div>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
                    role="progressbar"
                    aria-label={`${label} coverage`}
                    aria-valuenow={v}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-rose-500 to-rose-400"
                      style={{ width: `${v}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="font-mono text-[10px] leading-relaxed text-zinc-600">
            Coverage is filled continuously by the background metadata grind; gaps shrink as
            descriptions, art and developer data are backfilled from Steam and IGDB.
          </p>
        </section>
      )}

      <section className="panel mx-auto max-w-2xl rounded-2xl p-6 text-center">
        <p className="text-xs leading-relaxed text-zinc-500">
          Know a group that should be indexed? Drop it in the community channels. Source mirrors are
          checked periodically and the index keeps the group-authorized link per release.
        </p>
      </section>
    </div>
  );
};
