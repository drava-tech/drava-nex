"use client";

import { Check, ChevronDown, Layers } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@platform/ui";

/**
 * The tall group and screen bars at the top of Our Story
 * (broadcast/publish-board.tsx), as pieces Screens and Schedules share so the
 * top of all of them looks the same: a group dropdown, then a wide screen bar.
 */

const BAR =
  "flex h-12 items-center gap-2 rounded-xl border bg-card px-4 text-card-foreground shadow-[var(--card-shadow)] transition-colors hover:border-primary/50";

/** z-[300] matches Our Story's menus, which must clear its carousel. */
const MENU = "z-[300] max-h-[60vh] overflow-y-auto";

export interface GroupBarOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/**
 * The group dropdown. The first option is the "everything" default
 * ("All screens"); once anything else is picked the bar lights up.
 */
export function GroupBar<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly GroupBarOption<T>[];
  onChange: (value: T) => void;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  const applied = value !== options[0]?.value;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Screen group: ${current?.label ?? ""}`}
          className={`${BAR} max-w-[40%] shrink-0 text-sm font-semibold ${applied ? "border-primary/50 text-primary-ink" : ""}`}
        >
          <Layers className="h-4 w-4 shrink-0" />
          <span className="truncate">{current?.label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={`${MENU} min-w-56`}>
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => onChange(o.value)}
            className="flex cursor-pointer items-center gap-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{o.label}</span>
            {o.count !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.count}</span>}
            {o.value === value ? <Check className="h-4 w-4 shrink-0 text-primary-ink" /> : <span className="w-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface BarScreen {
  id: string;
  name: string;
  online: boolean;
  /** What it shows now, for the right-hand side; offline screens say so instead. */
  detail?: string | null;
}

/**
 * The wide screen bar: one screen picked (status dot, name, what it shows), or
 * all of them with a summary. Its menu starts with "All screens".
 */
export function ScreenBar({
  screens,
  value,
  onChange,
  allSummary,
}: {
  screens: BarScreen[];
  /** The picked screen's id; null = all screens. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Right-hand text while no screen is picked, e.g. "6 screens · 4 live". */
  allSummary: string;
}) {
  const picked = value ? screens.find((s) => s.id === value) ?? null : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={picked ? `Showing ${picked.name}. Choose another screen` : "Showing all screens. Choose a screen"}
          className={`${BAR} min-w-0 flex-1 justify-between gap-3 text-left ${picked ? "border-primary/50" : ""}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {picked && (
              <span
                title={picked.online ? "Display connected" : "No display connected"}
                className={`h-2 w-2 shrink-0 rounded-full ${picked.online ? "bg-emerald-400" : "bg-amber-400"}`}
              />
            )}
            <span className="truncate text-sm font-bold">{picked ? picked.name : "All screens"}</span>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {picked ? (picked.online ? picked.detail || "Nothing showing" : "Offline") : allSummary}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={`${MENU} w-[var(--radix-dropdown-menu-trigger-width)]`}>
        <DropdownMenuItem onSelect={() => onChange(null)} className="flex cursor-pointer items-center gap-3 py-2">
          <span className="h-2 w-2 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">All screens</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{screens.length}</span>
          {value === null ? <Check className="h-4 w-4 shrink-0 text-primary-ink" /> : <span className="w-4 shrink-0" />}
        </DropdownMenuItem>
        {screens.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onSelect={() => onChange(s.id)}
            className="flex cursor-pointer items-center gap-3 py-2"
          >
            <span
              title={s.online ? "Display connected" : "No display connected"}
              className={`h-2 w-2 shrink-0 rounded-full ${s.online ? "bg-emerald-400" : "bg-amber-400"}`}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.name}</span>
            <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
              {s.online ? s.detail || "Nothing showing" : "Offline"}
            </span>
            {s.id === value ? <Check className="h-4 w-4 shrink-0 text-primary-ink" /> : <span className="w-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
