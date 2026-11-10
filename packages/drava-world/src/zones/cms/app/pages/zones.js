// Zones: the screens this Nex runs, zone by zone, as a visitor pushes from the kiosk: choose a
// zone, choose one of its screens, choose what it shows. The push goes live in that zone,
// however far from the kiosk it is (Zone 02 then shows it there in a live view).

import { esc, h, icon } from '../ui.js';
import { screenCard, wireCards, zoneHead } from './screens.js';

const ui = { zone: null };

export function renderZones(app) {
  const zones = app.zones();
  if (!zones.some((z) => z.id === ui.zone)) ui.zone = zones.find((z) => z.id !== app.home)?.id ?? zones[0]?.id;
  const zone = zones.find((z) => z.id === ui.zone);

  const page = h(`<div class="page zones">
    <div class="page-head"><div><h1>Zones</h1>
      <p>Pick a zone, pick one of its screens, and push. It goes live in that zone straight away.</p></div></div>
    <div class="zn-step">${icon('MapPin', 'ico sm')} 1 · Zone</div>
    <div class="zn-tiles">${zones.map((z) => {
      const live = z.screens.filter((s) => app.isOnline(s.id)).length;
      return `<button class="zn-tile ${z.id === ui.zone ? 'on' : ''}" data-zone="${esc(z.id)}">
        <span class="zn-n">${esc(z.n)}</span>
        <span class="zn-t"><b>${esc(z.title)}</b><small><i class="dot ${live ? 'on' : ''}"></i>${live} of ${z.screens.length} live${z.id === app.home ? ' · this room' : ''}</small></span>
        ${z.id === ui.zone ? icon('Check', 'ico sm') : ''}</button>`;
    }).join('')}</div>
    ${zone ? `<div class="zn-step">${icon('Monitor', 'ico sm')} 2 · Screen <span>tap one to choose what it shows</span></div>
    <section class="zn-sec">${zoneHead(app, zone)}
      <div class="screen-grid">${zone.screens.map((s) => screenCard(app, s, { shot: 'assign' })).join('')}</div></section>` : ''}
  </div>`);

  page.querySelector('.zn-tiles').addEventListener('click', (e) => {
    const id = e.target.closest('[data-zone]')?.dataset.zone;
    if (!id || id === ui.zone) return;
    ui.zone = id;
    app.refresh();
  });
  wireCards(app, page);
  return page;
}
