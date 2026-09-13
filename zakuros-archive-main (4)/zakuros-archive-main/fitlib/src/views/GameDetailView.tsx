import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { 
  Download, Heart, ThumbsUp, HelpCircle, Star, HardDrive, Calendar, 
  ShieldAlert, Monitor, Cpu, Server, Database, Share2, Clipboard, 
  Sparkles, CheckCircle, ExternalLink, ArrowLeft, Gamepad2, Bookmark, X,
  Loader2
} from "lucide-react";
import { useGame } from "../lib/gameContext";
import { Game } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { RatingPanel } from "../components/RatingPanel";
import { GameComments } from "../components/GameComments";

export const GameDetailView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { games, user, toggleWishlist, toggleLike, bookmarks, toggleBookmark } = useGame();

  // Tab State
  const [activeTab, setActiveTab] = useState<"overview" | "screenshots" | "community">("overview");
  // Requirements OS Toggle State
  const [reqOs, setReqOs] = useState<"windows" | "linux" | "mac">("windows");
  
  // Download Sources Menu State
  const [showDownloadMenu, setShowDownloadMenu] = useState<boolean>(false);
  const [enriching, setEnriching] = useState<boolean>(false);

  // Notification Toast states
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Find local static game config
  const game = games.find((g) => g.id === id);

  // Trigger Toast Helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  if (!game) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <Gamepad2 className="h-12 w-12 text-zinc-700 animate-bounce" />
        <h2 className="font-display font-black text-xl text-white uppercase">REPACK STORAGE ID CORRUPTED</h2>
        <p className="text-zinc-500 text-xs">The requested index ID is not currently registered in Zakuro's Archive.</p>
        <Link to="/" className="mt-4 rounded-full bg-pink-400 px-6 py-2.5 text-xs font-bold text-black hover:bg-pink-300 font-mono">
          RETURN TO HOMEPAGE
        </Link>
      </div>
    );
  }

  // Handle Clipboard copies
  const handleCopyMagnet = () => {
    navigator.clipboard.writeText(game.magnetLink);
    showToast("Magnet Link copied to clipboard! Paste in torrent clients.");
  };

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

  // Lazy enrichment: pulls live Steam/IGDB metadata and merges anything missing.
  const handleEnrich = async () => {
    if (enriching) return;
    setEnriching(true);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(game.id)}/metadata`);
      if (!res.ok) throw new Error(`Steam refresh failed (${res.status})`);
      const meta = await res.json();
      showToast(meta.title ? `Refreshed details for ${meta.title}.` : "Metadata refreshed.");
    } catch (e: any) {
      showToast(e.message ?? "Steam refresh failed. Try again later.");
    } finally {
      setEnriching(false);
    }
  };

  // Determine auth properties
  const isWishlisted = user?.wishlist.includes(game.id) || false;
  const isLiked = user?.liked.includes(game.id) || false;
  const isBookmarked = bookmarks?.includes(game.id) || false;

  // Use saved data directly - no live enrichment
  const title = game.title;
  const summary = game.summary;
  const rating = game.rating;
  const releaseDate = game.releaseDate;
  const developer = game.developer;
  const publisher = game.publisher;
  const screenshots = (game.screenshots && game.screenshots.length > 0)
    ? game.screenshots
    : (game.screenshot ? [game.screenshot] : []);

  // Hero background - use first screenshot, fall back to cover image
  const heroImage = screenshots[0] || game.coverImage || "";

  return (
    <div id="game_detail_view" className="relative pb-16">
      
      {/* Dynamic Copied Toast Notifier */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.95 }}
            className="fixed top-20 right-6 z-50 flex items-center gap-2 rounded-xl bg-pink-950 border border-pink-500 px-4 py-3 shadow-2xl shadow-pink-950/50"
          >
            <CheckCircle className="h-4.5 w-4.5 text-pink-400" />
            <span className="text-xs font-semibold text-white font-mono">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* A. Full-Width Background Hero Screen */}
      <section id="game_hero_backdrop" className="relative h-[55vh] min-h-[360px] w-full overflow-hidden border-b border-zinc-900 bg-black">
        <div className="absolute inset-0 bg-gradient-to-t from-[#050506] via-[#050506]/35 to-transparent z-10" />
        {heroImage ? (
          <img
            src={heroImage}
            alt={title}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover opacity-35 filter blur-[1px]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}

        {/* Back and Share buttons */}
        <div className="absolute top-6 left-4 right-4 z-20 mx-auto max-w-7xl flex items-center justify-between">
          <Link
            to={-1 as any || "/"}
            className="flex items-center gap-1.5 rounded-full bg-zinc-950/80 border border-zinc-800 px-3.5 py-1.5 text-xs font-bold text-zinc-300 hover:text-white transition backdrop-blur-sm uppercase font-mono"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-pink-400" />
            <span>Back</span>
          </Link>

          <button
            onClick={handleSharePage}
            className="flex items-center gap-1.5 rounded-full bg-zinc-950/80 border border-zinc-800 px-3.5 py-1.5 text-xs font-bold text-zinc-300 hover:text-white transition backdrop-blur-sm uppercase font-mono"
          >
            <Share2 className="h-3.5 w-3.5 text-pink-400" />
            <span>Share</span>
          </button>
        </div>

        {/* Title, tags and details overlay bottom */}
        <div className="absolute bottom-0 inset-x-0 z-20 mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {game.genres.map((g) => (
              <span key={g} className="rounded bg-zinc-900/90 border border-zinc-800 px-2 py-0.5 text-[9px] font-bold tracking-wider text-zinc-400 uppercase">
                {g}
              </span>
            ))}
            {game.systemRequirements.windows && (
              <span className="rounded bg-pink-950/90 border border-pink-500/20 px-2 py-0.5 text-[9px] font-bold text-pink-400 uppercase">
                PC
              </span>
            )}
          </div>

          <h1 className="font-display font-black tracking-tight text-white text-4xl uppercase">
            {title}
          </h1>

          <p className="mt-1.5 text-xs font-bold text-zinc-400 flex items-center gap-1">
            <span className="text-pink-400 font-mono">⚡</span> From {developer}
          </p>
        </div>
      </section>

      {/* B. Two column splits content blocks */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mt-10">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          
          {/* LEFT PANEL: Overview, requirement charts, specs, screens */}
          <section className="lg:col-span-2">
            
            {/* Tabs control line */}
            <div className="border-b border-zinc-900 flex gap-4 text-xs font-semibold mb-6">
              {[
                { id: "overview", label: "Overview" },
                { id: "screenshots", label: "Screenshots" },
                { id: "community", label: "Community" }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`pb-3 border-b-2 font-mono transition uppercase ${
                    activeTab === tab.id
                      ? "border-pink-400 text-pink-400 font-bold"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* TAB CONTENT: Overview */}
            {activeTab === "overview" && (
              <div id="overview_tab" className="space-y-8">
                
                {/* 1. Summary details */}
                <div className="prose prose-invert max-w-none">
                  <h3 className="font-display font-medium text-white text-md uppercase tracking-wider mb-2.5">About this Game</h3>
                  <p className="text-zinc-400 text-xs md:text-sm leading-relaxed">
                    {summary || "No description available."}
                  </p>
                </div>

                {/* 2. System requirements block */}
                <div>
                  <h3 className="font-display font-medium text-white text-md uppercase tracking-wider mb-4">System Requirements</h3>
                  
                  <div className="flex gap-2 mb-4">
                    {Object.keys(game.systemRequirements).map((osKey) => (
                      <button
                        key={osKey}
                        onClick={() => setReqOs(osKey as any)}
                        className={`px-3 py-1 text-[11px] font-bold rounded capitalize font-mono ${
                          reqOs === osKey
                            ? "bg-pink-500 text-black shadow-md shadow-pink-500/15"
                            : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                        }`}
                      >
                        {osKey}
                      </button>
                    ))}
                  </div>

                  <div className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-4">
                    {game.systemRequirements[reqOs] ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                        
                        <div>
                          <p className="font-bold text-zinc-200 border-b border-zinc-900 pb-2 mb-3 uppercase tracking-wider font-display text-[11px]">Minimum OS specs</p>
                          <ul className="space-y-3 font-mono text-zinc-400">
                            <li className="flex items-start gap-2">
                              <Monitor className="h-3.5 w-3.5 shrink-0 text-pink-500/40 mt-0.5" />
                              <span><strong className="text-zinc-300">OS:</strong> {game.systemRequirements[reqOs]?.minimum.os}</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <Cpu className="h-3.5 w-3.5 shrink-0 text-pink-500/40 mt-0.5" />
                              <span><strong className="text-zinc-300">Processor:</strong> {game.systemRequirements[reqOs]?.minimum.processor}</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <Server className="h-3.5 w-3.5 shrink-0 text-pink-500/40 mt-0.5" />
                              <span><strong className="text-zinc-300">Memory:</strong> {game.systemRequirements[reqOs]?.minimum.memory}</span>
                            </li>
                            {game.systemRequirements[reqOs]?.minimum.graphics && (
                              <li className="flex items-start gap-2">
                                <Database className="h-3.5 w-3.5 shrink-0 text-pink-500/40 mt-0.5" />
                                <span><strong className="text-zinc-300">Graphics:</strong> {game.systemRequirements[reqOs]?.minimum.graphics}</span>
                              </li>
                            )}
                            <li className="flex items-start gap-2">
                              <Database className="h-3.5 w-3.5 shrink-0 text-pink-500/40 mt-0.5" />
                              <span><strong className="text-zinc-300">Storage:</strong> {game.systemRequirements[reqOs]?.minimum.storage}</span>
                            </li>
                          </ul>
                        </div>

                        <div>
                          <p className="font-bold text-zinc-200 border-b border-zinc-900 pb-2 mb-3 uppercase tracking-wider font-display text-[11px]">Recommended OS specs</p>
                          {game.systemRequirements[reqOs]?.recommended ? (
                            <ul className="space-y-3 font-mono text-zinc-400">
                              <li className="flex items-start gap-2">
                                <Monitor className="h-3.5 w-3.5 shrink-0 text-pink-500/40 mt-0.5" />
                                <span><strong className="text-zinc-300">OS:</strong> {game.systemRequirements[reqOs]?.recommended?.os}</span>
                              </li>
                              <li className="flex items-start gap-2">
                                <Cpu className="h-3.5 w-3.5 shrink-0 text-pink-500/40 mt-0.5" />
                                <span><strong className="text-zinc-300">Processor:</strong> {game.systemRequirements[reqOs]?.recommended?.processor}</span>
                              </li>
                              <li className="flex items-start gap-2">
                                <Server className="h-3.5 w-3.5 shrink-0 text-pink-500/40 mt-0.5" />
                                <span><strong className="text-zinc-300">Memory:</strong> {game.systemRequirements[reqOs]?.recommended?.memory}</span>
                              </li>
                              {game.systemRequirements[reqOs]?.recommended?.graphics && (
                                <li className="flex items-start gap-2">
                                  <Database className="h-3.5 w-3.5 shrink-0 text-pink-500/40 mt-0.5" />
                                  <span><strong className="text-zinc-300">Graphics:</strong> {game.systemRequirements[reqOs]?.recommended?.graphics}</span>
                                </li>
                              )}
                              <li className="flex items-start gap-2">
                                <Database className="h-3.5 w-3.5 shrink-0 text-pink-500/40 mt-0.5" />
                                <span><strong className="text-zinc-300">Storage:</strong> {game.systemRequirements[reqOs]?.recommended?.storage}</span>
                              </li>
                            </ul>
                          ) : (
                            <p className="text-[11px] text-zinc-500 font-mono italic p-4">No recommended specifications listed for this operating platform.</p>
                          )}
                        </div>

                      </div>
                    ) : (
                      <p className="text-zinc-500 text-xs py-4 text-center">Unspecified requirements for this system.</p>
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* TAB CONTENT: Screenshots */}
            {activeTab === "screenshots" && (
              <div id="screenshots_tab">
                <h3 className="font-display font-medium text-white text-md uppercase tracking-wider mb-4">Screenshots Gallery</h3>
                {screenshots.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {screenshots.map((screen, idx) => (
                      <div key={idx} className="relative aspect-video rounded-xl overflow-hidden border border-zinc-900 bg-zinc-900 group">
                        <img
                          src={screen}
                          alt={`Screenshot ${idx + 1}`}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-xs py-8 text-center">No screenshots available for this game.</p>
                )}
              </div>
            )}

            {/* TAB CONTENT: Community — real persisted comments */}
            {activeTab === "community" && (
              <GameComments gameId={game.id} />
            )}

          </section>

          {/* RIGHT SIDEBAR */}
          <aside id="game_sidebar" className="space-y-6">
            
            <div className="rounded-xl border border-zinc-900 bg-zinc-950/80 p-5 backdrop-blur-sm">
              <span className="inline-flex items-center gap-1.5 rounded bg-zinc-900 px-2.5 py-1 text-[9px] font-bold text-zinc-500 uppercase tracking-widest font-mono mb-4 border border-zinc-800">
                <div className="h-1.5 w-1.5 rounded-full bg-pink-400 animate-ping" />
                Updated {releaseDate}
              </span>

              <div className="space-y-2 mb-2">
                <button
                  id="main_download_trigger_btn"
                  onClick={() => {
                    setShowDownloadMenu(true);
                    showToast("Opening Secure Download Mirrors Portal...");
                  }}
                  className="w-full h-11 flex items-center justify-center gap-2.5 rounded-xl bg-pink-400 hover:bg-pink-300 font-display font-black text-black text-xs uppercase tracking-wider transition active:scale-[0.98] cursor-pointer shadow-lg shadow-pink-400/10 hover:shadow-pink-400/20"
                >
                  <Download className="h-4 w-4 stroke-[2.5]" />
                  <span>Choose Download Mirror</span>
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2 mt-4 text-[10px] font-bold font-mono text-zinc-500 uppercase">
                
                <button
                  onClick={() => {
                    if (!user) {
                      showToast("Please Sign in to add items to your Wishlist.");
                    } else {
                      toggleWishlist(game.id);
                      showToast(isWishlisted ? "Removed from Wishlist!" : "Added to Wishlist!");
                    }
                  }}
                  className={`flex flex-col items-center gap-1 border border-zinc-900 hover:border-zinc-700 py-2 rounded-lg transition cursor-pointer ${
                    isWishlisted ? "bg-pink-900/10 text-pink-500 border-pink-500/20" : ""
                  }`}
                >
                  <Heart className={`h-4 w-4 ${isWishlisted ? "fill-current" : ""}`} />
                  <span>Wishlist</span>
                </button>

                <button
                  onClick={() => {
                    if (!user) {
                      showToast("Please Sign in to upvote game.");
                    } else {
                      toggleLike(game.id);
                      showToast(isLiked ? "Revoked Like!" : "Uploader upvoted!");
                    }
                  }}
                  className={`flex flex-col items-center gap-1 border border-zinc-900 hover:border-zinc-700 py-2 rounded-lg transition cursor-pointer ${
                    isLiked ? "bg-pink-950/20 text-pink-400 border-pink-500/20" : ""
                  }`}
                >
                  <ThumbsUp className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />
                  <span>Upvote ({game.rating})</span>
                </button>

                <button
                  id="bookmark_toggle_btn"
                  onClick={() => {
                    toggleBookmark(game.id);
                    showToast(isBookmarked ? "Removed from Bookmarks!" : "Added to Bookmarks!");
                  }}
                  className={`flex flex-col items-center gap-1 border border-zinc-900 hover:border-zinc-700 py-2 rounded-lg transition cursor-pointer ${
                    isBookmarked ? "bg-emerald-950/20 text-emerald-400 border-emerald-500/20" : ""
                  }`}
                >
                  <Bookmark className={`h-4 w-4 ${isBookmarked ? "fill-current" : ""}`} />
                  <span>Bookmark</span>
                </button>

                <button
                  id="steam_store_btn"
                  onClick={() => {
                    const steamUrl = game.steamId 
                      ? `https://store.steampowered.com/app/${game.steamId}` 
                      : `https://store.steampowered.com/search/?term=${encodeURIComponent(game.title)}`;
                    window.open(steamUrl, "_blank", "noopener,noreferrer");
                    showToast(`Opening Steam page for ${game.title}...`);
                  }}
                  className="flex flex-col items-center gap-1 border border-zinc-900 hover:border-zinc-700 py-2 rounded-lg transition cursor-pointer"
                >
                  <ExternalLink className="h-4 w-4 text-pink-400" />
                  <span>Open Steam</span>
                </button>

              </div>
            </div>

            <div id="ad_warning_panel" className="bg-amber-950/10 border border-amber-500/20 rounded-xl p-4 flex gap-3 text-[11px] leading-relaxed text-amber-500">
              <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5 text-amber-500" />
              <div>
                <strong className="block font-bold mb-1 font-display uppercase tracking-wider text-[10px]">Watch out for ads!</strong>
                Make sure you are using uBlock, Firefox, Check the guide tab for more info on how to be safe!
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-zinc-950/40 border border-zinc-900 p-3 rounded-xl">
                <span className="text-[10px] text-zinc-500 font-mono uppercase font-semibold">Downloads</span>
                <p className="text-xl font-black font-display text-white mt-1">{(game.stats.downloads).toLocaleString()}</p>
              </div>
              <div className="bg-zinc-950/40 border border-zinc-900 p-3 rounded-xl">
                <span className="text-[10px] text-zinc-500 font-mono uppercase font-semibold">VIEWS</span>
                <p className="text-xl font-black font-display text-white mt-1">{(game.stats.views).toLocaleString()}</p>
              </div>
            </div>

            {/* Community rating — ported from UnionCrax experiences */}
            <RatingPanel gameId={game.id} />

            <div className="rounded-xl border border-zinc-900 bg-zinc-950/45 p-4 text-xs space-y-4">
              
              {rating > 0 && (
                <div className="flex justify-between items-center pb-2.5 border-b border-zinc-900">
                  <span className="text-zinc-500 font-semibold font-mono">Rating Score</span>
                  <span className="font-black text-pink-400 font-display flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-current" />
                    {rating}%
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center pb-2.5 border-b border-zinc-900">
                <span className="text-zinc-500 font-semibold font-mono">Archive Size</span>
                <span className="font-bold text-white font-mono">{game.fileSize}</span>
              </div>

              {releaseDate && (
                <div className="flex justify-between items-center pb-2.5 border-b border-zinc-900">
                  <span className="text-zinc-500 font-semibold font-mono">Released Year</span>
                  <span className="font-bold text-white font-mono">{releaseDate.substring(0, 4)}</span>
                </div>
              )}

              <div className="flex justify-between items-center">
                <span className="text-zinc-500 font-semibold font-mono">Uploader Role</span>
                <span className="rounded bg-pink-950 px-2 py-0.5 text-[9px] font-bold text-pink-400 uppercase tracking-widest border border-pink-500/20 font-mono">Verified</span>
              </div>

              <button
                onClick={handleEnrich}
                disabled={enriching}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[10px] font-bold font-mono text-zinc-300 hover:border-pink-500/30 hover:text-pink-300 transition cursor-pointer disabled:opacity-40"
              >
                {enriching ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3 text-pink-400" />
                )}
                {enriching ? "Syncing with Steam…" : "Refresh from Steam"}
              </button>

            </div>

          </aside>

        </div>
      </main>

      {/* DOWNLOAD MODAL */}
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
              className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-800 bg-[#0c0c0e] p-6 shadow-2xl z-10"
            >
              <button
                onClick={() => setShowDownloadMenu(false)}
                className="absolute top-4 right-4 rounded-full p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-white transition cursor-pointer"
              >
                <X className="h-4.5 w-4.5" />
              </button>

              <div>
                <div className="mb-4 pr-8">
                  <span className="text-[9px] font-bold text-pink-400 font-mono uppercase tracking-widest bg-pink-950/40 border border-pink-500/20 px-2 py-0.5 rounded">
                    Repack Download Ports ({game.fileSize})
                  </span>
                  <h2 className="mt-2 text-lg font-black text-white font-display uppercase tracking-tight">{title}</h2>
                  <p className="text-xs text-zinc-400 mt-1">Select one of our high-speed verified mirrors below. Bypass redirects to download safely.</p>
                </div>

                {(() => {
                  const sources = game.downloadSources && game.downloadSources.length > 0
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
                    <div className="space-y-4 max-h-[380px] overflow-y-auto pr-1">
                      {repackers.map((repacker) => (
                        <div key={repacker}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-[9px] font-bold font-mono uppercase tracking-widest text-pink-400 bg-pink-950/40 border border-pink-500/20 px-2 py-0.5 rounded">
                              {repacker}
                            </span>
                            <span className="text-[9px] text-zinc-600 font-mono">
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
                                  className="w-full text-left p-3 rounded-xl bg-zinc-950 border border-zinc-900 hover:border-pink-500/35 hover:bg-zinc-900 transition flex items-start gap-3 group cursor-pointer"
                                >
                                  <div className={`mt-0.5 rounded-lg p-2 border transition shrink-0 ${isMagnet ? "bg-violet-950/40 border-violet-500/20 text-violet-400 group-hover:bg-violet-950 group-hover:border-violet-400/40 group-hover:text-violet-300" : "bg-emerald-950/40 border-emerald-500/20 text-emerald-400 group-hover:bg-emerald-950 group-hover:border-emerald-400/40 group-hover:text-emerald-300"}`}>
                                    {isMagnet ? <Database className="h-4 w-4" /> : <Server className="h-4 w-4" />}
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className={`text-[9px] font-bold font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${isMagnet ? "bg-violet-950/60 text-violet-400 border border-violet-500/25" : "bg-emerald-950/60 text-emerald-400 border border-emerald-500/25"}`}>
                                        {isMagnet ? "⚡ Torrent" : "⬇ Direct"}
                                      </span>
                                      {src.fileSize && (
                                        <span className="text-[9px] font-mono font-bold text-zinc-300 bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded">
                                          {src.fileSize}
                                        </span>
                                      )}
                                      {src.name}
                                      {src.uploadDate && (
                                        <span className="text-[9px] font-mono text-zinc-600 ml-auto shrink-0">
                                          {new Date(src.uploadDate).toLocaleDateString()}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[10px] text-zinc-600 mt-1 font-mono truncate">{(src.url || "").slice(0, 55)}…</p>
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

                <div className="mt-5 pt-4 border-t border-zinc-900 text-[10px] font-mono text-zinc-600 text-center flex items-center justify-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-zinc-500" />
                  <span>Always ensure you have an active antivirus and adblocker active.</span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};
