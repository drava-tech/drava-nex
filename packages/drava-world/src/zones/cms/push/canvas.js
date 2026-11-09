// Push's canvas (the console's middle): a grid you pan (drag, arrow keys) and zoom (wheel, the
// buttons), bounded round a 1920 × 1080 frame at its origin (the red frame: what fits a
// screen). On it:
//  - media cards: drag to move, corner to resize, title bar with what it's live on, Send to and
//    Remove; drop one on a screen on an edge, or throw it toward an edge, to show it there; a
//    video live on a screen gets that screen's controls (play, position, sound) on the card
//  - holding the canvas itself (0.6 s) lifts it: throw it toward a screen to share the whole
//    canvas with it (the green pill lists where it's shared)
//  - pen notes (the round button, top left): pen in three colours, eraser, undo, redo, clear, on
//    the canvas or a card (a card live on a screen shows them there), Save with notes
//  - the canvas key (bottom left): every card and the view, click or drag to go there.

import { Mirror, dropdown, esc, h, icon, typeIcon } from '../app/ui.js';
import { mediaContent } from '../shared/state.js';
import { drawMedia, drawStrokes } from './board.js';
import { EDGES, EDGE_LABELS, ZONES, baseId, zoneOf } from './state.js';

const FRAME = { w: 1920, h: 1080 };                       // the red frame round the origin
const BOUND = Math.sqrt(30);                              // the canvas reaches this many frames each way
const BOUNDS = { x: -960 * BOUND, y: -540 * BOUND, w: 1920 * BOUND, h: 1080 * BOUND };
const MAX_ZOOM = 4, STEP = 1.25;
const BAR = 28;
const LIFT_MS = 600, LIFT_SLOP = 8;                       // hold the canvas this long, this still, to lift it
const THROW = { speed: 0.9, edge: 28, sampleMs: 90 };      // a card thrown at px/ms, or let go this near the canvas's edge
const COLORS = ['#e11d48', '#2563eb', '#111827'];         // Push's pen colours
const CANVAS_PEN = 4, CARD_PEN = 0.006;                   // pen widths: on-screen px on the canvas, a share of the card's width on a card
const KEY_W = 168;                                        // the canvas key's width

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

