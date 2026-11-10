import * as THREE from 'three';
import { COLOR } from '../../config.js';
import { FONT, spacedText, textPlane } from '../../util/textures.js';

const accent = new THREE.Color(COLOR.accent);

/**
 * A life-size Holobox. Our CEO appears inside as a point-cloud hologram of a person:
 * the figure builds up from the base, shimmers with scan lines, stands on rings of
 * light, and its face brightens while it speaks. summon() materialises it.
 */
export class Holobox {
  /**
   * cabinet: false builds only the hologram, its emitter and beam, for a cabinet that is already
   * in the room (the Welcome Zone's model has one); floor is the height of the cabinet's floor.
   */
  constructor({ cabinet = true, floor = 0.34 } = {}) {
    const g = (this.group = new THREE.Group());
    this.materialise = 0;
    this.target = 0;
    this.W = 1.3; this.H = 2.5; this.D = 1.0;
    this.floor = floor;
    this.cabinet = cabinet;
    const { W, H, D } = this;
    const mk = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };

    if (cabinet) {
      const frame = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.3, metalness: 0.85 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.9 });

      this.base = mk(W, 0.34, D, frame, 0, 0.17, 0);
      this.cap = mk(W, 0.22, D, frame, 0, H - 0.11, 0);
      mk(W, H - 0.56, 0.04, dark, 0, H / 2, -D / 2 + 0.02);            // back
      for (const s of [-1, 1]) mk(0.04, H - 0.56, D, dark, s * (W / 2 - 0.02), H / 2, 0); // sides
      for (const s of [-1, 1]) mk(0.05, H - 0.56, 0.05, frame, s * (W / 2 - 0.025), H / 2, D / 2 - 0.025); // front posts

      // Inner back glow (brightens as the hologram appears)
      this.backGlowMat = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(0.02) });
      const backGlow = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, H - 0.62), this.backGlowMat);
      backGlow.position.set(0, H / 2, -D / 2 + 0.045);
      g.add(backGlow);

      // Front glass
      this.glass = new THREE.Mesh(
        new THREE.PlaneGeometry(W - 0.1, H - 0.56),
        // Satin rather than mirror glass: a mirror catches the room's lights as bright spots in front of the hologram.
        new THREE.MeshStandardMaterial({ color: 0xcfefff, roughness: 0.28, metalness: 0.2, transparent: true, opacity: 0.06, depthWrite: false }),
      );
      this.glass.position.set(0, H / 2, D / 2 - 0.02);
      this.glass.renderOrder = 6;
      g.add(this.glass);

      // Glow strips on its front
      this.stripMat = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(0.8) });
      mk(W - 0.2, 0.02, 0.01, this.stripMat, 0, 0.3, D / 2 + 0.005);
      mk(W - 0.2, 0.02, 0.01, this.stripMat, 0, H - 0.2, D / 2 + 0.005);

      const label = textPlane(W - 0.3, 0.1, 1024, (ctx, w, h) => {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#8D96A6';
        ctx.font = `500 ${h * 0.6}px ${FONT.mono}`;
        spacedText(ctx, 'HOLOBOX · WHITE TUSKER', w / 2, h / 2, 12);
      });
      label.position.set(0, 0.17, D / 2 + 0.006);
      g.add(label);
    }

    // Emitter on the cabinet's floor
    this.emitterMat = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(0.4) });
    const emitter = new THREE.Mesh(new THREE.CircleGeometry(0.3, 48).rotateX(-Math.PI / 2), this.emitterMat);
    emitter.position.set(0, floor + 0.005, 0.02);
    g.add(emitter);
    // Light beam from the emitter
    this.beamUniforms = { uAmt: { value: 0 }, uTime: { value: 0 }, uColor: { value: accent.clone() } };
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.26, 1.9, 48, 1, true),
      new THREE.ShaderMaterial({
        uniforms: this.beamUniforms,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uAmt, uTime; uniform vec3 uColor; varying vec2 vUv;
          void main(){
            float fade = pow(max(1.0 - vUv.y, 0.0), 1.6); // clamp: pow of a negative is NaN
            float streak = 0.6 + 0.4 * sin(vUv.x * 60.0 + uTime * 2.0) * sin(vUv.x * 23.0 - uTime);
            float a = fade * streak * 0.1 * uAmt;
            gl_FragColor = vec4(uColor * a, a);
          }`,
      }),
    );
    beam.position.set(0, floor + 0.01 + 0.95, 0.02);
    beam.renderOrder = 5;
    g.add(beam);

    this.#buildHologram();

    this.light = new THREE.PointLight(COLOR.accent, 0, 5, 2);
    // Inside the cabinet, behind the glass: a light in front would show as a hot spot reflected in the glass.
    this.light.position.set(0, 1.2, -0.1);
    g.add(this.light);

    this.hitTargets = cabinet ? [this.glass, this.base, this.cap] : [];   // without a cabinet, the zone gives its own
    this.collider = { minX: -W / 2 - 0.05, maxX: W / 2 + 0.05, minZ: -D / 2 - 0.05, maxZ: D / 2 + 0.05 };
  }

  #buildHologram() {
    // A standing figure, 1.75 m tall, facing out of the cabinet (+z). Local units are
    // metres; the feet sit at y = -1.05 (the top of the base) and the head tops out at 0.70.
    const pts = [];
    const seeds = [];
    const kinds = [];
    const add = (x, y, z, kind = 0, seed = Math.random()) => { pts.push(x, y, z); seeds.push(seed); kinds.push(kind); };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const onSphere = () => {
      const u = rnd(-1, 1), th = rnd(0, Math.PI * 2), r = Math.sqrt(1 - u * u);
      return [r * Math.cos(th), u, r * Math.sin(th)];
    };
    const ellipsoid = (cx, cy, cz, rx, ry, rz, n) => {
      for (let i = 0; i < n; i++) { const [x, y, z] = onSphere(); add(cx + x * rx, cy + y * ry, cz + z * rz); }
    };
    const limb = (a, b, r0, r1, n) => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
      const axis = B.clone().sub(A).normalize();
      const u = new THREE.Vector3(1, 0, 0).cross(axis).normalize();
      if (u.lengthSq() < 1e-6) u.set(0, 0, 1);
      const v = axis.clone().cross(u).normalize();
      for (let i = 0; i < n; i++) {
        const t = Math.random(), th = rnd(0, Math.PI * 2), r = r0 + (r1 - r0) * t;
        const p = A.clone().lerp(B, t).addScaledVector(u, Math.cos(th) * r).addScaledVector(v, Math.sin(th) * r);
        add(p.x, p.y, p.z);
      }
    };
    // Torso: elliptical slices from the hips to the base of the neck.
    const profile = [[-0.16, 0.16, 0.1], [0.05, 0.14, 0.09], [0.25, 0.185, 0.115], [0.35, 0.2, 0.1], [0.41, 0.07, 0.06]];
    const at = (y) => {
      for (let i = 1; i < profile.length; i++) {
        const [y0, x0, z0] = profile[i - 1], [y1, x1, z1] = profile[i];
        if (y <= y1) { const k = (y - y0) / (y1 - y0); return [x0 + (x1 - x0) * k, z0 + (z1 - z0) * k]; }
      }
      return profile[profile.length - 1].slice(1);
    };
    for (let i = 0; i < 950; i++) {
      const y = rnd(-0.16, 0.41), [rx, rz] = at(y), th = rnd(0, Math.PI * 2);
      add(Math.cos(th) * rx, y, Math.sin(th) * rz);
    }
    ellipsoid(0, 0.58, 0.005, 0.092, 0.12, 0.105, 540);          // head
    limb([0, 0.4, 0], [0, 0.48, 0.005], 0.05, 0.048, 70);         // neck
    for (const s of [-1, 1]) {
      ellipsoid(s * 0.2, 0.335, 0, 0.06, 0.055, 0.06, 60);           // shoulder
      limb([s * 0.215, 0.33, 0], [s * 0.25, 0.04, 0.01], 0.047, 0.04, 160);    // upper arm
      limb([s * 0.25, 0.04, 0.01], [s * 0.24, -0.22, 0.04], 0.038, 0.032, 120); // forearm
      ellipsoid(s * 0.24, -0.29, 0.05, 0.03, 0.06, 0.04, 50);         // hand
      limb([s * 0.085, -0.13, 0], [s * 0.095, -0.58, 0.01], 0.075, 0.055, 240); // thigh
      limb([s * 0.095, -0.58, 0.01], [s * 0.095, -0.99, 0], 0.052, 0.04, 180);  // shin
      ellipsoid(s * 0.095, -1.025, 0.05, 0.045, 0.028, 0.1, 50);      // foot
    }
    // Light rings on the floor of the cabinet: (angle, radius, unused)
    const rings = 3, ringPts = 200;
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < ringPts; k++) add((k / ringPts) * Math.PI * 2, 0.4 + r * 0.08, 0, 1, r / rings);
    }
    // Motes rising around the figure
    for (let k = 0; k < 300; k++) {
      const a = rnd(0, Math.PI * 2), rr = rnd(0.3, 0.5);
      add(Math.cos(a) * rr, 0, Math.sin(a) * rr, 2);
    }

    const count = seeds.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aPos', new THREE.BufferAttribute(new Float32Array(pts), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seeds), 1));
    geo.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(kinds), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);

    this.holoUniforms = {
      uTime: { value: 0 },
      uMat: { value: 0 },
      uLevel: { value: 0 },
      uScale: { value: 800 },
      uColor: { value: accent.clone() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.holoUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute float aSeed; attribute float aKind;
        uniform float uTime, uMat, uLevel, uScale;
        uniform vec3 uColor;
        varying vec3 vCol; varying float vAlpha;
        void main(){
          vec3 p; float size = 0.01; float alpha = 1.0; vec3 col = uColor;
          if (aKind < 0.5) {
            // The figure: builds up from the base, shimmers, and its face brightens as it speaks.
            p = aPos;
            float h = (aPos.y + 1.05) / 1.75;
            float reveal = smoothstep(0.0, 0.12, uMat * 1.2 - h - aSeed * 0.05);
            p.x += 0.004 * sin(aSeed * 50.0 + uTime * 3.0);
            p.z += 0.004 * cos(aSeed * 37.0 + uTime * 2.6);
            float glitch = step(0.985, fract(sin(floor(uTime * 7.0) * 12.9898 + floor(aPos.y * 30.0) * 78.233) * 43758.5453));
            p.x += glitch * 0.03;
            p = mix(vec3(p.x * 0.2, -1.05, p.z * 0.2), p, reveal);
            float face = (1.0 - smoothstep(0.0, 0.16, length(vec2(aPos.x, (aPos.y - 0.56) * 0.8)))) * step(0.0, aPos.z);
            float speak = uLevel * face;
            float scan = 0.7 + 0.3 * sin(aPos.y * 140.0 - uTime * 5.0);
            alpha = reveal * scan * (0.55 + 0.3 * sin(aSeed * 70.0 + uTime * 2.0));
            col = mix(uColor, vec3(0.88, 1.0, 0.97), 0.35 + speak * 0.6);
            size = 0.01 + speak * 0.008;
          } else if (aKind < 1.5) {
            float ang = aPos.x + uTime * (0.35 + aSeed * 0.5) * (aSeed > 0.5 ? -1.0 : 1.0);
            p = vec3(cos(ang) * aPos.y, -1.03 + aSeed * 0.06, sin(ang) * aPos.y);
            alpha = smoothstep(0.0, 0.3, uMat) * 0.5;
            size = 0.011;
          } else {
            float h = fract(aSeed + uTime * 0.12);
            p = vec3(aPos.x, -1.05 + h * 1.8, aPos.z);
            alpha = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.6, 1.0, h)) * 0.5 * uMat;
            size = 0.01;
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, size * uScale / -mv.z);
          vCol = col; vAlpha = alpha;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vAlpha;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = 1.0 - smoothstep(0.0, 0.5, d);
          gl_FragColor = vec4(vCol * 1.05 * a, a * vAlpha * 0.85);
        }`,
    });
    this.hologram = new THREE.Points(geo, mat);
    this.hologram.position.set(0, this.floor + 1.08, 0.02);   // feet just above the floor
    this.hologram.renderOrder = 5;
    this.hologram.frustumCulled = false;
    this.group.add(this.hologram);
  }

  summon() {
    this.target = 1;
  }

  /** Gone at once (the visitor walked away): no fade. summon() brings it back. */
  dismiss() {
    this.target = 0;
    this.materialise = 0;
  }

  get summoned() {
    return this.target > 0;
  }

  update(dt, t, level, pointScale) {
    const speed = this.target > this.materialise ? 0.42 : 1.5;
    this.materialise += Math.sign(this.target - this.materialise) * Math.min(Math.abs(this.target - this.materialise), dt * speed);
    const m = this.materialise;
    const u = this.holoUniforms;
    u.uTime.value = t;
    u.uMat.value = m;
    u.uLevel.value = level * Math.min(1, m * 2);
    u.uScale.value = pointScale;
    this.beamUniforms.uTime.value = t;
    this.beamUniforms.uAmt.value = 0.25 + m * 0.75 + level * 0.3;
    this.emitterMat.color.copy(accent).multiplyScalar(0.3 + m * 0.9 + level * 0.4);
    if (this.cabinet) {
      this.backGlowMat.color.copy(accent).multiplyScalar(0.015 + m * 0.035);
      this.stripMat.color.copy(accent).multiplyScalar(0.8 + m * 0.8);
    }
    this.light.intensity = m * (0.35 + level * 0.4);
    this.hologram.rotation.y = Math.sin(t * 0.3) * 0.05; // barely turns: a person facing the visitor
  }
}
