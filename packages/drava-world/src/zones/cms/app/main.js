// The Nex replica: a browser-only copy of White Tusker's Nex (cms-platform, apps/cms) that
// runs on the kiosk in Zone 02. Same navigation, pages and styling; the state lives in
// this browser and reaches the screens (Zone 02's three screens, and those of the zones further
// on: SCREEN_ZONES) and the room's devices over a BroadcastChannel (shared/state.js).

import '@fontsource/geist-sans/300.css';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-sans/900.css';
import './cms.css';
import './pages.css';

import { EMAIL_MEDIA, MAIN, MEDIA, SCREEN_ZONES, USER, seedState } from '../shared/seed.js';
import { clearSaved, contentLabel, loadState, openChannel, resolveContent, saveState, sortMedia } from '../shared/state.js';
import { setBoard, syncBoards } from '../shared/render.js';
import { Mirror, bytes, dropdown, esc, fmtDate, icon, toast } from './ui.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderScreens, renderScreenControl } from './pages/screens.js';
import { renderMedia } from './pages/media.js';
import { renderBroadcast } from './pages/broadcast.js';
import { renderZones } from './pages/zones.js';
import { renderEnvironment } from './pages/environment.js';
import { drawFromFab, renderBoard, renderWhiteboards } from './pages/whiteboards.js';
import { renderVisitors } from './pages/visitors.js';
import { renderBrowser, renderSettings } from './pages/other.js';

// guest: shown in Guest mode (the real Nex's guestModeVisible). hidden: a page the real Nex
// still has but no longer lists in its sidebar (cms-platform master, app-sidebar.tsx); it
// opens by its address only.
const NAV = [
  { title: 'Dashboard', path: '/', icon: 'LayoutDashboard', render: renderDashboard },
  { title: 'Broadcast', path: '/broadcast', icon: 'Send', render: renderBroadcast, guest: true },
  { title: 'Zones', path: '/zones', icon: 'MapPin', render: renderZones, guest: true },
  { title: 'Environment', path: '/environment', icon: 'Cpu', render: renderEnvironment, guest: true },
  { title: 'Screens', path: '/screens', icon: 'Monitor', render: renderScreens, guest: true },
  { title: 'Whiteboards', path: '/whiteboards', icon: 'PenTool', render: renderWhiteboards },
  { title: 'Visitors', path: '/visitors', icon: 'ScanFace', render: renderVisitors, hidden: true },
  { title: 'Media', path: '/media', icon: 'Film', render: renderMedia, guest: true },
  { title: 'Settings', path: '/settings', icon: 'Settings2', render: renderSettings, hidden: true },
];
// Reached from the "+" button, not the sidebar (its nav entry is commented out in the real Nex too).
const BROWSER = { title: 'Browser', path: '/browser', icon: 'Globe', render: renderBrowser, guest: true };

const AUTO_RELOCK_MS = 5000;     // the door locks itself again 5 s after an unlock
const DOCK_STEP = 10;            // the audio dock's volume step, in %
const VISIT_GAP_MS = 10 * 60e3;  // a new sighting of the same visitor after this long bumps "last seen"

/* ---------------------------------------------------------------- state */

let state = loadState();
syncBoards(state);
const lastSeen = new Map();          // screenId → time of its last heartbeat
let onlineIds = new Set();
let visitorAt = 0;                   // last time the room said a visitor is in Zone 02
// More than one Nex page can be open (the kiosk's, and /cms/ in a tab): each tags what it
// sends and takes the others' changes, so none of them writes back an old copy.
const me = `cms-${Math.random().toString(36).slice(2, 10)}`;

const channel = openChannel((msg) => {
  if (msg?.type === 'hello') channel.post({ type: 'state', state, from: me });
  if (msg?.type === 'state' && msg.from && msg.from !== me) {
    state = msg.state;
    syncBoards(state);
    render();
  }
  if (msg?.type === 'board') setBoard(msg.screenId, msg.page);
  if (msg?.type === 'online') {
    const now = Date.now();
    for (const id of msg.ids ?? []) lastSeen.set(id, now);
    refreshOnline();
  }
  if (msg?.type === 'visitor') visitorDetected();
});

