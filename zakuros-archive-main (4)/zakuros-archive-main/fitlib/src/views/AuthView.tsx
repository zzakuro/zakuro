import React, { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { User, Lock, Mail, Gamepad2, ArrowRight } from "lucide-react";
import { useGame } from "../lib/gameContext";
import { motion } from "motion/react";

export const AuthView: React.FC = () => {
  const { user, loginUser, registerUser } = useGame();
  const navigate = useNavigate();
  const location = useLocation();

  // Mode Toggler: true = login, false = signup (driven by the route so
  // /register actually lands on the register form).
  const [isLogin, setIsLogin] = useState(() => !location.pathname.endsWith("/register"));

  // Form Fields
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password.trim()) {
      setError("Please complete all blank fields.");
      return;
    }

    if (username.trim().length < 3) {
      setError("Username must exceed 3 letters.");
      return;
    }

    try {
      if (isLogin) {
        loginUser(username.trim());
      } else {
        registerUser(username.trim());
      }
      navigate("/");
    } catch (e) {
      setError("Failed to create credential context.");
    }
  };

  return (
    <div id="auth_view" className="flex min-h-[75vh] flex-col items-center justify-center px-4 py-12">
      
      {/* Auth Card Box */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="panel w-full max-w-md rounded-2xl p-8 shadow-2xl relative"
      >
        
        {/* Brand visual header decoration */}
        <div className="text-center mb-8">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 font-black ring-1 ring-rose-500/30 mx-auto mb-3">
            Z
          </span>
          <h2 className="font-display font-black text-white text-2xl uppercase tracking-wider">
            {isLogin ? "Sign in to the archive" : "Create archive account"}
          </h2>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            Enable game track wishlisting and voting.
          </p>
        </div>

        {/* Error Callout */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-950/20 border border-red-500/20 p-3 text-xs text-red-400 font-mono">
            ⚠️ {error}
          </div>
        )}

        {/* Auth form input panels */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Username */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5 font-mono">Username</label>
            <div className="relative">
              <input
                type="text"
                required
                placeholder="e.g. repacker99"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#0d0d10] py-2.5 pl-10 pr-3 text-xs text-white transition placeholder-zinc-600 focus:border-rose-500/50 focus:outline-none focus:ring-1 focus:ring-rose-500/30"
              />
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5 font-mono">Password</label>
            <div className="relative">
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#0d0d10] py-2.5 pl-10 pr-3 text-xs text-white transition placeholder-zinc-650 focus:border-rose-500/50 focus:outline-none focus:ring-1 focus:ring-rose-500/30"
              />
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            </div>
          </div>

          {/* Form action submission */}
          <button
            type="submit"
            className="w-full h-11 flex items-center justify-center gap-2 rounded-full bg-rose-400 hover:bg-rose-300 font-display font-bold text-black text-xs uppercase tracking-wider transition active:scale-[0.98] mt-6 cursor-pointer shadow-lg shadow-rose-400/10"
          >
            <span>{isLogin ? "Sign In" : "Register Credentials"}</span>
            <ArrowRight className="h-4 w-4 stroke-[2.5]" />
          </button>

        </form>

        {/* Toggle Mode Link indicator */}
        <div className="mt-6 text-center border-t border-white/5 pt-5 text-xs">
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError("");
            }}
            className="text-zinc-400 hover:text-rose-400 transition"
          >
            {isLogin ? (
              <span>Don't have an account? <strong className="text-rose-400 font-bold underline">Sign up here</strong></span>
            ) : (
              <span>Already registered? <strong className="text-rose-400 font-bold underline">Sign in here</strong></span>
            )}
          </button>
        </div>

      </motion.div>

    </div>
  );
};
