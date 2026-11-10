import * as THREE from 'three';
import { FONT, corsUrl, drawContent, isAnimated } from './shared/render.js';
import { contentKey } from './shared/state.js';

const CANVAS_H = 720;   // drawn content is this tall and as wide as the screen's shape
const FADE = 0.45;          // seconds to crossfade from one item to the next
const LEVEL = 0.86;         // under full white, so bright content doesn't bloom into a haze
const BOARD_LEVEL = 0.5;    // a whiteboard is a wall of white: lower still, so the ink stays readable
const OSD = { w: 640, h: 120, height: 0.13, bottom: 0.08, hold: 2.2 };   // the volume overlay: canvas, share of the screen's height, from the foot, seconds shown
// show(r, { enter }): the new item slides in instead of fading, as on Push's displays (1.5 s,
// easing out). enter: which way it moves; where it starts, in the screen's UV space.
const SLIDE_S = 1.5;
const SLIDE_FROM = { up: [0, -1], left: [1, 0], right: [-1, 0] };

/**
 * A strip of a vertical cylinder, seen from inside: radius r, from angle `from` to `to`
 * (radians, 0 straight ahead along -z, positive toward +x), `height` tall, centred on
 * y = 0 round the cylinder's axis. UVs run left to right as seen from the axis.
 */
