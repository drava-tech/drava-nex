import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { glossFloor, repaintShadow, roomReflections } from '../../core/bakedRoom.js';

/**
 * Architecture of the Nex Zone: the client's model, public/WT_Room_50x30/ (the four-screen room,
 * 50 × 30 × 14 ft; its README and Dimensions_and_Materials.json give every measure used here),
 * shown as the Welcome Zone shows its model: its light is baked into each material's emissive
 * map; room reflections and a gloss floor go on top (core/bakedRoom.js).
 *
 * Plan (metres, looking down, +x right, +z toward the entrance; the floor is at y = 0):
 *   Interior      x -7.62..7.62, z -4.572..4.572, ceiling 4.267 (a 20 ft glowing disc in the middle,
 *                 a warm cove round the edge)
 *   Front wall    red metal, two 16 × 9 ft screens either side of the White Tusker logo
 *   Left wall     red metal, one screen        Right wall   graphite, one screen
 *   Middle        the kiosk: a 55" 16:9 screen at 45°, facing the entrance
 *   Rear wall     graphite, the entrance (8 × 9 ft) in the middle
 *
 * The model's four screens are its own surfaces, always hidden (the zones set their displays on
 * them, or hide their frames too: `screens: false`). The Nex Zone hides the model's four screens
 * and its kiosk and stands its own touch point in the room instead (2026-10-12, the client's
 * choice): three framed screens on the front wall (WALL_SCREENS,
 * buildWall), and the wide white pedestal kiosk in the middle (KIOSK, buildKiosk).
 */
export const MODEL_URL = '/drava-world/WT_Room_50x30/WT_Room_50x30_Four_Screens.glb';

export const ROOM = { minX: -7.62, maxX: 7.62, minZ: -4.572, maxZ: 4.572, height: 4.267 };
// The entrance in the rear wall (z: the wall's inside face).
export const ENTRY = { x: 0, z: 4.572, width: 2.438, height: 2.743 };

// The model's four wall screens and their frames.
const SCREEN_NODES = ['Screen_Left', 'Screen_Front_Left', 'Screen_Front_Right', 'Screen_Right'];
const FRAME_NODES = SCREEN_NODES.map((n) => `${n}_Frame`);
// The frames' baked shadow on the walls behind, repainted when they're hidden (repaintShadow):
// the face's axis along the wall (z) to v, the stretch the frame covered, and the face's own
// columns of the map.
const FRAME_SHADOWS = [
  { mesh: 'Red_Left_Panel', along: [4.362, 0.0009, -4.362, 0.9545], span: [-2.55, 2.55], u: [0.001, 0.3745] },
  { mesh: 'Wall_Right', along: [4.722, 0.1542, -4.722, 0.9991], span: [-2.55, 2.55], u: [0.4719, 0.9233] },
  // Across both front screens and the logo between them, blended top to bottom (from just above
  // and below the screens' frames), so the light pool from the ceiling is kept.
  { mesh: 'Red_Front_Panel', along: [-7.41, 0.9866, 7.41, 0.1737], span: [-5.6, 5.6], u: [0.4814, 0.9431], across: { along: [0.4, 0.9431, 3.7, 0.4814], span: [0.52, 3.45] } },
];

// The Nex Zone's screens: three on the front wall, left, centre and right, each its own screen in
// the Nex, the same size (16:9) and evenly spaced, each in a thin dark frame, as the Multi-Zone
// Screens (since replaced by the floors) hung theirs (the client's call, 2026-10-12, after a curved
// wall). Larger than those were, as the zone's main wall, seen from the entrance 8.5 m away. They hang high (bottom edge SCREEN_BASE
// up), so that from the entrance they show above the kiosk when it has slid to the front of the
// view (CmsZone, OPERATE), none behind it. The zone hides the model's logo (CmsZone).
// x: each one's centre; SCREEN_Z: their faces, just off the wall (as the floors' screens).
export const SCREEN_W = 3.6, SCREEN_H = (SCREEN_W * 9) / 16, SCREEN_BASE = 1.25, SCREEN_Y = SCREEN_BASE + SCREEN_H / 2;
export const SCREEN_Z = ROOM.minZ + 0.122;
export const WALL_SCREENS = [{ x: -4.8 }, { x: 0 }, { x: 4.8 }];

