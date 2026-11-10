// Whiteboards (whiteboards/ and _components/whiteboard/whiteboard-overlay.tsx in the real
// Nex): the saved boards, and the board itself: pen, eraser, line, rectangle and ellipse,
// eight colours and four widths, a white, dark or see-through board, undo, clear, pages, Save,
// and Push to screen, which draws on a wall live, stroke by stroke, as you draw here.

import { ERASER_WIDTHS, WHITEBOARD_COLORS, WHITEBOARD_WIDTHS, drawPage } from '../../shared/whiteboard.js';
import { confirmDialog, esc, fmtDate, h, icon, modal, toast } from '../ui.js';
import { pushModal } from './push.js';

const TOOLS = [['pen', 'Pen', 'Pencil'], ['eraser', 'Eraser', 'Eraser'], ['line', 'Line', 'Minus'], ['rect', 'Rectangle', 'Square'], ['circle', 'Ellipse', 'Circle']];
const SURFACES = [['light', 'White board', 'Sun'], ['dark', 'Dark board', 'Moon'], ['clear', 'Annotate the page', 'Eye']];
const WIDTH_DOTS = [6, 9, 12, 16];

/* ---------------------------------------------------------------- list */

export function renderWhiteboards(app) {
  const boards = [...app.state.whiteboards].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const page = h(`<div class="page wb-list">
    <div class="row" style="justify-content:space-between">
      <div><p class="kicker">Saved Boards</p><h1 class="caps-h1">Whiteboards</h1></div>
      <button class="btn pill solid" data-act="new">${icon('Plus')} New Board</button>
    </div>
    ${boards.length === 0 ? `<div class="empty">${icon('PenTool', 'ico lg')}<span style="font-size:12px">No saved whiteboards yet.</span></div>`
      : `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Pages</th><th>Updated</th><th class="r">Actions</th></tr></thead><tbody>
        ${boards.map((b) => `<tr data-id="${esc(b.id)}"><td><button class="wb-name" data-act="open">${icon('PenTool', 'ico xs dim')}<b>${esc(b.name)}</b></button></td>
          <td class="muted">${b.pages.length} page${b.pages.length === 1 ? '' : 's'}</td><td class="muted">${fmtDate(b.updatedAt)}</td>
          <td class="r"><button class="icon-btn del" data-act="delete" aria-label="Delete ${esc(b.name)}">${icon('Trash2', 'ico sm')}</button></td></tr>`).join('')}
      </tbody></table></div>`}
  </div>`);
  page.querySelector('[data-act="new"]').addEventListener('click', () => { session = null; app.go('/whiteboards/new'); });
  page.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const b = boards.find((x) => x.id === e.target.closest('tr')?.dataset.id);
    if (!b) return;
    if (act === 'open') app.go(`/whiteboards/${encodeURIComponent(b.id)}`);
    if (act === 'delete' && await confirmDialog({ title: `Delete "${b.name}"?`, body: `This can't be undone — all ${b.pages.length} page${b.pages.length === 1 ? '' : 's'} will be permanently removed.` })) app.deleteBoard(b.id);
  });
  return page;
}

/* ---------------------------------------------------------------- board */

// One editing session, kept outside the page so a re-render never loses the drawing.
let session = null;
let askPush = false;
/** The "+" button's Draw: a blank board that asks for a screen first. */
export function drawFromFab(app) { session = null; askPush = true; app.go('/whiteboards/new'); }

function newSession(app, id) {
  const doc = id && app.state.whiteboards.find((b) => b.id === id);
  return {
    id: doc?.id ?? null,
    name: doc?.name ?? 'Untitled Whiteboard',
    pages: doc ? structuredClone(doc.pages) : [{ surface: 'light', strokes: [] }],
    index: 0, tool: 'pen', color: WHITEBOARD_COLORS[0], width: 4, eraserWidth: 16,
    target: null, showColors: false,
  };
}

