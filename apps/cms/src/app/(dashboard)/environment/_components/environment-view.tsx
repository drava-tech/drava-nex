"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@platform/ui";
import dynamic from "next/dynamic";
import { toggleDoorLock, getLiveLockState } from "@/actions/door-lock-actions";
import { hexToRgb } from "./utils";
import { setLightState, getLightState } from "@/actions/light-actions";
import { acPower, acSetTemp, acSetMode, acSetFan, sendRemoteKey, getIrDeviceState } from "@/actions/ir-actions";
import {
  IR_AC,
  IR_AC_CONFIGURED,
  IR_REMOTES,
  irDeviceForDeviceId,
  acModeToBridge,
  acModeFromBridge,
  acFanToBridge,
  acFanFromBridge,
} from "@/lib/ir-devices";
import { LIGHT_GROUP, GROUP_ON_BRIGHTNESS, DEFAULT_GROUP_COLOR, isGroupDeviceId } from "@/lib/casambi-lights";

const ClimateContent = dynamic(() => import("./climate-content"), { ssr: false });
const LightingContent = dynamic(() => import("./lighting-content"), { ssr: false });
const AudioContent = dynamic(() => import("./audio-content"), { ssr: false });
const SecurityContent = dynamic(() => import("./security-content"), { ssr: false });
const LightColourContent = dynamic(() => import("./light-colour-content"), { ssr: false });
const IrRemotesContent = dynamic(() => import("./ir-remotes-content"), { ssr: false });

type PanelType = "climate" | "lighting" | "audio" | "security";

// The panels this page renders, in fixed order. The grid below sizes itself
// from this list, so adding or removing a card needs no layout changes.
const PANELS: PanelType[] = ["climate", "lighting", "audio", "security"];

// Grid-area names for the non-focused cards, in the order they stack.
const SECONDARY_ROLES = ["top", "middle", "bottom"].slice(0, PANELS.length - 1);

const cardLayoutTransition = { type: "spring", bounce: 0.14, duration: 0.9 } as any;

// How long the door stays unlocked before the UI re-locks it automatically.
const AUTO_RELOCK_MS = 5_000;
// Safety-net poll for the lock; the live path is the LOCK_STATE_UPDATE push.
const LOCK_POLL_FALLBACK_MS = 30_000;

