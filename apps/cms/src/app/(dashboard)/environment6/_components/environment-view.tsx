"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Power } from "lucide-react";
import { Button } from "@platform/ui";
import { EnvironmentView as ThreeDView } from "../../environment5/_components/environment-view";
import dynamic from "next/dynamic";
import { toggleDoorLock, getLiveLockState } from "@/actions/door-lock-actions";
import { setLightState, identifyLight, type LightStateInput } from "@/actions/light-actions";
import { pressTvPower } from "@/actions/crabtree-actions";
import { ZONE_DEVICES, ZONE_NAMES, zoneForDeviceId } from "@/lib/casambi-zones";
import { hexToRgb } from "./utils";

const ClimateContent = dynamic(() => import("./climate-content"), { ssr: false });
const LightingContent = dynamic(() => import("./lighting-content"), { ssr: false });
const AudioContent = dynamic(() => import("./audio-content"), { ssr: false });
const LightColourContent = dynamic(() => import("./light-colour-content"), { ssr: false });
const SecurityContent = dynamic(() => import("./security-content"), { ssr: false });

type PanelType = "climate" | "lighting" | "audio" | "security";

const cardLayoutTransition = { type: "spring", bounce: 0.14, duration: 0.9 } as any;

export function EnvironmentView() {
  const [focused, setFocused] = useState<PanelType>("climate");
  const [isClient, setIsClient] = useState(false);
  const [showColourPanel, setShowColourPanel] = useState(false);
  const [show3D, setShow3D] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  // Header TV on/off → live CrabController IR bridge (POST :8000/command).
  // The TV codebook has a single Power toggle, so each press flips it; tvOn is a
  // best-guess label that flips with each successful press.
  const [tvOn, setTvOn] = useState(false);
  const [tvBusy, setTvBusy] = useState(false);
  const toggleTv = useCallback(async () => {
    if (tvBusy) return;
    setTvBusy(true);
    try {
      await pressTvPower();
      setTvOn((v) => !v);
    } catch (err) {
      console.error("TV toggle failed:", err);
    } finally {
      setTvBusy(false);
    }
  }, [tvBusy]);

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
    mode: "Dry",
    fan: 60,
    swing: false,
    turbo: false,
    timer: null as string | null,
    fanSpeed: "Med",
  });
  const [lighting, setLighting] = useState({
    power: true,
    brightness: 49,
    activeScene: "Presentation",
    zones: Object.fromEntries(ZONE_NAMES.map(zone => [zone, 49])) as Record<string, number>,
    color: { r: 138, g: 92, b: 255, w: 100, hex: "#8A5CFF" }
  });
  const [audio, setAudio] = useState({ power: true, playing: true, volume: 45, muted: false, input: "HDMI", treble: 0, device: "Detecting..." });

  // Mirrors `lighting` for reads inside callbacks that must stay pure setState
  // updaters (queueLightState fires a server action — a side effect — so it
  // can never run inside a setLighting(s => ...) updater; React may invoke
  // updaters outside the normal commit flow, which is what was breaking this).
  const lightingRef = useRef(lighting);
  useEffect(() => { lightingRef.current = lighting; }, [lighting]);

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
          if (msg.type === "LIGHT_STATE_UPDATE") {
            const zone = zoneForDeviceId(msg.deviceId);
            if (zone) {
              const nextBrightness = typeof msg.state?.brightness === "number" ? msg.state.brightness : undefined;
              const nextHex = typeof msg.state?.color === "string" ? msg.state.color : undefined;
              setLighting(s => ({
                ...s,
                zones: nextBrightness === undefined ? s.zones : { ...s.zones, [zone]: nextBrightness },
                color: nextHex === undefined ? s.color : { ...s.color, ...hexToRgb(nextHex), hex: nextHex },
              }));
            }
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
        .finally(sendNext);
    };

    sendNext();
  }, []);

  const apiSetMuted = useCallback((muted: boolean) => {
    setAudio(s => ({ ...s, muted }));
    fetch(muted ? "/api/audio/mute" : "/api/audio/unmute", { method: "POST" })
      .catch(err => console.error("Error setting mute:", err));
  }, []);

  // Per-device command queue → real Casambi lights (apps/api/src/services/casambi-driver.ts).
  // Same pending-ref coalescing as apiSetVolume above, keyed per device so the
  // zones (+ color, which fans out to every zone) don't block each other during drags.
  const pendingLightStateRef = useRef<Map<string, LightStateInput>>(new Map());
  const sendingLightRef = useRef<Set<string>>(new Set());

  const queueLightState = useCallback((deviceUuid: string, state: LightStateInput) => {
    pendingLightStateRef.current.set(deviceUuid, state);
    if (sendingLightRef.current.has(deviceUuid)) return;

    const sendNext = () => {
      const next = pendingLightStateRef.current.get(deviceUuid);
      if (!next) {
        sendingLightRef.current.delete(deviceUuid);
        return;
      }
      pendingLightStateRef.current.delete(deviceUuid);
      sendingLightRef.current.add(deviceUuid);

      setLightState(deviceUuid, next)
        .catch(err => console.error(`Error setting light ${deviceUuid}:`, err))
        .finally(() => { setTimeout(sendNext, 50); });
    };

    sendNext();
  }, []);

  // Master Brightness = "set every zone to this level" (there's no single
  // physical device behind Master — it's a convenience action over all 3).
  const apiSetMasterBrightness = useCallback((brightness: number) => {
    setLighting(s => ({
      ...s,
      brightness,
      zones: Object.fromEntries(ZONE_NAMES.map(zone => [zone, brightness])) as typeof s.zones,
    }));
    for (const zone of ZONE_NAMES) {
      const dev = ZONE_DEVICES[zone];
      if (dev) queueLightState(dev.uuid, { on: brightness > 0, brightness });
    }
  }, [queueLightState]);

  const apiSetZoneBrightness = useCallback((zone: string, brightness: number) => {
    setLighting(s => ({ ...s, zones: { ...s.zones, [zone]: brightness } }));
    const dev = ZONE_DEVICES[zone];
    if (dev) queueLightState(dev.uuid, { on: brightness > 0, brightness });
  }, [queueLightState]);

  // Shared color across the whole room (the UI has one color picker, not
  // per-zone) — fans out to every zone device, carrying each zone's current
  // brightness so a color change doesn't blast every light to full.
  const apiSetColor = useCallback((color: { r: number; g: number; b: number; w: number; hex: string }) => {
    setLighting(s => ({ ...s, color }));
    const current = lightingRef.current;
    for (const zone of ZONE_NAMES) {
      const dev = ZONE_DEVICES[zone];
      const brightness = (current.zones as Record<string, number>)[zone] ?? current.brightness;
      if (dev) queueLightState(dev.uuid, { on: true, brightness, color: color.hex });
    }
  }, [queueLightState]);

  const identifyZone = useCallback((zone: string) => {
    const dev = ZONE_DEVICES[zone];
    if (!dev) return;
    identifyLight(dev.uuid).catch(err => console.error(`Error identifying ${zone}:`, err));
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

  useEffect(() => {
    refreshLockState();
    const interval = setInterval(refreshLockState, 5_000);
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
          // Auto re-lock 2s after an unlock.
          autoLockTimerRef.current = setTimeout(() => {
            autoLockTimerRef.current = null;
            setSecurity({ locked: true });
            toggleDoorLock("locked").catch(() => refreshLockState());
          }, 2_000);
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

  // Global Quick Devices State
  const [globalPower, setGlobalPower] = useState({ ac: true, lights: true, audio: true });

  // Persistence
  useEffect(() => {
    setIsClient(true);
    const saved = localStorage.getItem("cms_environment6_panel") as PanelType;
    if (saved && ["climate", "lighting", "audio", "security"].includes(saved)) {
      setFocused(saved);
    }
  }, []);

  useEffect(() => {
    if (isClient && focused) localStorage.setItem("cms_environment6_panel", focused);
  }, [focused, isClient]);

  // Order
  const orderedContents = [focused, ...(["climate", "lighting", "audio", "security"] as PanelType[]).filter(x => x !== focused)];

  const renderContent = (type: PanelType, isExpanded: boolean) => {
    if (type === "climate") return <ClimateContent key="climate" isExpanded={isExpanded} state={climate} actions={{
      setTemp: (temp: number) => setClimate(s => ({ ...s, temp })),
      setMode: (mode: string) => setClimate(s => ({ ...s, mode })),
      setFan: (fan: number) => setClimate(s => ({ ...s, fan })),
      setPower: (power: boolean) => setClimate(s => ({ ...s, power })),
      setSwing: (swing: boolean) => setClimate(s => ({ ...s, swing })),
      setTurbo: (turbo: boolean) => setClimate(s => ({ ...s, turbo })),
      setTimer: (timer: string | null) => setClimate(s => ({ ...s, timer })),
      setFanSpeed: (fanSpeed: string) => setClimate(s => ({ ...s, fanSpeed })),
    }} />;
    if (type === "lighting") return <LightingContent key="lighting" isExpanded={isExpanded} state={lighting} globalPowerState={globalPower} globalPowerActions={{
      setAc: (ac: boolean) => setGlobalPower(s => ({ ...s, ac })),
      setLights: (lights: boolean) => setGlobalPower(s => ({ ...s, lights })),
      setAudio: (audio: boolean) => setGlobalPower(s => ({ ...s, audio })),
    }} actions={{
      setBrightness: apiSetMasterBrightness,
      setZoneBrightness: apiSetZoneBrightness,
      setActiveScene: (activeScene: string) => setLighting(s => ({ ...s, activeScene })),
      setColor: apiSetColor,
      setPower: (power: boolean) => setLighting(s => ({ ...s, power })),
      toggleColourPanel: () => { setFocused("lighting"); setShowColourPanel(s => !s); },
      identifyZone,
    }} />;
    if (type === "audio") return <AudioContent key="audio" isExpanded={isExpanded} state={audio} globalPowerState={globalPower} actions={{
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
    <div className="w-full h-full flex flex-col gap-6 overflow-hidden font-sans text-foreground pb-2">

      <div className="flex justify-between items-center shrink-0 pt-2 pb-0">
        <div>
          <h1 className="text-3xl font-black tracking-tight mb-1">Environment Control</h1>
          <p className="text-muted-foreground font-medium">Manage workspace climate, lighting, audio, and devices.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className={`rounded-xl font-bold tracking-widest text-xs uppercase ${tvOn ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20" : ""}`}
            onClick={toggleTv}
            disabled={tvBusy}
          >
            <Power className="w-3.5 h-3.5 mr-1.5" />
            TV {tvOn ? "On" : "Off"}
          </Button>
          <Button variant="outline" className="rounded-xl font-bold tracking-widest text-xs uppercase" onClick={() => setShow3D(true)}>
            3D
          </Button>
        </div>
      </div>

      <div
        className="flex-1 w-full grid gap-6 min-h-0"
        style={isDesktop
          ? { gridTemplateColumns: "68fr 32fr", gridTemplateRows: "1fr 1fr 1fr", gridTemplateAreas: '"primary top" "primary middle" "primary bottom"' }
          : { gridTemplateColumns: "1fr", gridTemplateRows: "auto auto auto auto", gridTemplateAreas: '"primary" "top" "middle" "bottom"' }
        }
      >
        {(["climate", "lighting", "audio", "security"] as PanelType[]).map((type) => {
          const isPrimary = type === focused;
          const role = isPrimary ? "primary" : (orderedContents[1] === type ? "top" : orderedContents[2] === type ? "middle" : "bottom");
          return (
            <motion.div
              key={type}
              layout
              initial={false}
              animate={{ zIndex: isPrimary ? 50 : 1 }}
              transition={cardLayoutTransition}
              style={{ gridArea: role, originX: 0.5, originY: 0.5, touchAction: "manipulation" }}
              className={`rounded-2xl border bg-card shadow-sm flex flex-col relative min-h-0 ${isPrimary ? "overflow-visible" : "overflow-hidden cursor-pointer hover:border-primary/50 transition-colors opacity-90 hover:opacity-100"}`}
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
                    ? "absolute inset-0 w-full h-full p-5 md:p-8 flex flex-col overflow-visible"
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-6"
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
              <LightColourContent state={lighting} actions={{ setColor: apiSetColor, closeColourPanel: () => setShowColourPanel(false) }} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {show3D && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 md:p-6"
            onClick={() => setShow3D(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 20, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.5 }}
              className="w-full max-w-5xl h-[85vh] rounded-3xl border border-border/50 overflow-hidden shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="absolute top-4 right-4 z-50 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                onClick={() => setShow3D(false)}
              >
                <X className="w-4 h-4" />
              </button>
              <ThreeDView />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
