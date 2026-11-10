import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WebScreen } from '../../core/WebScreen.js';
import { FONT, canvasTexture } from '../../util/textures.js';
import { CHANNEL } from './trainer/backend.js';

// The bench's own frame (metres): its long side along x, the visitor in front (+z), the wall
// behind (-z). An assembly workstation: the work area along the front (the mat and turntable in
// the middle, a tray at either end, centred on WORK_Z), the display behind it.
export const BENCH = { w: 2, d: 1.1, top: 0.9 };
const WORK_Z = 0.28;
// The display: angled back at 45° on a stand at the back of the bench, its foot just behind the
// mat. Using the bench, the eye looks down at the mat at 45° (H45 above it and H45 in front), so
// the display is square to the view (a true rectangle, no keystone) and right behind the work.
// The picture is moved up a little with a shift lens (`shift`, in half view heights), which keeps
// that: it moves the picture, it doesn't turn the camera.
const TILT = Math.PI / 4;
// Its foot (lower edge: height, z) is high enough to clear the car in that view: the page is drawn
// over the 3D scene, so it must never sit in front of anything on the bench.
export const SCREEN = { w: 1.42, h: 0.8, foot: 1.2, z: 0 };
const H45 = 1.05;
export const OPERATE = { eye: [0, BENCH.top + H45, WORK_Z + H45], look: [0, BENCH.top, WORK_Z], shift: -0.4 };
const MAT = { x: 0, z: WORK_Z, w: 0.76, d: 0.5 };
const TRAYS = [{ x: -0.69, w: 0.52 }, { x: 0.71, w: 0.52 }];      // the first shaft and the bolt on the left, the second shaft and the screw on the right
const TRAY = { d: 0.5, h: 0.014 };
const TURNTABLE = { r: 0.19, h: 0.01 };
const K = 0.13;            // model units to metres: the shafts are 23 cm across
// The camera, like the real trainer's: overhead, on a boom from a post behind the display that
// reaches forward over the mat (above the 45° view, so out of it), looking down at the car from
// a little behind, so it sees the car's top and the side turned toward the back.
const MAST = { z: -0.53, top: 2.06 };
const CAM = { pos: [0, 2.0, -0.04], look: [0, BENCH.top + 0.06, WORK_Z], fov: 30 };
const FEED = { w: 640, h: 360, fps: 12, exposure: 1.25 };
const MOVE_S = 0.9;        // a part's trip between the tray and the car
const TURN_S = 0.9;        // the turntable's half turn
const LIFT = 0.14;         // how high a part rises on its way
const LIT = 3;             // the environment's share of the light on the bench (the rest is its spot, LAMP)
// The bench's own light: a spot in the ceiling over it, its fitting a glowing disc. The room's lights
// are off (ROOM_LIGHTS); this one belongs to the exhibit, so the zone switches it on (lights).
const LAMP = { below: 0.04, z: WORK_Z + 0.2, intensity: 14, angle: 0.42, penumbra: 0.6 };   // below: under the ceiling

// Where each part waits in the trays (bench frame). Each part lies
// as described below.
const FIRST = 'shaft1';            // the part everything else goes on
// The shafts are discs and lie flat in the tray; the bolt lies along it. `below`: how far under the
// part (m) its name is printed.
const SLOTS = {
  shaft1: { x: -0.69, z: WORK_Z - 0.1, flat: true, below: 0.15 },
  bolt: { x: -0.69, z: WORK_Z + 0.14, yaw: Math.PI / 2, below: 0.07 },
  shaft2: { x: 0.71, z: WORK_Z - 0.1, flat: true, below: 0.15 },
  screw: { x: 0.71, z: WORK_Z + 0.14, flat: true, below: 0.07 },
};
// The bolt and the screw are tiny next to the shafts, so they lie in the tray larger than life, and come
// down to their true size as they go onto the assembly (and grow again when they are put back).
const TRAY_SCALE = { bolt: 2, screw: 3.2 };

