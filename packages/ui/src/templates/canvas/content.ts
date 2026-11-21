// Content shape for the Canvas ("Design") template — a free-form, Canva-style
// layout built in the Frames editor. Stored on the experience as
// experience.templateContent.canvas, the same keyed-JSONB convention as every
// other template (the DB stores it loosely; readCanvasContent normalises it).
//
// All coordinates are in DESIGN pixels: a 1080×1920 portrait design has its
// elements laid out on a 1080×1920 surface, and the renderer scales the whole
// surface to whatever screen shows it (letterboxed, never stretched).

export type CanvasOrientation = "landscape" | "portrait" | "square";

export type CanvasAnimation = "none" | "fade" | "slide-up" | "slide-left" | "zoom";

interface CanvasElementBase {
  id: string;
  /** Top-left corner, before rotation (rotation is around the centre). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** 0–1. */
  opacity: number;
  locked?: boolean;
  /** Entrance animation when the page comes on screen. */
  animation?: CanvasAnimation;
  /** Seconds after the page appears before the entrance animation starts. */
  animationDelay?: number;
}

export interface CanvasTextElement extends CanvasElementBase {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  uppercase: boolean;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  /** In em. */
  letterSpacing: number;
  /** Highlight box behind the text; null = none. */
  background: string | null;
  shadow: boolean;
}

export interface CanvasShapeElement extends CanvasElementBase {
  type: "shape";
  shape: "rect" | "ellipse";
  fill: string;
  stroke: string | null;
  strokeWidth: number;
  /** Corner radius in design px (rect only). */
  radius: number;
}

export interface CanvasImageElement extends CanvasElementBase {
  type: "image";
  src: string;
  assetId?: string;
  fit: "cover" | "contain";
  radius: number;
}

export interface CanvasVideoElement extends CanvasElementBase {
  type: "video";
  src: string;
  assetId?: string;
  fit: "cover" | "contain";
  radius: number;
  muted: boolean;
  loop: boolean;
}

export type CanvasElement =
  | CanvasTextElement
  | CanvasShapeElement
  | CanvasImageElement
  | CanvasVideoElement;

export type CanvasElementType = CanvasElement["type"];

export interface CanvasBackground {
  color: string;
  /** Linear gradient over the colour; null = flat colour. */
  gradient: { from: string; to: string; angle: number } | null;
  imageUrl: string | null;
  imageAssetId?: string;
  imageFit: "cover" | "contain";
}

export interface CanvasPage {
  id: string;
  /** How long the page stays up before the next one, when a design has several. */
  durationSeconds: number;
  background: CanvasBackground;
  elements: CanvasElement[];
}

export interface CanvasContent {
  version: 1;
  width: number;
  height: number;
  pages: CanvasPage[];
}

// ─── Sizes ────────────────────────────────────────────────────────────────────

export interface CanvasSizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const CANVAS_SIZE_PRESETS: CanvasSizePreset[] = [
  { id: "landscape-hd", label: "Landscape · Full HD", width: 1920, height: 1080 },
  { id: "portrait-hd", label: "Portrait · Full HD", width: 1080, height: 1920 },
  { id: "landscape-4k", label: "Landscape · 4K", width: 3840, height: 2160 },
  { id: "portrait-4k", label: "Portrait · 4K", width: 2160, height: 3840 },
  { id: "square", label: "Square", width: 1080, height: 1080 },
];

export const CANVAS_MIN_SIDE = 200;
export const CANVAS_MAX_SIDE = 7680;

