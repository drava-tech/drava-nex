// Dashboard: the real Nex's overview (cms-platform master, app/(dashboard)/page.tsx): the KPI
// row (Active Users in the sidebar's red), then two columns, Screen Uptime over the Screens
// list on the left, Media Ratio over Recent Activity on the right.

import { ago, esc, h, icon, isLinkType } from '../ui.js';

// The real Nex's chart colours (--chart-1, -2, -3): red, green, orange-red.
const CHART = ['#E21D3E', '#4DDD00', '#FF2400'];

export function renderDashboard(app) {
  const { state } = app;
  const online = state.screens.filter((s) => app.isOnline(s.id)).length;
  const library = state.media.filter((m) => !m.pending);
  const videos = library.filter((m) => m.type === 'video').length;
  const images = library.filter((m) => m.type === 'image').length;
  const documents = library.filter((m) => m.type !== 'video' && m.type !== 'image' && !isLinkType(m.type)).length;
  const links = library.length - videos - images - documents;
  const templates = Object.entries(state.experiences.reduce((acc, e) => ((acc[e.template] = (acc[e.template] || 0) + 1), acc), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${n} ${k.replace(/[-_]/g, ' ')}`).join(' · ');

  const page = h(`<div class="page">
    <div class="page-head"><div><h1>Dashboard</h1><p>Overview of your signage network</p></div></div>

    <div class="grid cols-4">
      ${stat('Monitor', state.screens.length, 'Total Screens', `${online} online · ${state.screens.length - online} offline`, '/screens')}
      ${stat('SquareTerminal', state.experiences.length, 'Experiences', templates, '/broadcast')}
      ${stat('Film', library.length, 'Media Assets', `${videos} videos · ${images} images · ${documents} documents`, '/media')}
      ${stat('Users', 1, 'Active Users', '1 total · 1 admin', null, true)}
    </div>

    <div class="grid cols-3">
      <div class="col span-2">
        <div class="card">
          <div class="card-head"><h3>Screen Uptime</h3><span class="sample" title="No uptime recorded yet — these values are placeholders">Sample</span></div>
          <p class="desc">Share of screens online during office hours, last 7 days</p>
          ${uptimeChart()}
        </div>
        <div class="card">
          <h3>Screens</h3><p class="desc">Live status across your network</p>
          <ul class="slist">${state.screens.map((s) => screenRow(app, s)).join('')}</ul>
        </div>
      </div>
      <div class="col">
        <div class="card">
          <h3>Media Ratio</h3><p class="desc">Videos, images, and documents</p>
          ${ratio([[videos, 'Videos', 'Film'], [images, 'Images', 'Image'], [documents, 'Documents', 'FileText']], links)}
        </div>
        <div class="card" style="flex:1">
          <h3>Recent Activity</h3><p class="desc">Latest pushes and uploads</p>
          <div class="feed">${state.activity.length ? state.activity.slice(0, 7).map(activity).join('')
            : '<div class="empty" style="padding:24px 0">No activity yet</div>'}</div>
        </div>
      </div>
    </div>
  </div>`);

  page.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); app.go(el.dataset.href); }));
  page.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => app.go(`/screens/${encodeURIComponent(li.dataset.id)}`)));
  wireUptime(page);
  return page;
}

function stat(ico, value, label, breakdown, href, highlight = false) {
  return `<a class="stat ${highlight ? 'hl' : ''}" ${href ? `href="#${href}" data-href="${href}"` : ''}>
    <div class="chip">${icon(ico)}</div>
    <div><div class="val">${value}</div><div class="lbl">${label}</div></div>
    ${breakdown ? `<span class="brk">${esc(breakdown)}</span>` : ''}</a>`;
}

/** A row of the Screens card: what kind of thing is on it, its name, what and where, its status. */
function screenRow(app, s) {
  const r = app.resolve(s);
  const kind = s.blanked ? 'Slash' : r.kind === 'experience' ? 'Layers' : r.kind === 'media' || r.kind === 'whiteboard' ? 'Film' : 'Slash';
  const showing = s.blanked ? 'Screen stopped' : app.label(s) ?? 'Unassigned';
  const on = app.isOnline(s.id);
  return `<li data-id="${esc(s.id)}"><span class="k">${icon(kind)}</span>
    <div class="n"><p>${esc(s.name)}</p><small>${esc(showing)} · ${esc(s.id)}</small></div>
    <div class="s"><span class="badge"><i class="dot ${on ? 'on' : ''}"></i>${on ? 'Online' : 'Offline'}</span><small>${on ? 'Live now' : 'Not connected'}</small></div></li>`;
}

/** The real Nex's Media Ratio: the counts as a ratio, a stacked bar and one tile per kind. */
function ratio(parts, links) {
  const total = parts.reduce((n, [v]) => n + v, 0);
  const pct = (v) => (total ? (v / total) * 100 : 0);
  return `<div class="stack" style="gap:20px">
    <div class="row" style="justify-content:space-between;align-items:baseline;flex-wrap:nowrap">
      <div><p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8">Asset ratio</p>
        <p style="margin:4px 0 0;font-size:24px;font-variant-numeric:tabular-nums">${parts.map(([v]) => v).join(' : ')}</p></div>
      <p style="margin:0;font-size:12px;color:#94a3b8;text-align:right">${total} categorized asset${total === 1 ? '' : 's'}</p>
    </div>
    <div class="bar" role="img" aria-label="${parts.map(([v, l]) => `${v} ${l.toLowerCase()}`).join(', ')}">${parts.map(([v], i) => `<i style="width:${pct(v)}%;background:${CHART[i]}"></i>`).join('')}</div>
    <div class="ratio-tiles">${parts.map(([v, label, ico], i) => `<div class="ratio-tile">
      <div class="h"><span style="color:${CHART[i]};display:flex">${icon(ico)}</span>${label}</div>
      <div class="v"><b>${v}</b><span>${Math.round(pct(v))}%</span></div></div>`).join('')}</div>
    ${links ? `<p style="margin:0;font-size:12px;color:#64748b">${links} linked or embedded asset${links === 1 ? ' is' : 's are'} not included in this ratio.</p>` : ''}
  </div>`;
}

/** One entry of Recent Activity, on the real Nex's timeline: a coloured disc by kind, the action muted, its target bright. */
function activity(a) {
  const kind = ['Upload', 'Trash2', 'Mail', 'Link2', 'Film'].includes(a.icon) ? 'media' : a.icon === 'SquarePen' ? 'experience' : 'screen';
  const ico = { screen: 'Monitor', experience: 'SquareTerminal', media: 'Film' }[kind];
  const [action, ...rest] = String(a.text).split(' ');
  return `<div class="feed-item"><div class="chip ${kind}">${icon(ico)}</div>
    <div style="min-width:0;flex:1"><p title="${esc(a.text)}"><span style="color:#94a3b8">${esc(action)}</span> ${esc(rest.join(' '))}</p><small>${ago(a.at)}</small></div></div>`;
}

// Seven days of placeholder uptime, like the real chart before anything is recorded (shown
// at half strength with the Sample badge). Hovering a day shows its value.
const UPTIME = [92, 96, 88, 99, 94, 97, 100];
const W = 640, H = 220, PX = 16, PT = 16, PB = 28;

function uptimeChart() {
  const innerW = W - PX * 2, innerH = H - PT - PB;
  const pts = UPTIME.map((v, i) => {
    const d = new Date(Date.now() - (6 - i) * 864e5);
    return { v, x: PX + (innerW * i) / 6, y: PT + innerH - (v / 100) * innerH, label: d.toLocaleDateString(undefined, { weekday: 'short' }) };
  });
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const base = PT + innerH;
  return `<div class="uptime" style="position:relative;opacity:0.5">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto;display:block" role="img" aria-label="Screen uptime over the last 7 days">
      <defs><linearGradient id="ug" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${CHART[0]}" stop-opacity="0.35"/><stop offset="1" stop-color="${CHART[0]}" stop-opacity="0"/></linearGradient></defs>
      ${[0, 0.5, 1].map((t) => `<line x1="${PX}" x2="${W - PX}" y1="${PT + innerH * t}" y2="${PT + innerH * t}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3 3"/>`).join('')}
      <path d="M${pts[0].x},${base} ${pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} L${pts[6].x},${base} Z" fill="url(#ug)"/>
      <path d="${line}" fill="none" stroke="${CHART[0]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 6px ${CHART[0]})"/>
      <g class="up-mark" style="display:none"><line y1="${PT}" y2="${base}" stroke="rgba(255,255,255,0.12)"/><circle r="4" fill="${CHART[0]}" stroke="#05070d" stroke-width="2" style="filter:drop-shadow(0 0 8px ${CHART[0]})"/></g>
      ${pts.map((p, i) => `<rect data-i="${i}" x="${p.x - innerW / 14}" y="0" width="${innerW / 7}" height="${H}" fill="transparent"/>
        <text x="${p.x}" y="${H - 8}" fill="#94a3b8" font-size="11" text-anchor="middle">${p.label}</text>`).join('')}
    </svg>
    <div class="up-tip" style="display:none;pointer-events:none;position:absolute;transform:translate(-50%,-100%);border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(11,15,26,0.9);padding:4px 8px;font-size:12px;white-space:nowrap"></div>
  </div>`;
}

function wireUptime(page) {
  const box = page.querySelector('.uptime');
  if (!box) return;
  const mark = box.querySelector('.up-mark'), tip = box.querySelector('.up-tip');
  const innerH = H - PT - PB;
  box.querySelectorAll('rect[data-i]').forEach((r) => {
    const i = Number(r.dataset.i), v = UPTIME[i];
    const x = PX + ((W - PX * 2) * i) / 6, y = PT + innerH - (v / 100) * innerH;
    r.addEventListener('mouseenter', () => {
      mark.style.display = '';
      mark.querySelector('line').setAttribute('x1', x);
      mark.querySelector('line').setAttribute('x2', x);
      mark.querySelector('circle').setAttribute('cx', x);
      mark.querySelector('circle').setAttribute('cy', y);
      tip.style.display = '';
      tip.style.left = `${(x / W) * 100}%`;
      tip.style.top = `${(y / H) * 100}%`;
      tip.innerHTML = `<span>${v}%</span> <span style="color:#94a3b8">online</span>`;
    });
    r.addEventListener('mouseleave', () => { mark.style.display = 'none'; tip.style.display = 'none'; });
  });
}
