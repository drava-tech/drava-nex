/**
 * Pure canvas drawing primitives shared between the operator's whiteboard
 * (apps/cms/.../_components/whiteboard/whiteboard-overlay.tsx) and the
 * screen-side receiver (apps/cms/.../display/_components/WhiteboardScreenOverlay.tsx)
 * so a stroke drawn on one renders in the same relative spot on the other.
 */

export type WhiteboardTool = "pen" | "eraser" | "line" | "rect" | "circle";
export type WhiteboardSurface = "light" | "dark" | "clear";

/** Shared palette so the CMS toolbar and the TV's own on-screen controls offer the same colors. */
export const WHITEBOARD_COLORS = [
  "#18181b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ffffff",
];

/** Shared stroke-width presets so the CMS toolbar and the TV's on-screen controls offer the same sizes. */
export const WHITEBOARD_WIDTHS = [2, 4, 8, 16];

/** Tailwind background class for a board surface — shared so the TV backdrop matches the operator's board exactly. */
export function whiteboardSurfaceClassName(surface: WhiteboardSurface): string {
  switch (surface) {
    case "light":
      return "bg-white";
    case "dark":
      return "bg-[#101014]";
    case "clear":
      return "bg-transparent";
  }
}

/**
 * Points are stored/sent as fractions of the drawing surface (0..1 on each
 * axis), not raw pixels — the CMS's mirror preview, a fullscreen mirror, and
 * the real TV are all different pixel sizes, so a point drawn in a corner on
 * one has to land in the same relative corner on every other, not the same
 * absolute pixel offset.
 */
export interface WhiteboardPoint {
  x: number;
  y: number;
}

export interface WhiteboardStroke {
  tool: WhiteboardTool;
  color: string;
  width: number;
  /** Freehand keeps every point; shapes only need start and end. Normalized (0..1), not pixels. */
  points: WhiteboardPoint[];
}

/** One page of a saved whiteboard document — its own background + stroke history. */
export interface WhiteboardPageData {
  surface: WhiteboardSurface;
  strokes: WhiteboardStroke[];
}

/** Turn a client pointer event's position into a normalized (0..1) point relative to `rect`. */
export function normalizedPointFromClient(clientX: number, clientY: number, rect: DOMRect): WhiteboardPoint {
  return {
    x: rect.width === 0 ? 0 : (clientX - rect.left) / rect.width,
    y: rect.height === 0 ? 0 : (clientY - rect.top) / rect.height,
  };
}

function denormalize(point: WhiteboardPoint, width: number, height: number): WhiteboardPoint {
  return { x: point.x * width, y: point.y * height };
}

export function applyStrokeStyle(ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.width;
  if (stroke.tool === "eraser") {
    // Punch through what's already drawn rather than painting over it, so the
    // eraser works whatever the board colour is.
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color;
  }
}

/**
 * Draw a whole stroke — used for replays (undo, resize, remote sync) and
 * shape previews. `width`/`height` are the CSS pixel size of the canvas
 * being drawn onto (each viewer denormalizes against its own size).
 */
export function drawWhiteboardStroke(
  ctx: CanvasRenderingContext2D,
  stroke: WhiteboardStroke,
  width: number,
  height: number
) {
  const rawStart = stroke.points[0];
  if (!rawStart) return;
  const rawEnd = stroke.points[stroke.points.length - 1] ?? rawStart;
  const start = denormalize(rawStart, width, height);
  const end = denormalize(rawEnd, width, height);

  ctx.save();
  applyStrokeStyle(ctx, stroke);
  ctx.beginPath();

  switch (stroke.tool) {
    case "pen":
    case "eraser": {
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length; i++) {
        const raw = stroke.points[i];
        if (raw) {
          const p = denormalize(raw, width, height);
          ctx.lineTo(p.x, p.y);
        }
      }
      // A single tap should still leave a dot.
      if (stroke.points.length === 1) ctx.lineTo(start.x + 0.01, start.y);
      ctx.stroke();
      break;
    }
    case "line": {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      break;
    }
    case "rect": {
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      break;
    }
    case "circle": {
      ctx.ellipse(
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        Math.abs(end.x - start.x) / 2,
        Math.abs(end.y - start.y) / 2,
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}
