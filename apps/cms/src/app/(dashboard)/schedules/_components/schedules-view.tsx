"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CalendarDays,
  Copy,
  Hand,
  ListVideo,
  MoreVertical,
  Pause,
  Pencil,
  Plus,
  Radio,
  Trash2,
} from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@platform/ui";
import type { ScheduleRow } from "@platform/db";
import {
  describeDays,
  describeWindow,
  formatDuration,
  playlistSeconds,
} from "@platform/types";
import {
  deleteSchedule,
  getScheduleStatus,
  setScheduleEnabled,
  type ScreenScheduleStatus,
} from "@/actions/schedule-actions";
import { ScheduleEditor, type EditorDraft } from "./schedule-editor";
import { WeekView } from "./week-view";
import {
  formatWhen,
  playableItems,
  relativeIn,
  targetScreenIds,
  type ExperienceOption,
  type GroupOption,
  type ScreenOption,
} from "./schedule-shared";

type Tab = "now" | "schedules" | "week";

interface SchedulesViewProps {
  schedules: ScheduleRow[];
  screens: ScreenOption[];
  groups: GroupOption[];
  experiences: ExperienceOption[];
  initialStatus: { now: string; screens: ScreenScheduleStatus[] } | null;
  isAdmin: boolean;
}

/** How often "On air" re-asks the API; countdowns tick locally in between. */
const STATUS_POLL_MS = 15_000;

