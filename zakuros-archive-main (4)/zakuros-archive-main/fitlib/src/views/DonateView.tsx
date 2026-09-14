import React, { useState } from "react";
import {
  Heart,
  Coffee,
  Server,
  Database,
  Wifi,
  ShieldCheck,
  Copy,
  Check,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { motion } from "motion/react";

export const DonateView: React.FC = () => {
  const [amount, setAmount] = useState(3);
  const [copied, setCopied] = useState<string | null>(null);

  const presets = [1, 3, 5, 10];

  const copyAddress = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard blocked; nothing to do
    }
  };

  const supportTiers = [
    {
      icon: Heart,
      name: "One-Time",
      desc: "A coffee's worth, straight to server costs. No account, no strings.",
    },
    {
      icon: Coffee,
      name: "Monthly",
      desc: "Monthly supporters keep the index running and get a community badge after two consecutive months.",
    },
    {
      icon: Server,
      name: "Infra Hero",
      desc: "Donations that reliably cover a full hosting month fund metadata snapshots for the whole community.",
    },
  ];

  const wallets = [
    { key: "btc", ticker: "BTC", name: "Bitcoin", address: "bc1qzakuroarchive0x0000000000000000demo" },
    { key: "eth", ticker: "ETH", name: "Ethereum", address: "0xZakurosArchiveDemoWallet000000000000001" },
    { key: "xmr", ticker: "XMR", name: "Monero", address: "4ZakurosArchiveDemoMoneroAddressX00000000000000000000" },
  ];

  const useOfFunds = [
    { icon: Server, label: "Server & bandwidth", detail: "Hosting, the Vite infrastructure, and the API serving 20,000+ entries 24/7." },
    { icon: Database, label: "Metadata enrichment", detail: "Steam & ProtonDB API quota so descriptions, badges, and covers stay fresh." },
    { icon: Wifi, label: "Mirror checks", detail: "Automated availability pings so dead links are flagged and pruned quickly." },
    { icon: ShieldCheck, label: "Zero ads, forever", detail: "The index stays free and ad-free for everyone. Donations replace ad revenue, not supplement it." },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-20">

      {/* Hero */}
      <section className="text-center max-w-3xl mx-auto py-8">
        <span className="rounded-full bg-rose-950/40 border border-rose-500/20 px-3.5 py-1 text-[11px] font-bold text-rose-400 uppercase tracking-widest font-mono">
          Keep the index alive
        </span>
        <h1 className="font-display font-black tracking-tight text-white mt-6 uppercase leading-tight text-4xl sm:text-5xl">
          Support the<br />
          <span className="text-rose-400">archive</span>
        </h1>
        <p className="mt-4 text-zinc-400 text-sm leading-relaxed font-sans max-w-xl mx-auto">
          Zakuro's Archive is free, open, and ad-free. Every contribution goes straight to server costs, API quota, and mirror checks — never into anyone's pocket.
        </p>
        <div className="mt-8 flex justify-center gap-3 flex-wrap">
          <a
            href="#donate-now"
            className="flex items-center gap-1.5 rounded-full bg-rose-400 hover:bg-rose-300 font-mono text-xs font-bold px-6 py-2.5 text-black transition active:scale-95 shadow-lg shadow-rose-500/20"
          >
            <Heart className="h-3.5 w-3.5" />
            <span>Donate now</span>
          </a>
          <a
            href="#funds"
            className="rounded-full border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 font-mono text-xs font-bold px-6 py-2.5 text-zinc-300 hover:text-white transition"
          >
            Where it goes
          </a>
        </div>
      </section>

      {/* Donation card */}
      <section id="donate-now" className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-zinc-900 bg-zinc-950/40 overflow-hidden">
          <div className="border-b border-zinc-900 p-6 sm:p-8">
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Contribution</span>
            <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Pick an amount</h2>
            <p className="text-zinc-500 text-xs mt-2 font-sans">
              Cards, PayPal and crypto all go to the same infrastructure fund. One-time or monthly, any amount helps.
            </p>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {/* Amount presets */}
            <div className="flex flex-wrap items-center gap-3">
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => setAmount(p)}
                  className={`rounded-xl border px-5 py-3 font-mono text-sm font-bold transition ${
                    amount === p
                      ? "border-rose-500/60 bg-rose-500/10 text-rose-400"
                      : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-white"
                  }`}
                >
                  ${p}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
                <span className="font-mono text-sm font-bold text-white">$</span>
                <input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
                  className="w-16 bg-transparent font-mono text-sm font-bold text-white outline-none"
                />
              </div>
            </div>

            {/* CTA buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <a
                href="https://www.paypal.com/donate"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-center gap-2 rounded-xl bg-rose-400 px-6 py-3.5 font-mono text-sm font-bold text-black hover:bg-rose-300 transition active:scale-[0.99]"
              >
                PayPal ${amount}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </a>
              <a
                href="https://github.com/sponsors"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-6 py-3.5 font-mono text-sm font-bold text-zinc-300 hover:border-zinc-700 hover:text-white transition"
              >
                GitHub Sponsors
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <p className="text-[10px] font-mono text-zinc-600 text-center">
              Demo links: production donation endpoints are wired at launch.
            </p>
            <hr className="border-zinc-900" />

            {/* Crypto */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Direct crypto</span>
              </div>
              <div className="space-y-3">
                {wallets.map((w) => (
                  <div key={w.key} className="flex items-center gap-3 rounded-xl border border-zinc-900 bg-black/20 p-4">
                    <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800">
                      <span className="font-mono text-[9px] font-black text-rose-400">{w.ticker}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">{w.name}</p>
                      <p className="truncate font-mono text-xs text-zinc-300">{w.address}</p>
                    </div>
                    <button
                      onClick={() => copyAddress(w.key, w.address)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 hover:border-rose-500/40 transition"
                      aria-label={`Copy ${w.name} address`}
                    >
                      {copied === w.key ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-zinc-500" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center font-mono text-[10px] text-zinc-600 max-w-xl mx-auto">
          Donations cover operational costs only. We never take money in exchange for listings, links, or review positioning — the index stays neutral.
        </p>
      </section>

      {/* Support tiers */}
      <section className="space-y-8 max-w-5xl mx-auto">
        <div className="text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Ways to give</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">How your support counts</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {supportTiers.map((tier, idx) => (
            <div key={idx} className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-5 hover:border-rose-500/20 transition duration-300">
              <div className="h-9 w-9 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800 text-rose-400 mb-4">
                <tier.icon className="h-4 w-4" />
              </div>
              <h3 className="font-display font-bold text-white uppercase text-sm mb-2">{tier.name}</h3>
              <p className="text-zinc-400 text-xs leading-relaxed font-sans">{tier.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Where funds go */}
      <section id="funds" className="space-y-6 max-w-4xl mx-auto">
        <div className="text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Transparency</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Where the money goes</h2>
          <p className="text-zinc-500 text-xs mt-2 font-sans max-w-lg mx-auto">
            A small server and a lot of metadata — here's the rough budget split every month.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {useOfFunds.map((item, idx) => (
            <div key={idx} className="flex gap-4 rounded-xl border border-zinc-900 bg-zinc-950/40 p-5">
              <div className="h-9 w-9 shrink-0 rounded-lg bg-rose-950/20 border border-rose-500/20 flex items-center justify-center text-rose-400">
                <item.icon className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-display font-bold text-white uppercase text-xs mb-1">{item.label}</h3>
                <p className="text-zinc-400 text-xs leading-relaxed font-sans">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="rounded-2xl border border-rose-500/10 bg-rose-950/10 p-8 text-center max-w-4xl mx-auto flex flex-col items-center gap-4">
        <Heart className="h-9 w-9 text-rose-400" />
        <h3 className="font-display font-black text-white uppercase text-xl">Prefer to just browse?</h3>
        <p className="text-zinc-400 text-xs max-w-xl font-sans">
          That's perfectly fine. The whole archive is free forever, with or without donations. If you do chip in, thank you — you're literally paying for the bytes sitting on this page.
        </p>
        <motion.a
          href="https://discord.gg"
          target="_blank"
          rel="noopener noreferrer"
          whileTap={{ scale: 0.97 }}
          className="mt-2 flex items-center gap-2 rounded-full bg-rose-400 px-6 py-2.5 text-xs font-bold text-black hover:bg-rose-300 transition"
        >
          <span>JOIN THE COMMUNITY</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </motion.a>
      </section>

    </div>
  );
};