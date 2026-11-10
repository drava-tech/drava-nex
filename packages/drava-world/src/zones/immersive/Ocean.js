import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAUSTIC, NOISE } from './glsl.js';
import { FishSchool, Jellies, Manta, Shark, Turtle } from './sealife.js';

// The ocean the World Zone's screens show. It is its own scene (its own lights and fog, so it
// never changes the main scene's light set), drawn every frame from the visitor's own eye, so the
// walls and ceiling are windows onto a 3D ocean with real depth: near animals slide past far ones
// as the visitor moves (a head-tracked LED room; the real one follows its visitor with a camera).
// Units: metres from the room's sweet spot (OceanRoom's SWEET); y up; the surface is far above.
// Every animal stays outside the room's volume (KEEP_OUT), so it is always seen through the screens.
// Two moods (setNight): the sunlit reef, and Midnight: moonlight, black water and the plankton's own
// light. A touch on the glass (lure) draws the nearest shoals to that point and sets the plankton
// there alight; pick() finds the animal behind a point on the glass.
const WATER = 0x0b3d91;          // the blue the water fades to at a distance (fog and horizon)
const WATER_NIGHT = 0x03102a;    // the same at midnight
const MOON = new THREE.Vector3(-0.35, 1, 0.4).normalize();
const BURSTS = 4, PER_BURST = 280;   // plankton bursts at the latest touches
const DENSITY = 0.03;            // FogExp2: ~70 % clear at 20 m, ~35 % at 34 m
const SEABED = -12;
const SUN = new THREE.Vector3(0.3, 1, -0.55).normalize();   // high, a little toward the waterfall
// The room's volume from the sweet spot, with a margin: x ±9, z ±12, up to the 9 m ceiling (7.4 m above the eye).
export const KEEP_OUT = { x: 9.8, z: 12.8, y: 7.9 };

const DOME_FRAGMENT = /* glsl */ `
  uniform float uTime, uNight; uniform vec3 uWater, uSun, uMoon;
  varying vec3 vDir;
  ${NOISE}
  ${CAUSTIC}
  void main() {
    vec3 d = normalize(vDir);
    float up = d.y;
    vec3 deep = vec3(0.0006, 0.004, 0.022);
    vec3 high = vec3(0.03, 0.2, 0.55);
    vec3 c = up < 0.0 ? mix(uWater, deep, pow(min(-up * 1.5, 1.0), 0.7)) : mix(uWater, high, pow(up, 0.85));
    // Snell's window: the surface, seen through ~97 degrees overhead, rippling and bright
    float win = smoothstep(0.6, 0.7, up);
    vec2 sp = d.xz / max(up, 0.08) * 3.0;
    float rip = caustic(sp * 0.35 + vec2(uTime * 0.01, 0.0), uTime * 0.35);
    float waves = fbm(sp * 0.8 + vec2(uTime * 0.05, -uTime * 0.03));
    c = mix(c, vec3(0.1, 0.3, 0.6) * (0.55 + 1.3 * rip + 0.5 * waves), win * 0.75);
    // the window's edge glows where the surface mirrors the deep (total internal reflection)
    c += vec3(0.1, 0.35, 0.75) * exp(-(up - 0.66) * (up - 0.66) * 676.0) * 0.5;
    // the sun through the surface
    float s = max(dot(d, uSun), 0.0);
    c += vec3(1.0, 0.95, 0.82) * (pow(s, 900.0) * 6.0 + pow(s, 60.0) * 0.45 + pow(s, 8.0) * 0.1);
    // god rays: shafts of light that fan out from the sun and flicker as the waves pass
    vec3 e1 = normalize(cross(uSun, vec3(0.0, 0.0, 1.0)));
    vec3 e2 = cross(uSun, e1);
    vec2 around = normalize(vec2(dot(d, e1), dot(d, e2)) + 1e-5);
    float shafts = noise(around * 9.0 + vec2(uTime * 0.07, 0.0)) * noise(around * 23.0 - vec2(0.0, uTime * 0.11));
    shafts = pow(shafts, 1.6) * smoothstep(-0.35, 0.45, up) * (1.0 - win * 0.7) * smoothstep(0.0, 0.85, s);
    c += vec3(0.25, 0.55, 0.9) * shafts * 0.9;
    // Midnight: black water, a faint silver window and the moon through it; no shafts.
    vec3 n = up < 0.0 ? mix(uWater, vec3(0.0, 0.0005, 0.003), pow(min(-up * 1.5, 1.0), 0.7)) : mix(uWater, vec3(0.004, 0.02, 0.06), pow(up, 0.85));
    n = mix(n, vec3(0.02, 0.05, 0.11) * (0.5 + 1.2 * rip + 0.4 * waves), win * 0.6);
    n += vec3(0.05, 0.14, 0.3) * exp(-(up - 0.66) * (up - 0.66) * 676.0) * 0.3;
    float m = max(dot(d, uMoon), 0.0);
    n += vec3(0.75, 0.85, 1.0) * (pow(m, 1400.0) * 2.5 + pow(m, 80.0) * 0.12);
    c = mix(c, n, uNight);
    gl_FragColor = vec4(c, 1.0);
  }`;

