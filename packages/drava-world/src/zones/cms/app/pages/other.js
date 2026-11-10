// Settings (settings/page.tsx: Experience Types) and the Browser (browser/_components/
// browser-view.tsx: paste any link and send it to screens), plus this replica's own
// "Reset demo".

import { FILE_LABELS } from '../../shared/render.js';
import { esc, h, icon, toast } from '../ui.js';
import { classifyLink } from './push.js';

export function renderSettings(app) {
  const { state } = app;
  const page = h(`<div class="page settings">
    <div><h1 class="h1-lg">Settings</h1><p class="muted">Manage workspace configuration.</p></div>
    <section class="stack" style="gap:16px">
      <div><h2 class="h2">Experience Types</h2><p class="muted">Create the types people can assign when building a new experience.</p></div>
      <div class="stack" style="gap:16px;max-width:672px">
        <form class="row" style="align-items:flex-start">
          <input class="input sm" name="type" placeholder="e.g. Retail, Lobby, Wayfinding" required style="width:256px">
          <button class="btn solid sm" disabled>Add Type</button>
        </form>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th class="r">Actions</th></tr></thead><tbody>
          ${state.experienceTypes.length === 0 ? '<tr><td colspan="2" class="center muted" style="padding:24px">No experience types yet. Add one above.</td></tr>'
            : state.experienceTypes.map((t) => `<tr data-id="${esc(t.id)}"><td class="fw5">${esc(t.name)}</td><td class="r"><button class="btn red-solid sm" data-act="delete">Delete</button></td></tr>`).join('')}
        </tbody></table></div>
      </div>
    </section>
    <section class="stack" style="gap:16px">
      <div><h2 class="h2">Demo data</h2><p class="muted">This Nex runs entirely in your browser. Screens, assignments, devices, boards and edits are kept here; uploaded files last for this visit only.</p></div>
      <div><button class="btn danger" data-act="reset">${icon('RotateCcw', 'ico sm')} Reset demo</button></div>
    </section>
  </div>`);
  const f = page.querySelector('form');
  f.type.addEventListener('input', () => { f.querySelector('button').disabled = !f.type.value.trim(); });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = f.type.value.trim();
    if (state.experienceTypes.some((t) => t.name.toLowerCase() === name.toLowerCase())) { toast('That type already exists.', 'err'); return; }
    app.addType(name);
  });
  page.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'delete' && confirm('Delete this type? It will be removed from all experiences.')) app.deleteType(e.target.closest('tr').dataset.id);
    if (act === 'reset' && confirm('Reset the demo? Every screen goes back to idle and uploads are removed.')) { app.reset(); toast('Demo reset'); }
  });
  return page;
}

/* ---------------------------------------------------------------- browser */

const LINK_LABELS = { ...FILE_LABELS, youtube: 'YouTube video', drive: 'Google Drive', document: 'PDF document' };
const browser = { url: '', name: '', selected: [], live: null };

