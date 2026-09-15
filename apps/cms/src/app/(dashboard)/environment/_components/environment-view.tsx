"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@platform/ui";
import dynamic from "next/dynamic";
import { toggleDoorLock, getLiveLockState } from "@/actions/door-lock-actions";
import {
  setLightState,
  identifyLight,
  listLights,
  recallCasambiScene,
  type LightSummary,
} from "@/actions/light-actions";
import {
  acPower,
  acSetTemp,
  acSetMode,
  acSetFan,
  sendRemoteKey,
  getIrDeviceState,
} from "@/actions/ir-actions";
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
import {
  GROUP_ON_BRIGHTNESS,
  DEFAULT_GROUP_COLOR,
  SCENE_MODE_GROUPS,
  WARM_WHITE_HEX,
} from "@/lib/casambi-lights";
import { hexToRgb } from "./utils";
import { useSystemAudio } from "@/hooks/useSystemAudio";

const ClimateContent = dynamic(() => import("./climate-content"), {
  ssr: false,
});
const LightingContent = dynamic(() => import("./lighting-content"), {
  ssr: false,
});
const AudioContent = dynamic(() => import("./audio-content"), { ssr: false });
const LightColourContent = dynamic(() => import("./light-colour-content"), {
  ssr: false,
});
const SecurityContent = dynamic(() => import("./security-content"), {
  ssr: false,
});
const IrRemotesContent = dynamic(() => import("./ir-remotes-content"), {
  ssr: false,
});

type PanelType = "climate" | "lighting" | "audio" | "security";

// The panels this page renders, in fixed order. The grid below sizes itself
// from this list, so adding or removing a card needs no layout changes.
const PANELS: PanelType[] = ["climate", "lighting", "audio", "security"];

// Grid-area names for the non-focused cards, in the order they stack.
const SECONDARY_ROLES = ["top", "middle", "bottom"].slice(0, PANELS.length - 1);

const cardLayoutTransition = {
  type: "spring",
  bounce: 0.14,
  duration: 0.9,
} as any;

// How long the door stays unlocked before the UI re-locks it automatically.
const AUTO_RELOCK_MS = 5_000;
// Safety-net poll for the lock; the live path is the LOCK_STATE_UPDATE push.
const LOCK_POLL_FALLBACK_MS = 30_000;

