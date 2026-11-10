import * as THREE from 'three';
import { CMS_URL, EMS_DISPLAYS, EMS_URL, GLOW, ZONES } from '../../config.js';
import { TeleportPoint } from '../../core/TeleportPoint.js';
import { LightPath } from '../../core/LightPath.js';
import { WebScreen } from '../../core/WebScreen.js';
import { clamp } from '../../util/tween.js';
import { WallDisplay } from './WallDisplay.js';
import { RoomDevices } from './RoomDevices.js';
import { LiveView } from './LiveView.js';
import { loadState, openChannel, resolveContent } from './shared/state.js';
import { WALLS as CANVAS_IDS, loadPush, openPushChannel, resolvePush } from './push/state.js';
import { setPushState } from './push/board.js';
import { setBoard, syncBoards } from './shared/render.js';
import { SCREENS as CMS_SCREENS, SCREEN_ZONES } from './shared/seed.js';
import { ENTRY, KIOSK, ROOM, SCREEN_W, SCREEN_Z, WALL_SCREENS, buildKiosk, buildRoom, buildWall } from './room.js';
import { CARDS, LINES, LIVE, MODES, OBJECTIVES } from './script.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const EYE = 1.65;
// This room's three screens in the Nex (the front wall's left, centre and right: the order of
// WALL_SCREENS in room.js); the canvas has its own ids for the same three (CANVAS_IDS).
const OWN = CMS_SCREENS.filter((s) => s.zone === 'cms').map((s) => s.id);

// The model is shown as the Welcome Zone shows its own: a 60° lens (wider than the Welcome Zone's
// 55°, for a room twice as wide), no bloom, drawn at the screen's own resolution.
const LENS = 60;
const sharp = () => Math.min(window.devicePixelRatio || 1, 1.75);

// Stops (the room is 15.2 m wide and 9.1 m deep, three screens on its front wall, the kiosk in
// the middle, the entrance in the rear wall): the entrance, and the kiosk's, behind it, looking
// along SIGHT. The room is only 9 m deep, so their rings are 1.5 m apart.
const ENTRANCE = { x: 0, z: 4, look: V(0, 2.1, ROOM.minZ) };
const STOP_Z = 2.5;
const STOP = V(KIOSK.x, EYE, STOP_Z);

// Using the kiosk (the client's call, 2026-10-12): the camera stays exactly as it is at the
// entrance (not even re-aimed), where the whole front wall is in view, and the kiosk comes to the
// visitor: it slides
// straight forward, along the floor, until its screen reaches the front of the view, as close as the
// screen still fits (inside `side` across and `bottom` down). The wall stands high enough (room.js)
// that the screens show above it there, none of them behind it. The page is used right there on
// the kiosk, and a push shows on the wall as it lands, with no camera move. MOVE_S: the slide.
// (From 2026-10-11 to 10-12 the camera leaned in square on to the model's kiosk and glanced up at
// its four screens on every push; the client found that too disturbing.)
const OPERATE = { side: 0.94, bottom: 0.97 };
const SIGHT = V(0, Math.sin(THREE.MathUtils.degToRad(-12)), -Math.cos(THREE.MathUtils.degToRad(-12)));
const MOVE_S = 1.4;

// The air conditioner, on the right wall between the front corner and the entrance, in view from
// the entrance; it faces into the room (-x).
const AC_AT = V(ROOM.maxX, 0, 1.3);

// The Environment page's changes (lights, AC, door) play out in the room with the camera where it
// is: no turn to show them (the client's call, 2026-10-12).

/**
 * Zone 02 — The Nex Zone.
 *
 * The client's four-screen room (room.js), with the zone's first touch point standing in it in
 * place of the model's own screens and kiosk: three screens on the front wall and
 * the wide pedestal kiosk in the middle. A switch in the top bar (MODES) turns the one setup
 * between two things:
 *  - Nex: the kiosk runs our Nex (app/, a page of this site in a WebScreen; first built as the
 *    Nex) and the three screens (WallDisplay) show whatever it assigns, kept in step over the
 *    BroadcastChannel in shared/state.js. Its Environment page also runs the room itself
 *    (RoomDevices): the ceiling disc and the cove, the air conditioner, the glass entrance door
 *    and the screens' volume; changes play out with the camera where it is.
 *  - Grid: the kiosk runs the canvas (push/, a replica of our Push) and the same
 *    three screens show what is thrown onto them (push/state.js).
 * Each screen has a display for each, in the same place; only the one for the switch's side shows.
 * Clicking the kiosk slides it straight up to the visitor at the entrance, and it is used right there on its sloped
 * screen, the front screens in view above. Both also run the screens of zones further on
 * (ScreensZone: built with this zone, so they're online from the start); a push to one of them
 * shows it landing there, live, in a panel over the view (LiveView), with a button to go there.
 * There are no doors: after the kiosk, a button takes the visitor on to Zone 03.
 */
