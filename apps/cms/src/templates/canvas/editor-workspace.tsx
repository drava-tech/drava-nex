"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Maximize,
  MonitorUp,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Experience } from "@platform/db";
import {
  CanvasThumbnail,
  blankPage,
  canvasId,
  canvasOrientation,
  clonePage,
  makeImage,
  makeVideo,
  normalizeCanvasContent,
  resizeCanvas,
  type CanvasContent,
  type CanvasElement,
  type CanvasPage,
} from "@platform/ui/templates/canvas";
import { updateExperience, updateExperienceTemplateContent } from "@/actions/experience-actions";
import { assignExperience, assignMedia } from "@/actions/screen-actions";
import { MediaPicker, type MediaPickerItem } from "@/components/media-picker";
import { PushToScreenModal } from "@/components/push-to-screen-modal";
import { useHistory } from "./use-history";
import { EditorStage } from "./editor-stage";
import { EditorLeftPanel } from "./editor-left-panel";
import { EditorRightPanel, type AlignKind, type ArrangeKind } from "./editor-right-panel";
import { aabb, unionBox } from "./geometry";
import "./fonts";

type MediaTarget =
  | { kind: "add"; type: "image" | "video" }
  | { kind: "replace"; id: string; type: "image" | "video" }
  | { kind: "background" };

const ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * The Frames editor (Canva-style) for a Design experience. Full-tab and
 * chrome-free, opened at /edit/experiences/<slug> like every template's editor.
 */
