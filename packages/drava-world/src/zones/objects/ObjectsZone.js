import * as THREE from 'three';
import { GLOW, ZONES } from '../../config.js';
import { TeleportPoint } from '../../core/TeleportPoint.js';
import { LightPath } from '../../core/LightPath.js';
import { clamp, wait } from '../../util/tween.js';
import { FONT, canvasTexture, spacedText } from '../../util/textures.js';
import { ROOM, ENTRY, PUCKS, TABLE as T, WALL, WALL_Z, buildRoom, screenTexture } from './room.js';
import { KIOSK_AT, ProductWall, READER } from './ProductWall.js';
import { TangibleTable, TABLE as TT, VIEW } from './TangibleTable.js';
import { CARDS, LINES, METHODS, OBJECTIVES, SHOES, TABLE, TABLE_SCREEN, shoeName } from './script.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const EYE = 1.65;
// The model is shown as the Welcome and Nex Zones show theirs: a 60° lens, no bloom, sharp.
const LENS = 60;
const sharp = () => Math.min(window.devicePixelRatio || 1, 1.75);

// Stops: the entrance, the product wall (its kiosk beside it, KIOSK_AT) and the tangible table.
const ENTRANCE = { x: 0, z: 3.9, look: V(0, 2.0, ROOM.minZ) };
const PRODUCTS = { x: -4.1, z: 1.0, look: V(-4.3, 1.7, WALL_Z) };   // a little left and down: the whole kiosk in view too

// Using the kiosk: the camera leans in square on to its 50° screen, the picture filling `fill` of
// the view. A colourway chosen there glances over at the wall to show it (GLANCE), and back.
const KIOSK_FILL = 0.9;
const MOVE_S = 1.3;
const GLANCE = { turn: 1.1, hold: 2.6 };

// The tangible table: the old concept (discs, windows, a zoom disc, seen from straight above) on the
// model's table; its pucks give way to the discs. The top view uses a longer lens, so it reads like
// a plan, and stays under the hanging light. The table stop is square on to it (same x), so rising
// to it is a move in one vertical plane and the view never turns.
const TOP_FOV = 45;
const TOP_MAX_Y = 3.5;
const TOP_X = T.x + (VIEW.minX + VIEW.maxX) / 2;
const TOP_Z = T.z + (VIEW.minZ + VIEW.maxZ) / 2;
const TABLE_STOP = { x: TOP_X, z: 0.6, look: V(TOP_X, 1.4, WALL_Z) };

/**
 * Zone 05 — The Orca Zone: the client's product and tangible experience room (room.js).
 *   Product wall    six concept shoes in lit niches and a kiosk beside them. A switch in the top bar
 *                   (METHODS) picks how the wall recognises a shoe: pressure (click to lift it off its
 *                   pad), LiDAR (point at it and hold: no touch; a grid of light shows the sensing
 *                   plane) or RFID (click to place it on the reader). The kiosk opens the shoe it
 *                   recognised. Or use the kiosk (square on): choose a colourway and the wall presents it.
 *   Tangible table  click the table for a top view; drag discs onto the glass (each opens a window
 *                   beside it), turn them, turn the zoom disc. The 85" screen shows what is open.
 * There are no doors: → from the last stop goes on to Zone 06, ← from the first back to Zone 04.
 * The words are in script.js.
 */
export class ObjectsZone {
  static id = 'objects';

  constructor(app) {
    this.app = app;
    this.id = ObjectsZone.id;
    const i = ZONES.findIndex((z) => z.id === this.id);
    this.zone = ZONES[i];
    this.next = ZONES[(i + 1) % ZONES.length];
    this.mode = 'play';          // play | kiosk | table | show
    this.method = 'pressure';    // how the product wall recognises a shoe
    this.busy = false;
    this.going = null;
    this.button = null;
    this.done = new Set();
  }

  /* ------------------------------------------------------------------ build */