export class CmsZone {
  static id = 'cms';

  constructor(app) {
    this.app = app;
    this.id = CmsZone.id;
    const i = ZONES.findIndex((z) => z.id === this.id);
    this.zone = ZONES[i];
    this.next = ZONES[(i + 1) % ZONES.length];
    this.mode = 'play';           // play | kiosk
    this.screenMode = 'cms';      // what the kiosk and the screens run: cms | canvas
    this.busy = false;
    this.going = null;
    this.at = 'entrance';          // the stop the visitor is at: entrance | kiosk (the camera stays at the entrance)
    this.done = new Set();
  }

  /* ------------------------------------------------------------------ build */

  build() {
    const { engine, interactions, audio, hud } = this.app;
    const root = (this.root = new THREE.Group());
    root.name = `zone-${this.id}`;
    engine.scene.add(root);

    this.room = buildRoom(root, { engine, kiosk: false, screens: false });
    engine.on('quality', (q) => this.room.setReflections(q === 'high'));
    this.room.ready.then((model) => {
      // No logo on the front wall here (the client's call, 2026-10-12): the screens carry the brand.
      const logo = model.getObjectByName('White_Tusker_Logo');
      if (logo) {
        logo.visible = false;
        const i = this.room.occluders.indexOf(logo);
        if (i >= 0) this.room.occluders.splice(i, 1);
      }
      interactions.addOccluders(this.room.occluders);
      engine.warm(this.root);
    }).catch((err) => console.error('Nex Zone: the room model could not load.', err));

    const screenHits = this.#buildScreens(root);
    const kioskHits = this.#buildKiosk(root);

    // The room's devices: the Environment page's lights are the model's ceiling disc (the
    // stretch fabric) and its warm cove (the strip light); the AC on the right wall; the glass
    // door in the entrance.
    this.devices = new RoomDevices(root, {
      room: ROOM, entry: ENTRY, audio,
      lines: [{ mesh: this.room.cove, level: 1 }],
      fabric: { mesh: this.room.disc },
      ac: { at: AC_AT, rotation: -Math.PI / 2 },
    });
    // The room's baked light follows the lights too, so turning them down or colouring them
    // changes the whole room, not just the disc and the cove.
    this.devices.adoptRoomGlow((rel) => this.room.setLight(rel));

    const look = STOP.clone().addScaledVector(SIGHT, 6);
    this.points = [
      new TeleportPoint({ id: 'entrance', label: 'Entrance', short: 'Entrance', x: ENTRANCE.x, z: ENTRANCE.z, look: ENTRANCE.look }),
      new TeleportPoint({ id: 'kiosk', label: 'Kiosk', short: 'Kiosk', x: STOP.x, z: STOP.z, look }),
    ];
    for (const p of this.points) root.add(p.group);

    this.path = new LightPath([[0, ENTRY.z - 0.3], [0, ENTRANCE.z - 0.8], [STOP.x, STOP.z]]);
    this.path.revealTo(2);
    root.add(this.path.mesh);

    this.kioskItem = interactions.add({
      id: 'cms-kiosk', label: 'Kiosk', verb: MODES.verb[this.screenMode], objects: kioskHits, range: 24,
      onUse: () => this.useKiosk(),
    });
    interactions.add({
      id: 'cms-screens', label: 'Screens', verb: 'About', objects: screenHits, range: 30,
      onUse: () => hud.info(CARDS.screens),
    });
    for (const p of this.points) {
      interactions.add({
        id: `cms-tp-${p.id}`, label: p.label, verb: 'Go to', objects: [p.hit], range: 40,
        onHover: (on) => p.setHover(on),
        onUse: () => this.teleportTo(p),
      });
    }

    // The Nex screens follow the Nex: its state, pushed on every change, and video commands.
    this.state = loadState();
    this.channel = openChannel((msg) => {
      if (msg?.type === 'state') { this.state = msg.state; this.#showState(); }
      if (msg?.type === 'video') this.walls[msg.screenId]?.command(msg.action);
      if (msg?.type === 'board') setBoard(msg.screenId, msg.page);
      if (msg?.type === 'identify') this.devices.identify(msg.uuids ?? []);
      if (msg?.type === 'event' && this.app.zone === this) this.#onCmsEvent(msg.name);
      if (msg?.type === 'pushed' && this.app.zone === this) this.#pushed(msg.ids ?? []);
    });
    this.#showState();
    hud.on('sound', (on) => this.#sound(on));

    // The canvas screens follow the Grid over their own channel (push/state.js).
    // board.js draws what isn't one plain picture: a split screen, a shared canvas, pen notes.
    this.push = loadPush();
    setPushState(this.push);
    this.pushChannel = openPushChannel((msg) => {
      if (msg?.type === 'state') { this.push = msg.state; setPushState(this.push); this.#showPush(); }
      if (msg?.type === 'video') { this.canvasWalls[msg.screenId]?.command(msg.action, msg.value); this.#videoStates(); }
      if (msg?.type === 'event' && this.app.zone === this) this.#onPushEvent(msg.name, msg.ids ?? []);
    });
    this.#showPush(false);
    this.#applyMode();

    // The zones further on whose screens the kiosk runs, and the live view of them.
    for (const r of new Set(SCREEN_ZONES.map((z) => z.room))) if (r !== this.id) this.app.zoneFor(r);
    this.liveView = new LiveView(this.app, { words: LIVE, onGo: (zoneId, screenId) => this.goToScreen(zoneId, screenId) });
    hud.on('mode', (id) => { if (this.app.zone === this) this.setScreenMode(id); });
    hud.on('skip', () => {
      if (this.app.zone !== this) return;
      if (this.mode === 'kiosk') this.leaveKiosk();
    });
  }

  /**
   * The front wall's three screens (room.js, buildWall), each with a display for the Nex (a
   * WallDisplay drawing what it assigns, or, with the live Nex, its display page in a WebScreen)
   * and one for the canvas, in the same place. Returns everything you can point at.
   */
  #buildScreens(root) {
    this.walls = {};          // Nex (replica): id → WallDisplay
    this.displays = {};       // Nex (live, EMS_DISPLAYS): id → WebScreen
    this.canvasWalls = {};    // canvas: id → WallDisplay
    const wall = buildWall(root);
    this.room.adopt(wall.materials);
    const hits = [...wall.hits];
    wall.sections.forEach(({ group: g, width, height }, i) => {
      g.translateZ(0.002);     // just clear of the frame
      const id = OWN[i];
      if (EMS_DISPLAYS?.[id]) {
        const name = CMS_SCREENS.find((x) => x.id === id)?.name ?? id;
        // Laid out 540 px tall (half of 1080p: seen from metres away, and far cheaper for the kiosk).
        const page = new WebScreen(this.app.engine, { url: EMS_DISPLAYS[id], width, height, viewport: [Math.round((540 * width) / height), 540], title: `${name} display` });
        this.displays[id] = page;
        g.add(page.group);
        hits.push(page.backing);
      } else {
        const d = new WallDisplay({ width, height, bezel: false });
        this.walls[id] = d;
        g.add(d.group);
        hits.push(...d.hitTargets);
      }
      if (CMS_URL) {
        const c = new WallDisplay({ width, height, bezel: false });
        this.canvasWalls[CANVAS_IDS[i]] = c;
        g.add(c.group);
        hits.push(...c.hitTargets);
      }
    });
    return hits;
  }

  /**
   * The kiosk (room.js, buildKiosk) and its two pages (the Nex, and the canvas if there is one)
   * on its wide sloped screen; only the one the switch is on shows. Returns what you point at to use it.
   */
  #buildKiosk(root) {
    const { engine } = this.app;
    const kiosk = (this.kiosk = buildKiosk(root));
    this.kioskHome = kiosk.group.position.z;   // it slides toward the visitor while in use (#kioskZ)
    this.room.adopt(kiosk.materials);
    // 1280 × 576 CSS pixels (20:9, like the screen) on a 2.1 m screen.
    const page = (url, title) => new WebScreen(engine, { url, width: KIOSK.w, height: KIOSK.h, viewport: [1280, 576], title });
    this.pages = { cms: page(EMS_URL, 'White Tusker Nex') };
    if (CMS_URL) this.pages.canvas = page(CMS_URL, 'Grid');
    for (const p of Object.values(this.pages)) {
      p.group.position.z = 0.002;
      kiosk.mount.add(p.group);
    }
    return [...kiosk.hits, ...Object.values(this.pages).map((p) => p.backing)];
  }

  /** The page on the kiosk now. */
  get page() {
    return this.pages[this.screenMode];
  }

  /** Show the screens' displays for the switch's side (the other side's rest, paused and silent). */
  #applyMode() {
    const cms = this.screenMode === 'cms';
    const here = this.app.zone === this;
    for (const w of Object.values(this.walls)) { w.group.visible = cms; if (!cms || !here) w.pause(); else w.resume(); }
    for (const w of Object.values(this.canvasWalls)) { w.group.visible = !cms; if (cms || !here) w.pause(); else w.resume(); }
    this.#sound(this.app.hud.soundOn);
    this.kioskItem.verb = MODES.verb[this.screenMode];
  }

  /**
   * The switch: the kiosk and the three screens turn to the Nex or to the canvas. In use at the
   * kiosk, the other page takes over right there.
   */
  setScreenMode(id) {
    const { hud, travis } = this.app;
    if (id === this.screenMode || !this.pages[id] || this.busy) {
      this.#showSwitch();
      return;
    }
    const using = this.mode === 'kiosk';
    this.page.setInteractive(false);
    this.page.hide();
    this.screenMode = id;
    this.#applyMode();
    this.#showState();
    this.#showPush(false);
    this.page.load();
    if (using) this.page.setInteractive(true, { flat: false });
    this.#showSwitch();
    this.app.audio.whoosh(0.6);
    if (hud.infoId === 'cms' || hud.infoId === 'canvas') hud.info(CARDS[id]);
    if (id === 'canvas') hud.completeObjective('canvas');
    const key = `switch-${id}`;
    if (!this.done.has(key)) {
      this.done.add(key);
      if (id === 'canvas') this.done.add('canvas');
      // The first time at the kiosk on this side, its own introduction says it all.
      const intro = using && !this.done.has(`in-${id}`);
      if (intro) this.done.add(`in-${id}`);
      travis.say(intro ? LINES.kioskIn[id] : LINES.switched[id], { interrupt: true });
    }
  }

  #showSwitch() {
    if (!CMS_URL) return;
    this.app.hud.modeSwitch(MODES.options, this.screenMode, MODES.label);
  }

