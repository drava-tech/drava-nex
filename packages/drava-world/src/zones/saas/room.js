import * as THREE from 'three';
import { buildBakedRoom } from '../../core/bakedRoom.js';

/**
 * Architecture of the SaaS Zone: the client's model, public/WT_Room_40x30_Dual_Screens_Package/
 * (the dual-screen room, 40 × 30 × 14 ft; its README and Dimensions_and_Materials.json give every
 * measure used here), shown as the other client rooms are: its light is baked into each material's
 * emissive map; room reflections and a gloss floor go on top (core/bakedRoom.js).
 *
 * Plan (metres, looking down, +x right, +z toward the entrance; the floor is at y = 0):
 *   Interior      x -6.096..6.096, z -4.572..4.572, ceiling 4.267, the entrance in the rear wall
 *   Front wall    red metal, two 16 × 9 ft screens with the White Tusker lettering between them
 *   Ceiling       a 20 ft glowing disc and a warm cove round the edge
 * The two screens are the model's own surfaces: the zone sets its displays exactly on them (SCREENS)
 * and the model's white faces are hidden.
 */
export const MODEL_URL = '/drava-world/WT_Room_40x30_Dual_Screens_Package/WT_Room_40x30_Dual_Screens/WT_Room_40x30_Dual_Screens.glb';

export const ROOM = { minX: -6.096, maxX: 6.096, minZ: -4.572, maxZ: 4.572, height: 4.267 };
export const ENTRY = { x: 0, z: 4.572, width: 2.438, height: 2.743 };

// The two screens (active area 16 × 9 ft) on the front wall, facing the room (+z): centre and node.
export const SCREEN_W = 4.8768, SCREEN_H = 2.7432, SCREEN_Y = 1.9812, SCREEN_Z = -4.422;
export const SCREENS = { left: { x: -2.8956, node: 'Screen_Front_Left' }, right: { x: 2.8956, node: 'Screen_Front_Right' } };

// Box projection volume for the reflections: the model's outer box.
const BOX_MIN = new THREE.Vector3(-6.25, 0, -4.722);
const BOX_MAX = new THREE.Vector3(6.25, 4.387, 4.722);

/** Builds the room into `scene` and starts loading the model (core/bakedRoom.js buildBakedRoom). */
export function buildRoom(scene, { engine }) {
  return buildBakedRoom(scene, {
    engine, url: MODEL_URL, name: 'saas-room', box: [BOX_MIN, BOX_MAX], probe: { x: 0, z: 1.2 },
    hide: Object.values(SCREENS).map((s) => s.node), entry: ENTRY,
  });
}
