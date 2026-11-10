// Screens: the real Nex's screens controller (screens/_components/screens-controller.tsx):
// a card per screen with a live mirror, Control / Assign / Idle, and a menu with Copy
// display URL, Stop / Resume and Remove, grouped by the zone each screen is in. Plus the
// per-screen control page and the assignment picker (experiences or media).

import { SCREENS } from '../../shared/seed.js';
import { Mirror, dropdown, esc, h, icon, modal, toast } from '../ui.js';
import { zoneMap } from '../zonemap.js';

const isWall = (id) => SCREENS.some((s) => s.id === id);
export const displayUrl = (id) => `${location.origin}/cms/display.html?screen=${encodeURIComponent(id)}`;

/** A zone's heading: its number, title, and how many of its screens are live. */
export function zoneHead(app, z) {
  const live = z.screens.filter((s) => app.isOnline(s.id)).length;
  return `<h2 class="zn-head"><span class="zn-n">${esc(z.n)}</span>${esc(z.title)}
    <small>${z.screens.length} screen${z.screens.length === 1 ? '' : 's'} · ${live} live</small>${z.id === app.home ? '<span class="zn-tag">This room</span>' : ''}</h2>`;
}

/** A screen's card: its live mirror, status and what it shows, Control / Assign / Idle. shot: what clicking the picture does. */
export function screenCard(app, s, { shot = 'control' } = {}) {
  const online = app.isOnline(s.id);
  const label = app.label(s);
  const push = shot === 'assign';
  return `<div class="screen-card" data-id="${esc(s.id)}">
    <div style="position:relative">
      <button class="shot" data-act="${shot}" title="${push ? 'Push content to this screen' : 'Open control'}">${app.slot(`screen:${s.id}`, app.resolve(s))}
        <div class="hint"><span>${push ? `${icon('Send', 'ico sm')} Push here` : `${icon('SlidersHorizontal', 'ico sm')} Control`}</span></div></button>
      ${s.blanked ? '<span class="blanked-tag">Stopped</span>' : ''}
      <button class="kebab" data-act="menu" aria-label="Screen actions">${icon('EllipsisVertical')}</button>
    </div>
    <div class="body">
      <div class="name-row"><span class="name">${esc(s.name)}</span>
        <span class="live-badge ${online ? 'on' : ''}">${online ? 'Live' : 'Offline'}</span></div>
      <div class="what">${label ? esc(label) : 'No content assigned'}</div>
      <div class="btn-row">
        <button class="btn glass" data-act="control">Control</button>
        <button class="btn glass" data-act="assign">${label ? 'Change' : 'Assign'}</button>
        <button class="btn glass" data-act="idle" title="Clear the current assignment and fall back to the idle screen">Idle</button>
      </div>
    </div>
  </div>`;
}

/** What the buttons on the screenCard()s inside `page` do. */
export function wireCards(app, page) {
  page.querySelectorAll('.screen-card').forEach((card) => {
    const id = card.dataset.id;
    card.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'control') app.go(`/screens/${encodeURIComponent(id)}`);
      if (act === 'assign') openPicker(app, id);
      if (act === 'idle') app.idle(id);
      if (act === 'menu') { e.stopPropagation(); screenMenu(app, id, e.target.closest('[data-act]')); }
    });
  });
}

export function renderScreens(app) {
  const page = h(`<div class="page screens">
    <div class="toolbar">
      <button class="btn pill" data-act="publish">${icon('Send')} Drag &amp; Publish</button>
      <button class="btn pill solid" data-act="add">${icon('Plus')} Add Screen</button>
    </div>
    ${app.zones().map((z) => `<section class="zn-sec">${zoneHead(app, z)}
      <div class="screen-grid">${z.screens.map((s) => screenCard(app, s)).join('')}</div></section>`).join('')}
  </div>`);

  page.querySelector('[data-act="publish"]').addEventListener('click', () => app.go('/broadcast'));
  page.querySelector('[data-act="add"]').addEventListener('click', () => addScreen(app));
  wireCards(app, page);
  return page;
}

