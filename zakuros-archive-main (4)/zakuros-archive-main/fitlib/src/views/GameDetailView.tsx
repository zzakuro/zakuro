import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  Download, Heart, ThumbsUp, Star, HardDrive,
  ShieldAlert, Monitor, Cpu, Server, Database, Share2,
  Sparkles, CheckCircle, ExternalLink, ArrowLeft, Gamepad2, Bookmark, X,
  Loader2, Eye, CalendarClock, Library,
} from "lucide-react";
import { useGame } from "../lib/gameContext";
import { Game } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { RatingPanel } from "../components/RatingPanel";
import { GameComments } from "../components/GameComments";
import { LinuxBadge } from "../components/LinuxBadge";
import { GameCard, PlaceholderCover } from "../components/GameCard";

export const GameDetailView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { games, user, toggleWishlist, toggleLike, bookmarks, toggleBookmark } = useGame();
  const navigate = useNavigate();

  const game = games.find((g) => g.id === id);

  const [reqOs, setReqOs] = useState<"windows" | "linux" | "mac">("windows");
  const [showDownloadMenu, setShowDownloadMenu] = useState<boolean>(false);
  const [enriching, setEnriching] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [shotIdx, setShotIdx] = useState<number>(0);
  const [featBroken, setFeatBroken] = useState<boolean>(false);
  const [heroBroken, setHeroBroken] = useState<boolean>(false);

  // Reset per-game UI state when navigating between game pages.
  useEffect(() => {
    setShotIdx(0);
    setFeatBroken(false);
    setHeroBroken(false);
    const keys = Object.keys(game?.systemRequirements ?? {});
    setReqOs((keys[0] as "windows" | "linux" | "mac") || "windows");
  }, [game?.id]);

  useEffect(() => {
    setFeatBroken(false);
  }, [shotIdx]);

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
      showToast(meta.title ? `Refreshed details for ${meta.title}.` : "Metadata refreshed.");
    } catch (e: any) {
      showToast(e.message ?? "Steam refresh failed. Try again later.");
    } finally {
      setEnriching(false);
    }
  };

  /* ---------- derived data ---------- */
  const title = game.title;
  const summary = game.summary;
  const rating = game.rating;
  const releaseDate = game.releaseDate;
  const developer = game.developer;
  const publisher = game.publisher;
  const year = (releaseDate || "").match(/(19|20)\d{2}/)?.[0] ?? releaseDate;

  // Screenshot gallery (fall back to a single cover in a wide frame).
  const screenshots =
    game.screenshots && game.screenshots.length > 0
      ? game.screenshots
      : game.screenshot
        ? [game.screenshot]
        : game.coverImage
          ? [game.coverImage]
          : [];
  const featureShot = screenshots[shotIdx % Math.max(screenshots.length, 1)] || "";

  // Hero backdrop: Steam library hero art when known, else first screenshot.
  const heroUrl = game.steamId
    ? `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamId}/library_hero.jpg`
    : "";
  const heroOk = heroUrl && !heroBroken;

  const systemRequirements = game.systemRequirements ?? {};
  const reqKeys = Object.keys(systemRequirements);
  const activeReq = (systemRequirements as any)[reqOs] ? reqOs : ((reqKeys[0] || "windows") as "windows" | "linux" | "mac");

  const isWishlisted = user?.wishlist.includes(game.id) || false;
  const isLiked = user?.liked.includes(game.id) || false;
  const isBookmarked = bookmarks?.includes(game.id) || false;

  // Feature rows for the stats card (kryo-style "features" block).
  const isCoop = (game.genres || []).some((g) => /co-op|couch co-op/i.test(g));
  const isMulti = (game.genres || []).some((g) => /multiplayer|online|mmo|battle royale|pvp/i.test(g));
  const features = [
    { label: "Single-player", ok: true },
    ...(isCoop ? [{ label: "Co-op play supported", ok: true }] : []),
    ...(isMulti ? [{ label: "Multiplayer / online", ok: true }] : []),
    ...(game.linux && (game.linux.tier || game.linux.native)
      ? [{ label: game.linux.native ? "Native Linux build" : "Linux playable (Proton)", ok: true }]
      : []),
    { label: "Verified release in archive", ok: true },
  ];

  const repackers = Array.from(
    new Set((game.downloadSources || []).map((s) => s.repacker || "Source").filter(Boolean))
  );

  const related = useMemo(() => {
    const shared = (g2: Game) => (game.genres || []).filter((x) => (g2.genres || []).includes(x)).length;
    return [...games]
      .filter((g2) => g2.id !== game.id && shared(g2) > 0)
      .sort(
        (a, b) =>
          shared(b) - shared(a) ||
          (b.popularityScore ?? 0) - (a.popularityScore ?? 0) ||
          b.rating - a.rating
      )
      .slice(0, 8);
  }, [games, game]);

  const updatedLabel = game.stats?.updatedAt
    ? new Date(game.stats.updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";

  /* ---------- render ---------- */
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

      {/* A. Hero backdrop — clean image band (kryo-style) */}
      <section className="relative h-[42vh] min-h-[300px] w-full overflow-hidden border-b border-white/5 bg-black">
        {heroOk ? (
          <img
            src={heroUrl}
            alt={title}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover opacity-45"
            onError={() => setHeroBroken(true)}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-black to-black">
            <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-rose-500/10 blur-[100px]" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#09090b] via-[#09090b]/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#09090b]/80 via-transparent to-transparent" />

        {/* Back / Share */}
        <div className="absolute inset-x-0 top-6 z-20 mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 font-mono text-xs font-bold uppercase text-zinc-300 backdrop-blur-sm transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-rose-400" />
            Back
          </button>
          <button
            onClick={handleSharePage}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 font-mono text-xs font-bold uppercase text-zinc-300 backdrop-blur-sm transition hover:text-white"
          >
            <Share2 className="h-3.5 w-3.5 text-rose-400" />
            Share
          </button>
        </div>
      </section>

      {/* B. Heading — overlapping the hero (title + tags + byline) */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative z-10 -mt-20 pt-2">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {(game.genres || []).map((g) => (
              <Link
                key={g}
                to={`/browse?genre=${encodeURIComponent(g)}`}
                className="rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300 backdrop-blur-sm transition hover:border-rose-500/40 hover:text-rose-400"
              >
                {g}
              </Link>
            ))}
            {game.systemRequirements?.windows && (
              <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-400 ring-1 ring-rose-500/25">
                PC
              </span>
            )}
            {game.linux && (game.linux.tier || game.linux.native) && (
              <LinuxBadge linux={game.linux} className="!px-2.5 !py-1 !text-[10px]" />
            )}
          </div>

          <h1 className="font-display text-4xl font-bold tracking-tight text-white md:text-6xl">
            {title}
          </h1>

          <p className="mt-2 text-sm text-zinc-400">
            <span className="text-zinc-200">{developer}</span>
            {year && <span> · {year}</span>}
            {publisher && publisher !== developer && (
              <span className="text-zinc-500"> · Published by {publisher}</span>
            )}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-zinc-400">
            <span className="flex items-center gap-1.5 text-zinc-300">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-700 text-[8px] font-black text-white">
                ZA
              </span>
              Added by <b>Archive Indexer</b>
            </span>
            <span className="text-zinc-700">·</span>
            <span className="flex items-center gap-1.5 text-emerald-400/90">
              <CheckCircle className="h-3.5 w-3.5" /> Reviewed · verified release
            </span>
            {updatedLabel && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="flex items-center gap-1 text-zinc-400">
                  <Eye className="h-3 w-3" /> {(game.stats?.views ?? 0).toLocaleString()} views
                </span>
                <span className="flex items-center gap-1 text-zinc-400">
                  <Download className="h-3 w-3" /> {(game.stats?.downloads ?? 0).toLocaleString()} dl
                </span>
              </>
            )}
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-3">
          {/* ---------- Left: gallery, about, requirements, mirrors, comments ---------- */}
          <section className="space-y-12 lg:col-span-2">
            {/* Screenshot gallery */}
            <div>
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-[#0d0d10] ring-1 ring-white/[0.08]">
                {featureShot && !featBroken ? (
                  <img
                    src={featureShot}
                    alt={`${title} screenshot ${shotIdx + 1}`}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                    onError={() => setFeatBroken(true)}
                  />
                ) : (
                  <PlaceholderCover title={title} />
                )}
              </div>

              {screenshots.length > 1 && (
                <div className="no-scrollbar mt-3 flex gap-2.5 overflow-x-auto pb-1">
                  {screenshots.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setShotIdx(i)}
                      aria-label={`Show screenshot ${i + 1}`}
                      className={`h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-zinc-900 ring-1 transition ${
                        i === shotIdx
                          ? "ring-2 ring-rose-500"
                          : "ring-white/10 opacity-60 hover:opacity-100"
                      }`}
                    >
                      <img src={s} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* About this game */}
            <div id="about_game">
              <h2 className="mb-3 font-display text-2xl font-bold tracking-tight text-white">
                About this game
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-400">
                {summary || "No description available."}
              </p>
            </div>

            {/* System requirements */}
            <div id="system_requirements">
              <h2 className="mb-4 font-display text-2xl font-bold tracking-tight text-white">
                System requirements
              </h2>

              <div className="mb-4 flex gap-2">
                {reqKeys.map((osKey) => (
                  <button
                    key={osKey}
                    onClick={() => setReqOs(osKey as any)}
                    className={`rounded-full px-3.5 py-1 font-mono text-[11px] font-bold capitalize transition ${
                      activeReq === osKey
                        ? "bg-rose-500 text-white shadow-md shadow-rose-500/20"
                        : "bg-white/[0.04] text-zinc-400 ring-1 ring-white/10 hover:text-white"
                    }`}
                  >
                    {osKey}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl bg-[#0d0d10] p-5 ring-1 ring-white/[0.06]">
                {(systemRequirements as any)[activeReq] ? (
                  <div className="grid grid-cols-1 gap-8 text-xs md:grid-cols-2">
                    <ReqColumn
                      title="Minimum OS specs"
                      req={(systemRequirements as any)[activeReq]?.minimum}
                    />
                    <ReqColumn
                      title="Recommended OS specs"
                      req={
                        (systemRequirements as any)[activeReq]?.recommended
                          ? (systemRequirements as any)[activeReq]!.recommended!
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

            {/* Download mirrors */}
            <div id="download_mirrors">
              <h2 className="mb-4 font-display text-2xl font-bold tracking-tight text-white">
                Download {title}
              </h2>

              <button
                id="main_download_trigger_btn"
                onClick={() => {
                  setShowDownloadMenu(true);
                  showToast("Opening Secure Download Mirrors Portal...");
                }}
                className="flex h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-rose-500 font-display text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-rose-500/25 transition hover:bg-rose-400 active:scale-[0.99]"
              >
                <Download className="h-4 w-4" />
                Download · {game.fileSize || "—"}
              </button>

              {(game.downloadSources || []).length > 0 && (
                <div className="mt-4 overflow-hidden rounded-2xl bg-[#0d0d10] ring-1 ring-white/[0.06]">
                  {[...new Map((game.downloadSources || []).map((s) => [`${s.repacker}-${s.name}`, s])).values()]
                    .slice(0, 6)
                    .map((src, idx) => {
                      const isMagnet = src.type === "torrent" || (src.url || "").startsWith("magnet:");
                      return (
                        <button
                          key={idx}
                          onClick={() => handleMirrorClick({ ...src, isMagnet })}
                          className="group flex w-full cursor-pointer items-center gap-3 border-b border-white/[0.05] px-4 py-3 text-left transition last:border-0 hover:bg-white/[0.03]"
                        >
                          <div
                            className={`shrink-0 rounded-lg p-2 ring-1 ${
                              isMagnet
                                ? "bg-violet-500/10 text-violet-400 ring-violet-500/20"
                                : "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
                            }`}
                          >
                            {isMagnet ? <Database className="h-4 w-4" /> : <Server className="h-4 w-4" />}
                          </div>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-zinc-200">
                              {src.name}
                              {src.fileSize ? (
                                <span className="ml-2 rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] font-bold text-zinc-300 ring-1 ring-white/10">
                                  {src.fileSize}
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600">
                              {src.repacker || "Source"} · {(src.url || "").slice(0, 44)}…
                            </span>
                          </span>
                          <span className="shrink-0 text-zinc-600 transition group-hover:text-rose-400">→</span>
                        </button>
                      );
                    })}
                  {(game.downloadSources || []).length > 6 && (
                    <button
                      onClick={() => setShowDownloadMenu(true)}
                      className="w-full px-4 py-3 text-center font-mono text-[11px] font-bold uppercase tracking-widest text-zinc-500 transition hover:text-rose-400"
                    >
                      + {(game.downloadSources || []).length - 6} more mirrors
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Comments */}
            <div id="comments">
              <div className="mb-4 flex items-end justify-between">
                <h2 className="font-display text-2xl font-bold tracking-tight text-white">Comments</h2>
                <span className="font-mono text-[11px] text-zinc-600">Community · {game.stats?.views?.toLocaleString() || 0} views</span>
              </div>
              <GameComments gameId={game.id} />
            </div>
          </section>

          {/* ---------- Right: stats + download card ---------- */}
          <aside id="game_sidebar" className="space-y-5 lg:sticky lg:top-20 lg:self-start">
            {/* Stats card (kryo-style facts) */}
            <div className="rounded-2xl bg-[#0d0d10] p-5 ring-1 ring-white/[0.06]">
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <span className="font-display text-xs font-bold uppercase tracking-widest text-zinc-400">
                  Rating
                </span>
                <span className="flex items-center gap-1.5 font-display text-lg font-bold text-rose-400">
                  <Star className="h-4 w-4 fill-rose-400" />
                  {rating > 0 ? `${rating}% positive` : "Unrated"}
                </span>
              </div>

              <div className="divide-y divide-white/[0.05] text-xs">
                <InfoRow label="Developer" value={<span className="font-semibold text-white">{developer}</span>} />
                <InfoRow label="Release" value={<span className="font-semibold text-white">{year || "—"}</span>} />
                <InfoRow label="Install size" value={<span className="font-mono font-semibold text-white">{game.fileSize || "—"}</span>} />
                <InfoRow
                  label="Updated"
                  value={<span className="flex items-center gap-1 font-mono font-semibold text-white"><CalendarClock className="h-3 w-3 text-rose-400" />{updatedLabel || "—"}</span>}
                />
              </div>

              <div className="mt-4 border-t border-white/5 pt-4">
                <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Features
                </span>
                <ul className="space-y-1.5">
                  {features.map((f) => (
                    <li key={f.label} className="flex items-center gap-2 text-[11px] text-zinc-300">
                      <CheckCircle className={`h-3.5 w-3.5 ${f.ok ? "text-emerald-400" : "text-zinc-600"}`} />
                      {f.label}
                    </li>
                  ))}
                  {game.classic && (
                    <li className="flex items-center gap-2 text-[11px] text-zinc-300">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                      Classic / Retro title
                    </li>
                  )}
                </ul>
              </div>
            </div>

            {/* Download card */}
            <div className="rounded-2xl bg-[#0d0d10] p-5 ring-1 ring-white/[0.06]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-widest text-white">
                  <Library className="h-3.5 w-3.5 text-rose-400" />
                  Add to Library
                </h2>
              </div>

              <button
                onClick={() => {
                  toggleBookmark(game.id);
                  showToast(isBookmarked ? "Removed from library." : "Added to your library!");
                }}
                className={`flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl font-display text-xs font-bold uppercase tracking-wider transition active:scale-[0.98] ${
                  isBookmarked
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                    : "bg-white/[0.05] text-white ring-1 ring-white/10 hover:bg-white/[0.08]"
                }`}
              >
                <Bookmark className={`h-4 w-4 ${isBookmarked ? "fill-current" : ""}`} />
                {isBookmarked ? "In Library" : "Add to Library"}
              </button>

              <div className="mt-4 divide-y divide-white/[0.05] text-xs">
                <InfoRow
                  label="Source"
                  value={<span className="font-mono font-semibold text-white">{repackers.length ? repackers.join(" + ") : "Steam"}</span>}
                />
                <InfoRow label="Version" value={<span className="font-mono font-semibold text-white">latest</span>} />
                <InfoRow label="Download" value={<span className="font-mono font-semibold text-white">{game.fileSize || "—"}</span>} />
                <InfoRow label="Install" value={<span className="font-mono font-semibold text-white">{game.fileSize || "—"}</span>} />
                <div className="grid grid-cols-2 gap-2 px-3 py-3">
                  <div className="rounded-lg bg-white/[0.03] px-3 py-2 ring-1 ring-white/[0.06]">
                    <p className="font-mono text-[9px] font-bold uppercase text-zinc-500">Views</p>
                    <p className="mt-0.5 font-display text-sm font-bold text-white">{(game.stats?.views ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] px-3 py-2 ring-1 ring-white/[0.06]">
                    <p className="font-mono text-[9px] font-bold uppercase text-zinc-500">Downloads</p>
                    <p className="mt-0.5 font-display text-sm font-bold text-white">{(game.stats?.downloads ?? 0).toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowDownloadMenu(true);
                  showToast("Opening Secure Download Mirrors Portal...");
                }}
                className="mt-4 flex h-11 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-rose-500 font-display text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-rose-500/20 transition hover:bg-rose-400 active:scale-[0.98]"
              >
                <Download className="h-4 w-4" />
                Download · {game.fileSize || "—"}
              </button>

              <div className="mt-3 flex items-center justify-between">
                <Link
                  to="/help"
                  className="font-mono text-[10px] font-bold text-zinc-600 transition hover:text-rose-400"
                >
                  build out of date? report an update
                </Link>
                <button
                  onClick={handleEnrich}
                  disabled={enriching}
                  className="flex items-center gap-1 font-mono text-[10px] font-bold text-zinc-500 transition hover:text-rose-300 disabled:opacity-40"
                >
                  {enriching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-rose-400" />}
                  Refresh
                </button>
              </div>
            </div>

            {/* Community actions */}
            <div className="grid grid-cols-4 gap-2 text-[10px] font-bold uppercase text-zinc-500">
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

            <div className="flex gap-1.5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-[11px] leading-relaxed text-amber-500/90">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div>
                <strong className="mb-1 block font-display text-[10px] font-bold uppercase tracking-wider">
                  Watch out for ads!
                </strong>
                Make sure you are using an adblocker (e.g. uBlock Origin). Check the help tab for safety tips.
              </div>
            </div>

            <RatingPanel gameId={game.id} />
          </aside>
        </div>

        {/* C. More like this */}
        {related.length > 0 && (
          <section className="mt-16">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-rose-400">
                  ✦ Related
                </p>
                <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  More like this
                </h2>
              </div>
              <Link
                to={`/browse?genre=${encodeURIComponent(game.genres?.[0] || "")}`}
                className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-3.5 py-1.5 text-[11px] font-bold text-zinc-400 transition hover:border-rose-500/40 hover:text-white"
              >
                Browse {game.genres?.[0] || "similar"} <span aria-hidden>→</span>
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {related.map((g) => (
                <GameCard key={g.id} game={g} />
              ))}
            </div>
          </section>
        )}
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
              className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d10] p-6 shadow-2xl"
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
                                  <div className="flex flex-wrap items-center gap-1.5">
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

const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between px-0 py-3">
    <span className="font-mono font-semibold text-zinc-500">{label}</span>
    {value}
  </div>
);