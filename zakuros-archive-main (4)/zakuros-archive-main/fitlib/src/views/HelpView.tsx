import React, { useState } from "react";
import {
  Search,
  Download,
  ShieldCheck,
  Monitor,
  Bug,
  MessageSquare,
  ArrowRight,
  Lock,
  ChevronDown,
  BookOpen,
  FileArchive,
  Wrench,
  HardDrive,
  AlertTriangle,
  CheckCircle2,
  FolderCog,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Link } from "react-router-dom";

export const HelpView: React.FC = () => {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const quickLinks = [
    { icon: BookOpen, label: "The full guide", href: "#guide" },
    { icon: Search, label: "Searching the catalog", href: "#search" },
    { icon: Download, label: "How downloads work", href: "#downloads" },
    { icon: Monitor, label: "Install guides", href: "#install" },
    { icon: ShieldCheck, label: "Staying safe", href: "#safety" },
    { icon: Lock, label: "Accounts & login", href: "#accounts" },
    { icon: Bug, label: "Report a problem", href: "#report" },
  ];

  const guideSections = [
    {
      icon: Search,
      title: "Searching the catalog",
      id: "search",
      intro:
        "Searching is the fastest way through 20,000+ releases — and there's a hidden power-user trick built into the top bar.",
      steps: [
        {
          title: "Jump straight in (Ctrl+K)",
          body: "Press Ctrl+K (or Cmd+K on macOS) from anywhere to open the command palette. Type a partial title and hit Enter for instant results — no page reload, works mid-scroll. Esc closes it.",
        },
        {
          title: "Use the browse filters",
          body: "The Library page gives you year, genre, and native-Linux filters plus sorting. You can stack a genre with a year range, then sort by popularity, newest, rating, or downloads to zero in fast.",
        },
        {
          title: "Match what the metadata has",
          body: "Search matches the indexed title, developer, and genre fields. If a game is filed under its original Steam title but you know it by another name, use Browse's text filter to surface both spellings.",
        },
      ],
    },
    {
      icon: Download,
      title: "How downloads work",
      id: "downloads",
      intro:
        "Every game page lists the exact sources indexed for that release. Pick the one that fits your connection and preferences.",
      steps: [
        {
          title: "Pick the kind of source",
          body: "Repack = smaller archive, longer install (FitGirl, DODI). Direct = original files, bigger download, faster install (GOG, SteamRip, Xatab). Multiplayer patch = online-enabled variant for titles that support it.",
        },
        {
          title: "Check the badge before you go",
          body: "The Linux badge (Native, Gold, Silver, Platinum) is pulled live from ProtonDB — a Silver title likely needs a Proton launch command, while Native just runs. That's precisely what the badge is there to tell you before you commit to a big download.",
        },
        {
          title: "Downloads open the source page",
          body: "Nothing is hosted here. Clicking a mirror opens the repacker's own page in a new tab where the actual file lives. There is no in-site download step — the index stays lightweight and honest.",
        },
      ],
    },
    {
      icon: Monitor,
      title: "Install guides",
      id: "install",
      intro: "A clean install mostly comes down to a clean staging area and letting the repack's own tools do the integrity work.",
      steps: [
        {
          title: "Stage before you run",
          body: "Keep the archive on an NTFS volume with twice the repack's install size free. Wherever you extract, keep the installer and its .bin files in the same folder — never run the installer while it's still inside a zip or rar.",
        },
        {
          title: "Use the built-in verifier",
          body: "Every major repacker (FitGirl, DODI, Xatab) ships a file-check/verification step. Run it before and after install to catch a bad mirror or a corrupted download early — it rehashes every file against the repack manifest.",
        },
        {
          title: "Proton launch tips",
          body: "For titles without a Native badge, install Proton from Steam's compatibility settings, then set the game to force a specific GE/Proton version. A Gold or better ProtonDB tier is your green light.",
        },
      ],
    },
    {
      icon: ShieldCheck,
      title: "Staying safe",
      id: "safety",
      intro:
        "Zakuro's Archive is an index — a pointer map. The safety model is built on keeping that pointer map accurate and public.",
      steps: [
        {
          title: "Trust the badge, not the title",
          body: "The loudest release with the shiniest cover is the most common malware attack vector. Here, every entry is a verified Steam release with live ProtonDB data. If a cover attaches to the wrong appid it stays delisted until it lines up — that mismatch is the thing we filter out aggressively.",
        },
        {
          title: "Whitelist deliberately",
          body: "Repack installers trip antivirus false positives by design (custom packers). If a mirror is unusual, your AV flags it, AND the repack's own site doesn't list that binary — verify checksums and the binary's hash against the source page before you whitelist anything.",
        },
        {
          title: "Report what's wrong",
          body: "Spot a dead mirror, wrong cover, or missing link? Hit \"Report a problem\" from any game page. Every report lands in the queue with the game's context, so it gets cleaned on the next enrichment pass.",
        },
      ],
    },
    {
      icon: Lock,
      title: "Accounts & login",
      id: "accounts",
      intro: "Accounts are optional — download links work for everyone. Accounts exist for the community layer.",
      steps: [
        {
          title: "What an account is for",
          body: "Ratings, comments, and a watch history are tied to your account. Nothing else is gated: the full catalog, search, and download index are all public read-only.",
        },
        {
          title: "Sign in anywhere",
          body: "The top-right Sign In button toggles between login and create-account. Use the /register route if you want to jump straight to signup. Auth lives server-side; passwords are hashed, never stored in the browser.",
        },
        {
          title: "Community-first, ads-never",
          body: "There are no ads and no tracking scripts. Accounts never feed a marketing graph — ratings and comments only make the index more useful for the next person.",
        },
      ],
    },
    {
      icon: Bug,
      title: "Report a problem",
      id: "report",
      intro: "Found a bug, a stale mirror, or an inaccurate entry? There's a direct line in for all of it.",
      steps: [
        {
          title: "From a game page",
          body: "Every game has a Report action that pre-fills the title and ID so the fix lands on the right record. Describe what's wrong — dead mirror (report the exact URL), wrong cover, missing requirements — and it's triaged fast.",
        },
        {
          title: "Site doesn't feel right",
          body: "Broken layout, search missing results, a filter that ignores you — the Discord above covers the whole UI. Screenshots help most when a visual glitch is involved.",
        },
        {
          title: "About the metadata itself",
          body: "If enrichment looks wrong (wrong dev, placeholder summary, missing Linux data), the grind backfills those on a rolling schedule. Recent titles enrich faster than old ones — notice it on an old entry and it'll likely heal itself within the day.",
        },
      ],
    },
  ];

  const faqs = [
    {
      q: "What does the Linux badge mean?",
      a: "Native means a real Linux build exists. Gold/Platinum/Silver come from ProtonDB and describe how the Windows build plays under Proton — Platinum runs out of the box, Gold needs a small tweak, Silver might need a launch flag or GE-Proton. No badge = no reliable data yet.",
    },
    {
      q: "Is a repack faster than a direct download?",
      a: "Repacks trade download time for install time. The archive is smaller (great for capped connections), but the installer decompresses everything locally, so a 6GB repack can take 30-60 minutes to install. Direct downloads are bigger but done in minutes.",
    },
    {
      q: "Why is one game in both Repack and Direct?",
      a: "Many titles are repacked by one group and released direct by another. Both are legitimate sources; the game page lists each mirror's type so you can pick. Zakuro's Archive never prefers one — it just indexes what the groups publish.",
    },
    {
      q: "How do I verify a mirror is the original?",
      a: "Source mirrors are checked periodically and the index keeps the group-authorized URL per release. Still, always confirm the URL against the repack group's own site before downloading anything — and prefer their published checksums as the final word.",
    },
    {
      q: "My antivirus deleted the installer.",
      a: "That's the normal false-positive dance with custom repack packers — not a sign you were hit. Cross-check the exact filename and checksum against the repacker's release page, and test in a sandbox or VM if you're on the fence.",
    },
    {
      q: "What do the popularity/download numbers mean?",
      a: "Popularity is a weighted index of the catalog's own signals (views, saves, ratings) — not sales. Downloads reflect metadata interest aggregated from the index's own records. Both update on the enrichment cycle so they get sharper as the catalog matures.",
    },
    {
      q: "Can I request a game to be indexed?",
      a: "Yes — the community Request queue is the fastest way to signal a missing title. High-vote requests get prioritized in the enrichment pipeline. There's no guarantee a group will pick any title up, but the index reflects what's requested.",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-20">
      {/* Hero */}
      <section className="text-center max-w-3xl mx-auto py-8">
        <span className="inline-block rounded-full bg-rose-950/40 border border-rose-500/20 px-3.5 py-1 text-[11px] font-bold text-rose-400 uppercase tracking-widest font-mono">
          Full help & support
        </span>
        <h1 className="font-display font-black tracking-tight text-white mt-6 uppercase leading-tight text-4xl sm:text-5xl">
          We've got you<br />
          <span className="text-rose-400">covered</span>
        </h1>
        <p className="mt-4 text-zinc-400 text-sm leading-relaxed font-sans max-w-xl mx-auto">
          Every question the community actually asks, answered once. From the Ctrl+K trick to Proton badges — pick a topic or search the FAQ below.
        </p>

        {/* Quick topic nav */}
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          {quickLinks.map((q, idx) => (
            <a
              key={idx}
              href={q.href}
              className="flex items-center gap-1.5 rounded-full border border-zinc-900 bg-zinc-950/50 px-4 py-2 text-[11px] font-bold text-zinc-300 hover:border-rose-500/40 hover:text-white font-mono transition"
            >
              <q.icon className="h-3.5 w-3.5 text-rose-400" />
              {q.label}
            </a>
          ))}
        </div>
      </section>

      {/* Step guides */}
      {guideSections.map((s) => (
        <section key={s.id} id={s.id} className="space-y-6 max-w-4xl mx-auto">
          <div className="flex items-center gap-4">
            <div className="h-11 w-11 shrink-0 rounded-xl bg-rose-950/20 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <s.icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display font-black text-xl text-white uppercase leading-tight">{s.title}</h2>
              <p className="text-zinc-500 text-xs mt-1 max-w-2xl">{s.intro}</p>
            </div>
          </div>

          <div className="space-y-4">
            {s.steps.map((step, si) => (
              <div key={si} className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-5 relative overflow-hidden">
                <span className="absolute right-4 top-3 font-mono text-[10px] font-bold text-zinc-700">{String(si + 1).padStart(2, "0")}</span>
                <h3 className="font-display font-bold text-white uppercase text-xs mb-2 flex items-center gap-2">
                  <ArrowRight className="h-3.5 w-3.5 text-rose-400" />
                  {step.title}
                </h3>
                <p className="text-zinc-400 text-xs leading-relaxed font-sans">{step.body}</p>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Guide — install, patches, errors, save files */}
      <section id="guide" className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4">
          <div className="h-11 w-11 shrink-0 rounded-xl bg-rose-950/20 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display font-black text-xl text-white uppercase leading-tight">From download to running</h2>
            <p className="text-zinc-500 text-xs mt-1 max-w-2xl">
              The full lifecycle in one place — stage, extract, patch, troubleshoot, and find your saves. Follow these and most titles just work.
            </p>
          </div>
        </div>

        {/* Step 0 — Prepare */}
        <div className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-5 relative overflow-hidden">
          <span className="absolute right-4 top-3 font-mono text-[10px] font-bold text-zinc-700">01</span>
          <h3 className="font-display font-bold text-white uppercase text-xs mb-2 flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-rose-400" />
            Step 0 — Prepare, before you extract
          </h3>
          <ul className="text-zinc-400 text-xs leading-relaxed font-sans space-y-2">
            <li><span className="text-rose-400 font-bold">Exclude the folder in your antivirus first.</span> Cracked installers trip generic AV heuristics — Windows Defender silently deletes the launcher or a DLL mid-extraction Colors. Pick one folder for all your games (e.g. <code className="font-mono text-rose-300">D:\Games\Zakuro</code>) and add it to exclusions. You don't need to disable the AV.</li>
            <li><span className="text-rose-400 font-bold">Guide for specific AVs:</span> Windows Security → Virus & threat protection → Manage settings → Exclusions → Add exclusion → folder. Avast/AVG: Settings → Exceptions. Kaspersky: Threats and Exclusions. Bitdefender: Exceptions. Malwarebytes: Allow List.</li>
            <li><span className="text-rose-400 font-bold">Warning:</span> if the game won't launch after extracting, your AV deleted the launcher. Restore it from quarantine, add the folder exclusion, then re-extract.</li>
          </ul>
        </div>

        {/* Hardware / DL info tile */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-5">
            <div className="flex items-center gap-2 mb-2">
              <HardDrive className="h-3.5 w-3.5 text-rose-400" />
              <h4 className="font-display font-bold text-white uppercase text-xs">Hardware you'll want</h4>
            </div>
            <p className="text-zinc-400 text-xs leading-relaxed font-sans">
              8GB RAM minimum (16GB recommended), ~100GB free on the drive you install to, and a wired connection during the download. The archive page lists the exact space and RAM each title needs before you commit.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-5">
            <div className="flex items-center gap-2 mb-2">
              <Wrench className="h-3.5 w-3.5 text-rose-400" />
              <h4 className="font-display font-bold text-white uppercase text-xs">Download size vs install size</h4>
            </div>
            <p className="text-zinc-400 text-xs leading-relaxed font-sans">
              Repack = smaller archive (repcks for capped connections), but the installer decompresses everything locally — a 6GB repack can take 30–60 min to install. Direct = bigger download, done in minutes. Both say their sizes in the entry.
            </p>
          </div>
        </div>

        {/* Step 1 — Extract */}
        <div className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-5 relative overflow-hidden">
          <span className="absolute right-4 top-3 font-mono text-[10px] font-bold text-zinc-700">02</span>
          <h3 className="font-display font-bold text-white uppercase text-xs mb-2 flex items-center gap-2">
            <FileArchive className="h-3.5 w-3.5 text-rose-400" />
            Step 1 — Extract every part
          </h3>
          <ul className="text-zinc-400 text-xs leading-relaxed font-sans space-y-2">
            <li>Use 7-Zip (free) or WinRAR. Keep every part in the same folder and don't rename any of them.</li>
            <li>Right-click <code className="font-mono text-rose-300">part1</code> → Extract Here. The remaining parts unpack automatically — don't double-click part2, part3, etc.</li>
            <li>Extraction can take a few minutes for large releases. You need space about equal to the un-packed size.</li>
            <li><span className="text-rose-400 font-bold">"Cannot find next volume":</span> a part is missing or renamed — check the download finished, that no browser added a <code className="font-mono">(1)</code> suffix, and rename it back.</li>
          </ul>
        </div>

        {/* Step 2 — README + runtimes */}
        <div className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-5 relative overflow-hidden">
          <span className="absolute right-4 top-3 font-mono text-[10px] font-bold text-zinc-700">03</span>
          <h3 className="font-display font-bold text-white uppercase text-xs mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-rose-400" />
            Step 2 — Read README.html, install runtimes once
          </h3>
          <ul className="text-zinc-400 text-xs leading-relaxed font-sans space-y-2">
            <li>Open <code className="font-mono text-rose-300">README.html</code> inside the extracted folder. It lists the exact .exe to run Verified by the badge, any redistributables to install first, and game-specific notes. Always read it before launching.</li>
            <li><span className="text-rose-400 font-bold">Install these once</span> and most titles are covered: <span className="text-white">Visual C++ All-in-One, DirectX End-User Runtime, .NET Desktop Runtime (v6 and v8)</span>. Some folders bundle them under <code className="font-mono">_Redist</code> — running the bundles is harmless even if you already have a version.</li>
          </ul>
        </div>

        {/* Step 3 — Launch */}
        <div className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-5 relative overflow-hidden">
          <span className="absolute right-4 top-3 font-mono text-[10px] font-bold text-zinc-700">04</span>
          <h3 className="font-display font-bold text-white uppercase text-xs mb-2 flex items-center gap-2">
            <Monitor className="h-3.5 w-3.5 text-rose-400" />
            Step 3 — Launch
          </h3>
          <ul className="text-zinc-400 text-xs leading-relaxed font-sans space-y-2">
            <li>Run the .exe named in README.html — often the game's name, sometimes <code className="font-mono text-rose-300">Launcher.exe</code>.</li>
            <li>First launch: right-click → <span className="text-white">Run as Administrator</span> to let the game create its save folder.</li>
            <li>Nothing happens for a few seconds? Give it time — first launches build shader caches.</li>
            <li>Crash, freeze, or a missing DLL? Jump to the error table below.</li>
          </ul>
        </div>

        {/* Error fix table */}
        <div className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-5">
          <h3 className="font-display font-bold text-white uppercase text-xs mb-3 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
            Quick error fix-up
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] font-sans">
              <thead>
                <tr className="border-b border-zinc-900 text-zinc-500 font-mono text-[10px] uppercase tracking-wider">
                  <th className="py-2 pr-4 font-bold">Symptom</th>
                  <th className="py-2 font-bold">Fix</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 text-zinc-300">
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">MSVCP140.dll / VCRUNTIME140.dll</td><td className="py-2.5">Install the Visual C++ All-in-One pack.</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">XINPUT1_3.dll / d3dx9_*.dll</td><td className="py-2.5">Install the DirectX End-User Runtime.</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">0xc000007b</td><td className="py-2.5">Missing/mismatched Visual C++ — reinstall the All-in-One pack, reboot.</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">0xc0000142</td><td className="py-2.5">Run as Administrator; check your Windows username has no non-Latin chars; re-run VС++ pack.</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">"Please launch via Steam"</td><td className="py-2.5">AV deleted <code className="font-mono">steam_api64.dll</code>. Restore from quarantine or re-extract.</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">Instant exit / black screen</td><td className="py-2.5">Disable overlays (Discord, Steam, GeForce, RivaTuner); run as Admin; uncheck Read-only; update GPU driver.</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">CRC failed / Data error</td><td className="py-2.5">A part is corrupted — re-download it, preferably from a different mirror.</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">Access denied on extract</td><td className="py-2.5">Extract to a folder you own (e.g. <code className="font-mono">D:\Games\Zakuro</code>), not Program Files.</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-zinc-500 text-[10px] font-mono">
            Danger: never download DLLs from random sites — that's a classic malware vector. Restore from AV quarantine or re-extract instead.
          </p>
        </div>

        {/* Save files */}
        <div className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-5">
          <h3 className="font-display font-bold text-white uppercase text-xs mb-3 flex items-center gap-2">
            <FolderCog className="h-3.5 w-3.5 text-rose-400" />
            Finding save files
          </h3>
          <p className="text-zinc-400 text-xs mb-3 font-sans">Paste these into Explorer's address bar:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] font-sans">
              <thead>
                <tr className="border-b border-zinc-900 text-zinc-500 font-mono text-[10px] uppercase tracking-wider">
                  <th className="py-2 pr-4 font-bold">Path</th>
                  <th className="py-2 font-bold">What lives there</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 text-zinc-300">
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">%USERPROFILE%\Saved Games</td><td className="py-2.5">Many modern games</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">%USERPROFILE%\Documents</td><td className="py-2.5">Most games, in a subfolder named after the game</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">%LOCALAPPDATA%</td><td className="py-2.5">Many Steam and Uplay titles</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">%APPDATA%</td><td className="py-2.5">General saves and config</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">%APPDATA%\EMPRESS</td><td className="py-2.5">EMPRESS-cracked titles</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">%APPDATA%\Goldberg Social Club Emu Saves</td><td className="py-2.5">Ubisoft via Goldberg emu</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">%APPDATA%\Goldberg UplayEmu Saves</td><td className="py-2.5">Ubisoft via Goldberg emu</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">%APPDATA%\.1911\</td><td className="py-2.5">1911 releases</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">%APPDATA%\SOVEREIGN</td><td className="py-2.5">SOVEREIGN releases</td></tr>
                <tr><td className="py-2.5 pr-4 font-mono text-rose-300">%USERPROFILE%\Documents\onlinefix\&lt;appid&gt;</td><td className="py-2.5">OnlineFix co-op saves</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-zinc-500 text-[10px] font-mono">
            Still stuck? Re-read README.html, check the game's comment section, try a different mirror, then <Link to="/donate" className="text-rose-400 hover:text-rose-300">support the archive</Link> if we helped.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="space-y-6 max-w-4xl mx-auto">
        <div className="text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">FAQ</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Common Questions</h2>
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
                  <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform duration-300 flex-shrink-0 ml-4 ${isOpen ? "rotate-180 text-rose-400" : ""}`} />
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

      {/* Still stuck */}
      <section className="rounded-2xl border border-rose-500/10 bg-rose-950/10 p-8 text-center max-w-4xl mx-auto">
        <Bug className="h-8 w-8 text-rose-400 mx-auto mb-3" />
        <h3 className="font-display font-black text-white uppercase text-xl">Still stuck?</h3>
        <p className="text-zinc-400 text-xs max-w-xl mx-auto mt-2">
          Ask the community on Discord — include the game title and what exactly happens (error text, where the download fails) so someone can help you fast.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <a
            href="https://discord.gg"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-full bg-rose-400 px-6 py-2.5 text-xs font-bold text-black hover:bg-rose-300 transition"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Open Discord
          </a>
          <Link
            to="/donate"
            className="flex items-center gap-2 rounded-full border border-zinc-800 px-6 py-2.5 text-xs font-bold text-zinc-300 hover:text-white hover:border-zinc-700 transition"
          >
            Support the archive
          </Link>
        </div>
      </section>
    </div>
  );
};
