// Draws a screen's picture on a 2D canvas: the idle screen, the blackout and every
// experience template. The same code draws the walls in the 3D room (as textures), the
// /cms/display.html pages and the live mirrors and thumbnails in the Nex, so a screen
// looks the same everywhere. Images and videos are drawn by their callers; documents,
// spreadsheets, decks and links are shown as a card, and whiteboards stroke by stroke.

import { SURFACE_COLORS, drawPage } from './whiteboard.js';

export const FONT = "'Geist Sans', Geist, 'Instrument Sans', system-ui, sans-serif";

const logo = typeof Image !== 'undefined' ? Object.assign(new Image(), { src: '/drava-world/cms/logo.svg' }) : null;

/** Does this content change over time (so it has to be redrawn every frame)? */
export function isAnimated(r) {
  return r.kind === 'experience' || r.kind === 'whiteboard' || r.kind.startsWith('push-');
}

// A picture or video drawn into a texture has to come with CORS. The same file shown as a plain
// <img> or <video> elsewhere on the page (the kiosks' cards and thumbnails) is cached without
// it, and the browser would reuse that copy and refuse it: textures ask for a copy of their own.
export const corsUrl = (url) => (/^(blob|data):/.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}cors=1`);

// Push (the Nex replica, ../push/board.js) draws its own kinds: a shared canvas, a split
// screen, a picture with pen notes. It registers here, so this file doesn't depend on it.
let pushRenderer = null;
export const setPushRenderer = (fn) => { pushRenderer = fn; };

// The whiteboard page drawn live on each screen. Every page of the site keeps its own copy:
// set from the state (state.live) and from 'board' messages as strokes arrive.
const boards = new Map();
export const setBoard = (screenId, page) => { if (page) boards.set(screenId, page); else boards.delete(screenId); };
export function syncBoards(state) {
  for (const s of state.screens) setBoard(s.id, s.content?.kind === 'whiteboard' ? state.live?.[s.id] : null);
}

export const FILE_LABELS = {
  image: 'Image', video: 'Video', document: 'PDF', word: 'Word doc', sheet: 'Spreadsheet',
  presentation: 'Presentation', youtube: 'YouTube', drive: 'Google Drive', link: 'Web page',
};

/**
 * Draw content r (from state.resolveContent) at time t (seconds) into a w × h canvas.
 * For media, draws only a placeholder; callers put the image or video on top.
 */
export function drawContent(ctx, w, h, r, t = 0) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  if (r.kind === 'blank') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  } else if (r.kind === 'experience') {
    (TEMPLATES[r.template] ?? TEMPLATES.title)(ctx, w, h, t, r);
  } else if (r.kind === 'media') {
    if (r.type === 'image' || r.type === 'video') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    } else drawFile(ctx, w, h, r);
  } else if (r.kind === 'whiteboard') {
    drawBoard(ctx, w, h, r);
  } else if (r.kind.startsWith('push-') && pushRenderer) {
    pushRenderer(ctx, w, h, r, t);
  } else {
    drawIdle(ctx, w, h, r.screenId);
  }
  ctx.restore();
}

/** The real Nex's idle display: black, the logo, and the screen id underneath. */
function drawIdle(ctx, w, h, screenId) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (logo?.complete && logo.naturalWidth) {
    const lw = Math.min(w * 0.3, (h * 0.3 * logo.naturalWidth) / logo.naturalHeight);
    const lh = (lw * logo.naturalHeight) / logo.naturalWidth;
    ctx.drawImage(logo, (w - lw) / 2, h / 2 - lh / 2 - h * 0.03, lw, lh);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.font = `700 ${Math.max(9, h * 0.022)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  spaced(ctx, `SCREEN · ${screenId}`.toUpperCase(), w / 2, h / 2 + h * 0.16, h * 0.0066);
}

/**
 * A document, spreadsheet, deck or link on a screen: the real displays open these in their
 * own viewers (PDF, sheet, slides, an embedded page); here they are a title card.
 */
