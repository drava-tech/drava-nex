"use client";

import React, { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Circle,
  Film,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  Lock,
  Minus,
  Shapes,
  Square,
  Type,
  Unlock,
} from "lucide-react";
import {
  CANVAS_FONTS,
  makeShape,
  makeText,
  type CanvasElement,
  type CanvasPage,
} from "@platform/ui/templates/canvas";
import { TemplatePicker, buildTemplate } from "./template-picker";

type Tab = "elements" | "presets" | "layers";

export function EditorLeftPanel({
  width,
  height,
  page,
  selectedIds,
  onAdd,
  onPickMedia,
  onApplyPreset,
  onSelect,
  onMoveLayer,
  onToggleLock,
}: {
  width: number;
  height: number;
  page: CanvasPage;
  selectedIds: string[];
  onAdd: (el: CanvasElement) => void;
  onPickMedia: (kind: "image" | "video") => void;
  onApplyPreset: (page: CanvasPage) => void;
  onSelect: (ids: string[]) => void;
  onMoveLayer: (id: string, dir: 1 | -1) => void;
  onToggleLock: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("elements");
  const u = Math.min(width, height) / 1080;

  // New elements land centred on the canvas.
  const centred = (w: number, h: number) => ({ x: (width - w) / 2, y: (height - h) / 2, w, h });

  const addText = (kind: "heading" | "subheading" | "body") => {
    const spec = {
      heading: { size: 110, weight: 700, text: "Add a heading", font: CANVAS_FONTS[1]!.value, w: 1100 },
      subheading: { size: 60, weight: 600, text: "Add a subheading", font: CANVAS_FONTS[0]!.value, w: 900 },
      body: { size: 38, weight: 400, text: "Add a little bit of body text", font: CANVAS_FONTS[0]!.value, w: 800 },
    }[kind];
    const w = Math.min(width * 0.9, spec.w * u);
    onAdd(
      makeText(centred(w, spec.size * u * 1.2), {
        text: spec.text,
        fontSize: Math.round(spec.size * u),
        fontWeight: spec.weight,
        fontFamily: spec.font,
        align: "center",
      })
    );
  };

  return (
    <aside className="flex w-[300px] shrink-0 border-r border-border bg-card text-card-foreground">
      <nav className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-border py-3">
        {(
          [
            ["elements", Shapes, "Elements"],
            ["presets", LayoutTemplate, "Presets"],
            ["layers", Layers, "Layers"],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            data-plain
            onClick={() => setTab(id)}
            className={`flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors ${
              tab === id ? "bg-violet-500/10 text-violet-600 dark:text-violet-300" : "text-zinc-500 hover:bg-accent"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto p-3">
        {tab === "elements" && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <PanelTitle>Text</PanelTitle>
              <button type="button" data-plain onClick={() => addText("heading")} className={tileCls}>
                <span className="text-lg font-bold">Add a heading</span>
              </button>
              <button type="button" data-plain onClick={() => addText("subheading")} className={tileCls}>
                <span className="text-sm font-semibold">Add a subheading</span>
              </button>
              <button type="button" data-plain onClick={() => addText("body")} className={tileCls}>
                <span className="text-xs">Add body text</span>
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <PanelTitle>Shapes</PanelTitle>
              <div className="grid grid-cols-4 gap-2">
                <ShapeTile title="Square" onClick={() => onAdd(makeShape(centred(400 * u, 400 * u)))}>
                  <Square className="h-6 w-6 fill-current" />
                </ShapeTile>
                <ShapeTile
                  title="Rounded"
                  onClick={() => onAdd(makeShape(centred(500 * u, 300 * u), { radius: 48 * u, fill: "#0ea5e9" }))}
                >
                  <div className="h-5 w-7 rounded-md bg-current" />
                </ShapeTile>
                <ShapeTile
                  title="Circle"
                  onClick={() => onAdd(makeShape(centred(400 * u, 400 * u), { shape: "ellipse", fill: "#f59e0b" }))}
                >
                  <Circle className="h-6 w-6 fill-current" />
                </ShapeTile>
                <ShapeTile
                  title="Line"
                  onClick={() => onAdd(makeShape(centred(600 * u, Math.max(2, 8 * u)), { fill: "#111111" }))}
                >
                  <Minus className="h-6 w-6" strokeWidth={3} />
                </ShapeTile>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <PanelTitle>Media library</PanelTitle>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" data-plain onClick={() => onPickMedia("image")} className={`${tileCls} flex-col gap-1.5 py-4`}>
                  <ImageIcon className="h-5 w-5 text-zinc-500" />
                  <span className="text-xs">Image</span>
                </button>
                <button type="button" data-plain onClick={() => onPickMedia("video")} className={`${tileCls} flex-col gap-1.5 py-4`}>
                  <Film className="h-5 w-5 text-zinc-500" />
                  <span className="text-xs">Video</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "presets" && (
          <div className="flex flex-col gap-3">
            <PanelTitle>Templates</PanelTitle>
            <p className="text-[11px] leading-snug text-zinc-500">
              Replaces what&apos;s on this page, sized for your canvas. Ctrl+Z undoes it.
            </p>
            <TemplatePicker compact width={width} height={height} onPick={(id) => onApplyPreset(buildTemplate(id, width, height))} />
          </div>
        )}

        {tab === "layers" && (
          <div className="flex flex-col gap-2">
            <PanelTitle>Layers (top first)</PanelTitle>
            {page.elements.length === 0 && <p className="text-xs text-zinc-500">Nothing on this page yet.</p>}
            {[...page.elements].reverse().map((el, i, arr) => {
              const active = selectedIds.includes(el.id);
              return (
                <div
                  key={el.id}
                  onClick={(e) =>
                    onSelect(
                      e.shiftKey
                        ? active
                          ? selectedIds.filter((x) => x !== el.id)
                          : [...selectedIds, el.id]
                        : [el.id]
                    )
                  }
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                    active ? "border-violet-500 bg-violet-500/10" : "border-border hover:bg-accent"
                  }`}
                >
                  <LayerIcon el={el} />
                  <span className="min-w-0 flex-1 truncate">{layerName(el)}</span>
                  <LayerBtn title="Bring forward" disabled={i === 0} onClick={() => onMoveLayer(el.id, 1)}>
                    <ArrowUp className="h-3 w-3" />
                  </LayerBtn>
                  <LayerBtn title="Send backward" disabled={i === arr.length - 1} onClick={() => onMoveLayer(el.id, -1)}>
                    <ArrowDown className="h-3 w-3" />
                  </LayerBtn>
                  <LayerBtn title={el.locked ? "Unlock" : "Lock"} onClick={() => onToggleLock(el.id)}>
                    {el.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                  </LayerBtn>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

const tileCls =
  "flex w-full items-center justify-center rounded-lg border border-border bg-zinc-50 px-3 py-3 text-zinc-800 transition-colors hover:border-violet-400 hover:bg-violet-500/5 dark:bg-zinc-800/60 dark:text-zinc-100";

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{children}</h3>;
}

function ShapeTile({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-plain
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex aspect-square items-center justify-center rounded-lg border border-border bg-zinc-50 text-zinc-700 transition-colors hover:border-violet-400 hover:text-violet-600 dark:bg-zinc-800/60 dark:text-zinc-200"
    >
      {children}
    </button>
  );
}

function LayerBtn({
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
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-1 text-zinc-500 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-700"
    >
      {children}
    </button>
  );
}

function LayerIcon({ el }: { el: CanvasElement }) {
  const cls = "h-3.5 w-3.5 shrink-0 text-zinc-500";
  if (el.type === "text") return <Type className={cls} />;
  if (el.type === "image") return <ImageIcon className={cls} />;
  if (el.type === "video") return <Film className={cls} />;
  return el.shape === "ellipse" ? <Circle className={cls} /> : <Square className={cls} />;
}

function layerName(el: CanvasElement): string {
  if (el.type === "text") return el.text.split("\n")[0] || "Text";
  if (el.type === "shape") return el.shape === "ellipse" ? "Circle" : "Rectangle";
  return decodeURIComponent(el.src.split("/").pop() ?? el.type);
}
