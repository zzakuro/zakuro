import React, { useState } from "react";
import {
  HelpCircle,
  ChevronDown,
  Search,
  Monitor,
  Download,
  User,
  Star,
  Bug,
  MessageSquare,
  BookOpen,
  ExternalLink,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Link } from "react-router-dom";

export const HelpView: React.FC = () => {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const sections = [
    {
      icon: Search,
      title: "Finding games",
      items: [
        {
          q: "How do I search the catalog?",
          a: "Press Ctrl+K (or Cmd+K on macOS) anywhere to open the command palette, then type the game title, developer, or genre. Press Enter to jump straight into full-library search. On the Browse page you can also filter by year, genre, and sort by popularity, newest, or title.",
        },
        {
          q: "Why is a game I want missing?",
          a: "The catalog only indexes releases we can verify from the source groups. A title may be missing because the group hasn't repacked it yet, it's delisted from stores, or it's exclusive to a platform we don't cover. Use the request feature in About to signal it to the community.",
        },
      ],
    },
    {
      icon: Download,
      title: "Downloading releases",
      items: [
        {
          q: "What do the download sources mean?",
          a: "Each game page lists every indexed source with its type: Repack (smaller download, slower install), Direct (original files, larger), DRM-Free (GOG-style), or Multiplayer Patch (online capable). Choose whichever fits your connection and preference — we don't host any of them.",
        },
        {
          q: "I clicked a source but nothing happens.",
          a: "Sources open in a new tab at the repacker's own page or torrent client. Pop-up blockers can silently swallow them — allow pop-ups for Zakuro's Archive, or right-click the link and select \"Open in new tab\".",
        },
        {
          q: "The file size says 0 B.",
          a: "Some mirrors don't report archive sizes. The listed size is the best metadata available at index time; the real size always appears on the repacker's own release page.",
        },
      ],
    },
    {
      icon: Monitor,
      title: "Installation & running",
      items: [
        {
          q: "Why do repack installers scare my antivirus?",
          a: "Repacks use custom compressors and installer code, which antivirus tools frequently flag as false positives. Check the repacker's own site for a known false-positive list, verify checksums they publish, and whitelist the installer only if you trust the source. We index releases only from established groups.",
        },
        {
          q: "The game won't launch. What now?",
          a: "Confirm your system meets the listed requirements, run the installer's verification tool (FitGirl and DODI both ship one) to catch corrupt files, then reinstall via a different mirror. For multiplayer patches, the specific online fix has its own launcher — run the game through that, in the order the source instructs.",
        },
        {
          q: "How do I read the Linux badge?",
          a: "A game wearing the Linux badge has community Proton compatibility data from ProtonDB. Native means a proper Linux build; Gold/Platinum/Silver tiers describe how well it runs under Proton. Tiers are community-reported and can shift with Wine/Proton versions.",
        },
      ],
    },
    {
      icon: User,
      title: "Accounts & community",
      items: [
        {
          q: "Do I need an account to download?",
          a: "No. Browsing and downloading work without an account. Accounts exist for the community features — leaving ratings, commenting on games, and tracking your rating history.",
        },
        {
          q: "I can't log in / sign up.",
          a: "Register from the Sign In page via the \"Create account\" toggle, or visit /register directly. If an account can't be created, the backend community service may be starting — wait a minute and retry.",
        },
      ],
    },
    {
      icon: Bug,
      title: "Troubleshooting the site",
      items: [
        {
          q: "The site shows stale data.",
          a: "The catalog refreshes automatically in the background as metadata is enriched. Hard-refresh with Ctrl+Shift+R to bypass the browser cache and pull the newest index.",
        },
        {
          q: "A game page looks broken or is missing art.",
          a: "This is a metadata signal — the entry is still being enriched. Give it a few hours and revisit: covers, descriptions, and requirements populate on a rolling schedule. Persistent issues after that are worth reporting on Discord.",
        },
      ],
    },
  ];

  const faqs = sections.flatMap((s) => s.items);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-20">

      {/* Hero */}
      <section className="text-center max-w-3xl mx-auto py-8">
        <span className="rounded-full bg-rose-950/40 border border-rose-500/20 px-3.5 py-1 text-[11px] font-bold text-rose-400 uppercase tracking-widest font-mono">
          Guides, tips & troubleshooting
        </span>
        <h1 className="font-display font-black tracking-tight text-white mt-6 uppercase leading-tight text-4xl sm:text-5xl">
          How can we<br />
          <span className="text-rose-400">help you?</span>
        </h1>
        <p className="mt-4 text-zinc-400 text-sm leading-relaxed font-sans max-w-xl mx-auto">
          Everything you need to search the index, use downloads safely, install releases, and get the most out of the community.
        </p>
        <div className="mt-8 flex justify-center gap-3 flex-wrap">
          <a
            href="#guides"
            className="rounded-full border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 font-mono text-xs font-bold px-6 py-2.5 text-zinc-300 hover:text-white transition"
          >
            Browse guides
          </a>
          <a
            href="#support-faq"
            className="flex items-center gap-1.5 rounded-full bg-rose-400 hover:bg-rose-300 font-mono text-xs font-bold px-6 py-2.5 text-black transition active:scale-95 shadow-lg shadow-rose-500/20"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>FAQ & support</span>
          </a>
        </div>
      </section>

      {/* Guides */}
      <section id="guides" className="space-y-8 max-w-5xl mx-auto">
        <div className="text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Step by step</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Quick-Start Guides</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: Search,
              step: "01",
              title: "Search & filter",
              body: "Press Ctrl+K for instant search, or use Browse with year, genre and sort filters to narrow 20,000+ releases down to what you want.",
            },
            {
              icon: Download,
              step: "02",
              title: "Pick a source",
              body: "Open any game, review its system requirements and Linux badge, then choose your preferred mirror and source type on the download tab.",
            },
            {
              icon: Monitor,
              step: "03",
              title: "Install safely",
              body: "Verify checksums, whitelist the installer only if you trust the repacker, and use the repack's built-in verification before playing.",
            },
          ].map((g, idx) => (
            <div key={idx} className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-5 hover:border-rose-500/20 transition duration-300 relative overflow-hidden">
              <span className="absolute top-3 right-4 font-mono text-[10px] text-zinc-700 font-bold">{g.step}</span>
              <div className="h-9 w-9 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800 text-rose-400 mb-4">
                <g.icon className="h-4 w-4" />
              </div>
              <h3 className="font-display font-bold text-white uppercase text-sm mb-2">{g.title}</h3>
              <p className="text-zinc-400 text-xs leading-relaxed font-sans">{g.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Topic sections */}
      {sections.map((section, idx) => (
        <section key={idx} className="space-y-6 max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-rose-950/20 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <section.icon className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Guide</span>
              <h2 className="font-display font-black text-xl text-white uppercase leading-tight">{section.title}</h2>
            </div>
          </div>
          <div className="space-y-3">
            {section.items.map((faq, i) => {
              const flatIdx = faqs.indexOf(faq);
              const isOpen = activeFaq === flatIdx;
              return (
                <div key={i} className="rounded-xl border border-zinc-900 bg-zinc-950/45 overflow-hidden">
                  <button
                    onClick={() => setActiveFaq(isOpen ? null : flatIdx)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-zinc-900/10 transition"
                  >
                    <span className="font-display font-bold text-white text-xs sm:text-sm uppercase tracking-wide">{faq.q}</span>
                    <ChevronDown
                      className={`h-4 w-4 text-zinc-500 transition-transform duration-300 flex-shrink-0 ml-4 ${isOpen ? "rotate-180 text-rose-400" : ""}`}
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
                        <div className="p-4 border-t border-zinc-900/60 text-zinc-400 text-xs sm:text-sm leading-relaxed font-sans bg-[#0c0c14]/15">
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
      ))}

      {/* Full FAQ list */}
      <section id="support-faq" className="space-y-8 max-w-4xl mx-auto">
        <div className="text-center">
          <HelpCircle className="h-7 w-7 text-rose-400 mx-auto mb-2" />
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Support</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">All Common Questions</h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, idx) => {
            const isOpen = activeFaq === idx;
            return (
              <div key={idx} className="rounded-xl border border-zinc-900 bg-zinc-950/45 overflow-hidden">
                <button
                  onClick={() => setActiveFaq(isOpen ? null : idx)}
                  className="w-full flex items-center justify-between p-5 text-left hover:bg-zinc-900/10 transition"
                >
                  <span className="font-display font-bold text-white text-xs sm:text-sm uppercase tracking-wide">{faq.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 text-zinc-500 transition-transform duration-300 flex-shrink-0 ml-4 ${isOpen ? "rotate-180 text-rose-400" : ""}`}
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

      {/* Resources */}
      <section className="space-y-6 max-w-4xl mx-auto">
        <div className="text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">More help</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">External Resources</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Read the FAQ & safety", to: "/about", icon: BookOpen },
            { label: "Report a bug on Discord", href: "https://discord.gg", icon: MessageSquare },
            { label: "Browse the whole library", to: "/browse", icon: Search },
          ].map((r, idx) => {
            const inner = (
              <>
                <r.icon className="h-4 w-4 text-rose-400" />
                <span className="font-mono font-bold text-white text-xs group-hover:text-rose-400 transition">{r.label}</span>
                {r.href ? <ExternalLink className="h-3 w-3 text-zinc-600 group-hover:text-rose-400 transition ml-auto" /> : <ArrowRight className="h-3 w-3 text-zinc-600 group-hover:text-rose-400 transition ml-auto" />}
              </>
            );
            return r.href ? (
              <a key={idx} href={r.href} target="_blank" rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-xl border border-zinc-900 bg-zinc-950/40 hover:border-rose-500/20 p-4 transition duration-200">
                {inner}
              </a>
            ) : (
              <Link key={idx} to={r.to as string}
                className="group flex items-center gap-3 rounded-xl border border-zinc-900 bg-zinc-950/40 hover:border-rose-500/20 p-4 transition duration-200">
                {inner}
              </Link>
            );
          })}
        </div>
      </section>

      {/* Still stuck CTA */}
      <section className="rounded-2xl border border-rose-500/10 bg-rose-950/10 p-8 text-center max-w-4xl mx-auto flex flex-col items-center gap-4">
        <CheckCircle2 className="h-9 w-9 text-rose-400" />
        <h3 className="font-display font-black text-white uppercase text-xl">Still stuck?</h3>
        <p className="text-zinc-400 text-xs max-w-xl font-sans">
          Ask the community on Discord. Include the game title and what exactly happens (error text, where the download fails) so someone can help you fast.
        </p>
        <a
          href="https://discord.gg"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center gap-2 rounded-full bg-rose-400 px-6 py-2.5 text-xs font-bold text-black hover:bg-rose-300 transition"
        >
          <span>GET HELP ON DISCORD</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
        <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-zinc-600">
          <Star className="h-3 w-3" /> Prefer it free and ad-free? You're already here.
        </span>
      </section>

    </div>
  );
};