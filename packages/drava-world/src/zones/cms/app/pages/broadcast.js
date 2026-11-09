// Broadcast (broadcast/_components/publish-board.tsx in the real Nex): pick the zone, then the
// target screen in it with ‹ ›, browse a coverflow of content cards (experiences, or media with type, date
// and email filters), and hold a card and swipe it up to publish it to that screen. The board
// stays (a line under the screen bar says it went live), so the next card can go straight after
// it; Edit, at the right end past the › arrow, opens that screen's control page (the client's call, 2026-10-12:
// the real Nex rises into the control page after every publish).

import { experienceContent, mediaContent } from '../../shared/state.js';
import { FILE_LABELS } from '../../shared/render.js';
import { dateKey, dropdown, esc, h, icon, rangeCalendar, typeIcon } from '../ui.js';

// How far / how fast a card must be swiped up to publish: strict, near the card's full
// height, so a brush or a light flick never publishes by accident.
const SWIPE_DISTANCE = 260;
const SWIPE_VELOCITY = 900;
const CARD_RESET_MS = 240;
const PUSHABLE = ['image', 'video', 'document', 'sheet', 'presentation', 'word'];   // no pasted links

const ui = { zone: null, target: 0, filter: 'experiences', tag: null, type: null, from: '', to: '', emailOnly: false, loadingEmail: false, feedback: null, scroll: {} };
let feedbackTimer = 0;

function cardsFor(state) {
  if (ui.filter === 'experiences') {
    return state.experiences
      .filter((e) => !ui.tag || e.tags?.includes(ui.tag))
      .map((e) => ({ key: `exp:${e.id}`, type: 'experience', id: e.id, title: e.title, content: { kind: 'experience', id: e.id }, r: experienceContent(e) }));
  }
  return state.media
    .filter((m) => !m.pending && PUSHABLE.includes(m.type)
      && (!ui.type || m.type === ui.type)
      && (!ui.emailOnly || m.source === 'email')
      && (!ui.from || dateKey(m.createdAt) >= ui.from)
      && (!ui.to || dateKey(m.createdAt) <= ui.to))
    .map((m) => ({ key: `media:${m.id}`, type: m.type, id: m.id, title: m.name, url: m.url, content: { kind: 'media', id: m.id }, r: mediaContent(m) }));
}

const pill = (attrs, inner, on = false) => `<button class="bc-pill ${on ? 'on' : ''}" ${attrs}>${inner}</button>`;

