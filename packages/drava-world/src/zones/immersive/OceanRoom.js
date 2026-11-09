import * as THREE from 'three';
import { canvasTexture } from '../../util/textures.js';
import { CAUSTIC, LACE, NOISE } from './glsl.js';

// The World Zone's room is the whole zone (x -9..9, z -12..12, HEIGHT m high, taller than the
// other zones so the waterfall has room to fall): fine-pitch LED on
// all four walls and the ceiling, and an LED floor. The walls and ceiling are windows onto the ocean
// (Ocean.js), drawn from the visitor's eye; the exit wall (z = -12, the door to Zone 01) plays a waterfall that pours
// onto a stone lintel over the door; the floor is shallow water, waves washing in from the foot of
// the waterfall and drawing back. Everything here is screen content except the lintel.
// The walls and ceiling are touch screens too: a touch sends rings across the glass (touch()), a
// reticle on the glass can follow an animal behind it (setMark()), and a panel of content can be
// laid on any wall (showPanel()). The ocean's Midnight (its `night` uniform) darkens the falls and
// the floor and lights their foam with plankton. powerOn() switches the room on like an LED room
// booting: the floor from the visitor's feet, the walls from the bottom up, then the ceiling.
export const SWEET = new THREE.Vector3(0, 1.6, 0);
export const HEIGHT = 9;
const ROOM = { minX: -9, maxX: 9, minZ: -12, maxZ: 12, height: HEIGHT };
const TOP = HEIGHT.toFixed(2);
const BASE = 0.1;                      // the screens start above the plinth
const INSET = 0.45;                    // the ceiling screen sits in from the walls, past the cove light
const HOLE = { x: 1.7, y: 3.5 };       // the doorways, as cut in the walls (shared/room.js)
// The lintel the waterfall lands on: a slab of dark wet stone over the exit door, as wide as the
// door's frame (3.2 m + its 5 cm bars), carrying the door's sign.
export const LINTEL = { w: 3.3, y0: 3.45, y1: 4.05, depth: 0.08 };
const RIPPLES = 8;
const TOUCHES = 6;                     // touches on the glass still spreading
const RECAP = { z: 8, y0: 0.6, y1: 4.6 };   // where the recap shows on the left wall (z -8..8)
export const PANEL = { w: 5.4, h: 3.34, px: 300 };  // a content panel on a wall (m; canvas px per m): big enough to read from the middle of the room
const REVEAL_S = 3.6;                  // seconds the room takes to switch on
const REVEAL_END = 1.7;                // the reveal's last value (the ceiling's centre lights at ~1.55)

const SCREEN_VERTEX = 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';

/** The LED room switching on: k is when this point lights (0..~1.55 as uReveal runs to REVEAL_END), with a bright scan line at the edge. */
const REVEAL = /* glsl */ `
  uniform float uReveal;
  vec3 powerOn(vec3 col, float k) {
    float on = smoothstep(k - 0.012, k + 0.012, uReveal);
    float line = exp(-pow((uReveal - k) * 70.0, 2.0)) * step(uReveal, ${(REVEAL_END - 0.05).toFixed(2)});
    return col * on + vec3(0.85, 0.95, 1.0) * line * 1.2;
  }`;

