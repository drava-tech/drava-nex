import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/700.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/geist-sans/400.css';   // Zone 02's screens draw the Nex's experiences in Geist
import '@fontsource/geist-sans/700.css';
import './styles/main.css';

import { ALL_ZONES, ROOM_LIGHTS, SETTINGS, ZONES } from './config.js';
import { Engine } from './core/Engine.js';
import { Player } from './core/Player.js';
import { Interactions } from './core/Interactions.js';
import { Travis } from './core/Travis.js';
import { Bridge } from './core/Bridge.js';
import { AudioFX } from './core/AudioFX.js';
import { Hud } from './core/ui/Hud.js';
import { createZone } from './zones/index.js';

// Each zone has its own address: / is the Welcome Zone, /zone/<id> the others (not /<id>:
// /cms/ is the Nex replica's page). Opening one starts the visit there.
const zonePath = (id) => (id === 'welcome' ? '/drava-world/' : `/drava-world/zone/${id}`); // nex: served under /drava-world/
const zoneFromPath = () => {
  const id = location.pathname.match(/^\/drava-world\/zone\/([\w-]+)\/?$/)?.[1];
  return ALL_ZONES.some((z) => z.id === id) ? id : 'welcome';
};

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function loadFonts() {
  const faces = ['700 64px "Unbounded"', '500 32px "Unbounded"', '400 32px "Instrument Sans"', '500 32px "Instrument Sans"', '500 32px "JetBrains Mono"'];
  try {
    await Promise.race([Promise.all(faces.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 3000))]);
  } catch { /* fall back to system fonts */ }
}

