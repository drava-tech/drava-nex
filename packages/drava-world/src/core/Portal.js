import * as THREE from 'three';
import { COLOR } from '../config.js';
import { FONT, spacedText, textPlane } from '../util/textures.js';

const DEFAULT = { ground: 0x030508, glow: COLOR.accent, frame: COLOR.accent, kicker: '#FF4D63', title: '#EEF0F3', glowScale: 1, lightScale: 1 };

/**
 * A doorway to the next zone: a glowing frame lined in brand red, a swirling portal surface
 * and a sign (its kicker in red: red marks the way on in every zone). setOpen(true) brightens it once the visitor has finished this zone.
 * palette: { ground, glow, frame, kicker, title, glowScale, lightScale } lets a zone dress
 * the door in the next zone's colours (default: the centre's white). A pale glow (white)
 * needs lower glowScale / lightScale, or it blooms and floods the wall around it.
 * classic: the door from before the brand-red pass (white kicker, no red liner).
 * kicker: fixed text above the zone name (e.g. '←  BACK TO'); by default 'UP NEXT' until
 * the door opens, then 'TELEPORT  →'.
 */
/** A door frame as one solid: an upside-down U of bar thickness t round a width × height opening, depth deep (from z 0 to z depth). */
function doorFrame(width, height, t, depth) {
  const x = width / 2;
  const s = new THREE.Shape([[-x - t, 0], [-x - t, height + t], [x + t, height + t], [x + t, 0], [x, 0], [x, height], [-x, height], [-x, 0]].map(([a, b]) => new THREE.Vector2(a, b)));
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}

export class Portal {
  constructor({ zone, width = 3.2, height = 3.4, palette = {}, kicker = null, classic = false }) {
    this.zone = zone;
    this.kicker = kicker;
    this.palette = { ...DEFAULT, ...(classic && { kicker: '#FBFAF5' }), ...palette };
    this.frameColor = new THREE.Color(this.palette.frame);
    this.width = width;
    this.height = height;
    this.open = 0;
    this.openTarget = 0;
    this.hover = 0;
    const g = (this.group = new THREE.Group());

    // Surface
    this.uniforms = {
      uTime: { value: 0 },
      uOpen: { value: 0 },
      uHover: { value: 0 },
      uColor: { value: new THREE.Color(this.palette.glow) },
      uGround: { value: new THREE.Color(this.palette.ground) },
      uGlowScale: { value: this.palette.glowScale },
    };
    this.surface = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uOpen, uHover, uGlowScale;
          uniform vec3 uColor, uGround;
          varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
            return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
          void main() {
            vec2 p = (vUv - vec2(0.5, 0.42)) * vec2(1.0, 1.06);
            float r = length(p);
            // The swirl: the plane turned more toward the middle, then noise. (Not atan(): its jump
            // from +pi to -pi tore the surface along a seam.)
            float turn = r * 3.0 - uTime * 0.6;
            vec2 q = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * p;
            float swirl = noise(q * 7.0 + vec2(0.0, -uTime * 0.4));
            float rings = pow(0.5 + 0.5 * sin(r * 34.0 - uTime * (2.0 + 3.0 * uOpen) + swirl * 3.0), 6.0);
            float energy = (mix(0.18, 1.0, uOpen) + uHover * 0.35) * uGlowScale;
            vec3 col = uGround * (0.35 + 0.25 * energy);
            col += uColor * rings * (0.25 + 0.9 * energy) * smoothstep(0.75, 0.05, r);
            col += uColor * smoothstep(0.45, 0.0, r) * 0.35 * energy;
            col += vec3(1.0) * smoothstep(0.08, 0.0, r) * 0.6 * uOpen;
            // floor spill at the bottom edge
            col += uColor * smoothstep(0.1, 0.0, vUv.y) * 0.5 * energy;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.surface.position.set(0, height / 2, -0.35);
    g.add(this.surface);

    // Recess (short tunnel) so the portal sits inside the wall, and the glowing frame round the
    // opening: each one piece, so no seams show at the corners.
    const depth = 0.4;
    const recess = new THREE.Mesh(doorFrame(width, height, 0.06, depth), new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.8 }));
    recess.position.z = -depth;
    g.add(recess);
    this.frameMat = new THREE.MeshBasicMaterial({ color: this.frameColor.clone() });
    const frame = new THREE.Mesh(doorFrame(width, height, 0.05, 0.03), this.frameMat);
    frame.position.z = 0.005;
    g.add(frame);
    this.linerColor = new THREE.Color(COLOR.brand);
    this.linerMat = new THREE.MeshBasicMaterial({ color: this.linerColor.clone() });
    const liner = new THREE.Mesh(doorFrame(width - 0.05, height - 0.025, 0.025, 0.02), this.linerMat);
    liner.position.z = 0.004;
    if (!classic) g.add(liner);

    // Sign above the doorway
    this.sign = textPlane(5.2, 0.62, 2048, (ctx, w, h) => this.#drawSign(ctx, w, h));
    this.sign.position.set(0, height + 0.62, 0.03);
    g.add(this.sign);

    this.light = new THREE.PointLight(this.palette.glow, 0, 7, 2);
    this.light.position.set(0, 1.4, 0.6);
    g.add(this.light);

    this.hitTargets = [this.surface];
  }

  #drawSign(ctx, w, h) {
    const open = this.openTarget > 0.5;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.palette.kicker;
    ctx.font = `500 ${h * 0.24}px ${FONT.mono}`;
    spacedText(ctx, this.kicker ?? (open ? 'TELEPORT  →' : 'UP NEXT'), w / 2, h * 0.2, 14);
    ctx.fillStyle = this.palette.title;
    const title = `${this.zone.n} · ${this.zone.name.replace(/^The /, '').toUpperCase()}`;
    ctx.font = `700 ${h * 0.4}px ${FONT.display}`;
    const wide = ctx.measureText(title).width + 6 * title.length;     // as spacedText draws it
    if (wide > w * 0.96) ctx.font = `700 ${(h * 0.4 * w * 0.96) / wide}px ${FONT.display}`; // long names: smaller, not clipped
    spacedText(ctx, title, w / 2, h * 0.66, 6);
  }

  setOpen(open) {
    this.openTarget = open ? 1 : 0;
    this.sign.userData.canvas.redraw((ctx, w, h) => this.#drawSign(ctx, w, h));
  }

  setHover(on) { this.hoverTarget = on ? 1 : 0; }

  update(dt, t) {
    this.open += (this.openTarget - this.open) * Math.min(1, dt * 2);
    this.hover += ((this.hoverTarget || 0) - this.hover) * Math.min(1, dt * 8);
    this.uniforms.uTime.value = t;
    this.uniforms.uOpen.value = this.open;
    this.uniforms.uHover.value = this.hover;
    this.frameMat.color.copy(this.frameColor).multiplyScalar(0.6 + this.open * 1.4 + this.hover * 0.6);
    this.linerMat.color.copy(this.linerColor).multiplyScalar(0.9 + this.open * 0.5 + this.hover * 0.8);
    this.light.intensity = (1.5 + this.open * 6) * this.palette.lightScale;
  }
}