export function renderBrowser(app) {
  const { state } = app;
  const detected = browser.url.trim() ? classifyLink(browser.url) : null;
  const liveScreen = browser.live && state.screens.find((s) => s.id === browser.live.screenId);
  const media = browser.live && state.media.find((m) => m.id === browser.live.mediaId);
  const page = h(`<div class="page browser">
    <div class="br-left">
      <h1 style="font-size:16px;margin:0">Browser</h1>
      <div class="stack" style="gap:16px">
        <div><label class="field-label" for="br-url">URL</label>
          <label class="search wide">${icon('Link2', 'ico sm')}<input id="br-url" name="br-url" inputmode="url" placeholder="example.com, or paste any link" value="${esc(browser.url)}" spellcheck="false" autocomplete="off"></label>
          <p class="hint" data-hint></p></div>
        <div><label class="field-label" for="br-name">Display name <span class="dim">(optional)</span></label>
          <input class="input lg" id="br-name" name="br-name" value="${esc(browser.name)}" placeholder="${esc(detected?.name ?? 'Auto-detected')}"></div>
      </div>
      <div class="stack grow" style="gap:6px;min-height:0">
        <div class="ps-label" style="padding:0">${icon('MonitorPlay', 'ico sm')} Screens</div>
        <div class="ps-list" style="padding:0">${state.screens.map((s) => {
          const on = browser.selected.includes(s.id);
          return `<button class="ps-row ${on ? 'on' : ''}" data-id="${esc(s.id)}"><i class="dot ${app.isOnline(s.id) ? 'on' : ''}"></i>
            <span class="ps-name"><b>${esc(s.name)}</b><small>${s.blanked ? 'Stopped' : esc(app.label(s) ?? 'Idle')}</small></span>${on ? icon('Check') : ''}</button>`;
        }).join('')}</div>
      </div>
      <button class="btn blue-lg" data-send ${detected && browser.selected.length ? '' : 'disabled'}>${icon('MonitorPlay')} ${browser.selected.length ? `Send to ${browser.selected.length} screen${browser.selected.length > 1 ? 's' : ''}` : 'Select a screen'}</button>
    </div>
    <div class="br-right">${liveScreen ? `
      <div class="br-live"><span class="row" style="gap:8px">${icon('Radio', 'ico sm green-t')} Currently controlling <b>${esc(liveScreen.name)}</b></span>
        ${media?.pending ? `<button class="btn pill blue" data-save>${icon('Save', 'ico sm')} Save to Media Library</button>` : media ? '<span class="xs muted">Saved in the Media Library</span>' : ''}</div>
      <div class="br-pad">${app.slot(`browser:${liveScreen.id}`, app.resolve(liveScreen))}</div>`
      : `<div class="empty" style="padding:0">${icon('MonitorPlay', 'ico xl')}<span>Send a link to a screen to start controlling it here.</span></div>`}</div>
  </div>`);

  const urlIn = page.querySelector('[name="br-url"]'), nameIn = page.querySelector('[name="br-name"]'), hint = page.querySelector('[data-hint]');
  const send = page.querySelector('[data-send]');
  const showHint = () => {
    const d = browser.url.trim() ? classifyLink(browser.url) : null;
    hint.className = `hint ${browser.url.trim() && !d ? 'warn' : d ? 'ok' : ''}`;
    hint.innerHTML = browser.url.trim() && !d ? 'That isn’t an address — enter a domain or a full http(s) link'
      : d ? `Detected: ${esc(LINK_LABELS[d.type] ?? d.type)}${d.url !== browser.url.trim() ? `<span class="dim"> · saves as ${esc(d.url)}</span>` : ''}`
        : '<span class="dim">Any link — video, Drive, PDF, image or a whole web page</span>';
    nameIn.placeholder = d?.name ?? 'Auto-detected';
    send.disabled = !d || !browser.selected.length;
  };
  urlIn.addEventListener('input', () => { browser.url = urlIn.value; showHint(); });
  nameIn.addEventListener('input', () => { browser.name = nameIn.value; });
  showHint();
  page.querySelector('.ps-list').addEventListener('click', (e) => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!id) return;
    browser.selected = browser.selected.includes(id) ? browser.selected.filter((x) => x !== id) : [...browser.selected, id];
    app.refresh();
  });
  send.addEventListener('click', () => {
    const d = classifyLink(browser.url);
    if (!d || !browser.selected.length) return;
    const id = app.addLink({ ...d, name: browser.name.trim() || d.name });
    app.assign(browser.selected, { kind: 'media', id });
    browser.live = { screenId: browser.selected.find((s) => app.isOnline(s)) ?? browser.selected[0], mediaId: id };
    browser.url = '';
    browser.name = '';
    app.refresh();
  });
  page.querySelector('[data-save]')?.addEventListener('click', () => { app.saveLink(media.id); toast('Saved to the Media Library'); });
  return page;
}