const SCREEN_FRAGMENT = /* glsl */ `
  uniform sampler2D uView; uniform vec2 uRes;
  uniform sampler2D uRecap; uniform float uRecapMix;
  uniform float uTime, uNight;
  uniform vec4 uTouch[${TOUCHES}];             // xyz: where the glass was touched, w: when
  uniform vec4 uMark; uniform float uMarkA; uniform vec3 uMarkCol;   // reticle: centre on the glass, radius (m)
  uniform sampler2D uPanel; uniform float uPanelMix;
  uniform vec3 uPanelO, uPanelU, uPanelV; uniform vec2 uPanelSize;   // panel: centre, right and up along its wall, size (m)
  varying vec3 vW;
  ${REVEAL}
  /** A point relative to another on the same screen, flattened onto that screen. */
  vec2 onGlass(vec3 r) { return vW.y > ${TOP} - 0.05 ? r.xz : abs(vW.x) > 8.9 ? r.zy : r.xy; }
  void main() {
    if (abs(vW.z) > 11.9 && abs(vW.x) < ${HOLE.x.toFixed(2)} && vW.y < ${HOLE.y.toFixed(2)}) discard;   // the doorway
    // Touches: rings of light spread across the glass from where a hand met it, and the picture bends under them.
    float wave = 0.0, glow = 0.0;
    for (int i = 0; i < ${TOUCHES}; i++) {
      vec4 T = uTouch[i];
      float age = uTime - T.w;
      if (age < 0.0 || age > 6.0) continue;
      float d = distance(vW, T.xyz);
      float x = d - age * 2.6;
      float fade = exp(-age * 0.8);
      wave += sin(x * 8.0) * exp(-x * x * 2.0) * fade;
      glow += exp(-x * x * 30.0) * fade + exp(-d * d * 5.0) * exp(-age * 3.5) * 1.5;
    }
    vec2 bend = vec2(dFdx(wave), dFdy(wave)) * 30.0;
    vec3 col = texture2D(uView, (gl_FragCoord.xy + clamp(bend, -6.0, 6.0)) / uRes).rgb;   // the ocean as the eye sees it, through this screen
    vec3 tint = mix(vec3(0.7, 0.88, 1.0), vec3(0.15, 0.95, 1.3), uNight);
    col += tint * (glow * 0.32 + max(wave, 0.0) * 0.05);
    // The reticle round an animal: a thin ring and four ticks turning slowly outside it.
    if (uMarkA > 0.001) {
      vec3 r = vW - uMark.xyz;
      float d = length(r), R = uMark.w;
      float ring = exp(-pow((d - R) / (0.012 * R + 0.012), 2.0));
      vec2 q = onGlass(r);
      float a = atan(q.y, q.x) + uTime * 0.5;
      float ticks = smoothstep(0.985, 0.995, abs(cos(a * 2.0))) * step(R * 1.08, d) * step(d, R * 1.24);
      col += uMarkCol * (ring * 0.9 + ticks * 1.1) * uMarkA;
    }
    if (uRecapMix > 0.001 && vW.x < -8.9) {
      vec2 uv = vec2((${RECAP.z.toFixed(1)} - vW.z) / ${(RECAP.z * 2).toFixed(1)}, (vW.y - ${RECAP.y0.toFixed(2)}) / ${(RECAP.y1 - RECAP.y0).toFixed(2)});
      col *= 1.0 - 0.65 * uRecapMix;
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        vec4 r = texture2D(uRecap, uv);
        col = mix(col, r.rgb, r.a * uRecapMix);
      }
    }
    // A panel of content on its wall, wiped on from the left.
    if (uPanelMix > 0.001) {
      vec3 r = vW - uPanelO;
      if (abs(dot(r, cross(uPanelU, uPanelV))) < 0.05) {
        vec2 p = vec2(dot(r, uPanelU) / uPanelSize.x, dot(r, uPanelV) / uPanelSize.y) + 0.5;
        if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0) {
          float front = uPanelMix * 1.1;
          vec4 c = texture2D(uPanel, p);
          col = mix(col, c.rgb, c.a * smoothstep(front, front - 0.05, p.x));
          col += vec3(1.0) * exp(-pow((p.x - front) * 60.0, 2.0)) * step(uPanelMix, 0.98) * 0.8;
        }
      }
    }
    col = powerOn(col, vW.y > ${TOP} - 0.05 ? 1.25 + 0.3 * clamp(1.0 - length(vW.xz / vec2(8.6, 11.6)) / 1.414, 0.0, 1.0) : 0.25 + vW.y / ${TOP});
    gl_FragColor = vec4(col, 1.0);
  }`;

