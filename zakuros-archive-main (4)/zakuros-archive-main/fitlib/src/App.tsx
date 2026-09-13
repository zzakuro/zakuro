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
import { Heart, Activity, Globe, Disc, Gamepad, Github } from "lucide-react";

export default function App() {
  return (
    <GameProvider>
      <HashRouter>
        <div className="flex min-h-screen flex-col bg-[#050506] text-zinc-100 antialiased selection:bg-pink-500 selection:text-black">
          
          {/* Top Sticky Header */}
          <Navbar />

          {/* Primary Main Content Canvas Frame */}
          <div className="flex-grow">
            <Routes>
              <Route path="/" element={<HomeView />} />
              <Route path="/browse" element={<BrowseView />} />
              <Route path="/game/:id" element={<GameDetailView />} />
              <Route path="/about" element={<AboutView />} />
              <Route path="/login" element={<AuthView />} />
              <Route path="/register" element={<AuthView />} />
            </Routes>
          </div>

          {/* Bottom Integrated Footer */}
          <footer className="border-t border-zinc-900 bg-zinc-950/60 py-12 text-zinc-500 text-xs mt-16">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-zinc-900">
                
                {/* Footer Brand info */}
                <div className="space-y-3 md:col-span-1.5 col-span-1">
                  <div className="flex items-center gap-2 text-md font-bold tracking-wider font-display text-white">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-pink-500/10 text-pink-400 font-extrabold ring-1 ring-pink-500/30 text-xs">
                      Z
                    </span>
                    <span>ZAKURO'S<span className="text-pink-400"> ARCHIVE</span></span>
                  </div>
                  <p className="text-zinc-500 font-sans leading-relaxed max-w-xs">
                    Unthrottled gaming archives.
                  </p>
                </div>

                {/* Footer Fast links */}
                <div className="space-y-2">
                  <span className="block font-bold text-zinc-300 font-display uppercase tracking-wider text-[10px]">Index Directory</span>
                  <ul className="space-y-1.5 font-mono">
                    <li><Link to="/" className="hover:text-pink-400 transition">Main / Home</Link></li>
                    <li><Link to="/browse" className="hover:text-pink-400 transition"> Library</Link></li>
                    <li><Link to="/about" className="hover:text-pink-400 transition">FAQ & safety</Link></li>
                  </ul>
                </div>

                {/* External launchers */}
                <div className="space-y-2">
                  <span className="block font-bold text-zinc-300 font-display uppercase tracking-wider text-[10px]">Communities</span>
                  <ul className="space-y-1.5 font-mono">
                    <li><a href="https://discord.gg" target="_blank" rel="noopener noreferrer" className="hover:text-pink-400 transition flex items-center gap-1">Discord Portal</a></li>
                    <li><a href="https://reddit.com" target="_blank" rel="noopener noreferrer" className="hover:text-pink-400 transition flex items-center gap-1">Reddit Sub</a></li>
                    <li><a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:text-pink-400 transition flex items-center gap-1">GitHub Repos</a></li>
                    <li><a href="https://twitch.tv" target="_blank" rel="noopener noreferrer" className="hover:text-pink-400 transition flex items-center gap-1">Donation Tier</a></li>
                  </ul>
                </div>

                {/* Diagnostics */}
                <div className="space-y-2 font-mono">
                  <span className="block font-bold text-zinc-300 font-display uppercase tracking-wider text-[10px]">System Status</span>
                  <div className="space-y-1 text-zinc-500 text-[11px]">
                    <p className="flex items-center gap-1.5 text-zinc-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span>All Servers Active</span>
                    </p>
                    <p className="text-zinc-600">IP verification: SSL Clean</p>
                    <p className="text-zinc-600">Archival Library: Lossless x64</p>
                  </div>
                </div>

              </div>

              {/* Legal line */}
              <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
                <p className="font-mono text-[10px] text-zinc-600">
                  © 2026 Zakuro's Archive Database Indexer. Developed with ❤️ for archival gaming preservation.
                </p>
                <p className="flex items-center gap-1 text-[10px] text-zinc-600 font-mono">
                  <span>Preserving raw source files with</span>
                  <Heart className="h-3 w-3 text-red-500 fill-current" />
                  <span>lossless storage codes</span>
                </p>
              </div>

            </div>
          </footer>

        </div>
      </HashRouter>
    </GameProvider>
  );
}
