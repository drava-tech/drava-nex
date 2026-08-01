"use client";

import React, { useState } from "react";
import { ArrowDown, ArrowUp, ImageIcon, Plus, X } from "lucide-react";
import { MediaPicker } from "@/components/media-picker";
import {
  normalizeSections,
  newPortfolioProject,
  companyLinks,
  GALLERY_PHOTO_COUNT,
  type OverviewCard,
  type PortfolioProject,
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

          <div className="flex flex-col gap-1">
            <label className={LABEL}>Description</label>
            <textarea
              className={FIELD}
              rows={3}
              value={card.description ?? ""}
              disabled={disabled}
              onChange={(e) => onChange(i, "description", e.target.value)}
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
 * vertical's page, the section type (image slideshow, videos grid or gallery),
 * and that type's content.
 *
 * The two media types edit a flat list of URLs. A gallery instead edits a list
 * of companies — see ProjectsEditor — because a category holds one page per
 * client, and the client's name is what links its pages together.
 */
export function SectionFields({
  card,
  cardIndex,
  allCards,
  disabled,
  onSectionChange,
}: {
  card: OverviewCard;
  cardIndex: number;
  /**
   * Every card, not just the one being edited — the gallery editor shows which
   * other categories already hold each company, which can't be answered from
   * one card alone.
   */
  allCards: OverviewCard[];
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
                    { type: "gallery", label: "Gallery" },
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

            {section.type === "gallery" ? (
              <ProjectsEditor
                projects={section.projects ?? []}
                disabled={disabled}
                titlePlaceholder={section.name}
                matchesFor={(pi) =>
                  companyLinks(allCards, {
                    cardIndex,
                    sectionIndex: si,
                    projectIndex: pi,
                  }).map((l) => l.label)
                }
                onChange={(projects) => onSectionChange(cardIndex, si, { projects })}
              />
            ) : (
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
            )}
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

/**
 * The companies whose work sits in one gallery category — one page each, with
 * its own copy and four photos.
 *
 * The Company field is the point of the whole thing: it never appears on
 * screen, and its only job is to match this page to the same client's pages in
 * other categories, which is what draws the jump buttons on the gallery layout.
 * Matching is on the slugified name, so capitalisation and spacing don't have
 * to agree. The live "links to" line under the field keeps that visible while
 * typing, rather than leaving it to be discovered on the screen.
 */
function ProjectsEditor({
  projects,
  disabled,
  titlePlaceholder,
  matchesFor,
  onChange,
}: {
  projects: PortfolioProject[];
  disabled?: boolean;
  /** The category name, which the layout falls back to when a title is blank. */
  titlePlaceholder: string;
  /** Other categories already holding the company in this slot. */
  matchesFor: (projectIndex: number) => string[];
  onChange: (projects: PortfolioProject[]) => void;
}) {
  const [picker, setPicker] = useState<number | null>(null);

  const patch = (pi: number, p: Partial<PortfolioProject>) =>
    onChange(projects.map((proj, i) => (i === pi ? { ...proj, ...p } : proj)));

  const reorder = <T,>(list: T[], from: number, to: number): T[] | null => {
    if (to < 0 || to >= list.length) return null;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    return next;
  };

  const moveProject = (from: number, to: number) => {
    const next = reorder(projects, from, to);
    if (next) onChange(next);
  };

  const moveImage = (pi: number, from: number, to: number) => {
    const next = reorder(projects[pi]?.images ?? [], from, to);
    if (next) patch(pi, { images: next });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className={LABEL}>Companies</label>
        <p className="text-[11px] leading-relaxed text-zinc-400">
          One page per company. Give two categories the same company name and each page gets
          a button through to the other.
        </p>
      </div>

      {projects.map((project, pi) => {
        const images = project.images ?? [];
        const matches = matchesFor(pi);
        return (
          <div
            key={pi}
            className="flex flex-col gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3"
          >
            <div className="flex items-center gap-1">
              <span className="flex-1 truncate text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                {project.company.trim() || `Company ${pi + 1}`}
              </span>
              <button
                type="button"
                disabled={disabled || pi === 0}
                onClick={() => moveProject(pi, pi - 1)}
                className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                title="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={disabled || pi === projects.length - 1}
                onClick={() => moveProject(pi, pi + 1)}
                className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                title="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                // A category always renders its first project, so the last one
                // can't go — emptying the list would resurrect the pre-companies
                // fallback and quietly swap the page's copy back.
                disabled={disabled || projects.length <= 1}
                onClick={() => onChange(projects.filter((_, i) => i !== pi))}
                className="p-1.5 rounded-md text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 disabled:opacity-30"
                title={
                  projects.length <= 1 ? "A category needs at least one company" : "Remove company"
                }
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <label className={LABEL}>Company</label>
              <input
                className={FIELD}
                value={project.company}
                disabled={disabled}
                placeholder="Collins Aerospace"
                onChange={(e) => patch(pi, { company: e.target.value })}
              />
              <p className="text-[11px] leading-relaxed text-zinc-400">
                {matches.length > 0
                  ? `Links to: ${matches.join(", ")}`
                  : project.company.trim()
                    ? "No other category has this company yet."
                    : "Not shown on screen — it only links this page to the same company elsewhere."}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label className={LABEL}>Title</label>
              <input
                className={FIELD}
                value={project.title ?? ""}
                disabled={disabled}
                placeholder={titlePlaceholder}
                onChange={(e) => patch(pi, { title: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className={LABEL}>Subtitle</label>
              <input
                className={FIELD}
                value={project.subtitle ?? ""}
                disabled={disabled}
                placeholder="Corporate Films"
                onChange={(e) => patch(pi, { subtitle: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className={LABEL}>Description</label>
              <textarea
                className={`${FIELD} min-h-[88px] resize-y`}
                value={project.description ?? ""}
                disabled={disabled}
                onChange={(e) => patch(pi, { description: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>Photos (first {GALLERY_PHOTO_COUNT} used)</label>
              <p className="text-[11px] leading-relaxed text-zinc-400">
                The first image is the large feature photo; the next three sit in the row below.
              </p>

              {images.map((url, ii) => (
                <div
                  key={`${ii}-${url}`}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-1.5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="h-12 w-16 shrink-0 rounded-md object-cover bg-zinc-100 dark:bg-zinc-800"
                  />
                  <span className="flex-1 truncate text-[11px] text-zinc-500">
                    {url.split("/").pop()}
                  </span>
                  <button
                    type="button"
                    disabled={disabled || ii === 0}
                    onClick={() => moveImage(pi, ii, ii - 1)}
                    className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled || ii === images.length - 1}
                    onClick={() => moveImage(pi, ii, ii + 1)}
                    className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => patch(pi, { images: images.filter((_, i) => i !== ii) })}
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
                onClick={() => setPicker(pi)}
                className="flex items-center justify-center gap-2 py-4 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
              >
                <ImageIcon className="h-4 w-4" />
                Add images
              </button>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...projects, newPortfolioProject()])}
        className="flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        Add company
      </button>

      {/* multi, like the media lists above: the picker stays open so a whole set
          can be added in one go, each click appending to the fresh list. */}
      <MediaPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        multi
        accept="image"
        onSelect={(url) => {
          if (picker !== null) {
            patch(picker, { images: [...(projects[picker]?.images ?? []), url] });
          }
        }}
      />
    </div>
  );
}