// The kiosk, in the middle of the room where the model's stood: a white pedestal kiosk (flat base
// plate, cranked column with two grey panels, a deep white box holding a wide 20:9 screen). Its
// 2.1 m screen leans back 78° from horizontal, facing the entrance; the front edge is at 0.45 m and
// the top edge about 1.37 m, below the wall in the view where it is used.
// round: the corner radius of the head (its glass's reveal follows it, a little tighter).
export const KIOSK = { x: 0, z: 0, w: 2.1, h: (2.1 * 9) / 20, tilt: THREE.MathUtils.degToRad(78), frontY: 0.45, bezel: 0.07, depth: 0.14, round: 0.05 };
KIOSK.centreY = KIOSK.frontY + (KIOSK.h / 2) * Math.sin(KIOSK.tilt);

const FLOOR = 'Floor';
const DISC = 'Ceiling_Disc_Light';
const COVE = 'Warm_Perimeter_Cove';
const KIOSK_SCREEN = 'Kiosk_Screen_55in_45deg';
// Box projection volume for the reflections: the model's outer box.
const BOX_MIN = new THREE.Vector3(-7.77, 0, -4.722);
const BOX_MAX = new THREE.Vector3(7.77, 4.387, 4.722);
// With every light off the room keeps this much of its baked light (the screens and the kiosk
// still glow), so it reads as a dark room, not a black screen.
const DARK = 0.08;

/**
 * Builds the room into `scene` and starts loading the model. Returns at once:
 *   group, occluders (filled when the model is in), ready (resolves with the model),
 *   disc / cove: { material } for the ceiling disc and the warm cove. The room's devices
 *     (RoomDevices: the Environment page's fabric and strip light) set these before the model is
 *     in, and the model's disc and cove take them as it loads,
 *   setReflections(on): the gloss floor, on high quality,
 *   options: cove (a colour: the cove lit as baked, for a zone without RoomDevices), kiosk: false
 *     (the kiosk hidden, for a zone that puts its own exhibit in the middle), screens: false (the
 *     model's four screens' frames hidden too, their shadows on the walls repainted, for a zone
 *     that hangs its own screens),
 *   setLight(rel): the room's light, as a colour relative to the light it was baked with (white:
 *     as baked; RoomDevices drives it from the Environment page's lights). The baked glow of every
 *     surface, its reflections and the gloss floor follow it, down to DARK when the lights are off.
 *   adopt(materials): the zone's own pieces in the room (MeshStandardMaterials, lit by their
 *     emissive colour): they take the room's reflections and follow setLight as the model does.
 */