export function renderBroadcast(app) {
  const { state } = app;
  const zones = app.zones();
  if (!zones.some((z) => z.id === ui.zone)) ui.zone = app.home;
  const screens = zones.find((z) => z.id === ui.zone)?.screens ?? [];
  ui.target = screens.length ? ((ui.target % screens.length) + screens.length) % screens.length : 0;
  const target = screens[ui.target];
  const online = target && app.isOnline(target.id);
  const cards = cardsFor(state);
  const tags = [...new Set(state.experiences.flatMap((e) => e.tags ?? []))].filter((t) => state.experienceTypes.some((x) => x.name === t));
  const types = [...new Set(state.media.filter((m) => !m.pending && PUSHABLE.includes(m.type)).map((m) => m.type))];
  const dates = !ui.from && !ui.to ? 'Date Range' : ui.from && ui.to ? `${ui.from} → ${ui.to}` : ui.from ? `From ${ui.from}` : `Until ${ui.to}`;

  const page = h(`<div class="page bc">
    <div class="bc-zones" role="tablist" aria-label="Zone">${zones.map((z) => pill(`data-zone="${esc(z.id)}" role="tab" aria-selected="${z.id === ui.zone}" title="${esc(z.title)}"`, `<span class="zn-n">${esc(z.n)}</span>${esc(z.name)}`, z.id === ui.zone)).join('')}</div>
    <div class="bc-switch">
      <button class="bc-round" data-act="prev-screen" ${screens.length < 2 ? 'disabled' : ''} aria-label="Previous screen">${icon('ChevronLeft', 'ico lg')}</button>
      <div class="bc-drop">${target ? `<span class="row" style="gap:8px;flex-wrap:nowrap;min-width:0"><i class="sdot ${online ? 'ok' : 'part'}" title="${online ? 'Display connected' : 'No display connected'}"></i><b class="trunc">${esc(target.name)}</b></span>
        <span class="bc-now">${online ? esc(target.blanked ? 'Stopped' : app.label(target) ?? 'Idle') : 'Offline — nothing will change on the wall'}</span>` : '<b>No screens registered yet</b>'}</div>
      <button class="bc-round" data-act="next-screen" ${screens.length < 2 ? 'disabled' : ''} aria-label="Next screen">${icon('ChevronRight', 'ico lg')}</button>
      <button class="bc-edit" data-act="edit-screen" ${target ? `title="Open ${esc(target.name)}'s controls"` : 'disabled'}>${icon('SquarePen', 'ico xs')} Edit</button>
    </div>
    <div class="bc-msg">${ui.feedback ? `<span class="bc-feedback ${ui.feedback.tone}">${esc(ui.feedback.message)}</span>` : '<span class="bc-hint">Swipe left/right to browse • hold and swipe up to publish</span>'}</div>
    <div class="bc-filters">
      <div class="row">
        ${pill('data-dd="filter"', `${ui.filter} ${icon('ChevronDown', 'ico xs')}`, true)}
        ${ui.filter === 'experiences' && tags.length ? pill('data-dd="tag"', `${esc(ui.tag ?? 'All tags')} ${icon('ChevronDown', 'ico xs')}`) : ''}
        ${ui.filter === 'media' && types.length ? pill('data-dd="type"', `${esc(ui.type ? FILE_LABELS[ui.type] : 'All types')} ${icon('ChevronDown', 'ico xs')}`) : ''}
        ${ui.filter === 'media' ? pill('data-dd="dates"', `${icon('CalendarRange', 'ico xs')} ${esc(dates)} ${icon('ChevronDown', 'ico xs')}`, ui.from || ui.to) : ''}
      </div>
      <div class="row">
        ${ui.filter === 'media' ? pill(`data-act="email-only" aria-pressed="${ui.emailOnly}" title="${ui.emailOnly ? 'Showing only media from email — click to show all' : 'Show only media that came in from email'}"`, `${icon(ui.emailOnly ? 'Check' : 'Mail', 'ico xs')} From Email`, ui.emailOnly) : ''}
        ${pill(`data-act="email" title="Load last 2 days from email" ${ui.loadingEmail ? 'disabled' : ''}`, `${icon('RefreshCw', `ico xs ${ui.loadingEmail ? 'spin' : ''}`)} ${ui.loadingEmail ? 'Loading…' : 'Load Email'}`)}
      </div>
    </div>
    ${cards.length === 0 ? `<div class="empty">${icon('Layers', 'ico lg')}<span>No content to publish yet.</span></div>` : `
    <div class="bc-stage">
      <div class="bc-scroller">${cards.map((c) => `<div class="bc-slide" data-key="${esc(c.key)}"><div class="bc-card">
        <div class="bc-thumb">${thumb(app, c)}<span class="bc-type">${c.type === 'experience' ? icon('Layers', 'ico xxs') : typeIcon(c.type, 'ico xxs')} ${c.type === 'experience' ? 'experience' : esc(FILE_LABELS[c.type])}</span></div>
        <p class="bc-title" title="${esc(c.title)}">${esc(c.title)}</p></div></div>`).join('')}</div>
      <div class="row" style="justify-content:center;gap:16px"><button class="bc-round sm" data-act="prev-card" aria-label="Previous card">${icon('ChevronLeft', 'ico lg')}</button>
        <button class="bc-round sm" data-act="next-card" aria-label="Next card">${icon('ChevronRight', 'ico lg')}</button></div>
    </div>`}
  </div>`);

  const scroller = page.querySelector('.bc-scroller');
  const slides = [...page.querySelectorAll('.bc-slide')];
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));

  // Coverflow: the centred card full size and on top, the others smaller and turned away.
  const coverflow = () => {
    if (!scroller) return;
    const mid = scroller.scrollLeft + scroller.clientWidth / 2;
    for (const s of slides) {
      const d = (s.offsetLeft + s.offsetWidth / 2 - mid) / s.offsetWidth;
      const a = Math.min(Math.abs(d), 2.5);
      s.style.transform = `perspective(1200px) rotateY(${Math.max(-35, Math.min(35, -d * 22))}deg) scale(${1 - a * 0.12})`;
      s.style.zIndex = String(Math.round(5 - a * 2));
      s.style.opacity = String(1 - Math.min(0.55, a * 0.22));
    }
  };
  const nearest = () => {
    const mid = scroller.scrollLeft + scroller.clientWidth / 2;
    return slides.reduce((best, s, i) => (Math.abs(s.offsetLeft + s.offsetWidth / 2 - mid) < Math.abs(slides[best].offsetLeft + slides[best].offsetWidth / 2 - mid) ? i : best), 0);
  };
  const centre = (i, behavior = 'smooth') => {
    const s = slides[Math.max(0, Math.min(slides.length - 1, i))];
    if (s) scroller.scrollTo({ left: s.offsetLeft + s.offsetWidth / 2 - scroller.clientWidth / 2, behavior });
  };
  if (scroller) {
    scroller.addEventListener('scroll', () => { coverflow(); ui.scroll[ui.filter] = scroller.scrollLeft; }, { passive: true });
    scroller.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); scroller.scrollLeft += e.deltaY; } }, { passive: false });
    // Remember where the carousel was, so a re-render doesn't jump back to the start.
    requestAnimationFrame(() => { scroller.scrollLeft = ui.scroll[ui.filter] ?? 0; coverflow(); });
    gestures(scroller, slides, { nearest, centre, coverflow, publish: (key) => publish(app, byKey[key], target) });
  }

  page.addEventListener('click', async (e) => {
    const zone = e.target.closest('[data-zone]')?.dataset.zone;
    if (zone && zone !== ui.zone) { ui.zone = zone; ui.target = 0; app.refresh(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev-screen') { ui.target -= 1; app.refresh(); }
    if (act === 'next-screen') { ui.target += 1; app.refresh(); }
    if (act === 'edit-screen' && target) app.go(`/screens/${encodeURIComponent(target.id)}`);
    if (act === 'prev-card') centre(nearest() - 1);
    if (act === 'next-card') centre(nearest() + 1);
    if (act === 'email-only') { ui.emailOnly = !ui.emailOnly; app.refresh(); }
    if (act === 'email') {
      ui.loadingEmail = true;
      app.refresh();
      await new Promise((r) => setTimeout(r, 900));
      ui.loadingEmail = false;
      const n = app.loadEmail();
      feedback(app, n ? { message: `Loaded ${n} item${n === 1 ? '' : 's'} from email`, tone: 'success' } : { message: 'Nothing new in the last 2 days', tone: 'warning' });
    }
  });
  page.querySelectorAll('[data-dd]').forEach((b) => b.addEventListener('click', () => filterMenu(app, b, tags, types)));
  return page;
}

function thumb(app, c) {
  if (c.type === 'image') return `<img src="${esc(c.url)}" alt="${esc(c.title)}" loading="lazy" decoding="async">`;
  if (c.type === 'experience') return app.slot(`bc:${c.key}`, c.r, { still: true });
  // Static icons rather than <video> per card (one hardware decoder per card in the real
  // Nex's Android WebView), so video and files show their type.
  return `<span class="bc-ico">${typeIcon(c.type, 'ico xl')}</span>`;
}

function feedback(app, fb) {
  ui.feedback = fb;
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { ui.feedback = null; if (location.hash.startsWith('#/broadcast')) app.refresh(); }, 3500);
  app.refresh();
}