function refreshOnline() {
  const now = Date.now();
  const next = new Set([...lastSeen].filter(([, t]) => now - t < 5000).map(([id]) => id));
  const changed = next.size !== onlineIds.size || [...next].some((id) => !onlineIds.has(id));
  onlineIds = next;
  if (changed) render();
}
setInterval(refreshOnline, 2000);

function commit(activity, event, { render: draw = true } = {}) {
  if (activity) state.activity = [{ id: crypto.randomUUID?.() ?? String(Math.random()), at: new Date().toISOString(), ...activity }, ...state.activity].slice(0, 40);
  saveState(state);
  channel.post({ type: 'state', state, from: me });
  if (event) channel.post({ type: 'event', name: event });
  if (draw) render();
}

const screenById = (id) => state.screens.find((s) => s.id === id);
const HOME = 'cms';                  // the zone the kiosk stands in: its screens go by their own names

/** Every zone with screens, each with its screens; screens added here (no zone) last, as "Other displays". */
function zoneList() {
  const list = SCREEN_ZONES.map((z) => ({ ...z, screens: state.screens.filter((s) => s.zone === z.id) }));
  const other = state.screens.filter((s) => !SCREEN_ZONES.some((z) => z.id === s.zone));
  if (other.length) list.push({ id: 'other', n: '+', name: 'Other', title: 'Other displays', screens: other });
  return list;
}

/** A screen's name, with its zone when it isn't in the kiosk's own room ("Bay 1 · Zone 04"). */
function screenLabel(id) {
  const s = screenById(id);
  if (!s) return id;
  const z = SCREEN_ZONES.find((x) => x.id === s.zone);
  return z && z.id !== HOME ? `${s.name} · ${z.name}` : s.name;
}
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** What a file is, from its type or name (the formats the real Upload accepts). */
function fileType(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  const ext = file.name.split('.').pop().toLowerCase();
  return { pdf: 'document', docx: 'word', xlsx: 'sheet', csv: 'sheet', pptx: 'presentation' }[ext] ?? null;
}

/** The visitor walked into Zone 02 (the room says so with every heartbeat). */
function visitorDetected() {
  const now = Date.now();
  const fresh = now - visitorAt > 5000;
  visitorAt = now;
  let v = state.visitors.find((x) => x.virtual);
  const iso = new Date().toISOString();
  let changed = false;
  if (!v) {
    v = { uuid: uid('v'), name: '', email: '', role: 'guest', photo: 265, firstSeen: iso, lastSeen: iso, virtual: true };
    state.visitors = [v, ...state.visitors];
    changed = true;
  } else if (now - new Date(v.lastSeen).getTime() > VISIT_GAP_MS || fresh) {
    v.lastSeen = iso;
    changed = true;
  }
  // The Welcome Trigger: while armed, a detected face switches the idle main screen to Welcome.
  const centre = screenById(MAIN);
  if (fresh && state.welcomeArmed && centre && !centre.content && !centre.blanked) {
    centre.content = { kind: 'experience', id: 'exp-welcome' };
    commit({ icon: 'ScanFace', text: `Welcome Trigger: visitor detected, ${centre.name} to Welcome` }, 'welcome');
    return;
  }
  if (changed) commit(null, null, { render: location.hash.startsWith('#/visitors') });
  else if (fresh && location.hash.startsWith('#/visitors')) render();
}

let relockTimer = 0;
let dockMin = false;                 // the audio dock folded down to its button

/** Screens playing a video right now. */
const videoScreens = () => state.screens.filter((s) => {
  const r = resolveContent(state, s);
  return r.kind === 'media' && r.type === 'video';
});

/**
 * A video pushed to screens brings its sound: in each zone it reaches (each has its own
 * speakers), one of them plays it aloud (the main screen, MAIN, if it's one of them), and every other
 * screen playing a video in that zone goes quiet, so copies don't echo.
 * Returns whether it did (the content was a video).
 */
function giveSound(ids, mediaId) {
  if (state.media.find((m) => m.id === mediaId)?.type !== 'video') return false;
  const zoneOf = (id) => screenById(id)?.zone ?? null;
  for (const zone of new Set(ids.map(zoneOf))) {
    const here = ids.filter((id) => zoneOf(id) === zone);
    const loud = here.includes(MAIN) ? MAIN : here[0];
    for (const s of videoScreens()) if ((s.zone ?? null) === zone) s.muted = s.id !== loud;
  }
  state.environment.audio.power = true;
  dockMin = false;
  return true;
}

