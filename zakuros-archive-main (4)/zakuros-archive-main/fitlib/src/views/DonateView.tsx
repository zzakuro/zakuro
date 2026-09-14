import React, { useState } from "react";
import {
  Heart,
  Copy,
  Check,
  Server,
  Database,
  Wifi,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";

export const DonateView: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);

  const wallets = [
    { key: "btc", ticker: "BTC", name: "Bitcoin", address: "bc1qzakuroarchive0x0000000000000000demo" },
    { key: "eth", ticker: "ETH", name: "Ethereum", address: "0xZakurosArchiveDemoWallet000000000000001" },
    { key: "xmr", ticker: "XMR", name: "Monero", address: "4ZakurosArchiveDemoMoneroAddressX00000000000000000000" },
  ];

  const copyAddress = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard blocked; nothing to do
    }
  };

  const useOfFunds = [
    { icon: Server, label: "Server & bandwidth", detail: "Hosting and the API serving 20,000+ entries 24/7." },
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
          Zakuro's Archive is free, open, and ad-free. Donations are sent straight to the wallets below — no cards, no PayPal, no middleman. Every contribution covers server costs, API quota, and mirror checks.
        </p>
      </section>

      {/* Crypto wallets */}
      <section id="funds" className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-zinc-900 bg-zinc-950/40 overflow-hidden">
          <div className="border-b border-zinc-900 p-6 sm:p-8">
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Direct crypto</span>
            <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Send a wallet</h2>
            <p className="text-zinc-500 text-xs mt-2 font-mono">
              Tap an address to copy it, paste it into your wallet, and you're done.
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

      {/* Where funds go */}
      <section className="space-y-6 max-w-4xl mx-auto">
        <div className="text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Transparency</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Where the money goes</h2>
          <p className="text-zinc-500 text-xs mt-2">A small server and a lot of metadata — here's the rough split.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {useOfFunds.map((item, idx) => (
            <div key={idx} className="flex gap-4 rounded-xl border border-zinc-900 bg-zinc-950/40 p-5">
              <div className="h-9 w-9 shrink-0 rounded-lg bg-rose-950/20 border border-rose-500/20 flex items-center justify-center text-rose-400">
                <item.icon className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-display font-bold text-white uppercase text-xs mb-1">{item.label}</h3>
                <p className="text-zinc-400 text-xs leading-relaxed">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="rounded-2xl border border-zinc-900 bg-zinc-950/40 p-8 text-center max-w-4xl mx-auto">
        <Heart className="h-8 w-8 text-rose-400 mx-auto mb-3" />
        <h3 className="font-display font-black text-white uppercase text-xl">Only crypto counts</h3>
        <p className="text-zinc-400 text-xs mt-2 max-w-xl mx-auto">
          Everything goes through the wallets above — no autopay, no subscription, no cards. Send once, give monthly, or just browse.
        </p>
        <Link
          to="/browse"
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-rose-400 px-6 py-2.5 text-xs font-bold text-black hover:bg-rose-300 transition"
        >
          Browse the library
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

    </div>
  );
};
