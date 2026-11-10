"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Plane, CloudSun, Users, Check, Loader2, Play, Wand2 } from "lucide-react";
import { sendRemoteCommand } from "@/actions/screen-actions";
import { updateExperienceTemplateContent } from "@/actions/experience-actions";
import {
  ART_CATALOG,
  DEFAULT_ART_ID,
  DEFAULT_FLIGHT_SIMULATION_CONTENT,
  readFlightSimulationContent,
  type DataSource,
  type FlightSimulationContent,
} from "@platform/ui/templates/flight-simulation";

export interface DataArtControlPanelProps {
  screenId: string;
  experienceId?: string | null;
  /**
   * The live experience's whole templateContent record. Two jobs: it opens the
   * panel on what the wall is ACTUALLY showing rather than the defaults, and it
   * is spread back on save — the API replaces a template's slice wholesale
   * (mergeExperienceTemplateContent), so writing only the two fields here would
   * silently reset the airport, tower label, HUD toggles and speed authored in
   * the editor tab.
   */
  templateContent?: Record<string, unknown>;
}

/** Display metadata for the three scenes. Ids match the SCENES keys in flight-garden.js. */
const DATA_SOURCE_CARDS: {
  id: DataSource;
  name: string;
  subtitle: string;
  icon: typeof Plane;
  badge: string;
}[] = [
  {
    id: "flight",
    name: "Flight Garden",
    subtitle: "Butterflies as live air traffic",
    icon: Plane,
    badge: "Live Flights",
  },
  {
    id: "weather",
    name: "Weather Garden",
    subtitle: "Temperature & wind dynamics",
    icon: CloudSun,
    badge: "Climate Data",
  },
  {
    id: "attendance",
    name: "Attendance Art",
    subtitle: "Presence & space utilization",
    icon: Users,
    badge: "Live Occupancy",
  },
];

