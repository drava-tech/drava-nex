"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Monitor,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { ScheduleInput, ScheduleRow } from "@platform/db";
import {
  ALL_DAYS,
  compareSchedules,
  DEFAULT_ITEM_SECONDS,
  DEFAULT_SCHEDULE_TIMEZONE,
  describeDays,
  describeWindow,
  formatClock,
  formatDuration,
  isValidTimezone,
  MAX_ITEM_SECONDS,
  MIN_ITEM_SECONDS,
  nextWindowStart,
  playlistSeconds,
  queueTimeline,
  SCHEDULE_DAY_LABELS,
  schedulesOverlap,
  WEEKDAYS,
  WEEKEND,
  localParts,
  type ScheduleSpec,
} from "@platform/types";
import { MediaPicker, type MediaPickerItem } from "@/components/media-picker";
import { MediaThumb } from "@/components/media-thumb";
import { PUSHABLE_MEDIA_TYPES } from "@/lib/media-tiles";
import { createSchedule, updateSchedule } from "@/actions/schedule-actions";
import { Switch } from "./schedules-view";
import {
  formatWhen,
  SCHEDULE_COLORS,
  targetScreenIds,
  toScheduleSpecClient,
  type ExperienceOption,
  type GroupOption,
  type ScreenOption,
} from "./schedule-shared";

export type EditorDraft =
  | { mode: "new" }
  | { mode: "edit"; schedule: ScheduleRow }
  | { mode: "duplicate"; schedule: ScheduleRow };

interface DraftItem {
  key: string;
  kind: "experience" | "media";
  contentId: string;
  title: string;
  mediaType: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number;
  /** The content was deleted since it was queued; it will be dropped on save. */
  missing: boolean;
}

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

let keySeq = 0;
const newKey = () => `item-${++keySeq}`;

function defaultSeconds(mediaType: string | null, kind: "experience" | "media"): number {
  if (kind === "experience") return DEFAULT_ITEM_SECONDS.experience;
  if (mediaType === "image") return DEFAULT_ITEM_SECONDS.image;
  if (mediaType === "video") return DEFAULT_ITEM_SECONDS.video;
  return DEFAULT_ITEM_SECONDS.other;
}

interface ScheduleEditorProps {
  draft: EditorDraft;
  schedules: ScheduleRow[];
  screens: ScreenOption[];
  groups: GroupOption[];
  experiences: ExperienceOption[];
  onClose: () => void;
  onSaved: () => void;
}

