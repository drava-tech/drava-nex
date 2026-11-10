import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FONT } from './shared/render.js';
import { WARM_WHITE_HEX } from './shared/seed.js';

const FABRIC_LEVEL = 0.8;     // a full-bright panel stays just under white, so bloom doesn't wash the room
const LINE_GAIN = 1 / 0.85;   // the room's lines at the default 85 % look as they always have
const ROOM_LIGHT = 1.15;      // the room's ceiling lights follow the fabric at this scale
const IDENTIFY_S = 3;         // how long a fixture flashes for Identify

// The air conditioner: a slim split unit high on a wall (where the zone puts it, in view from
// the Nex kiosk), with a wall thermostat under it. y: the unit's and the thermostat's centres;
// sizes in metres.
const AC = { y: 3.85, w: 1.0, h: 0.29, d: 0.21 };
const THERMO = { y: 1.75, w: 0.48, h: 0.31 };   // high enough to clear TRAVIS's captions in the camera's view
const MODE_COLOR = { cool: '#38bdf8', heat: '#fb923c', auto: '#a78bfa', fan: '#e5e7eb', dry: '#2dd4bf' };
const FAN_BARS = { low: 1, med: 2, high: 3, auto: 2 };
const AMBIENT = 26.5;         // °C the room drifts back to with the AC off
const ROOM_RATE = 0.35;       // °C a second the room moves toward the set temperature (quick, for the demo)
const TEMP_STEP_S = 0.12;     // the displays count to a new set temperature a degree at a time

// The glass door at the entrance: two sliding leaves just inside the doorway, a header with a
// status light, a card reader on the wall beside it. LEAF_Z: how far in front of the wall.
const LEAF_Z = 0.22;
const UNLATCH_S = 0.35;       // from the lock's click to the leaves moving
const SLIDE_S = 1.1;          // the leaves' travel time
const LOCK_COLOR = { locked: '#eab308', open: '#22c55e' };   // the Nex's Security colours

/** A key for what the AC shows: two states with the same key look the same in the room. */
export const climateKey = (c) => `${c.power}:${c.temp}:${String(c.mode).toLowerCase()}:${c.fanSpeed}`;

/** What a light fixture is set to show: two settings with the same key look the same. */
const lightKey = (env, l) => {
  const group = l.name.replace(/\s*\d+\s*$/, '').trim() || l.name;
  return `${l.on}:${l.brightness}:${(env.groupMode?.[group] ?? 'warm') === 'warm' ? 'warm' : l.color}`;
};

const modeColor = (mode) => MODE_COLOR[String(mode).toLowerCase()] ?? MODE_COLOR.cool;
const smooth = (k) => k * k * (3 - 2 * k);

/**
 * Zone 02's own devices, driven by the Nex's Environment page (state.environment):
 *  - a stretch fabric ceiling panel (driven by "Stretch Fabric 0" and "1"), and the room's own white
 *    light lines, ceiling and skirting, as the "Strip Light": on/off, brightness, warm white or
 *    a colour; the room's ceiling lights follow the fabric, so the whole room takes the mode
 *  - an air conditioner high on the left wall: its display shows the set temperature and mode,
 *    its louvre swings and air flows from it in the mode's colour; a thermostat under it shows
 *    the set temperature on a dial, the room's temperature (which heads for the set one), mode and fan
 *  - a glass sliding door at the entrance with a card reader: unlocking clicks the lock, turns
 *    the reader and the header light green and slides the door open; locking closes it
 * Light changes ease in over a fraction of a second; Identify flashes one fixture.
 *
 * hold(kind) keeps the climate, the lock or the lights ('lights') as they are until release(kind), so the zone can turn
 * the camera to the device first and the visitor sees the change happen.
 *
 * room: { minX, maxX, minZ, maxZ, height }; lines: the room's light lines from buildRoom
 * ({ mesh, level }); entry: { x, z, width, height } of the entrance doorway (z: the wall's
 * inside face); audio: the AudioFX, for the lock's click; ac: { at, rotation }, the point on
 * a wall's inside face the AC hangs on and its turn (0 faces +z); fabric: { x, z, w, d }, the
 * ceiling panel's centre and size (w along x, d along z), or { mesh }: a light already in the
 * room (the model's ceiling disc) that becomes the panel.
 */