const WATERFALL_FRAGMENT = /* glsl */ `
  uniform float uTime, uNight;
  varying vec3 vW;
  ${NOISE}
  ${REVEAL}
  void main() {
    vec2 p = vW.xy;
    float t = uTime;
    if (abs(p.x) < ${HOLE.x.toFixed(2)} && p.y < ${HOLE.y.toFixed(2)}) discard;          // the doorway
    float fall = ${TOP} - p.y;
    float F = 2.2 * sqrt(fall + 0.25);         // falling coordinate: features speed up and stretch as they drop

    // How full the curtain is: the lintel leaves a dry shadow below it that the water closes over,
    // and the water that parts round it pours off its ends in heavier streams.
    float T = 1.0, edge = 0.0;
    float L1 = ${LINTEL.y1.toFixed(2)};
    if (p.y < L1) {
      float hw = ${(LINTEL.w / 2).toFixed(2)} - (L1 - p.y) * 0.2;
      float dx = abs(p.x) - hw + (noise(vec2(p.y * 3.0 - t * 2.0, sign(p.x))) - 0.5) * 0.3;
      T *= 1.0 - 0.93 * (1.0 - smoothstep(-0.12, 0.1, dx));
      edge += exp(-abs(dx) * 6.0);
    }
    // The falling water: broad sheets, threads within them, and fine glinting streaks.
    float warp = fbm(vec2(p.x * 0.7, F * 0.45 - t * 0.9)) - 0.5;
    float sheets = fbm(vec2(p.x * 1.5 + warp * 0.9, F * 0.85 - t * 1.6));
    float threads = noise(vec2(p.x * 10.0 + warp * 3.0, F * 1.3 - t * 3.3));
    float fine = noise(vec2(p.x * 32.0 + warp * 6.0, F * 2.8 - t * 5.4));
    float body = clamp(T * smoothstep(0.12, 0.7, sheets) + edge * 0.5 * sheets, 0.0, 1.0);   // sheets with thinner water between
    float aerated = 0.55 + 0.45 * smoothstep(0.0, 3.0, fall);          // whiter the further it falls
    float foam = smoothstep(0.62, 0.95, sheets * 0.6 + threads * 0.45 + fine * 0.2) * (T + edge * 0.6) * aerated;

    // By midnight the water runs dark and its broken white water glows with plankton.
    vec3 cliff = vec3(0.008, 0.02, 0.06) * (0.5 + fbm(p * 2.3)) * (1.0 - 0.6 * uNight);
    vec3 deep = mix(vec3(0.008, 0.05, 0.26), vec3(0.002, 0.01, 0.045), uNight);
    vec3 bright = mix(vec3(0.16, 0.44, 1.0), vec3(0.02, 0.12, 0.32), uNight);
    vec3 white = mix(vec3(1.1, 1.2, 1.35), vec3(0.18, 0.9, 1.3), uNight);
    vec3 col = mix(cliff, mix(deep, bright, sheets), body);
    col += white * foam * 0.55;
    col += white * pow(threads, 7.0) * body * 0.3;
    col += vec3(0.85, 0.92, 1.0) * pow(fine, 14.0) * body * 1.6;

    // The lintel takes the full weight of the falls. Where the water lands it bursts: a crown of
    // torn white water boiling up off its top, sheets flung out past both ends in arcs that break
    // into blobs, streams pouring off the ends down beside the door, and broken mist round it all.
    float HW = ${(LINTEL.w / 2).toFixed(2)};
    float dy = p.y - L1;
    float along = 1.0 - smoothstep(HW - 0.15, HW + 0.1, abs(p.x));
    vec2 cq = vec2(p.x * 2.6 - sign(p.x) * t * 0.9, dy * 3.2 - t * 2.4);
    float boil = fbm(cq + vec2(fbm(cq * 1.7 + t * 0.5), fbm(cq * 1.7 - t * 0.4)) * 1.2);     // warped: ragged, not round
    float crownH = 0.3 + 0.6 * noise(vec2(p.x * 1.8, t * 0.8));                              // the burst rises and falls along the lintel
    float crown = along * step(-0.02, dy) * (1.0 - smoothstep(0.0, crownH, dy)) * smoothstep(0.45, 0.8, boil + 0.3 * (1.0 - dy / crownH));
    col = mix(col, white * (0.7 + 0.4 * boil), clamp(crown, 0.0, 1.0) * 0.9);
    float ex = abs(p.x) - HW;                                                                // how far past the end
    float jets = 0.0;
    for (int j = 0; j < 3; j++) {
      float fj = float(j);
      float tau = ex / (1.0 + fj * 0.8);                                                     // seconds of flight to get this far out
      float wob = (fbm(vec2(p.x * 2.5 + fj * 5.0, p.y * 2.5 - t * 1.5)) - 0.5) * (0.1 + 0.4 * tau);
      float d = p.y + wob - (L1 + (1.5 - fj * 0.4) * tau - 4.9 * tau * tau);
      float thick = 0.06 + 0.16 * tau;                                                       // the sheet tears and spreads as it flies
      float blobs = smoothstep(0.5, 0.85, fbm(vec2(p.x * 5.0 + fj * 7.0 - sign(p.x) * t * 2.5, p.y * 5.0 + t)));
      jets += exp(-d * d / (thick * thick)) * step(0.0, ex) * (1.0 - smoothstep(0.0, 1.4, tau)) * blobs;
    }
    col += white * min(jets, 1.0) * 0.6;
    float arc = ex - 0.3 * sqrt(max(L1 - p.y, 0.0));
    float stream = exp(-arc * arc * 30.0) * step(p.y, L1 + 0.05) * smoothstep(-0.3, 0.05, ex + 0.3);
    col += white * stream * smoothstep(0.35, 0.8, fbm(vec2(p.x * 7.0, F * 2.2 - t * 3.4))) * 0.75;
    float wisp = smoothstep(0.5, 0.85, fbm(p * vec2(1.4, 2.0) + vec2(sin(t * 0.2), -t * 0.45)));
    float mist = exp(-length((p - vec2(0.0, L1 + 0.2)) * vec2(0.4, 1.4))) * wisp;
    col += vec3(0.55, 0.7, 0.95) * mist * 0.35;

    // The pool at the foot: churning white water and spray rising off it.
    float churn = fbm(vec2(p.x * 2.2 + sin(t * 0.3) * 0.5, p.y * 6.0 - t * 1.4));
    col = mix(col, white * (0.65 + 0.5 * churn), smoothstep(0.75, 0.0, p.y) * smoothstep(0.25, 0.75, churn + 0.25) * 0.85);
    col += vec3(0.4, 0.55, 0.85) * smoothstep(1.6, 0.0, p.y) * fbm(vec2(p.x * 0.9, p.y * 1.5 - t * 0.5)) * 0.35;
    // The top edge: the ocean overhead spilling over.
    col += bright * smoothstep(${TOP} - 0.2, ${TOP}, p.y) * 0.35;
    col = powerOn(col, 0.25 + p.y / ${TOP});
    gl_FragColor = vec4(col, 1.0);
  }`;

