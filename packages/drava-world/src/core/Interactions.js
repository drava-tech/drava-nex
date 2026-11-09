import * as THREE from 'three';
import { Emitter } from '../util/Emitter.js';

/**
 * Hover and use for things in the scene.
 *
 * Register items with add({ id, label, verb, objects, range, onUse, enabled, prompt }).
 * The item under the cursor (or finger) is targeted; a click, tap or E uses it.
 * Dragging to look never counts as a click. Walls and furniture passed as
 * `occluders` stop you from targeting things through them. Anything hidden (itself or a
 * parent, e.g. a zone that isn't on show) is ignored.
 *
 * Emits: 'hover' (item | null), 'use' (item), 'empty-click'.
 */
/** False if the object or any of its parents is hidden. */
function shown(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export class Interactions extends Emitter {
  constructor(camera, dom, player) {
    super();
    this.camera = camera;
    this.dom = dom;
    this.player = player;
    this.items = [];
    this.occluders = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.mouseInside = false;
    this.hovered = null;
    this.enabled = true;

    dom.addEventListener('pointermove', (e) => {
      const r = dom.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.mouseInside = true;
    });
    dom.addEventListener('pointerleave', () => { this.mouseInside = false; });

    // A "click" is a short press without much movement, so drag-to-look never triggers it.
    let down = null;
    dom.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (e.pointerType !== 'mouse') {
        const r = dom.getBoundingClientRect();
        this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.mouseInside = true;
      }
    });
    dom.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 450;
      down = null;
      if (moved > 8 || !quick || !this.enabled) return;
      this.#pick();
      if (this.hovered) this.use(this.hovered);
      else this.emit('empty-click', e);
    });

    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyE' || /^(INPUT|TEXTAREA)$/.test(e.target?.tagName)) return;
      if (this.hovered && this.enabled) this.use(this.hovered);
    });
  }

  add(item) {
    const entry = { range: 6, verb: 'Look', enabled: () => true, ...item };
    for (const obj of entry.objects) obj.traverse((o) => { o.userData.interactItem = entry; });
    this.items.push(entry);
    return entry;
  }

  addOccluders(objects) {
    this.occluders.push(...objects);
  }

  use(item) {
    if (!item || !item.enabled()) return;
    this.emit('use', item);
    item.onUse?.(item);
  }

  #pick() {
    if (!this.enabled || this.player.scripted || this.player.dragging || !this.mouseInside) { this.#setHover(null); return; }
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Only what is on show: each zone lives in its own group, and hidden zones don't count.
    const targets = this.occluders.filter(shown);
    for (const it of this.items) if (it.enabled()) targets.push(...it.objects.filter(shown));
    const hits = this.raycaster.intersectObjects(targets, true);

    let found = null;
    for (const hit of hits) {
      const item = hit.object.userData.interactItem;
      if (!item?.enabled()) break;      // an occluder is in front (or an item's object, hit as an occluder while it is off)
      if (hit.distance <= item.range) found = item;
      break;
    }
    this.#setHover(found);
  }

  #setHover(item) {
    if (item === this.hovered) return;
    this.hovered?.onHover?.(false);
    this.hovered = item;
    item?.onHover?.(true);
    this.dom.classList.toggle('pointing', !!item);
    this.emit('hover', item);
  }

  update() {
    this.#pick();
  }
}
