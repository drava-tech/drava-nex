import * as THREE from 'three';
import { EmptyZone } from '../shared/EmptyZone.js';
import { CEILING, FRONT_FACE, ROOM, buildRoom } from './room.js';
import { TeleportPoint } from '../../core/TeleportPoint.js';
import { Workbench, BENCH as B, OPERATE as OP } from './Workbench.js';
import * as script from './script.js';

const { BENCH, CARDS, LINES, OBJECTIVES, TRAINER } = script;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const EYE = 1.65;

// The client's training room (room.js), its own work table and front screen hidden: our bench,
// with its trainer screen on its stand, stands centred against the front wall, unturned (its own
// frame is the room's), facing the entrance. Its camera post (0.53 m behind the bench's middle)
// keeps clear of the wall.
const AT = { x: 0, z: FRONT_FACE + 0.64 };
const STOP = { x: AT.x, z: AT.z + 3 };
const ENTRANCE_Z = 4.1;
const LENS = 60;                       // the client models' lens (as Zones 01, 02 and 05)
// Using the simulator: looking down at the bench at 45° (OPERATE in Workbench.js), the screen in
// view above it, so the trainer and the parts are both in reach of the mouse.
// BACK: how much further back along that same 45° line than Workbench's OPERATE, so the trainer
// screen fits whole above the bench (at 1, its top ran off the view).
const BACK = 1.3;
const OPERATE = (() => {
  const look = V(AT.x + OP.look[0], OP.look[1], AT.z + OP.look[2]);
  const eye = V(AT.x + OP.eye[0], OP.eye[1], AT.z + OP.eye[2]);
  return { eye: look.clone().lerp(eye, BACK), look };
})();

/**
 * Zone 04 — The Simulation Zone: the Lab. A bench with a camera over its mat and
 * the Assembly Trainer on the wall above it (a replica of White Tusker's trainer: vision AI that
 * guides a build step by step). Click the bench (or the button) to use it: the camera steps
 * up, the trainer takes the mouse, and the parts on the bench can be clicked: from a tray
 * onto the car, off the car, and the turntable turns the car. The trainer's state comes back
 * over the channel (Workbench.onStatus), and TRAVIS speaks to it.
 * The room is the client's training room (room.js), its work table and front screen hidden: our
 * bench and trainer screen against the front wall; there are no doors: once the car is built, the bottom-right button is "Continue to Zone 05".
 * The stops come from EmptyZone; the words are in script.js.
 */
export class SimulationZone extends EmptyZone {
  constructor(app) {
    super(app, 'simulation', script, { room: ROOM, doors: false, bare: true, lens: LENS });
    this.ownButton = true;              // the bottom-right button uses and leaves the bench
    this.objectives = [...OBJECTIVES, ...this.objectives];
    this.done = new Set();
    this.said = new Set();
    this.mapFeatures = [
      { type: 'rect', cls: 'furn', x: AT.x, z: AT.z, w: B.w, d: B.d },
    ];
  }

  stops() {
    return [
      new TeleportPoint({ id: 'entrance', label: 'Entrance', x: 0, z: ENTRANCE_Z, look: V(AT.x, 1.75, ROOM.minZ) }),
      new TeleportPoint({ id: 'assembly', label: 'Lab', short: 'Assembly', x: STOP.x, z: STOP.z, look: V(AT.x, 1.35, AT.z) }),
    ];
  }