  build() {
    const { engine, interactions, hud } = this.app;
    const root = (this.root = new THREE.Group());
    root.name = `zone-${this.id}`;
    engine.scene.add(root);

    this.room = buildRoom(root, { engine });
    engine.on('quality', (q) => this.room.setReflections(q === 'high'));
    this.wall = new ProductWall(SHOES, { reader: METHODS.reader });
    root.add(this.wall.group);
    this.table = new TangibleTable({ ...TABLE, body: false });
    this.table.group.position.set(T.x, 0, T.z);     // unturned: the top view relies on it
    root.add(this.table.group);
    this.screen = canvasTexture(1600, 900);
    this.screenKey = null;
    this.#drawScreen();

    this.points = [
      new TeleportPoint({ id: 'entrance', label: 'Entrance', short: 'Entrance', ...ENTRANCE }),
      new TeleportPoint({ id: 'products', label: 'Product wall', short: 'Products', ...PRODUCTS }),
      new TeleportPoint({ id: 'table', label: 'Tangible table', short: 'Table', ...TABLE_STOP }),
    ];
    for (const p of this.points) root.add(p.group);
    this.path = new LightPath([[0, ENTRY.z - 0.3], [0, ENTRANCE.z - 0.8], [-1.6, 2.0], [PRODUCTS.x, PRODUCTS.z], [0, 1.4], [TABLE_STOP.x, TABLE_STOP.z]]);
    this.path.revealTo(3);
    root.add(this.path.mesh);

    // The model's meshes load after this: their items start empty and take them when it's in (#own).
    const play = () => this.mode === 'play';
    this.shoeItems = SHOES.items.map((s, i) => interactions.add({
      id: `shoe-${i}`, label: shoeName(s), verb: METHODS.verb[this.method], objects: [], range: 9, enabled: play,
      onHover: (on) => { if (this.method === 'lidar') this.wall.hover(on ? i : this.wall.hovered === i ? null : this.wall.hovered); },
      onUse: () => this.recognise(i, this.method),
    }));
    this.kioskItem = interactions.add({ id: 'objects-kiosk', label: 'Product kiosk', verb: 'Use the kiosk', objects: [], range: 12, enabled: play, onUse: () => this.useKiosk() });
    this.tableItem = interactions.add({ id: 'objects-table', label: 'Tangible table', verb: 'Look from above', objects: [...this.table.hitTargets], range: 10, enabled: play, onUse: () => this.useTable() });
    for (const p of this.points) {
      interactions.add({
        id: `objects-tp-${p.id}`, label: p.label, verb: 'Go to', objects: [p.hit], range: 40, enabled: play,
        onHover: (on) => p.setHover(on),
        onUse: () => this.teleportTo(p),
      });
    }

    this.room.ready.then((model) => {
      this.wall.attach(model);
      // A shoe is picked by itself or anywhere on its niche: a bigger target, and the LiDAR's reach zone.
      const niche = (i, part) => model.getObjectByName(`Product_Niche_${String(i + 1).padStart(2, '0')}_${part}`);
      this.wall.shoes.forEach((s, i) => this.#own(this.shoeItems[i], [...s.meshes, niche(i, 'Gold_Ring'), niche(i, 'Back'), niche(i, 'Shelf')]));
      this.#own(this.kioskItem, ['Kiosk_Screen_55in_50deg', 'Kiosk_55in_Housing', 'Kiosk_Screen_Bezel', 'Kiosk_Pedestal_Shell', 'Kiosk_Pedestal_Front', 'Kiosk_Base', 'Kiosk_Neck'].map((n) => model.getObjectByName(n)));
      this.#own(this.tableItem, ['Tangible_Table_Top', 'Tangible_Table_Pedestal', 'Tangible_Table_Base', 'Wall_Screen_85in_16x9'].map((n) => model.getObjectByName(n)));
      // The discs take the pucks' place; the table's own glass is drawn over the model's.
      for (const p of PUCKS) for (const n of [p.puck, p.ring, p.token]) { const m = model.getObjectByName(n); if (m) m.visible = false; }
      const surface = model.getObjectByName('Tangible_Table_75in_Touch_Surface');
      if (surface) surface.visible = false;
      const wallScreen = model.getObjectByName('Wall_Screen_85in_16x9');
      if (wallScreen) screenTexture(wallScreen, this.screen.texture);
      this.kioskScreen = model.getObjectByName('Kiosk_Screen_55in_50deg');
      interactions.addOccluders(this.room.occluders.filter((o) => o.visible));
      engine.warm(this.root);
    }).catch((err) => console.error('Orca Zone: the room model could not load.', err));

    this.wall.onDwell = (i) => this.recognise(i, 'lidar');
    this.wall.onRead = (i) => { this.app.audio.chime?.(); this.#tried('rfid', LINES.done.rfid(SHOES.items[i])); };
    this.table.onPlace = (d) => (d.kind === 'zoom' ? this.#say('zoom', LINES.tableZoom) : this.#tried('table', LINES.tablePlace(d)));

    hud.on('mode', (id) => { if (this.app.zone === this) this.setMethod(id); });
    hud.on('skip', () => {
      if (this.app.zone !== this) return;
      if (this.mode === 'kiosk') this.leaveKiosk();
      else if (this.mode === 'table') this.leaveTable();
    });
  }

  /** Make the model's meshes `list` what an item is clicked by. */
  #own(item, list) {
    for (const m of list) {
      if (!m) continue;
      m.traverse((o) => { o.userData.interactItem = item; });
      item.objects.push(m);
    }
  }

  #stop(id) {
    return this.points.find((p) => p.id === id);
  }

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

  #minimap() {
    const { minX, maxX, minZ, maxZ } = ROOM;
    const d = ENTRY.width / 2;
    return {
      viewBox: [minX - 0.8, minZ - 0.8, maxX - minX + 1.6, maxZ - minZ + 1.6],
      walls: [[minX, minZ, maxX, minZ], [minX, minZ, minX, maxZ], [maxX, minZ, maxX, maxZ], [minX, maxZ, -d, maxZ], [d, maxZ, maxX, maxZ]],
      features: [
        { type: 'line', cls: 'screen', x1: -5.6, z1: WALL_Z, x2: -2.0, z2: WALL_Z },
        { type: 'rect', cls: 'holo', x: KIOSK_AT.x, z: KIOSK_AT.z, w: 1.35, d: 0.6 },
        { type: 'rect', cls: 'furn', x: READER.x, z: READER.z, w: READER.w, d: READER.w },
        { type: 'line', cls: 'screen', x1: WALL.x - WALL.w / 2, z1: WALL.z, x2: WALL.x + WALL.w / 2, z2: WALL.z },
        { type: 'rect', cls: 'furn', x: T.x, z: T.z, w: T.w + 0.12, d: T.d + 0.12 },
      ],
      points: this.points.map((p) => ({ id: p.id, x: p.x, z: p.z, label: p.label })),
    };
  }

