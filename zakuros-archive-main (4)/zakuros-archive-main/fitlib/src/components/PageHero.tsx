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
    <div className="aurora-blob aurora-blob-soft left-[-22%] top-[-40%] h-[55vh] w-[42vw] bg-rose-500/[0.09]" />
    <div className="aurora-blob aurora-blob-soft right-[-24%] top-[5%] h-[60vh] w-[40vw] bg-violet-500/[0.06]" />
    <div className="aurora-blob aurora-blob-soft bottom-[-45%] left-[28%] h-[55vh] w-[45vw] bg-rose-500/[0.05]" />

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