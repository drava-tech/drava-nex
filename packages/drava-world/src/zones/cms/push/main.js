// The Push replica: a browser-only copy of White Tusker's Nex, "Push", on the Nex kiosk in
// Zone 02 (the right wall). Built from the live app's public front-end (its layout, wording,
// flows and limits), without its server: no sign-in; its screens are the Nex touch point's
// three walls plus any display page opened from it (display.html), all over a BroadcastChannel
// (state.js).
//
// The console, as in Push: a canvas you pan and zoom (canvas.js), the screens docked on its
// Top, Left and Right edges (edges.js), and a Library along the foot: Media, Templates, Screens
// (library.js). Media goes on the canvas as cards; a card goes to a screen by dropping or
// throwing it at the screen, or with Send to. Hold the canvas itself and throw it to share the
// whole canvas with a screen. Pen notes write on the canvas or a card, and on its screen.
// This file holds the state, every action and the shell.

import '@fontsource/geist-sans/300.css';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '../app/cms.css';
import '../app/pages.css';
import './push.css';
import './board.js';

import { EMAIL_MEDIA, MEDIA } from '../shared/seed.js';
import { esc, h, icon } from '../app/ui.js';
import {
  CODE_CHARS, EDGES, ENTER, LAYOUTS, MAX_ON_EDGE, PAIR_MS, USER, ZONES, ZONE_EDGES, baseId, clearPush, layoutOf, loadPush, newScreenId,
  openPushChannel, part, savePush, seedPush,
} from './state.js';
import { initCanvas } from './canvas.js';
import { initEdges } from './edges.js';
import { initLibrary } from './library.js';

const CARD_W = 320, BAR = 28;    // a new card: 320 wide, a 16:9 picture under its title bar (canvas units)
const UPLOAD_MS = 1400;          // how long a simulated upload takes
const THEME_KEY = 'theme';

/* ---------------------------------------------------------------- state */

let state = loadPush();
const me = `push-${Math.random().toString(36).slice(2, 10)}`;
const lastSeen = new Map();
let onlineIds = new Set();
const listeners = new Set();
const history = new Map();       // pen notes undo/redo per target key: { undo: [], redo: [] }

const channel = openPushChannel((msg) => {
  if (msg?.type === 'hello') {
    channel.post({ type: 'state', state, from: me });
    // A display opened by its link pairs itself.
    if (msg.display) for (const id of msg.ids ?? []) { const s = screen(id); if (s && !s.paired) { s.paired = true; s.pairedAt = new Date().toISOString(); commit(); } }
  }
  if (msg?.type === 'state' && msg.from && msg.from !== me) { state = msg.state; render(); }
  if (msg?.type === 'online') {
    const now = Date.now();
    for (const id of msg.ids ?? []) lastSeen.set(id, now);
    refreshOnline();
  }
  if (msg?.type === 'video-state') { app.videoState.set(msg.screenId, msg); emit(); }
  if (msg?.type === 'pair') pairWith(msg.code);
});

function refreshOnline() {
  const now = Date.now();
  const next = new Set([...lastSeen].filter(([, t]) => now - t < 5000).map(([id]) => id));
  const changed = next.size !== onlineIds.size || [...next].some((id) => !onlineIds.has(id));
  onlineIds = next;
  if (changed) render();
}
setInterval(refreshOnline, 2000);

/** Save and tell the screens, without drawing again (a card being dragged, the canvas panned). */
function sync() {
  savePush(state);
  channel.post({ type: 'state', state, from: me });
}
/** Save, tell the screens, draw again. event: a word for the room ({ name, ids }). */
function commit(event = null) {
  sync();
  if (event) channel.post({ type: 'event', ...event });
  render();
}
const emit = () => { for (const fn of listeners) fn(); };