function publish(app, card, target) {
  if (!card || !target) return;
  const showing = target.content?.id === card.id && !target.blanked && !target.queue;
  if (showing) { feedback(app, { message: `"${card.title}" is already on ${target.name}`, tone: 'warning' }); return; }
  app.assign(target.id, card.content, { quiet: true });
  const fb = app.isOnline(target.id)
    ? { message: `Pushed "${card.title}" to ${target.name}`, tone: 'success' }
    : { message: `Pushed "${card.title}", but no display is connected to ${target.name}`, tone: 'warning' };
  // Stay on the board: once the card has dropped back, the line under the screen bar says so.
  setTimeout(() => feedback(app, fb), CARD_RESET_MS);
}

/**
 * One pointer handler for the whole carousel: drag sideways to browse (snapping to a card
 * on release), or hold a card and drag it up to publish it.
 */
function gestures(scroller, slides, { nearest, centre, publish }) {
  let g = null;
  scroller.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const slide = e.target.closest('.bc-slide');
    g = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, slide, card: slide?.querySelector('.bc-card'), mode: null, samples: [[e.timeStamp, e.clientY]] };
    scroller.setPointerCapture(e.pointerId);
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.mode && Math.hypot(dx, dy) > 6) g.mode = Math.abs(dy) > Math.abs(dx) && dy < 0 && g.card ? 'swipe' : 'scroll';
    if (g.mode === 'scroll') { scroller.classList.add('dragging'); scroller.scrollLeft = g.left - dx; }
    if (g.mode === 'swipe') {
      g.samples.push([e.timeStamp, e.clientY]);
      if (g.samples.length > 6) g.samples.shift();
      g.card.style.transition = 'none';
      g.card.style.transform = `translateY(${Math.min(0, dy)}px) scale(1.05)`;
      g.slide.style.zIndex = '10';
    }
  });
  const end = (e) => {
    if (!g) return;
    const { mode, card, slide, samples } = g;
    g = null;
    scroller.classList.remove('dragging');
    if (mode === 'scroll') { centre(nearest()); return; }
    if (mode !== 'swipe') return;
    const dy = e.clientY - samples[0][1];
    const [t0, y0] = samples[0], [t1, y1] = samples[samples.length - 1];
    const v = t1 > t0 ? ((y1 - y0) / (t1 - t0)) * 1000 : 0;
    const offset = parseFloat(card.style.transform.match(/translateY\((-?[\d.]+)px/)?.[1] ?? '0');
    card.style.transition = 'transform 0.22s ease-in, opacity 0.22s';
    if (offset < -SWIPE_DISTANCE || v < -SWIPE_VELOCITY || (dy < -SWIPE_DISTANCE)) {
      card.style.transform = 'translateY(-400px)';
      card.style.opacity = '0';
      publish(slide.dataset.key);
      setTimeout(() => { card.style.transition = 'opacity 0.25s'; card.style.transform = ''; card.style.opacity = '1'; }, CARD_RESET_MS);
    } else {
      card.style.transition = 'transform 0.35s cubic-bezier(0.2, 1.4, 0.4, 1)';
      card.style.transform = '';
    }
  };
  scroller.addEventListener('pointerup', end);
  scroller.addEventListener('pointercancel', end);
}

