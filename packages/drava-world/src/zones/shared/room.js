import * as THREE from 'three';
import { COLOR } from '../../config.js';
import { panelTexture, terrazzoTexture } from '../../util/textures.js';

const PANEL = 1.2;          // wall panel module (m)
const BORDER = 0.5;         // stone border round the floor (m)
const COVE = 0.35;          // the ceiling's perimeter light line, in from the walls (m)

/** The wall cladding (panelTexture) for a room `height` tall; give each wall mesh wallUVs(). */
export function wallFinish(height) {
  return new THREE.MeshStandardMaterial({ map: panelTexture(height), roughness: 0.93 });
}

/** Map a wall box's UVs from its position in the room, so panels and the datum line up across every run and lintel. */
export function wallUVs(mesh, height) {
  const { position: p, normal: n, uv } = mesh.geometry.attributes;
  const o = mesh.position;
  for (let i = 0; i < p.count; i++) {
    const along = Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) + o.z : p.getX(i) + o.x;
    uv.setXY(i, along / PANEL, Math.abs(n.getY(i)) > 0.5 ? 0.5 : (p.getY(i) + o.y) / height);
  }
}

/** A dark honed-stone border round the floor with a thin metal inlay where it meets the terrazzo. */
export function floorBorder({ minX, maxX, minZ, maxZ }) {
  const W = maxX - minX, D = maxZ - minZ;
  const frame = (out, inset, y, mat) => {
    const s = new THREE.Shape().moveTo(-W / 2 + out, -D / 2 + out).lineTo(W / 2 - out, -D / 2 + out).lineTo(W / 2 - out, D / 2 - out).lineTo(-W / 2 + out, D / 2 - out);
    s.holes.push(new THREE.Path().moveTo(-W / 2 + inset, -D / 2 + inset).lineTo(-W / 2 + inset, D / 2 - inset).lineTo(W / 2 - inset, D / 2 - inset).lineTo(W / 2 - inset, -D / 2 + inset));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2), mat);
    m.position.set((minX + maxX) / 2, y, (minZ + maxZ) / 2);
    return m;
  };
  const g = new THREE.Group();
  g.add(frame(0, BORDER, 0.004, new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.55 })));
  g.add(frame(BORDER - 0.012, BORDER, 0.005, new THREE.MeshStandardMaterial({ color: 0x7a6a55, roughness: 0.35, metalness: 0.85 })));
  return g;
}

/** The ceiling's perimeter light line: [w, d, x, z] for each of its four runs. */
export function coveRuns({ minX, maxX, minZ, maxZ }) {
  const W = maxX - minX - 2 * COVE, D = maxZ - minZ - 2 * COVE, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  return [[W, 0.04, cx, minZ + COVE], [W, 0.04, cx, maxZ - COVE], [0.04, D, minX + COVE, cz], [0.04, D, maxX - COVE, cz]];
}

/** A brand-red inlay across a doorway's threshold, just inside the room. along: 'x' (front/back wall) or 'z' (side walls). */
export function thresholdInlay(width, x, z, along) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(along === 'x' ? width : 0.05, along === 'x' ? 0.05 : width).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(COLOR.brand).multiplyScalar(1.3) }),
  );
  m.position.set(x, 0.006, z);
  return m;
}

/**
 * A plain room for a zone: terrazzo floor in a stone border, panelled dark walls, a ceiling with
 * white light lines framed by a perimeter light line, a red inlay at each doorway's threshold
 * and warm point lights (switched off by ROOM_LIGHTS in config.js). Walls can have
 * doorway openings.
 *
 *   bounds    { minX, maxX, minZ, maxZ, height } of the inside, in metres
 *   openings  [{ wall: 'front' | 'back' | 'left' | 'right', at, width, height }]
 *             front is the wall at maxZ, back at minZ, left at minX, right at maxX;
 *             `at` is the opening's centre along the wall (x for front/back, z for left/right)
 *   along     'z' (default): the ceiling's light lines run front to back, the skirting lines
 *             along the left and right walls; 'x': the ceiling lines run side to side and the
 *             skirting lines along the front and back walls (broken at their doorways), for a
 *             room whose exhibits stand against its side walls
 *
 * classic: the plain room from before the panelled finish (flat walls, no border, cove or inlays).
 * ceilingLines: false leaves out the white lines across the ceiling (a zone whose ceiling is a screen).
 *
 * Returns { occluders, glow, lines } — walls that stop clicks passing through, a helper that
 * adds a glowing strip, and the room's own light lines (ceiling and skirting) with their level.
 */
