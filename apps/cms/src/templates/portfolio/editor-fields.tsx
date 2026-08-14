"use client";

import React, { useState } from "react";
import { ArrowDown, ArrowUp, ImageIcon, Plus, X } from "lucide-react";
import { MediaPicker } from "@/components/media-picker";
import { CompanyPicker } from "@/components/company-picker";
import {
  createPortfolioProjectAction,
  updatePortfolioProjectAction,
  deletePortfolioProjectAction,
  reorderPortfolioProjectsAction,
  addPortfolioProjectImageAction,
  removePortfolioProjectImageAction,
  reorderPortfolioProjectImagesAction,
  addPortfolioProjectVideoAction,
  removePortfolioProjectVideoAction,
  reorderPortfolioProjectVideosAction,
} from "@/actions/portfolio-actions";
import {
  normalizeSections,
  companyLinks,
  GALLERY_PHOTO_COUNT,
  type OverviewCard,
  type PortfolioContent,
  type PortfolioSection,
} from "@platform/ui/templates/portfolio";

const FIELD =
  "w-full bg-zinc-100 border border-zinc-300 focus:border-zinc-500 dark:bg-zinc-800 dark:border-zinc-700 dark:focus:border-zinc-500 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none transition-colors disabled:opacity-50";
const LABEL = "text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-[0.15em]";

/**
 * A company's project, as it actually exists in the editor now: a real
 * `portfolio_project` row (Section 14) rather than a JSONB-blob entry with
 * no identity — every field write here is an immediate API call, not staged
 * local state for a later whole-blob Save.
 */
export interface EditableProject {
  id: string;
  companyId: string | null;
  company: string;
  title?: string;
  subtitle?: string;
  description?: string;
  images: string[];
  imageIds: string[];
  videos: string[];
  videoIds: string[];
}

export interface EditableSection extends Omit<PortfolioSection, "projects"> {
  /** Real portfolio_category.id — the "gallery" type's projects are the only
   *  thing in the editor that's relationally live; this is what "Add company"
   *  posts to. */
  categoryId: string;
  projects?: EditableProject[];
}

export interface EditableCard extends Omit<OverviewCard, "sections"> {
  sections?: EditableSection[];
}

