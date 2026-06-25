"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { cn } from "@platform/ui";

export type Accent = "indigo" | "amber" | "sky";

const ACCENT_SOLID: Record<Accent, string> = {
  indigo: "bg-indigo-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
};

// ── Segmented — small pill view switcher ───────────────────────────────────
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border bg-muted/50 p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Switch — clean pill power toggle ───────────────────────────────────────
export function Switch({
  checked,
  onChange,
  accent = "indigo",
  color,
  disabled = false,
  label = "Toggle",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  accent?: Accent;
  /** Optional explicit on-state color (hex) — overrides `accent`. */
  color?: string;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={color && checked ? { backgroundColor: color } : undefined}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        checked ? (color ? "" : ACCENT_SOLID[accent]) : "bg-muted-foreground/25",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-300",
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

// ── Slider — track + fill + thumb, pointer-drag ────────────────────────────
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  accent = "indigo",
  color,
  disabled = false,
  ariaLabel = "Slider",
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  accent?: Accent;
  /** Optional explicit fill color (hex) — overrides `accent`. */
  color?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onChange(Math.round(min + ratio * (max - min)));
    },
    [min, max, onChange]
  );

  useEffect(() => {
    if (disabled) return;
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current) setFromClientX(e.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [disabled, setFromClientX]);

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={(e) => {
        if (disabled) return;
        draggingRef.current = true;
        setFromClientX(e.clientX);
      }}
      className={cn(
        "relative flex h-6 items-center",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer touch-none"
      )}
    >
      <div className="h-2 w-full rounded-full bg-muted-foreground/15">
        <div
          className={cn("h-2 rounded-full", !color && ACCENT_SOLID[accent])}
          style={{ width: `${pct}%`, ...(color ? { backgroundColor: color } : {}) }}
        />
      </div>
      <div
        className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/5 bg-white shadow-md"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}
