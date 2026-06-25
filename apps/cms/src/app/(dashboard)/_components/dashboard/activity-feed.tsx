import React from "react";
import { Film, Monitor, SquareTerminal, UserPlus, type LucideIcon } from "lucide-react";
import { activity, type ActivityItem } from "@/app/(dashboard)/_data/dashboard-demo";

const kindMeta: Record<ActivityItem["kind"], { icon: LucideIcon; className: string }> = {
  screen: { icon: Monitor, className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  experience: { icon: SquareTerminal, className: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  media: { icon: Film, className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  user: { icon: UserPlus, className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
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
              <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-border" />
            )}
            <span
              className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.className}`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="flex-1 text-sm leading-tight">
              <p>
                <span className="font-medium text-foreground">{item.user}</span>{" "}
                <span className="text-muted-foreground">{item.action}</span>{" "}
                <span className="text-foreground">{item.target}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.time}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
