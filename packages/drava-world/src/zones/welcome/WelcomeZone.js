import * as THREE from 'three';
import { GLOW, ZONES } from '../../config.js';
import { TeleportPoint } from '../../core/TeleportPoint.js';
import { LightPath } from '../../core/LightPath.js';
import { WebScreen } from '../../core/WebScreen.js';
import { clamp, wait } from '../../util/tween.js';
import { ART, buildRoom, KIOSK, ROOM, SCREEN } from './room.js';
import { Holobox } from './Holobox.js';
import { BrandWall } from './BrandWall.js';
import { BRAND_REEL, CARDS, CEO, DATA_ART_STUDIO, LINES, OBJECTIVES } from './script.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Layout: the client's model (room.js). Metres, +z toward the entrance.
const EYE = 1.65;

// The room is shown much as the client's reference viewer shows it: a 55° lens (the reference's
// 39.5° framed too tight; the other zones' 70° stretches a room this size), no bloom, and drawn at
// the screen's own resolution, as the reference is (its pixel ratio: the device's, up to 1.75).
// Below that, the picture is stretched up to the screen: on a 125 % display the engine's pixel
// budget and frame-rate fallback drew it at ratio 1, which stepped every edge and the logo's small type.
const LENS = 55;
const sharp = () => Math.min(window.devicePixelRatio || 1, 1.75);

// Where the visitor starts (and the title screen shows): the reference's interior view, by the
// entrance, level, looking straight down the room at the screen on the back wall.
const START = { x: -0.325, z: 6.8, look: V(-0.325, 1.675, SCREEN.z) };

// The brand wall and the Mosaic wall are both 16:9, the size of the model's screen.
const WALL_W = SCREEN.width;
const WALL_H = SCREEN.height;

// The kiosk in the back-left corner is the Holobox; its stop is in front of it, square on.
const HOLO = (() => {
  const nx = Math.sin(KIOSK.rotY), nz = Math.cos(KIOSK.rotY);
  return { x: KIOSK.x, z: KIOSK.z, stop: { x: KIOSK.x + nx * 4.4, z: KIOSK.z + nz * 4.4 } };
})();

// Stops: the entrance, the Holobox, the brand wall, the Mosaic wall. Each
// is far enough back for its exhibit to fit the lens.
// The stops' rings (and their pulse, out to ~0.95 m) mustn't overlap: every stop is at least 2.3 m from the next.
// The data art screen is centred on the right wall, so its stop, the brand wall's and the Holobox's
// share the middle of the room. Each stays square on to its exhibit; the brand wall's and the
// Holobox's are drawn in a little so the data art ring, straight in front of its screen, keeps clear.
const BRAND_STOP = { x: SCREEN.x, z: SCREEN.z + 5.5 };
const ART_STOP = { x: ART.x - 5.07, z: ART.z };
// There is no door out of this room: once the visitor has been to the Mosaic wall, the bottom-right
// button (or → from the last stop) takes them on to Zone 02.

// The tour when the visitor steps inside: five shots, in the order of the visit. Each shot flies
// its keys ({ eye, look }) while TRAVIS says its line (LINES.tour[i]); the next shot starts only
// when both the move and the line are done, so the voice always matches the picture. It ends
// back at the entrance, facing the room.
const TOUR = [
  { seconds: 4.2, keys: [                                    // a slow push into the room, toward the screen
    { eye: V(START.x, 1.75, START.z - 1.4), look: V(SCREEN.x, 1.75, SCREEN.z) },
    { eye: V(0.1, 1.8, 3.4), look: V(SCREEN.x, 1.75, SCREEN.z) },
  ] },
  { seconds: 3.2, keys: [                                    // the Holobox, in the back-left corner
    { eye: V(HOLO.stop.x + 0.3, 1.8, HOLO.stop.z + 0.4), look: V(HOLO.x, 1.8, HOLO.z) },
  ] },
  { seconds: 3.2, keys: [                                    // the brand wall
    { eye: V(BRAND_STOP.x, 1.85, BRAND_STOP.z + 0.3), look: V(SCREEN.x, 1.85, SCREEN.z) },
  ] },
  { seconds: 3.2, keys: [                                    // turn to the Mosaic wall on the right
    { eye: V(ART_STOP.x, 1.85, ART_STOP.z), look: V(ART.x, ART.y, ART.z) },
  ] },
  { seconds: 3.6, keys: [                         // back to the entrance, facing the room
    { eye: V(START.x, EYE, START.z), look: START.look },
  ] },
];

