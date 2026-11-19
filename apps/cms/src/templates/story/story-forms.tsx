"use client";

import React, { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Film, FileText, Image as ImageIcon, Plus, Trash2, ArrowUp, ArrowDown, X, Crosshair, Mic, Undo2 } from "lucide-react";
import { CANVAS_FONTS } from "@platform/ui/templates/canvas";
import {
  emptyDetail,
  makeFilter,
  storyId,
  STORY_MAP_MODES,
  type StoryApp,
  type StoryMapRegion,
  type StoryBrand,
  type StoryContent,
  type StoryDetail,
  type StoryFilter,
  type StoryMedia,
} from "@platform/ui/templates/story";
import { ColorField, NumberField, Row, Section, SelectField } from "../canvas/editor-fields";

/**
 * Form panels for the Story editor. Each takes the slice it edits plus an
 * `onChange(next)` — the shell turns those into undoable history steps. Text
 * inputs call begin()/end() on focus/blur so typing a paragraph is one undo.
 */

export type PickMedia = (accept: "image" | "video" | "visual" | "all", onPick: (m: StoryMedia) => void) => void;

export interface FormKit {
  begin: () => void;
  end: () => void;
  pickMedia: PickMedia;
}

const inputCls =
  "w-full rounded-md border border-border bg-zinc-100 px-2.5 py-2 text-xs text-zinc-900 outline-none focus:border-violet-500 dark:bg-zinc-800 dark:text-zinc-100";

export function TextField({
  label,
  value,
  onChange,
  kit,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  kit: FormKit;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-zinc-500">{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} onFocus={kit.begin} onBlur={kit.end} rows={4} placeholder={placeholder} className={`${inputCls} resize-y`} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} onFocus={kit.begin} onBlur={kit.end} placeholder={placeholder} className={inputCls} />
      )}
    </label>
  );
}

/** One image slot (logo, cover, background, map art). */
export function ImageSlot({
  label,
  url,
  onChange,
  kit,
  accept = "image",
}: {
  label: string;
  url: string | null;
  onChange: (url: string | null, media?: StoryMedia) => void;
  kit: FormKit;
  accept?: "image" | "visual";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <div className="flex items-center gap-1.5">
        {url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-9 w-14 rounded border border-border object-cover" />
            <button type="button" data-plain onClick={() => kit.pickMedia(accept, (m) => onChange(m.url, m))} className="h-8 rounded-md border border-border px-2 text-[11px] hover:bg-accent">
              Change
            </button>
            <button type="button" data-plain onClick={() => onChange(null)} aria-label={`Remove ${label}`} className="rounded-md p-1.5 text-zinc-500 hover:bg-accent">
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <button type="button" data-plain onClick={() => kit.pickMedia(accept, (m) => onChange(m.url, m))} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] hover:bg-accent">
            <ImageIcon className="h-3.5 w-3.5" /> Choose
          </button>
        )}
      </div>
    </div>
  );
}

/** A video or audio slot — shows the file name, since there's no picture to show. */
function MediaSlot({
  label,
  url,
  onChange,
  kit,
  icon,
  hint,
}: {
  label: string;
  url: string | null;
  onChange: (url: string | null) => void;
  kit: FormKit;
  icon: React.ReactNode;
  hint?: string;
}) {
  const name = url ? decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? url) : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-zinc-500">{label}</span>
        <div className="flex min-w-0 items-center gap-1.5">
          {name && (
            <span className="flex min-w-0 max-w-[150px] items-center gap-1 truncate text-[11px] text-zinc-600 dark:text-zinc-300" title={name}>
              {icon}
              <span className="truncate">{name}</span>
            </span>
          )}
          <button type="button" data-plain onClick={() => kit.pickMedia("video", (m) => onChange(m.url))} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] hover:bg-accent">
            {!name && icon}
            {name ? "Change" : "Choose"}
          </button>
          {name && (
            <button type="button" data-plain onClick={() => onChange(null)} aria-label={`Remove ${label}`} className="rounded-md p-1.5 text-zinc-500 hover:bg-accent">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {hint && <p className="text-[11px] leading-snug text-zinc-500">{hint}</p>}
    </div>
  );
}

