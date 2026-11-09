"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarClock, Loader2, Monitor, Plus, Search, Trash2, X } from "lucide-react";
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
  localParts,
  MAX_ITEM_SECONDS,
  MIN_ITEM_SECONDS,
  nextWindowStart,
  playlistSeconds,
  queueTimeline,
  SCHEDULE_DAY_LABELS,
  schedulesOverlap,
  WEEKDAYS,
  WEEKEND,
  type ScheduleSpec,
} from "@platform/types";
import { MediaPicker, type MediaPickerItem } from "@/components/media-picker";
import { MediaThumb } from "@/components/media-thumb";
import { createSchedule, updateSchedule } from "@/actions/schedule-actions";
import { Switch } from "./schedules-view";
import {
  formatWhen,
  SCHEDULE_COLORS,
  targetScreenIds,
  toScheduleSpecClient,
  type GroupOption,
  type ScreenOption,
} from "./schedule-shared";

export type EditorDraft =
  | { mode: "new" }
  | { mode: "edit"; schedule: ScheduleRow }
  | { mode: "duplicate"; schedule: ScheduleRow };

/**
 * One entry of the queue. A queue holds images and videos only: a video plays
 * for its own length (read from the file), an image for the time set here.
 */
interface DraftItem {
  key: string;
  contentId: string;
  title: string;
  type: "image" | "video";
  url: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number;
  /**
   * Videos only — "reading": finding the length; "known": read from the file;
   * "unknown": not readable from here, so the server reads it on save.
   */
  length: "reading" | "known" | "unknown" | null;
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

/** A video's length as the server reads it from the file (see GET /api/media/:id/length). */
async function serverVideoLength(mediaId: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/media/${encodeURIComponent(mediaId)}/length`);
    if (!res.ok) return null;
    const data = (await res.json()) as { seconds?: number | null };
    return typeof data.seconds === "number" && data.seconds > 0 ? data.seconds : null;
  } catch {
    return null;
  }
}

/**
 * A video's length in whole seconds, plus one so its last frame is seen
 * before the next item (the screen takes a moment to start it), as the
 * browser reads it. null when the file can't be loaded from here.
 */
function readVideoLength(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const done = (value: number | null) => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 10_000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) && video.duration > 0 ? Math.ceil(video.duration) + 1 : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

interface ScheduleEditorProps {
  draft: EditorDraft;
  schedules: ScheduleRow[];
  screens: ScreenOption[];
  groups: GroupOption[];
  onClose: () => void;
  onSaved: () => void;
}

export function ScheduleEditor({ draft, schedules, screens, groups, onClose, onSaved }: ScheduleEditorProps) {
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
  const [allDay, setAllDay] = useState(base ? base.startTime === null : false);
  const [startTime, setStartTime] = useState(base?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(base?.endTime ?? "18:00");
  const [days, setDays] = useState<number[]>(base?.daysOfWeek ?? ALL_DAYS);
  const [startDate, setStartDate] = useState(base?.startDate ?? "");
  const [endDate, setEndDate] = useState(base?.endDate ?? "");
  const [timezone, setTimezone] = useState(base?.timezone ?? DEFAULT_SCHEDULE_TIMEZONE);
  const [loop, setLoop] = useState(base?.loop ?? true);
  /** Play once: what the screens show after the queue; null = their idle screen. */
  const [afterMedia, setAfterMedia] = useState<{ id: string; name: string; type: string; url: string; thumbnailUrl: string | null } | null>(
    base?.afterMedia ?? null
  );
  const [pickingAfter, setPickingAfter] = useState(false);
  const [screenIds, setScreenIds] = useState<Set<string>>(new Set(base?.screenIds ?? []));
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set(base?.groupIds ?? []));
  // Only images and videos still in the library; anything else an older
  // schedule held (an experience, deleted media) is dropped, and said so.
  const [items, setItems] = useState<DraftItem[]>(
    () =>
      base?.items
        .filter((i) => i.kind === "media" && i.title !== null && (i.mediaType === "image" || i.mediaType === "video"))
        .map((i) => ({
          key: newKey(),
          contentId: i.contentId,
          title: i.title ?? "",
          type: i.mediaType as "image" | "video",
          url: i.mediaUrl,
          thumbnailUrl: i.thumbnailUrl,
          durationSeconds: i.durationSeconds,
          length: i.mediaType === "video" ? ("reading" as const) : null,
        })) ?? []
  );
  const droppedCount = base ? base.items.length - items.length : 0;
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Find a video's length: the server reads the file; failing that, the browser. */
  const measure = (key: string, mediaId: string, url: string | null) => {
    const find = async () => (await serverVideoLength(mediaId)) ?? (url ? await readVideoLength(url) : null);
    void find().then((seconds) =>
      setItems((prev) =>
        prev.map((i) =>
          i.key === key
            ? seconds
              ? { ...i, durationSeconds: Math.min(MAX_ITEM_SECONDS, seconds), length: "known" }
              : { ...i, durationSeconds: 0, length: "unknown" }
            : i
        )
      )
    );
  };
  useEffect(() => {
    for (const i of items) if (i.length === "reading") measure(i.key, i.contentId, i.url);
    // Once, for the videos the schedule opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tzOptions = [...new Set([timezone, browserTz, ...TIMEZONES])].filter(isValidTimezone);

  // ─── The draft as the scheduler will see it ───
  const windowSpec = { startTime: allDay ? null : startTime, endTime: allDay ? null : endTime };
  // Loop: repeat until the slot ends. Unticked: play once, then idle. All day
  // always loops — "once" from midnight would leave the screens idle all day.
  const repeats = allDay || loop;
  const draftSpec: ScheduleSpec = {
    id: draft.mode === "edit" ? draft.schedule.id : "__draft__",
    name: name || "This schedule",
    enabled: true,
    priority: 0,
    startDate: startDate || null,
    endDate: endDate || null,
    daysOfWeek: days,
    ...windowSpec,
    timezone,
    loop: repeats,
    afterMediaId: repeats ? null : afterMedia?.id ?? null,
    items: items.map((i) => ({ id: i.key, kind: "media" as const, contentId: i.contentId, durationSeconds: i.durationSeconds })),
    createdAt: draft.mode === "edit" ? draft.schedule.createdAt : new Date().toISOString(),
  };
  const draftTargets = targetScreenIds({ screenIds: [...screenIds], groupIds: [...groupIds] }, screens);
  const queueSeconds = playlistSeconds(draftSpec.items);
  const windowSeconds = windowLengthSeconds(windowSpec);
  const timeline = queueTimeline(windowSpec, draftSpec.items);
  const unfit = timeline.filter((t) => !t.fits).length;
  const videos = items.filter((i) => i.type === "video").length;
  const images = items.length - videos;
  const stillReading = items.some((i) => i.length === "reading");
  const nextStart = days.length ? nextWindowStart(draftSpec, new Date()) : null;

  // Other schedules that would be on the same screens at the same time. With
  // no priorities, the newer schedule plays.
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
        return { name: s.name, screens: shared.length, thisWins: compareSchedules(draftSpec, other) < 0 };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, screens, draftTargets.join(), days.join(), startTime, endTime, allDay, startDate, endDate, timezone, repeats, queueSeconds]);

  // ─── Queue editing ───
  const addMedia = (m: MediaPickerItem) => {
    if (m.type !== "image" && m.type !== "video") {
      setError(`"${m.name}" isn't an image or a video. A queue holds only those.`);
      return;
    }
    const key = newKey();
    setItems((prev) => [
      ...prev,
      {
        key,
        contentId: m.id,
        title: m.name,
        type: m.type as "image" | "video",
        url: m.url,
        thumbnailUrl: m.type === "image" ? m.url : null,
        durationSeconds: m.type === "image" ? DEFAULT_ITEM_SECONDS.image : DEFAULT_ITEM_SECONDS.video,
        length: m.type === "video" ? "reading" : null,
      },
    ]);
    if (m.type === "video") measure(key, m.id, m.url);
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
    if (items.length === 0) return setError("Add at least one image or video to the queue.");
    if (stillReading) return setError("Still reading the videos' lengths — one moment.");
    if (days.length === 0) return setError("Pick at least one day.");
    if (startDate && endDate && endDate < startDate) return setError("The end date is before the start date.");
    // Only images have a time to check; a video's length comes from its file.
    const bad = items.find(
      (i) => i.type === "image" && (i.durationSeconds < MIN_ITEM_SECONDS || i.durationSeconds > MAX_ITEM_SECONDS)
    );
    if (bad) return setError(`"${bad.title}" needs a time between ${MIN_ITEM_SECONDS} seconds and 24 hours.`);

