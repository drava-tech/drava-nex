import * as THREE from 'three';
import { COLOR } from '../../config.js';
import { clamp, damp, lerp } from '../../util/tween.js';
import { FONT, canvasTexture, spacedText } from '../../util/textures.js';

// Sizes in metres. The table's own frame: origin in the middle of the glass (at floor level),
// x along its length, z toward the visitor. The disc tray stands beside its left end.
// The glass is the Orca Zone model's 75" touch surface (16:9) at 0.94 m.
export const TABLE = { w: 1.6604, d: 0.9339, top: 0.94 };
const R = 0.085;                                     // disc radius
const TRAY = { x: -TABLE.w / 2 - 0.28, w: 0.3, d: 0.98 };
const SLOTS = [-0.33, -0.11, 0.11, 0.33];            // where the discs rest on the tray (z); four at most
const GOLD = '#F2B544';                              // the visitor's colour: the zoom they set

// What the top view frames: the glass and the tray, filling 90 % of the screen.
export const VIEW = { minX: TRAY.x - TRAY.w / 2 - 0.04, maxX: TABLE.w / 2 + 0.04, minZ: -TABLE.d / 2 - 0.04, maxZ: TABLE.d / 2 + 0.04, fill: 0.9 };

// A disc's window is 20 % of the screen wide (when the view fills the screen's width), and touches the disc.
const BOX_W = (0.2 * (VIEW.maxX - VIEW.minX)) / VIEW.fill;
// A window's contents are laid out for a window 0.658 m wide (the first, larger table); on another
// table everything in it scales with the window, so it looks the same on screen.
const WIN_SCALE = BOX_W / 0.658;
const BOX_H = BOX_W * 0.68;
const GAP = 0.012;
// The zoom disc turns from -180° (0.5×) to +360° (4×); every half turn doubles the zoom.
const TURN = [-180, 360];
const zoomAt = (angle) => 2 ** (angle / 180);

// Pixels per metre: the glass carries only a grid; windows and the dial carry text.
const GLASS_PPM = 600;
const WIN_PPM = 1100;
const DIAL = { w: 0.8, h: 0.34, ppm: 1000 };

// How quickly things follow (per second; higher is snappier). Discs and the dial ease after
// the pointer instead of jumping to each pointer event, which arrive at uneven times.
const FOLLOW = 28, RETURN = 9, TURN_EASE = 18, OPEN = 9;

// Heights above the glass for each layer, so they never fight; the discs sit on top.
const LAYER = { hint: 0.0015, glow: 0.002, dial: 0.003, window: 0.004 };

/** A window's centre, moved just enough that the whole window (turned by cos, sin) stays on the glass. */
function onTable({ x, z }, cos, sin) {
  const ex = Math.abs(cos) * BOX_W / 2 + Math.abs(sin) * BOX_H / 2, ez = Math.abs(sin) * BOX_W / 2 + Math.abs(cos) * BOX_H / 2;
  const m = 0.02;
  return { x: clamp(x, -TABLE.w / 2 + ex + m, TABLE.w / 2 - ex - m), z: clamp(z, -TABLE.d / 2 + ez + m, TABLE.d / 2 - ez - m) };
}

const onGlass = (x, z) => Math.abs(x) < TABLE.w / 2 - R * 0.3 && Math.abs(z) < TABLE.d / 2 - R * 0.3;
const wrapDeg = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

/** A flat, unlit, see-through plane lying on the glass. */
function flat(w, h, map, order, additive = false) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }),
  );
  m.renderOrder = order;
  return m;
}

/**
 * A tangible table: a touch table that recognises the discs placed on it.
 *  - The discs wait on a tray beside the table. Drag one onto the glass and its window
 *    opens right beside it (20 % of the screen); lift it off and the window closes.
 *  - Any disc on the glass turns: drag its outer ring, or scroll over it. A content disc's
 *    window turns with it, like a panel fixed to its side.
 *  - The zoom disc opens no window. Turn it and every open window zooms in or out; its
 *    angle and the zoom are shown beside it. Scrolling over empty glass turns it too.
 *
 * The zone feeds it pointer positions on the glass, in the table's frame (toLocal()):
 * down(p) → move(p) → up(), and wheel(p, dy). onPlace(disc) is called when a disc is put on the glass.
 *
 * Every layer is its own mesh that follows its disc, so moving a disc redraws nothing; a
 * window's canvas is redrawn only while the zoom changes, and the dial's only while it turns.
 */
