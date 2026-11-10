"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CalendarDays,
  Copy,
  Hand,
  ListVideo,
  Monitor,
  MoreVertical,
  Pause,
  Pencil,
  Plus,
  Radar,
  Radio,
  Repeat,
  Repeat1,
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
import type { ScheduleRow, ScreenRow } from "@platform/db";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { screensHydrated } from "@/store/screens-slice";
import {
  describeDays,
  describeWindow,
  formatDuration,
  playlistSeconds,
} from "@platform/types";
import {
  deleteSchedule,
  getScheduleStatus,
  type ScreenScheduleStatus,
} from "@/actions/schedule-actions";
import { ScheduleEditor, type EditorDraft } from "./schedule-editor";
import { MediaThumb } from "@/components/media-thumb";
import { FilterPill, SearchPill, matchesSearch } from "@/components/filter-bar";
import { WeekView } from "./week-view";
import { MotionTriggers } from "./motion-triggers";
import type { MotionOverview } from "@/actions/motion-trigger-actions";
import {
  formatWhen,
  playableItems,
  relativeIn,
  targetScreenIds,
  type ExperienceOption,
  type GroupOption,
  type ScreenOption,
} from "./schedule-shared";

type Tab = "now" | "schedules" | "week" | "motion";

interface SchedulesViewProps {
  schedules: ScheduleRow[];
  /** Seeds the shared screen store, which then keeps names and what's showing live. */
  screenRows: ScreenRow[];
  groups: GroupOption[];
  experiences: ExperienceOption[];
  initialStatus: { now: string; screens: ScreenScheduleStatus[] } | null;
  /** Motion triggers (admins only; null = not loaded). */
  motion: MotionOverview | null;
  isAdmin: boolean;
}

/** How often "On air" re-asks the API; countdowns tick locally in between. */
const STATUS_POLL_MS = 15_000;

