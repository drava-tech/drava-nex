import React from "react";
import Link from "next/link";
import { type LucideIcon } from "lucide-react";

export type StatAccent = "blue" | "violet" | "amber" | "emerald" | "rose" | "slate";

// Flat panel shell — clean border + hover lift.
const CARD_SHELL = "relative overflow-hidden rounded-2xl border border-border bg-card transition-all duration-200 hover:-translate-y-0.5";

const CHIP: Record<StatAccent, string> = {
  blue: "bg-blue-500/10 text-blue-500 dark:text-blue-400",
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
}

export function StatCard({ stat, icon: Icon, accent = "slate", href }: StatCardProps) {
  const inner = (
    <>
      <div className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-xl ${CHIP[accent]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="relative z-10 space-y-0.5">
        <p className="text-xl font-bold tabular-nums text-foreground">{stat.value}</p>
        <p className="text-xs text-muted-foreground">{stat.label}</p>
      </div>
      {stat.breakdown && (
        <span className="relative z-10 mt-auto text-[11px] leading-tight text-muted-foreground">
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
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={`${CARD_SHELL} flex flex-col gap-3 p-4`}
    >
      {inner}
    </div>
  );
}