export function EnvironmentView() {
  const [focused, setFocused] = useState<PanelType>("lighting");
  const [isClient, setIsClient] = useState(false);
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
  // Every registered Casambi fixture, read from the API rather than hardcoded —
  // the mesh has renumbered itself under a hardcoded list twice now.
  const [lights, setLights] = useState<LightSummary[]>([]);
  // Per-fixture on/off, keyed by device row uuid.
  const [lightOn, setLightOn] = useState<Record<string, boolean>>({});
  // Chosen colour per fixture. Not synced from LIGHT_STATE_UPDATE: a fixture in
  // white mode reports back something unrelated to what it was told, so the
  // swatch would show the hardware's version rather than the user's choice.
  const [lightColor, setLightColor] = useState<Record<string, string>>({});
  // Brightness per fixture, 0-100. Unlike colour this IS synced from the mesh:
  // the level readback is the one value this gateway reports reliably.
  const [lightBrightness, setLightBrightness] = useState<Record<string, number>>({});
  // Warm/colour mode per GROUP, held optimistically.
  //
  // The truth lives in each fixture's colorBalance, but that arrives on the
  // gateway's propertys poll which has been seen 30s+ behind. Driving the
  // toggle from it alone would leave the highlight lagging a visible age
  // behind the tap, so the toggle sets this immediately and the ingest's
  // reading reconciles it (see the card's fallback to inColourMode).
  const [groupMode, setGroupMode] = useState<Record<string, "warm" | "colour">>({});
  // Which fixtures the picker is editing, and what to call them.
  const [colourTarget, setColourTarget] = useState<{ uuids: string[]; label: string }>({ uuids: [], label: "" });
  const [showColourPanel, setShowColourPanel] = useState(false);
  // On/off only. The fixtures' White/Colour balance is not reachable over the
  // gateway's MQTT interface, so there is no colour state to keep here.
  // Volume/mute/device now come from the Redux store (useSystemAudio), shared
  // with the three other surfaces that show the same system audio. Only the
  // fields with no backend at all stay local — NAudio exposes volume and mute
  // and nothing else, so power/playing/input/treble are presentational.
  const [audio, setAudio] = useState({
    power: true,
    playing: true,
    input: "AUX",
    treble: 0,
  });
  const {
    volume,
    muted,
    device,
    setVolume: setSystemVolume,
    setMuted: setSystemMuted,
  } = useSystemAudio();

  // Live device state for the lighting, lock and IR-climate panels. Audio used
  // to be read here too, but it moved to the store's shared StoreSync — this
  // socket stays because the other three still need it.
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
          // AUDIO_STATUS_UPDATE is handled centrally by the store's StoreSync
          // (src/store/store-sync.tsx) so all four surfaces share one copy.
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
              // Ignore WS updates while commands are debounced, pending, or in-flight
              if (
                acDebounceTimersRef.current.size > 0 ||
                pendingAcRef.current.size > 0 ||
                sendingAcRef.current.size > 0
              ) {
                return;
              }
              const st = msg.state as {
                power?: boolean;
                temp?: number;
                mode?: string;
                fan?: string;
              };
              setClimate((s) => ({
                ...s,
                power: typeof st.power === "boolean" ? st.power : s.power,
                temp: typeof st.temp === "number" ? st.temp : s.temp,
                mode:
                  typeof st.mode === "string"
                    ? acModeFromBridge(st.mode)
                    : s.mode,
                fanSpeed:
                  typeof st.fan === "string"
                    ? acFanFromBridge(st.fan)
                    : s.fanSpeed,
              }));
            }
          }
          // Track on/off per fixture from what the mesh reports.
          if (msg.type === "LIGHT_STATE_UPDATE") {
            const on =
              typeof msg.state?.on === "boolean"
                ? msg.state.on
                : typeof msg.state?.brightness === "number"
                  ? msg.state.brightness > 0
                  : undefined;
            if (on !== undefined) {
              const hit = lightsRef.current.find(
                (r) => r.deviceId === msg.deviceId,
              );
              if (hit) {
                setLightOn((m) => ({ ...m, [hit.uuid]: on }));
                if (typeof msg.state?.brightness === "number") {
                  setLightBrightness((m) => ({
                    ...m,
                    [hit.uuid]: msg.state.brightness as number,
                  }));
                }
              }
            }
          }
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        if (!isDisposed) reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      isDisposed = true;
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  // Grouped on/off → both real Casambi drivers (apps/api/src/services/casambi-driver.ts).
  const lightPendingRef = useRef(false);
  // The WS handler must not re-subscribe every time the roster loads.
  const lightColorRef = useRef(lightColor);
  useEffect(() => { lightColorRef.current = lightColor; }, [lightColor]);
  const lightBrightnessRef = useRef(lightBrightness);
  useEffect(() => { lightBrightnessRef.current = lightBrightness; }, [lightBrightness]);
  const lightsRef = useRef(lights);
  useEffect(() => {
    lightsRef.current = lights;
  }, [lights]);

  /**
   * Push one fixture's state. Sent ONCE.
   *
   * This used to fire twice ~2s apart, added when commands appeared to be
   * getting lost. They were not: the CMS was addressing mesh unit ids that a
   * re-pairing had retired, so every command went to a unit that no longer
   * existed. Live units accept a single publish immediately. The retry only
   * made every light visibly trigger twice.
   */
  const pushLight = useCallback(
    (
      uuid: string,
      payload: { on: boolean; brightness?: number; color?: string },
    ) => {
      setLightState(uuid, payload).catch((err) =>
        console.error(`Error setting light ${uuid}:`, err),
      );
    },
    [],
  );

  /** Drive a set of fixtures with the same command — one fixture, a group, or all. */
  const setLightsPower = useCallback(
    (uuids: string[], on: boolean) => {
      if (lightPendingRef.current) return;
      lightPendingRef.current = true;
      setLightOn((m) => ({
        ...m,
        ...Object.fromEntries(uuids.map((u) => [u, on])),
      }));
      // No colour in the payload: the driver then sends target_level alone and
      // leaves whatever colour the fixture is already holding untouched.
      // Switching on restores the fixture's own last brightness rather than
      // slamming it to full.
      for (const uuid of uuids) {
        const level = lightBrightnessRef.current[uuid] ?? GROUP_ON_BRIGHTNESS;
        pushLight(
          uuid,
          on ? { on: true, brightness: level > 0 ? level : GROUP_ON_BRIGHTNESS } : { on: false },
        );
      }
      setTimeout(() => {
        lightPendingRef.current = false;
      }, 400);
    },
    [pushLight],
  );

  /**
   * Set a colour, putting the fixtures into colour mode first.
   *
   * A fixture sitting in white mode ignores RGB entirely, so sending a colour
   * on its own silently does nothing. The balance can only be moved by
   * recalling a Casambi scene, so that happens first and the colour follows
   * once it has settled.
   */
  const setLightsColor = useCallback(
    (uuids: string[], hex: string) => {
      setLightColor((m) => {
        const next = { ...m, ...Object.fromEntries(uuids.map((u) => [u, hex])) };
        try { localStorage.setItem("cms_light_colours", JSON.stringify(next)); } catch { /* private mode */ }
        return next;
      });
      setLightOn((m) => ({ ...m, ...Object.fromEntries(uuids.map((u) => [u, true])) }));

      // Sent directly. This used to recall the colour-mode scene first and wait
      // for it to settle, which added ~1.2s to every swatch tap; the mode
      // toggle now owns that transition, and a swatch is only tappable once the
      // fixture is already in colour mode.
      for (const uuid of uuids) {
        pushLight(uuid, { on: true, brightness: GROUP_ON_BRIGHTNESS, color: hex });
      }
    },
    [pushLight],
  );

  /** Warm white — recalls the scene that puts the fixtures back on their white LEDs. */
  /**
   * Switch a group between warm and colour.
   *
   * Scene-based groups recall a Casambi scene, which is the only thing that
   * moves their White/Colour balance. Note the scene is NETWORK-WIDE: it
   * applies to its own members, not to whatever fixtures the caller had in
   * mind. Recalling one on behalf of an RGB-only fixture is what previously
   * made the Strip Light's Warm button move the fabric panels, so only groups
   * declared in SCENE_MODE_GROUPS get here.
   *
   * RGB-only fixtures have no separate white source, so warm is just a colour
   * and goes out as a normal per-fixture command that cannot touch anything else.
   */
  const setLightsMode = useCallback(
    (groupName: string, uuids: string[], mode: "warm" | "colour") => {
      setLightOn((m) => ({ ...m, ...Object.fromEntries(uuids.map((u) => [u, true])) }));

      setGroupMode((m) => {
        const next = { ...m, [groupName]: mode };
        try { localStorage.setItem("cms_light_modes", JSON.stringify(next)); } catch { /* private mode */ }
        return next;
      });

      const scenes = SCENE_MODE_GROUPS[groupName];
      if (!scenes) {
        // Fallback for a fixture with no scenes of its own: approximate warm
        // with a warm-white colour, and restore the last chosen colour going
        // back. Every configured group is scene-based, so nothing hits this
        // today — but a newly added fixture stays usable until someone creates
        // its scene pair. Deliberately per-fixture: never borrow another
        // group's scene, which is what caused cross-talk before.
        const hex =
          mode === "warm"
            ? WARM_WHITE_HEX
            : (lightColorRef.current[uuids[0] ?? ""] ?? DEFAULT_GROUP_COLOR);
        for (const uuid of uuids) {
          pushLight(uuid, { on: true, brightness: GROUP_ON_BRIGHTNESS, color: hex });
        }
        return;
      }
      Promise.all((mode === "warm" ? scenes.warm : scenes.colour).map((n) => recallCasambiScene(n)))
        .catch((err) => console.error(`Failed to recall ${mode} scene for ${groupName}:`, err));
    },
    [pushLight],
  );

  /** Dim a set of fixtures. 0 turns them off; the switch reflects that. */
  const setLightsBrightness = useCallback((uuids: string[], value: number) => {
    const level = Math.max(0, Math.min(100, Math.round(value)));
    setLightBrightness((m) => ({ ...m, ...Object.fromEntries(uuids.map((u) => [u, level])) }));
    setLightOn((m) => ({ ...m, ...Object.fromEntries(uuids.map((u) => [u, level > 0])) }));
    for (const uuid of uuids) {
      pushLight(uuid, level > 0 ? { on: true, brightness: level } : { on: false });
    }
  }, [pushLight]);

  // Flash a group one fixture at a time, so a two-panel group is still
  // distinguishable rather than both blinking at once.
  const identifyLights = useCallback((uuids: string[]) => {
    uuids.forEach((uuid, i) => {
      setTimeout(() => {
        identifyLight(uuid).catch((err) =>
          console.error(`Error identifying light ${uuid}:`, err),
        );
      }, i * 4000);
    });
  }, []);

  // Load the fixture roster and seed on/off from what each row last reported.
  useEffect(() => {
    listLights()
      .then((rows) => {
        setLights(rows);
        setLightOn(
          Object.fromEntries(rows.map((r) => [r.uuid, r.state?.on === true])),
        );
        setLightBrightness(
          Object.fromEntries(
            rows.map((r) => [r.uuid, typeof r.state?.brightness === "number" ? r.state.brightness : 100]),
          ),
        );
        try {
          const savedModes = JSON.parse(localStorage.getItem("cms_light_modes") ?? "{}");
          if (savedModes && typeof savedModes === "object") setGroupMode(savedModes);
        } catch { /* ignore */ }
        let saved: Record<string, string> = {};
        try { saved = JSON.parse(localStorage.getItem("cms_light_colours") ?? "{}"); } catch { /* ignore */ }
        setLightColor(Object.fromEntries(rows.map((r) => [r.uuid, saved[r.uuid] ?? DEFAULT_GROUP_COLOR])));
      })
      .catch((err) => console.error("Failed to load lights:", err));
  }, []);

  // ── IR air-conditioner (Tuya cloud bridge) ────────────────────────────────
  // Per-command-family debouncing and coalescing so a held temp +/- press collapses
  // to the latest value instead of blasting the Tuya cloud path or spamming IR blasts,
  // while power/mode/fan don't block each other.
  const pendingAcRef = useRef<Map<string, () => Promise<unknown>>>(new Map());
  const sendingAcRef = useRef<Set<string>>(new Set());
  const acDebounceTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  const queueAcCommand = useCallback(
    (family: string, run: () => Promise<unknown>) => {
      if (!IR_AC_CONFIGURED) return; // still mock until a real device uuid is set

      const existingTimer = acDebounceTimersRef.current.get(family);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        acDebounceTimersRef.current.delete(family);
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
            .catch((err) => console.error(`Error sending AC ${family}:`, err))
            .finally(() => {
              setTimeout(sendNext, 50);
            });
        };
        sendNext();
      }, 200);

      acDebounceTimersRef.current.set(family, timer);
    },
    [],
  );

  const acSetPowerCmd = useCallback(
    (power: boolean) => {
      setClimate((s) => ({ ...s, power }));
      queueAcCommand("power", () => acPower(IR_AC.uuid, power));
    },
    [queueAcCommand],
  );

  // set_* commands turn the AC on bridge-side, so reflect that optimistically.
  const acSetTempCmd = useCallback(
    (temp: number) => {
      setClimate((s) => ({ ...s, temp, power: true }));
      queueAcCommand("temp", () => acSetTemp(IR_AC.uuid, temp));
    },
    [queueAcCommand],
  );

  const acSetModeCmd = useCallback(
    (mode: string) => {
      setClimate((s) => ({ ...s, mode, power: true }));
      queueAcCommand("mode", () => acSetMode(IR_AC.uuid, acModeToBridge(mode)));
    },
    [queueAcCommand],
  );

  const acSetFanSpeedCmd = useCallback(
    (fanSpeed: string) => {
      setClimate((s) => ({ ...s, fanSpeed, power: true }));
      queueAcCommand("fan", () =>
        acSetFan(IR_AC.uuid, acFanToBridge(fanSpeed)),
      );
    },
    [queueAcCommand],
  );

  const handleRemoteKey = useCallback((deviceUuid: string, key: string) => {
    sendRemoteKey(deviceUuid, key).catch((err) =>
      console.error(`Error sending IR key ${key}:`, err),
    );
  }, []);

  // Hydrate the Climate panel from the AC's last-known persisted state, so a
  // reload reflects reality instead of the hardcoded mock defaults.
  useEffect(() => {
    if (!IR_AC_CONFIGURED) return;
    getIrDeviceState(IR_AC.uuid)
      .then((dev) => {
        const st = dev?.state as
          | { power?: boolean; temp?: number; mode?: string; fan?: string }
          | undefined;
        if (!st) return;
        setClimate((s) => ({
          ...s,
          power: typeof st.power === "boolean" ? st.power : s.power,
          temp: typeof st.temp === "number" ? st.temp : s.temp,
          mode:
            typeof st.mode === "string" ? acModeFromBridge(st.mode) : s.mode,
          fanSpeed:
            typeof st.fan === "string" ? acFanFromBridge(st.fan) : s.fanSpeed,
        }));
      })
      .catch((err) => console.error("Failed to load AC state:", err));
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

  const setLocked = useCallback(
    (locked: boolean) => {
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
        .finally(() => {
          lockPendingRef.current = false;
        });
    },
    [refreshLockState],
  );

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
    if (isClient && focused)
      localStorage.setItem("cms_environment_panel", focused);
  }, [focused, isClient]);

  // Order
  const orderedContents = [focused, ...PANELS.filter((x) => x !== focused)];

  const renderContent = (type: PanelType, isExpanded: boolean) => {
    if (type === "climate")
      return (
        <ClimateContent
          key="climate"
          isExpanded={isExpanded}
          state={climate}
          actions={{
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
            setFan: (fan: number) => setClimate((s) => ({ ...s, fan })),
            setSwing: (swing: boolean) => setClimate((s) => ({ ...s, swing })),
            setTurbo: (turbo: boolean) => setClimate((s) => ({ ...s, turbo })),
            setTimer: (timer: string | null) =>
              setClimate((s) => ({ ...s, timer })),
          }}
        />
      );
    if (type === "lighting")
      return (
        <LightingContent
          key="lighting"
          isExpanded={isExpanded}
          state={{ lights, on: lightOn, colors: lightColor, brightness: lightBrightness, modes: groupMode }}
          actions={{
            setPower: setLightsPower,
            setBrightness: setLightsBrightness,
            setColor: setLightsColor,
            setMode: setLightsMode,
            identify: identifyLights,
            openColourPanel: (uuids: string[], label: string) => { setFocused("lighting"); setColourTarget({ uuids, label }); setShowColourPanel(true); },
          }}
        />
      );
    if (type === "audio")
      return (
        <AudioContent
          key="audio"
          isExpanded={isExpanded}
          state={{ ...audio, volume, muted, device }}
          actions={{
            setPlaying: (playing: boolean) =>
              setAudio((s) => ({ ...s, playing })),
            setVolume: setSystemVolume,
            setMuted: setSystemMuted,
            setInput: (input: string) => setAudio((s) => ({ ...s, input })),
            setPower: (power: boolean) => setAudio((s) => ({ ...s, power })),
            setTreble: (treble: number) => setAudio((s) => ({ ...s, treble })),
          }}
        />
      );
    if (type === "security")
      return (
        <SecurityContent
          key="security"
          isExpanded={isExpanded}
          state={security}
          actions={{
            setLocked,
          }}
        />
      );
    return null;
  };

  if (!isClient) return null;

  return (
    <div className="w-full h-full flex flex-col gap-4 sm:gap-6 overflow-y-auto lg:overflow-hidden font-sans text-foreground pb-2">
      <h1 className="shrink-0 text-3xl font-black tracking-tight pt-2">
        Environment
      </h1>

      <div
        className="flex-1 w-full grid gap-6 min-h-0"
        // Sized from PANELS so hiding or restoring a card leaves no empty cell:
        // one tall "primary" beside a stack of the remaining secondary slots.
        style={
          isDesktop
            ? {
                gridTemplateColumns: "68fr 32fr",
                gridTemplateRows: SECONDARY_ROLES.map(() => "1fr").join(" "),
                gridTemplateAreas: SECONDARY_ROLES.map(
                  (r) => `"primary ${r}"`,
                ).join(" "),
              }
            : {
                gridTemplateColumns: "1fr",
                gridTemplateRows: PANELS.map(() => "auto").join(" "),
                gridTemplateAreas: [
                  '"primary"',
                  ...SECONDARY_ROLES.map((r) => `"${r}"`),
                ].join(" "),
              }
        }
      >
        {PANELS.map((type) => {
          const isPrimary = type === focused;
          const role = isPrimary
            ? "primary"
            : SECONDARY_ROLES[orderedContents.indexOf(type) - 1]!;
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
                  animate={{
                    opacity: 1,
                    scale: 1,
                    transition: { duration: 0.4, delay: 0.1 },
                  }}
                  exit={{
                    opacity: 0,
                    scale: 0.95,
                    transition: { duration: 0.2 },
                  }}
                  className={
                    isPrimary
                      ? "absolute inset-0 w-full h-full p-4 sm:p-5 md:p-8 flex flex-col overflow-y-auto lg:overflow-hidden"
                      : "absolute inset-0 w-full h-full p-3 md:p-4 flex flex-col justify-center overflow-hidden"
                  }
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
                state={{
                  color: (() => {
                    const hex = lightColor[colourTarget.uuids[0] ?? ""] ?? DEFAULT_GROUP_COLOR;
                    return { ...hexToRgb(hex), hex };
                  })(),
                  targetLabel: colourTarget.label || "Light",
                }}
                actions={{
                  setColor: (c: { hex: string }) => setLightsColor(colourTarget.uuids, c.hex),
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-6"
            onClick={() => setShowRemotes(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 20, opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.5 }}
              className="w-full max-w-3xl rounded-3xl border border-border/50 bg-card shadow-2xl p-6 md:p-8 relative overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute top-6 right-6 z-50">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full hover:bg-muted"
                  onClick={() => setShowRemotes(false)}
                >
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