// The model's nodes (4.glb, the finished assembly) by name, sorted into the part they belong to.
const PARTS = {
  shaft1: ['Cylinder001'],
  shaft2: ['Cylinder005'],
  bolt: ['pan_head_screw_(bolt)002'],
  screw: ['Hex_Nut002'],
};
// GLTFLoader strips the dots from node names ('Object_9.001' loads as 'Object_9001'), and a node
// with several materials loads as a group whose meshes have names of their own: look up the tree.
const loaded = (name) => name.replace(/[.[\]:/]/g, '');
const PART_OF = Object.fromEntries(Object.entries(PARTS).flatMap(([id, names]) => names.map((n) => [loaded(n), id])));
function partOf(mesh) {
  for (let o = mesh; o; o = o.parent) if (PART_OF[o.name]) return PART_OF[o.name];
  return FIRST;
}
const CRADLE = 0.012;              // the thickness of the plate the assembly stands on

const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
// The model's axis (z) lies along the bench's z, the shafts' faces toward the visitor, standing like wheels
// on the turntable: the model's -z end (the bolt's) faces the visitor, the +z end (the screw's) the wall.
const MODEL_TURN = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
// The bolt and the screw go in along the axis, from the model's -z and +z. The turntable turns so that
// they come in from the visitor's side, where they can be seen (the turn is the first part of the move).
const SLIDE = { bolt: new THREE.Vector3(0, 0, -1), screw: new THREE.Vector3(0, 0, 1) };
const APPROACH = 0.3;      // how far out along the axis the slide starts (m)
const PICK_MIN = 0.03;     // a small part can be clicked or grabbed this far (m) from its middle, at its true size
const HOLD = 0.14;         // how high a part is carried above the bench when dragged
const _slide = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
const _pre = new THREE.Vector3(), _d = new THREE.Vector3(), _plane = new THREE.Plane(), _hit = new THREE.Vector3();

/**
 * The Lab's bench: a mat with a turntable, two trays of parts, a
 * camera on a mast looking down at the mat, and the screen on the wall that runs the Assembly
 * Trainer (/assembly/, trainer/main.js) in a WebScreen.
 *
 * The visitor builds the car by clicking: a part in a tray goes onto the car (the first shaft onto
 * the turntable first), a part on the car comes off again, and the turntable (or the first shaft)
 * turns the car round, so the camera sees its other side. Any part can go on at any time: it
 * is the trainer's vision AI that knows the order, and says so when a part goes on too early.
 *
 * The camera: what it sees goes to the trainer on the channel (backend.js: which parts are on
 * and in sight, which side faces it), and its picture is drawn from a camera on the mast
 * (renderFeed) and handed to onFrame(imageData, roi).
 *   ready          resolves once the car's parts are loaded
 *   pick(ray)      { id, action: 'take' | 'remove' | 'turn' } under the ray, or null
 *   use(hit)       does it
 *   reset()        every part back in its tray, the turntable home
 *   onHint(key)    a click that can't be done ('noChassis')
 */