function screenMenu(app, id, anchor) {
  const s = app.state.screens.find((x) => x.id === id);
  const r = anchor.getBoundingClientRect();
  const menu = h(`<div class="menu" role="menu">
    <button data-m="copy">${icon('Copy')} Copy display URL</button>
    <button data-m="open">${icon('ExternalLink')} Open display</button>
    <button data-m="blank">${s.blanked ? icon('Play') : icon('Ban')} ${s.blanked ? 'Resume' : 'Stop'}</button>
    ${isWall(id) ? '' : `<button data-m="remove" class="danger">${icon('Trash2')} Remove screen</button>`}
  </div>`);
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, r.right - 208)}px`;
  document.body.append(menu);
  const close = () => { menu.remove(); removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  setTimeout(() => addEventListener('pointerdown', outside, true));
  menu.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    close();
    if (m === 'copy') { await copy(displayUrl(id)); toast('Display URL copied'); }
    if (m === 'open') open(displayUrl(id), '_blank');
    if (m === 'blank') app.blank(id, !s.blanked);
    if (m === 'remove' && confirm(`Remove "${s.name}"? This cannot be undone.`)) {
      app.removeScreen(id);
      toast(`${s.name} removed`);
    }
  });
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch { prompt('Copy the display URL:', text); }
}

function addScreen(app) {
  modal(`<div class="modal-head"><div><h2>Add screen</h2><p class="sub">A new display with its own URL. Open it on any TV or in another tab.</p></div>
      <button class="icon-btn" data-close aria-label="Close">${icon('X')}</button></div>
    <form class="stack">
      <label class="field">Screen name<input class="input" name="name" required placeholder="Lobby TV" autofocus></label>
      <label class="field">Screen ID<input class="input" name="id" required placeholder="lobby-tv" pattern="[a-z0-9-]+" title="lowercase letters, numbers and dashes"></label>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn solid">Add screen</button></div>
    </form>`, {
    onMount(el, close) {
      const f = el.querySelector('form');
      f.name.addEventListener('input', () => { f.id.value = f.name.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); });
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = f.id.value.trim();
        if (app.state.screens.some((s) => s.id === id)) { toast(`A screen called ${id} already exists`, 'err'); return; }
        app.addScreen(id, f.name.value.trim());
        close();
        toast(`${f.name.value.trim()} added`);
      });
    },
  });
}

/* ---------------------------------------------------------------- picker */

export function openPicker(app, screenId, { onDone } = {}) {
  const { state } = app;
  const s = state.screens.find((x) => x.id === screenId);
  let tab = 'experiences';
  const mirrors = [];
  modal(`<div class="modal-head"><div><h2>Assign to ${esc(app.screenLabel(screenId))}</h2>
      <p class="sub">Currently: ${esc(app.label(s) ?? 'Idle')}</p></div>
      <button class="icon-btn" data-close aria-label="Close">${icon('X')}</button></div>
    <div class="tabs"><button class="tab on" data-tab="experiences">Experiences</button><button class="tab" data-tab="media">Media</button></div>
    <div class="pick-grid"></div>`, {
    wide: true,
    onClose: () => mirrors.splice(0).forEach((m) => m.destroy()),
    onMount(el, close) {
      const grid = el.querySelector('.pick-grid');
      const draw = () => {
        mirrors.splice(0).forEach((m) => m.destroy());
        const items = tab === 'experiences'
          ? state.experiences.map((e) => ({ content: { kind: 'experience', id: e.id }, title: e.title, kind: `${e.template} · #${e.n}`, r: { kind: 'experience', id: e.id, template: e.template, title: e.title, n: e.n, fields: e.fields ?? {} } }))
          : state.media.filter((m) => !m.pending).map((m) => ({ content: { kind: 'media', id: m.id }, title: m.name, kind: m.type, r: { kind: 'media', id: m.id, type: m.type, url: m.url, title: m.name } }));
        grid.innerHTML = items.map((it, i) => `<button class="pick ${s.content?.id === it.content.id ? 'current' : ''}" data-i="${i}"><div class="thumb"><div></div></div><div class="t">${esc(it.title)}<br><span class="k">${esc(it.kind)}</span></div></button>`).join('');
        grid.querySelectorAll('.thumb > div').forEach((d, i) => { const m = new Mirror(d); m.show(items[i].r); mirrors.push(m); });
        grid.onclick = (e) => {
          const b = e.target.closest('[data-i]');
          if (!b) return;
          app.assign(screenId, items[b.dataset.i].content);
          done();
        };
      };
      const done = () => { close(); onDone?.(); };
      el.querySelector('.tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        tab = b.dataset.tab;
        el.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t === b));
        draw();
      });
      draw();
    },
  });
}

/* ---------------------------------------------------------------- control page */