export function SchedulesView({ schedules, screens, groups, experiences, initialStatus, isAdmin }: SchedulesViewProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(schedules.length === 0 ? "schedules" : "now");
  const [status, setStatus] = useState(initialStatus);
  const [editing, setEditing] = useState<EditorDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refreshStatus = useCallback(async () => {
    const next = await getScheduleStatus();
    if (next) setStatus(next);
  }, []);

  // Live clock for the countdowns, and a periodic re-read of what's on air.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => void refreshStatus(), STATUS_POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [refreshStatus]);

  // When an item is due to change, ask again just after, so the card moves on.
  useEffect(() => {
    if (!status) return;
    const due = status.screens
      .map((s) => (s.current ? Date.parse(s.current.changesAt) : Infinity))
      .reduce((a, b) => Math.min(a, b), Infinity);
    if (!Number.isFinite(due)) return;
    const t = setTimeout(() => void refreshStatus(), Math.max(1000, due - Date.now() + 1500));
    return () => clearTimeout(t);
  }, [status, refreshStatus]);

  // Fresh props after a save (revalidatePath) → fresh status too.
  useEffect(() => {
    void refreshStatus();
  }, [schedules, refreshStatus]);

  const byId = useMemo(() => new Map(schedules.map((s) => [s.id, s])), [schedules]);
  const groupNames = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const onAirCount = status?.screens.filter((s) => s.current).length ?? 0;

  const onSaved = () => {
    setEditing(null);
    router.refresh();
  };

  const toggle = async (row: ScheduleRow) => {
    setBusyId(row.id);
    const res = await setScheduleEnabled(row.id, !row.enabled);
    setBusyId(null);
    if (!res.success) alert(res.error);
    router.refresh();
  };

  const remove = async (row: ScheduleRow) => {
    if (!confirm(`Delete "${row.name}"? Screens it is running go back to what they showed before.`)) return;
    setBusyId(row.id);
    const res = await deleteSchedule(row.id);
    setBusyId(null);
    if (!res.success) alert(res.error);
    router.refresh();
  };

  return (
    <div className="@container flex flex-col gap-5 p-4 sm:p-6">
      {editing && (
        <ScheduleEditor
          draft={editing}
          schedules={schedules}
          screens={screens}
          groups={groups}
          experiences={experiences}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl">Schedules</h1>
          <p className="text-sm text-muted-foreground">
            Queue content on screens and groups, by time of day, weekday and date.
          </p>
        </div>
        {isAdmin && (
          <Button variant="pill" size="pill" onClick={() => setEditing({ mode: "new" })}>
            <Plus className="h-4 w-4" />
            New schedule
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Schedule views" className="flex flex-wrap gap-2">
        {(
          [
            { key: "now", label: "On air", icon: Radio, badge: onAirCount || null },
            { key: "schedules", label: "Schedules", icon: ListVideo, badge: schedules.length || null },
            { key: "week", label: "Week", icon: CalendarDays, badge: null },
          ] as const
        ).map(({ key, label, icon: Icon, badge }) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm transition-colors ${
              tab === key ? "btn-active" : "btn-surface"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {badge !== null && (
              <span
                className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                  tab === key ? "bg-black/15" : "bg-muted text-muted-foreground"
                }`}
              >
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "now" && (
        <OnAir status={status} schedules={byId} groupNames={groupNames} experiences={experiences} now={now} />
      )}

      {tab === "schedules" && (
        <ScheduleList
          schedules={schedules}
          screens={screens}
          groupNames={groupNames}
          status={status}
          isAdmin={isAdmin}
          busyId={busyId}
          onNew={() => setEditing({ mode: "new" })}
          onEdit={(row) => setEditing({ mode: "edit", schedule: row })}
          onDuplicate={(row) => setEditing({ mode: "duplicate", schedule: row })}
          onToggle={toggle}
          onDelete={remove}
        />
      )}

      {tab === "week" && <WeekView schedules={schedules} screens={screens} groups={groups} />}
    </div>
  );
}

// ─── On air ──────────────────────────────────────────────────────────────────

function OnAir({
  status,
  schedules,
  groupNames,
  experiences,
  now,
}: {
  status: { now: string; screens: ScreenScheduleStatus[] } | null;
  schedules: Map<string, ScheduleRow>;
  groupNames: Map<string, string>;
  experiences: ExperienceOption[];
  now: number;
}) {
  if (!status) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Couldn't reach the scheduler"
        text="The API didn't answer. What's on air will show here once it does."
      />
    );
  }
  if (status.screens.length === 0) {
    return <EmptyState icon={CalendarClock} title="No screens yet" text="Add a screen first, then schedule content on it." />;
  }
  const experienceTitles = new Map(experiences.map((e) => [e.id, e.title]));
  return (
    <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-3">
      {status.screens.map((s) => {
        const row = s.current ? schedules.get(s.current.scheduleId) : undefined;
        const items = row ? playableItems(row) : [];
        const item = s.current ? items[s.current.itemIndex] : undefined;
        const title =
          item?.title ??
          (s.current?.kind === "experience" ? experienceTitles.get(s.current.contentId) : undefined) ??
          "Content";
        const started = s.current ? Date.parse(s.current.itemStartedAt) : 0;
        const changes = s.current ? Date.parse(s.current.changesAt) : 0;
        const progress = s.current ? Math.min(1, Math.max(0, (now - started) / Math.max(1, changes - started))) : 0;
        return (
          <div key={s.screenId} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${s.online ? "bg-status-online" : "bg-muted-foreground/40"}`}
                />
                <p className="truncate font-heading text-base">{s.screenName}</p>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {s.groupId ? groupNames.get(s.groupId) ?? "" : ""}
                {!s.online && (s.groupId ? " · " : "") + (s.online ? "" : "Offline")}
              </span>
            </div>

            {s.current ? (
              <>
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <span aria-hidden className="h-3 w-1 shrink-0 rounded-full" style={{ background: row?.color ?? "var(--primary)" }} />
                  <span className="truncate text-muted-foreground">{s.current.scheduleName}</span>
                  <span className="shrink-0 text-muted-foreground">
                    · {s.current.itemIndex + 1} of {s.current.itemCount}
                  </span>
                </div>
                <p className="truncate text-sm text-foreground">{title}</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>Next {relativeIn(changes - now)}</span>
                  <span>Ends {formatWhen(s.current.windowEndsAt, new Date(now))}</span>
                </div>
                {(s.paused || s.current.manualOverride || s.current.overriddenNames.length > 0) && (
                  <div className="flex flex-col gap-1 border-t border-border pt-2 text-[11px]">
                    {s.paused && (
                      <span className="flex items-center gap-1.5 text-warning">
                        <Pause className="h-3 w-3" />
                        {s.paused === "stopped" ? "Screen is stopped: the schedule resumes when it's resumed." : "A live whiteboard is up: the schedule waits for it."}
                      </span>
                    )}
                    {s.current.manualOverride && !s.paused && (
                      <span className="flex items-center gap-1.5 text-info">
                        <Hand className="h-3 w-3" />
                        Pushed by hand: the schedule takes over again at the next item.
                      </span>
                    )}
                    {s.current.overriddenNames.length > 0 && (
                      <span className="text-muted-foreground">
                        Also on air, lower priority: {s.current.overriddenNames.join(", ")}
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground">Not scheduled right now</p>
                <p className="text-[11px] text-muted-foreground">
                  {s.next ? `Next: ${s.next.scheduleName}, ${formatWhen(s.next.startsAt, new Date(now))}` : "Nothing coming up in the next two weeks."}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Schedule list ───────────────────────────────────────────────────────────

function ScheduleList({
  schedules,
  screens,
  groupNames,
  status,
  isAdmin,
  busyId,
  onNew,
  onEdit,
  onDuplicate,
  onToggle,
  onDelete,
}: {
  schedules: ScheduleRow[];
  screens: ScreenOption[];
  groupNames: Map<string, string>;
  status: { now: string; screens: ScreenScheduleStatus[] } | null;
  isAdmin: boolean;
  busyId: string | null;
  onNew: () => void;
  onEdit: (row: ScheduleRow) => void;
  onDuplicate: (row: ScheduleRow) => void;
  onToggle: (row: ScheduleRow) => void;
  onDelete: (row: ScheduleRow) => void;
}) {
  if (schedules.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No schedules yet"
        text="A schedule plays a queue of experiences and media on the screens you pick, at the times you set."
        action={isAdmin ? <Button variant="pill" size="pill" onClick={onNew}><Plus className="h-4 w-4" /> New schedule</Button> : undefined}
      />
    );
  }
  const screenNames = new Map(screens.map((s) => [s.screenId, s.screenName]));
  return (
    <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @7xl:grid-cols-3">
      {schedules.map((row) => {
        const live = status?.screens.filter((s) => s.current?.scheduleId === row.id).length ?? 0;
        const targets = targetScreenIds(row, screens);
        const items = playableItems(row);
        const missing = row.items.length - items.length;
        const targetLabel = [
          ...row.groupIds.map((g) => groupNames.get(g)).filter(Boolean),
          ...row.screenIds.map((s) => screenNames.get(s)).filter(Boolean),
        ].join(", ");
        const dates =
          row.startDate || row.endDate
            ? `${row.startDate ? fmtDate(row.startDate) : "Now"} – ${row.endDate ? fmtDate(row.endDate) : "no end"}`
            : null;
        return (
          <div
            key={row.id}
            className={`relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-card p-4 pl-5 ${row.enabled ? "" : "opacity-60"}`}
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: row.color }} />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-heading text-base">{row.name}</p>
                <p className="text-xs text-muted-foreground">
                  {describeDays(row.daysOfWeek)} · {describeWindow(row)}
                  {dates && <> · {dates}</>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {live > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary-ink">
                    <Radio className="h-3 w-3" /> On air · {live}
                  </span>
                )}
                {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Actions for ${row.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem className="cursor-pointer gap-2 py-1" onSelect={() => onEdit(row)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer gap-2 py-1" onSelect={() => onDuplicate(row)}>
                        <Copy className="h-4 w-4" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="cursor-pointer gap-2 py-1 text-destructive focus:text-destructive"
                        onSelect={() => onDelete(row)}
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                {items.length} item{items.length === 1 ? "" : "s"} · {formatDuration(playlistSeconds(items))}
                {row.loop ? ", repeating" : ", played once"}
              </span>
              <span>
                {targets.length} screen{targets.length === 1 ? "" : "s"}
                {targetLabel && <>: {targetLabel}</>}
              </span>
              {row.priority !== 0 && <span>Priority {row.priority}</span>}
            </div>

            {/* Thumbnails of the queue */}
            {items.length > 0 && (
              <div className="flex gap-1.5 overflow-hidden">
                {items.slice(0, 8).map((i) => (
                  <div
                    key={i.id}
                    title={`${i.title} · ${formatDuration(i.durationSeconds)}`}
                    className="flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-[10px] text-muted-foreground"
                  >
                    {i.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="truncate px-1">{i.kind === "experience" ? "Exp." : i.mediaType ?? "Media"}</span>
                    )}
                  </div>
                ))}
                {items.length > 8 && (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] text-muted-foreground">
                    +{items.length - 8}
                  </div>
                )}
              </div>
            )}

            {(missing > 0 || items.length === 0 || targets.length === 0) && (
              <p className="text-[11px] text-warning">
                {items.length === 0
                  ? "Nothing in the queue yet, so it won't play."
                  : targets.length === 0
                    ? "No screens picked, so it won't play anywhere."
                    : `${missing} item${missing === 1 ? " was" : "s were"} deleted and will be skipped.`}
              </p>
            )}

            {isAdmin && (
              <label className="flex cursor-pointer items-center justify-between gap-2 border-t border-border pt-3 text-sm">
                <span className="text-muted-foreground">{row.enabled ? "On" : "Off"}</span>
                <Switch checked={row.enabled} disabled={busyId === row.id} onChange={() => onToggle(row)} label={`Turn ${row.name} ${row.enabled ? "off" : "on"}`} />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

function fmtDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-primary" : "bg-input"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof CalendarClock;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <p className="font-heading text-base">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}