  /* ---------------------------------------------------------------- flow */

  attract() {}

  arrive() {
    const { hud, player, travis } = this.app;
    this.#view(true);
    this.mode = 'play';
    this.busy = false;
    this.going = null;
    this.button = null;
    hud.setZone(this.zone);
    hud.setStops(this.points.map((p) => ({ id: p.id, label: p.short })));
    hud.setMinimap(this.#minimap());
    hud.setObjectives(OBJECTIVES);
    for (const id of this.done) hud.completeObjective(id);
    hud.showPlayUI(true);
    hud.enterButton(false);
    hud.modeSwitch(METHODS.options, this.method, METHODS.label);
    player.eyeHeight = EYE;
    player.setPose(ENTRANCE.x, ENTRANCE.z, ENTRANCE.look);
    hud.stopTitle(`Zone ${this.zone.n} · ${this.zone.verb}`, this.zone.name);
    travis.say(this.visited ? LINES.back : LINES.arrival, { interrupt: true });
    this.visited = true;
  }

  leave() {
    const { app } = this;
    if (this.mode === 'table') {
      app.engine.container.classList.remove('using-screen');
      if (this.fov) app.player.baseFov = this.fov;
    }
    if (this.mode !== 'play') this.#stopUsing();
    app.hud.modeSwitch(null);
    this.wall.hover(null);
    this.#view(false);
    this.mode = 'play';
    this.button = null;
  }

  /** The first time the visitor does each thing: tick it off and TRAVIS says a line. */
  #tried(id, line) {
    if (this.done.has(id)) return;
    this.done.add(id);
    const { hud, travis } = this.app;
    hud.completeObjective(id);
    travis.say(line, { interrupt: true });
    if (OBJECTIVES.every((o) => o.id === 'next' || this.done.has(o.id))) travis.say(LINES.allDone);
  }