export function SchedulesView({ schedules, screenRows, groups, experiences, initialStatus, motion, isAdmin }: SchedulesViewProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(screensHydrated(screenRows));
  }, [dispatch, screenRows]);
  const storeRows = useAppSelector((st) => st.screens.rows);
  // Props until the hydrate lands, the store after (same as the Screens page).
  const rows = storeRows.length > 0 ? storeRows : screenRows;
  const screens = useMemo<ScreenOption[]>(
    () => rows.map((s) => ({ screenId: s.screenId, screenName: s.screenName, groupId: s.groupId ?? null })),
    [rows],
  );
  /** What each screen shows now, by name — for screens no schedule is driving. */
  const showing = useMemo(
    () =>
      new Map(
        rows.map((s) => [
          s.screenId,
          s.currentContentKind === "experience" ? s.experienceName : s.currentContentKind === "media" ? s.mediaName : null,
        ]),
      ),
    [rows],
  );
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

  // The bar under the tabs. Search and the screen pick apply on every tab; the
  // other pills belong to the tab that shows them.
  const [query, setQuery] = useState("");
  /** "all", "group:<id>" or "screen:<id>". */
  const [target, setTarget] = useState("all");
  const [triggerFilter, setTriggerFilter] = useState<"all" | keyof typeof TRIGGERS | "idle">("all");
  const [stateFilter, setStateFilter] = useState<"all" | "live" | "attention" | "ended">("all");
  const [modeFilter, setModeFilter] = useState<"all" | "loop" | "once">("all");
  const clearFilters = () => {
    setQuery("");
    setTarget("all");
    setTriggerFilter("all");
    setStateFilter("all");
    setModeFilter("all");
  };

  /** The screens the pick covers; null = all of them. */
  const targetScreens = useMemo(() => {
    if (target === "all") return null;
    if (target.startsWith("group:")) {
      return new Set(screens.filter((s) => s.groupId === target.slice(6)).map((s) => s.screenId));
    }
    return new Set([target.slice(7)]);
  }, [target, screens]);
  const screenNames = useMemo(() => new Map(screens.map((s) => [s.screenId, s.screenName])), [screens]);

  // Schedules by name, by where they play, and by what's in the queue.
  const found = schedules.filter(
    (row) =>
      (!targetScreens || targetScreenIds(row, screens).some((id) => targetScreens.has(id))) &&
      matchesSearch(
        query,
        row.name,
        ...row.groupIds.map((g) => groupNames.get(g)),
        ...row.screenIds.map((s) => screenNames.get(s)),
        ...row.items.map((i) => i.title),
      ),
  );
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, as schedule dates are stored
  const isLive = (row: ScheduleRow) => status?.screens.some((s) => s.current?.scheduleId === row.id) ?? false;
  const needsAttention = (row: ScheduleRow) => {
    const playable = playableItems(row).length;
    return playable === 0 || playable < row.items.length || targetScreenIds(row, screens).length === 0;
  };
  const listed = found.filter(
    (row) =>
      (stateFilter === "all" ||
        (stateFilter === "live" && isLive(row)) ||
        (stateFilter === "attention" && needsAttention(row)) ||
        (stateFilter === "ended" && !!row.endDate && row.endDate < today)) &&
      // All-day schedules always loop.
      (modeFilter === "all" || (row.loop || !row.startTime) === (modeFilter === "loop")),
  );
  const onAirScreens = (status?.screens ?? []).filter(
    (s) =>
      (!targetScreens || targetScreens.has(s.screenId)) &&
      (triggerFilter === "all" || screenTrigger(s, showing) === triggerFilter) &&
      matchesSearch(query, s.screenName, s.groupId ? groupNames.get(s.groupId) : null, s.current?.scheduleName, showing.get(s.screenId)),
  );
  const filtering =
    Boolean(query.trim()) ||
    target !== "all" ||
    (tab === "now" && triggerFilter !== "all") ||
    (tab === "schedules" && (stateFilter !== "all" || modeFilter !== "all"));
  const nothingFound = (
    <EmptyState
      icon={ListVideo}
      title="Nothing matches"
      text="No result for what you searched or picked."
      action={<Button variant="outline" size="sm" onClick={clearFilters}>Clear</Button>}
    />
  );

  const onSaved = () => {
    setEditing(null);
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
            ...(isAdmin ? [{ key: "motion" as const, label: "Motion", icon: Radar, badge: motion?.triggers.length || null }] : []),
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

      {/* The bar — the Motion tab lists its own triggers and has none. */}
      {tab !== "motion" && (
        <div className="flex flex-wrap items-center gap-2">
          <SearchPill value={query} onChange={setQuery} label="Search schedules, screens, content" className="w-64" />
          <FilterPill
            label="Screens"
            value={target}
            onChange={setTarget}
            options={[
              { value: "all", label: "All screens" },
              ...groups.map((g) => ({ value: `group:${g.id}`, label: `Group · ${g.name}` })),
              ...screens.map((s) => ({ value: `screen:${s.screenId}`, label: s.screenName })),
            ]}
          />
          {tab === "now" && (
            <FilterPill
              label="Trigger"
              value={triggerFilter}
              onChange={setTriggerFilter}
              options={[
                { value: "all", label: "Any trigger" },
                { value: "timed", label: "Timed" },
                { value: "motion", label: "Motion" },
                { value: "manual", label: "Manual" },
                { value: "idle", label: "Nothing showing" },
              ]}
            />
          )}
          {tab === "schedules" && (
            <>
              <FilterPill
                label="State"
                value={stateFilter}
                onChange={setStateFilter}
                options={[
                  { value: "all", label: "Any state" },
                  { value: "live", label: "On air now", count: found.filter(isLive).length },
                  { value: "attention", label: "Needs attention", count: found.filter(needsAttention).length },
                  { value: "ended", label: "Ended", count: found.filter((r) => !!r.endDate && r.endDate < today).length },
                ]}
              />
              <FilterPill
                label="Play mode"
                value={modeFilter}
                onChange={setModeFilter}
                options={[
                  { value: "all", label: "Loop or once" },
                  { value: "loop", label: "Loop" },
                  { value: "once", label: "Play once" },
                ]}
              />
            </>
          )}
          {filtering && (
            <>
              {tab !== "week" && (
                <span aria-live="polite" className="px-1 text-xs tabular-nums text-muted-foreground">
                  {tab === "now"
                    ? `${onAirScreens.length} of ${status?.screens.length ?? 0} screens`
                    : `${listed.length} of ${schedules.length} schedules`}
                </span>
              )}
              <button type="button" onClick={clearFilters} className="rounded-full px-2 py-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {tab === "now" &&
        (status && filtering && onAirScreens.length === 0 ? (
          nothingFound
        ) : (
          <OnAir
            status={status && { ...status, screens: filtering ? onAirScreens : status.screens }}
            schedules={byId}
            groupNames={groupNames}
            experiences={experiences}
            showing={showing}
            now={now}
          />
        ))}

      {tab === "schedules" && filtering && listed.length === 0 && nothingFound}
      {tab === "schedules" && !(filtering && listed.length === 0) && (
        <ScheduleList
          schedules={filtering ? listed : schedules}
          screens={screens}
          groupNames={groupNames}
          status={status}
          isAdmin={isAdmin}
          busyId={busyId}
          onNew={() => setEditing({ mode: "new" })}
          onEdit={(row) => setEditing({ mode: "edit", schedule: row })}
          onDuplicate={(row) => setEditing({ mode: "duplicate", schedule: row })}
          onDelete={remove}
        />
      )}

      {tab === "week" && <WeekView schedules={found} screens={screens} filter={target} />}

      {tab === "motion" && isAdmin && <MotionTriggers overview={motion} screens={screens} groups={groups} isAdmin={isAdmin} />}
    </div>
  );
}

// ─── What put it on the screen ───────────────────────────────────────────────

const TRIGGERS = {
  timed: { label: "Timed", icon: CalendarClock, hint: "Plays at the times set in a schedule." },
  motion: { label: "Motion", icon: Radar, hint: "Played because a sensor saw someone." },
  manual: { label: "Manual", icon: Hand, hint: "Someone pushed it to the screen by hand." },
} as const;

function TriggerBadge({ kind }: { kind: keyof typeof TRIGGERS }) {
  const { label, icon: Icon, hint } = TRIGGERS[kind];
  return (
    <span title={hint} className="flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
      <Icon aria-hidden className="h-3 w-3" />
      {label}
    </span>
  );
}

/**
 * What is driving a screen that has something on air. A hand push sits on top
 * of whatever was scheduled, and a motion trigger reaches us shaped like a
 * schedule whose id is "motion:<trigger id>" (see the API's motionResolutionFor).
 */
function triggerOf(current: NonNullable<ScreenScheduleStatus["current"]>): keyof typeof TRIGGERS {
  if (current.manualOverride) return "manual";
  return current.scheduleId.startsWith("motion:") ? "motion" : "timed";
}

/** A screen's trigger for the bar's filter: "idle" when nothing is on it at all. */
function screenTrigger(s: ScreenScheduleStatus, showing: Map<string, string | null>): keyof typeof TRIGGERS | "idle" {
  if (s.current) return triggerOf(s.current);
  return showing.get(s.screenId) ? "manual" : "idle";
}

// ─── On air ──────────────────────────────────────────────────────────────────

function OnAir({
  status,
  schedules,
  groupNames,
  experiences,
  showing,
  now,
}: {
  status: { now: string; screens: ScreenScheduleStatus[] } | null;
  schedules: Map<string, ScheduleRow>;
  groupNames: Map<string, string>;
  experiences: ExperienceOption[];
  /** What each screen shows now, by name (null = nothing assigned). */
  showing: Map<string, string | null>;
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
                  <span className="ml-auto">
                    <TriggerBadge kind={triggerOf(s.current)} />
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
                        Also scheduled here now (the newer schedule plays): {s.current.overriddenNames.join(", ")}
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-1">
                {showing.get(s.screenId) ? (
                  // No schedule is driving it, so whatever is on was put there by hand.
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-foreground">{showing.get(s.screenId)}</p>
                    <TriggerBadge kind="manual" />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing showing, not scheduled</p>
                )}
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
        const targetNames = [
          ...row.groupIds.map((g) => groupNames.get(g)),
          ...row.screenIds.map((s) => screenNames.get(s)),
        ].filter((n): n is string => Boolean(n));
        const dates =
          row.startDate || row.endDate
            ? `${row.startDate ? fmtDate(row.startDate) : "Now"} – ${row.endDate ? fmtDate(row.endDate) : "no end"}`
            : null;
        return (
          <div
            key={row.id}
            className={`relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-card p-4 pl-5 transition-opacity ${busyId === row.id ? "opacity-50" : ""}`}
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: row.color }} />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-heading text-base">{row.name}</p>
                {/* What starts it, then where it plays — the groups and screens picked, by name. */}
                <div className="my-1.5 flex flex-wrap gap-1">
                  <TriggerBadge kind="timed" />
                  {targetNames.slice(0, 4).map((name, i) => (
                    <span
                      // A group and a screen can share a name.
                      key={`${i}-${name}`}
                      className="flex min-w-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground"
                    >
                      <Monitor className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{name}</span>
                    </span>
                  ))}
                  {targetNames.length > 4 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      +{targetNames.length - 4}
                    </span>
                  )}
                </div>
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
              <span className="flex min-w-0 items-center gap-1.5">
                {/* The music-player pair: repeat = loops, repeat-1 = plays once. All-day always loops. */}
                {row.loop || !row.startTime ? (
                  <Repeat role="img" aria-label="Loops" className="h-3.5 w-3.5 shrink-0 text-foreground" />
                ) : (
                  <Repeat1 role="img" aria-label="Plays once" className="h-3.5 w-3.5 shrink-0 text-foreground" />
                )}
                <span className="min-w-0">
                  {items.length} item{items.length === 1 ? "" : "s"} · {formatDuration(playlistSeconds(items))} queue
                  {row.loop || !row.startTime ? "" : `, plays once, then ${row.afterMedia ? row.afterMedia.name : "idle"}`}
                </span>
              </span>
              {/* Only when a group is picked: the chips up top name the group, not how many screens are in it. */}
              {row.groupIds.length > 0 && (
                <span>
                  {targets.length} screen{targets.length === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {/* Thumbnails of the queue */}
            {items.length > 0 && (
              <div className="flex gap-1.5 overflow-hidden">
                {items.slice(0, 8).map((i) => (
                  <div key={i.id} className="h-9 w-14 shrink-0 overflow-hidden rounded-md border border-border">
                    <MediaThumb
                      compact
                      type={i.kind === "experience" ? "experience" : i.mediaType ?? "image"}
                      src={i.thumbnailUrl}
                      videoSrc={i.mediaType === "video" ? i.mediaUrl : null}
                      name={`${i.title} · ${formatDuration(i.durationSeconds)}`}
                    />
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
      className={`relative inline-block h-6 w-11 shrink-0 rounded-full p-0 transition-colors disabled:opacity-50 ${checked ? "bg-primary" : "bg-input"}`}
    >
      <span
        className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`}
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