/** Everything the pages can do; each change is saved, pushed to the screens and logged. */
const app = {
  get state() { return state; },
  user: USER,
  go: (path) => { location.hash = `#${path}`; },
  /** Change the address without rebuilding the page (a board's first save). */
  replacePath(path) { history.replaceState(null, '', `#${path}`); lastPath = location.hash; renderChrome(route()); },
  refresh: () => render(),
  isOnline: (id) => onlineIds.has(id),
  cameraLive: () => Date.now() - visitorAt < 6000,
  resolve: (screen) => resolveContent(state, screen),
  label: (screen) => contentLabel(state, screen),
  screenName: (id) => screenById(id)?.name ?? id,
  screenLabel,
  zones: zoneList,
  zoneOf: (screen) => zoneList().find((z) => z.screens.includes(screen)) ?? null,
  home: HOME,
  size: (m) => (m.sizeBytes ? bytes(m.sizeBytes) : '—'),
  date: (m) => fmtDate(m.createdAt),
  slot,

  /* screens */
  assign(screenIds, content, { quiet = false } = {}) {
    const ids = [].concat(screenIds);
    const title = content.kind === 'media'
      ? state.media.find((m) => m.id === content.id)?.name
      : state.experiences.find((e) => e.id === content.id)?.title;
    for (const id of ids) { const s = screenById(id); if (s) { s.content = { ...content }; s.blanked = false; s.queue = null; } }
    const sound = content.kind === 'media' && giveSound(ids, content.id);
    const names = ids.length === state.screens.length ? 'all screens' : ids.map(screenLabel).join(', ');
    // All four of Zone 02's screens in one push (whatever else it reached too).
    const walls = state.screens.filter((s) => s.zone === HOME).map((s) => s.id);
    commit({ icon: 'Send', text: `Pushed “${title}” to ${names}` }, walls.length > 1 && walls.every((id) => ids.includes(id)) ? 'publish-all' : 'assign');
    channel.post({ type: 'pushed', ids });
    if (sound) channel.post({ type: 'event', name: 'video-sound' });
    if (!quiet) toast(`Live on ${names}`);
  },
  /** A set of media, played on one screen in order; Next / Previous on its control page. */
  assignQueue(screenId, mediaIds) {
    const s = screenById(screenId);
    s.content = { kind: 'media', id: mediaIds[0] };
    s.queue = { ids: [...mediaIds], index: 0 };
    s.blanked = false;
    const sound = giveSound([screenId], mediaIds[0]);
    commit({ icon: 'Layers', text: `Queued ${mediaIds.length} items on ${screenLabel(screenId)}` }, 'assign');
    channel.post({ type: 'pushed', ids: [screenId] });
    if (sound) channel.post({ type: 'event', name: 'video-sound' });
    toast(`Queue live on ${screenLabel(screenId)}`);
  },
  queueStep(screenId, dir) {
    const s = screenById(screenId);
    if (!s?.queue) return;
    const n = s.queue.ids.length;
    s.queue.index = (s.queue.index + dir + n) % n;
    s.content = { kind: 'media', id: s.queue.ids[s.queue.index] };
    commit(null, 'assign');
  },
  idle(id) {
    const s = screenById(id);
    s.content = null;
    s.blanked = false;
    s.queue = null;
    commit({ icon: 'RotateCcw', text: `${s.name} back to idle` }, 'idle');
  },
  blank(id, on) {
    const s = screenById(id);
    s.blanked = on;
    commit({ icon: on ? 'Ban' : 'Play', text: `${s.name} ${on ? 'stopped' : 'resumed'}` }, on ? 'blank' : 'resume');
  },
  mute(id, muted) {
    screenById(id).muted = muted;
    if (!muted) { state.environment.audio.power = true; state.environment.audio.muted = false; }
    commit(null, 'env-audio');
  },
  video(id, action) {
    channel.post({ type: 'video', screenId: id, action });
    for (const [key, entry] of slots) if (key.endsWith(`:${id}`)) entry.mirror.command(action);
  },
  addScreen(id, name) {
    state.screens.push({ id, name, zone: null, content: null, blanked: false, muted: true, queue: null });
    commit({ icon: 'Plus', text: `Added screen ${name}` });
  },
  removeScreen(id) {
    const s = screenById(id);
    state.screens = state.screens.filter((x) => x.id !== id);
    commit({ icon: 'Trash2', text: `Removed screen ${s?.name ?? id}` });
  },
  rename(id, name) {
    const s = screenById(id);
    s.name = name.trim() || s.name;
    commit({ icon: 'Monitor', text: `Renamed a screen to ${s.name}` });
  },
  setFields(expId, fields) {
    const e = state.experiences.find((x) => x.id === expId);
    e.fields = { ...e.fields, ...fields };
    commit({ icon: 'SquarePen', text: `Edited “${e.title}”` }, 'edit');
  },

  /* media */
  addMedia(file) {
    const type = fileType(file);
    if (!type) { toast(`${file.name}: not a supported file`, 'err'); return; }
    const item = { id: uid('upload'), name: file.name, type, source: 'upload', url: URL.createObjectURL(file), sizeBytes: file.size, createdAt: new Date().toISOString(), upload: true };
    state.media = [item, ...state.media];
    commit({ icon: 'Upload', text: `Uploaded ${file.name}` }, 'upload');
    toast(`Uploaded ${file.name}`);
  },
  removeMedia(ids) {
    const gone = new Set([].concat(ids));
    const names = state.media.filter((m) => gone.has(m.id)).map((m) => m.name);
    state.media = state.media.filter((m) => !gone.has(m.id));
    state.deletedMedia = [...new Set([...(state.deletedMedia ?? []), ...[...gone].filter((id) => MEDIA.some((m) => m.id === id) || EMAIL_MEDIA.some((m) => m.id === id))])];
    for (const s of state.screens) {
      if (s.queue) {
        s.queue.ids = s.queue.ids.filter((id) => !gone.has(id));
        s.queue.index = Math.min(s.queue.index, Math.max(0, s.queue.ids.length - 1));
        if (!s.queue.ids.length) s.queue = null;
      }
      if (s.content?.kind === 'media' && gone.has(s.content.id)) s.content = s.queue ? { kind: 'media', id: s.queue.ids[s.queue.index] } : null;
    }
    commit({ icon: 'Trash2', text: names.length === 1 ? `Deleted ${names[0]}` : `Deleted ${names.length} files` });
  },
  /** "Load Email": the attachments that came in by email in the last 2 days. Returns how many were new. */
  loadEmail() {
    const fresh = EMAIL_MEDIA.filter((m) => !state.media.some((x) => x.id === m.id));
    if (!fresh.length) return 0;
    const now = Date.now();
    state.media = sortMedia([...fresh.map((m, i) => ({ ...m, createdAt: new Date(now - i * 60e3).toISOString() })), ...state.media]);
    state.deletedMedia = (state.deletedMedia ?? []).filter((id) => !fresh.some((m) => m.id === id));
    commit({ icon: 'Mail', text: `Loaded ${fresh.length} item${fresh.length === 1 ? '' : 's'} from email` }, 'upload');
    return fresh.length;
  },
  /** A pasted link (Browser): kept out of the library until it's saved. Returns its id. */
  addLink({ type, url, name }) {
    const item = { id: uid('link'), name, type, source: 'link', url, sizeBytes: 0, createdAt: new Date().toISOString(), pending: true };
    state.media = [item, ...state.media];
    return item.id;
  },
  saveLink(id) {
    const m = state.media.find((x) => x.id === id);
    if (!m) return;
    m.pending = false;
    commit({ icon: 'Link2', text: `Saved ${m.name} to the library` });
  },

  /* environment */
  env(mutate, { render: draw = true, event = null } = {}) {
    mutate(state.environment);
    commit(null, event, { render: draw });
  },
  /** by: 'user' when someone pressed it (the room turns to show the door), 'auto' for the relock. */
  setLocked(locked) {
    clearTimeout(relockTimer);
    state.environment.security = { ...state.environment.security, locked, by: 'user' };
    commit({ icon: locked ? 'Lock' : 'LockOpen', text: `Door ${locked ? 'locked' : 'unlocked'}` }, 'env-lock');
    if (!locked) relockTimer = setTimeout(() => { state.environment.security = { locked: true, by: 'auto' }; commit(null, null); }, AUTO_RELOCK_MS);
  },
  /** Flash fixtures one at a time, so a two-panel group can still be told apart. */
  identify(uuids) {
    uuids.forEach((uuid, i) => setTimeout(() => channel.post({ type: 'identify', uuids: [uuid] }), i * 4000));
  },

  /* whiteboards */
  saveBoard({ id, name, pages }) {
    const now = new Date().toISOString();
    const copy = structuredClone(pages);
    const existing = id && state.whiteboards.find((b) => b.id === id);
    if (existing) Object.assign(existing, { name, pages: copy, updatedAt: now });
    else { id = uid('wb'); state.whiteboards = [{ id, name, pages: copy, updatedAt: now }, ...state.whiteboards]; }
    commit({ icon: 'PenTool', text: `Saved whiteboard “${name}”` }, null, { render: false });
    return id;
  },
  deleteBoard(id) {
    const b = state.whiteboards.find((x) => x.id === id);
    state.whiteboards = state.whiteboards.filter((x) => x.id !== id);
    commit({ icon: 'Trash2', text: `Deleted whiteboard “${b?.name}”` });
  },
  startBoard(screenId, board, page) {
    const s = screenById(screenId);
    if (s.content?.kind !== 'whiteboard') s.boardPrev = s.content;
    s.content = { kind: 'whiteboard', id: board.id, title: board.name };
    s.blanked = false;
    s.queue = null;
    state.live = { ...state.live, [screenId]: structuredClone(page) };
    syncBoards(state);
    commit({ icon: 'PenTool', text: `Drawing live on ${screenLabel(screenId)}` }, 'whiteboard', { render: false });
    channel.post({ type: 'pushed', ids: [screenId] });
  },
  /** Mid-stroke: send the page to the screens without saving. */
  boardLive(screenId, page) {
    setBoard(screenId, page);
    channel.post({ type: 'board', screenId, page });
  },
  /** A stroke finished (or undo, clear, a new page): keep it, so a screen opened later shows it. */
  boardCommit(screenId, page) {
    state.live = { ...state.live, [screenId]: structuredClone(page) };
    setBoard(screenId, state.live[screenId]);
    commit(null, null, { render: false });
  },
  stopBoard(screenId) {
    const s = screenById(screenId);
    if (s?.content?.kind === 'whiteboard') { s.content = s.boardPrev ?? null; delete s.boardPrev; }
    const { [screenId]: _, ...rest } = state.live;
    state.live = rest;
    syncBoards(state);
    commit({ icon: 'PenTool', text: `Stopped drawing on ${s?.name}` }, null, { render: false });
  },

  /* visitors, settings */
  editVisitor(uuid, patch) {
    Object.assign(state.visitors.find((v) => v.uuid === uuid), patch);
    commit({ icon: 'ScanFace', text: `Updated visitor ${patch.name || 'Unknown'}` });
  },
  mergeVisitor(from, into) {
    const a = state.visitors.find((v) => v.uuid === from), b = state.visitors.find((v) => v.uuid === into);
    b.firstSeen = a.firstSeen < b.firstSeen ? a.firstSeen : b.firstSeen;
    b.lastSeen = a.lastSeen > b.lastSeen ? a.lastSeen : b.lastSeen;
    if (a.virtual) b.virtual = true;
    if (b.photo === null || b.photo === undefined) b.photo = a.photo;
    state.visitors = state.visitors.filter((v) => v.uuid !== from);
    commit({ icon: 'ScanFace', text: `Merged two visitor records into ${b.name || 'Unknown'}` });
  },
  setWelcomeArmed(on) {
    state.welcomeArmed = on;
    commit({ icon: 'ScanFace', text: `Welcome Trigger ${on ? 'armed' : 'disarmed'}` });
  },
  addType(name) {
    state.experienceTypes = [...state.experienceTypes, { id: uid('type'), name }];
    commit({ icon: 'Plus', text: `Added experience type ${name}` });
  },
  deleteType(id) {
    const t = state.experienceTypes.find((x) => x.id === id);
    state.experienceTypes = state.experienceTypes.filter((x) => x.id !== id);
    for (const e of state.experiences) e.tags = (e.tags ?? []).filter((x) => x !== t?.name);
    commit({ icon: 'Trash2', text: `Deleted experience type ${t?.name}` });
  },
  reset() {
    clearSaved();
    for (const m of state.media) if (m.url.startsWith('blob:')) URL.revokeObjectURL(m.url);
    state = seedState();
    syncBoards(state);
    commit({ icon: 'RotateCcw', text: 'Demo reset' });
  },
};

