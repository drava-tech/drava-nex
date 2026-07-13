import React from "react";
import { Lightbulb, Sparkles, Moon, Sun, Zap } from "lucide-react";
import { Badge } from "@platform/ui";
import { MiniSlider, Switch } from "./controls";
import { getSceneGlow } from "./utils";

export default function LightingContent({ isExpanded, state, actions }: any) {
  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className="flex justify-between items-start shrink-0 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Lightbulb className="w-4 h-4" />
          </div>
          <h3 className="font-semibold tracking-tight text-lg flex items-center gap-2">
            Lighting
            {isExpanded && (
              <button className="w-[13px] h-[13px] rounded-full hover:scale-125 transition-transform cursor-pointer shadow-[0_0_8px_rgba(0,0,0,0.5)] border border-black/10 dark:border-white/20" style={{ backgroundColor: state.color.hex }} onClick={(e) => { e.stopPropagation(); actions.toggleColourPanel?.(); }} />
            )}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={state.power ? "default" : "secondary"} className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest">{state.power ? "● Online" : "Off"}</Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 flex flex-col justify-start transition-all duration-150 ${!state.power ? 'opacity-40 grayscale-[0.8] pointer-events-none' : ''}`}>
        {!isExpanded ? (
          <div className="flex flex-col pb-2">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black">{state.brightness}%</span>
              <span className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Brightness</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 pt-0 min-h-0">
            {/* Left Column: Master & Zones */}
            <div className="flex flex-col gap-4">
               <div className="space-y-3">
                 <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1 block">Brightness Control</span>
                 <MiniSlider label="Master Brightness" value={state.power ? state.brightness : 0} onChange={actions.setBrightness} max={100} suffix="%" />
                 
                 <div className="space-y-2.5 pt-1">
                    {Object.entries(state.zones).map(([zone, val]) => {
                       const storedVal = val as number;
                       const outputVal = state.power ? Math.round((storedVal * state.brightness) / 100) : 0;
                       return (
                         <div key={zone}>
                            <div className="flex justify-between items-center mb-1.5">
                               <div className="flex items-center gap-2">
                                 <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest flex items-center gap-1.5">
                                   {zone}
                                   <button className="w-[8px] h-[8px] md:w-[10px] md:h-[10px] rounded-full hover:scale-125 transition-transform cursor-pointer shadow-[0_0_8px_rgba(0,0,0,0.5)] border border-black/10 dark:border-white/20" style={{ backgroundColor: state.color.hex }} onClick={(e) => { e.stopPropagation(); actions.toggleColourPanel?.(); }} />
                                 </span>
                                 <span className="text-[8px] md:text-[9px] uppercase font-bold text-muted-foreground bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded">{outputVal}% Out</span>
                               </div>
                               <span className="text-[10px] md:text-xs font-black text-foreground">{storedVal}%</span>
                            </div>
                            <MiniSlider label="" value={state.power ? storedVal : 0} onChange={(v) => actions.setZoneBrightness(zone, v)} max={100} suffix="" />
                         </div>
                       );
                    })}
                 </div>
               </div>
            </div>
            
            {/* Right Column: Scenes & Devices */}
            <div className="space-y-4 md:space-y-6">
               <div>
                 <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2 block">Environment Scenes</span>
                 <div className="grid grid-cols-2 gap-2 md:gap-3">
                   {[
                     { name: "Presentation", icon: <Sparkles className="w-5 h-5" /> },
                     { name: "Ambient",      icon: <Moon className="w-5 h-5" /> },
                     { name: "Focus",        icon: <Zap className="w-5 h-5" /> },
                     { name: "Relax",        icon: <Sun className="w-5 h-5" /> },
                   ].map(s => {
                     const isActive = state.activeScene === s.name;
                     return (
                       <div
                         key={s.name}
                         onClick={() => actions.setActiveScene(s.name)}
                         className={`group/btn relative flex flex-col items-center justify-center p-3 rounded-[20px] cursor-pointer transition-all duration-500 overflow-hidden border ${isActive
                           ? "bg-zinc-900 dark:bg-white border-transparent scale-[1.03]"
                           : "bg-white/50 dark:bg-card/50 border-border hover:bg-card dark:hover:bg-card hover:scale-[1.02]"
                         }`}
                       >
                         {isActive && (
                           <div className={`absolute inset-0 opacity-20 dark:opacity-30 bg-gradient-to-br ${getSceneGlow(s.name)} animate-pulse`} />
                         )}
                         <div className={`mb-2 transition-transform duration-500 ${isActive ? 'scale-110' : 'group-hover/btn:scale-110'}`}>
                           <div className={`p-3 rounded-full ${isActive ? 'text-white dark:text-zinc-900' : 'text-muted-foreground'}`}>
                             {isActive ? (
                               <div className="relative">
                                 {s.icon}
                                 <div className={`absolute inset-0 blur-lg bg-gradient-to-tr ${getSceneGlow(s.name)} -z-10`} />
                               </div>
                             ) : s.icon}
                           </div>
                         </div>
                         <span className={`text-[10px] font-black tracking-widest uppercase transition-colors ${isActive ? "text-white dark:text-zinc-900" : "text-muted-foreground"}`}>
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
