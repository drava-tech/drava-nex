// Central configuration: brand tokens, the zone registry and runtime settings.
// Runtime settings can be overridden from the URL, e.g.
//   ?bridge=ws://192.168.1.20:8765   point at a TRAVIS machine on the LAN
//   ?bridge=off                      never try to reach TRAVIS
//   ?quality=low                     skip reflections and heavy bloom
//   ?debug                           show an FPS counter
// Defaults per machine or deployment come from .env (see .env.example); the URL wins over both.

export const BRAND = {
  name: 'White Tusker',
  tagline: 'Architects of Experiences',
  email: 'hello@thewhitetusker.com',
};

// Large media (brand wall image and film) lives in the Cloudflare R2 bucket
// "virtual-experience-centre", served from its public URL. VITE_MEDIA_BASE in .env
// overrides it (e.g. a custom domain later).
const env = import.meta.env;
export const MEDIA_BASE = (env.VITE_MEDIA_BASE || 'https://pub-b087a9a8256a4a79a4c2272b6883f1cd.r2.dev').replace(/\/$/, '');

// Zone 02, the Nex Zone: one kiosk and three screens on the front wall, and a switch between the two things it runs.
// Nex: the built-in Nex (app/ in zones/cms, styled and laid out like cms-platform master; first
// built as the Nex), which also drives the three screens and the room's lights, AC, door and sound.
// VITE_EMS_URL in .env can point the kiosk at the live one on the office network instead
// (https://ec-cms/); the screens then show that one's display pages (a screen with none rests on
// the idle screen), but the room's devices don't follow it.
export const EMS_URL = env.VITE_EMS_URL || '/drava-world/cms/index.html';
export const EMS_BUILT_IN = EMS_URL.startsWith('/');
export const EMS_DISPLAYS = EMS_BUILT_IN ? null : {
  'vec-left': new URL('display/facade', EMS_URL).href,
  'vec-centre': new URL('display/main-screen', EMS_URL).href,
  'vec-right': new URL('display/kiosk', EMS_URL).href,
};
// Grid: the page the kiosk runs when the switch is on it. /push/ is the built-in
// replica of Push (zones/cms/push), which also drives the three screens. VITE_CMS_URL in .env can
// point it elsewhere; set it to "none" to leave the switch out (the kiosk runs the Nex only).
export const CMS_URL = env.VITE_CMS_URL === 'none' ? '' : env.VITE_CMS_URL || '/drava-world/push/index.html';

// Room lights (point, area and hemisphere lights) in every zone. Off: the rooms are lit only
// by their white light lines and screens, which glow on their own. Set true to bring them back.
export const ROOM_LIGHTS = false;

// Glow (bloom) around bright things: light lines, the arch and door frames, screens.
// 1 = the original glow, 0.5 = half of it, 0 = none (plain white lines, no haze).
export const GLOW = 0.5;

export const COLOR = {
  ground: 0x07080b,
  accent: 0xfbfaf5,     // white (the Nex off-white): the system / TRAVIS colour
  gold: 0xf2b544,
  warmWhite: 0xfff1e0,
  brand: 0xe21d3e,      // White Tusker red: the brand and the way on (doors, signs, calls to action), used sparingly
};

// Zone 02 is White Tusker's Nex. Its wall and doorway in the Welcome Zone are black with
// white light lines and white type (the client dropped the Nex product's sage green).
export const CMS_COLOR = {
  panel: 0x0c0d10,
  white: 0xfbfaf5,
};

// The loop, in visiting order; the last zone's door leads back to the Welcome Zone.
// status: 'live' (built), 'next' (being built: some of it works), 'empty' (the room exists but is empty for now)
export const ZONES = [
  { id: 'welcome', n: '01', verb: 'Welcome', name: 'The Welcome Zone', short: 'Welcome', status: 'live',
    blurb: 'Step inside, tour the zone with TRAVIS, meet our CEO in the Holobox, our brand film and live Mosaic.' },
  { id: 'cms', n: '02', verb: 'Command', name: 'The Nex Zone', short: 'Nex', status: 'live',
    blurb: 'One kiosk, three screens on the wall: run them from our Nex, or switch to the Grid and throw content onto them.' },
  { id: 'saas', n: '03', verb: 'Connect', name: 'The SaaS Zone', short: 'SaaS', status: 'live',
    blurb: 'Two of our own products on two screens: Core and our Care. Watch the film, then use it live.' },
  { id: 'simulation', n: '04', verb: 'Simulate', name: 'The Simulation Zone', short: 'Simulation', status: 'live',
    blurb: 'The Lab: build a race car on the bench while our vision AI checks every step.' },
  { id: 'objects', n: '05', verb: 'Touch', name: 'The Orca Zone', short: 'Orca', status: 'live',
    blurb: 'A LiDAR memento wall, a tangible table, lift-and-learn pressure pads and an RFID accolade wall.' },
  { id: 'immersive', n: '06', verb: 'Feel', name: 'The World Zone', short: 'World', status: 'live',
    blurb: 'A room made of screens, walls, ceiling and floor: stand in the ocean, leave under a waterfall, see your visit.' },
];

// Rooms off the loop: not on the floor map, no door in from another zone. The floors belong to
// Zone 02 (its number): the Nex and the Grid there push to each floor's screen, and
// their live view's "Go there" takes the visitor in; a button leads back to Zone 02 (back).
export const SIDE_ZONES = [
  { id: 'floor1', n: '02', verb: 'Extend', name: 'The First Floor', short: 'First floor', status: 'live', back: 'cms',
    blurb: 'A screen on the first floor, run from the kiosk in Zone 02: push to it from the Nex or the Grid, and watch it land here.' },
  { id: 'floor2', n: '02', verb: 'Extend', name: 'The Second Floor', short: 'Second floor', status: 'live', back: 'cms',
    blurb: 'A screen on the second floor, run from the kiosk in Zone 02: push to it from the Nex or the Grid, and watch it land here.' },
];
export const ALL_ZONES = [...ZONES, ...SIDE_ZONES];

const params = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer: coarse)').matches;

export const SETTINGS = {
  bridgeUrl: params.get('bridge') && params.get('bridge') !== 'off' ? params.get('bridge') : env.VITE_TRAVIS_BRIDGE_URL || 'ws://localhost:8765',
  bridgeEnabled: params.has('bridge') ? params.get('bridge') !== 'off' : env.VITE_TRAVIS_BRIDGE !== 'off',
  quality: params.get('quality') === 'low' || params.get('quality') === 'high' ? params.get('quality') : coarse ? 'low' : 'high',
  debug: params.has('debug'),
  touch: coarse,
};