export class Workbench {
  /** display: false leaves out the trainer's own stand: the zone sets `screen.group` somewhere in the room. */
  constructor(engine, { url, title, labels, ceiling = 5, display: ownDisplay = true }) {
    this.ceiling = ceiling;
    this.engine = engine;
    this.group = new THREE.Group();
    this.parts = {};
    this.yaw = 0;
    this.turn = null;
    this.hovered = null;
    this.seenKey = '';
    this.#furniture(labels);

    this.screen = new WebScreen(engine, { url, width: SCREEN.w, height: SCREEN.h, viewport: [1600, 900], title });
    const half = SCREEN.h / 2;
    const display = new THREE.Group();                // its centre, leaning back by TILT
    display.position.set(0, SCREEN.foot + half * Math.sin(TILT), SCREEN.z - half * Math.cos(TILT));
    display.rotation.x = -TILT;
    this.screen.group.position.z = 0.004;
    const shell = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.45, metalness: 0.5, envMapIntensity: LIT });
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(SCREEN.w + 0.06, SCREEN.h + 0.06, 0.035), shell);
    bezel.position.z = -0.016;
    display.add(this.screen.group, bezel);
    if (ownDisplay) this.group.add(display);
    // Its stand: two legs from the bench to the back of the display, and a foot rail.
    const back = new THREE.Vector3(0, 0, -0.04).applyEuler(display.rotation).add(display.position);
    for (const x of ownDisplay ? [-0.45, 0.45] : []) {
      const legH = back.y - BENCH.top;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, legH, 0.035), shell);
      leg.position.set(x, BENCH.top + legH / 2, back.z);
      this.group.add(leg);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(SCREEN.w * 0.7, 0.02, 0.06), shell);
    rail.position.set(0, BENCH.top + 0.01, back.z);
    if (ownDisplay) this.group.add(rail);

    this.feedCam = new THREE.PerspectiveCamera(CAM.fov, FEED.w / FEED.h, 0.02, 30);
    this.feedCam.position.set(...CAM.pos);
    this.feedCam.lookAt(...CAM.look);
    this.group.add(this.feedCam);
    this.feedBuffer = new THREE.WebGLRenderTarget(FEED.w, FEED.h, { type: THREE.HalfFloatType, samples: 4 });
    this.feedTarget = new THREE.WebGLRenderTarget(FEED.w, FEED.h);
    this.feedOut = new OutputPass();
    this.pixels = new Uint8Array(FEED.w * FEED.h * 4);
    this.feedClock = 0;

    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.addEventListener('message', (e) => {
      if (e.data?.type === 'reset') this.reset();
      if (e.data?.type === 'status') this.onStatus?.(e.data.status);
    });
    this.ready = this.#loadCar();
  }

  /* ------------------------------------------------------------- the bench */

  #furniture(labels) {
    const g = this.group;
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.45, metalness: 0.7, envMapIntensity: LIT });
    const top = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.7, envMapIntensity: LIT });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.55, envMapIntensity: LIT });
    const { w, d, top: y } = BENCH;

    // A display workstation in the rooms' finishes: a graphite worktop (light grey only round the
    // mat and trays, where the camera looks) with a brushed aluminium edge; two solid graphite
    // pedestals with a champagne line, a recessed back panel, a warm light strip under the front
    // edge and a glowing plinth at the floor.
    const graphite = new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.38, metalness: 0.55, envMapIntensity: LIT });
    const alu = new THREE.MeshStandardMaterial({ color: 0xbfc3ca, roughness: 0.28, metalness: 0.9, envMapIntensity: LIT });
    const champagne = new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.3, metalness: 0.85, envMapIntensity: LIT });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc98a).multiplyScalar(0.9), toneMapped: false });
    const T = 0.05, P = 0.36, inset = 0.08;           // worktop thickness, pedestal width, base inset from the edge
    this.top = add(new THREE.BoxGeometry(w, T, d), graphite, 0, y - T / 2, 0);
    add(new THREE.BoxGeometry(w - 0.24, 0.002, d - 0.2), top, 0, y + 0.0005, 0.02);    // the light working field
    add(new THREE.BoxGeometry(w + 0.02, T + 0.006, 0.014), alu, 0, y - T / 2, d / 2 + 0.007);   // aluminium edge, front
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.014, T + 0.006, d + 0.028), alu, sx * (w / 2 + 0.007), y - T / 2, 0);
    const baseH = y - T, baseD = d - inset * 2;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - inset - P / 2);
      add(new THREE.BoxGeometry(P, baseH - 0.06, baseD), graphite, x, 0.06 + (baseH - 0.06) / 2, 0);
      add(new THREE.BoxGeometry(0.008, baseH - 0.2, 0.004), champagne, x + sx * -0.09, 0.06 + (baseH - 0.06) / 2, baseD / 2 + 0.002);
    }
    add(new THREE.BoxGeometry(w - inset * 2 - P * 2, baseH * 0.62, 0.025), graphite, 0, y - T - (baseH * 0.62) / 2, -baseD / 2 + 0.05);   // back panel
    add(new THREE.BoxGeometry(w - 0.1, 0.012, 0.012), glow, 0, y - T - 0.012, d / 2 - 0.05);     // light strip under the front edge
    add(new THREE.BoxGeometry(w - inset * 2 - 0.04, 0.06, baseD - 0.04), graphite, 0, 0.03, 0);   // plinth
    add(new THREE.BoxGeometry(w - inset * 2 - 0.02, 0.008, 0.008), glow, 0, 0.012, baseD / 2 - 0.01);   // its glowing toe line

    // The mat: a cutting mat with a centimetre grid.
    const mat = canvasTexture(1024, Math.round((1024 * MAT.d) / MAT.w), (ctx, cw, ch) => {
      ctx.fillStyle = '#2e3a35';
      ctx.fillRect(0, 0, cw, ch);
      const cm = cw / (MAT.w * 100);
      for (let i = 0; i * cm <= cw; i++) {
        ctx.strokeStyle = i % 5 ? 'rgba(220,235,225,0.12)' : 'rgba(220,235,225,0.32)';
        ctx.lineWidth = i % 5 ? 1 : 1.6;
        ctx.beginPath(); ctx.moveTo(i * cm, 0); ctx.lineTo(i * cm, ch); ctx.stroke();
      }
      for (let i = 0; i * cm <= ch; i++) {
        ctx.strokeStyle = i % 5 ? 'rgba(220,235,225,0.12)' : 'rgba(220,235,225,0.32)';
        ctx.lineWidth = i % 5 ? 1 : 1.6;
        ctx.beginPath(); ctx.moveTo(0, i * cm); ctx.lineTo(cw, i * cm); ctx.stroke();
      }
    });
    const matMesh = add(new THREE.PlaneGeometry(MAT.w, MAT.d), new THREE.MeshStandardMaterial({ map: mat.texture, roughness: 0.9, envMapIntensity: LIT }), MAT.x, y + 0.002, MAT.z);
    matMesh.rotation.x = -Math.PI / 2;

    // The turntable the car is built on (click it to turn the car round).
    this.table = add(new THREE.CylinderGeometry(TURNTABLE.r, TURNTABLE.r, TURNTABLE.h, 64), metal, MAT.x, y + 0.003 + TURNTABLE.h / 2, MAT.z);
    this.tableTop = y + 0.003 + TURNTABLE.h;
    const ring = add(new THREE.TorusGeometry(TURNTABLE.r - 0.012, 0.002, 6, 96), new THREE.MeshBasicMaterial({ color: 0xfbfaf5 }), MAT.x, this.tableTop + 0.001, MAT.z);
    ring.rotation.x = Math.PI / 2;
    this.ring = ring;                                  // lit green while a part is over the mat
    this.jig = add(new THREE.BoxGeometry(0.3, 1, 0.08), metal, MAT.x, this.tableTop, MAT.z);   // height set once the car is loaded
    this.jig.visible = false;

    // The trays, each slot's name printed under it.
    this.trays = TRAYS.map((t) => {
      const tray = add(new THREE.BoxGeometry(t.w, TRAY.h, TRAY.d), white, t.x, y + TRAY.h / 2, WORK_Z);
      const print = canvasTexture(1024, Math.round((1024 * TRAY.d) / t.w), (ctx, cw, ch) => {
        ctx.fillStyle = '#f2f2f0';
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = '#2a2e35';
        ctx.font = `700 ${Math.round(cw * 0.037)}px ${FONT.mono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const [id, s] of Object.entries(SLOTS)) {
          if (Math.abs(s.x - t.x) > t.w / 2) continue;
          const below = s.below ?? 0.09;
          const px = ((s.x - t.x) / t.w + 0.5) * cw, pz = ((s.z - WORK_Z + below) / TRAY.d + 0.5) * ch;
          ctx.save();
          ctx.translate(px, pz);
          ctx.fillText(labels[id].toUpperCase(), 0, 0);
          ctx.restore();
        }
      });
      // Lit from within a little, so the names read in the dark room.
      const face = add(new THREE.PlaneGeometry(t.w, TRAY.d), new THREE.MeshStandardMaterial({ map: print.texture, emissiveMap: print.texture, emissive: 0x6a6a6a, roughness: 0.55, envMapIntensity: LIT }), t.x, y + TRAY.h + 0.001, WORK_Z);
      face.rotation.x = -Math.PI / 2;
      return tray;
    });
    this.trayTop = y + TRAY.h;

    // The camera on its boom, from a post at the back of the bench.
    add(new THREE.CylinderGeometry(0.06, 0.07, 0.015, 32), metal, 0, y + 0.0075, MAST.z);
    add(new THREE.CylinderGeometry(0.012, 0.012, MAST.top - y, 16), metal, 0, (MAST.top + y) / 2, MAST.z);
    add(new THREE.BoxGeometry(0.024, 0.024, CAM.pos[2] - MAST.z), metal, 0, MAST.top, (MAST.z + CAM.pos[2]) / 2);
    const head = new THREE.Group();
    head.position.set(...CAM.pos);
    head.lookAt(...CAM.look);                          // not in the group yet: its frame is the bench's
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.026, 0.026), new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.35, metalness: 0.5, envMapIntensity: LIT })));
    for (const x of [-0.035, -0.012, 0.012, 0.035]) {
      const lens = new THREE.Mesh(new THREE.CircleGeometry(x === -0.012 ? 0.005 : 0.0065, 20), new THREE.MeshBasicMaterial({ color: 0x050608 }));
      lens.position.set(x, 0, 0.0135);
      head.add(lens);
    }
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.0018, 10), new THREE.MeshBasicMaterial({ color: 0x3dff6e }));
    led.position.set(0.046, 0.007, 0.0135);
    head.add(led);
    g.add(head);

    // The spot over the bench, aimed at the mat, and a softer one filling the trays at either end.
    const spot = new THREE.SpotLight(0xfff1e0, LAMP.intensity, 0, LAMP.angle, LAMP.penumbra, 2);
    spot.position.set(0, this.ceiling - LAMP.below, LAMP.z);
    spot.target.position.set(0, y, WORK_Z);
    const fill = new THREE.PointLight(0xfff1e0, 1.6, 0, 2);
    fill.position.set(0, 2.6, 1.4);
    g.add(spot, spot.target, fill);
    this.lights = [spot, fill];
    const fitting = add(new THREE.CircleGeometry(0.09, 32), new THREE.MeshBasicMaterial({ color: 0xfff1e0 }), 0, this.ceiling - LAMP.below - 0.01, LAMP.z);
    fitting.rotation.x = Math.PI / 2;

  }

  /** What a click on the bench outside the parts and the screen may use (the zone's hover target). */
  get hitTargets() {
    return [this.top, this.table, ...this.trays];
  }

  /* --------------------------------------------------------------- the car */

  async #loadCar() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync('/drava-world/assembly/models/assembled.glb');
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);

    // Every visible mesh, baked where it ends up, and sorted into its part.
    const meshes = {};
    const box = new THREE.Box3();
    scene.traverse((o) => {
      if (!o.isMesh || Math.abs(o.matrixWorld.determinant()) < 1e-9) return;
      (meshes[partOf(o)] ??= []).push(o);
    });
    for (const list of Object.values(meshes)) for (const o of list) box.expandByObject(o);
    // The assembly stands on the turntable on a low plate (the jig), centred over it.
    const centre = box.getCenter(new THREE.Vector3());
    this.carOrigin = new THREE.Vector3(centre.x, box.min.y, centre.z);
    this.jig.scale.y = CRADLE;
    this.jig.position.y = this.tableTop + CRADLE / 2;
    this.jig.visible = true;

    for (const [id, list] of Object.entries(meshes)) {
      const b = new THREE.Box3();
      for (const o of list) b.expandByObject(o);
      const c = b.getCenter(new THREE.Vector3());
      const group = new THREE.Group();
      group.name = `part-${id}`;
      const mats = new Map();
      for (const o of list) {
        // Each part gets its own copies of its materials, so it can be lit up on its own.
        const material = [o.material].flat().map((m) => {
          if (!mats.has(m)) {
            const copy = m.clone();
            copy.envMapIntensity = LIT;
            mats.set(m, copy);
          }
          return mats.get(m);
        });
        const mesh = new THREE.Mesh(o.geometry, Array.isArray(o.material) ? material : material[0]);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(_m.makeTranslation(-c.x, -c.y, -c.z).multiply(o.matrixWorld));
        group.add(mesh);
      }
      const local = new THREE.Box3();                  // the part round its own centre
      group.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); local.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrix)); } });
      // A small part (the bolt, the screw) gets an invisible box round it, at least 2 x PICK_MIN each way, so it is easy to hit.
      const size = local.getSize(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) * K < 0.15) {
        const min = (2 * PICK_MIN) / K;
        const pad = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x, min), Math.max(size.y, min), Math.max(size.z, min)), new THREE.MeshBasicMaterial({ visible: false }));
        pad.name = 'pick-area';
        pad.position.copy(local.getCenter(new THREE.Vector3()));
        group.add(pad);
      }
      group.scale.setScalar(K * (TRAY_SCALE[id] ?? 1));
      this.group.add(group);
      const part = { id, group, centre: c, local, mats: [...mats.values()], at: 'tray', move: null, sc: TRAY_SCALE[id] ?? 1 };
      part.tray = this.#trayPose(part);
      group.position.copy(part.tray.p);
      group.quaternion.copy(part.tray.q);
      this.parts[id] = part;
    }
  }

  #trayPose(part) {
    const s = SLOTS[part.id];
    const q = new THREE.Quaternion().setFromAxisAngle(UP, s.yaw ?? 0);
    if (s.flat) q.multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    const b = part.local.clone().applyMatrix4(_m.compose(_v.set(0, 0, 0), q, _s.setScalar(K * (TRAY_SCALE[part.id] ?? 1))));
    return { p: new THREE.Vector3(s.x, this.trayTop - b.min.y + 0.001, s.z), q };
  }

  /** Where a part sits on the car, as the turntable is turned now. */
  #carPose(part, out = { p: new THREE.Vector3(), q: new THREE.Quaternion() }) {
    const o = this.carOrigin;
    _m.compose(_v.set(MAT.x, this.tableTop + CRADLE, MAT.z), this.#carQuat(this.yaw, _q), _s.setScalar(K));
    _m.multiply(_m2.makeTranslation(part.centre.x - o.x, part.centre.y - o.y, part.centre.z - o.z));
    _m.decompose(out.p, out.q, _s);
    return out;
  }

  /** The assembly's turn on the turntable at this yaw. */
  #carQuat(yaw, out = new THREE.Quaternion()) {
    return out.setFromAxisAngle(UP, yaw).multiply(MODEL_TURN);
  }

  get #on() {
    return this.parts[FIRST]?.at === 'car';
  }

  /** The side of the car toward the camera (null while it turns). At yaw 0 the car's left faces the wall. */
  get facing() {
    if (this.turn) return null;
    return Math.cos(this.yaw) > 0 ? 'left' : 'right';
  }

  /* ----------------------------------------------------------- clicking */

  pick(ray) {
    const targets = [...Object.values(this.parts).map((p) => p.group), this.table, this.jig];
    const hit = new THREE.Raycaster(ray.origin, ray.direction, 0, 20).intersectObjects(targets, true)[0];
    if (!hit) return null;
    if (hit.object === this.table || hit.object === this.jig) return this.#on ? { id: FIRST, action: 'turn' } : null;
    let o = hit.object;
    while (o && !o.name.startsWith('part-')) o = o.parent;
    const part = this.parts[o?.name.slice(5)];
    if (!part || part.move) return null;
    if (part.at === 'tray') return { id: part.id, action: 'take' };
    return { id: part.id, action: part.id === FIRST ? 'turn' : 'remove' };
  }

  use(hit) {
    if (!hit) return;
    const part = this.parts[hit.id];
    if (hit.action === 'turn') { this.#turn(); return; }
    if (hit.action === 'take') this.#take(part);
    else if (hit.action === 'remove') this.#send(part, 'tray');
  }

  /** A part to the car (the bolt and the screw first have the turntable show the end they go in at). */
  #take(part) {
    if ((part.id !== FIRST && !this.#on) || this.turn) {
      if (!this.turn) {
        this.onHint?.('noChassis');
        this.channel.postMessage({ type: 'mistake', kind: 'no_base' });   // for the trainer's report
      }
      this.#send(part, 'tray', 0.35);                // a hop: it can't go on yet
      return;
    }
    let wait = 0;
    if (SLIDE[part.id] && _d.copy(SLIDE[part.id]).applyQuaternion(this.#carQuat(this.yaw)).z < 0) {
      this.#turn();
      wait = TURN_S;
    }
    this.#send(part, 'car', MOVE_S, wait);
  }

  /* ------------------------------------------------------ drag and drop */

  /** Pick the part up: it follows dragTo(ray) until drop(). False for what can't be dragged (the turn). */
  startDrag(hit) {
    const part = this.parts[hit?.id];
    if (!part || part.move || part.drag || hit.action === 'turn') return false;
    part.drag = { to: part.group.position.clone(), over: false };
    part.at = 'tray';                                // a part picked off the car is off it
    return true;
  }

  /** Where the ray meets the plane the part is carried in; lights the mat when it is over it. */
  dragTo(ray) {
    const part = Object.values(this.parts).find((p) => p.drag);
    if (!part) return;
    this.group.updateWorldMatrix(true, false);
    const y = this.group.localToWorld(_v.set(0, BENCH.top + HOLD, 0)).y;
    if (!new THREE.Ray(ray.origin, ray.direction).intersectPlane(_plane.set(UP, -y), _hit)) return;
    this.group.worldToLocal(_hit);
    part.drag.to.copy(_hit);
    const over = Math.abs(_hit.x - MAT.x) < MAT.w / 2 && Math.abs(_hit.z - MAT.z) < MAT.d / 2;
    if (over !== part.drag.over) {
      part.drag.over = over;
      this.ring.material.color.setHex(over ? 0x3dff6e : 0xfbfaf5);
    }
  }

  /** Let go: on the mat it goes on the car, anywhere else it goes back to its tray. */
  drop() {
    const part = Object.values(this.parts).find((p) => p.drag);
    if (!part) return;
    const over = part.drag.over;
    part.drag = null;
    this.ring.material.color.setHex(0xfbfaf5);
    if (over) this.#take(part); else this.#send(part, 'tray', 0.6);
  }

  /** The pointer is gone (left the page, Esc): put it down off the mat. */
  cancelDrag() {
    for (const p of Object.values(this.parts)) if (p.drag) p.drag.over = false;
    this.drop();
  }

  /** Hover: the part (or the whole car, to turn it) lights up a little. */
  hover(hit) {
    const key = hit ? `${hit.id}:${hit.action}` : null;
    if (key === this.hovered) return;
    this.hovered = key;
    const lit = !hit ? [] : hit.action === 'turn' ? Object.values(this.parts).filter((p) => p.at === 'car') : [this.parts[hit.id]];
    for (const p of Object.values(this.parts)) for (const m of p.mats) m.emissive?.setScalar(lit.includes(p) ? 0.12 : 0);
  }

  #send(part, to, dur = MOVE_S, wait = 0) {
    const from = { p: part.group.position.clone(), q: part.group.quaternion.clone() };
    part.at = to;
    part.move = { from, t: 0, dur, hop: dur < MOVE_S, wait };
  }

  #turn() {
    if (this.turn) return;
    this.turn = { from: this.yaw, to: this.yaw + Math.PI, t: 0 };
  }

  /** Everything back in its tray, the turntable home (a new session on the trainer). */
  reset() {
    this.cancelDrag();
    for (const p of Object.values(this.parts)) if (p.at === 'car') this.#send(p, 'tray');
    if (Math.cos(this.yaw) < 0.999) this.turn = { from: this.yaw, to: Math.round(this.yaw / (2 * Math.PI) + 0.5) * 2 * Math.PI, t: 0 };
  }

  /* ----------------------------------------------------------- the camera */

  /** What the camera sees: the parts on the car, still, and in its sight. */
  seen() {
    return Object.values(this.parts)
      .filter((p) => p.at === 'car' && !p.move)
      .map((p) => p.id);
  }

  /** Is this part on the car? */
  isOn(id) {
    return this.parts[id]?.at === 'car' && !this.parts[id].move;
  }

  #report(t) {
    const tags = this.seen();
    const key = `${tags.join()}|${this.facing}`;
    if (key === this.seenKey && t - this.sentAt < 1) return;
    this.seenKey = key;
    this.sentAt = t;
    this.channel.postMessage({ type: 'seen', tags, facing: this.facing });
  }

  /**
   * Draw the camera's picture (at FEED.fps) and hand it to onFrame(imageData, roi). Call it after
   * the room is drawn (engine.onOverlay). The picture is read back without stalling the frame.
   */
  renderFeed(renderer, scene, dt) {
    this.feedClock += dt;
    if (this.feedClock < 1 / FEED.fps || this.reading || !this.onFrame) return;
    this.feedClock = 0;
    const exposure = renderer.toneMappingExposure;
    renderer.setRenderTarget(this.feedBuffer);
    renderer.clear();
    renderer.render(scene, this.feedCam);
    renderer.toneMappingExposure = FEED.exposure;      // the camera's auto exposure: the room is dark
    this.feedOut.render(renderer, this.feedTarget, this.feedBuffer);
    renderer.toneMappingExposure = exposure;
    renderer.setRenderTarget(null);
    this.reading = true;
    renderer.readRenderTargetPixelsAsync(this.feedTarget, 0, 0, FEED.w, FEED.h, this.pixels).then(() => {
      this.reading = false;
      const image = new ImageData(FEED.w, FEED.h);
      const row = FEED.w * 4;
      for (let y = 0; y < FEED.h; y++) image.data.set(this.pixels.subarray((FEED.h - 1 - y) * row, (FEED.h - y) * row), y * row);
      this.onFrame?.(image, this.#roi());
    }, () => { this.reading = false; });
  }

  /** The mat's outline in the camera's picture (0..1), as the real feed outlines its build area. */
  #roi() {
    this.feedCam.updateMatrixWorld();
    const y = BENCH.top + 0.002, hw = MAT.w / 2, hd = MAT.d / 2;
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => {
      _v.set(MAT.x + x, y, MAT.z + z).applyMatrix4(this.group.matrixWorld).project(this.feedCam);
      return [(_v.x + 1) / 2, (1 - _v.y) / 2];
    });
  }

  /**
   * The bolt's and the screw's trip: out of the tray and round to just outside its place on the
   * car, then in along its own axis, in plain sight. Coming off, the same the other way.
   */
  #slide(part, m) {
    const car = this.#carPose(part, _slide);
    const pre = _pre.copy(SLIDE[part.id]).applyQuaternion(this.#carQuat(this.yaw)).multiplyScalar(APPROACH).add(car.p);
    const g = part.group;
    const fit = (t, from, to, lift = 0) => { g.position.lerpVectors(from, to, smooth(t)); g.position.y += Math.sin(Math.PI * t) * lift; };
    if (part.at === 'car') {
      const split = 0.6;
      if (m.t < split) {
        const a = m.t / split;
        fit(a, m.from.p, pre, LIFT);
        g.quaternion.slerpQuaternions(m.from.q, car.q, smooth(a));
      } else {
        fit((m.t - split) / (1 - split), pre, car.p);
        g.quaternion.copy(car.q);
      }
    } else {
      const split = 0.4;
      if (m.t < split) {
        fit(m.t / split, m.from.p, pre);
        g.quaternion.copy(m.from.q);
      } else {
        const b = (m.t - split) / (1 - split);
        fit(b, pre, part.tray.p, LIFT);
        g.quaternion.slerpQuaternions(m.from.q, part.tray.q, smooth(b));
      }
    }
  }

  /* --------------------------------------------------------------- frame */

  update(dt, t) {
    if (this.turn) {
      this.turn.t = Math.min(1, this.turn.t + dt / TURN_S);
      this.yaw = this.turn.from + (this.turn.to - this.turn.from) * smooth(this.turn.t);
      if (this.turn.t >= 1) { this.yaw = this.turn.to % (2 * Math.PI); this.turn = null; }
    }
    this.table.rotation.y = this.yaw;
    this.jig.rotation.y = this.yaw;
    const pose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    for (const part of Object.values(this.parts)) {
      const g = part.group;
      // Its size: the tray's while it is there, its true size once it is on the mat or on the car.
      const size = part.at === 'tray' && !part.drag?.over ? TRAY_SCALE[part.id] ?? 1 : 1;
      part.sc += (size - part.sc) * (1 - Math.exp(-dt * 7));
      if (Math.abs(size - part.sc) < 0.005) part.sc = size;
      g.scale.setScalar(K * part.sc);
      if (part.drag) {                                 // in the hand: follows the pointer, turning to how it will sit
        g.position.lerp(part.drag.to, 1 - Math.exp(-dt * 18));
        const q = part.drag.over ? this.#carPose(part, pose).q : part.tray.q;
        g.quaternion.slerp(q, 1 - Math.exp(-dt * 10));
        continue;
      }
      const to = part.at === 'car' ? this.#carPose(part, pose) : part.tray;
      if (!part.move) { g.position.copy(to.p); g.quaternion.copy(to.q); continue; }
      const m = part.move;
      if (m.wait > 0) { m.wait -= dt; continue; }      // the turntable is turning the right end round
      m.t = Math.min(1, m.t + dt / m.dur);
      if (SLIDE[part.id] && !m.hop) this.#slide(part, m);
      else {
        const k = smooth(m.t);
        g.position.lerpVectors(m.from.p, to.p, k);
        g.position.y += Math.sin(Math.PI * m.t) * (m.hop ? 0.05 : LIFT);
        g.quaternion.slerpQuaternions(m.from.q, to.q, k);
      }
      if (m.t >= 1) part.move = null;
    }
    this.#report(t);
  }
}
