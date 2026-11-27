"use client";

import React from "react";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowRightLeft,
  BringToFront,
  ChevronDown,
  ChevronUp,
  Copy,
  Bold,
  Italic,
  Lock,
  SendToBack,
  Trash2,
  Underline,
  Unlock,
  CaseUpper,
  Image as ImageIcon,
  X,
} from "lucide-react";
import {
  CANVAS_FONTS,
  CANVAS_MAX_SIDE,
  CANVAS_MIN_SIDE,
  CANVAS_SIZE_PRESETS,
  canvasOrientation,
  type CanvasAnimation,
  type CanvasBackground,
  type CanvasElement,
  type CanvasPage,
} from "@platform/ui/templates/canvas";
import { ColorField, IconToggle, NumberField, Row, Section, SelectField, Slider } from "./editor-fields";

export type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type ArrangeKind = "front" | "forward" | "backward" | "back";

type Patch = Partial<CanvasElement> | ((el: CanvasElement) => CanvasElement);

const ANIMATIONS: { label: string; value: CanvasAnimation }[] = [
  { label: "None", value: "none" },
  { label: "Fade in", value: "fade" },
  { label: "Rise", value: "slide-up" },
  { label: "Slide in", value: "slide-left" },
  { label: "Pop", value: "zoom" },
];

const WEIGHTS = [
  { label: "Light", value: 300 },
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
  { label: "Black", value: 900 },
];