export function initCanvas(app, el) {
  el.innerHTML = `
    <div class="pc-grid minor" aria-hidden="true"></div>
    <div class="pc-grid major" aria-hidden="true"></div>
    <div class="pc-lift">
      <div class="pc-world">
        <div class="pc-bounds" aria-hidden="true"></div>
        <div class="pc-frame" aria-hidden="true"></div>
        <svg class="pc-ink" aria-hidden="true"></svg>
      </div>
    </div>
    <p class="pc-empty">Drag media here from the library, then drop or throw it on a screen.</p>
    <p class="pc-hint" hidden></p>
    <div class="pc-tl">
      <button type="button" class="pc-pen" data-act="pen" aria-label="Pen tool" title="Pen tool"></button>
      <button type="button" class="pc-sharing" data-act="sharing" hidden></button>
    </div>
    <div class="pc-zones" role="group" aria-label="Zone on the edges"></div>
    <button type="button" class="pc-reset" data-act="reset" title="Start over: the screens, media and canvas go back to how they began">${icon('RotateCcw', 'ico sm')}Reset</button>
    <div class="pc-zoom">
      <button type="button" data-zoom="-1" aria-label="Zoom out">${icon('Minus', 'ico sm')}</button>
      <span class="pc-pct">100%</span>
      <button type="button" data-zoom="1" aria-label="Zoom in">${icon('Plus', 'ico sm')}</button>
      <button type="button" data-zoom="0" aria-label="Back to the origin at 100%" title="Back to the origin at 100%">${icon('House', 'ico sm')}</button>
    </div>
    <div class="pc-key-wrap"></div>`;

  const $ = (s) => el.querySelector(s);
  const world = $('.pc-world'), lift = $('.pc-lift'), inkSvg = $('.pc-ink');
  const size = () => ({ w: el.clientWidth, h: el.clientHeight });
  let view = app.state.view ?? null;
  let keyOpen = true;
  let selected = null;

  /* ---- the view ---- */

  /** The home view: the origin in the middle, at 100%. */
  const home = () => {
    const { w, h: hh } = size();
    return { x: w / 2, y: hh / 2, scale: 1 };
  };
  const minScale = () => { const { w, h: hh } = size(); return Math.max(w / BOUNDS.w, hh / BOUNDS.h, 0.05); };
  /** Keep the view inside the canvas's bounds. */
  function bound(v) {
    const { w, h: hh } = size();
    const scale = clamp(v.scale, minScale(), MAX_ZOOM);
    const fit = (p, b0, bw, len) => { const hi = -b0 * scale, lo = len - (b0 + bw) * scale; return lo > hi ? (lo + hi) / 2 : clamp(p, lo, hi); };
    return { scale, x: fit(v.x, BOUNDS.x, BOUNDS.w, w), y: fit(v.y, BOUNDS.y, BOUNDS.h, hh) };
  }
  const toWorld = (cx, cy) => { const r = el.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.scale, y: (cy - r.top - view.y) / view.scale }; };
  const centre = () => { const { w, h: hh } = size(); return { x: (w / 2 - view.x) / view.scale, y: (hh / 2 - view.y) / view.scale }; };

  function applyView() {
    if (!size().w) return;
    view = bound(view ?? home());
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    // Push's grid: fine squares that fade as you zoom out, every fifth line stronger.
    const s = view.scale;
    const R = 24 * 5 ** Math.max(0, Math.ceil(Math.log(12 / (24 * s)) / Math.log(5))) * s;
    const minor = $('.pc-grid.minor'), major = $('.pc-grid.major');
    minor.style.backgroundSize = `${R}px ${R}px`;
    minor.style.opacity = String(clamp((R - 12) / 12, 0, 1));
    major.style.backgroundSize = `${R * 5}px ${R * 5}px`;
    minor.style.backgroundPosition = major.style.backgroundPosition = `${view.x}px ${view.y}px`;
    $('.pc-pct').textContent = `${Math.round(s * 100)}%`;
    const { w, h: hh } = size();
    app.act.setShareView({ cx: (w / 2 - view.x) / s, cy: (hh / 2 - view.y) / s, w: w / s, h: hh / s });
    drawKey();
  }
  let viewTimer = 0;
  const keepView = () => { clearTimeout(viewTimer); viewTimer = setTimeout(() => { app.state.view = view; app.sync(); }, 400); };
  const setView = (v) => { view = v; applyView(); keepView(); };
  function zoomAt(f, cx, cy) {
    const r = el.getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
    const scale = clamp(view.scale * f, minScale(), MAX_ZOOM), k = scale / view.scale;
    setView({ x: px - (px - view.x) * k, y: py - (py - view.y) * k, scale });
  }
  const centerOn = (x, y) => { const { w, h: hh } = size(); setView({ ...view, x: w / 2 - x * view.scale, y: hh / 2 - y * view.scale }); };

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    else setView({ ...view, x: view.x - e.deltaX });
  }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[e.key];
    if (!d || e.target !== el) return;
    e.preventDefault();
    setView({ ...view, x: view.x + d[0], y: view.y + d[1] });
  });
  $('.pc-zoom').addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]')?.dataset.zoom;
    if (z === undefined) return;
    if (z === '0') { setView(home()); return; }
    const r = el.getBoundingClientRect();
    zoomAt(z === '1' ? STEP : 1 / STEP, r.left + r.width / 2, r.top + r.height / 2);
  });
  new ResizeObserver(() => applyView()).observe(el);

  /* ---- cards ---- */

  const cards = new Map();   // card id → { el, mirror, ink }

  function cardMarkup() {
    return `<div class="pc-bar"><span class="pc-type"></span><span class="pc-name"></span><span class="pc-live" hidden></span>
        <button type="button" class="pc-ib" data-act="send" aria-label="Send to a screen" title="Send to a screen">${icon('Send', 'ico xs')}</button>
        <button type="button" class="pc-ib" data-act="remove-card" aria-label="Remove from canvas" title="Remove from canvas">${icon('X', 'ico xs')}</button></div>
      <div class="pc-body"><svg class="pc-card-ink" preserveAspectRatio="none"></svg><div class="pc-vc" hidden></div></div>
      <span class="pc-resize" aria-label="Resize" title="Resize"></span>`;
  }

  function renderCards() {
    const { state } = app;
    const keep = new Set(state.items.map((i) => i.id));
    for (const [id, c] of cards) if (!keep.has(id)) { c.mirror.destroy(); c.el.remove(); cards.delete(id); }
    for (const it of state.items) {
      const m = app.media(it.mediaId);
      if (!m) continue;
      let c = cards.get(it.id);
      if (!c) {
        const cel = h(`<div class="pc-card" data-card="${esc(it.id)}">${cardMarkup()}</div>`);
        c = { el: cel, mirror: new Mirror(document.createElement('div')) };
        cel.querySelector('.pc-body').prepend(c.mirror.el);
        cards.set(it.id, c);
        world.append(cel);
      }
      Object.assign(c.el.style, { left: `${it.x}px`, top: `${it.y}px`, width: `${it.w}px`, height: `${it.h}px` });
      c.el.querySelector('.pc-type').innerHTML = typeIcon(m.type, 'ico xs');
      const name = c.el.querySelector('.pc-name');
      name.textContent = m.name;
      name.title = m.name;
      // Live on a screen (and the screens linked with it), while it still shows this media.
      const on = it.liveOn && app.screen(it.liveOn);
      const live = on && !on.blanked && (on.mediaId === it.mediaId || Object.values(on.zoneMedia ?? {}).includes(it.mediaId)) ? [on.name, ...app.linkedWith(on.id).map((x) => app.screen(x)?.name).filter(Boolean)] : [];
      const chip = c.el.querySelector('.pc-live');
      chip.hidden = !live.length;
      chip.innerHTML = live.length ? `<i></i><span>Live on ${esc(live.join(', '))}</span>` : '';
      chip.title = live.length ? `What you do on this card happens on ${live.map((x) => `“${x}”`).join(', ')}` : '';
      c.el.classList.toggle('is-live', live.length > 0);
      c.el.classList.toggle('selected', selected === it.id);
      c.mirror.show({ ...mediaContent(m), muted: true });
      drawCardInk(c, it);
      videoControls(c, it, m, live.length ? on : null);
    }
    $('.pc-empty').hidden = state.items.length > 0;
  }

  function drawCardInk(c, it) {
    const bw = it.w, bh = it.h - BAR;
    const svg = c.el.querySelector('.pc-card-ink');
    svg.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
    svg.innerHTML = (app.state.ink.cards[it.id] ?? []).map((s) => path(s, (x, y) => [x * bw, y * bh], bw)).join('');
  }

  /** A pen stroke as an SVG path; to() maps its points, k its width. */
  function path(s, to, k) {
    const d = s.points.map((p, i) => { const [x, y] = to(p[0], p[1]); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');
    return `<path d="${d}${s.points.length === 1 ? ' l0.01 0' : ''}" stroke="${s.color}" stroke-width="${(s.width * k).toFixed(2)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  /** A video live on a screen: that screen's play, position and sound, on the card. */
  function videoControls(c, it, m, screen) {
    const vc = c.el.querySelector('.pc-vc');
    const show = m.type === 'video' && screen && app.isOnline(screen.id);
    vc.hidden = !show;
    if (!show) return;
    const st = app.videoState.get(screen.id) ?? { playing: true, time: 0, duration: 0, muted: screen.muted, volume: 1 };
    if (!vc.firstChild) {
      vc.innerHTML = `<button type="button" class="pc-vb" data-v="play"></button><span class="pc-vt" data-v="time"></span>
        <input type="range" class="pc-vr" data-v="seek" min="0" max="1000" aria-label="Position on the screen"><span class="pc-vt dim" data-v="dur"></span>
        <button type="button" class="pc-vb" data-v="mute"></button><input type="range" class="pc-vr vol" data-v="volume" min="0" max="100" aria-label="Volume on the screen">`;
      vc.addEventListener('pointerdown', (e) => e.stopPropagation());
      vc.addEventListener('click', (e) => {
        const v = e.target.closest('[data-v]')?.dataset.v;
        const s = app.videoState.get(vc.dataset.screen) ?? {};
        if (v === 'play') app.act.video(vc.dataset.screen, s.playing === false ? 'play' : 'pause');
        if (v === 'mute') app.act.video(vc.dataset.screen, s.muted ? 'unmute' : 'mute');
      });
      vc.addEventListener('input', (e) => {
        const v = e.target.dataset.v, s = app.videoState.get(vc.dataset.screen) ?? {};
        if (v === 'seek' && s.duration) app.act.video(vc.dataset.screen, 'seek', (e.target.value / 1000) * s.duration);
        if (v === 'volume') app.act.video(vc.dataset.screen, 'volume', e.target.value / 100);
      });
    }
    vc.dataset.screen = screen.id;
    const play = vc.querySelector('[data-v="play"]'), mute = vc.querySelector('[data-v="mute"]');
    play.innerHTML = icon(st.playing === false ? 'Play' : 'Pause', 'ico sm');
    play.setAttribute('aria-label', st.playing === false ? 'Play on the screen' : 'Pause on the screen');
    mute.innerHTML = icon(st.muted ? 'VolumeX' : 'Volume2', 'ico sm');
    mute.setAttribute('aria-label', st.muted ? 'Unmute the screen' : 'Mute the screen');
    vc.querySelector('[data-v="time"]').textContent = fmt(st.time);
    vc.querySelector('[data-v="dur"]').textContent = fmt(st.duration);
    const seek = vc.querySelector('[data-v="seek"]');
    if (document.activeElement !== seek) seek.value = st.duration ? String(Math.round((st.time / st.duration) * 1000)) : '0';
    const vol = vc.querySelector('[data-v="volume"]');
    if (document.activeElement !== vol) vol.value = String(Math.round((st.muted ? 0 : st.volume ?? 1) * 100));
  }

  function drawCanvasInk() {
    inkSvg.innerHTML = app.state.ink.canvas.map((s) => path(s, (x, y) => [x, y], 1)).join('');
  }

  /* ---- dropping and throwing ---- */

  /** The slot under a point: { id, zone, edge, el } for a screen on an edge, or null. */
  function slotAt(x, y) {
    const s = document.elementFromPoint(x, y)?.closest('.pc-slot.on');
    return s ? { id: s.dataset.screen, zone: s.dataset.zone || null, edge: s.dataset.edge, el: s } : null;
  }
  /** Where a throw lands: the edge it went toward (or was let go near), and the screen on it in line with it. */
  function edgeTarget(e, dir) {
    const r = el.getBoundingClientRect();
    let edge = dir;
    if (!edge) {
      const d = [['left', e.clientX - r.left], ['right', r.right - e.clientX], ['top', e.clientY - r.top]].sort((a, b) => a[1] - b[1])[0];
      if (d[1] < THROW.edge) edge = d[0];
    }
    if (!edge) return null;
    const list = app.state.slots[edge];
    const t = edge === 'top' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    const entry = list[clamp(Math.floor(t * list.length), 0, list.length - 1)] ?? list.find(Boolean) ?? null;
    return { edge, id: entry ? baseId(entry) : null, zone: entry ? zoneOf(entry) ?? null : null };
  }
  const throwDir = (vx, vy) => (Math.hypot(vx, vy) < THROW.speed ? null : vx < -Math.abs(vy) ? 'left' : vx > Math.abs(vy) ? 'right' : vy < -Math.abs(vx) ? 'top' : null);
  /** Light up the screen something would go to. */
  function target(t) {
    el.ownerDocument.querySelectorAll('.pc-slot.drop').forEach((s) => s.classList.remove('drop'));
    if (!t?.id) return;
    const sel = t.zone ? `.pc-slot.on[data-screen="${CSS.escape(t.id)}"][data-zone="${CSS.escape(t.zone)}"]` : `.pc-slot.on[data-screen="${CSS.escape(t.id)}"]`;
    el.ownerDocument.querySelectorAll(sel).forEach((s) => s.classList.add('drop'));
  }
  function flyOff(cel, edge) {
    const d = { left: [-1, 0], right: [1, 0], top: [0, -1] }[edge] ?? [0, -1];
    cel.classList.add('flying');
    cel.style.transform = `translate(${d[0] * 420}px, ${d[1] * 320}px) scale(0.6)`;
    cel.style.opacity = '0';
    setTimeout(() => { cel.classList.remove('flying'); cel.style.transform = ''; cel.style.opacity = ''; }, 380);
  }
  const hint = (text) => { const p = $('.pc-hint'); p.hidden = !text; p.textContent = text ?? ''; };

  /* ---- gestures ---- */

  let g = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select, .pc-zoom, .pc-key, .pc-tl, .pc-reset, .pc-zones')) return;
    const cel = e.target.closest('.pc-card');
    const it = cel && app.state.items.find((i) => i.id === cel.dataset.card);
    // No text selection, no native drag: either would cancel the gesture (pointercancel).
    e.preventDefault();
    getSelection()?.removeAllRanges();
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    const mode = app.ui.mode;
    if (mode !== 'select') {
      // Pen notes: on the card under the pen, else on the canvas.
      const body = cel?.querySelector('.pc-body');
      const on = it && body ? { id: it.id, rect: body.getBoundingClientRect() } : null;
      const pt = (ev) => (on ? [(ev.clientX - on.rect.left) / on.rect.width, (ev.clientY - on.rect.top) / on.rect.height] : (({ x, y }) => [x, y])(toWorld(ev.clientX, ev.clientY)));
      if (mode === 'pen') {
        const stroke = { color: app.ui.color, width: on ? CARD_PEN : CANVAS_PEN / view.scale, points: [pt(e)] };
        const holder = on ? cel.querySelector('.pc-card-ink') : inkSvg;
        const live = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        holder.append(live);
        g = { kind: 'pen', stroke, live, on, pt, it };
      } else g = { kind: 'erase', on, pt };
      return;
    }
    if (it && e.target.closest('.pc-resize')) { g = { kind: 'resize', it, cel, sx: e.clientX, sy: e.clientY, w: it.w, h: it.h }; return; }
    if (it) {
      select(it.id);
      app.state.items = [...app.state.items.filter((i) => i !== it), it];   // on top
      world.append(cel);
      g = { kind: 'move', it, cel, sx: e.clientX, sy: e.clientY, x: it.x, y: it.y, samples: [[e.timeStamp, e.clientX, e.clientY]] };
      return;
    }
    select(null);
    g = { kind: 'press', sx: e.clientX, sy: e.clientY, x: view.x, y: view.y };
    // Held still: the canvas lifts, to be thrown at a screen.
    g.timer = setTimeout(() => { if (g?.kind === 'press') { g.kind = 'lift'; el.classList.add('lifted'); hint('Throw toward a screen on the left, right or top to share this canvas with it'); navigator.vibrate?.(15); } }, LIFT_MS);
  });

  el.addEventListener('pointermove', (e) => {
    if (!g) return;
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (g.kind === 'pen') {
      const p = g.pt(e);
      const last = g.stroke.points[g.stroke.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > (g.on ? 0.002 : 1 / view.scale)) g.stroke.points.push(p);
      const k = g.on ? g.it.w : 1;
      g.live.innerHTML = path(g.stroke, g.on ? (x, y) => [x * g.it.w, y * (g.it.h - BAR)] : (x, y) => [x, y], k);
      return;
    }
    if (g.kind === 'erase') { eraseAt(g.on, g.pt(e)); return; }
    if (g.kind === 'press') {
      if (Math.hypot(dx, dy) > LIFT_SLOP) { clearTimeout(g.timer); g.kind = 'pan'; el.classList.add('grabbing'); }
      else return;
    }
    if (g.kind === 'pan') { setView({ ...view, x: g.x + dx, y: g.y + dy }); return; }
    if (g.kind === 'lift') {
      lift.style.transform = `translate(${dx}px, ${dy}px) scale(0.97)`;
      const r = el.getBoundingClientRect();
      const ax = Math.abs(dx) / r.width, ay = Math.abs(dy) / r.height;
      const dir = ax >= ay ? (ax >= 0.05 ? (dx < 0 ? 'left' : 'right') : null) : ay >= 0.05 && dy < 0 ? 'top' : null;
      g.target = dir ? edgeTarget(e, dir) : null;
      target(g.target);
      return;
    }
    if (g.kind === 'resize') {
      g.it.w = Math.max(160, Math.round(g.w + dx / view.scale));
      g.it.h = Math.max(110, Math.round(g.h + dy / view.scale));
      Object.assign(g.cel.style, { width: `${g.it.w}px`, height: `${g.it.h}px` });
      return;
    }
    // Moving a card.
    g.moved ||= Math.hypot(dx, dy) > 4;
    g.it.x = Math.round(g.x + dx / view.scale);
    g.it.y = Math.round(g.y + dy / view.scale);
    Object.assign(g.cel.style, { left: `${g.it.x}px`, top: `${g.it.y}px` });
    g.cel.classList.add('lifted');
    g.samples.push([e.timeStamp, e.clientX, e.clientY]);
    if (g.samples.length > 4) g.samples.shift();
    hint('Drop it on a screen, or throw it toward one on the left, right or top');
    // The throw: the fastest of the last few movements (one slow frame doesn't spoil it).
    let v = [0, 0];
    for (let i = 1; i < g.samples.length; i++) {
      const [ta, xa, ya] = g.samples[i - 1], [tb, xb, yb] = g.samples[i];
      const dt = Math.max(1, tb - ta), s = [(xb - xa) / dt, (yb - ya) / dt];
      if (tb >= e.timeStamp - THROW.sampleMs * 3 && Math.hypot(...s) > Math.hypot(...v)) v = s;
    }
    g.target = slotAt(e.clientX, e.clientY) ?? edgeTarget(e, throwDir(...v));
    target(g.target);
  });

  const end = (e) => {
    if (!g) return;
    const d = g;
    g = null;
    clearTimeout(d.timer);
    el.classList.remove('grabbing', 'lifted');
    hint(null);
    target(null);
    if (d.kind === 'pen') {
      d.live.remove();
      if (e.type === 'pointerup') app.act.addStroke(d.on ? d.on.id : 'canvas', d.stroke);
      return;
    }
    if (d.kind === 'erase' || d.kind === 'press') return;
    if (d.kind === 'pan') { keepView(); return; }
    if (d.kind === 'lift') {
      lift.classList.add('settling');
      lift.style.transform = '';
      setTimeout(() => lift.classList.remove('settling'), 300);
      if (d.target?.id && e.type === 'pointerup') app.act.share(d.target.id);
      return;
    }
    if (d.kind === 'resize') { app.commit(); return; }
    d.cel.classList.remove('lifted');
    if (!d.moved) { app.sync(); return; }
    const t = e.type === 'pointerup' ? d.target : null;
    if (!t) { app.commit(); return; }
    // Dropped on a screen: it stays where it was let go. Thrown: back where it was picked up.
    const dropped = t.el;
    if (!dropped) { d.it.x = d.x; d.it.y = d.y; }
    if (!t.id) { app.notify(`No screen on the ${EDGE_LABELS[t.edge].toLowerCase()} edge yet`, { tone: 'err' }); app.commit(); return; }
    if (!dropped) flyOff(d.cel, t.edge);
    setTimeout(() => app.act.push(t.id, d.it.mediaId, { cardId: d.it.id, zoneId: t.zone }), dropped ? 0 : 200);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  /** The eraser: strokes within reach of the point go. */
  function eraseAt(on, [x, y]) {
    const list = on ? app.state.ink.cards[on.id] ?? [] : app.state.ink.canvas;
    const reach = on ? 0.02 : 12 / view.scale;
    const hit = list.find((s) => s.points.some(([px, py]) => Math.hypot(px - x, (py - y) * (on ? on.rect.height / on.rect.width : 1)) < reach));
    if (hit) app.act.eraseStroke(on ? on.id : 'canvas', hit);
  }

  function select(id) {
    selected = id;
    for (const [cid, c] of cards) c.el.classList.toggle('selected', cid === id);
  }

  world.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    const id = b?.closest('.pc-card')?.dataset.card;
    if (!id) return;
    if (b.dataset.act === 'remove-card') app.act.removeCard(id);
    if (b.dataset.act === 'send') sendMenu(app, b, app.state.items.find((i) => i.id === id).mediaId, { cardId: id });
  });

  /* ---- top left: pen notes, and where the canvas is shared ---- */

  function renderTopLeft() {
    const pen = $('.pc-pen');
    pen.classList.toggle('on', app.ui.mode !== 'select');
    pen.innerHTML = icon(app.ui.mode === 'eraser' ? 'Eraser' : app.ui.mode === 'pen' ? 'Pen' : 'PenTool', 'ico');
    if (app.ui.mode === 'pen') pen.style.setProperty('--pen', app.ui.color); else pen.style.removeProperty('--pen');
    const share = $('.pc-sharing');
    const n = app.state.share.length;
    share.hidden = !n;
    share.innerHTML = n ? `${icon('Presentation', 'ico')}<b>${n}</b>` : '';
    share.title = n ? `Sharing canvas with ${app.state.share.map((id) => app.screen(id)?.name ?? 'A screen').join(', ')}` : '';
    el.classList.toggle('pen-mode', app.ui.mode !== 'select');
  }
  /** The zone switcher: which zone's screens are on the edges; pick one to put its screens there. */
  function renderZones() {
    const on = app.zoneOnEdges();
    $('.pc-zones').innerHTML = ZONES.map((z) => `<button type="button" class="${z.id === on ? 'on' : ''}" data-zone="${esc(z.id)}" aria-pressed="${z.id === on}"
      title="Put the ${esc(z.title)}'s screens on the edges">${z.id === on ? icon('MapPin', 'ico xs') : ''}<b>${esc(z.n)}</b>${esc(z.name)}</button>`).join('');
  }
  $('.pc-zones').addEventListener('click', (e) => {
    const z = e.target.closest('[data-zone]')?.dataset.zone;
    if (z && z !== app.zoneOnEdges()) app.act.showZone(z);
  });

  $('.pc-reset').addEventListener('click', () => {
    app.confirm('Start over?', 'The screens, media and canvas go back to how they were at the start, and the walls go idle.', 'Reset', () => app.act.reset());
  });
  $('.pc-tl').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b?.dataset.act === 'pen') penMenu(b);
    if (b?.dataset.act === 'sharing') sharingMenu(b);
  });

  /** What notes act on: the canvas, or a card (with the screen it's live on). */
  function targets() {
    const list = [{ key: 'canvas', label: 'The canvas' }];
    for (const it of app.state.items) {
      const m = app.media(it.mediaId), on = it.liveOn && app.screen(it.liveOn);
      if (m) list.push({ key: it.id, label: on ? `${m.name} (live on ${on.name})` : `${m.name} (card)` });
    }
    return list;
  }

  function penMenu(anchor) {
    const ui = app.ui;
    if (!targets().some((t) => t.key === ui.target)) ui.target = 'canvas';
    dropdown(anchor, '<div class="pen-pop"></div>', {
      width: 220,
      onMount(menu, close) {
        menu.classList.add('pen-menu');
        const pop = menu.querySelector('.pen-pop');
        const draw = () => {
          const t = ui.target;
          pop.innerHTML = `<div class="pen-row" role="group" aria-label="Pen tool">
              <button type="button" data-p="select" class="${ui.mode === 'select' ? 'on' : ''}" aria-label="Select: the mouse moves and pans, only a stylus writes" title="Select (mouse moves things; a stylus still writes)">${icon('MousePointer2', 'ico sm')}</button>
              <button type="button" data-p="pen" class="${ui.mode === 'pen' ? 'on' : ''}" aria-label="Pen">${icon('Pen', 'ico sm')}</button>
              <button type="button" data-p="eraser" class="${ui.mode === 'eraser' ? 'on' : ''}" aria-label="Eraser">${icon('Eraser', 'ico sm')}</button>
              <i class="pen-sep"></i>
              <button type="button" data-p="undo" aria-label="Undo" ${app.act.canUndo(t) ? '' : 'disabled'}>${icon('Undo2', 'ico sm')}</button>
              <button type="button" data-p="redo" aria-label="Redo" ${app.act.canRedo(t) ? '' : 'disabled'}>${icon('Redo2', 'ico sm')}</button>
              <button type="button" data-p="clear" aria-label="Clear all notes" title="Clear all notes">${icon('Trash2', 'ico sm')}</button>
              <button type="button" data-p="save" aria-label="Save with notes" title="Save with notes: download or keep in Media">${icon('Download', 'ico sm')}</button>
            </div>
            <div class="pen-row colours" ${ui.mode === 'pen' ? '' : 'hidden'}>${COLORS.map((c) => `<button type="button" data-c="${c}" class="pen-dot ${ui.color === c ? 'on' : ''}" style="--c:${c}" aria-label="Pen colour ${c}"></button>`).join('')}</div>
            <label class="pen-on">Acts on <select>${targets().map((x) => `<option value="${esc(x.key)}" ${x.key === t ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>`;
        };
        draw();
        pop.addEventListener('click', (e) => {
          const c = e.target.closest('[data-c]')?.dataset.c;
          if (c) { ui.color = c; ui.mode = 'pen'; draw(); renderTopLeft(); return; }
          const p = e.target.closest('[data-p]')?.dataset.p;
          if (!p) return;
          if (['select', 'pen', 'eraser'].includes(p)) { ui.mode = p; draw(); renderTopLeft(); if (p === 'select') close(); return; }
          if (p === 'undo') app.act.undo(ui.target);
          if (p === 'redo') app.act.redo(ui.target);
          if (p === 'clear') app.act.clearNotes(ui.target);
          if (p === 'save') { close(); saveMenu(anchor, ui.target); return; }
          draw();
        });
        pop.addEventListener('change', (e) => { ui.target = e.target.value; draw(); });
      },
    });
  }

  function saveMenu(anchor, key) {
    dropdown(anchor, `<div class="dd-label">Save with notes</div>
      <button data-to="device">${icon('Download', 'ico sm')} To this device</button>
      <button data-to="media">${icon('Image', 'ico sm')} To Media</button>`, {
      width: 200,
      onMount(menu, close) {
        menu.addEventListener('click', async (e) => {
          const to = e.target.closest('[data-to]')?.dataset.to;
          if (!to) return;
          close();
          try { await saveWithNotes(key, to); } catch { app.notify('Export failed', { tone: 'err' }); }
        });
      },
    });
  }

  /** The canvas as it is in view, or a card's picture, with its notes, as a PNG. */
  async function saveWithNotes(key, to) {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    let name;
    if (key === 'canvas') {
      const { w, h: hh } = size();
      cv.width = w * 2; cv.height = hh * 2;
      ctx.scale(2, 2);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, hh);
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);
      for (const it of app.state.items) {
        const m = app.media(it.mediaId);
        if (!m) continue;
        ctx.fillStyle = '#191919';
        ctx.fillRect(it.x, it.y, it.w, BAR);
        ctx.fillStyle = '#fff';
        ctx.font = "500 12px 'Geist Sans', system-ui";
        ctx.fillText(m.name, it.x + 8, it.y + 18, it.w - 16);
        drawMedia(ctx, m, it.x, it.y + BAR, it.w, it.h - BAR);
        drawStrokes(ctx, app.state.ink.cards[it.id], (x, y) => [it.x + x * it.w, it.y + BAR + y * (it.h - BAR)], it.w);
      }
      drawStrokes(ctx, app.state.ink.canvas, (x, y) => [x, y], 1);
      name = 'Canvas with notes.png';
    } else {
      const it = app.state.items.find((i) => i.id === key), m = app.media(it.mediaId);
      cv.width = 1920; cv.height = 1080;
      drawMedia(ctx, m, 0, 0, 1920, 1080);
      drawStrokes(ctx, app.state.ink.cards[it.id], (x, y) => [x * 1920, y * 1080], 1920);
      name = `${m.name.replace(/\.[^.]+$/, '')} with notes.png`;
    }
    const blob = await new Promise((r, j) => { try { cv.toBlob((b) => (b ? r(b) : j()), 'image/png'); } catch (err) { j(err); } });
    if (to === 'device') {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    const item = { id: `dl-${Date.now().toString(36)}`, name, type: 'image', source: 'download', url: URL.createObjectURL(blob), sizeBytes: blob.size, createdAt: new Date().toISOString() };
    app.state.media = [item, ...app.state.media];
    app.fresh.add(item.id);
    app.commit();
    app.notify(`Saved “${name}” to Media`);
  }

  function sharingMenu(anchor) {
    const ids = app.state.share;
    dropdown(anchor, `<div class="dd-label">Sharing this canvas with</div>
      ${ids.map((id) => `<button data-stop="${esc(id)}"><i class="pc-dot ${app.status(app.screen(id) ?? {}).dot}"></i>${esc(app.screen(id)?.name ?? 'A screen')}<small class="dd-side">Stop</small></button>`).join('')}
      <hr><button data-all class="danger">${icon('X', 'ico sm')} Stop sharing everywhere</button>`, {
      width: 230,
      onMount(menu, close) {
        menu.addEventListener('click', (e) => {
          const id = e.target.closest('[data-stop]')?.dataset.stop;
          if (id) { close(); app.act.stopShare(id); }
          if (e.target.closest('[data-all]')) { close(); app.act.stopShareAll(); }
        });
      },
    });
  }

  /* ---- the canvas key ---- */

  function drawKey() {
    const wrap = $('.pc-key-wrap');
    if (!keyOpen) {
      wrap.innerHTML = `<button type="button" class="pc-key-show" data-key="show" aria-label="Show the canvas key" title="Show the canvas key">${icon('Map', 'ico sm')}</button>`;
      return;
    }
    if (!view) return;
    const { w, h: hh } = size();
    const vr = { x: -view.x / view.scale, y: -view.y / view.scale, w: w / view.scale, h: hh / view.scale };
    // Fit everything: the frame, the cards and the view, with a margin.
    const boxes = [{ x: -FRAME.w / 2, y: -FRAME.h / 2, w: FRAME.w, h: FRAME.h }, vr, ...app.state.items];
    let x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    let x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
    const pad = Math.max(x1 - x0, y1 - y0) * 0.08;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const kh = clamp(KEY_W * ((y1 - y0) / (x1 - x0)), 60, 120);
    const k = Math.min(KEY_W / (x1 - x0), kh / (y1 - y0));
    const ox = (KEY_W - (x1 - x0) * k) / 2 - x0 * k, oy = (kh - (y1 - y0) * k) / 2 - y0 * k;
    const r = (b, cls, title = '') => `<i class="${cls}" style="left:${ox + b.x * k}px;top:${oy + b.y * k}px;width:${Math.max(2, b.w * k)}px;height:${Math.max(2, b.h * k)}px"${title ? ` title="${esc(title)}"` : ''}></i>`;
    wrap.innerHTML = `<div class="pc-key">
      <div class="pk-head"><span>Canvas</span><button type="button" data-key="hide" aria-label="Hide the canvas key">${icon('ChevronDown', 'ico sm')}</button></div>
      <div class="pk-map" style="width:${KEY_W}px;height:${kh}px" aria-label="Canvas key: click or drag to go there" data-ox="${ox}" data-oy="${oy}" data-k="${k}">
        <i class="pk-axis h" style="top:${oy}px"></i><i class="pk-axis v" style="left:${ox}px"></i>
        ${r({ x: -FRAME.w / 2, y: -FRAME.h / 2, w: FRAME.w, h: FRAME.h }, 'pk-frame')}
        ${app.state.items.map((it) => r(it, it.liveOn ? 'pk-live' : 'pk-card', app.media(it.mediaId)?.name)).join('')}
        ${r(vr, 'pk-view')}
      </div>
      <div class="pk-legend"><span><i class="pk-card"></i>Card</span><span><i class="pk-live"></i>Live</span><span><i class="pk-frame"></i>Screen</span></div></div>`;
  }
  $('.pc-key-wrap').addEventListener('click', (e) => {
    const k = e.target.closest('[data-key]')?.dataset.key;
    if (k === 'hide') { keyOpen = false; drawKey(); }
    if (k === 'show') { keyOpen = true; drawKey(); }
  });
  $('.pc-key-wrap').addEventListener('pointerdown', (e) => {
    const map = e.target.closest('.pk-map');
    if (!map) return;
    e.stopPropagation();
    const go = (ev) => {
      const r = map.getBoundingClientRect();
      const k = Number(map.dataset.k);
      centerOn((ev.clientX - r.left - Number(map.dataset.ox)) / k, (ev.clientY - r.top - Number(map.dataset.oy)) / k);
    };
    go(e);
    const move = (ev) => go(ev);
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  app.canvas = { toWorld, centre, centerOn, select, home: () => setView(home()), el };
  // Video positions from the screens: keep the cards' controls current.
  app.onChange(() => { for (const it of app.state.items) { const c = cards.get(it.id), m = app.media(it.mediaId); const on = it.liveOn && app.screen(it.liveOn); if (c && m) videoControls(c, it, m, on && !on.blanked ? on : null); } });

  return {
    render() {
      applyView();
      renderCards();
      drawCanvasInk();
      renderTopLeft();
      renderZones();
    },
  };
}

/** "Send to": every paired screen, its status, which are on an edge or showing the canvas. */
export function sendMenu(app, anchor, mediaId, { cardId = null } = {}) {
  const placed = new Set(EDGES.flatMap((e) => app.state.slots[e]).filter(Boolean).map(baseId));
  const row = (s) => `<button data-id="${esc(s.id)}" class="${app.state.share.includes(s.id) ? 'dim' : ''}"><i class="pc-dot ${app.status(s).dot}"></i>${esc(s.name)}${app.state.share.includes(s.id) ? '<small class="dd-side ok">sharing</small>' : placed.has(s.id) ? '<small class="dd-side">on edge</small>' : ''}</button>`;
  // Zone by zone, as the Nex lists them; screens added here (no zone) last.
  const groups = [...ZONES.map((z) => ({ label: z.label, list: app.state.screens.filter((s) => s.zone === z.id) })),
    { label: 'Other screens', list: app.state.screens.filter((s) => !ZONES.some((z) => z.id === s.zone)) }].filter((g) => g.list.length);
  dropdown(anchor, `<div class="dd-label">Send to</div>
    ${groups.length ? groups.map((g) => `<hr><div class="dd-zone">${esc(g.label)}</div>${g.list.map(row).join('')}`).join('') : '<p class="dd-empty">No screens yet.</p>'}`, {
    align: 'end', width: 230,
    onMount(menu, close) {
      menu.addEventListener('click', (e) => {
        const id = e.target.closest('[data-id]')?.dataset.id;
        if (!id) return;
        close();
        app.act.push(id, mediaId, { cardId });
      });
    },
  });
}
