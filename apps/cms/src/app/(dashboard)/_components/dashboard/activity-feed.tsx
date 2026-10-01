"use client";

import React from "react";
import { Film, Monitor, SquareTerminal, type LucideIcon } from "lucide-react";
import type { DashboardActivityItem } from "@platform/db";
import { sampleActivity } from "./sample-data";
import { SampleBadge } from "./sample-badge";

const kindMeta: Record<DashboardActivityItem["kind"], { icon: LucideIcon; className: string; glow: string }> = {
  screen: { icon: Monitor, className: "bg-primary/15 text-red-300", glow: "shadow-[0_0_16px_-4px_rgba(226,29,62,0.7)]" },
  experience: { icon: SquareTerminal, className: "bg-violet-500/15 text-violet-300", glow: "shadow-[0_0_16px_-4px_rgba(167,139,250,0.7)]" },
  media: { icon: Film, className: "bg-amber-500/15 text-amber-300", glow: "shadow-[0_0_16px_-4px_rgba(245,158,11,0.7)]" },
};

/** "just now" / "12m ago" / "3h ago" / "Yesterday" / "12 Aug". */
function relativeTime(at: Date, now: number): string {
  const diffMs = now - at.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * What has actually happened on the network, newest first.
 *
 * A client component only so the relative times can be computed against the
 * browser's clock without a hydration mismatch — the items themselves are
 * fetched on the server (see getRecentActivity).
 */
export function ActivityFeed({ items }: { items: DashboardActivityItem[] }) {
  // Resolved after mount: rendering "5m ago" on the server bakes the server's
  // clock into the HTML and then disagrees with the client on hydration.
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Placeholders rather than an empty card, so the layout still reads as a
  // dashboard on a fresh install — badged, and at half strength, so it is
  // never mistaken for something that actually happened.
  const isSample = items.length === 0;
  const shown = isSample ? sampleActivity() : items;

  return (
    <>
    {isSample && (
      <div className="mb-3">
        <SampleBadge title="No pushes or uploads recorded yet — these are examples" />
      </div>
    )}
    <ul className={`flex flex-col ${isSample ? "opacity-50" : ""}`}>
      {shown.map((item, i) => {
        const meta = kindMeta[item.kind];
        const Icon = meta.icon;
        const last = i === shown.length - 1;
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
            <div className="min-w-0 flex-1 text-sm leading-tight">
              <p className="truncate">
                <span className="text-slate-400">{item.action}</span>{" "}
                <span className="text-slate-200">{item.target}</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {now === null ? " " : relativeTime(item.at, now)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
    </>
  );
}