async function boot() {
  const container = document.getElementById('app');
  if (!webglAvailable()) {
    document.getElementById('hud').innerHTML =
      '<div class="nogl"><h1>This browser can’t show 3D</h1><p>The virtual Experience Centre needs WebGL. Try the latest Chrome, Edge or Safari, and check that hardware acceleration is switched on.</p>'
      + '<p>If it worked a moment ago, the browser has switched 3D off after a graphics error. Close every window of the browser and open it again (a reload is not enough); chrome://gpu shows whether WebGL is back.</p></div>';
    return;
  }
  await loadFonts();

  const engine = new Engine(container, { quality: SETTINGS.quality });
  const canvas = engine.renderer.domElement;
  // The graphics driver can drop the 3D context mid-visit (a GPU reset). Say so and offer a reload,
  // instead of a frozen picture; if the browser gives the context back, reload straight away.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    const note = document.createElement('div');
    note.className = 'nogl lost';
    note.innerHTML = '<h1>The 3D view stopped</h1><p>The graphics driver reset. Reload to carry on; if this keeps happening, close other 3D tabs or switch Graphics to Performance on the start screen.</p><p><button type="button" class="btn big">Reload</button></p>';
    note.querySelector('button').addEventListener('click', () => location.reload());
    document.getElementById('hud').append(note);
  });
  canvas.addEventListener('webglcontextrestored', () => location.reload());
  const player = new Player(engine.camera, canvas);
  const interactions = new Interactions(engine.camera, canvas, player);
  const travis = new Travis();
  const hud = new Hud(document.getElementById('hud'), { zones: ZONES, settings: SETTINGS });
  const audio = new AudioFX();
  const bridge = new Bridge(SETTINGS.bridgeUrl, SETTINGS.bridgeEnabled);

  // Anything that should freeze looking and using (title screen, dialogs, cinematics,
  // travel) adds a reason to `blocks`; control returns when the set is empty.
  const blocks = new Set(['boot']);
  const sync = () => {
    const free = blocks.size === 0;
    player.enabled = free;
    interactions.enabled = free;
    if (!free) hud.prompt(null);
  };
  const app = {
    engine, player, interactions, travis, hud, audio, bridge,
    settings: SETTINGS,
    visitor: { name: null },
    // What this visitor has done, for the World Zone's recap. In the real centre each exhibit
    // logs it against the visitor's RFID wristband (or QR badge).
    visit: { start: Date.now(), zones: new Set(), memento: null, award: null, product: null },
    playing: false,
    block(reason) { blocks.add(reason); sync(); },
    unblock(reason) { blocks.delete(reason); sync(); },
  };
  sync();

  /* ---- wiring ---- */
  travis.on('line', (text, name) => hud.caption(text, name));
  travis.on('start', () => hud.speaking(true));
  travis.on('end', () => hud.speaking(false));

  hud.on('voice', (on) => travis.setVoice(on));
  hud.on('sound', (on) => audio.setEnabled(on));
  hud.on('quality', (q) => engine.setQuality(q));
  hud.on('overlay', (covered) => { if (covered) app.block('overlay'); else app.unblock('overlay'); });

  // An item with prompt: false shows no "Click · …" pill (e.g. where it would sit over a screen).
  interactions.on('hover', (item) => hud.prompt(item?.prompt === false ? null : item, { touch: SETTINGS.touch }));

  bridge.on('status', (s) => hud.bridge(s, bridge.url));
  hud.bridge(bridge.status, bridge.url);

  /* ---- zones ---- */
  // Every zone has its own group in the one scene; only the zone the visitor is in is
  // shown (hidden groups aren't drawn, lit or clickable). Zones are built on first visit.
  const zones = new Map();
  const zoneFor = (id) => {
    if (!zones.has(id)) {
      const z = createZone(id, app);
      z.build();
      if (!ROOM_LIGHTS) z.root.traverse((o) => { if (o.isLight) o.visible = false; });
      z.root.visible = false;
      zones.set(id, z);
    }
    return zones.get(id);
  };
  app.zoneFor = zoneFor;    // a zone, built if need be (Zone 02 builds the zones whose screens its Nex runs)
  app.zone = zoneFor(zoneFromPath());
  app.visit.zones.add(app.zone.id);
  history.replaceState(null, '', zonePath(app.zone.id) + location.search);   // an unknown /zone/... becomes /
  app.zone.root.visible = true;
  // Compile every shader and upload every texture now, behind the title screen. Otherwise
  // each wall stalls a frame the first time it comes into view (on the first glides).
  engine.warm(app.zone.root);

  /**
   * Teleport to another zone: the portal transition, then the visitor arrives at its door (or,
   * in a zone that knows it, at stop `at`: a screen the Nex just pushed to).
   */
  app.goTo = async (id, { from = app.zone.id, at = null } = {}) => {
    const next = zoneFor(id);
    const meta = ALL_ZONES.find((z) => z.id === id);
    app.block('zone');
    travis.stop();
    hud.info(null);
    hud.stopTitle(null);
    hud.skipButton(false);
    await Promise.all([hud.portal(meta.name, `Teleporting · Zone ${meta.n}`), engine.warm(next.root)]);
    app.zone.leave?.();
    app.zone.root.visible = false;
    next.root.visible = true;
    app.zone = next;
    app.visit.zones.add(id);
    // Not when the Back/Forward buttons brought us here: the address is already this zone's.
    if (location.pathname !== zonePath(id)) history.pushState(null, '', zonePath(id) + location.search);
    next.arrive({ from, at });
    await hud.endPortal();
    app.unblock('zone');
  };

  hud.on('teleport', (id) => app.zone.teleportById(id));

  // Floor map: click a zone to go straight there.
  hud.on('zone', (id) => {
    hud.close('map');
    if (id === app.zone.id || blocks.has('zone') || blocks.has('portal')) return;
    // Mid-tour or using an exhibit (studio, table top view, kiosk): finish that first, so
    // nothing is left half-open in the zone behind.
    if (app.zone.mode !== 'play') { hud.toast('Finish what you are doing here first, then pick a zone.'); return; }
    player.cancelTween(false);                       // stop any glide in this zone
    app.goTo(id);
  });
  // Browser Back/Forward: go to the zone in the address, if the visitor is free to leave.
  addEventListener('popstate', () => {
    const id = zoneFromPath();
    if (id === app.zone.id) return;
    if (!app.playing || app.zone.mode !== 'play' || blocks.has('zone') || blocks.has('portal')) {
      history.pushState(null, '', zonePath(app.zone.id) + location.search);   // stay put: put the address back
      return;
    }
    player.cancelTween(false);
    app.goTo(id);
  });
  hud.on('step', (dir) => app.zone.step(dir));
  hud.on('enter', () => app.zone.enter?.());

  let travelling = false;
  let fpsTick = 0;
  engine.onUpdate((dt, t) => {
    player.update(dt);
    travis.update(dt, t);
    interactions.update();
    app.zone.update(dt, t);

    if (player.scripted !== travelling) { travelling = player.scripted; container.classList.toggle('travelling', travelling); }
    if ((fpsTick += dt) > 0.5) { fpsTick = 0; hud.fps(engine.fps); }
  });
  engine.start();
  app.zone.attract();

  if (import.meta.env.DEV) window.vec = app; // handy in the browser console

  // The title screen is the Welcome Zone's front door only. Opened straight at another zone, the
  // visit starts at once, and sound on the first click or key (browsers allow audio only after one).
  if (app.zone.id === 'welcome') {
    await hud.showStart();
    audio.start();
  } else {
    for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => audio.start(), { once: true });
  }
  audio.setEnabled(hud.soundOn);
  app.playing = true;
  app.unblock('boot');
  app.zone.arrive();
}

boot();
