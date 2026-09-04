import React from "react";
import { motion } from "framer-motion";
import { RotateCw, Wind, Clock, Zap } from "lucide-react";

export function MiniSlider({ value, onChange, min = 0, max = 100, label, suffix = "%", color = "bg-gradient-to-r from-[#1B006D] to-[#8A5CFF]" }: { value: number, onChange: (v: number) => void, min?: number, max?: number, label?: string, suffix?: string, color?: string }) {
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
 * A draggable slider with a real thumb and a generous touch target.
 *
 * MiniSlider above is deliberately tap-only: an earlier drag implementation
 * made the handle visibly jump, because mid-drag positions raced ahead of the
 * throttled onChange and then snapped back to the last confirmed value on
 * release. Tapping avoided that but is awkward to use.
 *
 * This fixes the race properly instead of avoiding it: while a drag is in
 * progress the thumb renders from local state and the incoming `value` prop is
 * ignored, so a late parent update can never yank it backwards. onChange is
 * throttled during the drag and always fired once more on release with the
 * final position, so the committed value matches where the finger stopped.
 */
export function DragSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [local, setLocal] = React.useState(value);
  const lastSent = React.useRef(0);

  // While dragging, local wins — see the note above about the jump.
  const shown = dragging ? local : value;
  const pct = ((shown - min) / (max - min)) * 100;

  const valueAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return shown;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - r.left, r.width));
    return Math.round(min + (x / r.width) * (max - min));
  };

  // The thumb follows the finger from local state on every move, so this
  // only paces what actually reaches the mesh. At 90ms a two-second drag fired
  // ~20 MQTT commands at the gateway; 250ms keeps it responsive without
  // flooding it, and the forced commit on release guarantees the final value
  // lands regardless of where the throttle happened to fall.
  const commit = (v: number, force = false) => {
    const now = Date.now();
    if (force || now - lastSent.current > 250) {
      lastSent.current = now;
      onChange(v);
    }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuenow={shown}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-disabled={disabled}
      // Tall, transparent hit area around a thin visible track — easy to grab
      // on a touchscreen without making the control look heavy.
      className={`relative flex h-8 w-full touch-none items-center ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = valueAt(e.clientX);
        setDragging(true);
        setLocal(v);
        commit(v, true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const v = valueAt(e.clientX);
        setLocal(v);
        commit(v);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        const v = valueAt(e.clientX);
        setDragging(false);
        setLocal(v);
        commit(v, true); // always land on exactly where the finger stopped
      }}
      onPointerCancel={() => setDragging(false)}
    >
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 shadow-inner dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#1B006D] to-[#8A5CFF]"
          style={{ width: `${pct}%`, transition: dragging ? "none" : "width 150ms ease-out" }}
        />
      </div>
      <div
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-primary shadow-md dark:border-zinc-900"
        style={{ left: `${pct}%`, transition: dragging ? "none" : "left 150ms ease-out" }}
      />
    </div>
  );
}
