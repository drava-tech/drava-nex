import * as THREE from 'three';
import { EmptyZone } from '../shared/EmptyZone.js';
import { ROOM, SCREENS as AT, SCREEN_H, SCREEN_W, SCREEN_Y, SCREEN_Z, buildRoom } from './room.js';
import { TeleportPoint } from '../../core/TeleportPoint.js';
import { ShowcaseScreen } from './ShowcaseScreen.js';
import * as script from './script.js';

const { CARDS, LINES, OBJECTIVES, SHOWCASES } = script;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const EYE = 1.65;

// The room is the client's dual-screen room (room.js): Core on the front wall's left screen,
// the Care on its right one, both 16 × 9 ft and facing the room, each with a stop square on in front
// of it, far enough back (STOP_D) that the whole screen sits well inside the view with room round it.
// The stops look level (at eye height, not the screen's centre), so the screens' edges stay upright.
const SCREEN = { w: SCREEN_W, h: SCREEN_H, y: SCREEN_Y, z: SCREEN_Z + 0.006 };
const STOP_D = 5.6;
const AT_X = { trava: AT.left.x, hms: AT.right.x };
const LENS = 60;                       // the client models' lens (as Zones 01, 02 and 05)

/**
 * Zone 03 — The SaaS Zone: two of White Tusker's products, each on one of the two front-wall
 * screens of the client's dual-screen room (room.js).
 * Arriving at a screen's stop plays its film; when it ends (or is skipped) the product runs
 * live on the screen. Click it (or the button) to step up and use it like a browser tab;
 * "Back to the room" (or Esc) returns to the stop. Walking away mid-film stops it.
 * There are no doors (EmptyZone's doors: false): once a product has been tried, the bottom-right
 * button is "Continue to Zone 04" wherever it isn't playing, skipping or opening a screen.
 * The room and stops come from EmptyZone; the words are in script.js.
 */
export class SaasZone extends EmptyZone {
  constructor(app) {
    super(app, 'saas', script, { doors: false, bare: true, room: ROOM, lens: LENS });
    this.ownButton = true;              // the bottom-right button plays, skips and uses the screens (#label)
    this.objectives = [...OBJECTIVES, ...this.objectives];
    this.done = new Set();
    this.mapFeatures = Object.values(AT_X).map((x) => (
      { type: 'line', cls: 'screen', x1: x - SCREEN.w / 2, z1: SCREEN_Z, x2: x + SCREEN.w / 2, z2: SCREEN_Z }
    ));
  }

  stops() {
    return [
      new TeleportPoint({ id: 'entrance', label: 'Entrance', x: 0, z: 3.9, look: V(0, 1.9, ROOM.minZ) }),
      new TeleportPoint({ id: 'trava', label: SHOWCASES.trava.name, short: 'Core', x: AT_X.trava, z: SCREEN_Z + STOP_D, look: V(AT_X.trava, EYE, SCREEN_Z) }),
      new TeleportPoint({ id: 'hms', label: SHOWCASES.hms.name, short: 'Care', x: AT_X.hms, z: SCREEN_Z + STOP_D, look: V(AT_X.hms, EYE, SCREEN_Z) }),
    ];
  }

  build() {
    super.build();
    const { engine, interactions, hud } = this.app;
    // The client's dual-screen room.
    this.room = buildRoom(this.root, { engine });
    engine.on('quality', (q) => this.room.setReflections(q === 'high'));
    this.room.ready.then(() => {
      interactions.addOccluders(this.room.occluders);
      engine.warm(this.root);
    }).catch((err) => console.error('SaaS Zone: the room model could not load.', err));
    this.screens = {};
    for (const [id, x] of Object.entries(AT_X)) {
      // On the model's screen, which has its own frame: no bezel.
      const s = (this.screens[id] = new ShowcaseScreen(engine, SHOWCASES[id], { width: SCREEN.w, height: SCREEN.h, bezel: false }));
      s.group.position.set(x, SCREEN.y, SCREEN.z);     // facing into the room (+z)
      s.onLive = () => this.#live(id);
      this.root.add(s.group);
      interactions.add({
        id: `saas-${id}`, label: SHOWCASES[id].name, verb: SHOWCASES[id].use, objects: s.hitTargets, range: 14,
        onUse: () => this.useScreen(id),
      });
    }
    // The bottom-right button (or Space): play, skip, use or leave, depending on where the visitor is.
    hud.on('skip', () => { if (this.app.zone === this) this.#button(); });
    hud.on('sound', (on) => { for (const s of Object.values(this.screens)) s.setSound(on && this.app.zone === this); });
  }

  arrive(opts) {
    super.arrive(opts);
    this.label = undefined;
    for (const id of this.done) this.app.hud.completeObjective(id); // setObjectives() starts the list afresh
  }

  /** EmptyZone calls this after each glide. At a screen: its card, and its film if it hasn't played. */
  arrived(p) {
    this.app.hud.info(CARDS[p.id] ?? null);
    if (this.screens[p.id]?.state === 'idle') this.#play(p.id);
  }

  suggested() {
    return OBJECTIVES.find((o) => !this.done.has(o.id))?.id ?? null;
  }

  #here() {
    return this.going ? null : this.points.find((p) => p.here)?.id ?? null;
  }

  #play(id) {
    this.app.travis.stop();
    this.screens[id].playIntro({ sound: this.app.hud.soundOn });
  }

