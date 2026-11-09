// A small floor plan of the zones whose screens this Nex runs (the screen control page):
// each room from above, its back wall at the top, its screens where they hang, the one being
// controlled picked out. Tap a screen to control it.
//
// Metres, in each room's own coordinates, worked out from the 3D rooms: Zone 02's from room.js
// (WALL_SCREENS and KIOSK in zones/cms/room.js: three screens on the front wall, the kiosk in
// the middle), the floors' from LAYOUTS in zones/shared/ScreensZone.js. Move
// a screen there, move it here. door: half the doorway's width (DOOR if not given); kioskR: the
// kiosk's dot.

import { esc } from './ui.js';

const ROOMS = {
  cms: {
    n: '02', name: 'Nex', backDoor: false, door: 1.22,
    minX: -7.62, maxX: 7.62, minZ: -4.57, maxZ: 4.57,
    kiosk: [0, 0], kioskR: 0.8,
    screens: {
      'vec-left': [-6.6, -4.45, -3, -4.45],
      'vec-centre': [-1.8, -4.45, 1.8, -4.45],
      'vec-right': [3, -4.45, 6.6, -4.45],
    },
  },
  floor1: {
    n: '1', name: 'First floor', backDoor: false, door: 1.22,
    minX: -7.62, maxX: 7.62, minZ: -4.57, maxZ: 4.57,
    screens: { 'floor1-screen': [-1.8, -4.45, 1.8, -4.45] },
  },
  floor2: {
    n: '2', name: 'Second floor', backDoor: false, door: 1.22,
    minX: -7.62, maxX: 7.62, minZ: -4.57, maxZ: 4.57,
    screens: { 'floor2-screen': [-1.8, -4.45, 1.8, -4.45] },
  },
};
const GAP = 6;        // metres between rooms on the plan
const TOP = 5;        // room for the zone labels above the rooms
const DOOR = 1.6;     // half a doorway's width

/** The plan as SVG markup: the rooms side by side (a room holds every group in it), `current` (a screen id) picked out. */
export function zoneMap(app, current) {
  const groups = app.zones().filter((z) => ROOMS[z.room]);
  const rooms = [...new Set(groups.map((z) => z.room))];
  let ox = 0;
  const parts = [];
  for (const id of rooms) {
    const r = ROOMS[id];
    const inRoom = groups.filter((z) => z.room === id);
    const screens = inRoom.flatMap((z) => z.screens.map((s) => ({ s, z })));
    const w = r.maxX - r.minX;
    const X = (x) => ox + x - r.minX, Y = (zz) => TOP + zz - r.minZ;
    const here = screens.some(({ s }) => s.id === current);
    // The room: walls with a doorway front (and back, where there is a door on).
    const back = r.backDoor === false ? `M${X(r.minX)} ${Y(r.minZ)} H${X(r.maxX)}` : '';
    const d = r.door ?? DOOR;
    parts.push(`<g class="zm-room ${here ? 'here' : ''}">
      <text class="zm-label" x="${X(r.minX)}" y="${TOP - 1.6}"><tspan class="zm-n">${esc(r.n)}</tspan> ${esc(r.name)}</text>
      <rect class="zm-floor" x="${X(r.minX)}" y="${Y(r.minZ)}" width="${w}" height="${r.maxZ - r.minZ}"/>
      <path class="zm-wall" d="M${X(-d)} ${Y(r.minZ)} H${X(r.minX)} V${Y(r.maxZ)} H${X(-d)} M${X(d)} ${Y(r.maxZ)} H${X(r.maxX)} V${Y(r.minZ)} H${X(d)} ${back}"/>
      ${(r.others ?? []).map(([x1, z1, x2, z2]) => `<line class="zm-other" x1="${X(x1)}" y1="${Y(z1)}" x2="${X(x2)}" y2="${Y(z2)}"/>`).join('')}
      ${r.kiosk ? `<circle class="zm-kiosk" cx="${X(r.kiosk[0])}" cy="${Y(r.kiosk[1])}" r="${r.kioskR ?? 1.3}"><title>Kiosk: you are here</title></circle>
        <text class="zm-you" x="${X(r.kiosk[0]) + (r.kioskR ?? 1.3) + 1.1}" y="${Y(r.kiosk[1]) + 1}">You are here</text>` : ''}
      ${screens.map(({ s, z }) => {
        const at = r.screens[s.id];
        if (!at) return '';
        const [x1, z1, x2, z2] = at;
        const cls = s.id === current ? 'on' : app.isOnline(s.id) ? 'live' : '';
        const line = `x1="${X(x1)}" y1="${Y(z1)}" x2="${X(x2)}" y2="${Y(z2)}"`;
        return `<g class="zm-screen ${cls}" data-screen="${esc(s.id)}" role="button" tabindex="0" aria-label="${esc(s.name)}, ${esc(z.label)}">
          <title>${esc(s.name)} · ${esc(app.label(s) ?? 'Idle')}</title>
          <line class="zm-hit" ${line}/><line class="zm-line" ${line}/></g>`;
      }).join('')}
    </g>`);
    ox += w + GAP;
  }
  const width = ox - GAP;
  const height = TOP + Math.max(...rooms.map((id) => ROOMS[id].maxZ - ROOMS[id].minZ)) + 1;
  return `<svg class="zmap-svg" viewBox="-1 0 ${width + 2} ${height}" role="img" aria-label="Map of the zones and screens this Nex runs">${parts.join('')}</svg>`;
}