const FLOOR_FRAGMENT = /* glsl */ `
  uniform float uTime, uNight; uniform vec4 uRipples[${RIPPLES}]; uniform samplerCube uOcean;
  varying vec3 vW;
  ${NOISE}
  ${CAUSTIC}
  ${LACE}
  ${REVEAL}
  void main() {
    vec2 p = vW.xz;
    float t = uTime;
    // Rings where the visitor walks or points.
    float rip = 0.0;
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 r = uRipples[i];
      float age = t - r.z;
      if (age < 0.0 || age > 6.0) continue;
      float d = length(p - r.xy);
      float x = d - age * 1.4;
      rip += sin(x * 16.0) * exp(-x * x * 5.0) * exp(-age * 0.7) / (1.0 + d * 0.5);
    }
    // Waves from the foot of the waterfall: each runs up the floor fast, foams at its lip, then
    // slides back slowly, leaving a lace of foam on the wet floor that fades.
    float film = 0.0, foam = 0.0;
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      float T = 10.0 + fk * 3.3;
      float ph = fract(t / T + fk * 0.43);
      float run = ph < 0.3 ? 1.0 - pow(1.0 - ph / 0.3, 2.2) : 1.0 - smoothstep(0.3, 1.0, ph);
      float reach = -11.6 + run * (9.0 - fk * 2.2);
      float lip = reach + (fbm(vec2(p.x * 0.3 + fk * 7.0, t * 0.12)) - 0.5) * 2.4 + sin(p.x * 0.45 + fk * 2.0) * 0.5;
      float b = lip - p.y;                                    // > 0 behind the lip, where the water is
      float wet = smoothstep(-0.05, 0.5, b);
      film = max(film, wet * (ph < 0.3 ? 1.0 : 1.0 - 0.75 * smoothstep(0.3, 1.0, ph)));
      // foam lace in drifting patches, its cells warped so no straight edges show
      vec2 lp = p * vec2(1.3, 1.0) * 2.2 + vec2(fk * 5.0, ph < 0.3 ? -t * 0.5 : t * 0.25);
      lp += vec2(fbm(lp * 0.5), fbm(lp * 0.5 + 4.0)) * 1.3;
      float patches = smoothstep(0.42, 0.72, fbm(p * 0.8 + vec2(fk * 3.0, t * 0.04)));
      float l = lace(lp, t) * patches * (0.5 + 0.5 * noise(p * 30.0));
      float rush = 1.0 - smoothstep(0.3, 0.45, ph);
      float front = exp(-b * b * 5.76) * (0.45 + 0.9 * l) * (0.4 + 0.6 * rush);
      float trail = wet * l * 0.6 * smoothstep(0.25, 0.5, ph) * (1.0 - smoothstep(0.7, 1.0, ph));
      foam = max(foam, max(front, trail));
    }
    // The pool at the foot of the falls is always churning.
    float pool = 1.0 - smoothstep(-11.5, -9.6, p.y);
    foam = max(foam, pool * (0.35 + 0.65 * fbm(p * 2.2 + vec2(t * 0.2, -t * 0.6))));
    film = max(film, 1.0 - smoothstep(-11.5, -8.8, p.y));

    // Sunlight through the water: a caustic net, split into colour at its edges, and a violet echo.
    vec2 cp = p / 2.4 + rip * 0.06 + vec2(0.0, film * t * 0.04);
    float ct = t * 0.45;
    vec3 caus = vec3(caustic(cp + vec2(0.012, 0.0), ct), caustic(cp, ct), caustic(cp - vec2(0.012, 0.0), ct));
    float sand = fbm(p * 4.0) * 0.5 + fbm(p * 19.0) * 0.5;
    float day = 1.0 - 0.88 * uNight;                         // no sun at midnight: the caustics fade
    vec3 col = (vec3(0.004, 0.026, 0.1) + vec3(0.01, 0.025, 0.06) * sand) * (1.0 - 0.7 * uNight);
    col += caus * vec3(0.42, 0.72, 1.2) * (0.55 + 0.7 * film) * day;
    col += vec3(0.22, 0.08, 0.5) * caustic(cp * 0.5 + 3.0, ct * 0.7) * 0.3 * day;
    col += mix(vec3(0.35, 0.65, 1.0) * rip * 0.3, vec3(0.15, 0.95, 1.3) * max(rip, 0.0) * 1.1, uNight);   // at midnight the ripples glow
    // Plankton on the wet floor at midnight, twinkling.
    vec2 cell = floor(p * 9.0);
    float h = hash(cell);
    col += vec3(0.2, 0.9, 1.2) * step(0.97, h) * (0.5 + 0.5 * sin(t * 2.5 + h * 60.0)) * (1.0 - smoothstep(0.05, 0.14, length(fract(p * 9.0) - 0.5))) * film * uNight * 0.8;

    // The wet floor mirrors the ocean overhead, more where the sheet of water lies.
    vec3 v = normalize(vW - cameraPosition);
    vec3 n = normalize(vec3(rip * 0.12 + (noise(p * 3.0 + t) - 0.5) * 0.08 * film, 1.0, (noise(p * 3.0 - t) - 0.5) * 0.08 * film));
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
    col += textureCube(uOcean, reflect(v, n)).rgb * fres * (0.2 + 0.6 * film);
    col = mix(col, mix(vec3(1.0, 1.08, 1.2), vec3(0.15, 0.9, 1.3), uNight), clamp(foam, 0.0, 1.0) * 0.82);   // sea sparkle: foam lit blue at midnight
    col = powerOn(col, 0.25 * length(vW.xz - cameraPosition.xz) / 16.0);
    gl_FragColor = vec4(col, 1.0);
  }`;

