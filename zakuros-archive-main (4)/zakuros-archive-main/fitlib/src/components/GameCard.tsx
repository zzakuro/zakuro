import React, { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Star, Eye, ArrowUpRight } from "lucide-react";
import { Game } from "../types";
import { formatDistanceToNow, parseISO } from "date-fns";
import { LinuxBadge } from "./LinuxBadge";
import { useGame } from "../lib/gameContext";

type CardBadge = "NEW" | "HOT" | "UPDATED" | "VR";

interface GameCardProps {
  game: Game;
  badge?: CardBadge;
}

const BADGE_STYLES: Record<CardBadge, string> = {
  NEW: "bg-emerald-500/90 text-emerald-50",
  HOT: "bg-amber-500/90 text-amber-50",
  UPDATED: "bg-sky-500/90 text-sky-50",
  VR: "bg-violet-500/90 text-violet-50",
};

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function coverInitials(s: string): string {
  const words = s.split(/\s+/).filter(Boolean).slice(0, 2);
  const fromWords = words.map((w) => Array.from(w)[0] || "").join("");
  return (fromWords || Array.from(s).slice(0, 2).join("")).toUpperCase();
}

export const PlaceholderCover: React.FC<{ title: string; className?: string }> = ({ title, className }) => {
  const hue = hashHue(title || "?");
  const hue2 = (hue + 40) % 360;
  return (
    <div
      className={`relative flex h-full w-full flex-col justify-between overflow-hidden p-4 ${className ?? ""}`}
      style={{
        background: `linear-gradient(160deg, hsl(${hue} 55% 26%), hsl(${hue2} 60% 12%) 60%, #0d0d10)`,
      }}
    >
      <span className="font-display text-lg font-black tracking-wide text-white/90 drop-shadow">
        {coverInitials(title)}
      </span>
      <div>
        <div className="mb-2 h-0.5 w-8 rounded bg-rose-400/90" />
        <span className="font-display text-sm font-bold leading-snug text-zinc-100 line-clamp-4">
          {title}
        </span>
      </div>
    </div>
  );
};