const uid = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const screen = (id) => state.screens.find((s) => s.id === id);
const media = (id) => state.media.find((m) => m.id === id);
/** The edge a screen (or one of its parts) is on, or null. */
const edgeOf = (id) => EDGES.find((e) => state.slots[e].some((x) => x && baseId(x) === id)) ?? null;
const linkedWith = (id) => state.links.find((l) => l.includes(id))?.filter((x) => x !== id) ?? [];
const status = (s) => (!s.paired ? { dot: 'none', text: 'Not paired' } : onlineIds.has(s.id) ? { dot: 'ok', text: 'Online' } : { dot: 'off', text: 'Offline' });
const zoneMeta = (s) => ZONES.find((z) => z.id === s?.zone) ?? null;
/** A screen's name, with its zone when it isn't the Nex wall's own room ("Bay 1 · Zone 04"). */
const label = (s) => { const z = zoneMeta(s); return z && z.id !== 'cms' ? `${s.name} · ${z.name}` : s?.name ?? ''; };
/** The zone whose screens fill the edges, if one does. */
function zoneOnEdges() {
  const ids = [...new Set(EDGES.flatMap((e) => state.slots[e]).filter(Boolean).map(baseId))];
  const zones = new Set(ids.map((id) => screen(id)?.zone ?? null));
  return ids.length && zones.size === 1 ? [...zones][0] : null;
}

/* ---------------------------------------------------------------- toasts (sonner, as in Push) */

const toasts = h('<ol class="pt-toasts" aria-live="polite"></ol>');
document.body.append(toasts);
/** tone: ok | warn | err | info. action: { label, onClick }. */
function notify(title, { tone = 'ok', description = '', action = null } = {}) {
  const ico = { ok: 'CircleCheck', warn: 'TriangleAlert', err: 'CircleAlert', info: 'CircleAlert' }[tone];
  const t = h(`<li class="pt-toast ${tone}">${icon(ico, 'ico sm')}<div><b>${esc(title)}</b>${description ? `<p>${esc(description)}</p>` : ''}</div>
    ${action ? `<button type="button" class="pt-act">${esc(action.label)}</button>` : ''}</li>`);
  t.querySelector('.pt-act')?.addEventListener('click', () => { action.onClick(); t.remove(); });
  toasts.append(t);
  requestAnimationFrame(() => t.classList.add('on'));
  setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 250); }, description ? 4200 : 2800);
}

/* ---------------------------------------------------------------- actions */

function zonesOf(s) { return layoutOf(s.layout).zones; }

/** Take a screen (and its parts) off every edge; an edge left empty keeps one placeholder. */
function lift(slots, id) {
  const out = {};
  for (const e of EDGES) {
    const had = slots[e].some((x) => x && baseId(x) === id);
    let list = slots[e].filter((x) => !(x && x.includes('#') && baseId(x) === id)).map((x) => (x === id ? null : x));
    if (had && !list.length) list = [null];
    out[e] = list;
  }
  return out;
}

function pairWith(code) {
  const p = state.pairing;
  const ok = p && p.code === String(code).toUpperCase() && Date.now() < p.expiresAt;
  if (!ok) { channel.post({ type: 'paired', code, error: 'NOT_FOUND' }); return; }
  const s = screen(p.screenId);
  s.paired = true;
  s.pairedAt = new Date().toISOString();
  state.pairing = { ...p, done: true };
  commit();
  channel.post({ type: 'paired', code, screenId: s.id, name: s.name });
}

