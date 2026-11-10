"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ScheduleRow } from "@platform/db";
import {
  addDays,
  compareSchedules,
  DEFAULT_SCHEDULE_TIMEZONE,
  formatTimeOfDay,
  localParts,
  weekSegments,
  weekdayOf,
  SCHEDULE_DAY_LABELS,
} from "@platform/types";
import {
  playableItems,
  targetScreenIds,
  toScheduleSpecClient,
  type ScreenOption,
} from "./schedule-shared";

const HOUR_PX = 36;

interface Block {
  schedule: ScheduleRow;
  start: number;
  end: number;
  lane: number;
  lanes: number;
  /** Loses to a higher-priority block it overlaps, on the screens filtered to. */
  shadowed: boolean;
}

/**
 * The coming week as a calendar: one column per day, one block per schedule
 * window, in each schedule's own timezone. Filter to a screen or a group to
 * see exactly what would play there; overlapping windows sit side by side,
 * and the ones that lose on priority are drawn faded.
 */
export function WeekView({
  schedules,
  screens,
  filter,
}: {
  schedules: ScheduleRow[];
  screens: ScreenOption[];
  /** Picked in the bar above the tabs: "all", "group:<id>" or "screen:<id>". */
  filter: string;
}) {
  const [offsetWeeks, setOffsetWeeks] = useState(0);
  const tz = schedules[0]?.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
  const today = localParts(new Date(), tz);
  const firstDate = addDays(today.date, offsetWeeks * 7);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(firstDate, i));

  const filterScreens = useMemo(() => {
    if (filter === "all") return null;
    if (filter.startsWith("group:")) {
      const g = filter.slice(6);
      return new Set(screens.filter((s) => s.groupId === g).map((s) => s.screenId));
    }
    return new Set([filter.slice(7)]);
  }, [filter, screens]);

  const relevant = schedules.filter((s) => {
    if (!s.enabled || playableItems(s).length === 0) return false;
    const targets = targetScreenIds(s, screens);
    if (targets.length === 0) return false;
    return !filterScreens || targets.some((id) => filterScreens.has(id));
  });

  /** A schedule's screens, narrowed to the filter. */
  const targetsIn = (row: ScheduleRow) =>
    targetScreenIds(row, screens).filter((id) => !filterScreens || filterScreens.has(id));

  // Blocks per day, laid out in lanes so overlaps don't hide each other.
  const blocksByDate = useMemo(() => {
    const map = new Map<string, Block[]>();
    for (const row of relevant) {
      for (const seg of weekSegments(toScheduleSpecClient(row), firstDate, 7)) {
        const list = map.get(seg.date) ?? [];
        list.push({ schedule: row, start: seg.startMinute, end: seg.endMinute, lane: 0, lanes: 1, shadowed: false });
        map.set(seg.date, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start - b.start || compareSchedules(toScheduleSpecClient(a.schedule), toScheduleSpecClient(b.schedule)));
      // Greedy lanes within each cluster of overlapping blocks.
      let cluster: Block[] = [];
      let clusterEnd = -1;
      const flush = () => {
        const laneEnds: number[] = [];
        for (const b of cluster) {
          let lane = laneEnds.findIndex((end) => end <= b.start);
          if (lane === -1) lane = laneEnds.length;
          laneEnds[lane] = b.end;
          b.lane = lane;
        }
        for (const b of cluster) b.lanes = laneEnds.length;
        cluster = [];
      };
      for (const b of list) {
        if (b.start >= clusterEnd && cluster.length) flush();
        cluster.push(b);
        clusterEnd = Math.max(clusterEnd, b.end);
      }
      if (cluster.length) flush();
      // Faded when a higher-priority block overlapping it would win on every
      // screen they share (within the filter) — two schedules on different
      // screens don't compete.
      for (const b of list) {
        const mine = targetsIn(b.schedule);
        b.shadowed =
          mine.length > 0 &&
          mine.every((screenId) =>
            list.some(
              (o) =>
                o !== b &&
                o.start < b.end &&
                b.start < o.end &&
                targetsIn(o.schedule).includes(screenId) &&
                compareSchedules(toScheduleSpecClient(o.schedule), toScheduleSpecClient(b.schedule)) < 0
            )
          );
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevant.map((r) => r.id + r.updatedAt).join(), firstDate, filterScreens]);

  const nowMinute = today.minutes;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous week" onClick={() => setOffsetWeeks((w) => w - 1)} className="btn-surface flex h-8 w-8 items-center justify-center rounded-full">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setOffsetWeeks(0)} disabled={offsetWeeks === 0} className="btn-surface rounded-full px-3 py-1.5 text-xs disabled:opacity-50">
            This week
          </button>
          <button type="button" aria-label="Next week" onClick={() => setOffsetWeeks((w) => w + 1)} className="btn-surface flex h-8 w-8 items-center justify-center rounded-full">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {relevant.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing is scheduled {filter === "all" ? "on any screen" : "here"} yet.</p>
      )}

      {/* Scrolls sideways on narrow screens rather than squeezing seven days into them. */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b border-border">
            <div />
            {dates.map((d) => {
              const isToday = d === today.date;
              const [, m, day] = d.split("-");
              return (
                <div key={d} className={`px-2 py-2 text-center text-xs ${isToday ? "text-primary-ink" : "text-muted-foreground"}`}>
                  <span className="font-heading">{SCHEDULE_DAY_LABELS[weekdayOf(d)]}</span> {Number(day)}/{Number(m)}
                </div>
              );
            })}
          </div>
          <div className="relative max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-[3rem_repeat(7,1fr)]" style={{ height: HOUR_PX * 24 }}>
              {/* Hour labels */}
              <div className="relative">
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground" style={{ top: h * HOUR_PX }}>
                    {h === 0 ? "" : formatTimeOfDay(h * 60)}
                  </span>
                ))}
              </div>
              {dates.map((d) => (
                <div key={d} className="relative border-l border-border">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="absolute inset-x-0 border-t border-border/50" style={{ top: h * HOUR_PX }} />
                  ))}
                  {(blocksByDate.get(d) ?? []).map((b, i) => {
                    const top = (b.start / 60) * HOUR_PX;
                    const height = Math.max(14, ((b.end - b.start) / 60) * HOUR_PX);
                    return (
                      <div
                        key={`${b.schedule.id}-${i}`}
                        title={`${b.schedule.name} · ${formatTimeOfDay(b.start)}–${b.end === 1440 ? "24:00" : formatTimeOfDay(b.end)}${b.shadowed ? " · lower priority, won't play where it overlaps" : ""}`}
                        className={`absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-[10px] leading-tight text-[#0e1a07] ${b.shadowed ? "opacity-40" : ""}`}
                        style={{
                          top,
                          height,
                          left: `calc(${(b.lane / b.lanes) * 100}% + 2px)`,
                          width: `calc(${100 / b.lanes}% - 4px)`,
                          background: b.schedule.color,
                          borderColor: "rgb(0 0 0 / 0.15)",
                        }}
                      >
                        <span className="block truncate">{b.schedule.name}</span>
                        {height > 28 && (
                          <span className="block truncate opacity-75">
                            {formatTimeOfDay(b.start)}–{b.end === 1440 ? "24:00" : formatTimeOfDay(b.end)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {d === today.date && (
                    <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-destructive" style={{ top: (nowMinute / 60) * HOUR_PX }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Times are in {tz.replace(/_/g, " ")}. Faded blocks lose to a higher-priority schedule where they overlap.
      </p>
    </div>
  );
}
