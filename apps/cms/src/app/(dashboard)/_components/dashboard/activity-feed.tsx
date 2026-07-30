import React from "react";
import { Film, Monitor, SquareTerminal, UserPlus, type LucideIcon } from "lucide-react";
import { activity, type ActivityItem } from "@/app/(dashboard)/_data/dashboard-demo";

const kindMeta: Record<ActivityItem["kind"], { icon: LucideIcon; className: string; glow: string }> = {
  screen: { icon: Monitor, className: "bg-blue-500/15 text-blue-300", glow: "shadow-[0_0_16px_-4px_rgba(59,130,246,0.7)]" },
  experience: { icon: SquareTerminal, className: "bg-violet-500/15 text-violet-300", glow: "shadow-[0_0_16px_-4px_rgba(167,139,250,0.7)]" },
  media: { icon: Film, className: "bg-amber-500/15 text-amber-300", glow: "shadow-[0_0_16px_-4px_rgba(245,158,11,0.7)]" },
  user: { icon: UserPlus, className: "bg-emerald-500/15 text-emerald-300", glow: "shadow-[0_0_16px_-4px_rgba(16,185,129,0.7)]" },
};

export function ActivityFeed() {
  return (
    <ul className="flex flex-col">
      {activity.map((item, i) => {
        const meta = kindMeta[item.kind];
        const Icon = meta.icon;
        const last = i === activity.length - 1;
        return (
          <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && (
              <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-white/10" />
            )}
            <span
              className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.className} ${meta.glow}`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="flex-1 text-sm leading-tight">
              <p>
                <span className="font-medium text-white">{item.user}</span>{" "}
                <span className="text-slate-400">{item.action}</span>{" "}
                <span className="text-slate-200">{item.target}</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{item.time}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
