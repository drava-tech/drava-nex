"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/**
 * A single month grid, click-to-pick a range: first click sets the start
 * (clearing any previous end), second click sets the end (swapped into
 * order if picked before the start) — one calendar, not two separate
 * <input type="date"> fields. Shared by the Media Library page's date
 * filter and the Push page's media date-range filter.
 */
export function DateRangeCalendar({
  from,
  to,
  onChange,
}: {
  /** "YYYY-MM-DD", or "" for an open-ended bound. */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const [viewDate, setViewDate] = useState(() => (from ? parseDateKey(from) : new Date()));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = new Date(year, month, 1).getDay();

  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ date: new Date(year, month, i - startWeekday + 1), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]!.date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false });
  }

  const todayKey = toDateKey(new Date());

  const handlePick = (key: string) => {
    if (!from || (from && to)) {
      onChange(key, "");
    } else if (key < from) {
      onChange(key, from);
    } else {
      onChange(from, key);
    }
  };

  return (
    <div className="w-64">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          aria-label="Previous month"
          className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/10"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
          {viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          aria-label="Next month"
          className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/10"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i} className="py-1 text-[10px] font-bold uppercase text-zinc-400">
            {w}
          </span>
        ))}
        {cells.map(({ date, inMonth }, i) => {
          const key = toDateKey(date);
          const isEndpoint = key === from || key === to;
          const inRange = Boolean(from && to && key > from && key < to);
          const isToday = key === todayKey;
          return (
            <button
              key={i}
              type="button"
              onClick={() => handlePick(key)}
              className={`h-8 w-8 rounded-lg text-xs transition-colors ${
                !inMonth ? "text-zinc-300 dark:text-zinc-700" : "text-zinc-700 dark:text-zinc-200"
              } ${
                isEndpoint
                  ? "bg-blue-600 font-bold text-white"
                  : inRange
                    ? "bg-blue-100 dark:bg-blue-500/20"
                    : "hover:bg-zinc-100 dark:hover:bg-white/10"
              } ${isToday && !isEndpoint ? "ring-1 ring-blue-400" : ""}`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      {(from || to) && (
        <button
          type="button"
          onClick={() => onChange("", "")}
          className="mt-2 text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
        >
          Clear dates
        </button>
      )}
    </div>
  );
}
