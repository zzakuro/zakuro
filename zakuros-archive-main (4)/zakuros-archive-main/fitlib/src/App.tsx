/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React from "react";
import { HashRouter, Routes, Route, Link } from "react-router-dom";
import { GameProvider } from "./lib/gameContext";
import { Navbar } from "./components/Navbar";
import { HomeView } from "./views/HomeView";
import { BrowseView } from "./views/BrowseView";
import { GameDetailView } from "./views/GameDetailView";
import { AboutView } from "./views/AboutView";
import { AuthView } from "./views/AuthView";
import { Heart } from "lucide-react";

export default function App() {
  return (
    <GameProvider>
      <HashRouter>
        <div className="relative flex min-h-screen flex-col bg-[#09090b] text-zinc-100 antialiased selection:bg-rose-500 selection:text-white">
          <Navbar />

          <div className="relative z-10 flex-grow">
            <Routes>
              <Route path="/" element={<HomeView />} />
              <Route path="/browse" element={<BrowseView />} />
              <Route path="/game/:id" element={<GameDetailView />} />
              <Route path="/about" element={<AboutView />} />
              <Route path="/login" element={<AuthView />} />
              <Route path="/register" element={<AuthView />} />
            </Routes>
          </div>

          {/* Footer */}
          <footer className="relative z-10 mt-20 border-t border-white/5 bg-[#0a0a0c] py-12 text-xs text-zinc-500">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-2 gap-10 border-b border-white/5 pb-10 md:grid-cols-4">
                <div className="col-span-2 space-y-3 md:col-span-1">
                  <div className="flex items-center gap-2 font-display text-sm font-bold tracking-widest text-white">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-rose-500 to-rose-700 text-xs font-black text-white">
                      Z
                    </span>
                    <span>ZAKURO'S<span className="text-rose-400"> ARCHIVE</span></span>
                  </div>
                  <p className="max-w-xs leading-relaxed text-zinc-500">
                    A read-only index of PC game releases. We host metadata, never game files.
                  </p>
                </div>

                <div className="space-y-2.5">
                  <span className="block font-display text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Index Directory
                  </span>
                  <ul className="space-y-1.5 font-mono">
                    <li><Link to="/" className="transition hover:text-rose-400">Main / Home</Link></li>
                    <li><Link to="/browse" className="transition hover:text-rose-400">Library</Link></li>
                    <li><Link to="/about" className="transition hover:text-rose-400">FAQ & safety</Link></li>
                  </ul>
                </div>

                <div className="space-y-2.5">
                  <span className="block font-display text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    Communities
                  </span>
                  <ul className="space-y-1.5 font-mono">
                    <li><a href="https://discord.gg" target="_blank" rel="noopener noreferrer" className="transition hover:text-rose-400">Discord Portal</a></li>
                    <li><a href="https://reddit.com" target="_blank" rel="noopener noreferrer" className="transition hover:text-rose-400">Reddit Sub</a></li>
                    <li><a href="https://github.com" target="_blank" rel="noopener noreferrer" className="transition hover:text-rose-400">GitHub Repos</a></li>
                  </ul>
                </div>

                <div className="space-y-2.5 font-mono">
                  <span className="block font-display text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    System Status
                  </span>
                  <div className="space-y-1 text-[11px]">
                    <p className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      All Servers Active
                    </p>
                    <p className="text-zinc-600">IP verification: SSL Clean</p>
                    <p className="text-zinc-600">Archival Library: Lossless x64</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center justify-between gap-4 pt-8 md:flex-row">
                <p className="font-mono text-[10px] text-zinc-600">
                  © 2026 Zakuro's Archive Database Indexer. Developed with{" "}
                  <Heart className="inline h-3 w-3 fill-rose-500 text-rose-500" /> for archival gaming preservation.
                </p>
                <p className="font-mono text-[10px] text-zinc-600">
                  Preserving raw source files with lossless storage codes
                </p>
              </div>
            </div>
          </footer>
        </div>
      </HashRouter>
    </GameProvider>
  );
}