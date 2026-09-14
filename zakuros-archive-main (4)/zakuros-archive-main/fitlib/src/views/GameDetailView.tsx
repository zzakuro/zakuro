import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Download, Heart, ThumbsUp, Star, HardDrive, Calendar,
  ShieldAlert, Monitor, Cpu, Server, Database, Share2,
  Sparkles, CheckCircle, ExternalLink, ArrowLeft, Gamepad2, Bookmark, X,
  Loader2,
} from "lucide-react";
import { useGame } from "../lib/gameContext";
import { Game, GameTrailer } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { RatingPanel } from "../components/RatingPanel";
import { GameComments } from "../components/GameComments";
import { LinuxBadge } from "../components/LinuxBadge";

export const GameDetailView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { games, user, toggleWishlist, toggleLike, bookmarks, toggleBookmark } = useGame();

  const game = games.find((g) => g.id === id);

  const [activeTab, setActiveTab] = useState<"overview" | "screenshots" | "trailers" | "community">("overview");
  const [reqOs, setReqOs] = useState<"windows" | "linux" | "mac">("windows");
  const [showDownloadMenu, setShowDownloadMenu] = useState<boolean>(false);
  const [enriching, setEnriching] = useState<boolean>(false);
  const [trailers, setTrailers] = useState<GameTrailer[]>(game?.trailers || []);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  if (!game) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <Gamepad2 className="h-12 w-12 animate-bounce text-zinc-700" />
        <h2 className="font-display text-xl font-bold uppercase text-white">REPACK STORAGE ID CORRUPTED</h2>
        <p className="text-xs text-zinc-500">The requested index ID is not currently registered in Zakuro's Archive.</p>
        <Link
          to="/"
          className="mt-4 rounded-full bg-rose-500 px-6 py-2.5 font-mono text-xs font-bold text-white transition hover:bg-rose-400"
        >
          RETURN TO HOMEPAGE
        </Link>
      </div>
    );
  }

  const handleSharePage = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast("Share URL Link copied to clipboard!");
  };

  const handleMirrorClick = (source: { name: string; url: string; isMagnet?: boolean }) => {
    if (source.isMagnet) {
      try {
        window.location.href = source.url;
      } catch (err) {
        console.warn("Could not auto-trigger protocol handler:", err);
      }
      navigator.clipboard.writeText(source.url);
      showToast("Opening local torrent client! Link also copied to clipboard.");
    } else {
      window.open(source.url, "_blank", "noopener,noreferrer");
      showToast(`Opening ${source.name} download page…`);
    }
    setShowDownloadMenu(false);
  };

  const handleEnrich = async () => {
    if (enriching) return;
    setEnriching(true);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(game.id)}/metadata`);
      if (!res.ok) throw new Error(`Steam refresh failed (${res.status})`);
      const meta = await res.json();
      if (meta.trailers?.length) setTrailers(meta.trailers);
      showToast(meta.title ? `Refreshed details for ${meta.title}.` : "Metadata refreshed.");
    } catch (e: any) {
      showToast(e.message ?? "Steam refresh failed. Try again later.");
    } finally {
      setEnriching(false);
    }
  };

  // Pull live Steam metadata once on open so trailers (and refresh button data)
  // are available even before the offline grind has persisted them to disk.
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/games/${encodeURIComponent(game.id)}/metadata`, { signal: ac.signal });
        if (!res.ok) return;
        const meta = await res.json();
        if (meta.trailers?.length) setTrailers(meta.trailers);
      } catch {
        // ignore network/abort failures — trailers just stay empty
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  const isWishlisted = user?.wishlist.includes(game.id) || false;
  const isLiked = user?.liked.includes(game.id) || false;
  const isBookmarked = bookmarks?.includes(game.id) || false;

  const title = game.title;
  const summary = game.summary;
  const rating = game.rating;
  const releaseDate = game.releaseDate;
  const developer = game.developer;
  const publisher = game.publisher;
  const screenshots =
    game.screenshots && game.screenshots.length > 0
      ? game.screenshots
      : game.screenshot
        ? [game.screenshot]
        : [];

  const heroImage = screenshots[0] || game.coverImage || "";

  const tabBtn = (tabId: "overview" | "screenshots" | "trailers" | "community", label: string) => (
    <button
      onClick={() => setActiveTab(tabId)}
      className={`border-b-2 pb-3 font-mono uppercase transition ${
        activeTab === tabId
          ? "border-rose-500 font-bold text-rose-400"
          : "border-transparent text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div id="game_detail_view" className="relative pb-16">
      {/* Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.95 }}
            className="fixed right-6 top-20 z-50 flex items-center gap-2 rounded-xl border border-rose-500/40 bg-[#160a0e] px-4 py-3 shadow-2xl shadow-black/60"
          >
            <CheckCircle className="h-4.5 w-4.5 text-rose-400" />
            <span className="font-mono text-xs font-semibold text-white">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* A. Hero backdrop */}
      <section className="relative h-[55vh] min-h-[360px] w-full overflow-hidden border-b border-white/5 bg-black">
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-[#09090b] via-[#09090b]/40 to-transparent" />
        {heroImage && (
          <img
            src={heroImage}
            alt={title}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover opacity-40 blur-[1px]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}

        <div className="absolute inset-x-0 top-6 z-20 mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            to={-1 as any || "/"}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 font-mono text-xs font-bold uppercase text-zinc-300 backdrop-blur-sm transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-rose-400" />
            Back
          </Link>
          <button
            onClick={handleSharePage}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 font-mono text-xs font-bold uppercase text-zinc-300 backdrop-blur-sm transition hover:text-white"
          >
            <Share2 className="h-3.5 w-3.5 text-rose-400" />
            Share
          </button>
        </div>

        <div className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {game.genres.map((g) => (
              <span key={g} className="rounded bg-black/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400 ring-1 ring-white/10">
                {g}
              </span>
            ))}
            {game.systemRequirements.windows && (
              <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-400 ring-1 ring-rose-500/25">
                PC
              </span>
            )}
            {game.linux && (game.linux.tier || game.linux.native) && (
              <LinuxBadge linux={game.linux} className="!px-2 !py-0.5 !text-[9px]" />
            )}
          </div>

          <h1 className="font-display text-4xl font-bold uppercase leading-tight tracking-tight text-white md:text-5xl">
            {title}
          </h1>

          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            <span className="font-mono text-rose-400">⚡</span>
            <span>
              From <span className="text-zinc-200">{developer}</span>
              {publisher && (
                <span className="text-zinc-500"> · Published by {publisher}</span>
              )}
            </span>
          </p>
        </div>
      </section>

      {/* B. Content */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
          {/* Left panel */}
          <section className="lg:col-span-2">
            <div className="mb-6 flex gap-5 border-b border-white/5 text-xs font-semibold">
              {tabBtn("overview", "Overview")}
              {tabBtn("screenshots", "Screenshots")}
              {trailers.length > 0 && tabBtn("trailers", "Trailers")}
              {tabBtn("community", "Community")}
            </div>

            {activeTab === "overview" && (
              <div id="overview_tab" className="space-y-9">
                <div>
                  <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wider text-white">
                    About this Game
                  </h3>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-400">
                    {summary || "No description available."}
                  </p>
                </div>

                <div>
                  <h3 className="mb-4 font-display text-sm font-bold uppercase tracking-wider text-white">
                    System Requirements
                  </h3>

                  <div className="mb-4 flex gap-2">
                    {Object.keys(game.systemRequirements).map((osKey) => (
                      <button
                        key={osKey}
                        onClick={() => setReqOs(osKey as any)}
                        className={`rounded-full px-3.5 py-1 font-mono text-[11px] font-bold capitalize transition ${
                          reqOs === osKey
                            ? "bg-rose-500 text-white shadow-md shadow-rose-500/20"
                            : "bg-white/[0.04] text-zinc-400 ring-1 ring-white/10 hover:text-white"
                        }`}
                      >
                        {osKey}
                      </button>
                    ))}
                  </div>

                  <div className="rounded-2xl bg-[#0d0d10] p-5 ring-1 ring-white/[0.06]">
                    {game.systemRequirements[reqOs] ? (
                      <div className="grid grid-cols-1 gap-8 text-xs md:grid-cols-2">
                        <ReqColumn
                          title="Minimum OS specs"
                          req={game.systemRequirements[reqOs]?.minimum}
                        />
                        <ReqColumn
                          title="Recommended OS specs"
                          req={
                            game.systemRequirements[reqOs]?.recommended
                              ? game.systemRequirements[reqOs]!.recommended!
                              : null
                          }
                        />
                      </div>
                    ) : (
                      <p className="py-4 text-center text-xs text-zinc-500">
                        Unspecified requirements for this system.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "screenshots" && (
              <div id="screenshots_tab">
                <h3 className="mb-4 font-display text-sm font-bold uppercase tracking-wider text-white">
                  Screenshots Gallery
                </h3>
                {screenshots.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {screenshots.map((screen, idx) => (
                      <div key={idx} className="group relative aspect-video overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/[0.06]">
                        <img
                          src={screen}
                          alt={`Screenshot ${idx + 1}`}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-center text-xs text-zinc-500">
                    No screenshots available for this game.
                  </p>
                )}
              </div>
            )}

            {activeTab === "trailers" && (
              <div id="trailers_tab">
                <h3 className="mb-4 font-display text-sm font-bold uppercase tracking-wider text-white">
                  Trailers
                </h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {trailers.map((t, idx) => (
                    <div key={idx} className="group relative aspect-video overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/[0.06]">
                      <video
                        src={t.src}
                        poster={t.thumb}
                        controls
                        preload="none"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "community" && <GameComments gameId={game.id} />}
          </section>

          {/* Right sidebar */}
          <aside id="game_sidebar" className="space-y-5">
            <div className="rounded-2xl bg-[#0d0d10] p-5 ring-1 ring-white/[0.06]">
              <span className="mb-4 inline-flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-400 ring-1 ring-white/[0.06]">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-rose-400" />
                  Updated {releaseDate}
                </span>
              </span>

              <button
                id="main_download_trigger_btn"
                onClick={() => {
                  setShowDownloadMenu(true);
                  showToast("Opening Secure Download Mirrors Portal...");
                }}
                className="flex h-11 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-rose-500 font-display text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-rose-500/20 transition hover:bg-rose-400 active:scale-[0.98]"
              >
                <Download className="h-4 w-4" />
                Choose Download Mirror
              </button>

              <div className="mt-4 grid grid-cols-4 gap-2 text-[10px] font-bold uppercase text-zinc-500">
                <ActionBtn
                  active={isWishlisted}
                  activeCls="text-rose-400 border-rose-500/30 bg-rose-500/10 border"
                  onClick={() => {
                    if (!user) {
                      showToast("Please Sign in to add items to your Wishlist.");
                    } else {
                      toggleWishlist(game.id);
                      showToast(isWishlisted ? "Removed from Wishlist!" : "Added to Wishlist!");
                    }
                  }}
                  label="Wishlist"
                >
                  <Heart className={`h-4 w-4 ${isWishlisted ? "fill-current" : ""}`} />
                </ActionBtn>
                <ActionBtn
                  active={isLiked}
                  activeCls="text-rose-400 border-rose-500/30 bg-rose-500/10 border"
                  onClick={() => {
                    if (!user) {
                      showToast("Please Sign in to upvote game.");
                    } else {
                      toggleLike(game.id);
                      showToast(isLiked ? "Revoked Like!" : "Uploader upvoted!");
                    }
                  }}
                  label={`Upvote (${rating})`}
                >
                  <ThumbsUp className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />
                </ActionBtn>
                <ActionBtn
                  active={isBookmarked}
                  activeCls="text-emerald-400 border-emerald-500/30 bg-emerald-500/10 border"
                  onClick={() => {
                    toggleBookmark(game.id);
                    showToast(isBookmarked ? "Removed from Bookmarks!" : "Added to Bookmarks!");
                  }}
                  label="Bookmark"
                >
                  <Bookmark className={`h-4 w-4 ${isBookmarked ? "fill-current" : ""}`} />
                </ActionBtn>
                <ActionBtn
                  active={false}
                  activeCls=""
                  onClick={() => {
                    const steamUrl = game.steamId
                      ? `https://store.steampowered.com/app/${game.steamId}`
                      : `https://store.steampowered.com/search/?term=${encodeURIComponent(game.title)}`;
                    window.open(steamUrl, "_blank", "noopener,noreferrer");
                    showToast(`Opening Steam page for ${game.title}...`);
                  }}
                  label="Steam"
                >
                  <ExternalLink className="h-4 w-4 text-rose-400" />
                </ActionBtn>
              </div>
            </div>

            <div className="flex gap-1.5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-[11px] leading-relaxed text-amber-500/90">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div>
                <strong className="mb-1 block font-display text-[10px] font-bold uppercase tracking-wider">
                  Watch out for ads!
                </strong>
                Make sure you are using an adblocker (e.g. uBlock Origin). Check the guide tab for safety tips.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <StatCard label="Downloads" value={game.stats.downloads.toLocaleString()} />
              <StatCard label="Views" value={game.stats.views.toLocaleString()} />
            </div>

            <RatingPanel gameId={game.id} />

            <div className="divide-y divide-white/[0.05] rounded-2xl bg-[#0d0d10] p-1 text-xs ring-1 ring-white/[0.06]">
              <InfoRow
                label="Rating Score"
                value={
                  rating > 0 ? (
                    <span className="flex items-center gap-1 font-display font-bold text-rose-400">
                      <Star className="h-3.5 w-3.5 fill-rose-400" /> {rating}%
                    </span>
                  ) : (
                    <span className="font-mono font-bold text-zinc-400">Unrated</span>
                  )
                }
              />
              <InfoRow
                label="Archive Size"
                value={<span className="font-mono font-bold text-white">{game.fileSize}</span>}
              />
              {releaseDate && (
                <InfoRow
                  label="Released Year"
                  value={<span className="font-mono font-bold text-white">{releaseDate.substring(0, 4)}</span>}
                />
              )}
              {game.linux && (game.linux.tier || game.linux.native) && (
                <div className="flex items-center justify-between px-3 py-3">
                  <span className="font-mono font-semibold text-zinc-500">Linux Support</span>
                  <LinuxBadge linux={game.linux} className="!px-2 !py-1 !text-[9px]" />
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-zinc-500">Uploader Role</span>
                <span className="rounded bg-rose-500/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-rose-400 ring-1 ring-rose-500/20">
                  Verified
                </span>
              </div>

              <button
                onClick={handleEnrich}
                disabled={enriching}
                className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[10px] font-bold text-zinc-300 transition hover:border-rose-500/30 hover:text-rose-300 disabled:opacity-40"
              >
                {enriching ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3 text-rose-400" />
                )}
                {enriching ? "Syncing with Steam…" : "Refresh from Steam"}
              </button>
            </div>
          </aside>
        </div>
      </main>

      {/* Download modal */}
      <AnimatePresence>
        {showDownloadMenu && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDownloadMenu(false)}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d10] p-6 shadow-2xl z-10"
            >
              <button
                onClick={() => setShowDownloadMenu(false)}
                className="absolute right-4 top-4 cursor-pointer rounded-full p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-white"
              >
                <X className="h-4.5 w-4.5" />
              </button>

              <div className="mb-4 pr-8">
                <span className="rounded bg-rose-500/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-rose-400 ring-1 ring-rose-500/20">
                  Repack Download Ports ({game.fileSize})
                </span>
                <h2 className="mt-2 font-display text-lg font-bold uppercase tracking-tight text-white">{title}</h2>
                <p className="mt-1 text-xs text-zinc-400">
                  Select one of our verified mirrors below. Bypass redirects to download safely.
                </p>
              </div>

              {(() => {
                const sources =
                  game.downloadSources && game.downloadSources.length > 0
                    ? game.downloadSources
                    : [{ name: "Main Magnet", url: game.magnetLink, type: "torrent", repacker: "Unknown", fileSize: game.fileSize }];

                const grouped: Record<string, typeof sources> = {};
                for (const src of sources) {
                  const key = src.repacker || "Other";
                  if (!grouped[key]) grouped[key] = [];
                  grouped[key].push(src);
                }
                const repackers = Object.keys(grouped);

                return (
                  <div className="max-h-[380px] space-y-4 overflow-y-auto pr-1">
                    {repackers.map((repacker) => (
                      <div key={repacker}>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="rounded bg-rose-500/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-rose-400 ring-1 ring-rose-500/20">
                            {repacker}
                          </span>
                          <span className="font-mono text-[9px] text-zinc-600">
                            {grouped[repacker].length} source{grouped[repacker].length > 1 ? "s" : ""}
                          </span>
                        </div>

                        <div className="space-y-2">
                          {grouped[repacker].map((src, idx) => {
                            const isMagnet = src.type === "torrent" || (src.url || "").startsWith("magnet:");
                            return (
                              <button
                                key={idx}
                                onClick={() => handleMirrorClick({ ...src, isMagnet })}
                                className="group flex w-full cursor-pointer items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-rose-500/30 hover:bg-white/[0.04]"
                              >
                                <div
                                  className={`mt-0.5 shrink-0 rounded-lg p-2 ring-1 transition ${
                                    isMagnet
                                      ? "bg-violet-500/10 text-violet-400 ring-violet-500/20"
                                      : "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
                                  }`}
                                >
                                  {isMagnet ? <Database className="h-4 w-4" /> : <Server className="h-4 w-4" />}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span
                                      className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ring-1 ${
                                        isMagnet
                                          ? "bg-violet-500/10 text-violet-400 ring-violet-500/25"
                                          : "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25"
                                      }`}
                                    >
                                      {isMagnet ? "⚡ Torrent" : "⬇ Direct"}
                                    </span>
                                    {src.fileSize && (
                                      <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] font-bold text-zinc-300 ring-1 ring-white/10">
                                        {src.fileSize}
                                      </span>
                                    )}
                                    <span className="text-xs text-zinc-200">{src.name}</span>
                                    {src.uploadDate && (
                                      <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-600">
                                        {new Date(src.uploadDate).toLocaleDateString()}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 truncate font-mono text-[10px] text-zinc-600">
                                    {(src.url || "").slice(0, 55)}…
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="mt-5 flex items-center justify-center gap-1.5 border-t border-white/5 pt-4 font-mono text-[10px] text-zinc-600">
                <ShieldAlert className="h-3.5 w-3.5 text-zinc-500" />
                <span>Always ensure you have an active antivirus and adblocker active.</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ---------- tiny building blocks ---------- */
const ReqColumn: React.FC<{
  title: string;
  req: {
    os: string;
    processor: string;
    memory: string;
    graphics?: string;
    storage: string;
  } | null;
}> = ({ title, req }) => (
  <div>
    <p className="mb-3 border-b border-white/5 pb-2 font-display text-[11px] font-bold uppercase tracking-wider text-zinc-200">
      {title}
    </p>
    {req ? (
      <ul className="space-y-3 font-mono text-zinc-400">
        <SpecRow icon={<Monitor className="h-3.5 w-3.5 text-rose-500/40" />} label="OS" value={req.os} />
        <SpecRow icon={<Cpu className="h-3.5 w-3.5 text-rose-500/40" />} label="Processor" value={req.processor} />
        <SpecRow icon={<Server className="h-3.5 w-3.5 text-rose-500/40" />} label="Memory" value={req.memory} />
        {req.graphics && (
          <SpecRow icon={<Database className="h-3.5 w-3.5 text-rose-500/40" />} label="Graphics" value={req.graphics} />
        )}
        <SpecRow icon={<HardDrive className="h-3.5 w-3.5 text-rose-500/40" />} label="Storage" value={req.storage} />
      </ul>
    ) : (
      <p className="p-4 font-mono text-[11px] italic text-zinc-500">
        No recommended specifications listed for this operating platform.
      </p>
    )}
  </div>
);

const SpecRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <li className="flex items-start gap-2">
    <span className="mt-0.5 shrink-0">{icon}</span>
    <span>
      <strong className="text-zinc-300">{label}:</strong> {value}
    </span>
  </li>
);

const ActionBtn: React.FC<{
  active: boolean;
  activeCls: string;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}> = ({ active, activeCls, onClick, label, children }) => (
  <button
    onClick={onClick}
    className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg py-2 transition ${
      active ? activeCls : "border border-white/[0.06] hover:border-white/20 hover:bg-white/[0.03]"
    }`}
  >
    {children}
    <span>{label}</span>
  </button>
);

const StatCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-2xl bg-[#0d0d10] p-4 ring-1 ring-white/[0.06]">
    <span className="font-mono text-[9px] font-bold uppercase text-zinc-500">{label}</span>
    <p className="mt-1 font-display text-xl font-bold text-white">{value}</p>
  </div>
);

const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between px-3 py-3">
    <span className="font-mono font-semibold text-zinc-500">{label}</span>
    {value}
  </div>
);