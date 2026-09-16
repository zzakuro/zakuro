import React, { useState } from "react";
import { Palette, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const THEMES: { id: string; name: string; tagline: string; swatch: [string, string]; font?: "serif" }[] = [
  { id: "pomegranate", name: "Pomegranate", tagline: "Editorial rose", swatch: ["#f43f5e", "#e11d48"] },
  { id: "emerald", name: "Emerald", tagline: "Cool arcade", swatch: ["#10b981", "#047857"] },
  { id: "amber", name: "Amber", tagline: "Warm studio", swatch: ["#f59e0b", "#b45309"], font: "serif" },
  { id: "violet", name: "Violet", tagline: "Neon night", swatch: ["#8b5cf6", "#6d28d9"] },
];

type ThemeId = (typeof THEMES)[number]["id"];

const STORAGE_KEY = "zakuro-theme";

function currentTheme(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || document.documentElement.dataset.theme || "pomegranate";
  } catch {
    return "pomegranate";
  }
}

const ThemeSwitcher: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>(currentTheme());

  const select = (id: string) => {
    setActive(id);
    document.documentElement.setAttribute("data-theme", id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Change theme"
        className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs transition ${
          open
            ? "border-rose-500/40 bg-white/[0.05] text-white"
            : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-rose-500/40 hover:text-white"
        }`}
      >
        <Palette className="h-3.5 w-3.5 text-rose-400" />
        <span className="hidden sm:inline">Theme</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute right-0 mt-2 z-20 w-56 rounded-xl border border-white/10 bg-[#101013] p-1.5 shadow-2xl shadow-black"
            >
              <p className="border-b border-white/5 px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                Site theme
              </p>
              <div className="p-1">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => select(t.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                      active === t.id ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <span
                      className="h-6 w-6 shrink-0 rounded-md ring-1 ring-white/20"
                      style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block text-xs font-semibold text-white"
                        style={t.font === "serif" ? { fontFamily: "Fraunces, Georgia, serif" } : undefined}
                      >
                        {t.name}
                      </span>
                      <span className="block text-[10px] text-zinc-500">{t.tagline}</span>
                    </span>
                    {active === t.id && <Check className="h-3.5 w-3.5 shrink-0 text-rose-400" />}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ThemeSwitcher;