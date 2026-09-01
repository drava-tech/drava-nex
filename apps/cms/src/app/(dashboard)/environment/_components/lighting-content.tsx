import React from "react";
import { Lightbulb } from "lucide-react";
import { Badge } from "@platform/ui";
import { Switch } from "./controls";

/**
 * Both Casambi drivers are switched as a single group — no brightness, colour,
 * per-fixture or scene controls by design. `on` is the group's state and
 * `setPower` drives both drivers at once (see environment-view's
 * apiSetGroupPower).
 */
export default function LightingContent({ isExpanded, state, actions }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className={`flex justify-between items-start shrink-0 ${isExpanded ? "mb-4" : "mb-2"}`}>
        <div className="flex items-center gap-2">
          <div className={`${isExpanded ? "w-8 h-8" : "w-7 h-7"} rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0`}>
            <Lightbulb className={isExpanded ? "w-4 h-4" : "w-3.5 h-3.5"} />
          </div>
          <h3 className={`${isExpanded ? "text-lg" : "text-base"} font-semibold tracking-tight`}>Lighting</h3>
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
        </div>
      )}
    </div>
  );
}