function drawFile(ctx, w, h, r) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#01001f');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const s = Math.min(w / 16, h / 9);                      // one unit of a 16:9 layout
  const cx = w / 2, iy = h * 0.36;
  // A page with a folded corner, the file type on it.
  const pw = s * 2.6, ph = s * 3.3, px = cx - pw / 2, py = iy - ph / 2, fold = pw * 0.28;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + pw - fold, py);
  ctx.lineTo(px + pw, py + fold);
  ctx.lineTo(px + pw, py + ph);
  ctx.lineTo(px, py + ph);
  ctx.closePath();
  ctx.fillStyle = 'rgba(67,41,146,0.35)';
  ctx.fill();
  ctx.strokeStyle = '#9978ff';
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  const tag = { document: 'PDF', word: 'DOC', sheet: 'XLS', presentation: 'PPT', youtube: '▶', drive: 'DRIVE', link: 'WWW' }[r.type] ?? 'FILE';
  ctx.font = `700 ${s * (tag.length > 3 ? 0.5 : 0.75)}px ${FONT}`;
  ctx.fillText(tag, cx, iy + s * 0.5);
  ctx.font = `600 ${s * 0.62}px ${FONT}`;
  let title = String(r.title ?? '');
  while (ctx.measureText(title).width > w * 0.84 && title.length > 4) title = `${title.slice(0, -2).trimEnd()}…`;
  ctx.fillText(title, cx, h * 0.72);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = `700 ${s * 0.26}px ${FONT}`;
  spaced(ctx, (FILE_LABELS[r.type] ?? 'File').toUpperCase(), cx, h * 0.8, s * 0.06);
  if (r.type === 'link' || r.type === 'youtube' || r.type === 'drive') {
    ctx.fillStyle = 'rgba(153,120,255,0.8)';
    ctx.font = `400 ${s * 0.3}px ${FONT}`;
    ctx.fillText(String(r.url ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''), cx, h * 0.87);
  }
  if (r.queue) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `500 ${s * 0.26}px ${FONT}`;
    ctx.fillText(`${r.queue.index + 1} / ${r.queue.count}`, w - s * 0.5, h - s * 0.4);
  }
}

/** A whiteboard: its board colour, letterboxed to 16:9 like the real one, and the strokes. */
function drawBoard(ctx, w, h, r) {
  const page = boards.get(r.screenId) ?? r.page;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  let bw = w, bh = (w * 9) / 16;
  if (bh > h) { bh = h; bw = (h * 16) / 9; }
  const bx = (w - bw) / 2, by = (h - bh) / 2;
  if (page?.surface === 'clear') drawIdle(ctx, w, h, r.screenId);   // annotating: ink over the screen's picture
  else {
    ctx.fillStyle = SURFACE_COLORS[page?.surface] ?? '#fff';
    ctx.fillRect(bx, by, bw, bh);
  }
  drawPage(ctx, page, bx, by, bw, bh, page?.current);
}

/** Letter-spaced text (canvas letterSpacing where supported). */
function spaced(ctx, text, x, y, spacing) {
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
  } else ctx.fillText(text, x, y);
}

function wrap(ctx, text, maxWidth) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
  }
  lines.push(line);
  return lines;
}

