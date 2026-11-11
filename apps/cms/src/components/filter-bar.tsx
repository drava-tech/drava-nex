"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@platform/ui";

/**
 * The pill controls of the Our Story bar (broadcast/publish-board.tsx), as
 * pieces the Screens and Schedules bars share so the three look the same.
 */

/** True when every word typed appears somewhere in the fields. Empty query matches all. */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

export function SearchPill({
  value,
  onChange,
  label,
  className = "w-56",
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Placeholder and accessible name, e.g. "Search screens". */
  label: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={`relative flex items-center ${className}`}>
      <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Clear first; a second Escape reaches whatever is behind (a dialog, say).
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={label}
        aria-label={label}
        // select-text: the pages these bars sit on are select-none, which some browsers pass on to inputs.
        className="h-8 w-full select-text rounded-full border border-border bg-card pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-ring [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * A dropdown pill. The first option is the "everything" default; the pill
 * lights up once anything else is picked, so an applied filter is visible.
 */
export function FilterPill<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** What this filters by, for screen readers ("Group", "Status"). */
  label: string;
  value: T;
  options: readonly { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  const applied = value !== options[0]?.value;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${current?.label ?? ""}`}
          className={`flex max-w-48 shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-xs transition-colors ${
            applied ? "btn-active" : "btn-surface"
          }`}
        >
          <span className="truncate">{current?.label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-44 overflow-y-auto">
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            className="cursor-pointer gap-2 text-xs"
            onSelect={() => onChange(o.value)}
          >
            {o.value === value ? <Check className="h-3.5 w-3.5 shrink-0" /> : <span className="w-3.5 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.count !== undefined && <span className="tabular-nums text-muted-foreground">{o.count}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
