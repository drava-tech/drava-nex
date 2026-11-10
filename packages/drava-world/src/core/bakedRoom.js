import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

// The look of a client's baked room model (its light baked into each material's emissive map), as
// the reference viewers show it: room reflections and a gloss floor. Used by the Welcome Zone's and
// the Nex Zone's rooms (zones/<id>/room.js).

/**
 * Room reflections, as the reference viewer makes them: the baked room (each material drawn as
 * its baked light alone) captured once into an environment map from the middle of the room, and
 * once from just above the floor for the floor. Box projection keeps each reflection in its
 * place in the room as the camera moves, instead of sliding with it.
 */
export function roomReflections(renderer, model, { boxMin: min, boxMax: max, isFloor, centre: at, low: atLow }) {
  const capture = new THREE.Scene();
  capture.background = new THREE.Color('#181a1e');
  const copy = model.clone(true);
  capture.add(copy);
  const temporary = [];
  copy.traverse((o) => {
    if (!o.isMesh) return;
    // A material with no baked map (a light or a screen) is captured as its own glow.
    const glow = (m) => (m.emissiveMap || !m.emissive ? 0xffffff : m.emissive.clone().multiplyScalar(Math.min(1, m.emissiveIntensity ?? 1)));
    const convert = (m) => { const b = new THREE.MeshBasicMaterial({ map: m.emissiveMap, color: glow(m), side: THREE.DoubleSide }); temporary.push(b); return b; };
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
  });
  copy.updateMatrixWorld(true);

  const lift = model.position.y;
  const centre = at.clone().setY(at.y + lift);
  const low = atLow.clone().setY(atLow.y + lift);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = pmrem.fromScene(capture, 0, 0.025, 60, { size: 512, position: centre });
  const floor = pmrem.fromScene(capture, 0, 0.015, 60, { size: 256, position: low });
  temporary.forEach((m) => m.dispose());
  pmrem.dispose();

  const boxMin = min.clone().setY(min.y + lift), boxMax = max.clone().setY(max.y + lift);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const onFloor = isFloor(o);
    for (const m of [o.material].flat()) {
      m.envMap = (onFloor ? floor : room).texture;
      m.envMapIntensity = 1;
      boxProject(m, onFloor ? low : centre, boxMin, boxMax);
      m.needsUpdate = true;
    }
  });
  model.userData.reflectionTargets = [room, floor];   // keep them alive while the model uses them
}

/** Patch a material's environment lookup to reflect off the room's box instead of infinitely far away. */
function boxProject(material, probe, boxMin, boxMax) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { roomProbe: { value: probe }, roomMin: { value: boxMin }, roomMax: { value: boxMax } });
    shader.vertexShader = 'varying vec3 vRoomPosition;\n' + shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvRoomPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const project = /* glsl */ `
      uniform vec3 roomProbe, roomMin, roomMax;
      varying vec3 vRoomPosition;
      vec3 projectedRoomDirection(vec3 direction) {
        if (any(lessThan(vRoomPosition, roomMin)) || any(greaterThan(vRoomPosition, roomMax))) return direction;
        vec3 safe = sign(direction + vec3(1e-9)) * max(abs(direction), vec3(1e-5));
        vec3 dist = max((roomMax - vRoomPosition) / safe, (roomMin - vRoomPosition) / safe);
        float travel = max(0.0, min(min(dist.x, dist.y), dist.z));
        return normalize(vRoomPosition + direction * travel - roomProbe);
      }
    `;
    const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
      'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );',
      'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );\nreflectVec = projectedRoomDirection( reflectVec );');
    shader.fragmentShader = project + shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>', chunk);
  };
  material.customProgramCacheKey = () => 'baked-room-reflections';
}

/**
 * The gloss floor: a mirror of the room, softly blurred and faded in by the angle of view
 * (strong at a glance across the floor, faint looking down), over the floor's baked light.
 */