const TEMPLATES = {
  /** The experience cards in the real Nex: pale grey, a huge white number, the title below. */
  title(ctx, w, h, t, r) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    const s = 0.5 + 0.5 * Math.sin(t * 0.4);
    g.addColorStop(0, `hsl(0 0% ${84 + 3 * s}%)`);
    g.addColorStop(1, `hsl(0 0% ${76 + 3 * (1 - s)}%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `300 ${h * 0.78}px ${FONT}`;
    ctx.fillText(String(r.n ?? ''), w * 0.03, h * 0.66);
    ctx.fillStyle = '#18181b';
    ctx.font = `400 ${h * 0.085}px ${FONT}`;
    const lines = wrap(ctx, r.title, w * 0.6);
    lines.forEach((line, i) => ctx.fillText(line, w * 0.05, h * 0.78 + i * h * 0.1));
  },

  /** Brand slides that crossfade, White Tusker red accent. */
  portfolio(ctx, w, h, t) {
    const slides = [
      ['WHITE TUSKER', 'Architects of Experiences'],
      ['WHAT WE DO', 'Experience centres'],
      ['WHAT WE DO', 'Immersive technology'],
      ['WHAT WE DO', 'Spatial storytelling'],
      ['WHAT WE DO', 'Corporate films'],
    ];
    const period = 5, k = (t + 0.6) / period;   // start just past the fade-in, so a still shows a slide
    const i = Math.floor(k) % slides.length, f = k - Math.floor(k);
    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.8, h * 0.2, 0, w * 0.8, h * 0.2, w * 0.7);
    glow.addColorStop(0, 'rgba(226,29,62,0.22)');
    glow.addColorStop(1, 'rgba(226,29,62,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    const alpha = Math.min(1, f * 5, (1 - f) * 5);
    ctx.globalAlpha = alpha;
    const x = w * 0.08;
    ctx.fillStyle = '#e21d3e';
    ctx.fillRect(x, h * 0.36, w * 0.06, Math.max(2, h * 0.008));
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `600 ${h * 0.04}px ${FONT}`;
    spaced(ctx, slides[i][0], x, h * 0.32, h * 0.01);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${h * 0.12}px ${FONT}`;
    wrap(ctx, slides[i][1], w * 0.8).forEach((line, n) => ctx.fillText(line, x, h * 0.54 + n * h * 0.13));
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `500 ${h * 0.03}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${String(i + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`, w * 0.92, h * 0.9);
  },

  /** A visitor welcome with editable headline and subline. */
  welcome(ctx, w, h, t, r) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, w * 0.6);
    bg.addColorStop(0, 'rgba(67,41,146,0.45)');
    bg.addColorStop(1, 'rgba(1,0,31,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    const head = r.fields?.headline || 'Welcome';
    let size = h * 0.12;
    ctx.font = `700 ${size}px ${FONT}`;
    while (ctx.measureText(head).width > w * 0.86 && size > h * 0.04) { size *= 0.94; ctx.font = `700 ${size}px ${FONT}`; }
    const tg = ctx.createLinearGradient(0, h * 0.4, 0, h * 0.55);
    tg.addColorStop(0, '#ffffff');
    tg.addColorStop(1, '#9978ff');
    ctx.fillStyle = tg;
    const rise = Math.min(1, t * 0.8);
    ctx.globalAlpha = 0.4 + 0.6 * rise;
    ctx.fillText(head, w / 2, h * 0.52);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `400 ${h * 0.045}px ${FONT}`;
    ctx.fillText(r.fields?.subline || '', w / 2, h * 0.62);
  },

  /** A live-looking operations dashboard: KPI tiles and moving charts. */
  analytics(ctx, w, h, t) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#01001f');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const pad = w * 0.04;
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${h * 0.05}px ${FONT}`;
    ctx.fillText('Digital Twin · Plant overview', pad, h * 0.11);
    const kpis = [
      ['Throughput', `${(1240 + Math.round(40 * Math.sin(t * 0.7))).toLocaleString()} u/h`],
      ['Uptime', `${(98.2 + 0.4 * Math.sin(t * 0.3)).toFixed(1)}%`],
      ['Energy', `${(412 + Math.round(12 * Math.sin(t * 0.5 + 1)))} kW`],
      ['Visitors', `${38 + Math.floor(t / 20) % 5}`],
    ];
    const tw = (w - pad * 2 - pad * 0.6 * 3) / 4;
    kpis.forEach(([label, value], i) => {
      const x = pad + i * (tw + pad * 0.6), y = h * 0.17;
      roundRect(ctx, x, y, tw, h * 0.2, h * 0.02);
      ctx.fillStyle = 'rgba(67,41,146,0.18)';
      ctx.fill();
      ctx.strokeStyle = '#432992';
      ctx.lineWidth = Math.max(1, h * 0.003);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `500 ${Math.min(h * 0.03, tw * 0.1)}px ${FONT}`;
      ctx.fillText(label, x + tw * 0.08, y + h * 0.065);
      const vg = ctx.createLinearGradient(0, y + h * 0.08, 0, y + h * 0.16);
      vg.addColorStop(0, '#fff');
      vg.addColorStop(1, '#9978ff');
      ctx.fillStyle = vg;
      ctx.font = `700 ${Math.min(h * 0.06, tw * 0.13)}px ${FONT}`;   // fits narrow (portrait) tiles too
      ctx.fillText(value, x + tw * 0.08, y + h * 0.155);
    });
    // Line chart
    const cx = pad, cy = h * 0.45, cw = w * 0.58, ch = h * 0.46;
    roundRect(ctx, cx, cy, cw, ch, h * 0.02);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fill();
    ctx.strokeStyle = '#432992';
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const x = cx + (i / 60) * cw;
      const v = 0.5 + 0.25 * Math.sin(i * 0.25 + t * 0.9) + 0.12 * Math.sin(i * 0.7 - t * 1.3);
      const y = cy + ch * (0.9 - v * 0.75);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(1.5, h * 0.005);
    ctx.stroke();
    // Bars
    const bx = cx + cw + pad * 0.6, bw = w - pad - bx;
    roundRect(ctx, bx, cy, bw, ch, h * 0.02);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fill();
    ctx.strokeStyle = '#432992';
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const v = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.8 + i * 1.3));
      const barW = (bw * 0.7) / 6;
      const x = bx + bw * 0.15 + i * barW;
      ctx.fillStyle = i % 2 ? '#a78bfa' : '#9978ff';
      ctx.fillRect(x + barW * 0.15, cy + ch * 0.9 - ch * 0.75 * v, barW * 0.7, ch * 0.75 * v);
    }
  },

  /** Flowing contour lines, like the Mosaic wall. */
  dataart(ctx, w, h, t) {
    ctx.fillStyle = '#02030a';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = Math.max(1, h * 0.003);
    for (let k = 0; k < 26; k++) {
      ctx.beginPath();
      const base = (k / 26) * h * 1.2 - h * 0.1;
      for (let i = 0; i <= 80; i++) {
        const x = (i / 80) * w;
        const y = base + Math.sin(i * 0.12 + t * 0.6 + k * 0.4) * h * 0.05 + Math.sin(i * 0.05 - t * 0.3 + k) * h * 0.04;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t + k * 0.5));
      ctx.strokeStyle = k % 3 === 0 ? `rgba(153,120,255,${a})` : `rgba(56,189,248,${a * 0.7})`;
      ctx.stroke();
    }
  },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
