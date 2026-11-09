// Small DOM helpers for the Nex replica: icons (Lucide, as in the real Nex), markup
// escaping, a live content mirror, modals and toasts.

import { ICONS } from './icons.js';
import { drawContent, isAnimated } from '../shared/render.js';
import { contentKey } from '../shared/state.js';

/** A Lucide icon as an SVG string, e.g. icon('Monitor'). */
export function icon(name, cls = 'ico') {
  const node = ICONS[name];
  if (!node) return '';
  const inner = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/* ---------- live mirror: exactly what a screen is showing ---------- */

const animated = new Set();
let loopOn = false;
function loop(now) {
  for (const m of animated) m.draw(now / 1000);
  if (animated.size) requestAnimationFrame(loop); else loopOn = false;
}

/**
 * Shows resolved content (state.resolveContent) inside an element: images and videos as
 * elements, everything else drawn on a canvas by the shared renderer. sound: let videos
 * play with sound (display pages); mirrors are always muted.
 */
export class Mirror {
  constructor(el, { sound = false, still = false } = {}) {
    this.el = el;
    this.sound = sound;
    this.still = still;        // draw one frame of an animated experience (a thumbnail)
    this.key = null;
    el.classList.add('mirror');
  }

  show(r) {
    const key = contentKey(r);
    if (key === this.key) {
      if (this.video) this.video.muted = !this.sound || r.muted;
      return;
    }
    this.key = key;
    this.r = r;
    this.clear();
    if (r.kind === 'media' && r.type === 'image') {
      this.el.append(Object.assign(document.createElement('img'), { src: r.url, alt: r.title, draggable: false }));
    } else if (r.kind === 'media' && r.type === 'video') {
      this.video = Object.assign(document.createElement('video'), {
        src: r.url, loop: true, autoplay: true, playsInline: true, muted: !this.sound || r.muted, crossOrigin: 'anonymous',
      });
      this.el.append(this.video);
      const v = this.video;
      v.play().catch(() => { if (this.video !== v) return; v.muted = true; v.play().catch(() => {}); });
    } else {
      this.canvas = document.createElement('canvas');
      this.el.append(this.canvas);
      this.draw(performance.now() / 1000);
      if (isAnimated(r) && !this.still) {
        this.t0 = performance.now() / 1000;
        animated.add(this);
        if (!loopOn) { loopOn = true; requestAnimationFrame(loop); }
      } else {
        // The idle logo may still be loading, and a thumbnail may not be laid out yet: draw again shortly.
        if (this.still) this.t0 = performance.now() / 1000 - 1.6;
        setTimeout(() => this.canvas && this.draw(performance.now() / 1000), 400);
      }
    }
  }

  draw(now) {
    const c = this.canvas;
    if (!c) return;
    if (!this.el.isConnected) {
      if (this.wasConnected) this.destroy();              // its page was re-rendered away
      return;                                             // not on the page yet: draw next frame
    }
    this.wasConnected = true;
    const w = Math.max(1, Math.round(this.el.clientWidth * Math.min(devicePixelRatio, 2)));
    const hgt = Math.max(1, Math.round(this.el.clientHeight * Math.min(devicePixelRatio, 2)));
    if (c.width !== w || c.height !== hgt) { c.width = w; c.height = hgt; }
    drawContent(c.getContext('2d'), w, hgt, this.r, Math.max(0, now - (this.t0 ?? now))); // rAF time can run a hair behind t0
  }

  command(action) {
    const v = this.video;
    if (!v) return;
    if (action === 'play') v.play().catch(() => {});
    if (action === 'pause') v.pause();
    if (action === 'restart') { v.currentTime = 0; v.play().catch(() => {}); }
  }

  clear() {
    animated.delete(this);
    if (this.video) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); }
    this.video = null;
    this.canvas = null;
    this.el.replaceChildren();
  }

  destroy() {
    this.clear();
    this.key = null;
  }
}

/* ---------- modal and toast ---------- */

