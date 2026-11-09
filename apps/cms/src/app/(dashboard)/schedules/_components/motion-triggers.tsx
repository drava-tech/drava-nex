"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Info, Loader2, MoreVertical, Pencil, Play, Plus, Radar, Trash2, X } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@platform/ui";
import type { MotionTriggerInput, MotionTriggerRow } from "@platform/db";
import {
  ALL_DAYS,
  DEFAULT_ITEM_SECONDS,
  DEFAULT_SCHEDULE_TIMEZONE,
  describeDays,
  describeWindow,
  formatDuration,
  SCHEDULE_DAY_LABELS,
  WEEKDAYS,
  WEEKEND,
} from "@platform/types";
import { MediaPicker } from "@/components/media-picker";
import { MediaThumb } from "@/components/media-thumb";
import {
  createMotionTrigger,
  deleteMotionTrigger,
  getMotionSensors,
  testMotionTrigger,
  updateMotionTrigger,
  type MotionOverview,
} from "@/actions/motion-trigger-actions";
import { Switch } from "./schedules-view";
import { DurationInput, Field, PickList, Section } from "./schedule-editor";
import { formatWhen, relativeIn, targetScreenIds, type GroupOption, type ScreenOption } from "./schedule-shared";

const COOLDOWNS: [string, number][] = [
  ["No wait", 0],
  ["30 seconds", 30],
  ["1 minute", 60],
  ["2 minutes", 120],
  ["5 minutes", 300],
  ["10 minutes", 600],
  ["15 minutes", 900],
  ["30 minutes", 1800],
  ["1 hour", 3600],
];

/**
 * Schedules → Motion: "when this sensor sees someone, play this on these
 * screens". The API hears the sensors and plays the content over whatever is
 * on, then lets the screens go back (see apps/api/src/services/motion-triggers.ts).
 */
