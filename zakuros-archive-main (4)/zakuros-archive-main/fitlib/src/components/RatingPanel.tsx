import React, { useEffect, useState } from "react";
import { Star, Loader2, User } from "lucide-react";
import { useGame } from "../lib/gameContext";

const SCALE_LABELS = ["", "Broken", "Barely runs", "Playable", "Works great", "Perfect"];
const MAX = 5;

// Ported from UnionCrax "game experiences": rate how well a repack runs,
// shown as a distributed 5-star summary with the viewer's own rating.
export const RatingPanel: React.FC<{ gameId: string }> = ({ gameId }) => {
  const { getRatings, submitRating, user } = useGame();
  const [summary, setSummary] = useState<{
    count: number;
    average: number;
    distribution: Record<number, number>;
    mine: { value: number; platform?: string } | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hover, setHover] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getRatings(gameId)
      .then((s) => mounted && setSummary(s))
      .catch(() => mounted && setError("Failed to load community ratings."))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [gameId, getRatings]);

  const rate = async (value: number) => {
    setSubmitting(true);
    setError(null);
    try {
      setSummary(await submitRating(gameId, value));
    } catch (e: any) {
      setError(e.message ?? "Failed to submit rating.");
    } finally {
      setSubmitting(false);
    }
  };

  const maxCount = summary ? Math.max(1, ...Object.values(summary.distribution)) : 1;
  const active = summary?.mine?.value ?? hover;

  return (
    <div className="rounded-xl border border-zinc-900 bg-zinc-950/45 p-4 text-xs space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-zinc-500 font-semibold font-mono uppercase tracking-wider text-[10px]">
          Community Rating
        </span>
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-400" />
        ) : summary && summary.count > 0 ? (
          <span className="flex items-center gap-1 text-zinc-200 font-mono">
            <Star className="h-3.5 w-3.5 fill-rose-400 text-rose-400" />
            <span className="font-black text-rose-400 text-sm">{summary.average.toFixed(1)}</span>
            <span className="text-zinc-600">({summary.count})</span>
          </span>
        ) : (
          <span className="text-zinc-600">No ratings yet</span>
        )}
      </div>

      {summary && summary.count > 0 && (
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5].map((n) => {
            const c = summary.distribution[n] ?? 0;
            const pct = Math.round((c / maxCount) * 100);
            return (
              <div key={n} className="flex items-center gap-2">
                <span className="w-9 text-right text-[10px] font-mono text-zinc-500 shrink-0">{n}★</span>
                <div className="flex-1 h-1.5 rounded bg-zinc-900 overflow-hidden">
                  <div className="h-full bg-rose-500/70" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-6 text-left text-[10px] font-mono text-zinc-600 shrink-0">{c}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-zinc-900 pt-3">
        <p className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest font-mono mb-2">
          <User className="h-3 w-3" />
          {summary?.mine ? "Update your rating" : "How well does it run?"}
        </p>
        <div
          className="flex items-center gap-1.5"
          onMouseLeave={() => setHover(0)}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              disabled={submitting}
              onClick={() => rate(n)}
              onMouseEnter={() => setHover(n)}
              className="p-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition hover:scale-110"
              title={SCALE_LABELS[n]}
            >
              <Star
                className={`h-4.5 w-4.5 transition-colors ${
                  n <= active ? "fill-rose-400 text-rose-400" : "text-zinc-700"
                }`}
              />
            </button>
          ))}
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-400" />}
        </div>
        {hover > 0 && (
          <p className="mt-1.5 text-[10px] font-mono text-rose-400">
            {SCALE_LABELS[hover]} — click to {summary?.mine ? "update" : "submit"}
          </p>
        )}
        {!user && (
          <p className="mt-1.5 text-[10px] font-mono text-zinc-600">
            Rating {summary?.mine ? "saved" : "posted"} as Guest.
          </p>
        )}
        {error && <p className="mt-1.5 text-[10px] font-mono text-red-400">{error}</p>}
      </div>
    </div>
  );
};