/* ---------------------------------------------------------------- mirrors */

// Mirrors are kept between renders, keyed by what they show, and moved into each new
// page: a video keeps playing instead of restarting every time the page re-renders.
const slots = new Map();
let wanted = [];

function slot(key, r, opts = {}) {
  wanted.push([key, r, opts]);
  return `<div data-slot="${esc(key)}"></div>`;
}

function fillSlots(root) {
  const used = new Set();
  for (const [key, r, opts] of wanted) {
    const ph = root.querySelector(`[data-slot="${CSS.escape(key)}"]`);
    if (!ph) continue;
    let entry = slots.get(key);
    if (!entry) {
      const el = document.createElement('div');
      entry = { el, mirror: new Mirror(el, opts) };
      slots.set(key, entry);
    }
    ph.replaceWith(entry.el);
    entry.mirror.show(r);
    used.add(key);
  }
  wanted = [];
  for (const [key, entry] of slots) if (!used.has(key)) { entry.mirror.destroy(); slots.delete(key); }
}

/* ---------------------------------------------------------------- shell */

const GUEST_KEY = 'cms_guest_mode';
let guest = (() => { try { return localStorage.getItem(GUEST_KEY) === '1'; } catch { return false; } })();
const navItems = () => NAV.filter((n) => !n.hidden && (!guest || n.guest));

