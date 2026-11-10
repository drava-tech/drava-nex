import React from "react";
import Link from "next/link";
import { type LucideIcon } from "lucide-react";

export type StatAccent = "blue" | "violet" | "amber" | "emerald" | "rose" | "slate";

// Flat panel shell — clean border + hover lift.
const CARD_SHELL = "relative overflow-hidden rounded-2xl border border-border/30 bg-card shadow-[var(--card-shadow)] transition-all duration-200 hover:-translate-y-0.5";

const CHIP: Record<StatAccent, string> = {
  blue: "bg-primary/15 text-primary-ink",
  violet: "bg-violet-500/10 text-violet-500 dark:text-violet-400",
  amber: "bg-amber-500/10 text-amber-500 dark:text-amber-400",
  emerald: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400",
  rose: "bg-rose-500/10 text-rose-500 dark:text-rose-400",
  slate: "bg-muted text-muted-foreground",
};

/**
 * A headline figure with a one-line breakdown under it.
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
  accent?: StatAccent;
  href?: string;
  /** Use the sidebar's selected-item gradient + shadow. */
  highlight?: boolean;
}

const HIGHLIGHT_SHELL =
  "relative overflow-hidden rounded-2xl border border-[var(--sidebar-active-border)] text-[var(--sidebar-active-fg)] transition-all duration-200 hover:-translate-y-0.5 [background-image:var(--sidebar-active-gradient)] [background-repeat:no-repeat] [background-size:100%_100%] [box-shadow:var(--sidebar-active-shadow)]";

// "blue" is the lime chip (the name predates the palette), the dashboard's icon colour.
export function StatCard({ stat, icon: Icon, accent = "blue", href, highlight = false }: StatCardProps) {
  const shell = highlight ? HIGHLIGHT_SHELL : CARD_SHELL;
  const inner = (
    <>
      <div className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-xl ${highlight ? "bg-primary/15 text-primary-ink" : CHIP[accent]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="relative z-10 space-y-0.5">
        <p className={`text-xl font-bold tabular-nums ${"text-foreground"}`}>{stat.value}</p>
        <p className={`text-xs ${"text-muted-foreground"}`}>{stat.label}</p>
      </div>
      {stat.breakdown && (
        <span className={`relative z-10 mt-auto text-[11px] leading-tight ${"text-muted-foreground"}`}>
          {stat.breakdown}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label={`${stat.label}: ${stat.value}. Open`}
        className={`${shell} group flex flex-col gap-3 p-4 hover:border-primary/40`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={`${shell} flex flex-col gap-3 p-4`}
    >
      {inner}
    </div>
  );
}
