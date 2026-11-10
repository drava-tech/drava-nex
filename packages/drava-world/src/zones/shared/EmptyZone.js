import * as THREE from 'three';
import { CMS_COLOR, COLOR, GLOW, SIDE_ZONES, ZONES } from '../../config.js';
import { Portal } from '../../core/Portal.js';
import { TeleportPoint } from '../../core/TeleportPoint.js';
import { LightPath } from '../../core/LightPath.js';
import { clamp } from '../../util/tween.js';
import { FONT, spacedText, textPlane } from '../../util/textures.js';
import { buildRoom } from './room.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const EYE = 1.65;

// Same footprint as the Welcome Zone (metres): x -9..9, z -12..12, ceiling 5.
// The door you came in by (back to the previous zone) is in the front wall at z = 12; the
// door on to the next zone is straight ahead in the back wall at z = -12.
// A zone can pass a room of its own (opts.room) and put the door on elsewhere (opts.exit: { wall: 'back' |
// 'left' | 'right', at }, `at` its centre along that wall: x on the back wall, z on a side wall).
// opts.doors: false is the way Zones 01, 02 and 05 work: no doors at all (whole walls); once the
// The arrows in the bottom bar are the way through (the client's call, 2026-10-12): → past the last
// stop goes on to the next zone (goNext()), whether or not anything was tried, and ← before the first
// stop goes back to the one before (goPrev()). There is no Continue button; a zone may still use the
// bottom-right button for its own actions (ownButton).
// opts.bare: true builds no room and no sign: the zone sets its own (a client model) in `root`, and
// `room` gives its bounds. opts.lens: shown as the client models are (that lens, no bloom, drawn at
// the screen's own resolution) while the visitor is in the zone; a zone with its own leave() calls
// super.leave().
export const ROOM = { minX: -9, maxX: 9, minZ: -12, maxZ: 12, height: 5 };
const DOOR = { width: 3.2, height: 3.4 };
const SIGN = { x: 0.06, y: 2.5, z: 0, width: 11, height: 3.4 };    // x: in from the left wall

// Doors to the Nex Zone match its door in the Welcome Zone: black with white.
const white = '#FBFAF5';
const PALETTES = {
  cms: { ground: CMS_COLOR.panel, glow: CMS_COLOR.white, frame: CMS_COLOR.white, kicker: '#FF4D63', title: white, glowScale: 0.5, lightScale: 0.25 },
};

/**
 * A zone whose room is built but still empty: floor, walls, lights, a large sign naming
 * the zone, a door back to the previous zone and a door on to the next one (the last
 * zone's door leads back to the Welcome Zone). Stops: entrance, centre, next door.
 *
 * Each zone's words (what TRAVIS says, the sign) are in src/zones/<id>/script.js.
 * When a zone gets its real content, give it its own class in src/zones/<id>/ and
 * register it in src/zones/index.js.
 */
export class EmptyZone {
  constructor(app, id, script, { room = ROOM, exit = { wall: 'back', at: 0 }, doors = true, bare = false, lens = null } = {}) {
    this.app = app;
    this.id = id;
    this.script = script;
    this.bounds = room;
    this.exit = exit;
    this.doors = doors;
    this.bare = bare;
    this.lens = lens;
    const i = ZONES.findIndex((z) => z.id === id);
    if (i >= 0) {
      this.zone = ZONES[i];
      this.prev = ZONES[i - 1];
      this.next = ZONES[(i + 1) % ZONES.length];
    } else {
      // A room off the loop (SIDE_ZONES): one door, back to the zone it belongs to; no door on.
      this.zone = SIDE_ZONES.find((z) => z.id === id);
      this.prev = ZONES.find((z) => z.id === this.zone.back);
      this.next = null;
    }
    this.classic = false;      // true: the room, sign and doors from before the panelled, brand-red finish
    this.roomOptions = {};     // more options for buildRoom (shared/room.js), e.g. { ceilingLines: false }
    this.height = room.height; // a zone can raise its ceiling (the World Zone does, for its waterfall)
    this.mode = 'play';
    this.busy = false;
    this.going = null;
    this.objectives = [this.next
      ? { id: 'next', text: `${doors ? 'Go on' : 'Continue'} to Zone ${this.next.n} · ${this.next.short}` }
      : { id: 'next', text: `Back to Zone ${this.prev.n} · ${this.prev.short}` }];
  }

  /* ------------------------------------------------------------------ build */

