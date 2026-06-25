import React from "react";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import type { DeltaStat } from "@/app/(dashboard)/_data/dashboard-demo";

interface StatCardProps {
  stat: DeltaStat;
  icon: LucideIcon;
}

export function StatCard({ stat, icon: Icon }: StatCardProps) {
  const positive = stat.delta >= 0;
  const DeltaIcon = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/5 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${
              positive
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
            }`}
          >
            <DeltaIcon className="h-3 w-3" />
            {Math.abs(stat.delta)}%
          </span>
        </div>
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{stat.label}</p>
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {stat.value}
          </p>
          <p className="text-xs text-muted-foreground">{stat.breakdown}</p>
        </div>
      </CardContent>
    </Card>
  );
}
