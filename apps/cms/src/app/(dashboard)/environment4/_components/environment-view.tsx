"use client";

import React, { useState } from "react";
import { Music, Lightbulb, Snowflake, LayoutGrid } from "lucide-react";
import { cn } from "@platform/ui";
import { AcCard, type AcState } from "./ac-card";
import { SpeakerCard, type SpeakerState } from "./speaker-card";
import { LightCard, type Light } from "./light-card";
import { Segmented } from "./controls";

const GROUP_COLOR = "#6366f1"; // indigo — group accent
const WARM_COLOR = "#fbbf24"; // shared warm-white accent for non-RGB lights

const INITIAL_LIGHTS: Light[] = [
  { id: "strip1", name: "Strip 1", color: "#a78bfa", on: true, brightness: 75, rgb: true }, // RGB
  { id: "strip2", name: "Strip 2", color: "#22d3ee", on: true, brightness: 60, rgb: true }, // RGB
  { id: "ceiling", name: "Ceiling", color: WARM_COLOR, on: true, brightness: 80 }, // warm white
  { id: "bar", name: "Bar Light", color: WARM_COLOR, on: false, brightness: 50 }, // warm white
];

type LightsView = "group" | "individual";

export function EnvironmentView() {
  const [speaker, setSpeaker] = useState<SpeakerState>({ on: true, volume: 65, muted: false });
  const [lights, setLights] = useState<Light[]>(INITIAL_LIGHTS);
  const [ac, setAc] = useState<AcState>({ on: true, temp: 22, mode: "Cool" });
  const [lightsView, setLightsView] = useState<LightsView>("group");

  const update =
    <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
    (next: Partial<T>) =>
      setter((prev) => ({ ...prev, ...next }));

  const updateLight = (id: string, next: Partial<Light>) =>
    setLights((prev) => prev.map((l) => (l.id === id ? { ...l, ...next } : l)));

  const toggleAll = (on: boolean) => setLights((prev) => prev.map((l) => ({ ...l, on })));

  const brightnessAll = (value: number) =>
    setLights((prev) => prev.map((l) => (l.on ? { ...l, brightness: value } : l)));

  const onCount = lights.filter((l) => l.on).length;
  const anyOn = onCount > 0;
  const groupBrightness = anyOn
    ? Math.round(lights.filter((l) => l.on).reduce((sum, l) => sum + l.brightness, 0) / onCount)
    : 0;

  const pills: { icon: typeof Music; label: string; tint: string }[] = [
    {
      icon: Music,
      label: speaker.on ? (speaker.muted ? "Speaker Muted" : `Speaker ${speaker.volume}%`) : "Speaker Off",
      tint: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    },
    {
      icon: Lightbulb,
      label: onCount > 0 ? `Lights ${onCount} on` : "Lights Off",
      tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
    {
      icon: Snowflake,
      label: ac.on ? `AC ${ac.temp}°C` : "AC Off",
      tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Environment</h1>
          <p className="text-sm text-muted-foreground">Control your room devices</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pills.map((p) => (
            <span
              key={p.label}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                p.tint
              )}
            >
              <p.icon className="h-3.5 w-3.5" />
              {p.label}
            </span>
          ))}
        </div>
      </div>

      {/* Two columns: Lights (left) · Climate & Audio (right) */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left — Lights panel with Group | Individual views */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">Lights</h2>
            <Segmented<LightsView>
              value={lightsView}
              onChange={setLightsView}
              options={[
                { value: "group", label: "Group" },
                { value: "individual", label: "Individual" },
              ]}
            />
          </div>

          {lightsView === "group" ? (
            <div className="flex flex-col gap-3">
              <LightCard
                icon={LayoutGrid}
                name="Living Room"
                subtitle="All lights"
                color={GROUP_COLOR}
                on={anyOn}
                brightness={groupBrightness}
                onToggle={toggleAll}
                onBrightness={brightnessAll}
                secondary={
                  <span className="tabular-nums">
                    {onCount}/{lights.length} on
                  </span>
                }
              />
              {/* member summary */}
              <div className="flex flex-wrap gap-2">
                {lights.map((l) => (
                  <span
                    key={l.id}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: l.on ? l.color : "var(--muted-foreground)" }}
                    />
                    <span className={cn(!l.on && "text-muted-foreground")}>{l.name}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {lights.map((light) => (
                <LightCard
                  key={light.id}
                  icon={Lightbulb}
                  name={light.name}
                  subtitle={light.rgb ? "RGB strip" : "White"}
                  color={light.color}
                  on={light.on}
                  brightness={light.brightness}
                  rgb={light.rgb}
                  onToggle={(v) => updateLight(light.id, { on: v })}
                  onBrightness={(v) => updateLight(light.id, { brightness: v })}
                  onColor={(hex) => updateLight(light.id, { color: hex })}
                />
              ))}
            </div>
          )}
        </section>

        {/* Right — AC + Speaker stacked */}
        <div className="flex flex-col gap-4">
          <AcCard state={ac} onChange={update(setAc)} />
          <SpeakerCard state={speaker} onChange={update(setSpeaker)} />
        </div>
      </div>
    </div>
  );
}
