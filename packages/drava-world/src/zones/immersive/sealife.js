import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The animals of the World Zone's ocean (Ocean.js). Each has `object` (add it to the ocean
// scene) and update(dt, t). Sizes are real: sardines ~0.3 m, a whale shark 9 m, a reef manta
// 4.5 m across, moon jellies up to 1 m. Positions are metres from the room's sweet spot.

const f = (n) => n.toFixed(4);
const vec = (hex) => { const c = new THREE.Color(hex); return `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`; };
const rand = (a, b) => a + Math.random() * (b - a);
const up = new THREE.Vector3(0, 1, 0);

/** Triangles (non-indexed, with normals) from a flat list of [x, y, z] corners, three per triangle. */
function tris(points) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/** Merge parts that may be indexed and carry uvs into one non-indexed geometry (position + normal). */
function merge(parts) {
  return mergeGeometries(parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    return n;
  }));
}

/**
 * A lit, fogged material that swims: the body bends side to side in a wave running from head
 * (+z) to tail, stronger toward the tail, and it is countershaded (dark back, pale belly) as
 * fish are. phase: 'aPhase' (a per-instance attribute) or 'uPhase' (a uniform). extra: GLSL run
 * after the colour is set (vObj: the vertex in the model's own space, vUp: its normal's y).
 */
