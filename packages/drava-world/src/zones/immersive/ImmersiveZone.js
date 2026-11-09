import * as THREE from 'three';
import { ZONES } from '../../config.js';
import { EmptyZone } from '../shared/EmptyZone.js';
import { TeleportPoint } from '../../core/TeleportPoint.js';
import { clamp } from '../../util/tween.js';
import { FONT, spacedText } from '../../util/textures.js';
import { Ocean } from './Ocean.js';
import { HEIGHT, LINTEL, OceanRoom, PANEL, SWEET } from './OceanRoom.js';
import * as script from './script.js';

const { CARDS, DISCOVER_GOAL, DOCK, LINES, MOODS, OBJECTIVES, PANEL_TEXT, RECAP, SPECIES } = script;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const STOP = { x: 0, z: 1 };               // the sweet spot, near enough: the ocean is drawn from (0, 0)
const STEP_EVERY = 2.4;                    // seconds between ripples under a visitor standing there
const POINT_EVERY = 0.12;                  // seconds between ripples while the pointer moves over the floor
const PANEL_FOR = 16;                      // seconds a species panel stays on the wall
const LURE_PAST = 4.5;                     // m past the glass where a touch draws the shoals
const BOX = { x: 9, z: 12 };               // the screens' faces (the ceiling is at HEIGHT)
const MARK = { hover: 0xfbfaf5, shown: 0xf2b544 };   // the reticle: white while pointing, gold (the visitor's) on what they picked
// The walls a panel can go on (never the waterfall's): a point on the wall, and right along it as seen from the room.
const WALLS = {
  left: { at: V(-BOX.x + 0.008, 0, 0), u: V(0, 0, -1), half: BOX.z },
  right: { at: V(BOX.x - 0.008, 0, 0), u: V(0, 0, 1), half: BOX.z },
  front: { at: V(0, 0, BOX.z - 0.008), u: V(-1, 0, 0), half: BOX.x },
};
const _eye = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3();

/**
 * Zone 06 — The World Zone: the whole room is screens. The walls and ceiling show a live
 * ocean (whale shark, mantas, jellyfish, shoals, reef, light from the surface), the exit wall a
 * waterfall that lands on the lintel over the door, and the floor shallow water with waves
 * washing in and out that ripples under the visitor. The walls are touch screens: a touch sends
 * rings across the glass and draws the nearest shoals to it; pointing at an animal puts a reticle
 * round it on the glass, and tapping it lays its story on the wall beside it. The switch in the top
 * bar turns the ocean between the sunlit reef and Midnight. The room switches on as the visitor
 * arrives. At the sweet spot, "Your visit" shows the recap on the left wall. The doors and stops
 * come from EmptyZone; the words are in script.js.
 */
export class ImmersiveZone extends EmptyZone {
  constructor(app) {
    super(app, 'immersive', script);
    this.roomOptions = { ceilingLines: false };     // the ceiling is a screen
    this.height = HEIGHT;                           // taller than the other zones: the waterfall needs the drop
    this.objectives = [...OBJECTIVES, ...this.objectives];
    this.done = new Set();
    this.found = new Set();                         // the species discovered on the walls
    this.mood = 'reef';
    this.shown = null;                              // { target, until }: the animal whose panel is on the wall
    this.hovered = null;                            // the animal under the pointer
    this.clock = 0;
    this.mapFeatures = [
      { type: 'line', cls: 'screen', x1: -8.75, z1: -11.8, x2: -8.75, z2: 11.8 },
      { type: 'line', cls: 'screen', x1: 8.75, z1: -11.8, x2: 8.75, z2: 11.8 },
      { type: 'line', cls: 'screen', x1: -8.8, z1: -11.75, x2: 8.8, z2: -11.75 },
    ];
  }

  stops() {
    return [
      new TeleportPoint({ id: 'entrance', label: 'Entrance', x: 0, z: 8.6, look: V(0, 4.2, -12) }),
      new TeleportPoint({ id: 'room', label: 'The ocean', short: 'Ocean', x: STOP.x, z: STOP.z, look: V(0, 5.5, -8) }),
      this.exitStop(),
    ];
  }