function filterMenu(app, anchor, tags, types) {
  const which = anchor.dataset.dd;
  if (which === 'dates') {
    dropdown(anchor, '<div class="dd-pad"></div>', {
      onMount: (el) => rangeCalendar(el.querySelector('.dd-pad'), { from: ui.from, to: ui.to, onChange: (from, to) => { ui.from = from; ui.to = to; app.refresh(); } }),
    });
    return;
  }
  const items = which === 'filter' ? [['experiences', 'experiences'], ['media', 'media']]
    : which === 'tag' ? [['', 'All tags'], ...tags.map((t) => [t, t])]
      : [['', 'All types'], ...types.map((t) => [t, FILE_LABELS[t]])];
  dropdown(anchor, items.map(([v, label]) => `<button class="caps-item" data-v="${esc(v)}">${esc(label)}</button>`).join(''), {
    onMount(el, close) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (!b) return;
        const v = b.dataset.v;
        if (which === 'filter') {
          ui.filter = v;
          if (v !== 'experiences') ui.tag = null;
          if (v !== 'media') { ui.type = null; ui.emailOnly = false; ui.from = ''; ui.to = ''; }
        } else if (which === 'tag') ui.tag = v || null;
        else ui.type = v || null;
        close();
        app.refresh();
      });
    },
  });
}
