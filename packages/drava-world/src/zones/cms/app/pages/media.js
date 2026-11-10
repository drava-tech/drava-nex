// Media Library (media/page.tsx in the real Nex): one table of every asset, with search, a
// multi-select type filter, a source filter and a date range; Select mode to push several
// as a queue to one screen or delete them; Load Email; Upload; paging. Clicking a row opens
// the preview with the screens to push it to. Uploads stay in this browser (blob: URLs).

import { confirmDialog, copyText, dateKey, dropdown, esc, h, icon, isLinkType, rangeCalendar, toast, typeIcon } from '../ui.js';
import { FILE_LABELS } from '../../shared/render.js';
import { mediaPushModal, queuePushModal, youTubeId } from './push.js';

const CATEGORIES = [
  { id: 'images', label: 'Images', icon: 'Image', types: ['image'] },
  { id: 'videos', label: 'Videos', icon: 'Video', types: ['video'] },
  { id: 'documents', label: 'Documents', icon: 'FileText', types: ['document', 'word'] },
  { id: 'sheets', label: 'Spreadsheets', icon: 'FileSpreadsheet', types: ['sheet'] },
  { id: 'presentations', label: 'Presentations', icon: 'Presentation', types: ['presentation'] },
  { id: 'links', label: 'Links', icon: 'Link2', types: ['youtube', 'drive', 'link'] },
];
const SOURCES = [
  { id: 'upload', label: 'Upload', icon: 'Upload' },
  { id: 'email', label: 'Email', icon: 'Mail' },
  { id: 'link', label: 'Link', icon: 'Link2' },
];
const PAGE_SIZES = [10, 25, 50, 100];

// Filters and paging survive re-renders (every change in the Nex re-renders the page).
const ui = { search: '', applied: '', cats: new Set(), sources: new Set(), from: '', to: '', page: 1, size: 10, selecting: false, selected: [], uploading: false, loadingEmail: false };
let searchTimer = 0;

function filtered(state) {
  const q = ui.applied.trim().toLowerCase();
  const types = new Set([...ui.cats].flatMap((c) => CATEGORIES.find((x) => x.id === c).types));
  return state.media.filter((m) => !m.pending && (!q || m.name.toLowerCase().includes(q))
    && (!types.size || types.has(m.type))
    && (!ui.sources.size || ui.sources.has(m.source))
    && (!ui.from || dateKey(m.createdAt) >= ui.from)
    && (!ui.to || dateKey(m.createdAt) <= ui.to));
}

const pillLabel = (set, list, none, many) => (set.size === 0 ? none : set.size === 1 ? list.find((x) => set.has(x.id)).label : `${set.size} ${many}`);
const dateLabel = () => (!ui.from && !ui.to ? 'Date Range' : ui.from && ui.to ? `${ui.from} → ${ui.to}` : ui.from ? `From ${ui.from}` : `Until ${ui.to}`);

