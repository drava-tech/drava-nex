import React, { useEffect, useRef } from "react";
import { Lightbulb, Plus, Radar, Sparkles } from "lucide-react";
import { Badge } from "@platform/ui";
import { MiniSlider, Switch } from "./controls";

const LONG_PRESS_MS = 500;
// Beyond this pointer travel (px) a "press" is a drag/scroll, not a tap.
const PRESS_MOVE_TOLERANCE = 6;

// Tap = trigger the mode; long-press = arm it for in-place editing (see the
// name/Save/Cancel bar above the Master Brightness slider). Same
// timing/tolerance as the experiences page's push-to-screen long-press
// (apps/cms/src/app/(dashboard)/experiences/_components/projects-list.tsx).
function ModeCard({ name, isEditing, onTap, onLongPress }: { name: string; isEditing: boolean; onTap: () => void; onLongPress: () => void }) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressActive = useRef(false);
  const longPressFired = useRef(false);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const clearPressTimer = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  useEffect(() => clearPressTimer, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pressActive.current = true;
    longPressFired.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    clearPressTimer();
    pressTimer.current = setTimeout(() => {
      if (!pressActive.current) return;
      longPressFired.current = true;
      pressActive.current = false;
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    clearPressTimer();
    if (!pressActive.current) return;
    pressActive.current = false;
    if (longPressFired.current) return;
    if (pressStart.current) {
      const dx = e.clientX - pressStart.current.x;
      const dy = e.clientY - pressStart.current.y;
      if (Math.hypot(dx, dy) > PRESS_MOVE_TOLERANCE) return;
    }
    onTap();
  };

  const handlePressCancel = () => {
    clearPressTimer();
    pressActive.current = false;
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePressCancel}
      onPointerCancel={handlePressCancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`group/btn relative flex flex-col items-center justify-center p-3 lg:p-5 rounded-[20px] cursor-pointer select-none transition-all duration-500 overflow-hidden border hover:scale-[1.02] ${
        isEditing
          ? "bg-primary/10 border-primary ring-2 ring-primary/40"
          : "bg-white/50 dark:bg-card/50 border-border hover:bg-card dark:hover:bg-card"
      }`}
    >
      <div className="mb-2 lg:mb-3 transition-transform duration-500 group-hover/btn:scale-110">
        <div className="p-3 lg:p-4 rounded-full text-muted-foreground">
          <Sparkles className="w-5 h-5 lg:w-6 lg:h-6" />
        </div>
      </div>
      <span className="text-[10px] lg:text-xs font-black tracking-widest uppercase text-muted-foreground text-center">
        {name}
      </span>
    </div>
  );
}

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
          <Badge variant="secondary" className={`${isExpanded ? "" : "hidden xl:inline-flex"} border-0 bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-slate-300 shadow-none font-bold uppercase text-[10px] tracking-widest`}>{state.power ? "Online" : "Off"}</Badge>
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
                 {state.editingModeId ? (
                   <div className="flex items-center gap-2 mb-1">
                     <input
                       autoFocus
                       type="text"
                       value={state.editingModeName}
                       onChange={(e) => actions.setEditingModeName?.(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") actions.saveEditingMode?.(); }}
                       placeholder="Mode name"
                       className="min-w-0 flex-1 bg-transparent border border-primary/40 focus:border-primary rounded-lg px-2.5 h-7 text-xs font-bold focus:outline-none"
                     />
                     <button
                       onClick={() => actions.saveEditingMode?.()}
                       disabled={!state.editingModeName?.trim() || state.savingEditMode}
                       className="shrink-0 h-7 px-3 rounded-lg bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
                     >
                       {state.savingEditMode ? "Saving…" : "Save"}
                     </button>
                     <button
                       onClick={() => actions.cancelEditingMode?.()}
                       className="shrink-0 h-7 px-3 rounded-lg border border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:bg-muted"
                     >
                       Cancel
                     </button>
                   </div>
                 ) : (
                   <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1 block">Brightness Control</span>
                 )}
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
                                   <button className="w-[8px] h-[8px] md:w-[10px] md:h-[10px] rounded-full hover:scale-125 transition-transform cursor-pointer shadow-[0_0_8px_rgba(0,0,0,0.5)] border border-black/10 dark:border-white/20" style={{ backgroundColor: (state.colors?.[zone] ?? state.color).hex }} onClick={(e) => { e.stopPropagation(); actions.toggleColourPanel?.(zone); }} />
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
                 <div className="flex items-center justify-between mb-2 shrink-0">
                   <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Environment Modes</span>
                   <button
                     title="Add mode"
                     className="flex items-center justify-center w-6 h-6 rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                     onClick={(e) => { e.stopPropagation(); actions.addMode?.(); }}
                   >
                     <Plus className="w-3.5 h-3.5" />
                   </button>
                 </div>
                 {state.modes?.length ? (
                   <div className="grid grid-cols-2 gap-2 md:gap-3 lg:gap-4 lg:flex-1 lg:auto-rows-fr lg:min-h-0">
                     {state.modes.map((mode: { id: string; name: string }) => (
                       <ModeCard
                         key={mode.id}
                         name={mode.name}
                         isEditing={state.editingModeId === mode.id}
                         onTap={() => actions.triggerMode?.(mode.id)}
                         onLongPress={() => actions.editMode?.(mode)}
                       />
                     ))}
                   </div>
                 ) : (
                   <p className="text-[11px] text-muted-foreground/70 lg:flex-1 flex items-center justify-center text-center px-4">
                     No modes saved yet — set the lights how you want them, then tap + to save.
                   </p>
                 )}
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
