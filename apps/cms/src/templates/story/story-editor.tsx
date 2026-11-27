"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ExternalLink,
  Home,
  Loader2,
  MonitorUp,
  MonitorPlay,
  Palette,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import type { Experience } from "@platform/db";
import { CANVAS_SIZE_PRESETS, canvasOrientation } from "@platform/ui/templates/canvas";
import {
  STORY_APP_DESCRIPTIONS,
  STORY_APP_ICON,
  STORY_APP_LABELS,
  StoryFrame,
  makeApp,
  normalizeStoryContent,
  storyId,
  type StoryAppKind,
  type StoryContent,
  type StoryMedia,
  type StoryView,
} from "@platform/ui/templates/story";
import { updateExperience, updateExperienceTemplateContent } from "@/actions/experience-actions";
import { assignExperience, assignMedia } from "@/actions/screen-actions";
import { MediaPicker, type MediaPickerItem } from "@/components/media-picker";
import { PushToScreenModal } from "@/components/push-to-screen-modal";
import { useHistory } from "../canvas/use-history";
import { Row, SelectField } from "../canvas/editor-fields";
import { AppForm, BrandForm, HomeForm, IdleForm, type FormKit } from "./story-forms";
import { STORY_MODULE_KINDS } from "./presets";
import "../canvas/fonts";

type Section = { kind: "brand" } | { kind: "idle" } | { kind: "home" } | { kind: "app"; id: string };


function viewFor(section: Section): StoryView {
  if (section.kind === "idle") return { screen: "idle" };
  if (section.kind === "app") return { screen: "app", appId: section.id };
  return { screen: "home" };
}

/**
 * Story editor: sections on the left (brand, idle screen, home, apps), the
 * form for the chosen section in the middle, and the live, tappable story on
 * the right — it follows the section you're editing, and tapping a tile in the
 * preview jumps the editor to that app.
 */
