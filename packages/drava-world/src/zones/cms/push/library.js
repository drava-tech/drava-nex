// Push's Library, along the foot of the console: a sidebar (Media, Templates, Screens; the
// account and the theme at its foot), a breadcrumb with the section's actions, and the section
// as a strip you scroll sideways. Collapses to one bar ("Show library · Media").
//  - Media: square thumbnails; drag one onto the canvas (a card) or a screen (shown there, and
//    a card for it); click to preview or delete. Source filter, Upload (with an uploads panel),
//    Load Email (and the mailbox's details), and the whole library in a sheet.
//  - Screens: groups and screens (status, layout, the edge they're on), each with its menu:
//    place on an edge, layout, pair a display (a code or a display link), rename, unpair,
//    delete. Add screen, New group. Down the right, the five layouts: drag one onto a screen.
//  - Templates: not in Push yet either.
// Every dialog of these lives here too.

import { bytes, dropdown, esc, h, icon, modal } from '../app/ui.js';
import { justDragged, mark, nearestEdge, startDrag } from './drag.js';
import { EDGES, EDGE_LABELS, LAYOUTS, MAILBOX, ZONES, baseId, layoutOf } from './state.js';

const SECTIONS = [
  { id: 'media', label: 'Media', icon: 'Image' },
  { id: 'templates', label: 'Templates', icon: 'LayoutTemplate' },
  { id: 'screens', label: 'Screens', icon: 'Monitor' },
];
const TYPE_ICON = { image: 'Image', video: 'Video', document: 'FileText', sheet: 'FileSpreadsheet', presentation: 'Presentation', word: 'FileText', link: 'Link' };
const TYPE_LABEL = { image: 'Image', video: 'Video', document: 'PDF', sheet: 'Spreadsheet', presentation: 'Slides', word: 'Document', link: 'Link' };
const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.avif,.mp4,.m4v,.webm,.ogg,.mov,.pdf,.xlsx,.csv,.pptx,.docx';
const COLLAPSED_KEY = 'bottom-panel:collapsed';
const NEW_MS = 5 * 60e3;
const STATUS = { queued: 'Waiting…', preparing: 'Preparing…', uploading: 'Uploading', saving: 'Saving…', done: 'Uploaded', error: 'Failed', cancelled: 'Cancelled' };

/** Push's layout thumbnail: its parts as little blocks. */
export const layoutThumb = (id, cls = '') => {
  const L = layoutOf(id);
  return `<span class="pl-lt ${cls}" style="grid-template-columns:${L.columns};grid-template-rows:${L.rows}" aria-label="${esc(L.label)}">${L.zones.map((z) => `<i style="grid-area:${z.area}"></i>`).join('')}</span>`;
};
const fmtSize = (n) => (n == null ? '—' : n < 1024 ? `${n} B` : bytes(n).replace(/\.0 /, ' '));