export function EditorRightPanel({
  width,
  height,
  page,
  pageCount,
  selected,
  patch,
  begin,
  end,
  patchPage,
  onResizeCanvas,
  onAlign,
  onArrange,
  onDuplicate,
  onDelete,
  onReplaceMedia,
  onPickBackground,
}: {
  width: number;
  height: number;
  page: CanvasPage;
  pageCount: number;
  selected: CanvasElement[];
  patch: (ids: string[], p: Patch) => void;
  begin: () => void;
  end: () => void;
  patchPage: (p: Partial<CanvasPage>) => void;
  onResizeCanvas: (w: number, h: number) => void;
  onAlign: (kind: AlignKind) => void;
  onArrange: (kind: ArrangeKind) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReplaceMedia: (id: string, kind: "image" | "video") => void;
  onPickBackground: () => void;
}) {
  const single = selected.length === 1 ? selected[0]! : null;
  const ids = selected.map((e) => e.id);
  const p = (x: Patch) => patch(ids, x);

  const alignRow = (
    <div className="grid grid-cols-6 gap-1">
      <IconToggle title="Align left" onClick={() => onAlign("left")}><AlignStartVertical className="h-4 w-4" /></IconToggle>
      <IconToggle title="Align centre" onClick={() => onAlign("hcenter")}><AlignCenterVertical className="h-4 w-4" /></IconToggle>
      <IconToggle title="Align right" onClick={() => onAlign("right")}><AlignEndVertical className="h-4 w-4" /></IconToggle>
      <IconToggle title="Align top" onClick={() => onAlign("top")}><AlignStartHorizontal className="h-4 w-4" /></IconToggle>
      <IconToggle title="Align middle" onClick={() => onAlign("vcenter")}><AlignCenterHorizontal className="h-4 w-4" /></IconToggle>
      <IconToggle title="Align bottom" onClick={() => onAlign("bottom")}><AlignEndHorizontal className="h-4 w-4" /></IconToggle>
    </div>
  );

  const actionsRow = (
    <div className="flex gap-1">
      <IconToggle title="Bring to front" onClick={() => onArrange("front")}><BringToFront className="h-4 w-4" /></IconToggle>
      <IconToggle title="Bring forward" onClick={() => onArrange("forward")}><ChevronUp className="h-4 w-4" /></IconToggle>
      <IconToggle title="Send backward" onClick={() => onArrange("backward")}><ChevronDown className="h-4 w-4" /></IconToggle>
      <IconToggle title="Send to back" onClick={() => onArrange("back")}><SendToBack className="h-4 w-4" /></IconToggle>
      <div className="flex-1" />
      <IconToggle title="Duplicate (Ctrl+D)" onClick={onDuplicate}><Copy className="h-4 w-4" /></IconToggle>
      <IconToggle title="Delete (Del)" onClick={onDelete}><Trash2 className="h-4 w-4 text-red-500" /></IconToggle>
    </div>
  );

  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-border bg-card text-card-foreground">
      {selected.length === 0 && (
        <>
          <CanvasSizeSection width={width} height={height} onResize={onResizeCanvas} />
          <BackgroundSection
            bg={page.background}
            onChange={(bg) => patchPage({ background: { ...page.background, ...bg } })}
            begin={begin}
            end={end}
            onPickImage={onPickBackground}
          />
          <Section title="Page timing">
            <Row label="Show for">
              <NumberField
                value={page.durationSeconds}
                min={1}
                max={3600}
                suffix="s"
                onChange={(v) => patchPage({ durationSeconds: v })}
              />
            </Row>
            <p className="text-[11px] leading-snug text-zinc-500">
              {pageCount > 1
                ? "Screens step through the pages in order, then loop."
                : "Add more pages to make the design cycle on screen."}
            </p>
          </Section>
        </>
      )}

      {selected.length > 1 && (
        <>
          <Section title={`${selected.length} selected`}>
            {alignRow}
            {actionsRow}
          </Section>
          <Section title="Opacity">
            <Row label="Opacity">
              <Slider
                value={Math.round((selected[0]!.opacity ?? 1) * 100)}
                min={0}
                max={100}
                onStart={begin}
                onEnd={end}
                onChange={(v) => p({ opacity: v / 100 })}
              />
            </Row>
          </Section>
        </>
      )}

      {single && (
        <>
          {single.type === "text" && (
            <Section title="Text">
              <textarea
                value={single.text}
                onFocus={begin}
                onBlur={end}
                onChange={(e) => p({ text: e.target.value } as Partial<CanvasElement>)}
                rows={3}
                className="w-full resize-y rounded-md border border-border bg-zinc-100 px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-violet-500 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <Row label="Font">
                <SelectField
                  value={single.fontFamily}
                  width={170}
                  options={CANVAS_FONTS.map((f) => ({ label: f.label, value: f.value }))}
                  onChange={(v) => p({ fontFamily: v } as Partial<CanvasElement>)}
                />
              </Row>
              <Row label="Size / weight">
                <NumberField value={single.fontSize} min={4} max={2000} onChange={(v) => p({ fontSize: v } as Partial<CanvasElement>)} />
                <SelectField
                  value={single.fontWeight}
                  width={100}
                  options={WEIGHTS}
                  onChange={(v) => p({ fontWeight: v } as Partial<CanvasElement>)}
                />
              </Row>
              <div className="flex flex-wrap gap-1">
                <IconToggle title="Bold" active={single.fontWeight >= 700} onClick={() => p({ fontWeight: single.fontWeight >= 700 ? 400 : 700 } as Partial<CanvasElement>)}>
                  <Bold className="h-4 w-4" />
                </IconToggle>
                <IconToggle title="Italic" active={single.italic} onClick={() => p({ italic: !single.italic } as Partial<CanvasElement>)}>
                  <Italic className="h-4 w-4" />
                </IconToggle>
                <IconToggle title="Underline" active={single.underline} onClick={() => p({ underline: !single.underline } as Partial<CanvasElement>)}>
                  <Underline className="h-4 w-4" />
                </IconToggle>
                <IconToggle title="Uppercase" active={single.uppercase} onClick={() => p({ uppercase: !single.uppercase } as Partial<CanvasElement>)}>
                  <CaseUpper className="h-4 w-4" />
                </IconToggle>
                <div className="w-2" />
                <IconToggle title="Align text left" active={single.align === "left"} onClick={() => p({ align: "left" } as Partial<CanvasElement>)}>
                  <AlignLeft className="h-4 w-4" />
                </IconToggle>
                <IconToggle title="Centre text" active={single.align === "center"} onClick={() => p({ align: "center" } as Partial<CanvasElement>)}>
                  <AlignCenter className="h-4 w-4" />
                </IconToggle>
                <IconToggle title="Align text right" active={single.align === "right"} onClick={() => p({ align: "right" } as Partial<CanvasElement>)}>
                  <AlignRight className="h-4 w-4" />
                </IconToggle>
              </div>
              <Row label="Colour">
                <ColorField value={single.color} onStart={begin} onEnd={end} onChange={(v) => p({ color: v } as Partial<CanvasElement>)} />
              </Row>
              <Row label="Line height">
                <NumberField value={single.lineHeight} min={0.5} max={4} step={0.05} onChange={(v) => p({ lineHeight: v } as Partial<CanvasElement>)} />
              </Row>
              <Row label="Letter spacing">
                <NumberField value={single.letterSpacing} min={-0.2} max={2} step={0.01} suffix="em" onChange={(v) => p({ letterSpacing: v } as Partial<CanvasElement>)} />
              </Row>
              <Row label="Shadow">
                <input type="checkbox" checked={single.shadow} onChange={(e) => p({ shadow: e.target.checked } as Partial<CanvasElement>)} className="accent-violet-600" />
              </Row>
              <Row label="Highlight">
                <input
                  type="checkbox"
                  checked={single.background !== null}
                  onChange={(e) => p({ background: e.target.checked ? "#fde047" : null } as Partial<CanvasElement>)}
                  className="accent-violet-600"
                />
              </Row>
              {single.background !== null && (
                <ColorField value={single.background} onStart={begin} onEnd={end} onChange={(v) => p({ background: v } as Partial<CanvasElement>)} />
              )}
            </Section>
          )}

          {single.type === "shape" && (
            <Section title="Shape">
              <Row label="Type">
                <SelectField
                  value={single.shape}
                  options={[
                    { label: "Rectangle", value: "rect" },
                    { label: "Ellipse", value: "ellipse" },
                  ]}
                  onChange={(v) => p({ shape: v } as Partial<CanvasElement>)}
                />
              </Row>
              <Row label="Fill">
                <ColorField value={single.fill} onStart={begin} onEnd={end} onChange={(v) => p({ fill: v } as Partial<CanvasElement>)} />
              </Row>
              {single.shape === "rect" && (
                <Row label="Corner radius">
                  <NumberField value={single.radius} min={0} max={4000} onChange={(v) => p({ radius: v } as Partial<CanvasElement>)} />
                </Row>
              )}
              <Row label="Border">
                <NumberField
                  value={single.strokeWidth}
                  min={0}
                  max={500}
                  suffix="px"
                  onChange={(v) => p({ strokeWidth: v, stroke: single.stroke ?? "#111111" } as Partial<CanvasElement>)}
                />
              </Row>
              {single.strokeWidth > 0 && (
                <ColorField value={single.stroke ?? "#111111"} onStart={begin} onEnd={end} onChange={(v) => p({ stroke: v } as Partial<CanvasElement>)} />
              )}
            </Section>
          )}

          {(single.type === "image" || single.type === "video") && (
            <Section title={single.type === "image" ? "Image" : "Video"}>
              <button
                type="button"
                onClick={() => onReplaceMedia(single.id, single.type as "image" | "video")}
                className="h-8 rounded-md border border-border text-xs font-medium hover:bg-accent"
              >
                Replace {single.type}
              </button>
              <Row label="Fit">
                <SelectField
                  value={single.fit}
                  options={[
                    { label: "Fill (crop)", value: "cover" },
                    { label: "Fit (whole)", value: "contain" },
                  ]}
                  onChange={(v) => p({ fit: v } as Partial<CanvasElement>)}
                />
              </Row>
              <Row label="Corner radius">
                <NumberField value={single.radius} min={0} max={4000} onChange={(v) => p({ radius: v } as Partial<CanvasElement>)} />
              </Row>
              {single.type === "video" && (
                <>
                  <Row label="Sound on screen">
                    <input type="checkbox" checked={!single.muted} onChange={(e) => p({ muted: !e.target.checked } as Partial<CanvasElement>)} className="accent-violet-600" />
                  </Row>
                  <Row label="Loop">
                    <input type="checkbox" checked={single.loop} onChange={(e) => p({ loop: e.target.checked } as Partial<CanvasElement>)} className="accent-violet-600" />
                  </Row>
                </>
              )}
            </Section>
          )}

          <Section
            title="Position"
            action={
              <button
                type="button"
                data-plain
                onClick={() => p({ locked: !single.locked })}
                className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                {single.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                {single.locked ? "Locked" : "Lock"}
              </button>
            }
          >
            {alignRow}
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="X" width={120} value={single.x} onChange={(v) => p({ x: v })} />
              <NumberField label="Y" width={120} value={single.y} onChange={(v) => p({ y: v })} />
              <NumberField label="W" width={120} min={1} value={single.w} onChange={(v) => p({ w: v })} />
              {single.type === "text" ? (
                <div className="flex h-8 items-center px-2 text-[11px] text-zinc-400">H follows text</div>
              ) : (
                <NumberField label="H" width={120} min={1} value={single.h} onChange={(v) => p({ h: v })} />
              )}
            </div>
            <Row label="Rotation">
              <NumberField value={single.rotation} min={-180} max={180} suffix="°" onChange={(v) => p({ rotation: v })} />
            </Row>
            <Row label="Opacity">
              <Slider
                value={Math.round(single.opacity * 100)}
                min={0}
                max={100}
                onStart={begin}
                onEnd={end}
                onChange={(v) => p({ opacity: v / 100 })}
              />
              <span className="w-8 text-right text-[11px] text-zinc-500">{Math.round(single.opacity * 100)}%</span>
            </Row>
            {actionsRow}
          </Section>

          <Section title="Animation">
            <Row label="Entrance">
              <SelectField value={single.animation ?? "none"} options={ANIMATIONS} onChange={(v) => p({ animation: v })} />
            </Row>
            {single.animation && single.animation !== "none" && (
              <Row label="Delay">
                <NumberField value={single.animationDelay ?? 0} min={0} max={30} step={0.1} suffix="s" onChange={(v) => p({ animationDelay: v })} />
              </Row>
            )}
            <p className="text-[11px] leading-snug text-zinc-500">Plays on screen and in Preview each time the page appears.</p>
          </Section>
        </>
      )}
    </aside>
  );
}

