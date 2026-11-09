import * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

/**
 * A live web page on a surface in the room: a real <iframe>, placed in 3D with the
 * engine's CSS layer (engine.css), so the site runs and responds exactly as it does
 * in a browser tab.
 *
 * The CSS layer draws on top of the WebGL canvas, so the page can't be hidden behind
 * scene objects: the zone decides when it may show (update's `allowed`), and the
 * page also hides whenever the screen is out of view. `group` goes in the WebGL scene
 * like any exhibit; a black backing plane in it stands in for the page (hover target,
 * floor reflection) and the iframe follows its world transform.
 *
 *   tag             'iframe' (a web page, the default) or 'video' (a film at `url`, shown exactly
 *                   as filmed: the CSS layer has no bloom or tone mapping); `frame` is the element
 *   width, height   size of the screen in metres
 *   viewport        the page's size in CSS pixels (its "browser window")
 *   load()          starts loading the page (call it before the visitor gets there)
 *   setInteractive  lets the page take clicks and keys (true) or passes them through to the scene
 *
 * While the page is in use (setInteractive(true), with the camera square on to it) it
 * is laid flat over the exact rectangle it covers on screen, so it reads crisp and
 * clicks land exactly, and goes back into 3D afterwards.
 * setInteractive(true, { flat: false }) instead leaves the page where it is in 3D and
 * just hands it the pointer, for using it at an angle (the Nex kiosk). The camera must
 * hold still while it's in use.
 */
export class WebScreen {
  constructor(engine, { url, tag = 'iframe', width, height, viewport = [1920, 1080], title = 'Live page' }) {
    this.engine = engine;
    this.url = url;
    this.width = width;
    this.height = height;
    this.viewport = viewport;
    this.loaded = false;
    this.opacity = 0;
    this.shown = false;
    this.interactive = false;

    this.group = new THREE.Group();
    this.backing = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.backing.visible = false;
    this.group.add(this.backing);

    const f = (this.frame = document.createElement(tag));
    f.title = title;
    if (tag === 'iframe') {
      f.allow = 'fullscreen; autoplay; clipboard-read; clipboard-write';
      f.referrerPolicy = 'strict-origin-when-cross-origin';
    }
    Object.assign(f.style, {
      width: `${viewport[0]}px`, height: `${viewport[1]}px`, border: '0', background: '#000',
      pointerEvents: 'none', visibility: 'hidden', opacity: '0',
      backfaceVisibility: 'hidden',   // no mirrored page when seen from behind
    });

    this.object = new CSS3DObject(f);
    f.style.pointerEvents = 'none';                   // CSS3DObject sets 'auto': clicks go to the scene until setInteractive(true)
    this.object.scale.setScalar(width / viewport[0]);
    this.object.visible = false;                      // until update() shows it
    engine.css.scene.add(this.object);
    // In the page from the start: the CSS layer only adds (and shows) it as it draws, and it
    // doesn't draw while a page is in use, so a page that goes live then would never appear.
    engine.css.renderer.domElement.firstElementChild.firstElementChild.appendChild(f);
    f.style.display = 'none';

    this.frustum = new THREE.Frustum();
    this.m = new THREE.Matrix4();
    this.s = new THREE.Vector3();
    this.c = new THREE.Vector3();
    this.e = new THREE.Vector3();
  }

  get hitTargets() {
    return [this.backing];
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    this.frame.src = this.url;
  }

  /**
   * true: the page takes the pointer and the keyboard. false: clicks go to the scene.
   * flat: lay the page flat over the screen while in use (false: leave it in 3D, see above).
   */
  setInteractive(on, { flat = true } = {}) {
    if (on === this.interactive) return;
    this.interactive = on;
    const css = this.engine.css;
    const view = css.renderer.domElement.firstElementChild;
    const cam = view.firstElementChild;
    if (on) this.flat = flat;
    if (this.flat && on) {
      this.saved = [view.style.perspective, cam.style.transform, this.frame.style.transform];
      css.paused = true;
      view.style.perspective = 'none';
      cam.style.transform = 'none';
      this.#flatten(this.engine.camera);
    } else if (this.flat) {
      [view.style.perspective, cam.style.transform, this.frame.style.transform] = this.saved;
      css.paused = false;
    }
    this.frame.style.pointerEvents = on ? 'auto' : 'none';
    if (on) this.frame.focus();
    else { this.frame.blur(); window.focus(); }
  }

  /** Lay the page flat over the rectangle the screen covers in the view. */
  #flatten(camera) {
    const { width: w, height: h } = this.engine;
    const [vw, vh] = this.viewport;
    this.backing.updateWorldMatrix(true, false);
    const c = this.c.set(0, 0, 0).applyMatrix4(this.backing.matrixWorld).project(camera);
    const e = this.e.set(this.width / 2, 0, 0).applyMatrix4(this.backing.matrixWorld).project(camera);
    const cx = ((c.x + 1) / 2) * w, cy = ((1 - c.y) / 2) * h;
    const scale = (((e.x - c.x) / 2) * w) / (vw / 2);
    this.frame.style.transform = `translate(${(cx - vw / 2).toFixed(2)}px, ${(cy - vh / 2).toFixed(2)}px) scale(${scale.toFixed(5)})`;
  }

  /** Hide at once (the zone is being left); update() brings it back when allowed. */
  hide() {
    this.setInteractive(false);
    this.opacity = 0;
    this.shown = false;
    this.frame.style.visibility = 'hidden';
    this.frame.style.opacity = this.lastOpacity = '0.000';
    this.backing.visible = false;
    this.object.visible = false;
  }

  /** How far the camera must be from the screen for it to fill `fill` of the view. */
  fitDistance(camera, fill = 0.94) {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    return Math.max(this.height / 2 / t, this.width / 2 / (t * camera.aspect)) / fill;
  }

  /** allowed: the zone says nothing stands between the camera and the screen. */
  update(dt, camera, { allowed = true } = {}) {
    this.group.updateWorldMatrix(true, false);
    this.group.matrixWorld.decompose(this.object.position, this.object.quaternion, this.s);

    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    const inView = this.frustum.intersectsObject(this.backing);

    const want = this.loaded && (this.interactive || (allowed && inView)) ? 1 : 0;
    this.opacity += (want - this.opacity) * Math.min(1, dt * 5);
    if (want === 0 && this.opacity < 0.02) this.opacity = 0;
    const shown = this.opacity > 0;
    if (shown !== this.shown) {
      this.shown = shown;
      this.frame.style.visibility = shown ? 'visible' : 'hidden';
      this.backing.visible = shown;
      // Out of the layout while hidden, so the page stops drawing its own animation in the
      // background (the CSS layer sets display: none for an invisible object).
      this.object.visible = shown;
      this.frame.style.display = shown ? '' : 'none';   // the CSS layer does this too, but not while a page is in use
    }
    const opacity = this.opacity.toFixed(3);
    if (opacity !== this.lastOpacity) this.frame.style.opacity = this.lastOpacity = opacity; // only on change: a page (or film) over the canvas is costly to restyle
    if (this.interactive && this.flat) this.#flatten(camera);
    return shown;
  }
}