const BURST_VERTEX = /* glsl */ `
  attribute vec4 aDir;        // xyz: where it flies (m), w: which burst
  attribute float aSeed;
  uniform vec4 uBurst[${BURSTS}];   // xyz: where (ocean space), w: when
  uniform float uTime, uScale, uNight, uFog;
  varying float vA;
  void main() {
    vec4 B = uBurst[int(aDir.w + 0.5)];
    float age = uTime - B.w;
    vec3 p = B.xyz + aDir.xyz * (1.0 - exp(-age * 1.4)) + vec3(sin(age * 1.7 + aSeed * 40.0), age * (0.2 + 0.3 * aSeed), cos(age * 1.3 + aSeed * 30.0)) * 0.2;
    float twinkle = 0.6 + 0.4 * sin(uTime * (6.0 + aSeed * 9.0) + aSeed * 80.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vA = step(0.0, age) * smoothstep(0.0, 0.1, age) * exp(-age * mix(0.9, 0.45, uNight)) * twinkle * exp(-pow(-mv.z * uFog, 2.0));
    gl_PointSize = clamp(uScale * (0.035 + 0.045 * aSeed) / -mv.z, 1.0, 9.0);
    gl_Position = projectionMatrix * mv;
  }`;

const BURST_FRAGMENT = /* glsl */ `
  uniform float uNight;
  varying float vA;
  void main() {
    float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA;
    gl_FragColor = vec4(mix(vec3(0.7, 0.85, 1.0) * 0.7, vec3(0.2, 0.95, 1.25) * 1.8, uNight) * a, 1.0);
  }`;

/** Light from above on the seabed and the reef: the moving caustic net, on surfaces that face up (dim at midnight). */
function causticLit(material, time, night) {
  material.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.uniforms.uNight = night;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCW; varying vec3 vNW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 cw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cw = instanceMatrix * cw;
        #endif
        vCW = (modelMatrix * cw).xyz;
        vNW = normalize(transformedNormal * mat3(viewMatrix));`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime, uNight;\nvarying vec3 vCW; varying vec3 vNW;\n${CAUSTIC}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.5, 0.85, 1.1) * caustic(vCW.xz / 5.0, uTime * 0.4) * max(vNW.y, 0.0) * 0.9 * (1.0 - 0.9 * uNight);`);
  };
  return material;
}

