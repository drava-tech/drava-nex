import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { glossFloor, roomReflections } from '../../core/bakedRoom.js';

/**
 * Architecture of the Orca Zone: the client's model, public/WT_Retail_Experience_Room/
 * (the product and tangible experience room, 50 × 30 × 14 ft; its README and
 * Dimensions_and_Materials.json give every measure used here), shown as the Welcome and Nex Zones
 * show theirs: its light is baked into each material's emissive map; room reflections and a gloss
 * floor go on top (core/bakedRoom.js).
 *
 * Plan (metres, looking down, +x right, +z toward the entrance; the floor is at y = 0):
 *   Interior      x -7.62..7.62, z -4.572..4.572, ceiling 4.267, the entrance in the rear wall
 *   Front, left   the product wall: six concept shoes in gold niches (3 × 2) and a 55" kiosk at
 *                 50° in front of it (KIOSK, SHOES)
 *   Front, right  the tangible table: a 75" touch surface at 0.94 m with three pucks (TABLE,
 *                 PUCKS), facing an 85" screen on the wall (WALL)
 *
 * The kiosk, table and wall screens are the model's own surfaces; the zone draws on them (their
 * UVs map the whole picture, glTF style: v = 0 at the top).
 */
export const MODEL_URL = '/drava-world/WT_Retail_Experience_Room/WT_Retail_Experience_Room.glb';

export const ROOM = { minX: -7.62, maxX: 7.62, minZ: -4.572, maxZ: 4.572, height: 4.267 };
export const ENTRY = { x: 0, z: 4.572, width: 2.438 };

// The six shoes, in the model's order (top row left to right, then the bottom row): the centre
// of each niche's opening, where the shoe sits.
export const SHOES = [
  { x: -5.1, y: 2.55 }, { x: -3.8, y: 2.55 }, { x: -2.5, y: 2.55 },
  { x: -5.1, y: 1.35 }, { x: -3.8, y: 1.35 }, { x: -2.5, y: 1.35 },
].map((s, i) => ({ ...s, z: -4.17, n: String(i + 1).padStart(2, '0') }));
export const WALL_Z = -4.385;   // the face of the product and tangible feature panels

// The kiosk's 55" screen (16:9), inclined 50° above horizontal, facing the entrance.
export const KIOSK = {
  x: -3.8, z: -1.85,
  screen: { x: -3.8, y: 1.258, z: -1.805, w: 1.2176, h: 0.6849, tilt: THREE.MathUtils.degToRad(50) },
};
// The table's 75" touch surface (16:9) and the 85" wall screen it faces.
export const TABLE = { x: 3.8, z: -2.12, y: 0.94, w: 1.6604, d: 0.9339 };
export const WALL = { x: 3.8, y: 2.24, z: -4.31, w: 1.8817, h: 1.0585 };
// The three pucks: their places on the glass as the model has them, and the token on each.
export const PUCKS = [
  { x: 3.29, z: -2.02, token: 'Tangible_Token_Cylinder' },
  { x: 3.83, z: -2.31, token: 'Tangible_Token_Cube' },
  { x: 4.31, z: -1.97, token: 'Tangible_Token_Sphere' },
].map((p, i) => ({ ...p, puck: `Tangible_Puck_0${i + 1}`, ring: `Tangible_Puck_0${i + 1}_Recognition_Ring` }));

const FLOOR = 'Floor';
// Box projection volume for the reflections: the model's outer box.
const BOX_MIN = new THREE.Vector3(-7.77, 0, -4.722);
const BOX_MAX = new THREE.Vector3(7.77, 4.387, 4.722);

/**
 * Builds the room into `scene` and starts loading the model. Returns at once:
 *   group, occluders (filled when the model is in), ready (resolves with the model),
 *   setReflections(on): the gloss floor, on high quality.
 */
export function buildRoom(scene, { engine }) {
  const group = new THREE.Group();
  group.name = 'objects-room';
  scene.add(group);

  const occluders = [];
  const room = { group, occluders, ready: null, setReflections: () => {} };

  // A dark lobby behind the entrance, so the doorway doesn't open on nothing (faces point in).
  const lobby = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.95, 3), new THREE.MeshBasicMaterial({ color: 0x0d0f12, side: THREE.BackSide }));
  lobby.position.set(ENTRY.x, 1.465, ENTRY.z + 0.15 + 1.5);
  lobby.raycast = () => {};
  group.add(lobby);

  room.ready = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    roomReflections(engine.renderer, model, {
      boxMin: BOX_MIN, boxMax: BOX_MAX, isFloor: (o) => o.name === FLOOR,
      centre: new THREE.Vector3(0, 1.8, 0.8), low: new THREE.Vector3(0, 0.16, 0.8),
    });
    group.add(model);
    model.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) {
        // The baked light is in these textures: filter them anisotropically, or surfaces seen at
        // a glancing angle go soft.
        for (const t of [m.emissiveMap, m.aoMap, m.normalMap, m.metalnessMap, m.roughnessMap]) {
          if (!t) continue;
          t.anisotropy = engine.renderer.capabilities.getMaxAnisotropy();
          t.needsUpdate = true;
        }
        if (m.emissiveMap) engine.renderer.initTexture(m.emissiveMap);
      }
      if (o.name !== FLOOR) occluders.push(o);
    });
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
 * Put a canvas on one of the model's screens (the kiosk, the table, the wall screen): it shows
 * exactly as drawn, at full brightness, through the model's own UVs.
 */
export function screenTexture(mesh, texture) {
  texture.flipY = false;       // glTF UVs: v = 0 at the top
  texture.needsUpdate = true;
  mesh.material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
}