/** `getPortfolioTree`'s return shape, as seen by the editor (with row ids). */
export interface EditablePortfolioContent extends Omit<PortfolioContent, "overview"> {
  overview: Omit<PortfolioContent["overview"], "cards"> & { cards: EditableCard[] };
}

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
  card: EditableCard;
  cardIndex: number;
  /**
   * Every card, not just the one being edited — the gallery editor shows which
   * other categories already hold each company, which can't be answered from
   * one card alone.
   */
  allCards: EditableCard[];
  disabled?: boolean;
  onSectionChange: (cardIndex: number, sectionIndex: number, patch: Partial<EditableSection>) => void;
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

            {section.type === "gallery" || section.type === "videos" ? (
              <ProjectsEditor
                // Read straight off the raw (unnormalized) card, not the
                // normalizeSections() result above — normalizing rebuilds
                // every project object from scratch and doesn't carry the
                // real row ids this editor now needs to save against.
                projects={card.sections?.[si]?.projects ?? []}
                categoryId={card.sections?.[si]?.categoryId ?? ""}
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
  categoryId,
  disabled,
  titlePlaceholder,
  matchesFor,
  onChange,
}: {
  projects: EditableProject[];
  /** The real portfolio_category row this list belongs to — "Add company" posts here. */
  categoryId: string;
  disabled?: boolean;
  /** The category name, which the layout falls back to when a title is blank. */
  titlePlaceholder: string;
  /** Other categories already holding the company in this slot. */
  matchesFor: (projectIndex: number) => string[];
  onChange: (projects: EditableProject[]) => void;
}) {
  const [picker, setPicker] = useState<number | null>(null);
  const [videoPicker, setVideoPicker] = useState<number | null>(null);
  // Keyed by project id (or "__add" for the create-company action) — disables
  // just that row's controls while its own request is in flight, and
  // "__list" for a failure that isn't about any one row (e.g. reorder).
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isBusy = (key: string) => Boolean(busy[key]);
  const setRowBusy = (key: string, value: boolean) =>
    setBusy((b) => ({ ...b, [key]: value }));
  const setRowError = (key: string, message: string) =>
    setErrors((e) => ({ ...e, [key]: message }));

  const patch = (pi: number, p: Partial<EditableProject>) =>
    onChange(projects.map((proj, i) => (i === pi ? { ...proj, ...p } : proj)));

  const reorder = <T,>(list: T[], from: number, to: number): T[] | null => {
    if (to < 0 || to >= list.length) return null;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    return next;
  };

  // Every mutation below fires its API call immediately (this project row is
  // a real `portfolio_project` — there's no "Save" button for it anymore),
  // then updates local state from the result so the live preview and
  // companyLinks() stay in sync.

  const handleSelectCompany = async (pi: number, company: { id: string; name: string }) => {
    const project = projects[pi]!;
    setRowBusy(project.id, true);
    const res = await updatePortfolioProjectAction(project.id, { companyId: company.id });
    setRowBusy(project.id, false);
    if (res.success) {
      setRowError(project.id, "");
      patch(pi, { company: company.name, companyId: company.id });
    } else {
      setRowError(project.id, res.error ?? "Failed to link company.");
    }
  };

  const handleCreateCompany = async (pi: number, name: string) => {
    const project = projects[pi]!;
    setRowBusy(project.id, true);
    const res = await updatePortfolioProjectAction(project.id, { newCompanyName: name });
    setRowBusy(project.id, false);
    if (res.success && res.data) {
      setRowError(project.id, "");
      patch(pi, { company: name, companyId: res.data.companyId });
    } else {
      setRowError(project.id, res.error ?? "Failed to create company.");
    }
  };

  const handleFieldBlur = async (
    pi: number,
    field: "title" | "subtitle" | "description",
    value: string
  ) => {
    const project = projects[pi]!;
    const res = await updatePortfolioProjectAction(project.id, { [field]: value || null });
    if (!res.success) setRowError(project.id, res.error ?? "Failed to save.");
  };

  const handleAddCompany = async () => {
    setRowBusy("__add", true);
    const res = await createPortfolioProjectAction(categoryId, {});
    setRowBusy("__add", false);
    if (res.success && res.data) {
      const row = res.data;
      onChange([
        ...projects,
        {
          id: row.id,
          companyId: row.companyId,
          company: "",
          images: [],
          imageIds: [],
          videos: [],
          videoIds: [],
        },
      ]);
      setRowError("__list", "");
    } else {
      setRowError("__list", res.error ?? "Failed to add company.");
    }
  };

  const handleRemoveCompany = async (pi: number) => {
    const project = projects[pi]!;
    setRowBusy(project.id, true);
    const res = await deletePortfolioProjectAction(project.id);
    setRowBusy(project.id, false);
    if (res.success) {
      onChange(projects.filter((_, i) => i !== pi));
    } else {
      setRowError(project.id, res.error ?? "Failed to remove company.");
    }
  };

  // Reorders are applied optimistically (they're just a display order swap,
  // not new content) and rolled back if the request fails.
  const moveProject = async (from: number, to: number) => {
    const next = reorder(projects, from, to);
    if (!next) return;
    const previous = projects;
    onChange(next);
    const res = await reorderPortfolioProjectsAction(categoryId, next.map((p) => p.id));
    if (!res.success) {
      onChange(previous);
      setRowError("__list", res.error ?? "Failed to reorder companies.");
    }
  };

  const handleAddImage = async (pi: number, url: string) => {
    const project = projects[pi]!;
    const res = await addPortfolioProjectImageAction(project.id, url);
    if (res.success && res.data) {
      patch(pi, {
        images: [...project.images, url],
        imageIds: [...project.imageIds, res.data.id],
      });
    } else {
      setRowError(project.id, res.error ?? "Failed to add image.");
    }
  };

  const handleRemoveImage = async (pi: number, ii: number) => {
    const project = projects[pi]!;
    const imageId = project.imageIds[ii];
    if (!imageId) return;
    const res = await removePortfolioProjectImageAction(project.id, imageId);
    if (res.success) {
      patch(pi, {
        images: project.images.filter((_, i) => i !== ii),
        imageIds: project.imageIds.filter((_, i) => i !== ii),
      });
    } else {
      setRowError(project.id, res.error ?? "Failed to remove image.");
    }
  };

  const moveImage = async (pi: number, from: number, to: number) => {
    const project = projects[pi]!;
    const nextImages = reorder(project.images, from, to);
    const nextIds = reorder(project.imageIds, from, to);
    if (!nextImages || !nextIds) return;
    const prevImages = project.images;
    const prevIds = project.imageIds;
    patch(pi, { images: nextImages, imageIds: nextIds });
    const res = await reorderPortfolioProjectImagesAction(project.id, nextIds);
    if (!res.success) {
      patch(pi, { images: prevImages, imageIds: prevIds });
      setRowError(project.id, res.error ?? "Failed to reorder images.");
    }
  };

  const handleAddVideo = async (pi: number, url: string) => {
    const project = projects[pi]!;
    const res = await addPortfolioProjectVideoAction(project.id, url);
    if (res.success && res.data) {
      patch(pi, {
        videos: [...project.videos, url],
        videoIds: [...project.videoIds, res.data.id],
      });
    } else {
      setRowError(project.id, res.error ?? "Failed to add video.");
    }
  };

  const handleRemoveVideo = async (pi: number, vi: number) => {
    const project = projects[pi]!;
    const videoId = project.videoIds[vi];
    if (!videoId) return;
    const res = await removePortfolioProjectVideoAction(project.id, videoId);
    if (res.success) {
      patch(pi, {
        videos: project.videos.filter((_, i) => i !== vi),
        videoIds: project.videoIds.filter((_, i) => i !== vi),
      });
    } else {
      setRowError(project.id, res.error ?? "Failed to remove video.");
    }
  };

  const moveVideo = async (pi: number, from: number, to: number) => {
    const project = projects[pi]!;
    const nextVideos = reorder(project.videos, from, to);
    const nextIds = reorder(project.videoIds, from, to);
    if (!nextVideos || !nextIds) return;
    const prevVideos = project.videos;
    const prevIds = project.videoIds;
    patch(pi, { videos: nextVideos, videoIds: nextIds });
    const res = await reorderPortfolioProjectVideosAction(project.id, nextIds);
    if (!res.success) {
      patch(pi, { videos: prevVideos, videoIds: prevIds });
      setRowError(project.id, res.error ?? "Failed to reorder videos.");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className={LABEL}>Companies</label>
        <p className="text-[11px] leading-relaxed text-zinc-400">
          One page per company. Give two categories the same company and each page gets a
          button through to the other. Every change here saves immediately.
        </p>
      </div>

      {projects.map((project, pi) => {
        const matches = matchesFor(pi);
        const rowDisabled = disabled || isBusy(project.id);
        return (
          <div
            key={project.id}
            className="flex flex-col gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3"
          >
            <div className="flex items-center gap-1">
              <span className="flex-1 truncate text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                {project.company.trim() || `Company ${pi + 1}`}
              </span>
              <button
                type="button"
                disabled={rowDisabled || pi === 0}
                onClick={() => moveProject(pi, pi - 1)}
                className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                title="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={rowDisabled || pi === projects.length - 1}
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
                disabled={rowDisabled || projects.length <= 1}
                onClick={() => handleRemoveCompany(pi)}
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
              <CompanyPicker
                value={project.company}
                disabled={rowDisabled}
                onSelect={(company) => handleSelectCompany(pi, company)}
                onCreateNew={(name) => handleCreateCompany(pi, name)}
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
                disabled={rowDisabled}
                placeholder={titlePlaceholder}
                onChange={(e) => patch(pi, { title: e.target.value })}
                onBlur={(e) => handleFieldBlur(pi, "title", e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className={LABEL}>Subtitle</label>
              <input
                className={FIELD}
                value={project.subtitle ?? ""}
                disabled={rowDisabled}
                placeholder="Corporate Films"
                onChange={(e) => patch(pi, { subtitle: e.target.value })}
                onBlur={(e) => handleFieldBlur(pi, "subtitle", e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className={LABEL}>Description</label>
              <textarea
                className={`${FIELD} min-h-[88px] resize-y`}
                value={project.description ?? ""}
                disabled={rowDisabled}
                onChange={(e) => patch(pi, { description: e.target.value })}
                onBlur={(e) => handleFieldBlur(pi, "description", e.target.value)}
              />
            </div>

            {errors[project.id] ? (
              <p className="text-[11px] text-red-500 dark:text-red-400">{errors[project.id]}</p>
            ) : null}

            {/* Videos (optional) — shown when this company's category is the
                video-grid kind (e.g. Brand Films). With none, no grid. */}
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>Videos (optional)</label>

              {project.videos.map((url, vi) => (
                <div
                  key={project.videoIds[vi] ?? `${vi}-${url}`}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-1.5"
                >
                  <video
                    src={url}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-12 w-16 shrink-0 rounded-md object-cover bg-black"
                  />
                  <span className="flex-1 truncate text-[11px] text-zinc-500">
                    {url.split("/").pop()}
                  </span>
                  <button
                    type="button"
                    disabled={rowDisabled || vi === 0}
                    onClick={() => moveVideo(pi, vi, vi - 1)}
                    className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={rowDisabled || vi === project.videos.length - 1}
                    onClick={() => moveVideo(pi, vi, vi + 1)}
                    className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={rowDisabled}
                    onClick={() => handleRemoveVideo(pi, vi)}
                    className="p-1.5 rounded-md text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 disabled:opacity-30"
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                disabled={rowDisabled}
                onClick={() => setVideoPicker(pi)}
                className="flex items-center justify-center gap-2 py-4 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
              >
                ▶ Add videos
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>Photos (first {GALLERY_PHOTO_COUNT} used)</label>
              <p className="text-[11px] leading-relaxed text-zinc-400">
                The first image is the large feature photo; the next three sit in the row below.
              </p>

              {project.images.map((url, ii) => (
                <div
                  key={project.imageIds[ii] ?? `${ii}-${url}`}
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
                    disabled={rowDisabled || ii === 0}
                    onClick={() => moveImage(pi, ii, ii - 1)}
                    className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={rowDisabled || ii === project.images.length - 1}
                    onClick={() => moveImage(pi, ii, ii + 1)}
                    className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={rowDisabled}
                    onClick={() => handleRemoveImage(pi, ii)}
                    className="p-1.5 rounded-md text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 disabled:opacity-30"
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                disabled={rowDisabled}
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

      {errors["__list"] ? (
        <p className="text-[11px] text-red-500 dark:text-red-400">{errors["__list"]}</p>
      ) : null}

      <button
        type="button"
        disabled={disabled || isBusy("__add") || !categoryId}
        onClick={handleAddCompany}
        className="flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        Add company
      </button>

      {/* multi: the picker stays open so a whole set can be added in one go,
          each click firing its own upload-then-link request. */}
      <MediaPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        multi
        accept="image"
        onSelect={(url) => {
          if (picker !== null) handleAddImage(picker, url);
        }}
      />

      <MediaPicker
        open={videoPicker !== null}
        onClose={() => setVideoPicker(null)}
        multi
        accept="video"
        onSelect={(url) => {
          if (videoPicker !== null) handleAddVideo(videoPicker, url);
        }}
      />
    </div>
  );
}