export function modal(html, { onMount, onClose, wide = false, narrow = false, cls = '' } = {}) {
  const wrap = h(`<div class="modal-wrap"><div class="modal ${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''} ${cls}" role="dialog" aria-modal="true">${html}</div></div>`);
  const close = () => { if (!wrap.isConnected) return; onClose?.(); wrap.remove(); removeEventListener('keydown', onKey); };
  // Escape closes only the top dialog (a confirm can sit over another dialog).
  const onKey = (e) => { if (e.key === 'Escape' && wrap === [...document.querySelectorAll('.modal-wrap')].pop()) close(); };
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  addEventListener('keydown', onKey);
  document.body.append(wrap);
  onMount?.(wrap.querySelector('.modal'), close);
  return close;
}

export function toast(text, kind = 'ok') {
  const t = h(`<div class="toast ${kind}">${kind === 'ok' ? icon('CircleCheck') : icon('CircleAlert')}<span>${esc(text)}</span></div>`);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('on'));
  setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, 2600);
}

/* ---------- file types ---------- */

const TYPE_ICONS = { image: 'Image', video: 'Video', document: 'FileText', word: 'FileText', sheet: 'FileSpreadsheet', presentation: 'Presentation', youtube: 'Play', drive: 'HardDrive', link: 'Globe' };
/** The icon for a media type, as on each row of the Media Library. */
export const typeIcon = (type, cls = 'ico sm') => icon(TYPE_ICONS[type] ?? 'Globe', cls);
export const isLinkType = (type) => type === 'youtube' || type === 'drive' || type === 'link';

/** "Sep 30, 2026", as the real Nex formats dates. */
export const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** "YYYY-MM-DD" in local time (date range filters). */
export function dateKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/* ---------- dropdown menu ---------- */

/**
 * A dropdown under an anchor, like the real Nex's DropdownMenu. html is its content;
 * onMount(el, close) wires it. Closes on a click outside, Escape, or close().
 */
export function dropdown(anchor, html, { align = 'start', onMount, width } = {}) {
  document.querySelectorAll('.menu.dd').forEach((m) => m.__close?.());
  const r = anchor.getBoundingClientRect();
  const menu = h(`<div class="menu dd" role="menu">${html}</div>`);
  if (width) menu.style.minWidth = `${width}px`;
  document.body.append(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const left = align === 'end' ? r.right - mw : r.left;
  menu.style.left = `${Math.max(8, Math.min(left, innerWidth - mw - 8))}px`;
  menu.style.top = `${r.bottom + mh + 6 > innerHeight && r.top - mh - 6 > 0 ? r.top - mh - 6 : r.bottom + 6}px`;
  const close = () => { menu.remove(); removeEventListener('pointerdown', outside, true); removeEventListener('keydown', onKey); };
  const outside = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  menu.__close = close;
  setTimeout(() => addEventListener('pointerdown', outside, true));
  addEventListener('keydown', onKey);
  onMount?.(menu, close);
  return close;
}

/* ---------- date range calendar ---------- */

/**
 * One month grid, click to pick a range (the real Nex's DateRangeCalendar): the first click
 * sets the start, the second the end (swapped if earlier). onChange(from, to) with
 * "YYYY-MM-DD" or "".
 */
export function rangeCalendar(el, { from, to, onChange }) {
  let view = from ? new Date(`${from}T00:00`) : new Date();
  const draw = () => {
    const y = view.getFullYear(), m = view.getMonth();
    const start = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < start; i++) cells.push([new Date(y, m, i - start + 1), false]);
    for (let d = 1; d <= days; d++) cells.push([new Date(y, m, d), true]);
    while (cells.length % 7) { const last = cells[cells.length - 1][0]; cells.push([new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), false]); }
    const today = dateKey(new Date());
    el.innerHTML = `<div class="cal">
      <div class="cal-head"><button type="button" class="icon-btn" data-nav="-1" aria-label="Previous month">${icon('ChevronLeft')}</button>
        <b>${view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
        <button type="button" class="icon-btn" data-nav="1" aria-label="Next month">${icon('ChevronRight')}</button></div>
      <div class="cal-grid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w) => `<span class="wd">${w}</span>`).join('')}
        ${cells.map(([d, inMonth]) => {
          const k = dateKey(d);
          const end = k === from || k === to, mid = from && to && k > from && k < to;
          return `<button type="button" data-k="${k}" class="${inMonth ? '' : 'out'} ${end ? 'end' : mid ? 'mid' : ''} ${k === today && !end ? 'today' : ''}">${d.getDate()}</button>`;
        }).join('')}</div>
      ${from || to ? '<button type="button" class="link-btn" data-clear>Clear dates</button>' : ''}</div>`;
  };
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const nav = e.target.closest('[data-nav]');
    if (nav) { view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.nav), 1); draw(); return; }
    if (e.target.closest('[data-clear]')) { from = ''; to = ''; onChange('', ''); draw(); return; }
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    if (!from || (from && to)) { from = k; to = ''; } else if (k < from) { to = from; from = k; } else to = k;
    onChange(from, to);
    draw();
  });
  draw();
}

