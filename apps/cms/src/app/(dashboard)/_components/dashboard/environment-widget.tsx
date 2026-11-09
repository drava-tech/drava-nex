"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Lightbulb, Loader2, Lock, LockOpen, Minus, Plus, Power, Snowflake, Volume2, VolumeX } from "lucide-react";
import { listAmbientModes, applyAmbientMode, type AmbientModeSummary } from "@/actions/ambient-mode-actions";
import { listLights, setLightState, type LightSummary } from "@/actions/light-actions";
import { acPower, acSetTemp, getIrDeviceState } from "@/actions/ir-actions";
import { getLiveLockState, toggleDoorLock } from "@/actions/door-lock-actions";
import { IR_AC, IR_AC_CONFIGURED } from "@/lib/ir-devices";
import { useSystemAudio } from "@/hooks/useSystemAudio";

/** Same as the Environment page: the door locks itself again after an unlock. */
const AUTO_RELOCK_MS = 5_000;
const AC_MIN = 16;
const AC_MAX = 30;

/**
 * The room at a glance, controllable from the dashboard: room modes, all the
 * lights, the AC, the sound and the door. The Environment page has the full
 * controls; this uses the same server actions.
 */
export function EnvironmentWidget() {
  return (
    <div className="flex flex-col gap-5">
      <RoomModes />
      <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
        <Lights />
        <Climate />
        <Sound />
        <Door />
      </div>
      <Link href="/environment" className="self-start text-xs text-primary-ink underline-offset-4 hover:underline">
        Open Environment for every control
      </Link>
    </div>
  );
}

function Tile({ icon: Icon, title, children }: { icon: typeof Power; title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-xs text-foreground/80">
        <Icon className="h-4 w-4 text-primary-ink" />
        {title}
      </div>
      {children}
    </div>
  );
}

const pill = (on: boolean) =>
  `rounded-full px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${on ? "btn-active" : "btn-surface"}`;

// ─── Room modes ──────────────────────────────────────────────────────────────

function RoomModes() {
  const [modes, setModes] = useState<AmbientModeSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    listAmbientModes().then(setModes).catch(() => setModes([]));
  }, []);
  if (modes && modes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Room mode</span>
      <div className="flex flex-wrap gap-2">
        {modes === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          modes.map((m) => (
            <button
              key={m.key}
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(m.key);
                try {
                  await applyAmbientMode(m.key);
                  setActive(m.key);
                } catch {
                  alert(`Couldn't switch to ${m.label}.`);
                } finally {
                  setBusy(null);
                }
              }}
              className={`flex items-center gap-2 ${pill(active === m.key)}`}
            >
              <span aria-hidden className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: m.color }} />
              {busy === m.key ? "Applying…" : m.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Lights ──────────────────────────────────────────────────────────────────

function Lights() {
  const [lights, setLights] = useState<LightSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    listLights().then(setLights).catch(() => setLights([]));
  }, []);
  const onCount = lights?.filter((l) => l.state?.on).length ?? 0;
  const setAll = async (on: boolean) => {
    if (!lights?.length) return;
    setBusy(true);
    // Switching on restores each light's own brightness, as on the Environment page.
    await Promise.allSettled(
      lights.map((l) => setLightState(l.uuid, on ? { on: true, brightness: l.state?.brightness && l.state.brightness > 0 ? l.state.brightness : 80 } : { on: false }))
    );
    setLights((prev) => prev?.map((l) => ({ ...l, state: { ...l.state, on } })) ?? prev);
    setBusy(false);
  };
  return (
    <Tile icon={Lightbulb} title="Lights">
      {lights === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : lights.length === 0 ? (
        <p className="text-xs text-muted-foreground">No lights connected.</p>
      ) : (
        <>
          <p className="text-sm">
            {onCount} of {lights.length} on
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => setAll(true)} className={pill(onCount === lights.length)}>All on</button>
            <button type="button" disabled={busy} onClick={() => setAll(false)} className={pill(onCount === 0)}>All off</button>
          </div>
        </>
      )}
    </Tile>
  );
}

