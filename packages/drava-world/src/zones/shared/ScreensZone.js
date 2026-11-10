import * as THREE from 'three';
import { TeleportPoint } from '../../core/TeleportPoint.js';
import { WallDisplay } from '../cms/WallDisplay.js';
import { contentKey, loadState, openChannel, resolveContent } from '../cms/shared/state.js';
import { setBoard, syncBoards } from '../cms/shared/render.js';
import { loadPush, openPushChannel, resolvePush } from '../cms/push/state.js';
import { setPushState } from '../cms/push/board.js';
import { SCREENS } from '../cms/shared/seed.js';
import { EmptyZone } from './EmptyZone.js';
import { ROOM as FOUR, buildRoom as buildFourScreenRoom } from '../cms/room.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const EYE = 1.65;

// Each zone's room and where its screens hang (on wall 'front' or 'back': `at` is x, `z` the face's
// distance in from the centre line). room: the client's four-screen room (the Nex Zone's
// model, cms/room.js), without its kiosk, no doors. Each screen: wall 'right' or 'left' (facing in)
// or 'front'; at: its centre along that wall (z on a side wall, x on the front); y: its centre
// height; w: its width (all 16:9); x: the face's distance in from the room's centre line (the side
// walls' model screens are at 7.47, our own bays stand off the wall at 7.45); bezel: false for one
// set on the model's own screen (it has its frame). Ids and names are the Nex's (SCREENS in
// seed.js). The floors (the client's call, 2026-10-12, in place of the Multi-Zone Screens room):
// one screen each, as large as Zone 02's, in the middle of the front wall. The model's own four
// screens and their frames are hidden (buildRoom's `screens: false`: they aren't screens the Nex
// runs; it repaints their baked shadows on the walls), and its logo raised over the screen (`logoUp`).
const FLOOR = (id) => ({
  room: FOUR,
  screens: [{ id, wall: 'front', at: 0, y: 2.0, w: 3.6, z: 4.45 }],
  logoUp: 1.25,
});
const LAYOUTS = {
  floor1: FLOOR('floor1-screen'),
  floor2: FLOOR('floor2-screen'),
};
const LENS = 60;      // the client models' lens (as every zone in them)

/** A screen's layout, worked out: its height, centre, the way it faces, and its stop in front. */
function place(l) {
  const h = (l.w * 9) / 16;
  const wall = {
    right: { centre: V(l.x, l.y, l.at), normal: V(-1, 0, 0), rotation: -Math.PI / 2 },
    left: { centre: V(-l.x, l.y, l.at), normal: V(1, 0, 0), rotation: Math.PI / 2 },
    front: { centre: V(l.at, l.y, -l.z), normal: V(0, 0, 1), rotation: 0 },
    back: { centre: V(l.at, l.y, l.z), normal: V(0, 0, -1), rotation: Math.PI },
  }[l.wall];
  const { centre, normal, rotation } = wall;
  // Far enough back to take the whole screen in, a little more for a big one (or `d` metres out).
  const stop = centre.clone().addScaledVector(normal, l.d ?? l.w * 0.85 + 1.2).setY(0);
  return { ...l, h, centre, normal, rotation, stop, name: SCREENS.find((s) => s.id === l.id)?.name ?? l.id };
}

/**
 * A zone whose own exhibits are still to come, but whose screens Zone 02's Nex and Nex (Push)
 * already run: an EmptyZone with LAYOUTS[id]'s screens on its walls (WallDisplay), each showing
 * whichever of the two last pushed to it, kept in step over their BroadcastChannels
 * (cms/shared/state.js, cms/push/state.js). Its screens report themselves online to both from
 * the moment it's built, so Zone 02 builds these zones with itself (both list them as live).
 *
 * Their pictures only move while someone can see them: the visitor is in the zone, or Zone 02
 * is showing one of its screens in its live view (watch()). Stops: the entrance, one in front
 * of each screen, the next door. arrive({ at }) lands straight in front of screen `at` (the
 * live view's "Go there"), with a button back to the kiosk the push came from.
 */
export class ScreensZone extends EmptyZone {
  constructor(app, id, script) {
    const layout = LAYOUTS[id];
    super(app, id, script, { room: layout.room, doors: false, bare: true, lens: LENS });
    this.layout = layout;
    this.ownButton = true;              // the bottom-right button goes back (to the kiosk, or to Zone 02)
    this.screens = layout.screens.map(place);
    this.watchers = 0;
    this.seen = false;
    this.mapFeatures = this.screens.map((s) => {
      const half = V(-s.normal.z, 0, s.normal.x).multiplyScalar(s.w / 2);
      const a = s.centre.clone().add(half), b = s.centre.clone().sub(half);
      return { type: 'line', cls: 'screen', x1: a.x, z1: a.z, x2: b.x, z2: b.z };
    });
  }

