import React from "react";
import { Lightbulb, Pipette } from "lucide-react";
import { Badge } from "@platform/ui";
import { Switch } from "./controls";
import { LIGHT_PRESETS } from "@/lib/casambi-lights";

/**
 * Both Casambi drivers are driven as a single group — one switch and one
 * colour, never per-fixture, since the pair is meant to look identical.
 * `setPower` and `setColor` both fan out to the two drivers (see
 * environment-view's apiSetGroupPower / apiSetGroupColor). No brightness
 * control by design.
 */
export default function LightingContent({ isExpanded, state, actions }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className={`flex justify-between items-start shrink-0 ${isExpanded ? "mb-4" : "mb-2"}`}>
        <div className="flex items-center gap-2">
          <div className={`${isExpanded ? "w-8 h-8" : "w-7 h-7"} rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0`}>
            <Lightbulb className={isExpanded ? "w-4 h-4" : "w-3.5 h-3.5"} />
          </div>
          <h3 className={`${isExpanded ? "text-lg" : "text-base"} font-semibold tracking-tight flex items-center gap-2`}>
            Lighting
            {isExpanded && (
              <button
                type="button"
                title="Pick a custom colour"
                className="w-[13px] h-[13px] rounded-full hover:scale-125 transition-transform cursor-pointer shadow-[0_0_8px_rgba(0,0,0,0.5)] border border-black/10 dark:border-white/20"
                style={{ backgroundColor: state.color }}
                onClick={(e) => { e.stopPropagation(); actions.openColourPanel?.(); }}
              />
            )}
          </h3>
        </div>
        <div className={`flex items-center ${isExpanded ? "gap-3" : "gap-2"}`}>
          <Badge variant="secondary" className={`${isExpanded ? "" : "hidden xl:inline-flex"} border-0 bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-slate-300 shadow-none font-bold uppercase text-[10px] tracking-widest`}>{state.on ? "On" : "Off"}</Badge>
          <Switch checked={state.on} onChange={actions.setPower} />
        </div>
      </div>

      {!isExpanded ? (
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <span className="text-3xl font-black md:text-[2rem] leading-none">{state.on ? "On" : "Off"}</span>
          <span className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">2 Drivers</span>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 min-h-0">
          <button
            type="button"
            aria-pressed={state.on}
            onClick={() => actions.setPower(!state.on)}
            className={`flex h-28 w-28 items-center justify-center rounded-full border-2 transition-all duration-300 md:h-32 md:w-32 ${
              state.on
                ? "border-primary bg-primary/10 text-primary shadow-[0_0_40px_-8px] shadow-primary/50"
                : "border-border bg-transparent text-muted-foreground hover:border-primary/50"
            }`}
          >
            <Lightbulb className="h-10 w-10 md:h-12 md:w-12" />
          </button>
          <div className="text-center">
            <p className="text-sm font-black uppercase tracking-widest">{state.on ? "On" : "Off"}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              DALI RGB/White + Stretch Fabric
            </p>
          </div>

          <div className="w-full max-w-sm">
            <span className="mb-2 block text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Colour
            </span>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {LIGHT_PRESETS.map((p) => {
                const active = state.color?.toUpperCase() === p.hex.toUpperCase();
                return (
                  <button
                    key={p.hex}
                    type="button"
                    title={p.name}
                    aria-label={p.name}
                    aria-pressed={active}
                    onClick={(e) => { e.stopPropagation(); actions.setColor?.(p.hex); }}
                    className={`h-7 w-7 rounded-full border transition-transform hover:scale-110 ${
                      active
                        ? "border-primary ring-2 ring-primary/50 scale-110"
                        : "border-black/10 dark:border-white/20"
                    }`}
                    style={{ backgroundColor: p.hex }}
                  />
                );
              })}
              <button
                type="button"
                title="Custom colour"
                aria-label="Custom colour"
                onClick={(e) => { e.stopPropagation(); actions.openColourPanel?.(); }}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Pipette className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