export const GameCard: React.FC<GameCardProps> = ({ game, badge }) => {
  const [imgFailed, setImgFailed] = useState(false);
  const { getGameSummary } = useGame();
  const tiltRef = useRef<HTMLDivElement>(null);
  const tiltFrame = useRef<number>(0);

  // 3D tilt driven by CSS vars (--rx/--ry) + a glare hotspot (--mx/--my).
  // Cheap: only fires while the pointer is over a card, paints via one DOM
  // style write per frame, and disabled under prefers-reduced-motion.
  const onCardMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = tiltRef.current;
    if (!el) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    cancelAnimationFrame(tiltFrame.current);
    tiltFrame.current = requestAnimationFrame(() => {
      el.style.setProperty("--rx", `${((y - 0.5) * -9).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${((x - 0.5) * 11).toFixed(2)}deg`);
      el.style.setProperty("--mx", `${(x * 100).toFixed(2)}%`);
      el.style.setProperty("--my", `${(y * 100).toFixed(2)}%`);
    });
  };

  const onCardLeave = () => {
    const el = tiltRef.current;
    cancelAnimationFrame(tiltFrame.current);
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  };

  // The list payload ships only `hasSummary`; fetch the text on first hover/focus.
  const [summary, setSummary] = useState<string>(game.summary ?? "");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const summaryRequested = useRef(false);
  const loadSummary = useCallback(() => {
    if (summary || summaryRequested.current) return;
    summaryRequested.current = true;
    if (!game.hasSummary) return;
    setSummaryLoading(true);
    getGameSummary(game.id)
      .then((s) => setSummary(s))
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, [summary, game.hasSummary, game.id, getGameSummary]);

  let relativeUpdate = "";
  try {
    relativeUpdate = formatDistanceToNow(parseISO(game.stats.updatedAt), { addSuffix: true });
  } catch {
    relativeUpdate = "";
  }

  const showPlaceholder = !game.coverImage || imgFailed;

  // Score-coloured rating: high scores read green/gold, mid amber, rest brand rose.
  const ratingTone =
    game.rating >= 85
      ? "text-emerald-400 [&>svg]:fill-emerald-400 [&>svg]:text-emerald-400"
      : game.rating >= 70
        ? "text-amber-400 [&>svg]:fill-amber-400 [&>svg]:text-amber-400"
        : "text-rose-400 [&>svg]:fill-rose-400 [&>svg]:text-rose-400";

  return (
    <div
      ref={tiltRef}
      onPointerMove={onCardMove}
      onPointerLeave={onCardLeave}
      className="group tilt-card relative flex h-full rounded-xl"
    >
      {/* Hover bloom — a soft tri-color aura that bleeds out past the card edges */}
      <div
        aria-hidden
        className="blend-screen pointer-events-none absolute -inset-2 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
      >
        <div className="absolute left-[6%] top-[4%] h-28 w-28 rounded-full bg-rose-500/50" />
        <div className="absolute right-[8%] top-[26%] h-24 w-24 rounded-full bg-violet-500/50" />
        <div className="absolute bottom-[6%] left-[22%] h-24 w-24 rounded-full bg-rose-300/40" />
      </div>

      <Link
        to={`/game/${game.id}`}
        onMouseEnter={loadSummary}
        onFocus={loadSummary}
        className="relative flex h-full w-full flex-col overflow-hidden rounded-xl bg-[#0d0d10] ring-1 ring-white/[0.06] transition-all duration-300 hover:-translate-y-1 hover:ring-rose-500/50 hover:shadow-2xl hover:shadow-rose-950/20"
      >
      {/* Cover */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-900">
        {showPlaceholder ? (
          <PlaceholderCover title={game.title} />
        ) : (
          <img
            src={game.coverImage}
            alt={game.title}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            onError={() => setImgFailed(true)}
          />
        )}

        {/* Bottom scrim for contrast */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[#0d0d10]/80 to-transparent" />

        {/* Shine sweep on hover */}
        <div className="pointer-events-none absolute left-[-75%] top-0 h-full w-1/2 -skew-x-[20deg] bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 transition-all duration-700 ease-out group-hover:left-full group-hover:opacity-100" />

        {/* NEW / HOT / UPDATED badge */}
        {badge && (
          <span
            className={`absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ring-1 ring-black/20 ${BADGE_STYLES[badge]}`}
          >
            {badge}
          </span>
        )}

        {/* Era chip: Retro vs New + platform, so same-named titles read apart */}
        {(game.era || game.classic) && (
          <span
            className={`absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ring-1 backdrop-blur-sm ${
              game.era === "retro"
                ? "bg-amber-950/85 text-amber-300 ring-amber-500/40"
                : "bg-sky-950/85 text-sky-300 ring-sky-500/40"
            }`}
          >
            {game.era === "retro" ? "Retro" : "New"}
            {game.eraPlatform ? ` · ${game.eraPlatform}` : ""}
          </span>
        )}

        {/* Size chip */}
        {game.fileSize && (
          <div className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-bold text-zinc-200 ring-1 ring-white/10 backdrop-blur-sm">
            {game.fileSize}
          </div>
        )}

        {/* Linux support chip */}
        {game.linux && (game.linux.tier || game.linux.native) && (
          <div className="absolute bottom-2 left-2">
            <LinuxBadge linux={game.linux} />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/90 via-black/30 to-transparent p-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="flex justify-end">
            <span className="flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
              <Eye className="h-3 w-3 text-rose-400" />
              {((game.stats?.views ?? 0) / 1000).toFixed(0)}k
            </span>
          </div>
          <div className="translate-y-2 transition-transform duration-300 group-hover:translate-y-0 group-focus-within:translate-y-0">
            <p className="line-clamp-3 text-[11px] leading-relaxed text-zinc-300">
              {summary || (summaryLoading ? "Loading description…" : "No description available.")}
            </p>
            <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-rose-400">
              View game
              <ArrowUpRight className="h-3 w-3" />
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-between gap-1.5 p-3.5">
          <h3 className="line-clamp-1 font-display text-[15px] font-semibold text-zinc-100 transition group-hover:text-rose-400">
            {game.title}
          </h3>
          <div className="flex items-center gap-2 text-[10px]">
            <span className={`flex shrink-0 items-center gap-1 text-[10px] font-bold ${ratingTone}`}>
              <Star className="h-3 w-3" />
              {game.rating > 0 ? `${game.rating}%` : "—"}
            </span>
            <span className="truncate font-medium capitalize text-zinc-500">
              {game.genres[0] ?? "Game"}
            </span>
            <span className="ml-auto shrink-0 font-mono text-zinc-600">{relativeUpdate}</span>
          </div>
        </div>
      </Link>

      {/* Pointer glare — a soft spotlight pinned to the cursor on hover */}
      <div aria-hidden className="tilt-glare" />
    </div>
  );
};