export class TangibleTable {
  /** body: false leaves out the table itself (base and slab) for a room that has its own. */
  constructor({ discs, idle, body = true }) {
    this.drag = null;
    this.onPlace = null;

    const g = (this.group = new THREE.Group());
    const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.5, metalness: 0.6 });
    const line = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLOR.warmWhite).multiplyScalar(0.9) });
    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };

    const frame = [];
    if (body) {
      frame.push(box(TABLE.w - 0.5, TABLE.top - 0.06, TABLE.d - 0.5, dark, 0, (TABLE.top - 0.06) / 2, 0));
      frame.push(box(TABLE.w + 0.06, 0.06, TABLE.d + 0.06, dark, 0, TABLE.top - 0.03, 0));
      for (const z of [-1, 1]) box(TABLE.w, 0.008, 0.008, line, 0, TABLE.top - 0.065, z * (TABLE.d / 2 - 0.02));
    }
    const glassTex = canvasTexture(Math.round(TABLE.w * GLASS_PPM), Math.round(TABLE.d * GLASS_PPM), drawGlass).texture;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.w, TABLE.d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glassTex, color: new THREE.Color(0.85, 0.85, 0.85) }));
    glass.position.y = TABLE.top + 0.0012;
    g.add(glass);

    // "Place a disc on the table", fading out once a disc is down.
    this.hint = flat(Math.min(1.2, TABLE.w * 0.8), 0.08 * Math.min(1, TABLE.w * 0.8 / 1.2), canvasTexture(1200, 80, (ctx, w, h) => {
      ctx.fillStyle = '#FBFAF5';
      ctx.font = `500 ${h * 0.42}px ${FONT.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      spacedText(ctx, idle.toUpperCase(), w / 2, h / 2, 9);
    }).texture, 1);
    this.hint.position.y = TABLE.top + LAYER.hint;
    g.add(this.hint);

    const tray = box(TRAY.w, TABLE.top, TRAY.d, dark, TRAY.x, TABLE.top / 2, 0);
    for (const z of SLOTS) {
      const slot = new THREE.Mesh(new THREE.RingGeometry(R + 0.008, R + 0.016, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.3 }));
      slot.position.set(TRAY.x, TABLE.top + 0.001, z);
      g.add(slot);
    }
    this.hitTargets = [glass, ...frame, tray];

    const glowTex = canvasTexture(128, 128, (ctx, w) => {
      const grad = ctx.createRadialGradient(w / 2, w / 2, w * 0.2, w / 2, w / 2, w / 2);
      grad.addColorStop(0, 'rgba(255,255,255,0.28)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, w);
    }).texture;

    this.discs = discs.slice(0, SLOTS.length).map((def, i) => {
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.028, 48), new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.4, metalness: 0.6 }));
      const face = new THREE.Mesh(new THREE.CircleGeometry(R * 0.97, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: discFace(def).texture }));
      face.position.y = 0.0145;
      mesh.add(body, face);
      const glow = flat(R * 3.2, R * 3.2, glowTex, 2, true);
      glow.material.color.set(def.color);
      g.add(mesh, glow);
      const home = { x: TRAY.x, z: SLOTS[i] };
      const d = {
        ...def, home, mesh, glow,
        x: home.x, z: home.z, tx: home.x, tz: home.z,        // where it is, and where it is heading
        angle: 0, angleTo: 0, on: false, back: false, open: 0, lift: 0, side: 1, sideTo: 1,
      };
      if (def.kind === 'content') {
        d.win = new DiscWindow(def);
        g.add(d.win.mesh);
      }
      return d;
    });
    this.zoomDisc = this.discs.find((d) => d.kind === 'zoom');
    if (this.zoomDisc) {
      this.dial = canvasTexture(Math.round(DIAL.w * DIAL.ppm), Math.round(DIAL.h * DIAL.ppm));
      this.dialMesh = flat(DIAL.w, DIAL.h, this.dial.texture, 3);
      g.add(this.dialMesh);
      this.dialKey = null;
    }
  }

  /** Zoom of the open windows: set by the zoom disc while it is on the glass. */
  get zoom() {
    return this.zoomDisc?.on ? zoomAt(this.zoomDisc.angle) : 1;
  }

  toLocal(world) {
    const p = this.group.worldToLocal(world.clone());
    return { x: p.x, z: p.z };
  }

  /** The disc under p, and whether grabbing it there moves it (its middle) or turns it (its outer ring, on the glass). */
  pick(p) {
    for (const d of [...this.discs].reverse()) {
      const r = Math.hypot(p.x - d.x, p.z - d.z);
      if (d.on && r > R * 0.6 && r < R * 1.6) return { d, mode: 'turn' };
      if (r < R * 1.05) return { d, mode: 'move' };
    }
    return null;
  }

  down(p) {
    const hit = this.pick(p);
    if (!hit) return false;
    const { d, mode } = hit;
    if (d.back) { d.back = false; d.tx = d.x; d.tz = d.z; }   // caught on its way back to the tray
    this.drag = { d, mode, was: d.on, dx: d.tx - p.x, dz: d.tz - p.z, bearing: bearing(d, p) };
    return true;
  }

  move(p) {
    const g = this.drag;
    if (!g) return;
    if (g.mode === 'move') {
      g.d.tx = clamp(p.x + g.dx, VIEW.minX, VIEW.maxX);
      g.d.tz = clamp(p.z + g.dz, VIEW.minZ, VIEW.maxZ);
    } else {
      const b = bearing(g.d, p);
      this.#turn(g.d, wrapDeg(b - g.bearing));
      g.bearing = b;
    }
  }

  up() {
    const g = this.drag;
    if (!g) return;
    this.drag = null;
    if (g.mode !== 'move') return;
    const d = g.d;
    if (!onGlass(d.tx, d.tz)) {                               // dropped off the glass: back to its place on the tray
      d.back = true;
      d.tx = d.home.x;
      d.tz = d.home.z;
    } else if (!g.was) this.onPlace?.(d);
  }

  /** Scrolling turns the disc under the pointer, or the zoom disc over empty glass. */
  wheel(p, dy) {
    const under = p && this.pick(p)?.d;
    const d = under?.on ? under : this.zoomDisc?.on ? this.zoomDisc : null;
    if (d) this.#turn(d, -dy * 0.2);
  }

  /** The zoom disc turns between its limits; content discs turn freely. */
  #turn(d, deg) {
    d.angleTo = d === this.zoomDisc ? clamp(d.angleTo + deg, TURN[0], TURN[1]) : d.angleTo + deg;
  }

  update(dt) {
    const top = TABLE.top;
    for (const d of this.discs) {
      const held = this.drag?.d === d;
      const k = d.back ? RETURN : FOLLOW;
      d.x = damp(d.x, d.tx, k, dt);
      d.z = damp(d.z, d.tz, k, dt);
      if (d.back && Math.hypot(d.x - d.tx, d.z - d.tz) < 0.002) d.back = false;
      d.angle = damp(d.angle, d.angleTo, TURN_EASE, dt);
      d.on = !d.back && onGlass(d.x, d.z);
      d.open = damp(d.open, d.on ? 1 : 0, OPEN, dt);
      d.lift = damp(d.lift, held ? 1 : 0, 12, dt);

      d.mesh.position.set(d.x, top + 0.014 + d.lift * 0.03, d.z);
      d.mesh.rotation.y = -THREE.MathUtils.degToRad(d.angle);  // clockwise seen from above
      d.glow.position.set(d.x, top + LAYER.glow, d.z);
      d.glow.material.opacity = d.open;
      if (d.win) this.#placeWindow(d, dt);
    }
    if (this.zoomDisc) this.#placeDial(this.zoomDisc);
    const empty = !this.discs.some((d) => d.on);
    this.hint.material.opacity = damp(this.hint.material.opacity, empty ? 0.5 : 0, 6, dt);
  }

  /**
   * The window grows out of the disc and is fixed to its side, touching it, so it turns with
   * the disc. It sits on one side (right at 0°); where the glass ends it is pushed back onto
   * the glass, and if that would push it well clear of the disc it moves to the other side
   * (with a little slack, so it doesn't flick back and forth).
   */
  #placeWindow(d, dt) {
    const a = THREE.MathUtils.degToRad(d.angle), cos = Math.cos(a), sin = Math.sin(a);
    const dist = R + GAP + BOX_W / 2;
    const ideal = (side) => ({ x: d.x + side * dist * cos, z: d.z + side * dist * sin });
    const shift = (side) => { const i = ideal(side), c = onTable(i, cos, sin); return Math.hypot(c.x - i.x, c.z - i.z); };
    if (shift(d.sideTo) > 0.06 && shift(-d.sideTo) < shift(d.sideTo) - 0.03) d.sideTo = -d.sideTo;
    d.side = damp(d.side, d.sideTo, 10, dt);
    const f = onTable(ideal(d.side), cos, sin);
    const e = d.open, m = d.win.mesh;
    m.visible = e > 0.002;
    if (!m.visible) return;
    m.position.set(lerp(d.x, f.x, e), TABLE.top + LAYER.window, lerp(d.z, f.z, e));
    m.rotation.y = -a;                                        // clockwise with the disc
    m.scale.setScalar(Math.max(e, 0.01));
    m.material.opacity = e;
    d.win.draw(this.zoom);
  }

  /** The zoom disc's gauge round it, and its angle and zoom beside it; redrawn only when they change. */
  #placeDial(d) {
    const m = this.dialMesh;
    m.visible = d.open > 0.002;
    if (!m.visible) return;
    m.position.set(d.x, TABLE.top + LAYER.dial, d.z);
    m.material.opacity = d.open;
    const right = d.x + DIAL.w / 2 < TABLE.w / 2;
    const key = `${d.angle.toFixed(1)}|${right}`;
    if (key === this.dialKey) return;
    this.dialKey = key;
    const zoom = zoomAt(d.angle);
    this.dial.redraw((ctx, w, h) => {
      const p = (v) => v * DIAL.ppm, cx = w / 2, cy = h / 2, rr = p(R + 0.03);
      ctx.lineWidth = p(0.008);
      ctx.strokeStyle = 'rgba(251,250,245,0.15)';
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
      if (Math.abs(d.angle) > 0.05) {
        const a0 = -Math.PI / 2;
        ctx.strokeStyle = GOLD;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, a0, a0 + THREE.MathUtils.degToRad(d.angle), d.angle < 0);
        ctx.stroke();
      }
      const tx = right ? cx + rr + p(0.03) : cx - rr - p(0.03);
      ctx.textAlign = right ? 'left' : 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(251,250,245,0.6)';
      ctx.font = `500 ${p(0.016)}px ${FONT.mono}`;
      spacedText(ctx, 'ZOOM', tx, cy - p(0.03), p(0.004));
      ctx.fillStyle = '#EEF0F3';
      ctx.font = `700 ${p(0.04)}px ${FONT.display}`;
      const deg = Math.round(d.angle);
      ctx.fillText(`${deg > 0 ? '+' : ''}${deg}°`, tx, cy + p(0.015));
      ctx.fillStyle = GOLD;
      ctx.font = `500 ${p(0.022)}px ${FONT.mono}`;
      ctx.fillText(`${zoom.toFixed(2)}×`, tx, cy + p(0.05));
    });
  }
}

/**
 * A disc's window: its own canvas on a plane. The dot field is drawn once, twice as wide
 * and tall as the window (so zooming out to 0.5× still fills it); a redraw while zooming is
 * then one image and four pins.
 */
class DiscWindow {
  constructor(def) {
    this.def = def;
    this.zoom = null;
    this.canvas = canvasTexture(Math.round(BOX_W * WIN_PPM), Math.round(BOX_H * WIN_PPM));
    this.mesh = flat(BOX_W, BOX_H, this.canvas.texture, 4);
    this.mesh.visible = false;
    const m = (v) => v * WIN_PPM * WIN_SCALE, w = this.canvas.canvas.width, h = this.canvas.canvas.height, pad = m(0.022);
    this.art = { x: pad, y: m(0.1), w: w - pad * 2, h: h - m(0.1) - m(0.058) };
    this.dots = dotField(this.art.w, this.art.h, m(0.012), 1.5);
  }

  draw(zoom) {
    if (Math.abs(zoom - (this.zoom ?? -1)) < 1e-4) return;
    this.zoom = zoom;
    const { def, art, dots } = this;
    const m = (v) => v * WIN_PPM * WIN_SCALE;
    this.canvas.redraw((ctx, w, h) => {
      const pad = m(0.022);
      ctx.fillStyle = 'rgba(9,12,17,0.95)';
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(1.5, 1.5, w - 3, h - 3, m(0.012));
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = def.color;
      ctx.font = `500 ${m(0.017)}px ${FONT.mono}`;
      spacedText(ctx, def.name.toUpperCase(), pad, m(0.04), m(0.004));
      ctx.fillStyle = '#EEF0F3';
      ctx.font = `700 ${m(0.032)}px ${FONT.display}`;
      ctx.fillText(def.card.title, pad, m(0.082));

      // The content area: this is what the zoom disc zooms.
      ctx.save();
      ctx.beginPath();
      ctx.rect(art.x, art.y, art.w, art.h);
      ctx.clip();
      ctx.fillStyle = '#0B0F15';
      ctx.fillRect(art.x, art.y, art.w, art.h);
      ctx.translate(art.x + art.w / 2, art.y + art.h / 2);
      ctx.scale(zoom, zoom);
      ctx.drawImage(dots, -art.w, -art.h, art.w * 2, art.h * 2);
      drawPins(ctx, art.w, art.h, def.card.pins, def.color, m);
      ctx.restore();
      if (zoom !== 1) {
        ctx.fillStyle = 'rgba(251,250,245,0.7)';
        ctx.font = `500 ${m(0.015)}px ${FONT.mono}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${zoom.toFixed(2)}×`, art.x + art.w - m(0.01), art.y + m(0.025));
        ctx.textAlign = 'left';
      }

      ctx.fillStyle = '#B9C0CC';
      ctx.font = `400 ${m(0.021)}px ${FONT.body}`;
      wrapText(ctx, def.card.body, pad, h - m(0.024), w - pad * 2, m(0.026), 1);
    });
  }
}

/** The glass itself: a faint 10 cm grid inside a border. Drawn once. */
function drawGlass(ctx, w, h) {
  const m = (v) => v * GLASS_PPM;
  ctx.fillStyle = '#05070A';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(251,250,245,0.06)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = m(0.1); x < w; x += m(0.1)) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = m(0.1); y < h; y += m(0.1)) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(251,250,245,0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(m(0.02), m(0.02), w - m(0.04), h - m(0.04));
}

/** Clockwise angle (degrees) from "up" on the glass (away from the visitor) to p, seen from the disc. */
function bearing(d, p) {
  return THREE.MathUtils.radToDeg(Math.atan2(p.x - d.x, -(p.z - d.z)));
}

/** A field of dots covering twice aw × ah round the middle, drawn once at `scale` × resolution. */
function dotField(aw, ah, step, scale) {
  const c = document.createElement('canvas');
  c.width = Math.round(aw * 2 * scale);
  c.height = Math.round(ah * 2 * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.translate(aw, ah);
  for (let x = -aw; x <= aw; x += step) {
    for (let y = -ah; y <= ah; y += step) {
      const land = Math.sin(x * 0.011) + Math.cos(y * 0.016 + x * 0.004) > 0.2;
      ctx.fillStyle = land ? 'rgba(251,250,245,0.22)' : 'rgba(251,250,245,0.06)';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  }
  return c;
}

/** Labelled pins on a disc's content, round (0, 0); x and y from -1 to 1. */
function drawPins(ctx, aw, ah, pins, color, m) {
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${m(0.016)}px ${FONT.body}`;
  for (const [px, py, label] of pins) {
    const x = px * aw * 0.42, y = py * ah * 0.4;
    ctx.strokeStyle = `${color}88`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, m(0.012), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, m(0.005), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#EEF0F3';
    ctx.textAlign = px > 0 ? 'right' : 'left';               // labels point inward, so they stay in the window
    ctx.fillText(label, x + (px > 0 ? -m(0.018) : m(0.018)), y);
  }
}

/** The printed top of a disc: its colour, its name and a notch that shows which way it is turned. */
function discFace(def) {
  return canvasTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = '#12151B';
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(c, c, c - 8, 0, Math.PI * 2);
    ctx.stroke();
    if (def.kind === 'zoom') {
      ctx.lineWidth = 3;
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2, r0 = i % 9 ? c - 30 : c - 42;
        ctx.beginPath();
        ctx.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0);
        ctx.lineTo(c + Math.sin(a) * (c - 18), c - Math.cos(a) * (c - 18));
        ctx.stroke();
      }
    }
    ctx.fillStyle = def.color;
    ctx.beginPath();                                          // the notch, pointing "up" at 0°
    ctx.moveTo(c, 20);
    ctx.lineTo(c - 14, 44);
    ctx.lineTo(c + 14, 44);
    ctx.fill();
    ctx.fillStyle = '#EEF0F3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${def.name.length > 8 ? 26 : 32}px ${FONT.mono}`;
    ctx.fillText(def.name.toUpperCase(), c, c + 6);
  });
}

/** Wrap text into at most maxLines lines of maxW pixels; returns the y after the last line. */
function wrapText(ctx, text, x, y, maxW, lineH, maxLines = 4) {
  const words = text.split(' ');
  let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      if (++n === maxLines) { ctx.fillText(`${line}…`, x, y); return y + lineH; }
      ctx.fillText(line, x, y);
      y += lineH;
      line = words[i];
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lineH; }
  return y;
}