function swimMaterial({ time, back, belly, phase = 'aPhase', freq, wave, amp, head, tail, roughness = 0.5, metalness = 0, extra = '' }) {
  const m = new THREE.MeshStandardMaterial({ roughness, metalness, side: THREE.DoubleSide });
  m.userData.phase = { value: 0 };
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.uniforms.uPhase = m.userData.phase;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uPhase;
        ${phase === 'aPhase' ? 'attribute float aPhase;' : ''}
        varying float vUp; varying vec3 vObj;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += sin(uTime * ${f(freq)} + ${phase} - position.z * ${f(wave)}) * ${f(amp)} * (1.0 - smoothstep(${f(tail)}, ${f(head)}, position.z));
        vUp = normal.y; vObj = position;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vUp; varying vec3 vObj;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(${vec(belly)}, ${vec(back)}, smoothstep(-0.3, 0.5, vUp));
        ${extra}`);
  };
  return m;
}

/* ------------------------------------------------------------------ fish schools */

/** One small schooling fish, ~1.15 units nose to tail, head toward +z. */
function fishGeometry() {
  const body = new THREE.SphereGeometry(1, 16, 10).rotateX(Math.PI / 2);   // poles on the z axis
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = z < 0 ? 1 - 0.82 * Math.pow(-z, 1.15) : 1 - 0.35 * z * z;    // slim tail stock, rounded head
    p.setXYZ(i, x * 0.075 * k, y * 0.15 * k, z * 0.5);
  }
  body.computeVertexNormals();
  const fins = tris([
    [0, 0.02, -0.44], [0, 0.16, -0.64], [0, 0, -0.55],          // tail, upper lobe
    [0, -0.02, -0.44], [0, 0, -0.55], [0, -0.16, -0.64],        // tail, lower lobe
    [0, 0.12, 0.08], [0, 0.12, -0.12], [0, 0.2, -0.1],          // dorsal
  ]);
  return merge([body, fins]);
}

const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * A school: one InstancedMesh of fish that move as a pack. The school's centre wanders round the
 * room on a slow loop; each fish keeps its place in the shoal (an offset in the school's own
 * frame, so the whole shoal wheels when it turns) by steering, so turns ripple through it the
 * way real shoals do, and it flees anything in `predators` (it splits round a passing shark).
 * `lure` ({ pos, from, until }, seconds on the ocean's clock) draws it in: the shoal leaves its loop
 * and wheels round that point as a bait ball until `until`, then swims back. `mid`: where it is now.
 */
export class FishSchool {
  constructor({ count, time, size = 0.3, radius = 15, height = 2, spread = [3.2, 1.3, 4], speed = 2.2, back = 0x1b3550, belly = 0xc7d3de, seed = 0 }) {
    this.count = count;
    this.radius = radius;
    this.height = height;
    this.speed = speed;
    this.seed = seed;
    this.spread = spread;
    this.predators = [];
    this.lure = null;
    this.mid = new THREE.Vector3();
    const geo = fishGeometry();
    const phases = new Float32Array(count).map(() => Math.random() * 6.283);
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    const mat = swimMaterial({ time, back, belly, freq: 11, wave: 6, amp: 0.07, head: 0.35, tail: -0.6, roughness: 0.32, metalness: 0.55 });
    const mesh = (this.object = new THREE.InstancedMesh(geo, mat, count));
    mesh.frustumCulled = false;
    this.fish = Array.from({ length: count }, () => {
      // A shoal is dense in the middle and thins at the edges.
      const o = new THREE.Vector3().randomDirection().multiplyScalar(Math.pow(Math.random(), 0.6));
      return {
        offset: o.multiply(new THREE.Vector3(...spread)),
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: size * rand(0.8, 1.2), wob: Math.random() * 6.28,
      };
    });
    this.centre = new THREE.Vector3();
    this.centreVel = new THREE.Vector3();
    this.#centreAt(0, this.centre);
    for (const fish of this.fish) fish.pos.copy(this.centre).add(fish.offset);
  }

  /** The school's path: a loop round the sweet spot that breathes in and out, rising and sinking. */
  #centreAt(t, out) {
    const a = (t * this.speed) / this.radius + this.seed * 2.1;
    const r = this.radius * (1 + 0.12 * Math.sin(t * 0.05 + this.seed * 3));
    return out.set(Math.cos(a) * r, this.height + 2.6 * Math.sin(t * 0.09 + this.seed), Math.sin(a) * r * 1.15);
  }

  /** Push a fish that has strayed into the room's volume (keepOut: { x, z, y }) back out the nearest side. */
  #keepOut(p) {
    const k = this.keepOut;
    if (!k || Math.abs(p.x) > k.x || Math.abs(p.z) > k.z || p.y > k.y) return;
    const dx = k.x - Math.abs(p.x), dz = k.z - Math.abs(p.z), dy = k.y - p.y;
    if (dx < dz && dx < dy) p.x = Math.sign(p.x) * k.x;
    else if (dz < dy) p.z = Math.sign(p.z) * k.z;
    else p.y = k.y;
  }

  update(dt, t) {
    this.#centreAt(t + 0.5, _a);
    this.centreVel.copy(_a).sub(this.#centreAt(t, this.centre)).multiplyScalar(2);
    const heading = Math.atan2(this.centreVel.x, this.centreVel.z);
    const breathe = 1 + 0.18 * Math.sin(t * 0.4 + this.seed);
    const steer = 1 - Math.exp(-dt * 1.6);
    const L = this.lure;
    let w = 0;                                          // how far the lure has the shoal (0..1)
    if (L && t > L.until) this.lure = null;
    else if (L) w = smooth(L.from, L.from + 1.5, t) * (1 - smooth(L.until - 2.5, L.until, t));
    const swirl = t * 0.9 + this.seed;
    const fastest = this.speed * 2.5 + 3;
    this.mid.set(0, 0, 0);
    this.fish.forEach((fish, i) => {
      // Where this fish wants to be: its place in the shoal, turned with the shoal.
      _b.copy(fish.offset).multiplyScalar(breathe).applyAxisAngle(up, heading).add(this.centre);
      _b.y += Math.sin(t * 0.7 + fish.wob) * 0.25;
      // Lured: a tight ball wheeling round the lure.
      if (w > 0) _b.lerp(_d.copy(fish.offset).multiplyScalar(0.4).applyAxisAngle(up, swirl).add(L.pos), w);
      _c.copy(_b).sub(fish.pos).multiplyScalar(0.9).addScaledVector(this.centreVel, 1 - w);
      for (const p of this.predators) {
        _a.copy(fish.pos).sub(p.position);
        const d = _a.length(), R = p.userData.fear ?? 6;
        if (d < R) _c.addScaledVector(_a.normalize(), (R - d) * 2.2);
      }
      fish.vel.lerp(_c, steer);
      if (fish.vel.lengthSq() > fastest * fastest) fish.vel.setLength(fastest);
      fish.pos.addScaledVector(fish.vel, dt);
      this.#keepOut(fish.pos);
      this.mid.add(fish.pos);
      // Face along the way it swims (lookAt points the matrix's +z from target to eye).
      _m.lookAt(_a.copy(fish.pos).add(fish.vel), fish.pos, up);
      _q.setFromRotationMatrix(_m);
      _m.compose(fish.pos, _q, _s.setScalar(fish.size));
      this.object.setMatrixAt(i, _m);
    });
    this.mid.divideScalar(this.count);
    this.object.instanceMatrix.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ sharks */

const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

/**
 * A body of revolution 1 unit long, head toward +z. profile(s) → [half width, half height] at s
 * (0 at the tail stock, 1 at the snout); ridge(a, s) scales the width round the section.
 */
function tubeBody(profile, ridge = () => 1) {
  const R = 64, S = 32, pos = [], index = [];
  for (let i = 0; i < R; i++) {
    const s = i / (R - 1);
    const [w, h] = profile(s);
    for (let j = 0; j < S; j++) {
      const a = (j / S) * Math.PI * 2, sy = Math.sin(a);
      pos.push(Math.cos(a) * w * ridge(a, s), sy * h * (sy < 0 ? 0.72 : 1) + 0.012 * s, s - 0.5);   // flatter belly
    }
  }
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < S; j++) {
      const a = i * S + j, b = i * S + ((j + 1) % S), c = (i + 1) * S + j, d = (i + 1) * S + ((j + 1) % S);
      index.push(a, b, c, b, d, c);
    }
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setIndex(index);
  body.computeVertexNormals();
  return body;
}

/** A whale shark (scaled to 9 m): broad flat head, ridged flanks, tall tail. */
function whaleSharkGeometry() {
  const body = tubeBody((s) => {
    let w = 0.012 + 0.088 * smooth(0, 0.55, s) * (1 + 0.14 * smooth(0.7, 1, s));
    let h = 0.016 + 0.072 * smooth(0.02, 0.45, s) * (1 - 0.5 * smooth(0.72, 1, s));
    if (s > 0.94) { const c = Math.sqrt(Math.max(0, 1 - ((s - 0.94) / 0.06) ** 2)); w *= c; h *= c; }   // the blunt, wide snout
    return [w, h];
  }, (a, s) => 1 + 0.05 * Math.exp(-(((a % Math.PI) - 0.45) ** 2) * 60) * smooth(0.15, 0.6, s));
  const fins = tris([
    [0, 0.035, -0.47], [0, 0.22, -0.66], [0, 0.012, -0.555],      // tail, upper lobe (the long one)
    [0, -0.012, -0.47], [0, 0.012, -0.555], [0, -0.115, -0.61],   // tail, lower lobe
    [0, 0.035, -0.47], [0, 0.012, -0.555], [0, -0.012, -0.47],
    [0, 0.075, -0.02], [0, 0.075, -0.15], [0, 0.185, -0.19],      // first dorsal
    [0, 0.04, -0.3], [0, 0.04, -0.36], [0, 0.08, -0.38],          // second dorsal
    [0.06, -0.03, 0.2], [0.06, -0.03, 0.08], [0.29, -0.08, 0.0],  // pectoral fins
    [-0.06, -0.03, 0.2], [-0.29, -0.08, 0.0], [-0.06, -0.03, 0.08],
  ]);
  return merge([body, fins]);
}

/** A reef shark (scaled to ~2 m): slender, pointed snout, tall first dorsal, swept pectorals, crescent tail. */
function reefSharkGeometry() {
  const body = tubeBody((s) => {
    const k = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.75);    // tapers to a point at both ends
    return [0.012 + 0.07 * k, 0.014 + 0.085 * k];
  });
  const fins = tris([
    [0, 0.02, -0.46], [0, 0.2, -0.64], [0, 0.0, -0.53],           // tail
    [0, -0.01, -0.46], [0, 0.0, -0.53], [0, -0.12, -0.6],
    [0, 0.085, 0.08], [0, 0.085, -0.08], [0, 0.23, -0.12],        // first dorsal, tall
    [0, 0.03, -0.3], [0, 0.03, -0.35], [0, 0.06, -0.37],          // second dorsal
    [0.05, -0.04, 0.16], [0.05, -0.04, 0.04], [0.25, -0.12, -0.06], // pectoral fins
    [-0.05, -0.04, 0.16], [-0.25, -0.12, -0.06], [-0.05, -0.04, 0.04],
  ]);
  return merge([body, fins]);
}

/**
 * A shark that cruises a loop round the room. kind 'whale': the 9 m whale shark, slow and high, so
 * it reads on the ceiling; 'reef': a 2 m grey reef shark, quicker and lower, with dark fin tips.
 * dir: 1 or -1, which way round it swims.
 */
export class Shark {
  constructor({ time, kind = 'whale', radius = 15, height = 9, dir = 1, seed = 0 }) {
    const whale = kind === 'whale';
    // The whale shark's pale spots in rows between faint bands (from 3D cells, so no seam);
    // the reef shark's black-tipped fins.
    const extra = whale ? `
      vec3 g = vObj * vec3(46.0, 46.0, 46.0);
      vec3 cell = floor(g);
      vec3 o = fract(sin(vec3(dot(cell, vec3(12.9, 78.2, 37.7)), dot(cell, vec3(39.3, 11.1, 83.4)), dot(cell, vec3(73.1, 52.7, 19.3)))) * 43758.5);
      float spot = 1.0 - smoothstep(0.17, 0.26, length(fract(g) - 0.25 - o * 0.5));
      float band = 1.0 - smoothstep(0.02, 0.06, abs(fract(vObj.z * 24.0) - 0.5));
      float onBack = smoothstep(-0.05, 0.35, vUp) * smoothstep(-0.48, -0.3, vObj.z);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.66, 0.7), (spot * 0.9 + band * 0.2 * (1.0 - spot)) * onBack);` : `
      float tip = smoothstep(0.17, 0.21, vObj.y) + smoothstep(0.17, 0.23, abs(vObj.x)) + smoothstep(0.58, 0.63, -vObj.z);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02), clamp(tip, 0.0, 1.0));`;
    const mat = swimMaterial({
      time, phase: 'uPhase', extra, head: 0.3, tail: -0.5,
      ...(whale ? { back: 0x23303b, belly: 0x9aa5ad, freq: 1.3, wave: 5, amp: 0.045, roughness: 0.6 }
        : { back: 0x4f5a63, belly: 0xd5d8da, freq: 3.2, wave: 6, amp: 0.06, roughness: 0.45 }),
    });
    mat.userData.phase.value = seed * 1.9;
    this.object = new THREE.Mesh(whale ? whaleSharkGeometry() : reefSharkGeometry(), mat);
    this.object.scale.setScalar(whale ? 9 : 2.1);
    this.object.userData.fear = whale ? 7 : 5;
    this.object.frustumCulled = false;
    Object.assign(this, { radius, height, dir, seed, speed: whale ? 1.15 : 2.3, wobble: whale ? 0.15 : 0.08 });
    this.update(0, 0);
  }

  update(dt, t) {
    const a = ((t * this.speed) / this.radius) * this.dir + 2.4 + this.seed * 2.5;
    const r = this.radius * (1 + this.wobble * Math.sin(t * 0.05 + this.seed));
    const p = this.object.position.set(Math.cos(a) * r, this.height + 1.4 * Math.sin(t * 0.045 + this.seed), Math.sin(a) * r * 0.8);
    _a.set(-Math.sin(a) * this.dir, 0, Math.cos(a) * 0.8 * this.dir);    // head along the loop
    this.object.lookAt(_b.copy(p).add(_a));
  }
}

/* ------------------------------------------------------------------ sea turtles */

/** A green turtle, 1 unit long nose to tail (scaled to ~1.2 m): domed shell, head, four flippers. */
function turtleGeometry() {
  const shell = new THREE.SphereGeometry(1, 28, 14);
  const p = shell.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * 0.4, p.getY(i) * (p.getY(i) > 0 ? 0.16 : 0.06), p.getZ(i) * 0.48);
  shell.computeVertexNormals();
  const head = new THREE.SphereGeometry(1, 14, 10).scale(0.1, 0.075, 0.14).translate(0, 0.01, 0.56);
  const flippers = tris([
    [0.28, 0, 0.3], [0.32, 0, 0.12], [0.9, -0.03, -0.12],          // front flippers: long and swept
    [-0.28, 0, 0.3], [-0.9, -0.03, -0.12], [-0.32, 0, 0.12],
    [0.18, 0, -0.36], [0.2, 0, -0.46], [0.4, -0.01, -0.6],         // rear flippers: short paddles
    [-0.18, 0, -0.36], [-0.4, -0.01, -0.6], [-0.2, 0, -0.46],
  ]);
  return merge([shell, head, flippers]);
}

/** A sea turtle gliding round the room, beating its front flippers like wings. */
export class Turtle {
  constructor({ time, radius = 11, height = 2, dir = 1, seed = 0 }) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide });
    const phase = { value: seed * 2.7 };
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = time;
      s.uniforms.uPhase = phase;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime, uPhase;\nvarying vec3 vObj; varying float vUp;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ax = abs(position.x);
          if (ax > 0.3) {
            float k = ax - 0.3, front = step(-0.2, position.z);
            transformed.y += sin(uTime * 1.1 + uPhase) * k * mix(0.25, 0.85, front);
            transformed.z += cos(uTime * 1.1 + uPhase) * k * 0.25 * front;
          }
          vObj = position; vUp = normal.y;`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying float vUp;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float onShell = 1.0 - smoothstep(0.96, 1.0, length(vec2(vObj.x / 0.4, vObj.z / 0.48)));
          // the shell's plates: cells with paler seams, mottled brown and olive
          vec2 g = vObj.xz * 9.0;
          vec2 c = floor(g), f = fract(g) - 0.5;
          float h = fract(sin(dot(c, vec2(12.9, 78.2))) * 43758.5);
          float seam = smoothstep(0.38, 0.48, max(abs(f.x), abs(f.y)));
          vec3 plate = mix(vec3(0.16, 0.1, 0.045), vec3(0.11, 0.1, 0.05), h) * (0.8 + 0.4 * h);
          vec3 shell = mix(plate, vec3(0.32, 0.27, 0.16), seam * 0.6);
          float scale = fract(sin(dot(floor(vObj.xz * 40.0), vec2(4.1, 7.3))) * 999.0);
          vec3 skin = mix(vec3(0.07, 0.07, 0.05), vec3(0.3, 0.29, 0.22), smoothstep(0.4, 0.6, scale) * 0.5);
          vec3 top = mix(skin, shell, onShell);
          diffuseColor.rgb = mix(vec3(0.55, 0.5, 0.36), top, smoothstep(-0.3, 0.2, vUp));`);
    };
    this.object = new THREE.Mesh(turtleGeometry(), mat);
    this.object.scale.setScalar(1.2);
    this.object.userData.fear = 2;
    this.object.frustumCulled = false;
    Object.assign(this, { radius, height, dir, seed, speed: 0.75 });
    this.update(0, 0);
  }

  update(dt, t) {
    const a = ((t * this.speed) / this.radius) * this.dir + this.seed * 2.1;
    const p = this.object.position.set(Math.cos(a) * this.radius, this.height + 1.2 * Math.sin(t * 0.11 + this.seed), Math.sin(a) * this.radius);
    _a.set(-Math.sin(a) * this.dir, 0.1 * Math.cos(t * 0.11 + this.seed), Math.cos(a) * this.dir);
    this.object.lookAt(_b.copy(p).add(_a));
  }
}

/* ------------------------------------------------------------------ manta rays */

/** A reef manta seen from below: white belly with dark margins; from above, black with pale shoulders. */
export class Manta {
  constructor({ time, span = 4.5, radius = 13, height = 6, speed = 1.7, seed = 0 }) {
    const geo = new THREE.PlaneGeometry(1, 0.8, 40, 26).rotateX(-Math.PI / 2).translate(0, 0, -0.07);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide });
    const phase = { value: seed * 2.3 };
    // The wings beat in a slow wave from the body out to the tips; the body stays thick and steady.
    const lift = `
      float mantaLift(vec3 p) {
        float ax = abs(p.x);
        return sin(uTime * 1.25 + uPhase - ax * 2.6) * 0.17 * pow(ax * 2.0, 1.6)
          + 0.04 * (1.0 - smoothstep(0.0, 0.13, ax)) * (1.0 - smoothstep(0.08, 0.26, abs(p.z + 0.02)));
      }`;
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = time;
      s.uniforms.uPhase = phase;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime, uPhase;\nvarying vec3 vObj;\n${lift}`)
        .replace('#include <beginnormal_vertex>', `
          const float e = 0.01;
          vec3 objectNormal = normalize(vec3(
            -(mantaLift(position + vec3(e, 0.0, 0.0)) - mantaLift(position - vec3(e, 0.0, 0.0))) / (2.0 * e), 1.0,
            -(mantaLift(position + vec3(0.0, 0.0, e)) - mantaLift(position - vec3(0.0, 0.0, e))) / (2.0 * e)));`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += mantaLift(position);\nvObj = position;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float ax = abs(vObj.x), z = vObj.z, k = ax / 0.5;
          float front = 0.24 - 0.33 * pow(k, 1.25);
          float back = -0.17 + 0.07 * pow(k, 0.7);
          bool wing = z < front && z > back;
          bool horn = ax > 0.03 && ax < 0.085 && z > 0.17 && z < 0.31 - (ax - 0.03) * 0.8;
          bool tail = z < -0.15 && z > -0.47 && ax < 0.007 * (1.0 - (-z - 0.15) / 0.34);
          if (!(wing || horn || tail)) discard;
          float shoulder = 1.0 - smoothstep(0.03, 0.09, length(vec2(ax - 0.13, (z - 0.06) * 1.3)));
          vec3 top = mix(vec3(0.012, 0.013, 0.016), vec3(0.32, 0.34, 0.37), shoulder);
          float margin = smoothstep(0.72, 0.98, k) + (1.0 - smoothstep(-0.16, -0.1, z)) * smoothstep(0.2, 0.6, k);
          float gills = step(ax, 0.1) * step(0.04, ax) * step(0.5, fract((z - 0.02) * 70.0)) * step(-0.02, z) * step(z, 0.07);
          vec3 belly = mix(vec3(0.78, 0.8, 0.82), vec3(0.06, 0.065, 0.075), clamp(margin + gills * 0.6, 0.0, 1.0));
          diffuseColor.rgb = gl_FrontFacing ? top : belly;`);
    };
    this.object = new THREE.Mesh(geo, mat);
    this.object.scale.setScalar(span);
    this.object.userData.fear = 4;
    this.object.frustumCulled = false;
    Object.assign(this, { radius, height, speed, seed });
    this.update(0, 0);
  }

  update(dt, t) {
    const a = (t * this.speed) / this.radius * (this.seed % 2 ? -1 : 1) + this.seed * 2.2;
    const r = this.radius * (1 + 0.2 * Math.sin(t * 0.07 + this.seed));
    const p = this.object.position.set(Math.cos(a) * r, this.height + 1.8 * Math.sin(t * 0.13 + this.seed * 1.7), Math.sin(a) * r);
    const dir = this.seed % 2 ? -1 : 1;
    _a.set(-Math.sin(a) * dir, 0.08 * Math.cos(t * 0.13 + this.seed * 1.7), Math.cos(a) * dir);
    this.object.lookAt(_b.copy(p).add(_a));
    this.object.rotateZ(0.25 * dir);                         // banks into the turn
  }
}

/* ------------------------------------------------------------------ jellyfish */

const JELLY_VERTEX = /* glsl */ `
  attribute float aPhase; attribute vec3 aColor;
  uniform float uTime;
  varying vec3 vN, vV, vObj, vC; varying float vDist;
  void main() {
    float pulse = 0.5 + 0.5 * sin(uTime * 1.7 + aPhase);
    vec3 p = position;
    float rim = 1.0 - p.y;                                   // 0 at the crown, 1 at the rim
    p.xz *= 1.0 - 0.17 * pulse * rim;
    p.y *= 1.0 + 0.1 * pulse;
    vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vV = cameraPosition - w.xyz;
    vDist = length(vV);
    vObj = position; vC = aColor;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const JELLY_FRAGMENT = /* glsl */ `
  uniform float uFog, uNight;
  varying vec3 vN, vV, vObj, vC; varying float vDist;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float a = atan(vObj.z, vObj.x);
    // four glowing gonads round the crown, the moon jelly's mark, and faint radial canals
    float lobes = smoothstep(0.55, 0.95, cos(a * 4.0)) * smoothstep(0.35, 0.75, vObj.y) * (1.0 - smoothstep(0.85, 1.0, vObj.y));
    float canals = pow(abs(cos(a * 8.0)), 30.0) * 0.5;
    float rimGlow = smoothstep(0.25, 0.0, vObj.y);
    vec3 c = vC * (0.06 + 1.3 * fres + 0.9 * lobes + canals * 0.4 + rimGlow * 0.8);
    c *= 1.0 + 1.8 * uNight;                                // at midnight they are the brightest things in the water
    float fog = exp(-pow(vDist * uFog * (1.0 - 0.45 * uNight), 2.0));
    gl_FragColor = vec4(c * fog, 1.0);
  }`;

const TENTACLE_VERTEX = /* glsl */ `
  #define N JELLIES
  attribute float aJelly, aAngle, aS, aKind;
  uniform float uTime;
  uniform vec4 uJelly[N];                // xyz: bell rim centre, w: phase
  uniform vec4 uShape[N];                // x: bell radius, y: tentacle length
  uniform vec3 uColor[N];
  varying float vA; varying vec3 vC; varying float vDist;
  void main() {
    int j = int(aJelly + 0.5);
    vec4 J = uJelly[j]; vec4 S = uShape[j];
    float pulse = 0.5 + 0.5 * sin(uTime * 1.7 + J.w);
    float s = aS;
    // tentacles hang from the rim; oral arms (aKind 1) from the middle, thicker and shorter
    float r = S.x * mix(0.9 * (1.0 - 0.17 * pulse), 0.14, aKind);
    float len = S.y * mix(1.0, 0.45, aKind);
    vec3 p = vec3(cos(aAngle) * r, 0.0, sin(aAngle) * r);
    p.xz *= 1.0 - s * 0.25;
    p += vec3(sin(uTime * 0.9 + J.w + s * 5.0 + aAngle * 2.0) * 0.35 * s, -s * len, cos(uTime * 0.7 + J.w + s * 4.0 + aAngle * 3.0) * 0.35 * s);
    vec4 w = modelMatrix * vec4(J.xyz + p, 1.0);
    vDist = length(cameraPosition - w.xyz);
    vA = (1.0 - s) * mix(0.35, 0.9, aKind);
    vC = uColor[j];
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const TENTACLE_FRAGMENT = /* glsl */ `
  uniform float uFog, uNight;
  varying float vA; varying vec3 vC; varying float vDist;
  void main() { gl_FragColor = vec4(vC * vA * (1.0 + 1.5 * uNight) * exp(-pow(vDist * uFog * (1.0 - 0.45 * uNight), 2.0)), 1.0); }`;

/**
 * A bloom of jellyfish drifting up through the water, each bell pulsing, glowing at its rim and
 * its four gonads, trailing tentacles that sway behind it. Two draw calls for all of them:
 * the bells are instanced, the tentacles are one set of lines placed in the vertex shader.
 * night: the ocean's Midnight uniform (0..1); they glow brighter and carry further in the dark.
 */
export class Jellies {
  constructor({ count = 16, time, fog, night = { value: 0 } }) {
    this.count = count;
    const colors = [0xffb3c7, 0xffd2b0, 0xe6b8ff, 0xbfe3ff, 0xffc4e8].map((c) => new THREE.Color(c).multiplyScalar(0.85));
    this.jellies = Array.from({ length: count }, (_, i) => this.#spawn({ phase: Math.random() * 6.28, color: colors[i % colors.length] }, true));
    const bell = new THREE.SphereGeometry(1, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    bell.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(this.jellies.map((j) => j.phase)), 1));
    bell.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(this.jellies.flatMap((j) => j.color.toArray())), 3));
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
    this.bells = new THREE.InstancedMesh(bell, new THREE.ShaderMaterial({ uniforms: { uTime: time, uFog: fog, uNight: night }, vertexShader: JELLY_VERTEX, fragmentShader: JELLY_FRAGMENT, ...additive }), count);
    this.bells.frustumCulled = false;

    // Tentacles: TENT per jelly hanging from the rim, plus 4 oral arms, SEG segments each.
    const TENT = 18, ARMS = 4, SEG = 20;
    const attr = { aJelly: [], aAngle: [], aS: [], aKind: [] };
    const push = (j, angle, s, kind) => { attr.aJelly.push(j); attr.aAngle.push(angle); attr.aS.push(s); attr.aKind.push(kind); };
    for (let j = 0; j < count; j++) {
      for (let k = 0; k < TENT + ARMS; k++) {
        const kind = k < TENT ? 0 : 1;
        const angle = kind ? ((k - TENT) / ARMS) * 6.283 + 0.4 : (k / TENT) * 6.283;
        for (let i = 0; i < SEG; i++) { push(j, angle, i / SEG, kind); push(j, angle, (i + 1) / SEG, kind); }
      }
    }
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(attr.aS.length * 3), 3));
    for (const [k, v] of Object.entries(attr)) lines.setAttribute(k, new THREE.Float32BufferAttribute(v, 1));
    this.uniforms = {
      uTime: time, uFog: fog, uNight: night,
      uJelly: { value: this.jellies.map(() => new THREE.Vector4()) },
      uShape: { value: this.jellies.map((j) => new THREE.Vector4(j.size, j.length, 0, 0)) },
      uColor: { value: this.jellies.map((j) => j.color) },
    };
    this.tentacles = new THREE.LineSegments(lines, new THREE.ShaderMaterial({
      uniforms: this.uniforms, defines: { JELLIES: count }, vertexShader: TENTACLE_VERTEX, fragmentShader: TENTACLE_FRAGMENT, ...additive,
    }));
    this.tentacles.frustumCulled = false;
    this.object = new THREE.Group();
    this.object.add(this.bells, this.tentacles);
  }

  /** Place a jelly somewhere round the room (first: anywhere in the water column; later: below, to drift up into view). */
  #spawn(j, first = false) {
    const a = Math.random() * 6.283, r = rand(15, 27);           // outside the room (Ocean.js KEEP_OUT)
    j.pos = new THREE.Vector3(Math.cos(a) * r, first ? rand(-6, 12) : rand(-9, -6), Math.sin(a) * r);
    j.size = rand(0.45, 1.0);
    j.length = j.size * rand(2.5, 4.5);
    j.drift = new THREE.Vector2(rand(-0.06, 0.06), rand(-0.06, 0.06));
    return j;
  }

  update(dt, t) {
    this.jellies.forEach((j, i) => {
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + j.phase);
      j.pos.y += dt * (0.06 + 0.22 * pulse * pulse);           // each beat pushes it up a little
      j.pos.x += j.drift.x * dt;
      j.pos.z += j.drift.y * dt;
      if (j.pos.y > 15) { this.#spawn(j); this.uniforms.uShape.value[i].set(j.size, j.length, 0, 0); }
      _m.compose(j.pos, _q.identity(), _s.set(j.size, j.size * 0.72, j.size));
      this.bells.setMatrixAt(i, _m);
      this.uniforms.uJelly.value[i].set(j.pos.x, j.pos.y, j.pos.z, j.phase);
    });
    this.bells.instanceMatrix.needsUpdate = true;
  }
}