/** A lumpy rock: an icosphere pushed in and out by a few sines (no texture needed at this distance). */
function rockGeometry(seed) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 4).deleteAttribute('uv').deleteAttribute('normal'));   // shared vertices: smooth, not faceted
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 2.1 + seed) * Math.sin(v.y * 2.7 + seed * 2) * Math.sin(v.z * 1.9 + seed * 3)
      + 0.4 * Math.sin(v.x * 5.3 + seed * 5) * Math.sin(v.z * 4.7 + seed);
    v.multiplyScalar(1 + 0.3 * n);
    if (v.y < -0.3) v.y = -0.3 - (v.y + 0.3) * 0.2;                       // flattish underside, sits on the sand
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A branching coral head: a stem that forks twice, about 1 m tall. */
function coralGeometry() {
  const parts = [];
  const branch = (from, dir, len, r, depth) => {
    const g = new THREE.CylinderGeometry(r * 0.7, r, len, 6).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(from.x, from.y, from.z);
    parts.push(g);
    if (!depth) return;
    const end = from.clone().addScaledVector(dir, len);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 6.283 + depth;
      const d = dir.clone().add(new THREE.Vector3(Math.cos(a) * 0.6, 0.15, Math.sin(a) * 0.6)).normalize();
      branch(end, d, len * 0.72, r * 0.68, depth - 1);
    }
  };
  branch(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0.4, 0.07, 2);
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _pts = Array.from({ length: 5 }, () => new THREE.Vector3());
const _day = new THREE.Color(WATER), _night = new THREE.Color(WATER_NIGHT);
const _sunDay = new THREE.Color(0xbfe6ff), _moon = new THREE.Color(0x8fb3ff);

