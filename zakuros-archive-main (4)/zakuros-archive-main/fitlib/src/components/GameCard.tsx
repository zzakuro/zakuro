import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Star, Download, Eye, Calendar, HardDrive } from "lucide-react";
import { Game } from "../types";
import { formatDistanceToNow, parseISO } from "date-fns";

interface GameCardProps {
  game: Game;
}

export const GameCard: React.FC<GameCardProps> = ({ game }) => {
  const [imgFailed, setImgFailed] = useState(false);

  let relativeUpdate = "";
  try {
    relativeUpdate = formatDistanceToNow(parseISO(game.stats.updatedAt), { addSuffix: true });
  } catch (e) {
    relativeUpdate = game.stats.updatedAt;
  }

  const showPlaceholder = !game.coverImage || imgFailed;

  return (
    <Link
      id={`game_card_${game.id}`}
      to={`/game/${game.id}`}
      className="group relative flex flex-col overflow-hidden rounded-xl bg-zinc-950/60 border border-zinc-900 shadow-lg hover:shadow-pink-500/10 transition-all duration-300 hover:-translate-y-1"
    >
      {/* Portrait Cover Container (Aspect Ratio: 3:4) */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-900 border-b border-zinc-900">
        {showPlaceholder ? (
          <div className="h-full w-full flex flex-col items-start justify-end p-3 bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950">
            <div className="w-8 h-0.5 bg-pink-500 mb-2 rounded" />
            <span className="text-[11px] font-bold text-zinc-200 leading-snug line-clamp-4">{game.title}</span>
          </div>
        ) : (
          <img
            src={game.coverImage}
            alt={game.title}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={() => setImgFailed(true)}
          />
        )}

        {/* Hover/Overlay info rails */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-3">
          <div className="flex justify-end">
            <span className="flex items-center gap-1 rounded bg-zinc-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              <Eye className="h-3 w-3 text-pink-400" />
              {(game.stats.views / 1000).toFixed(0)}k Views
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-300 line-clamp-3">
            {game.summary}
          </p>
        </div>

        {/* Rating Badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1 rounded-md bg-[#050506]/85 px-2 py-0.5 text-[10px] font-bold text-white border border-zinc-800 backdrop-blur-sm">
          <Star className="h-3 w-3 fill-pink-400 text-pink-400" />
          <span>{game.rating}%</span>
        </div>

        {/* Size Badge */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-[#050506]/85 px-2 py-1 text-[10px] font-bold text-pink-400 border border-zinc-800 backdrop-blur-sm font-mono">
          <HardDrive className="h-3 w-3" />
          <span>{game.fileSize}</span>
        </div>
      </div>

      {/* Description Context */}
      <div className="flex flex-1 flex-col p-4 justify-between">
        <div>
          <h3 className="font-display font-semibold text-zinc-100 group-hover:text-pink-400 transition text-[15px] line-clamp-1">
            {game.title}
          </h3>
          <p className="mt-1 text-xs text-zinc-400 line-clamp-1">{game.developer}</p>
        </div>

        <div className="mt-3.5 flex items-center justify-between border-t border-zinc-900 pt-2.5">
          <span className="inline-block rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-400 capitalize">
            {game.genres[0]}
          </span>
          <span className="text-[10px] text-zinc-500 flex items-center gap-1 font-mono">
            <Calendar className="h-3 w-3 text-zinc-600" />
            {relativeUpdate}
          </span>
        </div>
      </div>
    </Link>
  );
};