  /** A line the first time only, with no objective. */
  #say(id, line) {
    if (this.done.has(id)) return;
    this.done.add(id);
    this.app.travis.say(line, { interrupt: true });
  }

  #ready() {
    return OBJECTIVES.some((o) => o.id !== 'next' && this.done.has(o.id));
  }

  /** On to Zone 06: → from the last stop (this room has no doors). */
  async goNext() {
    const { app } = this;
    const { hud, audio } = app;
    if (this.busy || this.mode !== 'play') return;
    this.busy = true;
    app.block('portal');
    hud.info(null);
    hud.skipButton(false);
    this.button = null;
    hud.completeObjective('next');
    hud.stopTitle(null);
    audio.whoosh(1.8);
    await app.goTo(this.next.id);
    app.unblock('portal');
    this.busy = false;
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

  /* -------------------------------------------------------- product wall */

  /** The switch: how the wall recognises a shoe. A shoe out by the old method goes back. */
  setMethod(id) {
    const { hud, travis } = this.app;
    if (id === this.method || !METHODS.verb[id] || this.mode !== 'play') { hud.modeSwitch(METHODS.options, this.method, METHODS.label); return; }
    this.method = id;
    this.wall.setMode(id);
    for (const it of this.shoeItems) it.verb = METHODS.verb[id];
    hud.modeSwitch(METHODS.options, id, METHODS.label);
    this.app.audio.whoosh(0.5);
    this.#say(`method-${id}`, LINES.method[id]);
  }

  /** A shoe recognised by `how` (the switch's method): it is shown and the kiosk opens it. Again: it goes back. */
  recognise(i, how) {
    const { audio, visit } = this.app;
    if (this.wall.lifted === i && this.wall.how === how) { this.wall.drop(); audio.whoosh(0.5); return; }
    this.wall.lift(i, how);
    audio.whoosh(how === 'rfid' ? 0.9 : 0.6);
    visit.product = shoeName(SHOES.items[i]);                  // for the World Zone's recap
    if (how !== 'rfid') this.#tried(how, LINES.done[how](SHOES.items[i]));   // RFID: once it lands (onRead)
  }

  /** Square on to the kiosk's sloped screen (wherever it stands), the picture filling KIOSK_FILL of the view. */
  #kioskView() {
    const { camera } = this.app.engine;
    const { centre, normal } = this.wall.kioskFrame();
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const d = Math.max(0.6849 / 2 / t, 1.2176 / 2 / (t * camera.aspect)) / KIOSK_FILL;
    return { eye: centre.clone().addScaledVector(normal, d), look: centre };
  }

  /** Up to the kiosk: lean in square on to it; tap it to use it. */
  async useKiosk() {
    const { app } = this;
    const { player, hud, travis, engine } = app;
    if (this.busy || this.mode !== 'play' || player.scripted) return;
    this.busy = true;
    this.mode = 'kiosk';
    app.block('kiosk');
    hud.info(null);
    hud.stopTitle(null);
    hud.showPlayUI(false);
    hud.skipButton(false);
    this.button = null;
    this.wall.hover(null);
    const view = this.#kioskView();
    player.eyeHeight = view.eye.y;
    await player.cinematic([view], { duration: MOVE_S + 0.4, push: 0 });
    if (this.mode !== 'kiosk') return;
    player.holdView();
    this.#listen(this.kioskScreen, {
      down: (hit) => this.#tapKiosk(hit.uv),
      over: (hit) => this.wall.over(hit.uv.x, hit.uv.y),
    });
    this.offResize = engine.on('resize', () => {
      if (this.mode !== 'kiosk' || player.scripted) return;
      const v = this.#kioskView();
      player.eyeHeight = v.eye.y;
      player.setPose(v.eye.x, v.eye.z, v.look);
      player.holdView();
    });
    hud.skipButton(true, TABLE.back);
    this.busy = false;
    this.#say('kioskIn', LINES.kioskIn);
  }

  #tapKiosk(uv) {
    if (this.mode !== 'kiosk' || this.busy) return;
    const r = this.wall.tap(uv.x, uv.y);
    if (!r) return;
    this.app.audio.chime?.();
    if (r.back || r.put) { this.wall.drop(); return; }
    if (r.pick !== undefined) {
      this.wall.lift(r.pick, 'chosen');
      this.app.visit.product = shoeName(SHOES.items[r.pick]);
      this.#tried('kiosk', LINES.chosen(SHOES.items[r.pick]));
      this.#glance(this.wall.showcase(r.pick));
    }
  }

  /** From the kiosk, look over at the wall where the chosen shoe comes out, hold, and lean back in. */
  async #glance(look) {
    const { player, hud } = this.app;
    this.busy = true;
    this.mode = 'show';
    hud.skipButton(false);
    await wait(250);    // the shoe starts out of its niche first
    const eye = V(PRODUCTS.x - 0.6, 1.8, PRODUCTS.z - 0.6);
    await player.cinematic([{ eye, look }], { duration: GLANCE.turn, push: 0 });
    if (this.mode !== 'show') return;
    await wait(GLANCE.hold * 1000);
    if (this.mode !== 'show') return;
    await player.cinematic([this.#kioskView()], { duration: GLANCE.turn, push: 0 });
    if (this.mode !== 'show') return;
    player.holdView();
    this.mode = 'kiosk';
    hud.skipButton(true, TABLE.back);
    this.busy = false;
  }

  async leaveKiosk() {
    if (this.mode !== 'kiosk' || this.busy) return;
    await this.#backToStop(this.#stop('products'));
  }

  /* ---------------------------------------------------------------- table */

  /** Straight above the table, framing the glass and the disc tray in VIEW.fill of the screen. */
  #topView() {
    const { aspect } = this.app.engine.camera;
    const tan = Math.tan(THREE.MathUtils.degToRad(TOP_FOV) / 2) * VIEW.fill;
    const h = Math.min(TOP_MAX_Y - TT.top, Math.max((VIEW.maxZ - VIEW.minZ) / 2 / tan, (VIEW.maxX - VIEW.minX) / 2 / (tan * aspect)));
    // A hair "up" the screen from straight below, so the view keeps its heading (screen up = away from the visitor).
    return { eye: V(TOP_X, TT.top + h, TOP_Z), look: V(TOP_X, TT.top, TOP_Z - 0.002) };
  }

  /**
   * Rise above the table and look straight down. The discs can then be dragged onto the glass
   * and turned, and the zoom disc turned. "Back to the room" (or Esc) returns to the table stop.
   */
  async useTable() {
    const { app } = this;
    const { player, hud, engine, audio } = app;
    if (this.busy || this.mode !== 'play' || player.scripted) return;
    this.busy = true;
    this.mode = 'table';
    app.block('table');
    hud.info(null);
    hud.stopTitle(null);
    hud.showPlayUI(false);
    hud.skipButton(false);
    this.button = null;
    audio.whoosh(1);
    // From anywhere else, first glide to the table stop, square on to the table.
    const stop = this.#stop('table');
    if (Math.hypot(player.pos.x - stop.x, player.pos.z - stop.z) > 0.01 || Math.abs(player.yaw) > 1e-4) {
      player.eyeHeight = EYE;
      await player.travel(stop, { look: stop.look });
      if (this.mode !== 'table') return;
    }
    this.pitchLimit = player.pitchLimit;
    player.pitchLimit = Math.PI / 2;
    const view = this.#topView();
    player.eyeHeight = view.eye.y;
    this.fov = player.baseFov;
    await player.cinematic([view], { duration: 1.6, push: 0, fov: TOP_FOV });
    if (this.mode !== 'table') return;
    engine.container.classList.add('using-screen');
    const glass = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TT.top);
    this.#listen(null, {
      plane: (ray) => { const p = ray.intersectPlane(glass, new THREE.Vector3()); return p && this.table.toLocal(p); },
      down: (p) => this.table.down(p),
      move: (p) => this.table.move(p),
      up: () => this.table.up(),
      wheel: (p, dy) => this.table.wheel(p, dy),
      over: (p) => { const k = this.table.pick(p); return !k ? '' : k.mode === 'turn' ? 'alias' : 'grab'; },
      grabbing: () => !!this.table.drag,
    });
    this.offResize = engine.on('resize', () => {
      if (this.mode !== 'table' || player.scripted) return;
      const v = this.#topView();
      player.eyeHeight = v.eye.y;
      player.setPose(v.eye.x, v.eye.z, v.look);
    });
    hud.skipButton(true, TABLE.back);
    hud.lookHint(TABLE.hint, 9000);
    this.busy = false;
    this.#say('tableIn', LINES.tableIn);
  }

  async leaveTable() {
    if (this.mode !== 'table' || this.busy) return;
    const { app } = this;
    const { player, hud, engine, audio } = app;
    this.busy = true;
    this.#stopUsing();
    app.block('table');
    engine.container.classList.remove('using-screen');
    audio.whoosh(1);
    player.eyeHeight = EYE;
    player.pitchLimit = this.pitchLimit;
    const dest = this.#stop('table');
    await player.travel(dest, { look: dest.look, fov: this.fov });
    app.unblock('table');
    this.mode = 'play';
    this.busy = false;
    hud.showPlayUI(true);
    // The table is the last stop: point the way on.
    if (this.#ready()) this.#say('onward', LINES.onward(this.next));
  }

  /** The 85" screen over the table: what the discs on the glass have opened (redrawn when that changes). */
  #drawScreen() {
    const open = this.table.discs.filter((d) => d.on && d.kind === 'content');
    const zoom = this.table.zoom;
    const key = `${open.map((d) => d.id).join(',')}|${zoom.toFixed(2)}`;
    if (key === this.screenKey) return;
    this.screenKey = key;
    const s = TABLE_SCREEN;
    this.screen.redraw((ctx, w) => {
      ctx.fillStyle = '#071019';
      ctx.fillRect(0, 0, w, 900);
      ctx.fillStyle = '#F2B544';
      ctx.font = `600 22px ${FONT.mono}`;
      spacedText(ctx, open.length ? s.open : s.kicker, 90, 110, 2);
      if (!open.length) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `700 96px ${FONT.body}`;
        s.idle.title.forEach((line, k) => ctx.fillText(line, 88, 270 + k * 108));
        ctx.fillStyle = '#9DB7C1';
        ctx.font = `400 34px ${FONT.body}`;
        ctx.fillText(s.idle.sub, 90, 470);
        return;
      }
      if (zoom !== 1) {
        ctx.fillStyle = '#F2B544';
        ctx.textAlign = 'right';
        spacedText(ctx, s.zoom(zoom), w - 90, 110, 2);
        ctx.textAlign = 'left';
      }
      // One column per open disc: its colour, name, title, words and points of interest.
      const cw = (w - 180 - (open.length - 1) * 40) / open.length;
      open.forEach((d, k) => {
        const x = 90 + k * (cw + 40);
        ctx.fillStyle = d.color;
        ctx.fillRect(x, 160, 90, 8);
        ctx.font = `600 22px ${FONT.mono}`;
        spacedText(ctx, d.name.toUpperCase(), x, 220, 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `700 ${open.length > 2 ? 46 : 60}px ${FONT.body}`;
        ctx.fillText(d.card.title, x, 300);
        ctx.fillStyle = '#C9D9DF';
        ctx.font = `400 28px ${FONT.body}`;
        let line = '', y = 360;
        for (const word of d.card.body.split(' ')) {
          if (ctx.measureText(`${line}${word} `).width > cw && line) { ctx.fillText(line.trim(), x, y); line = ''; y += 40; }
          line += `${word} `;
        }
        ctx.fillText(line.trim(), x, y);
        d.card.pins.forEach(([, , label], n) => {
          const py = y + 80 + n * 52;
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x + 12, py - 9, 10, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#E6ECEF';
          ctx.font = `500 28px ${FONT.body}`;
          ctx.fillText(label, x + 38, py);
        });
      });
    });
  }

  /* --------------------------------------------------------- using either */

  /**
   * Pointer handling while using the kiosk or the table (the scene's own looking and clicking are
   * blocked meanwhile). With a mesh, events give its hit (uv); with `plane`, the point on it.
   */
  #listen(mesh, h) {
    const { engine } = this.app;
    const dom = engine.renderer.domElement;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const at = (e) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, engine.camera);
      if (h.plane) return h.plane(ray.ray);
      return mesh ? ray.intersectObject(mesh, false)[0] ?? null : null;
    };
    const on = {
      pointerdown: (e) => { const p = at(e); if (p && h.down?.(p) !== false && h.grabbing?.()) dom.style.cursor = 'grabbing'; },
      pointermove: (e) => {
        const p = at(e);
        if (!p) { dom.style.cursor = ''; return; }
        if (h.grabbing?.()) { h.move?.(p); return; }
        const over = h.over?.(p);
        dom.style.cursor = over === true ? 'pointer' : over || '';
      },
      pointerup: () => { h.up?.(); dom.style.cursor = ''; },
      pointercancel: () => { h.up?.(); dom.style.cursor = ''; },
      wheel: (e) => { if (!h.wheel) return; e.preventDefault(); h.wheel(at(e), e.deltaY); },
    };
    for (const [type, fn] of Object.entries(on)) dom.addEventListener(type, fn, type === 'wheel' ? { passive: false } : undefined);
    const onKey = (e) => { if (e.code === 'Escape') { if (this.mode === 'kiosk') this.leaveKiosk(); else if (this.mode === 'table') this.leaveTable(); } };
    addEventListener('keydown', onKey);
    this.unlisten = () => {
      for (const [type, fn] of Object.entries(on)) dom.removeEventListener(type, fn);
      removeEventListener('keydown', onKey);
      h.up?.();
      dom.style.cursor = '';
    };
  }

  #stopUsing() {
    const { app } = this;
    this.unlisten?.();
    this.unlisten = null;
    this.offResize?.();
    this.offResize = null;
    app.hud.skipButton(false);
    app.player.eyeHeight = EYE;
    if (this.pitchLimit !== undefined) app.player.pitchLimit = this.pitchLimit;
    app.unblock('kiosk');
    app.unblock('table');
  }

  async #backToStop(stop) {
    const { app } = this;
    const { player, hud } = app;
    this.busy = true;
    const using = this.mode;
    this.#stopUsing();
    app.block(using);      // still blocked while gliding back
    player.eyeHeight = EYE;
    await player.travel(stop, { look: stop.look });
    app.unblock(using);
    this.mode = 'play';
    this.busy = false;
    hud.showPlayUI(true);
  }

  /* ---------------------------------------------------------------- moving */

  teleportById(id) {
    const p = this.#stop(id);
    if (p) this.teleportTo(p);
  }

  /** Previous (-1) or next (1) stop; past the last one on to Zone 06, before the first back to Zone 04. */
  step(dir) {
    const j = this.#nearestStop() + dir;
    if (j >= this.points.length) this.goNext();
    else if (j < 0) this.goPrev();
    else this.teleportTo(this.points[j]);
  }

  #nearestStop() {
    const { pos } = this.app.player;
    let best = 0;
    this.points.forEach((p, i) => {
      if (Math.hypot(pos.x - p.x, pos.z - p.z) < Math.hypot(pos.x - this.points[best].x, pos.z - this.points[best].z)) best = i;
    });
    return best;
  }

  async teleportTo(dest) {
    const { app } = this;
    const { player, hud, audio } = app;
    if (this.busy || player.scripted || this.mode !== 'play') return;
    const dist = Math.hypot(player.pos.x - dest.x, player.pos.z - dest.z);
    this.busy = true;
    this.going = dest.id;
    app.block('teleport');
    hud.stopTitle(null);
    if (dist > 0.3) audio.whoosh(clamp(dist / 5, 0.8, 2.4));
    player.eyeHeight = EYE;
    await player.travel(dest, { look: dest.look });
    this.going = null;
    app.unblock('teleport');
    this.busy = false;
    hud.info(CARDS[dest.id] ?? null);
    if (dest.id === 'products') this.path.revealTo(5);
    if (LINES.at[dest.id]) this.#say(`at-${dest.id}`, LINES.at[dest.id]);
  }

  /* --------------------------------------------------------------- update */

  update(dt, t) {
    const { player, hud } = this.app;
    if (this.mode === 'play') {
      const here = this.going ? null : this.points.find((p) => p.here)?.id ?? null;
      const todo = OBJECTIVES.find((o) => o.id !== 'next' && !this.done.has(o.id))?.id;
      hud.markStops({ here, going: this.going, next: !todo ? null : todo === 'table' ? 'table' : 'products' });
    }
    for (const p of this.points) {
      p.group.visible = this.mode === 'play';
      p.update(dt, t, player.pos);
    }
    this.wall.update(dt, t);
    this.table.update(dt);
    this.#drawScreen();
    this.path.update(dt, t);
    hud.updateMinimap(player.pos.x, player.pos.z, player.yaw);
  }
}