function CanvasSizeSection({
  width,
  height,
  onResize,
}: {
  width: number;
  height: number;
  onResize: (w: number, h: number) => void;
}) {
  const preset = CANVAS_SIZE_PRESETS.find((s) => s.width === width && s.height === height);
  const orientation = canvasOrientation(width, height);
  return (
    <Section title="Canvas">
      <Row label="Size">
        <SelectField
          value={preset?.id ?? "custom"}
          width={170}
          options={[
            ...CANVAS_SIZE_PRESETS.map((s) => ({ label: s.label, value: s.id })),
            ...(preset ? [] : [{ label: `Custom ${width}×${height}`, value: "custom" }]),
          ]}
          onChange={(id) => {
            const s = CANVAS_SIZE_PRESETS.find((x) => x.id === id);
            if (s) onResize(s.width, s.height);
          }}
        />
      </Row>
      <div className="flex items-center gap-2">
        <NumberField label="W" width={92} min={CANVAS_MIN_SIDE} max={CANVAS_MAX_SIDE} value={width} onChange={(v) => onResize(Math.round(v), height)} />
        <NumberField label="H" width={92} min={CANVAS_MIN_SIDE} max={CANVAS_MAX_SIDE} value={height} onChange={(v) => onResize(width, Math.round(v))} />
        <IconToggle title="Swap landscape / portrait" onClick={() => onResize(height, width)} disabled={width === height}>
          <ArrowRightLeft className="h-4 w-4" />
        </IconToggle>
      </div>
      <p className="text-[11px] capitalize text-zinc-500">
        {orientation} · resizing re-fits everything on every page
      </p>
    </Section>
  );
}