function MediaList({ media, onChange, kit }: { media: StoryMedia[]; onChange: (m: StoryMedia[]) => void; kit: FormKit }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-zinc-500">Media in the detail view (images, videos, PDFs)</span>
      <div className="flex flex-wrap gap-1.5">
        {media.map((m, i) => (
          <div key={m.id} className="group relative h-14 w-20 overflow-hidden rounded border border-border bg-zinc-900">
            {m.type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-[9px] text-zinc-300">
                {m.type === "video" ? <Film className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                <span className="max-w-full truncate px-1">{m.name ?? m.type}</span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 hidden justify-between bg-black/70 group-hover:flex">
              <button type="button" data-plain disabled={i === 0} onClick={() => onChange(move(media, i, i - 1))} className="p-0.5 text-white disabled:opacity-30" aria-label="Move earlier">
                <ChevronRight className="h-3 w-3 rotate-180" />
              </button>
              <button type="button" data-plain onClick={() => onChange(media.filter((x) => x.id !== m.id))} className="p-0.5 text-white" aria-label="Remove">
                <Trash2 className="h-3 w-3" />
              </button>
              <button type="button" data-plain disabled={i === media.length - 1} onClick={() => onChange(move(media, i, i + 1))} className="p-0.5 text-white disabled:opacity-30" aria-label="Move later">
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          data-plain
          onClick={() => kit.pickMedia("all", (m) => onChange([...media, m]))}
          className="flex h-14 w-20 flex-col items-center justify-center gap-0.5 rounded border border-dashed border-zinc-400 text-[10px] text-zinc-500 hover:border-violet-500 hover:text-violet-500"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

// ─── Brand ────────────────────────────────────────────────────────────────────

const THEMES: { label: string; brand: Partial<StoryBrand> }[] = [
  { label: "Night", brand: { background: "#0b0d12", surface: "#161a22", text: "#f5f6f8", muted: "#9aa3b2", accent: "#92ff5f", accentText: "#0b0d12" } },
  { label: "Paper", brand: { background: "#f4f1ea", surface: "#ffffff", text: "#1a1a1a", muted: "#6b6b6b", accent: "#1a1a1a", accentText: "#ffffff" } },
  { label: "Ocean", brand: { background: "#06172b", surface: "#0e2744", text: "#eaf4ff", muted: "#8fb0d0", accent: "#38bdf8", accentText: "#06172b" } },
  { label: "Ember", brand: { background: "#1c1210", surface: "#2a1c18", text: "#fff4ee", muted: "#c9a99a", accent: "#ff7a45", accentText: "#1c1210" } },
];

export function BrandForm({ brand, onChange, kit }: { brand: StoryBrand; onChange: (b: StoryBrand) => void; kit: FormKit }) {
  const set = (p: Partial<StoryBrand>) => onChange({ ...brand, ...p });
  const color = (label: string, key: keyof StoryBrand) => (
    <Row label={label}>
      <ColorField swatches={false} value={String(brand[key])} onStart={kit.begin} onEnd={kit.end} onChange={(v) => set({ [key]: v } as Partial<StoryBrand>)} />
    </Row>
  );
  return (
    <>
      <Section title="Theme">
        <div className="grid grid-cols-4 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.label}
              type="button"
              data-plain
              onClick={() => set(t.brand)}
              className="flex flex-col items-center gap-1 rounded-lg border border-border p-2 text-[10px] hover:border-violet-400"
            >
              <span className="flex h-8 w-full overflow-hidden rounded" style={{ background: t.brand.background }}>
                <span className="m-1.5 w-1/2 rounded-sm" style={{ background: t.brand.surface }} />
                <span className="my-2.5 mr-1.5 h-3 w-3 rounded-full" style={{ background: t.brand.accent }} />
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Logo">
        <ImageSlot label="Logo" url={brand.logoUrl} kit={kit} onChange={(url) => set({ logoUrl: url })} />
        <p className="text-[11px] text-zinc-500">Shown on the idle screen, the home menu and each app.</p>
      </Section>
      <Section title="Colours">
        {color("Background", "background")}
        {color("Cards & panels", "surface")}
        {color("Text", "text")}
        {color("Muted text", "muted")}
        {color("Accent", "accent")}
        {color("Text on accent", "accentText")}
      </Section>
      <Section title="Type & shape">
        <Row label="Headings">
          <SelectField value={brand.headingFont} width={170} options={CANVAS_FONTS.map((f) => ({ label: f.label, value: f.value }))} onChange={(v) => set({ headingFont: v })} />
        </Row>
        <Row label="Body">
          <SelectField value={brand.bodyFont} width={170} options={CANVAS_FONTS.map((f) => ({ label: f.label, value: f.value }))} onChange={(v) => set({ bodyFont: v })} />
        </Row>
        <Row label="Corner radius">
          <NumberField value={brand.radius} min={0} max={80} suffix="px" onChange={(v) => set({ radius: v })} />
        </Row>
      </Section>
    </>
  );
}

// ─── Idle ─────────────────────────────────────────────────────────────────────

export function IdleForm({ idle, onChange, kit }: { idle: StoryContent["idle"]; onChange: (i: StoryContent["idle"]) => void; kit: FormKit }) {
  const set = (p: Partial<StoryContent["idle"]>) => onChange({ ...idle, ...p });
  return (
    <>
      <Section title="Behaviour">
        <Row label="Use an idle screen">
          <input type="checkbox" checked={idle.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="accent-violet-600" />
        </Row>
        <Row label="Return after no touch for">
          <NumberField value={idle.timeoutSeconds} min={10} max={3600} suffix="s" onChange={(v) => set({ timeoutSeconds: v })} />
        </Row>
        <Row label="Each slide shows for">
          <NumberField value={idle.slideSeconds} min={2} max={600} suffix="s" onChange={(v) => set({ slideSeconds: v })} />
        </Row>
        <TextField label="Prompt" value={idle.prompt} kit={kit} onChange={(v) => set({ prompt: v })} />
        <p className="text-[11px] leading-snug text-zinc-500">
          The screen plays these slides — announcements, videos, news — until someone touches it.
        </p>
      </Section>
      <Section
        title={`Slides (${idle.slides.length})`}
        action={
          <button
            type="button"
            data-plain
            onClick={() => set({ slides: [...idle.slides, { id: storyId(), mediaUrl: null, mediaType: "image", headline: "New slide", body: "" }] })}
            className="flex items-center gap-1 text-[11px] text-violet-600 dark:text-violet-300"
          >
            <Plus className="h-3 w-3" /> Add slide
          </button>
        }
      >
        {idle.slides.map((s, i) => (
          <div key={s.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold">Slide {i + 1}</span>
              <ItemActions
                onUp={i > 0 ? () => set({ slides: move(idle.slides, i, i - 1) }) : undefined}
                onDown={i < idle.slides.length - 1 ? () => set({ slides: move(idle.slides, i, i + 1) }) : undefined}
                onDelete={() => set({ slides: idle.slides.filter((x) => x.id !== s.id) })}
              />
            </div>
            <ImageSlot
              label="Image or video"
              accept="visual"
              url={s.mediaType === "image" ? s.mediaUrl : null}
              kit={kit}
              onChange={(url, m) =>
                set({ slides: idle.slides.map((x) => (x.id === s.id ? { ...x, mediaUrl: url, mediaType: m?.type === "video" ? "video" : "image" } : x)) })
              }
            />
            {s.mediaType === "video" && s.mediaUrl && (
              <p className="flex items-center gap-1 text-[11px] text-zinc-500">
                <Film className="h-3 w-3" /> Video: {decodeURIComponent(s.mediaUrl.split("/").pop() ?? "")}
              </p>
            )}
            <TextField label="Headline" value={s.headline} kit={kit} onChange={(v) => set({ slides: idle.slides.map((x) => (x.id === s.id ? { ...x, headline: v } : x)) })} />
            <TextField label="Body" value={s.body} kit={kit} onChange={(v) => set({ slides: idle.slides.map((x) => (x.id === s.id ? { ...x, body: v } : x)) })} />
          </div>
        ))}
      </Section>
    </>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────

export function HomeForm({ home, onChange, kit }: { home: StoryContent["home"]; onChange: (h: StoryContent["home"]) => void; kit: FormKit }) {
  const set = (p: Partial<StoryContent["home"]>) => onChange({ ...home, ...p });
  return (
    <Section title="Home menu">
      <TextField label="Headline" value={home.headline} kit={kit} onChange={(v) => set({ headline: v })} />
      <TextField label="Subheadline" value={home.subheadline} kit={kit} onChange={(v) => set({ subheadline: v })} />
      <ImageSlot label="Background" url={home.backgroundUrl} kit={kit} onChange={(url) => set({ backgroundUrl: url })} />
      <p className="text-[11px] leading-snug text-zinc-500">Each app in the story becomes a tile here, in the order of the list on the left.</p>
    </Section>
  );
}

// ─── Apps ─────────────────────────────────────────────────────────────────────

function ItemActions({ onUp, onDown, onDelete }: { onUp?: () => void; onDown?: () => void; onDelete: () => void }) {
  const btn = "rounded p-1 text-zinc-500 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-700";
  return (
    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button type="button" data-plain className={btn} disabled={!onUp} onClick={onUp} aria-label="Move up">
        <ArrowUp className="h-3 w-3" />
      </button>
      <button type="button" data-plain className={btn} disabled={!onDown} onClick={onDown} aria-label="Move down">
        <ArrowDown className="h-3 w-3" />
      </button>
      <button type="button" data-plain className={`${btn} hover:text-red-500`} onClick={onDelete} aria-label="Delete">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function FiltersForm({ filters, onChange, kit, colors, label }: { filters: StoryFilter[]; onChange: (f: StoryFilter[]) => void; kit: FormKit; colors: boolean; label: string }) {
  const palette = ["#92ff5f", "#38bdf8", "#f472b6", "#f59e0b", "#a78bfa", "#f87171"];
  return (
    <Section
      title={label}
      action={
        <button
          type="button"
          data-plain
          onClick={() => onChange([...filters, makeFilter(`Filter ${filters.length + 1}`, palette[filters.length % palette.length])])}
          className="flex items-center gap-1 text-[11px] text-violet-600 dark:text-violet-300"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      }
    >
      {filters.length === 0 && <p className="text-[11px] text-zinc-500">Optional. Viewers tap these to narrow what they see.</p>}
      {filters.map((f, i) => (
        <div key={f.id} className="flex items-center gap-2">
          {colors && (
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(f.color) ? f.color : "#92ff5f"}
              onFocus={kit.begin}
              onBlur={kit.end}
              onChange={(e) => onChange(filters.map((x) => (x.id === f.id ? { ...x, color: e.target.value } : x)))}
              className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
            />
          )}
          <input
            value={f.label}
            onFocus={kit.begin}
            onBlur={kit.end}
            onChange={(e) => onChange(filters.map((x) => (x.id === f.id ? { ...x, label: e.target.value } : x)))}
            className={inputCls}
          />
          <ItemActions
            onUp={i > 0 ? () => onChange(move(filters, i, i - 1)) : undefined}
            onDown={i < filters.length - 1 ? () => onChange(move(filters, i, i + 1)) : undefined}
            onDelete={() => onChange(filters.filter((x) => x.id !== f.id))}
          />
        </div>
      ))}
    </Section>
  );
}

function DetailFields<T extends StoryDetail>({ item, onChange, kit }: { item: T; onChange: (d: T) => void; kit: FormKit }) {
  return (
    <>
      <TextField label="Title" value={item.title} kit={kit} onChange={(v) => onChange({ ...item, title: v })} />
      <TextField label="Subtitle" value={item.subtitle} kit={kit} onChange={(v) => onChange({ ...item, subtitle: v })} />
      <TextField label="Description" multiline value={item.body} kit={kit} onChange={(v) => onChange({ ...item, body: v })} />
      <MediaList media={item.media} kit={kit} onChange={(m) => onChange({ ...item, media: m })} />
    </>
  );
}

/** Collapsible list of an app's items (events, pins, cards, hotspots). */
function ItemList<T extends StoryDetail & { id: string }>({
  title,
  items,
  onChange,
  make,
  render,
  openId,
  setOpenId,
  addLabel,
}: {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  make: () => T;
  render: (item: T, update: (next: T) => void) => React.ReactNode;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  addLabel: string;
}) {
  return (
    <Section
      title={`${title} (${items.length})`}
      action={
        <button
          type="button"
          data-plain
          onClick={() => {
            const n = make();
            onChange([...items, n]);
            setOpenId(n.id);
          }}
          className="flex items-center gap-1 text-[11px] text-violet-600 dark:text-violet-300"
        >
          <Plus className="h-3 w-3" /> {addLabel}
        </button>
      }
    >
      {items.map((it, i) => {
        const open = openId === it.id;
        return (
          <div key={it.id} className={`rounded-lg border ${open ? "border-violet-500" : "border-border"}`}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(open ? null : it.id)}
              onKeyDown={(e) => e.key === "Enter" && setOpenId(open ? null : it.id)}
              className="flex cursor-pointer items-center gap-2 px-2.5 py-2"
            >
              {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{it.title || "Untitled"}</span>
              <ItemActions
                onUp={i > 0 ? () => onChange(move(items, i, i - 1)) : undefined}
                onDown={i < items.length - 1 ? () => onChange(move(items, i, i + 1)) : undefined}
                onDelete={() => onChange(items.filter((x) => x.id !== it.id))}
              />
            </div>
            {open && (
              <div className="flex flex-col gap-2.5 border-t border-border p-3">
                {render(it, (next) => onChange(items.map((x) => (x.id === it.id ? next : x))))}
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

/**
 * Image with draggable points — click to drop the open item's point, drag any
 * point to move it. Positions are stored in % so they survive any screen size.
 */
function PointPlacer({
  imageUrl,
  points,
  activeId,
  onPlace,
  onSelect,
  numbered,
  colorOf,
  kit,
}: {
  imageUrl: string | null;
  points: { id: string; x: number; y: number; title: string }[];
  activeId: string | null;
  onPlace: (id: string, x: number, y: number) => void;
  onSelect: (id: string) => void;
  numbered?: boolean;
  colorOf?: (id: string) => string;
  kit: FormKit;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)) * 10) / 10,
      y: Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) * 10) / 10,
    };
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-[11px] text-zinc-500">
        <Crosshair className="h-3 w-3" />
        {activeId ? "Click the image to place the open item, or drag any point." : "Open an item below, then click to place it. Drag points to move them."}
      </span>
      <div
        ref={box}
        onPointerDown={(e) => {
          if (!activeId || e.target !== e.currentTarget) return;
          const p = at(e);
          onPlace(activeId, p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!dragId) return;
          const p = at(e);
          onPlace(dragId, p.x, p.y);
        }}
        onPointerUp={() => {
          if (dragId) kit.end();
          setDragId(null);
        }}
        className="relative w-full select-none overflow-hidden rounded-md border border-border bg-zinc-800"
        style={{
          aspectRatio: imageUrl ? undefined : "16 / 9",
          cursor: activeId ? "crosshair" : "default",
          backgroundImage: imageUrl ? undefined : "repeating-linear-gradient(0deg, rgba(255,255,255,.07) 0 1px, transparent 1px 24px), repeating-linear-gradient(90deg, rgba(255,255,255,.07) 0 1px, transparent 1px 24px)",
        }}
      >
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" draggable={false} className="pointer-events-none block w-full" />
        )}
        {points.map((p, i) => (
          <div
            key={p.id}
            title={p.title}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
              kit.begin();
              setDragId(p.id);
              onSelect(p.id);
            }}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white text-[9px] font-bold text-zinc-900 shadow ${
              p.id === activeId ? "h-6 w-6 ring-2 ring-violet-500" : "h-4 w-4"
            }`}
            style={{ left: `${p.x}%`, top: `${p.y}%`, background: colorOf?.(p.id) ?? "#92ff5f" }}
          >
            {numbered && p.id === activeId ? i + 1 : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Draw tappable regions on the map: with a region open, each click on the
 * image adds a corner to its outline; drag a corner to move it. Clicking
 * another region's shape opens it. Positions are % so they survive any size.
 */
function RegionDrawer({
  imageUrl,
  regions,
  activeId,
  onChange,
  onSelect,
  colorOf,
  kit,
}: {
  imageUrl: string | null;
  regions: StoryMapRegion[];
  activeId: string | null;
  onChange: (regions: StoryMapRegion[]) => void;
  onSelect: (id: string) => void;
  colorOf: (r: StoryMapRegion) => string;
  kit: FormKit;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const active = regions.find((r) => r.id === activeId) ?? null;
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)) * 10) / 10,
      y: Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) * 10) / 10,
    };
  };
  const setPoints = (points: StoryMapRegion["points"]) =>
    active && onChange(regions.map((r) => (r.id === active.id ? { ...r, points } : r)));

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-[11px] text-zinc-500">
        <Crosshair className="h-3 w-3" />
        {active ? "Click the map to add corners to the open region. Drag a corner to move it." : "Open a region below, then click around its edge to outline it."}
      </span>
      <div
        ref={box}
        onPointerDown={(e) => {
          if (!active || e.target !== e.currentTarget) return;
          setPoints([...active.points, at(e)]);
        }}
        onPointerMove={(e) => {
          if (drag === null || !active) return;
          const p = at(e);
          setPoints(active.points.map((q, i) => (i === drag ? p : q)));
        }}
        onPointerUp={() => {
          if (drag !== null) kit.end();
          setDrag(null);
        }}
        className="relative w-full select-none overflow-hidden rounded-md border border-border bg-zinc-800"
        style={{
          aspectRatio: imageUrl ? undefined : "16 / 9",
          cursor: active ? "crosshair" : "default",
          backgroundImage: imageUrl ? undefined : "repeating-linear-gradient(0deg, rgba(255,255,255,.07) 0 1px, transparent 1px 24px), repeating-linear-gradient(90deg, rgba(255,255,255,.07) 0 1px, transparent 1px 24px)",
        }}
      >
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" draggable={false} className="pointer-events-none block w-full" />
        )}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
          {regions.map((r) => {
            const c = colorOf(r);
            const pts = r.points.map((p) => `${p.x},${p.y}`).join(" ");
            const isActive = r.id === activeId;
            return r.points.length >= 3 ? (
              <polygon
                key={r.id}
                points={pts}
                fill={c}
                fillOpacity={isActive ? 0.45 : 0.25}
                stroke={c}
                strokeWidth={isActive ? 2 : 1}
                vectorEffect="non-scaling-stroke"
                className={isActive ? "" : "pointer-events-auto cursor-pointer"}
                onPointerDown={(e) => {
                  if (isActive) return;
                  e.stopPropagation();
                  onSelect(r.id);
                }}
              />
            ) : (
              <polyline key={r.id} points={pts} fill="none" stroke={c} strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            );
          })}
        </svg>
        {active?.points.map((p, i) => (
          <div
            key={i}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
              kit.begin();
              setDrag(i);
            }}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white shadow"
            style={{ left: `${p.x}%`, top: `${p.y}%`, background: colorOf(active) }}
          />
        ))}
      </div>
      {active && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[11px] text-zinc-500">
            {active.points.length < 3 ? `${active.points.length} of at least 3 corners` : `${active.points.length} corners`}
          </span>
          <button type="button" data-plain disabled={active.points.length === 0} onClick={() => setPoints(active.points.slice(0, -1))} className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:bg-accent disabled:opacity-40">
            <Undo2 className="h-3 w-3" /> Undo corner
          </button>
          <button type="button" data-plain disabled={active.points.length === 0} onClick={() => setPoints([])} className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:bg-accent disabled:opacity-40">
            <Trash2 className="h-3 w-3" /> Clear
          </button>
        </div>
      )}
    </div>
  );
}

export function AppForm({ app, onChange, kit }: { app: StoryApp; onChange: (a: StoryApp) => void; kit: FormKit }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const filterSelect = (value: string | null, filters: StoryFilter[], set: (v: string | null) => void) =>
    filters.length > 0 && (
      <Row label="Filter">
        <SelectField
          value={value ?? ""}
          width={170}
          options={[{ label: "None", value: "" }, ...filters.map((f) => ({ label: f.label, value: f.id }))]}
          onChange={(v) => set(v || null)}
        />
      </Row>
    );

  const general = (
    <Section title="Tile">
      <TextField label="Title" value={app.title} kit={kit} onChange={(v) => onChange({ ...app, title: v })} />
      <TextField label="Tagline" value={app.tagline} kit={kit} onChange={(v) => onChange({ ...app, tagline: v })} />
      <ImageSlot label="Tile image" url={app.coverUrl} kit={kit} onChange={(url) => onChange({ ...app, coverUrl: url })} />
    </Section>
  );

  switch (app.kind) {
    case "timeline":
      return (
        <>
          {general}
          <FiltersForm label="Eras / filters" filters={app.filters} colors={false} kit={kit} onChange={(filters) => onChange({ ...app, filters })} />
          <ItemList
            title="Milestones"
            addLabel="Add milestone"
            items={app.events}
            openId={openId}
            setOpenId={setOpenId}
            onChange={(events) => onChange({ ...app, events })}
            make={() => ({ ...emptyDetail("New milestone"), id: storyId(), year: (app.events.at(-1)?.year ?? new Date().getFullYear() - 1) + 1, dateLabel: "", filterId: null })}
            render={(ev, update) => (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-zinc-500">Year (sort order)</span>
                    <NumberField value={ev.year} width={120} onChange={(v) => update({ ...ev, year: Math.round(v) })} />
                  </label>
                  <TextField label="Label (optional)" placeholder={String(ev.year)} value={ev.dateLabel} kit={kit} onChange={(v) => update({ ...ev, dateLabel: v })} />
                </div>
                {filterSelect(ev.filterId, app.filters, (v) => update({ ...ev, filterId: v }))}
                <DetailFields item={ev} kit={kit} onChange={update} />
              </>
            )}
          />
        </>
      );
    case "map": {
      const pinColor = (filterId: string | null) => app.filters.find((f) => f.id === filterId)?.color ?? "#92ff5f";
      const journey = app.mode === "journey";
      return (
        <>
          {general}
          <Section title="Map type">
            <div className="grid grid-cols-3 gap-2">
              {STORY_MAP_MODES.map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  data-plain
                  onClick={() => {
                    setOpenId(null);
                    onChange({ ...app, mode: m.mode });
                  }}
                  title={m.description}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                    app.mode === m.mode ? "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300" : "border-border hover:border-zinc-400"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-zinc-500">{STORY_MAP_MODES.find((m) => m.mode === app.mode)?.description}.</p>
            {journey && (
              <>
                <Row label="Round dial control">
                  <input type="checkbox" checked={app.dial} onChange={(e) => onChange({ ...app, dial: e.target.checked })} className="accent-violet-600" />
                </Row>
                <p className="text-[11px] leading-snug text-zinc-500">
                  Viewers turn a big dial to travel the route — with a finger, a tangible dial puck on a touch table, or a rotary controller (scroll or arrow keys). Off: previous / next buttons.
                </p>
              </>
            )}
          </Section>
          <Section title="Map">
            <ImageSlot label="Map image" url={app.mapUrl} kit={kit} onChange={(url) => onChange({ ...app, mapUrl: url })} />
            <p className="text-[11px] leading-snug text-zinc-500">Any artwork works: a world or regional map, a campus, a floor plan.</p>
            {app.mode === "regions" ? (
              <RegionDrawer
                imageUrl={app.mapUrl}
                regions={app.regions}
                activeId={openId}
                kit={kit}
                onSelect={setOpenId}
                colorOf={(r) => pinColor(r.filterId)}
                onChange={(regions) => onChange({ ...app, regions })}
              />
            ) : (
              <PointPlacer
                imageUrl={app.mapUrl}
                points={app.pins}
                activeId={openId}
                kit={kit}
                numbered={journey}
                onSelect={setOpenId}
                colorOf={(id) => pinColor(app.pins.find((p) => p.id === id)?.filterId ?? null)}
                onPlace={(id, x, y) => onChange({ ...app, pins: app.pins.map((p) => (p.id === id ? { ...p, x, y } : p)) })}
              />
            )}
          </Section>
          <FiltersForm label={journey ? "Legs / colours (optional)" : "Categories"} filters={app.filters} colors kit={kit} onChange={(filters) => onChange({ ...app, filters })} />
          {app.mode === "regions" ? (
            <ItemList
              title="Regions"
              addLabel="Add region"
              items={app.regions}
              openId={openId}
              setOpenId={setOpenId}
              onChange={(regions) => onChange({ ...app, regions })}
              make={() => ({ ...emptyDetail("New region"), id: storyId(), points: [], filterId: app.filters[0]?.id ?? null })}
              render={(g, update) => (
                <>
                  {filterSelect(g.filterId, app.filters, (v) => update({ ...g, filterId: v }))}
                  <DetailFields item={g} kit={kit} onChange={update} />
                </>
              )}
            />
          ) : (
            <ItemList
              title={journey ? "Stops, in order" : "Pins"}
              addLabel={journey ? "Add stop" : "Add pin"}
              items={app.pins}
              openId={openId}
              setOpenId={setOpenId}
              onChange={(pins) => onChange({ ...app, pins })}
              make={() => ({ ...emptyDetail(journey ? "New stop" : "New location"), id: storyId(), x: 50, y: 50, filterId: app.filters[0]?.id ?? null })}
              render={(pin, update) => (
                <>
                  {filterSelect(pin.filterId, app.filters, (v) => update({ ...pin, filterId: v }))}
                  <DetailFields item={pin} kit={kit} onChange={update} />
                </>
              )}
            />
          )}
        </>
      );
    }
    case "showcase":
      return (
        <>
          {general}
          <FiltersForm label="Categories" filters={app.filters} colors={false} kit={kit} onChange={(filters) => onChange({ ...app, filters })} />
          <ItemList
            title="Cards"
            addLabel="Add card"
            items={app.items}
            openId={openId}
            setOpenId={setOpenId}
            onChange={(items) => onChange({ ...app, items })}
            make={() => ({ ...emptyDetail("New card"), id: storyId(), coverUrl: null, filterId: null })}
            render={(it, update) => (
              <>
                <ImageSlot label="Card image" url={it.coverUrl} kit={kit} onChange={(url) => update({ ...it, coverUrl: url })} />
                {filterSelect(it.filterId, app.filters, (v) => update({ ...it, filterId: v }))}
                <DetailFields item={it} kit={kit} onChange={update} />
              </>
            )}
          />
        </>
      );
    case "hotspots":
      return (
        <>
          {general}
          <Section title="Image">
            <ImageSlot label="Image" url={app.imageUrl} kit={kit} onChange={(url) => onChange({ ...app, imageUrl: url })} />
            <PointPlacer
              imageUrl={app.imageUrl}
              points={app.hotspots}
              activeId={openId}
              kit={kit}
              numbered
              onSelect={setOpenId}
              onPlace={(id, x, y) => onChange({ ...app, hotspots: app.hotspots.map((h) => (h.id === id ? { ...h, x, y } : h)) })}
            />
          </Section>
          <ItemList
            title="Hotspots"
            addLabel="Add hotspot"
            items={app.hotspots}
            openId={openId}
            setOpenId={setOpenId}
            onChange={(hotspots) => onChange({ ...app, hotspots })}
            make={() => ({ ...emptyDetail("New hotspot"), id: storyId(), x: 50, y: 50 })}
            render={(h, update) => <DetailFields item={h} kit={kit} onChange={update} />}
          />
        </>
      );
    case "video":
      return (
        <>
          {general}
          <Section title="Playback">
            <Row label="Play the next chapter automatically">
              <input type="checkbox" checked={app.autoAdvance} onChange={(e) => onChange({ ...app, autoAdvance: e.target.checked })} className="accent-violet-600" />
            </Row>
            <p className="text-[11px] leading-snug text-zinc-500">
              Each chapter plays a video, or a photo with a voice-over. Add a voice-over to a video to narrate over it — the video is muted and loops under the narration. The transcript shows as captions.
            </p>
          </Section>
          <ItemList
            title="Chapters"
            addLabel="Add chapter"
            items={app.chapters}
            openId={openId}
            setOpenId={setOpenId}
            onChange={(chapters) => onChange({ ...app, chapters })}
            make={() => ({ ...emptyDetail("New chapter"), id: storyId(), videoUrl: null, posterUrl: null, voiceUrl: null })}
            render={(c, update) => (
              <>
                <TextField label="Title" value={c.title} kit={kit} onChange={(v) => update({ ...c, title: v })} />
                <TextField label="Subtitle" value={c.subtitle} kit={kit} onChange={(v) => update({ ...c, subtitle: v })} />
                <MediaSlot label="Video" url={c.videoUrl} kit={kit} icon={<Film className="h-3.5 w-3.5" />} onChange={(url) => update({ ...c, videoUrl: url })} />
                <ImageSlot label={c.videoUrl ? "Poster image" : "Photo"} url={c.posterUrl} kit={kit} onChange={(url) => update({ ...c, posterUrl: url })} />
                <MediaSlot
                  label="Voice-over"
                  url={c.voiceUrl}
                  kit={kit}
                  icon={<Mic className="h-3.5 w-3.5" />}
                  hint="Optional narration (MP3, M4A, WAV). Upload it in the picker — it's listed with the videos."
                  onChange={(url) => update({ ...c, voiceUrl: url })}
                />
                <TextField label="Transcript (captions)" multiline value={c.body} kit={kit} onChange={(v) => update({ ...c, body: v })} />
              </>
            )}
          />
        </>
      );
  }
}