export function ScheduleEditor({ draft, schedules, screens, groups, experiences, onClose, onSaved }: ScheduleEditorProps) {
  const base = draft.mode === "new" ? null : draft.schedule;
  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return DEFAULT_SCHEDULE_TIMEZONE;
    }
  }, []);

  const [name, setName] = useState(base ? (draft.mode === "duplicate" ? `${base.name} (copy)` : base.name) : "");
  const [color, setColor] = useState(base?.color ?? SCHEDULE_COLORS[schedules.length % SCHEDULE_COLORS.length]!);
  const [enabled, setEnabled] = useState(base ? (draft.mode === "duplicate" ? false : base.enabled) : true);
  const [priority, setPriority] = useState(base?.priority ?? 0);
  const [allDay, setAllDay] = useState(base ? base.startTime === null : false);
  const [startTime, setStartTime] = useState(base?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(base?.endTime ?? "18:00");
  const [days, setDays] = useState<number[]>(base?.daysOfWeek ?? ALL_DAYS);
  const [startDate, setStartDate] = useState(base?.startDate ?? "");
  const [endDate, setEndDate] = useState(base?.endDate ?? "");
  const [timezone, setTimezone] = useState(base?.timezone ?? DEFAULT_SCHEDULE_TIMEZONE);
  const [loop, setLoop] = useState(base?.loop ?? true);
  /**
   * "clock": each item has a From and a To time, back to back from the first
   * item's From (stored as the slot's start + each item's length, played once).
   * "duration": each item plays for a length, inside the slot set under When.
   */
  const [timing, setTiming] = useState<"clock" | "duration">(() => inferTiming(base));
  const clock = timing === "clock";
  const [screenIds, setScreenIds] = useState<Set<string>>(new Set(base?.screenIds ?? []));
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set(base?.groupIds ?? []));
  const [items, setItems] = useState<DraftItem[]>(
    () =>
      base?.items.map((i) => ({
        key: newKey(),
        kind: i.kind,
        contentId: i.contentId,
        title: i.title ?? "Deleted content",
        mediaType: i.mediaType,
        thumbnailUrl: i.thumbnailUrl,
        durationSeconds: i.durationSeconds,
        missing: i.title === null,
      })) ?? []
  );
  const [pickingMedia, setPickingMedia] = useState(false);
  const [pickingExperience, setPickingExperience] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tzOptions = [...new Set([timezone, browserTz, ...TIMEZONES])].filter(isValidTimezone);

  // ─── Derived: the draft as the scheduler will see it ───
  const queueSeconds = items.filter((i) => !i.missing).reduce((sum, i) => sum + i.durationSeconds, 0);
  const effStartTime = clock ? startTime : allDay ? null : startTime;
  const effEndTime = clock ? addSecondsToClock(startTime, queueSeconds || 3600) : allDay ? null : endTime;
  const effLoop = clock ? false : loop;
  const draftSpec: ScheduleSpec = {
    id: draft.mode === "edit" ? draft.schedule.id : "__draft__",
    name: name || "This schedule",
    enabled: true,
    priority,
    startDate: startDate || null,
    endDate: endDate || null,
    daysOfWeek: days,
    startTime: effStartTime,
    endTime: effEndTime,
    timezone,
    loop: effLoop,
    items: items
      .filter((i) => !i.missing)
      .map((i) => ({ id: i.key, kind: i.kind, contentId: i.contentId, durationSeconds: i.durationSeconds })),
    createdAt: draft.mode === "edit" ? draft.schedule.createdAt : new Date().toISOString(),
  };
  const draftTargets = targetScreenIds({ screenIds: [...screenIds], groupIds: [...groupIds] }, screens);
  const loopSeconds = playlistSeconds(draftSpec.items);
  // Where each item falls on the clock the first time through the queue.
  const windowSpec = { startTime: effStartTime, endTime: effEndTime };
  const timeline = queueTimeline(windowSpec, draftSpec.items);
  const timelineByKey = new Map(draftSpec.items.map((i, n) => [i.id, timeline[n]!]));
  const windowSeconds = windowLengthSeconds(windowSpec);
  const unfitCount = timeline.filter((t) => !t.fits).length;
  const nextStart = days.length ? nextWindowStart(draftSpec, new Date()) : null;

  const conflicts = useMemo(() => {
    const today = localParts(new Date(), timezone).date;
    const mine = new Set(draftTargets);
    return schedules
      .filter((s) => s.enabled && (draft.mode !== "edit" || s.id !== draft.schedule.id))
      .map((s) => {
        const shared = targetScreenIds(s, screens).filter((id) => mine.has(id));
        if (shared.length === 0) return null;
        const other = toScheduleSpecClient(s);
        if (!schedulesOverlap(draftSpec, other, today)) return null;
        const thisWins = compareSchedules(draftSpec, other) < 0;
        return { name: s.name, screens: shared.length, thisWins, samePriority: other.priority === priority };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, screens, draftTargets.join(), days.join(), effStartTime, effEndTime, effLoop, queueSeconds, startDate, endDate, timezone, priority]);

  // ─── Playlist editing ───
  const addMedia = (m: MediaPickerItem) => {
    if (!(PUSHABLE_MEDIA_TYPES as readonly string[]).includes(m.type)) {
      setError(`"${m.name}" is a ${m.type}, which can't be shown on a screen.`);
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        key: newKey(),
        kind: "media",
        contentId: m.id,
        title: m.name,
        mediaType: m.type,
        thumbnailUrl: m.type === "image" ? m.url : null,
        durationSeconds: clock ? 3600 : defaultSeconds(m.type, "media"),
        missing: false,
      },
    ]);
  };
  const addExperience = (e: ExperienceOption) => {
    setItems((prev) => [
      ...prev,
      {
        key: newKey(),
        kind: "experience",
        contentId: e.id,
        title: e.title,
        mediaType: null,
        thumbnailUrl: e.coverImage,
        durationSeconds: clock ? 3600 : defaultSeconds(null, "experience"),
        missing: false,
      },
    ]);
  };
  const move = (index: number, by: -1 | 1) =>
    setItems((prev) => {
      const next = [...prev];
      const to = index + by;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to]!, next[index]!];
      return next;
    });
  const setDuration = (key: string, seconds: number) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, durationSeconds: seconds } : i)));

  const switchTiming = (next: "clock" | "duration") => {
    if (next === timing) return;
    if (next === "clock") {
      // Whole minutes, at least one, so every item has a clock time.
      setItems((prev) => prev.map((i) => ({ ...i, durationSeconds: Math.max(60, Math.round(i.durationSeconds / 60) * 60) })));
      if (allDay) setStartTime("00:00");
    } else {
      // Keep the same slot the clock times covered, played once.
      setAllDay(false);
      setEndTime(effEndTime ?? endTime);
      setLoop(false);
    }
    setTiming(next);
  };

  /** Set item `key`'s To time; its length follows, the items after it move along. */
  const setItemEnd = (key: string, fromSecond: number, to: string) => {
    const toMin = toMinutes(to);
    if (toMin === null) return;
    const fromMin = Math.floor(fromSecond / 60) % 1440;
    let len = toMin - fromMin;
    if (len <= 0) len += 1440;
    setDuration(key, len * 60);
  };

  const toggleIn = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  // ─── Save ───
  const save = async () => {
    setError(null);
    if (!name.trim()) return setError("Give the schedule a name.");
    if (days.length === 0) return setError("Pick at least one day.");
    if (startDate && endDate && endDate < startDate) return setError("The end date is before the start date.");
    const bad = items.find((i) => !i.missing && (i.durationSeconds < MIN_ITEM_SECONDS || i.durationSeconds > MAX_ITEM_SECONDS));
    if (bad) return setError(`"${bad.title}" needs a duration between ${MIN_ITEM_SECONDS} seconds and 24 hours.`);
    if (clock && queueSeconds > 86400) {
      return setError("The items' times add up to more than 24 hours. Shorten some so the queue fits in a day.");
    }
    if (clock && queueSeconds === 0) return setError("Add at least one item, with its From and To times.");

    const input: ScheduleInput = {
      name: name.trim(),
      color,
      enabled,
      priority,
      startDate: startDate || null,
      endDate: endDate || null,
      daysOfWeek: [...days].sort(),
      startTime: effStartTime,
      endTime: effEndTime,
      timezone,
      loop: effLoop,
      screenIds: [...screenIds],
      groupIds: [...groupIds],
      items: items.filter((i) => !i.missing).map((i) => ({ kind: i.kind, contentId: i.contentId, durationSeconds: i.durationSeconds })),
    };
    setSaving(true);
    const res = draft.mode === "edit" ? await updateSchedule(draft.schedule.id, input) : await createSchedule(input);
    setSaving(false);
    if (!res.success) return setError(res.error);
    onSaved();
  };

  const title = draft.mode === "edit" ? "Edit schedule" : draft.mode === "duplicate" ? "Duplicate schedule" : "New schedule";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-editor-title"
        className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden bg-popover text-popover-foreground shadow-xl sm:max-h-[92vh] sm:rounded-3xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary-ink" />
            <h2 id="schedule-editor-title" className="font-heading text-base">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="@container min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
          {/* ─── Basics ─── */}
          <Section title="Name and colour">
            <div className="grid gap-3 @lg:grid-cols-[1fr_auto]">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lobby, weekday mornings"
                maxLength={80}
                autoFocus
                aria-label="Schedule name"
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
              />
              <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Colour">
                {SCHEDULE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={color === c}
                    aria-label={c}
                    onClick={() => setColor(c)}
                    className={`h-7 w-7 rounded-full border-2 transition-transform ${color === c ? "scale-110 border-foreground" : "border-transparent"}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </Section>

          {/* ─── Screens ─── */}
          <Section
            title="Screens"
            hint={`${draftTargets.length} screen${draftTargets.length === 1 ? "" : "s"} · a group's screens are kept up to date as the group changes`}
          >
            <div className="grid gap-4 @lg:grid-cols-2">
              <PickList
                label="Groups"
                empty="No groups yet. Create them on the Screens page."
                options={groups.map((g) => ({
                  id: g.id,
                  label: g.name,
                  sub: `${screens.filter((s) => s.groupId === g.id).length} screens`,
                }))}
                selected={groupIds}
                onToggle={(id) => toggleIn(groupIds, id, setGroupIds)}
              />
              <PickList
                label="Screens"
                empty="No screens yet."
                options={screens.map((s) => ({
                  id: s.screenId,
                  label: s.screenName,
                  sub: s.groupId && groupIds.has(s.groupId) ? "via its group" : undefined,
                }))}
                selected={screenIds}
                onToggle={(id) => toggleIn(screenIds, id, setScreenIds)}
              />
            </div>
          </Section>

          {/* ─── Playlist ─── */}
          <Section
            title="Queue"
            hint={
              draftSpec.items.length
                ? clock
                  ? `${draftSpec.items.length} items · ${effStartTime}–${effEndTime}`
                  : `${draftSpec.items.length} items · ${formatDuration(loopSeconds)} in total${loop ? ", then repeats" : ", played once"}`
                : "Plays top to bottom"
            }
          >
            <div role="radiogroup" aria-label="How each item is timed" className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Each item plays</span>
              {(
                [
                  ["clock", "From – To", "Give each item a start and end time, e.g. 09:00–12:00"],
                  ["duration", "For a set time", "Give each item a length, e.g. 15 seconds, and repeat the queue"],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={timing === value}
                  onClick={() => switchTiming(value)}
                  title={hint}
                  className={`rounded-full px-4 py-1.5 text-sm ${timing === value ? "btn-active" : "btn-surface"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {items.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {clock
                  ? "Add experiences or media, then set when each one starts and ends, e.g. 09:00 to 12:00."
                  : "Add experiences or media. Each one stays on screen for its time, then the next comes up."}
              </p>
            ) : (
              <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
                {items.map((item, index) => (
                  <li key={item.key} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 ${item.missing ? "opacity-50" : ""}`}>
                    <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <div className="h-10 w-14 shrink-0 overflow-hidden rounded-md border border-border">
                      <MediaThumb compact type={item.kind === "experience" ? "experience" : item.mediaType ?? "image"} src={item.thumbnailUrl} name={item.title} />
                    </div>
                    <div className="min-w-[8rem] flex-1">
                      <p className="truncate text-sm">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.missing ? (
                          "Deleted — removed when you save"
                        ) : (
                          <>
                            {item.kind === "experience" ? "Experience" : item.mediaType ?? "Media"}
                            {!clock && <ItemTime slot={timelineByKey.get(item.key)} />}
                          </>
                        )}
                      </p>
                    </div>
                    {!item.missing &&
                      (clock ? (
                        <ClockRange
                          slot={timelineByKey.get(item.key)}
                          isFirst={items.findIndex((i) => !i.missing) === index}
                          onFrom={setStartTime}
                          onTo={(fromSecond, to) => setItemEnd(item.key, fromSecond, to)}
                        />
                      ) : (
                        <DurationInput seconds={item.durationSeconds} onChange={(s) => setDuration(item.key, s)} />
                      ))}
                    <div className="flex shrink-0 items-center">
                      <IconButton label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                      <IconButton label="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                      <IconButton label="Remove" onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setPickingExperience(true)} className="btn-surface flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm">
                <Plus className="h-4 w-4" /> Experience
              </button>
              <button type="button" onClick={() => setPickingMedia(true)} className="btn-surface flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm">
                <Plus className="h-4 w-4" /> Media
              </button>
            </div>
            {clock && draftSpec.items.length > 0 && (
              <p className="mt-4 rounded-2xl border border-border p-3 text-[11px] text-muted-foreground">
                Runs {effStartTime} to {effEndTime}
                {toMinutes(effEndTime ?? "") !== null && (toMinutes(effEndTime ?? "")! <= toMinutes(effStartTime ?? "")! ) ? " (the next day)" : ""}. Each
                item starts when the one before it ends. Afterwards the screens go back to what they showed before,
                until the same time on the next scheduled day.
              </p>
            )}
            {!clock && (
            <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-border p-3">
              <p className="text-[11px] text-muted-foreground">When the queue reaches the end</p>
              <div role="radiogroup" aria-label="When the queue reaches the end" className="flex flex-wrap gap-2">
                {(
                  [
                    [true, "Repeat", "Start again from the top until the time slot ends"],
                    [false, "Play once", "Then the screen goes back to what it showed before"],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={loop === value}
                    onClick={() => setLoop(value)}
                    title={hint}
                    className={`rounded-full px-4 py-1.5 text-sm ${loop === value ? "btn-active" : "btn-surface"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {draftSpec.items.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {fitSummary({ loop, loopSeconds, windowSeconds, unfitCount, lastEnd: timeline.at(-1)?.endSecond ?? 0 })}
                </p>
              )}
            </div>
            )}
          </Section>

          {/* ─── When ─── */}
          <Section title="When" hint={`${describeDays(days)} · ${describeWindow({ startTime: effStartTime, endTime: effEndTime })}`}>
            <div className="space-y-4">
              {clock ? (
                <p className="text-[11px] text-muted-foreground">
                  The times come from the queue above. Pick the days, and dates if it's only for a while.
                </p>
              ) : (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-2.5 text-sm">
                  <Switch checked={allDay} onChange={() => setAllDay((v) => !v)} label="All day" />
                  <span>All day</span>
                </div>
                {!allDay && (
                  <div className="flex items-center gap-2 text-sm">
                    <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label="Start time" className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
                    <span className="text-muted-foreground">to</span>
                    <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="End time" className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
                    {endTime <= startTime && <span className="text-[11px] text-muted-foreground">ends the next day</span>}
                  </div>
                )}
              </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {SCHEDULE_DAY_LABELS.map((label, d) => {
                  const on = days.includes(d);
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDays((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d].sort()))}
                      className={`h-9 w-11 rounded-full text-xs transition-colors ${on ? "btn-active" : "btn-surface"}`}
                    >
                      {label}
                    </button>
                  );
                })}
                <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                {([["Every day", ALL_DAYS], ["Weekdays", WEEKDAYS], ["Weekends", WEEKEND]] as const).map(([label, set]) => (
                  <button key={label} type="button" onClick={() => setDays([...set])} className="rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid gap-3 @lg:grid-cols-3">
                <Field label="From (optional)">
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
                </Field>
                <Field label="Until (optional)">
                  <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
                </Field>
                <Field label="Timezone">
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring">
                    {tzOptions.map((tz) => (
                      <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </Section>

          {/* ─── Priority ─── */}
          <Section title="Priority and status">
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm">Priority</p>
                  <p className="text-[11px] text-muted-foreground">
                    If two schedules cover the same screen at the same time, the higher number plays. Leave at 0 if they don't overlap.
                  </p>
                </div>
                <input
                  type="number"
                  min={-100}
                  max={100}
                  value={priority}
                  aria-label="Priority"
                  onChange={(e) => setPriority(Math.max(-100, Math.min(100, Math.round(Number(e.target.value) || 0))))}
                  className="w-20 shrink-0 rounded-xl border border-input bg-background px-3 py-2 text-center text-sm tabular-nums outline-none focus:border-ring"
                />
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm">{enabled ? "On" : "Off"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {enabled ? "Plays at the times above." : "Saved, but won't play until you turn it on."}
                  </p>
                </div>
                <Switch checked={enabled} onChange={() => setEnabled((v) => !v)} label="Schedule on" />
              </div>
            </div>
          </Section>

          {/* ─── Checks ─── */}
          <div className="space-y-2 rounded-2xl bg-muted/50 px-4 py-3 text-xs">
            <p className="text-muted-foreground">
              {draftSpec.items.length === 0
                ? "Add something to the queue for this schedule to play."
                : draftTargets.length === 0
                  ? "Pick at least one screen or group for this schedule to play."
                  : nextStart
                    ? `Next starts ${formatWhen(nextStart.toISOString())} on ${draftTargets.length} screen${draftTargets.length === 1 ? "" : "s"}.`
                    : "It won't start in the next two weeks with these dates and days."}
            </p>
            {conflicts.map((c) => (
              <p key={c.name} className="flex items-start gap-1.5 text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Overlaps "{c.name}" on {c.screens} screen{c.screens === 1 ? "" : "s"}.{" "}
                  {c.thisWins
                    ? `This one plays there${c.samePriority ? " (same priority, and it's the newer one)" : ""}.`
                    : `"${c.name}" plays there${c.samePriority ? " (same priority, and it's the newer one)" : ""}. Raise this one's priority to win.`}
                </span>
              </p>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-4">
          {error && <p className="mr-auto text-xs text-destructive">{error}</p>}
          <button type="button" onClick={onClose} className="btn-surface rounded-full px-5 py-2 text-sm">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary rounded-full px-5 py-2 text-sm disabled:opacity-50">
            {saving ? "Saving…" : draft.mode === "edit" ? "Save changes" : "Create schedule"}
          </button>
        </div>
      </div>

      <MediaPicker open={pickingMedia} onClose={() => setPickingMedia(false)} onSelectItem={addMedia} accept="all" multi />
      {pickingExperience && (
        <ExperiencePicker experiences={experiences} onPick={addExperience} onClose={() => setPickingExperience(false)} />
      )}
    </div>
  );
}

// ─── Small parts ─────────────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-heading text-sm">{title}</h3>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** "HH:MM" → minutes after midnight, or null. */
function toMinutes(t: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** "HH:MM" plus some seconds, as "HH:MM" (wrapping past midnight). */
function addSecondsToClock(start: string, seconds: number): string {
  const startMin = toMinutes(start) ?? 0;
  const total = (startMin * 60 + seconds) % 86400;
  return formatClock(Math.floor(total / 60) * 60);
}

/**
 * Whether a saved schedule reads best as From–To times: played once, in a slot
 * exactly as long as its queue, every item a whole number of minutes. New
 * schedules start that way too.
 */
function inferTiming(base: ScheduleRow | null): "clock" | "duration" {
  if (!base) return "clock";
  if (base.loop || !base.startTime || !base.endTime) return "duration";
  const playable = base.items.filter((i) => i.title !== null);
  if (playable.length === 0 || !playable.every((i) => i.durationSeconds % 60 === 0)) return "duration";
  const total = playable.reduce((sum, i) => sum + i.durationSeconds, 0);
  return total === windowLengthSeconds(base) ? "clock" : "duration";
}

/** From and To clock times for one item; From is editable on the first item only. */
function ClockRange({
  slot,
  isFirst,
  onFrom,
  onTo,
}: {
  slot?: { startSecond: number; endSecond: number };
  isFirst: boolean;
  onFrom: (t: string) => void;
  onTo: (fromSecond: number, to: string) => void;
}) {
  if (!slot) return null;
  const from = formatClock(Math.floor(slot.startSecond / 60) * 60);
  const to = formatClock(Math.floor(slot.endSecond / 60) * 60);
  const cls = "h-[30px] w-[6.25rem] rounded-lg border border-input bg-background px-2 text-xs tabular-nums outline-none focus:border-ring";
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      {isFirst ? (
        <input type="time" value={from} onChange={(e) => e.target.value && onFrom(e.target.value)} aria-label="From" className={cls} />
      ) : (
        <span
          className="inline-flex h-[30px] w-[6.25rem] items-center rounded-lg border border-dashed border-input px-2 text-xs tabular-nums text-muted-foreground"
          title="Starts when the item before it ends"
        >
          {from}
        </span>
      )}
      <span>to</span>
      <input type="time" value={to} onChange={(e) => e.target.value && onTo(slot.startSecond, e.target.value)} aria-label="To" className={cls} />
      <span className="w-12 text-right tabular-nums text-foreground/80">{formatDuration(slot.endSecond - slot.startSecond)}</span>
    </div>
  );
}

/** Length of the daily time slot, in seconds (all day = 24h). */
function windowLengthSeconds(spec: { startTime: string | null; endTime: string | null }): number {
  if (!spec.startTime || !spec.endTime) return 86400;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const len = toMin(spec.endTime) - toMin(spec.startTime);
  return (len > 0 ? len : len + 1440) * 60;
}

/** One line on how the queue fits the time slot. */
function fitSummary(x: { loop: boolean; loopSeconds: number; windowSeconds: number; unfitCount: number; lastEnd: number }): string {
  const head = `The time slot is ${formatDuration(x.windowSeconds)} and the queue is ${formatDuration(x.loopSeconds)}. `;
  if (x.unfitCount > 0) {
    return head + `${x.unfitCount} item${x.unfitCount === 1 ? "" : "s"} won't get a turn: shorten the ones above or make the slot longer.`;
  }
  if (!x.loop) {
    return x.loopSeconds < x.windowSeconds
      ? head + `It finishes at ${formatClock(x.lastEnd)}; then the screen goes back to what it showed before, until the next slot.`
      : head + "It fills the slot.";
  }
  const times = Math.floor(x.windowSeconds / Math.max(1, x.loopSeconds));
  return x.loopSeconds < x.windowSeconds
    ? head + `It plays through about ${times} time${times === 1 ? "" : "s"}.`
    : head + "It fills the slot once.";
}

/** "· 09:00–12:00", or a warning when the item doesn't fit the slot. */
function ItemTime({ slot }: { slot?: { startSecond: number; endSecond: number; fits: boolean; cutShort: boolean } }) {
  if (!slot) return null;
  if (!slot.fits) return <span className="text-warning"> · won't play: the time slot ends first</span>;
  return (
    <span className={slot.cutShort ? "text-warning" : "text-foreground/80"}>
      {" · "}
      {formatClock(slot.startSecond)}–{formatClock(slot.endSecond)}
      {slot.cutShort && " (cut short when the slot ends)"}
    </span>
  );
}

const DURATION_PRESETS: [string, number][] = [
  ["15s", 15],
  ["30s", 30],
  ["1m", 60],
  ["5m", 300],
  ["15m", 900],
  ["30m", 1800],
  ["1h", 3600],
  ["2h", 7200],
  ["3h", 10800],
];

/** Hours, minutes and seconds, stored as seconds, with quick picks. */
function DurationInput({ seconds, onChange }: { seconds: number; onChange: (s: number) => void }) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const set = (nh: number, nm: number, ns: number) =>
    onChange(Math.min(MAX_ITEM_SECONDS, nh * 3600 + nm * 60 + ns));
  const num = (v: string, max: number) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
  const cls =
    "w-11 rounded-lg border border-input bg-background px-1 py-1 text-center text-xs tabular-nums outline-none focus:border-ring";
  const preset = DURATION_PRESETS.find(([, v]) => v === seconds)?.[1];
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 text-[11px] text-muted-foreground" title="How long it stays on screen">
      <input type="number" min={0} max={24} value={h} aria-label="Hours" onChange={(e) => set(num(e.target.value, 24), m, s)} className={cls} />
      h
      <input type="number" min={0} max={59} value={m} aria-label="Minutes" onChange={(e) => set(h, num(e.target.value, 59), s)} className={cls} />
      m
      <input type="number" min={0} max={59} value={s} aria-label="Seconds" onChange={(e) => set(h, m, num(e.target.value, 59))} className={cls} />
      s
      <select
        value={preset ?? ""}
        onChange={(e) => e.target.value && onChange(Number(e.target.value))}
        aria-label="Quick duration"
        className="ml-1 rounded-lg border border-input bg-background px-1 py-1 text-xs outline-none focus:border-ring"
      >
        <option value="">Quick…</option>
        {DURATION_PRESETS.map(([label, v]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PickList({
  label,
  empty,
  options,
  selected,
  onToggle,
}: {
  label: string;
  empty: string;
  options: { id: string; label: string; sub?: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const visible = query ? options.filter((o) => o.label.toLowerCase().includes(query)) : options;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground">{[...selected].filter((id) => options.some((o) => o.id === id)).length} picked</span>
      </div>
      {options.length > 5 && (
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label.toLowerCase()}`} className="w-full rounded-full border border-input bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:border-ring" />
        </div>
      )}
      <ul className="max-h-48 overflow-y-auto rounded-2xl border border-border">
        {options.length === 0 && <li className="px-4 py-5 text-center text-xs text-muted-foreground">{empty}</li>}
        {visible.map((o) => {
          const on = selected.has(o.id);
          return (
            <li key={o.id} className="border-b border-border last:border-b-0">
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted">
                <input type="checkbox" checked={on} onChange={() => onToggle(o.id)} className="h-4 w-4 accent-[var(--primary)]" />
                <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{o.label}</span>
                {o.sub && <span className="shrink-0 text-[11px] text-muted-foreground">{o.sub}</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ExperiencePicker({
  experiences,
  onPick,
  onClose,
}: {
  experiences: ExperienceOption[];
  onPick: (e: ExperienceOption) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const query = q.trim().toLowerCase();
  const visible = query ? experiences.filter((e) => e.title.toLowerCase().includes(query)) : experiences;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative flex max-h-[80vh] w-full max-w-md flex-col gap-3 rounded-3xl border border-border bg-popover p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm">Add experiences</h3>
          <button type="button" onClick={onClose} aria-label="Done" className="rounded-full px-3 py-1 text-xs btn-primary">Done</button>
        </div>
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
          <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search experiences" aria-label="Search experiences" className="w-full rounded-full border border-input bg-background py-2 pl-8 pr-3 text-sm outline-none focus:border-ring" />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border">
          {visible.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted-foreground">No experiences match.</li>}
          {visible.map((e) => {
            const count = added.filter((id) => id === e.id).length;
            return (
              <li key={e.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    onPick(e);
                    setAdded((prev) => [...prev, e.id]);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted"
                >
                  <div className="h-9 w-12 shrink-0 overflow-hidden rounded-md border border-border">
                    <MediaThumb compact type="experience" src={e.coverImage} name={e.title} />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
                  {count > 0 ? (
                    <span className="shrink-0 text-[11px] text-primary-ink">Added{count > 1 ? ` ×${count}` : ""}</span>
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
