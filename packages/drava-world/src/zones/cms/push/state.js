// The Grid's state (a replica of White Tusker's "Push", on the kiosk in Zone 02
// when its switch is on Grid) and its live link to the screens: Zone 02's four
// screens and any /push/display.html tab.
//
// Like the Nex replica (../shared/state.js): the console owns the state, saves it in the browser
// and sends it over a BroadcastChannel. The real Push stores it on its server and talks to its
// paired displays over a WebSocket.
//
// Messages on the channel ({ type, ... }):
//   state        console → all       the whole state, after every change
//   hello        screen → console    a screen has opened ({ ids, display }); the console answers with the state
//   online       screen → console    heartbeat every 2 s with the screen ids it is showing
//   video        console → screen    { screenId, action: play | pause | seek | mute | unmute | volume, value }
//   video-state  screen → console    { screenId, playing, time, duration, muted, volume } of the video it plays
//   pair         display → console   { code }: a display typed a pairing code
//   paired       console → display   { code, screenId } or { code, error }
//   event        console → room      something worth a word from TRAVIS ({ name, ids })

import { MEDIA, RETIRED_MEDIA, SCREENS as EMS_SCREENS, SCREEN_ZONES } from '../shared/seed.js';
import { mediaContent } from '../shared/state.js';

const KEY = 'vec-push-state';
const CHANNEL = 'vec-push';

// The canvas's screens, all paired from the start: Zone 02's three screens (its own ids for them,
// in the same order as the Nex's), and the screens of the zones further on, the same ones the
// Nex runs (ScreensZone shows whichever pushed to it last).
export const WALLS = ['cms-left', 'cms-centre', 'cms-right'];
export const SCREENS = [
  { id: 'cms-left', name: 'Left wall', zone: 'cms' },
  { id: 'cms-centre', name: 'Centre wall', zone: 'cms' },
  { id: 'cms-right', name: 'Right wall', zone: 'cms' },
  ...EMS_SCREENS.filter((s) => s.zone !== 'cms').map(({ id, name, zone }) => ({ id, name, zone })),
];
// The zones, and the screens each puts on the canvas's edges (the zone switcher, and a group each).
export const ZONES = SCREEN_ZONES;
const zoneScreens = (z) => SCREENS.filter((s) => s.zone === z).map((s) => s.id);
export const ZONE_EDGES = Object.fromEntries(ZONES.map((z) => {
  const ids = zoneScreens(z.id);
  // Three screens, listed left to right (Zone 02's front wall): the middle one at the top, the
  // others either side. Any other number (a floor's one screen): shared out in order.
  if (ids.length === 3) return [z.id, { top: [ids[1]], left: [ids[0]], right: [ids[2]] }];
  const n = Math.ceil(ids.length / 3);
  return [z.id, { top: ids.slice(0, n), left: ids.slice(n, 2 * n), right: ids.slice(2 * n) }];
}));

// The canvas's three edges; a screen's parts on an edge are "id#zone".
export const EDGES = ['top', 'left', 'right'];
export const EDGE_LABELS = { top: 'Top', left: 'Left', right: 'Right' };
export const MAX_ON_EDGE = 6;
export const part = (id, zone) => `${id}#${zone}`;
export const baseId = (entry) => entry.split('#')[0];
export const zoneOf = (entry) => entry.split('#')[1];
// How content slides onto a screen pushed from each edge (Push's "enter").
export const ENTER = { top: 'up', left: 'left', right: 'right' };

