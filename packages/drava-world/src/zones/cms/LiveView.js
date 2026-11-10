import * as THREE from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FOV = 40;       // degrees, vertical: a longer lens than the visitor's, like a fixed camera
const DOLLY_S = 5;    // seconds the camera takes to ease in toward the screen
const DOLLY = { back: 0.3, side: 0.25 };   // where it starts: further back and to one side, in screen widths

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * A live picture of a screen in another zone, in a panel over the view: when the Nex pushes to
 * a screen elsewhere, Zone 02 shows it landing there without the visitor leaving the kiosk.
 * Every frame, once the room is drawn, that zone is drawn from a camera in front of the screen
 * (its group shown for that one draw: zones share coordinates, so only one may be visible at a
 * time) into a buffer, then finished into the panel's box by the same OutputPass as the main
 * view (tone mapping and sRGB: the screens' own shaders write linear colour), so whatever
 * plays there plays here, looking the same. That picture is then copied straight into the panel's
 * own canvas (.lv-pic): a page laid flat over the view (the kiosk in use) sits above the 3D canvas,
 * so a picture left on that canvas would be hidden under it. The zone is told it is
 * watched (ScreensZone.watch), so its pictures move.
 *
 * words: { live, go, close } (script.js, LIVE). onGo(zoneId, screenId): the "Go there" button.
 */
export class LiveView {
  constructor(app, { words, onGo }) {
    this.app = app;
    this.zone = null;
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 140);
    this.buffer = new THREE.WebGLRenderTarget(16, 9, { type: THREE.HalfFloatType });
    this.output = new OutputPass();
    this.output.renderToScreen = true;
    this.el = document.createElement('div');
    this.el.className = 'live-view';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="lv-head"><span class="lv-live"><i></i>${esc(words.live)}</span><span class="lv-where"></span>
        <button type="button" class="lv-x" aria-label="${esc(words.close)}">✕</button></div>
      <div class="lv-box"><canvas class="lv-pic"></canvas><span class="lv-name"></span></div>
      <div class="lv-foot"><span class="lv-what"></span><button type="button" class="lv-go">${esc(words.go)} <span aria-hidden="true">→</span></button></div>`;
    document.getElementById('hud').append(this.el);
    this.box = this.el.querySelector('.lv-box');
    this.pic = this.el.querySelector('.lv-pic');
    this.picCtx = this.pic.getContext('2d');
    this.el.querySelector('.lv-x').addEventListener('click', () => this.hide());
    this.el.querySelector('.lv-go').addEventListener('click', () => {
      if (this.zone) onGo(this.zone.id, this.screenId);
    });
    app.engine.onOverlay((renderer, dt) => this.#draw(renderer, dt));
  }

  get open() {
    return !!this.zone;
  }

  /** Show screen `screenId` of `zone` (a ScreensZone). where / name / what: the panel's words. */
  show(zone, screenId, { where, name, what }) {
    const view = zone.screenView(screenId);
    if (!view) return;
    if (zone !== this.zone) {
      this.zone?.watch(false);
      zone.watch(true);
      this.zone = zone;
    }
    // Same screen again: the picture just changes under the camera, no new move.
    if (screenId !== this.screenId || this.el.hidden) {
      this.screenId = screenId;
      this.from = view.eye.clone().addScaledVector(view.eye.clone().sub(view.look).setY(0).normalize(), view.width * DOLLY.back).addScaledVector(view.side, view.width * DOLLY.side);
      this.to = view.eye;
      this.look = view.look;
      this.t = 0;
      this.el.classList.remove('in');
      void this.el.offsetWidth;   // restart the slide-in
      this.el.classList.add('in');
    }
    this.el.querySelector('.lv-where').textContent = where;
    this.el.querySelector('.lv-name').textContent = name;
    this.el.querySelector('.lv-what').textContent = what;
    this.el.hidden = false;
  }

  hide() {
    if (!this.zone) return;
    this.zone.watch(false);
    this.zone = null;
    this.screenId = null;
    this.el.hidden = true;
  }

  #draw(renderer, dt) {
    const target = this.zone;
    const here = this.app.zone;
    if (!target || target === here) return;
    const box = this.box.getBoundingClientRect();
    const canvas = renderer.domElement.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;

    this.t = Math.min(DOLLY_S, this.t + dt);
    const k = 1 - (1 - this.t / DOLLY_S) ** 3;   // ease out
    this.camera.position.lerpVectors(this.from, this.to, k);
    this.camera.lookAt(this.look);
    const aspect = box.width / box.height;
    if (Math.abs(this.camera.aspect - aspect) > 1e-3) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

    const ratio = renderer.getPixelRatio();
    const bw = Math.round(box.width * ratio), bh = Math.round(box.height * ratio);
    if (this.buffer.width !== bw || this.buffer.height !== bh) this.buffer.setSize(bw, bh);

    const shown = here.root.visible;
    here.root.visible = false;
    target.root.visible = true;
    renderer.setRenderTarget(this.buffer);
    renderer.render(this.app.engine.scene, this.camera);
    target.root.visible = false;
    here.root.visible = shown;

    // Into the box on the canvas (viewport and scissor are in CSS pixels, from the bottom left).
    const x = box.left - canvas.left, y = canvas.bottom - box.bottom;
    renderer.setRenderTarget(null);
    renderer.setViewport(x, y, box.width, box.height);
    renderer.setScissor(x, y, box.width, box.height);
    renderer.setScissorTest(true);
    this.output.render(renderer, null, this.buffer);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.app.engine.width, this.app.engine.height);
    // Copy it into the panel's canvas, in the same task as the draw (the canvas keeps no buffer after).
    const src = renderer.domElement, sx = src.width / canvas.width, sy = src.height / canvas.height;
    const pw = Math.round(box.width * sx), ph = Math.round(box.height * sy);
    if (this.pic.width !== pw || this.pic.height !== ph) { this.pic.width = pw; this.pic.height = ph; }
    this.picCtx.drawImage(src, (box.left - canvas.left) * sx, (box.top - canvas.top) * sy, pw, ph, 0, 0, pw, ph);
  }
}
