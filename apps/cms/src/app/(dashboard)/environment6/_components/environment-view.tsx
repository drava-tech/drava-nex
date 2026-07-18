"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@platform/ui";
import { EnvironmentView as ThreeDView } from "../../environment5/_components/environment-view";
import dynamic from "next/dynamic";

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
  const [audio, setAudio] = useState({ power: true, playing: true, volume: 45, muted: false, input: "HDMI", bass: 0, treble: 0 });
  const [security, setSecurity] = useState({ locked: true });

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
      setBrightness: (brightness: number) => setLighting(s => ({ ...s, brightness })),
      setZoneBrightness: (zone: string, brightness: number) => setLighting(s => ({ ...s, zones: { ...s.zones, [zone]: brightness } })),
      setActiveScene: (activeScene: string) => setLighting(s => ({ ...s, activeScene })),
      setColor: (color: any) => setLighting(s => ({ ...s, color })),
      setPower: (power: boolean) => setLighting(s => ({ ...s, power })),
      toggleColourPanel: () => { setFocused("lighting"); setShowColourPanel(s => !s); },
    }} />;
    if (type === "audio") return <AudioContent key="audio" isExpanded={isExpanded} state={audio} globalPowerState={globalPower} actions={{
      setPlaying: (playing: boolean) => setAudio(s => ({ ...s, playing })),
      setVolume: (volume: number) => setAudio(s => ({ ...s, volume })),
      setMuted: (muted: boolean) => setAudio(s => ({ ...s, muted })),
      setInput: (input: string) => setAudio(s => ({ ...s, input })),
      setPower: (power: boolean) => setAudio(s => ({ ...s, power })),
      setBass: (bass: number) => setAudio(s => ({ ...s, bass })),
      setTreble: (treble: number) => setAudio(s => ({ ...s, treble })),
    }} />;
    if (type === "security") return <SecurityContent key="security" isExpanded={isExpanded} state={security} actions={{
      setLocked: (locked: boolean) => setSecurity(s => ({ ...s, locked }))
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
        <Button variant="outline" className="rounded-xl font-bold tracking-widest text-xs uppercase" onClick={() => setShow3D(true)}>
          3D
        </Button>
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
              <LightColourContent state={lighting} actions={{ setColor: (color: any) => setLighting(s => ({ ...s, color })), closeColourPanel: () => setShowColourPanel(false) }} />
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