export function glossFloor(floor) {
  if (!floor) return null;
  const source = floor.geometry;
  source.computeBoundingBox();
  const bounds = source.boundingBox;
  const pos = source.attributes.position, normal = source.attributes.normal, uv = source.attributes.uv;
  // Three corners of the floor's top face, to carry its baked texture's UVs over to the new plane.
  const top = [];
  for (let i = 0; i < pos.count; i++) if (normal.getY(i) > 0.9) top.push(i);
  const P = (i) => new THREE.Vector3().fromBufferAttribute(pos, i);
  let corners = null;
  for (let i = 2; i < top.length && !corners; i++) {
    if (new THREE.Triangle(P(top[0]), P(top[1]), P(top[i])).getArea() > 1e-5) corners = [top[0], top[1], top[i]];
  }
  if (!corners) return null;
  const triangle = new THREE.Triangle(...corners.map(P));
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  const geometry = new THREE.PlaneGeometry(size.x, size.z);
  const surfaceUV = [], bc = new THREE.Vector3(), local = new THREE.Vector3();
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    local.fromBufferAttribute(geometry.attributes.position, i);
    triangle.getBarycoord(new THREE.Vector3(center.x + local.x, bounds.max.y, center.z - local.y), bc);
    for (const get of ['getX', 'getY']) surfaceUV.push(bc.x * uv[get](corners[0]) + bc.y * uv[get](corners[1]) + bc.z * uv[get](corners[2]));
  }
  geometry.setAttribute('surfaceUV', new THREE.Float32BufferAttribute(surfaceUV, 2));

  const shader = {
    name: 'GlossFloor',
    uniforms: {
      color: { value: new THREE.Color(1, 1, 1) },
      tDiffuse: { value: null },
      textureMatrix: { value: new THREE.Matrix4() },
      bakedFloor: { value: floor.material.emissiveMap },
      tint: { value: new THREE.Color(1, 1, 1) },   // the room's light on the floor (white: as baked)
    },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      attribute vec2 surfaceUV;
      varying vec4 vReflectionUv; varying vec2 vSurfaceUv; varying vec3 vFloorWorld;
      void main() {
        vReflectionUv = textureMatrix * vec4(position, 1.0);
        vSurfaceUv = surfaceUV;
        vFloorWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse, bakedFloor;
      uniform vec3 tint;
      varying vec4 vReflectionUv; varying vec2 vSurfaceUv; varying vec3 vFloorWorld;
      void main() {
        vec2 uv = vReflectionUv.xy / vReflectionUv.w;
        vec3 view = normalize(cameraPosition - vFloorWorld);
        float grazing = 1.0 - clamp(view.y, 0.0, 1.0);
        vec2 radius = vec2(0.010, 0.018) * (1.0 + 0.55 * grazing);
        vec3 reflected = vec3(0.0); float total = 0.0;
        for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
          vec2 o = vec2(float(x), float(y)); float w = exp(-0.5 * dot(o, o));
          reflected += texture2D(tDiffuse, clamp(uv + o * radius, vec2(0.002), vec2(0.998))).rgb * w; total += w;
        }
        reflected /= total;
        float fresnel = 0.065 + 0.72 * pow(grazing, 5.0);
        vec3 body = texture2D(bakedFloor, vSurfaceUv).rgb * tint;
        gl_FragColor = vec4(body * (1.0 - fresnel) + reflected * fresnel, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  };
  const mirror = new Reflector(geometry, { textureWidth: 1024, textureHeight: 576, clipBias: 0.002, multisample: 0, shader });
  mirror.rotation.x = -Math.PI / 2;
  floor.updateWorldMatrix(true, false);
  const top3 = new THREE.Vector3(center.x, bounds.max.y, center.z).applyMatrix4(floor.matrixWorld);
  mirror.position.set(top3.x, top3.y + 0.0015, top3.z);
  mirror.name = 'gloss-floor';
  mirror.raycast = () => {};
  return mirror;
}

/**
 * Loads a client's baked room model (`url`) into a new group in `scene`, shown as the reference
 * viewers show it: the meshes named in `hide` (display faces another surface replaces) hidden,
 * room reflections from `probe` (box-projected inside `box`), the baked maps filtered
 * anisotropically, and the gloss floor on high quality. Returns at once:
 *   group, occluders (filled when the model is in), ready (resolves with the model),
 *   setReflections(on).
 * entry: { x, z, width, height } adds a dark lobby behind the entrance so it doesn't open on nothing.
 * prepare(model): runs on the loaded model before anything else (e.g. to repaint a baked map).
 */
export function buildBakedRoom(scene, { engine, url, name = 'baked-room', box, probe, hide = [], floor: floorName = 'Floor', entry = null, prepare = null }) {
  const group = new THREE.Group();
  group.name = name;
  scene.add(group);
  const occluders = [];
  const room = { group, occluders, ready: null, setReflections: () => {} };

  if (entry) {
    const lobby = new THREE.Mesh(new THREE.BoxGeometry(entry.width + 1, entry.height + 0.2, 3), new THREE.MeshBasicMaterial({ color: 0x0d0f12, side: THREE.BackSide }));
    lobby.position.set(entry.x, (entry.height + 0.2) / 2 - 0.01, entry.z + 0.15 + 1.5);
    lobby.raycast = () => {};
    group.add(lobby);
  }

  room.ready = new GLTFLoader().loadAsync(url).then((gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const hidden = new Set(hide);
    model.traverse((o) => { if (o.isMesh && hidden.has(o.name)) o.visible = false; });
    prepare?.(model);
    roomReflections(engine.renderer, model, {
      boxMin: box[0], boxMax: box[1], isFloor: (o) => o.name === floorName,
      centre: new THREE.Vector3(probe.x, 1.8, probe.z), low: new THREE.Vector3(probe.x, 0.16, probe.z),
    });
    group.add(model);
    model.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) {
        for (const t of [m.emissiveMap, m.aoMap, m.normalMap, m.metalnessMap, m.roughnessMap]) {
          if (!t) continue;
          t.anisotropy = engine.renderer.capabilities.getMaxAnisotropy();
          t.needsUpdate = true;
        }
        if (m.emissiveMap) engine.renderer.initTexture(m.emissiveMap);
      }
      if (o.name !== floorName && o.visible) occluders.push(o);
    });
    const floor = glossFloor(model.getObjectByName(floorName));
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
 * Repaint a stretch of a baked surface's maps (light and AO) that carries the shadow of something
 * since hidden (a model screen and its frame): each texel across the stretch is blended from the lit
 * surface just either side of it. The surface's face maps one axis along the wall to v (glTF UVs,
 * v = 0 at the top): `along` [p0, v0, p1, v1] gives two positions on that axis and their v; `span`
 * [s0, s1] is the stretch to repaint (positions on that axis); `u` [u0, u1] limits it to the face's
 * own columns of the map; `sample`: how far either side to take the lit colour from.
 * across: { along: [q0, u0, q1, u1], span: [t0, t1] } blends across the other axis instead (the
 * face's second axis to u, e.g. height): each texel of the stretch takes the lit surface just above
 * and below it, at the same place along the wall, so light that falls across the wall (a pool from
 * the ceiling) is kept. `span` then gives the rows (along the wall) it applies to.
 */
export function repaintShadow(mesh, { along, span, u = [0, 1], sample = 0.06, across = null }) {
  if (!mesh) return;
  const [p0, v0, p1, v1] = along;
  const vAt = (p) => v0 + ((p - p0) / (p1 - p0)) * (v1 - v0);
  const m = mesh.material;
  const lo = Math.min(...span), hi = Math.max(...span);
  for (const key of ['emissiveMap', 'aoMap']) {
    const tex = m[key];
    const img = tex?.image;
    if (!img?.width) continue;
    const { width: W, height: H } = img;
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, W, H);
    const px = data.data;
    const row = (p) => Math.max(1, Math.min(H - 2, Math.round(vAt(p) * (H - 1))));
    const r0 = row(lo), r1 = row(hi), a0 = row(lo - sample), a1 = row(hi + sample);
    const c0 = Math.max(0, Math.floor(Math.min(...u) * (W - 1))), c1 = Math.min(W - 1, Math.ceil(Math.max(...u) * (W - 1)));
    const avg = (r, c, k) => (px[((r - 1) * W + c) * 4 + k] + px[(r * W + c) * 4 + k] + px[((r + 1) * W + c) * 4 + k]) / 3;
    if (across) {
      const [q0, u0, q1, u1] = across.along;
      const col = (q) => Math.max(1, Math.min(W - 2, Math.round((u0 + ((q - q0) / (q1 - q0)) * (u1 - u0)) * (W - 1))));
      const ql = Math.min(...across.span), qh = Math.max(...across.span);
      const k0 = col(ql), k1 = col(qh), s0 = col(ql - sample), s1 = col(qh + sample);
      const avgC = (r, c, k) => (px[(r * W + c - 1) * 4 + k] + px[(r * W + c) * 4 + k] + px[(r * W + c + 1) * 4 + k]) / 3;
      for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
        const A = [0, 1, 2].map((k) => avgC(r, s0, k)), B = [0, 1, 2].map((k) => avgC(r, s1, k));
        for (let c = Math.min(k0, k1); c <= Math.max(k0, k1); c++) {
          const t = (c - s0) / (s1 - s0);
          const i = (r * W + c) * 4;
          for (let k = 0; k < 3; k++) px[i + k] = A[k] + (B[k] - A[k]) * t;
        }
      }
    }
    for (let c = across ? c1 + 1 : c0; c <= c1; c++) {
      const A = [0, 1, 2].map((k) => avg(a0, c, k)), B = [0, 1, 2].map((k) => avg(a1, c, k));
      for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
        const t = (r - a0) / (a1 - a0);
        const i = (r * W + c) * 4;
        for (let k = 0; k < 3; k++) px[i + k] = A[k] + (B[k] - A[k]) * t;
      }
    }
    ctx.putImageData(data, 0, 0);
    const fixed = new THREE.CanvasTexture(canvas);
    for (const p of ['flipY', 'colorSpace', 'channel', 'wrapS', 'wrapT', 'anisotropy', 'magFilter', 'minFilter']) fixed[p] = tex[p];
    fixed.needsUpdate = true;
    m[key] = fixed;
  }
  m.needsUpdate = true;
}
