import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { COLOR, GLOW } from '../config.js';
import { Emitter } from '../util/Emitter.js';

const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _scale = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const SNAP = 0.002;   // radians: a camera tilt or roll smaller than this (about 0.1°) is drawn as none in the CSS layer
const CSS_DEPTH = 10;  // metres the CSS layer's camera sits behind that layer's origin
// Dynamic resolution (see #adapt). Calibration knobs: the pixel budget, the floor, and the frame
// times that count as slow (under ~45 fps) and as having headroom (over ~57 fps).
const MAX_PIXELS = 4.2e6;
const MIN_RATIO = 0.7;
const SLOW = 1 / 45, FAST = 1 / 57;

/**
 * Renderer, scene, camera and the frame loop.
 * Zones register per-frame callbacks with engine.onUpdate(fn(dt, t)).
 * engine.css is a CSS 3D layer over the canvas for live web pages (see WebScreen);
 * it is created the first time something asks for it.
 */
export class Engine extends Emitter {
  constructor(container, { quality = 'high' } = {}) {
    super();
    this.container = container;
    this.quality = quality;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    RectAreaLightUniformsLib.init();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLOR.ground);
    this.scene.fog = new THREE.Fog(COLOR.ground, 22, 48);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 140);
    this.camera.rotation.order = 'YXZ';

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.16;
    pmrem.dispose();

    // The scene is drawn into the composer's buffer, not the canvas, so the renderer's own antialias
    // doesn't apply: the buffer is multisampled itself (setQuality sets how many samples).
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.55, 0.82);
    this.bloom.enabled = GLOW > 0; // GLOW (config.js) scales the glow; 0 turns it off
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.timer = new THREE.Timer();
    this.frameAvg = 1 / 60;
    this.adaptWait = 3;                               // let the first frames (uploads, compiles) pass
    this.ceiling = Infinity;
    this.minRatio = MIN_RATIO;                        // a zone may ask for more (never this blurry), see #adapt
    this.updaters = new Set();
    this.overlays = new Set();
    this.time = 0;
    this.fps = 0;

    this.setQuality(quality);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  /** 'high' = sharper pixels, stronger bloom, floor reflections. 'low' = lighter on the GPU. */
  setQuality(q) {
    this.quality = q;
    this.bloom.strength = (q === 'high' ? 0.75 : 0.6) * GLOW;
    const samples = q === 'high' ? 4 : 0;
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (t.samples !== samples) { t.samples = samples; t.dispose(); }
    }
    this.ceiling = Infinity;                          // a new quality may afford more: let it climb again
    this.resize();
    this.#setRatio(this.maxRatio);
    this.emit('quality', q);
  }

  /**
   * The sharpest pixel ratio allowed: the quality's, but never more than MAX_PIXELS a frame
   * (a big screen at a high device ratio would otherwise ask the GPU for ~10 MP).
   */
  get maxRatio() {
    const want = this.quality === 'high' ? Math.min(window.devicePixelRatio, 1.75) : Math.min(window.devicePixelRatio, 1);
    return Math.max(this.minRatio, Math.min(want, Math.sqrt(MAX_PIXELS / (this.width * this.height)), this.ceiling));
  }

  #setRatio(r) {
    this.ratio = r;
    this.renderer.setPixelRatio(r);                  // both resize their buffers themselves
    this.composer.setPixelRatio(r);
  }

  /**
   * Dynamic resolution: while frames run slow, step the pixel ratio down; with headroom, step it
   * back up, but never again to a ratio that was too slow (no seesaw). Motion stays smooth on
   * any machine; only sharpness gives. dt: the real time since the last frame.
   */
  #adapt(dt) {
    if (dt > 0.25) return;                            // a stall or a background tab, not the GPU's pace
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    if ((this.adaptWait -= dt) > 0) return;
    if (this.frameAvg > SLOW && this.ratio > this.minRatio) {
      this.ceiling = this.ratio - 0.05;
      this.#setRatio(Math.max(this.minRatio, this.ratio - 0.15));
      this.adaptWait = 1.5;                           // let the average catch up before judging again
    } else if (this.frameAvg < FAST && this.ratio < this.maxRatio - 0.01) {
      this.#setRatio(Math.min(this.maxRatio, this.ratio + 0.1));
      this.adaptWait = 4;
    }
  }

  /**
   * The least pixel ratio dynamic resolution may drop to (MIN_RATIO by default). A zone that must
   * stay sharp asks for more, trading frame rate on a slow GPU for sharpness; null puts it back.
   */
  setMinRatio(r) {
    this.minRatio = r ?? MIN_RATIO;
    if (this.ratio < this.maxRatio) this.#setRatio(this.maxRatio);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    if (this.ratio > this.maxRatio) this.#setRatio(this.maxRatio);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._css?.renderer.setSize(w, h);
    this.#applyShift();
    this.emit('resize', { width: w, height: h });
  }

  /**
   * A shift lens: move the picture up or down without tilting the camera, so vertical lines
   * stay vertical (a camera pitched down makes the edges of tall things lean apart). shift is
   * in half view heights; positive shows more below, as if looking down. It is the camera's
   * view offset, which the CSS 3D layer follows too.
   */
  setLensShift(shift) {
    this.lensShift = shift;
    this.#applyShift();
  }

  /** The shift that frames like a camera pitched by `pitch` radians (negative: down). */
  shiftForPitch(pitch) {
    return Math.tan(-pitch) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
  }

  #applyShift() {
    const s = this.lensShift ?? 0;
    const px = (s * this.height) / 2;
    if (Math.abs(px) < 0.01) {
      if (this.camera.view?.enabled) this.camera.clearViewOffset();
      return;
    }
    this.camera.setViewOffset(this.width, this.height, 0, px, this.width, this.height);
  }

  /** Pixels per world unit at distance 1 — used to size point sprites. */
  get pointScale() {
    const px = this.height * this.renderer.getPixelRatio();
    return px / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  /**
   * Draw the CSS layer moved and turned (see css) so its camera faces -z from CSS_DEPTH in
   * front of the layer's plane, with any tilt or roll too small to see (a glide's last trace
   * of bank) dropped.
   */
  #renderCss() {
    const c = this._css;
    this.camera.matrixWorld.decompose(_pos, _quat, _scale);
    _euler.setFromQuaternion(_quat, 'YXZ');
    const yaw = _euler.y;
    _euler.y = 0;
    if (Math.abs(_euler.x) < SNAP) _euler.x = 0;
    if (Math.abs(_euler.z) < SNAP) _euler.z = 0;
    c.scene.rotation.y = -yaw;
    _pos.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw);   // the camera, in the turned layer
    c.scene.position.set(-_pos.x, 0, CSS_DEPTH - _pos.z);  // ...then moved to (0, y, CSS_DEPTH)
    _pos.set(0, _pos.y, CSS_DEPTH);
    c.camera.matrixWorld.compose(_pos, _quat.setFromEuler(_euler), _scale);
    c.camera.matrixWorldInverse.copy(c.camera.matrixWorld).invert();
    c.camera.projectionMatrix.copy(this.camera.projectionMatrix);
    c.camera.view = this.camera.view;
    c.renderer.render(c.root, c.camera);
  }

  /**
   * { scene, renderer, paused }: HTML elements placed in 3D, drawn over the canvas with the same
   * camera. `scene` is what to add them to.
   */
  get css() {
    if (!this._css) {
      const renderer = new CSS3DRenderer();
      const el = renderer.domElement;
      el.classList.add('css-layer');
      renderer.setSize(this.width, this.height);
      this.container.appendChild(el);
      // A page in the layer can scroll it: an embedded page's scrollIntoView() scrolls every
      // scrollable ancestor, even across origins (the real Nex's Broadcast carousel does), and
      // the whole layer then slides off the screens it belongs to. The layer clips without
      // being scrollable (overflow: clip in main.css); this puts it back where a browser
      // without overflow: clip lets it move.
      el.addEventListener('scroll', () => { el.scrollLeft = 0; el.scrollTop = 0; });
      // Chrome hit-tests a page placed in 3D by way of the layer's own plane (z = 0 in the
      // layer): when that plane is behind the camera, nothing in the layer takes a click,
      // though it all still draws (a kiosk against a side wall, the camera facing the wall
      // with the room's origin behind it, took no clicks: they went to the canvas). So the
      // layer is drawn moved and turned about y with a stand-in camera, so that the camera
      // always faces -z from CSS_DEPTH in front of that plane; the picture is exactly the same.
      const root = new THREE.Scene();
      const scene = new THREE.Group();
      root.add(scene);
      const camera = new THREE.PerspectiveCamera();
      camera.matrixWorldAutoUpdate = false;
      this._css = { scene, root, camera, renderer, paused: false };
    }
    return this._css;
  }

  onUpdate(fn) {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  /**
   * fn(renderer, dt) runs every frame once the scene is on the canvas, before the CSS layer:
   * for drawing something more into part of the canvas (a picture-in-picture, LiveView).
   */
  onOverlay(fn) {
    this.overlays.add(fn);
    return () => this.overlays.delete(fn);
  }

  /**
   * Compile a zone's shaders and upload its textures before it is first shown (call it while
   * the portal transition covers the screen), so its first frames don't stall.
   */
  async warm(root) {
    root.traverse((o) => {
      for (const m of [o.material].flat()) {
        if (!m) continue;
        if (m.map) this.renderer.initTexture(m.map);
        for (const u of Object.values(m.uniforms ?? {})) if (u.value?.isTexture) this.renderer.initTexture(u.value);
      }
    });
    // The scene is drawn into the composer's buffer (and the floor reflection's), never straight to
    // the screen, and three compiles a different shader for that: compile against the buffer.
    const target = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer.readBuffer);
    const ready = this.renderer.compileAsync(root, this.camera, this.scene);
    this.renderer.setRenderTarget(target);
    await ready;
  }

  start() {
    let frames = 0, acc = 0;
    // Time each frame by the display's own timestamp (when the frame will show), not by when
    // this code happens to run, so motion advances by even steps.
    this.renderer.setAnimationLoop((time) => {
      this.timer.update(time);
      this.#adapt(this.timer.getDelta());
      const dt = Math.min(Math.max(this.timer.getDelta(), 0), 1 / 20);
      this.time += dt;
      for (const fn of this.updaters) fn(dt, this.time);
      this.composer.render(dt);
      for (const fn of this.overlays) fn(this.renderer, dt);
      if (this._css && !this._css.paused) this.#renderCss();
      frames++; acc += this.timer.getDelta();
      if (acc >= 0.5) { this.fps = Math.round(frames / acc); frames = 0; acc = 0; }
    });
  }
}
