/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { Suspense, lazy } from "react";
import { HashRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { GameProvider } from "./lib/gameContext";
import { Navbar } from "./components/Navbar";
import { Heart } from "lucide-react";
import { motion } from "motion/react";

// Route-level code splitting — the shell (Navbar, provider, router) stays
// in the critical first-paint chunk; each view loads only when navigated to.
const HomeView = lazy(() => import("./views/HomeView").then((m) => ({ default: m.HomeView })));
const BrowseView = lazy(() => import("./views/BrowseView").then((m) => ({ default: m.BrowseView })));
const GameDetailView = lazy(() => import("./views/GameDetailView").then((m) => ({ default: m.GameDetailView })));
const AboutView = lazy(() => import("./views/AboutView").then((m) => ({ default: m.AboutView })));
const HelpView = lazy(() => import("./views/HelpView").then((m) => ({ default: m.HelpView })));
const DonateView = lazy(() => import("./views/DonateView").then((m) => ({ default: m.DonateView })));
const AuthView = lazy(() => import("./views/AuthView").then((m) => ({ default: m.AuthView })));
const SourcesView = lazy(() => import("./views/SourcesView").then((m) => ({ default: m.SourcesView })));

function RouteFallback() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-14 sm:px-6 lg:px-8">
      <div className="skeleton h-12 w-64 max-w-full" />
      <div className="skeleton h-4 w-full max-w-xl" />
      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="skeleton aspect-[3/4]" />
        ))}
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
  return (
    // Entrance animation keyed to the route + error isolation per path.
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
    >
      <ErrorBoundary key={location.pathname}>{children}</ErrorBoundary>
    </motion.div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="font-mono text-xs font-bold uppercase tracking-widest text-rose-400">404</p>
      <h2 className="font-display text-3xl font-bold uppercase text-white">Page not found</h2>
      <p className="max-w-sm text-sm text-zinc-500">
        That page doesn't exist — it may have been renamed, or the link was mistyped.
      </p>
      <Link
        to="/"
        className="rounded-full bg-rose-500 px-6 py-2.5 font-mono text-xs font-bold text-white transition hover:bg-rose-400"
      >
        BACK TO HOMEPAGE
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <div className="relative flex min-h-screen flex-col bg-[var(--color-dark-bg)] text-zinc-100 antialiased selection:bg-rose-500 selection:text-white">
          {/* Site-wide aurora ambience — screen-blended pools, barely there */}
          <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
            <div className="aurora-blob aurora-blob-soft left-[-14%] top-[-22%] h-[60vh] w-[46vw] bg-rose-500/[0.07]" />
            <div className="aurora-blob aurora-blob-soft aurora-blob-alt right-[-16%] top-[30%] h-[58vh] w-[42vw] bg-violet-500/[0.06]" />
            <div className="aurora-blob aurora-blob-soft aurora-blob-alt bottom-[-30%] left-[16%] h-[60vh] w-[50vw] bg-rose-500/[0.05]" />
            <div className="aurora-blob aurora-blob-soft right-[-12%] bottom-[-26%] h-[56vh] w-[44vw] bg-violet-500/[0.05]" />
          </div>

          {/* Skip link — first tab stop, jumps keyboard/AT users straight to content */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-full focus:bg-rose-500 focus:px-4 focus:py-2 focus:text-xs focus:font-bold focus:text-white"
          >
            Skip to content
          </a>

          <Navbar />

          <div id="main-content" className="relative z-10 flex-grow">
            <RoutedBoundary>
              <Routes>
              <Route path="/" element={<HomeView />} />
              <Route path="/browse" element={<BrowseView />} />
              <Route path="/game/:id" element={<GameDetailView />} />
              <Route path="/about" element={<AboutView />} />
              <Route path="/help" element={<HelpView />} />
              <Route path="/sources" element={<SourcesView />} />
              <Route path="/donate" element={<DonateView />} />
              <Route path="/login" element={<AuthView />} />
              <Route path="/register" element={<AuthView />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </RoutedBoundary>
          </div>

          {/* Footer */}
          <footer className="relative z-10 border-t border-white/5 bg-[#0a0a0c] py-10 text-xs text-zinc-500">
            <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 sm:px-6 md:flex-row lg:px-8">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-rose-500 to-rose-700 text-xs font-black text-white">
                  Z
                </span>
                <span className="font-display text-sm font-bold tracking-widest text-white">
                  ZAKURO'S<span className="text-rose-400"> ARCHIVE</span>
                </span>
                <span className="hidden font-mono text-[10px] text-zinc-600 sm:inline">
                  — a read-only index of PC game releases
                </span>
              </div>

              <nav className="flex flex-wrap items-center justify-center gap-5 font-mono text-[11px]">
                <Link to="/" className="transition hover:text-rose-400">Home</Link>
                <Link to="/browse" className="transition hover:text-rose-400">Library</Link>
                <Link to="/sources" className="transition hover:text-rose-400">Sources</Link>
                <Link to="/help" className="transition hover:text-rose-400">Help</Link>
                <Link to="/donate" className="transition hover:text-rose-400">Donate</Link>
              </nav>

              <p className="font-mono text-[10px] text-zinc-600">
                © 2026 Zakuro's Archive Indexer, made with{" "}
                <Heart className="inline h-3 w-3 fill-rose-500 text-rose-500" /> for archival preservation.
              </p>
            </div>
          </footer>
        </div>
      </HashRouter>
    </GameProvider>
  );
}