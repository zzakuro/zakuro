/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { Suspense, lazy } from "react";
import { HashRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { GameProvider } from "./lib/gameContext";
import { Navbar } from "./components/Navbar";
import { Heart } from "lucide-react";

// Route-level code splitting — the shell (Navbar, provider, router) stays
// in the critical first-paint chunk; each view loads only when navigated to.
const HomeView = lazy(() => import("./views/HomeView").then((m) => ({ default: m.HomeView })));
const BrowseView = lazy(() => import("./views/BrowseView").then((m) => ({ default: m.BrowseView })));
const GameDetailView = lazy(() => import("./views/GameDetailView").then((m) => ({ default: m.GameDetailView })));
const AboutView = lazy(() => import("./views/AboutView").then((m) => ({ default: m.AboutView })));
const HelpView = lazy(() => import("./views/HelpView").then((m) => ({ default: m.HelpView })));
const DonateView = lazy(() => import("./views/DonateView").then((m) => ({ default: m.DonateView })));
const AuthView = lazy(() => import("./views/AuthView").then((m) => ({ default: m.AuthView })));

function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-950/20">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-rose-400/20 border-t-rose-400" />
        </div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Reticulating splines…
        </p>
      </div>
    </div>
  );
}

// Safety net: a render error anywhere in a view must not take down the whole
// app with a blank page. The boundary resets on every route change so a single
// broken route never traps the user on a black screen.
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-[70vh] flex-col items-center justify-center gap-4 px-4 text-center">
          <h2 className="font-display text-xl font-bold uppercase text-white">SOMETHING WENT WRONG</h2>
          <p className="max-w-md text-xs text-zinc-500">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-full bg-rose-500 px-6 py-2.5 font-mono text-xs font-bold text-white transition hover:bg-rose-400"
          >
            TRY AGAIN
          </button>
          <Link to="/" className="font-mono text-[10px] text-zinc-400 underline hover:text-white">
            BACK TO HOMEPAGE
          </Link>
        </div>
      );
    }
    return this.props.children;
  }
}

function RoutedBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary key={location.pathname}>{children}</ErrorBoundary>;
}

export default function App() {
  return (
    <GameProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <div className="relative flex min-h-screen flex-col bg-[#09090b] text-zinc-100 antialiased selection:bg-rose-500 selection:text-white">
          <Navbar />

          <div className="relative z-10 flex-grow">
            <RoutedBoundary>
              <Routes>
              <Route path="/" element={<HomeView />} />
              <Route path="/browse" element={<BrowseView />} />
              <Route path="/game/:id" element={<GameDetailView />} />
              <Route path="/about" element={<AboutView />} />
              <Route path="/help" element={<HelpView />} />
              <Route path="/donate" element={<DonateView />} />
              <Route path="/login" element={<AuthView />} />
              <Route path="/register" element={<AuthView />} />
            </Routes>
            </RoutedBoundary>
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
                    <li><Link to="/help" className="transition hover:text-rose-400">Help & guides</Link></li>
                    <li><Link to="/donate" className="transition hover:text-rose-400">Support the archive</Link></li>
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