const SPRAY_VERTEX = /* glsl */ `
  attribute vec4 aShot;       // x, y where it leaves the water; vx, vy
  attribute vec3 aLife;       // life (s), phase, size (m)
  uniform float uTime, uScale, uReveal;
  varying float vA;
  void main() {
    float tau = fract(uTime / aLife.x + aLife.y) * aLife.x;
    vec3 p = vec3(aShot.x + aShot.z * tau, aShot.y + aShot.w * tau - 2.6 * tau * tau, position.z);
    vA = (1.0 - tau / aLife.x) * smoothstep(0.0, 0.05, tau) * step(p.y, ${TOP} - 0.03) * step(0.0, p.y) * smoothstep(0.6, 0.9, uReveal);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = max(1.0, uScale * aLife.z / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const SPRAY_FRAGMENT = /* glsl */ `
  uniform float uNight;
  varying float vA;
  void main() { float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA; gl_FragColor = vec4(mix(vec3(0.85, 0.93, 1.0) * 1.3, vec3(0.2, 0.9, 1.3) * 1.1, uNight) * a, 1.0); }`;

/** Spray thrown off the lintel: stateless particles, each on its own arc, in a loop. */
function sprayGeometry(count) {
  const shot = [], life = [];
  const add = (x, y, vx, vy) => { shot.push(x, y, vx, vy); life.push(0.5 + Math.random() * 0.9, Math.random(), 0.012 + Math.random() * 0.03); };
  const half = LINTEL.w / 2;
  for (let i = 0; i < count; i++) {
    const x = (Math.random() * 2 - 1) * half, k = Math.abs(x) / half;
    add(x, LINTEL.y1, Math.sign(x) * (0.3 + 2.2 * k * k) * Math.random() + (Math.random() - 0.5) * 0.7, 0.3 + Math.random() * 1.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(shot.length / 4 * 3), 3));
  g.setAttribute('aShot', new THREE.Float32BufferAttribute(shot, 4));
  g.setAttribute('aLife', new THREE.Float32BufferAttribute(life, 3));
  return g;
}

/**
 * The room's screens and the lintel. ocean: the Ocean whose cube map the walls and ceiling show.
 *   surfaces       meshes to raycast (the floor: userData.wall = 'floor')
 *   screens        the walls and ceiling that show the ocean (userData.wall: 'left' | 'right' | 'front' | 'ceiling'), and the falls ('fall')
 *   ripple(x, z)   a ring on the floor
 *   touch(point)   rings across the glass from a point on a screen
 *   setMark(point, radius, color) / setMark(null)   a reticle on the glass
 *   showPanel(place, draw) / hidePanel()   content on a wall (place: { o, u, v }: centre, right, up; draw(ctx, w, h))
 *   showRecap(draw) / hideRecap()   the visit, drawn on the left wall (draw(ctx, w, h))
 *   powerOn()      the room switches on
 */
export class OceanRoom {
  constructor({ ocean, detail = 'high' }) {
    this.group = new THREE.Group();
    this.time = { value: 0 };
    this.recap = canvasTexture(2400, 600);
    this.recapMix = { value: 0 };
    this.recapTarget = 0;
    this.ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
    this.nextRipple = 0;
    this.touches = Array.from({ length: TOUCHES }, () => new THREE.Vector4(0, 0, 0, -99));
    this.nextTouch = 0;
    this.night = ocean.night;
    this.reveal = { value: REVEAL_END };
    this.revealing = false;
    this.mark = { value: new THREE.Vector4(0, 0, 0, 1) };
    this.markA = { value: 0 };
    this.markOn = false;
    this.markCol = { value: new THREE.Color() };
    this.panel = canvasTexture(Math.round(PANEL.w * PANEL.px), Math.round(PANEL.h * PANEL.px));
    this.panelMix = { value: 0 };
    this.panelTarget = 0;
    this.panelAt = { o: { value: new THREE.Vector3() }, u: { value: new THREE.Vector3(1, 0, 0) }, v: { value: new THREE.Vector3(0, 1, 0) } };
    const { minX, maxX, minZ, maxZ, height } = ROOM;
    const H = height - BASE, W = maxX - minX, D = maxZ - minZ;

    const screen = new THREE.ShaderMaterial({
      uniforms: {
        uView: { value: ocean.view.texture }, uRes: { value: ocean.res }, uRecap: { value: this.recap.texture }, uRecapMix: this.recapMix,
        uTime: this.time, uNight: this.night, uReveal: this.reveal, uTouch: { value: this.touches },
        uMark: this.mark, uMarkA: this.markA, uMarkCol: this.markCol,
        uPanel: { value: this.panel.texture }, uPanelMix: this.panelMix, uPanelO: this.panelAt.o, uPanelU: this.panelAt.u, uPanelV: this.panelAt.v,
        uPanelSize: { value: new THREE.Vector2(PANEL.w, PANEL.h) },
      },
      vertexShader: SCREEN_VERTEX, fragmentShader: SCREEN_FRAGMENT,
    });
    this.screens = [];
    const add = (wall, geo, x, y, z) => { const m = new THREE.Mesh(geo, screen); m.position.set(x, y, z); m.userData.wall = wall; this.group.add(m); this.screens.push(m); return m; };
    const e = 0.008;                                           // just off the wall faces
    add('left', new THREE.PlaneGeometry(D, H).rotateY(Math.PI / 2), minX + e, BASE + H / 2, 0);
    add('right', new THREE.PlaneGeometry(D, H).rotateY(-Math.PI / 2), maxX - e, BASE + H / 2, 0);
    add('front', new THREE.PlaneGeometry(W, H).rotateY(Math.PI), 0, BASE + H / 2, maxZ - e);       // round the door back
    add('ceiling', new THREE.PlaneGeometry(W - 2 * INSET, D - 2 * INSET).rotateX(Math.PI / 2), 0, height - 0.008, 0);

    const fall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uNight: this.night, uReveal: this.reveal }, vertexShader: SCREEN_VERTEX, fragmentShader: WATERFALL_FRAGMENT,
    }));
    fall.position.set(0, BASE + H / 2, minZ + e);
    fall.userData.wall = 'fall';
    this.group.add(fall);
    this.screens.push(fall);

    this.sprayScale = { value: 1 };
    const spray = new THREE.Points(sprayGeometry(detail === 'high' ? 5000 : 2200), new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uScale: this.sprayScale, uNight: this.night, uReveal: this.reveal }, vertexShader: SPRAY_VERTEX, fragmentShader: SPRAY_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    spray.position.z = minZ + 0.03;
    spray.frustumCulled = false;
    this.group.add(spray);

    // The lintel: real stone, the one built thing the water "hits".
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(LINTEL.w, LINTEL.y1 - LINTEL.y0, LINTEL.depth),
      new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.22, metalness: 0.2 }),
    );
    lintel.position.set(0, (LINTEL.y0 + LINTEL.y1) / 2, minZ + LINTEL.depth / 2);
    this.group.add(lintel);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, D - 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uNight: this.night, uReveal: this.reveal, uRipples: { value: this.ripples }, uOcean: { value: ocean.reflection.texture } },
      vertexShader: SCREEN_VERTEX, fragmentShader: FLOOR_FRAGMENT,
    }));
    floor.position.y = 0.003;                                  // inside the stone border (shared/room.js)
    floor.userData.wall = 'floor';
    this.group.add(floor);
    this.surfaces = [floor];
  }

  ripple(x, z) {
    this.ripples[this.nextRipple].set(x, z, this.time.value, 0);
    this.nextRipple = (this.nextRipple + 1) % RIPPLES;
  }

  /** A touch on a screen at `point` (world): rings spread across the glass from it. */
  touch(point) {
    this.touches[this.nextTouch].set(point.x, point.y, point.z, this.time.value);
    this.nextTouch = (this.nextTouch + 1) % TOUCHES;
  }

  /** A reticle of `radius` (m) round `point` on the glass, in `color`; null fades it out where it was. */
  setMark(point, radius = 1, color = 0xffffff) {
    this.markOn = !!point;
    if (!point) return;
    this.mark.value.set(point.x, point.y, point.z, radius);
    this.markCol.value.set(color);
  }

  /** Content on a wall: place { o, u, v } (centre, unit right and up along the wall, world), draw(ctx, w, h) on a PANEL-sized canvas. */
  showPanel(place, draw) {
    this.panel.redraw(draw);
    this.panelAt.o.value.copy(place.o);
    this.panelAt.u.value.copy(place.u);
    this.panelAt.v.value.copy(place.v);
    this.panelMix.value = 0;                                   // wipe it on afresh
    this.panelTarget = 1;
  }

  hidePanel() {
    this.panelTarget = 0;
  }

  get panelShown() {
    return this.panelTarget > 0;
  }

  /** The room switches on (each arrival), after a moment dark while the portal clears. */
  powerOn() {
    this.reveal.value = -0.35;
    this.revealing = true;
  }

  get recapShown() {
    return this.recapTarget > 0;
  }

  showRecap(draw) {
    this.recap.redraw(draw);
    this.recapTarget = 1;
  }

  hideRecap() {
    this.recapTarget = 0;
  }

  /** pointScale: the engine's pixels per metre at 1 m (sizes the spray). */
  update(dt, t, pointScale) {
    this.time.value = t;
    this.sprayScale.value = pointScale;
    this.recapMix.value += (this.recapTarget - this.recapMix.value) * Math.min(1, dt * 2.5);
    this.markA.value += ((this.markOn ? 1 : 0) - this.markA.value) * Math.min(1, dt * 8);
    // The panel wipes on at a steady pace and fades off.
    const pm = this.panelMix;
    pm.value = this.panelTarget ? Math.min(1, pm.value + dt * 1.6) : Math.max(0, pm.value - dt * 2.5);
    if (this.revealing) {
      this.reveal.value = Math.min(REVEAL_END, this.reveal.value + (dt * REVEAL_END) / REVEAL_S);
      this.revealing = this.reveal.value < REVEAL_END;
    }
  }
}