function BackgroundSection({
  bg,
  onChange,
  begin,
  end,
  onPickImage,
}: {
  bg: CanvasBackground;
  onChange: (bg: Partial<CanvasBackground>) => void;
  begin: () => void;
  end: () => void;
  onPickImage: () => void;
}) {
  return (
    <Section title="Background">
      <Row label="Colour">
        <ColorField value={bg.color} onStart={begin} onEnd={end} onChange={(v) => onChange({ color: v })} />
      </Row>
      <Row label="Gradient">
        <input
          type="checkbox"
          checked={bg.gradient !== null}
          onChange={(e) => onChange({ gradient: e.target.checked ? { from: bg.color, to: "#7c3aed", angle: 135 } : null })}
          className="accent-violet-600"
        />
      </Row>
      {bg.gradient && (
        <>
          <Row label="From">
            <ColorField swatches={false} value={bg.gradient.from} onStart={begin} onEnd={end} onChange={(v) => onChange({ gradient: { ...bg.gradient!, from: v } })} />
          </Row>
          <Row label="To">
            <ColorField swatches={false} value={bg.gradient.to} onStart={begin} onEnd={end} onChange={(v) => onChange({ gradient: { ...bg.gradient!, to: v } })} />
          </Row>
          <Row label="Angle">
            <NumberField value={bg.gradient.angle} min={0} max={360} suffix="°" onChange={(v) => onChange({ gradient: { ...bg.gradient!, angle: v } })} />
          </Row>
        </>
      )}
      <Row label="Image">
        {bg.imageUrl ? (
          <div className="flex items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bg.imageUrl} alt="" className="h-8 w-12 rounded border border-border object-cover" />
            <IconToggle title="Remove background image" onClick={() => onChange({ imageUrl: null, imageAssetId: undefined })}>
              <X className="h-4 w-4" />
            </IconToggle>
          </div>
        ) : (
          <button type="button" onClick={onPickImage} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs hover:bg-accent">
            <ImageIcon className="h-3.5 w-3.5" /> Choose
          </button>
        )}
      </Row>
      {bg.imageUrl && (
        <Row label="Image fit">
          <SelectField
            value={bg.imageFit}
            options={[
              { label: "Fill (crop)", value: "cover" },
              { label: "Fit (whole)", value: "contain" },
            ]}
            onChange={(v) => onChange({ imageFit: v })}
          />
        </Row>
      )}
    </Section>
  );
}
