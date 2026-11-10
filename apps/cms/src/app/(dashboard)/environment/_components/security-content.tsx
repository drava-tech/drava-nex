import React from "react";
import { Lock, Unlock } from "lucide-react";
import { Badge } from "@platform/ui";
import { Switch } from "./controls";

export default function SecurityContent({ isExpanded, state, actions }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className={`flex justify-between items-start shrink-0 ${isExpanded ? "mb-4" : "mb-2"}`}>
        <div className="flex items-center gap-2">
          <div className={`${isExpanded ? "w-8 h-8" : "w-7 h-7"} rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0`}>
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
          <div className="flex-1 flex min-h-0 w-full flex-col gap-2 sm:gap-4 py-1">
             <div className="min-w-0 flex flex-1 min-h-0 flex-col justify-center items-center h-full mt-2 sm:mt-4">
              <button
                onClick={() => actions.setLocked(!state.locked)}
                className={`flex items-center justify-center rounded-full p-5 sm:p-7 md:p-8 transition-colors ${state.locked ? "btn-active" : "bg-[#262626] text-white shadow-[var(--pill-shadow)] hover:bg-[#333333]"}`}
              >
                {state.locked ? <Lock className="w-20 h-20 sm:w-28 sm:h-28 lg:w-36 lg:h-36" /> : <Unlock className="w-20 h-20 sm:w-28 sm:h-28 lg:w-36 lg:h-36" />}
              </button>
              <div className="flex items-start justify-center mt-3 sm:mt-5 mb-1 sm:mb-2 shrink-0">
                <span className="text-3xl sm:text-5xl lg:text-6xl font-black text-white">{state.locked ? "Locked" : "Unlocked"}</span>
              </div>
              <p className={`text-center text-[10px] sm:text-xs font-bold tracking-widest uppercase opacity-80 mt-1 sm:mt-2 shrink-0 ${state.locked ? "text-primary-ink" : "text-white/60"}`}>
                {state.locked ? "System is fully locked and secured" : "System is unlocked"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