export function DataArtControlPanel({
  screenId,
  experienceId,
  templateContent,
}: DataArtControlPanelProps) {
  // The authored slice, coerced. Never null: readFlightSimulationContent
  // returns null only when the slice is missing, which is a brand-new
  // experience — the defaults are the right answer there.
  const authored: FlightSimulationContent = useMemo(
    () => readFlightSimulationContent(templateContent) ?? DEFAULT_FLIGHT_SIMULATION_CONTENT,
    [templateContent]
  );

  const [dataSource, setDataSource] = useState<DataSource>(authored.dataSource);
  const [artId, setArtId] = useState(authored.artId);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Art ids whose MP4 is actually in the R2 allowlist. null = not yet known. */
  const [availableIds, setAvailableIds] = useState<Set<string> | null>(null);

  // Follow the wall: a push from another tab, or an operator touching the HUD
  // through the mirror, arrives here as a new templateContent.
  useEffect(() => {
    setDataSource(authored.dataSource);
    setArtId(authored.artId);
  }, [authored]);

  // Which renders have actually landed in the bucket. Until this resolves every
  // tile stays enabled — a slow fetch must not lock the operator out.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/flight-simulation/arts");
        if (!res.ok) return;
        const body = (await res.json()) as {
          data?: { id: string; available?: boolean }[];
        };
        if (cancelled || !body.data) return;
        setAvailableIds(new Set(body.data.filter((a) => a.available).map((a) => a.id)));
      } catch {
        // Offline or the API is down: leave every tile enabled rather than
        // greying out the whole catalog on a transient failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isAvailable = useCallback(
    (id: string) => availableIds === null || availableIds.has(id),
    [availableIds]
  );

  /**
   * Both axes go out together as one absolute view — SET_FLIGHT_VIEW is
   * echoed back by the gateway, so a partial payload would let the echo
   * overwrite whichever half was omitted.
   */
  const push = (next: { dataSource: DataSource; artId: string }) => {
    setSavedSuccess(false);
    setSaveError(null);
    void sendRemoteCommand(screenId, "SET_FLIGHT_VIEW", {
      sceneId: next.dataSource,
      artId: next.artId,
    });
  };

  const handleSelectDataSource = (id: DataSource) => {
    setDataSource(id);
    push({ dataSource: id, artId });
  };

  const handleSelectArt = (id: string) => {
    if (!isAvailable(id)) return;
    setArtId(id);
    push({ dataSource, artId: id });
  };

  const handleGenerate = async () => {
    if (!experienceId) return;
    setSaving(true);
    setSavedSuccess(false);
    setSaveError(null);
    try {
      const res = await updateExperienceTemplateContent(experienceId, "flight-simulation", {
        ...authored,
        dataSource,
        artId,
      });
      if (res.success) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      } else {
        setSaveError(res.error ?? "Failed to save.");
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const selectedArt = ART_CATALOG.find((a) => a.id === artId) ?? ART_CATALOG[0];
  // Relative on purpose: nginx routes /api/ to the API container, and the route
  // 302s to a freshly presigned R2 URL on every load, so expiry and range
  // requests take care of themselves.
  const videoPreviewUrl = `/api/flight-simulation/garden-video?id=${encodeURIComponent(artId)}`;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto p-1">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
            <Sparkles className="h-5 w-5 text-purple-500" /> DATA ART Control Panel
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Pick the data to map, and the art to map it onto.
          </p>
        </div>

        {experienceId && (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleGenerate}
              disabled={saving}
              title="Save this pair as the portfolio item's default, so a screen reboot comes back to it"
              className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-lg transition-all hover:bg-purple-500 active:scale-95 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : savedSuccess ? (
                <Check className="h-4 w-4 text-green-300" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {saving ? "Generating…" : savedSuccess ? "Generated & Saved!" : "Generate"}
            </button>
            {saveError && (
              <span className="text-[10px] text-red-500 dark:text-red-400">{saveError}</span>
            )}
          </div>
        )}
      </div>

      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: DATA source */}
        <div className="flex flex-col gap-3 lg:col-span-3">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            1. Select DATA Source
          </div>
          <div className="flex flex-col gap-2.5">
            {DATA_SOURCE_CARDS.map((src) => {
              const Icon = src.icon;
              const isSelected = dataSource === src.id;
              return (
                <button
                  key={src.id}
                  onClick={() => handleSelectDataSource(src.id)}
                  className={`group relative flex flex-col gap-1 rounded-2xl p-4 text-left transition-all ${
                    isSelected
                      ? "border-2 border-purple-500 bg-purple-500/10 shadow-md dark:bg-purple-950/20"
                      : "border border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`rounded-xl p-2 transition-colors ${
                          isSelected
                            ? "bg-purple-500 text-white"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        {src.name}
                      </span>
                    </div>
                    {isSelected && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-500 text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{src.subtitle}</p>
                  <span className="mt-2 self-start rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {src.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Centre: preview of the render itself (a flat clip, not a second WebGL context) */}
        <div className="flex flex-col gap-3 lg:col-span-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Video Preview
            </span>
            <span className="rounded-full bg-purple-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
              {selectedArt?.label}
            </span>
          </div>

          <div className="relative aspect-video w-full overflow-hidden rounded-2xl border-2 border-purple-500/30 bg-black shadow-2xl">
            <video
              key={artId}
              src={videoPreviewUrl}
              autoPlay
              loop
              muted
              playsInline
              className="h-full w-full object-cover"
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">
                  Data Stream
                </span>
                <span className="text-xs font-semibold text-white">
                  {DATA_SOURCE_CARDS.find((d) => d.id === dataSource)?.name}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">
                  Art Output
                </span>
                <span className="text-xs font-semibold text-white">{selectedArt?.label}</span>
              </div>
            </div>
          </div>

          <p className="text-center text-[11px] italic text-zinc-500 dark:text-zinc-400">
            Every change goes to the wall immediately. Generate saves it as the default.
          </p>
        </div>

        {/* Right: ART catalog */}
        <div className="flex flex-col gap-3 lg:col-span-4">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            2. Select ART Style
          </div>
          <div className="flex max-h-[380px] flex-col gap-2 overflow-y-auto pr-1">
            {ART_CATALOG.map((art) => {
              const isSelected = artId === art.id;
              const available = isAvailable(art.id);
              return (
                <button
                  key={art.id}
                  onClick={() => handleSelectArt(art.id)}
                  disabled={!available}
                  title={available ? art.blurb : "This render has not been uploaded to R2 yet"}
                  className={`group relative flex items-center justify-between rounded-xl p-3 text-left transition-all ${
                    !available
                      ? "cursor-not-allowed border border-dashed border-zinc-200 bg-zinc-50 opacity-50 dark:border-zinc-800 dark:bg-zinc-900/30"
                      : isSelected
                        ? "border-2 border-purple-500 bg-purple-500/10 shadow-md dark:bg-purple-950/20"
                        : "border border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700"
                  }`}
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        {art.label}
                      </span>
                      {art.id === DEFAULT_ART_ID && (
                        <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          Hero Default
                        </span>
                      )}
                      {!available && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                          Not uploaded
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {art.blurb}
                    </span>
                  </div>

                  {isSelected ? (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500 text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : (
                    <Play className="h-3.5 w-3.5 shrink-0 text-zinc-400 opacity-0 group-hover:opacity-100" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
