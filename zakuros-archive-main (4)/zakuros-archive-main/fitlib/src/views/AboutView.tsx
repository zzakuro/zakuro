import React, { useState } from "react";
import {
  HelpCircle,
  ChevronDown,
  CheckCircle,
  Shield,
  Database,
  Search,
  ArrowRight,
  ExternalLink,
  Globe,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { PageHero, Reveal } from "../components/PageHero";
import { useGame } from "../lib/gameContext";

export const AboutView: React.FC = () => {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const { totalGames } = useGame();

  const indexedReleases = totalGames > 0 ? `${totalGames.toLocaleString()}+` : "80,000+";

  const scrollToFaq = () => {
    document.getElementById("faq-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const stats = [
    { label: "Indexed Releases", value: indexedReleases, icon: Database },
    { label: "Indexed Sources", value: "8", icon: Layers },
    { label: "File Hosting", value: "None", icon: Shield },
    { label: "Cost", value: "Free", icon: Globe },
  ];

  const features = [
    {
      title: "Multi-Source Index",
      description:
        "Zakuro's Archive aggregates release data from FitGirl, DODI, GOG, Xatab, SteamRip, OnlineFix, and more into a single searchable catalog. We don't pick winners — we index everything.",
      icon: Database,
    },
    {
      title: "No File Hosting",
      description:
        "Zakuro's Archive stores only metadata — titles, descriptions, cover art, system requirements, and external links. No game files, torrents, or binaries are hosted here. All downloads originate from the source groups directly.",
      icon: Shield,
    },
    {
      title: "Search & Discovery",
      description:
        "Browse by genre, repacker, release date, or search by title. Each game page shows all available download sources — torrent, magnet, or direct — so you can pick what works for you.",
      icon: Search,
    },
  ];

  const sources = [
    { name: "FitGirl Repacks", type: "Repack", url: "https://fitgirl-repacks.site" },
    { name: "DODI Repacks", type: "Repack", url: "https://dodi-repacks.site" },
    { name: "GOG Games", type: "DRM-Free", url: "https://gog-games.to" },
    { name: "Xatab", type: "Repack", url: "#" },
    { name: "SteamRip", type: "Direct", url: "https://steamrip.com" },
    { name: "OnlineFix", type: "Multiplayer Patch", url: "https://online-fix.me" },
    { name: "ATOP Games", type: "Direct", url: "#" },
    { name: "Rexa Games", type: "Direct", url: "#" },
  ];

  const faqs = [
    {
      q: "What exactly is Zakuro's Archive?",
      a: "Zakuro's Archive is a game catalog indexer. We scrape and aggregate release metadata from trusted repack and direct-download groups into one searchable database. We don't host, seed, or distribute any game files ourselves.",
    },
    {
      q: "Are the download links safe?",
      a: "Zakuro's Archive only indexes releases from established, well-known groups with long community track records. That said, we don't independently verify every file. Always download from the exact source URL listed, verify any checksums the repacker provides, and use a reputable antivirus. False positives from antivirus tools are common with repack installers — check the repacker's own site for known false positive reports.",
    },
    {
      q: "What's the difference between a repack and a direct download?",
      a: "A repack (like FitGirl or DODI) recompresses the game into a smaller archive to reduce download size. When you run the installer, it decompresses back to the full game — no quality loss, but installation takes longer. A direct download is the game's original files without recompression, typically larger but faster to install.",
    },
    {
      q: "How does the request queue work?",
      a: "Community members can submit titles they want indexed. High-vote requests get visibility — but Zakuro's Archive doesn't produce repacks or uploads. Requests are community signals; the actual release depends on the repack groups themselves picking up a title.",
    },
    {
      q: "Do you host torrents or magnet links?",
      a: "No. Zakuro's Archive stores the magnet URI or external download URL as metadata alongside the game entry. Clicking a download link takes you directly to the source — we're never in the middle of the transfer.",
    },
    {
      q: "Why are some games missing Steam IDs or cover art?",
      a: "Our metadata is sourced from Steam and IGDB APIs where possible. Games that are GOG-exclusive, DRM-free only, or not on Steam may have incomplete metadata. We're continuously enriching the database.",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-20">

      {/* Hero */}
      <PageHero
        eyebrow="Game release index — not a host"
        title={
          <>
            One place to find
            <br />
            <span className="text-gradient animate">every release</span>
          </>
        }
        lead="Zakuro's Archive is a read-only index of PC game releases from reputable repack and direct-download groups. Search, filter, and find download sources — all in one place, with no ads and no file hosting."
        actions={
          <>
            <button
              type="button"
              onClick={scrollToFaq}
              className="rounded-full border border-white/10 bg-white/[0.03] px-6 py-2.5 font-mono text-xs font-bold text-zinc-300 transition hover:border-rose-500/40 hover:text-white"
            >
              Read the FAQ
            </button>
            <a
              href="https://discord.gg"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-full bg-[#5865F2] px-6 py-2.5 font-mono text-xs font-bold text-white shadow-lg shadow-[#5865F2]/20 transition hover:bg-[#4752C4] active:scale-95"
            >
              <span>Join Discord</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </>
        }
      />

      {/* Stats */}
      <Reveal>
        <section className="panel grid grid-cols-2 gap-4 p-6 font-mono md:grid-cols-4">
          {stats.map((stat, idx) => (
            <div key={idx} className="flex flex-col items-center text-center p-3">
              <div className="h-10 w-10 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/20 mb-3 text-rose-400">
                <stat.icon className="h-5 w-5" />
              </div>
              <p className="text-2xl font-black font-display text-white">{stat.value}</p>
              <p className="text-[10px] text-zinc-500 mt-1 uppercase font-bold tracking-wider">{stat.label}</p>
            </div>
          ))}
        </section>
      </Reveal>

      {/* What Zakuro's Archive does */}
      <Reveal>
      <section className="space-y-8">
        <div className="text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">How it works</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">What Zakuro's Archive is (and isn't)</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((feat, idx) => (
            <div key={idx} className="panel panel-hover p-5">
              <div className="h-9 w-9 rounded-lg bg-white/[0.04] flex items-center justify-center border border-white/10 text-rose-400 mb-4">
                <feat.icon className="h-4 w-4" />
              </div>
              <h3 className="font-display font-bold text-white uppercase text-sm mb-2">{feat.title}</h3>
              <p className="text-zinc-400 text-xs leading-relaxed font-sans">{feat.description}</p>
            </div>
          ))}
        </div>
      </section>
      </Reveal>

      {/* Indexed sources */}
      <Reveal>
      <section className="space-y-6">
        <div className="text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Sourced from</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Indexed Release Groups</h2>
          <p className="text-zinc-500 text-xs mt-2 font-sans max-w-lg mx-auto">
            These are the groups whose releases appear in the Zakuro's Archive catalog. Zakuro's Archive has no affiliation with any of them — we only index their public release metadata.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {sources.map((src, idx) => {
            const linked = src.url && src.url !== "#";
            const cardClass = "panel panel-hover group flex flex-col gap-1.5 p-4";
            const inner = (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-white text-xs group-hover:text-rose-400 transition">{src.name}</span>
                  {linked && <ExternalLink className="h-3 w-3 text-zinc-600 group-hover:text-rose-400 transition" />}
                </div>
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{src.type}</span>
              </>
            );
            return linked ? (
              <a
                key={idx}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cardClass}
              >
                {inner}
              </a>
            ) : (
              <div key={idx} className={cardClass} aria-label={`${src.name} — no public site linked`}>
                {inner}
              </div>
            );
          })}
        </div>
      </section>
      </Reveal>

      {/* FAQ */}
      <Reveal>
      <section id="faq-section" className="space-y-8 max-w-4xl mx-auto">
        <div className="text-center">
          <HelpCircle className="h-7 w-7 text-rose-400 mx-auto mb-2" />
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">FAQ</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Common Questions</h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, idx) => {
            const isOpen = activeFaq === idx;
            return (
              <div
                key={idx}
                className="panel panel-hover overflow-hidden transition"
              >
                <button
                  onClick={() => setActiveFaq(isOpen ? null : idx)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between p-5 text-left hover:bg-zinc-900/10 transition"
                >
                  <span className="font-display font-bold text-white text-xs sm:text-sm uppercase tracking-wide">
                    {faq.q}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-zinc-500 transition-transform duration-300 flex-shrink-0 ml-4 ${
                      isOpen ? "rotate-180 text-rose-400" : ""
                    }`}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: "auto" }}
                      exit={{ height: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="p-5 border-t border-zinc-900/60 text-zinc-400 text-xs sm:text-sm leading-relaxed font-sans bg-[#0c0c14]/15">
                        {faq.a}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </section>
      </Reveal>

      {/* Footer CTA */}
      <Reveal>
      <section className="panel rounded-2xl border-rose-500/15 p-8 text-center max-w-4xl mx-auto flex flex-col items-center gap-4">
        <CheckCircle className="h-9 w-9 text-rose-400" />
        <h3 className="font-display font-black text-white uppercase text-xl">Something missing from the index?</h3>
        <p className="text-zinc-400 text-xs max-w-xl font-sans">
          If a release isn't in the catalog yet, submit a request in the Request tab or drop it in the Discord. The community keeps the index growing.
        </p>
        <a
          href="https://discord.gg"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center gap-2 rounded-full bg-rose-400 px-6 py-2.5 text-xs font-bold text-black hover:bg-rose-300 transition"
        >
          <span>OPEN DISCORD</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </section>
      </Reveal>

    </div>
  );
};