import * as THREE from 'three';
import { buildBakedRoom, repaintShadow } from '../../core/bakedRoom.js';

/**
 * Architecture of the Simulation Zone: the client's model, public/WT_Training_Room_30x30.glb (the
 * training room, 30 × 30 × 14 ft; reference viewer https://wt-training-room.lunarhill2.chatgpt.site/),
 * shown as the other client rooms are (core/bakedRoom.js).
 *
 * Plan (metres, looking down, +x right, +z toward the entrance; the floor is at y = 0):
 *   Interior      x -4.572..4.572, z -4.572..4.572, ceiling 4.267, the entrance in the rear wall
 *   Front wall    red metal, the White Tusker lettering high in the middle (the model's 18 × 10 ft
 *                 screen and its frame are hidden: the bench stands against this wall, 2026-10-11;
 *                 their baked shadow on the panel is repainted, clearScreenShadow)
 *   Middle        a 6 ft black work table, its top inclined 50° above horizontal: hidden here (the
 *                 client chose our own bench and its trainer screen instead, 2026-10-11)
 */
export const MODEL_URL = '/drava-world/WT_Training_Room_30x30.glb';

export const ROOM = { minX: -4.572, maxX: 4.572, minZ: -4.572, maxZ: 4.572, height: 4.267 };
export const ENTRY = { x: 0, z: 4.572, width: 2.438, height: 2.743 };
// Under the ceiling inset, for the bench's lamp.
export const CEILING = 4.15;

// The face of the front wall's red panel, which the bench stands against.
export const FRONT_FACE = -4.52;

// The model's work table, hidden.
const WORK_TABLE = ['Top', 'Lower_Ledge', 'Left_Support', 'Left_Foot', 'Left_Toe_Reveal', 'Right_Support', 'Right_Foot', 'Right_Toe_Reveal', 'Underside_Accent']
  .map((p) => `Work_Table_${p === 'Top' ? '50deg_Top' : p}`);

const BOX_MIN = new THREE.Vector3(-4.72, 0, -4.72);
const BOX_MAX = new THREE.Vector3(4.72, 4.387, 4.72);

/** Builds the room into `scene` and starts loading the model (core/bakedRoom.js buildBakedRoom). */
export function buildRoom(scene, { engine }) {
  return buildBakedRoom(scene, {
    engine, url: MODEL_URL, name: 'simulation-room', box: [BOX_MIN, BOX_MAX], probe: { x: 0, z: 1.2 },
    hide: ['Screen_Front_Center', 'Screen_Front_Center_Frame', ...WORK_TABLE], entry: ENTRY,
    prepare: (model) => clearScreenShadow(model.getObjectByName('Red_Front_Panel')),
  });
}

// The red front panel's baked maps still carry the shadow of the screen and frame, which are hidden:
// repainted across x -2.86..2.86 (its face: x -4.362 → v 0.9994, x 4.362 → v 0.0754; u 0.4762..0.9358).
const clearScreenShadow = (panel) => repaintShadow(panel, { along: [-4.362, 0.9994, 4.362, 0.0754], span: [-2.86, 2.86], u: [0.4762, 0.9358] });
