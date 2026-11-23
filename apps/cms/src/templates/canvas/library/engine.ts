import {
  blankPage,
  makeImage,
  makeShape,
  makeText,
  type CanvasAnimation,
  type CanvasElement,
  type CanvasImageElement,
  type CanvasPage,
  type CanvasShapeElement,
  type CanvasTextElement,
} from "@platform/ui/templates/canvas";
import type { CanvasTheme } from "./themes";

/**
 * The little layout engine the template library is built on. Layouts work in
 * a unit `u` (1 at a 1080px short side) and stack text in columns whose
 * heights are estimated from the font's average glyph width, so headings can
 * shrink to fit their box instead of spilling off a portrait screen.
 */

export interface Ctx {
  W: number;
  H: number;
  u: number;
  portrait: boolean;
  square: boolean;
  pad: number;
  th: CanvasTheme;
}

export function ctx(W: number, H: number, th: CanvasTheme): Ctx {
  const u = Math.min(W, H) / 1080;
  const portrait = H > W * 1.1;
  const square = !portrait && W < H * 1.25;
  return { W, H, u, portrait, square, pad: (portrait ? 84 : 110) * u, th };
}

export function page(c: Ctx, opts: { flat?: boolean; color?: string } = {}): CanvasPage {
  const { th } = c;
  const color = opts.color ?? th.bg;
  return blankPage({
    color,
    gradient: !opts.flat && !opts.color && th.bg2 ? { from: th.bg2, to: th.bg, angle: 155 } : null,
  });
}

// ─── Text measuring ───────────────────────────────────────────────────────────

/** Average glyph advance as a fraction of the font size. */
function glyph(font: string, weight: number, upper: boolean, ls: number): number {
  let w = font.includes("Archivo Expanded") ? 0.8 : /Gelasio|Tinos|Caladea/.test(font) ? 0.58 : font.includes("Cousine") ? 0.62 : 0.57;
  if (weight >= 600) w += 0.04;
  if (upper) w *= 1.14;
  return w + ls;
}