export function renderMedia(app) {
  const { state } = app;
  const all = filtered(state);
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / ui.size));
  ui.page = Math.min(ui.page, pages);
  const start = (ui.page - 1) * ui.size;
  const rows = all.slice(start, start + ui.size);
  ui.selected = ui.selected.filter((id) => state.media.some((m) => m.id === id));
  const allOnPage = rows.length > 0 && rows.every((m) => ui.selected.includes(m.id));

  const page = h(`<div class="page lib">
    <input type="file" hidden accept="image/*,video/*,application/pdf,.xlsx,.csv,.pptx,.docx">
    <div class="lib-head">
      <div class="lib-title"><h1>Media Library</h1>
        <div class="row">
          <button class="btn pill-out ${ui.selecting ? 'sel' : ''}" data-act="select">${icon('SquareCheck', 'ico sm')} ${ui.selecting ? 'Cancel' : 'Select'}</button>
          <button class="btn pill-out" data-act="email" title="Load last 2 days from email" ${ui.loadingEmail ? 'disabled' : ''}>${icon('RefreshCw', `ico sm ${ui.loadingEmail ? 'spin' : ''}`)} ${ui.loadingEmail ? 'Loading…' : 'Load Email'}</button>
          <button class="btn pill blue" data-act="upload" ${ui.uploading ? 'disabled' : ''}>${icon(ui.uploading ? 'LoaderCircle' : 'Upload', `ico sm ${ui.uploading ? 'spin' : ''}`)} ${ui.uploading ? 'Uploading...' : 'Upload'}</button>
        </div></div>
      <div class="filters">
        <label class="search">${icon('Search', 'ico sm')}<input name="media-search" placeholder="Search media..." value="${esc(ui.search)}" autocomplete="off"></label>
        <button class="fpill ${ui.cats.size ? 'on' : ''}" data-dd="cats">${icon('Folder', 'ico xs')} ${esc(pillLabel(ui.cats, CATEGORIES, 'All Media', 'filters'))} ${icon('ChevronDown', 'ico xs')}</button>
        <button class="fpill ${ui.sources.size ? 'on' : ''}" data-dd="sources">${icon('Mail', 'ico xs')} ${esc(pillLabel(ui.sources, SOURCES, 'Source', 'sources'))} ${icon('ChevronDown', 'ico xs')}</button>
        <button class="fpill ${ui.from || ui.to ? 'on' : ''}" data-dd="dates">${icon('CalendarRange', 'ico xs')} ${esc(dateLabel())} ${icon('ChevronDown', 'ico xs')}</button>
      </div>
    </div>
    <div class="lib-body">
      <div class="lib-bar">${ui.selecting
        ? `<div class="row"><span class="muted">${ui.selected.length} selected</span><button class="link-btn blue" data-act="all">${allOnPage ? 'Deselect all' : 'Select all'}</button></div>
           <div class="row"><button class="btn caps-pill blue" data-act="push-sel" ${ui.selected.length ? '' : 'disabled'}>${icon('MonitorPlay', 'ico xs')} ${ui.selected.length ? `Push selected (${ui.selected.length})` : 'Push selected'}</button>
             <button class="btn caps-pill red" data-act="del-sel" ${ui.selected.length ? '' : 'disabled'}>${icon('Trash2', 'ico xs')} Delete${ui.selected.length ? ` (${ui.selected.length})` : ''}</button>
             <button class="btn caps-pill" data-act="select">${icon('X', 'ico xs')} Cancel</button></div>`
        : `<span class="muted">Showing ${ui.cats.size ? esc([...ui.cats].map((c) => CATEGORIES.find((x) => x.id === c).label).join(', ')) : 'All Files'} <span class="dim">(${total})</span></span>`}</div>
      ${total === 0 && !ui.uploading
        ? `<div class="empty">${icon('Folder', 'ico lg')}<b>No assets found</b><span style="font-size:12px">Upload a file or add a link to get started.</span></div>`
        : `<div class="tbl-wrap"><table class="tbl lib-tbl"><thead><tr>${ui.selecting ? '<th style="width:40px"></th>' : ''}<th>Name</th><th>Type</th><th>Source</th><th>Size</th><th>Date</th><th class="r">Actions</th></tr></thead><tbody>
          ${ui.uploading ? `<tr><td colspan="${ui.selecting ? 7 : 6}"><span class="row muted">${icon('LoaderCircle', 'ico sm spin blue-t')} Uploading asset…</span></td></tr>` : ''}
          ${rows.map((m) => {
            const sel = ui.selected.includes(m.id);
            return `<tr data-id="${esc(m.id)}" class="${sel ? 'picked' : ''}">
              ${ui.selecting ? `<td><button class="cbox ${sel ? 'on' : ''}" data-act="tick" aria-label="${sel ? 'Deselect' : 'Select'} ${esc(m.name)}">${sel ? icon('Check', 'ico xs') : ''}</button></td>` : ''}
              <td><div class="row" style="flex-wrap:nowrap;gap:12px"><span class="lib-thumb">${thumb(m)}</span><span class="lib-name" title="${esc(m.name)}">${esc(m.name)}</span></div></td>
              <td><span class="lib-type">${typeIcon(m.type, 'ico xs')} ${esc(FILE_LABELS[m.type] ?? m.type)}</span></td>
              <td>${m.source ? `<span class="src ${esc(m.source)}">${esc(SOURCES.find((s) => s.id === m.source)?.label ?? m.source)}</span>` : '<span class="dim">—</span>'}</td>
              <td class="muted">${esc(app.size(m))}</td><td class="muted">${esc(app.date(m))}</td>
              <td class="r"><button class="icon-btn round" data-act="kebab" aria-label="Actions">${icon('EllipsisVertical')}</button></td></tr>`;
          }).join('')}
        </tbody></table></div>
        <div class="pager"><div class="row"><span class="muted xs">${total ? start + 1 : 0}–${Math.min(start + ui.size, total)} of ${total}</span>
            <label class="muted xs row" style="gap:6px">Rows per page <select class="mini-select" name="page-size">${PAGE_SIZES.map((n) => `<option ${n === ui.size ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
          ${pages > 1 ? `<div class="row" style="gap:4px"><button class="icon-btn round" data-act="prev" ${ui.page === 1 ? 'disabled' : ''} aria-label="Previous page">${icon('ChevronLeft')}</button>
            <span class="muted xs">Page ${ui.page} of ${pages}</span>
            <button class="icon-btn round" data-act="next" ${ui.page === pages ? 'disabled' : ''} aria-label="Next page">${icon('ChevronRight')}</button></div>` : ''}</div>`}
    </div>
  </div>`);

  const input = page.querySelector('input[type=file]');
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    ui.uploading = true;
    app.refresh();
    await new Promise((r) => setTimeout(r, 500));   // the real upload's round trip, so the row shows
    ui.uploading = false;
    app.addMedia(file);
  });

  const search = page.querySelector('[name="media-search"]');
  search.addEventListener('input', () => {
    ui.search = search.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { ui.applied = ui.search; ui.page = 1; app.refresh(); }, 300);
  });
  page.querySelector('[name="page-size"]')?.addEventListener('change', (e) => { ui.size = Number(e.target.value); ui.page = 1; app.refresh(); });

  page.querySelectorAll('[data-dd]').forEach((b) => b.addEventListener('click', () => filterMenu(app, b)));

  page.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const row = e.target.closest('tr[data-id]');
    const m = row && state.media.find((x) => x.id === row.dataset.id);
    if (act === 'select') { ui.selecting = !ui.selecting; ui.selected = []; app.refresh(); return; }
    if (act === 'upload') { input.click(); return; }
    if (act === 'email') {
      ui.loadingEmail = true;
      app.refresh();
      await new Promise((r) => setTimeout(r, 900));
      ui.loadingEmail = false;
      const n = app.loadEmail();
      toast(n ? `Loaded ${n} item${n === 1 ? '' : 's'} from email` : 'Nothing new in the last 2 days');
      return;
    }
    if (act === 'all') { ui.selected = allOnPage ? [] : rows.map((x) => x.id); app.refresh(); return; }
    if (act === 'push-sel') { queuePushModal(app, ui.selected.map((id) => state.media.find((x) => x.id === id)).filter(Boolean)); return; }
    if (act === 'del-sel') {
      const n = ui.selected.length;
      if (!confirm(`Delete ${n} selected item${n === 1 ? '' : 's'}? This can't be undone.`)) return;
      app.removeMedia(ui.selected);
      ui.selected = [];
      return;
    }
    if (act === 'prev') { ui.page -= 1; app.refresh(); return; }
    if (act === 'next') { ui.page += 1; app.refresh(); return; }
    if (act === 'kebab' && m) { rowMenu(app, m, e.target.closest('[data-act]')); return; }
    if (!m) return;
    if (ui.selecting) {
      ui.selected = ui.selected.includes(m.id) ? ui.selected.filter((x) => x !== m.id) : [...ui.selected, m.id];
      app.refresh();
    } else mediaPushModal(app, m);
  });

  // Video thumbnails play while pointed at, as in the real table.
  page.querySelectorAll('.lib-thumb video').forEach((v) => {
    v.addEventListener('mouseover', () => v.play().catch(() => {}));
    v.addEventListener('mouseout', () => v.pause());
  });
  return page;
}

