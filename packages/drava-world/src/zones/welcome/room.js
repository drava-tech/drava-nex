import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { glossFloor, roomReflections } from '../../core/bakedRoom.js';

/**
 * Architecture of the Welcome Zone: the client's model, public/zone1.glb (WTZ1, the baked
 * reference at https://wtz1-baked-model.lunarhill2.chatgpt.site/), shown exactly as that viewer
 * shows it. Its light is baked into each material's emissive map; this file adds what the
 * reference viewer adds on top, as it does: room reflections (the baked room captured into an
 * environment map, box-projected so they stay put as the camera moves) and, on high quality, a
 * soft gloss reflection on the floor. The zone also matches the viewer's lens and turns bloom
 * off (WelcomeZone.js).
 *
 * Plan (metres, looking down, +x right, +z toward the entrance; the model is lowered by its
 * floor's thickness, so the floor is at y = 0):
 *   Interior      x -4.42..4.42, z -4.42..6.97, ceiling 4.14 (a glowing disc in the middle)
 *   Back wall     red lacquer, the 16:9 screen (SCREEN): the brand wall
 *   Back left     the kiosk cabinet (KIOSK): the Holobox
 *   Left wall     red lacquer and the White Tusker logo (no door: a button takes the visitor on)
 *   Right wall    plain graphite: the Mosaic (ART)
 */
export const MODEL_URL = '/drava-world/zone1.glb';
const FLOOR_Y = 0.03;                                // top of the model's floor slab

export const ROOM = { minX: -4.42, maxX: 4.42, minZ: -4.42, maxZ: 6.97, height: 4.14 };
// The model's screen on the back wall (its white face, at z = -4.07).
export const SCREEN = { x: 0.635, y: 1.77, z: -4.07, width: 4.87, height: 2.74 };
// The kiosk cabinet in the back-left corner: open at the front, a lit back panel inside.
// Centre of its footprint, the way it faces, and the floor of its niche.
export const KIOSK = { x: -3.15, z: -3.37, rotY: Math.atan2(0.28, 1.05), floor: 0.24 };
// The red lacquer block the screen stands on: the model's, on the back wall (its face 0.305 m out
// from the wall, 0.275..3.323 m high), and a copy of it on the right wall for the Mosaic wall.
// The screen sits 4.5 cm in front of its face and 0.73 m in from its right end.
const RED = { depth: 0.305, y0: 0.305 - FLOOR_Y, y1: 3.353 - FLOOR_Y, margin: 0.73 };
// The Mosaic on the right wall, toward the entrance, set out like the brand wall: on its
// own red block, at the same height. Centre (screen face) and height; 16:9, the size of the screen.
// Far enough forward that its stop keeps clear of the other stops' rings.
export const ART = { x: ROOM.maxX - RED.depth - 0.045, z: 3.4, y: SCREEN.y };

// Meshes in the model (by node name). A node with several materials loads as a group of meshes.
const FLOOR = 'Box001';
const DISPLAY = 'Rectangle002';                       // the back-wall screen and its trim
const KIOSK_MESH = 'Box197';
const LACQUER = 'Line001';                            // the red lacquer: left wall and the block on the back wall
const isNode = (o, name) => o.name === name || o.parent?.name === name;
// Box projection volume for the reflections: the model's outer box, in model coordinates.
const BOX_MIN = new THREE.Vector3(-4.572, 0.0, -4.572);
const BOX_MAX = new THREE.Vector3(4.572, 4.274, 7.138);

export function buildRoom(scene, { engine }) {
  const group = new THREE.Group();
  group.name = 'welcome-room';
  scene.add(group);

  const occluders = [];
  const room = {
    group, occluders,
    screen: null,                                     // the model's own screen face (hidden: the brand wall sits on it)
    kiosk: [],                                        // the kiosk's meshes (the Holobox's hit targets)
    backdrop: [],                                     // the kiosk's materials, dimmed while the hologram shows
    ready: null,
    /**
     * dim: 0..1, the kiosk dimmed for the hologram: its lit back panel and bright metal would wash
     * out a hologram drawn in light, so its glow and its reflections go down. The rest of the room
     * always shows exactly as the model is baked.
     */
    setKioskDim(dim) {
      for (const m of room.backdrop) { m.emissiveIntensity = m.userData.emissiveFull * (1 - dim); m.envMapIntensity = 1 - 0.8 * dim; }
    },
    setReflections: () => {},
  };

  room.ready = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    const model = gltf.scene;
    model.position.y = -FLOOR_Y;
    model.updateMatrixWorld(true);
    roomReflections(engine.renderer, model, {
      boxMin: BOX_MIN, boxMax: BOX_MAX, isFloor: (o) => isNode(o, FLOOR),
      centre: new THREE.Vector3(0, 1.8, 0.4), low: new THREE.Vector3(0, 0.16, 0.4),
    });
    group.add(model);

    model.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) {
        m.userData.emissiveFull = m.emissiveIntensity;
        // The baked light is in these textures: filter them anisotropically, or walls and floor seen
        // at a glancing angle (most of them, from inside the room) go soft.
        for (const t of [m.emissiveMap, m.aoMap, m.normalMap, m.metalnessMap, m.roughnessMap]) {
          if (!t) continue;
          t.anisotropy = engine.renderer.capabilities.getMaxAnisotropy();
          t.needsUpdate = true;
        }
        if (m.emissiveMap) engine.renderer.initTexture(m.emissiveMap);
      }
      if (isNode(o, KIOSK_MESH)) {
        room.kiosk.push(o);
        room.backdrop.push(...[o.material].flat());
      } else if (!isNode(o, FLOOR)) occluders.push(o);
    });
    // The brand wall's screen covers the model's white screen face; hide that face so the two don't fight.
    const display = model.getObjectByName(DISPLAY);
    display?.traverse((o) => {
      if (!o.isMesh) return;
      const mats = [o.material].flat();
      if (mats.length === 1 && /white display/i.test(mats[0].name)) { o.visible = false; room.screen = o; }
    });

    // The red block behind the Mosaic wall: the model's own lacquer, lit by its own baked light.
    const lacquer = model.getObjectByName(LACQUER);
    if (lacquer) {
      const block = redBlock(lacquer.material);
      group.add(block);
      occluders.push(block);
    }

    const floor = glossFloor(model.getObjectByName(FLOOR));
    if (floor) {
      group.add(floor);
      room.setReflections = (on) => { floor.visible = on; };
      room.setReflections(engine.quality === 'high');
    }
    return model;
  });

  return room;
}

