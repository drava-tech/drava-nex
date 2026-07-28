"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Check } from "lucide-react";
import type { Experience } from "@platform/db";
import { updateExperienceTemplateContent } from "@/actions/experience-actions";
import {
  DEFAULT_FLIGHT_SIMULATION_CONTENT,
  FlightSimulationRenderer,
  useFlightData,
  type FlightSimulationContent,
} from "@platform/ui/templates/flight-simulation";

const FIELD_CLASS =
  "w-full rounded-md border border-zinc-300 bg-zinc-100 px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

const SECTION_CLASS =
  "text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400";

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-violet-500"
      />
      <span className="min-w-0">
        <span className="block text-sm text-zinc-800 dark:text-zinc-200">{label}</span>
        <span className="block text-[11px] text-zinc-400">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Full-tab editor for the Flight Simulation template. The fields are pacing and
 * chrome only — flight data comes from the API at render time, so there is no
 * content to author here beyond how the garden presents itself.
 */
export function FlightSimulationEditorWorkspace({
  experience,
  initialContent,
}: {
  experience: Experience;
  initialContent: FlightSimulationContent;
}) {
  const router = useRouter();
  const [content, setContent] = useState<FlightSimulationContent>({
    ...DEFAULT_FLIGHT_SIMULATION_CONTENT,
    ...initialContent,
  });
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The airport list is the API's catalog, so the editor can never offer an
  // airport the simulation doesn't actually have. Polling is off here — the
  // editor only needs the catalog, not a live board.
  const { catalog } = useFlightData({
    airportCode: content.airportCode,
    refreshIntervalSeconds: 0,
  });
  const airportChoices = catalog?.airports ?? [];

  const update = (patch: Partial<FlightSimulationContent>) => {
    setSaved(false);
    setContent((c) => ({ ...c, ...patch }));
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateExperienceTemplateContent(
        experience.id,
        "flight-simulation",
        content
      );
      if (res.success) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? "Failed to save.");
      }
    });
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-100 dark:bg-zinc-950">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/experiences"
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Back to experiences"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {experience.name}
            </p>
            <p className="text-[11px] text-zinc-400">Flight Simulation</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/preview/experiences/${experience.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View
          </a>
          <button
            onClick={save}
            disabled={isPending}
            className="flex min-w-[84px] items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saved ? (
              <Check className="h-3.5 w-3.5" />
            ) : null}
            {isPending ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[400px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col gap-3">
            <h2 className={SECTION_CLASS}>Airport</h2>
            <select
              value={content.airportCode}
              onChange={(e) => update({ airportCode: e.target.value })}
              className={FIELD_CLASS}
              disabled={!airportChoices.length}
            >
              {airportChoices.length ? (
                airportChoices.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.full}
                  </option>
                ))
              ) : (
                <option value={content.airportCode}>{content.airportCode}</option>
              )}
            </select>
            {!airportChoices.length && (
              <p className="text-[11px] text-amber-600 dark:text-amber-500">
                Airport list unavailable — the API isn&apos;t reachable. The saved
                airport is kept.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h2 className={SECTION_CLASS}>Tower label (optional)</h2>
            <input
              type="text"
              value={content.label}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="BLR Garden Tower"
              className={FIELD_CLASS}
            />
            <p className="text-[11px] text-zinc-400">
              Leave blank to use the airport&apos;s own tower name.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className={SECTION_CLASS}>Display</h2>
            <Toggle
              label="Show HUD"
              hint="Tower panel, live counters, legend and flight detail."
              checked={content.showHud}
              onChange={(v) => update({ showHud: v })}
            />
            <Toggle
              label="Allow airport switching"
              hint="Shows the airport picker. Turn off for unattended screens."
              checked={content.allowAirportSwitching}
              onChange={(v) => update({ allowAirportSwitching: v })}
            />
          </div>

          <div className="flex flex-col gap-3">
            <h2 className={SECTION_CLASS}>
              Simulation speed · {content.simulationSpeed.toFixed(2)}×
            </h2>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={content.simulationSpeed}
              onChange={(e) => update({ simulationSpeed: Number(e.target.value) })}
              className="w-full accent-violet-500"
            />
            <p className="text-[11px] text-zinc-400">
              Scales how busy the airspace feels. Flight count stays gate-driven.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className={SECTION_CLASS}>Flight data refresh</h2>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={3600}
                step={10}
                value={content.refreshIntervalSeconds}
                onChange={(e) =>
                  update({ refreshIntervalSeconds: Number(e.target.value) })
                }
                className={FIELD_CLASS}
              />
              <span className="shrink-0 text-xs text-zinc-400">seconds</span>
            </div>
            <p className="text-[11px] text-zinc-400">
              How often to pull a fresh flight board from the API. 0 disables polling.
            </p>
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </aside>

        <main className="min-w-0 flex-1 bg-zinc-200 p-6 dark:bg-zinc-900/40">
          {/*
            A live 16:9 instance of the real scene. Keyed on the options that
            can't be applied through the engine handle, so toggling the HUD
            rebuilds it while changing airport or speed does not — remounting
            WebGL on every keystroke would re-download ~37MB of geometry.
          */}
          <div className="aspect-video w-full overflow-hidden rounded-xl border border-zinc-300 bg-[#05070a] dark:border-zinc-700">
            <FlightSimulationRenderer
              key={`${content.showHud}-${content.allowAirportSwitching}-${content.label}`}
              content={content}
              live={false}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