export function buildRoom(scene, { engine, cove = null, kiosk = true, screens: showScreens = true }) {
  const group = new THREE.Group();
  group.name = 'cms-room';
  scene.add(group);

  const occluders = [];
  const room = {
    group, occluders,
    disc: { material: null },
    cove: { material: new THREE.MeshBasicMaterial({ color: cove ?? 0x000000, toneMapped: false }) },
    ready: null,
    setReflections: () => {},
    light: new THREE.Color(1, 1, 1),
    setLight(rel) {
      room.light.copy(rel);
      const k = (v) => DARK + (1 - DARK) * v;
      const glow = new THREE.Color(k(rel.r), k(rel.g), k(rel.b));
      const level = Math.max(glow.r, glow.g, glow.b);
      for (const m of baked) { m.emissive.copy(glow); m.envMapIntensity = level; }
      if (room.floor) room.floor.material.uniforms.tint.value.copy(glow);
      for (const m of adopted) { m.emissive.copy(m.userData.emissive).multiply(glow); m.envMapIntensity = level; }
    },
    adopt(materials) {
      for (const m of materials) {
        if (adopted.includes(m)) continue;
        m.userData.emissive = m.emissive.clone();
        adopted.push(m);
        if (room.env) { m.envMap = room.env; m.needsUpdate = true; }
      }
      room.setLight(room.light);
    },
  };
  const baked = [];      // the materials whose light is baked (all but the screens and the lights)
  const adopted = [];    // the zone's own (adopt)

  // The cove's glow on the ceiling round it (the model's cove itself is a 5 cm strip): it takes
  // the cove's colour, so the Strip Light reads from across the room.
  group.add(coveGlow(room.cove.material));

  // A dark lobby behind the entrance, so the doorway doesn't open on nothing. Seen from inside
  // only (its faces point in), so from the room its near face is open.
  const lobby = new THREE.Mesh(new THREE.BoxGeometry(3.4, ENTRY.height + 0.2, 3), new THREE.MeshBasicMaterial({ color: 0x0d0f12, side: THREE.BackSide }));
  lobby.position.set(ENTRY.x, (ENTRY.height + 0.2) / 2 - 0.01, ENTRY.z + 0.15 + 1.5);
  lobby.raycast = () => {};
  group.add(lobby);

  room.ready = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    // The display faces are hidden first, so the reflections show the room, not white screens
    // (and the frames and the kiosk, when the zone has its own).
    const screens = new Set(SCREEN_NODES);
    const hidden = new Set([...SCREEN_NODES, ...(showScreens ? [] : FRAME_NODES)]);
    const gone = (o) => hidden.has(o.name) || (!kiosk && /^Kiosk_/.test(o.name));
    model.traverse((o) => { if (o.isMesh && gone(o)) o.visible = false; });
    roomReflections(engine.renderer, model, {
      boxMin: BOX_MIN, boxMax: BOX_MAX, isFloor: (o) => o.name === FLOOR,
      centre: new THREE.Vector3(0, 1.8, 1.2), low: new THREE.Vector3(0, 0.16, 1.2),
    });
    group.add(model);

    model.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) {
        // The baked light is in these textures: filter them anisotropically, or walls and floor
        // seen at a glancing angle go soft.
        for (const t of [m.emissiveMap, m.aoMap, m.normalMap, m.metalnessMap, m.roughnessMap]) {
          if (!t) continue;
          t.anisotropy = engine.renderer.capabilities.getMaxAnisotropy();
          t.needsUpdate = true;
        }
        if (m.emissiveMap) engine.renderer.initTexture(m.emissiveMap);
      }
      if (o.name !== FLOOR && !gone(o)) occluders.push(o);
      if (o.name !== DISC && o.name !== COVE && o.name !== KIOSK_SCREEN && !screens.has(o.name)) {
        for (const m of [o.material].flat()) if (m.emissiveMap && !baked.includes(m)) baked.push(m);
      }
    });

    // The lights the Environment page runs (after the reflections were captured from their baked glow).
    const disc = model.getObjectByName(DISC), cove = model.getObjectByName(COVE);
    if (disc && room.disc.material) disc.material = room.disc.material;
    if (cove) cove.material = room.cove.material;
    if (!showScreens) for (const sh of FRAME_SHADOWS) repaintShadow(model.getObjectByName(sh.mesh), sh);
    room.env = model.userData.reflectionTargets[0].texture;
    for (const m of adopted) { m.envMap = room.env; m.needsUpdate = true; }
    // The kiosk's glass is dark until its page shows on it.
    const glass = model.getObjectByName(KIOSK_SCREEN);
    if (glass) { glass.material.emissive.set(0x06080b); glass.material.emissiveIntensity = 1; }

    const floor = glossFloor(model.getObjectByName(FLOOR));
    if (floor) {
      group.add(floor);
      room.floor = floor;
      room.setReflections = (on) => { floor.visible = on; };
      room.setReflections(engine.quality === 'high');
    }
    room.setLight(room.light);   // as the lights are now (they may have changed while it loaded)
    return model;
  });

  return room;
}

/**
 * The three wall screens' places (WALL_SCREENS) into `parent`, each with its frame. Returns
 * { sections, hits, materials }: sections, left to right, { group (put the display in it, facing
 * +z), width, height }; hits: the frames; materials: to adopt into the room's light.
 */
export function buildWall(parent) {
  // As WallDisplay's own bezel, shared by the two displays in each place (the Nex's and the canvas's).
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.5, metalness: 0.6, emissive: 0x050608 });
  const hits = [];
  const sections = WALL_SCREENS.map(({ x }) => {
    const g = new THREE.Group();
    g.position.set(x, SCREEN_Y, SCREEN_Z);
    parent.add(g);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(SCREEN_W + 0.12, SCREEN_H + 0.12, 0.1), frameMat);
    frame.position.z = -0.055;
    g.add(frame);
    hits.push(frame);
    return { group: g, width: SCREEN_W, height: SCREEN_H };
  });
  return { sections, hits, materials: [frameMat] };
}

/**
 * The kiosk (KIOSK) into `parent`. Returns { group, mount, hits, materials }: group, the whole
 * kiosk (move it to move the kiosk); mount, the group on its screen (put the page in it, facing +z,
 * KIOSK.w × KIOSK.h); hits: what you point at to use it.
 */
