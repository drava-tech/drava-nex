import React, { useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { RotateCw, Wind, Clock, Zap } from "lucide-react";

export function MiniSlider({ value, onChange, min = 0, max = 100, label, suffix = "%", color = "bg-zinc-900 dark:bg-white", instant = false }: { value: number, onChange: (v: number) => void, min?: number, max?: number, label?: string, suffix?: string, color?: string, instant?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const mv = useMotionValue(value);
  const [, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!dragging) {
      if (instant) {
        mv.set(value);
      } else {
        animate(mv, value, { type: "spring", stiffness: 60, damping: 15 });
      }
    }
  }, [value, dragging, mv, instant]);

  const pctFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return Math.round(min + (x / rect.width) * (max - min));
  };

  const lastCallRef = React.useRef(0);

  const handleDrag = (e: React.PointerEvent<HTMLDivElement>, isFinal = false) => {
    const val = pctFromEvent(e);
    mv.set(val);
    
    const now = Date.now();
    if (isFinal || now - lastCallRef.current > 32) {
      lastCallRef.current = now;
      startTransition(() => onChange(val));
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    handleDrag(e);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (dragging) handleDrag(e);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    handleDrag(e, true);
  };

  const pctMv = useTransform(mv, [min, max], [0, 100]);
  const widthStr = useTransform(pctMv, p => `${p}%`);
  const leftStr = useTransform(pctMv, p => `calc(${p}% - 10px)`);
  const textStr = useTransform(mv, v => `${Math.round(v)}${suffix}`);

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between items-center mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
          <motion.span className="text-[11px] font-black text-foreground">{textStr}</motion.span>
        </div>
      )}
      <div
        className="w-full h-3 bg-zinc-200 dark:bg-zinc-800 rounded-full relative cursor-pointer touch-none flex items-center shadow-inner"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <motion.div className={`absolute left-0 h-full rounded-full ${color}`} style={{ width: widthStr }} />
        <motion.div
          className="absolute h-5 w-5 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.15)] rounded-full border border-zinc-200"
          style={{ left: leftStr }}
        />
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
        transition={{ type: "spring", stiffness: 500, damping: 30, duration: 0.65 }}
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
