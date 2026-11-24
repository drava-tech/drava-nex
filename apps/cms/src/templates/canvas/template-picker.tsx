"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { CanvasThumbnail, blankPage, type CanvasPage } from "@platform/ui/templates/canvas";
import { CANVAS_PRESETS, TEMPLATE_CATEGORIES, type TemplateCategory } from "./presets";
import { CANVAS_THEMES } from "./library/themes";
import type { BrandKit } from "../brand";

export const BLANK_TEMPLATE_ID = "blank";

/** Builds a template's page for a canvas size (or a blank page). */
export function buildTemplate(id: string, width: number, height: number, brand?: BrandKit | null): CanvasPage {
  const t = CANVAS_PRESETS.find((p) => p.id === id);
  if (t) return t.build(width, height, brand);
  return brand ? blankPage({ color: brand.background }) : blankPage();
}

export function templateLabel(id: string): string | null {
  return CANVAS_PRESETS.find((p) => p.id === id)?.label ?? null;
}

/** Renders the thumbnail only once it scrolls near view — the library is 100+ pages. */
function Tile({
  id,
  label,
  sub,
  width,
  height,
  active,
  onClick,
  thumbH,
  brand,
}: {
  id: string;
  label: string;
  sub?: string;
  width: number;
  height: number;
  active: boolean;
  onClick: () => void;
  thumbH: number;
  brand?: BrandKit | null;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "300px" });
    io.observe(node);
    return () => io.disconnect();
  }, [seen]);
  const pageData = useMemo(() => (seen ? buildTemplate(id, width, height, brand) : null), [seen, id, width, height, brand]);
  const box: React.CSSProperties = width >= height ? { width: "100%", aspectRatio: `${width} / ${height}` } : { height: "100%", aspectRatio: `${width} / ${height}` };

  return (
    <button ref={ref} type="button" data-plain onClick={onClick} className="group flex min-w-0 flex-col gap-1 text-left" title={label}>
      <div
        className={`flex items-center justify-center rounded-lg border-2 bg-zinc-100 p-1.5 transition-colors dark:bg-zinc-800 ${
          active ? "border-violet-500" : "border-transparent group-hover:border-zinc-300 dark:group-hover:border-zinc-600"
        }`}
        style={{ height: thumbH }}
      >
        {pageData ? (
          <CanvasThumbnail
            content={{ version: 1, width, height, pages: [pageData] }}
            className="max-h-full max-w-full rounded-sm border border-border"
            style={box}
          />
        ) : (
          <div className="max-h-full max-w-full rounded-sm bg-zinc-200 dark:bg-zinc-700" style={box} />
        )}
      </div>
      <span className="truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
      {sub && <span className="-mt-1 truncate text-[10px] text-zinc-500">{sub}</span>}
    </button>
  );
}

/**
 * The Design template library: category chips, search and a lazily rendered
 * grid. `compact` is the editor's narrow side panel.
 */
export function TemplatePicker({
  width,
  height,
  value,
  onPick,
  includeBlank = false,
  compact = false,
  brand = null,
}: {
  width: number;
  height: number;
  value?: string | null;
  onPick: (id: string) => void;
  includeBlank?: boolean;
  compact?: boolean;
  /** Redraw every template in this brand. */
  brand?: BrandKit | null;
}) {
  const [cat, setCat] = useState<TemplateCategory | "all">("all");
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const catLabel = (id: TemplateCategory) => TEMPLATE_CATEGORIES.find((c) => c.id === id)?.label ?? "";
    return CANVAS_PRESETS.filter(
      (t) =>
        (cat === "all" || t.category === cat) &&
        (!needle || `${t.label} ${catLabel(t.category)} ${CANVAS_THEMES[t.theme].label}`.toLowerCase().includes(needle))
    );
  }, [cat, q]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of CANVAS_PRESETS) m.set(t.category, (m.get(t.category) ?? 0) + 1);
    return m;
  }, []);

  const chip = (active: boolean) =>
    `h-7 shrink-0 rounded-full px-3 text-[11px] font-medium transition-colors ${
      active ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "btn-surface text-zinc-600 dark:text-zinc-300"
    }`;

  const thumbH = compact ? 120 : 112;
  const showBlank = includeBlank && cat === "all" && !q.trim();

  return (
    <div className="flex flex-col gap-3">
      <div className={`flex gap-2 ${compact ? "flex-col" : "items-center"}`}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${CANVAS_PRESETS.length} templates`}
            className={`h-8 rounded-full border border-border bg-zinc-50 pl-8 pr-3 text-xs outline-none focus:border-violet-500 dark:bg-zinc-900 ${compact ? "w-full" : "w-56"}`}
          />
        </div>
        {compact ? (
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value as TemplateCategory | "all")}
            className="h-8 rounded-md border border-border bg-zinc-50 px-2 text-xs dark:bg-zinc-900"
          >
            <option value="all">All categories</option>
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({counts.get(c.id) ?? 0})
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" data-plain onClick={() => setCat("all")} className={chip(cat === "all")}>
            All <span className="opacity-60">{CANVAS_PRESETS.length}</span>
          </button>
          {TEMPLATE_CATEGORIES.map((c) => (
            <button key={c.id} type="button" data-plain onClick={() => setCat(c.id)} className={chip(cat === c.id)}>
              {c.label} <span className="opacity-60">{counts.get(c.id) ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 && !showBlank ? (
        <p className="py-10 text-center text-xs text-zinc-500">No templates match “{q}”.</p>
      ) : (
        <div className={`grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-3 sm:grid-cols-5"}`}>
          {showBlank && (
            <Tile id={BLANK_TEMPLATE_ID} label="Blank" width={width} height={height} active={value === BLANK_TEMPLATE_ID} onClick={() => onPick(BLANK_TEMPLATE_ID)} thumbH={thumbH} brand={brand} />
          )}
          {visible.map((t) => (
            <Tile
              key={t.id}
              id={t.id}
              label={t.label}
              sub={compact ? undefined : brand ? "Your brand" : CANVAS_THEMES[t.theme].label}
              width={width}
              height={height}
              active={value === t.id}
              onClick={() => onPick(t.id)}
              thumbH={thumbH}
              brand={brand}
            />
          ))}
        </div>
      )}
    </div>
  );
}
