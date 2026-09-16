import React from "react";
import { motion } from "motion/react";

/**
 * Reveal — fades/slides its children into view the first time they scroll
 * near the viewport. One-place animation for all page sections.
 */
export const Reveal: React.FC<{
  children: React.ReactNode;
  delay?: number;
  className?: string;
}> = ({ children, delay = 0, className }) => (
  <motion.div
    className={className}
    initial={{ opacity: 0, y: 26 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-60px" }}
    transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay }}
  >
    {children}
  </motion.div>
);

/**
 * PageHero — the unified "✦ eyebrow / big title / lead" header used by every
 * secondary page so they all read as part of the same designed system.
 */
export const PageHero: React.FC<{
  eyebrow: string;
  title: React.ReactNode;
  lead: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ eyebrow, title, lead, children, actions }) => (
  <section className="relative mx-auto max-w-3xl overflow-hidden pb-10 pt-16 text-center">
    <div className="aurora-blob left-[-10%] top-[-30%] h-64 w-64 bg-rose-500/15" />
    <div className="aurora-blob right-[-12%] top-[10%] h-72 w-72 bg-rose-500/10" />
    <div className="aurora-blob bottom-[-40%] left-1/3 h-64 w-64 bg-violet-500/10" />

    <Reveal className="relative">
      <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-rose-500/25 bg-rose-500/10 px-3.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-rose-400">
        {eyebrow}
      </span>
      <h1 className="font-display text-4xl font-black uppercase leading-[1.05] tracking-tight text-white sm:text-6xl">
        {title}
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-zinc-400">{lead}</p>
      {children}
      {actions && <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div>}
    </Reveal>
  </section>
);