export class Ocean {
  /** detail: 'high' | 'low' (fewer animals, no antialiasing on the view). */
  constructor(renderer, { detail = 'high' } = {}) {
    this.renderer = renderer;
    const high = detail === 'high';
    const scene = (this.scene = new THREE.Scene());
    const water = (this.water = new THREE.Color(WATER));
    scene.fog = new THREE.FogExp2(water, DENSITY);
    this.time = { value: 0 };
    this.night = { value: 0 };                 // 0 the sunlit reef .. 1 midnight, eased toward nightTarget
    this.nightTarget = 0;
    const fog = { value: DENSITY };

    // The water itself: a dome round everything, lit from the surface.
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(300, 64, 32), new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uNight: this.night, uWater: { value: water }, uSun: { value: SUN }, uMoon: { value: MOON } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: DOME_FRAGMENT,
      side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    // Lit from above and by the blue all round, and reflecting the water (silver fish flash as they turn).
    const sun = (this.sun = new THREE.DirectionalLight(0xbfe6ff, 2.4));
    sun.position.copy(SUN).multiplyScalar(50);
    this.ambient = new THREE.HemisphereLight(0x3d8fe0, 0x01060f, 1.1);
    scene.add(sun, this.ambient);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const sky = new THREE.Scene();
    sky.add(this.dome.clone());
    scene.environment = pmrem.fromScene(sky, 0, 1, 600).texture;      // captured by day; dimmed at midnight
    scene.environmentIntensity = 0.6;
    pmrem.dispose();

    this.#buildSeabed(scene);
    this.snowScale = { value: 1 };
    this.lureAt = { value: new THREE.Vector4(0, 0, 0, -99) };
    this.#buildSnow(scene, high ? 4000 : 1800);
    this.#buildBursts(scene);

    // Who lives here. Sizes and speeds are each animal's own (sealife.js); placement is radius
    // (m from the sweet spot) and height (m above it): high ones read on the ceiling.
    const T = { time: this.time };
    this.sharks = [
      new Shark({ ...T, kind: 'whale', radius: 15, height: 10.5 }),
      new Shark({ ...T, kind: 'reef', radius: 18, height: -1.5, seed: 0 }),
      new Shark({ ...T, kind: 'reef', radius: 21, height: 0.5, dir: -1, seed: 1 }),
      ...(high ? [new Shark({ ...T, kind: 'reef', radius: 25, height: -3, seed: 2 })] : []),
    ];
    this.mantas = Array.from({ length: high ? 5 : 3 }, (_, i) => new Manta({ ...T, seed: i, radius: 8 + i * 2.6, height: 10.5 + i * 1.2 }));
    this.turtles = Array.from({ length: high ? 3 : 2 }, (_, i) => new Turtle({ ...T, seed: i, radius: 16 + i * 3, height: 1 + i * 2, dir: i % 2 ? -1 : 1 }));
    const predators = [...this.sharks, ...this.mantas].map((a) => a.object);
    const n = (count) => Math.round(count * (high ? 1 : 0.5));
    this.schools = [
      new FishSchool({ ...T, count: n(480), radius: 20, height: 1.5, seed: 0 }),                                                       // sardines
      new FishSchool({ ...T, count: n(300), radius: 12, height: 10.5, seed: 1.7, size: 0.24, speed: 2.8, back: 0x2a4a5e, spread: [2.6, 1.6, 3.4] }),
      new FishSchool({ ...T, count: n(320), radius: 22, height: -1, seed: 3.1, size: 0.28, speed: 2.4, back: 0x2c5cab, belly: 0xd9c25a, spread: [4, 1.5, 4] }),   // fusiliers: blue over yellow
      new FishSchool({ ...T, count: n(240), radius: 26, height: -5, seed: 4.6, size: 0.13, speed: 0.9, back: 0xd2582a, belly: 0xf2a37a, spread: [7, 1.6, 7] }),  // anthias over the reef
      new FishSchool({ ...T, count: n(70), radius: 18, height: 3, seed: 5.9, size: 0.65, speed: 3.4, back: 0x47555f, belly: 0xc9d0d4, spread: [2.4, 1.2, 3] }),   // a pack of big jacks
    ];
    // kind: the species card each school shows (script.js SPECIES)
    ['sardines', 'sardines', 'fusiliers', 'anthias', 'jacks'].forEach((kind, i) => Object.assign(this.schools[i], { kind, predators, keepOut: KEEP_OUT }));
    this.jellies = new Jellies({ ...T, count: high ? 30 : 14, fog, night: this.night });
    this.animals = [...this.sharks, ...this.mantas, ...this.turtles, ...this.schools, this.jellies];
    for (const a of this.animals) scene.add(a.object);
    this.targets = this.#targets();

    // The view through the screens: drawn from the visitor's eye at the screen's own resolution.
    this.view = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: high ? 4 : 0 });
    this.res = new THREE.Vector2(2, 2);
    this.eye = new THREE.PerspectiveCamera();
    // A small 360-degree capture round the eye, for the wet floor's reflection only (every few frames).
    this.reflection = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cube = new THREE.CubeCamera(0.1, 600, this.reflection);
    this.frame = 0;
  }

  /** Sand and a ring of reef round the room: rocks, with coral heads on them. */
  #buildSeabed(scene) {
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), causticLit(new THREE.MeshStandardMaterial({ color: 0x8c8574, roughness: 1 }), this.time, this.night));
    sand.position.y = SEABED;
    scene.add(sand);

    const rocks = [], tops = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + Math.random() * 0.12;
      const r = 24 + Math.random() * 16;
      const size = 3 + Math.random() * 4;
      const tall = size * (0.7 + Math.random() * 1.0);
      const g = rockGeometry(i * 1.7).scale(size * 1.3, tall, size * 1.1).rotateY(Math.random() * 6.28);
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = SEABED + tall * 0.3;
      g.translate(x, y, z);
      const c = new THREE.Color().setHSL(0.08 + Math.random() * 0.05, 0.14, 0.07 + Math.random() * 0.06);
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(c.toArray()).flat(), 3));
      rocks.push(g);
      tops.push({ x, z, y: y + tall * 0.9, spread: size * 0.7 });
    }
    const reef = new THREE.Mesh(mergeGeometries(rocks), causticLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), this.time, this.night));
    scene.add(reef);

    const COUNT = 220;
    const coral = new THREE.InstancedMesh(coralGeometry(), causticLit(new THREE.MeshStandardMaterial({ roughness: 0.8 }), this.time, this.night), COUNT);
    const palette = [0xc2376e, 0x7a45b8, 0xe0763a, 0xd6b640, 0x2bb3b0, 0xe8e0d0].map((c) => new THREE.Color(c));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    for (let i = 0; i < COUNT; i++) {
      const t = tops[i % tops.length];
      const a = Math.random() * 6.28, d = Math.random() * t.spread;
      p.set(t.x + Math.cos(a) * d, t.y - d * 0.45 - 0.3, t.z + Math.sin(a) * d);
      q.setFromEuler(e.set((Math.random() - 0.5) * 0.5, Math.random() * 6.28, (Math.random() - 0.5) * 0.5));
      m.compose(p, q, s.setScalar(0.8 + Math.random() * 1.8));
      coral.setMatrixAt(i, m);
      coral.setColorAt(i, palette[Math.floor(Math.random() * palette.length)]);
    }
    scene.add(coral);
  }

  /** Marine snow: the specks that drift in sunlit water and give it depth. At midnight they are plankton, glowing where the glass is touched. */
  #buildSnow(scene, count) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.283, r = 16 + Math.pow(Math.random(), 0.7) * 30;     // never inside the room
      pos.set([Math.cos(a) * r, Math.random() * 60 - 30, Math.sin(a) * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uScale: this.snowScale, uFog: { value: DENSITY }, uNight: this.night, uLure: this.lureAt },
      vertexShader: /* glsl */ `
        uniform float uTime, uScale, uNight; varying float vFade, vFlash, vTw; uniform float uFog; uniform vec4 uLure;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * 0.12 + 30.0, 60.0) - 30.0;
          p.x += sin(uTime * 0.3 + position.z) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vec3 q = p - uLure.xyz;
          float age = uTime - uLure.w;
          vFlash = exp(-dot(q, q) / 60.0) * exp(-age * 0.4) * step(0.0, age);
          vTw = 0.55 + 0.45 * sin(uTime * 2.3 + position.x * 7.1 + position.z * 3.3);
          gl_PointSize = clamp(uScale * 0.03 * (1.0 + 1.5 * vFlash) / d, 1.0, 7.0);
          vFade = exp(-pow(d * uFog * (1.0 - 0.3 * uNight), 2.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vFade, vFlash, vTw;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          vec3 day = vec3(0.55, 0.75, 0.95) * 0.35;
          vec3 night = vec3(0.15, 0.75, 1.0) * 0.55 * vTw;
          vec3 c = mix(day, night, uNight) + mix(vec3(0.6, 0.8, 1.0), vec3(0.3, 1.0, 1.3) * 2.0, uNight) * vFlash;
          gl_FragColor = vec4(c * a * vFade, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
  }

  /** The plankton set alight where the glass was touched: one burst per touch, the oldest reused. */
  #buildBursts(scene) {
    const n = BURSTS * PER_BURST;
    const dir = new Float32Array(n * 4), seed = new Float32Array(n), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.randomDirection().multiplyScalar(0.6 + Math.pow(Math.random(), 0.5) * 3.4);
      dir.set([v.x, v.y * 0.7, v.z, Math.floor(i / PER_BURST)], i * 4);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 4));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.bursts = Array.from({ length: BURSTS }, () => new THREE.Vector4(0, 0, 0, -99));
    this.nextBurst = 0;
    const points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uScale: this.snowScale, uNight: this.night, uFog: { value: DENSITY }, uBurst: { value: this.bursts } },
      vertexShader: BURST_VERTEX, fragmentShader: BURST_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    points.frustumCulled = false;
    scene.add(points);
  }

  /**
   * What can be picked out through the glass. Each: kind (the species), centre(out) where it is now,
   * size (its radius on show, m), and for pick(): samples(out[]) points along its body and r (how near
   * a ray must pass one of them).
   */
  #targets() {
    const along = (obj, axis, half, k = 5) => (out) => {
      const a = _v.setFromMatrixColumn(obj.matrixWorld, axis).normalize();
      for (let i = 0; i < k; i++) out[i].copy(obj.position).addScaledVector(a, half * ((i / (k - 1)) * 2 - 1));
      return k;
    };
    const at = (centre) => (out) => { centre(out[0]); return 1; };
    const list = [];
    for (const s of this.sharks) {
      const whale = s.object.scale.x > 5;
      list.push({ kind: whale ? 'whale' : 'reef', size: whale ? 4.8 : 1.3, r: whale ? 1.8 : 0.8, centre: (o) => o.copy(s.object.position), samples: along(s.object, 2, whale ? 4.2 : 1) });
    }
    for (const m of this.mantas) list.push({ kind: 'manta', size: 2.6, r: 1.3, centre: (o) => o.copy(m.object.position), samples: along(m.object, 0, 2) });
    for (const tu of this.turtles) {
      const centre = (o) => o.copy(tu.object.position);
      list.push({ kind: 'turtle', size: 1.1, r: 1, centre, samples: at(centre) });
    }
    for (const s of this.schools) {
      const r = ((s.spread[0] + s.spread[1] + s.spread[2]) / 3) * 0.85;
      const centre = (o) => o.copy(s.mid);
      list.push({ kind: s.kind, size: r, r, centre, samples: at(centre) });
    }
    for (const j of this.jellies.jellies) {
      const centre = (o) => o.set(j.pos.x, j.pos.y - j.length * 0.3, j.pos.z);
      list.push({ kind: 'jelly', get size() { return Math.max(j.size * 1.3, j.length * 0.45); }, get r() { return Math.max(j.size * 1.4, j.length * 0.5); }, centre, samples: at(centre) });
    }
    return list;
  }

  /**
   * The animal nearest the eye that a ray passes (ocean space: origin from the sweet spot, dir unit),
   * beyond `near` (the glass) and not lost in the water (`far`). Null if none.
   */
  pick(origin, dir, near, far = 42) {
    let best = null, bestT = Infinity;
    for (const tg of this.targets) {
      const k = tg.samples(_pts);
      for (let i = 0; i < k; i++) {
        const t = _w.copy(_pts[i]).sub(origin).dot(dir);
        if (t < near || t > far || t > bestT) continue;
        if (_w.copy(origin).addScaledVector(dir, t).distanceTo(_pts[i]) < tg.r) { best = tg; bestT = t; }
      }
    }
    return best;
  }

  /** A touch on the glass, at p (ocean space, just past the glass): the plankton lights up there and the nearest shoals come to it. */
  lure(p, { shoals = 2, hold = 10 } = {}) {
    const t = this.time.value;
    this.bursts[this.nextBurst].set(p.x, p.y, p.z, t);
    this.nextBurst = (this.nextBurst + 1) % BURSTS;
    this.lureAt.value.set(p.x, p.y, p.z, t);
    const near = [...this.schools].sort((a, b) => a.mid.distanceTo(p) - b.mid.distanceTo(p));
    for (const s of near.slice(0, shoals)) s.lure = { pos: p.clone(), from: t, until: t + hold };
  }

  /** Midnight (true) or the sunlit reef (false); the change eases over a few seconds. */
  setNight(on) {
    this.nightTarget = on ? 1 : 0;
  }

  update(dt, t) {
    this.time.value = t;
    const n = (this.night.value += (this.nightTarget - this.night.value) * Math.min(1, dt * 0.9));
    this.water.lerpColors(_day, _night, n);
    this.scene.fog.color.copy(this.water);
    this.sun.intensity = 2.4 + (0.35 - 2.4) * n;
    this.sun.color.lerpColors(_sunDay, _moon, n);
    this.ambient.intensity = 1.1 + (0.24 - 1.1) * n;
    this.scene.environmentIntensity = 0.6 + (0.14 - 0.6) * n;
    for (const a of this.animals) a.update(dt, t);
  }

  /**
   * Draw the ocean as the visitor sees it (call once a frame, before the main render): through
   * `camera`, with the same lens, turn and shift, from where it stands relative to `origin` (the
   * sweet spot). pointScale: the engine's pixels per metre at 1 m (sizes the specks).
   */
  render(camera, origin, pointScale) {
    const r = this.renderer;
    r.getDrawingBufferSize(this.res);
    if (this.view.width !== this.res.x || this.view.height !== this.res.y) this.view.setSize(this.res.x, this.res.y);
    this.eye.copy(camera, false);
    this.eye.far = 700;                              // the main camera stops at 140 m; the water dome is at 300
    this.eye.updateProjectionMatrix();
    camera.getWorldQuaternion(this.eye.quaternion);
    camera.getWorldPosition(this.eye.position).sub(origin);
    this.eye.updateMatrixWorld();
    this.snowScale.value = pointScale;
    const target = r.getRenderTarget();
    r.setRenderTarget(this.view);
    r.render(this.scene, this.eye);
    r.setRenderTarget(target);
    if (this.frame++ % 4 === 0) {
      this.cube.position.copy(this.eye.position);
      this.cube.update(r, this.scene);
    }
  }
}
