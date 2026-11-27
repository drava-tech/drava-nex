"use client";

import React, { useEffect, useState } from "react";

/** Small form controls shared by the editor panels. */

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b border-border px-4 py-4 last:border-0">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-300">
      <span className="shrink-0">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-1.5">{children}</div>
    </label>
  );
}

const inputCls =
  "h-8 rounded-md border border-border bg-zinc-100 px-2 text-xs text-zinc-900 outline-none focus:border-violet-500 dark:bg-zinc-800 dark:text-zinc-100";

/**
 * A number box that commits on blur / Enter (one undo step per edit, not per
 * keystroke) and supports ArrowUp/Down (+Shift ×10).
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  width = 64,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  width?: number;
  label?: string;
}) {
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return setText(fmt(value));
    const next = clamp(v);
    if (next !== value) onChange(next);
    setText(fmt(next));
  };

  return (
    <div className="relative flex items-center">
      {label && <span className="pointer-events-none absolute left-2 text-[10px] font-semibold text-zinc-400">{label}</span>}
      <input
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const next = clamp(Number(text) + d);
            setText(fmt(next));
            onChange(next);
          }
        }}
        className={`${inputCls} ${label ? "pl-6" : ""} ${suffix ? "pr-6" : ""}`}
        style={{ width }}
      />
      {suffix && <span className="pointer-events-none absolute right-2 text-[10px] text-zinc-400">{suffix}</span>}
    </div>
  );
}

export function SelectField<T extends string | number>({
  value,
  options,
  onChange,
  width = 140,
}: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
  width?: number;
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value);
        if (opt) onChange(opt.value);
      }}
      className={inputCls}
      style={{ width }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export const SWATCHES = [
  "#000000",
  "#ffffff",
  "#111827",
  "#6b7280",
  "#ef4444",
  "#f59e0b",
  "#fde047",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#7c3aed",
  "#ec4899",
];

function toHex(c: string): string {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : /^#[0-9a-f]{3}$/i.test(c) ? `#${[...c.slice(1)].map((x) => x + x).join("")}` : "#000000";
}

/**
 * Colour swatch + text box + quick swatches. The native picker fires on every
 * drag frame, so the caller gets `live` updates (no undo step) between
 * onStart/onEnd and the whole pick lands as one undo step.
 */
export function ColorField({
  value,
  onChange,
  onStart,
  onEnd,
  swatches = true,
}: {
  value: string;
  onChange: (v: string, live?: boolean) => void;
  onStart?: () => void;
  onEnd?: () => void;
  swatches?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={toHex(value)}
          onFocus={onStart}
          onBlur={onEnd}
          onChange={(e) => onChange(e.target.value, true)}
          className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== value && text.trim() && onChange(text.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className={`${inputCls} w-[104px] font-mono`}
        />
      </div>
      {swatches && (
        <div className="flex flex-wrap gap-1">
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              data-plain
              onClick={() => onChange(s)}
              title={s}
              className={`h-5 w-5 rounded-full border ${value.toLowerCase() === s ? "ring-2 ring-violet-500 ring-offset-1 ring-offset-background" : "border-zinc-300 dark:border-zinc-600"}`}
              style={{ background: s }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function IconToggle({
  active,
  onClick,
  title,
  children,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-plain
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md border text-zinc-600 transition-colors disabled:opacity-40 dark:text-zinc-300 ${
        active
          ? "border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-300"
          : "border-border hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onStart,
  onEnd,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onPointerDown={onStart}
      onPointerUp={onEnd}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-28 accent-violet-600"
    />
  );
}