  build() {
    super.build();
    const { engine, interactions, hud } = this.app;
    // The client's training room.
    this.room = buildRoom(this.root, { engine });
    engine.on('quality', (q) => this.room.setReflections(q === 'high'));
    this.room.ready.then(() => {
      interactions.addOccluders(this.room.occluders);
      engine.warm(this.root);
    }).catch((err) => console.error('Simulation Zone: the room model could not load.', err));
    const bench = (this.bench = new Workbench(engine, { url: '/drava-world/assembly/index.html', title: TRAINER.title, labels: TRAINER.tagLabels, ceiling: CEILING }));
    bench.group.position.set(AT.x, 0, AT.z);
    this.root.add(bench.group);
    // Against the wall, the bench's lights would throw a hot spot on the red panel behind it: no fill
    // here, and the spot narrowed onto the bench (the room's baked light does the rest).
    const [spot, fill] = bench.lights;
    spot.angle = 0.24;
    spot.penumbra = 0.85;
    fill.intensity = 0;

    interactions.add({
      id: 'assembly', label: BENCH.screen, verb: BENCH.verb, objects: [...bench.hitTargets, ...bench.screen.hitTargets], range: 9,
      onUse: () => this.useBench(),
    });
    bench.onHint = (key) => this.#say(LINES[key], { once: false });
    bench.onStatus = (s) => this.#status(s);
    bench.onFrame = (image, roi) => {
      if (this.app.zone === this) bench.screen.frame.contentWindow?.vecFeed?.(image, roi);
    };
    engine.onOverlay((renderer, dt) => {
      if (this.app.zone === this && bench.screen.shown) bench.renderFeed(renderer, engine.scene, dt);
    });
    hud.on('skip', () => { if (this.app.zone === this) this.#button(); });
  }

  arrive(opts) {
    super.arrive(opts);
    this.label = undefined;
    this.bench.screen.load();
    // main.js switches every light in a zone off as it is built (ROOM_LIGHTS); the bench's lamp is part of the exhibit.
    for (const l of this.bench.lights) l.visible = true;
    for (const id of this.done) this.app.hud.completeObjective(id); // setObjectives() starts the list afresh
  }

  arrived(p) {
    this.app.hud.info(CARDS[p.id] ?? null);
    if (p.id === 'assembly') this.#say(LINES.at);
  }

  suggested() {
    return OBJECTIVES.find((o) => !this.done.has(o.id))?.id ?? null;
  }

  #here() {
    return this.going ? null : this.points.find((p) => p.here)?.id ?? null;
  }

  /** TRAVIS says a line; once: only the first time this visit to the bench. */
  #say(line, { once = true } = {}) {
    if (!line) return;
    if (once) {
      if (this.said.has(line)) return;
      this.said.add(line);
    }
    this.app.travis.say(line, { interrupt: true });
  }

