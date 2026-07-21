import React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import type { DeltaStat } from "@/app/(dashboard)/_data/dashboard-demo";
import { LIQUID_PANEL, liquidPanelStyle, type LiquidAccent } from "./liquid-glass";
import { LiquidShine } from "./liquid-pill";

const CHIP: Record<LiquidAccent, string> = {
  blue: "bg-blue-500/15 text-blue-300",
  violet: "bg-violet-500/15 text-violet-300",
  amber: "bg-amber-500/15 text-amber-300",
  emerald: "bg-emerald-500/15 text-emerald-300",
  rose: "bg-rose-500/15 text-rose-300",
  slate: "bg-white/10 text-slate-300",
};

interface StatCardProps {
  stat: DeltaStat;
  icon: LucideIcon;
  accent: LiquidAccent;
  href: string;
}

export function StatCard({ stat, icon: Icon, accent, href }: StatCardProps) {
  const positive = stat.delta >= 0;
  const DeltaIcon = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <Link href={href} className={`${LIQUID_PANEL} flex flex-col gap-3 p-4`} style={liquidPanelStyle(accent)}>
      <LiquidShine />
      <div className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-xl ${CHIP[accent]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="relative z-10 space-y-0.5">
        <p className="text-xl font-bold tabular-nums text-white">{stat.value}</p>
        <p className="text-xs text-slate-400">{stat.label}</p>
      </div>
      <span
        className={`relative z-10 inline-flex w-fit items-center gap-0.5 text-[11px] font-medium ${
          positive ? "text-emerald-400" : "text-rose-400"
        }`}
      >
        <DeltaIcon className="h-3 w-3" />
        {Math.abs(stat.delta)}%
      </span>
    </Link>
  );
}
