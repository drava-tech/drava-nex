import type { CanvasElement } from "@platform/ui/templates/canvas";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rotated extends Box {
  rotation: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export function rotateVec(x: number, y: number, deg: number): [number, number] {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [x * c - y * s, x * s + y * c];
}

/** Axis-aligned bounds of a (possibly rotated) box. */
export function aabb(el: Rotated): Box {
  if (!el.rotation) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const pts = [
    [-el.w / 2, -el.h / 2],
    [el.w / 2, -el.h / 2],
    [el.w / 2, el.h / 2],
    [-el.w / 2, el.h / 2],
  ].map(([px, py]) => rotateVec(px!, py!, el.rotation));
  const xs = pts.map((p) => p[0] + cx);
  const ys = pts.map((p) => p[1] + cy);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const btm = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: btm - y };
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** -1 / 0 / 1 per axis: which edge a resize handle drags. */
export type Handle = { hx: -1 | 0 | 1; hy: -1 | 0 | 1 };

export const HANDLES: (Handle & { id: string; cursor: string })[] = [
  { id: "nw", hx: -1, hy: -1, cursor: "nwse-resize" },
  { id: "n", hx: 0, hy: -1, cursor: "ns-resize" },
  { id: "ne", hx: 1, hy: -1, cursor: "nesw-resize" },
  { id: "e", hx: 1, hy: 0, cursor: "ew-resize" },
  { id: "se", hx: 1, hy: 1, cursor: "nwse-resize" },
  { id: "s", hx: 0, hy: 1, cursor: "ns-resize" },
  { id: "sw", hx: -1, hy: 1, cursor: "nesw-resize" },
  { id: "w", hx: -1, hy: 0, cursor: "ew-resize" },
];

/**
 * Resize a rotated box by dragging one handle by (dx, dy) in design space,
 * keeping the opposite edge/corner pinned. Works in the box's own (rotated)
 * frame, so a 30°-rotated image resizes along its own sides like in Canva.
 * Returns the new box plus the uniform scale applied (for text font scaling).
 */
export function resizeBox(
  start: Rotated,
  handle: Handle,
  dx: number,
  dy: number,
  keepRatio: boolean,
  min = 8
): Box & { scale: number } {
  const [lx, ly] = rotateVec(dx, dy, -start.rotation);
  let w = start.w + handle.hx * lx;
  let h = start.h + handle.hy * ly;
  let scale = 1;

  if (keepRatio && handle.hx !== 0 && handle.hy !== 0) {
    // Project onto the diagonal: whichever axis moved further relative to its
    // size drives a uniform scale.
    const sx = w / start.w;
    const sy = h / start.h;
    scale = Math.max(min / Math.min(start.w, start.h), Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy);
    w = start.w * scale;
    h = start.h * scale;
  } else {
    w = Math.max(min, w);
    h = Math.max(min, h);
  }

  // Shift the centre so the opposite side stays where it was.
  const [cdx, cdy] = rotateVec((handle.hx * (w - start.w)) / 2, (handle.hy * (h - start.h)) / 2, start.rotation);
  const cx = start.x + start.w / 2 + cdx;
  const cy = start.y + start.h / 2 + cdy;
  return { x: cx - w / 2, y: cy - h / 2, w, h, scale };
}

export interface Guide {
  axis: "x" | "y";
  /** Design-space coordinate of the line. */
  at: number;
}

/**
 * Snaps a moving box's edges/centre to the canvas edges/centre and to other
 * elements' edges/centres. Returns the correction to apply and the guide lines
 * to draw.
 */
export function snapBox(
  box: Box,
  others: Box[],
  canvas: { width: number; height: number },
  threshold: number
): { dx: number; dy: number; guides: Guide[] } {
  const xs = [0, canvas.width / 2, canvas.width];
  const ys = [0, canvas.height / 2, canvas.height];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const best = (cands: number[], targets: number[]) => {
    let off = 0;
    let at: number | null = null;
    let dist = threshold;
    for (const c of cands) {
      for (const t of targets) {
        const d = Math.abs(t - c);
        if (d < dist) {
          dist = d;
          off = t - c;
          at = t;
        }
      }
    }
    return { off, at };
  };
  const bx = best([box.x, box.x + box.w / 2, box.x + box.w], xs);
  const by = best([box.y, box.y + box.h / 2, box.y + box.h], ys);
  const guides: Guide[] = [];
  if (bx.at !== null) guides.push({ axis: "x", at: bx.at });
  if (by.at !== null) guides.push({ axis: "y", at: by.at });
  return { dx: bx.off, dy: by.off, guides };
}

export function elementBoxes(elements: CanvasElement[], exclude: Set<string>): Box[] {
  return elements.filter((e) => !exclude.has(e.id)).map((e) => aabb(e));
}
