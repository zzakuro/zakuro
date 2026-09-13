import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Search, User, LogOut, Compass, HelpCircle, Home } from "lucide-react";
import { useGame } from "../lib/gameContext";
import { motion, AnimatePresence } from "motion/react";

export const Navbar: React.FC = () => {
  const { user, logoutUser, searchQuery, setSearchQuery } = useGame();
  const location = useLocation();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);

  const navItems = [
    { label: "Home", path: "/", icon: Home },
    { label: "Browse", path: "/browse", icon: Compass },
    { label: "About", path: "/about", icon: HelpCircle },
  ];

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(localSearch);
    navigate(`/browse?q=${encodeURIComponent(localSearch)}`);
  };

  return (
    <header id="nav_header" className="sticky top-0 z-50 w-full border-b border-zinc-900 bg-[#050506]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        
        {/* Zakuro's Archive Brand logo */}
        <Link 
          id="nav_logo" 
          to="/" 
          className="flex items-center gap-2 text-xl font-bold tracking-wider font-display text-white transition hover:opacity-90"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-500/10 text-pink-400 font-black ring-1 ring-pink-500/30">
            Z
          </span>
          <span>ZAKURO'S<span className="text-pink-400"> ARCHIVE</span></span>
        </Link>

        {/* Navigation center links */}
        <nav id="nav_links" className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                id={`nav_link_${item.label.toLowerCase()}`}
                to={item.path}
                className={`relative px-4 py-1.5 text-sm font-medium transition duration-200 hover:text-white rounded-full ${
                  isActive ? "text-pink-400" : "text-zinc-400"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="active-nav-pill"
                    className="absolute inset-0 -z-10 rounded-full bg-pink-950/40 border border-pink-500/20"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Search, Auth, and Discord Buttons */}
        <div id="nav_actions" className="flex items-center gap-4">
          
          {/* Quick Search Input */}
          <form id="nav_search_form" onSubmit={handleSearchSubmit} className="relative hidden sm:block">
            <input
              type="text"
              placeholder="Search repacks..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="w-48 xl:w-64 rounded-full border border-zinc-800 bg-zinc-950 py-1.5 pl-4 pr-10 text-xs font-medium text-white transition placeholder-zinc-500 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500/30"
            />
            <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-pink-400 transition">
              <Search className="h-4 w-4" />
            </button>
          </form>

          {/* User Account State */}
          <div className="relative">
            {user ? (
              <div className="flex items-center gap-2">
                <button
                  id="user_profile_trigger"
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white hover:border-pink-500/40 hover:bg-zinc-900 transition"
                >
                  <User className="h-3.5 w-3.5 text-pink-400" />
                  <span>{user.username}</span>
                </button>

                <AnimatePresence>
                  {showDropdown && (
                    <>
                      {/* Invisible backdrop helper to close */}
                      <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                      <motion.div
                        id="user_dropdown"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute right-0 mt-12 z-20 w-44 rounded-xl border border-zinc-900 bg-[#0a0a0f] p-1.5 shadow-2xl shadow-black"
                      >
                        <div className="px-3 py-2 text-xs border-b border-zinc-900">
                          <p className="text-zinc-500">Account status</p>
                          <p className="font-semibold text-pink-400">{user.role}</p>
                        </div>
                        <button
                          onClick={() => {
                            logoutUser();
                            setShowDropdown(false);
                            navigate("/");
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-400 hover:bg-red-950/20 hover:text-red-400 transition"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          <span>Logout</span>
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <Link
                id="navbar_signin_btn"
                to="/login"
                className="flex items-center gap-1.5 rounded-full border border-dashed border-pink-500/30 bg-pink-950/20 px-4 py-1.5 text-xs font-semibold text-pink-400 hover:bg-pink-950/40 hover:border-pink-500 transition"
              >
                <User className="h-3.5 w-3.5" />
                <span>Sign In</span>
              </Link>
            )}
          </div>

          {/* Discord Styled Button */}
          <a
            id="discord_btn"
            href="https://discord.gg"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-full bg-[#5865F2] hover:bg-[#4752C4] px-4 py-1.5 text-xs font-semibold text-white transition active:scale-95 shadow-md shadow-[#5865F2]/20"
          >
            <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 127.14 96.36">
              <path d="M107.7,8.07A105.15,105.15,0,0,0,77.26,0a77.19,77.19,0,0,0-3.3,6.83A96.67,96.67,0,0,0,53.18,6.83,77.19,77.19,0,0,0,49.88,0,105.15,105.15,0,0,0,19.44,8.07C3.66,31.58-1.9,54.65,1,77.53a105.73,105.73,0,0,0,32,16.29,80.68,80.68,0,0,0,6.83-11.12,68.8,68.8,0,0,1-10.85-5.18c.92-.68,1.81-1.39,2.67-2.14a75.48,75.48,0,0,0,71,0c.87.75,1.76,1.46,2.68,2.14a68.86,68.86,0,0,1-10.85,5.18,80.12,80.12,0,0,0,6.83,11.12,105.54,105.54,0,0,0,32-16.29C129.24,48.24,121.55,25.43,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53S36.18,40.36,42.45,40.36,53.83,46,53.83,53,48.72,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.24,60,73.24,53S78.41,40.36,84.69,40.36,96.07,46,96.07,53,91,65.69,84.69,65.69Z"/>
            </svg>
            <span className="hidden lg:inline">Discord</span>
          </a>

        </div>
      </div>
    </header>
  );
};