export function canvasOrientation(width: number, height: number): CanvasOrientation {
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

// ─── Fonts ────────────────────────────────────────────────────────────────────
// Families the CMS ships (next/font + @fontsource, loaded by the app), so a
// design looks identical in the editor and on an offline screen.

export const CANVAS_FONTS: { label: string; value: string }[] = [
  { label: "Inter", value: "var(--font-inter), Inter, system-ui, sans-serif" },
  { label: "Archivo Expanded", value: "var(--font-archivo-expanded), 'Archivo Expanded', sans-serif" },
  { label: "Arimo", value: "Arimo, Arial, sans-serif" },
  { label: "Carlito", value: "Carlito, Calibri, sans-serif" },
  { label: "Tinos", value: "Tinos, 'Times New Roman', serif" },
  { label: "Gelasio", value: "Gelasio, Georgia, serif" },
  { label: "Caladea", value: "Caladea, Cambria, serif" },
  { label: "Cousine", value: "Cousine, 'Courier New', monospace" },
];

export const DEFAULT_CANVAS_FONT = CANVAS_FONTS[0]!.value;

// ─── Factories ────────────────────────────────────────────────────────────────

export function canvasId(): string {
  // crypto.randomUUID is in every browser and Node the CMS runs on, but not in
  // insecure (http, non-localhost) contexts — the kiosk LAN case — so fall back.
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID().slice(0, 12);
    }
  } catch {
    /* fall through */
  }
  return Math.random().toString(36).slice(2, 14);
}

export function defaultBackground(color = "#ffffff"): CanvasBackground {
  return { color, gradient: null, imageUrl: null, imageFit: "cover" };
}

export function blankPage(background?: Partial<CanvasBackground>): CanvasPage {
  return {
    id: canvasId(),
    durationSeconds: 10,
    background: { ...defaultBackground(), ...background },
    elements: [],
  };
}

export function blankCanvas(width = 1920, height = 1080): CanvasContent {
  return { version: 1, width, height, pages: [blankPage()] };
}

export const DEFAULT_CANVAS_CONTENT: CanvasContent = blankCanvas();

type Base = Pick<CanvasElementBase, "x" | "y" | "w" | "h">;

export function makeText(base: Base, patch: Partial<CanvasTextElement> = {}): CanvasTextElement {
  return {
    id: canvasId(),
    type: "text",
    rotation: 0,
    opacity: 1,
    animation: "none",
    text: "Your text here",
    fontFamily: DEFAULT_CANVAS_FONT,
    fontSize: 64,
    fontWeight: 400,
    italic: false,
    underline: false,
    uppercase: false,
    color: "#111111",
    align: "left",
    lineHeight: 1.2,
    letterSpacing: 0,
    background: null,
    shadow: false,
    ...base,
    ...patch,
  };
}

export function makeShape(base: Base, patch: Partial<CanvasShapeElement> = {}): CanvasShapeElement {
  return {
    id: canvasId(),
    type: "shape",
    rotation: 0,
    opacity: 1,
    animation: "none",
    shape: "rect",
    fill: "#7c3aed",
    stroke: null,
    strokeWidth: 0,
    radius: 0,
    ...base,
    ...patch,
  };
}

export function makeImage(base: Base, src: string, patch: Partial<CanvasImageElement> = {}): CanvasImageElement {
  return {
    id: canvasId(),
    type: "image",
    rotation: 0,
    opacity: 1,
    animation: "none",
    src,
    fit: "cover",
    radius: 0,
    ...base,
    ...patch,
  };
}

export function makeVideo(base: Base, src: string, patch: Partial<CanvasVideoElement> = {}): CanvasVideoElement {
  return {
    id: canvasId(),
    type: "video",
    rotation: 0,
    opacity: 1,
    animation: "none",
    src,
    fit: "cover",
    radius: 0,
    muted: true,
    loop: true,
    ...base,
    ...patch,
  };
}