const act = {
  /**
   * Show media on a screen (a part of it: zoneId), and on the screens linked with it. cardId:
   * the card it came from; keep: from the library, so it also goes on the canvas as a card.
   */
  push(screenId, mediaId, { cardId = null, zoneId = null, keep = false } = {}) {
    const s = screen(screenId), m = media(mediaId);
    if (!s || !m) return;
    if (state.share.includes(screenId)) { notify(`“${s.name}” is showing your canvas`, { tone: 'err', description: 'Stop sharing to push to it.' }); return; }
    let card = cardId ? state.items.find((i) => i.id === cardId) : null;
    if (!card && keep) card = state.items.find((i) => i.mediaId === m.id) ?? addCard(m);
    const linked = s.layout === 'single' && !zoneId ? linkedWith(screenId).filter((id) => !state.share.includes(id) && screen(id)?.layout === 'single') : [];
    const ids = [screenId, ...linked];
    for (const id of ids) {
      const t = screen(id);
      if (t.layout !== 'single') t.zoneMedia = { ...t.zoneMedia, [zoneId ?? zonesOf(t)[0].id]: m.id };
      else t.mediaId = m.id;
      t.blanked = false;
      t.enter = ENTER[edgeOf(id)] ?? 'up';
    }
    // A video plays aloud on the screen it was pushed to; other screens playing one go quiet.
    if (m.type === 'video') for (const x of state.screens) x.muted = x.id !== screenId;
    for (const it of state.items) if (ids.includes(it.liveOn)) it.liveOn = null;
    if (card) card.liveOn = screenId;
    commit({ name: 'push', ids });
    const msg = `Showing “${m.name}” on ${label(s)}${linked.length === 1 ? ' and 1 linked screen' : linked.length > 1 ? ` and ${linked.length} linked screens` : ''}`;
    if (onlineIds.has(screenId)) notify(msg);
    else notify(`${msg} — but no display is connected`, { tone: 'warn', description: `It will appear when “${s.name}” comes back online.` });
  },
  /** A card off the canvas: the screens it is live on go back to nothing. */
  removeCard(id) {
    const it = state.items.find((i) => i.id === id);
    if (!it) return;
    const live = it.liveOn ? [it.liveOn, ...linkedWith(it.liveOn)] : [];
    for (const sid of live) {
      const s = screen(sid);
      if (s?.mediaId === it.mediaId) s.mediaId = null;
    }
    state.items = state.items.filter((i) => i !== it);
    delete state.ink.cards[id];
    commit(live.length ? { name: 'clear', ids: live } : null);
  },
  /** On the canvas: a new card at x, y (canvas units), or the centre of the view. */
  addCard(mediaId, at = null) {
    const m = media(mediaId);
    if (m) { addCard(m, at); commit({ name: 'card' }); }
  },
  /** From the library's Add: the card already on the canvas comes into view, else a new one. */
  showCard(mediaId) {
    const it = state.items.find((i) => i.mediaId === mediaId);
    if (it) { app.canvas.centerOn(it.x + it.w / 2, it.y + it.h / 2); app.canvas.select(it.id); return; }
    act.addCard(mediaId);
  },

  /** The zone switcher: a zone's screens on the edges (its main screen at the top). */
  showZone(zoneId) {
    const z = ZONES.find((x) => x.id === zoneId);
    if (!z) return;
    state.slots = Object.fromEntries(EDGES.map((e) => [e, ZONE_EDGES[zoneId][e].flatMap((sid) => {
      const s = screen(sid);
      return s && s.layout !== 'single' ? zonesOf(s).map((p) => part(sid, p.id)) : [sid];
    })]));
    commit({ name: 'zone', ids: [zoneId] });
    notify(`${z.label} on the edges`, { description: 'Throw a card toward a screen to show it there.' });
  },

  /* edges */
  place(id, edge, index = null) {
    const s = screen(id);
    if (!s) return;
    if (s.layout !== 'single') { state.slots = { ...lift(state.slots, id), [edge]: zonesOf(s).map((z) => part(id, z.id)) }; commit(); return; }
    const before = EDGES.flatMap((e) => state.slots[e].map((x, i) => (x === id ? { e, i } : null))).find(Boolean);
    const slots = lift(state.slots, id);
    if (slots[edge].some((x) => x?.includes('#'))) slots[edge] = [null];   // an edge given to a split screen's parts
    const list = [...slots[edge]];
    const at = index ?? (list.includes(null) ? list.indexOf(null) : list.length);
    if (at >= MAX_ON_EDGE) { notify(`Up to ${MAX_ON_EDGE} screens on one edge`, { tone: 'err' }); return; }
    const there = list[at] ?? null;
    list[at] = id;
    slots[edge] = list;
    // Dropped on another screen: they swap places.
    if (there && there !== id && before) { const l = [...slots[before.e]]; l[before.i] = there; slots[before.e] = l; }
    state.slots = slots;
    commit();
  },
  unplace(id) { state.slots = lift(state.slots, id); commit(); },
  addSlot(edge) { if (state.slots[edge].length < MAX_ON_EDGE) { state.slots[edge] = [...state.slots[edge], null]; commit(); } },
  removeSlot(edge, i) { state.slots[edge] = state.slots[edge].filter((_, j) => j !== i); commit(); },
  shift(edge, i, d) {
    const l = [...state.slots[edge]], j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    state.slots[edge] = l;
    commit();
  },
  link(a, b) {
    const sa = state.links.find((l) => l.includes(a)) ?? [a], sb = state.links.find((l) => l.includes(b)) ?? [b];
    state.links = [...state.links.filter((l) => l !== sa && l !== sb), [...new Set([...sa, ...sb])]];
    commit();
  },
  unlink(id) {
    state.links = state.links.map((l) => l.filter((x) => x !== id)).filter((l) => l.length > 1);
    commit();
  },

  /* screens */
  addScreen(name) {
    const now = new Date().toISOString();
    const s = { id: newScreenId(), name, paired: false, pairedAt: null, layout: 'single', mediaId: null, zoneMedia: {}, blanked: false, muted: true, enter: 'up', createdAt: now };
    state.screens = [...state.screens, s];
    commit();
    notify(`“${name}” added`, { description: 'Pair it with a display to start pushing content.' });
    return s.id;
  },
  rename(id, name) { screen(id).name = name; commit(); notify('Screen renamed'); },
  deleteScreen(id) {
    const s = screen(id);
    state.slots = lift(state.slots, id);
    state.links = state.links.map((l) => l.filter((x) => x !== id)).filter((l) => l.length > 1);
    state.share = state.share.filter((x) => x !== id);
    state.groups = state.groups.map((g) => ({ ...g, layout: Object.fromEntries(EDGES.map((e) => [e, g.layout[e].filter((x) => x !== id)])) }));
    for (const it of state.items) if (it.liveOn === id) it.liveOn = null;
    state.screens = state.screens.filter((x) => x.id !== id);
    commit();
    notify(`Deleted “${s.name}”`);
  },
  unpair(id) { const s = screen(id); s.paired = false; s.pairedAt = null; commit(); notify(`“${s.name}” unpaired`); },
  newCode(id) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    state.pairing = { code, screenId: id, expiresAt: Date.now() + PAIR_MS };
    commit();
  },
  endPairing() { if (state.pairing) { state.pairing = null; sync(); } },
  displayLink: (id) => `${location.origin}/push/display.html?screen=${encodeURIComponent(id)}`,
  setLayout(id, layout) {
    const s = screen(id);
    if (!s || s.layout === layout) return;
    const edge = edgeOf(id);
    s.layout = layout;
    s.zoneMedia = {};
    state.links = state.links.map((l) => l.filter((x) => x !== id)).filter((l) => l.length > 1);   // a split screen is never linked
    if (edge) {
      if (layout === 'single') {
        const at = state.slots[edge].findIndex((x) => x && baseId(x) === id);
        const list = state.slots[edge].filter((x) => !(x && x.includes('#') && baseId(x) === id));
        list.splice(Math.max(0, at), 0, id);
        state.slots[edge] = list;
      } else state.slots = { ...lift(state.slots, id), [edge]: zonesOf(s).map((z) => part(id, z.id)) };
    }
    commit({ name: 'layout', ids: [id] });
    notify(`“${s.name}” is now ${LAYOUTS[layout].label.toLowerCase()}`, layout === 'single' ? {} : { description: 'On the canvas its edge splits into these parts; drop media on a part.' });
  },

  /* groups */
  saveGroup({ id = null, name, layout }) {
    if (id) state.groups = state.groups.map((g) => (g.id === id ? { ...g, name, layout } : g));
    else state.groups = [...state.groups, { id: `grp-${uid().slice(0, 8)}`, name, layout }];
    commit();
    notify(id ? 'Group saved' : `Group “${name}” created`, { description: 'Drag it onto the canvas to put its screens on their edges.' });
  },
  deleteGroup(id) {
    const g = state.groups.find((x) => x.id === id);
    state.groups = state.groups.filter((x) => x.id !== id);
    commit();
    notify(`Group “${g.name}” deleted`, { description: 'Its screens stay as they are.' });
  },
  /** Every edge the group uses becomes its screens; the other edges stay as they are. */
  placeGroup(id) {
    const g = state.groups.find((x) => x.id === id);
    if (!g) return;
    let slots = state.slots;
    const ids = EDGES.flatMap((e) => g.layout[e]);
    for (const sid of ids) slots = lift(slots, sid);
    for (const e of EDGES) if (g.layout[e].length) slots[e] = g.layout[e].flatMap((sid) => { const s = screen(sid); return s && s.layout !== 'single' ? zonesOf(s).map((z) => part(sid, z.id)) : [sid]; });
    state.slots = slots;
    commit();
  },

  /* media */
  upload(files) {
    const ok = [], bad = [];
    for (const f of files) (fileType(f.name) ? ok : bad).push(f);
    if (bad.length) notify(`${bad.length} file${bad.length === 1 ? '' : 's'} skipped`, { tone: 'err', description: 'Only images, video, PDF, XLSX/CSV, PPTX and DOCX can be shown on a screen.' });
    for (const file of ok) {
      const task = { id: uid(), file, status: 'queued', progress: 0 };
      app.uploads.push(task);
      const t0 = performance.now() + app.uploads.indexOf(task) * 250;
      const tick = () => {
        if (task.status === 'cancelled') return;
        const p = Math.min(1, Math.max(0, (performance.now() - t0) / UPLOAD_MS));
        task.status = p <= 0 ? 'preparing' : p < 1 ? 'uploading' : 'done';
        task.progress = Math.round(p * 100);
        if (p >= 1) {
          const item = { id: `upload-${uid().slice(0, 8)}`, name: file.name, type: fileType(file.name), source: 'upload', url: URL.createObjectURL(file), sizeBytes: file.size, createdAt: new Date().toISOString() };
          state.media = [item, ...state.media];
          app.fresh.add(item.id);
          commit({ name: 'upload' });
          return;
        }
        emit();
        setTimeout(tick, 120);
      };
      tick();
    }
    emit();
  },
  /** Load Email: the mailbox's new attachments (in Push, from Gmail); here, two samples. */
  loadEmail() {
    if (app.email.status === 'running') return;
    app.email.status = 'running';
    emit();
    setTimeout(() => {
      const now = Date.now();
      const add = EMAIL_MEDIA.filter((m) => !state.media.some((x) => x.id === m.id)).map((m, i) => ({
        ...m, createdAt: new Date(now - i * 1000).toISOString(), emailFrom: 'hello@thewhitetusker.com', emailSubject: 'For the Nex wall', emailReceivedAt: new Date(now - 6e5).toISOString(),
      }));
      state.media = [...add, ...state.media];
      for (const m of add) app.fresh.add(m.id);
      state.imports = [{ at: new Date(now).toISOString(), subject: add.length ? 'For the Nex wall' : 'Nothing new', added: add.length }, ...state.imports].slice(0, 10);
      app.email.status = 'complete';
      commit(add.length ? { name: 'upload' } : null);
      notify(`${add.length} ${add.length === 1 ? 'file' : 'files'} added`, { description: '0 emails skipped · 0 need retry', action: { label: 'Details', onClick: () => app.openEmail() } });
    }, 1500);
  },
  deleteMedia(id) {
    const m = media(id);
    for (const s of state.screens) {
      if (s.mediaId === id) s.mediaId = null;
      s.zoneMedia = Object.fromEntries(Object.entries(s.zoneMedia ?? {}).filter(([, x]) => x !== id));
    }
    for (const it of state.items.filter((i) => i.mediaId === id)) delete state.ink.cards[it.id];
    state.items = state.items.filter((i) => i.mediaId !== id);
    state.media = state.media.filter((x) => x.id !== id);
    if (MEDIA.some((x) => x.id === id)) state.deletedMedia = [...(state.deletedMedia ?? []), id];
    if (m.url.startsWith('blob:')) URL.revokeObjectURL(m.url);
    commit();
    notify(`Deleted “${m.name}”`);
  },

  /* the shared canvas */
  share(id) {
    const s = screen(id);
    if (!s) return;
    if (!state.share.includes(id)) state.share = [...state.share, id];
    s.enter = ENTER[edgeOf(id)] ?? 'up';
    commit({ name: 'share', ids: [id] });
    notify(`Sharing this canvas with “${s.name}”`);
  },
  stopShare(id) { state.share = state.share.filter((x) => x !== id); commit({ name: 'stop-share', ids: [id] }); },
  stopShareAll() { const ids = state.share; state.share = []; commit({ name: 'stop-share', ids }); },
  setShareView(v) {
    state.shareView = v;
    if (!state.share.length) return;
    clearTimeout(act.viewTimer);
    act.viewTimer = setTimeout(sync, 60);
  },

  /* pen notes: target 'canvas' or a card id */
  addStroke(target, stroke) {
    const list = target === 'canvas' ? state.ink.canvas : (state.ink.cards[target] ??= []);
    list.push(stroke);
    const hist = history.get(target) ?? { undo: [], redo: [] };
    hist.undo.push({ add: stroke });
    hist.redo = [];
    history.set(target, hist);
    commit({ name: 'ink' });
  },
  eraseStroke(target, stroke) {
    const list = target === 'canvas' ? state.ink.canvas : state.ink.cards[target];
    const i = list?.indexOf(stroke) ?? -1;
    if (i < 0) return;
    list.splice(i, 1);
    const hist = history.get(target) ?? { undo: [], redo: [] };
    hist.undo.push({ remove: stroke, at: i });
    hist.redo = [];
    history.set(target, hist);
    commit();
  },
  undo(target) { step(target, 'undo', 'redo'); },
  redo(target) { step(target, 'redo', 'undo'); },
  clearNotes(target) {
    if (target === 'canvas') state.ink.canvas = [];
    else delete state.ink.cards[target];
    history.delete(target);
    commit();
  },
  canUndo: (target) => !!history.get(target)?.undo.length,
  canRedo: (target) => !!history.get(target)?.redo.length,

  /** A video on a screen: play, pause, seek (s), volume (0..1); mute / unmute is the screen's own setting. */
  video(screenId, action, value) {
    if (action === 'mute' || action === 'unmute') {
      const s = screen(screenId);
      s.muted = action === 'mute';
      app.videoState.set(screenId, { ...app.videoState.get(screenId), muted: s.muted });
      commit();
      return;
    }
    channel.post({ type: 'video', screenId, action, value });
  },
  /** Back to the start: the seed's screens, media and layout, an empty canvas, the walls idle. */
  reset() {
    clearPush();
    for (const m of state.media) if (m.url.startsWith('blob:')) URL.revokeObjectURL(m.url);
    state = seedPush();
    history.clear();
    app.uploads = [];
    app.fresh.clear();
    app.videoState.clear();
    app.email.status = 'idle';
    Object.assign(app.ui, { section: 'media', mode: 'select', color: '#e11d48', target: 'canvas', pushTarget: null });
    document.querySelectorAll('.modal-wrap').forEach((w) => w.remove());
    document.querySelectorAll('.menu.dd').forEach((m) => m.__close?.());
    app.canvas.home();
    commit({ name: 'reset' });
    notify('Back to the start');
  },
};