/** A line's width in average glyphs — wide and narrow characters weighted. */
export function glyphs(line: string): number {
  let n = 0;
  for (const ch of line) {
    if ("%@MWmw₹".includes(ch)) n += 1.35;
    else if (/[A-Z0-9#&+]/.test(ch)) n += 1.1;
    else if ("iljftI1.,:;'’!|() ".includes(ch)) n += 0.55;
    else n += 1;
  }
  return n;
}

/** Estimated rendered width of a string, in px. */
export function measure(c: Ctx, str: string, o: { size: number; font?: "head" | "body"; weight?: number; upper?: boolean; ls?: number }): number {
  const font = o.font === "head" ? c.th.head : c.th.body;
  const g = glyph(font, o.weight ?? (o.font === "head" ? c.th.headWeight : 400), o.upper ?? false, o.ls ?? 0);
  return Math.max(...str.split("\n").map(glyphs)) * g * o.size * c.u;
}

export interface TextOpts {
  /** Font size at 1080p. */
  size: number;
  font?: "head" | "body";
  weight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  lh?: number;
  ls?: number;
  upper?: boolean;
  italic?: boolean;
  /** Shrink so the longest line fits the box on one line. */
  fit?: boolean;
  /** Floor for fit, at 1080p. */
  min?: number;
  anim?: CanvasAnimation;
  delay?: number;
  bg?: string | null;
  shadow?: boolean;
  opacity?: number;
}

/** A text element and the height it will take. */
export function text(c: Ctx, x: number, y: number, w: number, str: string, o: TextOpts): { el: CanvasTextElement; h: number } {
  const font = o.font === "head" ? c.th.head : c.th.body;
  const weight = o.weight ?? (o.font === "head" ? c.th.headWeight : 400);
  const upper = o.upper ?? false;
  const ls = o.ls ?? 0;
  const lh = o.lh ?? (o.font === "head" ? 1.05 : 1.35);
  const g = glyph(font, weight, upper, ls);
  const lines = str.split("\n");
  let px = o.size * c.u;
  if (o.fit) {
    const longest = Math.max(1, ...lines.map(glyphs));
    px = Math.max((o.min ?? 12) * c.u, Math.min(px, (w * 0.95) / (longest * g)));
  }
  px = Math.round(px);
  const perLine = Math.max(1, w / (px * g));
  const count = lines.reduce((n, l) => n + Math.max(1, Math.ceil((glyphs(l) * 0.98) / perLine)), 0);
  const h = Math.ceil(count * px * lh);
  const el = makeText(
    { x, y, w, h },
    {
      text: str,
      fontFamily: font,
      fontSize: px,
      fontWeight: weight,
      italic: o.italic ?? false,
      uppercase: upper,
      color: o.color ?? c.th.text,
      align: o.align ?? "left",
      lineHeight: lh,
      letterSpacing: ls,
      background: o.bg ?? null,
      shadow: o.shadow ?? false,
      opacity: o.opacity ?? 1,
      animation: o.anim ?? "none",
      animationDelay: o.delay,
    }
  );
  return { el, h };
}

export function rect(x: number, y: number, w: number, h: number, fill: string, patch: Partial<CanvasShapeElement> = {}): CanvasShapeElement {
  return makeShape({ x, y, w, h }, { fill, ...patch });
}

export function circle(cx: number, cy: number, r: number, fill: string, patch: Partial<CanvasShapeElement> = {}): CanvasShapeElement {
  return makeShape({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, { shape: "ellipse", fill, ...patch });
}

export function image(x: number, y: number, w: number, h: number, src: string, patch: Partial<CanvasImageElement> = {}): CanvasImageElement {
  return makeImage({ x, y, w, h }, src, patch);
}

/** A rounded label: accent pill with centred text. */
export function pill(c: Ctx, x: number, y: number, label: string, o: { fill?: string; color?: string; size?: number; align?: "left" | "center" | "right"; anim?: CanvasAnimation; delay?: number } = {}): { els: CanvasElement[]; w: number; h: number } {
  const size = (o.size ?? 30) * c.u;
  const g = glyph(c.th.body, 700, true, 0.12);
  const w = label.length * size * g + size * 2.4;
  const h = size * 2.3;
  const left = o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x;
  const bg = rect(left, y, w, h, o.fill ?? c.th.accent, { radius: h / 2, animation: o.anim ?? "fade", animationDelay: o.delay });
  const t = text(c, left, y + (h - size * 1.2) / 2, w, label, {
    size: o.size ?? 30,
    weight: 700,
    upper: true,
    ls: 0.12,
    lh: 1.2,
    align: "center",
    color: o.color ?? c.th.accentText,
    anim: o.anim ?? "fade",
    delay: o.delay,
  });
  return { els: [bg, t.el], w, h };
}

// ─── Columns ──────────────────────────────────────────────────────────────────

export type Part =
  | { t: "text"; str: string | undefined; o: TextOpts; gap?: number }
  | { t: "bar"; w: number; h?: number; color?: string; gap?: number }
  | { t: "pill"; str: string | undefined; gap?: number; fill?: string; color?: string }
  | { t: "space"; h: number };

/**
 * Stacks parts top to bottom inside a box and places the stack at the top,
 * centre or bottom. Gaps and sizes are at 1080p. Missing strings are skipped,
 * and each part enters a beat after the one before.
 */
export function column(
  c: Ctx,
  box: { x: number; y: number; w: number; h: number },
  parts: Part[],
  opts: { align?: "left" | "center" | "right"; v?: "top" | "center" | "bottom"; stagger?: number } = {}
): CanvasElement[] {
  // Lay out at full size; if the stack is taller than its box, shrink type
  // and gaps together until it fits (a square or portrait screen).
  let scale = 1;
  let run = stack(c, box, parts, opts, scale);
  for (let i = 0; i < 5 && box.h > 0 && run.total > box.h; i++) {
    scale *= Math.max(0.6, (box.h / run.total) * 0.98);
    run = stack(c, box, parts, opts, scale);
  }
  return run.els;
}

function stack(
  c: Ctx,
  box: { x: number; y: number; w: number; h: number },
  parts: Part[],
  opts: { align?: "left" | "center" | "right"; v?: "top" | "center" | "bottom"; stagger?: number },
  scale: number
): { els: CanvasElement[]; total: number } {
  const align = opts.align ?? "left";
  const placed: { els: CanvasElement[]; h: number; gap: number }[] = [];
  let beat = 0;
  for (const p of parts) {
    if (p.t === "space") {
      placed.push({ els: [], h: p.h * c.u * scale, gap: 0 });
      continue;
    }
    if ((p.t === "text" || p.t === "pill") && !p.str) continue;
    const gap = (p.gap ?? 0) * c.u * scale;
    const delay = beat * (opts.stagger ?? 0.12);
    beat++;
    if (p.t === "text") {
      const o = { align, anim: p.o.anim ?? (beat === 2 ? "slide-up" : "fade"), delay: p.o.delay ?? delay, ...p.o };
      o.size = p.o.size * scale;
      if (p.o.min) o.min = p.o.min * scale;
      const t = text(c, box.x, 0, box.w, p.str!, o);
      placed.push({ els: [t.el], h: t.h, gap });
    } else if (p.t === "bar") {
      const w = p.w * c.u;
      const h = (p.h ?? 6) * c.u;
      const x = align === "center" ? box.x + (box.w - w) / 2 : align === "right" ? box.x + box.w - w : box.x;
      placed.push({ els: [rect(x, 0, w, h, p.color ?? c.th.accent, { radius: h / 2, animation: "fade", animationDelay: delay })], h, gap });
    } else {
      const ax = align === "center" ? box.x + box.w / 2 : align === "right" ? box.x + box.w : box.x;
      const pl = pill(c, ax, 0, p.str!, { align, fill: p.fill, color: p.color, delay, size: 30 * Math.max(0.75, scale) });
      placed.push({ els: pl.els, h: pl.h, gap });
    }
  }
  const total = placed.reduce((n, p, i) => n + p.h + (i ? p.gap : 0), 0);
  let y = opts.v === "center" ? box.y + (box.h - total) / 2 : opts.v === "bottom" ? box.y + box.h - total : box.y;
  const els: CanvasElement[] = [];
  placed.forEach((p, i) => {
    if (i) y += p.gap;
    const top = Math.min(...p.els.map((e) => e.y), 0);
    for (const e of p.els) {
      e.y = y + (e.y - top);
      els.push(e);
    }
    y += p.h;
  });
  return { els, total };
}

/** Shorthand for the usual heading stack: eyebrow, title, body, CTA. */
export function headingParts(
  c: Ctx,
  k: { eyebrow?: string; title: string; body?: string; cta?: string },
  o: { title?: number; body?: number; eyebrowColor?: string; titleColor?: string; bodyColor?: string; bar?: boolean } = {}
): Part[] {
  return [
    { t: "text", str: k.eyebrow, o: { size: 28, weight: 700, upper: true, ls: 0.28, color: o.eyebrowColor ?? c.th.accent } },
    ...(o.bar ? [{ t: "bar" as const, w: 90, gap: 26 }] : []),
    { t: "text", str: k.title, o: { size: o.title ?? 120, font: "head", fit: true, min: 40, color: o.titleColor }, gap: k.eyebrow ? 30 : 0 },
    { t: "text", str: k.body, o: { size: o.body ?? 40, color: o.bodyColor ?? c.th.muted }, gap: 34 },
    { t: "pill", str: k.cta, gap: 48 },
  ];
}