/** Deep copy with fresh ids — for duplicating a page or a whole design. */
export function clonePage(page: CanvasPage): CanvasPage {
  return {
    ...structuredCloneSafe(page),
    id: canvasId(),
    elements: page.elements.map((el) => ({ ...structuredCloneSafe(el), id: canvasId() })),
  };
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Re-lays a design onto a new canvas size: every element is scaled uniformly
 * (by the smaller axis ratio) and re-centred, so a landscape layout dropped
 * onto a portrait canvas stays intact and in the middle rather than stretched.
 */
export function resizeCanvas(content: CanvasContent, width: number, height: number): CanvasContent {
  const s = Math.min(width / content.width, height / content.height);
  const offX = (width - content.width * s) / 2;
  const offY = (height - content.height * s) / 2;
  return {
    ...content,
    width,
    height,
    pages: content.pages.map((p) => ({
      ...p,
      elements: p.elements.map((el) => scaleElement(el, s, offX, offY)),
    })),
  };
}

export function scaleElement<T extends CanvasElement>(el: T, s: number, offX = 0, offY = 0): T {
  const next = { ...el, x: el.x * s + offX, y: el.y * s + offY, w: el.w * s, h: el.h * s };
  if (next.type === "text") next.fontSize = Math.max(4, Math.round(next.fontSize * s));
  if (next.type === "shape") {
    next.radius = next.radius * s;
    next.strokeWidth = next.strokeWidth * s;
  }
  if (next.type === "image" || next.type === "video") next.radius = next.radius * s;
  return next;
}

// ─── Reading ──────────────────────────────────────────────────────────────────

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clampSide(v: unknown, fallback: number): number {
  return Math.min(CANVAS_MAX_SIDE, Math.max(CANVAS_MIN_SIDE, Math.round(num(v, fallback))));
}

function readElement(raw: unknown): CanvasElement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const base: Base = { x: num(r.x, 0), y: num(r.y, 0), w: Math.max(1, num(r.w, 100)), h: Math.max(1, num(r.h, 100)) };
  const common = {
    id: typeof r.id === "string" && r.id ? r.id : canvasId(),
    rotation: num(r.rotation, 0),
    opacity: Math.min(1, Math.max(0, num(r.opacity, 1))),
  };
  switch (r.type) {
    case "text":
      return { ...makeText(base), ...(r as Partial<CanvasTextElement>), ...base, ...common, type: "text" };
    case "shape":
      return { ...makeShape(base), ...(r as Partial<CanvasShapeElement>), ...base, ...common, type: "shape" };
    case "image":
      if (typeof r.src !== "string") return null;
      return { ...makeImage(base, r.src), ...(r as Partial<CanvasImageElement>), ...base, ...common, type: "image" };
    case "video":
      if (typeof r.src !== "string") return null;
      return { ...makeVideo(base, r.src), ...(r as Partial<CanvasVideoElement>), ...base, ...common, type: "video" };
    default:
      return null;
  }
}

function readPage(raw: unknown): CanvasPage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const bg = (r.background ?? {}) as Partial<CanvasBackground>;
  return {
    id: typeof r.id === "string" && r.id ? r.id : canvasId(),
    durationSeconds: Math.max(1, Math.round(num(r.durationSeconds, 10))),
    background: { ...defaultBackground(), ...bg },
    elements: Array.isArray(r.elements)
      ? r.elements.map(readElement).filter((e): e is CanvasElement => e !== null)
      : [],
  };
}

/** Normalises any stored blob into a valid CanvasContent (never throws). */
export function normalizeCanvasContent(raw: unknown): CanvasContent {
  if (!raw || typeof raw !== "object") return blankCanvas();
  const r = raw as Record<string, unknown>;
  const pages = Array.isArray(r.pages)
    ? r.pages.map(readPage).filter((p): p is CanvasPage => p !== null)
    : [];
  return {
    version: 1,
    width: clampSide(r.width, 1920),
    height: clampSide(r.height, 1080),
    pages: pages.length > 0 ? pages : [blankPage()],
  };
}

/** Reads the canvas content slice off an experience row, or null if unset. */
export function readCanvasContent(
  templateContent: Record<string, unknown> | null | undefined
): CanvasContent | null {
  const slice = templateContent?.["canvas"];
  return slice ? normalizeCanvasContent(slice) : null;
}
