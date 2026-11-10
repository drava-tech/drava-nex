// What Push's screens show that isn't one plain picture, drawn on a 2D canvas: a split screen
// (each part its own media), a picture with pen notes, and the shared canvas itself (the
// console's canvas as it is now: its cards, what plays on them, its notes). Registered with
// ../shared/render.js, so the walls in the 3D room (WallDisplay) and the display page draw it
// like any other content. setPushState() hands it the latest state.

import { corsUrl, drawContent, setPushRenderer } from '../shared/render.js';
import { mediaContent } from '../shared/state.js';
import { layoutOf } from './state.js';

let state = null;
export const setPushState = (s) => { state = s; };

const BAR = 28;          // a card's title bar, canvas units (as in the console)
const GAP = 6;           // between a split screen's parts, at 1080 px tall

/* ---------------------------------------------------------------- pictures */

const images = new Map();
const videos = new Map();

/** An image or video element for media m, loading or playing (muted) in the background. */
function element(m) {
  if (m.type === 'image') {
    let img = images.get(m.url);
    if (!img) { img = Object.assign(new Image(), { crossOrigin: 'anonymous', src: corsUrl(m.url) }); images.set(m.url, img); }
    return img.complete && img.naturalWidth ? { el: img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }
  if (m.type === 'video') {
    let v = videos.get(m.url);
    if (!v) {
      v = Object.assign(document.createElement('video'), { src: corsUrl(m.url), muted: true, loop: true, playsInline: true, crossOrigin: 'anonymous', preload: 'auto' });
      v.play().catch(() => {});
      videos.set(m.url, v);
    }
    if (v.paused) v.play().catch(() => {});
    return v.readyState >= 2 ? { el: v, w: v.videoWidth, h: v.videoHeight } : null;
  }
  return null;
}

/** Media m in the box x, y, w, h: images and video fitted inside it, anything else as its card. Returns where the picture went. */
export function drawMedia(ctx, m, x, y, w, h, t = 0) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  let at = { x, y, w, h };
  if (m.type === 'image' || m.type === 'video') {
    const p = element(m);
    if (p) {
      const k = Math.min(w / p.w, h / p.h);
      at = { x: x + (w - p.w * k) / 2, y: y + (h - p.h * k) / 2, w: p.w * k, h: p.h * k };
      ctx.drawImage(p.el, at.x, at.y, at.w, at.h);
    }
  } else {
    ctx.translate(x, y);
    drawContent(ctx, w, h, mediaContent(m), t);
  }
  ctx.restore();
  return at;
}

/** Pen strokes; to(x, y) maps a stroke's points onto the canvas, k its widths. */
export function drawStrokes(ctx, strokes, to, k) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes ?? []) {
    if (!s.points?.length) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1, s.width * k);
    ctx.beginPath();
    s.points.forEach(([px, py], i) => { const [x, y] = to(px, py); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    if (s.points.length === 1) { const [x, y] = to(...s.points[0]); ctx.lineTo(x + 0.01, y); }
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- the kinds */

/** "65fr 35fr" → the start of each track, as fractions, and 1 at the end. */
function tracks(spec) {
  const fr = spec.split(/\s+/).map((x) => parseFloat(x) || 1);
  const sum = fr.reduce((a, b) => a + b, 0);
  const at = [0];
  for (const f of fr) at.push(at[at.length - 1] + f / sum);
  return at;
}

function drawSplit(ctx, w, h, screen, t) {
  const L = layoutOf(screen.layout);
  const cols = tracks(L.columns), rows = tracks(L.rows);
  const g = (GAP * h) / 1080;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  for (const z of L.zones) {
    const [r1, c1, r2, c2] = z.area.split('/').map((n) => parseInt(n, 10) - 1);
    const x = cols[c1] * w + (c1 ? g / 2 : 0), y = rows[r1] * h + (r1 ? g / 2 : 0);
    const x2 = cols[c2] * w - (c2 < cols.length - 1 ? g / 2 : 0), y2 = rows[r2] * h - (r2 < rows.length - 1 ? g / 2 : 0);
    const m = state.media.find((x) => x.id === screen.zoneMedia?.[z.id]);
    if (m) drawMedia(ctx, m, x, y, x2 - x, y2 - y, t);
    else {
      ctx.fillStyle = '#0b0b0b';
      ctx.fillRect(x, y, x2 - x, y2 - y);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = `500 ${Math.max(10, h * 0.03)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(z.label, (x + x2) / 2, (y + y2) / 2);
    }
  }
}

function drawInked(ctx, w, h, card, t) {
  const m = state.media.find((x) => x.id === card.mediaId);
  if (!m) return;
  drawMedia(ctx, m, 0, 0, w, h, t);
  // Notes are kept as fractions of the card's picture: the screen's whole picture here.
  drawStrokes(ctx, state.ink.cards[card.id], (x, y) => [x * w, y * h], w);
}

/** The shared canvas: the part of the console's canvas it shows (shareView), fitted to the screen. */
function drawShared(ctx, w, h, t) {
  const v = state.shareView;
  const k = Math.min(w / v.w, h / v.h);
  const ox = w / 2 - v.cx * k, oy = h / 2 - v.cy * k;
  const to = (x, y) => [ox + x * k, oy + y * k];
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  // The canvas's grid, faint.
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  const step = 120 * k;
  if (step > 6) {
    ctx.beginPath();
    for (let x = ((ox % step) + step) % step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = ((oy % step) + step) % step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }
  for (const it of state.items) {
    const m = state.media.find((x) => x.id === it.mediaId);
    if (!m) continue;
    const [x, y] = to(it.x, it.y), cw = it.w * k, ch = it.h * k, bar = BAR * k;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, cw, ch, 8 * k);
    ctx.fillStyle = '#191919';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.font = `500 ${12 * k}px 'Geist Sans', system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(m.name, x + 10 * k, y + bar / 2, cw - 20 * k);
    drawMedia(ctx, m, x, y + bar, cw, ch - bar, t);
    drawStrokes(ctx, state.ink.cards[it.id], (px, py) => [x + px * cw, y + bar + py * (ch - bar)], cw);
    ctx.restore();
    ctx.strokeStyle = it.liveOn ? 'rgba(16,185,129,0.6)' : '#262626';
    ctx.lineWidth = Math.max(1, k);
    ctx.beginPath();
    ctx.roundRect(x, y, cw, ch, 8 * k);
    ctx.stroke();
  }
  drawStrokes(ctx, state.ink.canvas, to, k);
}

function drawPush(ctx, w, h, r, t) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (!state) return;
  const [id, extra] = r.screenId.split(':');
  if (r.kind === 'push-board') drawShared(ctx, w, h, t);
  if (r.kind === 'push-split') { const s = state.screens.find((x) => x.id === id); if (s) drawSplit(ctx, w, h, s, t); }
  if (r.kind === 'push-ink') { const c = state.items.find((x) => x.id === extra); if (c) drawInked(ctx, w, h, c, t); }
}

setPushRenderer(drawPush);