// Push's screen layouts: each part shows its own media.
export const LAYOUTS = {
  single: { id: 'single', label: 'Full screen', columns: '1fr', rows: '1fr', zones: [{ id: 'main', label: 'Full', area: '1 / 1 / 2 / 2' }] },
  'split-2-eq': { id: 'split-2-eq', label: 'Two equal', columns: '1fr 1fr', rows: '1fr', zones: [
    { id: 'left', label: 'Left', area: '1 / 1 / 2 / 2' }, { id: 'right', label: 'Right', area: '1 / 2 / 2 / 3' }] },
  'split-2-wide': { id: 'split-2-wide', label: 'Wide + narrow', columns: '65fr 35fr', rows: '1fr', zones: [
    { id: 'main', label: 'Wide', area: '1 / 1 / 2 / 2' }, { id: 'side', label: 'Narrow', area: '1 / 2 / 2 / 3' }] },
  'split-3-tall': { id: 'split-3-tall', label: 'One + two stacked', columns: '1fr 1fr', rows: '1fr 1fr', zones: [
    { id: 'left', label: 'Left', area: '1 / 1 / 3 / 2' }, { id: 'right-top', label: 'Top right', area: '1 / 2 / 2 / 3' },
    { id: 'right-bottom', label: 'Bottom right', area: '2 / 2 / 3 / 3' }] },
  'grid-4': { id: 'grid-4', label: 'Four grid', columns: '1fr 1fr', rows: '1fr 1fr', zones: [
    { id: 'top-left', label: '1', area: '1 / 1 / 2 / 2' }, { id: 'top-right', label: '2', area: '1 / 2 / 2 / 3' },
    { id: 'bottom-left', label: '3', area: '2 / 1 / 3 / 2' }, { id: 'bottom-right', label: '4', area: '2 / 2 / 3 / 3' }] },
};
export const layoutOf = (id) => LAYOUTS[id] ?? LAYOUTS.single;

// The pairing code's letters (no 0/O, 1/I/L, U).
export const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIR_MS = 10 * 60e3;

// The media Push can show (images, video, PDF, XLSX/CSV, PPTX, DOCX, links).
const PUSHABLE = ['image', 'video', 'document', 'sheet', 'presentation', 'word', 'link'];
export const MAILBOX = 'push@thewhitetusker.com';

export const USER = { name: 'Guest', email: 'guest@thewhitetusker.com', role: 'ADMIN', accountCode: 'AC-7K2Q9', workspace: { code: 'WS-4XH8P2', name: 'White Tusker', plan: 'active' } };

export function seedPush() {
  const now = new Date().toISOString();
  return {
    version: 5,
    screens: SCREENS.map((s) => ({ ...s, paired: true, pairedAt: now, layout: 'single', mediaId: null, zoneMedia: {}, blanked: false, muted: true, enter: 'up', createdAt: now })),
    slots: structuredClone(ZONE_EDGES.cms),
    links: [],                       // sets of screen ids: a push to one shows on all
    groups: ZONES.map((z) => ({ id: `grp-${z.id}`, name: z.id === 'cms' ? 'Zone 02 screens' : `${z.title}`, zone: z.id, layout: structuredClone(ZONE_EDGES[z.id]) })),
    media: MEDIA.filter((m) => PUSHABLE.includes(m.type)).map((m) => ({ ...m })),
    items: [],                       // canvas cards: { id, mediaId, x, y, w, h, liveOn }
    ink: { canvas: [], cards: {} },  // pen notes: on the canvas (canvas units), on a card (0..1 of its picture)
    share: [],                       // screens showing the canvas itself
    shareView: { cx: 0, cy: 0, w: 1920, h: 1080 },   // the part of the canvas they show
    pairing: null,                   // { code, screenId, expiresAt }
    imports: [],                     // email loads: { at, subject, added }
    view: null,
  };
}