export function MotionTriggers({
  overview,
  screens,
  groups,
  isAdmin,
}: {
  overview: MotionOverview | null;
  screens: ScreenOption[];
  groups: GroupOption[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<MotionTriggerRow | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Status (playing / cooling down) moves on its own; re-read it while visible.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);

  if (!overview) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
        <p className="font-heading text-base">Motion triggers aren&apos;t available yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          The API couldn&apos;t load them. If they were just added, the database needs its one-time update
          (migration 0043) before they can be used.
        </p>
      </div>
    );
  }

  const screenNames = new Map(screens.map((s) => [s.screenId, s.screenName]));
  const groupNames = new Map(groups.map((g) => [g.id, g.name]));

  const run = async (id: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(id);
    const res = await fn();
    setBusy(null);
    if (!res.success) alert(res.error ?? "Something went wrong.");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      {editing && (
        <MotionEditor
          trigger={editing === "new" ? null : editing}
          screens={screens}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Play an image or video on chosen screens when a motion sensor sees someone, over whatever is on. Afterwards
          the screens go back to their schedule, or to what they showed before.
        </p>
        {isAdmin && (
          <Button variant="pill" size="pill" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> New motion trigger
          </Button>
        )}
      </div>

      {(!overview.homeAssistant || !overview.sensorCalls) && (
        <div className="flex gap-2 rounded-2xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-1">
            {overview.homeAssistant ? (
              <p>Home Assistant is connected: its motion sensors fire these triggers.</p>
            ) : (
              <p>
                Home Assistant isn&apos;t connected on this server (HA_URL and HA_TOKEN), so its sensors can&apos;t fire triggers here.
              </p>
            )}
            {!overview.sensorCalls && (
              <p>
                Other sensors can fire a trigger by calling <code className="text-foreground">POST /api/motion-triggers/fire</code> with
                {" "}<code className="text-foreground">{"{ \"sensor\": \"<sensor id>\" }"}</code>, once MOTION_TRIGGER_TOKEN is set on the server.
              </p>
            )}
          </div>
        </div>
      )}

      {overview.triggers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <Radar className="h-8 w-8 text-muted-foreground" />
          <p className="font-heading text-base">No motion triggers yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            For example: when someone walks into the lobby, play the welcome video on the lobby screens.
          </p>
        </div>
      ) : (
        <div className="@container">
          <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @7xl:grid-cols-3">
            {overview.triggers.map((t) => {
              const st = overview.status[t.id];
              const playingUntil = st?.playingUntil ? Date.parse(st.playingUntil) : 0;
              const readyAt = st?.readyAt ? Date.parse(st.readyAt) : 0;
              const targets = targetScreenIds(t, screens);
              const where = [
                ...t.groupIds.map((g) => groupNames.get(g)).filter(Boolean),
                ...t.screenIds.map((s) => screenNames.get(s)).filter(Boolean),
              ].join(", ");
              return (
                <div key={t.id} className={`flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 ${busy === t.id ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-heading text-base">{t.name}</p>
                      <p className="truncate text-xs text-muted-foreground" title={t.sensorId}>
                        <Activity className="mr-1 inline h-3 w-3" />
                        {t.sensorId}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {playingUntil > now ? (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary-ink">Playing · {relativeIn(playingUntil - now).replace("in ", "")} left</span>
                      ) : readyAt > now ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Ready {relativeIn(readyAt - now)}</span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Ready</span>
                      )}
                      {isAdmin && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" aria-label={`Actions for ${t.name}`} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem className="cursor-pointer gap-2 py-1" onSelect={() => run(t.id, () => testMotionTrigger(t.id))}>
                              <Play className="h-4 w-4" /> Test now
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer gap-2 py-1" onSelect={() => setEditing(t)}>
                              <Pencil className="h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="cursor-pointer gap-2 py-1 text-destructive focus:text-destructive"
                              onSelect={() => {
                                if (confirm(`Delete "${t.name}"?`)) run(t.id, () => deleteMotionTrigger(t.id));
                              }}
                            >
                              <Trash2 className="h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="h-10 w-16 shrink-0 overflow-hidden rounded-md border border-border">
                      <MediaThumb
                        compact
                        type={t.media?.type ?? "image"}
                        src={t.media ? (t.media.type === "image" ? t.media.thumbnailUrl || t.media.url : t.media.thumbnailUrl) : null}
                        name={t.media?.name}
                      />
                    </div>
                    <div className="min-w-0 text-xs">
                      <p className="truncate text-sm">{t.media?.name ?? "Content was deleted"}</p>
                      <p className="text-muted-foreground">
                        Plays {formatDuration(t.durationSeconds)}
                        {t.media?.type === "video" ? " (full video)" : ""} · again after {t.cooldownSeconds ? formatDuration(t.cooldownSeconds) : "no wait"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                    <span>{describeDays(t.daysOfWeek)} · {t.startTime ? describeWindow(t) : "any time"}</span>
                    <span>
                      {targets.length} screen{targets.length === 1 ? "" : "s"}
                      {where && <>: {where}</>}
                    </span>
                    {st?.lastFiredAt && <span>Last played {formatWhen(st.lastFiredAt, new Date(now))}</span>}
                  </div>
                  {!t.media && <p className="text-[11px] text-warning">Its content was deleted, so it won&apos;t play. Edit it to pick another.</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function MotionEditor({
  trigger,
  screens,
  groups,
  onClose,
  onSaved,
}: {
  trigger: MotionTriggerRow | null;
  screens: ScreenOption[];
  groups: GroupOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(trigger?.name ?? "");
  const [sensorId, setSensorId] = useState(trigger?.sensorId ?? "");
  const [sensors, setSensors] = useState<{ id: string; name: string; state: string }[] | null>(null);
  const [haAvailable, setHaAvailable] = useState(true);
  const [screenIds, setScreenIds] = useState<Set<string>>(new Set(trigger?.screenIds ?? []));
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set(trigger?.groupIds ?? []));
  const [media, setMedia] = useState(trigger?.media ?? null);
  const [durationSeconds, setDurationSeconds] = useState(trigger?.durationSeconds ?? DEFAULT_ITEM_SECONDS.image);
  const [videoLength, setVideoLength] = useState<"reading" | "known" | "unknown" | null>(trigger?.media?.type === "video" ? "known" : null);
  const [cooldownSeconds, setCooldownSeconds] = useState(trigger?.cooldownSeconds ?? 300);
  const [anyTime, setAnyTime] = useState(trigger ? trigger.startTime === null : true);
  const [startTime, setStartTime] = useState(trigger?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(trigger?.endTime ?? "18:00");
  const [days, setDays] = useState<number[]>(trigger?.daysOfWeek ?? ALL_DAYS);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getMotionSensors().then((r) => {
      setSensors(r.sensors);
      setHaAvailable(r.available);
    });
  }, []);
  const knownSensor = useMemo(() => sensors?.some((s) => s.id === sensorId) ?? false, [sensors, sensorId]);
  const [typing, setTyping] = useState(false);
  const showTyped = typing || (sensors !== null && !!sensorId && !knownSensor) || (sensors !== null && sensors.length === 0);
  const targets = targetScreenIds({ screenIds: [...screenIds], groupIds: [...groupIds] }, screens);

  const toggleIn = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const pickMedia = async (m: { id: string; name: string; type: string; url: string }) => {
    if (m.type !== "image" && m.type !== "video") return setError(`"${m.name}" isn't an image or a video.`);
    setMedia({ id: m.id, name: m.name, type: m.type, url: m.url, thumbnailUrl: m.type === "image" ? m.url : null });
    if (m.type === "image") {
      setVideoLength(null);
      if (durationSeconds < 5) setDurationSeconds(DEFAULT_ITEM_SECONDS.image);
      return;
    }
    setVideoLength("reading");
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(m.id)}/length`);
      const data = res.ok ? ((await res.json()) as { seconds?: number | null }) : null;
      if (data?.seconds) {
        setDurationSeconds(data.seconds);
        setVideoLength("known");
      } else {
        setDurationSeconds(0);
        setVideoLength("unknown");
      }
    } catch {
      setDurationSeconds(0);
      setVideoLength("unknown");
    }
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError("Give the trigger a name.");
    if (!sensorId.trim()) return setError("Pick the motion sensor.");
    if (targets.length === 0) return setError("Pick at least one screen or group.");
    if (!media) return setError("Pick an image or video to play.");
    if (videoLength === "reading") return setError("Still reading the video's length — one moment.");
    if (days.length === 0) return setError("Pick at least one day.");
    const input: MotionTriggerInput = {
      name: name.trim(),
      sensorId: sensorId.trim(),
      screenIds: [...screenIds],
      groupIds: [...groupIds],
      mediaAssetId: media.id,
      durationSeconds,
      cooldownSeconds,
      startTime: anyTime ? null : startTime,
      endTime: anyTime ? null : endTime,
      daysOfWeek: [...days].sort(),
      timezone: trigger?.timezone ?? DEFAULT_SCHEDULE_TIMEZONE,
    };
    setSaving(true);
    const res = trigger ? await updateMotionTrigger(trigger.id, input) : await createMotionTrigger(input);
    setSaving(false);
    if (!res.success) return setError(res.error);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={trigger ? "Edit motion trigger" : "New motion trigger"}
        className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden bg-popover text-popover-foreground shadow-xl sm:max-h-[92vh] sm:rounded-3xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary-ink" />
            <h2 className="font-heading text-base">{trigger ? "Edit motion trigger" : "New motion trigger"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="@container min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
          <Section title="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lobby welcome"
              maxLength={80}
              autoFocus
              aria-label="Trigger name"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
            />
          </Section>

          <Section title="Motion sensor" hint={haAvailable ? "From Home Assistant, or type another sensor's name" : "Type the name the sensor sends"}>
            {sensors === null ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for sensors…</p>
            ) : (
              <div className="space-y-2">
                {sensors.length > 0 && !showTyped && (
                  <select
                    value={sensorId}
                    onChange={(e) => (e.target.value === "__other__" ? (setTyping(true), setSensorId("")) : setSensorId(e.target.value))}
                    aria-label="Motion sensor"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
                  >
                    <option value="">Choose a sensor…</option>
                    {sensors.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
                    ))}
                    <option value="__other__">Another sensor…</option>
                  </select>
                )}
                {showTyped && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sensorId}
                      onChange={(e) => setSensorId(e.target.value)}
                      placeholder="binary_sensor.lobby_motion"
                      aria-label="Sensor name"
                      className="min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
                    />
                    {sensors.length > 0 && (
                      <button type="button" onClick={() => setTyping(false)} className="btn-surface shrink-0 rounded-full px-3 text-xs">
                        Pick from list
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </Section>

          <Section title="Screens" hint={`${targets.length} screen${targets.length === 1 ? "" : "s"}`}>
            <div className="grid gap-4 @lg:grid-cols-2">
              <PickList
                label="Groups"
                empty="No groups yet."
                options={groups.map((g) => ({ id: g.id, label: g.name, sub: `${screens.filter((s) => s.groupId === g.id).length} screens` }))}
                selected={groupIds}
                onToggle={(id) => toggleIn(groupIds, id, setGroupIds)}
              />
              <PickList
                label="Screens"
                empty="No screens yet."
                options={screens.map((s) => ({ id: s.screenId, label: s.screenName, sub: s.groupId && groupIds.has(s.groupId) ? "via its group" : undefined }))}
                selected={screenIds}
                onToggle={(id) => toggleIn(screenIds, id, setScreenIds)}
              />
            </div>
          </Section>

          <Section title="What plays">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border p-3">
              {media ? (
                <>
                  <div className="h-10 w-16 shrink-0 overflow-hidden rounded-md border border-border">
                    <MediaThumb compact type={media.type} src={media.type === "image" ? media.thumbnailUrl || media.url : media.thumbnailUrl} name={media.name} />
                  </div>
                  <span className="min-w-[8rem] flex-1 truncate text-sm">{media.name}</span>
                </>
              ) : (
                <span className="flex-1 text-sm text-muted-foreground">Nothing picked yet</span>
              )}
              <button type="button" onClick={() => setPicking(true)} className="btn-surface shrink-0 rounded-full px-3 py-1 text-xs">
                {media ? "Change" : "Choose image or video"}
              </button>
            </div>
            {media && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted-foreground">Plays for</span>
                {media.type === "image" ? (
                  <DurationInput seconds={durationSeconds} onChange={setDurationSeconds} />
                ) : videoLength === "reading" ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Reading length…</span>
                ) : videoLength === "known" ? (
                  <span className="rounded-lg border border-dashed border-input px-2.5 py-1 text-xs tabular-nums text-foreground/80">{formatDuration(durationSeconds)} · full video</span>
                ) : (
                  <span className="rounded-lg border border-dashed border-input px-2.5 py-1 text-xs text-muted-foreground">Full video · length read on save</span>
                )}
              </div>
            )}
          </Section>

          <Section title="Play again after" hint="So a busy spot doesn't keep restarting it">
            <select
              value={cooldownSeconds}
              onChange={(e) => setCooldownSeconds(Number(e.target.value))}
              aria-label="Play again after"
              className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
            >
              {COOLDOWNS.map(([label, v]) => (
                <option key={v} value={v}>{label}</option>
              ))}
              {!COOLDOWNS.some(([, v]) => v === cooldownSeconds) && <option value={cooldownSeconds}>{formatDuration(cooldownSeconds)}</option>}
            </select>
          </Section>

          <Section title="When it can trigger" hint={`${describeDays(days)} · ${anyTime ? "any time" : describeWindow({ startTime, endTime })}`}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-2.5 text-sm">
                  <Switch checked={anyTime} onChange={() => setAnyTime((v) => !v)} label="Any time" />
                  <span>Any time</span>
                </div>
                {!anyTime && (
                  <div className="flex items-center gap-2 text-sm">
                    <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label="From" className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
                    <span className="text-muted-foreground">to</span>
                    <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="Until" className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
                  </div>
                )}
              </div>
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
            </div>
          </Section>

          <Field label="">
            <p className="rounded-2xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
              When {sensorId || "the sensor"} sees motion, {media ? `"${media.name}"` : "the content"} plays on {targets.length || "the chosen"} screen
              {targets.length === 1 ? "" : "s"} over whatever is on, then they go back. Use Test now on the trigger to try it without the sensor.
            </p>
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-4">
          {error && <p className="mr-auto text-xs text-destructive">{error}</p>}
          <button type="button" onClick={onClose} className="btn-surface rounded-full px-5 py-2 text-sm">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary rounded-full px-5 py-2 text-sm disabled:opacity-50">
            {saving ? "Saving…" : trigger ? "Save changes" : "Create trigger"}
          </button>
        </div>
      </div>

      <MediaPicker open={picking} onClose={() => setPicking(false)} onSelectItem={(m) => void pickMedia(m)} accept="visual" />
    </div>
  );
}