export function StoryEditorWorkspace({ experience, initialContent }: { experience: Experience; initialContent: StoryContent }) {
  const router = useRouter();
  const history = useHistory<StoryContent>(normalizeStoryContent(initialContent));
  const content = history.value;
  const { set, begin, end, undo, redo } = history;

  const [section, setSection] = useState<Section>({ kind: "home" });
  const [view, setView] = useState<StoryView>({ screen: "home" });
  const [name, setName] = useState(experience.name);
  const [savedName, setSavedName] = useState(experience.name);
  const [saved, setSaved] = useState<StoryContent>(content);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [pushOpen, setPushOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [picker, setPicker] = useState<{ accept: "image" | "video" | "visual" | "all"; onPick: (m: StoryMedia) => void } | null>(null);
  const dirty = content !== saved || name.trim() !== savedName;

  const go = (s: Section) => {
    setSection(s);
    setView(viewFor(s));
  };

  const kit: FormKit = useMemo(
    () => ({
      begin,
      end,
      pickMedia: (accept, onPick) => setPicker({ accept, onPick }),
    }),
    [begin, end]
  );

  const onPicked = (item: MediaPickerItem) => {
    const p = picker;
    setPicker(null);
    if (!p) return;
    const type: StoryMedia["type"] =
      item.type === "video" ? "video" : item.type === "image" ? "image" : /\.pdf($|\?)/i.test(item.url) ? "pdf" : "image";
    p.onPick({ id: storyId(), type, url: item.url, assetId: item.id, name: item.name });
  };

  const addApp = (kind: StoryAppKind) => {
    const app = makeApp(kind);
    set((c) => ({ ...c, apps: [...c.apps, app] }));
    setAddOpen(false);
    go({ kind: "app", id: app.id });
  };

  const moveApp = (i: number, d: -1 | 1) =>
    set((c) => {
      const j = i + d;
      if (j < 0 || j >= c.apps.length) return c;
      const apps = c.apps.slice();
      [apps[i], apps[j]] = [apps[j]!, apps[i]!];
      return { ...c, apps };
    });

  const deleteApp = (id: string) => {
    const app = content.apps.find((a) => a.id === id);
    if (!app || !window.confirm(`Delete "${app.title}" and everything in it?`)) return;
    set((c) => ({ ...c, apps: c.apps.filter((a) => a.id !== id) }));
    go({ kind: "home" });
  };

  const save = useCallback(
    (then?: () => void) => {
      setError(null);
      const snapshot = content;
      const nextName = name.trim() || savedName;
      startSaving(async () => {
        const res = await updateExperienceTemplateContent(experience.id, "story", snapshot);
        if (!res.success) return setError(res.error ?? "Couldn't save.");
        if (nextName !== savedName) {
          const r = await updateExperience(experience.id, { name: nextName, slug: experience.slug, templateKey: "story", typeIds: [] });
          if (r.success) setSavedName(nextName);
          else setError(r.error ?? "Saved, but couldn't rename.");
        }
        setSaved(snapshot);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1600);
        then?.();
      });
    },
    [content, experience.id, experience.slug, name, savedName]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "s") {
        e.preventDefault();
        save();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redo, save, undo]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // A deleted/undone app can't stay selected.
  const currentApp = section.kind === "app" ? content.apps.find((a) => a.id === section.id) : undefined;
  useEffect(() => {
    if (section.kind === "app" && !currentApp) go({ kind: "home" });
  }, [currentApp, section.kind]);

  const previewRef = useRef<HTMLDivElement>(null);
  const orientation = canvasOrientation(content.width, content.height);
  const sizePreset = CANVAS_SIZE_PRESETS.find((s) => s.width === content.width && s.height === content.height);

  const navItem = (s: Section, label: string, icon: React.ReactNode, extra?: React.ReactNode) => {
    const active =
      section.kind === s.kind && (s.kind !== "app" || (section.kind === "app" && section.id === (s as { id: string }).id));
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => go(s)}
        onKeyDown={(e) => e.key === "Enter" && go(s)}
        className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs ${
          active ? "bg-violet-500/10 font-semibold text-violet-700 dark:text-violet-200" : "text-zinc-700 hover:bg-accent dark:text-zinc-300"
        }`}
      >
        <span className="shrink-0 text-zinc-500">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {extra}
      </div>
    );
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
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
              aria-label="Story name"
              className="w-[260px] truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold outline-none hover:border-border focus:border-violet-500"
            />
            <p className="px-1.5 text-[11px] capitalize text-muted-foreground">
              Story · {orientation} · {content.width}×{content.height} · {content.apps.length} app{content.apps.length === 1 ? "" : "s"}
              {dirty && <span className="normal-case"> · unsaved changes</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" data-plain onClick={undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" className="rounded-md p-2 text-muted-foreground hover:bg-accent disabled:opacity-30">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" data-plain onClick={redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)" className="rounded-md p-2 text-muted-foreground hover:bg-accent disabled:opacity-30">
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="max-w-[240px] truncate text-xs text-red-500" title={error}>{error}</span>}
          <button
            type="button"
            onClick={() => {
              const open = () => window.open(`/preview/experiences/${experience.slug}`, "_blank", "noopener");
              if (dirty) save(open);
              else open();
            }}
            className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Preview
          </button>
          <button
            type="button"
            onClick={() => save()}
            disabled={isSaving || !dirty}
            className="flex min-w-[84px] items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : justSaved ? <Check className="h-3.5 w-3.5" /> : null}
            {isSaving ? "Saving…" : justSaved ? "Saved" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => (dirty ? save(() => setPushOpen(true)) : setPushOpen(true))}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <MonitorUp className="h-3.5 w-3.5" /> Push to screen
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sections */}
        <aside className="flex w-[230px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card p-2.5">
          <p className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Story</p>
          {navItem({ kind: "brand" }, "Brand & screen", <Palette className="h-3.5 w-3.5" />)}
          {navItem({ kind: "idle" }, "Idle screen", <MonitorPlay className="h-3.5 w-3.5" />)}
          {navItem({ kind: "home" }, "Home menu", <Home className="h-3.5 w-3.5" />)}
          <p className="px-2.5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Modules</p>
          {content.apps.map((a, i) => (
            <React.Fragment key={a.id}>
            {navItem(
              { kind: "app", id: a.id },
              a.title || STORY_APP_LABELS[a.kind],
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d={STORY_APP_ICON[a.kind]} />
              </svg>,
              <span className="hidden items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
                <button type="button" data-plain disabled={i === 0} onClick={() => moveApp(i, -1)} className="rounded p-0.5 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-700" aria-label="Move up">
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button type="button" data-plain disabled={i === content.apps.length - 1} onClick={() => moveApp(i, 1)} className="rounded p-0.5 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-700" aria-label="Move down">
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button type="button" data-plain onClick={() => deleteApp(a.id)} className="rounded p-0.5 hover:bg-zinc-200 hover:text-red-500 dark:hover:bg-zinc-700" aria-label="Delete module">
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            )}
            </React.Fragment>
          ))}
          <div className="relative mt-1">
            <button
              type="button"
              data-plain
              onClick={() => setAddOpen((o) => !o)}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-2.5 py-2 text-xs text-zinc-500 hover:border-violet-400 hover:text-violet-600 dark:border-zinc-700"
            >
              <Plus className="h-3.5 w-3.5" /> Add module
            </button>
            {addOpen && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
                {STORY_MODULE_KINDS.map((k) => (
                  <button key={k} type="button" data-plain onClick={() => addApp(k)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-accent">
                    <svg className="mt-0.5 shrink-0 text-violet-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d={STORY_APP_ICON[k]} />
                    </svg>
                    <span>
                      <span className="block text-xs font-semibold">{STORY_APP_LABELS[k]}</span>
                      <span className="block text-[11px] leading-snug text-zinc-500">{STORY_APP_DESCRIPTIONS[k]}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Form */}
        <div className="w-[400px] shrink-0 overflow-y-auto border-r border-border bg-card text-card-foreground">
          {section.kind === "brand" && (
            <>
              <div className="flex flex-col gap-2.5 border-b border-border px-4 py-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Screen</h3>
                <Row label="Size">
                  <SelectField
                    value={sizePreset?.id ?? "custom"}
                    width={190}
                    options={[
                      ...CANVAS_SIZE_PRESETS.map((s) => ({ label: s.label, value: s.id })),
                      ...(sizePreset ? [] : [{ label: `Custom ${content.width}×${content.height}`, value: "custom" }]),
                    ]}
                    onChange={(id) => {
                      const s = CANVAS_SIZE_PRESETS.find((x) => x.id === id);
                      if (s) set((c) => ({ ...c, width: s.width, height: s.height }));
                    }}
                  />
                </Row>
                <p className="text-[11px] leading-snug text-zinc-500">A story re-flows for landscape or portrait — the menu, timeline and grids rearrange themselves.</p>
              </div>
              <BrandForm brand={content.brand} kit={kit} onChange={(brand) => set((c) => ({ ...c, brand }))} />
            </>
          )}
          {section.kind === "idle" && <IdleForm idle={content.idle} kit={kit} onChange={(idle) => set((c) => ({ ...c, idle }))} />}
          {section.kind === "home" && <HomeForm home={content.home} kit={kit} onChange={(home) => set((c) => ({ ...c, home }))} />}
          {section.kind === "app" && currentApp && (
            <AppForm
              key={currentApp.id}
              app={currentApp}
              kit={kit}
              onChange={(next) => set((c) => ({ ...c, apps: c.apps.map((a) => (a.id === next.id ? next : a)) }))}
            />
          )}
        </div>

        {/* Live preview */}
        <div className="flex min-w-0 flex-1 flex-col bg-zinc-200/70 dark:bg-zinc-900">
          <div className="flex items-center justify-between px-4 pt-3 text-[11px] text-zinc-500">
            <span>Live preview — tap it like a touchscreen</span>
            <div className="flex gap-1">
              {(["idle", "home"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  data-plain
                  onClick={() => setView({ screen: s })}
                  className={`rounded-full px-2.5 py-1 capitalize ${view.screen === s ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-300/60 dark:hover:bg-zinc-800"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div ref={previewRef} className="min-h-0 flex-1 p-4">
            <StoryFrame
              content={content}
              view={view}
              disableIdle
              onViewChange={(v) => {
                setView(v);
                if (v.screen === "app") setSection({ kind: "app", id: v.appId });
                else if (v.screen === "home" && section.kind === "app") setSection({ kind: "home" });
              }}
              className="h-full w-full"
            />
          </div>
        </div>
      </div>

      <MediaPicker open={picker !== null} onClose={() => setPicker(null)} accept={picker?.accept ?? "image"} onSelectItem={onPicked} />

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
