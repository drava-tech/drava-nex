import * as THREE from 'three';
import { damp } from '../../util/tween.js';
import { FONT, canvasTexture, spacedText } from '../../util/textures.js';
import { KIOSK, SHOES as AT, WALL_Z, screenTexture } from './room.js';

// Where a recognised shoe goes, by how it was recognised. pressure (lifted off its pad) and chosen
// (on the kiosk): out of the niche toward the visitor, larger, turning slowly. lidar (no touch): it
// stays in its niche and turns there, a little forward. rfid: carried to the reader (READER).
// EASE: how quickly it follows (per second).
const POSE = {
  pressure: { out: 0.62, up: 0.06, scale: 1.45 },
  chosen: { out: 0.62, up: 0.06, scale: 1.45 },
  lidar: { out: 0.14, up: 0.02, scale: 1.12 },
};
const SPIN = 0.55;
const EASE = 4;
// The RFID reader: a slim plinth in front of the wall, under the middle column of niches (low
// enough that the bottom row shows over it from the stop). top: its reading pad's height.
export const READER = { x: AT[1].x, z: -3.35, top: 0.86, w: 0.46 };
// The LiDAR sensing plane in front of the niches (world), shown as a grid of light, and the sensor
// above it. DWELL: seconds a reach is held before it counts.
const GRID = { x0: -5.9, x1: -1.7, y0: 0.82, y1: 3.08, z: -3.98, cell: 0.2, ppm: 300 };
const DWELL = 0.7;
// The kiosk stands beside the wall, not in front of it (the model has it in front, where it hid
// the bottom row of shoes from the visitor): left of the niches, turned toward the product wall's
// stop. Its head (screen, bezel, housing) is raised from the model's 50° to `tilt` above horizontal,
// hinged at the housing's bottom front edge (`hinge`, in the kiosk's own frame: up and toward the
// visitor from its footprint) so it rises clear of the pedestal; the screen then faces a standing
// visitor and reads from the stop.
export const KIOSK_AT = { x: -6.1, z: -2.6, rotY: 0.51, tilt: THREE.MathUtils.degToRad(70), hinge: { y: 0.885, z: 0.291 } };
const HALO = { rest: 1, lit: 3.2 };       // the niche's LED ring: as baked, and lit for the shoe on show

// The kiosk's screen, in canvas pixels (16:9). Everything on it is laid out here, and a tap on
// the screen (its UV) is matched against the same rectangles.
const W = 1600, H = 900;
const CARD = { x0: 60, y0: 266, w: 470, h: 240, gx: 30, gy: 32 };
const cardRect = (i) => ({ x: CARD.x0 + (i % 3) * (CARD.w + CARD.gx), y: CARD.y0 + Math.floor(i / 3) * (CARD.h + CARD.gy), w: CARD.w, h: CARD.h });
const BACK = { x: 60, y: 46, w: 300, h: 64 };
const PUT = { x: 1190, y: 790, w: 350, h: 74 };
const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** A shoe in profile, as the kiosk draws it: upper, sole and swoosh, `w` wide with its sole at y. */
function drawShoe(ctx, x, y, w, hex, swoosh) {
  const k = w / 330;
  const P = (px, py) => [x + px * k, y + py * k];
  ctx.fillStyle = hex;
  ctx.beginPath();
  for (const [i, [px, py]] of [[0, -6], [0, -102], [32, -116], [62, -98], [90, -112], [140, -62], [190, -50], [308, -30], [326, -8], [326, -2], [0, -2]].entries()) {
    const [a, b] = P(px, py);
    if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#E3E1D8';
  const [sx, sy] = P(-2, -8);
  ctx.beginPath();
  ctx.roundRect(sx, sy, 330 * k, 18 * k, 9 * k);
  ctx.fill();
  ctx.fillStyle = swoosh;
  ctx.beginPath();
  ctx.moveTo(...P(72, -66));
  ctx.lineTo(...P(92, -40));
  ctx.lineTo(...P(222, -62));
  ctx.lineTo(...P(96, -50));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,205,210,0.7)';
  ctx.lineWidth = 7 * k;
  ctx.beginPath();
  ctx.moveTo(...P(112, -88));
  ctx.lineTo(...P(176, -66));
  ctx.stroke();
}