/** Undo or redo one pen-note step on a target. */
function step(target, from, to) {
  const hist = history.get(target);
  const s = hist?.[from].pop();
  if (!s) return;
  const list = target === 'canvas' ? state.ink.canvas : (state.ink.cards[target] ??= []);
  const adding = from === 'undo' ? s.remove : s.add;
  const removing = from === 'undo' ? s.add : s.remove;
  if (removing) { const i = list.indexOf(removing); if (i >= 0) list.splice(i, 1); }
  if (adding) list.splice(Math.min(s.at ?? list.length, list.length), 0, adding);
  hist[to].push(s);
  commit();
}

/** A new card for media m, at `at` (canvas units) or the middle of the view. Returns it. */
function addCard(m, at = null) {
  // In the middle of the view, each new one a little further down and right (as Push does).
  const n = (state.items.length % 8) * 24;
  const c = at ?? (({ x, y }) => ({ x: x + n, y: y + n }))(app.canvas.centre());
  const ph = (CARD_W * 9) / 16;
  const it = { id: uid(), mediaId: m.id, x: Math.round(c.x - CARD_W / 2), y: Math.round(c.y - (ph + BAR) / 2), w: CARD_W, h: Math.round(ph + BAR), liveOn: null };
  state.items = [...state.items, it];
  return it;
}