// Day / dark mode, as the real Nex's user menu switches it (next-themes, saved as "theme").
const THEME_KEY = 'theme';
let theme = (() => { try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } })();
const applyTheme = () => document.documentElement.classList.toggle('light', theme === 'light');
applyTheme();

const root = document.getElementById('app');
root.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="sb-logo"><img src="/drava-world/cms/logo.svg" alt="White Tusker"><span class="mark"></span></div>
      <div class="sb-group">Navigation</div>
      <nav class="sb-nav"></nav>
      <div class="sb-foot">
        <button class="sb-user" data-act="user"><div class="avatar">${USER.name.slice(0, 2).toUpperCase()}</div>
          <div class="sb-user-text"><b>${esc(USER.name)}</b><span>${esc(USER.email)}</span></div>${icon('ChevronsUpDown', 'ico sm sb-chev')}</button>
      </div>
    </aside>
    <div class="inset">
      <header class="topbar">
        <button class="icon-btn" data-act="toggle" aria-label="Toggle sidebar">${icon('PanelLeft')}</button>
        <div class="vsep"></div>
        <div class="crumbs"></div>
      </header>
      <main class="main"></main>
      <div class="aud-dock" hidden></div>
    </div>
    <div class="fab"><div class="fab-items"></div><button class="fab-main" data-act="fab" aria-label="Open Actions">${icon('Plus')}</button></div>
  </div>`;

const shell = root.querySelector('.shell');
const main = root.querySelector('.main');
const fab = root.querySelector('.fab');
const dock = root.querySelector('.aud-dock');

root.querySelector('.sb-nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-path]');
  if (b) app.go(b.dataset.path);
});
root.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'toggle') shell.classList.toggle('collapsed');
  if (act === 'user') userMenu(e.target.closest('[data-act]'));
  if (act === 'fab') fab.classList.toggle('open');
  if (act === 'fab-draw') { fab.classList.remove('open'); drawFromFab(app); }
  if (act === 'fab-browse') { fab.classList.remove('open'); app.go('/browser'); }
  if (act?.startsWith('aud-')) audioAction(act, e.target.closest('[data-act]'));
});

/* ---------------------------------------------------------------- audio dock */

// Whenever a video plays on a screen, a "Now playing" bar under the page gives its
// sound: which screen plays it aloud, the room's master volume and mute (the same values as
// Environment → Audio).
function renderDock(hide = false) {
  const playing = videoScreens().filter((s) => !s.blanked);
  const show = playing.length > 0 && !hide;
  dock.hidden = !show;
  document.body.classList.toggle('has-dock', show && !dockMin);
  if (!show) return;
  const a = state.environment.audio;
  const off = !a.power || a.muted;
  const loud = playing.filter((s) => !s.muted);
  const now = loud[0] ?? playing[0];
  const title = state.media.find((m) => m.id === now.content.id)?.name ?? 'Video';
  const quiet = off || !loud.length;
  dock.classList.toggle('min', dockMin);
  dock.innerHTML = dockMin
    ? `<button class="ad-fab ${quiet ? '' : 'live'}" data-act="aud-open" title="Sound" aria-label="Show sound controls">${icon(quiet ? 'VolumeX' : 'Volume2')}</button>`
    : `<span class="ad-ico ${quiet ? '' : 'live'}">${icon(quiet ? 'VolumeX' : 'Volume2')}</span>
      <div class="ad-now"><small>Now playing</small><b class="trunc" title="${esc(title)}">${esc(title)}</b></div>
      <div class="ad-src" role="group" aria-label="Sound from">${playing.map((s) => `<button class="ad-chip ${s.muted ? '' : 'on'}" data-act="aud-src" data-id="${esc(s.id)}" title="${s.muted ? 'Play the sound on' : 'Silence'} ${esc(s.name)}">${icon(s.muted ? 'VolumeX' : 'Volume2', 'ico sm')}${esc(s.name.replace(/ wall$/i, ''))}</button>`).join('')}</div>
      <div class="ad-vol"><button class="ad-btn" data-act="aud-vol" data-d="-1" aria-label="Volume down">${icon('Minus', 'ico sm')}</button>
        <div class="ad-bar"><i style="width:${off ? 0 : a.volume}%"></i></div><b class="ad-num">${off ? 'Mute' : `${a.volume}%`}</b>
        <button class="ad-btn" data-act="aud-vol" data-d="1" aria-label="Volume up">${icon('Plus', 'ico sm')}</button></div>
      <button class="ad-mute ${off ? 'on' : ''}" data-act="aud-mute">${icon(off ? 'VolumeX' : 'Volume2', 'ico sm')}${off ? 'Unmute' : 'Mute'}</button>
      <button class="ad-btn ghost" data-act="aud-min" title="Hide" aria-label="Hide sound controls">${icon('ChevronDown', 'ico sm')}</button>`;
}

function audioAction(act, el) {
  const a = state.environment.audio;
  if (act === 'aud-min' || act === 'aud-open') { dockMin = act === 'aud-min'; renderDock(); return; }
  if (act === 'aud-src') {
    const s = screenById(el.dataset.id);
    if (s) app.mute(s.id, !s.muted);
    return;
  }
  app.env(() => {
    a.power = true;
    if (act === 'aud-mute') a.muted = !a.muted;
    if (act === 'aud-vol') {
      a.volume = Math.max(0, Math.min(100, (a.muted ? 0 : a.volume) + Number(el.dataset.d) * DOCK_STEP));
      a.muted = a.volume === 0;
    }
  }, { event: 'env-audio' });
}
fab.querySelector('.fab-items').innerHTML = `
  <button class="fab-item" data-act="fab-draw"><span>Draw</span><i>${icon('PenTool')}</i></button>
  <button class="fab-item" data-act="fab-browse"><span>Browse URL</span><i>${icon('Globe')}</i></button>`;
addEventListener('pointerdown', (e) => { if (!fab.contains(e.target)) fab.classList.remove('open'); });

function userMenu(anchor) {
  dropdown(anchor, `<div class="dd-user"><div class="avatar">${USER.name.slice(0, 2).toUpperCase()}</div><div class="sb-user-text"><b>${esc(USER.name)}</b><span>${esc(USER.email)}</span></div></div>
    <hr><button data-m="docs">${icon('BookOpen')} Docs</button>
    <button data-m="guest">${icon('UserCog')} ${guest ? 'Switch to Full Mode' : 'Switch to Guest Mode'}</button>
    <button data-m="theme">${icon(theme === 'light' ? 'Moon' : 'Sun')} ${theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Day Mode'}</button>
    <hr><button data-m="logout">${icon('LogOut')} Log out</button>`, {
    width: 224,
    onMount(el, close) {
      el.addEventListener('click', (e) => {
        const m = e.target.closest('[data-m]')?.dataset.m;
        if (!m) return;
        close();
        if (m === 'guest') {
          guest = !guest;
          try { localStorage.setItem(GUEST_KEY, guest ? '1' : '0'); } catch { /* private mode */ }
          toast(guest ? 'Guest mode: only the pages a visitor may use' : 'Full mode');
          render();
        }
        if (m === 'theme') {
          theme = theme === 'light' ? 'dark' : 'light';
          try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
          applyTheme();
          render();
        }
        if (m === 'docs') toast('The Nex docs live with the live Nex, at /docs');
        if (m === 'logout') toast('The kiosk stays signed in as Guest');
      });
    },
  });
}

// Docked beside the 3D room the Nex is narrow: fold the sidebar to icons, as the real one does.
const fold = () => shell.classList.toggle('collapsed', innerWidth < 900);
addEventListener('resize', () => { fold(); if (location.hash.startsWith('#/environment')) render(); });
fold();

function route() {
  const path = (location.hash.replace(/^#/, '') || '/').replace(/\/+$/, '') || '/';
  let r;
  let m = path.match(/^\/screens\/(.+)$/);
  if (m) r = { nav: NAV.find((n) => n.path === '/screens'), params: { id: decodeURIComponent(m[1]) }, render: renderScreenControl };
  else if ((m = path.match(/^\/whiteboards\/(.+)$/))) r = { nav: NAV.find((n) => n.path === '/whiteboards'), params: { id: decodeURIComponent(m[1]) }, render: renderBoard };
  else if (path === '/browser') r = { nav: BROWSER, params: {}, render: renderBrowser };
  else { const nav = NAV.find((n) => n.path === path) ?? NAV[0]; r = { nav, params: {}, render: nav.render }; }
  // Guest mode keeps to its pages, as the real Nex redirects.
  if (guest && !r.nav.guest) { const home = navItems()[0]; r = { nav: home, params: {}, render: home.render, redirect: home.path }; }
  return r;
}

function renderChrome(r) {
  root.querySelector('.sb-nav').innerHTML = navItems().map((n) => `<button class="sb-item ${n.path === r.nav.path ? 'active' : ''}" data-path="${n.path}" title="${n.title}">${icon(n.icon)}<span class="sb-label">${n.title}</span></button>`).join('');
  const parts = [['Dashboard', '/']];
  if (r.nav.path !== '/') parts.push([r.nav.title, r.nav.path]);
  if (r.params.id) {
    const name = r.render === renderBoard
      ? (r.params.id === 'new' ? 'New' : state.whiteboards.find((b) => b.id === r.params.id)?.name ?? r.params.id)
      : screenById(r.params.id)?.name ?? r.params.id;
    parts.push([name, null]);
  }
  root.querySelector('.crumbs').innerHTML = parts
    .map(([text, path], i) => (i === parts.length - 1 ? `<span class="cur">${esc(text)}</span>` : `<a href="#${path}">${esc(text)}</a>`))
    .join(`<span>${icon('ChevronRight', 'ico sm')}</span>`);
  fab.hidden = r.render === renderBoard;
  renderDock(r.render === renderBoard);
}

let lastPath = null;
function render() {
  const r = route();
  if (r.redirect && location.hash !== `#${r.redirect}`) { history.replaceState(null, '', `#${r.redirect}`); }
  renderChrome(r);

  // A page that asks to be kept (the whiteboard) isn't rebuilt while it stays open.
  const current = main.firstElementChild;
  if (lastPath === location.hash && current?.keep) { current.update?.(); return; }

  // Keep scroll positions, and the focused field, across the rebuild.
  const same = lastPath === location.hash;
  const keepScroll = same ? main.scrollTop : 0;
  const inner = same ? Object.fromEntries([...main.querySelectorAll('[data-keep-scroll]')].map((el) => [el.dataset.keepScroll, el.scrollTop])) : {};
  const focus = same && document.activeElement?.name && main.contains(document.activeElement)
    ? { name: document.activeElement.name, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;

  current?.stop?.();
  const page = r.render(app, r.params);
  main.replaceChildren(page);
  fillSlots(page);
  main.scrollTop = keepScroll;
  for (const el of main.querySelectorAll('[data-keep-scroll]')) if (inner[el.dataset.keepScroll]) el.scrollTop = inner[el.dataset.keepScroll];
  if (focus) {
    const el = main.querySelector(`[name="${CSS.escape(focus.name)}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(focus.start, focus.end); } catch { /* not a text field */ } }
  }
  lastPath = location.hash;
}

addEventListener('hashchange', render);
render();

// Tell any screen already open what to show, and ask any Nex page already open for its
// state (it holds this visit's uploads, which aren't saved). Untagged, so other Nex pages
// don't take this page's copy over their own.
channel.post({ type: 'state', state });
channel.post({ type: 'hello' });