  #button() {
    if (this.mode === 'using') {
      if (this.screens[this.using].state === 'intro') this.screens[this.using].skip();
      else this.leaveScreen();
      return;
    }
    const id = this.#here();
    const s = this.screens[id];
    if (!s || this.mode !== 'play') return;
    if (s.state === 'intro') s.skip();
    else this.useScreen(id);
  }

  #done(id) {
    if (this.done.has(id)) return;
    this.done.add(id);
    this.app.hud.completeObjective(id);
    if (OBJECTIVES.every((o) => this.done.has(o.id))) this.app.travis.say(LINES.onward(this.next));
  }

  /** The film ended or was skipped: TRAVIS hands the screen over. */
  #live(id) {
    if (this.app.zone !== this) return;
    if (this.using === id) { if (this.useOff) this.#hand(id); return; }   // watched up close: straight into the site
    const live = !!this.screens[id].site;
    if (!live) this.#done(id);
    if (this.#here() === id) this.app.travis.say(live ? LINES.live[id] : LINES.soon, { interrupt: true });
  }

  /* ------------------------------------------------------------ using a screen */

  /** Where the eye goes to use a screen: square on, the page filling the view. */
  #eye(id) {
    const d = this.screens[id].site.fitDistance(this.app.engine.camera);
    return V(AT_X[id], SCREEN.y, SCREEN.z + 0.01 + d);
  }

  /**
   * Click a screen: from elsewhere, go to its stop; from the stop, step up square on until the
   * screen fills the view (like the Mosaic wall). The film plays there if it hasn't; once
   * the screen is live, the page takes the mouse and keyboard.
   */
  async useScreen(id) {
    const { app } = this;
    const { player, hud, engine, audio } = app;
    if (this.busy || this.mode !== 'play' || player.scripted) return;
    const s = this.screens[id];
    const stop = this.points.find((p) => p.id === id);
    if (this.#here() !== id) { this.teleportTo(stop); return; }
    if (!s.site) { if (s.state === 'idle') this.#play(id); return; }   // no live demo yet: just the film
    if (s.state === 'idle') this.#play(id);          // plays while the camera steps up

    this.busy = true;
    this.mode = 'using';
    this.using = id;
    app.block('screen');
    hud.info(null);
    hud.stopTitle(null);
    hud.showPlayUI(false);                           // objectives, captions, minimap and stops would sit on top of the page
    audio.whoosh(1);

    const look = V(AT_X[id], SCREEN.y, SCREEN.z);
    player.eyeHeight = SCREEN.y;                     // hold the eye level with the middle of the page
    await player.cinematic([{ eye: this.#eye(id), look }], { duration: 1.5, push: 0 });
    if (this.mode !== 'using') return;

    engine.container.classList.add('using-screen');
    const onKey = (e) => { if (e.code === 'Escape') this.leaveScreen(); };
    addEventListener('keydown', onKey);
    const off = engine.on('resize', () => { const e = this.#eye(id); player.setPose(e.x, e.z, look); });
    this.useOff = () => { off(); removeEventListener('keydown', onKey); };
    if (s.state === 'live') this.#hand(id);          // otherwise #live() hands it over when the film ends
  }

  /** The page takes the mouse and keyboard. */
  #hand(id) {
    this.screens[id].site.setInteractive(true);
    this.#done(id);
    this.app.travis.say(LINES.using, { interrupt: true });
  }

  async leaveScreen() {
    if (this.mode !== 'using' || !this.useOff) return;
    const { app } = this;
    const { player, hud, engine, audio } = app;
    const id = this.using;
    this.useOff();
    this.useOff = null;
    this.screens[id].site.setInteractive(false);
    engine.container.classList.remove('using-screen');
    audio.whoosh(1);

    player.eyeHeight = EYE;
    const dest = this.points.find((p) => p.id === id);
    await player.travel(dest, { look: dest.look });
    this.mode = 'play';
    this.busy = false;
    this.using = null;
    app.unblock('screen');
    hud.showPlayUI(true);
  }

  /** Leaving for another zone: stop the films and take the live pages off the walls. */
  leave() {
    super.leave();
    for (const s of Object.values(this.screens)) s.hide();
    this.label = undefined;
  }

  update(dt, t) {
    super.update(dt, t);
    const { player, engine, hud } = this.app;
    const here = this.#here();
    // The live pages show only while the camera is at rest (or in use): a whole website starting
    // mid-glide would stall the glide. Nothing stands between the visitor and either wall.
    const resting = !player.scripted || this.mode === 'using';
    for (const [id, s] of Object.entries(this.screens)) {
      if (s.state === 'intro' && here !== id && this.using !== id) s.stopIntro();   // walked away mid-film
      s.update(dt, engine.camera, { allowed: resting });
    }

    const own = this.#label(here);
    const label = own;
    if (label !== this.label) {
      this.label = label;
      hud.skipButton(!!label, label);
    }
  }

  #label(here) {
    if (this.mode === 'using') return this.screens[this.using].state === 'intro' ? SHOWCASES[this.using].skip : SHOWCASES[this.using].back;
    const s = this.screens[here];
    if (!s || this.mode !== 'play') return null;
    const show = SHOWCASES[here];
    return { idle: show.play, intro: show.skip, live: s.site ? show.use : null }[s.state];
  }
}