export function CanvasEditorWorkspace({
  experience,
  initialContent,
}: {
  experience: Experience;
  initialContent: CanvasContent;
}) {
  const router = useRouter();
  const history = useHistory<CanvasContent>(normalizeCanvasContent(initialContent));
  const content = history.value;
  const { set, begin, end, undo, redo } = history;

  const [pageIndex, setPageIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [name, setName] = useState(experience.name);
  const [savedName, setSavedName] = useState(experience.name);
  const [savedContent, setSavedContent] = useState<CanvasContent>(content);
  const [mediaTarget, setMediaTarget] = useState<MediaTarget | null>(null);
  const [pushOpen, setPushOpen] = useState(false);
  const [isSaving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const clipboard = useRef<CanvasElement[]>([]);

  const safeIndex = Math.min(pageIndex, content.pages.length - 1);
  const page = content.pages[safeIndex]!;
  const dirty = content !== savedContent || name.trim() !== savedName;

  // ── Mutators ─────────────────────────────────────────────────────────────

  const setPage = useCallback(
    (fn: (p: CanvasPage) => CanvasPage, opts?: { record?: boolean }) => {
      set(
        (c) => {
          const idx = Math.min(pageIndex, c.pages.length - 1);
          const cur = c.pages[idx]!;
          const next = fn(cur);
          if (next === cur) return c;
          const pages = c.pages.slice();
          pages[idx] = next;
          return { ...c, pages };
        },
        opts
      );
    },
    [pageIndex, set]
  );

  /** Updates the current page's elements; a no-op map keeps the old state (no re-render, no undo step). */
  const updateElements = useCallback(
    (fn: (els: CanvasElement[]) => CanvasElement[], opts?: { record?: boolean }) => {
      setPage((p) => {
        const next = fn(p.elements);
        const same = next.length === p.elements.length && next.every((e, i) => e === p.elements[i]);
        return same ? p : { ...p, elements: next };
      }, opts);
    },
    [setPage]
  );

  const patchElements = useCallback(
    (ids: string[], patch: Partial<CanvasElement> | ((el: CanvasElement) => CanvasElement)) => {
      const set_ = new Set(ids);
      updateElements((els) =>
        els.map((el) =>
          set_.has(el.id) ? (typeof patch === "function" ? patch(el) : ({ ...el, ...patch } as CanvasElement)) : el
        )
      );
    },
    [updateElements]
  );

  const addElement = (el: CanvasElement) => {
    updateElements((els) => [...els, el]);
    setSelectedIds([el.id]);
    setEditingId(null);
  };

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const ids = new Set(selectedIds);
    updateElements((els) => els.filter((e) => !ids.has(e.id) || e.locked));
    setSelectedIds([]);
  }, [selectedIds, updateElements]);

  const paste = useCallback(
    (items: CanvasElement[], offset: number) => {
      if (items.length === 0) return;
      const copies = items.map((el) => ({ ...el, id: canvasId(), x: el.x + offset, y: el.y + offset, locked: false }));
      updateElements((els) => [...els, ...copies]);
      setSelectedIds(copies.map((c) => c.id));
    },
    [updateElements]
  );

  const duplicateSelected = useCallback(() => {
    const items = page.elements.filter((e) => selectedIds.includes(e.id));
    paste(items, Math.round(Math.min(content.width, content.height) * 0.03));
  }, [content.height, content.width, page.elements, paste, selectedIds]);

  const arrange = (kind: ArrangeKind) => {
    const ids = new Set(selectedIds);
    updateElements((els) => {
      const sel = els.filter((e) => ids.has(e.id));
      const rest = els.filter((e) => !ids.has(e.id));
      if (kind === "front") return [...rest, ...sel];
      if (kind === "back") return [...sel, ...rest];
      const out = els.slice();
      const order = kind === "forward" ? [...out.keys()].reverse() : [...out.keys()];
      for (const i of order) {
        const j = kind === "forward" ? i + 1 : i - 1;
        if (!ids.has(out[i]!.id) || j < 0 || j >= out.length || ids.has(out[j]!.id)) continue;
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    });
  };

  const moveLayer = (id: string, dir: 1 | -1) => {
    updateElements((els) => {
      const i = els.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= els.length) return els;
      const out = els.slice();
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });
  };

  /** One element aligns to the page; several align to their shared bounds. */
  const align = (kind: AlignKind) => {
    const sel = page.elements.filter((e) => selectedIds.includes(e.id) && !e.locked);
    if (sel.length === 0) return;
    const frame =
      sel.length === 1 ? { x: 0, y: 0, w: content.width, h: content.height } : unionBox(sel.map((e) => aabb(e)))!;
    const ids = new Set(sel.map((e) => e.id));
    updateElements((els) =>
      els.map((el) => {
        if (!ids.has(el.id)) return el;
        const b = aabb(el);
        // Shift by how far the element's visual bounds are from the target.
        let dx = 0;
        let dy = 0;
        if (kind === "left") dx = frame.x - b.x;
        if (kind === "hcenter") dx = frame.x + frame.w / 2 - (b.x + b.w / 2);
        if (kind === "right") dx = frame.x + frame.w - (b.x + b.w);
        if (kind === "top") dy = frame.y - b.y;
        if (kind === "vcenter") dy = frame.y + frame.h / 2 - (b.y + b.h / 2);
        if (kind === "bottom") dy = frame.y + frame.h - (b.y + b.h);
        return { ...el, x: el.x + dx, y: el.y + dy };
      })
    );
  };

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const ids = new Set(selectedIds);
      updateElements((els) => els.map((el) => (ids.has(el.id) && !el.locked ? { ...el, x: el.x + dx, y: el.y + dy } : el)));
    },
    [selectedIds, updateElements]
  );

  // ── Pages ────────────────────────────────────────────────────────────────

  const goToPage = (i: number) => {
    setPageIndex(i);
    setSelectedIds([]);
    setEditingId(null);
  };

  const addPage = () => {
    const bg = page.background;
    set((c) => ({ ...c, pages: [...c.pages.slice(0, safeIndex + 1), blankPage({ color: bg.color }), ...c.pages.slice(safeIndex + 1)] }));
    goToPage(safeIndex + 1);
  };

  const duplicatePage = (i: number) => {
    set((c) => ({ ...c, pages: [...c.pages.slice(0, i + 1), clonePage(c.pages[i]!), ...c.pages.slice(i + 1)] }));
    goToPage(i + 1);
  };

  const deletePage = (i: number) => {
    if (content.pages.length < 2) return;
    set((c) => ({ ...c, pages: c.pages.filter((_, k) => k !== i) }));
    goToPage(Math.max(0, Math.min(i, content.pages.length - 2)));
  };

  const movePage = (from: number, to: number) => {
    if (to < 0 || to >= content.pages.length) return;
    set((c) => {
      const pages = c.pages.slice();
      const [p] = pages.splice(from, 1);
      pages.splice(to, 0, p!);
      return { ...c, pages };
    });
    setPageIndex(to);
  };

  // ── Media ────────────────────────────────────────────────────────────────

  const onMediaPicked = async (item: MediaPickerItem) => {
    const target = mediaTarget;
    setMediaTarget(null);
    if (!target) return;
    if (target.kind === "background") {
      setPage((p) => ({ ...p, background: { ...p.background, imageUrl: item.url, imageAssetId: item.id } }));
      return;
    }
    if (target.kind === "replace") {
      patchElements([target.id], { src: item.url, assetId: item.id } as Partial<CanvasElement>);
      return;
    }
    const isVideo = target.type === "video" || item.type === "video";
    const natural = await mediaSize(item.url, isVideo);
    const maxW = content.width * 0.6;
    const maxH = content.height * 0.6;
    const s = Math.min(maxW / natural.w, maxH / natural.h, 1.5);
    const w = natural.w * s;
    const h = natural.h * s;
    const box = { x: (content.width - w) / 2, y: (content.height - h) / 2, w, h };
    addElement(isVideo ? makeVideo(box, item.url, { assetId: item.id }) : makeImage(box, item.url, { assetId: item.id }));
  };

  // ── Save / push ──────────────────────────────────────────────────────────

  const save = useCallback(
    (then?: () => void) => {
      setError(null);
      const snapshot = content;
      const nextName = name.trim() || savedName;
      startSaving(async () => {
        const res = await updateExperienceTemplateContent(experience.id, "canvas", snapshot);
        if (!res.success) {
          setError(res.error ?? "Couldn't save.");
          return;
        }
        if (nextName !== savedName) {
          const r2 = await updateExperience(experience.id, {
            name: nextName,
            slug: experience.slug,
            templateKey: "canvas",
            typeIds: [],
          });
          if (!r2.success) {
            setError(r2.error ?? "Saved the design, but couldn't rename it.");
          } else {
            setSavedName(nextName);
          }
        }
        setSavedContent(snapshot);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1600);
        then?.();
      });
    },
    [content, experience.id, experience.slug, name, savedName]
  );

  const openPreview = () => {
    const go = () => window.open(`/preview/experiences/${experience.slug}`, "_blank", "noopener");
    if (dirty) save(go);
    else go();
  };

  const openPush = () => {
    if (dirty) save(() => setPushOpen(true));
    else setPushOpen(true);
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ── Keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (typing || mediaTarget || pushOpen) return;

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        setEditingId(null);
      } else if (mod && key === "y") {
        e.preventDefault();
        redo();
      } else if (mod && key === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (mod && key === "a") {
        e.preventDefault();
        setSelectedIds(page.elements.map((el) => el.id));
      } else if (mod && key === "c") {
        clipboard.current = page.elements.filter((el) => selectedIds.includes(el.id));
      } else if (mod && key === "x") {
        clipboard.current = page.elements.filter((el) => selectedIds.includes(el.id));
        deleteSelected();
      } else if (mod && key === "v") {
        e.preventDefault();
        paste(clipboard.current, Math.round(Math.min(content.width, content.height) * 0.02));
      } else if (key === "delete" || key === "backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (key === "escape") {
        setSelectedIds([]);
      } else if (key === "enter" && selectedIds.length === 1) {
        const el = page.elements.find((x) => x.id === selectedIds[0]);
        if (el?.type === "text" && !el.locked) {
          e.preventDefault();
          setEditingId(el.id);
        }
      } else if (key.startsWith("arrow") && selectedIds.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        nudge(key === "arrowleft" ? -step : key === "arrowright" ? step : 0, key === "arrowup" ? -step : key === "arrowdown" ? step : 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [content.height, content.width, deleteSelected, duplicateSelected, mediaTarget, nudge, page.elements, paste, pushOpen, redo, save, selectedIds, undo]);

  // Drop stale ids after undo/redo or page changes.
  useEffect(() => {
    const live = new Set(page.elements.map((e) => e.id));
    setSelectedIds((ids) => (ids.every((i) => live.has(i)) ? ids : ids.filter((i) => live.has(i))));
    if (editingId && !live.has(editingId)) setEditingId(null);
  }, [editingId, page.elements]);

  const selected = useMemo(
    () => page.elements.filter((e) => selectedIds.includes(e.id)),
    [page.elements, selectedIds]
  );

  const zoomStep = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 1e-6);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + dir))]!;
    setZoom(next);
  };

  const orientation = canvasOrientation(content.width, content.height);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* ── Header ── */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 text-card-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/frames"
            onClick={(e) => {
              if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) e.preventDefault();
            }}
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="Back to Frames"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="Design name"
              className="w-[260px] truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold text-foreground outline-none hover:border-border focus:border-violet-500"
            />
            <p className="px-1.5 text-[11px] capitalize text-muted-foreground">
              {orientation} · {content.width}×{content.height} · {content.pages.length} page{content.pages.length === 1 ? "" : "s"}
              {dirty && <span className="normal-case"> · unsaved changes</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <HeaderBtn title="Undo (Ctrl+Z)" onClick={undo} disabled={!history.canUndo}>
            <Undo2 className="h-4 w-4" />
          </HeaderBtn>
          <HeaderBtn title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!history.canRedo}>
            <Redo2 className="h-4 w-4" />
          </HeaderBtn>
          <div className="mx-2 h-5 w-px bg-border" />
          <HeaderBtn title="Zoom out" onClick={() => zoomStep(-1)}>
            <ZoomOut className="h-4 w-4" />
          </HeaderBtn>
          <button
            type="button"
            data-plain
            onClick={() => setZoom(1)}
            title="Fit to screen"
            className="w-14 rounded-md py-1 text-center text-xs tabular-nums text-muted-foreground hover:bg-accent"
          >
            {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
          </button>
          <HeaderBtn title="Zoom in" onClick={() => zoomStep(1)}>
            <ZoomIn className="h-4 w-4" />
          </HeaderBtn>
          <HeaderBtn title="Fit" onClick={() => setZoom(1)}>
            <Maximize className="h-4 w-4" />
          </HeaderBtn>
        </div>

        <div className="flex items-center gap-2">
          {error && <span className="max-w-[240px] truncate text-xs text-red-500" title={error}>{error}</span>}
          <button
            type="button"
            onClick={openPreview}
            className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Preview
          </button>
          <button
            type="button"
            onClick={() => save()}
            disabled={isSaving || !dirty}
            className="flex min-w-[84px] items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : justSaved ? <Check className="h-3.5 w-3.5" /> : null}
            {isSaving ? "Saving…" : justSaved ? "Saved" : "Save"}
          </button>
          <button
            type="button"
            onClick={openPush}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <MonitorUp className="h-3.5 w-3.5" /> Push to screen
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1">
        <EditorLeftPanel
          width={content.width}
          height={content.height}
          page={page}
          selectedIds={selectedIds}
          onAdd={addElement}
          onPickMedia={(type) => setMediaTarget({ kind: "add", type })}
          onApplyPreset={(preset) => {
            setPage((p) => ({ ...preset, id: p.id, durationSeconds: p.durationSeconds }));
            setSelectedIds([]);
          }}
          onSelect={setSelectedIds}
          onMoveLayer={moveLayer}
          onToggleLock={(id) => patchElements([id], (el) => ({ ...el, locked: !el.locked }))}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <EditorStage
            width={content.width}
            height={content.height}
            page={page}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            editingId={editingId}
            onEditText={setEditingId}
            zoom={zoom}
            update={updateElements}
            begin={begin}
            end={end}
          />

          {/* ── Pages strip ── */}
          <div className="flex h-[112px] shrink-0 items-center gap-3 overflow-x-auto border-t border-border bg-card px-4">
            {content.pages.map((p, i) => {
              const thumbH = 64;
              const thumbW = Math.max(36, Math.min(160, (thumbH * content.width) / content.height));
              return (
                <div key={p.id} className="group relative flex shrink-0 flex-col items-center gap-1">
                  <button
                    type="button"
                    data-plain
                    onClick={() => goToPage(i)}
                    title={`Page ${i + 1}`}
                    className={`overflow-hidden rounded-md border-2 transition-colors ${
                      i === safeIndex ? "border-violet-500" : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-600"
                    }`}
                  >
                    <CanvasThumbnail
                      content={content}
                      pageIndex={i}
                      className="bg-zinc-100 dark:bg-zinc-800"
                      style={{ width: thumbW, height: thumbH }}
                    />
                  </button>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {i + 1}
                    {content.pages.length > 1 && ` · ${p.durationSeconds}s`}
                  </span>
                  <div className="absolute -top-1 right-0 hidden gap-0.5 group-hover:flex">
                    <PageBtn title="Move left" disabled={i === 0} onClick={() => movePage(i, i - 1)}>‹</PageBtn>
                    <PageBtn title="Move right" disabled={i === content.pages.length - 1} onClick={() => movePage(i, i + 1)}>›</PageBtn>
                    <PageBtn title="Duplicate page" onClick={() => duplicatePage(i)}>
                      <Copy className="h-2.5 w-2.5" />
                    </PageBtn>
                    {content.pages.length > 1 && (
                      <PageBtn title="Delete page" onClick={() => deletePage(i)}>
                        <Trash2 className="h-2.5 w-2.5" />
                      </PageBtn>
                    )}
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              data-plain
              onClick={addPage}
              title="Add page"
              className="flex h-16 w-16 shrink-0 items-center justify-center self-start rounded-md border-2 border-dashed border-zinc-300 text-zinc-400 hover:border-violet-400 hover:text-violet-500 dark:border-zinc-700"
              style={{ marginTop: 12 }}
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </div>

        <EditorRightPanel
          width={content.width}
          height={content.height}
          page={page}
          pageCount={content.pages.length}
          selected={selected}
          patch={patchElements}
          begin={begin}
          end={end}
          patchPage={(patch) => setPage((p) => ({ ...p, ...patch }))}
          onResizeCanvas={(w, h) => {
            if (w === content.width && h === content.height) return;
            set((c) => resizeCanvas(c, w, h));
          }}
          onAlign={align}
          onArrange={arrange}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelected}
          onReplaceMedia={(id, type) => setMediaTarget({ kind: "replace", id, type })}
          onPickBackground={() => setMediaTarget({ kind: "background" })}
        />
      </div>

      <MediaPicker
        open={mediaTarget !== null}
        onClose={() => setMediaTarget(null)}
        accept={mediaTarget && mediaTarget.kind !== "background" ? mediaTarget.type : "image"}
        onSelectItem={(item) => void onMediaPicked(item)}
      />

      {pushOpen && (
        <PushToScreenModal
          contentName={savedName}
          onPush={(screenId) => assignExperience(screenId, experience.id)}
          isAlreadyShowing={(s) => s.currentContentKind === "experience" && s.currentExperienceId === experience.id}
          onClose={() => {
            setPushOpen(false);
            router.refresh();
          }}
          onRemove={async (s) => {
            await assignMedia(s.screenId, null);
          }}
        />
      )}
    </div>
  );
}

function HeaderBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-plain
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function PageBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-plain
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-4 w-4 items-center justify-center rounded bg-zinc-900/80 text-[11px] leading-none text-white disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Natural pixel size of an image or video, falling back to 16:9 if it can't load. */
function mediaSize(url: string, video: boolean): Promise<{ w: number; h: number }> {
  const fallback = { w: 1600, h: 900 };
  return new Promise((resolve) => {
    const done = (w: number, h: number) => resolve(w > 0 && h > 0 ? { w, h } : fallback);
    const timer = setTimeout(() => resolve(fallback), 6000);
    if (video) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => {
        clearTimeout(timer);
        done(v.videoWidth, v.videoHeight);
      };
      v.onerror = () => {
        clearTimeout(timer);
        resolve(fallback);
      };
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => {
        clearTimeout(timer);
        done(img.naturalWidth, img.naturalHeight);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(fallback);
      };
      img.src = url;
    }
  });
}