  build() {
    const { engine, interactions } = this.app;
    const root = (this.root = new THREE.Group());
    root.name = `zone-${this.id}`;
    engine.scene.add(root);

    const occluders = this.#buildRoom(root);
    if (!this.doors) { this.#buildDoorless(root, occluders); return; }

    this.back = new Portal({ zone: this.prev, width: DOOR.width, height: DOOR.height, palette: PALETTES[this.prev.id], kicker: '←  BACK TO', classic: this.classic });
    const B = this.bounds;
    this.back.group.position.set(0, 0, B.maxZ - 0.07);
    this.back.group.rotation.y = Math.PI;
    this.back.setOpen(true);
    root.add(this.back.group);

    if (this.next) {
      this.forward = new Portal({ zone: this.next, width: DOOR.width, height: DOOR.height, palette: PALETTES[this.next.id], classic: this.classic });
      const e = this.#exitDoor();
      this.forward.group.position.set(e.x, 0, e.z);
      this.forward.group.rotation.y = e.rotation;
      this.forward.setOpen(true);
      root.add(this.forward.group);
    }

    // The light path from the entrance to the door on (or the back wall), in five points.
    const to = this.next ? this.#exitDoor() : null;
    const end = to ? [to.x + to.nx * 1.33, to.z + to.nz * 1.33] : [0, B.minZ + 1.4];
    this.path = new LightPath([0, 1, 2, 3, 4].map((i) => [(end[0] * i) / 4, B.maxZ - 1.4 + (i / 4) * (end[1] - (B.maxZ - 1.4))]));
    this.path.revealTo(4);
    root.add(this.path.mesh);

    this.points = this.stops().filter(Boolean);
    for (const p of this.points) root.add(p.group);

    interactions.addOccluders(occluders);
    interactions.add({
      id: `${this.id}-back`, label: `Back to Zone ${this.prev.n} · ${this.prev.short}`, verb: 'Step in', objects: this.back.hitTargets, range: 8,
      onHover: (on) => this.back.setHover(on),
      onUse: () => this.enterDoor(this.back, this.prev),
    });
    if (this.forward) {
      interactions.add({
        id: `${this.id}-forward`, label: `Zone ${this.next.n} · ${this.next.short}`, verb: 'Step in', objects: this.forward.hitTargets, range: 8,
        onHover: (on) => this.forward.setHover(on),
        onUse: () => this.enterDoor(this.forward, this.next),
      });
    }
    for (const p of this.points) {
      interactions.add({
        id: `${this.id}-tp-${p.id}`, label: p.label, verb: 'Go to', objects: [p.hit], range: 40,
        onHover: (on) => p.setHover(on),
        onUse: () => this.teleportTo(p),
      });
    }
  }

  /** No doors: the stops, a light path from the entrance through them, and the Continue button. */
  #buildDoorless(root, occluders) {
    const { interactions, hud } = this.app;
    this.points = this.stops().filter(Boolean);
    for (const p of this.points) root.add(p.group);
    this.path = new LightPath(this.points.map((p) => [p.x, p.z]));
    this.path.revealTo(this.points.length - 1);
    root.add(this.path.mesh);
    interactions.addOccluders(occluders);
    for (const p of this.points) {
      interactions.add({
        id: `${this.id}-tp-${p.id}`, label: p.label, verb: 'Go to', objects: [p.hit], range: 40,
        onHover: (on) => p.setHover(on),
        onUse: () => this.teleportTo(p),
      });
    }
  }

  /** On to the next zone (the portal transition takes the visitor): → from the last stop. */
  async goNext() {
    const { app } = this;
    const { hud, audio } = app;
    if (this.busy || this.mode !== 'play' || !this.next) return;
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

  /** The stops, in order. A zone with exhibits overrides this (keep 'entrance' first and 'exit' last). */
  stops() {
    return [
      new TeleportPoint({ id: 'entrance', label: 'Entrance', short: 'Entrance', x: 0, z: this.bounds.maxZ - 3.4, look: V(0, EYE, 0) }),
      new TeleportPoint({ id: 'centre', label: `${this.zone.short} Zone`, short: 'Centre', x: 0, z: 0, look: V(this.bounds.minX + SIGN.x, SIGN.y, SIGN.z) }),
      this.exitStop(),
    ];
  }

  /** The stop by the door on (none in a room off the loop: stops() leaves it out). */
  exitStop() {
    if (!this.next || !this.doors) return null;
    const e = this.#exitDoor();
    return new TeleportPoint({ id: 'exit', label: `Door to Zone ${this.next.n}`, short: `To ${this.next.short}`, x: e.x + e.nx * 3.53, z: e.z + e.nz * 3.53, look: V(e.x - e.nx * 0.07, 1.7, e.z - e.nz * 0.07) });
  }

  /** The door on: where it stands (0.07 m off its wall), which way it faces (into the room) and its turn. */
  #exitDoor() {
    const { minX, maxX, minZ } = this.bounds;
    const { wall, at = 0 } = this.exit;
    if (wall === 'right') return { x: maxX - 0.07, z: at, nx: -1, nz: 0, rotation: -Math.PI / 2 };
    if (wall === 'left') return { x: minX + 0.07, z: at, nx: 1, nz: 0, rotation: Math.PI / 2 };
    return { x: at, z: minZ + 0.07, nx: 0, nz: 1, rotation: 0 };
  }

