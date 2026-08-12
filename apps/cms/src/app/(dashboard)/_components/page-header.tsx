"use client";

import React from "react";
import { Bell } from "lucide-react";

interface PageHeaderProps {
  title: string;
  /** When set, renders the "Good evening, <name>." line under the title. */
  greetingName?: string;
  /** Buttons placed left of the clock pill (e.g. "+ New Experience"). */
  actions?: React.ReactNode;
}

// Clock/date/greeting are client-only so the server render can't ship a stale time.
export function PageHeader({ title, greetingName, actions }: PageHeaderProps) {
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const hour = now?.getHours() ?? 0;
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[34px] font-semibold leading-tight tracking-tight text-white">
          {title}
        </h1>
        {greetingName && (
          <p className="mt-2 text-[15px] text-[#b3adc4]">
            {now
              ? `${greeting}, ${greetingName}. The Experience Centre is operating at full capacity today.`
              : " "}
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-3">
          {actions}
          <span className="flex h-11 min-w-[104px] items-center justify-center rounded-full border border-[#8c73d8]/70 bg-[linear-gradient(180deg,rgba(61,54,90,.83),rgba(44,38,68,.9))] px-6 text-[18px] tabular-nums text-white shadow-[inset_0_0_18px_rgba(255,255,255,.08)]">
            {now
              ? now.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })
              : "--:--"}
          </span>
          <button
            type="button"
            aria-label="Notifications"
            className="relative flex size-11 items-center justify-center rounded-full border border-[#8c73d8]/70 bg-[linear-gradient(180deg,rgba(61,54,90,.83),rgba(44,38,68,.9))] text-[#c9b8ff] transition hover:brightness-125"
          >
            <Bell className="size-[18px]" strokeWidth={1.6} />
            <span className="absolute right-3 top-3 size-1.5 rounded-full bg-[#4ade80]" />
          </button>
        </div>
        <p className="text-[13px] text-[#8f89a6]">
          {now
            ? now.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })
            : " "}
        </p>
      </div>
    </div>
  );
}

/** Pill button matching the header's clock/bell styling. */
export const HEADER_BUTTON =
  "flex h-11 items-center gap-2 rounded-full border border-[#8c73d8]/70 bg-[linear-gradient(180deg,rgba(61,54,90,.83),rgba(44,38,68,.9))] px-5 text-[14px] text-[#e6e0ff] shadow-[inset_0_0_18px_rgba(255,255,255,.08)] transition hover:brightness-125";
