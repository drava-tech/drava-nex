// Whiteboard drawing, shared by the Nex's board (app/pages/whiteboards.js) and every screen
// it is pushed to (render.js), so a stroke lands in the same relative spot on each. A port
// of the real Nex's lib/whiteboard-canvas.ts.
//
// A stroke: { tool: 'pen' | 'eraser' | 'line' | 'rect' | 'circle', color, width, points }.
// Points are fractions of the board (0..1 on each axis), not pixels; freehand strokes keep
// every point, shapes only their first and last. A page: { surface: 'light' | 'dark' | 'clear', strokes }.

export const WHITEBOARD_COLORS = ['#18181b', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ffffff'];
export const WHITEBOARD_WIDTHS = [2, 4, 8, 16];
export const ERASER_WIDTHS = WHITEBOARD_WIDTHS.map((w) => w * 4);
export const SURFACE_COLORS = { light: '#ffffff', dark: '#101014', clear: 'transparent' };

// Widths are calibrated against a canvas this wide, and scale with the canvas being drawn
// on, so a line reads the same thickness on the kiosk and on a 9 m wall.
const WIDTH_REFERENCE = 1200;

function applyStyle(ctx, stroke, canvasW) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, stroke.width * (canvasW / WIDTH_REFERENCE));
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';   // punch through, whatever the board colour
    ctx.strokeStyle = '#000';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
  }
}

/** Draw one whole stroke into a w × h canvas (CSS pixels of that canvas). */
export function drawStroke(ctx, stroke, w, h) {
  const p0 = stroke.points[0];
  if (!p0) return;
  const p1 = stroke.points[stroke.points.length - 1] ?? p0;
  const sx = p0.x * w, sy = p0.y * h, ex = p1.x * w, ey = p1.y * h;
  ctx.save();
  applyStyle(ctx, stroke, w);
  ctx.beginPath();
  if (stroke.tool === 'pen' || stroke.tool === 'eraser') {
    // A smooth curve through the points: each point is a control point and the curve runs
    // through the midpoints between them, so freehand reads as curves, not straight segments.
    const pts = stroke.points;
    ctx.moveTo(sx, sy);
    if (pts.length === 1) ctx.lineTo(sx + 0.01, sy);             // a tap still leaves a dot
    else if (pts.length === 2) ctx.lineTo(ex, ey);
    else {
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = ((pts[i].x + pts[i + 1].x) / 2) * w, my = ((pts[i].y + pts[i + 1].y) / 2) * h;
        ctx.quadraticCurveTo(pts[i].x * w, pts[i].y * h, mx, my);
      }
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();
  } else if (stroke.tool === 'line') {
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  } else if (stroke.tool === 'rect') {
    ctx.strokeRect(sx, sy, ex - sx, ey - sy);
  } else if (stroke.tool === 'circle') {
    ctx.ellipse((sx + ex) / 2, (sy + ey) / 2, Math.abs(ex - sx) / 2, Math.abs(ey - sy) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw a page's strokes (and the stroke still being drawn) into a w × h area at (x, y) of
 * ctx. Strokes go on their own layer first, so the eraser only removes ink, never the
 * picture underneath.
 */
export function drawPage(ctx, page, x, y, w, h, current = null) {
  const layer = scratch(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const lc = layer.getContext('2d');
  lc.clearRect(0, 0, layer.width, layer.height);
  for (const s of page?.strokes ?? []) drawStroke(lc, s, layer.width, layer.height);
  if (current) drawStroke(lc, current, layer.width, layer.height);
  ctx.drawImage(layer, x, y, w, h);
}

let scratchCanvas = null;
function scratch(w, h) {
  scratchCanvas ??= document.createElement('canvas');
  if (scratchCanvas.width !== w || scratchCanvas.height !== h) { scratchCanvas.width = w; scratchCanvas.height = h; }
  return scratchCanvas;
}