export function EnvironmentView() {
  const [focused, setFocused] = useState<PanelType>("lighting");
  const [isClient, setIsClient] = useState(false);
  // const [show3D, setShow3D] = useState(false);
  const [showRemotes, setShowRemotes] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // States
  const [climate, setClimate] = useState({
    power: true,
    temp: 22,
    mode: "Cool",
    fan: 60,
    swing: false,
    turbo: false,
    timer: null as string | null,
    fanSpeed: "Med",
  });
  // Both Casambi drivers move together and the card offers on/off only, so a
  // single boolean is the whole lighting model: optimistic on toggle, then
  // corrected from the mesh by the one member that reports state back.
  const [lightsOn, setLightsOn] = useState(false);
  // The colour the user last chose for the group.
  //
  // Deliberately NOT synced from LIGHT_STATE_UPDATE. These fixtures transform
  // what they are sent — the RGB path forces saturation to maximum, so a warm
  // white reads back as red (see the calibration record in casambi-lights.ts).
  // Syncing the swatch from readback would therefore replace the user's choice
  // with the hardware's mangled version of it. Desired is the honest thing to
  // show; localStorage keeps it across reloads since the server only stores
  // what the fixture reports, not what was asked for.
  const [groupColor, setGroupColor] = useState<string>(DEFAULT_GROUP_COLOR);
  const [showColourPanel, setShowColourPanel] = useState(false);
  const [audio, setAudio] = useState({ power: true, playing: true, volume: 45, muted: false, input: "AUX", treble: 0, device: "Detecting..." });

  const pendingVolumeRef = useRef<number | null>(null);
  const isSendingVolumeRef = useRef<boolean>(false);

  // Real volume/mute/device — read live over WS from the native audio bridge
  // (apps/api/audio-helper/bridge.mjs), not local mock state like the other
  // panels above. power/playing/input/treble stay local-only: no
  // backend equivalent exists for those (NAudio only exposes volume/mute).
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isDisposed = false;

    const connect = () => {
      if (isDisposed) return;
      const wsUrl = process.env["NEXT_PUBLIC_WS_GATEWAY_URL"] ?? "/ws/";
      let resolved = wsUrl;
      if (typeof window !== "undefined" && wsUrl.startsWith("/")) {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        resolved = `${protocol}//${window.location.host}${wsUrl}`;
      }

      ws = new WebSocket(resolved);

      ws.onopen = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "CMS_REGISTER" }));
        }
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "AUDIO_STATUS_UPDATE") {
            // Ignore stale volume echoes while a local drag/write is still in
            // flight — NAudio's own change notification bounces back over WS
            // a step or two behind the live pointer position, and applying it
            // mid-drag fights the optimistic value and makes the slider stutter.
            const applyVolume = pendingVolumeRef.current === null && !isSendingVolumeRef.current;
            setAudio(s => ({ ...s, volume: applyVolume ? msg.volume : s.volume, muted: msg.muted, device: msg.device }));
          }
          // Either driver's report speaks for the group — they are always
          // commanded together, and the gateway polls them on a slow rotation so
          // whichever one answers first is the freshest truth we have. This is
          // what keeps the switch honest when someone uses a wall switch, the
          // Casambi app, or the Home Assistant bridge on this same network.
          // Pushed by the API's Home Assistant ingest the instant HA sees the
          // change, from any source. This is what makes the Security card as
          // immediate as HA's own dashboard; the poll below is only a net.
          if (msg.type === "LOCK_STATE_UPDATE") {
            if (msg.state === "locked" || msg.state === "unlocked") {
              // A real-world change supersedes any pending auto-relock timer.
              if (autoLockTimerRef.current && msg.state === "locked") {
                clearTimeout(autoLockTimerRef.current);
                autoLockTimerRef.current = null;
              }
              setSecurity({ locked: msg.state === "locked" });
            }
          }
          if (msg.type === "IR_STATE_UPDATE") {
            const dev = irDeviceForDeviceId(msg.deviceId);
            // Only the AC drives a live panel; its state is echoed back on each
            // command (the bridge has no external AC-state feedback path).
            if (dev && dev.deviceId === IR_AC.deviceId && msg.state) {
              const st = msg.state as { power?: boolean; temp?: number; mode?: string; fan?: string };
              setClimate(s => ({
                ...s,
                power: typeof st.power === "boolean" ? st.power : s.power,
                temp: typeof st.temp === "number" ? st.temp : s.temp,
                mode: typeof st.mode === "string" ? acModeFromBridge(st.mode) : s.mode,
                fanSpeed: typeof st.fan === "string" ? acFanFromBridge(st.fan) : s.fanSpeed,
              }));
            }
          }
          if (msg.type === "LIGHT_STATE_UPDATE" && isGroupDeviceId(msg.deviceId)) {
            const on = typeof msg.state?.on === "boolean"
              ? msg.state.on
              : typeof msg.state?.brightness === "number" ? msg.state.brightness > 0 : undefined;
            if (on !== undefined) setLightsOn(on);
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        if (!isDisposed) reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = () => { ws?.close(); };
    };

    connect();

    fetch("/api/audio/status")
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.volume === "number") {
          setAudio(s => ({ ...s, volume: data.volume, muted: data.muted, device: data.device }));
        }
      })
      .catch(err => console.error("Failed to fetch audio status:", err));

    return () => {
      isDisposed = true;
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  const apiSetVolume = useCallback((volume: number) => {
    setAudio(s => ({ ...s, volume, muted: false }));
    pendingVolumeRef.current = volume;
    if (isSendingVolumeRef.current) return;

    const sendNext = () => {
      if (pendingVolumeRef.current === null) {
        isSendingVolumeRef.current = false;
        return;
      }
      const volToSend = pendingVolumeRef.current;
      pendingVolumeRef.current = null;
      isSendingVolumeRef.current = true;

      fetch("/api/audio/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volume: volToSend }),
      })
        .catch(err => console.error("Error setting volume:", err))
        .finally(() => { setTimeout(sendNext, 50); });
    };

    sendNext();
  }, []);

  const apiSetMuted = useCallback((muted: boolean) => {
    setAudio(s => ({ ...s, muted }));
    fetch(muted ? "/api/audio/mute" : "/api/audio/unmute", { method: "POST" })
      .catch(err => console.error("Error setting mute:", err));
  }, []);

  // Grouped on/off → both real Casambi drivers (apps/api/src/services/casambi-driver.ts).
  // Both commands are issued in the same tick so the two fixtures switch
  // together, and "on" carries a fixed colour + brightness so they can never
  // drift apart. No coalescing queue here — with a single switch there is
  // nothing to coalesce; an in-flight ref just drops re-entrant taps.
  const lightPendingRef = useRef(false);
  // Read inside callbacks that must not re-create on every colour change.
  const groupColorRef = useRef(groupColor);
  useEffect(() => { groupColorRef.current = groupColor; }, [groupColor]);

  const apiSetGroupPower = useCallback((on: boolean) => {
    if (lightPendingRef.current) return;
    lightPendingRef.current = true;
    setLightsOn(on);

    const payload = on
      ? { on: true, brightness: GROUP_ON_BRIGHTNESS, color: groupColorRef.current }
      : { on: false };

    Promise.all(LIGHT_GROUP.map(dev => setLightState(dev.uuid, payload)))
      .catch(err => {
        console.error("Error setting lighting group:", err);
        setLightsOn(!on);
      })
      .finally(() => { lightPendingRef.current = false; });
  }, []);

  const apiSetGroupColor = useCallback((hex: string) => {
    setGroupColor(hex);
    try { localStorage.setItem("cms_light_group_colour", hex); } catch { /* private mode */ }

    const payload = { on: true, brightness: GROUP_ON_BRIGHTNESS, color: hex };
    const sendAll = () => Promise.all(LIGHT_GROUP.map(dev => setLightState(dev.uuid, payload)));

    // Sent twice, ~2s apart. Commands demonstrably do not always reach both
    // fixtures — that is the whole reason the two drift into different colours
    // — and a second identical send is by far the cheapest way to raise the
    // odds both land. It is idempotent, so a duplicate costs nothing.
    sendAll()
      .then(() => { setLightsOn(true); setTimeout(() => { void sendAll().catch(() => {}); }, 2000); })
      .catch(err => console.error("Error setting lighting group colour:", err));
  }, []);

  // Restore the last chosen colour; the server only knows what the fixtures
  // report, which is not what was asked for.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cms_light_group_colour");
      if (saved && /^#[0-9A-F]{6}$/i.test(saved)) setGroupColor(saved);
    } catch { /* private mode */ }
  }, []);

  // Hydrate from the drivers' last-known persisted state. Both are read: the
  // pair is always driven together, so either row is a valid answer, and one of
  // them may be staler than the other depending on the gateway's poll rotation.
  useEffect(() => {
    Promise.all(LIGHT_GROUP.map(dev => getLightState(dev.uuid).catch(() => null)))
      .then(results => {
        const states = results.flatMap(r => (r?.state ? [r.state] : []));
        if (states.length > 0) setLightsOn(states.some(st => st.on === true));
      })
      .catch(err => console.error("Failed to load light states:", err));
  }, []);

  // ── IR air-conditioner (Tuya cloud bridge) ────────────────────────────────
  // Per-command-family coalescing so a held temp +/- press collapses to the
  // latest value instead of blasting the Tuya cloud path, while power/mode/fan
  // don't block each other.
  const pendingAcRef = useRef<Map<string, () => Promise<unknown>>>(new Map());
  const sendingAcRef = useRef<Set<string>>(new Set());

  const queueAcCommand = useCallback((family: string, run: () => Promise<unknown>) => {
    if (!IR_AC_CONFIGURED) return; // still mock until a real device uuid is set
    pendingAcRef.current.set(family, run);
    if (sendingAcRef.current.has(family)) return;

    const sendNext = () => {
      const next = pendingAcRef.current.get(family);
      if (!next) {
        sendingAcRef.current.delete(family);
        return;
      }
      pendingAcRef.current.delete(family);
      sendingAcRef.current.add(family);
      next()
        .catch(err => console.error(`Error sending AC ${family}:`, err))
        .finally(() => { setTimeout(sendNext, 50); });
    };
    sendNext();
  }, []);

  const acSetPowerCmd = useCallback((power: boolean) => {
    setClimate(s => ({ ...s, power }));
    queueAcCommand("power", () => acPower(IR_AC.uuid, power));
  }, [queueAcCommand]);

  // set_* commands turn the AC on bridge-side, so reflect that optimistically.
  const acSetTempCmd = useCallback((temp: number) => {
    setClimate(s => ({ ...s, temp, power: true }));
    queueAcCommand("temp", () => acSetTemp(IR_AC.uuid, temp));
  }, [queueAcCommand]);

  const acSetModeCmd = useCallback((mode: string) => {
    setClimate(s => ({ ...s, mode, power: true }));
    queueAcCommand("mode", () => acSetMode(IR_AC.uuid, acModeToBridge(mode)));
  }, [queueAcCommand]);

  const acSetFanSpeedCmd = useCallback((fanSpeed: string) => {
    setClimate(s => ({ ...s, fanSpeed, power: true }));
    queueAcCommand("fan", () => acSetFan(IR_AC.uuid, acFanToBridge(fanSpeed)));
  }, [queueAcCommand]);

  const handleRemoteKey = useCallback((deviceUuid: string, key: string) => {
    sendRemoteKey(deviceUuid, key).catch(err => console.error(`Error sending IR key ${key}:`, err));
  }, []);

  // Hydrate the Climate panel from the AC's last-known persisted state, so a
  // reload reflects reality instead of the hardcoded mock defaults.
  useEffect(() => {
    if (!IR_AC_CONFIGURED) return;
    getIrDeviceState(IR_AC.uuid)
      .then((dev) => {
        const st = dev?.state as { power?: boolean; temp?: number; mode?: string; fan?: string } | undefined;
        if (!st) return;
        setClimate(s => ({
          ...s,
          power: typeof st.power === "boolean" ? st.power : s.power,
          temp: typeof st.temp === "number" ? st.temp : s.temp,
          mode: typeof st.mode === "string" ? acModeFromBridge(st.mode) : s.mode,
          fanSpeed: typeof st.fan === "string" ? acFanFromBridge(st.fan) : s.fanSpeed,
        }));
      })
      .catch(err => console.error("Failed to load AC state:", err));
  }, []);

  // Real lock state — read live from Home Assistant (unlike the other mock
  // panels above), polled so it stays correct even when the lock changes
  // some other way (e.g. auto-lock). Toggling updates optimistically and
  // reverts on failure.
  const [security, setSecurity] = useState({ locked: true });
  const lockPendingRef = useRef(false);
  const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshLockState = useCallback(async () => {
    try {
      const live = await getLiveLockState();
      setSecurity({ locked: live.state === "locked" });
    } catch {
      // Leave the last-known state on screen for this compact tile rather
      // than flashing an error — a failed toggle still reverts below.
    }
  }, []);

  // LOCK_STATE_UPDATE above is the live path. This poll only covers the gap
  // while the websocket is down or reconnecting, so it can be slow — at 5s it
  // was the card's sole source of truth, which is why it lagged HA so visibly.
  useEffect(() => {
    refreshLockState();
    const interval = setInterval(refreshLockState, LOCK_POLL_FALLBACK_MS);
    return () => clearInterval(interval);
  }, [refreshLockState]);

  const setLocked = useCallback((locked: boolean) => {
    if (lockPendingRef.current) return;

    // Cancel any pending auto-relock — this new action supersedes it.
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }

    lockPendingRef.current = true;
    setSecurity({ locked });
    toggleDoorLock(locked ? "locked" : "unlocked")
      .then(() => {
        if (!locked) {
          // Auto re-lock 5s after an unlock. Must stay comfortably above the
          // Yale cloud's own command latency (measured at ~8s cold, ~2s warm) —
          // at 2s the relock was firing while the unlock was still in flight,
          // racing the two commands and making the toggle visibly snap back.
          autoLockTimerRef.current = setTimeout(() => {
            autoLockTimerRef.current = null;
            setSecurity({ locked: true });
            toggleDoorLock("locked").catch(() => refreshLockState());
          }, AUTO_RELOCK_MS);
        }
      })
      .catch(() => refreshLockState())
      .finally(() => { lockPendingRef.current = false; });
  }, [refreshLockState]);

  useEffect(() => {
    return () => {
      if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
    };
  }, []);

  // Persistence
  useEffect(() => {
    setIsClient(true);
    // A stale "climate" saved before that card was hidden must not win, or the
    // page would try to focus a panel it no longer renders.
    const saved = localStorage.getItem("cms_environment_panel") as PanelType;
    if (saved && PANELS.includes(saved)) {
      setFocused(saved);
    }
  }, []);

  useEffect(() => {
    if (isClient && focused) localStorage.setItem("cms_environment_panel", focused);
  }, [focused, isClient]);

  // Order
  const orderedContents = [focused, ...PANELS.filter(x => x !== focused)];

  const renderContent = (type: PanelType, isExpanded: boolean) => {
    if (type === "climate") return <ClimateContent key="climate" isExpanded={isExpanded} state={climate} actions={{
      // Wired to the real IR AC via the CrabController bridge (apps/api ir-driver).
      setTemp: acSetTempCmd,
      setMode: acSetModeCmd,
      setPower: acSetPowerCmd,
      setFanSpeed: acSetFanSpeedCmd,
      // Local-only: the codebook for "Experience Centre AC" carries only
      // PowerOn/PowerOff/T/M/F (per /v1.0/devices/{id}/functions), so there is
      // no swing/turbo/timer dp. Reachable via raw IR learning
      // (PUT /v2.0/infrareds/{hub}/learning-state — verified live) but that
      // needs a human pressing the physical remote once per key, and the
      // learned blast is one-shot: these would become momentary buttons, not
      // the stateful toggles rendered today. Timer is better done CMS-side as
      // a scheduled power_off than over IR at all.
      setFan: (fan: number) => setClimate(s => ({ ...s, fan })),
      setSwing: (swing: boolean) => setClimate(s => ({ ...s, swing })),
      setTurbo: (turbo: boolean) => setClimate(s => ({ ...s, turbo })),
      setTimer: (timer: string | null) => setClimate(s => ({ ...s, timer })),
    }} />;
    if (type === "lighting") return <LightingContent key="lighting" isExpanded={isExpanded} state={{ on: lightsOn, color: groupColor }} actions={{
      setPower: apiSetGroupPower,
      setColor: apiSetGroupColor,
      openColourPanel: () => { setFocused("lighting"); setShowColourPanel(true); },
    }} />;
    if (type === "audio") return <AudioContent key="audio" isExpanded={isExpanded} state={audio} actions={{
      setPlaying: (playing: boolean) => setAudio(s => ({ ...s, playing })),
      setVolume: apiSetVolume,
      setMuted: apiSetMuted,
      setInput: (input: string) => setAudio(s => ({ ...s, input })),
      setPower: (power: boolean) => setAudio(s => ({ ...s, power })),
      setTreble: (treble: number) => setAudio(s => ({ ...s, treble })),
    }} />;
    if (type === "security") return <SecurityContent key="security" isExpanded={isExpanded} state={security} actions={{
      setLocked
    }} />;
    return null;
  };

  if (!isClient) return null;

  return (
    <div className="w-full h-full flex flex-col gap-4 sm:gap-6 overflow-y-auto lg:overflow-hidden font-sans text-foreground pb-2">

      <h1 className="shrink-0 text-3xl font-black tracking-tight pt-2">Environment</h1>

      <div
        className="flex-1 w-full grid gap-6 min-h-0"
        // Sized from PANELS so hiding or restoring a card leaves no empty cell:
        // one tall "primary" beside a stack of the remaining secondary slots.
        style={isDesktop
          ? { gridTemplateColumns: "68fr 32fr", gridTemplateRows: SECONDARY_ROLES.map(() => "1fr").join(" "), gridTemplateAreas: SECONDARY_ROLES.map(r => `"primary ${r}"`).join(" ") }
          : { gridTemplateColumns: "1fr", gridTemplateRows: PANELS.map(() => "auto").join(" "), gridTemplateAreas: ['"primary"', ...SECONDARY_ROLES.map(r => `"${r}"`)].join(" ") }
        }
      >
        {PANELS.map((type) => {
          const isPrimary = type === focused;
          const role = isPrimary ? "primary" : SECONDARY_ROLES[orderedContents.indexOf(type) - 1]!;
          return (
            <motion.div
              key={type}
              layout
              initial={false}
              animate={{ zIndex: isPrimary ? 50 : 1 }}
              transition={cardLayoutTransition}
              style={{
                gridArea: role,
                originX: 0.5,
                originY: 0.5,
                touchAction: "manipulation",
              }}
              /* ponytail: primary needs explicit min-h on mobile so grid auto-rows don't collapse to 0 height causing card overlaps */
              className={`rounded-2xl border bg-card flex flex-col relative min-h-0 ${isPrimary ? "min-h-[460px] lg:min-h-0 overflow-hidden" : "min-h-[96px] lg:min-h-0 overflow-hidden cursor-pointer hover:border-primary/50 transition-colors opacity-90 hover:opacity-100"}`}
              // onTap (not onClick) — this card animates with `layout`, and on
              // touchscreens a plain onClick's first tap can get swallowed while
              // Framer Motion is mid layout-measurement; onTap is its own
              // gesture-recognizer and doesn't have that race.
              onTap={isPrimary ? undefined : () => setFocused(type)}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={isPrimary ? "expanded" : "compact"}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1, transition: { duration: 0.4, delay: 0.1 } }}
                  exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                  className={isPrimary
                    ? "absolute inset-0 w-full h-full p-4 sm:p-5 md:p-8 flex flex-col overflow-y-auto lg:overflow-hidden"
                    : "absolute inset-0 w-full h-full p-3 md:p-4 flex flex-col justify-center overflow-hidden"}
                >
                  {renderContent(type, isPrimary)}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {focused === "lighting" && showColourPanel && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-6"
            onClick={() => setShowColourPanel(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 20, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.5 }}
              className="w-full max-w-4xl rounded-3xl border border-border/50 bg-card shadow-2xl p-6 md:p-8 relative overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute top-6 right-6 z-50">
                <Button variant="ghost" size="icon" className="rounded-full hover:bg-muted" onClick={() => setShowColourPanel(false)}>
                  <X className="w-5 h-5" />
                </Button>
              </div>
              <LightColourContent
                state={{ color: { ...hexToRgb(groupColor), hex: groupColor } }}
                actions={{
                  setColor: (c: { hex: string }) => apiSetGroupColor(c.hex),
                  closeColourPanel: () => setShowColourPanel(false),
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showRemotes && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-6"
            onClick={() => setShowRemotes(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 20, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.5 }}
              className="w-full max-w-3xl rounded-3xl border border-border/50 bg-card shadow-2xl p-6 md:p-8 relative overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute top-6 right-6 z-50">
                <Button variant="ghost" size="icon" className="rounded-full hover:bg-muted" onClick={() => setShowRemotes(false)}>
                  <X className="w-5 h-5" />
                </Button>
              </div>
              <IrRemotesContent remotes={IR_REMOTES} onKey={handleRemoteKey} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
