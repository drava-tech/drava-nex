// What the Nex replica starts with: the three wall screens of Zone 02 and the screens of the
// floors it runs (SCREEN_ZONES), the experiences
// (templates drawn in the browser), the media library, the room's devices (Environment),
// sample visitors and whiteboards. Everything a visitor changes is saved in their browser
// (state.js); "Reset demo" in Settings goes back to this.

import { MEDIA_BASE } from '../../../config.js';

// The groups of screens this Nex runs, in the order the Nex lists them: Zone 02's own three screens
// in front of the kiosk, then the building's floors, one screen each, each floor its own room off
// Zone 02 (the client's call, 2026-10-12; until then the Multi-Zone Screens room, a group per side
// of it). id: the group (a screen's `zone`); room: the 3D zone it hangs in (main.js builds it);
// n: its badge; name: short; title: as the Nex heads it; label: in a sentence.
export const SCREEN_ZONES = [
  { id: 'cms', n: '02', name: 'Nex', title: 'Nex Zone', room: 'cms', label: 'Zone 02 · Nex Zone' },
  { id: 'floor-1', n: '1', name: 'First floor', title: 'First floor', room: 'floor1', label: 'First floor' },
  { id: 'floor-2', n: '2', name: 'Second floor', title: 'Second floor', room: 'floor2', label: 'Second floor' },
];

// zone: which group the screen is in (SCREEN_ZONES), listed left to right as you face them.
// Screens added in the Nex have none. Zone 02's: the front wall's left, centre and right (where
// they hang: WALL_SCREENS in zones/cms/room.js). MAIN: the one the Welcome Trigger greets on and a
// pushed video plays aloud from.
export const MAIN = 'vec-centre';
export const SCREENS = [
  { id: 'vec-left', name: 'Left wall', zone: 'cms' },
  { id: 'vec-centre', name: 'Centre wall', zone: 'cms' },
  { id: 'vec-right', name: 'Right wall', zone: 'cms' },
  // One screen on each floor.
  { id: 'floor1-screen', name: 'First floor screen', zone: 'floor-1' },
  { id: 'floor2-screen', name: 'Second floor screen', zone: 'floor-2' },
];

// template: which renderer draws it (render.js). fields: what the editor can change.
// tags: its experience types (Settings → Experience Types; the Broadcast tag filter).
export const EXPERIENCES = [
  { id: 'exp-portfolio', n: 1, title: 'The White Tusker Portfolio', template: 'portfolio', tags: ['Brand'] },
  { id: 'exp-welcome', n: 2, title: 'Welcome Visitor', template: 'welcome', tags: ['Lobby'],
    fields: { headline: 'Welcome to White Tusker', subline: 'Architects of Experiences' } },
  { id: 'exp-analytics', n: 3, title: 'Analytics Dashboard (Digital Twin)', template: 'analytics', tags: ['Data'] },
  { id: 'exp-dataart', n: 4, title: 'Live Mosaic', template: 'dataart', tags: ['Data'] },
  { id: 'exp-explainer', n: 5, title: 'Gamified Explainer Story', template: 'title', tags: ['Story'] },
  { id: 'exp-aping', n: 6, title: 'Human Aping', template: 'title', tags: ['AI'] },
  { id: 'exp-objects', n: 7, title: 'Orca', template: 'title', tags: ['AI'] },
  { id: 'exp-lego', n: 8, title: 'Lego Kits', template: 'title', tags: ['Play'] },
  { id: 'exp-assembly', n: 9, title: 'Lab', template: 'title', tags: ['AI'] },
  { id: 'exp-ehs', n: 10, title: 'EHS Training', template: 'title', tags: ['Training'] },
];