/**
 * The product wall: six shoes in lit niches, and the kiosk in front of them. A shoe is lifted
 * (lift(i)): it comes out of its niche toward the visitor, larger, turning slowly, its niche ring
 * lit; the kiosk opens it. Only one is out at a time; drop() puts it back.
 *
 * attach(model) takes the shoes, rings and kiosk screen from the loaded model. The kiosk is
 * drawn here (draw()) and tapped through tap(u, v): it returns { pick: i }, { back: true } or
 * { put: true }, or null.
 */
export class ProductWall {
  constructor(words, { reader = 'RFID READER' } = {}) {
    this.words = words;
    this.shoes = [];            // { pivot, meshes, halo, k, home, pose }
    this.hitTargets = [];       // the shoes' meshes (filled by attach)
    this.lifted = null;         // index of the shoe recognised
    this.how = null;            // 'pressure' | 'lidar' | 'rfid' | 'chosen'
    this.page = 'home';         // the kiosk: 'home' | 'detail'
    this.mode = 'pressure';     // the method on the switch
    this.hovered = null;        // LiDAR: the shoe being reached for, and for how long
    this.dwell = 0;
    this.onDwell = null;        // LiDAR: called with i once a reach has been held DWELL seconds
    this.reading = null;        // RFID: the shoe on its way to the reader (its tag isn't read until it lands)
    this.onRead = null;         // RFID: called with i once it has landed and its tag is read
    this.screen = canvasTexture(W, H);
    this.group = new THREE.Group();
    this.#buildReader(reader);
    this.#buildGrid();
    this.setMode('pressure');
    this.draw();
  }