/**
 * Zone 01 — The Welcome Zone.
 *
 * The room is the client's model (public/zone1.glb, see room.js).
 *
 * Story:
 *   1. Arrive      standing at the entrance, looking down the room
 *   2. Enter       Step inside (or Enter): the room lights up and TRAVIS narrates a flythrough
 *                  (Holobox → brand wall → data art), back to the entrance
 *   3. Holobox     first touch point: our CEO appears as a hologram in the kiosk
 *   4. Brand wall  White Tusker's brand film on the screen on the back wall
 *   5. Data art    the live Mosaic on the right wall
 *   6. Next zone   after the data art, a button takes the visitor on to Zone 02 (no door)
 *
 * There is no walking. After the tour, the visitor travels between four stops (the
 * floor rings, the stops bar, the minimap or ← →) and the camera glides there.
 */
export class WelcomeZone {
  static id = 'welcome';

  constructor(app) {
    this.app = app;
    this.visit = 0;          // counts moves between stops: a stop's lines still to come check it
    this.id = WelcomeZone.id;
    this.zone = ZONES.find((z) => z.id === 'welcome');
    this.next = ZONES.find((z) => z.id === 'cms');
    this.state = { entered: false, summoned: false, brandwall: false, dataart: false, portal: false };
    this.warm = 0;
    this.warmTarget = 0;
    this.said = new Set();
    this.mode = 'attract';
    this.busy = false;
    this.going = null;       // stop id while travelling
    this.tourSkipped = false;
  }

  /* ------------------------------------------------------------------ build */