export function buildRoom(root, { minX, maxX, minZ, maxZ, height }, { openings = [], along = 'z', classic = false, ceilingLines = true } = {}) {
  const occluders = [];
  const lines = [];
  const wallMat = classic ? new THREE.MeshStandardMaterial({ color: 0x22262d, roughness: 0.93 }) : wallFinish(height);
  const box = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    if (!classic) wallUVs(m, height);
    root.add(m);
    occluders.push(m);
  };
  const glow = (w, h, d, x, y, z, level = 0.9) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(COLOR.warmWhite).multiplyScalar(level) }));
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  const W = maxX - minX, D = maxZ - minZ;

  const terrazzo = terrazzoTexture(1024);
  terrazzo.repeat.set(W / 4, D / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: terrazzo, color: 0xb4b8c0, roughness: 0.42 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  root.add(floor);
  if (!classic) root.add(floorBorder({ minX, maxX, minZ, maxZ }));

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.6, D + 0.6), new THREE.MeshStandardMaterial({ color: 0x101217, roughness: 0.96 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((minX + maxX) / 2, height, (minZ + maxZ) / 2);
  root.add(ceiling);
  if (ceilingLines && along === 'x') {
    const count = Math.max(2, Math.round(D / 4));
    for (let i = 0; i < count; i++) lines.push({ mesh: glow(W - 1.6, 0.03, 0.07, (minX + maxX) / 2, height - 0.02, minZ + ((i + 0.5) / count) * D, 0.55), level: 0.55 });
  } else if (ceilingLines) {
    const count = Math.max(2, Math.round(W / 4));
    for (let i = 0; i < count; i++) lines.push({ mesh: glow(0.07, 0.03, D - 1.6, minX + ((i + 0.5) / count) * W, height - 0.02, (minZ + maxZ) / 2, 0.55), level: 0.55 });
  }
  if (!classic) for (const [w, d, x, z] of coveRuns({ minX, maxX, minZ, maxZ })) lines.push({ mesh: glow(w, 0.02, d, x, height - 0.015, z, 0.4), level: 0.4 });

  // Each wall is built as solid runs between its openings, with a lintel over each opening.
  const t = 0.2;
  const walls = {
    front: { from: minX, to: maxX, place: (a, b) => [(a + b) / 2, maxZ + t / 2, b - a, t] },
    back: { from: minX, to: maxX, place: (a, b) => [(a + b) / 2, minZ - t / 2, b - a, t] },
    left: { from: minZ - t, to: maxZ + t, place: (a, b) => [minX - t / 2, (a + b) / 2, t, b - a] },
    right: { from: minZ - t, to: maxZ + t, place: (a, b) => [maxX + t / 2, (a + b) / 2, t, b - a] },
  };
  for (const [name, wall] of Object.entries(walls)) {
    const holes = openings.filter((o) => o.wall === name).sort((a, b) => a.at - b.at);
    let cursor = wall.from;
    const solid = (a, b, y0 = 0, y1 = height) => {
      if (b - a < 0.01) return;
      const [x, z, w, d] = wall.place(a, b);
      box(w, y1 - y0, d, x, (y0 + y1) / 2, z);
    };
    for (const o of holes) {
      const inside = 0.22;   // the inlay sits just inside the room, in front of the portal's frame
      if (!classic) root.add(name === 'front' ? thresholdInlay(o.width, o.at, maxZ - inside, 'x')
        : name === 'back' ? thresholdInlay(o.width, o.at, minZ + inside, 'x')
          : name === 'left' ? thresholdInlay(o.width, minX + inside, o.at, 'z')
            : thresholdInlay(o.width, maxX - inside, o.at, 'z'));
      const a = o.at - (o.width + 0.2) / 2, b = o.at + (o.width + 0.2) / 2;
      solid(cursor, a);
      solid(a, b, o.height + 0.1, height);
      cursor = b;
    }
    solid(cursor, wall.to);
  }

  // Skirting light lines along the side walls (or the front and back, broken at their doorways).
  if (along === 'x') {
    for (const [name, z] of [['back', minZ + 0.03], ['front', maxZ - 0.03]]) {
      let x0 = minX + 0.2;
      const runs = [];
      for (const o of openings.filter((o) => o.wall === name).sort((a, b) => a.at - b.at)) {
        runs.push([x0, o.at - o.width / 2 - 0.3]);
        x0 = o.at + o.width / 2 + 0.3;
      }
      runs.push([x0, maxX - 0.2]);
      for (const [a, b] of runs) if (b - a > 0.1) lines.push({ mesh: glow(b - a, 0.02, 0.02, (a + b) / 2, 0.06, z, 0.5), level: 0.5 });
    }
  } else {
    for (const x of [minX + 0.03, maxX - 0.03]) lines.push({ mesh: glow(0.02, 0.02, D - 0.4, x, 0.06, (minZ + maxZ) / 2, 0.5), level: 0.5 });
  }

  root.add(new THREE.HemisphereLight(0xb9c6d6, 0x0b0c0f, 0.4));
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  for (const [x, z, i] of [[cx, cz, 22], [cx, maxZ - 4, 10], [cx, minZ + 4, 10]]) {
    const l = new THREE.PointLight(COLOR.warmWhite, i, 16, 2);
    l.position.set(x, height - 0.5, z);
    root.add(l);
  }
  return { occluders, glow, lines };
}
