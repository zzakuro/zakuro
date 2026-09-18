import React, { useRef, useState } from "react";
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
import { PageHero, Reveal } from "../components/PageHero";

export const DonateView: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const wallets = [
    { key: "btc", ticker: "BTC", name: "Bitcoin", address: "bc1qzakuroarchive0x0000000000000000demo" },
    { key: "eth", ticker: "ETH", name: "Ethereum", address: "0xZakurosArchiveDemoWallet000000000000001" },
    { key: "xmr", ticker: "XMR", name: "Monero", address: "4ZakurosArchiveDemoMoneroAddressX00000000000000000000" },
  ];

  const copyAddress = async (key: string, value: string) => {
    setCopyError(false);
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // Clipboard API blocked (insecure context / permissions): fall back to
      // a hidden textarea + execCommand so copying still works.
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      setCopyError(true);
      return;
    }
    setCopied(key);
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      setCopied((c) => (c === key ? null : c));
    }, 2000);
  };

  const useOfFunds = [
    { icon: Server, label: "Server & bandwidth", detail: "Hosting and the API serving 80,000+ entries 24/7." },
    { icon: Database, label: "Metadata enrichment", detail: "Steam & ProtonDB API quota so descriptions, badges, and covers stay fresh." },
    { icon: Wifi, label: "Mirror checks", detail: "Automated availability pings so dead links are flagged and pruned quickly." },
    { icon: ShieldCheck, label: "Zero ads, forever", detail: "The index stays free and ad-free for everyone. Donations replace ad revenue, not supplement it." },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-20">

      {/* Hero */}
      <PageHero
        eyebrow="Keep the index alive"
        title={
          <>
            Support the
            <br />
            <span className="text-gradient animate">archive</span>
          </>
        }
        lead="Zakuro's Archive is free, open, and ad-free. Donations are sent straight to the wallets below — no cards, no PayPal, no middleman. Every contribution covers server costs, API quota, and mirror checks."
      />

      {/* Crypto wallets */}
      <Reveal>
      <section id="funds" className="max-w-3xl mx-auto">
        <div className="panel overflow-hidden rounded-2xl">
          <div className="border-b border-white/5 p-6 sm:p-8">
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Direct crypto</span>
            <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Send a wallet</h2>
            <p className="text-zinc-500 text-xs mt-2 font-mono">
              Tap an address to copy it, paste it into your wallet, and you're done.
            </p>
          </div>
          <div className="p-6 sm:p-8 space-y-3">
            {wallets.map((w) => (
              <div key={w.key} className="panel flex items-center gap-3 p-4">
                <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] border border-white/10">
                  <span className="font-mono text-[9px] font-black text-rose-400">{w.ticker}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-white">{w.address}</p>
                  <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">{w.name}</p>
                </div>
                <button
                  onClick={() => copyAddress(w.key, w.address)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 hover:border-rose-500/40 transition"
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
            {copyError && (
              <p className="pt-1 font-mono text-[10px] text-rose-400">
                Couldn't copy automatically — select the address and copy it manually.
              </p>
            )}
          </div>
        </div>

        <p className="mt-4 text-center font-mono text-[10px] text-zinc-600 max-w-xl mx-auto">
          Demo addresses: production wallets are wired at launch.
        </p>
      </section>
      </Reveal>

      {/* Where funds go */}
      <Reveal>
      <section className="space-y-6 max-w-4xl mx-auto">
        <div className="text-center">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest font-mono">Transparency</span>
          <h2 className="font-display font-black text-2xl text-white mt-1 uppercase">Where the money goes</h2>
          <p className="text-zinc-500 text-xs mt-2">A small server and a lot of metadata — here's the rough split.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {useOfFunds.map((item, idx) => (
            <div key={idx} className="panel panel-hover flex gap-4 p-5">
              <div className="h-9 w-9 shrink-0 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
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
      </Reveal>

      {/* Closing CTA */}
      <Reveal>
      <section className="panel rounded-2xl border-rose-500/15 p-8 text-center max-w-4xl mx-auto">
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
      </Reveal>

    </div>
  );
};