  /** The trainer's state changed (main.js report()). */
  #status(s) {
    if (this.app.zone !== this) return;
    if (s.screen === 'trainer' && s.step === '1' && this.lastStep !== '1') this.#say(LINES.started, { once: false });
    this.lastStep = s.step;
    if (s.mismatch) this.#say(LINES.mismatch);
    if (s.result && !this.done.has('assembly')) {
      this.done.add('assembly');
      this.app.hud.completeObjective('assembly');
      this.app.travis.say(LINES.done({ time: Math.round(s.result.time), accuracy: s.result.accuracy }), { interrupt: true });
      this.app.travis.say(LINES.allDone);
    }
    this.buildStep = s.step;          // the trainer's step (not `step`: that is the arrows' method)
  }

  #button() {
    if (this.mode === 'using') { this.leaveBench(); return; }
    if (this.#here() === 'assembly' && this.mode === 'play' && !this.done.has('assembly')) this.useBench();
  }

  /* ------------------------------------------------------------ the bench */

  /**
   * Step up to the bench: the trainer takes clicks on the screen, and the parts take clicks on
   * the bench. "Back to the room" (or Esc) returns to the stop.
   */
  async useBench() {
    const { app } = this;
    const { player, hud, engine, audio } = app;
    if (this.busy || this.mode !== 'play' || player.scripted) return;
    this.busy = true;
    this.mode = 'using';
    app.block('bench');
    hud.info(null);
    hud.stopTitle(null);
    hud.showPlayUI(false);                           // the captions and stops would sit over the screen
    audio.whoosh(1);

    this.pitchLimit = player.pitchLimit;
    player.pitchLimit = Math.PI / 2;                 // the 45° look down is past the usual limit
    player.eyeHeight = OPERATE.eye.y;
    this.#shift(OP.shift, 1.5);
    await player.cinematic([{ eye: OPERATE.eye, look: OPERATE.look }], { duration: 1.5, push: 0 });
    if (this.mode !== 'using') return;

    engine.container.classList.add('using-screen');
    hud.lookHint(BENCH.hint, 9000);
    this.bench.screen.setInteractive(true, { flat: false });

    const dom = engine.renderer.domElement;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const rayAt = (e) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, engine.camera);
      return ray.ray;
    };
    const at = (e) => this.bench.pick(rayAt(e));
    // A press on a part that moves more than a few pixels carries it (drag and drop: onto the mat to put
    // it on, anywhere else to put it down); one that doesn't is a click, which does the same in one go.
    let down = null, grabbed = null, dragging = false;
    const putDown = () => {
      dragging = false;
      this.bench.cancelDrag();
      dom.style.cursor = '';
    };
    const on = {
      pointermove: (e) => {
        if (dragging) { this.bench.dragTo(rayAt(e)); return; }
        if (down && grabbed && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
          if (this.bench.startDrag(grabbed)) {
            dragging = true;
            this.bench.hover(null);
            audio.tick();
            dom.style.cursor = 'grabbing';
            this.bench.dragTo(rayAt(e));
            return;
          }
          grabbed = null;
        }
        const hit = at(e);
        this.bench.hover(hit);
        dom.style.cursor = hit ? (hit.action === 'turn' ? 'pointer' : 'grab') : '';
      },
      pointerdown: (e) => { down = { x: e.clientX, y: e.clientY }; grabbed = at(e); },
      pointerup: (e) => {
        if (dragging) { dragging = false; down = grabbed = null; this.bench.drop(); audio.tick(); dom.style.cursor = ''; return; }
        const moved = !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8;
        down = grabbed = null;
        if (moved) return;
        const hit = at(e);
        if (hit) audio.tick();
        this.bench.use(hit);
      },
      pointerleave: () => { if (dragging) putDown(); down = grabbed = null; this.bench.hover(null); dom.style.cursor = ''; },
    };
    for (const [type, fn] of Object.entries(on)) dom.addEventListener(type, fn);
    const onKey = (e) => { if (e.code === 'Escape') this.leaveBench(); };
    addEventListener('keydown', onKey);
    this.benchOff = () => {
      putDown();
      for (const [type, fn] of Object.entries(on)) dom.removeEventListener(type, fn);
      removeEventListener('keydown', onKey);
      this.bench.hover(null);
      dom.style.cursor = '';
    };
    this.#say(LINES.using);
  }

  /** Ease the lens shift (engine.setLensShift) to `to` over `s` seconds, alongside the camera's move. */
  #shift(to, s) {
    const { engine } = this.app;
    const from = engine.lensShift ?? 0;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / (s * 1000));
      engine.setLensShift(from + (to - from) * k * k * (3 - 2 * k));
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }

  async leaveBench() {
    if (this.mode !== 'using' || !this.benchOff) return;
    const { app } = this;
    const { player, hud, engine, audio } = app;
    this.benchOff();
    this.benchOff = null;
    this.bench.screen.setInteractive(false);
    engine.container.classList.remove('using-screen');
    audio.whoosh(1);

    player.eyeHeight = EYE;
    player.pitchLimit = this.pitchLimit;
    this.#shift(0, 1.2);
    const dest = this.points.find((p) => p.id === 'assembly');
    await player.travel(dest, { look: dest.look });
    this.mode = 'play';
    this.busy = false;
    app.unblock('bench');
    hud.showPlayUI(true);
  }

  /** Leaving for another zone: take the trainer off the wall. */
  leave() {
    super.leave();
    this.app.engine.setLensShift(0);
    this.bench.screen.hide();
    this.label = undefined;
  }

  update(dt, t) {
    super.update(dt, t);
    const { player, engine, hud } = this.app;
    this.bench.update(dt, t);
    // The trainer shows only while the camera is at rest (or in use): a page starting mid-glide stalls it.
    this.bench.screen.update(dt, engine.camera, { allowed: !player.scripted || this.mode === 'using' });

    // The bench's own button at its stop until it has been built (the arrows go on to the next zone).
    const label = this.mode === 'using' ? BENCH.back : this.#here() === 'assembly' && this.mode === 'play' && !this.done.has('assembly') ? BENCH.use : null;
    if (label !== this.label) {
      this.label = label;
      hud.skipButton(!!label, label);
    }
  }
}
