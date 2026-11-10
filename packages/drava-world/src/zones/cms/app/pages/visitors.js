// Visitors (visitors/_components/visitors-client.tsx in the real Nex): people recognised at
// the entrance camera, newest first, with search, paging and an editor to name them or merge
// two records. Here the visitors are samples, and you join the list live, as an unknown
// visitor, when you walk into Zone 02.

import { esc, h, icon, modal, toast } from '../ui.js';

const PAGE_SIZE = 20;
const ui = { search: '', input: '', page: 1 };

const seen = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** A visitor's photo: a drawn head and shoulders, tinted per person (the samples have no real photos). */
export function avatar(v, cls = 'vphoto') {
  if (v.photo === null || v.photo === undefined) return `<div class="${cls} none" title="Photo purged">—</div>`;
  const hue = v.photo;
  return `<svg class="${cls}" viewBox="0 0 48 48" aria-label="${esc(v.name || 'Unknown visitor')}"><defs><linearGradient id="g${esc(v.uuid)}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="hsl(${hue} 45% 34%)"/><stop offset="1" stop-color="hsl(${hue} 50% 16%)"/></linearGradient></defs>
    <rect width="48" height="48" fill="url(#g${esc(v.uuid)})"/><circle cx="24" cy="19" r="8.5" fill="hsl(${hue} 30% 78%)"/>
    <path d="M8 48c1.5-10 8-15 16-15s14.5 5 16 15z" fill="hsl(${hue} 30% 70%)"/></svg>`;
}

export function renderVisitors(app) {
  const { state } = app;
  const q = ui.search.toLowerCase();
  const list = [...state.visitors]
    .filter((v) => !q || v.name.toLowerCase().includes(q) || v.email.toLowerCase().includes(q))
    .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  ui.page = Math.min(ui.page, pages);
  const rows = list.slice((ui.page - 1) * PAGE_SIZE, ui.page * PAGE_SIZE);
  const live = app.cameraLive();

  const page = h(`<div class="page vis">
    <div class="vis-head"><h1>Visitors</h1><p>People recognized at the entrance camera. New visitors are enrolled anonymously — assign a name once you know who they are.</p></div>
    <form class="row vis-search">
      <input class="input sm" name="visitor-search" placeholder="Search name or email…" value="${esc(ui.input)}" style="width:256px">
      <button class="btn sec">Search</button>
      <span class="vis-live ${live ? 'on' : ''}" title="${live ? 'Receiving live detections' : 'Reconnecting…'}"><i></i>${live ? 'Live' : 'Offline'}</span>
      <span class="muted">${total} visitor${total === 1 ? '' : 's'}</span>
    </form>
    <div class="cam">
      <p class="xs muted" style="margin:0 0 8px">Entrance camera · cam-entrance</p>
      <div class="cam-feed ${live ? 'on' : ''}"><span>${icon('Camera', 'ico lg')}</span><b>${live ? 'Zone 02 entrance' : 'No snapshot'}</b>
        <small>${live ? 'A visitor is in the room — you' : 'The virtual centre has no camera feed; you are detected when you walk into Zone 02.'}</small>
        ${live ? `<span class="cam-rec"><i></i>LIVE ${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>` : ''}</div>
    </div>
    <div class="tbl-wrap"><table class="tbl vis-tbl"><thead><tr><th>Photo</th><th>Name</th><th>Email</th><th>Role</th><th>First seen</th><th>Last seen</th><th>Actions</th></tr></thead><tbody>
      ${rows.length === 0 ? '<tr><td colspan="7" class="center muted" style="padding:32px">No visitors yet.</td></tr>' : rows.map((v) => `<tr data-id="${esc(v.uuid)}">
        <td>${avatar(v)}</td>
        <td><b class="fw5">${v.name ? esc(v.name) : '<i class="muted">Unknown</i>'}</b>${v.virtual ? ' <span class="tag violet">you</span>' : ''}</td>
        <td class="muted">${esc(v.email || '—')}</td>
        <td><span class="badge">${esc(v.role)}</span></td>
        <td class="muted">${seen(v.firstSeen)}</td><td class="muted">${seen(v.lastSeen)}</td>
        <td><button class="btn sec sm" data-act="edit">Edit</button></td></tr>`).join('')}
    </tbody></table></div>
    ${pages > 1 ? `<div class="row" style="justify-content:flex-end"><button class="btn sec sm" data-act="prev" ${ui.page <= 1 ? 'disabled' : ''}>Previous</button>
      <span class="muted">Page ${ui.page} of ${pages}</span><button class="btn sec sm" data-act="next" ${ui.page >= pages ? 'disabled' : ''}>Next</button></div>` : ''}
  </div>`);

  const form = page.querySelector('form');
  form.elements['visitor-search'].addEventListener('input', (e) => { ui.input = e.target.value; });
  form.addEventListener('submit', (e) => { e.preventDefault(); ui.search = ui.input.trim(); ui.page = 1; app.refresh(); });
  page.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev') { ui.page -= 1; app.refresh(); }
    if (act === 'next') { ui.page += 1; app.refresh(); }
    if (act === 'edit') editVisitor(app, state.visitors.find((v) => v.uuid === e.target.closest('tr').dataset.id));
  });
  return page;
}

function editVisitor(app, v) {
  const others = app.state.visitors.filter((x) => x.uuid !== v.uuid);
  modal(`<div class="modal-head"><h2 class="caps-sm">Edit visitor</h2><button class="icon-btn" data-close aria-label="Close">${icon('X')}</button></div>
    <form class="stack" style="margin-top:12px">
      <label class="field">Name<input class="input" name="name" value="${esc(v.name)}" placeholder="Name"></label>
      <label class="field">Email<input class="input" name="email" value="${esc(v.email)}" placeholder="Email"></label>
      <div class="field">Photos
        <div class="row" style="gap:8px">${v.photo !== null && v.photo !== undefined ? `<span class="vphoto-wrap">${avatar(v, 'vphoto lg')}<button type="button" class="vphoto-del" data-act="photo" title="Delete this photo">${icon('X', 'ico xxs')}</button></span>` : '<span class="xs muted">No photos — the next detection enrols a new one.</span>'}</div></div>
      <label class="field">Merge into another visitor
        <select class="input" name="merge"><option value="">— Keep as a separate visitor —</option>
          ${others.map((o) => `<option value="${esc(o.uuid)}">${esc(o.name || 'Unknown')}${o.email ? ` · ${esc(o.email)}` : ''}</option>`).join('')}</select>
        <span class="xs muted">Both records become one; this visitor's sightings move to the one you pick.</span></label>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn solid">Save</button></div>
    </form>`, {
    onMount(el, close) {
      const f = el.querySelector('form');
      el.querySelector('[data-act="photo"]')?.addEventListener('click', (e) => { e.target.closest('.vphoto-wrap').remove(); f.dataset.purge = '1'; });
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        if (f.merge.value) {
          app.mergeVisitor(v.uuid, f.merge.value);
          toast('Visitors merged');
        } else {
          app.editVisitor(v.uuid, { name: f.name.value.trim(), email: f.email.value.trim(), ...(f.dataset.purge ? { photo: null } : {}) });
          toast('Visitor saved');
        }
        close();
      });
    },
  });
}