  /** Far enough back from the waterfall to see it whole, up to the ceiling. */
  exitStop() {
    return new TeleportPoint({ id: 'exit', label: `Door to Zone ${this.next.n}`, short: `To ${this.next.short}`, x: 0, z: -4.5, look: V(0, 4.2, -12) });
  }

  build() {
    super.build();
    const { engine, hud, interactions } = this.app;
    this.path.mesh.visible = false;                 // the floor is the show; the rings mark the stops
    // The exit door's sign sits on the lintel, no wider than the door frame.
    const sign = this.forward.sign;
    sign.scale.setScalar((LINTEL.w * 0.94) / sign.geometry.parameters.width);
    sign.position.y = (LINTEL.y0 + LINTEL.y1) / 2;
    const detail = engine.quality === 'high' ? 'high' : 'low';
    this.ocean = new Ocean(engine.renderer, { detail });
    this.room = new OceanRoom({ ocean: this.ocean, detail });
    this.root.add(this.room.group);
    this.ocean.update(0, 0);
    this.ocean.render(engine.camera, SWEET, engine.pointScale);   // compiles the ocean's shaders now, behind the portal
    this.#buildDock();
    this.#bindPointer(engine.renderer.domElement);
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    // A click on nothing the room lists (no stop ring, no door) is a touch on whatever screen is there.
    interactions.on('empty-click', () => { if (this.app.zone === this) this.#tap(); });
    hud.on('mode', (id) => { if (this.app.zone === this) this.setMood(id); });
  }

  arrive(opts) {
    super.arrive(opts);
    const { hud, audio } = this.app;
    for (const id of this.done) hud.completeObjective(id); // setObjectives() starts the list afresh
    hud.modeSwitch(MOODS.options, this.mood, MOODS.label);
    this.room.powerOn();
    audio.scan(2.8);
  }

  /** EmptyZone calls this after each glide. At the sweet spot: its card (no stop title over the ceiling) and TRAVIS's line. */
  arrived(p) {
    const { hud, travis } = this.app;
    hud.info(CARDS[p.id] ?? null);
    if (p.id === 'exit' && !this.done.has('at-exit')) { this.done.add('at-exit'); travis.say(LINES.exit, { interrupt: true }); }
    if (p.id !== 'room') return;
    hud.stopTitle(null);
    this.#footstep();
    if (this.done.has('at-room')) return;
    this.done.add('at-room');
    travis.say(LINES.atRoom, { interrupt: true });
  }

  suggested() {
    return OBJECTIVES.every((o) => this.done.has(o.id)) ? 'exit' : 'room';
  }

  #here() {
    return this.going ? null : this.points.find((p) => p.here)?.id ?? null;
  }

  /** The first time the visitor does something: tick it off and TRAVIS says a line (after what he is saying, if not `interrupt`). */
  #tried(id, line, { interrupt = true } = {}) {
    if (this.done.has(id)) return;
    this.done.add(id);
    const { hud, travis } = this.app;
    hud.completeObjective(id);
    if (line) travis.say(line, { interrupt });
    if (OBJECTIVES.every((o) => this.done.has(o.id))) travis.say(LINES.allDone);
  }

  /* ------------------------------------------------------------- the ocean's mood */

  /** The switch: the sunlit reef or Midnight (the change eases over a few seconds). */
  setMood(id) {
    const { hud, travis, audio } = this.app;
    if (id === this.mood || this.mode !== 'play' || !MOODS.options.some((o) => o.id === id)) { hud.modeSwitch(MOODS.options, this.mood, MOODS.label); return; }
    this.mood = id;
    hud.modeSwitch(MOODS.options, id, MOODS.label);
    this.ocean.setNight(id === 'midnight');
    audio.whoosh(1.6);
    if (id === 'midnight') this.#tried('night', LINES.night);
    else if (!this.done.has('day')) { this.done.add('day'); travis.say(LINES.day, { interrupt: true }); }
  }

  /* ------------------------------------------------------------- the walls */