// type: image | video | document (PDF) | word | sheet | presentation | youtube | drive | link
// source: where it came from, as in the real media_asset table: upload | email | link
export const MEDIA = [
  { id: 'media-film', name: 'Brand film.mp4', type: 'video', source: 'upload', url: `${MEDIA_BASE}/brandfilm.mp4`, sizeBytes: 107829069, createdAt: '2026-09-30T06:40:00.000Z' },
  // Project photos (public/cms/media/, resized to 1920 px)
  { id: 'media-bial-live-action-01', name: 'BIAL - Live Action 01.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/bial-live-action-01.jpg', sizeBytes: 341620, createdAt: '2026-09-30T06:29:00.000Z' },
  { id: 'media-bial-live-action-02', name: 'BIAL - Live Action 02.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/bial-live-action-02.jpg', sizeBytes: 291906, createdAt: '2026-09-30T06:28:00.000Z' },
  { id: 'media-boeing-2', name: 'Boeing-2.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/boeing-2.jpg', sizeBytes: 185585, createdAt: '2026-09-30T06:27:00.000Z' },
  { id: 'media-boeing', name: 'boeing.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/boeing.jpg', sizeBytes: 184782, createdAt: '2026-09-30T06:26:00.000Z' },
  { id: 'media-ca-environmental-graphics-01', name: 'CA - Environmental Graphics 01.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/ca-environmental-graphics-01.jpg', sizeBytes: 136948, createdAt: '2026-09-30T06:25:00.000Z' },
  { id: 'media-ca-environmental-graphics-02', name: 'CA - Environmental Graphics 02.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/ca-environmental-graphics-02.jpg', sizeBytes: 79597, createdAt: '2026-09-30T06:24:00.000Z' },
  { id: 'media-ca-environmental-graphics-04', name: 'CA - Environmental Graphics 04.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/ca-environmental-graphics-04.jpg', sizeBytes: 88037, createdAt: '2026-09-30T06:23:00.000Z' },
  { id: 'media-ca-nose-01', name: 'CA - Nose 01.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/ca-nose-01.jpg', sizeBytes: 119294, createdAt: '2026-09-30T06:22:00.000Z' },
  { id: 'media-ca-nose-02', name: 'CA - Nose 02.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/ca-nose-02.jpg', sizeBytes: 123330, createdAt: '2026-09-30T06:21:00.000Z' },
  { id: 'media-ca-wall-branding-01', name: 'CA - Wall Branding 01.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/ca-wall-branding-01.jpg', sizeBytes: 275093, createdAt: '2026-09-30T06:20:00.000Z' },
  { id: 'media-ca-ng-a-02', name: 'CA NG (A) 02.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/ca-ng-a-02.jpg', sizeBytes: 199843, createdAt: '2026-09-30T06:19:00.000Z' },
  { id: 'media-ca-ng-a-04', name: 'CA NG (A) 04.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/ca-ng-a-04.jpg', sizeBytes: 231023, createdAt: '2026-09-30T06:18:00.000Z' },
  { id: 'media-ca-ng-b-03', name: 'CA NG (B) 03.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/ca-ng-b-03.jpg', sizeBytes: 183299, createdAt: '2026-09-30T06:17:00.000Z' },
  { id: 'media-johnnie-walker-1', name: 'Johnnie Walker (1).jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/johnnie-walker-1.jpg', sizeBytes: 349154, createdAt: '2026-09-30T06:16:00.000Z' },
  { id: 'media-johnnie-walker-2', name: 'Johnnie Walker (2).jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/johnnie-walker-2.jpg', sizeBytes: 348068, createdAt: '2026-09-30T06:15:00.000Z' },
  { id: 'media-mr-joushua-s-office-01', name: "Mr. Joushua's Office 01.jpg", type: 'image', source: 'upload', url: '/drava-world/cms/media/mr-joushua-s-office-01.jpg', sizeBytes: 31642, createdAt: '2026-09-30T06:14:00.000Z' },
  { id: 'media-mr-joushua-s-office-02', name: "Mr. Joushua's Office 02.jpg", type: 'image', source: 'upload', url: '/drava-world/cms/media/mr-joushua-s-office-02.jpg', sizeBytes: 48141, createdAt: '2026-09-30T06:13:00.000Z' },
  { id: 'media-nappa-dori-01', name: 'Nappa Dori 01.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/nappa-dori-01.jpg', sizeBytes: 79389, createdAt: '2026-09-30T06:12:00.000Z' },
  { id: 'media-nappa-dori-02', name: 'Nappa Dori 02.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/nappa-dori-02.jpg', sizeBytes: 145770, createdAt: '2026-09-30T06:11:00.000Z' },
  { id: 'media-nappa-dori-03', name: 'Nappa Dori 03.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/nappa-dori-03.jpg', sizeBytes: 264753, createdAt: '2026-09-30T06:10:00.000Z' },
  { id: 'media-npcc-mumbai-01', name: 'NPCC Mumbai 01.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/npcc-mumbai-01.jpg', sizeBytes: 41456, createdAt: '2026-09-30T06:09:00.000Z' },
  { id: 'media-npcc-mumbai-03', name: 'NPCC Mumbai 03.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/npcc-mumbai-03.jpg', sizeBytes: 30145, createdAt: '2026-09-30T06:08:00.000Z' },
  { id: 'media-tbz-01', name: 'TBZ 01.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/tbz-01.jpg', sizeBytes: 142258, createdAt: '2026-09-30T06:07:00.000Z' },
  { id: 'media-tbz-03', name: 'TBZ 03.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/tbz-03.jpg', sizeBytes: 119944, createdAt: '2026-09-30T06:06:00.000Z' },
  { id: 'media-the-attic-grey-04', name: 'The Attic Grey 04.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/the-attic-grey-04.jpg', sizeBytes: 67756, createdAt: '2026-09-30T06:05:00.000Z' },
  { id: 'media-the-flying-squirrel-02', name: 'The Flying Squirrel 02.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/the-flying-squirrel-02.jpg', sizeBytes: 49911, createdAt: '2026-09-30T06:04:00.000Z' },
  { id: 'media-the-flying-squirrel-03', name: 'The Flying Squirrel 03.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/the-flying-squirrel-03.jpg', sizeBytes: 119152, createdAt: '2026-09-30T06:03:00.000Z' },
  { id: 'media-zensar-2', name: 'Zensar-2.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/zensar-2.jpg', sizeBytes: 154040, createdAt: '2026-09-30T06:02:00.000Z' },
  { id: 'media-zensar-3', name: 'Zensar-3.jpg', type: 'image', source: 'upload', url: '/drava-world/cms/media/zensar-3.jpg', sizeBytes: 160780, createdAt: '2026-09-30T06:01:00.000Z' },
  { id: 'media-brochure', name: 'White Tusker brochure.pdf', type: 'document', source: 'upload', url: '/drava-world/cms/samples/white-tusker-brochure.pdf', sizeBytes: 1240, createdAt: '2026-09-24T09:15:00.000Z' },
  { id: 'media-schedule', name: 'Visitor schedule.csv', type: 'sheet', source: 'email', url: '/drava-world/cms/samples/visitor-schedule.csv', sizeBytes: 269, createdAt: '2026-09-18T12:05:00.000Z' },
  { id: 'media-site', name: 'thewhitetusker.com', type: 'link', source: 'link', url: 'https://www.thewhitetusker.com/', sizeBytes: 0, createdAt: '2026-09-12T08:00:00.000Z' },
];

