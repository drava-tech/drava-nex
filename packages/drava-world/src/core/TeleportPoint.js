import * as THREE from 'three';
import { COLOR } from '../config.js';

const accent = new THREE.Color(COLOR.accent);

/** A glowing floor ring (a stop) you can click to glide to. */
export class TeleportPoint {
  constructor({ id, label, short = label, x, z, look }) {
    this.id = id;
    this.label = label;
    this.short = short;           // name in the stops bar
    this.x = x;
    this.z = z;
    this.look = look;             // Vector3 to face after arriving
    this.hover = false;
    this.here = false;
    this.visibleLevel = 1;

    const g = (this.group = new THREE.Group());
    g.position.set(x, 0.018, z);
    g.renderOrder = 3;

    const flat = (geo) => { geo.rotateX(-Math.PI / 2); return geo; };
    this.ringMat = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(1.8), transparent: true, depthWrite: false });
    this.ring = new THREE.Mesh(flat(new THREE.RingGeometry(0.4, 0.46, 64)), this.ringMat);
    this.fillMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending });
    this.fill = new THREE.Mesh(flat(new THREE.CircleGeometry(0.4, 48)), this.fillMat);
    this.pulseMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    this.pulse = new THREE.Mesh(flat(new THREE.RingGeometry(0.46, 0.49, 64)), this.pulseMat);
    this.hit = new THREE.Mesh(flat(new THREE.CircleGeometry(0.7, 24)), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.y = 0.01;
    for (const m of [this.ring, this.fill, this.pulse]) m.renderOrder = 3;
    g.add(this.fill, this.ring, this.pulse, this.hit);
    this.phase = Math.random();
  }

  setHover(on) { this.hover = on; }

  update(dt, t, playerPos) {
    this.here = Math.hypot(playerPos.x - this.x, playerPos.z - this.z) < 0.9;
    const target = this.here ? 0.25 : 1;
    this.visibleLevel += (target - this.visibleLevel) * Math.min(1, dt * 6);
    const hv = this.hover ? 1 : 0;
    const s = 1 + hv * 0.15;
    this.ring.scale.setScalar(s);
    this.fill.scale.setScalar(s);
    this.ringMat.opacity = 0.9 * this.visibleLevel;
    this.fillMat.opacity = (0.06 + hv * 0.18) * this.visibleLevel;
    const k = (t * 0.55 + this.phase) % 1;
    this.pulse.scale.setScalar(1 + k * 0.9);
    this.pulseMat.opacity = (1 - k) * 0.45 * this.visibleLevel;
  }
}