export function loadPush() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.version === 5) {   // 5: the floors, one screen each (4 had the Multi-Zone Screens' six)
      const seed = seedPush();
      const media = [...(saved.media ?? []).filter((m) => !m.url.startsWith('blob:') && !RETIRED_MEDIA.includes(m.id))];
      for (const m of seed.media) if (!media.some((x) => x.id === m.id) && !(saved.deletedMedia ?? []).includes(m.id)) media.push(m);
      const has = (id) => media.some((m) => m.id === id);
      const screens = [
        ...seed.screens.map((s) => ({ ...s, ...(saved.screens?.find((x) => x.id === s.id) ?? {}), zone: s.zone })),   // the zone is the seed's
        // Screens added here (no zone) stay; a zone's screens all come from the seed, so one it no longer has goes.
        ...(saved.screens ?? []).filter((s) => !seed.screens.some((x) => x.id === s.id) && !s.zone),
      ].map((s) => ({
        ...s,
        mediaId: s.mediaId && has(s.mediaId) ? s.mediaId : null,
        zoneMedia: Object.fromEntries(Object.entries(s.zoneMedia ?? {}).filter(([, id]) => has(id))),
      }));
      // Anything pointing at a screen that is gone lets go of it.
      const live = (id) => screens.some((s) => s.id === id);
      const keepIds = (list) => list.filter((id) => live(baseId(id)));
      const slots = Object.fromEntries(EDGES.map((e) => [e, (saved.slots?.[e] ?? seed.slots[e]).map((x) => (x && !live(baseId(x)) ? null : x))]));
      // Each zone's group is always there (saved ones keep their edits); a group of a zone that has gone doesn't.
      const groups = [...seed.groups.map((g) => saved.groups?.find((x) => x.id === g.id) ?? g),
        ...(saved.groups ?? []).filter((g) => g.id !== 'grp-wall' && !seed.groups.some((x) => x.id === g.id) && (!g.zone || ZONES.some((z) => z.id === g.zone)))]
        .map((g) => ({ ...g, layout: Object.fromEntries(EDGES.map((e) => [e, keepIds(g.layout?.[e] ?? [])])) }));
      return {
        ...seed, ...saved, media, screens, groups, slots,
        links: (saved.links ?? []).map(keepIds).filter((l) => l.length > 1),
        share: keepIds(saved.share ?? []),
        items: (saved.items ?? []).filter((i) => has(i.mediaId)).map((i) => (i.liveOn && !live(i.liveOn) ? { ...i, liveOn: null } : i)),
      };
    }
  } catch { /* storage blocked or corrupt: start fresh */ }
  return seedPush();
}

export function savePush(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, media: state.media.filter((m) => !m.url.startsWith('blob:')) }));
  } catch { /* storage full or blocked: the demo still works for this visit */ }
}

export function clearPush() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The card on the canvas that put this media on this screen, if it has pen notes. */
const inkedCard = (state, id, mediaId) => state.items.find((i) => i.liveOn === id && i.mediaId === mediaId && state.ink.cards[i.id]?.length);

/**
 * What a screen shows, as the renderers want it (../shared/render.js, WallDisplay, the display
 * page). A plain image or video is a texture; a shared canvas, a split screen or a picture with
 * pen notes is drawn (push-* kinds, board.js).
 */
export function resolvePush(state, id) {
  const s = state.screens.find((x) => x.id === id);
  if (!s) return { kind: 'idle', screenId: id };
  if (s.blanked) return { kind: 'blank', screenId: id };
  if (state.share.includes(id)) return { kind: 'push-board', screenId: id };
  if (s.layout && s.layout !== 'single') return { kind: 'push-split', screenId: `${id}:${s.layout}` };
  const m = s.mediaId && state.media.find((x) => x.id === s.mediaId);
  if (!m) return { kind: 'idle', screenId: id };
  const card = inkedCard(state, id, m.id);
  if (card) return { kind: 'push-ink', screenId: `${id}:${card.id}` };
  return mediaContent(m, s);
}

/** "scr_" and 16 hex digits, as Push's screen ids. */
export const newScreenId = () => `scr_${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

export function openPushChannel(onMessage) {
  if (typeof BroadcastChannel === 'undefined') return { post() {}, close() {} };
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e) => onMessage(e.data);
  return { post: (msg) => ch.postMessage(msg), close: () => ch.close() };
}

