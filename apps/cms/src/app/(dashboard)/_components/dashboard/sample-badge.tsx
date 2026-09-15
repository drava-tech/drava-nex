import React from "react";

/**
 * Marks a card whose contents are placeholders, not measurements.
 *
 * Mandatory wherever sample-data.ts is used. Deliberately high-contrast amber
 * rather than a subtle grey: the whole point is that it cannot be skimmed past.
 */
export function SampleBadge({ title }: { title?: string }) {
  return (
    <span
      title={title ?? "Placeholder values — no real data recorded for this period yet"}
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-500 dark:text-amber-400"
    >
      Sample data
    </span>
  );
}
