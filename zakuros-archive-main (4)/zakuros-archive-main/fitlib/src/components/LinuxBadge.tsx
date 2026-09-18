import React from "react";
import { MonitorSmartphone } from "lucide-react";
import { LinuxSupportInfo } from "../types";

const TIER_STYLES: Record<string, string> = {
  native: "bg-emerald-500/90 text-emerald-950 ring-emerald-300/40",
  platinum: "bg-violet-500/90 text-white ring-violet-300/40",
  gold: "bg-amber-500/90 text-amber-950 ring-amber-300/40",
  silver: "bg-slate-400/90 text-slate-950 ring-slate-300/40",
  bronze: "bg-orange-700/90 text-orange-50 ring-orange-300/40",
  borked: "bg-red-500/90 text-white ring-red-300/40",
  pending: "bg-zinc-500/80 text-zinc-100 ring-zinc-300/40",
  unknown: "bg-zinc-600/80 text-zinc-200 ring-zinc-300/40",
};

const TIER_LABELS: Record<string, string> = {
  native: "Linux Native",
  platinum: "Proton Platinum",
  gold: "Proton Gold",
  silver: "Proton Silver",
  bronze: "Proton Bronze",
  borked: "Proton Borked",
  pending: "Proton Pending",
  unknown: "Unknown",
};

export const LinuxBadge: React.FC<{ linux: LinuxSupportInfo; className?: string }> = ({
  linux,
  className = "",
}) => {
  const label = linux.native
    ? TIER_LABELS.native
    : TIER_LABELS[linux.tier || "unknown"] || "Linux";
  const key = linux.native ? "native" : linux.tier || "unknown";
  const style = TIER_STYLES[key] || TIER_STYLES.unknown;
  const detail = linux.native
    ? "Runs natively on Linux"
    : linux.tier
      ? `Linux compatibility via Proton — ${linux.tier}${linux.confidence ? ` (${linux.confidence})` : ""}${linux.votes ? ` · ${linux.votes} reports` : ""}`
      : "No Linux report yet";

  return (
    <span
      role="img"
      aria-label={`${label}: ${detail}`}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ring-1 ring-black/20 backdrop-blur-sm ${style} ${className}`}
      title={detail}
    >
      <MonitorSmartphone className="h-2.5 w-2.5" />
      {label}
    </span>
  );
};