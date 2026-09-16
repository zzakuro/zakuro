import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Star, Eye, ArrowUpRight } from "lucide-react";
import { Game } from "../types";
import { formatDistanceToNow, parseISO } from "date-fns";
import { LinuxBadge } from "./LinuxBadge";

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

  let relativeUpdate = "";
  try {
    relativeUpdate = formatDistanceToNow(parseISO(game.stats.updatedAt), { addSuffix: true });
  } catch {
    relativeUpdate = "";
  }

  const showPlaceholder = !game.coverImage || imgFailed;

  return (
    <Link
      to={`/game/${game.id}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-xl bg-[#0d0d10] ring-1 ring-white/[0.06] transition-all duration-300 hover:-translate-y-1 hover:ring-rose-500/50 hover:shadow-2xl hover:shadow-rose-950/20"
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
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            onError={() => setImgFailed(true)}
          />
        )}

        {/* Bottom scrim for contrast */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[#0d0d10]/80 to-transparent" />

        {/* Rating pill */}
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/10 backdrop-blur-sm">
          <Star className="h-3 w-3 fill-rose-400 text-rose-400" />
          <span>{game.rating > 0 ? `${game.rating}%` : "—"}</span>
        </div>

        {/* NEW / HOT / UPDATED badge */}
        {badge && (
          <span
            className={`absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ring-1 ring-black/20 ${BADGE_STYLES[badge]}`}
          >
            {badge}
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
              {game.summary || "No description available."}
            </p>
            <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-rose-400">
              View game
              <ArrowUpRight className="h-3 w-3" />
            </span>
          </div>
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-1 flex-col justify-between gap-2 p-3.5">
        <h3 className="line-clamp-1 font-display text-[15px] font-semibold text-zinc-100 transition group-hover:text-rose-400">
          {game.title}
        </h3>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium capitalize text-zinc-400 ring-1 ring-white/[0.06]">
            {game.genres[0] ?? "Game"}
          </span>
          {relativeUpdate && (
            <span className="shrink-0 font-mono text-[10px] text-zinc-600">{relativeUpdate}</span>
          )}
        </div>
      </div>
    </Link>
  );
};