export function initLibrary(app, lib) {
  const ui = {
    collapsed: (() => { try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; } })(),
    source: 'all',                 // Media: all | email | download
    show: 'all',                   // Screens: all | groups | screens
  };
  const fileInput = h(`<input type="file" accept="${ACCEPT}" multiple hidden>`);
  document.body.append(fileInput);
  fileInput.addEventListener('change', () => { app.act.upload([...fileInput.files]); fileInput.value = ''; });

  const section = () => SECTIONS.find((s) => s.id === app.ui.section) ?? SECTIONS[0];
  // The Screens filter: everything, groups, screens, or one zone's.
  const showOptions = () => [['all', 'All'], ['groups', 'Groups'], ['screens', 'Screens'], ...ZONES.map((z) => [z.id, z.label])];
  const showLabel = () => showOptions().find(([v]) => v === ui.show)?.[1] ?? 'All';
  const pending = () => app.uploads.filter((t) => !['done', 'error', 'cancelled'].includes(t.status)).length;

  /* ---------------------------------------------------------------- render */

  function render() {
    lib.classList.toggle('collapsed', ui.collapsed);
    if (ui.collapsed) {
      const n = pending();
      lib.innerHTML = `<button type="button" class="pl-show" data-act="expand" aria-expanded="false" aria-controls="library-body">${icon('ChevronUp', 'ico sm')} Show library · ${section().label}${n ? ` <b>· ${n} uploading</b>` : ''}</button>${uploadsPanel()}`;
      return;
    }
    const scroll = lib.querySelector('.pl-strip')?.scrollLeft ?? 0;
    lib.innerHTML = `
      <button type="button" class="pc-hide" data-act="collapse" aria-expanded="true" aria-controls="library-body">${icon('ChevronDown', 'ico xs')} Hide library</button>
      ${uploadsPanel()}
      <nav class="pl-nav" aria-label="Sections">
        ${SECTIONS.map((s) => `<button type="button" class="pl-sec ${s.id === app.ui.section ? 'btn-active' : ''}" data-section="${s.id}" aria-current="${s.id === app.ui.section ? 'page' : 'false'}">${icon(s.icon, 'ico sm')}<span>${s.label}</span></button>`).join('')}
        <div class="pl-foot">
          <button type="button" class="pl-me" data-act="me" aria-label="Account menu"><span class="pc-av btn-active">${esc(app.user.name[0])}</span>${icon('ChevronDown', 'ico xs')}<span class="pl-me-name">${esc(app.user.name)}</span></button>
          <button type="button" class="pl-theme" data-act="theme" title="Light or dark mode" aria-label="Toggle theme">${icon(document.documentElement.classList.contains('light') ? 'Sun' : 'Moon', 'ico sm')}</button>
        </div>
      </nav>
      <div class="pl-body" id="library-body">
        <div class="pl-head"><nav class="pl-crumbs" aria-label="breadcrumb"><span>Library</span>${icon('ChevronRight', 'ico xs')}<b>${section().label}</b></nav>
          <div class="pl-actions">${actions()}</div></div>
        <div class="pl-content">${content()}</div>
      </div>`;
    const strip = lib.querySelector('.pl-strip');
    if (strip) strip.scrollLeft = scroll;
  }

  function actions() {
    if (app.ui.section === 'media') {
      const running = app.email.status === 'running';
      const srcLabel = { all: 'All media', email: 'Email', download: 'Downloads' }[ui.source];
      return `<button type="button" class="pb active" data-act="source" aria-label="Media source">${icon('SlidersHorizontal', 'ico xs')}${srcLabel}${icon('ChevronDown', 'ico xs')}</button>
        <button type="button" class="pb" data-act="upload">${icon('Upload', 'ico xs')}Upload</button>
        <button type="button" class="pb outline" data-act="email" ${running ? 'disabled' : ''}>${icon('RefreshCw', `ico xs ${running ? 'spin' : ''}`)}${running ? 'Loading…' : 'Load Email'}</button>
        <button type="button" class="pb outline icon" data-act="email-info" aria-label="Email settings and import details" title="Email settings and import details">${icon('Settings2', 'ico xs')}</button>
        <button type="button" class="pb outline icon" data-act="sheet" aria-label="Expand media library" title="Expand media library">${icon('Maximize2', 'ico xs')}</button>`;
    }
    if (app.ui.section === 'screens') {
      return `<button type="button" class="pb active" data-act="show" aria-label="Show screens or groups">${icon('SlidersHorizontal', 'ico xs')}${showLabel()}${icon('ChevronDown', 'ico xs')}</button>
        <button type="button" class="pb" data-act="add-screen">${icon('Plus', 'ico xs')}Add screen</button>
        <button type="button" class="pb outline" data-act="new-group" ${app.state.screens.length ? '' : 'disabled'} title="${app.state.screens.length ? 'Group screens to place them on an edge in one drag' : 'Add a screen first'}">${icon('Boxes', 'ico xs')}New group</button>`;
    }
    return '';
  }

  const isNew = (m) => app.fresh.has(m.id) || (m.source === 'email' && Date.now() - Date.parse(m.createdAt) < NEW_MS);
  const thumb = (m) => (m.type === 'image' ? `<img src="${esc(m.url)}" alt="" loading="lazy" decoding="async" draggable="false">`
    : m.type === 'video' ? `<video src="${esc(m.url)}" preload="metadata" muted playsinline></video>`
      : `<span class="pl-ico">${icon(TYPE_ICON[m.type] ?? 'FileText', 'ico lg')}</span>`);
  const badges = (m) => `${m.source === 'email' ? `<span class="pl-badge" title="Imported from email">${icon('Mail', 'ico xxs')}</span>` : ''}${m.source === 'download' ? `<span class="pl-badge" title="Downloaded with notes">${icon('Download', 'ico xxs')}</span>` : ''}${isNew(m) ? '<span class="pl-new">New</span>' : ''}`;
  const visibleMedia = () => app.state.media.filter((m) => ui.source === 'all' || m.source === ui.source);

  function content() {
    if (app.ui.section === 'templates') return '<p class="pl-soon">Templates will live here.</p>';
    if (app.ui.section === 'media') {
      const list = visibleMedia();
      const empty = ui.source === 'email' ? 'No email media yet. Send files to your mailbox, then load them here.'
        : ui.source === 'download' ? 'Nothing saved yet. Use the download button → Save to Media on a card or screen.' : 'No media yet.';
      return `<div class="pl-strip media" data-drop="files">${list.length ? list.map((m) => `<button type="button" class="pl-m" data-media="${esc(m.id)}" title="${esc(m.name)} — drag onto the canvas or a screen" aria-label="Preview ${esc(m.name)}">${thumb(m)}${badges(m)}</button>`).join('')
        : `<p class="pl-empty">${empty}</p>`}</div>`;
    }
    // Screens: groups, screens, and the layouts down the right.
    const { state } = app;
    // ui.show: all | groups | screens | a zone's id (its group and its screens).
    const zoneOnly = ZONES.some((z) => z.id === ui.show) ? ui.show : null;
    const groups = ui.show !== 'screens' ? state.groups.filter((g) => !zoneOnly || g.zone === zoneOnly).map((g) => `<div class="pl-tile group" data-group="${esc(g.id)}" title="${esc(g.name)}\n${esc(groupSummary(g) || 'No screens')}\nDrag onto the canvas">
        <div class="pl-th">${icon('Boxes', 'ico xs')}<b>${esc(g.name)}</b><button type="button" class="pc-ib" data-act="group-menu" aria-label="Actions for group ${esc(g.name)}">${icon('EllipsisVertical', 'ico xs')}</button></div>
        <small class="pl-sum">${esc(groupSummary(g) || 'No screens')}</small></div>`).join('') : '';
    const screens = ui.show !== 'groups' ? state.screens.filter((s) => !zoneOnly || s.zone === zoneOnly).map((s) => {
      const st = app.status(s), edge = app.edgeOf(s.id), z = app.zoneMeta(s);
      return `<div class="pl-tile screen ${edge ? 'placed' : ''} ${app.ui.pushTarget === s.id ? 'target' : ''}" data-screen="${esc(s.id)}" title="${esc(`${app.label(s)} — ${st.text}`)}${s.paired ? '\nBrowser' : ''}">
        <div class="pl-th"><i class="pc-dot ${st.dot}" aria-label="${st.text}"></i><b>${esc(s.name)}</b>${s.layout !== 'single' ? layoutThumb(s.layout, 'sm') : ''}
          <button type="button" class="pc-ib" data-act="screen-menu" aria-label="Actions for ${esc(s.name)}">${icon('EllipsisVertical', 'ico xs')}</button></div>
        <div class="pl-foot-row">${edge ? `<span class="pl-edge">${EDGE_LABELS[edge]}</span>` : ''}${z ? `<span class="pl-zn" title="${esc(z.title)}">${esc(z.n)}</span>` : ''}</div></div>`;
    }).join('') : '';
    const none = !state.screens.length && ui.show !== 'groups' ? '<p class="pl-empty">No screens yet. Add one to get started.</p>' : '';
    return `<div class="pl-screens">
      <div class="pl-strip">${groups}${screens}${none}</div>
      <div class="pl-layouts" aria-label="Screen layouts">${Object.values(LAYOUTS).map((L) => `<div class="pl-layout" data-layout="${L.id}" title="${esc(L.label)}: drag onto a screen, or use the menu">
        <div class="pl-th"><b>${esc(L.label)}</b><button type="button" class="pc-ib" data-act="layout-menu" aria-label="Apply ${esc(L.label)} to a screen">${icon('EllipsisVertical', 'ico xs')}</button></div>
        ${layoutThumb(L.id)}</div>`).join('')}</div>
    </div>`;
  }

  function groupSummary(g) {
    return EDGES.filter((e) => g.layout[e].length).map((e) => `${EDGE_LABELS[e]}: ${g.layout[e].map((id) => app.screen(id)?.name).filter(Boolean).join(', ')}`).join(' · ');
  }

  function uploadsPanel() {
    if (!app.uploads.length) return '';
    const done = app.uploads.filter((t) => ['done', 'error', 'cancelled'].includes(t.status)).length;
    return `<div class="pl-uploads" aria-label="Uploads">
      <div class="pu-head"><b>Uploads · ${done}/${app.uploads.length} finished</b>${done ? '<button type="button" class="pb ghost" data-act="clear-uploads">Clear finished</button>' : ''}</div>
      ${app.uploads.map((t) => `<div class="pu-row">
        <div class="pu-line">${t.status === 'done' ? icon('CircleCheck', 'ico sm ok') : t.status === 'error' || t.status === 'cancelled' ? icon('CircleX', 'ico sm err') : icon('LoaderCircle', 'ico sm spin')}
          <span class="pu-name">${esc(t.file.name)}</span><span class="pu-st">${t.status === 'uploading' ? `${t.progress}%` : STATUS[t.status]}</span>
          ${['queued', 'preparing', 'uploading'].includes(t.status) ? `<button type="button" class="pc-ib" data-cancel="${esc(t.id)}" aria-label="Cancel ${esc(t.file.name)}">${icon('X', 'ico xs')}</button>` : ''}</div>
        <div class="pu-bar"><i style="width:${t.status === 'done' ? 100 : t.progress}%"></i></div></div>`).join('')}</div>`;
  }

  /* ---------------------------------------------------------------- clicks */

  lib.addEventListener('click', (e) => {
    if (justDragged()) return;
    const sec = e.target.closest('[data-section]')?.dataset.section;
    if (sec) { app.ui.section = sec; render(); return; }
    const cancel = e.target.closest('[data-cancel]')?.dataset.cancel;
    if (cancel) { const t = app.uploads.find((x) => x.id === cancel); if (t) t.status = 'cancelled'; render(); return; }
    const m = e.target.closest('[data-media]')?.dataset.media;
    const b = e.target.closest('[data-act]');
    if (!b && m) { preview(app.media(m)); return; }
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'collapse' || a === 'expand') {
      ui.collapsed = a === 'collapse';
      try { localStorage.setItem(COLLAPSED_KEY, ui.collapsed ? '1' : '0'); } catch { /* private mode */ }
      render();
    }
    if (a === 'upload') fileInput.click();
    if (a === 'email') app.act.loadEmail();
    if (a === 'email-info') emailSheet();
    if (a === 'sheet') librarySheet();
    if (a === 'source') choose(b, [['all', 'All media'], ['email', 'Email'], ['download', 'Downloads']], ui.source, (v) => { ui.source = v; render(); });
    if (a === 'show') choose(b, showOptions(), ui.show, (v) => { ui.show = v; render(); });
    if (a === 'add-screen') screenDialog();
    if (a === 'new-group') groupDialog();
    if (a === 'clear-uploads') { app.uploads = app.uploads.filter((t) => !['done', 'error', 'cancelled'].includes(t.status)); render(); }
    if (a === 'me') accountMenu(b);
    if (a === 'theme') themeMenu(b);
    if (a === 'screen-menu') screenMenu(b, b.closest('[data-screen]').dataset.screen);
    if (a === 'group-menu') groupMenu(b, b.closest('[data-group]').dataset.group);
    if (a === 'layout-menu') applyMenu(b, b.closest('[data-layout]').dataset.layout);
  });

  /* ---- files dropped on the library ---- */
  lib.addEventListener('dragover', (e) => { if (app.ui.section === 'media' && e.dataTransfer.types.includes('Files')) { e.preventDefault(); lib.classList.add('dropping'); } });
  lib.addEventListener('dragleave', (e) => { if (e.target === lib) lib.classList.remove('dropping'); });
  lib.addEventListener('drop', (e) => {
    lib.classList.remove('dropping');
    if (app.ui.section !== 'media' || !e.dataTransfer.files.length) return;
    e.preventDefault();
    app.act.upload([...e.dataTransfer.files]);
  });

  /* ---- dragging out of the library ---- */
  lib.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button.pc-ib')) return;
    const canvas = document.querySelector('.pc-canvas');
    const mt = e.target.closest('[data-media]'), st = e.target.closest('.pl-tile.screen'), gt = e.target.closest('.pl-tile.group'), lt = e.target.closest('.pl-layout');
    const slotOf = (el) => el?.closest('.pc-slot');
    if (mt) {
      const id = mt.dataset.media;
      startDrag(e, mt, {
        over(el) { const s = slotOf(el); mark('drop', s?.classList.contains('on') && !s.classList.contains('sharing') ? s : null); canvas.classList.toggle('drop', !!el?.closest('.pc-canvas') && !s); },
        drop(el, x, y) {
          canvas.classList.remove('drop');
          const s = slotOf(el);
          if (s?.classList.contains('on')) app.act.push(s.dataset.screen, id, { zoneId: s.dataset.zone || null, keep: true });
          else if (el?.closest('.pc-canvas')) app.act.addCard(id, app.canvas.toWorld(x, y));
        },
      });
    } else if (st) {
      const id = st.dataset.screen;
      startDrag(e, st, {
        over(el) { mark('drop', slotOf(el) ?? null); canvas.classList.toggle('drop', !!el?.closest('.pc-canvas')); },
        drop(el, x, y) {
          canvas.classList.remove('drop');
          const s = slotOf(el);
          if (s) app.act.place(id, s.dataset.edge, s.classList.contains('on') || s.classList.contains('empty') ? Number(s.dataset.i) : null);
          else if (el?.closest('.pc-canvas')) app.act.place(id, nearestEdge(canvas, x, y));
          else if (el?.closest('.pc-edge')) app.act.place(id, el.closest('.pc-edge').dataset.edge);
        },
      });
    } else if (gt) {
      const id = gt.dataset.group;
      startDrag(e, gt, {
        over(el) { canvas.classList.toggle('drop', !!el?.closest('.pc-canvas, .pc-edge')); },
        drop(el) { canvas.classList.remove('drop'); if (el?.closest('.pc-canvas, .pc-edge')) app.act.placeGroup(id); },
      });
    } else if (lt) {
      const layout = lt.dataset.layout;
      startDrag(e, lt, {
        over(el) { mark('drop', el?.closest('.pc-slot.on, .pl-tile.screen') ?? null); },
        drop(el) {
          const t = el?.closest('.pc-slot.on, .pl-tile.screen');
          if (t) app.act.setLayout(t.dataset.screen, layout);
        },
      });
    }
  });

  /* ---------------------------------------------------------------- menus */

  function choose(anchor, options, value, onChange) {
    dropdown(anchor, options.map(([v, l]) => `<button data-v="${v}" class="ind">${v === value ? icon('Check', 'ico sm') : '<i class="ico-sp"></i>'}${esc(l)}</button>`).join(''), {
      align: 'end', width: 170,
      onMount(menu, close) { menu.addEventListener('click', (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v) { close(); onChange(v); } }); },
    });
  }

  function accountMenu(anchor) {
    const w = app.user.workspace;
    dropdown(anchor, `<div class="dd-user"><div class="sb-user-text"><b>${esc(app.user.name)}</b><span>${esc(app.user.email)}</span></div></div><hr>
      <button data-copy="${esc(app.user.accountCode)}" data-what="Account ID"><span class="dd-k">Account</span><code>${esc(app.user.accountCode)}</code>${icon('Copy', 'ico xs')}</button>
      <button data-copy="${esc(w.code)}" data-what="Workspace ID"><span class="dd-k">Workspace</span><code>${esc(w.code)}</code>${icon('Copy', 'ico xs')}</button>
      <div class="dd-kv"><span>Name</span><span>${esc(w.name)}</span></div>
      <div class="dd-label">Plan: ${esc(w.plan)}</div><hr>
      <button data-m="reset">${icon('RotateCcw', 'ico sm')} Reset demo</button>
      <button data-m="out">${icon('LogOut', 'ico sm')} Sign out</button>`, {
      align: 'start', width: 256,
      onMount(menu, close) {
        menu.addEventListener('click', (e) => {
          const c = e.target.closest('[data-copy]');
          if (c) { close(); copy(c.dataset.copy, `${c.dataset.what} copied`); return; }
          const m = e.target.closest('[data-m]')?.dataset.m;
          if (!m) return;
          close();
          if (m === 'reset') app.act.reset();
          if (m === 'out') app.notify('The kiosk stays signed in', { tone: 'info' });
        });
      },
    });
  }

  function themeMenu(anchor) {
    dropdown(anchor, [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(([v, l]) => `<button data-t="${v}" class="ind">${app.theme === v ? icon('Check', 'ico sm') : '<i class="ico-sp"></i>'}${l}</button>`).join(''), {
      align: 'end', width: 150,
      onMount(menu, close) { menu.addEventListener('click', (e) => { const t = e.target.closest('[data-t]')?.dataset.t; if (t) { close(); app.setTheme(t); } }); },
    });
  }

  function screenMenu(anchor, id) {
    const s = app.screen(id), edge = app.edgeOf(id);
    const splitEdge = (e) => app.state.slots[e].some((x) => x?.includes('#') && baseId(x) !== id);
    dropdown(anchor, `<div class="dd-label">Place on the canvas</div>
      ${EDGES.map((e) => `<button data-place="${e}" ${e === edge || splitEdge(e) ? 'disabled' : ''}>${icon('Monitor', 'ico sm')} ${EDGE_LABELS[e]}${e === edge ? '<small class="dd-side">here</small>' : ''}</button>`).join('')}
      ${edge ? `<button data-m="off">${icon('X', 'ico sm')} Remove from canvas</button>` : ''}
      <button data-m="layout">${icon('LayoutGrid', 'ico sm')} Layout…</button><hr>
      <button data-m="pair">${icon('Link', 'ico sm')} ${s.paired ? 'Pair again' : 'Pair display'}</button>
      <button data-m="link">${icon('Copy', 'ico sm')} Copy display link</button>
      ${s.paired ? `<button data-m="unpair">${icon('Unplug', 'ico sm')} Unpair</button>` : ''}
      <button data-m="rename">${icon('Pencil', 'ico sm')} Rename</button>
      <button data-m="delete" class="danger">${icon('Trash2', 'ico sm')} Delete</button>`, {
      align: 'end', width: 210,
      onMount(menu, close) {
        menu.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b || b.disabled) return;
          close();
          if (b.dataset.place) app.act.place(id, b.dataset.place);
          const m = b.dataset.m;
          if (m === 'off') app.act.unplace(id);
          if (m === 'layout') layoutDialog(id);
          if (m === 'pair') pairDialog(id);
          if (m === 'link') copy(app.act.displayLink(id), `Display link for “${s.name}” copied`, s.paired ? 'The display paired with a code was signed out: open this link on it.' : 'Open it on the display: it shows this screen.');
          if (m === 'unpair') confirm(`Unpair “${s.name}”?`, 'The display stops receiving content. Pair it again to use it.', 'Unpair', () => app.act.unpair(id));
          if (m === 'rename') screenDialog(s);
          if (m === 'delete') confirm(`Delete “${s.name}”?`, 'The display is unpaired and stops receiving content. To use it again you will add it and pair it from scratch.', 'Delete screen', () => app.act.deleteScreen(id));
        });
      },
    });
  }

  function groupMenu(anchor, id) {
    const g = app.state.groups.find((x) => x.id === id);
    dropdown(anchor, `<button data-m="place">${icon('Monitor', 'ico sm')} Place on the canvas</button>
      <button data-m="edit">${icon('Pencil', 'ico sm')} Edit</button><hr>
      <button data-m="delete" class="danger">${icon('Trash2', 'ico sm')} Delete group</button>`, {
      align: 'end', width: 200,
      onMount(menu, close) {
        menu.addEventListener('click', (e) => {
          const m = e.target.closest('[data-m]')?.dataset.m;
          if (!m) return;
          close();
          if (m === 'place') app.act.placeGroup(id);
          if (m === 'edit') groupDialog(g);
          if (m === 'delete') confirm(`Delete group “${g.name}”?`, 'Its screens stay as they are.', 'Delete group', () => app.act.deleteGroup(id));
        });
      },
    });
  }

  function applyMenu(anchor, layout) {
    const list = app.state.screens;
    dropdown(anchor, `<div class="dd-label">Apply to</div>
      ${list.length ? list.map((s) => `<button data-id="${esc(s.id)}" ${s.layout === layout ? 'disabled' : ''}>${icon('Monitor', 'ico sm')}${esc(s.name)}${s.layout === layout ? '<small class="dd-side">now</small>' : ''}</button>`).join('') : '<p class="dd-empty">No screens yet.</p>'}`, {
      align: 'end', width: 200,
      onMount(menu, close) { menu.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b && !b.disabled) { close(); app.act.setLayout(b.dataset.id, layout); } }); },
    });
  }

  async function copy(text, done, description = '') {
    try { await navigator.clipboard.writeText(text); app.notify(done, { description }); } catch { app.notify("Couldn't copy", { tone: 'err', description: text }); }
  }

  /* ---------------------------------------------------------------- dialogs */

  /** A Push dialog: title, description, body, footer buttons. Returns close(). */
  function dialog({ title, description = '', body = '', footer = '', cls = '', onMount, onClose }) {
    return modal(`<div class="pd-head"><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div>
      <button type="button" class="pd-x" data-close aria-label="Close">${icon('X', 'ico sm')}</button>
      ${body}${footer ? `<div class="pd-foot">${footer}</div>` : ''}`, { cls: `pd ${cls}`, onMount, onClose });
  }

  /** fn() on every change while el is on the page. */
  function watch(el, fn) {
    const off = app.onChange(() => (el.isConnected ? fn() : off()));
  }

  app.confirm = (...a) => confirm(...a);
  function confirm(title, body, label, onYes) {
    dialog({
      title: esc(title), description: esc(body), cls: 'narrow',
      footer: `<button type="button" class="pb outline lg" data-close>Cancel</button><button type="button" class="pb danger lg" data-yes>${esc(label)}</button>`,
      onMount(el, close) { el.querySelector('[data-yes]').addEventListener('click', () => { close(); onYes(); }); },
    });
  }

  function preview(m) {
    if (!m) return;
    const email = m.source === 'email' ? `<div class="pd-mail"><p><span>From: </span>${esc(m.emailFrom || 'Unknown sender')}</p><p><span>Subject: </span>${esc(m.emailSubject || 'No subject')}</p>
      ${m.emailReceivedAt ? `<p class="dim">Received ${esc(new Date(m.emailReceivedAt).toLocaleString())}</p>` : ''}</div>` : '';
    const pic = m.type === 'image' ? `<img src="${esc(m.url)}" alt="${esc(m.name)}">`
      : m.type === 'video' ? `<video src="${esc(m.url)}" controls autoplay muted playsinline></video>`
        : m.type === 'document' ? `<iframe src="${esc(m.url)}" title="${esc(m.name)}"></iframe>`
          : `<div class="pd-file">${icon(TYPE_ICON[m.type] ?? 'FileText', 'ico xl')}<p>${m.type === 'link' ? esc(m.url) : 'This file renders full-screen on a display. Open it to check the contents.'}</p>
            <a class="pb outline" href="${esc(m.url)}" target="_blank" rel="noreferrer">${icon('ExternalLink', 'ico xs')}Open</a></div>`;
    dialog({
      title: esc(m.name), cls: 'wide',
      description: `${TYPE_LABEL[m.type] ?? m.type}${m.sizeBytes != null ? ` · ${fmtSize(m.sizeBytes)}` : ''} · added ${esc(new Date(m.createdAt).toLocaleString())}`,
      body: `${email}<div class="pd-pic">${pic}</div>`,
      footer: `<button type="button" class="pb outline lg" data-add>${icon('Plus', 'ico xs')}Add to canvas</button><button type="button" class="pb danger lg" data-del>${icon('Trash2', 'ico xs')}Delete</button>`,
      onMount(el, close) {
        el.querySelector('[data-add]').addEventListener('click', () => { close(); app.act.showCard(m.id); });
        el.querySelector('[data-del]').addEventListener('click', () => confirm(`Delete “${m.name}”?`, 'It comes off the canvas and every screen showing it.', 'Delete', () => { close(); app.act.deleteMedia(m.id); }));
      },
    });
  }

  function librarySheet() {
    let close = null;
    const draw = (el) => {
      const list = visibleMedia();
      el.querySelector('.ps-grid').innerHTML = list.length ? list.map((m) => `<div class="ps-item"><button type="button" class="pl-m wide" data-media="${esc(m.id)}" aria-label="Preview ${esc(m.name)}">
          <span class="pl-pic">${thumb(m)}${badges(m)}</span><span class="pl-cap"><b>${esc(m.name)}</b><small>${esc(m.emailFrom || 'Media library')}</small></span></button>
        <button type="button" class="pb outline sm full" data-add="${esc(m.id)}">${icon('Plus', 'ico xs')}Add<span class="sr-only"> to canvas: ${esc(m.name)}</span></button></div>`).join('')
        : '<p class="pl-empty center">No media yet.</p>';
    };
    close = dialog({
      title: 'Media library', description: 'Preview a file or add it to your canvas.', cls: 'sheet bottom',
      body: `<div class="ps-bar"><button type="button" class="pb active" data-src>${icon('SlidersHorizontal', 'ico xs')}<span></span>${icon('ChevronDown', 'ico xs')}</button>
        <button type="button" class="pb" data-up>${icon('Upload', 'ico xs')}Upload</button></div><div class="ps-grid"></div>`,
      onMount(el, closeIt) {
        const label = () => { el.querySelector('[data-src] span').textContent = { all: 'All media', email: 'Email', download: 'Downloads' }[ui.source]; };
        label();
        draw(el);
        watch(el, () => draw(el));
        el.addEventListener('click', (e) => {
          const add = e.target.closest('[data-add]')?.dataset.add;
          if (add) { closeIt(); app.act.showCard(add); return; }
          const m = e.target.closest('[data-media]')?.dataset.media;
          if (m) { preview(app.media(m)); return; }
          if (e.target.closest('[data-up]')) fileInput.click();
          const src = e.target.closest('[data-src]');
          if (src) choose(src, [['all', 'All media'], ['email', 'Email'], ['download', 'Downloads']], ui.source, (v) => { ui.source = v; label(); draw(el); render(); });
        });
      },
    });
    return close;
  }

  function emailSheet() {
    dialog({
      title: 'Email Media', description: 'Your mailbox and import activity.', cls: 'sheet right',
      body: `<div class="pe">
        <div class="pe-box"><small>Import mailbox</small>
          <div class="pe-addr"><b>${MAILBOX}</b><button type="button" class="pb outline icon" data-copy aria-label="Copy mailbox address">${icon('Copy', 'ico xs')}</button></div>
          <p>Send files to this address, then click Load Email.</p><p class="pe-ok">Configured · access is verified when loading</p></div>
        <div class="pe-act"><b>Import activity</b><div class="pe-list"></div>
          <div class="row"><button type="button" class="pb outline" data-retry>Retry failed emails</button></div></div>
        <p class="pe-note">Drive links keep their existing sharing permissions. Files must be accessible to the display that opens them.</p></div>`,
      onMount(el) {
        const draw = () => {
          const list = app.state.imports;
          el.querySelector('.pe-list').innerHTML = list.length ? list.map((x) => `<div class="pe-item"><b>${esc(x.subject || 'Email import')}</b><small>${esc(new Date(x.at).toLocaleString())} · ${x.added} ${x.added === 1 ? 'file' : 'files'} added</small></div>`).join('')
            : '<p class="dim">No imports yet. Load Email brings in what has arrived.</p>';
        };
        draw();
        watch(el, draw);
        el.querySelector('[data-copy]').addEventListener('click', () => copy(MAILBOX, 'Mailbox address copied'));
        el.querySelector('[data-retry]').addEventListener('click', () => app.act.loadEmail());
      },
    });
  }
  app.openEmail = emailSheet;

  /** Add screen, or Rename (s given). */
  function screenDialog(s = null) {
    dialog({
      title: s ? 'Rename screen' : 'Add screen', cls: 'narrow',
      description: s ? 'The new name shows up everywhere immediately.' : 'Create the screen here, then pair the physical display with a code.',
      body: `<form class="pd-form" id="pd-screen"><label>Name<input class="pd-input" name="name" maxlength="80" placeholder="Lobby wall" value="${esc(s?.name ?? '')}" required autocomplete="off"></label>
        <small>Where it is, so anyone can find it.</small><p class="pd-err" hidden></p></form>`,
      footer: `<button type="button" class="pb outline lg" data-close>Cancel</button><button type="submit" form="pd-screen" class="pb lg">${s ? 'Save' : 'Add screen'}</button>`,
      onMount(el, close) {
        const f = el.querySelector('form');
        f.name.focus();
        f.name.select();
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          const name = f.name.value.trim();
          if (!name) { const p = el.querySelector('.pd-err'); p.hidden = false; p.textContent = 'Name is required'; return; }
          close();
          if (s) app.act.rename(s.id, name);
          else { const id = app.act.addScreen(name); pairDialog(id); }
        });
      },
    });
  }

  function layoutDialog(id) {
    const s = app.screen(id);
    dialog({
      title: `Layout for “${esc(s.name)}”`, cls: 'mid',
      description: 'Split the screen into parts; each part shows its own media. A split screen is never linked: splitting unlinks it.',
      body: `<div class="pd-layouts">${Object.values(LAYOUTS).map((L) => `<button type="button" class="pd-lay ${s.layout === L.id ? 'on' : ''}" data-l="${L.id}">${layoutThumb(L.id)}<span>${esc(L.label)}</span></button>`).join('')}</div>`,
      onMount(el, close) { el.addEventListener('click', (e) => { const l = e.target.closest('[data-l]')?.dataset.l; if (l) { close(); app.act.setLayout(id, l); } }); },
    });
  }

  function pairDialog(id) {
    const s = app.screen(id);
    app.act.newCode(id);
    let timer = 0;
    dialog({
      title: `Pair a display with “${esc(s.name)}”`, cls: 'narrow',
      description: `On the display, open the desktop player (server: <code>${esc(location.origin)}</code>) and type this code. Or open the display address below on it.`,
      body: '<div class="pp"></div>',
      footer: `<button type="button" class="pb outline lg" data-new>${icon('RefreshCw', 'ico xs')}New code</button><button type="button" class="pb lg" data-close data-done>Close</button>`,
      // Closed: the code stops working.
      onClose() { clearInterval(timer); if (!app.state.pairing?.done) app.act.endPairing(); },
      onMount(el) {
        const box = el.querySelector('.pp');
        const draw = () => {
          const p = app.state.pairing;
          if (p?.done && p.screenId === id) {
            box.innerHTML = `<div class="pp-done">${icon('CircleCheck', 'ico xl ok')}<b>Paired</b><p>The display can now receive content.</p></div>`;
            el.querySelector('[data-new]').hidden = true;
            el.querySelector('[data-done]').textContent = 'Done';
            return;
          }
          const left = p ? Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000)) : 0;
          box.innerHTML = `<div class="pp-addr"><input class="pd-input mono" readonly value="${esc(`${location.origin}/push/display.html`)}" aria-label="Display address">
              <button type="button" class="pb outline icon" data-copy aria-label="Copy address">${icon('Copy', 'ico xs')}</button></div>
            <div class="pp-code">${p ? `<b>${esc(p.code)}</b><small>${left ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · waiting for the display…` : 'This code has expired.'}</small>` : '<small>Generating…</small>'}</div>`;
          box.querySelector('[data-copy]').addEventListener('click', () => copy(`${location.origin}/push/display.html`, 'Copied'));
        };
        draw();
        timer = setInterval(draw, 1000);
        watch(el, draw);
        el.querySelector('[data-new]').addEventListener('click', () => { app.act.newCode(id); draw(); });
      },
    });
  }

  /** New screen group, or Edit (g given): a name, and an edge (or none) for each screen. */
  function groupDialog(g = null) {
    const edgeOf = Object.fromEntries(EDGES.flatMap((e) => (g?.layout[e] ?? []).map((id) => [id, e])));
    const order = (id) => { const e = edgeOf[id]; return e ? Object.entries(edgeOf).filter(([, x]) => x === e).map(([k]) => k).indexOf(id) + 1 : ''; };
    dialog({
      title: g ? 'Edit group' : 'New screen group', cls: 'mid',
      description: 'Choose an edge for each screen. Dropped on the canvas, every edge used here becomes these screens; the others stay as they are.',
      body: `<form class="pd-form" id="pd-group"><label>Name<input class="pd-input" name="name" maxlength="80" placeholder="Showroom" value="${esc(g?.name ?? '')}" required autocomplete="off"></label>
        <div class="pd-label">Screens and their edges</div><div class="pg-list"></div><p class="pg-sum"></p><p class="pd-err" hidden></p></form>`,
      footer: `<button type="button" class="pb outline lg" data-close>Cancel</button><button type="submit" form="pd-group" class="pb lg">${g ? 'Save' : 'Create group'}</button>`,
      onMount(el, close) {
        const draw = () => {
          el.querySelector('.pg-list').innerHTML = app.state.screens.length ? app.state.screens.map((s) => `<div class="pg-row"><span class="pg-name">${esc(s.name)}</span>
            <div class="pg-seg" role="radiogroup" aria-label="Edge for ${esc(s.name)}">${[null, ...EDGES].map((e) => `<button type="button" data-s="${esc(s.id)}" data-e="${e ?? ''}" class="${(edgeOf[s.id] ?? null) === e ? 'on' : ''}">${e ? EDGE_LABELS[e] : 'Off'}</button>`).join('')}</div>
            <span class="pg-n">${order(s.id)}</span></div>`).join('') : '<p class="dim">No screens yet.</p>';
          const sum = EDGES.filter((e) => Object.values(edgeOf).includes(e)).map((e) => `${EDGE_LABELS[e]}: ${Object.entries(edgeOf).filter(([, x]) => x === e).map(([id]) => app.screen(id)?.name).join(', ')}`).join(' · ');
          el.querySelector('.pg-sum').textContent = sum || 'No screens on an edge yet.';
        };
        draw();
        el.querySelector('.pg-list').addEventListener('click', (e) => {
          const b = e.target.closest('[data-s]');
          if (!b) return;
          delete edgeOf[b.dataset.s];
          if (b.dataset.e) edgeOf[b.dataset.s] = b.dataset.e;
          draw();
        });
        el.querySelector('form').addEventListener('submit', (e) => {
          e.preventDefault();
          const name = e.target.name.value.trim();
          const err = el.querySelector('.pd-err');
          const layout = Object.fromEntries(EDGES.map((x) => [x, Object.entries(edgeOf).filter(([, v]) => v === x).map(([k]) => k)]));
          if (!name) { err.hidden = false; err.textContent = 'Name is required'; return; }
          if (!EDGES.some((x) => layout[x].length)) { err.hidden = false; err.textContent = 'Put at least one screen on an edge'; return; }
          if (EDGES.some((x) => layout[x].length > 6)) { err.hidden = false; err.textContent = 'Up to 6 screens on one edge'; return; }
          close();
          app.act.saveGroup({ id: g?.id ?? null, name, layout });
        });
      },
    });
  }

  app.onChange(() => { if (app.uploads.length || ui.collapsed) render(); });
  return { render };
}
