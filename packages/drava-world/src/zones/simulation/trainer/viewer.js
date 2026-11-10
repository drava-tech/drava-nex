import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

/** A model, loaded once per page (every viewer clones it). */
export function loadModel(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
}

/**
 * The trainer's 3D views, standing in for the <model-viewer> element the real page uses, with
 * the same behaviour: the model framed from the front, a little above (model-viewer's default
 * orbit, 0° 75°), its animation playing on a loop, and optionally drag to orbit and a turn of
 * `spin` degrees a second. Draws only while its canvas is on show.
 *
 *   load(url)              show that model; fires 'load' or 'error' on the canvas, as model-viewer does
 *   materials              the shown model's materials, by name (for setEmissive)
 */
export class ModelView {
  constructor(canvas, { controls = false, spin = 0, background = null } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !background });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;   // model-viewer's default
    this.scene = new THREE.Scene();
    if (background) this.scene.background = new THREE.Color(background);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    this.timer = new THREE.Timer();
    this.spin = THREE.MathUtils.degToRad(spin);
    if (controls) {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.enablePan = false;
    }
    this.renderer.setAnimationLoop((t) => this.#frame(t));
  }

  get materials() {
    const out = [];
    this.model?.traverse((o) => { if (o.isMesh) for (const m of [o.material].flat()) if (!out.includes(m)) out.push(m); });
    return out;
  }

  async load(url) {
    this.url = url;
    let gltf;
    try {
      gltf = await loadModel(url);
    } catch (err) {
      if (this.url === url) this.canvas.dispatchEvent(new Event('error'));
      return;
    }
    if (this.url !== url) return;                 // another model was asked for meanwhile
    if (this.model) this.scene.remove(this.model);
    // A fresh copy with its own materials, so highlighting one view leaves the others alone.
    const model = (this.model = gltf.scene.clone(true));
    model.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); });
    this.scene.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    const clip = (this.clip = gltf.animations[0]);
    if (clip) this.mixer.clipAction(clip).play();
    this.#frame0();
    this.canvas.dispatchEvent(new Event('load'));
  }

  /**
   * Frame the whole of the animation, so a part flying in stays in view, and look at it from the
   * side of the direction it moves in (end-on, a part coming toward the camera barely seems to move).
   */
  #frame0() {
    const box = new THREE.Box3();
    const steps = this.clip ? 16 : 0;
    for (let i = 0; i <= steps; i++) {
      this.mixer.setTime(this.clip ? (this.clip.duration * i) / steps : 0);
      this.model.updateMatrixWorld(true);
      this.model.traverse((o) => { if (o.isMesh && Math.abs(o.matrixWorld.determinant()) > 1e-9) box.expandByObject(o); });   // not the copies at scale 0
    }
    this.mixer.setTime(0);
    this.model.updateMatrixWorld(true);
    const size = box.getSize(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.target = sphere.center;
    this.radius = sphere.radius;
    // The camera in front (+z) for a model that is longest along x; at its side (+x), a little round to the front, for one longest along z.
    this.theta = size.z > size.x ? Math.PI / 2 - 0.45 : 0;
    this.#place();
    if (this.controls) {
      this.controls.target.copy(this.target);
      this.controls.minDistance = this.radius;
      this.controls.maxDistance = this.radius * 8;
      this.controls.update();
    }
  }

  #place() {
    const fit = this.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2) / Math.min(1, this.camera.aspect) * 1.05;
    const phi = THREE.MathUtils.degToRad(75);
    this.camera.position.setFromSphericalCoords(fit, phi, this.theta).add(this.target);
    this.camera.near = fit / 100;
    this.camera.far = fit * 100;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.target);
  }

  #frame(t) {
    this.timer.update(t);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (!this.canvas.isConnected || !this.canvas.offsetParent) return;   // not on show
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this.model && !this.controls) this.#place();
    }
    if (!this.model) { this.renderer.clear(); return; }
    this.mixer.update(dt);
    if (this.spin && !this.controls) { this.theta += this.spin * dt; this.#place(); }   // a fixed view turns the camera round the model
    if (this.controls) {
      if (this.spin) {
        // Turn round the target, as model-viewer's auto-rotate does (a drag takes over meanwhile).
        _s.copy(this.camera.position).sub(this.controls.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.spin * dt);
        this.camera.position.copy(this.controls.target).add(_s);
      }
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  }
}

const _s = new THREE.Vector3();
