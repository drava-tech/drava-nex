"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import type { ScheduleRow } from "@platform/db";
import { getSchedules, getScheduleStatus, type ScreenScheduleStatus } from "@/actions/schedule-actions";
import { formatWhen, targetScreenIds } from "@/app/(dashboard)/schedules/_components/schedule-shared";

/** How often what's on air is re-read (the scheduler moves on by itself). */
const STATUS_POLL_MS = 30_000;

/** One schedule a piece of content is in, and how. */
export interface ContentSchedule {
  id: string;
  name: string;
  enabled: boolean;
  /** "queue": an item of its playlist; "after": shown once a play-once queue ends. */
  role: "queue" | "after";
}

export interface ScheduleInfo {
  rows: ScheduleRow[];
  /** Per screen, what's on air from a schedule and what's next (null until read, or if the API is down). */
  status: ScreenScheduleStatus[] | null;
  /** content id (media or experience) → the schedules it's in. */
  byContent: Map<string, ContentSchedule[]>;
  refresh: () => void;
}

/**
 * The schedules and what they have on air, for pages that show content and
 * screens (Our Story, Media). Read-only: the Schedules page is where they're
 * made and changed.
 */
export function useScheduleInfo(refreshKey?: unknown): ScheduleInfo {
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [status, setStatus] = useState<ScreenScheduleStatus[] | null>(null);

  const readStatus = useCallback(() => {
    getScheduleStatus()
      .then((s) => setStatus(s?.screens ?? null))
      .catch(() => setStatus(null));
  }, []);
  const refresh = useCallback(() => {
    getSchedules().then(setRows).catch(() => setRows([]));
    readStatus();
  }, [readStatus]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(readStatus, STATUS_POLL_MS);
    return () => window.clearInterval(t);
  }, [refresh, readStatus]);
  // Something changed on a screen (a publish, a schedule moving on): re-read soon after.
  useEffect(() => {
    if (refreshKey === undefined) return;
    const t = window.setTimeout(readStatus, 1_500);
    return () => window.clearTimeout(t);
  }, [refreshKey, readStatus]);

  const byContent = useMemo(() => {
    const map = new Map<string, ContentSchedule[]>();
    const add = (id: string, s: ContentSchedule) => {
      const list = map.get(id) ?? [];
      if (!list.some((x) => x.id === s.id)) list.push(s);
      map.set(id, list);
    };
    for (const r of rows) {
      for (const i of r.items) if (i.contentId && i.title !== null) add(i.contentId, { id: r.id, name: r.name, enabled: r.enabled, role: "queue" });
      if (r.afterMedia) add(r.afterMedia.id, { id: r.id, name: r.name, enabled: r.enabled, role: "after" });
    }
    return map;
  }, [rows]);

  return { rows, status, byContent, refresh };
}

const time = (iso: string) => formatWhen(iso).replace(/^Today /, "");

/**
 * A line under the screen picker: what this screen's schedule has on air, what
 * comes next, and how many schedules run here — with a way to the Schedules page.
 */
export function ScreenScheduleStrip({
  info,
  screen,
  screens,
}: {
  info: ScheduleInfo;
  screen: { screenId: string } | null;
  /** All screens with their groups, to tell which schedules reach this one. */
  screens: { screenId: string; screenName: string; groupId: string | null }[];
}) {
  if (!screen) return null;
  const s = info.status?.find((x) => x.screenId === screen.screenId) ?? null;
  const here = info.rows.filter((r) => r.enabled && targetScreenIds(r, screens).includes(screen.screenId));

  let main: React.ReactNode;
  if (s?.paused === "stopped") main = <span>Schedules paused: the screen was stopped</span>;
  else if (s?.paused === "whiteboard") main = <span>Schedules paused while a whiteboard is live</span>;
  else if (s?.current) {
    const c = s.current;
    main = (
      <span className="min-w-0 truncate">
        <span className="font-semibold text-foreground">{c.scheduleName}</span>
        {c.manualOverride ? " · interrupted by a manual push" : ` · item ${c.itemIndex + 1} of ${c.itemCount}`}
        {` · next item ${time(c.changesAt)} · ends ${time(c.windowEndsAt)}`}
      </span>
    );
  } else if (here.length === 0) main = <span>No schedule on this screen</span>;
  else main = <span>Nothing scheduled on air now</span>;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card/60 px-4 py-2 text-xs text-muted-foreground">
      <CalendarClock className={`h-4 w-4 shrink-0 ${s?.current ? "text-primary-ink" : ""}`} />
      {s?.current && !s.paused && (
        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
          On schedule
        </span>
      )}
      {main}
      {s?.next && (
        <span className="min-w-0 truncate">
          · Next: <span className="text-foreground">{s.next.scheduleName}</span> {formatWhen(s.next.startsAt)}
        </span>
      )}
      <Link href="/schedules" className="ml-auto shrink-0 text-primary-ink underline-offset-4 hover:underline">
        {here.length === 0 ? "Add a schedule" : `${here.length} schedule${here.length === 1 ? "" : "s"} here`}
      </Link>
    </div>
  );
}

/** What a "Scheduled" tag says on hover. */
export function scheduledTitle(list: ContentSchedule[]): string {
  return (
    "In schedules: " +
    list.map((s) => `${s.name}${s.role === "after" ? " (shown afterwards)" : ""}${s.enabled ? "" : " (off)"}`).join(", ")
  );
}

/** A small tag on content that's in a schedule; names them on hover. */
export function ScheduledChip({ list, className = "" }: { list: ContentSchedule[] | undefined; className?: string }) {
  if (!list?.length) return null;
  const on = list.some((s) => s.enabled);
  return (
    <span
      title={scheduledTitle(list)}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
        on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
      } ${className}`}
    >
      <CalendarClock className="h-2.5 w-2.5" />
      {list.length === 1 ? "Scheduled" : `In ${list.length} schedules`}
    </span>
  );
}