/** The small square at the start of a row. */
function thumb(m) {
  if (m.type === 'image') return `<img src="${esc(m.url)}" alt="" loading="lazy" decoding="async">`;
  if (m.type === 'video') return `<video src="${esc(m.url)}" preload="metadata" muted playsinline loop></video>`;
  if (m.type === 'youtube') {
    const id = youTubeId(m.url);
    return `${icon('Play', 'ico sm')}${id ? `<img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" alt="" onerror="this.remove()">` : ''}`;
  }
  return typeIcon(m.type, 'ico sm');
}

function rowMenu(app, m, anchor) {
  dropdown(anchor, `<button data-m="copy">${icon('Copy')} Copy Link</button>
    ${isLinkType(m.type) ? '' : `<a data-m="dl" href="${esc(m.url)}" download="${esc(m.name)}">${icon('Download')} Download</a>`}
    <hr><button data-m="delete" class="danger">${icon('Trash2')} Delete</button>`, {
    align: 'end',
    width: 192,
    onMount(el, close) {
      el.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-m]')?.dataset.m;
        if (!act) return;
        if (act === 'dl') { setTimeout(close); return; }
        close();
        if (act === 'copy') { if (await copyText(new URL(m.url, location.href).href)) toast('Copied!'); }
        if (act === 'delete' && await confirmDialog({ title: `Delete "${m.name}"?`, body: 'It is removed from the library and from any screen showing it.' })) app.removeMedia([m.id]);
      });
    },
  });
}

function filterMenu(app, anchor) {
  const which = anchor.dataset.dd;
  if (which === 'dates') {
    dropdown(anchor, '<div class="dd-pad"></div>', {
      onMount(el) {
        rangeCalendar(el.querySelector('.dd-pad'), {
          from: ui.from, to: ui.to,
          onChange: (from, to) => { ui.from = from; ui.to = to; ui.page = 1; app.refresh(); },
        });
      },
    });
    return;
  }
  const list = which === 'cats' ? CATEGORIES : SOURCES;
  const set = which === 'cats' ? ui.cats : ui.sources;
  const draw = (el) => {
    el.innerHTML = list.map((x) => `<button data-id="${x.id}" class="check ${set.has(x.id) ? 'on' : ''}"><span class="cmark">${set.has(x.id) ? icon('Check', 'ico xs') : ''}</span>${icon(x.icon, 'ico xs dim')} ${x.label}</button>`).join('')
      + (set.size ? '<hr><button data-clear class="muted">Clear filters</button>' : '');
  };
  dropdown(anchor, '', {
    width: which === 'cats' ? 224 : 192,
    onMount(el) {
      draw(el);
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-clear]')) set.clear();
        else {
          const id = e.target.closest('[data-id]')?.dataset.id;
          if (!id) return;
          if (set.has(id)) set.delete(id); else set.add(id);
        }
        ui.page = 1;
        draw(el);
        app.refresh();   // the menu stays open while filters change, as in the real one
      });
    },
  });
}
