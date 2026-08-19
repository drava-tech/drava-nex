import React from "react";
import { Lock, Unlock } from "lucide-react";
import { Badge } from "@platform/ui";
import { Switch } from "./controls";

export default function SecurityContent({ isExpanded, state, actions }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className={`flex justify-between items-start shrink-0 ${isExpanded ? "mb-4" : "mb-2"}`}>
        <div className="flex items-center gap-2">
          <div className={`${isExpanded ? "w-8 h-8" : "w-7 h-7"} rounded-full bg-yellow-500/10 flex items-center justify-center text-yellow-500 shrink-0`}>
            {state.locked ? <Lock className={isExpanded ? "w-4 h-4" : "w-3.5 h-3.5"} /> : <Unlock className={isExpanded ? "w-4 h-4" : "w-3.5 h-3.5"} />}
          </div>
          <h3 className={`${isExpanded ? "text-lg" : "text-base"} font-semibold tracking-tight`}>Security</h3>
        </div>
        <div className={`flex items-center ${isExpanded ? "gap-3" : "gap-2"}`}>
          <Badge variant="secondary" className={`${isExpanded ? "" : "hidden xl:inline-flex"} border-0 bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-slate-300 shadow-none font-bold uppercase text-[10px] tracking-widest`}>
            {state.locked ? "Locked" : "Unlocked"}
          </Badge>
          <Switch checked={state.locked} onChange={actions.setLocked} />
        </div>
      </div>

      <div className={`flex-1 flex flex-col justify-center transition-all duration-150`}>
        {!isExpanded ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 leading-none">
              <span className="text-3xl font-black md:text-[2rem]">{state.locked ? "Locked" : "Unlocked"}</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0 w-full flex-col gap-4 lg:gap-6 py-1">
             <div className="min-w-0 lg:flex lg:flex-1 lg:min-h-0 lg:flex-col justify-center items-center h-full mt-8">
              <button
                onClick={() => actions.setLocked(!state.locked)}
                className={`flex items-center justify-center rounded-full p-8 transition-colors ${state.locked ? "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20" : "bg-muted hover:bg-muted/80 text-muted-foreground"}`}
              >
                {state.locked ? <Lock className="w-32 h-32 lg:w-48 lg:h-48" /> : <Unlock className="w-32 h-32 lg:w-48 lg:h-48" />}
              </button>
              <div className="flex items-start justify-center mt-6 mb-2 lg:mb-4 shrink-0">
                <span className="text-5xl lg:text-7xl font-black">{state.locked ? "Locked" : "Unlocked"}</span>
              </div>
              <p className={`text-center text-[10px] lg:text-xs font-bold tracking-widest uppercase opacity-80 mt-2 lg:mt-3 shrink-0 ${state.locked ? "text-yellow-500" : "text-muted-foreground"}`}>
                {state.locked ? "System is fully locked and secured" : "System is unlocked"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
