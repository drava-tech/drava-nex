import React from "react";
import { motion } from "framer-motion";
import { RotateCw, Wind, Clock, Zap } from "lucide-react";
import { DragSlider } from "@/components/drag-slider";

export function MiniSlider({ value, onChange, min = 0, max = 100, label, suffix = "%", color = "bg-primary" }: { value: number, onChange: (v: number) => void, min?: number, max?: number, label?: string, suffix?: string, color?: string }) {
  // Single click/tap on the track sets the value directly at that position —
  // no drag-tracking, no spring re-sync after release (that combination was
  // what caused the visible "jump": mid-drag positions raced ahead of the
  // throttled onChange, then snapped back to the confirmed value on release).
  const handleSetFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const val = Math.round(min + (x / rect.width) * (max - min));
    onChange(val);
  };

  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between items-center mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
          <span className="text-[11px] font-black text-foreground">{Math.round(value)}{suffix}</span>
        </div>
      )}
      <div
        className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full relative cursor-pointer touch-none flex items-center shadow-inner"
        onPointerDown={handleSetFromEvent}
      >
        <div className={`h-full rounded-full transition-[width] duration-150 ease-out ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Switch({ checked, onChange }: { checked: boolean, onChange: (c: boolean) => void }) {
  return (
    <div
      className={`w-11 h-6 rounded-full p-1 cursor-pointer transition-colors ${checked ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-200 dark:bg-zinc-700'}`}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
    >
      <motion.div
        className={`w-4 h-4 rounded-full bg-white dark:bg-zinc-900 shadow-sm`}
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </div>
  );
}

export function ClimateControlIcon({ type, active }: { type: "swing" | "timer" | "turbo" | "fan", active?: boolean }) {
  if (type === "swing") {
    return (
      <span className="relative flex h-5 w-7 items-center justify-center">
        <motion.span
          className="absolute left-0 top-0.5"
          animate={active ? { rotate: 360 } : { rotate: 0 }}
          transition={active ? { duration: 2.2, repeat: Infinity, ease: "linear" } : { duration: 0.2 }}
        >
          <RotateCw className="h-4 w-4" />
        </motion.span>
        <motion.span
          className="absolute right-0 top-1"
          animate={active ? { x: [-2, 2, -2], opacity: [0.55, 1, 0.55] } : { x: 0, opacity: 0.85 }}
          transition={active ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        >
          <Wind className="h-4 w-4" />
        </motion.span>
      </span>
    );
  }

  if (type === "timer") {
    return (
      <motion.span
        animate={active ? { rotate: [0, 8, 0, -8, 0] } : { rotate: 0 }}
        transition={active ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      >
        <Clock className="w-4 h-4" />
      </motion.span>
    );
  }

  if (type === "turbo") {
    return (
      <motion.span
        animate={active ? { scale: [1, 1.22, 1], opacity: [0.8, 1, 0.8] } : { scale: 1, opacity: 1 }}
        transition={active ? { duration: 0.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      >
        <Zap className="w-4 h-4" />
      </motion.span>
    );
  }

  return (
    <div className="relative flex items-center justify-center w-4 h-4">
      <motion.span
        className="absolute"
        animate={active ? { x: [-6, 6], opacity: [0, 1, 0] } : { x: 0, opacity: 1 }}
        transition={active ? { duration: 1.5, repeat: Infinity, ease: "linear" } : { duration: 0.2 }}
      >
        <Wind className="w-4 h-4" />
      </motion.span>
      {active && (
        <motion.span
          className="absolute"
          animate={{ x: [-6, 6], opacity: [0, 1, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear", delay: 0.75 }}
        >
          <Wind className="w-4 h-4" />
        </motion.span>
      )}
    </div>
  );
}

/**
 * Re-exported so this page keeps its single controls import. The
 * implementation moved to components/drag-slider.tsx when the video scrub bar
 * started needing it too — a shared control must not live inside one route's
 * private _components folder.
 */
export { DragSlider };