export function renderBoard(app, { id }) {
  const want = id === 'new' ? null : id;
  if (!session || session.id !== want) session = newSession(app, want);
  if (want && !app.state.whiteboards.some((b) => b.id === want)) {
    return h(`<div class="page"><div class="empty">${icon('PenTool', 'ico lg')}<b>Whiteboard not found</b></div></div>`);
  }
  const s = session;
  const page = h(`<div class="page wb-editor">
    <div class="wb-stage"><div class="wb-box"><div class="wb-surface"></div><canvas class="wb-ink"></canvas><canvas class="wb-touch"></canvas></div></div>
    <div class="wb-dock"><div class="wb-tools"></div></div>
  </div>`);
  page.keep = true;      // Nex updates don't rebuild the board while it's open

  const stage = page.querySelector('.wb-stage'), box = page.querySelector('.wb-box');
  const surfaceEl = page.querySelector('.wb-surface'), ink = page.querySelector('.wb-ink'), touch = page.querySelector('.wb-touch');
  const tools = page.querySelector('.wb-tools');
  let current = null, size = { w: 1, h: 1 }, raf = 0;
  const pageData = () => s.pages[s.index];

  const redraw = () => {
    const ctx = ink.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ink.width, ink.height);
    drawPage(ctx, pageData(), 0, 0, ink.width, ink.height, current);
    surfaceEl.className = `wb-surface ${pageData().surface}`;
  };
  // Live on a screen: send the page as it changes, once a frame at most.
  const sendLive = () => {
    if (!s.target || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; app.boardLive(s.target, { ...pageData(), current }); });
  };
  const commitLive = () => { if (s.target) app.boardCommit(s.target, pageData()); };

  const fit = () => {
    const r = stage.getBoundingClientRect();
    let w = r.width, hh = (r.width * 9) / 16;
    if (hh > r.height) { hh = r.height; w = (r.height * 16) / 9; }
    box.style.width = `${w}px`;
    box.style.height = `${hh}px`;
    const dpr = Math.min(devicePixelRatio, 2);
    size = { w, h: hh };
    for (const c of [ink, touch]) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
    redraw();
  };
  const ro = new ResizeObserver(fit);
  ro.observe(stage);

  const point = (e) => {
    const r = touch.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  touch.addEventListener('pointerdown', (e) => {
    touch.setPointerCapture(e.pointerId);
    s.showColors = false;
    current = { tool: s.tool, color: s.color, width: s.tool === 'eraser' ? s.eraserWidth : s.width, points: [point(e)] };
    redraw();
    sendLive();
  });
  touch.addEventListener('pointermove', (e) => {
    if (!current) return;
    if (current.tool === 'pen' || current.tool === 'eraser') {
      // Every sample the pointer made since the last event, not just the last one: on the kiosk
      // (a page inside the 3D view) moves arrive sparsely, and the in-between samples are what
      // keep a fast curve round. Samples closer than ~1 px are dropped.
      const samples = e.getCoalescedEvents?.() ?? [];
      const r = touch.getBoundingClientRect();
      const minGap = 1 / Math.max(r.width, 1);
      for (const ev of samples.length ? samples : [e]) {
        const p = point(ev), last = current.points[current.points.length - 1];
        if (Math.hypot(p.x - last.x, (p.y - last.y) * (r.height / r.width)) >= minGap) current.points.push(p);
      }
    } else current.points = [current.points[0], point(e)];
    redraw();
    sendLive();
  });
  const end = () => {
    if (!current) return;
    pageData().strokes.push(current);
    current = null;
    s.dirty = true;
    redraw();
    drawTools();
    sendLive();
    commitLive();
  };
  touch.addEventListener('pointerup', end);
  touch.addEventListener('pointercancel', end);
  touch.style.cursor = s.tool === 'eraser' ? 'cell' : 'crosshair';

  const btn = (act, label, inner, { on = false, danger = false, disabled = false, extra = '' } = {}) =>
    `<button class="tb ${on ? 'on' : ''} ${danger ? 'danger' : ''}" data-t="${act}" ${extra} title="${esc(label)}" aria-label="${esc(label)}" ${disabled ? 'disabled' : ''}>${inner}</button>`;
  const div = '<span class="tb-div"></span>';

  function drawTools() {
    const widths = s.tool === 'eraser' ? ERASER_WIDTHS : WHITEBOARD_WIDTHS;
    const active = s.tool === 'eraser' ? s.eraserWidth : s.width;
    const surf = SURFACES.find((x) => x[0] === pageData().surface);
    const n = pageData().strokes.length;
    tools.innerHTML = `
      ${TOOLS.map(([t, label, ico]) => btn(`tool:${t}`, label, icon(ico), { on: s.tool === t })).join('')}
      ${div}
      <span class="tb-wrap">${btn('colors', 'Colour', `<span class="tb-colour">${icon('Palette')}<i style="background:${s.color}"></i></span>`, { on: s.showColors })}
        ${s.showColors ? `<span class="tb-pop">${WHITEBOARD_COLORS.map((c) => `<button class="swatch lg ${c === s.color ? 'ring-blue' : ''}" data-t="color:${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}
          <label class="swatch lg rainbow" title="Custom colour"><input type="color" value="${s.color}" data-custom></label></span>` : ''}</span>
      ${widths.map((w, i) => btn(`width:${w}`, `${w}px`, `<span class="tb-dot" style="width:${WIDTH_DOTS[i]}px;height:${WIDTH_DOTS[i]}px"></span>`, { on: active === w })).join('')}
      ${div}
      ${btn('surface', `Board: ${surf[1]}`, icon(surf[2]))}
      ${btn('undo', 'Undo', icon('Undo2'), { disabled: n === 0 })}
      ${btn('clear', 'Clear board', icon('Trash2'), { danger: true, disabled: n === 0 })}
      ${div}
      ${btn('prev', 'Previous page', icon('ChevronLeft'), { disabled: s.index === 0 })}
      <span class="tb-count">${s.index + 1}/${s.pages.length}</span>
      ${btn('next', 'Next page', icon('ChevronRight'), { disabled: s.index === s.pages.length - 1 })}
      ${btn('page', 'New page', icon('Plus'))}
      ${div}
      ${btn('save', s.id ? `Save "${s.name}"` : 'Save whiteboard', icon('Save'))}
      ${div}
      ${btn('cast', s.target ? `Live on ${app.screenName(s.target)} — click to stop` : 'Push to screen', icon('Cast'), { on: !!s.target })}`;
    tools.querySelector('[data-custom]')?.addEventListener('input', (e) => { s.color = e.target.value; if (s.tool === 'eraser') s.tool = 'pen'; });
    tools.querySelector('[data-custom]')?.addEventListener('change', () => { s.showColors = false; drawTools(); });
    touch.style.cursor = s.tool === 'eraser' ? 'cell' : 'crosshair';
  }

  const switchTo = (i) => {
    s.index = i;
    redraw();
    drawTools();
    if (s.target) app.boardCommit(s.target, pageData());
  };

  tools.addEventListener('click', (e) => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (!t) return;
    const [act, arg] = t.split(':');
    if (act === 'tool') s.tool = arg;
    else if (act === 'colors') s.showColors = !s.showColors;
    else if (act === 'color') { s.color = t.slice(6); s.showColors = false; if (s.tool === 'eraser') s.tool = 'pen'; }
    else if (act === 'width') { if (s.tool === 'eraser') s.eraserWidth = Number(arg); else s.width = Number(arg); }
    else if (act === 'surface') {
      const i = SURFACES.findIndex((x) => x[0] === pageData().surface);
      pageData().surface = SURFACES[(i + 1) % SURFACES.length][0];
      s.dirty = true;
      redraw();
      commitLive();
    } else if (act === 'undo') { pageData().strokes.pop(); s.dirty = true; redraw(); commitLive(); }
    else if (act === 'clear') { pageData().strokes = []; s.dirty = true; redraw(); commitLive(); }
    else if (act === 'prev') { switchTo(s.index - 1); return; }
    else if (act === 'next') { switchTo(s.index + 1); return; }
    else if (act === 'page') { s.pages.push({ surface: 'light', strokes: [] }); switchTo(s.pages.length - 1); return; }
    else if (act === 'save') { save(); return; }
    else if (act === 'cast') {
      if (s.target) { app.stopBoard(s.target); s.target = null; toast('Stopped pushing'); } else askScreen();
    }
    drawTools();
  });

  function save(then) {
    const write = () => {
      const isNew = !s.id;
      s.id = app.saveBoard({ id: s.id, name: s.name, pages: s.pages });
      s.dirty = false;
      if (isNew) app.replacePath(`/whiteboards/${s.id}`);
      toast(`Saved "${s.name}"`);
      drawTools();
      then?.();
    };
    if (s.id) { write(); return; }
    modal(`<p class="kicker">Save Board</p><h2 style="font-size:15px">Name this whiteboard</h2>
      <input class="input" data-name value="${esc(s.name)}" placeholder="Whiteboard name" style="margin-top:8px">
      <div class="confirm-foot"><button class="btn ghost-caps" data-close>Cancel</button><button class="btn caps-solid" data-ok>Save</button></div>`, {
      narrow: true,
      onMount(el, close) {
        const input = el.querySelector('[data-name]');
        input.focus();
        input.select();
        const ok = () => { s.name = input.value.trim() || 'Untitled Whiteboard'; close(); write(); };
        el.querySelector('[data-ok]').addEventListener('click', ok);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      },
    });
  }

  // Pushing saves the board first (as the real one does), then draws on the screen live.
  function askScreen() {
    pushModal(app, {
      contentName: s.name,
      subtitle: 'Pick a screen to replicate your drawing to, live',
      single: true,
      onSkip: () => {},
      skipLabel: 'Draw without pushing',
      onPush: () => {},
      onPushed: ([screenId]) => {
        const start = () => {
          s.target = screenId;
          app.startBoard(screenId, { id: s.id, name: s.name }, pageData());
          toast(`Live on ${app.screenName(screenId)}`);
          drawTools();
        };
        if (s.id) start(); else save(start);
      },
    });
  }

  page.stop = () => ro.disconnect();
  drawTools();
  if (askPush) { askPush = false; setTimeout(askScreen); }
  return page;
}
