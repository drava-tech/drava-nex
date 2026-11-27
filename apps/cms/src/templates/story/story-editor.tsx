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
  ChevronRight,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import type { Experience } from "@platform/db";
import { CANVAS_SIZE_PRESETS } from "@platform/ui/templates/canvas";
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

/** "overview" is the list of parts; the others open that part's form in the same panel. */
type Section = { kind: "overview" } | { kind: "brand" } | { kind: "idle" } | { kind: "home" } | { kind: "app"; id: string };

/** Plain-language names for the fixed parts of a story. */
const PARTS = {
  brand: { title: "Look & colours", hint: "Colours, logo and fonts used on every screen" },
  idle: { title: "Welcome screen", hint: "Plays on its own while nobody is touching the screen" },
  home: { title: "Main menu", hint: "What people see after they tap, with a button per section" },
} as const;

function viewFor(section: Section): StoryView {
  if (section.kind === "idle") return { screen: "idle" };
  if (section.kind === "app") return { screen: "app", appId: section.id };
  return { screen: "home" };
}

/**
 * Story editor: one panel on the left that lists the story's parts in plain
 * words and opens a part's form in place, and the live, tappable story on the
 * right. The preview follows the part you're editing, and tapping a button in
 * the preview opens that section.
 */
export function StoryEditorWorkspace({ experience, initialContent }: { experience: Experience; initialContent: StoryContent }) {
  const router = useRouter();
  const history = useHistory<StoryContent>(normalizeStoryContent(initialContent));
  const content = history.value;
  const { set, begin, end, undo, redo } = history;

  const [section, setSection] = useState<Section>({ kind: "overview" });
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

  // The overview row under the mouse: the preview shows and blinks the part it changes.
  const [hover, setHover] = useState<Section | null>(null);
  const shownView: StoryView = !hover || hover.kind === "brand" ? view : hover.kind === "idle" ? { screen: "idle" } : { screen: "home" };
  const hoverKey = hover && hover.kind !== "overview" ? (hover.kind === "app" ? `app:${hover.id}` : hover.kind) : null;

  const go = (s: Section) => {
    setHover(null);
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
    go({ kind: "overview" });
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
    if (section.kind === "app" && !currentApp) go({ kind: "overview" });
  }, [currentApp, section.kind]);

  const previewRef = useRef<HTMLDivElement>(null);
  const sizePreset = CANVAS_SIZE_PRESETS.find((s) => s.width === content.width && s.height === content.height);

  const appIcon = (kind: StoryAppKind, cls = "") => (
    <svg className={cls} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={STORY_APP_ICON[kind]} />
    </svg>
  );

  /** A big, plain-language row in the overview list. */
  const partRow = (s: Section, label: string, hint: string, icon: React.ReactNode, extra?: React.ReactNode) => (
    <div
      role="button"
      tabIndex={0}
      onClick={() => go(s)}
      onKeyDown={(e) => e.key === "Enter" && go(s)}
      onMouseEnter={() => setHover(s)}
      onMouseLeave={() => setHover(null)}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-background/40 p-3 transition-colors hover:border-violet-400 hover:bg-violet-500/5"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{label}</span>
        <span className="block truncate text-[11px] text-zinc-500">{hint}</span>
      </span>
      {extra}
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
    </div>
  );

  const detail =
    section.kind === "overview"
      ? null
      : section.kind === "app"
        ? currentApp && { title: currentApp.title || STORY_APP_LABELS[currentApp.kind], hint: `${STORY_APP_LABELS[currentApp.kind]} section` }
        : PARTS[section.kind];

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
              title="Click to rename"
              className="w-65 truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold outline-none hover:border-border focus:border-violet-500"
            />
            <p className={`px-1.5 text-[11px] ${dirty ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
              {dirty ? "Unsaved changes" : "All changes saved"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="max-w-60 truncate text-xs text-red-500" title={error}>{error}</span>}
          <button type="button" data-plain onClick={undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo" className="rounded-md p-2 text-muted-foreground hover:bg-accent disabled:opacity-30">
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const open = () => window.open(`/preview/experiences/${experience.slug}`, "_blank", "noopener");
              if (dirty) save(open);
              else open();
            }}
            title="Open full screen in a new tab"
            className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Preview
          </button>
          <button
            type="button"
            onClick={() => save()}
            disabled={isSaving || !dirty}
            className="flex min-w-21 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
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
        {/* One panel: the list of parts, or the form for the part you opened */}
        <aside className="flex w-100 shrink-0 flex-col overflow-hidden border-r border-border bg-card text-card-foreground">
          {!detail ? (
            <div className="flex flex-col gap-2 overflow-y-auto p-4">
              <p className="pb-1 text-xs text-zinc-500">Click a part to change it. The preview on the right updates as you go.</p>
              {partRow({ kind: "brand" }, PARTS.brand.title, PARTS.brand.hint, <Palette className="h-4 w-4" />)}
              {partRow({ kind: "idle" }, PARTS.idle.title, PARTS.idle.hint, <MonitorPlay className="h-4 w-4" />)}
              {partRow({ kind: "home" }, PARTS.home.title, PARTS.home.hint, <Home className="h-4 w-4" />)}

              <div className="mt-4 flex items-baseline justify-between px-0.5">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Sections</h3>
                <span className="text-[11px] text-zinc-500">Each one is a button on the main menu</span>
              </div>
              {content.apps.length === 0 && <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-zinc-500">No sections yet. Add one below.</p>}
              {content.apps.map((a, i) => (
                <React.Fragment key={a.id}>
                  {partRow(
                    { kind: "app", id: a.id },
                    a.title || STORY_APP_LABELS[a.kind],
                    STORY_APP_LABELS[a.kind],
                    appIcon(a.kind),
                    <span className="hidden items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
                      <button type="button" data-plain disabled={i === 0} onClick={() => moveApp(i, -1)} className="rounded p-1 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-700" title="Move up" aria-label="Move up">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" data-plain disabled={i === content.apps.length - 1} onClick={() => moveApp(i, 1)} className="rounded p-1 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-700" title="Move down" aria-label="Move down">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                </React.Fragment>
              ))}

              {addOpen ? (
                <div className="flex flex-col gap-1 rounded-xl border border-violet-400/60 p-2">
                  <div className="flex items-center justify-between px-1 pb-1">
                    <span className="text-xs font-semibold">What kind of section?</span>
                    <button type="button" data-plain onClick={() => setAddOpen(false)} className="text-[11px] text-zinc-500 hover:underline">
                      Cancel
                    </button>
                  </div>
                  {STORY_MODULE_KINDS.map((k) => (
                    <button key={k} type="button" data-plain onClick={() => addApp(k)} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-accent">
                      {appIcon(k, "mt-0.5 shrink-0 text-violet-500")}
                      <span>
                        <span className="block text-xs font-semibold">{STORY_APP_LABELS[k]}</span>
                        <span className="block text-[11px] leading-snug text-zinc-500">{STORY_APP_DESCRIPTIONS[k]}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  data-plain
                  onClick={() => setAddOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 p-3 text-xs font-medium text-zinc-500 hover:border-violet-400 hover:text-violet-600 dark:border-zinc-700"
                >
                  <Plus className="h-4 w-4" /> Add a section
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 border-b border-border px-3 py-3">
                <button type="button" data-plain onClick={() => go({ kind: "overview" })} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-zinc-500 hover:bg-accent hover:text-zinc-900 dark:hover:text-zinc-100">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <div className="min-w-0 flex-1 pt-0.5">
                  <h2 className="truncate text-sm font-semibold">{detail.title}</h2>
                  <p className="text-[11px] leading-snug text-zinc-500">{detail.hint}</p>
                </div>
                {section.kind === "app" && (
                  <button type="button" data-plain onClick={() => deleteApp(section.id)} title="Delete this section" aria-label="Delete this section" className="rounded-md p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {section.kind === "brand" && (
                  <>
                    <BrandForm brand={content.brand} kit={kit} onChange={(brand) => set((c) => ({ ...c, brand }))} />
                    <div className="flex flex-col gap-2.5 border-t border-border px-4 py-4">
                      <Row label="Screen shape">
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
                      <p className="text-[11px] leading-snug text-zinc-500">Pick the shape of the screen it will play on. Everything rearranges to fit.</p>
                    </div>
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
            </>
          )}
        </aside>


        {/* Live preview */}
        <div className="flex min-w-0 flex-1 flex-col bg-zinc-200/70 dark:bg-zinc-900">
          <div className="flex items-center justify-between px-4 pt-3 text-[11px] text-zinc-500">
            <span>Preview · click around to try it</span>
            <div className="flex gap-1">
              {(
                [
                  ["idle", PARTS.idle.title],
                  ["home", PARTS.home.title],
                ] as const
              ).map(([s, label]) => (
                <button
                  key={s}
                  type="button"
                  data-plain
                  onClick={() => setView({ screen: s })}
                  className={`rounded-full px-2.5 py-1 ${view.screen === s ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-300/60 dark:hover:bg-zinc-800"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div ref={previewRef} className="min-h-0 flex-1 p-4">
            {hoverKey && (
              <style>{`[data-story-part="${hoverKey}"]::after{content:"";position:absolute;inset:0;z-index:50;pointer-events:none;border:8px solid #a78bfa;border-radius:inherit;background:rgba(139,92,246,.14);animation:story-part-blink .9s ease-in-out infinite}@keyframes story-part-blink{50%{opacity:.15}}@media (prefers-reduced-motion:reduce){[data-story-part]::after{animation:none!important}}`}</style>
            )}
            <StoryFrame
              content={content}
              view={shownView}
              disableIdle
              onViewChange={(v) => {
                setView(v);
                if (v.screen === "app") setSection({ kind: "app", id: v.appId });
                else if (v.screen === "home" && section.kind === "app") setSection({ kind: "overview" });
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
