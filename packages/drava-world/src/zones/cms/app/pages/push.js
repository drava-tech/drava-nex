// The push-to-screen dialog (components/push-to-screen-modal.tsx in the real Nex): a preview
// of the content on the left, the screens on the right zone by zone (live dot and what each
// shows), pick one or more, in any zones, and push. Media, the media queue, whiteboards and the Browser all use it.

import { Mirror, esc, h, icon, isLinkType, modal, toast, typeIcon } from '../ui.js';
import { mediaContent } from '../../shared/state.js';

/**
 * opts:
 *   contentName, subtitle   heading of the screens pane
 *   preview(el)             fill the preview pane; may return a cleanup function. Omit for a compact dialog.
 *   isAlreadyShowing(s)     pre-selects the screens already showing it
 *   single                  only one screen at a time (a queue)
 *   onPush(ids)             do the push
 *   onPushed(ids)           after pushing; default: open the first screen's control page
 *   onSkip, skipLabel       an extra button under Push ("Draw without pushing")
 */
export function pushModal(app, opts) {
  const { state } = app;
  const pre = state.screens.filter((s) => opts.isAlreadyShowing?.(s)).map((s) => s.id);
  let selected = opts.single ? pre.slice(0, 1) : pre;
  let needs = selected.length === 0;
  let cleanup = null;
  // The screens are listed one zone at a time: the zone of a screen already showing it, or the kiosk's own.
  const zones = app.zones();
  let zone = zones.find((z) => z.screens.some((s) => selected.includes(s.id)))?.id ?? app.home;

  const close = modal(`
    ${opts.preview ? `<div class="pv-pane"><div class="pv-box"></div><button class="pv-x icon-btn" data-close aria-label="Close preview">${icon('X')}</button></div>` : ''}
    <div class="ps-pane">
      <div class="ps-head"><div style="min-width:0"><h2 title="${esc(opts.contentName)}">${esc(opts.contentName)}</h2>${opts.subtitle ? `<div class="sub">${opts.subtitle}</div>` : ''}</div>
        <button class="icon-btn" data-close aria-label="Close">${icon('X')}</button></div>
      <div class="ps-label">${icon('MonitorPlay', 'ico sm')} Push to screen</div>
      <div class="ps-zones" role="tablist" aria-label="Zone"></div>
      <div class="ps-list"></div>
      <div class="ps-foot">
        ${opts.onSkip ? `<button class="btn ghost-caps" data-skip>${esc(opts.skipLabel ?? 'Skip')}</button>` : ''}
        <button class="btn blue-lg" data-push></button>
      </div>
    </div>`, {
    cls: `push ${opts.preview ? 'with-preview' : ''}`,
    onClose: () => cleanup?.(),
    onMount(el, closeIt) {
      if (opts.preview) cleanup = opts.preview(el.querySelector('.pv-box')) ?? null;
      const list = el.querySelector('.ps-list');
      const tabs = el.querySelector('.ps-zones');
      const push = el.querySelector('[data-push]');
      const draw = () => {
        tabs.innerHTML = zones.map((z) => {
          const n = z.screens.filter((s) => selected.includes(s.id)).length;
          return `<button class="ps-zone ${z.id === zone ? 'on' : ''}" data-zone="${esc(z.id)}" role="tab" aria-selected="${z.id === zone}" title="${esc(z.title)}">
            <span class="zn-n">${esc(z.n)}</span>${esc(z.name)}${n ? `<i class="ps-count">${n}</i>` : ''}</button>`;
        }).join('');
        const screens = zones.find((z) => z.id === zone)?.screens ?? [];
        list.classList.toggle('needs', needs);
        list.innerHTML = screens.length ? screens.map((s) => {
          const on = selected.includes(s.id), online = app.isOnline(s.id);
          return `<button class="ps-row ${on ? 'on' : ''}" data-id="${esc(s.id)}"><i class="dot ${online ? 'on' : ''}"></i>
            <span class="ps-name"><b>${esc(s.name)}</b><small>${s.blanked ? 'Stopped' : esc(app.label(s) ?? 'Idle')}</small></span>${on ? icon('Check') : ''}</button>`;
        }).join('') + (needs ? '<p class="ps-need">Select a screen to push to</p>' : '') : '<p class="muted center">No screens registered yet</p>';
        push.innerHTML = `${icon('MonitorPlay')} ${selected.length ? `Push to ${selected.length}` : 'Select a screen'}`;
      };
      tabs.addEventListener('click', (e) => {
        const id = e.target.closest('[data-zone]')?.dataset.zone;
        if (id) { zone = id; draw(); }
      });
      list.addEventListener('click', (e) => {
        const id = e.target.closest('[data-id]')?.dataset.id;
        if (!id) return;
        needs = false;
        if (opts.single) selected = selected[0] === id ? [] : [id];
        else selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
        draw();
      });
      push.addEventListener('click', () => {
        if (!selected.length) { needs = true; draw(); return; }
        const ids = [...selected];
        opts.onPush(ids);
        closeIt();
        if (opts.onPushed) opts.onPushed(ids);
        else app.go(`/screens/${encodeURIComponent(ids[0])}`);
      });
      el.querySelector('[data-skip]')?.addEventListener('click', () => { closeIt(); opts.onSkip(); });
      draw();
    },
  });
  return close;
}

/** Push one media asset: its preview, then the screens. */
export function mediaPushModal(app, m) {
  return pushModal(app, {
    contentName: m.name,
    subtitle: `<span class="caps-sm">${esc(m.type)}</span>${m.sizeBytes ? ` · ${esc(app.size(m))}` : ''} · ${esc(app.date(m))}`,
    preview: (el) => mediaPreview(el, m),
    isAlreadyShowing: (s) => s.content?.kind === 'media' && s.content.id === m.id && !s.queue,
    onPush: (ids) => app.assign(ids, { kind: 'media', id: m.id }),
  });
}

