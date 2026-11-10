// The canvas's three edges, as in Push: the screens docked Top, Left and Right (up to six on an
// edge), each showing its status, what it shows faintly behind its name, and a menu to move,
// link or remove it. A split screen's parts sit on its edge one after another, each taking
// media of its own. Between two whole screens next to each other, a button links them (a push
// to either shows on both). An empty place offers "Assign screen"; + adds one. A screen
// showing the shared canvas says so and is locked until sharing stops there.

import { Mirror, dropdown, esc, icon } from '../app/ui.js';
import { mediaContent } from '../shared/state.js';
import { justDragged, mark, nearestEdge, startDrag } from './drag.js';
import { EDGES, EDGE_LABELS, MAX_ON_EDGE, baseId, layoutOf, zoneOf } from './state.js';

export function initEdges(app, stage) {
  const mirrors = new Map();   // slot entry → Mirror

  function slot(entry, edge, i) {
    const { state } = app;
    if (!entry) {
      return `<button type="button" class="pc-slot empty" data-act="assign" data-edge="${edge}" data-i="${i}" aria-label="Assign a screen to this ${EDGE_LABELS[edge].toLowerCase()} placeholder" title="Assign a screen to ${EDGE_LABELS[edge]}, or drop one here">
        ${icon('Plus', 'ico sm')}<span>Assign screen</span></button>`;
    }
    const id = baseId(entry), zone = zoneOf(entry);
    const s = app.screen(id);
    if (!s) return '';
    const st = app.status(s);
    if (state.share.includes(id)) {
      return `<section class="pc-slot on sharing" data-screen="${esc(id)}" data-edge="${edge}" data-i="${i}" title="“${esc(s.name)}” is showing the shared canvas: locked until sharing stops there">
        ${icon('Presentation', 'ico sm')}<span class="pc-sname">Showing your canvas</span>
        <button type="button" class="pc-ib" data-act="share-menu" aria-label="${esc(s.name)}: sharing">${icon('EllipsisVertical', 'ico xs')}</button></section>`;
    }
    const z = zone ? layoutOf(s.layout).zones.find((x) => x.id === zone) : null;
    const name = z ? `${s.name} · ${z.label}` : s.name;
    const mid = z ? s.zoneMedia?.[zone] : s.mediaId;
    const showing = s.blanked ? 'Stopped' : app.media(mid)?.name ?? 'Nothing';
    const linked = app.linkedWith(id).map((x) => app.screen(x)?.name).filter(Boolean);
    const tip = [z && 'Drop media here to show it in this part', `Showing: ${showing}`, linked.length && `Linked with ${linked.join(', ')}`, 'Drag to move it'].filter(Boolean).join('\n');
    return `<section class="pc-slot on" data-screen="${esc(id)}" data-zone="${esc(zone ?? '')}" data-edge="${edge}" data-i="${i}" data-entry="${esc(entry)}" title="${esc(tip)}" aria-label="${esc(name)}: ${st.text}">
      <div class="pc-slot-shot" data-shot="${esc(entry)}"></div>
      <span class="pc-dot ${st.dot}"></span>
      ${linked.length ? `<span class="pc-linked" aria-label="Linked">${icon('Link', 'ico xs')}</span>` : ''}
      <span class="pc-sname">${esc(name)}</span>
      <button type="button" class="pc-ib" data-act="slot-menu" aria-label="${esc(s.name)}: move, link or remove">${icon('EllipsisVertical', 'ico xs')}</button></section>`;
  }

  function render() {
    const { state } = app;
    const used = new Set();
    for (const edge of EDGES) {
      const el = stage.querySelector(`.pc-edge.${edge}`);
      const list = state.slots[edge];
      const parts = list.some((x) => x?.includes('#'));
      let html = '';
      list.forEach((entry, i) => {
        // Link two whole screens side by side.
        const prev = i > 0 ? list[i - 1] : null;
        const a = prev && !prev.includes('#') && app.screen(prev), b = entry && !entry.includes('#') && app.screen(entry);
        if (a && b && a.layout === 'single' && b.layout === 'single' && a.id !== b.id) {
          const on = app.linkedWith(a.id).includes(b.id);
          html += `<button type="button" class="pc-link ${on ? 'on' : ''}" data-act="link" data-a="${esc(a.id)}" data-b="${esc(b.id)}" aria-pressed="${on}"
            aria-label="${on ? `Unlink ${esc(b.name)} from ${esc(a.name)}` : `Link ${esc(a.name)} and ${esc(b.name)}`}"
            title="${on ? `Linked: a push to either shows on both. Click to unlink “${esc(b.name)}”.` : `Link “${esc(a.name)}” and “${esc(b.name)}”: a push to either shows on both`}">${icon(on ? 'Link' : 'Unlink', 'ico xs')}</button>`;
        }
        html += slot(entry, edge, i);
        if (entry) used.add(entry);
      });
      if (!parts && list.length < MAX_ON_EDGE) {
        html += `<button type="button" class="pc-add" data-act="add-slot" data-edge="${edge}" aria-label="Add a screen placeholder to ${EDGE_LABELS[edge].toLowerCase()}" title="Add a screen placeholder to ${EDGE_LABELS[edge].toLowerCase()}">${icon('Plus', 'ico sm')}</button>`;
      }
      el.innerHTML = html;
    }
    // What each screen (or part) shows, faintly behind its name.
    for (const [k, m] of mirrors) if (!used.has(k)) { m.destroy(); mirrors.delete(k); }
    for (const entry of used) {
      const box = stage.querySelector(`[data-shot="${CSS.escape(entry)}"]`);
      if (!box) continue;
      let m = mirrors.get(entry);
      if (!m) { m = new Mirror(document.createElement('div')); mirrors.set(entry, m); }
      box.append(m.el);
      const s = app.screen(baseId(entry)), zone = zoneOf(entry);
      const med = app.media(zone ? s.zoneMedia?.[zone] : s.mediaId);
      m.show(med && !s.blanked ? { ...mediaContent(med), muted: true } : { kind: 'blank', screenId: entry });
    }
  }

  /* ---- clicks ---- */

  stage.addEventListener('click', (e) => {
    if (justDragged()) return;
    const b = e.target.closest('[data-act]');
    if (!b || !b.closest('.pc-edge')) return;
    const s = b.closest('.pc-slot');
    const edge = b.dataset.edge ?? s?.dataset.edge;
    const i = Number(b.dataset.i ?? s?.dataset.i);
    if (b.dataset.act === 'add-slot') app.act.addSlot(edge);
    if (b.dataset.act === 'assign') assignMenu(b, edge, i);
    if (b.dataset.act === 'slot-menu') slotMenu(b, s.dataset.screen, edge, i, s.dataset.zone);
    if (b.dataset.act === 'share-menu') shareMenu(b, s.dataset.screen);
    if (b.dataset.act === 'link') {
      const { a, b: bb } = b.dataset;
      if (app.linkedWith(a).includes(bb)) app.act.unlink(bb); else app.act.link(a, bb);
    }
  });

  function assignMenu(anchor, edge, i) {
    const placed = new Set(EDGES.flatMap((e) => app.state.slots[e]).filter(Boolean).map(baseId));
    const free = app.state.screens.filter((s) => !placed.has(s.id));
    dropdown(anchor, `<div class="dd-label">Choose a screen for ${edge}</div><hr>
      ${app.state.screens.length ? free.length ? free.map((s) => `<button data-id="${esc(s.id)}"><i class="pc-dot ${app.status(s).dot}"></i>${esc(s.name)}${s.layout !== 'single' ? `<small class="dd-side">${esc(layoutOf(s.layout).label)}</small>` : ''}</button>`).join('') : '<p class="dd-empty">Every screen is on an edge.</p>' : '<p class="dd-empty">No screens yet.</p>'}
      <hr><button data-rm class="danger">${icon('X', 'ico sm')} Remove placeholder</button>`, {
      width: 230,
      onMount(menu, close) {
        menu.addEventListener('click', (e) => {
          if (e.target.closest('[data-rm]')) { close(); app.act.removeSlot(edge, i); return; }
          const id = e.target.closest('[data-id]')?.dataset.id;
          if (!id) return;
          close();
          app.act.place(id, edge, i);
        });
      },
    });
  }

  function slotMenu(anchor, id, edge, i, zone) {
    const s = app.screen(id);
    const part = !!zone;
    const vertical = edge !== 'top';
    const len = app.state.slots[edge].length;
    const linked = app.linkedWith(id);
    const others = app.state.screens.filter((x) => x.id !== id && x.layout === 'single');
    dropdown(anchor, `<div class="dd-label">${esc(s.name)}</div><hr>
      <div class="dd-sub">${icon('Move', 'ico sm')} Move to</div>
      ${EDGES.map((e) => `<button data-move="${e}" class="ind" ${e === edge ? 'disabled' : ''}>${EDGE_LABELS[e]}${e === edge ? '<small class="dd-side">here</small>' : ''}</button>`).join('')}
      ${!part ? `<button data-shift="-1" ${i === 0 ? 'disabled' : ''}>${icon(vertical ? 'ArrowUp' : 'ChevronLeft', 'ico sm')} ${vertical ? 'Move up' : 'Move left'}</button>
        <button data-shift="1" ${i >= len - 1 ? 'disabled' : ''}>${icon(vertical ? 'ArrowDown' : 'ChevronRight', 'ico sm')} ${vertical ? 'Move down' : 'Move right'}</button>` : ''}
      ${s.layout === 'single' ? `<hr><div class="dd-sub">${icon('Link', 'ico sm')} Link with</div>
        <p class="dd-note">A push to any linked screen shows on all of them.</p>
        ${others.length ? others.map((x) => `<button data-link="${esc(x.id)}" class="ind">${linked.includes(x.id) ? icon('Check', 'ico sm') : '<i class="ico-sp"></i>'}${esc(x.name)}</button>`).join('') : '<p class="dd-empty">No other screens yet.</p>'}
        ${linked.length ? `<button data-unlink>${icon('Unlink', 'ico sm')} Unlink</button>` : ''}` : ''}
      <hr><button data-off class="danger">${icon('X', 'ico sm')} Remove from canvas</button>`, {
      align: 'end', width: 220,
      onMount(menu, close) {
        menu.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b || b.disabled) return;
          close();
          if (b.dataset.move) app.act.place(id, b.dataset.move);
          if (b.dataset.shift) app.act.shift(edge, i, Number(b.dataset.shift));
          if (b.dataset.link) { if (linked.includes(b.dataset.link)) app.act.unlink(b.dataset.link); else app.act.link(id, b.dataset.link); }
          if ('unlink' in b.dataset) app.act.unlink(id);
          if ('off' in b.dataset) app.act.unplace(id);
        });
      },
    });
  }

  function shareMenu(anchor, id) {
    dropdown(anchor, `<div class="dd-label">${esc(app.screen(id)?.name)}</div><hr>
      <button data-stop>${icon('X', 'ico sm')} Stop sharing on this screen</button>`, {
      align: 'end', width: 220,
      onMount(menu, close) { menu.addEventListener('click', (e) => { if (e.target.closest('[data-stop]')) { close(); app.act.stopShare(id); } }); },
    });
  }

  /* ---- dragging a screen to another place ---- */

  stage.addEventListener('pointerdown', (e) => {
    const s = e.target.closest('.pc-edge .pc-slot.on:not(.sharing)');
    if (!s || e.target.closest('button')) return;
    const id = s.dataset.screen;
    const canvas = stage.querySelector('.pc-canvas');
    startDrag(e, s, {
      over(el) { const t = el?.closest('.pc-slot'); mark('drop', t && t !== s ? t : null); },
      drop(el, x, y) {
        const t = el?.closest('.pc-slot');
        if (t && t !== s) app.act.place(id, t.dataset.edge, Number(t.dataset.i));
        else if (el?.closest('.pc-canvas')) app.act.place(id, nearestEdge(canvas, x, y));
        else if (el?.closest('.pc-edge')) app.act.place(id, el.closest('.pc-edge').dataset.edge);
      },
    });
  });

  return { render };
}
