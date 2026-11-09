import * as THREE from 'three';
import { Emitter } from '../util/Emitter.js';
import { clamp, damp, ease, lerp, lerpAngle, smoothstep } from '../util/tween.js';

const PITCH_LIMIT = 0.85;
// Samples per curve for constant-speed glides (three's default of 200 leaves small speed steps on long routes).
const ARC_DIVISIONS = 1200;

/**
 * The visitor's camera. There is no walking: the visitor travels between stops
 * and looks around from each one.
 *  - Look: drag the view (mouse, touch or pen). Releasing a drag keeps a little momentum.
 *  - Travel: travel() glides the eye along a curve to a stop and settles on what is there.
 *  - Scripted: path() glides the eye along a hand-made curve (the arrival glide);
 *    cinematic() flies a shot list of { eye, look } keys (the tour of a zone).
 *  - The view never moves on its own: only a drag, a travel or a script moves it.
 *
 * Position is stored at floor level; the eye sits `eyeHeight` above it.
 * `yaw` and `pitch` are the view; the bank and FOV push while travelling are layered
 * on top in applyCamera() and never change them.
 */
export class Player extends Emitter {
  constructor(camera, dom) {
    super();
    this.camera = camera;
    this.dom = dom;

    this.pos = new THREE.Vector3(0, 0, 10.5);
    this.prev = this.pos.clone();
    this.eyeHeight = 1.65;
    this.eyeY = this.eyeHeight;
    this.yaw = 0;
    this.pitch = 0;
    this.pitchLimit = PITCH_LIMIT;       // how far up or down the view may tilt; a top-down view lifts it to π/2

    this.enabled = false;                 // free look allowed
    this.aim = { yaw: 0, pitch: 0 };      // where a drag wants the view to be
    this.spin = { yaw: 0, pitch: 0 };     // momentum after a drag, rad/s
    this.dragging = false;

    this.tween = null;
    this.baseFov = camera.fov;
    this.fovPush = 0;
    this.roll = 0;
    this.bank = 0;                       // how much a move may bank: 0 at its ends (see update())

    this.#bind();
    this.applyCamera();
  }