  stops() {
    return [
      new TeleportPoint({ id: 'entrance', label: 'Entrance', short: 'Entrance', x: 0, z: 3.9, look: V(0, 1.9, this.bounds.minZ) }),
      // Level at eye height; one hung high (over the entrance) is looked up at.
      ...this.screens.map((s) => new TeleportPoint({ id: s.id, label: s.name, short: s.name, x: s.stop.x, z: s.stop.z, look: s.centre.clone().setY(s.y > 2.6 ? s.y : EYE) })),
    ];
  }

  suggested() {
    return this.seen ? null : this.screens[0].id;
  }

  arrived(stop) {
    const s = this.screens.find((x) => x.id === stop.id);
    if (!s) return;
    this.seen = true;
    this.app.hud.info(this.script.CARD);
  }

  build() {
    super.build();
    const { interactions, hud, engine } = this.app;
    // The client's four-screen room, its cove lit as baked, without its kiosk or its screens.
    this.room = buildFourScreenRoom(this.root, { engine, cove: 0xffa05e, kiosk: false, screens: false });
    engine.on('quality', (q) => this.room.setReflections(q === 'high'));
    this.room.ready.then((model) => {
      const logo = this.layout.logoUp && model.getObjectByName('White_Tusker_Logo');
      if (logo) logo.position.y += this.layout.logoUp;
      interactions.addOccluders(this.room.occluders);
      engine.warm(this.root);
    }).catch((err) => console.error(`${this.zone.name}: the room model could not load.`, err));
    this.displays = {};
    for (const s of this.screens) {
      const d = new WallDisplay({ width: s.w, height: s.h, bezel: s.bezel !== false });
      d.group.position.copy(s.centre);
      d.group.rotation.y = s.rotation;
      this.root.add(d.group);
      this.displays[s.id] = d;
      interactions.add({
        id: `${this.id}-screen-${s.id}`, label: s.name, verb: 'Go to', objects: d.hitTargets, range: 40,
        onUse: () => {
          const p = this.points.find((x) => x.id === s.id);
          if (p.here) hud.info(this.script.CARD);
          else this.teleportTo(p);
        },
      });
    }

    // The screens follow the Nex and Push both, wherever the visitor is: each shows whichever of
    // the two last put something new on it (#pick).
    this.state = loadState();
    this.push = loadPush();
    setPushState(this.push);
    this.source = {};        // screen id → 'ems' | 'push': which one it shows
    this.keys = { ems: {}, push: {} };   // screen id → what each last gave it
    this.channel = openChannel((msg) => {
      if (msg?.type === 'state') { this.state = msg.state; this.#pick('ems'); this.#show(); }
      if (msg?.type === 'video') this.displays[msg.screenId]?.command(msg.action);
      if (msg?.type === 'board') setBoard(msg.screenId, msg.page);
    });
    this.pushChannel = openPushChannel((msg) => {
      if (msg?.type === 'state') { this.push = msg.state; setPushState(this.push); this.#pick('push'); this.#show(true); }
      if (msg?.type === 'video' && this.displays[msg.screenId]) { this.displays[msg.screenId].command(msg.action, msg.value); this.#videoStates(); }
    });
    this.#pick('ems');
    this.#pick('push');
    this.#show();
    const ids = this.screens.map((s) => s.id);
    this.channel.post({ type: 'hello', ids });
    this.pushChannel.post({ type: 'hello', ids });
    const beat = () => {
      this.channel.post({ type: 'online', ids });
      this.pushChannel.post({ type: 'online', ids });
      this.#videoStates();
    };
    beat();
    this.heartbeat = setInterval(beat, 2000);
    engine.onUpdate((dt) => { if (this.#active()) for (const d of Object.values(this.displays)) d.update(dt); });
    hud.on('sound', () => this.#sound());
    hud.on('skip', () => { if (this.app.zone === this && this.mode === 'play') this.#goBack(); });
  }

  /**
   * Back to the kiosk the visitor pushed from (Zone 02 puts them straight back into using it), or,
   * come in some other way, back to the zone this room belongs to (it has no doors).
   */
  async #goBack() {
    const { app } = this;
    if (this.busy || app.player.scripted) return;
    this.busy = true;
    app.hud.skipButton(false);
    app.block('portal');
    app.audio.whoosh(1.8);
    if (this.returnTo) await app.goTo(this.returnTo, { at: 'kiosk' });
    else await app.goTo(this.prev.id);
    app.unblock('portal');
    this.busy = false;
  }

  /** Seen: the visitor is here, or Zone 02's live view is on one of these screens. */
  #active() {
    return this.app.zone === this || this.watchers > 0;
  }

  /** What the Nex gives screen id, and what Push gives it. */
  #from(src, id) {
    if (src === 'ems') return resolveContent(this.state, this.state.screens.find((s) => s.id === id) ?? { id, content: null });
    return resolvePush(this.push, id);
  }

  /**
   * After a change from src ('ems' or 'push'): a screen it now gives something new takes it as
   * its source; one it cleared falls back to what the other gives.
   */
  #pick(src) {
    const other = src === 'ems' ? 'push' : 'ems';
    for (const id of Object.keys(this.displays)) {
      const r = this.#from(src, id);
      const key = contentKey(r);
      const changed = this.keys[src][id] !== undefined && this.keys[src][id] !== key;
      const first = this.keys[src][id] === undefined;
      this.keys[src][id] = key;
      const idle = r.kind === 'idle';
      if (!idle && (changed || (first && !this.source[id]))) this.source[id] = src;
      else if (idle && this.source[id] === src && this.#from(other, id).kind !== 'idle') this.source[id] = other;
    }
  }

  /** slide: a push from Push slides in from the side it was thrown, as on its displays. */
  #show(slide = false) {
    syncBoards(this.state);
    for (const [id, d] of Object.entries(this.displays)) {
      const src = this.source[id] ?? 'ems';
      const enter = slide && src === 'push' ? this.push.screens.find((s) => s.id === id)?.enter : null;
      d.show(this.#from(src, id), { enter });
    }
    if (!this.#active()) for (const d of Object.values(this.displays)) d.pause();
  }

  /** How each screen's video is playing, for the controls on Push's cards. */
  #videoStates() {
    for (const [id, d] of Object.entries(this.displays)) {
      const v = this.source[id] === 'push' && d.videoState();
      if (v) this.pushChannel.post({ type: 'video-state', screenId: id, ...v });
    }
  }

  /** Sound only while the visitor is in the room (the live view is silent). */
  #sound() {
    const on = this.app.zone === this && this.app.hud.soundOn;
    for (const d of Object.values(this.displays)) d.setSound(on);
  }

  /** Zone 02's live view starts (true) or stops (false) showing one of these screens. */
  watch(on) {
    const was = this.#active();
    this.watchers = Math.max(0, this.watchers + (on ? 1 : -1));
    if (this.#active() === was) return;
    for (const d of Object.values(this.displays)) { if (on) d.resume(); else d.pause(); }
  }

  /** Where Zone 02's live view looks from to show screen `id`: { eye, look, width }. */
  screenView(id) {
    const s = this.screens.find((x) => x.id === id);
    if (!s) return null;
    // Level with the screen's centre, looking straight at it: its edges stay square in the picture.
    return { eye: s.centre.clone().addScaledVector(s.normal, s.w), side: V(-s.normal.z, 0, s.normal.x), look: s.centre.clone(), width: s.w };
  }

  /**
   * at: a screen's id, to arrive in front of it instead of at the door (the live view's "Go
   * there"). Then the bottom-right button (or Space) goes back to the kiosk in `from`.
   */
  arrive({ from = null, at = null } = {}) {
    super.arrive({ from });
    this.returnTo = null;
    for (const d of Object.values(this.displays)) d.resume();
    this.#sound();
    const p = at && this.points.find((x) => x.id === at);
    if (!p) { this.app.hud.skipButton(true, this.#backLabel(), { cta: true }); return; }
    const { player, hud, travis } = this.app;
    player.setPose(p.x, p.z, p.look);
    if (from && from !== this.id) this.returnTo = from;
    hud.skipButton(true, this.returnTo ? this.script.BACK : this.#backLabel(), { cta: !this.returnTo });
    this.seen = true;
    hud.stopTitle(`Zone ${this.zone.n} · ${this.zone.verb}`, p.label);
    travis.say(this.script.LINES.pushed, { interrupt: true });
  }

  #backLabel() {
    return `Back to Zone ${this.prev.n} · ${this.prev.short}  →`;
  }

  leave() {
    super.leave();
    this.returnTo = null;
    if (this.watchers === 0) for (const d of Object.values(this.displays)) d.pause();
    for (const d of Object.values(this.displays)) d.setSound(false);
  }
}