export class RoomDevices {
  constructor(root, { room, lines, entry, ac, fabric, audio = null }) {
    this.root = root;
    this.audio = audio;
    this.fixtures = {};       // uuid → { mats: [{ mat, level }], target: Color, now: Color, flash }
    this.roomLights = [];
    this.held = new Set();
    this.#buildFabric(room, fabric);
    this.#fixture('light-23', lines.map((l) => ({ mat: l.mesh.material, level: l.level * LINE_GAIN })));
    this.#buildAc(ac);
    this.#buildDoor(entry);
    // Where the zone points the camera to show each device (world space).
    this.spots = {
      ac: new THREE.Vector3(ac.at.x, 2.6, ac.at.z),   // frames the unit and the thermostat, the thermostat clear of the captions
      door: new THREE.Vector3(entry.x, 1.75, entry.z),
    };
  }

  /**
   * A baked room's light (fn(rel): a colour relative to the light it was baked with, the lights
   * at their default: warm white, 85 %). The fabric panels light most of the room, the strip
   * light the rest, so the whole room dims and takes their colour with them.
   */
  adoptRoomGlow(fn) {
    this.roomGlow = fn;
    this.glowBase = new THREE.Color(WARM_WHITE_HEX).multiplyScalar(0.85);
    this.glowKey = null;
  }

  /** The room's warm ceiling point lights (from buildRoom): they follow the fabric panels. */
  adoptRoomLights(lights) {
    this.roomLights = lights.map((l) => ({ light: l, base: l.intensity }));
  }