  /** What the pointer is on: the first screen or floor under it, and the animal behind the glass there (or null). */
  #look(ndc) {
    const { camera } = this.app.engine;
    this.ray.setFromCamera(ndc, camera);
    const hit = this.ray.intersectObjects([...this.room.screens, ...this.room.surfaces], false)[0] ?? null;
    const wall = hit?.object.userData.wall;
    if (!hit || wall === 'floor' || wall === 'fall' || this.#onRecap(hit.point)) return { hit, target: null };
    camera.getWorldPosition(_eye);
    return { hit, target: this.ocean.pick(_o.copy(_eye).sub(SWEET), this.ray.ray.direction, hit.distance) };
  }

  #onRecap(p) {
    return this.room.recapShown && p.x < -8.9 && Math.abs(p.z) < 8 && p.y < 4.6;
  }

  /** Whether a point on the glass is on the panel that is up. */
  #onPanel(p) {
    if (!this.shown) return false;
    const { o, u } = this.room.panelAt;
    _d.copy(p).sub(o.value);
    return Math.abs(_d.dot(u.value)) < PANEL.w / 2 && Math.abs(_d.y) < PANEL.h / 2 && Math.abs(_d.dot(_c.crossVectors(u.value, THREE.Object3D.DEFAULT_UP))) < 0.1;
  }

  /** A tap on the glass: rings across it; on an animal, its story on the wall; anywhere else, the shoals come. */
  #tap() {
    const { player, interactions, audio } = this.app;
    if (this.mode !== 'play' || player.scripted || this.going) return;
    const { hit, target } = this.#look(interactions.mouse);
    const wall = hit?.object.userData.wall;
    if (!hit || wall === 'floor' || wall === 'fall') return;   // the floor ripples by itself (#bindPointer)
    this.room.touch(hit.point);
    audio.drop();
    if (this.#onPanel(hit.point)) { this.#closePanel(); return; }
    if (target) {
      this.#discover(target, hit.point);
      this.#tried('touch');
      return;
    }
    this.ocean.lure(_p.copy(hit.point).sub(SWEET).addScaledVector(this.ray.ray.direction, LURE_PAST));
    this.#tried('touch', LINES.touch);
  }

  /** An animal picked out: its panel on the wall beside where it was tapped, and TRAVIS tells its story. */
  #discover(target, at) {
    const { audio, travis } = this.app;
    if (this.shown?.target === target) { this.#closePanel(); return; }
    const s = SPECIES[target.kind];
    const first = !this.found.has(target.kind);
    this.found.add(target.kind);
    this.shown = { target, until: this.clock + PANEL_FOR };
    this.room.showPanel(this.#panelPlace(at), (ctx, w, h) => this.#drawPanel(ctx, w, h, s));
    audio.ping();
    travis.say(LINES.discover(s), { interrupt: true });
    if (first && this.found.size >= DISCOVER_GOAL) this.#tried('discover', LINES.discovered, { interrupt: false });
  }

  #closePanel() {
    this.shown = null;
    this.room.hidePanel();
  }

  /**
   * Where a panel goes for a tap at `at`: on that wall, beside the animal toward the wall's middle,
   * at a height to read. A tap on the ceiling puts it on the wall the visitor faces (never the falls').
   */
  #panelPlace(at) {
    let id = at.x < -8.9 ? 'left' : at.x > 8.9 ? 'right' : at.z > 11.9 ? 'front' : null;
    let y = at.y;
    if (!id) {
      this.app.engine.camera.getWorldDirection(_d);
      const side = at.x < 0 ? 'left' : 'right';
      id = Math.abs(_d.x) > Math.abs(_d.z) * 0.6 ? (_d.x < 0 ? 'left' : 'right') : _d.z > 0 ? 'front' : side;
      y = 3.4;
    }
    const wall = WALLS[id];
    const along = at.dot(wall.u);
    const room = wall.half - PANEL.w / 2 - 0.3;
    let s = clamp(along + (along > 0 ? -1 : 1) * (PANEL.w / 2 + 0.7), -room, room);
    const door = 1.9 + PANEL.w / 2;                                  // the door and its sign, on the front wall
    if (id === 'front' && Math.abs(s) < door) s = (s || along || 1) > 0 ? door : -door;
    y = clamp(y, PANEL.h / 2 + 0.8, 5);
    return { o: wall.at.clone().addScaledVector(wall.u, s).setY(y), u: wall.u, v: THREE.Object3D.DEFAULT_UP };
  }

  /** The species panel: what it is, three facts in a row, and its story. */
  #drawPanel(ctx, w, h, s) {
    const m = w / 3.4;                                   // the layout is 3.4 units wide, scaled to the panel
    const x = m * 0.22, inner = w - 2 * x;
    ctx.fillStyle = 'rgba(4, 9, 17, 0.8)';
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, m * 0.07);
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 250, 245, 0.24)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#E21D3E';
    ctx.fillRect(x, m * 0.22, m * 0.42, m * 0.018);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FF4D63';
    ctx.font = `500 ${m * 0.07}px ${FONT.mono}`;
    spacedText(ctx, `${PANEL_TEXT.kicker}  ·  ${this.found.size} of ${Object.keys(SPECIES).length} found`.toUpperCase(), x, m * 0.4, m * 0.018);
    ctx.fillStyle = '#EEF0F3';
    ctx.font = `700 ${m * 0.25}px ${FONT.display}`;
    ctx.fillText(s.name, x, m * 0.72);
    ctx.fillStyle = '#B9C0CC';
    ctx.font = `italic 400 ${m * 0.1}px ${FONT.body}`;
    ctx.fillText(s.latin, x, m * 0.9);
    ctx.fillStyle = 'rgba(251, 250, 245, 0.16)';
    ctx.fillRect(x, m * 1.03, inner, 2);
    const col = inner / 3;
    ['size', 'depth', 'diet'].forEach((k, i) => {
      const cx = x + i * col;
      ctx.fillStyle = '#8D96A6';
      ctx.font = `500 ${m * 0.058}px ${FONT.mono}`;
      spacedText(ctx, PANEL_TEXT.stats[k].toUpperCase(), cx, m * 1.2, m * 0.015);
      ctx.fillStyle = '#EEF0F3';
      let size = m * 0.095;
      ctx.font = `600 ${size}px ${FONT.body}`;
      while (ctx.measureText(s[k]).width > col - m * 0.12 && size > m * 0.06) ctx.font = `600 ${(size -= 2)}px ${FONT.body}`;
      ctx.fillText(s[k], cx, m * 1.36);
    });
    ctx.fillStyle = '#D5DAE2';
    ctx.font = `400 ${m * 0.092}px ${FONT.body}`;
    wrap(ctx, s.fact, inner).slice(0, 3).forEach((line, i) => ctx.fillText(line, x, m * 1.62 + i * m * 0.14));
    ctx.fillStyle = '#6B7380';
    ctx.font = `500 ${m * 0.05}px ${FONT.mono}`;
    spacedText(ctx, PANEL_TEXT.footer.toUpperCase(), x, h - m * 0.12, m * 0.012);
  }

  /**
   * Where an animal shows on the glass from the visitor's eye: the point where the sight line to it
   * leaves the room, and its size there. Null if that is not an ocean screen (behind the falls, under the floor).
   */
  #markFor(target) {
    this.app.engine.camera.getWorldPosition(_eye);
    target.centre(_c).add(SWEET);
    _d.copy(_c).sub(_eye);
    const dist = _d.length();
    _d.divideScalar(dist);
    const tx = _d.x ? (Math.sign(_d.x) * BOX.x - _eye.x) / _d.x : Infinity;
    const ty = _d.y > 0 ? (HEIGHT - _eye.y) / _d.y : Infinity;
    const tz = _d.z ? (Math.sign(_d.z) * BOX.z - _eye.z) / _d.z : Infinity;
    const t = Math.min(tx, ty, tz);
    if (_d.y < 0 && -_eye.y / _d.y < t) return null;                 // it shows below the floor's edge
    if ((t === tz && _d.z < 0) || t >= dist) return null;            // behind the waterfall
    return { point: _p.copy(_eye).addScaledVector(_d, t), radius: clamp((target.size * t) / dist, 0.15, 3) };
  }

  /** Each frame: the animal under the pointer (a "Discover" prompt), and the reticle on the glass round it or round the one on show. */
  #hover() {
    const { interactions, player, settings, hud, engine } = this.app;
    const free = this.mode === 'play' && !player.scripted && !player.dragging && !this.going && interactions.enabled
      && interactions.mouseInside && !interactions.hovered && !settings.touch;
    const target = free ? this.#look(interactions.mouse).target : null;
    if (target !== this.hovered) {
      this.hovered = target;
      if (!interactions.hovered) {
        hud.prompt(target ? { verb: 'Discover', label: SPECIES[target.kind].name } : null);
        engine.renderer.domElement.classList.toggle('pointing', !!target);
      }
    }
    const on = this.shown?.target ?? this.hovered;
    const mark = on && this.#markFor(on);
    if (mark) this.room.setMark(mark.point, mark.radius, this.shown ? MARK.shown : MARK.hover);
    else this.room.setMark(null);
  }

  /* ------------------------------------------------------------- the recap */

  /** The finale: the visit on the left wall, the view turning to it, TRAVIS reading it out. */
  showRecap() {
    const { player, travis } = this.app;
    const v = this.#visit();
    this.#closePanel();
    this.room.showRecap((ctx, w, h) => this.#drawRecap(ctx, w, h, v));
    this.#syncDock();
    if (!player.scripted) player.travel({ x: player.pos.x, z: player.pos.z }, { look: V(-9, 2.6, 0), duration: 1.6 });
    this.#tried('recap');
    travis.say(LINES.recap(v), { interrupt: true });
  }

  hideRecap() {
    this.room.hideRecap();
    this.#syncDock();
  }

  #visit() {
    const { visit } = this.app;
    return {
      zones: visit.zones.size,
      visited: ZONES.filter((z) => visit.zones.has(z.id)),
      minutes: Math.max(1, Math.round((Date.now() - visit.start) / 60000)),
      memento: visit.memento, award: visit.award, product: visit.product,
      found: this.found.size,
    };
  }

  /** The canvas is 16 m × 4 m of the left wall: where they went | the title | what they chose. */
  #drawRecap(ctx, w, h, v) {
    const m = w / 16;                                // px per metre
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FF4D63';
    ctx.font = `500 ${m * 0.16}px ${FONT.mono}`;
    spacedText(ctx, RECAP.kicker.toUpperCase(), w / 2, h * 0.3, m * 0.05);
    ctx.fillStyle = '#EEF0F3';
    ctx.font = `700 ${m * 0.42}px ${FONT.display}`;
    ctx.fillText(RECAP.title, w / 2, h * 0.47);
    ctx.fillStyle = '#B9C0CC';
    ctx.font = `400 ${m * 0.18}px ${FONT.body}`;
    ctx.fillText([`${v.zones} of ${ZONES.length} zones`, `${v.minutes} min`, ...(v.found ? [RECAP.found(v.found)] : [])].join('  ·  '), w / 2, h * 0.58);
    ctx.fillStyle = '#8D96A6';
    ctx.font = `400 ${m * 0.12}px ${FONT.body}`;
    ctx.fillText(RECAP.footer, w / 2, h * 0.84);
    ctx.textAlign = 'left';
    const list = (x0, title, rows) => {
      ctx.fillStyle = '#8D96A6';
      ctx.font = `500 ${m * 0.12}px ${FONT.mono}`;
      spacedText(ctx, title.toUpperCase(), x0, h * 0.22, m * 0.04);
      rows.forEach(([label, value], i) => {
        const y = h * 0.34 + i * m * 0.4;
        ctx.fillStyle = '#6B7380';
        ctx.font = `500 ${m * 0.1}px ${FONT.mono}`;
        spacedText(ctx, label.toUpperCase(), x0, y, m * 0.03);
        ctx.fillStyle = '#EEF0F3';
        ctx.font = `600 ${m * 0.19}px ${FONT.body}`;
        ctx.fillText(value, x0, y + m * 0.23);
      });
    };
    list(m * 0.6, RECAP.zonesTitle, v.visited.map((z) => [`Zone ${z.n} · ${z.verb}`, z.name.replace(/^The /, '')]));
    const choices = [
      ...(v.memento ? [[RECAP.memento, v.memento]] : []),
      ...(v.award ? [[RECAP.award, v.award]] : []),
      ...(v.product ? [[RECAP.product, v.product]] : []),
    ];
    list(m * 11, RECAP.choicesTitle, choices.length ? choices : [['', RECAP.none]]);
  }

  /* ------------------------------------------------------------- the floor */

  /** A ripple under the visitor's feet (the real floor's overhead sensor sees them standing there). */
  #footstep() {
    const p = this.app.player.pos;
    this.room.ripple(p.x, p.z);
  }

  /** Pointing at the floor (moving over it, or a press) ripples it, anywhere in the room. Looking around still works. */
  #bindPointer(dom) {
    let last = 0;
    const at = (e, force) => {
      if (this.app.zone !== this || this.mode !== 'play' || this.app.player.scripted || !this.app.interactions.enabled) return;
      const now = performance.now() / 1000;
      if (!force && now - last < POINT_EVERY) return;
      const r = dom.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.ray.setFromCamera(this.ndc, this.app.engine.camera);
      const hit = this.ray.intersectObjects(this.room.surfaces, false)[0];
      if (!hit) return;
      last = now;
      this.room.ripple(hit.point.x, hit.point.z);
      this.#tried('floor', LINES.floor);
    };
    dom.addEventListener('pointermove', (e) => at(e, false));
    dom.addEventListener('pointerdown', (e) => at(e, true));
  }

  /* ------------------------------------------------------------- the dock */

  #buildDock() {
    const el = (this.dock = document.createElement('section'));
    el.className = 'imm-dock';
    el.setAttribute('aria-label', 'Immersive room controls');
    el.innerHTML = `<div class="imm-row"><button type="button" data-recap>${DOCK.recap}</button></div><p class="imm-hint">${DOCK.hint}</p>`;
    this.app.hud.root.appendChild(el);
    el.querySelector('[data-recap]').addEventListener('click', () => (this.room.recapShown ? this.hideRecap() : this.showRecap()));
  }

  #syncDock() {
    const b = this.dock.querySelector('[data-recap]');
    b.classList.toggle('on', this.room.recapShown);
    b.textContent = this.room.recapShown ? DOCK.hide : DOCK.recap;
  }

  /* ------------------------------------------------------------- frame */

  leave() {
    super.leave();
    const { hud, audio, engine } = this.app;
    this.dock.classList.remove('on');
    this.dockOn = false;
    audio.water(false);
    this.watering = false;
    hud.modeSwitch(null);
    this.#closePanel();
    this.room.setMark(null);
    if (this.hovered) {
      this.hovered = null;
      hud.prompt(null);
      engine.renderer.domElement.classList.remove('pointing');
    }
  }

  update(dt, t) {
    super.update(dt, t);
    const { engine, audio } = this.app;
    this.clock = t;
    this.ocean.update(dt, t);
    this.ocean.render(engine.camera, SWEET, engine.pointScale);
    if (this.shown && t > this.shown.until) this.#closePanel();
    this.#hover();
    this.room.update(dt, t, engine.pointScale);
    // The falls are heard as soon as sound is allowed (after the visitor's first click).
    if (!this.watering && audio.ctx) { audio.water(true); this.watering = true; }
    const atRoom = this.mode === 'play' && !this.app.player.scripted && this.#here() === 'room';
    if (atRoom !== this.dockOn) { this.dockOn = atRoom; this.dock.classList.toggle('on', atRoom); }
    if (atRoom && (this.stepT = (this.stepT ?? 0) + dt) > STEP_EVERY) { this.stepT = 0; this.#footstep(); }
  }
}

/** Break text into lines no wider than `width` at the context's current font. */
function wrap(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