    const input: ScheduleInput = {
      name: name.trim(),
      color,
      // No on/off or priority any more: a schedule plays while it exists, and
      // where two overlap the newer one plays.
      enabled: true,
      priority: 0,
      startDate: startDate || null,
      endDate: endDate || null,
      daysOfWeek: [...days].sort(),
      startTime: windowSpec.startTime,
      endTime: windowSpec.endTime,
      timezone,
      loop: repeats,
      afterMediaId: repeats ? null : afterMedia?.id ?? null,
      screenIds: [...screenIds],
      groupIds: [...groupIds],
      items: items.map((i) => ({ kind: "media" as const, contentId: i.contentId, durationSeconds: i.durationSeconds })),
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
          {/* ─── Name ─── */}
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
                options={groups.map((g) => ({ id: g.id, label: g.name, sub: `${screens.filter((s) => s.groupId === g.id).length} screens` }))}
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

          {/* ─── Queue ─── */}
          <Section title="Queue" hint="Images and videos, top to bottom">
            {items.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                Add images and videos. A video plays for its own length; you choose how long each image stays up.
              </p>
            ) : (
              <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
                {items.map((item, index) => (
                  <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                    <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <div className="h-10 w-14 shrink-0 overflow-hidden rounded-md border border-border">
                      <MediaThumb compact type={item.type} src={item.thumbnailUrl} name={item.title} />
                    </div>
                    <div className="min-w-[8rem] flex-1">
                      <p className="truncate text-sm">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground">{item.type === "video" ? "Video" : "Image"}</p>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      {item.type === "image" ? (
                        <DurationInput seconds={item.durationSeconds} onChange={(s) => setDuration(item.key, s)} />
                      ) : item.length === "reading" ? (
                        <span className="flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Reading length…
                        </span>
                      ) : item.length === "known" ? (
                        <span
                          className="rounded-lg border border-dashed border-input px-2.5 py-1 text-xs tabular-nums text-foreground/80"
                          title="Plays for the video's full length"
                        >
                          {formatDuration(item.durationSeconds)} · full video
                        </span>
                      ) : (
                        <span
                          className="rounded-lg border border-dashed border-input px-2.5 py-1 text-xs text-muted-foreground"
                          title="This computer can't open the file; the server reads its length when you save"
                        >
                          Full video · length read on save
                        </span>
                      )}
                      <IconButton label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                      <IconButton label="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                      <IconButton label="Remove" onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {droppedCount > 0 && (
              <p className="mt-2 text-[11px] text-warning">
                {droppedCount} item{droppedCount === 1 ? " was" : "s were"} removed: {droppedCount === 1 ? "it isn't" : "they aren't"} an image or video in the library any more.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => setPicking(true)} className="btn-surface flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm">
                <Plus className="h-4 w-4" /> Add images or videos
              </button>
              {items.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Whole queue: <span className="tabular-nums text-foreground">{formatDuration(queueSeconds)}</span>
                  {" · "}
                  {videos > 0 && `${videos} video${videos === 1 ? "" : "s"}`}
                  {videos > 0 && images > 0 && ", "}
                  {images > 0 && `${images} image${images === 1 ? "" : "s"}`}
                </p>
              )}
            </div>
          </Section>

          {/* ─── When ─── */}
          <Section title="When" hint={`${describeDays(days)} · ${describeWindow(windowSpec)}`}>
            <div className="space-y-4">
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

              {!allDay && (
                <div className="flex flex-col gap-3 rounded-2xl border border-border p-3">
                  <div role="radiogroup" aria-label="How the queue plays" className="grid gap-2 @md:grid-cols-2">
                    {(
                      [
                        [true, "Loop", "Repeats until the time slot ends."],
                        [false, "Play once", "Plays through one time, then shows what you choose below."],
                      ] as const
                    ).map(([value, label, hint]) => (
                      <button
                        key={label}
                        type="button"
                        role="radio"
                        aria-checked={loop === value}
                        onClick={() => setLoop(value)}
                        className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                          loop === value ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                        }`}
                      >
                        <span className="block text-sm">{label}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>
                      </button>
                    ))}
                  </div>
                  {!loop && (
                    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                      <span className="text-[11px] text-muted-foreground">Afterwards, show</span>
                      {afterMedia ? (
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div className="h-9 w-12 shrink-0 overflow-hidden rounded-md border border-border">
                            <MediaThumb
                              compact
                              type={afterMedia.type}
                              src={afterMedia.type === "image" ? (afterMedia.thumbnailUrl || afterMedia.url) : afterMedia.thumbnailUrl}
                              name={afterMedia.name}
                            />
                          </div>
                          <span className="min-w-0 truncate text-sm">{afterMedia.name}</span>
                        </div>
                      ) : (
                        <span className="flex-1 text-sm text-foreground/80">The screens&apos; idle screen</span>
                      )}
                      <div className="flex shrink-0 gap-2">
                        <button type="button" onClick={() => setPickingAfter(true)} className="btn-surface rounded-full px-3 py-1 text-xs">
                          {afterMedia ? "Change" : "Choose image or video"}
                        </button>
                        {afterMedia && (
                          <button type="button" onClick={() => setAfterMedia(null)} className="rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                            Use idle screen
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {items.length > 0 && (
                <p className="rounded-2xl bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
                  {allDay
                    ? `The queue (${formatDuration(queueSeconds)}) repeats all day, from midnight to midnight.`
                    : fitSummary({ loop: repeats, queueSeconds, windowSeconds, unfit, startTime, afterName: afterMedia?.name ?? null })}
                </p>
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

          {/* ─── Checks ─── */}
          <div className="space-y-2 rounded-2xl bg-muted/50 px-4 py-3 text-xs">
            <p className="text-muted-foreground">
              {items.length === 0
                ? "Add images or videos to the queue for this schedule to play."
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
                  Overlaps &quot;{c.name}&quot; on {c.screens} screen{c.screens === 1 ? "" : "s"}.{" "}
                  {c.thisWins ? "This one plays there, as the newer schedule." : `"${c.name}" plays there, as the newer schedule.`}
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

      <MediaPicker open={picking} onClose={() => setPicking(false)} onSelectItem={addMedia} accept="visual" multi />
      <MediaPicker
        open={pickingAfter}
        onClose={() => setPickingAfter(false)}
        onSelectItem={(m) => {
          if (m.type !== "image" && m.type !== "video") return setError(`"${m.name}" isn't an image or a video.`);
          setAfterMedia({ id: m.id, name: m.name, type: m.type, url: m.url, thumbnailUrl: m.type === "image" ? m.url : null });
        }}
        accept="visual"
      />
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Length of the daily time slot, in seconds (all day = 24h). */
function windowLengthSeconds(spec: { startTime: string | null; endTime: string | null }): number {
  if (!spec.startTime || !spec.endTime) return 86400;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const len = toMin(spec.endTime) - toMin(spec.startTime);
  return (len > 0 ? len : len + 1440) * 60;
}

/** One line on how the queue fits the time slot. */
function fitSummary(x: { loop: boolean; queueSeconds: number; windowSeconds: number; unfit: number; startTime: string; afterName?: string | null }): string {
  const head = `The time slot is ${formatDuration(x.windowSeconds)}; the queue is ${formatDuration(x.queueSeconds)}. `;
  if (x.unfit > 0) {
    return head + `The last ${x.unfit === 1 ? "item doesn't" : `${x.unfit} items don't`} get a turn: shorten the images or make the slot longer.`;
  }
  if (x.queueSeconds >= x.windowSeconds) return head + "It fills the slot once.";
  if (!x.loop) {
    const [h, m] = x.startTime.split(":").map(Number) as [number, number];
    return head + `It plays once, finishing at ${formatClock((h * 60 + m) * 60 + x.queueSeconds)}${x.afterName ? `, then the screens show ${x.afterName}.` : ", then the screens go to their idle screen."}`;
  }
  const times = Math.floor(x.windowSeconds / Math.max(1, x.queueSeconds));
  return head + `It repeats about ${times} time${times === 1 ? "" : "s"}.`;
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

const DURATION_PRESETS: [string, number][] = [
  ["5s", 5],
  ["10s", 10],
  ["15s", 15],
  ["30s", 30],
  ["1m", 60],
  ["5m", 300],
  ["15m", 900],
  ["30m", 1800],
  ["1h", 3600],
];

/** Hours, minutes and seconds, stored as seconds, with quick picks. */
function DurationInput({ seconds, onChange }: { seconds: number; onChange: (s: number) => void }) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const set = (nh: number, nm: number, ns: number) => onChange(Math.min(MAX_ITEM_SECONDS, nh * 3600 + nm * 60 + ns));
  const num = (v: string, max: number) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
  const cls = "w-11 rounded-lg border border-input bg-background px-1 py-1 text-center text-xs tabular-nums outline-none focus:border-ring";
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
          <option key={v} value={v}>{label}</option>
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
