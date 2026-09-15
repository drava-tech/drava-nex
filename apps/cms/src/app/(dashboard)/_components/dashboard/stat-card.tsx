import React from "react";
import Link from "next/link";
import { type LucideIcon } from "lucide-react";
import { panelBorderStyle, textGradientStyle, type LiquidAccent } from "./liquid-glass";

// Flat panel shell — no blur/shine/glow, just the border + hover lift.
const CARD_SHELL = "relative overflow-hidden rounded-2xl border transition-all duration-200 hover:-translate-y-0.5";

const CHIP: Record<LiquidAccent, string> = {
  blue: "bg-blue-500/15 text-blue-300",
  violet: "bg-violet-500/15 text-violet-300",
  amber: "bg-amber-500/15 text-amber-300",
  emerald: "bg-emerald-500/15 text-emerald-300",
  rose: "bg-rose-500/15 text-rose-300",
  slate: "bg-white/10 text-slate-300",
};

/**
 * A headline figure with a one-line breakdown under it.
 *
 * There is deliberately no percentage-change chip any more. Nothing in this
 * platform records a historical count of screens, experiences, users or media,
 * so every "+12.5% vs last week" this card used to show was invented — and the
 * breakdown line, which was real, was never rendered at all. A true subtitle
 * beats a fabricated trend.
 */
export interface DashboardStat {
  label: string;
  value: string;
  /** One line of real detail, e.g. "4 online · 2 offline". */
  breakdown?: string;
}

interface StatCardProps {
  stat: DashboardStat;
  icon: LucideIcon;
  accent?: LiquidAccent;
  href?: string;
}

export function StatCard({ stat, icon: Icon, accent = "slate", href }: StatCardProps) {
  const inner = (
    <>
      <div className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-xl ${CHIP[accent]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="relative z-10 space-y-0.5">
        <p className="text-xl font-bold tabular-nums" style={textGradientStyle}>{stat.value}</p>
        <p className="text-xs" style={textGradientStyle}>{stat.label}</p>
      </div>
      {stat.breakdown && (
        // mt-auto: grid items stretch to the tallest card, so without this a
        // one-line subtitle floats mid-card next to a two-line one. Pinning
        // them to the bottom keeps the four baselines level.
        <span className="relative z-10 mt-auto text-[11px] leading-tight text-slate-400">
          {stat.breakdown}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`${CARD_SHELL} flex flex-col gap-3 p-4`}
        style={panelBorderStyle("solid")}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={`${CARD_SHELL} flex flex-col gap-3 p-4`}
      style={panelBorderStyle("solid")}
    >
      {inner}
    </div>
  );
}