  #fixture(uuid, mats) {
    this.fixtures[uuid] = { mats, target: new THREE.Color(0x000000), now: new THREE.Color(0x000000), flash: 0 };
  }

  #canvas(w, h) {
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex, ctx: canvas.getContext('2d') };
  }

  #buildFabric({ height }, fabric) {
    // A light the room already has (a baked model's ceiling disc) becomes the panel: it glows
    // as bright as it was baked, so it isn't tone mapped.
    if (fabric.mesh) {
      this.fabricLevel = LINE_GAIN;     // at the default 85 %, as bright as it was baked
      this.fabricMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
      fabric.mesh.material = this.fabricMat;
      this.#fixture('light-27', []);
      this.#fixture('light-28', []);
      return;
    }
    // One backlit stretch fabric panel in the ceiling over the curved screen, inside the curve,
    // where the view from the kiosk sees it above the walls. Both fabric drivers light it (they
    // move together in the real centre). It hangs just below the ceiling's light lines, so the
    // centre line doesn't cross it.
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6, metalness: 0.3 });
    this.fabricMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(fabric.w, fabric.d), this.fabricMat);
    panel.rotation.x = Math.PI / 2;
    panel.position.set(fabric.x, height - 0.06, fabric.z);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(fabric.w + 0.2, 0.05, fabric.d + 0.2), frameMat);
    frame.position.set(fabric.x, height - 0.03, fabric.z);
    this.root.add(frame, panel);
    this.#fixture('light-27', []);
    this.#fixture('light-28', []);
  }

  /* ------------------------------------------------------------------ AC */

  #buildAc({ at, rotation }) {
    // Built facing +z, then turned to face into the room off its wall.
    const g = new THREE.Group();
    g.position.set(at.x, 0, at.z);
    g.rotation.y = rotation;
    const white = new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.42, emissive: 0x4a4a47 });
    const seam = new THREE.MeshStandardMaterial({ color: 0x9c9ea4, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.6 });
    const bottom = AC.y - AC.h / 2, front = AC.d + 0.01;

    // A soft-edged body, one fine seam across its face, and a dark slot along the underside
    // with the louvre that swings down over it while it runs.
    const body = new THREE.Mesh(new RoundedBoxGeometry(AC.w, AC.h, AC.d, 4, 0.04), white);
    body.position.set(0, AC.y, AC.d / 2 + 0.01);
    const line = new THREE.Mesh(new THREE.BoxGeometry(AC.w - 0.07, 0.004, 0.004), seam);
    line.position.set(0, bottom + 0.085, front);
    const outlet = new THREE.Mesh(new THREE.BoxGeometry(AC.w - 0.1, 0.008, 0.1), dark);
    outlet.position.set(0, bottom - 0.001, AC.d - 0.05);
    this.louvre = new THREE.Group();
    this.louvre.position.set(0, bottom - 0.006, AC.d - 0.1);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(AC.w - 0.12, 0.008, 0.09), white);
    flap.position.z = 0.045;
    this.louvre.add(flap);

    // The display: a small black glass window on the face, its digits lit in the mode's colour,
    // and a hairline of the same colour along the foot of the face while it runs.
    this.acUnit = this.#canvas(320, 120);
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.075), new THREE.MeshBasicMaterial({ map: this.acUnit.tex, toneMapped: false }));
    display.position.set(0, AC.y + 0.035, front + 0.001);
    this.acGlow = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.BoxGeometry(AC.w - 0.22, 0.005, 0.003), this.acGlow);
    glow.position.set(0, bottom + 0.035, front);

    // Air from the outlet: two sheets of moving streaks, one steep, one long, in the mode's colour.
    this.airUniforms = { uTime: { value: 0 }, uLevel: { value: 0 }, uColor: { value: new THREE.Color(MODE_COLOR.cool) } };
    const airMat = new THREE.ShaderMaterial({
      uniforms: this.airUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uTime, uLevel;
        uniform vec3 uColor;
        varying vec2 vUv;
        float hash(float n){ return fract(sin(n * 91.7) * 43758.5453); }
        void main(){
          float s = 1.0 - vUv.y;                       // 0 at the outlet, 1 at the far end
          float lane = floor(vUv.x * 34.0);
          float r = hash(lane);
          float line = 1.0 - abs(fract(vUv.x * 34.0) - 0.5) * 2.0;
          float puff = 0.5 + 0.5 * sin(s * 10.0 - uTime * (2.4 + r * 1.6) + r * 6.283);
          float along = smoothstep(0.0, 0.1, s) * (1.0 - smoothstep(0.3, 1.0, s));
          float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
          float a = uLevel * 0.28 * along * edge * mix(0.25, 1.0, puff * line);
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    for (const [length, drop] of [[0.7, 0.8], [1.2, 0.6]]) {
      const air = new THREE.Mesh(airflowGeometry(AC.w - 0.16, length, drop), airMat);
      air.position.set(0, bottom - 0.01, AC.d - 0.02);
      air.renderOrder = 2;
      g.add(air);
    }

    // The thermostat: a black glass panel in a thin frame, at eye level under the unit.
    const frame = new THREE.Mesh(new RoundedBoxGeometry(THERMO.w + 0.03, THERMO.h + 0.03, 0.02, 2, 0.008), new THREE.MeshStandardMaterial({ color: 0x9a9da4, roughness: 0.35, metalness: 0.6 }));
    frame.position.set(0, THERMO.y, 0.01);
    this.thermo = this.#canvas(560, 360);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(THERMO.w, THERMO.h), new THREE.MeshBasicMaterial({ map: this.thermo.tex, toneMapped: false }));
    face.position.set(0, THERMO.y, 0.021);

    g.add(body, line, outlet, this.louvre, display, glow, frame, face);
    this.root.add(g);
  }

  /* ---------------------------------------------------------------- door */

  #buildDoor({ x, z, width, height }) {
    // Built facing +z (into the room is +z here), then turned to face into the room from the entrance wall.
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = Math.PI;
    const leafW = width / 2 + 0.06, leafH = height - 0.04;
    this.slide = width / 2 + 0.02;          // how far each leaf travels to clear the doorway
    const glass = new THREE.MeshStandardMaterial({ color: 0xc4d8de, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.16, depthWrite: false });
    const edge = new THREE.MeshStandardMaterial({ color: 0x7fa39b, roughness: 0.2, transparent: true, opacity: 0.55 });
    const frost = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, transparent: true, opacity: 0.32, depthWrite: false });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.3, metalness: 0.85 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.45, metalness: 0.5 });

    // Two leaves meeting in the middle, each its own group so it can slide. side: -1 left, 1 right.
    this.leaves = [-1, 1].map((side) => {
      const leaf = new THREE.Group();
      leaf.userData.side = side;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.012), glass);
      pane.position.y = 0.02 + leafH / 2;
      pane.renderOrder = 3;
      leaf.add(pane);
      // Green-tinted glass edges, so the leaves read against the doorway.
      for (const ex of [-leafW / 2, leafW / 2]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.014, leafH, 0.014), edge);
        e.position.set(ex, pane.position.y, 0);
        leaf.add(e);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(leafW, 0.07, 0.04), black);
      rail.position.y = 0.02 + leafH - 0.035;
      // A frosted safety band, as glass doors carry, at about hip height.
      const band = new THREE.Mesh(new THREE.BoxGeometry(leafW - 0.12, 0.1, 0.016), frost);
      band.position.y = 1.05;
      band.renderOrder = 4;
      // A tall pull handle near the meeting edge, on the room side.
      const hx = -side * (leafW / 2 - 0.14);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.15, 12), steel);
      handle.position.set(hx, 1.15, 0.07);
      for (const hy of [0.7, 1.6]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.064, 8), steel);
        post.rotation.x = Math.PI / 2;
        post.position.set(hx, hy, 0.038);
        leaf.add(post);
      }
      leaf.add(rail, band, handle);
      leaf.userData.base = leafW / 2;
      leaf.position.set(side * leaf.userData.base, 0, LEAF_Z);
      g.add(leaf);
      return leaf;
    });

    // The header over the track, wide enough for both leaves open, with the status light on its face.
    const reach = width / 2 + this.slide + 0.2;
    const header = new THREE.Mesh(new THREE.BoxGeometry(reach * 2, 0.2, 0.16), black);
    header.position.set(0, height + 0.1, LEAF_Z);
    this.doorLightMat = new THREE.MeshBasicMaterial({ color: LOCK_COLOR.locked, toneMapped: false });
    const light = new THREE.Mesh(new THREE.BoxGeometry(width, 0.022, 0.01), this.doorLightMat);
    light.position.set(0, height + 0.1, LEAF_Z + 0.085);
    const track = new THREE.Mesh(new THREE.BoxGeometry(reach * 2, 0.008, 0.05), steel);
    track.position.set(0, 0.004, LEAF_Z);

    // The card reader on the wall beside the door, clear of the open leaf.
    const reader = new THREE.Group();
    reader.position.set(-(reach + 0.4), 1.35, 0);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.36, 0.03), black);
    plate.position.z = 0.015;
    this.lockFace = this.#canvas(160, 240);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.3), new THREE.MeshBasicMaterial({ map: this.lockFace.tex, toneMapped: false }));
    face.position.z = 0.031;
    reader.add(plate, face);

    g.add(header, light, track, reader);
    this.root.add(g);
    this.door = 0;            // 0 closed … 1 open
    this.doorWait = 0;        // seconds until the leaves start moving
    this.passFor = 0;         // seconds the door stays open for someone walking through
  }

  /* --------------------------------------------------------------- state */

  /** Keep the climate ('climate') or the door lock ('lock') as shown until release(). */
  hold(kind) {
    this.held.add(kind);
  }

  release(kind) {
    this.held.delete(kind);
    if (this.env) this.apply(this.env);
  }

  /** What the AC shows (a climateKey), and whether the door shows locked. */
  get climateShown() { return this.climate ? climateKey(this.climate) : null; }
  get lockShown() { return this.locked; }

  /** Whether a change has finished playing out: 'door' done sliding, 'ac' displays done counting. */
  settled(kind) {
    if (kind === 'door') return this.doorWait <= 0 && this.door === (this.locked ? 0 : 1);
    if (kind === 'lights') {
      return Object.values(this.fixtures).every((f) => Math.abs(f.now.r - f.target.r) + Math.abs(f.now.g - f.target.g) + Math.abs(f.now.b - f.target.b) < 0.01);
    }
    return this.shownTemp === this.climate?.temp;
  }

  /** The light fixtures (uuids) whose setting in env differs from what the room shows (none before the first apply). */
  lightsChanged(env) {
    if (!this.shownLights) return [];
    return env.lights.filter((l) => this.fixtures[l.uuid] && this.shownLights[l.uuid] !== lightKey(env, l)).map((l) => l.uuid);
  }

  /** Open the door for a few seconds for someone walking through, locked or not (an exit sensor). */
  pass(seconds = 3) {
    this.passFor = seconds;
    this.doorWait = 0;
  }

  /** Take the Environment state. */
  apply(env) {
    if (!env) return;
    this.env = env;
    if (!this.held.has('lights')) {
      this.shownLights = {};
      for (const l of env.lights) {
        const f = this.fixtures[l.uuid];
        if (!f) continue;
        const group = l.name.replace(/\s*\d+\s*$/, '').trim() || l.name;
        const hex = (env.groupMode?.[group] ?? 'warm') === 'warm' ? WARM_WHITE_HEX : l.color;
        f.target.set(l.on && l.brightness > 0 ? hex : 0x000000).multiplyScalar(l.on ? l.brightness / 100 : 0);
        this.shownLights[l.uuid] = lightKey(env, l);
      }
    }
    if (!this.held.has('climate')) {
      const first = !this.climate;
      this.climate = { ...env.climate };
      if (first) {
        this.shownTemp = this.climate.temp;
        this.room = this.climate.power ? this.climate.temp + 1.5 : AMBIENT;
        this.airUniforms.uColor.value.set(modeColor(this.climate.mode));
      }
    }
    if (!this.held.has('lock')) this.#setLock(env.security.locked);
  }

  /**
   * Show the lock as `locked` now, even while it's held: the zone plays the press it held back
   * once the camera is on the door, even if the door has relocked itself since.
   */
  showLock(locked) {
    this.#setLock(locked);
  }

  #setLock(locked) {
    if (locked === this.locked) return;
    const first = this.locked === undefined;
    this.locked = locked;
    this.#drawLock(locked);
    this.doorLightMat.color.set(locked ? LOCK_COLOR.locked : LOCK_COLOR.open);
    if (!first) {
      if (this.root.visible) this.audio?.latch(!locked);
      if (!locked) this.doorWait = UNLATCH_S;
    }
  }

  identify(uuids) {
    for (const id of uuids) if (this.fixtures[id]) this.fixtures[id].flash = IDENTIFY_S;
  }

  /* ------------------------------------------------------------- drawing */

  #drawAc() {
    const c = this.climate;
    const { ctx, canvas, tex } = this.acUnit;
    const { width: w, height: h } = canvas;
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, w, h);
    if (c.power) {
      const col = modeColor(c.mode);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = col;
      ctx.font = `600 96px ${FONT}`;
      ctx.fillText(`${this.shownTemp}°`, w / 2 + 6, h / 2 + 6);
      // A small dot of the mode's colour on the left, like the unit's status light.
      ctx.beginPath();
      ctx.arc(26, h / 2, 7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(26, h / 2, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    tex.needsUpdate = true;
    this.acGlow.color.set(c.power ? modeColor(c.mode) : 0x000000).multiplyScalar(0.8);
  }

  #drawThermo() {
    const c = this.climate;
    const { ctx, canvas, tex } = this.thermo;
    const { width: w, height: h } = canvas;
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    const col = c.power ? modeColor(c.mode) : '#3f434b';
    // The dial: 16 °C to 30 °C round 270°, filled to the set temperature.
    const cx = 150, cy = 186, r = 118, a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
    ctx.lineCap = 'round';
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#1c1f25';
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + sweep);
    ctx.stroke();
    const k = Math.max(0, Math.min(1, (this.shownTemp - 16) / 14));
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + sweep * Math.max(0.02, k));
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = c.power ? '#ffffff' : '#6b7079';
    ctx.font = `700 92px ${FONT}`;
    ctx.fillText(`${this.shownTemp}°`, cx + 10, cy - 4);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(c.power ? 'SET' : 'OFF', cx, cy + 56);

    // The room's temperature, mode and fan on the right.
    const x = 318;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText('ROOM', x, 62);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 58px ${FONT}`;
    ctx.fillText(`${this.room.toFixed(1)}°`, x - 2, 112);
    if (c.power) {
      const label = String(c.mode).toUpperCase();
      ctx.font = `700 22px ${FONT}`;
      const pw = ctx.measureText(label).width + 30;
      ctx.fillStyle = `${col}33`;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, 160, pw, 40, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillText(label, x + 15, 181);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `600 20px ${FONT}`;
      ctx.fillText('FAN', x, 236);
      const bars = FAN_BARS[String(c.fanSpeed).toLowerCase()] ?? 2;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < bars ? '#ffffff' : '#2a2e36';
        ctx.fillRect(x + 54 + i * 18, 246 - (i + 1) * 9, 11, (i + 1) * 9 + 4);
      }
      // Cooling only in modes that cool, heating only in modes that heat; otherwise it holds.
      const gap = this.room - this.shownTemp, mode = String(c.mode).toLowerCase();
      const status = gap > 0.25 && ['cool', 'auto', 'dry'].includes(mode) ? 'Cooling…'
        : gap < -0.25 && ['heat', 'auto'].includes(mode) ? 'Heating…' : 'Holding';
      ctx.fillStyle = status === 'Holding' ? 'rgba(255,255,255,0.6)' : col;
      ctx.font = `600 22px ${FONT}`;
      ctx.fillText(status, x, 298);
    }
    tex.needsUpdate = true;
  }

  #drawLock(locked) {
    const { ctx, canvas, tex } = this.lockFace;
    const { width: w, height: h } = canvas;
    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, w, h);
    const col = locked ? LOCK_COLOR.locked : LOCK_COLOR.open;
    ctx.strokeStyle = col;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    // Shackle (open when unlocked) and body.
    ctx.beginPath();
    if (locked) ctx.arc(w / 2, 92, 26, Math.PI, 0);
    else ctx.arc(w / 2 + 26, 80, 26, Math.PI, Math.PI * 1.9);
    if (locked) { ctx.moveTo(w / 2 - 26, 92); ctx.lineTo(w / 2 - 26, 104); ctx.moveTo(w / 2 + 26, 92); ctx.lineTo(w / 2 + 26, 104); }
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(w / 2 - 40, 102, 80, 62, 10);
    ctx.fill();
    ctx.fillStyle = '#07080a';
    ctx.beginPath();
    ctx.arc(w / 2, 130, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(locked ? 'LOCKED' : 'UNLOCKED', w / 2, 204);
    tex.needsUpdate = true;
  }

  /* -------------------------------------------------------------- update */

  update(dt, t) {
    const k = 1 - Math.exp(-dt * 7);
    const out = new THREE.Color();
    for (const [uuid, f] of Object.entries(this.fixtures)) {
      f.now.lerp(f.target, k);
      out.copy(f.now);
      if (f.flash > 0) {
        f.flash -= dt;
        out.setRGB(1, 1, 1).multiplyScalar(Math.sin(t * Math.PI * 6) > 0 ? 1 : 0.05);
      }
      for (const { mat, level } of f.mats) mat.color.copy(out).multiplyScalar(level);
      f.out = (f.out ?? new THREE.Color()).copy(out);
    }
    // The one fabric panel shows the brighter of its two drivers (and either's Identify flash).
    const fa = this.fixtures['light-27'].out, fb = this.fixtures['light-28'].out;
    this.fabricMat.color.setRGB(Math.max(fa.r, fb.r), Math.max(fa.g, fb.g), Math.max(fa.b, fb.b)).multiplyScalar(this.fabricLevel ?? FABRIC_LEVEL);
    // The room's lights take the fabric's colour and level (the average of the two panels).
    const a = this.fixtures['light-27'].now, b = this.fixtures['light-28'].now;
    const avg = out.setRGB((a.r + b.r) / 2, (a.g + b.g) / 2, (a.b + b.b) / 2);
    const level = Math.max(avg.r, avg.g, avg.b);
    for (const { light, base } of this.roomLights) {
      light.intensity = base * ROOM_LIGHT * level;
      if (level > 0.001) light.color.copy(avg).multiplyScalar(1 / level);
    }
    if (this.roomGlow) {
      // Without the Identify flash (.now, not .out): a flash shows on its fixture, not the whole room.
      const s = this.fixtures['light-23'].now, base = this.glowBase;
      const rel = (fab, strip, at) => Math.min(1.3, (0.75 * fab + 0.25 * strip) / at);
      const glow = out.setRGB(rel((a.r + b.r) / 2, s.r, base.r), rel((a.g + b.g) / 2, s.g, base.g), rel((a.b + b.b) / 2, s.b, base.b));
      const key = glow.getHexString();
      if (key !== this.glowKey) { this.glowKey = key; this.roomGlow(glow); }
    }
    if (this.climate) this.#updateAc(dt, t);
    if (this.leaves) this.#updateDoor(dt);
  }

  #updateAc(dt, t) {
    const c = this.climate;
    // The displays count to the set temperature a degree at a time.
    this.tempClock = (this.tempClock ?? 0) + dt;
    if (this.shownTemp !== c.temp && this.tempClock >= TEMP_STEP_S) {
      this.tempClock = 0;
      this.shownTemp += Math.sign(c.temp - this.shownTemp);
    }
    // The room heads for the set temperature while the AC runs, and back to ambient when it's off.
    const goal = c.power && c.mode.toLowerCase() !== 'fan' ? c.temp : AMBIENT;
    const step = ROOM_RATE * dt * (c.power ? 1 : 0.3);
    this.room += Math.max(-step, Math.min(step, goal - this.room));
    const key = `${climateKey(c)}:${this.shownTemp}:${this.room.toFixed(1)}`;
    if (key !== this.acKey) { this.acKey = key; this.#drawAc(); this.#drawThermo(); }

    const u = this.airUniforms;
    u.uTime.value = t;
    u.uLevel.value += ((c.power ? 1 : 0) - u.uLevel.value) * Math.min(1, dt * 2.5);
    u.uColor.value.lerp(new THREE.Color(modeColor(c.mode)), Math.min(1, dt * 3));
    // The louvre opens and swings gently while it runs.
    const want = c.power ? 0.6 + 0.12 * Math.sin(t * 0.8) : 0;
    this.louvre.rotation.x += (want - this.louvre.rotation.x) * Math.min(1, dt * 3);
  }

  #updateDoor(dt) {
    if (this.passFor > 0) this.passFor -= dt;
    if (this.doorWait > 0) this.doorWait -= dt;
    else {
      const want = !this.locked || this.passFor > 0 ? 1 : 0;
      this.door += Math.max(-dt / SLIDE_S, Math.min(dt / SLIDE_S, want - this.door));
    }
    const s = smooth(this.door) * this.slide;
    for (const leaf of this.leaves) leaf.position.x = leaf.userData.side * (leaf.userData.base + s);
  }
}

/**
 * A sheet of air leaving an outlet: `width` across (x), reaching `length` out (z) while it
 * falls `drop` (y), bending down as it goes. UV v is 1 at the outlet.
 */
function airflowGeometry(width, length, drop, segments = 24) {
  const geo = new THREE.PlaneGeometry(width, 1, 1, segments);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const s = 0.5 - pos.getY(i);
    pos.setXYZ(i, pos.getX(i), -drop * Math.pow(s, 1.35), length * s);
  }
  geo.computeVertexNormals();
  return geo;
}