/** What a file is, from its name (the formats Push takes). */
function fileType(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'm4v', 'webm', 'ogg', 'mov'].includes(ext)) return 'video';
  return { pdf: 'document', xlsx: 'sheet', csv: 'sheet', pptx: 'presentation', docx: 'word' }[ext] ?? null;
}

/* ---------------------------------------------------------------- theme */

let theme = (() => { try { return localStorage.getItem(THEME_KEY) ?? 'dark'; } catch { return 'dark'; } })();
const dark = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const light = theme === 'light' || (theme === 'system' && !dark.matches);
  document.documentElement.classList.toggle('light', light);
  document.documentElement.classList.toggle('dark', !light);
}
dark.addEventListener('change', applyTheme);
applyTheme();

/* ---------------------------------------------------------------- the app the parts share */

const app = {
  get state() { return state; },
  act, commit, sync, notify, status, screen, media, edgeOf, linkedWith, zoneMeta, label, zoneOnEdges,
  user: USER,
  isOnline: (id) => onlineIds.has(id),
  fresh: new Set(),                // media added this visit: "New"
  uploads: [],                     // Upload's tasks: { id, file, status, progress }
  email: { status: 'idle' },
  videoState: new Map(),           // screen id → its video's position, from the screen
  ui: { section: 'media', mode: 'select', color: '#e11d48', target: 'canvas', pushTarget: null },
  canvas: null,                    // canvas.js: { centre, centerOn, select, home, toWorld }
  openEmail: () => {},             // library.js sets it
  confirm: () => {},               // library.js sets it: (title, body, button, onYes)
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  get theme() { return theme; },
  setTheme(t) { theme = t; try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ } applyTheme(); render(); },
};

/* ---------------------------------------------------------------- shell */

const root = document.getElementById('app');
root.innerHTML = `
  <div class="pc">
    <main class="pc-stage" data-testid="canvas">
      ${EDGES.map((e) => `<div class="pc-edge ${e}" data-edge="${e}"></div>`).join('')}
      <div class="pc-canvas" tabindex="0" role="application" aria-label="Canvas" data-testid="canvas-surface"></div>
    </main>
    <section class="pc-lib" aria-label="Library" data-testid="bottom-panel"></section>
  </div>`;

// Everything here is dragged by pointer (drag.js, canvas.js): the browser's own drag would cancel it.
root.addEventListener('dragstart', (e) => e.preventDefault());

const parts = [
  initCanvas(app, root.querySelector('.pc-canvas')),
  initEdges(app, root.querySelector('.pc-stage')),
  initLibrary(app, root.querySelector('.pc-lib')),
];

function render() {
  for (const p of parts) p.render();
  emit();
}

render();
// Tell any screen already open what to show, and ask any Push page already open for its state.
channel.post({ type: 'state', state });
channel.post({ type: 'hello' });
