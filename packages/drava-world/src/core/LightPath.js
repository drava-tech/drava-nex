import * as THREE from 'three';
import { COLOR } from '../config.js';

/**
 * A dashed line of light on the floor that guides the visitor.
 * reveal(fraction) extends it along the route as each step is completed.
 * stops: [[x, z], ...] waypoints. mark(i) → the fraction where stop i sits.
 */
export class LightPath {
  constructor(stops, { spacing = 0.55, color = COLOR.accent } = {}) {
    this.curve = new THREE.CatmullRomCurve3(stops.map(([x, z]) => new THREE.Vector3(x, 0.013, z)), false, 'centripetal', 0.3);
    const length = this.curve.getLength();
    const count = Math.floor(length / spacing);
    this.stopsAt = stops.map(([x, z]) => this.#fractionNear(x, z));

    const geo = new THREE.PlaneGeometry(0.075, 0.26).rotateX(-Math.PI / 2);
    const along = new Float32Array(count);
    this.uniforms = { uReveal: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aAlong; varying float vAlong;
        void main(){ vAlong = aAlong; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uReveal, uTime; uniform vec3 uColor; varying float vAlong;
        void main(){
          float shown = smoothstep(uReveal, uReveal - 0.015, vAlong);
          float wave = pow(fract(vAlong * 5.0 - uTime * 0.45), 6.0);
          float a = shown * (0.3 + 1.2 * wave);
          gl_FragColor = vec4(uColor * a * 1.5, a);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count;
      const p = this.curve.getPointAt(u);
      const tng = this.curve.getTangentAt(u);
      q.setFromAxisAngle(up, Math.atan2(tng.x, tng.z));
      m4.compose(p, q, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(i, m4);
      along[i] = u;
    }
    geo.setAttribute('aAlong', new THREE.InstancedBufferAttribute(along, 1));
    this.revealTarget = 0;
  }

  #fractionNear(x, z) {
    const pts = this.curve.getSpacedPoints(400);
    let best = 0, bestD = Infinity;
    pts.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bestD) { bestD = d; best = i; } });
    return best / 400;
  }

  /** Extend the path up to waypoint i. */
  revealTo(i) {
    this.revealTarget = Math.max(this.revealTarget, this.stopsAt[Math.min(i, this.stopsAt.length - 1)] + 0.01);
  }

  update(dt, t) {
    const u = this.uniforms;
    u.uTime.value = t;
    u.uReveal.value += (this.revealTarget - u.uReveal.value) * Math.min(1, dt * 1.2);
  }
}