export function renderScreenControl(app, { id }) {
  const { state } = app;
  const s = state.screens.find((x) => x.id === id);
  if (!s) return h(`<div class="page"><div class="empty">${icon('Monitor', 'ico lg')}<b>Screen not found</b><button class="btn" onclick="location.hash='#/screens'">Back to screens</button></div></div>`);
  const r = app.resolve(s);
  const label = app.label(s);
  const online = app.isOnline(id);
  const isVideo = r.kind === 'media' && r.type === 'video';
  const exp = s.content?.kind === 'experience' ? state.experiences.find((e) => e.id === s.content.id) : null;

  const page = h(`<div class="page">
    <div class="page-head"><div><button class="screen-switch" data-act="switch" aria-haspopup="menu" title="Switch screen"><h1>${esc(s.name)}</h1>${icon('ChevronDown', 'ico')}</button>
      <p>Control what this screen shows. Changes go live on the screen instantly.</p></div>
      <span class="badge"><i class="dot ${online ? 'on' : ''}"></i>${online ? 'Online' : 'Offline'}</span></div>
    <div class="control">
      <div class="stack">
        <div class="big">${app.slot(`big:${id}`, r)}</div>
        ${isVideo ? `<div class="row">
          <button class="btn" data-act="play">${icon('Play', 'ico sm')} Play</button>
          <button class="btn" data-act="pause">${icon('Pause', 'ico sm')} Pause</button>
          <button class="btn" data-act="restart">${icon('RotateCcw', 'ico sm')} Restart</button>
          <button class="btn" data-act="sound">${icon(s.muted ? 'VolumeX' : 'Volume2', 'ico sm')} ${s.muted ? 'Sound off' : 'Sound on'}</button>
        </div>` : ''}
        ${exp?.fields ? `<div class="card"><h3>Edit experience</h3><p class="desc">${esc(exp.title)} · changes show on every screen running it</p>
          <form class="stack" data-form="fields">
            ${Object.entries(exp.fields).map(([k, v]) => `<label class="field">${esc(k[0].toUpperCase() + k.slice(1))}<input class="input" name="${esc(k)}" value="${esc(v)}"></label>`).join('')}
            <div class="row" style="justify-content:flex-end"><button class="btn solid">${icon('Send', 'ico sm')} Save &amp; push</button></div>
          </form></div>` : ''}
      </div>
      <div class="stack">
        <div class="card">
          <h3>Now showing</h3><p class="desc">${s.blanked ? 'Stopped: the screen is black' : esc(label ?? 'Idle screen')}</p>
          ${s.queue ? `<div class="queue-nav"><button class="btn" data-act="q-prev">${icon('ChevronLeft', 'ico sm')} Previous</button>
            <span class="muted">${s.queue.index + 1} of ${s.queue.ids.length}</span>
            <button class="btn" data-act="q-next">Next ${icon('ChevronRight', 'ico sm')}</button></div>` : ''}
          <div class="btn-row two">
            <button class="btn solid" data-act="assign">${icon('Layers', 'ico sm')} ${label ? 'Change' : 'Assign'}</button>
            <button class="btn" data-act="idle">${icon('RotateCcw', 'ico sm')} Idle</button>
            <button class="btn ${s.blanked ? '' : 'danger'}" data-act="blank">${icon(s.blanked ? 'Play' : 'Ban', 'ico sm')} ${s.blanked ? 'Resume' : 'Stop'}</button>
            <button class="btn" data-act="open">${icon('ExternalLink', 'ico sm')} Open display</button>
          </div>
        </div>
        <div class="card zmap-card">
          <h3>Where it is</h3><p class="desc">${isWall(id) ? `${esc(s.name)} · ${esc(app.zoneOf(s)?.label)}. Tap another screen to control it.` : 'A display added from this Nex, outside the zones. Tap a screen to control it.'}</p>
          <div class="zmap">${zoneMap(app, id)}</div>
          <div class="zmap-legend"><span><i class="on"></i>This screen</span><span><i></i>Other screens</span><span><i class="kiosk"></i>Kiosk</span></div>
        </div>
      </div>
    </div>
  </div>`);

  const toScreen = (e) => {
    const to = e.target.closest('[data-screen]')?.dataset.screen;
    if (to && to !== id) app.go(`/screens/${encodeURIComponent(to)}`);
    return !!to;
  };
  page.querySelector('.zmap').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toScreen(e); } });
  page.addEventListener('click', async (e) => {
    if (toScreen(e)) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'switch') { switchScreen(app, id, e.target.closest('[data-act]')); return; }
    if (!act) return;
    if (act === 'assign') openPicker(app, id);
    if (act === 'idle') app.idle(id);
    if (act === 'blank') app.blank(id, !s.blanked);
    if (act === 'open') open(displayUrl(id), '_blank');
    if (act === 'copy') { await copy(displayUrl(id)); toast('Display URL copied'); }
    if (act === 'play' || act === 'pause' || act === 'restart') app.video(id, act);
    if (act === 'sound') app.mute(id, !s.muted);
    if (act === 'q-prev') app.queueStep(id, -1);
    if (act === 'q-next') app.queueStep(id, 1);
  });
  page.querySelector('[data-form="fields"]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    app.setFields(exp.id, Object.fromEntries(new FormData(e.target)));
    toast('Saved and pushed');
  });
  return page;
}

/** The screen switcher by the control page's title: every screen, its status and what it shows; pick one to control it. */
function switchScreen(app, current, anchor) {
  const { screens } = app.state;
  dropdown(anchor, screens.map((x) => `<button class="sw-item ${x.id === current ? 'on' : ''}" data-id="${esc(x.id)}">
      <i class="dot ${app.isOnline(x.id) ? 'on' : ''}"></i>
      <span class="sw-text"><b>${esc(app.screenLabel(x.id))}</b><small>${x.blanked ? 'Stopped' : esc(app.label(x) ?? 'Idle')}</small></span>
      ${x.id === current ? icon('Check', 'ico sm') : ''}</button>`).join(''), {
    width: 260,
    onMount(el, close) {
      el.addEventListener('click', (e) => {
        const id = e.target.closest('[data-id]')?.dataset.id;
        if (!id) return;
        close();
        if (id !== current) app.go(`/screens/${encodeURIComponent(id)}`);
      });
    },
  });
}