// ─── AC ──────────────────────────────────────────────────────────────────────

function Climate() {
  const [state, setState] = useState<{ power: boolean; temp: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!IR_AC_CONFIGURED) return setState({ power: false, temp: 24 });
    getIrDeviceState(IR_AC.uuid)
      .then((d) => {
        const st = (d.state ?? {}) as { power?: unknown; temp?: unknown };
        setState({ power: st.power === true, temp: typeof st.temp === "number" ? st.temp : 24 });
      })
      .catch(() => setState({ power: false, temp: 24 }));
  }, []);
  const send = async (next: { power: boolean; temp: number }, cmd: () => Promise<unknown>) => {
    const prev = state;
    setState(next);
    setBusy(true);
    try {
      await cmd();
    } catch {
      setState(prev);
      alert("The AC didn't respond.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tile icon={Snowflake} title="AC">
      {!IR_AC_CONFIGURED ? (
        <p className="text-xs text-muted-foreground">No AC connected.</p>
      ) : state === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => send({ ...state, power: !state.power }, () => acPower(IR_AC.uuid, !state.power))}
            className={`flex items-center gap-1.5 ${pill(state.power)}`}
          >
            <Power className="h-3.5 w-3.5" /> {state.power ? "On" : "Off"}
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Cooler"
              disabled={busy || state.temp <= AC_MIN}
              onClick={() => send({ power: true, temp: state.temp - 1 }, () => acSetTemp(IR_AC.uuid, state.temp - 1))}
              className="btn-surface flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-12 text-center text-sm tabular-nums">{state.temp}°C</span>
            <button
              type="button"
              aria-label="Warmer"
              disabled={busy || state.temp >= AC_MAX}
              onClick={() => send({ power: true, temp: state.temp + 1 }, () => acSetTemp(IR_AC.uuid, state.temp + 1))}
              className="btn-surface flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </Tile>
  );
}

// ─── Sound ───────────────────────────────────────────────────────────────────

function Sound() {
  const { volume, muted, setVolume, setMuted } = useSystemAudio();
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? volume ?? 0;
  return (
    <Tile icon={Volume2} title="Sound">
      {volume === null || volume === undefined ? (
        <p className="text-xs text-muted-foreground">The sound system isn&apos;t reporting yet.</p>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => setMuted(!muted)}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${muted ? "btn-active" : "btn-surface"}`}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={shown}
            aria-label="Volume"
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={() => {
              if (draft !== null) setVolume(draft);
              setDraft(null);
            }}
            onKeyUp={() => {
              if (draft !== null) setVolume(draft);
              setDraft(null);
            }}
            className="min-w-0 flex-1 accent-[var(--primary)]"
          />
          <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{shown}%</span>
        </div>
      )}
    </Tile>
  );
}

// ─── Door ────────────────────────────────────────────────────────────────────

function Door() {
  const [locked, setLocked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const relock = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(async () => {
    try {
      const live = await getLiveLockState();
      setLocked(live.state === "locked");
    } catch {
      setLocked((l) => l ?? true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 30_000);
    return () => {
      clearInterval(t);
      if (relock.current) clearTimeout(relock.current);
    };
  }, [refresh]);
  const unlock = async () => {
    setBusy(true);
    setLocked(false);
    try {
      await toggleDoorLock("unlocked");
      relock.current = setTimeout(() => {
        setLocked(true);
        toggleDoorLock("locked").catch(() => refresh());
      }, AUTO_RELOCK_MS);
    } catch {
      await refresh();
      alert("The door didn't respond.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tile icon={locked === false ? LockOpen : Lock} title="Door">
      {locked === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`text-sm ${locked ? "" : "text-primary-ink"}`}>{locked ? "Locked" : "Unlocked · locks again in a moment"}</span>
          {locked && (
            <button type="button" disabled={busy} onClick={unlock} className={`flex items-center gap-1.5 ${pill(false)}`}>
              <LockOpen className="h-3.5 w-3.5" /> Unlock
            </button>
          )}
        </div>
      )}
    </Tile>
  );
}
