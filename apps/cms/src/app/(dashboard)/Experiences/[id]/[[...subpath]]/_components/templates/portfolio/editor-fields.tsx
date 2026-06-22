"use client";

import React, { useState } from "react";
import { ImageIcon } from "lucide-react";
import { MediaPicker } from "@/components/media-picker";
import type { OverviewCard } from "./content";

const FIELD =
  "w-full bg-zinc-100 border border-zinc-300 focus:border-zinc-500 dark:bg-zinc-800 dark:border-zinc-700 dark:focus:border-zinc-500 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none transition-colors disabled:opacity-50";
const LABEL = "text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-[0.15em]";

/** Controlled inputs for the Portfolio Overview cards (used by the editor workspace). */
export function PortfolioFields({
  cards,
  disabled,
  onChange,
}: {
  cards: OverviewCard[];
  disabled?: boolean;
  onChange: (index: number, key: keyof OverviewCard, value: string) => void;
}) {
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {cards.map((card, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Card {i + 1}
          </span>

          <div className="flex flex-col gap-1">
            <label className={LABEL}>Title</label>
            <input
              className={FIELD}
              value={card.title}
              disabled={disabled}
              onChange={(e) => onChange(i, "title", e.target.value)}
            />
          </div>

          {/* Image — select from media library */}
          <div className="flex flex-col gap-1.5">
            <label className={LABEL}>Image</label>
            {card.imageUrl ? (
              <div className="relative aspect-video rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card.imageUrl} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setPickerIndex(i)}
                    className="px-3 py-1.5 rounded-lg bg-white text-zinc-900 text-xs font-semibold disabled:opacity-50"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(i, "imageUrl", "")}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900/80 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setPickerIndex(i)}
                className="flex items-center justify-center gap-2 py-6 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
              >
                <ImageIcon className="h-4 w-4" />
                Select from media
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className={LABEL}>Button 1</label>
              <input
                className={FIELD}
                value={card.button1}
                disabled={disabled}
                placeholder="label"
                onChange={(e) => onChange(i, "button1", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={LABEL}>Button 2</label>
              <input
                className={FIELD}
                value={card.button2}
                disabled={disabled}
                placeholder="label"
                onChange={(e) => onChange(i, "button2", e.target.value)}
              />
            </div>
          </div>
        </div>
      ))}

      <MediaPicker
        open={pickerIndex !== null}
        onClose={() => setPickerIndex(null)}
        onSelect={(url) => {
          if (pickerIndex !== null) onChange(pickerIndex, "imageUrl", url);
        }}
      />
    </div>
  );
}