  build() {
    const { engine, interactions } = this.app;
    // Everything in this zone goes in its own group, so the zone can be hidden when the visitor leaves.
    this.root = new THREE.Group();
    this.root.name = 'zone-welcome';
    engine.scene.add(this.root);
    const scene = this.root;

    this.room = buildRoom(scene, { engine });
    engine.on('quality', (q) => this.room.setReflections(q === 'high'));
    // The model loads after the zone is built: compile and upload it as soon as it's in.
    this.room.ready.then(() => {
      interactions.addOccluders(this.room.occluders);
      engine.warm(this.root);
    }).catch((err) => console.error('Welcome Zone: the room model could not load.', err));

    // The CEO appears inside the model's kiosk.
    this.holo = new Holobox({ cabinet: false, floor: KIOSK.floor });
    this.holo.group.position.set(KIOSK.x, 0, KIOSK.z);
    this.holo.group.rotation.y = KIOSK.rotY;
    scene.add(this.holo.group);
    // What a click on the Holobox hits: an unseen box round the model's kiosk. (The model loads
    // after the zone is built, too late to register its own meshes as the hit target.)
    this.holoHit = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.45, 0.95), new THREE.MeshBasicMaterial({ visible: false }));
    this.holoHit.position.set(0, 1.22, 0);
    this.holo.group.add(this.holoHit);

    // The brand wall sits on the model's screen on the back wall.
    // No bezel (the model's screen has its trim) and as bright as that screen (no bloom here).
    this.brand = new BrandWall({ engine, width: WALL_W, height: WALL_H, reel: BRAND_REEL, idleLevel: 0.9, bezel: false, ticker: false });
    this.brand.group.position.set(SCREEN.x, SCREEN.y, SCREEN.z + 0.01);
    this.brand.onIdleLoaded = (tex) => engine.renderer.initTexture(tex); // upload now, not on first sight
    scene.add(this.brand.group);

    // The Mosaic wall on the right wall, set up exactly like the brand wall: on its own red block, no
    // bezel, resting on the same picture (the logo; no film), and the Mosaic attached to it
    // just in front, as the brand film is, so it fades in over the logo once the visitor stops there.
    // (With a bezel, the page, drawn over the scene, showed it as a black band along one edge.)
    this.art = new BrandWall({ engine, width: WALL_W, height: WALL_H, reel: { ...BRAND_REEL, film: null }, idleLevel: 0.9, bezel: false, ticker: false });
    this.art.group.position.set(ART.x, ART.y, ART.z);
    this.art.group.rotation.y = -Math.PI / 2;
    scene.add(this.art.group);

    const [vw, vh] = DATA_ART_STUDIO.viewport;
    this.studio = new WebScreen(engine, {
      url: DATA_ART_STUDIO.url, viewport: DATA_ART_STUDIO.viewport, title: DATA_ART_STUDIO.label,
      width: (WALL_H * vw) / vh, height: WALL_H,
    });
    this.studio.group.position.z = 0.01;
    this.art.group.add(this.studio.group);

    // Guide light: entrance → Holobox → brand wall → data art (pathStops are waypoint indices).
    this.path = new LightPath([
      [START.x, START.z - 0.8], [-1.6, 3.0], [HOLO.stop.x, HOLO.stop.z],
      [-0.9, -0.8], [BRAND_STOP.x, BRAND_STOP.z],
      [-0.1, 1.5], [ART_STOP.x, ART_STOP.z],
    ]);
    this.pathStops = { holobox: 2, brandwall: 4, dataart: 6 };
    scene.add(this.path.mesh);

    this.points = [
      new TeleportPoint({ id: 'entrance', label: 'Entrance', short: 'Entrance', x: START.x, z: START.z, look: START.look }),
      new TeleportPoint({ id: 'holobox', label: 'Holobox', short: 'Holobox', x: HOLO.stop.x, z: HOLO.stop.z, look: V(HOLO.x, EYE, HOLO.z) }),   // level, so upright edges stay upright
      new TeleportPoint({ id: 'brandwall', label: 'Brand wall', short: 'Brand wall', x: BRAND_STOP.x, z: BRAND_STOP.z, look: V(SCREEN.x, EYE, SCREEN.z) }),   // level: pitched up, the screen looked tilted back
      new TeleportPoint({ id: 'dataart', label: 'Mosaic wall', short: 'Mosaic', x: ART_STOP.x, z: ART_STOP.z, look: V(ART.x, ART.y, ART.z) }),
    ];
    for (const p of this.points) scene.add(p.group);

    // Interactions
    // Before the visitor has stepped inside, any exhibit starts the tour.
    const inside = (use) => () => (this.state.entered ? use() : this.enter());
    this.brandItem = interactions.add({
      id: 'brandwall', label: 'Brand wall', verb: BRAND_REEL.play, objects: this.brand.hitTargets, range: 12,
      onUse: inside(() => this.toggleFilm()),
    });
    interactions.add({
      id: 'dataart', label: DATA_ART_STUDIO.label, verb: DATA_ART_STUDIO.use, objects: this.art.hitTargets, range: 12,
      onUse: inside(() => this.useStudio()),
    });
    this.holoItem = interactions.add({
      id: 'holobox', label: 'Holobox', verb: 'Meet our CEO', objects: [this.holoHit], range: 12,
      onUse: inside(() => this.useHolobox()),
    });
    for (const p of this.points) {
      interactions.add({
        id: `tp-${p.id}`, label: p.label, verb: 'Go to', objects: [p.hit], range: 40,
        enabled: () => this.state.entered, // the stops appear after the tour
        onHover: (on) => p.setHover(on),
        onUse: () => this.teleportTo(p),
      });
    }

    // The bottom-right button (or Space): at the brand wall stop it plays and stops the film. The
    // arrows are the way on (→ from the last stop goes to Zone 02).
    this.app.hud.on('skip', () => {
      if (this.app.zone !== this || this.mode !== 'play') return;
      if (this.button === 'film') this.toggleFilm();
    });
    this.app.hud.on('sound', (on) => this.brand.setSound(on));
    this.brand.onFilmEnd = () => {
      this.brandItem.verb = BRAND_REEL.play;
      this.button = null; // refresh the button
      if (!this.leaving && !this.state.dataart) this.app.travis.say(LINES.brandFilmEnd);
    };
  }

  /**
   * The reference viewer's look while the visitor is in this zone (on), and the other zones' back
   * as they leave (off): lens, no bloom, full sharpness.
   */
  #view(on) {
    const { player, engine } = this.app;
    if (on && !this.viewOn) this.otherLens = player.baseFov;
    if (!on && !this.viewOn) return;
    this.viewOn = on;
    player.baseFov = on ? LENS : this.otherLens;
    engine.bloom.enabled = !on && GLOW > 0;
    engine.setMinRatio(on ? sharp() : null);
  }

  /** This zone's stops, minimap and objectives in the HUD (again on coming back from another zone). */
  #showHud() {
    const { hud } = this.app;
    hud.setZone(this.zone);
    hud.setStops(this.points.map((p) => ({ id: p.id, label: p.short })));
    hud.setMinimap(this.#minimap());
    hud.setObjectives(OBJECTIVES);
    const s = this.state;
    const done = { enter: s.entered, holobox: s.summoned, brandwall: s.brandwall, dataart: s.dataart, next: s.portal };
    for (const o of OBJECTIVES) if (done[o.id]) hud.completeObjective(o.id);
  }

  #minimap() {
    const { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = ROOM;
    return {
      viewBox: [x0 - 0.8, z0 - 0.8, x1 - x0 + 1.6, z1 - z0 + 1.6],
      walls: [[x0, z0, x0, z1], [x1, z0, x1, z1], [x0, z1, x1, z1], [x0, z0, x1, z0]],
      features: [
        { type: 'line', cls: 'screen', x1: SCREEN.x - WALL_W / 2, z1: SCREEN.z, x2: SCREEN.x + WALL_W / 2, z2: SCREEN.z },
        { type: 'line', cls: 'screen', x1: ART.x - 0.15, z1: ART.z - WALL_W / 2, x2: ART.x - 0.15, z2: ART.z + WALL_W / 2 },
        { type: 'rect', cls: 'holo', x: HOLO.x, z: HOLO.z, w: 1.2, d: 0.9 },
      ],
      points: this.points.map((p) => ({ id: p.id, x: p.x, z: p.z, label: p.label })),
    };
  }

  /* ---------------------------------------------------------------- flow */

  /** The title screen shows the same still view the visit starts from. */
  attract() {
    this.mode = 'attract';
    this.#view(true);
    this.app.player.setPose(START.x, START.z, START.look);
  }

  /**
   * Straight into the zone: the visitor is already standing at the entrance.
   * from: the zone the visitor is coming back from; they arrive at the entrance, facing the room.
   */
  arrive({ from = null } = {}) {
    const app = this.app;
    const { hud, travis, player, audio } = app;
    this.#showHud();
    this.#view(true);
    this.mode = 'play';

    if (from) {
      this.busy = false;
      this.going = null;
      this.at = 'entrance';
      this.studio.load();   // no tour on the way back in (a no-op if it has loaded already)
      this.button = null;
      hud.showPlayUI(true);
      hud.enterButton(false);
      player.setPose(START.x, START.z, START.look);
      if (this.holo.summoned) audio.hum(true);
      travis.say(LINES.welcomeBack(ZONES.find((z) => z.id === from)), { interrupt: true });
      return;
    }

    // The stops appear once the visitor has stepped inside.
    hud.showPlayUI(true);
    hud.showStops(false);
    hud.enterButton(true);

    travis.say([LINES.arrival(), LINES.arrivalHint]);
    if (app.bridge.status === 'online') travis.say(LINES.bridgeOnline);

    // Nudge if nothing happens for a while.
    setTimeout(() => {
      if (!this.state.entered && !travis.busy) travis.say(LINES.idleHint);
    }, 24000);
  }

  /**
   * Step inside: the room lights up and the camera flies a tour of the whole zone, then
   * comes back to the entrance, facing the room.
   */
  async enter() {
    if (this.state.entered || this.mode !== 'play' || this.busy) return;
    const app = this.app;
    const { player, hud, travis, audio, bridge } = app;
    this.state.entered = true;
    this.busy = true;
    this.mode = 'tour';
    app.block('tour');
    hud.enterButton(false);
    hud.info(null);
    hud.completeObjective('enter');

    audio.chime();
    this.warmTarget = 1;
    this.brand.preload();
    bridge.send({ task: 'welcome_zone', cmd: 'visitor_entered', source: 'virtual' });

    hud.skipButton(true, 'Skip the tour');
    this.tourSkipped = false;
    const offSkip = hud.on('skip', () => {
      this.tourSkipped = true;
      travis.stop();
      player.cancelTween(false);
    });
    for (const [i, shot] of TOUR.entries()) {
      if (this.tourSkipped) break;
      await Promise.all([
        player.cinematic(shot.keys, { duration: shot.seconds, push: 2 }),
        travis.say(LINES.tour[i], { interrupt: true, pause: 0 }),
      ]);
    }
    offSkip();
    hud.skipButton(false);
    if (this.tourSkipped) player.setPose(START.x, START.z, START.look);
    // The live studio is a whole website: load it only now, not during the tour, so it can't stutter
    // the flythrough. It is ready long before the visitor reaches the data art stop.
    this.studio.load();
    this.at = 'entrance';

    this.mode = 'play';
    this.busy = false;
    app.unblock('tour');
    hud.showStops(true);
    hud.stopTitle(`Zone ${this.zone.n} · ${this.zone.verb}`, this.zone.name);
    hud.lookHint(app.settings.touch ? LINES.lookHintTouch : LINES.lookHint);
    this.path.revealTo(this.pathStops.holobox);
  }

  /** quiet: the visitor went straight to the film, so skip the card and the introduction. */
  onBrandWall(quiet = false) {
    if (this.state.brandwall) return;
    const { hud, travis } = this.app;
    this.state.brandwall = true;
    hud.completeObjective('brandwall');
    this.path.revealTo(this.pathStops.dataart);
    if (quiet) return;
    hud.info(CARDS.brandwall);
    travis.say(LINES.brandWall, { interrupt: true });
  }

  /** quiet: the visitor went straight to using the studio, so skip the card and the introduction. */
  /** Play the brand film on the brand wall, or stop it. */
  async toggleFilm() {
    const { hud, travis } = this.app;
    if (this.brand.playing) { this.brand.stopFilm(); return; }
    this.onBrandWall(true);
    hud.info(null);
    travis.stop();
    if (await this.brand.playFilm({ sound: hud.soundOn })) {
      this.brandItem.verb = BRAND_REEL.stop;
      this.button = null; // refresh the button
    }
  }

  onDataArt(quiet = false) {
    if (this.state.dataart) return;
    const { hud, travis } = this.app;
    this.state.dataart = true;
    hud.completeObjective('dataart');
    if (quiet) return;
    hud.info(CARDS.dataart);
    travis.say(LINES.dataArt, { interrupt: true });
  }

  /** Where the eye goes to use the studio: square on, the page filling the view. */
  #studioEye() {
    return V(ART.x - 0.02 - this.studio.fitDistance(this.app.engine.camera), ART.y, ART.z);
  }

  /**
   * Step up to the Mosaic: the camera glides square on to the wall until the
   * page fills the view, and the page takes the mouse and keyboard, just like a browser
   * tab. "Back to the room" (or Esc) returns to the data art stop.
   */
  async useStudio() {
    const app = this.app;
    const { player, hud, travis, engine, audio } = app;
    if (!this.state.entered || this.busy || this.mode !== 'play' || player.scripted) return;
    this.busy = true;
    this.mode = 'studio';
    app.block('studio');
    this.onDataArt(true);
    hud.info(null);
    hud.stopTitle(null);
    hud.showPlayUI(false); // objectives, captions, minimap and stops would sit on top of the page
    audio.whoosh(1);

    player.eyeHeight = ART.y; // hold the eye level with the middle of the page
    await player.cinematic([{ eye: this.#studioEye(), look: V(ART.x, ART.y, ART.z) }], { duration: 1.5, push: 0 });
    if (this.mode !== 'studio') return;

    engine.container.classList.add('using-screen');
    this.studio.setInteractive(true);
    hud.skipButton(true, DATA_ART_STUDIO.back);
    const center = V(ART.x, ART.y, ART.z);
    const offs = [
      hud.on('skip', () => this.leaveStudio()),
      engine.on('resize', () => { const e = this.#studioEye(); player.setPose(e.x, e.z, center); }),
    ];
    const onKey = (e) => { if (e.code === 'Escape') this.leaveStudio(); };
    addEventListener('keydown', onKey);
    this.studioOff = () => { offs.forEach((off) => off()); removeEventListener('keydown', onKey); };
    travis.say(LINES.studioIn, { interrupt: true });
  }

  async leaveStudio() {
    if (this.mode !== 'studio' || !this.studio.interactive) return;
    const app = this.app;
    const { player, hud, travis, engine, audio } = app;
    this.studioOff();
    hud.skipButton(false);
    this.button = null;   // the update shows "Continue to Zone 02" again once back at the stop
    this.studio.setInteractive(false);
    engine.container.classList.remove('using-screen');
    audio.whoosh(1);

    player.eyeHeight = EYE;
    const dest = this.points.find((p) => p.id === 'dataart');
    await player.travel(dest, { look: dest.look });
    this.mode = 'play';
    this.busy = false;
    app.unblock('studio');
    hud.showPlayUI(true);
    this.#arrived(dest);
    if (!this.state.portal) travis.say(LINES.studioOut, { interrupt: true });
  }

  /** A click on the Holobox: from across the room, glide to its stop first; then the CEO appears (or, after, its card). */
  async useHolobox() {
    if (this.holo.summoned) { this.app.hud.info(CARDS.holobox); return; }
    const stop = this.points.find((p) => p.id === 'holobox');
    const away = () => Math.hypot(this.app.player.pos.x - stop.x, this.app.player.pos.z - stop.z) > 0.5;
    if (away()) {
      await this.teleportTo(stop);
      if (away()) return;   // the glide didn't happen (mid-tour or another move)
    }
    this.summon();
  }

  /** Our CEO appears in the Holobox and welcomes the visitor; then TRAVIS points on to Zone 02. */
  async summon() {
    if (this.holo.summoned) return;
    const { hud, travis, audio } = this.app;
    const visit = this.visit;
    this.state.summoned = true;
    this.holoItem.verb = 'About';
    hud.completeObjective('holobox');
    this.path.revealTo(this.pathStops.brandwall);   // now, so the way on shows even if they leave mid-welcome
    hud.info(CARDS.holobox);
    await travis.say(LINES.ceoIntro, { interrupt: true });
    if (visit !== this.visit) return;   // the visitor moved on mid-line
    this.holo.summon();
    audio.hum(true);
    await wait(1800); // let the figure build up from the base before it speaks
    if (visit !== this.visit) return;
    await travis.say(CEO.message, { speaker: { name: CEO.caption, voice: 'alt' } });
    if (visit !== this.visit) return;
    travis.say(LINES.afterCeo);
  }

  /** On to Zone 02: → from the last stop (no door; the portal transition takes them). */
  async goNext() {
    if (this.busy) return;
    const app = this.app;
    const { hud, audio } = app;
    this.#leaveStop();
    this.busy = true;
    app.block('portal');
    hud.info(null);
    hud.skipButton(false);
    hud.completeObjective('next');
    this.state.portal = true;
    hud.stopTitle(null);
    audio.whoosh(1.8);
    await app.goTo(this.next.id);
    app.unblock('portal');
    this.busy = false;
  }

  /** Leaving for another zone: stop what is playing and take the live page off the wall. */
  leave() {
    const { hud, audio } = this.app;
    this.#view(false);
    this.brand.hide();
    this.studio.hide();
    this.art.hide();
    audio.hum(false);
    hud.skipButton(false);
    this.button = null;
  }

  teleportById(id) {
    const p = this.points.find((x) => x.id === id);
    if (p) this.teleportTo(p);
  }

  /** Previous (-1) or next (1) stop along the loop. Before entering, any step goes in; past the last stop, on to Zone 02. */
  step(dir) {
    if (!this.state.entered) { if (dir > 0) this.enter(); return; }
    const i = this.#nearestStop();
    if (dir > 0 && i === this.points.length - 1) { this.goNext(); return; }
    const j = clamp(i + dir, 0, this.points.length - 1);
    if (j !== i) this.teleportTo(this.points[j]);
  }

  /** The stop the visitor is at (where two are here, the one they last arrived at). */
  #here() {
    const here = this.points.filter((p) => p.here);
    return (here.find((p) => p.id === this.at) ?? here[0])?.id ?? null;
  }

  #nearestStop() {
    const { pos } = this.app.player;
    const at = this.points.findIndex((p) => p.id === this.at);
    if (at >= 0 && Math.hypot(pos.x - this.points[at].x, pos.z - this.points[at].z) < 0.3) return at;
    let best = 0;
    this.points.forEach((p, i) => {
      if (Math.hypot(pos.x - p.x, pos.z - p.z) < Math.hypot(pos.x - this.points[best].x, pos.z - this.points[best].z)) best = i;
    });
    return best;
  }

  /** The stop the visitor should try next, for the stops bar. */
  #suggested() {
    const s = this.state;
    return !s.summoned ? 'holobox' : !s.brandwall ? 'brandwall' : !s.dataart ? 'dataart' : null;
  }

  /** Glide to a stop. Before the visitor has stepped inside, any stop starts the tour. */
  async teleportTo(dest) {
    const app = this.app;
    const { player, hud, audio } = app;
    if (!this.state.entered) { this.enter(); return; }
    if (this.busy || player.scripted || this.mode !== 'play') return;

    if (Math.hypot(player.pos.x - dest.x, player.pos.z - dest.z) < 0.3) {
      // Already here: just turn back to face the exhibit.
      this.busy = true;
      await player.travel(dest, { look: dest.look });
      this.busy = false;
      return;
    }

    this.#leaveStop();
    const dist = Math.hypot(player.pos.x - dest.x, player.pos.z - dest.z);
    this.busy = true;
    this.going = dest.id;
    app.block('teleport');
    hud.stopTitle(null);
    audio.whoosh(clamp(dist / 5, 0.8, 2.4));
    await player.travel(dest, { look: dest.look });
    this.going = null;
    app.unblock('teleport');
    this.busy = false;
    this.#arrived(dest);
  }

  /**
   * The visitor is moving on: everything from the stop they're leaving stops at once. TRAVIS's or
   * the CEO's voice (and the CEO's lines still to come), the brand film (without its "next" line),
   * the CEO's hologram and its hum, and the info card. (The live studio hides itself off its stop.)
   */
  #leaveStop() {
    const { travis, audio, hud } = this.app;
    this.visit++;
    travis.stop();
    this.leaving = true;
    this.brand.stopFilm();
    this.leaving = false;
    this.holo.dismiss();
    audio.hum(false);
    hud.info(null);
  }

  #arrived(p) {
    const { hud } = this.app;
    this.at = p.id;
    if (hud.infoId && hud.infoId !== p.id) hud.info(null);   // another exhibit's card
    const n = this.points.indexOf(p) + 1;
    hud.stopTitle(`Zone ${this.zone.n} · Stop ${String(n).padStart(2, '0')}`, p.label);
    if (p.id === 'dataart') this.onDataArt();
    if (p.id === 'brandwall') this.onBrandWall();
  }

  /* --------------------------------------------------------------- update */

  update(dt, t) {
    const { player, travis, engine, hud } = this.app;

    if (this.mode === 'play' && this.state.entered) {
      const here = this.going ? null : this.#here();
      hud.markStops({ here, going: this.going, next: this.#suggested() });
    }

    // The screens wake up after the welcome; the kiosk dims while the hologram shows.
    this.warm += (this.warmTarget - this.warm) * Math.min(1, dt * 0.7);
    const w = this.warm;
    this.room.setKioskDim(0.88 * this.holo.materialise);

    this.holo.update(dt, t, travis.speaker ? travis.level : 0, engine.pointScale); // the figure moves only when the CEO speaks
    this.path.update(dt, t);
    for (const p of this.points) {
      p.group.visible = this.state.entered;
      p.update(dt, t, player.pos);
    }
    // The live studio shows only at the data art stop (or while the visitor uses it), with the camera
    // at rest: it is a whole website drawing its own animation, and starting it mid-glide would stall
    // the glide. Elsewhere the wall rests on the logo. Nothing in the room stands in front of either
    // wall, so these pages (drawn over the scene) never cover anything nearer.
    const resting = !player.scripted || this.mode === 'studio';
    const atArt = !this.going && this.#here() === 'dataart';
    this.studio.update(dt, engine.camera, { allowed: this.state.entered && resting && (atArt || this.mode === 'studio') });
    this.art.update(dt, t, { warm: 0.3 + 0.7 * w, camera: engine.camera, allowed: false });
    this.brand.update(dt, t, { warm: 0.3 + 0.7 * w, camera: engine.camera, allowed: resting });

    if (this.mode === 'tour') hud.updateMinimap(player.pos.x, player.pos.z, player.yaw);
    if (this.mode !== 'play') return;

    // The bottom-right button: at the brand wall stop it plays or stops the film (walking away stops
    // it); once the visitor has been to the Mosaic wall, elsewhere it goes on to Zone 02.
    const atBrand = !this.going && this.#here() === 'brandwall';
    const button = this.going || this.busy ? null : atBrand ? 'film' : null;
    if (button !== this.button) {
      this.button = button;
      if (button === 'film') hud.skipButton(true, this.brand.playing ? BRAND_REEL.stop : BRAND_REEL.play);
      else hud.skipButton(false);
    }
    if (this.brand.playing && Math.hypot(player.pos.x - BRAND_STOP.x, player.pos.z - BRAND_STOP.z) > 6) this.brand.stopFilm();

    // Near the Holobox before summoning
    const dHolo = Math.hypot(player.pos.x - HOLO.x, player.pos.z - HOLO.z);
    if (dHolo < 3.2 && !this.state.summoned && !this.said.has('holoHint') && !player.scripted) {
      this.said.add('holoHint');
      travis.say(LINES.holoHint);
    }

    // Close an info card once you walk away from its exhibit
    if (hud.infoId) {
      const anchor = {
        holobox: [HOLO.x, HOLO.z], brandwall: [SCREEN.x, SCREEN.z], dataart: [ART.x, ART.z],
      }[hud.infoId];
      const wall = hud.infoId === 'dataart' || hud.infoId === 'brandwall';
      if (anchor && Math.hypot(player.pos.x - anchor[0], player.pos.z - anchor[1]) > (wall ? 6.5 : 5)) hud.info(null);
    }

    hud.updateMinimap(player.pos.x, player.pos.z, player.yaw);
  }
}
