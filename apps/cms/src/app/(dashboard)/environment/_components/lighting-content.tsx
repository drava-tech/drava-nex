import React from "react";
import { Lightbulb, Sparkles, Moon, Sun, Zap, Radar } from "lucide-react";
import { Badge } from "@platform/ui";
import { MiniSlider, Switch } from "./controls";
import { getSceneGlow } from "./utils";

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
              <button className="w-[13px] h-[13px] rounded-full hover:scale-125 transition-transform cursor-pointer shadow-[0_0_8px_rgba(0,0,0,0.5)] border border-black/10 dark:border-white/20" style={{ backgroundColor: state.color.hex }} onClick={(e) => { e.stopPropagation(); actions.toggleColourPanel?.(); }} />
            )}
          </h3>
        </div>
        <div className={`flex items-center ${isExpanded ? "gap-3" : "gap-2"}`}>
          <Badge variant={state.power ? "default" : "secondary"} className={`${isExpanded ? "" : "hidden xl:inline-flex"} bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest`}>{state.power ? "Online" : "Off"}</Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 flex flex-col justify-start transition-all duration-150 ${!state.power ? 'opacity-40 grayscale-[0.8] pointer-events-none' : ''}`}>
        {!isExpanded ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 leading-none">
              <span className="text-3xl font-black md:text-[2rem]">{state.brightness}%</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Brightness</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${state.power ? state.brightness : 0}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 pt-0 min-h-0">
            {/* Left Column: Master & Zones */}
            <div className="flex flex-col gap-4 lg:h-full lg:justify-between lg:gap-6">
               <div className="space-y-3 lg:space-y-5">
                 <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1 block">Brightness Control</span>
                 <MiniSlider label="Master Brightness" value={state.power ? state.brightness : 0} onChange={actions.setBrightness} max={100} suffix="%" />
               </div>

               <div className="space-y-2.5 pt-1 lg:flex lg:flex-1 lg:min-h-0 lg:flex-col lg:justify-around lg:space-y-0 lg:pt-0">
                    {Object.entries(state.zones).map(([zone, val]) => {
                       const storedVal = val as number;
                       return (
                         <div key={zone}>
                            <div className="flex justify-between items-center mb-1.5">
                               <div className="flex items-center gap-2">
                                 <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest flex items-center gap-1.5">
                                   {zone}
                                   <button className="w-[8px] h-[8px] md:w-[10px] md:h-[10px] rounded-full hover:scale-125 transition-transform cursor-pointer shadow-[0_0_8px_rgba(0,0,0,0.5)] border border-black/10 dark:border-white/20" style={{ backgroundColor: state.color.hex }} onClick={(e) => { e.stopPropagation(); actions.toggleColourPanel?.(); }} />
                                 </span>
                                 <button
                                   title={`Flash ${zone} to identify the physical fixture`}
                                   className="flex items-center gap-1 text-[8px] md:text-[9px] uppercase font-bold text-muted-foreground bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 px-1 py-0.5 rounded transition-colors"
                                   onClick={(e) => { e.stopPropagation(); actions.identifyZone?.(zone); }}
                                 >
                                   <Radar className="w-2.5 h-2.5" />
                                   Identify
                                 </button>
                               </div>
                               <span className="text-[10px] md:text-xs font-black text-foreground">{storedVal}%</span>
                            </div>
                            <MiniSlider label="" value={state.power ? storedVal : 0} onChange={(v) => actions.setZoneBrightness(zone, v)} max={100} suffix="" />
                         </div>
                       );
                    })}
               </div>
            </div>
            
            {/* Right Column: Scenes & Devices */}
            <div className="space-y-4 md:space-y-6 lg:flex lg:h-full lg:flex-col">
               <div className="lg:flex lg:flex-1 lg:min-h-0 lg:flex-col">
                 <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2 block lg:shrink-0">Environment Scenes</span>
                 <div className="grid grid-cols-2 gap-2 md:gap-3 lg:gap-4 lg:flex-1 lg:auto-rows-fr lg:min-h-0">
                   {[
                     { name: "Presentation", icon: <Sparkles className="w-5 h-5 lg:w-6 lg:h-6" /> },
                     { name: "Ambient",      icon: <Moon className="w-5 h-5 lg:w-6 lg:h-6" /> },
                     { name: "Focus",        icon: <Zap className="w-5 h-5 lg:w-6 lg:h-6" /> },
                     { name: "Relax",        icon: <Sun className="w-5 h-5 lg:w-6 lg:h-6" /> },
                   ].map(s => {
                     const isActive = state.activeScene === s.name;
                     return (
                       <div
                         key={s.name}
                         onClick={() => actions.setActiveScene(s.name)}
                         className={`group/btn relative flex flex-col items-center justify-center p-3 lg:p-5 rounded-[20px] cursor-pointer transition-all duration-500 overflow-hidden border ${isActive
                           ? "bg-zinc-900 dark:bg-white border-transparent scale-[1.03]"
                           : "bg-white/50 dark:bg-card/50 border-border hover:bg-card dark:hover:bg-card hover:scale-[1.02]"
                         }`}
                       >
                         {isActive && (
                           <div className={`absolute inset-0 opacity-20 dark:opacity-30 bg-gradient-to-br ${getSceneGlow(s.name)} animate-pulse`} />
                         )}
                         <div className={`mb-2 lg:mb-3 transition-transform duration-500 ${isActive ? 'scale-110' : 'group-hover/btn:scale-110'}`}>
                           <div className={`p-3 lg:p-4 rounded-full ${isActive ? 'text-white dark:text-zinc-900' : 'text-muted-foreground'}`}>
                             {isActive ? (
                               <div className="relative">
                                 {s.icon}
                                 <div className={`absolute inset-0 blur-lg bg-gradient-to-tr ${getSceneGlow(s.name)} -z-10`} />
                               </div>
                             ) : s.icon}
                           </div>
                         </div>
                         <span className={`text-[10px] lg:text-xs font-black tracking-widest uppercase transition-colors ${isActive ? "text-white dark:text-zinc-900" : "text-muted-foreground"}`}>
                           {s.name}
                         </span>
                       </div>
                     );
                   })}
                 </div>
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