// Seed media taken out of the library: dropped from what a browser saved before.
export const RETIRED_MEDIA = ['media-logo-sheet', 'media-logo'];

// What "Load Email" brings in (the real Nex pulls the last 2 days of attachments and links
// from a Gmail inbox). Dated when they're loaded.
export const EMAIL_MEDIA = [
  { id: 'media-email-brief', name: 'Client brief.pdf', type: 'document', source: 'email', url: '/drava-world/cms/samples/white-tusker-brochure.pdf', sizeBytes: 1240 },
  { id: 'media-email-photo', name: 'Site visit photo.png', type: 'image', source: 'email', url: `${MEDIA_BASE}/Untitled.png`, sizeBytes: 70508 },
];

export const USER = { name: 'Guest', email: 'guest@thewhitetusker.com', role: 'ADMIN' };

/* ---------------------------------------------------------------- environment */

// Zone 02's own devices, named like the real centre's (Casambi fixtures, an IR air
// conditioner, the system audio and a smart lock). Fixtures sharing a name but for a
// trailing number are one group ("Stretch Fabric 0" and "1" → "Stretch Fabric").
export const LIGHTS = [
  { uuid: 'light-23', deviceId: 'casambi-light-23', name: 'Strip Light', status: 'online' },
  { uuid: 'light-27', deviceId: 'casambi-light-27', name: 'Stretch Fabric 0', status: 'online' },
  { uuid: 'light-28', deviceId: 'casambi-light-28', name: 'Stretch Fabric 1', status: 'online' },
];

export const WARM_WHITE_HEX = '#FFF3E0';
export const DEFAULT_GROUP_COLOR = '#FFF3E0';

/** Everyday colours, offered as swatches (the real Nex's LIGHT_PRESETS). */
export const LIGHT_PRESETS = [
  { name: 'Warm White', hex: '#FFF3E0' },
  { name: 'Neutral White', hex: '#FFFFFF' },
  { name: 'Red', hex: '#FF0000' },
  { name: 'Green', hex: '#00FF00' },
  { name: 'Cyan', hex: '#00FFFF' },
  { name: 'Blue', hex: '#0000FF' },
  { name: 'Magenta', hex: '#FF00FF' },
];

/** Whole-room lighting modes, as seeded in the real ambient_mode table. */
export const AMBIENT_MODES = [
  { key: 'pre_entry', label: 'Pre-entry', color: '#FFF3E0', brightness: 70, stripOn: true },
  { key: 'entry', label: 'Entry', color: '#FFF3E0', brightness: 80, stripOn: true },
  { key: 'meeting', label: 'Meeting', color: '#FFF3E0', brightness: 85, stripOn: true },
  { key: 'presentation', label: 'Presentation', color: '#100073', brightness: 15, stripOn: false },
];