  /** The stop the stops bar suggests next. */
  suggested() {
    return 'exit';
  }

  /** The room (shared/room.js) with a doorway front and back, and the zone sign (a zone with exhibits on the left wall has none). */
  #buildRoom(root) {
    if (this.bare) return [];
    const door = { width: DOOR.width, height: DOOR.height, at: 0 };
    // A room off the loop has no door on: its back wall is whole.
    const { occluders, glow } = buildRoom(root, { ...this.bounds, height: this.height }, {
      openings: !this.doors ? [] : [{ wall: 'front', ...door }, ...(this.next ? [{ ...door, wall: this.exit.wall, at: this.exit.at ?? 0 }] : [])],
      classic: this.classic, ...this.roomOptions,
    });
    if (this.script.SIGN) this.#buildSign(root, glow);
    return occluders;
  }

  #buildSign(root, glow) {
    this.sign = textPlane(SIGN.width, SIGN.height, 2600, (ctx, w, h) => this.#drawSign(ctx, w, h), { glow: 0.72 }); // under the bloom threshold
    this.sign.position.set(this.bounds.minX + SIGN.x, SIGN.y, SIGN.z);
    this.sign.rotation.y = Math.PI / 2;
    root.add(this.sign);
    const rule = glow(0.02, 0.02, SIGN.width, this.bounds.minX + 0.04, SIGN.y - SIGN.height / 2 - 0.1, SIGN.z);
    rule.material.color.set(COLOR.brand).multiplyScalar(1.4);       // the brand's red under every zone's name
  }

  #drawSign(ctx, w, h) {
    const z = this.zone;
    const x = w / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FF4D63';
    ctx.font = `500 ${h * 0.05}px ${FONT.mono}`;
    spacedText(ctx, `ZONE ${z.n}  ·  ${z.verb.toUpperCase()}`, x, h * 0.3, 12);
    ctx.fillStyle = '#EEF0F3';
    ctx.font = `700 ${h * 0.2}px ${FONT.display}`;
    ctx.fillText(z.name.replace(/^The /, ''), x, h * 0.56);
    ctx.fillStyle = '#F2B544';
    ctx.font = `500 ${h * 0.06}px ${FONT.body}`;
    ctx.fillText(this.script.SIGN.note, x, h * 0.72);
  }

  #minimap() {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const d = DOOR.width / 2, { wall, at: e = 0 } = this.exit;
    // The wall with the door on is drawn in two runs either side of it.
    const gap = {
      back: [[minX, minZ, e - d, minZ], [e + d, minZ, maxX, minZ]],
      right: [[maxX, minZ, maxX, e - d], [maxX, e + d, maxX, maxZ]],
      left: [[minX, minZ, minX, e - d], [minX, e + d, minX, maxZ]],
    }[wall];
    const doorLine = { back: [e - d, minZ, e + d, minZ], right: [maxX, e - d, maxX, e + d], left: [minX, e - d, minX, e + d] }[wall];
    const whole = { back: [minX, minZ, maxX, minZ], right: [maxX, minZ, maxX, maxZ], left: [minX, minZ, minX, maxZ] };
    if (!this.doors) {
      return {
        viewBox: [minX - 1, minZ - 1.2, maxX - minX + 2, maxZ - minZ + 2.4],
        walls: [[minX, maxZ, maxX, maxZ], [minX, minZ, maxX, minZ], [minX, minZ, minX, maxZ], [maxX, minZ, maxX, maxZ]],
        features: [
          ...(this.script.SIGN ? [{ type: 'line', cls: 'screen', x1: minX + 0.25, z1: SIGN.z - SIGN.width / 2, x2: minX + 0.25, z2: SIGN.z + SIGN.width / 2 }] : []),
          ...(this.mapFeatures ?? []),
        ],
        points: this.points.map((p) => ({ id: p.id, x: p.x, z: p.z, label: p.label })),
      };
    }
    return {
      viewBox: [minX - 1, minZ - 1.2, maxX - minX + 2, maxZ - minZ + 2.4],
      walls: [[minX, maxZ, -d, maxZ], [d, maxZ, maxX, maxZ],
        ...['back', 'left', 'right'].flatMap((w) => (this.forward && w === wall ? gap : [whole[w]]))],
      features: [
        { type: 'line', cls: 'portal', x1: -d, z1: maxZ, x2: d, z2: maxZ },
        ...(this.forward ? [{ type: 'line', cls: 'portal', x1: doorLine[0], z1: doorLine[1], x2: doorLine[2], z2: doorLine[3] }] : []),
        ...(this.script.SIGN ? [{ type: 'line', cls: 'screen', x1: minX + 0.25, z1: SIGN.z - SIGN.width / 2, x2: minX + 0.25, z2: SIGN.z + SIGN.width / 2 }] : []),
        ...(this.mapFeatures ?? []),
      ],
      points: this.points.map((p) => ({ id: p.id, x: p.x, z: p.z, label: p.label })),
    };
  }

  /* ---------------------------------------------------------------- flow */

  /** from: the zone the visitor came from. Coming back from the next zone, they arrive by its door. */
  arrive({ from = null } = {}) {
    const { hud, player, travis } = this.app;
    this.mode = 'play';
    this.busy = false;
    this.going = null;
    hud.setZone(this.zone);
    hud.setStops(this.points.map((p) => ({ id: p.id, label: p.short })));
    hud.setMinimap(this.#minimap());
    hud.setObjectives(this.objectives);
    hud.showPlayUI(true);
    hud.enterButton(false);

    this.#view(true);
    const back = this.doors && from && from === this.next?.id && from !== this.prev.id;
    const e = this.#exitDoor();
    if (back) player.setPose(e.x + e.nx * 2.33, e.z + e.nz * 2.33, V(0, EYE, 0));   // 2.4 m from the wall
    else player.setPose(0, this.bounds.maxZ - 1.8, V(0, EYE, 0));
    hud.stopTitle(`Zone ${this.zone.n} · ${this.zone.verb}`, this.zone.name);
    travis.say(back ? this.script.LINES.back : this.script.LINES.arrival, { interrupt: true });
  }

  attract() {}

  leave() {
    this.#view(false);
  }

  /** opts.lens: the client models' look while here (on), and the other zones' back as the visitor leaves (off). */
  #view(on) {
    if (!this.lens) return;
    const { player, engine } = this.app;
    if (on && !this.viewOn) this.otherLens = player.baseFov;
    if (!on && !this.viewOn) return;
    this.viewOn = on;
    player.baseFov = on ? this.lens : this.otherLens;
    engine.bloom.enabled = !on && GLOW > 0;
    engine.setMinRatio(on ? Math.min(window.devicePixelRatio || 1, 1.75) : null);
  }

  async enterDoor(portal, to) {
    if (this.busy) return;
    const { app } = this;
    const { player, hud, audio } = app;
    this.busy = true;
    app.block('portal');
    if (to === (this.next ?? this.prev)) hud.completeObjective('next');
    hud.stopTitle(null);
    audio.whoosh(1.8);
    // Into the door: against the way it faces into the room (the door back faces -z).
    const n = portal === this.forward ? this.#exitDoor() : { nx: 0, nz: -1 };
    const { x, z } = portal.group.position;
    await player.travel({ x: x - n.nx * 0.3, z: z - n.nz * 0.3 }, { look: V(x - n.nx * 4, 1.6, z - n.nz * 4), speed: 5.5, push: 14, lift: 0 });
    await app.goTo(to.id);
    app.unblock('portal');
    this.busy = false;
  }

  teleportById(id) {
    const p = this.points.find((x) => x.id === id);
    if (p) this.teleportTo(p);
  }

  /** Previous (-1) or next (1) stop; past the last one on to the next zone, before the first back to the previous. */
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
    await player.travel(dest, { look: dest.look });
    this.going = null;
    app.unblock('teleport');
    this.busy = false;
    const n = this.points.indexOf(dest) + 1;
    if (dist > 0.3) hud.stopTitle(`Zone ${this.zone.n} · Stop ${String(n).padStart(2, '0')}`, dest.label);
    this.arrived?.(dest);
  }

  /* --------------------------------------------------------------- update */

  update(dt, t) {
    const { player, hud } = this.app;
    const here = this.going ? null : this.points.find((p) => p.here)?.id ?? null;
    hud.markStops({ here, going: this.going, next: here === 'exit' ? null : this.suggested() });
    this.back?.update(dt, t);
    this.forward?.update(dt, t);
    this.path.update(dt, t);
    for (const p of this.points) p.update(dt, t, player.pos);
    hud.updateMinimap(player.pos.x, player.pos.z, player.yaw);
  }
}