  #bind() {
    const dom = this.dom;
    let drag = null;

    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, mouse: e.pointerType === 'mouse' };
      this.spin.yaw = this.spin.pitch = 0;
    });

    dom.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.hypot(dx, dy);
      if (!this.dragging && drag.moved > 6) {
        this.dragging = true;
        try { dom.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        dom.classList.add('dragging');
      }
      if (!this.dragging || !this.enabled || this.tween) return;

      // "Grab the room": drag right and the room follows the hand.
      const k = drag.mouse ? 0.0024 : 0.004;
      const now = performance.now();
      const secs = Math.max(0.004, (now - drag.t) / 1000);
      drag.t = now;
      this.aim.yaw += dx * k;
      this.aim.pitch = clamp(this.aim.pitch + dy * k, -this.pitchLimit, this.pitchLimit);
      this.spin.yaw = clamp(lerp(this.spin.yaw, (dx * k) / secs, 0.5), -2.5, 2.5);
      this.spin.pitch = clamp(lerp(this.spin.pitch, (dy * k) / secs, 0.5), -1.2, 1.2);
    });

    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      // A drag that stopped before release should not fling the view.
      if (performance.now() - drag.t > 90) this.spin.yaw = this.spin.pitch = 0;
      drag = null;
      if (this.dragging) {
        this.dragging = false;
        try { dom.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
        dom.classList.remove('dragging');
      }
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    addEventListener('blur', () => { this.spin.yaw = this.spin.pitch = 0; });
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get eye() {
    return new THREE.Vector3(this.pos.x, this.eyeY, this.pos.z);
  }

  get scripted() {
    return !!this.tween;
  }

  /** Turn instantly to face a world point. */
  face(target) {
    const { yaw, pitch } = this.#anglesTo(target);
    this.yaw = this.aim.yaw = yaw;
    this.pitch = this.aim.pitch = pitch;
    this.spin.yaw = this.spin.pitch = 0;
  }

  #anglesTo(target, from = this.pos, eyeY = this.eyeY) {
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    const dy = target.y - eyeY;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  }

  /**
   * Keep the view exactly where it is, even beyond the usual look-up/down limit (e.g. looking
   * straight down onto a sloped kiosk). Free look and travel clamp it again as normal.
   */
  holdView() {
    this.aim.yaw = this.yaw;
    this.aim.pitch = this.pitch;
    this.spin.yaw = this.spin.pitch = 0;
  }

  /** Jump to a floor position, optionally facing a point. */
  setPose(x, z, lookAt) {
    this.pos.set(x, 0, z);
    this.prev.copy(this.pos);
    this.eyeY = this.eyeHeight;
    if (lookAt) this.face(lookAt);
    this.applyCamera();
  }

  /**
   * Glide to a floor point along a smooth route and land looking at `look`.
   * via: floor points ({x, z}) to pass through on the way (e.g. the arch).
   * The view turns toward the direction of travel on long moves, then settles on
   * `look`; the eye lifts a little mid-glide and the field of view opens slightly.
   * A move that goes backwards from where the view faces, before and after (say, from a
   * screen back to the entrance, still facing it), glides back without turning.
   * Resolves when the visitor has arrived.
   */
  travel(to, { via = [], look = null, speed = 4.2, duration = null, lift = 0.14, push = 5, easing = ease.smoother, fov = null } = {}) {
    this.cancelTween(false);
    const y = this.eyeHeight;
    const pts = [this.eye];
    for (const p of via) {
      const v = new THREE.Vector3(p.x, y, p.z);
      if (v.distanceTo(pts[pts.length - 1]) > 0.6) pts.push(v);
    }
    // Land exactly on the destination; a via point right next to it is dropped.
    const dest = new THREE.Vector3(to.x, y, to.z);
    if (pts.length > 1 && dest.distanceTo(pts[pts.length - 1]) < 0.6) pts[pts.length - 1] = dest;
    else if (dest.distanceTo(pts[pts.length - 1]) > 0.02) pts.push(dest);

    const end = new THREE.Vector3(to.x, 0, to.z);
    const endAngles = look ? this.#anglesTo(look, end, y) : { yaw: this.yaw, pitch: this.pitch };
    const curve = pts.length < 2 ? null
      : pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1])
        : new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    if (curve) curve.arcLengthDivisions = ARC_DIVISIONS;
    const length = curve ? curve.getLength() : 0;
    const dur = duration ?? (curve ? clamp(0.8 + (length / speed) * 0.5, 1.0, 3.0) : 0.7);
    const reach = clamp(length / 8, 0, 1);    // short hops get a gentler lift and push
    // Backing away: the move runs against the view at both ends.
    const dx = dest.x - this.eye.x, dz = dest.z - this.eye.z;
    const facing = (yaw) => -Math.sin(yaw) * dx - Math.cos(yaw) * dz;    // > 0 when moving the way yaw faces
    const reverse = length > 0.3 && facing(this.yaw) < 0 && facing(endAngles.yaw) < 0;

    return new Promise((resolve) => {
      this.tween = {
        kind: 'travel', t: 0, duration: dur, curve, easing, resolve,
        from: { yaw: this.yaw, pitch: this.pitch, eyeY: this.eyeY },
        to: endAngles,
        // How much the view swings to face the way it's heading; none on short hops.
        heading: reverse ? 0 : clamp((length - 1.5) / 6, 0, 0.8),
        headYaw: null,
        lift: lift * reach,
        push: reverse ? 0 : push * reach,
        fov: this.#fovTo(fov),
      };
    });
  }

  /**
   * Glide the eye along a hand-made path (eye positions, Vector3).
   * look: Vector3 or fn(progress) => Vector3, followed with a soft lag.
   */
  path(points, { duration = 3, look = null, easing = ease.inOut } = {}) {
    this.cancelTween(false);
    const pts = points.map((p) => p.clone());
    if (pts.length === 1) pts.unshift(this.eye);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    curve.arcLengthDivisions = ARC_DIVISIONS;
    return new Promise((resolve) => {
      this.tween = { kind: 'path', t: 0, duration, curve, look, easing, resolve };
    });
  }

  /**
   * Fly a shot list: keys are { eye: Vector3, look: Vector3 } in order. The eye and
   * the point it looks at each follow their own smooth curve on the same timeline,
   * so every key is framed exactly as written. Starts from the current view.
   * fov: a lens to change to on the same timeline (e.g. a longer lens for a plan view).
   */
  cinematic(keys, { duration = 22, easing = ease.sine, push = 3, fov = null } = {}) {
    this.cancelTween(false);
    const cp = Math.cos(this.pitch);
    const ahead = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).multiplyScalar(4).add(this.eye);
    const eyes = new THREE.CatmullRomCurve3([this.eye, ...keys.map((k) => k.eye.clone())], false, 'centripetal');
    const looks = new THREE.CatmullRomCurve3([ahead, ...keys.map((k) => k.look.clone())], false, 'centripetal');
    return new Promise((resolve) => {
      this.tween = { kind: 'cinematic', t: 0, duration, easing, eyes, looks, push, fov: this.#fovTo(fov), resolve };
    });
  }

  #fovTo(fov) {
    return fov === null ? null : { from: this.baseFov, to: fov };
  }

  /** Stop a scripted move. finish=true jumps to its end. */
  cancelTween(finish = true) {
    if (!this.tween) return;
    const tw = this.tween;
    this.tween = null;
    if (finish && tw.fov) this.baseFov = tw.fov.to;
    if (finish && tw.kind === 'cinematic') {
      this.#frame(tw.eyes.getPoint(1), tw.looks.getPoint(1));
      this.prev.copy(this.pos);
    } else if (finish) {
      if (tw.curve) {
        const p = tw.curve.getPointAt(1);
        this.pos.set(p.x, 0, p.z);
        this.eyeY = tw.kind === 'travel' ? this.eyeHeight : p.y;
      }
      if (tw.kind === 'travel') { this.yaw = tw.to.yaw; this.pitch = tw.to.pitch; }
      else {
        const target = typeof tw.look === 'function' ? tw.look(1) : tw.look;
        if (target) { const a = this.#anglesTo(target); this.yaw = a.yaw; this.pitch = a.pitch; }
      }
      this.prev.copy(this.pos);
    }
    this.#settle();
    tw.resolve();
  }

  /** After a scripted move, free look carries on from wherever the view ended up. */
  #settle() {
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.aim.yaw = this.yaw;
    this.aim.pitch = clamp(this.pitch, -this.pitchLimit, this.pitchLimit);
    this.spin.yaw = this.spin.pitch = 0;
    this.fovPush = 0;
  }

  update(dt) {
    this.prev.copy(this.pos);
    const lastYaw = this.yaw;

    if (this.tween) {
      if (this.tween.kind === 'travel') this.#stepTravel(dt);
      else if (this.tween.kind === 'cinematic') this.#stepCinematic(dt);
      else this.#stepPath(dt);
    } else {
      if (!this.dragging && (this.spin.yaw || this.spin.pitch)) {
        this.aim.yaw += this.spin.yaw * dt;
        this.aim.pitch = clamp(this.aim.pitch + this.spin.pitch * dt, -this.pitchLimit, this.pitchLimit);
        const decay = Math.exp(-7.5 * dt);
        this.spin.yaw *= decay;
        this.spin.pitch *= decay;
        if (Math.abs(this.spin.yaw) + Math.abs(this.spin.pitch) < 0.002) this.spin.yaw = this.spin.pitch = 0;
      }
      this.yaw = damp(this.yaw, this.aim.yaw, 16, dt);
      this.pitch = damp(this.pitch, this.aim.pitch, 16, dt);
      this.eyeY = damp(this.eyeY, this.eyeHeight, 6, dt);
    }

    // Bank very slightly into turns while travelling, fading out as the move ends (bank: 0 at
    // both ends), so the view arrives level: a screen you arrive at must not look tilted.
    const moving = this.tween?.kind === 'travel' || this.tween?.kind === 'cinematic';
    const turn = moving ? Math.atan2(Math.sin(this.yaw - lastYaw), Math.cos(this.yaw - lastYaw)) / Math.max(dt, 1e-3) : 0;
    this.roll = damp(this.roll, clamp(turn * 0.018, -0.028, 0.028) * (moving ? this.bank : 0), moving ? 4 : 10, dt);

    this.applyCamera();
  }

  #stepTravel(dt) {
    const tw = this.tween;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.duration);
    const u = clamp(tw.easing(k), 0, 1); // easing can land a hair past 1, off the end of the curve
    const arc = Math.sin(Math.PI * u);
    this.bank = arc;
    if (tw.fov) this.baseFov = lerp(tw.fov.from, tw.fov.to, u);

    if (tw.curve) {
      const p = tw.curve.getPointAt(u);
      this.pos.set(p.x, 0, p.z);
      this.eyeY = lerp(tw.from.eyeY, this.eyeHeight, smoothstep(0, 0.4, k)) + tw.lift * arc;

      // Heading a little ahead on the curve, smoothed so corners don't snap the view.
      const tan = tw.curve.getTangentAt(Math.min(1, u + 0.08));
      const head = Math.atan2(-tan.x, -tan.z);
      tw.headYaw = tw.headYaw === null ? head : lerpAngle(tw.headYaw, head, 1 - Math.exp(-6 * dt));
    }

    const toHead = smoothstep(0, 0.32, k) * (tw.curve ? tw.heading : 0);
    const toEnd = tw.curve ? smoothstep(0.4, 1, k) : ease.smoother(k);
    const midYaw = tw.headYaw === null ? tw.from.yaw : lerpAngle(tw.from.yaw, tw.headYaw, toHead);
    this.yaw = lerpAngle(midYaw, tw.to.yaw, toEnd);
    this.pitch = lerp(lerp(tw.from.pitch, -0.05, toHead), tw.to.pitch, toEnd);
    this.fovPush = tw.push * arc * arc;

    if (k >= 1) {
      this.tween = null;
      this.yaw = tw.to.yaw;
      this.pitch = tw.to.pitch;
      this.eyeY = this.eyeHeight;
      this.#settle();
      tw.resolve();
    }
  }

  #stepCinematic(dt) {
    const tw = this.tween;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.duration);
    const u = clamp(tw.easing(k), 0, 1); // easing can land a hair past 1, off the end of the curve
    this.#frame(tw.eyes.getPoint(u), tw.looks.getPoint(u));
    if (tw.fov) this.baseFov = lerp(tw.fov.from, tw.fov.to, u);
    const arc = Math.sin(Math.PI * u);
    this.bank = arc;
    this.fovPush = tw.push * arc * arc;
    if (k >= 1) { this.tween = null; this.#settle(); tw.resolve(); }
  }

  /** Put the eye at `eye` looking at `look`. */
  #frame(eye, look) {
    this.pos.set(eye.x, 0, eye.z);
    this.eyeY = eye.y;
    const a = this.#anglesTo(look);
    this.yaw = lerpAngle(this.yaw, a.yaw, 1); // unwrap next to the current yaw so the bank reads the true turn
    this.pitch = a.pitch;
  }

  #stepPath(dt) {
    const tw = this.tween;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.duration);
    const p = tw.curve.getPointAt(clamp(tw.easing(k), 0, 1));
    this.pos.set(p.x, 0, p.z);
    this.eyeY = p.y;
    const target = typeof tw.look === 'function' ? tw.look(k) : tw.look;
    if (target) {
      const a = this.#anglesTo(target);
      this.yaw = lerpAngle(this.yaw, a.yaw, 1 - Math.exp(-5 * dt));
      this.pitch = damp(this.pitch, a.pitch, 5, dt);
    }
    if (k >= 1) { this.tween = null; this.#settle(); tw.resolve(); }
  }

  applyCamera() {
    this.camera.position.set(this.pos.x, this.eyeY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    const fov = this.baseFov + this.fovPush;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