export function seedEnvironment() {
  return {
    climate: { power: true, temp: 22, mode: 'Cool', fanSpeed: 'Med' },
    lights: LIGHTS.map((l) => ({ ...l, on: true, brightness: 85, color: DEFAULT_GROUP_COLOR })),
    groupMode: {},                       // group name → 'warm' | 'colour' (warm when unset)
    ambientModes: AMBIENT_MODES.map((m) => ({ ...m })),
    activeMode: null,
    audio: { power: true, volume: 60, muted: false, device: 'Zone 02 · LED wall speakers' },
    security: { locked: true },
  };
}

/* ---------------------------------------------------------------- visitors */

const day = 864e5;
const at = (daysAgo, hour, min = 0) => {
  const d = new Date(Date.now() - daysAgo * day);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};

// Sample people recognised at the entrance camera (photo: a drawn avatar, hue per person).
export function seedVisitors() {
  return [
    { uuid: 'v-01', name: 'Ananya Rao', email: 'ananya@example.com', role: 'vip', photo: 210, firstSeen: at(21, 10, 4), lastSeen: at(0, 9, 41) },
    { uuid: 'v-02', name: 'Rahul Menon', email: 'rahul@example.com', role: 'guest', photo: 28, firstSeen: at(14, 11, 30), lastSeen: at(1, 15, 2) },
    { uuid: 'v-03', name: '', email: '', role: 'guest', photo: 160, firstSeen: at(2, 16, 12), lastSeen: at(2, 16, 12) },
    { uuid: 'v-04', name: 'Priya Shah', email: 'priya@example.com', role: 'staff', photo: 300, firstSeen: at(40, 9, 0), lastSeen: at(3, 18, 20) },
    { uuid: 'v-05', name: 'Daniel Brooks', email: 'daniel@example.com', role: 'guest', photo: 95, firstSeen: at(6, 12, 45), lastSeen: at(4, 10, 15) },
    { uuid: 'v-06', name: '', email: '', role: 'guest', photo: 0, firstSeen: at(5, 14, 3), lastSeen: at(5, 14, 3) },
    { uuid: 'v-07', name: 'Meera Iyer', email: 'meera@example.com', role: 'vip', photo: 250, firstSeen: at(30, 15, 10), lastSeen: at(7, 11, 50) },
    { uuid: 'v-08', name: 'Arjun Nair', email: 'arjun@example.com', role: 'guest', photo: 60, firstSeen: at(9, 10, 20), lastSeen: at(9, 10, 20) },
  ];
}

/* ---------------------------------------------------------------- whiteboards */

// Points are fractions of the 16:9 board (0..1), as in the real whiteboard.
const ring = (cx, cy, rx, ry, n = 40) => [...Array(n + 1)].map((_, i) => ({ x: cx + rx * Math.cos((i / n) * Math.PI * 2), y: cy + ry * Math.sin((i / n) * Math.PI * 2) }));

export function seedWhiteboards() {
  return [{
    id: 'wb-zone-plan',
    name: 'Zone 02 plan',
    updatedAt: at(1, 17, 5),
    pages: [
      { surface: 'dark', strokes: [
        { tool: 'rect', color: '#ffffff', width: 4, points: [{ x: 0.12, y: 0.2 }, { x: 0.88, y: 0.85 }] },
        { tool: 'circle', color: '#a855f7', width: 8, points: [{ x: 0.4, y: 0.52 }, { x: 0.6, y: 0.74 }] },
        { tool: 'line', color: '#3b82f6', width: 8, points: [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.3 }] },
        { tool: 'pen', color: '#eab308', width: 4, points: ring(0.5, 0.42, 0.04, 0.06) },
      ] },
      { surface: 'light', strokes: [
        { tool: 'pen', color: '#ef4444', width: 8, points: [{ x: 0.2, y: 0.7 }, { x: 0.35, y: 0.4 }, { x: 0.5, y: 0.62 }, { x: 0.65, y: 0.3 }, { x: 0.8, y: 0.5 }] },
      ] },
    ],
  }];
}

export function seedState() {
  const types = [...new Set(EXPERIENCES.flatMap((e) => e.tags))];
  return {
    version: 1,
    screens: SCREENS.map((s) => ({ ...s, content: null, blanked: false, muted: true, queue: null })),
    experiences: EXPERIENCES.map((e) => ({ ...e, tags: [...e.tags], fields: e.fields ? { ...e.fields } : undefined })),
    media: MEDIA.map((m) => ({ ...m })),
    activity: [],
    environment: seedEnvironment(),
    visitors: seedVisitors(),
    whiteboards: seedWhiteboards(),
    experienceTypes: types.map((name) => ({ id: `type-${name.toLowerCase()}`, name })),
    welcomeArmed: false,
    live: {},                           // screenId → the whiteboard page being drawn live on it
  };
}