  /** The RFID reader on its plinth, with its pad lit; shown in RFID mode. */
  #buildReader(label) {
    const g = (this.reader = new THREE.Group());
    g.position.set(READER.x, 0, READER.z);
    const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.5, metalness: 0.5 });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(READER.w, READER.top, READER.w), dark);
    plinth.position.y = READER.top / 2;
    this.padMat = new THREE.MeshBasicMaterial({ color: 0x5cc8e0, transparent: true, opacity: 0.5, toneMapped: false });
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.17, 48).rotateX(-Math.PI / 2), this.padMat);
    pad.position.y = READER.top + 0.002;
    const face = canvasTexture(512, 96, (ctx, w, h) => {
      ctx.fillStyle = '#0b0e12';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#5CC8E0';
      ctx.font = `600 40px ${FONT.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      spacedText(ctx, label, w / 2, h / 2, 6);
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(READER.w * 0.8, READER.w * 0.15), new THREE.MeshBasicMaterial({ map: face.texture, toneMapped: false }));
    plate.position.set(0, READER.top - 0.12, READER.w / 2 + 0.002);
    g.add(plinth, pad, plate);
    this.group.add(g);
  }

  /** The LiDAR sensing plane as a grid of light in front of the niches, and its sensor; shown in LiDAR mode. */
  #buildGrid() {
    const w = GRID.x1 - GRID.x0, h = GRID.y1 - GRID.y0;
    this.grid = canvasTexture(Math.round(w * GRID.ppm), Math.round(h * GRID.ppm));
    this.gridMat = new THREE.MeshBasicMaterial({ map: this.grid.texture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.gridMat);
    plane.position.set((GRID.x0 + GRID.x1) / 2, (GRID.y0 + GRID.y1) / 2, GRID.z);
    plane.raycast = () => {};
    const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.1), new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.5, metalness: 0.5 }));
    sensor.position.set((GRID.x0 + GRID.x1) / 2, GRID.y1 + 0.05, GRID.z - 0.02);
    this.lidar = new THREE.Group();
    this.lidar.add(plane, sensor);
    this.group.add(this.lidar);
    this.gridKey = null;
    this.#drawGrid();
  }

  /** The grid; the cells round the shoe being reached for glow, with the reach's progress round its niche. */
  #drawGrid() {
    const key = `${this.hovered}|${Math.round(this.dwell * 20)}|${this.lifted}|${this.how}`;
    if (key === this.gridKey) return;
    this.gridKey = key;
    const m = GRID.ppm, X = (x) => (x - GRID.x0) * m, Y = (y) => (GRID.y1 - y) * m;
    this.grid.redraw((ctx, w, h) => {
      ctx.strokeStyle = 'rgba(92,200,224,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= w + 1; x += GRID.cell * m) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0; y <= h + 1; y += GRID.cell * m) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      const lit = this.hovered ?? (this.how === 'lidar' ? this.lifted : null);
      if (lit === null) return;
      const at = AT[lit], cx = X(at.x), cy = Y(at.y), r = 0.46 * m;
      ctx.fillStyle = 'rgba(242,181,68,0.16)';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.strokeStyle = '#F2B544';
      ctx.lineWidth = 6;
      ctx.beginPath();
      const k = this.hovered !== null ? Math.min(1, this.dwell / DWELL) : 1;
      ctx.arc(cx, cy, r * 0.95, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      ctx.stroke();
    });
  }

  /** The method on the switch: shows its hardware (the reader, the LiDAR grid) and puts a recognised shoe back. */
  setMode(mode) {
    this.mode = mode;
    this.reader.visible = mode === 'rfid';
    this.lidarOn = mode === 'lidar';
    this.hover(null);
    if (this.lifted !== null && this.how !== 'chosen') this.drop();
  }

  /** LiDAR: the shoe the visitor is reaching toward (null: none). */
  hover(i) {
    if (i === this.hovered) return;
    this.hovered = i;
    this.dwell = 0;
  }

  /** Where the kiosk's screen is now and which way it faces (world): for the camera to square up to it. */
  kioskFrame() {
    const s = KIOSK.screen;
    if (!this.kioskMesh || !this.kioskPivot) {
      return { centre: new THREE.Vector3(s.x, s.y, s.z), normal: new THREE.Vector3(0, Math.cos(s.tilt), Math.sin(s.tilt)) };
    }
    // The screen's middle, wherever the moved and tilted kiosk has put it.
    const m = this.kioskMesh;
    m.updateWorldMatrix(true, false);
    m.geometry.computeBoundingBox();
    const centre = m.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld);
    const normal = new THREE.Vector3(0, Math.cos(KIOSK_AT.tilt), Math.sin(KIOSK_AT.tilt)).applyAxisAngle(new THREE.Vector3(0, 1, 0), KIOSK_AT.rotY);
    return { centre, normal };
  }

  attach(model) {
    AT.forEach((at, i) => {
      const n = at.n;
      const meshes = ['Upper', 'Sole', 'Swoosh'].map((p) => model.getObjectByName(`Nike_Shoe_${n}_${p}`)).filter(Boolean);
      // A pivot at the shoe's centre, so it can come forward, grow and turn about itself.
      const box = new THREE.Box3();
      for (const m of meshes) box.expandByObject(m);
      const centre = box.getCenter(new THREE.Vector3());
      const pivot = new THREE.Group();
      pivot.position.copy(centre);
      model.add(pivot);
      pivot.updateMatrixWorld(true);
      for (const m of meshes) pivot.attach(m);
      const halo = model.getObjectByName(`Product_Niche_${n}_Halo`);
      // Each niche's ring has its own material, so it can light alone.
      if (halo) { halo.material = halo.material.clone(); halo.userData.full = halo.material.emissiveIntensity ?? 1; }
      this.shoes.push({ pivot, meshes, halo, k: 0, home: centre.clone() });
      this.hitTargets.push(...meshes);
    });
    const kiosk = model.getObjectByName('Kiosk_Screen_55in_50deg');
    if (kiosk) { screenTexture(kiosk, this.screen.texture); this.kioskMesh = kiosk; }
    // The kiosk moves beside the wall (KIOSK_AT): all its parts on one pivot at its footprint.
    const pivot = new THREE.Group();
    pivot.position.set(KIOSK.x, 0, KIOSK.z);
    model.add(pivot);
    pivot.updateMatrixWorld(true);
    for (const n of ['Kiosk_Base', 'Kiosk_Pedestal_Shell', 'Kiosk_Pedestal_Front', 'Kiosk_Neck', 'Kiosk_55in_Housing', 'Kiosk_Screen_Bezel', 'Kiosk_Screen_55in_50deg', 'Kiosk_Service_Slot', 'Kiosk_Red_Status_Line']) {
      const m = model.getObjectByName(n);
      if (m) pivot.attach(m);
    }
    // The head turns on its hinge (x along the screen): from 50° to KIOSK_AT.tilt.
    const sc = KIOSK.screen;
    const head = new THREE.Group();
    head.position.set(0, KIOSK_AT.hinge.y, KIOSK_AT.hinge.z);
    pivot.add(head);
    pivot.updateMatrixWorld(true);
    for (const n of ['Kiosk_55in_Housing', 'Kiosk_Screen_Bezel', 'Kiosk_Screen_55in_50deg']) {
      const m = model.getObjectByName(n);
      if (m) head.attach(m);
    }
    head.rotation.x = KIOSK_AT.tilt - sc.tilt;
    pivot.position.set(KIOSK_AT.x, 0, KIOSK_AT.z);
    pivot.rotation.y = KIOSK_AT.rotY;
    this.kioskPivot = pivot;
  }

  /** Recognise shoe i; how: 'pressure', 'lidar', 'rfid' (the method on the switch) or 'chosen' (on the kiosk). */
  lift(i, how) {
    this.lifted = i;
    this.how = how;
    if (this.shoes[i]) this.shoes[i].pose = how;
    // RFID: the reader only reads the tag once the shoe sits on it, so the kiosk waits (update()).
    this.reading = how === 'rfid' ? i : null;
    this.page = this.reading === null ? 'detail' : 'home';
    this.draw();
  }

  /** Put the lifted shoe back; the kiosk returns to every colourway. */
  drop() {
    this.lifted = null;
    this.how = null;
    this.reading = null;
    this.page = 'home';
    this.draw();
  }

  /** Where a recognised shoe is shown (world): for the camera to look at. */
  showcase(i) {
    const s = AT[i];
    return new THREE.Vector3(s.x, s.y + POSE.chosen.up, WALL_Z + POSE.chosen.out + 0.2);
  }

  /** A tap on the kiosk at (u, v), its UV (v = 0 at the top). */
  tap(u, v) {
    const x = u * W, y = v * H;
    if (this.page === 'home') {
      for (let i = 0; i < 6; i++) if (inside(cardRect(i), x, y)) return { pick: i };
      return null;
    }
    if (inside(BACK, x, y)) return { back: true };
    if (inside(PUT, x, y)) return { put: true };
    return null;
  }

  /** Whether (u, v) on the kiosk is over something to tap (for the pointer). */
  over(u, v) {
    return !!this.tap(u, v);
  }

  draw() {
    this.screen.redraw((ctx) => (this.page === 'detail' && this.lifted !== null ? this.#detail(ctx, this.lifted) : this.#home(ctx)));
  }

  #home(ctx) {
    const w = this.words;
    ctx.fillStyle = '#081016';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 54px ${FONT.body}`;
    ctx.fillText(w.brand, 60, 90);
    ctx.font = `700 64px ${FONT.body}`;
    ctx.fillText(w.title, 60, 180);
    ctx.fillStyle = '#8FA3AE';
    ctx.font = `400 26px ${FONT.body}`;
    ctx.fillText(w.sub, 62, 226);
    ctx.font = `500 19px ${FONT.mono}`;
    ctx.textAlign = 'right';
    spacedText(ctx, w.explorer, 1540, 72, 2);
    ctx.textAlign = 'left';
    w.items.forEach((s, i) => {
      const r = cardRect(i);
      ctx.fillStyle = '#14212A';
      ctx.strokeStyle = 'rgba(143,163,174,0.28)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#8FA3AE';
      ctx.font = `500 18px ${FONT.mono}`;
      ctx.fillText(String(i + 1).padStart(2, '0'), r.x + 24, r.y + 36);
      drawShoe(ctx, r.x + 60, r.y + 186, 326, s.hex, s.swoosh);
      ctx.fillStyle = '#E6ECEF';
      ctx.font = `700 19px ${FONT.body}`;
      spacedText(ctx, s.colour.toUpperCase(), r.x + 24, r.y + 220, 1.5);
    });
    ctx.fillStyle = '#FF6A55';
    ctx.font = `700 20px ${FONT.body}`;
    spacedText(ctx, w.start, 62, 856, 1.5);
    ctx.fillStyle = '#8FA3AE';
    ctx.font = `500 18px ${FONT.mono}`;
    ctx.textAlign = 'right';
    spacedText(ctx, w.footer, 1540, 856, 2);
    ctx.textAlign = 'left';
  }

  #detail(ctx, i) {
    const w = this.words, s = w.items[i], n = AT[i].n;
    ctx.fillStyle = '#081016';
    ctx.fillRect(0, 0, W, H);
    // The picture: the colourway on a soft panel of its own colour.
    const panel = ctx.createLinearGradient(0, 140, 0, 860);
    panel.addColorStop(0, `${s.hex}55`);
    panel.addColorStop(1, '#0D161C');
    ctx.fillStyle = panel;
    ctx.beginPath();
    ctx.roundRect(60, 140, 760, 720, 26);
    ctx.fill();
    drawShoe(ctx, 110, 640, 660, s.hex, s.swoosh);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `500 18px ${FONT.mono}`;
    spacedText(ctx, w.concept.toUpperCase(), 92, 826, 1.5);

    // Back to every colourway.
    ctx.strokeStyle = 'rgba(143,163,174,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(BACK.x, BACK.y, BACK.w, BACK.h, 32);
    ctx.stroke();
    ctx.fillStyle = '#E6ECEF';
    ctx.font = `600 24px ${FONT.body}`;
    ctx.fillText(`←  ${w.back}`, BACK.x + 28, BACK.y + 41);

    // How it was recognised.
    const how = (w.how[this.how] ?? w.how.chosen)(n);
    ctx.font = `600 20px ${FONT.mono}`;
    const bw = ctx.measureText(how).width + 64;
    ctx.fillStyle = 'rgba(92,200,224,0.14)';
    ctx.strokeStyle = 'rgba(92,200,224,0.7)';
    ctx.beginPath();
    ctx.roundRect(880, 150, bw, 50, 25);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#5CC8E0';
    ctx.beginPath();
    ctx.arc(906, 175, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(how, 926, 182);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 46px ${FONT.body}`;
    ctx.fillText(w.brand, 880, 270);
    ctx.font = `700 60px ${FONT.body}`;
    ctx.fillText(`Concept runner`, 880, 340);
    ctx.fillStyle = s.hex === '#253240' ? '#9FB3C8' : s.hex;
    ctx.font = `600 34px ${FONT.body}`;
    ctx.fillText(s.colour, 880, 392);

    ctx.fillStyle = '#C9D3D8';
    ctx.font = `400 26px ${FONT.body}`;
    s.features.forEach((f, k) => {
      ctx.fillStyle = '#FF6A55';
      ctx.fillRect(882, 448 + k * 52, 12, 3);
      ctx.fillStyle = '#C9D3D8';
      ctx.fillText(f, 910, 458 + k * 52);
    });

    ctx.fillStyle = '#8FA3AE';
    ctx.font = `500 18px ${FONT.mono}`;
    spacedText(ctx, 'SIZES', 880, 640, 2);
    w.sizes.forEach((z, k) => {
      const x = 880 + (k % 3) * 120, y = 660 + Math.floor(k / 3) * 58;
      ctx.strokeStyle = 'rgba(143,163,174,0.35)';
      ctx.beginPath();
      ctx.roundRect(x, y, 104, 44, 10);
      ctx.stroke();
      ctx.fillStyle = '#E6ECEF';
      ctx.font = `500 20px ${FONT.body}`;
      ctx.textAlign = 'center';
      ctx.fillText(z, x + 52, y + 29);
      ctx.textAlign = 'left';
    });

    // Put it back.
    ctx.fillStyle = '#E5484D';
    ctx.beginPath();
    ctx.roundRect(PUT.x, PUT.y, PUT.w, PUT.h, 37);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 26px ${FONT.body}`;
    ctx.textAlign = 'center';
    ctx.fillText(w.putBack, PUT.x + PUT.w / 2, PUT.y + 47);
    ctx.textAlign = 'left';
  }

  update(dt, t) {
    // LiDAR: a reach held on a shoe for DWELL seconds counts.
    if (this.lidarOn && this.hovered !== null) {
      this.dwell += dt;
      if (this.dwell >= DWELL && !(this.lifted === this.hovered && this.how === 'lidar')) {
        const i = this.hovered;
        this.dwell = DWELL;
        this.onDwell?.(i);
      }
    }
    this.gridMat.opacity = damp(this.gridMat.opacity, this.lidarOn ? 0.55 + 0.25 * Math.sin(t * 2.2) : 0, 5, dt);
    this.lidar.visible = this.gridMat.opacity > 0.01;
    if (this.lidar.visible) this.#drawGrid();
    this.padMat.opacity = 0.35 + (this.how === 'rfid' && this.lifted !== null && this.reading === null ? 0.55 : 0.15 * Math.sin(t * 3));
    this.shoes.forEach((s, i) => {
      const want = i === this.lifted ? 1 : 0;
      s.k = damp(s.k, want, EASE, dt);
      if (Math.abs(s.k - want) < 1e-3) s.k = want;
      const k = s.k * s.k * (3 - 2 * s.k);
      if (s.pose === 'rfid') {
        // Out of the niche, over in an arc, and down onto the reader's pad.
        const to = new THREE.Vector3(READER.x, READER.top + 0.1, READER.z);
        s.pivot.position.lerpVectors(s.home, to, k);
        s.pivot.position.y += Math.sin(Math.PI * k) * 0.35;
        s.pivot.position.z += Math.sin(Math.PI * k) * 0.55;     // well out from the wall, clear of the niches below
        s.pivot.scale.setScalar(1);
      } else {
        const pose = POSE[s.pose] ?? POSE.pressure;
        s.pivot.position.set(s.home.x, s.home.y + pose.up * k, s.home.z + pose.out * k);
        s.pivot.scale.setScalar(1 + (pose.scale - 1) * k);
      }
      // Out of the niche it turns slowly; going back, it eases round to face the way it came.
      if (want) s.spin = (s.spin ?? 0) + dt * SPIN;
      else s.spin = Math.atan2(Math.sin(s.spin ?? 0), Math.cos(s.spin ?? 0)) * (1 - Math.min(1, dt * EASE));   // the short way round
      s.pivot.rotation.y = s.spin * Math.min(1, k * 1.5);
      if (s.halo) s.halo.material.emissiveIntensity = s.halo.userData.full * (HALO.rest + (HALO.lit - HALO.rest) * k);
    });
    // RFID: the shoe has landed on the reader: now its tag is read and the kiosk opens it.
    if (this.reading !== null && this.shoes[this.reading]?.k >= 0.995) {
      const i = this.reading;
      this.reading = null;
      this.page = 'detail';
      this.draw();
      this.onRead?.(i);
    }
  }
}
