"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@platform/ui";
import { EnvironmentView as ThreeDView } from "../../environment5/_components/environment-view";
import dynamic from "next/dynamic";
import { toggleDoorLock, getLiveLockState } from "@/actions/door-lock-actions";
import { setLightState, identifyLight, getLightState, type LightStateInput } from "@/actions/light-actions";
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
import { ZONE_DEVICES, ZONE_NAMES, zoneForDeviceId } from "@/lib/casambi-zones";
import { hexToRgb } from "./utils";

const ClimateContent = dynamic(() => import("./climate-content"), { ssr: false });
const LightingContent = dynamic(() => import("./lighting-content"), { ssr: false });
const AudioContent = dynamic(() => import("./audio-content"), { ssr: false });
const LightColourContent = dynamic(() => import("./light-colour-content"), { ssr: false });
const SecurityContent = dynamic(() => import("./security-content"), { ssr: false });
const IrRemotesContent = dynamic(() => import("./ir-remotes-content"), { ssr: false });

type PanelType = "climate" | "lighting" | "audio" | "security";

const cardLayoutTransition = { type: "spring", bounce: 0.14, duration: 0.9 } as any;

export function EnvironmentView() {
  const [focused, setFocused] = useState<PanelType>("climate");
  const [isClient, setIsClient] = useState(false);
  const [showColourPanel, setShowColourPanel] = useState(false);
  const [show3D, setShow3D] = useState(false);
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
    zones: { "Roof Lights": 64, "Wall Lights 1": 70, "Wall Lights 2": 74 },
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
            setAudio(s => ({ ...s, volume: msg.volume, muted: msg.muted, device: msg.device }));
          }
          if (msg.type === "LIGHT_STATE_UPDATE") {
            const zone = zoneForDeviceId(msg.deviceId);
            if (zone) {
              const nextBrightness = typeof msg.state?.brightness === "number" ? msg.state.brightness : undefined;
              const nextHex = typeof msg.state?.color === "string" ? msg.state.color : undefined;
              const nextOn = typeof msg.state?.on === "boolean" ? msg.state.on : undefined;
              setLighting(s => ({
                ...s,
                power: nextOn !== undefined ? (nextOn || Object.values({ ...s.zones, [zone]: nextBrightness ?? s.zones[zone as keyof typeof s.zones] }).some(b => b > 0)) : s.power,
                zones: nextBrightness === undefined ? s.zones : { ...s.zones, [zone]: nextBrightness },
                color: nextHex === undefined ? s.color : { ...s.color, ...hexToRgb(nextHex), hex: nextHex },
              }));
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

  // Per-device command queue → real Casambi lights (apps/api/src/services/casambi-driver.ts).
  // Same pending-ref coalescing as apiSetVolume above, keyed per device so the 3
  // zones (+ color, which fans out to all 3) don't block each other during drags.
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
  // per-zone) — fans out to all 3 zone devices, carrying each zone's current
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

  // Hydrate the Lighting panel from the registered Casambi devices' last-known persisted state.
  useEffect(() => {
    async function loadLightStates() {
      try {
        const results = await Promise.all(
          Object.entries(ZONE_DEVICES).map(async ([zone, dev]) => {
            try {
              const res = await getLightState(dev.uuid);
              return { zone, state: res.state };
            } catch {
              return null;
            }
          })
        );

        setLighting(s => {
          const nextZones = { ...s.zones };
          let nextColor = s.color;
          let lastBrightness: number | undefined = undefined;
          const validResults = results.filter((r): r is { zone: string; state: { on?: boolean; brightness?: number; color?: string } } => r !== null && r.state !== undefined);

          for (const item of validResults) {
            if (typeof item.state.brightness === "number") {
              nextZones[item.zone as keyof typeof s.zones] = item.state.brightness;
              lastBrightness = item.state.brightness;
            }
            if (typeof item.state.color === "string") {
              const rgb = hexToRgb(item.state.color);
              nextColor = { ...nextColor, ...rgb, hex: item.state.color };
            }
          }

          return {
            ...s,
            zones: nextZones,
            power: validResults.some(r => r.state.on) ? true : (validResults.length > 0 ? false : s.power),
            brightness: lastBrightness ?? s.brightness,
            color: nextColor,
          };
        });
      } catch (err) {
        console.error("Failed to load light states:", err);
      }
    }

    loadLightStates();
  }, []);

  // ── IR air-conditioner (CrabController bridge) ────────────────────────────
  // Per-command-family coalescing (same shape as queueLightState) so a held
  // temp +/- press collapses to the latest value instead of blasting the Tuya
  // cloud path, while power/mode/fan don't block each other.
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
    const saved = localStorage.getItem("cms_environment_panel") as PanelType;
    if (saved && ["climate", "lighting", "audio", "security"].includes(saved)) {
      setFocused(saved);
    }
  }, []);

  useEffect(() => {
    if (isClient && focused) localStorage.setItem("cms_environment_panel", focused);
  }, [focused, isClient]);

  // Order
  const orderedContents = [focused, ...(["climate", "lighting", "audio", "security"] as PanelType[]).filter(x => x !== focused)];

  const renderContent = (type: PanelType, isExpanded: boolean) => {
    if (type === "climate") return <ClimateContent key="climate" isExpanded={isExpanded} state={climate} actions={{
      // Wired to the real IR AC via the CrabController bridge (apps/api ir-driver).
      setTemp: acSetTempCmd,
      setMode: acSetModeCmd,
      setPower: acSetPowerCmd,
      setFanSpeed: acSetFanSpeedCmd,
      // Local-only: the Tuya AC "scene" command carries only power/mode/temp/fan,
      // so these have no bridge equivalent (can later map to raw codebook keys).
      setFan: (fan: number) => setClimate(s => ({ ...s, fan })),
      setSwing: (swing: boolean) => setClimate(s => ({ ...s, swing })),
      setTurbo: (turbo: boolean) => setClimate(s => ({ ...s, turbo })),
      setTimer: (timer: string | null) => setClimate(s => ({ ...s, timer })),
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
          {IR_REMOTES.length > 0 && (
            <Button variant="outline" className="rounded-xl font-bold tracking-widest text-xs uppercase" onClick={() => setShowRemotes(true)}>
              Remotes
            </Button>
          )}
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
              style={{ gridArea: role, originX: 0.5, originY: 0.5 }}
              className={`rounded-2xl border bg-card shadow-sm flex flex-col relative min-h-0 ${isPrimary ? "overflow-visible" : "overflow-hidden cursor-pointer hover:border-primary/50 transition-colors opacity-90 hover:opacity-100"}`}
              onClick={isPrimary ? undefined : () => setFocused(type)}
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
