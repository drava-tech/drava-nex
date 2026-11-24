"use client";

import React from "react";
import { ImageIcon, X } from "lucide-react";
import { CANVAS_FONTS } from "@platform/ui/templates/canvas";

export const inputCls = "h-8 w-44 rounded-md border border-border bg-zinc-50 px-2 text-xs outline-none focus:border-violet-500 dark:bg-zinc-900";

export const thumbStyle = (w: number, h: number): React.CSSProperties =>
  w >= h ? { width: "100%", aspectRatio: `${w} / ${h}` } : { height: "100%", aspectRatio: `${w} / ${h}` };

export const card = (active: boolean) =>
  `rounded-xl border text-left transition-colors ${active ? "border-violet-500 bg-violet-500/5" : "border-border hover:border-zinc-400"}`;

export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{title}</span>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[11px] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

export function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-zinc-500">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
          aria-label={label}
        />
      </span>
    </Field>
  );
}

export function FontField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {CANVAS_FONTS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ImageField({ label, url, cover, onPick, onClear }: { label: string; url: string | null; cover?: boolean; onPick: () => void; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <span className="flex items-center gap-1.5">
        {url && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className={`h-8 w-12 rounded border border-border ${cover ? "object-cover" : "object-contain"}`} />
            <button type="button" data-plain onClick={onClear} aria-label={`Remove ${label.toLowerCase()}`} className="rounded-md p-1.5 text-zinc-500 hover:bg-accent">
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          data-plain
          onClick={onPick}
          className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] hover:bg-accent"
        >
          <ImageIcon className="h-3.5 w-3.5" /> {url ? "Change" : "Choose"}
        </button>
      </span>
    </div>
  );
}