  #showState() {
    syncBoards(this.state);
    const env = this.state.environment;
    const audio = env?.audio;
    const volume = audio ? (audio.power && !audio.muted ? audio.volume / 100 : 0) : 1;
    for (const id of Object.keys(this.walls)) {
      const screen = this.state.screens.find((s) => s.id === id);
      this.walls[id].setVolume(volume);
      this.walls[id].show(resolveContent(this.state, screen ?? { id, content: null }));
    }
    if (this.app.zone !== this || this.screenMode !== 'cms') for (const w of Object.values(this.walls)) w.pause();
    this.#volumeBar(env);
    this.devices.apply(env);
  }

  /** A change of sound shows the volume bar on the walls it affects (those playing a video). */
  #volumeBar(env) {
    if (!env) return;
    const a = env.audio;
    const screens = this.state.screens.filter((s) => this.walls[s.id]);
    const prev = this.soundKeys;
    this.soundKeys = Object.fromEntries(screens.map((s) => [s.id, `${a.power}:${a.muted}:${a.volume}:${s.muted}`]));
    if (!prev) return;
    for (const s of screens) {
      if (prev[s.id] === this.soundKeys[s.id]) continue;
      const r = resolveContent(this.state, s);
      if (r.kind !== 'media' || r.type !== 'video') continue;
      if (s.muted && prev[s.id]?.endsWith(':true')) continue;   // silent before and after
      const off = !a.power || a.muted || s.muted;
      this.walls[s.id].showVolume(off ? 0 : a.volume, off);
    }
  }

  /** Sound on the switch's side only, and only while the visitor is in the zone. */
  #sound(on) {
    const here = on && this.app.zone === this;
    for (const w of Object.values(this.walls)) w.setSound(here && this.screenMode === 'cms');
    for (const w of Object.values(this.canvasWalls)) w.setSound(here && this.screenMode === 'canvas');
  }

  /** The canvas screens show what was thrown onto them; slide: it slides on from the side it was thrown from. */
  #showPush(slide = true) {
    for (const [id, w] of Object.entries(this.canvasWalls)) {
      const s = this.push.screens.find((x) => x.id === id);
      w.show(resolvePush(this.push, id), { enter: slide ? s?.enter : null });
    }
    if (this.app.zone !== this || this.screenMode !== 'canvas') for (const w of Object.values(this.canvasWalls)) w.pause();
  }

  /** How each canvas screen's video is playing, for the controls on the canvas's cards. */
  #videoStates() {
    for (const [id, w] of Object.entries(this.canvasWalls)) {
      const v = w.videoState();
      if (v) this.pushChannel.post({ type: 'video-state', screenId: id, ...v });
    }
  }

  #onPushEvent(name, ids) {
    const { hud, travis } = this.app;
    if (name === 'card' && !this.done.has('canvasCard')) {
      this.done.add('canvasCard');
      travis.say(LINES.canvasCard, { interrupt: true });
    }
    if (name === 'push' && !this.done.has('canvasPush')) {
      this.done.add('canvasPush');
      hud.completeObjective('canvasPush');
      travis.say(LINES.canvasPush, { interrupt: true });
    }
    // Thrown to a screen in another zone: show it landing there, as for the Nex.
    if (name === 'push') this.#pushed(ids, 'push');
  }

  #onCmsEvent(name) {
    const { hud, travis } = this.app;
    if ((name === 'assign' || name === 'publish-all') && !this.done.has('assign')) {
      this.done.add('assign');
      hud.completeObjective('assign');
      travis.say(LINES.firstAssign, { interrupt: true });
    }
    if (name === 'publish-all' && !this.done.has('all')) {
      this.done.add('all');
      hud.completeObjective('all');
      travis.say(LINES.publishAll, { interrupt: true });
    }
    if (name === 'upload' && !this.done.has('upload')) {
      this.done.add('upload');
      travis.say(LINES.upload, { interrupt: true });
    }
    // The first time the Environment page changes the room, or a board goes live on a screen.
    const once = { 'env-light': 'lights', 'env-mode': 'lights', whiteboard: 'whiteboard', welcome: 'welcome', 'env-lock': 'lock', 'env-climate': 'climate' }[name];
    if (once && !this.done.has(once)) {
      this.done.add(once);
      travis.say(LINES[once], { interrupt: true });
    }
    // A pushed video's sound: after the line about the push, not over it.
    if (name === 'video-sound' && !this.done.has('audio')) {
      this.done.add('audio');
      travis.say(LINES.audio);
    }
  }

  /**
   * The Nex or the canvas pushed to these screens: if one is in another zone, show it there,
   * live. A push that also reached this room's screens is in view already.
   */
  #pushed(ids, from = 'cms') {
    const s = ids.map((id) => CMS_SCREENS.find((x) => x.id === id)).find((x) => x && x.zone !== this.id);
    if (!s) return;
    const meta = SCREEN_ZONES.find((z) => z.id === s.zone);
    const zone = meta && this.app.zoneFor(meta.room);
    if (!zone?.screenView) return;
    // What it shows now, from whichever pushed.
    const screen = from === 'push' ? this.push.screens.find((x) => x.id === s.id) : this.state.screens.find((x) => x.id === s.id);
    const r = screen && (from === 'push' ? resolvePush(this.push, s.id) : resolveContent(this.state, screen));
    const what = r?.kind === 'whiteboard' ? `Whiteboard · ${r.title}` : r?.kind === 'push-board' ? 'The shared canvas' : r?.kind === 'push-split' ? 'A split screen' : r?.title ?? '';
    this.app.hud.info(null);
    this.liveView.show(zone, s.id, { where: meta.label, name: screen?.name ?? s.name, what });
    if (!this.done.has('remote')) {
      this.done.add('remote');
      this.app.hud.completeObjective('remote');
      this.app.travis.say(LINES.remote, { interrupt: true });
    }
  }

  /**
   * The live view's "Go there": straight from wherever the visitor is in this room (the kiosk
   * too: leave() puts it away) to the screen in its zone. Coming back, they land at the kiosk.
   */
  async goToScreen(zoneId, screenId) {
    const { app } = this;
    if (this.busy || app.player.scripted || app.zone !== this) return;
    this.busy = true;
    this.liveView.hide();
    app.block('portal');
    app.audio.whoosh(1.8);
    await app.goTo(zoneId, { at: screenId });
    app.unblock('portal');
    this.busy = false;
  }

  #minimap() {
    const { minX, maxX, minZ, maxZ } = ROOM;
    const d = ENTRY.width / 2;
    const screens = WALL_SCREENS.map(({ x }) => ({ type: 'line', cls: 'screen', x1: x - SCREEN_W / 2, z1: SCREEN_Z, x2: x + SCREEN_W / 2, z2: SCREEN_Z }));
    return {
      viewBox: [minX - 0.8, minZ - 0.8, maxX - minX + 1.6, maxZ - minZ + 1.6],
      walls: [[minX, minZ, maxX, minZ], [minX, minZ, minX, maxZ], [maxX, minZ, maxX, maxZ], [minX, maxZ, -d, maxZ], [d, maxZ, maxX, maxZ]],
      features: [...screens, { type: 'rect', cls: 'holo', x: KIOSK.x, z: KIOSK.z, w: KIOSK.w + KIOSK.bezel * 2, d: 0.68 }],
      points: this.points.map((p) => ({ id: p.id, x: p.x, z: p.z, label: p.label })),
    };
  }

  /* ---------------------------------------------------------------- flow */

  /** The model's look while the visitor is here (on), and the other zones' back as they leave (off). */
  #view(on) {
    const { player, engine } = this.app;
    if (on && !this.viewOn) this.otherLens = player.baseFov;
    if (!on && !this.viewOn) return;
    this.viewOn = on;
    player.baseFov = on ? LENS : this.otherLens;
    engine.bloom.enabled = !on && GLOW > 0;
    engine.setMinRatio(on ? sharp() : null);
  }

  attract() {}

  /**
   * at: 'kiosk' to come straight back to the kiosk and into
   * using it (the way back from a screen the live view's "Go there" went to).
   */
  arrive({ at = null } = {}) {
    const { hud, player, travis } = this.app;
    this.#view(true);
    this.mode = 'play';
    this.busy = false;
    this.going = null;
    this.at = 'entrance';
    hud.setZone(this.zone);
    hud.setStops(this.points.map((p) => ({ id: p.id, label: p.short })));
    hud.setMinimap(this.#minimap());
    hud.setObjectives(OBJECTIVES);
    for (const id of this.done) hud.completeObjective(id);
    hud.showPlayUI(true);
    hud.enterButton(false);
    this.#showSwitch();

    const kiosk = at === 'kiosk';
    player.setPose(ENTRANCE.x, ENTRANCE.z, ENTRANCE.look);
    if (!kiosk) hud.stopTitle(`Zone ${this.zone.n} · ${this.zone.verb}`, this.zone.name);
    travis.say(kiosk ? LINES.backKiosk : this.visited ? LINES.back : LINES.arrival, { interrupt: true });
    this.visited = true;

    // Both pages load now, so the switch is instant. Tell the Nex and the canvas the three screens
    // are on, and keep telling them (online status). The entrance camera "sees" the visitor too:
    // they join the Nex's Visitors list live.
    for (const p of Object.values(this.pages)) p.load();
    this.#applyMode();
    for (const d of Object.values(this.displays)) d.load();
    this.channel.post({ type: 'hello', ids: OWN });
    this.pushChannel.post({ type: 'hello', ids: CANVAS_IDS });
    const beat = () => {
      this.channel.post({ type: 'online', ids: OWN });
      this.channel.post({ type: 'visitor' });
      this.pushChannel.post({ type: 'online', ids: CANVAS_IDS });
    };
    beat();
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(beat, 2000);
    clearInterval(this.videoTimer);
    this.videoTimer = setInterval(() => this.#videoStates(), 500);
    // At the entrance: the kiosk slides straight to the visitor.
    if (kiosk) this.useKiosk();
  }

  leave() {
    const { app } = this;
    // Leaving from the kiosk (the live view's "Go there"): put it away.
    if (this.mode !== 'play') { this.#stopUsing(); app.player.eyeHeight = EYE; app.unblock('kiosk'); }
    this.#view(false);
    app.hud.modeSwitch(null);
    this.liveView.hide();
    this.slide?.done();
    this.slide = null;
    this.kiosk.group.position.z = this.kioskHome;
    this.#showStops(true);
    this.mode = 'play';
    for (const p of Object.values(this.pages)) p.hide();
    for (const w of [...Object.values(this.walls), ...Object.values(this.canvasWalls)]) { w.pause(); w.setSound(false); }
    for (const d of Object.values(this.displays)) d.hide();
    clearInterval(this.heartbeat);   // the Nex shows the screens offline once the visitor leaves
    clearInterval(this.videoTimer);
  }

  /** On to Zone 03: the button after the kiosk (no doors in this room; the portal transition takes them). */
  async goNext() {
    const { app } = this;
    const { hud, audio } = app;
    if (this.busy || this.mode !== 'play') return;
    this.busy = true;
    app.block('portal');
    hud.info(null);
    hud.skipButton(false);
    hud.completeObjective('next');
    hud.stopTitle(null);
    audio.whoosh(1.8);
    await app.goTo(this.next.id);
    app.unblock('portal');
    this.busy = false;
  }

  /* ---------------------------------------------------------------- kiosk */

  /**
   * Where the kiosk comes to in the view as it is now (the camera held still): as close to the eye
   * as its screen still fits (OPERATE).
   */
  #kioskZ() {
    const { engine } = this.app;
    const cam = engine.camera;
    cam.updateMatrixWorld();
    const eye = cam.position;
    const { group } = this.kiosk;
    const { backing, width: w, height: h } = this.page;
    backing.updateWorldMatrix(true, false);
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y]) => V((x * w) / 2, (y * h) / 2, 0).applyMatrix4(backing.matrixWorld));
    const fits = (dz) => corners.every((c) => {
      const p = c.clone().setZ(c.z + dz).project(cam);
      return Math.abs(p.x) <= OPERATE.side && p.y >= -OPERATE.bottom && p.y <= 1;
    });
    for (let z = eye.z - 0.45; z > this.kioskHome; z -= 0.02) if (fits(z - group.position.z)) return z;
    return this.kioskHome;
  }

  /** Slide the kiosk to `z` over MOVE_S seconds (update() drives it); resolves when it is there. */
  #slideKiosk(z) {
    this.slide?.done();
    return new Promise((done) => { this.slide = { from: this.kiosk.group.position.z, to: z, t: 0, done }; });
  }

  /** The stops' rings and the light path, hidden while the kiosk is out in front of the entrance. */
  #showStops(on) {
    for (const p of this.points) p.group.visible = on;
    this.path.mesh.visible = on;
  }

  /**
   * Using the kiosk: the camera stays as it is (from further in, the Kiosk stop, it goes back to the
   * entrance first), and the kiosk slides straight forward to the front of the view (#kioskZ); the
   * page the switch is on is used right there on it.
   */
  async useKiosk() {
    const { app } = this;
    const { player, hud, travis, engine } = app;
    if (this.busy || this.mode !== 'play' || player.scripted) return;
    this.busy = true;
    this.mode = 'kiosk';
    this.at = 'kiosk';
    app.block('kiosk');
    hud.info(null);
    hud.stopTitle(null);
    hud.showPlayUI(false);
    hud.skipButton(false);
    this.page.load();
    this.onKey = (e) => { if (e.code === 'Escape') this.leaveKiosk(); };
    addEventListener('keydown', this.onKey);

    const entrance = this.points[0];
    player.eyeHeight = EYE;
    if (Math.hypot(player.pos.x - entrance.x, player.pos.z - entrance.z) > 0.3) {
      await player.travel(entrance, { look: entrance.look });
      if (this.mode !== 'kiosk') return;
    }
    player.holdView();
    this.#showStops(false);
    await this.#slideKiosk(this.#kioskZ());
    if (this.mode !== 'kiosk') return;
    // The page stays on the kiosk, in 3D, so the camera must not move while it's in use.
    this.page.setInteractive(true, { flat: false });
    this.offResize = engine.on('resize', () => {
      if (this.mode !== 'kiosk' || player.scripted) return;
      this.slide?.done();
      this.slide = null;
      this.kiosk.group.position.z = this.#kioskZ();
    });
    hud.skipButton(true, 'Back to the room');
    this.busy = false;

    if (!this.done.has('kiosk')) {
      this.done.add('kiosk');
      hud.completeObjective('kiosk');
    }
    const intro = `in-${this.screenMode}`;
    if (!this.done.has(intro)) {
      this.done.add(intro);
      travis.say(LINES.kioskIn[this.screenMode], { interrupt: true });
    }
  }

  #stopUsing() {
    const { hud } = this.app;
    this.offResize?.();
    this.offResize = null;
    removeEventListener('keydown', this.onKey);
    this.page.setInteractive(false);
    hud.skipButton(false);
  }

  async leaveKiosk() {
    if (this.mode !== 'kiosk' || this.busy) return;
    const { app } = this;
    const { player, hud, travis } = app;
    this.busy = true;
    this.#stopUsing();
    player.eyeHeight = EYE;
    // The kiosk slides back to its place; the camera stays.
    await this.#slideKiosk(this.kioskHome);
    this.#showStops(true);
    this.mode = 'play';
    this.busy = false;
    app.unblock('kiosk');
    hud.showPlayUI(true);
    if (!this.done.has('kioskOut')) {
      this.done.add('kioskOut');
      travis.say(LINES.kioskOut, { interrupt: true });
    }
  }

  /* ---------------------------------------------------------------- moving */

  teleportById(id) {
    const p = this.points.find((x) => x.id === id);
    if (p) this.teleportTo(p);
  }

  /**
   * The arrows: the camera never leaves the entrance (the Kiosk stop uses the kiosk), so the stops
   * are kept as where the visitor is in the zone (this.at). → from the Entrance uses the kiosk, →
   * from the Kiosk goes on to Zone 03, whether or not it was used; ← from the Kiosk is the Entrance
   * again, ← from the Entrance back to Zone 01.
   */
  step(dir) {
    if (dir > 0) {
      if (this.at === 'kiosk') this.goNext();
      else this.useKiosk();
    } else if (this.at === 'kiosk') this.at = 'entrance';
    else this.goPrev();
  }

  /** Back to the zone before this one: ← from the first stop. */
  async goPrev() {
    const { app } = this;
    const { hud, audio } = app;
    if (this.busy || this.mode !== 'play' || !this.prev) return;
    this.busy = true;
    app.block('portal');
    hud.info(null);
    hud.skipButton(false);
    hud.stopTitle(null);
    audio.whoosh(1.8);
    await app.goTo(this.prev.id);
    app.unblock('portal');
    this.busy = false;
  }

  async teleportTo(dest) {
    const { app } = this;
    const { player, hud, audio } = app;
    // The Kiosk stop (its button, its ring) uses the kiosk: the camera stays at the entrance and
    // the kiosk slides to the visitor, rather than walking up to it.
    if (dest.id === 'kiosk') { this.useKiosk(); return; }
    if (dest.id === 'entrance') this.at = 'entrance';
    if (this.busy || player.scripted || this.mode !== 'play') return;
    const dist = Math.hypot(player.pos.x - dest.x, player.pos.z - dest.z);
    this.busy = true;
    this.going = dest.id;
    app.block('teleport');
    hud.stopTitle(null);
    if (dist > 0.3) audio.whoosh(clamp(dist / 5, 0.8, 2.4));
    await player.travel(dest, { look: dest.look });
    this.going = null;
    app.unblock('teleport');
    this.busy = false;
    const n = this.points.indexOf(dest) + 1;
    if (dist > 0.3) hud.stopTitle(`Zone ${this.zone.n} · Stop ${String(n).padStart(2, '0')}`, dest.label);
    if (dest.id === 'kiosk') hud.info(CARDS[this.screenMode]);
  }

  /* --------------------------------------------------------------- update */

  update(dt, t) {
    const { player, hud, engine } = this.app;
    if (this.slide) {
      const sl = this.slide;
      sl.t = Math.min(1, sl.t + dt / MOVE_S);
      const k = 0.5 - 0.5 * Math.cos(Math.PI * sl.t);        // the same sine ease as the camera's glide
      this.kiosk.group.position.z = sl.from + (sl.to - sl.from) * k;
      if (sl.t >= 1) { this.slide = null; sl.done(); }
    }
    if (this.mode === 'play') {
      hud.markStops({ here: this.going ? null : this.at, going: this.going, next: this.done.has('kiosk') ? null : 'kiosk' });
    }
    const cms = this.screenMode === 'cms';
    for (const w of Object.values(this.walls)) if (cms) w.update(dt);
    for (const w of Object.values(this.canvasWalls)) if (!cms) w.update(dt);
    for (const d of Object.values(this.displays)) d.update(dt, engine.camera, { allowed: cms });
    this.page.update(dt, engine.camera);
    this.devices.update(dt, t);
    this.path.update(dt, t);
    for (const p of this.points) p.update(dt, t, player.pos);
    hud.updateMinimap(player.pos.x, player.pos.z, player.yaw);
  }
}
