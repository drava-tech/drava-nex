import React from "react";
import { uptimeSeries } from "@/app/(dashboard)/_data/dashboard-demo";

export function TodayUptime() {
  const today = uptimeSeries[uptimeSeries.length - 1]!;
  const values = uptimeSeries.map((d) => d.value);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const dayLabel = now.toLocaleDateString("en-US", { weekday: "long" });

  return (
    <div className="flex h-full flex-col justify-between gap-4 p-6">
      <div>
        <p className="text-sm font-medium text-slate-300">{dateLabel}</p>
        <p className="text-xs text-slate-500">{dayLabel}</p>
      </div>
      <div>
        <p className="text-4xl font-bold tabular-nums text-white">{today.value}%</p>
        <p className="text-sm text-slate-400">Screens online today</p>
      </div>
      <p className="text-xs text-slate-500">
        Week high <span className="font-medium text-slate-300">{high}%</span>
        {" · "}
        low <span className="font-medium text-slate-300">{low}%</span>
      </p>
    </div>
  );
}