/** Push a set of media as a queue to ONE screen; it plays in the order they were picked. */
export function queuePushModal(app, items) {
  const n = items.length;
  return pushModal(app, {
    contentName: `${n} item${n === 1 ? '' : 's'} selected`,
    subtitle: `Plays in the order selected · ${n} item${n === 1 ? '' : 's'}`,
    single: true,
    preview: (el) => {
      el.innerHTML = `<div class="q-stack">${items.slice(0, 6).map((m, i) => `<div class="q-tile">${m.type === 'image' ? `<img src="${esc(m.url)}" alt="">` : `<span class="q-ico">${typeIcon(m.type, 'ico lg')}</span>`}<span class="q-n">${i + 1}</span></div>`).join('')}
        ${n > 6 ? `<div class="q-tile more">+${n - 6} more</div>` : ''}</div>`;
    },
    onPush: ([id]) => app.assignQueue(id, items.map((m) => m.id)),
  });
}

/**
 * The asset itself, as a screen would show it: images and videos as they are, PDFs, pages and
 * YouTube in a frame, a spreadsheet as a table; anything else (an uploaded deck or Word
 * file) as the card the walls show. Returns a cleanup function.
 */
export function mediaPreview(el, m) {
  if (m.type === 'image') { el.innerHTML = `<img class="pv-media" src="${esc(m.url)}" alt="${esc(m.name)}">`; return null; }
  if (m.type === 'video') { el.innerHTML = `<video class="pv-media" src="${esc(m.url)}" controls playsinline autoplay></video>`; return () => el.querySelector('video')?.pause(); }
  const embed = embedUrl(m);
  if (embed) {
    el.innerHTML = `<iframe class="pv-frame" src="${esc(embed)}" title="${esc(m.name)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" allow="autoplay; encrypted-media; fullscreen"></iframe>
      <button class="pv-reload icon-btn" title="Reload" aria-label="Reload">${icon('RotateCw')}</button>
      ${m.type === 'link' ? `<div class="pv-hint" hidden>${icon('TriangleAlert', 'ico sm warn')}<div><b>Nothing rendered yet</b><span>This site may refuse to be embedded. Opening it in a new tab always works.</span></div>
        <button class="btn pill blue" data-open>${icon('ExternalLink', 'ico sm')} Open</button></div>` : ''}`;
    el.querySelector('.pv-reload').addEventListener('click', () => { const f = el.querySelector('iframe'); f.src = f.src; });
    el.querySelector('[data-open]')?.addEventListener('click', () => open(m.url, '_blank', 'noopener'));
    const hint = el.querySelector('.pv-hint');
    const t = hint ? setTimeout(() => { hint.hidden = false; }, 4000) : null;
    return () => clearTimeout(t);
  }
  if (m.type === 'sheet' && /\.csv($|\?)/i.test(m.url) || (m.type === 'sheet' && m.url.startsWith('blob:') && /\.csv$/i.test(m.name))) {
    el.innerHTML = '<div class="pv-sheet muted center">Loading…</div>';
    fetch(m.url).then((r) => r.text()).then((text) => {
      const rows = text.trim().split(/\r?\n/).slice(0, 60).map((line) => line.split(','));
      el.querySelector('.pv-sheet').outerHTML = `<div class="pv-sheet"><table>${rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join('')}</tr>`).join('')}</table></div>`;
    }).catch(() => { el.querySelector('.pv-sheet').textContent = 'Could not read this file.'; });
    return null;
  }
  const box = h('<div class="pv-card"></div>');
  el.replaceChildren(box);
  const mirror = new Mirror(box);
  mirror.show(mediaContent(m));
  return () => mirror.destroy();
}

/** The address a frame should load for a PDF, a page or a YouTube / Drive link, or null. */
export function embedUrl(m) {
  if (m.type === 'document') return m.url;
  if (m.type === 'youtube') { const id = youTubeId(m.url); return id ? `https://www.youtube.com/embed/${id}` : m.url; }
  if (m.type === 'drive') return m.url.replace(/\/(view|edit)(\?.*)?$/, '/preview');
  if (isLinkType(m.type)) return m.url;
  return null;
}

export function youTubeId(url) {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

const EXT_TYPES = {
  pdf: 'document', doc: 'word', docx: 'word', xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ppt: 'presentation', pptx: 'presentation',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', mp4: 'video', webm: 'video', mov: 'video',
};

/**
 * What a pasted link is (classifyLink in the real @platform/types): { type, url, name } or
 * null when it isn't an address. A bare host gains https://.
 */
export function classifyLink(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (!/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s)) return null;
    s = `https://${s}`;
  }
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!u.hostname.includes('.')) return null;
  const url = u.toString();
  if (youTubeId(url)) return { type: 'youtube', url, name: 'YouTube video' };
  if (/(^|\.)(drive|docs)\.google\.com$/.test(u.hostname)) {
    const kind = u.pathname.split('/')[1];
    return { type: 'drive', url, name: kind === 'spreadsheets' ? 'Google Sheet' : kind === 'document' ? 'Google Doc' : kind === 'presentation' ? 'Google Slides' : 'Drive file' };
  }
  const ext = (u.pathname.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  if (EXT_TYPES[ext]) return { type: EXT_TYPES[ext], url, name: decodeURIComponent(u.pathname.split('/').pop() || '') || u.hostname.replace(/^www\./, '') };
  return { type: 'link', url, name: u.hostname.replace(/^www\./, '') };
}
