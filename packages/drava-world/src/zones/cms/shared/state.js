// The Nex replica's state and the live link between the Nex and its screens.
//
// The real Nex writes Postgres and pushes CONTENT_UPDATE to each display over a WebSocket.
// Here the Nex page owns the state, saves it in the browser (localStorage) and pushes it
// over a BroadcastChannel, which reaches every page of this site open in the browser: the
// kiosk's Nex, the three walls in the 3D room, and any /cms/display.html tab.
//
// Messages on the channel ({ type, ... }):
//   state     Nex → all        the whole state, after every change
//   hello     screen → Nex      a screen has opened; the Nex answers with the state
//   online    screen → Nex      heartbeat every 2 s with the screen ids it is showing
//   video     Nex → screen      play / pause / restart the video on one screen
//   board     Nex → screens     the whiteboard page being drawn live on a screen, as it changes
//   identify  Nex → room        flash these light fixtures (Environment → Identify)
//   event     Nex → room        something worth a word from TRAVIS (assign, env-light, …)
//   pushed    Nex → room        content just went to these screens ({ ids }); Zone 02 shows a
//                               screen in another zone live (LiveView)

import { RETIRED_MEDIA, seedState, seedEnvironment } from './seed.js';

const KEY = 'vec-cms-state';
const CHANNEL = 'vec-cms';

export function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.version === 1) return merge(saved);
  } catch { /* storage blocked or corrupt: start fresh */ }
  return seedState();
}

/** Keep what the visitor saved, but make sure the seed's screens, experiences and media exist. */
function merge(saved) {
  const seed = seedState();
  // The seed's screens (every zone's) always exist, in its zones; screens added in the Nex are kept after them.
  const screens = [
    ...seed.screens.map((s) => ({ ...s, ...(saved.screens?.find((x) => x.id === s.id) ?? {}), zone: s.zone })),
    // Screens added in the Nex (no zone) stay; a zone's screens all come from the seed, so one it no longer has goes.
    ...(saved.screens ?? []).filter((s) => !seed.screens.some((x) => x.id === s.id) && !s.zone),
  ];
  const experiences = seed.experiences.map((e) => {
    const s = saved.experiences?.find((x) => x.id === e.id);
    return { ...e, ...(s?.fields ? { fields: { ...e.fields, ...s.fields } } : {}), ...(s?.tags ? { tags: s.tags } : {}) };
  });
  const deleted = new Set(saved.deletedMedia ?? []);
  const media = [
    ...(saved.media ?? []).filter((m) => !seed.media.some((x) => x.id === m.id) && !RETIRED_MEDIA.includes(m.id)),
    ...seed.media.filter((m) => !deleted.has(m.id)),
  ];
  const env = seedEnvironment();
  const se = saved.environment ?? {};
  const environment = {
    ...env,
    ...se,
    climate: { ...env.climate, ...se.climate },
    audio: { ...env.audio, ...se.audio },
    security: { ...env.security, ...se.security },
    lights: env.lights.map((l) => ({ ...l, ...(se.lights?.find((x) => x.uuid === l.uuid) ?? {}) })),
    ambientModes: env.ambientModes.map((m) => ({ ...m, ...(se.ambientModes?.find((x) => x.key === m.key) ?? {}) })),
  };
  const state = {
    ...seed,
    screens,
    experiences,
    media: sortMedia(media),
    deletedMedia: [...deleted],
    activity: saved.activity ?? [],
    environment,
    visitors: saved.visitors ?? seed.visitors,
    whiteboards: saved.whiteboards ?? seed.whiteboards,
    experienceTypes: saved.experienceTypes ?? seed.experienceTypes,
    welcomeArmed: saved.welcomeArmed ?? false,
    emailLoaded: saved.emailLoaded ?? false,
    live: saved.live ?? {},
  };
  for (const s of state.screens) if (s.content && !contentExists(state, s.content)) { s.content = null; s.queue = null; }
  return state;
}

export const sortMedia = (list) => [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

export function saveState(state) {
  try {
    // Uploaded files live only as blob: URLs in this browser session, so they aren't saved.
    const media = state.media.filter((m) => !m.url.startsWith('blob:'));
    const kept = { ...state, media };
    kept.screens = state.screens.map((s) => (s.content && !contentExists(kept, s.content) ? { ...s, content: null, queue: null } : s));
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch { /* storage full or blocked: the demo still works for this visit */ }
}

export function clearSaved() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

function contentExists(state, content) {
  if (content.kind === 'media') return state.media.some((m) => m.id === content.id);
  if (content.kind === 'experience') return state.experiences.some((e) => e.id === content.id);
  if (content.kind === 'whiteboard') return true;
  return false;
}

/** A media asset as renderers want it. */
export const mediaContent = (m, screen = null) => ({
  kind: 'media', screenId: screen?.id ?? '', id: m.id, type: m.type, url: m.url, title: m.name, muted: screen?.muted ?? true,
});

/** An experience as renderers want it. */
export const experienceContent = (e, screenId = '') => ({
  kind: 'experience', screenId, id: e.id, template: e.template, title: e.title, n: e.n, fields: e.fields ?? {},
});

/** What a screen should show right now, with everything a renderer needs. */
export function resolveContent(state, screen) {
  if (!screen) return { kind: 'idle', screenId: '' };
  if (screen.blanked) return { kind: 'blank', screenId: screen.id };
  const c = screen.content;
  if (c?.kind === 'media') {
    const m = state.media.find((x) => x.id === c.id);
    if (m) {
      const r = mediaContent(m, screen);
      if (screen.queue?.ids?.length > 1) r.queue = { index: screen.queue.index, count: screen.queue.ids.length };
      return r;
    }
  }
  if (c?.kind === 'experience') {
    const e = state.experiences.find((x) => x.id === c.id);
    if (e) return experienceContent(e, screen.id);
  }
  if (c?.kind === 'whiteboard') {
    return { kind: 'whiteboard', screenId: screen.id, id: c.id, title: c.title ?? 'Whiteboard', page: state.live?.[screen.id] ?? { surface: 'light', strokes: [] } };
  }
  return { kind: 'idle', screenId: screen.id };
}

/** A label for what a screen is showing, or null when nothing is assigned. */
export function contentLabel(state, screen) {
  const r = resolveContent(state, { ...screen, blanked: false });
  if (r.kind === 'whiteboard') return `Whiteboard · ${r.title}`;
  if (r.kind === 'media' && r.queue) return `${r.title} (${r.queue.index + 1} of ${r.queue.count})`;
  return r.kind === 'media' || r.kind === 'experience' ? r.title : null;
}

/** Same key for the same picture: renderers skip work when nothing visible changed. */
export function contentKey(r) {
  if (r.kind === 'experience') return `exp:${r.id}:${JSON.stringify(r.fields)}`;
  if (r.kind === 'media') return `media:${r.id}`;
  if (r.kind === 'whiteboard') return `wb:${r.screenId}:${r.id}`;   // drawn every frame from the live page
  return `${r.kind}:${r.screenId}`;
}

export function openChannel(onMessage) {
  if (typeof BroadcastChannel === 'undefined') return { post() {}, close() {} };
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e) => onMessage(e.data);
  return { post: (msg) => ch.postMessage(msg), close: () => ch.close() };
}
