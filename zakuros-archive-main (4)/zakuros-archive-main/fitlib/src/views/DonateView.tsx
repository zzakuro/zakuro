import React, { useState } from "react";
import {
  Heart,
  ShieldCheck,
  Server,
  Database,
  Wifi,
  Copy,
  Check,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";

export const DonateView: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);

  const copyAddress = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard blocked; nothing to do
    }
  };

  const wallets = [
    { key: "btc", ticker: "BTC", name: "Bitcoin", address: "bc1qzakuroarchive0x0000000000000000demo" },
    { key: "eth", ticker: "ETH", name: "Ethereum", address: "0xZakurosArchiveDemoWallet000000000000001" },
    { key: "xmr", ticker: "XMR", name: "Monero", address: "4ZakurosArchiveDemoMoneroAddressX00000000000000000000" },
  ];

  const useOfFunds = [
    { icon: Server, label: "Server & bandwidth", detail: "Hosting and the API serving 20,000+ entries 24/7." },
    { icon: Database, label: "Metadata enrichment", detail: "Steam & ProtonDB API quota so descriptions, badges, and covers stay fresh." },
    { icon: Wifi, label: "Mirror checks", detail: "Automated availability pings so dead links are flagged and pruned quickly." },
    { icon: ShieldCheck, label: "Zero ads, forever", detail: "The index stays free and ad-free for everyone. Donations replace ad revenue, not supplement it." },
  ];

  const supportTiers = [
    {
      icon: Heart,
      name: "One-Time",
      desc: "A coffee's worth, straight to server costs. No account, no strings.",
    },
    {
      icon: Heart,
      name: "Monthly",
      desc: "Monthly supporters keep the index running and get a community badge after two consecutive months.",
    },
    {
      icon: Heart,
      name: "Infra Hero",
      desc: "Donations that reliably cover a full hosting month fund metadata snapshots for the whole community.",
    },
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
            href="#funds"
            className="flex items-center gap-1.5 rounded-full bg-rose-400 hover:bg-rose-300 font-mono text-xs font-bold px-6 py-2.5 text-black transition active:scale-95 shadow-lg shadow-rose-500/20"
          >
            <Heart className="h-3.5 w-3.5" />
            <span>View wallets</span>
          </a>
          <a
            href="#funds"
            className="rounded-full border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 font-mono text-xs font-bold px-6 py-2.5 text-zinc-300 hover:text-white transition"
          >
            Where it goes
          </a>
        </div>
      </section>

      {/* Crypto wallets card */}
      <section id="funds" className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-zinc-900 bg-zinc-950/40 overflow-hidden">
          <div className="border-b border-zinc-900 p-6 sm:p-8">
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Direct crypto</span>
            <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Send a wallet</h2>
            <p className="text-zinc-400 text-xs mt-2 font-sans max-w-lg">
              No account, no middleman, tap a button to copy the addresscars. One-time or monthly, any amount helps.
            </p>
          </div>

          <div className="p-6 sm:p-8 space-y-3">
            {wallets.map((w) => (
              <div key={w.key} className="flex items-center gap-3 rounded-xl border border-zinc-900 bg-zinc-950/40 p-4">
                <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800">
                  <span className="font-mono text-[9px] font-black text-rose-400">{w.ticker}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-white">{w.address}</p>
                  <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">{w.name}</p>
                </div>
                <button
                  onClick={() => copyAddress(w.key, w.address)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 hover:border-rose-500/40 transition"
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

        <p className="mt-4 text-center font-mono text-[10px] text-zinc-600 max-w-xl mx-auto">
          Demo addresses: production wallets are wired at launch.
        </p>
      </section>

      {/* Support tiers */}
      <section className="space-y-4 max-w-6xl mx-auto">
        <div className="text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Support tiers</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">How your support counts</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {supportTiers.map((tier, idx) => (
            <div key={idx} className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-5 hover:border-rose-500/20 transition duration-300">
              <div className="h-9 w-9 rounded-lg bg-rose-950/20 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-4">
                <tier.icon className="h-4 w-4" />
              </div>
              <h3 className="font-display font-bold text-white uppercase text-xs mb-2">{tier.name}</h3>
              <p className="text-zinc-400 text-xs leading-relaxed font-sans">{tier.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Where funds go */}
      <section className="space-y-4 max-w-6xl mx-auto">
        <div className="text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Transparency</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Where the money goes</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
      <section className="rounded-2xl border border-rose-500/10 bg-rose-950/10 p-8 text-center max-w-4xl mx-auto">
        <Heart className="h-8 w-8 text-rose-400 mx-auto mb-3" />
        <h3 className="font-display font-black text-white uppercase text-xl">Prefer to just browse?</h3>
        <p className="text-zinc-400 text-xs max-w-xl mx-auto mt-2">
          That's perfectly fine. The whole archive is free forever, with or without donations.
        </p>
        <Link
          to="/browse"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-rose-400 px-6 py-2.5 text-xs font-bold text-black hover:bg-rose-300 transition"
        >
          Browse the library
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

    </div>
  );
};