export function buildKiosk(parent) {
  const g = new THREE.Group();
  g.position.set(KIOSK.x, 0, KIOSK.z);
  parent.add(g);
  // Lit mostly from within, as the room's baked surfaces are; enough is left to show the shape.
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f3ef, roughness: 0.6, metalness: 0, emissive: 0xb8b6b0 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x8e9096, roughness: 0.35, metalness: 0.4, emissive: 0x3a3b3e });
  const black = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.3, metalness: 0.2 });

  // Flat base plate.
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.92, 0.035, 0.68, 3, 0.017), white);
  plate.position.set(0, 0.0175, 0.04);

  // Cranked column, as a side profile (z toward the entrance, y up) extruded across its width:
  // the lower part leans back, the upper part rises straight into the head.
  const bend = 0.5, back = 0.24, lean = 0.2, top = KIOSK.centreY - 0.06;
  const profile = new THREE.Shape([
    [0.14, 0.035], [0.14 - lean, bend], [0.14 - lean, top],
    [0.14 - lean - back, top + 0.12], [0.14 - lean - back, bend], [0.14 - back, 0.035],
  ].map(([z, y]) => new THREE.Vector2(z, y)));
  const colW = 0.46;
  const colGeo = new THREE.ExtrudeGeometry(profile, { depth: colW, bevelEnabled: false });
  // The shape is drawn in x/y: turn it so its x is the room's z, and centre the extrusion.
  colGeo.rotateY(-Math.PI / 2);
  colGeo.translate(colW / 2, 0, 0);
  const column = new THREE.Mesh(colGeo, white);

  // Two grey panels on the front of the upright.
  for (const x of [-0.095, 0.095]) {
    const p = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.16, 0.012, 2, 0.005), grey);
    p.position.set(x, bend + 0.17, 0.14 - lean + 0.006);
    g.add(p);
  }

  // Tilted head: a deep white box with a thin black reveal round the glass. Leaning back: its top
  // edge is further from the visitor and higher, the screen facing up and toward the entrance.
  const mount = new THREE.Group();
  mount.position.set(0, KIOSK.centreY, 0);
  mount.rotation.x = -(Math.PI / 2 - KIOSK.tilt);
  const head = new THREE.Mesh(new RoundedBoxGeometry(KIOSK.w + KIOSK.bezel * 2, KIOSK.h + KIOSK.bezel * 2, KIOSK.depth, 4, KIOSK.round), white);
  head.position.z = -KIOSK.depth / 2 - 0.004;
  const reveal = new THREE.Mesh(roundedRect(KIOSK.w + 0.03, KIOSK.h + 0.03, KIOSK.round * 0.5), black);
  reveal.position.z = -0.002;
  mount.add(head, reveal);
  g.add(plate, column, mount);
  return { group: g, mount, hits: [plate, column, head, reveal], materials: [white, grey, black] };
}

/** A flat rectangle with rounded corners (radius r), centred, facing +z. */
function roundedRect(w, h, r) {
  const x = w / 2, y = h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  return new THREE.ShapeGeometry(shape, 6);
}

// The cove's centre line (a rounded rectangle round the ceiling, from the model) and its glow.
const COVE_LINE = { hx: 7.405, hz: 4.357, r: 0.45, y: 4.155 };
const COVE_GLOW = { inner: 0.42, outer: 0.17, level: 0.55 };   // metres in toward the room and out to the wall

/**
 * A soft band of light along the cove on the ceiling, brightest on the cove and fading either side,
 * added on top (so it shows the cove's colour, and nothing when it's off). It follows `material`'s
 * colour, the strip light's (RoomDevices sets it).
 */
function coveGlow(material) {
  const { hx, hz, r, y } = COVE_LINE;
  const path = [];   // points along the centre line with their outward normal (x, z)
  const corners = [[hx - r, hz - r, 0], [-(hx - r), hz - r, Math.PI / 2], [-(hx - r), -(hz - r), Math.PI], [hx - r, -(hz - r), Math.PI * 1.5]];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2);
      path.push([cx + r * Math.cos(a), cz + r * Math.sin(a), Math.cos(a), Math.sin(a)]);
    }
  }
  path.push(path[0]);
  const pos = [], fade = [], index = [];
  for (const [x, z, nx, nz] of path) {
    for (const [d, f] of [[-COVE_GLOW.inner, 0], [0, 1], [COVE_GLOW.outer, 0]]) { pos.push(x + nx * d, y, z + nz * d); fade.push(f); }
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = i * 3, b = a + 3;
    for (let k = 0; k < 2; k++) index.push(a + k, b + k, b + k + 1, a + k, b + k + 1, a + k + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('fade', new THREE.Float32BufferAttribute(fade, 1));
  geometry.setIndex(index);
  const uniforms = { color: { value: new THREE.Color() } };
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    vertexShader: 'attribute float fade; varying float vFade; void main(){ vFade = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 color; varying float vFade; void main(){ gl_FragColor = vec4(color * vFade * vFade, 1.0); }',
  }));
  mesh.onBeforeRender = () => uniforms.color.value.copy(material.color).multiplyScalar(COVE_GLOW.level);
  mesh.raycast = () => {};
  mesh.name = 'cove-glow';
  return mesh;
}
