"use client";

import React, { useState } from "react";
import { ArrowDown, ArrowUp, ImageIcon, X } from "lucide-react";
import { MediaPicker } from "@/components/media-picker";
import {
  normalizeSections,
  type OverviewCard,
  type PortfolioSection,
} from "@platform/ui/templates/portfolio";

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
  const [videoPickerIndex, setVideoPickerIndex] = useState<number | null>(null);

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

          {/* Video — optional; played in a popup when "Watch Video" (button 1) is tapped */}
          <div className="flex flex-col gap-1.5">
            <label className={LABEL}>Video (Watch Video popup)</label>
            {card.videoUrl ? (
              <div className="relative aspect-video rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-black group">
                <video src={card.videoUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setVideoPickerIndex(i)}
                    className="px-3 py-1.5 rounded-lg bg-white text-zinc-900 text-xs font-semibold disabled:opacity-50"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(i, "videoUrl", "")}
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
                onClick={() => setVideoPickerIndex(i)}
                className="flex items-center justify-center gap-2 py-6 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
              >
                ▶ Select video from media
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2">
            {card.videoUrl ? (
              <div className="flex flex-col gap-1">
                <label className={LABEL}>Button 1 (Watch Video)</label>
                <input
                  className={FIELD}
                  value={card.button1}
                  disabled={disabled}
                  placeholder="label"
                  onChange={(e) => onChange(i, "button1", e.target.value)}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <label className={LABEL}>Button 2 (Projects)</label>
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

      <MediaPicker
        open={videoPickerIndex !== null}
        onClose={() => setVideoPickerIndex(null)}
        accept="video"
        onSelect={(url) => {
          if (videoPickerIndex !== null) onChange(videoPickerIndex, "videoUrl", url);
        }}
      />
    </div>
  );
}

type MediaKey = "images" | "videos";

/**
 * Drill-in editor for one card's 2 sections: the button name shown on the
 * vertical's page, the section type (image slideshow or videos grid), and that
 * type's media list (add / remove / reorder).
 */
export function SectionFields({
  card,
  cardIndex,
  disabled,
  onSectionChange,
}: {
  card: OverviewCard;
  cardIndex: number;
  disabled?: boolean;
  onSectionChange: (cardIndex: number, sectionIndex: number, patch: Partial<PortfolioSection>) => void;
}) {
  const sections = normalizeSections(card.sections);
  const [picker, setPicker] = useState<{ section: number; key: MediaKey } | null>(null);

  const listOf = (si: number, key: MediaKey): string[] => sections[si]![key] ?? [];

  const moveMedia = (si: number, key: MediaKey, from: number, to: number) => {
    const urls = [...listOf(si, key)];
    if (to < 0 || to >= urls.length) return;
    const [url] = urls.splice(from, 1);
    urls.splice(to, 0, url!);
    onSectionChange(cardIndex, si, { [key]: urls });
  };

  const removeMedia = (si: number, key: MediaKey, at: number) => {
    onSectionChange(cardIndex, si, { [key]: listOf(si, key).filter((_, i) => i !== at) });
  };

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, si) => {
        const key: MediaKey = section.type === "videos" ? "videos" : "images";
        const urls = listOf(si, key);
        return (
          <div
            key={si}
            className="flex flex-col gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Button {si + 1}
            </span>

            <div className="flex flex-col gap-1">
              <label className={LABEL}>Name</label>
              <input
                className={FIELD}
                value={card.sections?.[si]?.name ?? section.name}
                disabled={disabled}
                placeholder={si === 0 ? "Build" : "Technology"}
                onChange={(e) => onSectionChange(cardIndex, si, { name: e.target.value })}
              />
            </div>

            {/* Section type — what this button opens */}
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>Opens</label>
              <div className="flex items-center gap-1">
                {(
                  [
                    { type: "images", label: "Image slideshow" },
                    { type: "videos", label: "Videos grid" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSectionChange(cardIndex, si, { type: opt.type })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                      section.type === opt.type
                        ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                        : "text-zinc-500 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>{key === "videos" ? "Videos" : "Slideshow images"}</label>

              {urls.map((url, ii) => (
                <div
                  key={`${ii}-${url}`}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-1.5"
                >
                  {key === "videos" ? (
                    <video
                      src={url}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-12 w-16 shrink-0 rounded-md object-cover bg-black"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt=""
                      className="h-12 w-16 shrink-0 rounded-md object-cover bg-zinc-100 dark:bg-zinc-800"
                    />
                  )}
                  <span className="flex-1 truncate text-[11px] text-zinc-500">{url.split("/").pop()}</span>
                  <button
                    type="button"
                    disabled={disabled || ii === 0}
                    onClick={() => moveMedia(si, key, ii, ii - 1)}
                    className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled || ii === urls.length - 1}
                    onClick={() => moveMedia(si, key, ii, ii + 1)}
                    className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeMedia(si, key, ii)}
                    className="p-1.5 rounded-md text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 disabled:opacity-30"
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                disabled={disabled}
                onClick={() => setPicker({ section: si, key })}
                className="flex items-center justify-center gap-2 py-4 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
              >
                <ImageIcon className="h-4 w-4" />
                {key === "videos" ? "Add videos" : "Add images"}
              </button>
            </div>
          </div>
        );
      })}

      {/* multi: the picker stays open so any number of items can be added in one go;
          each click appends (state updates re-render this closure with the fresh list). */}
      <MediaPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        multi
        accept={picker?.key === "videos" ? "video" : "image"}
        onSelect={(url) => {
          if (picker !== null) {
            onSectionChange(cardIndex, picker.section, {
              [picker.key]: [...listOf(picker.section, picker.key), url],
            });
          }
        }}
      />
    </div>
  );
}