export function arcGeometry(r, from, to, height, segments = 48) {
  const geo = new THREE.PlaneGeometry(1, height, segments, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = from + (pos.getX(i) + 0.5) * (to - from);
    pos.setXYZ(i, r * Math.sin(a), pos.getY(i), -r * Math.cos(a));
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * One of the Nex Zone's wall screens: an LED screen (16:9 or wider) in a thin bezel, showing what the
 * Nex assigns to it (resolved content, shared/state.js), crossfading between items.
 *  - experiences, the idle screen and the blackout are drawn on a canvas (shared/render.js),
 *    animated ones about 30 times a second
 *  - experiences and the idle screen are drawn at the screen's own shape, so they fill it
 *  - images and videos are textures, fitted inside the screen (letterboxed if needed)
 * Video sound follows both the Nex's per-screen setting and setSound() (the HUD's sound
 * switch while the visitor is in the zone). showVolume() puts a volume bar over the picture
 * for a moment, like a TV's, when the sound changes.
 *
 * arc: { radius, from, to } bends the screen into a strip of a curved wall (see arcGeometry),
 * with the group at the curve's axis and no bezel of its own: several of them make one
 * curved screen, each still its own display. bezel: false leaves out the bezel too (a screen set
 * into a model that has its own frame).
 */
export class WallDisplay {
  constructor({ width, height, arc = null, bezel = true }) {
    this.width = width;
    this.height = height;
    this.canvasW = Math.round((CANVAS_H * width) / height);
    this.sound = false;
    this.volume = 1;
    const g = (this.group = new THREE.Group());

    if (!arc && bezel) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.12, height + 0.12, 0.1), new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.5, metalness: 0.6 }));
      frame.position.z = -0.055;
      g.add(frame);
    }

    this.uniforms = {
      uA: { value: null }, uB: { value: null },
      uAspA: { value: 16 / 9 }, uAspB: { value: 16 / 9 },
      uMix: { value: 0 },
      uAspect: { value: width / height },
      uLevel: { value: LEVEL },
      uOsd: { value: null },
      uOsdA: { value: 0 },
      uOsdBox: { value: new THREE.Vector4() },
      uSlide: { value: new THREE.Vector2() },
      uSliding: { value: 0 },
    };
    this.osd = Object.assign(document.createElement('canvas'), { width: OSD.w, height: OSD.h });
    this.uniforms.uOsd.value = new THREE.CanvasTexture(this.osd);
    this.uniforms.uOsd.value.colorSpace = THREE.SRGBColorSpace;
    const ow = (OSD.height * height * (OSD.w / OSD.h)) / width;   // the overlay's width as a share of the screen's
    this.uniforms.uOsdBox.value.set(0.5 - ow / 2, OSD.bottom, ow, OSD.height);
    this.osdTime = 0;
    this.screen = new THREE.Mesh(
      arc ? arcGeometry(arc.radius, arc.from, arc.to, height) : new THREE.PlaneGeometry(width, height),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: /* glsl */ `
          uniform sampler2D uA, uB, uOsd;
          uniform float uAspA, uAspB, uMix, uAspect, uLevel, uOsdA, uSliding;
          uniform vec4 uOsdBox;
          uniform vec2 uSlide;
          varying vec2 vUv;
          // Fit a picture inside the screen, centred, keeping its shape; black around it.
          vec3 fitted(sampler2D tex, float aspect, vec2 at){
            vec2 uv = at - 0.5;
            if (aspect > uAspect) uv.y *= aspect / uAspect; else uv.x *= uAspect / aspect;
            uv += 0.5;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
            return texture2D(tex, uv).rgb;
          }
          void main(){
            vec3 a = fitted(uA, uAspA, vUv);
            vec3 col;
            if (uSliding > 0.5) {
              // The new item slides over the old one, from uSlide toward where it belongs.
              vec2 at = vUv - uSlide;
              bool inB = at.x >= 0.0 && at.x <= 1.0 && at.y >= 0.0 && at.y <= 1.0;
              col = inB ? fitted(uB, uAspB, at) : a;
            } else {
              col = mix(a, fitted(uB, uAspB, vUv), uMix);
            }
            vec2 o = (vUv - uOsdBox.xy) / uOsdBox.zw;
            if (uOsdA > 0.0 && o.x >= 0.0 && o.x <= 1.0 && o.y >= 0.0 && o.y <= 1.0) {
              vec4 t = texture2D(uOsd, o);
              col = mix(col, t.rgb, t.a * uOsdA);
            }
            gl_FragColor = vec4(col * uLevel, 1.0);
          }`,
      }),
    );
    g.add(this.screen);
    this.hitTargets = [this.screen];

    this.current = null;    // the layer on show (uA)
    this.next = null;       // the layer fading in (uB)
    this.key = null;
    this.clock = 0;
  }

  /**
   * Show resolved content. Same content again only updates the sound setting. enter ('up',
   * 'left', 'right'): slide it in that way instead of crossfading.
   */
  show(r, { enter = null } = {}) {
    const key = contentKey(r);
    this.want = r;
    if (key === this.key) { this.#applySound(); return; }
    this.key = key;
    const layer = this.#makeLayer(r);
    layer.enter = SLIDE_FROM[enter] ? enter : null;
    if (this.next) this.#dispose(this.next);
    this.next = layer;
    this.uniforms.uB.value = layer.texture;
    this.uniforms.uAspB.value = layer.aspect;
    this.uniforms.uMix.value = 0;
    this.fading = layer.ready ? 0 : null;   // wait for images and videos to have a frame
  }

  #makeLayer(r) {
    if (r.kind === 'media' && r.type === 'image') {
      const layer = { r, aspect: 16 / 9, ready: false };
      layer.texture = new THREE.TextureLoader().setCrossOrigin('anonymous').load(corsUrl(r.url), (tex) => {
        layer.aspect = tex.image.width / tex.image.height;
        if (this.next === layer) this.uniforms.uAspB.value = layer.aspect;
        layer.ready = true;
      }, undefined, () => { layer.ready = true; });
      layer.texture.colorSpace = THREE.SRGBColorSpace;
      return layer;
    }
    if (r.kind === 'media' && r.type === 'video') {
      const video = Object.assign(document.createElement('video'), { src: corsUrl(r.url), loop: true, playsInline: true, crossOrigin: 'anonymous', muted: true, preload: 'auto' });
      const layer = { r, video, aspect: 16 / 9, ready: false };
      video.addEventListener('loadeddata', () => {
        layer.aspect = video.videoWidth / video.videoHeight || 16 / 9;
        if (this.next === layer) this.uniforms.uAspB.value = layer.aspect;
        layer.ready = true;
      }, { once: true });
      video.addEventListener('error', () => { layer.ready = true; }, { once: true });
      layer.texture = new THREE.VideoTexture(video);
      layer.texture.colorSpace = THREE.SRGBColorSpace;
      this.#play(layer);
      return layer;
    }
    const canvas = Object.assign(document.createElement('canvas'), { width: this.canvasW, height: CANVAS_H });
    const layer = { r, canvas, ctx: canvas.getContext('2d'), aspect: this.width / this.height, ready: true, t0: this.clock, animated: isAnimated(r) };
    layer.texture = new THREE.CanvasTexture(canvas);
    layer.texture.colorSpace = THREE.SRGBColorSpace;
    this.#draw(layer);
    if (!layer.animated) setTimeout(() => { if (layer.canvas) this.#draw(layer); }, 500);   // the idle logo may still be loading
    return layer;
  }

  #draw(layer) {
    drawContent(layer.ctx, this.canvasW, CANVAS_H, layer.r, Math.max(0, this.clock - layer.t0));
    layer.texture.needsUpdate = true;
  }

  #play(layer) {
    const v = layer.video;
    v.volume = this.volume;
    v.muted = layer.r.muted || !this.sound || this.volume === 0;
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  }

  #applySound() {
    for (const layer of [this.current, this.next]) {
      if (layer?.video) {
        layer.r = { ...layer.r, muted: this.want.muted };
        layer.video.volume = this.volume;
        layer.video.muted = this.want.muted || !this.sound || this.volume === 0;
      }
    }
  }

  /** The HUD's sound switch, while the visitor is in the zone. */
  setSound(on) {
    this.sound = on;
    this.#applySound();
  }

  /** The room's master volume, 0..1 (the Nex's Environment → Audio). */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.want) this.#applySound();
  }

  /** Show the volume bar for a moment: level 0..100; muted shows it struck through. */
  showVolume(level, muted) {
    const ctx = this.osd.getContext('2d');
    const { w, h } = OSD;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(6,7,9,0.82)';
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, h / 2 - 2);
    ctx.fill();
    // A speaker, with waves for the level, or a cross when muted.
    const col = muted ? '#a3a3a3' : '#ffffff';
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(44, 48); ctx.lineTo(58, 48); ctx.lineTo(78, 30); ctx.lineTo(78, 90); ctx.lineTo(58, 72); ctx.lineTo(44, 72);
    ctx.closePath();
    ctx.fill();
    if (muted) {
      ctx.beginPath();
      ctx.moveTo(94, 46); ctx.lineTo(120, 74); ctx.moveTo(120, 46); ctx.lineTo(94, 74);
      ctx.stroke();
    } else {
      for (let i = 0; i < 3; i++) {
        if (level <= i * 33) break;
        ctx.beginPath();
        ctx.arc(80, 60, 18 + i * 13, -0.75, 0.75);
        ctx.stroke();
      }
    }
    // The bar and the number.
    const x0 = 150, x1 = w - 130, y = h / 2;
    ctx.fillStyle = '#2a2d33';
    ctx.beginPath();
    ctx.roundRect(x0, y - 7, x1 - x0, 14, 7);
    ctx.fill();
    ctx.fillStyle = muted ? '#525252' : '#9978ff';
    ctx.beginPath();
    ctx.roundRect(x0, y - 7, Math.max(14, ((x1 - x0) * level) / 100), 14, 7);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.font = `700 40px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(muted ? 'MUTE' : String(Math.round(level)), w - 40, y + 2);
    this.uniforms.uOsd.value.needsUpdate = true;
    this.osdTime = OSD.hold;
  }

  /** play / pause / restart the video on this screen (from the Nex's control page). */
  command(action, value) {
    const v = (this.next ?? this.current)?.video;
    if (!v) return;
    if (action === 'play') v.play().catch(() => {});
    if (action === 'pause') v.pause();
    if (action === 'restart') { v.currentTime = 0; v.play().catch(() => {}); }
    if (action === 'seek' && Number.isFinite(value)) v.currentTime = value;   // seconds (Push's card controls)
    if (action === 'volume' && Number.isFinite(value)) this.setVolume(value);
  }

  /** The video on show, if any: { playing, time, duration, muted, volume } (for Push's card controls). */
  videoState() {
    const layer = this.next ?? this.current;
    const v = layer?.video;
    return v ? { playing: !v.paused, time: v.currentTime, duration: v.duration || 0, muted: !!layer.r.muted, volume: this.volume } : null;
  }

  /** Stop all playback (the visitor left the zone). show() picks up again. */
  pause() {
    for (const layer of [this.current, this.next]) layer?.video?.pause();
  }

  resume() {
    for (const layer of [this.current, this.next]) if (layer?.video) this.#play(layer);
  }

  #dispose(layer) {
    if (layer.video) { layer.video.pause(); layer.video.removeAttribute('src'); layer.video.load(); }
    layer.texture?.dispose();
    layer.canvas = null;
  }

  update(dt) {
    this.clock += dt;
    const u = this.uniforms;
    if (this.next) {
      if (this.fading === null && this.next.ready) this.fading = 0;
      if (this.fading !== null) {
        this.fading += dt;
        const enter = this.next.enter;
        let done;
        if (enter) {
          const t = Math.min(1, this.fading / SLIDE_S);
          const k = 1 - (1 - t) ** 4;   // close to Push's cubic-bezier(.22, 1, .36, 1)
          const [x, y] = SLIDE_FROM[enter];
          u.uSliding.value = 1;
          u.uSlide.value.set(x * (1 - k), y * (1 - k));
          done = t >= 1;
        } else {
          u.uSliding.value = 0;
          u.uMix.value = Math.min(1, this.fading / FADE);
          done = u.uMix.value >= 1;
        }
        if (done) {
          if (this.current) this.#dispose(this.current);
          this.current = this.next;
          this.next = null;
          u.uA.value = this.current.texture;
          u.uAspA.value = this.current.aspect;
          u.uMix.value = 0;
          u.uSliding.value = 0;
        }
      }
    }
    // A whiteboard on show (or fading in) is dimmed so its white doesn't bloom over the ink.
    const board = (this.next ?? this.current)?.r?.kind === 'whiteboard';
    u.uLevel.value += ((board ? BOARD_LEVEL : LEVEL) - u.uLevel.value) * Math.min(1, dt * 6);
    // The volume bar fades in, holds, and fades out.
    this.osdTime = Math.max(0, this.osdTime - dt);
    u.uOsdA.value += ((this.osdTime > 0 ? 1 : 0) - u.uOsdA.value) * Math.min(1, dt * 8);
    if (u.uOsdA.value < 0.01 && this.osdTime === 0) u.uOsdA.value = 0;
    // Redraw animated experiences about 30 times a second.
    this.tick = (this.tick ?? 0) + dt;
    if (this.tick >= 1 / 30) {
      this.tick = 0;
      for (const layer of [this.current, this.next]) if (layer?.animated) this.#draw(layer);
    }
  }
}