/**
 * The red lacquer round the back-right corner and along the right wall behind the Mosaic wall:
 * the model's own panel, carried on. The model's runs along the left wall, round the back-left
 * corner (radius 0.615 m) and along the back wall behind the brand screen; this one picks it up just
 * before its right end, turns the back-right corner on the same radius and runs along the right wall
 * as deep and as high, to the same margin past the data art screen. It shares the model's material,
 * and its baked light is the back block's: round the data art screen, the stretch round the brand
 * screen (that face's UVs run straight with x and y), so it is lit just as that one is, glow of the
 * screen included; from the corner to there, one column of the brand screen's left margin, where it
 * meets that stretch, so no seam shows.
 */
function redBlock(material) {
  // The back block's face (model coordinates, z = -4.115): x -3.504..3.804 runs v 0.6692..0.1484,
  // y 0.305..3.353 runs u 0.7681..0.9992; uv1 (the fine metal grain) is 2.5 per metre.
  const faceU = (y) => 0.7681 + ((y + FLOOR_Y - 0.305) / 3.048) * (0.9992 - 0.7681);
  const faceV = (x) => 0.6692 + ((x + 3.504) / 7.308) * (0.1484 - 0.6692);
  const xFace = ROOM.maxX - RED.depth, xWall = ROOM.maxX, zBack = ROOM.minZ + RED.depth;
  const { y0, y1 } = RED;
  // Round the data art screen: the brand screen's stretch, the same margin either side.
  const bx0 = SCREEN.x - SCREEN.width / 2 - RED.margin, bx1 = SCREEN.x + SCREEN.width / 2 + RED.margin;
  const z0 = ART.z - (bx1 - bx0) / 2, z1 = ART.z + (bx1 - bx0) / 2;
  const v = (z) => faceV(z >= z0 ? bx0 + (z - z0) : bx0);

  // The path along the face, seen from above: the corner arc (centre 0.615 m in from both walls,
  // tangent to the back block's face and to the right wall's), then straight along the right wall.
  const R = 0.615, cx = xFace - R, cz = zBack + R, N = 16;
  const path = [];
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * (Math.PI / 2);                    // 0: on the back face, facing +z; π/2: on the right wall, facing -x
    path.push({ x: cx + R * Math.sin(a), z: cz - R * Math.cos(a), nx: -Math.sin(a), nz: Math.cos(a) });
  }
  path.push({ x: xFace, z: z0, nx: -1, nz: 0 }, { x: xFace, z: z1, nx: -1, nz: 0 });   // z0: where the data art stretch's light starts
  let s = 0;
  path.forEach((p, i) => { if (i) s += Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z); p.s = s; });

  const pos = [], nor = [], uv = [], uv1 = [], index = [];
  const vert = (x, y, z, n, z4uv) => {
    pos.push(x, y, z); nor.push(...n); uv.push(faceU(y), v(z4uv)); uv1.push((x + z) * 2.5, y * 2.5);
    return pos.length / 3 - 1;
  };
  // The face: a strip up the path (each point lit as the column it falls on: the arc and the run up
  // to the data art stretch all take its first column).
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const za = a.x === xFace ? a.z : -Infinity, zb = b.x === xFace ? b.z : -Infinity;
    const p = vert(a.x, y0, a.z, [a.nx, 0, a.nz], za), q = vert(b.x, y0, b.z, [b.nx, 0, b.nz], zb);
    const r = vert(b.x, y1, b.z, [b.nx, 0, b.nz], zb), t = vert(a.x, y1, a.z, [a.nx, 0, a.nz], za);
    index.push(p, q, r, p, r, t);
  }
  // The end past the data art screen, then the top and the bottom (fans from the corner over the arc,
  // and strips along the run), each lit as the face's edge next to it.
  {
    const p = vert(xWall, y0, z1, [0, 0, 1], z1), q = vert(xFace, y0, z1, [0, 0, 1], z1);
    const r = vert(xFace, y1, z1, [0, 0, 1], z1), t = vert(xWall, y1, z1, [0, 0, 1], z1);
    index.push(p, q, r, p, r, t);
  }
  for (const [y, up] of [[y1, 1], [y0, -1]]) {
    const corner = vert(xWall, y, ROOM.minZ, [0, up, 0], -Infinity);
    for (let k = 0; k < N; k++) {
      const a = path[k], b = path[k + 1];
      const p = vert(a.x, y, a.z, [0, up, 0], -Infinity), q = vert(b.x, y, b.z, [0, up, 0], -Infinity);
      index.push(...(up > 0 ? [corner, q, p] : [corner, p, q]));
    }
    const a = vert(xFace, y, cz, [0, up, 0], -Infinity), b = vert(xFace, y, z1, [0, up, 0], z1);
    const c = vert(xWall, y, z1, [0, up, 0], z1), d = vert(xWall, y, cz, [0, up, 0], -Infinity);
    index.push(...(up > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'welcome-red-block';
  return mesh;
}