/* ---------- switch, slider ---------- */

/** The real Nex's Switch: a pill toggle. Give it data-* attributes to find it. */
export const switchHtml = (on, attrs = '') => `<button type="button" class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" ${attrs}><i></i></button>`;

/**
 * The real Nex's DragSlider on an element: click or drag along the track. onChange(value,
 * final) is called at most every commitMs while dragging, and always once on release.
 */
export function dragSlider(el, { value, min = 0, max = 100, step = 1, commitMs = 120, onChange }) {
  el.classList.add('dslider');
  el.innerHTML = '<div class="track"><i></i></div><b></b>';
  const fill = el.querySelector('.track i'), knob = el.querySelector('b');
  let shown = value, dragging = false, last = 0;
  const paint = () => { const pct = ((shown - min) / (max - min)) * 100; fill.style.width = `${pct}%`; knob.style.left = `${pct}%`; };
  const at = (x) => {
    const r = el.getBoundingClientRect();
    const v = min + (Math.max(0, Math.min(x - r.left, r.width)) / (r.width || 1)) * (max - min);
    return Math.round(v / step) * step;
  };
  const send = (final) => { const now = Date.now(); if (final || now - last > commitMs) { last = now; onChange(shown, final); } };
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); el.setPointerCapture(e.pointerId); dragging = true; el.classList.add('drag'); shown = at(e.clientX); paint(); send(false); });
  el.addEventListener('pointermove', (e) => { if (!dragging) return; shown = at(e.clientX); paint(); send(false); });
  const end = (e) => { if (!dragging) return; dragging = false; el.classList.remove('drag'); if (e.type === 'pointerup') shown = at(e.clientX); paint(); send(true); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('click', (e) => e.stopPropagation());
  paint();
  return { set(v) { if (!dragging) { shown = v; paint(); } } };
}

/* ---------- confirm dialog ---------- */

/** The real Nex's amber-triangle confirm. Resolves true when confirmed. */
export function confirmDialog({ title, body = '', confirm = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let ok = false;
    modal(`<div class="row" style="align-items:flex-start;gap:12px;flex-wrap:nowrap">${icon('TriangleAlert', 'ico lg warn')}
        <div><h2 style="font-size:14px">${esc(title)}</h2>${body ? `<p class="sub" style="margin:4px 0 0">${esc(body)}</p>` : ''}</div></div>
      <div class="confirm-foot"><button class="btn ghost-caps" data-close>Cancel</button><button class="btn pill ${danger ? 'red' : 'blue'}" data-ok>${esc(confirm)}</button></div>`, {
      narrow: true,
      onMount(el, close) { el.querySelector('[data-ok]').addEventListener('click', () => { ok = true; close(); }); },
      onClose: () => resolve(ok),
    });
  });
}

/** Copy text, falling back to a prompt where the clipboard is blocked (an iframe). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { prompt('Copy this:', text); return false; }
}
