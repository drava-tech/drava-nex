/* =================================================================
   FLIGHT GARDEN
   An airport operations visualization disguised as a living garden,
   modelled on Kempegowda International Airport (BLR), Bengaluru.

   Real-world reference
     BLR operates two terminals on one campus. T2, opened 2022, is
     literally built as "a terminal in a garden" — so it is the hero
     structure here (the mainflower.glb bloom at the centre of the
     scene). T1 is the older, domestic-leaning terminal, represented
     as the smaller second bloom.

   Metaphor map
     garden               → Kempegowda International Airport (BLR)
     the flower blooms    → the terminal campus (mainflower.glb)
       · right flower      → Terminal 2, "Garden Terminal" (hero, international)
       · left flower       → Terminal 1, domestic pier
     butterflies           → flights — arrivals fly in and land on a flower,
                              departures are a parked butterfly flying back out
   ================================================================= */

import * as THREE from "three";
// CMS: kept as three/examples/jsm/* rather than upstream's three/addons/*.
// three@0.158 maps both to the same files, but the examples path is what the
// rest of this repo's build and @types/three are already proven against.
// DRACOLoader is gone with the GLB garden it decoded — mainflower.glb, the one
// model still loaded, is uncompressed.
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { buildDom } from "./dom";
import "./flight-garden.css";

/** Where the GLB/PNG assets are served from. See apps/cms/public/media. */
const DEFAULT_ASSET_BASE_URL = "/media/flight-garden/";

/* =================================================================
   0 · FACTORY BOUNDARY  (added for the CMS integration)

   The original main.js was a top-level script: it grabbed #scene from
   index.html at import time, registered window listeners, and called
   animate() with an uncancellable requestAnimationFrame recursion.
   None of that can live in a React app — it would run during SSR,
   leak a render loop per mount, and double its listeners under Strict
   Mode.

   The fix is deliberately mechanical: the entire original body now
   lives inside this factory, so every former module-level binding is
   function-scoped and each mount gets its own isolated world. The body
   is intentionally NOT re-indented — that keeps `git diff` against the
   original main.js readable, which matters a lot more for 3.4k lines of
   imperative WebGL than cosmetic indentation does.

   What actually changed inside is marked with "CMS:" comments.

   This file stays plain JavaScript on purpose. The repo's tsconfig is strict
   (noImplicitAny, noUncheckedIndexedAccess, noUnusedLocals), and annotating
   3.4k lines of shader-uniform and instancing code to satisfy it would be days
   of work with zero runtime benefit — while making the diff against the
   original unreadable. The typed boundary lives in flight-garden.d.ts instead,
   so every caller still gets full type checking.
   ================================================================= */

/**
 * @param {HTMLElement} host
 * @param {import("./types.js").FlightGardenOptions} [options]
 * @returns {import("./types.js").FlightGardenHandle}
 */
export function createFlightGarden(host, options = {}) {

// CMS: everything that must be undone on unmount registers here.
/** @type {Array<() => void>} */
const cleanups = [];
let disposed = false;

/** CMS: guards every async continuation — a 14MB GLB can resolve after unmount. */
const alive = () => !disposed;

const assetBaseUrl = options.assetBaseUrl ?? DEFAULT_ASSET_BASE_URL;
const asset = (file) => `${assetBaseUrl}${file}`;

const dom = buildDom(host);
const ui = dom.ui;
const canvas = dom.canvas;
const labelLayer = dom.labelLayer;

if (options.showHud === false) dom.root.classList.add("fg-no-hud");
if (options.allowAirportSwitching === false) dom.root.classList.add("fg-no-switching");

/**
 * CMS: the standalone app served its feeds from its own origin as /api/wind,
 * /api/attendance and /api/garden-video. Here they are routes on the Hono API
 * under /api/flight-simulation/, and a display can be served from a different
 * origin than that API — so every feed URL is built through this rather than
 * being a root-relative string. An empty base keeps them same-origin.
 */
const apiBaseUrl = (options.apiBaseUrl ?? "").replace(/\/$/, "");
const apiUrl = (path) => `${apiBaseUrl}/api/flight-simulation${path}`;

/* =================================================================
   1 · WORLD CONFIG
   Everything is expressed in the coordinate space of the garden
   plane so the metaphor stays anchored to the artwork.
   ================================================================= */

const GARDEN = {
  width: 7.06,          // world-space plane size — independent of texture source
  height: 6.0,
  // The frame's inner opening measures ≈ ±2.16 x, ±2.12 y in world units.
  innerX: 1.98,         // playable area inside the white shadow box
  innerY: 1.95,
  // Spawn ring sits on the foliage, inside the opening. Everything — corridors,
  // trails, holding stack — must live on the garden; the white frame is the
  // edge of the world, and anything past it reads as floating in the void.
  edgeX: 2.02,
  edgeY: 1.98
};

/** Two clearly separated terminal blooms, arranged side by side in the garden. */
const TERMINAL = new THREE.Vector3(1.18, -0.18, 0.30);

/** Terminal 1 and Terminal 2 use matching, separately positioned blooms. */
const TERMINAL_T1 = new THREE.Vector3(-1.18, -0.18, 0.30);

/**
 * The garden video (see GARDEN_VIDEO_URL) doesn't share the plane's aspect —
 * these control how its UVs are fitted onto the plane in the shader (see
 * fitContainUv in GARDEN_FRAG) without touching any world coordinate above.
 *
 * The MP4 is 3840×2160, but that resolution controls only texture sampling
 * (the contain-fit and the sharpen kernel below) — the Three.js world above
 * keeps its original dimensions so routes, gates and labels stay aligned.
 */
const GARDEN_VIDEO = {
  width: 3840,
  height: 2160,
  aspect: 3840 / 2160,
  scale: 1.0,
  offsetX: 0.0,
  offsetY: 0.0,
  sharpenMobile: 0.0,
  sharpenDesktop: 0.28,
  // The source video is 3840×2160. Stretched across a large-format display
  // (a 55"+ TV or an interactive touch panel used as a monitor) that's a
  // real, low pixel density — an 86" 4K panel is ~51 PPI — and the
  // contain-fit rescale plus bilinear sampling softens it further. A
  // stronger unsharp-mask pass is the one lever that actually helps; it
  // can't invent detail the source doesn't have, but it meaningfully
  // improves perceived crispness.
  sharpenLarge: 0.48
};

/** Picks the garden video's unsharp-mask strength for the current viewport. */
function pickSharpenAmount(cssWidth) {
  if (cssWidth < 720) return GARDEN_VIDEO.sharpenMobile;
  if (cssWidth > 2200) return GARDEN_VIDEO.sharpenLarge;
  return GARDEN_VIDEO.sharpenDesktop;
}

const VIDEO_RENDER_QUALITY = {
  desktopDpr: 2.5,
  mobileDpr: 1.75,
  bloomStrength: 0.18,
  bloomRadius: 0.25,
  bloomThreshold: 1.0
};

const ALT = {
  ground: 0.30,         // z of gates and a butterfly resting on a flower
  cruise: 0.75,         // z of airborne traffic and route corridors
  ceiling: 41000        // ft, for the readout only
};

// Two terminals, one campus — mirrors BLR's real Kempegowda layout. T2 (hero,
// "Garden Terminal") is the big central bloom, the busier real terminal
// (~25M pax/yr vs T1's ~20M) and the one whose real architecture *is* this
// project's garden metaphor.

const MAX_DT = 1 / 24;  // clamp so tab-switches never teleport flights

/** Overall butterfly size multiplier — applied on top of the base scale in Butterfly.update(). */
const BUTTERFLY_SCALE = 1.175;

const COLOR = {
  arrival: new THREE.Color("#62dcff"),
  departure: new THREE.Color("#ffc46b"),
  holding: new THREE.Color("#ffffff"),
  terminal: new THREE.Color("#9fe6b8")
};

/** Golden fairy dust, sprinkled behind moving butterflies. */
const FAIRY_DUST_COLOR = new THREE.Color("#ffd27a");

/* =================================================================
   2 · AIRLINE + AIRPORT DATA
   ================================================================= */

// CMS: `let` not `const` — these built-in tables are the offline fallback,
// replaced wholesale by applyCatalog() once the API responds.
let AIRLINES = {
  AI: { name: "Air India", color: "#e05a45", range: [100, 899] },
  "6E": { name: "IndiGo", color: "#4f7cf5", range: [2000, 2999] },
  UK: { name: "Vistara", color: "#b487f0", range: [800, 999] },
  EK: { name: "Emirates", color: "#e8b44c", range: [500, 599] },
  QR: { name: "Qatar Airways", color: "#c8577f", range: [500, 699] },
  LH: { name: "Lufthansa", color: "#e9d16a", range: [750, 799] },
  BA: { name: "British Airways", color: "#7fa8e8", range: [100, 299] }
};

let AIRLINE_CODES = Object.keys(AIRLINES);

let CITIES = {
  BLR: "Bengaluru", DEL: "Delhi", BOM: "Mumbai", MAA: "Chennai",
  HYD: "Hyderabad", LHR: "London", DXB: "Dubai", DOH: "Doha",
  SIN: "Singapore", FRA: "Frankfurt", CCU: "Kolkata", GOI: "Goa",
  JFK: "New York", AMS: "Amsterdam", HKG: "Hong Kong", BKK: "Bangkok",
  CDG: "Paris", SYD: "Sydney"
};

let AIRPORTS = {
  BLR: {
    tower: "BLR Garden Tower", full: "Kempegowda Intl", intensity: 1.00,
    routes: ["DEL", "BOM", "DXB", "SIN", "MAA", "HYD", "LHR", "DOH"]
  },
  DEL: {
    tower: "DEL Garden Tower", full: "Indira Gandhi Intl", intensity: 1.35,
    routes: ["BLR", "BOM", "DXB", "FRA", "LHR", "CCU", "MAA", "JFK"]
  },
  BOM: {
    tower: "BOM Garden Tower", full: "Chhatrapati Shivaji", intensity: 1.20,
    routes: ["DEL", "BLR", "GOI", "DXB", "DOH", "LHR", "SIN", "AMS"]
  },
  MAA: {
    tower: "MAA Garden Tower", full: "Chennai Intl", intensity: 0.85,
    routes: ["BLR", "HYD", "CCU", "SIN", "DXB", "BKK", "DEL"]
  },
  HYD: {
    tower: "HYD Garden Tower", full: "Rajiv Gandhi Intl", intensity: 0.90,
    routes: ["BLR", "DEL", "BOM", "DXB", "DOH", "MAA", "SIN"]
  },
  LHR: {
    tower: "LHR Garden Tower", full: "London Heathrow", intensity: 1.50,
    routes: ["JFK", "CDG", "AMS", "FRA", "DXB", "HKG", "DEL", "SYD"]
  }
};

const STATUS_LABEL = {
  inbound: "Arriving",
  parked: "Landed",
  boarding: "Boarding",
  climb: "Departing",
  gone: "Departed"
};

const ZONE_LABEL = {
  inbound: "Arriving",
  parked: "Terminal Bloom",
  boarding: "Terminal Bloom",
  climb: "Departing",
  gone: "—"
};

/* =================================================================
   3 · SMALL MATH / RANDOM HELPERS
   ================================================================= */

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/** Shortest signed angular difference, wrapped to (-π, π]. */
function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* =================================================================
   4 · RENDERER · SCENE · CAMERA
   ================================================================= */

// CMS: `canvas` now comes from buildDom() above, not document.getElementById.

/**
 * CMS: signage boxes often report a high devicePixelRatio with a weak GPU,
 * where rendering at native 4K costs 4x the fill rate for no visible gain.
 * The original hard-coded window.devicePixelRatio; this caps it (default 2).
 */
const maxPixelRatio = options.maxPixelRatio ?? 2;
const pixelRatio = () => Math.min(window.devicePixelRatio, maxPixelRatio);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(pixelRatio());
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Pure black: the bloom pass encodes the clear colour on its way out, so any
// non-zero value would be lifted into a washed-out grey. Black round-trips.
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();

// --- Lighting for 3D GLB model ---
const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
dirLight.position.set(5, 10, 7);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 25;
const d = 5;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

// Enable shadow mapping in the renderer
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 9);

let controls = null;

function initControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enabled = false; // Disable all camera controls / user interaction
}

initControls();

/* --- optional bloom; the piece degrades gracefully without it ---- */
let composer = null;

async function initPostProcessing() {
  // Post-processing bloom is disabled to prevent quality loss and glare on the background video animation.
  composer = null;
}

/* =================================================================
   5 · SHARED TEXTURES + GEOMETRY (created once, reused everywhere)
   ================================================================= */

/** Soft radial falloff used by every glow sprite and particle. */
function makeGlowTexture(size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.00, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.72)");
  g.addColorStop(0.45, "rgba(255,255,255,0.18)");
  g.addColorStop(1.00, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const GLOW_TEX = makeGlowTexture();

const SHARED = {
  // Aspect matches the cropped source frames (1470×1080) so the sprite
  // isn't stretched. Sized down from the crop's tight fill (the old
  // procedural wing only used ~75% of its own plane, so matching plane
  // sizes 1:1 read visibly bigger once this art fills nearly the whole
  // quad) to land back at the original on-screen footprint.
  butterflyGeo: new THREE.PlaneGeometry(0.30, 0.30 * (1080 / 1470))
};

/* =================================================================
   6 · BUTTERFLY SPRITE ATLAS
   Real rendered butterfly art — the full flap cycle (all 57 frames of
   the ASAS0063 source sequence) packed into an 8×8 grid texture —
   replaces the old procedural wing shader. The grid is deliberately
   larger than the cycle (64 cells, 57 used) so the layout stays square;
   uFrames, not the grid size, bounds playback. uFrame selects the cell each
   instance is showing; colour is remapped from the source's own
   luminance into a livery-tinted duotone rather than multiplying the
   (blue-biased) source RGB directly, which would crush any warm
   livery toward black.
   ================================================================= */

const BUTTERFLY_ATLAS_COLS = 8;
const BUTTERFLY_ATLAS_ROWS = 8;
const BUTTERFLY_ATLAS_FRAMES = 57;   // cells 57..63 of the 8×8 grid are empty

// CMS: was a relative "assets/…" path, which only worked under the standalone
// server. Resolves against assetBaseUrl (/media/flight-garden/) like every
// other asset here.
const BUTTERFLY_TEX = new THREE.TextureLoader().load(asset("butterfly_atlas.webp"));
BUTTERFLY_TEX.colorSpace = THREE.SRGBColorSpace;
BUTTERFLY_TEX.generateMipmaps = false;
BUTTERFLY_TEX.minFilter = THREE.LinearFilter;
BUTTERFLY_TEX.magFilter = THREE.LinearFilter;
// CMS: the atlas is held in a shader uniform, so dispose()'s material walk —
// which only looks at a material's own texture-valued properties — never
// reaches it. Freed explicitly, or every remount leaks 1.3 MB of GPU memory.
cleanups.push(() => BUTTERFLY_TEX.dispose());

const SPRITE_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SPRITE_FRAG = /* glsl */`
  precision highp float;

  uniform sampler2D uMap;
  uniform float uCols;
  uniform float uRows;
  uniform float uFrames;      // frames actually in the cycle (≤ cols*rows)
  uniform float uFrame;       // atlas cell, 0..(uFrames - 1)
  uniform float uOpacity;
  uniform vec3  uColor;       // airline livery
  uniform float uTint;        // how much livery survives the source art
  uniform float uHighlight;   // 0..1 pre-departure warm-up
  uniform float uSelect;      // 0..1 hover / pinned

  varying vec2 vUv;

  void main(){
    // uFrame is a continuous 0..uFrames sweep; rounding to the nearest
    // integer can land exactly on uFrames (past the end of the cycle —
    // an empty tail cell here) right at the loop seam, which read as a
    // glitch/pop once per cycle. Wrapping keeps it a clean loop.
    float frame = mod(floor(uFrame + 0.5), uFrames);
    float col = mod(frame, uCols);
    float rowFromTop = floor(frame / uCols);
    // three.js flips textures on upload (row 0 of the source image ends
    // up at v=1), so the atlas's visual top row is also v-space's top.
    float rowFromBottom = uRows - 1.0 - rowFromTop;
    vec2 cell = vec2(1.0 / uCols, 1.0 / uRows);
    vec2 atlasUv = (vec2(col, rowFromBottom) + vUv) * cell;

    vec4 texel = texture2D(uMap, atlasUv);

    // Recolour by luminance rather than multiplying RGB — the source
    // render is blue-biased, so a straight multiply would crush any
    // warm livery colour toward black instead of reading as that colour.
    // The ramp carries a luminance gain and a bright top end: without it
    // the source's own mid-tones sit too dark to read against the night
    // garden. This is exposure on the art that's already there, not a
    // glow layered over it.
    float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    vec3 dark = uColor * 0.32;
    vec3 light = mix(uColor, vec3(1.0), 0.65);
    vec3 duotone = mix(dark, light, clamp(lum * 1.7, 0.0, 1.0));
    vec3 color = mix(texel.rgb, duotone, uTint);

    // Pre-departure and selection read as a small exposure lift and warm
    // shift — scaling the art's own light rather than adding light of
    // their own, so nothing on the butterfly emits or blooms.
    color *= 1.0 + uHighlight * 0.35 + uSelect * 0.20;
    color = mix(color, color * vec3(1.08, 0.97, 0.84), uHighlight);

    gl_FragColor = vec4(color, texel.a * uOpacity);
  }
`;

function makeButterflyMaterial(color, tint) {
  return new THREE.ShaderMaterial({
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: BUTTERFLY_TEX },
      uCols: { value: BUTTERFLY_ATLAS_COLS },
      uRows: { value: BUTTERFLY_ATLAS_ROWS },
      uFrames: { value: BUTTERFLY_ATLAS_FRAMES },
      uFrame: { value: 0 },
      uOpacity: { value: 1 },
      uColor: { value: color.clone() },
      uTint: { value: tint },
      uHighlight: { value: 0 },
      uSelect: { value: 0 }
    }
  });
}

/* =================================================================
   7 · LIVING GARDEN — the base plate, alive
   The artwork is never distorted, only *lit*. A whole-image wobble
   reads as cheap; a breathing luminance and a sub-pixel shimmer read
   as a garden at night. Gate auras brighten the actual petals of the
   bloom rather than floating a sprite above them.
   ================================================================= */

let livingGarden = null;

const GARDEN_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GARDEN_FRAG = /* glsl */`
  precision highp float;

  uniform sampler2D uMap;
  uniform vec2  uSize;            // plane size in world units
  uniform float uTime;
  uniform float uMaster;          // global intro reveal
  uniform float uBreath;          // 0..1 organic swell
  uniform float uActivity;        // 0..1 how busy the airport is
  uniform float uGlowMotion;      // 0..1 — brightness/glow breathing amplitude (stays on, just gentler)

  // uMap's own aspect ratio rarely matches the plane's (7.06:6.0) — these fit
  // it into the plane letterboxed/pillarboxed ("contain"), with no stretch and
  // no change to any world coordinate. mediaAspect == planeAspect (the PNG
  // fallback case) makes fitContainUv the identity.
  uniform float uMediaAspect;
  uniform float uPlaneAspect;
  uniform float uVideoScale;
  uniform vec2  uVideoOffset;
  uniform vec2  uVideoResolution;  // native media px size, for the sharpen kernel's texel step
  uniform float uSharpenAmount;    // 0 off (mobile) .. ~0.3 (desktop) — counters bilinear softening
  uniform float uHueShift;         // 0..1 turns around the color wheel; 0 leaves the source (red) untouched

  // Attendance scene only: paints present/absent/late as green/red/orange
  // blotches sized by their share of the total, instead of one blended hue,
  // so all three colors stay visibly distinct. uAttendanceMix is 0 for every
  // other scene, leaving uHueShift in charge as before.
  uniform float uAttendanceMix;
  uniform vec2  uAttendanceShares;  // (presentShare, absentShare); lateShare = 1 - both
  uniform vec2  uGardenInner;       // half-extents of the video's own opening, inside its white frame (world units)

  varying vec2 vUv;

  const vec3 GOLD = vec3(1.00, 0.82, 0.45);

  // cheap hash, used only to stagger clump timing — never to distort geometry
  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }


  // Standard RGB<->HSV round trip, used to rotate the video's hue for the
  // weather scene's temperature tint — see uHueShift. Rotating in HSV keeps
  // each pixel's brightness and saturation intact and just spins its color
  // around the wheel, so it reads as one tinted render rather than a filter.
  vec3 rgb2hsv(vec3 c){
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c){
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec3 hueShift(vec3 rgb, float turns){
    vec3 hsv = rgb2hsv(rgb);
    hsv.x = fract(hsv.x + turns);
    return hsv2rgb(hsv);
  }

  // Forces a pixel to an exact hue/saturation, keeping only its own
  // brightness (so the video's shading/grain still reads through). Used by
  // the attendance scene instead of hueShift: a *rotation* leaves a
  // desaturated pixel (e.g. white highlights) untouched, since hue is
  // meaningless at zero saturation, and it leaves whichever category keeps
  // the source's native hue looking like the raw, un-recoloured video rather
  // than a real solid colour. Setting hue and saturation outright fixes both.
  vec3 recolor(vec3 rgb, float hue, float sat){
    float value = rgb2hsv(rgb).z;
    return hsv2rgb(vec3(hue, sat, value));
  }

  // Maps a plane UV onto uMap's own UV space so the media is fully visible,
  // centred, and undistorted — never cropped, never stretched. Whichever axis
  // the media is proportionally narrower on gets letterboxed: that axis's
  // valid range shrinks to less than 0..1, and callers must mask the rest out
  // rather than sample it (clamping would smear the edge pixel into the bars).
  vec2 fitContainUv(vec2 uv){
    vec2 p = uv - 0.5;
    if (uMediaAspect > uPlaneAspect) {
      p.y *= uMediaAspect / uPlaneAspect;   // media wider than plane: letterbox top/bottom
    } else {
      p.x *= uPlaneAspect / uMediaAspect;   // media taller than plane: pillarbox left/right
    }
    p = p / uVideoScale - uVideoOffset;
    return p + 0.5;
  }

  // Unsharp-mask style 5-tap kernel: video played back through bilinear
  // filtering at less-than-native size reads soft on a bright 4K display, so
  // this counters it with a cheap high-pass boost. Weights sum to 1.0 so flat
  // regions are untouched; only edges gain contrast.
  vec3 sampleSharp(sampler2D tex, vec2 uv, vec2 texel){
    vec3 c = texture2D(tex, uv).rgb;
    vec3 n = texture2D(tex, uv + vec2(0.0, texel.y)).rgb;
    vec3 s = texture2D(tex, uv - vec2(0.0, texel.y)).rgb;
    vec3 e = texture2D(tex, uv + vec2(texel.x, 0.0)).rgb;
    vec3 w = texture2D(tex, uv - vec2(texel.x, 0.0)).rgb;
    return c * 1.35 - (n + s + e + w) * 0.0875;
  }

  void main(){
    vec2 mediaUv = fitContainUv(vUv);
    float mediaValid = step(0.0, mediaUv.x) * step(0.0, mediaUv.y)
                      * step(mediaUv.x, 1.0) * step(mediaUv.y, 1.0);

    vec2 safeUv = clamp(mediaUv, 0.0, 1.0);
    vec3 normalCol = texture2D(uMap, safeUv).rgb;

    vec3 tintedCol;
    if (uAttendanceMix > 0.5) {
      // Coverage per color has to track its count's share, which is why
      // category comes from a single per-cell hash used directly against
      // the thresholds — a blended/interpolated noise value clusters near
      // the middle of its range (an earlier version used that and it
      // visibly skewed coverage toward whichever category owned the middle
      // band, regardless of its actual share) where a raw hash lands close
      // to uniform on 0..1, so each cell is an even, independent draw and
      // area follows share.
      //
      // Smooth Voronoi, not a hard-edged one: picking a single nearest
      // jittered cell per pixel (Worley F1) tiled the frame in flat polygons
      // with knife-edge borders — it read as a broken camouflage texture,
      // not the piece's own organic, living-garden look. Blending every
      // nearby cell's colour by a Gaussian falloff on its distance instead
      // gives soft, ink-like transitions between colors while keeping the
      // same per-cell area (and so the same share-driven coverage), just
      // with its edges feathered rather than cut.
      vec2 grid = vUv * uSize * 2.6;
      vec2 baseCell = floor(grid);
      vec2 f = fract(grid);

      // Same three hue stops as the wind/temp thermal anchors' green and
      // orange bands. A fixed saturation (not the source pixel's own) is
      // what makes every cell read as a solid particle colour rather than a
      // tint riding on whatever the video already looked like there.
      const float PRESENT_HUE = 0.3333;
      const float ABSENT_HUE = 0.0;
      const float LATE_HUE = 0.0833;
      const float ATTEND_SAT = 0.85;
      const float BLEND_SOFTNESS = 1.6;

      float presentT = uAttendanceShares.x;
      float absentT = presentT + uAttendanceShares.y;

      vec3 colorSum = vec3(0.0);
      float weightSum = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 neighbor = vec2(float(x), float(y));
          vec2 cellId = baseCell + neighbor;
          vec2 jitter = vec2(hash21(cellId + 11.3), hash21(cellId + 47.9));
          float d = length(neighbor + jitter - f);

          float catRand = hash21(cellId + 5.9);
          float hue = catRand < presentT ? PRESENT_HUE : (catRand < absentT ? ABSENT_HUE : LATE_HUE);

          float weight = exp(-d * d * BLEND_SOFTNESS * BLEND_SOFTNESS);
          colorSum += recolor(normalCol, hue, ATTEND_SAT) * weight;
          weightSum += weight;
        }
      }
      vec3 attendanceCol = colorSum / max(weightSum, 0.0001);

      // Confine the blend to the video's own interior opening — vUv covers
      // the whole plane, including the white display-case frame baked into
      // the footage around that opening, and recoloring straight to the
      // edge of the plane spilled the tint out over that frame (and, by
      // extension, made the outer cube read as tinted too). A 0.2-world-unit
      // feather keeps the cutoff from being a hard line.
      vec2 local = (vUv - 0.5) * uSize;
      vec2 innerFade = 1.0 - smoothstep(uGardenInner - 0.2, uGardenInner, abs(local));
      float insideMask = innerFade.x * innerFade.y;

      tintedCol = mix(normalCol, attendanceCol, insideMask);
    } else if (abs(uHueShift) > 0.0001) {
      // abs(), not a plain > check: uHueShift can be negative (the 40°C+
      // magenta anchor is -0.1111, the short way around the wheel from red —
      // see the weather scene's thermal.anchors) and a bare "> 0.0001" would
      // silently skip the rotation for every negative shift, always showing
      // the source's native red instead.
      tintedCol = hueShift(normalCol, uHueShift);
    } else {
      tintedCol = normalCol;
    }
    vec3 rawCol = tintedCol * mediaValid;

    gl_FragColor = vec4(rawCol, 1.0);
  }
`;

/**
 * Time constant for LivingGarden's hue easing: roughly how long a full
 * blend between two colours takes to feel settled. Exponential easing
 * never mathematically finishes, so this is a "practically there" figure,
 * not a hard duration.
 */
const HUE_EASE_SECONDS = 1.4;

/**
 * Owns the garden plane and the uniforms that make it feel alive. Gate state is
 * pushed in once per frame; nothing here allocates after construction.
 */
class LivingGarden {
  /**
   * mediaAspect defaults to the plane's own aspect (an identity fit) — the
   * PNG fallback case, where the texture was already baked to fill the
   * plane. Pass the video's real videoWidth/videoHeight ratio to letterbox
   * or pillarbox it cleanly instead.
   */
  constructor(texture, mediaAspect = GARDEN.width / GARDEN.height, mediaResolution = [GARDEN_VIDEO.width, GARDEN_VIDEO.height]) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: GARDEN_VERT,
      fragmentShader: GARDEN_FRAG,
      uniforms: {
        uMap: { value: texture },
        uSize: { value: new THREE.Vector2(GARDEN.width, GARDEN.height) },
        uTime: { value: 0 },
        uMaster: { value: 0 },
        uBreath: { value: 0 },
        uActivity: { value: 0 },
        uGlowMotion: { value: REDUCED_MOTION ? 0.35 : 1 },
        uMediaAspect: { value: mediaAspect },
        uPlaneAspect: { value: GARDEN.width / GARDEN.height },
        uVideoScale: { value: GARDEN_VIDEO.scale },
        uVideoOffset: { value: new THREE.Vector2(GARDEN_VIDEO.offsetX, GARDEN_VIDEO.offsetY) },
        uVideoResolution: { value: new THREE.Vector2(mediaResolution[0], mediaResolution[1]) },
        uSharpenAmount: { value: pickSharpenAmount(window.innerWidth) },
        uHueShift: { value: 0 },
        uAttendanceMix: { value: 0 },
        uAttendanceShares: { value: new THREE.Vector2(0, 0) },
        uGardenInner: { value: new THREE.Vector2(GARDEN.innerX, GARDEN.innerY) }
      }
    });

    // The uniform above is the *displayed* hue; this is where setHueShift
    // points it — update() eases the uniform toward this every frame rather
    // than jumping straight to it, so a new temperature reading blends in
    // instead of cutting.
    this.hueTarget = 0;

    // Same easing treatment for the attendance scene's blotch sizes — a new
    // reading grows/shrinks each color's share smoothly instead of snapping.
    this.attendanceSharesTarget = new THREE.Vector2(0, 0);

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(GARDEN.width, GARDEN.height),
      this.material
    );
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);
  }

  /**
   * Points the plane at a different video without rebuilding anything.
   *
   * Scene switches and the weather scene's temperature bands both land here,
   * so the swap has to carry the new media's own shape with it: a clip of a
   * different aspect ratio must re-fit, or it would be stretched to the
   * outgoing one's proportions.
   */
  setMedia(texture, mediaAspect, mediaResolution) {
    const u = this.material.uniforms;
    u.uMap.value = texture;
    u.uMediaAspect.value = mediaAspect;
    u.uVideoResolution.value.set(mediaResolution[0], mediaResolution[1]);
  }

  /**
   * turns: rotation around the color wheel (0 leaves the source, red,
   * untouched). Sets where the hue is headed, not where it is — update()
   * eases the displayed value toward this each frame, so a new reading
   * fades the garden into its new colour rather than snapping to it.
   */
  setHueShift(turns) {
    this.hueTarget = turns;
  }

  /** Turns the shader's three-colour attendance blend on or off. */
  setAttendanceMix(active) {
    this.material.uniforms.uAttendanceMix.value = active ? 1 : 0;
  }

  /**
   * Sets where each color's share of the noise field is headed; late's
   * share is implicit (1 - present - absent) so the shader always partitions
   * the whole field. Eased in update() the same way hueTarget is.
   */
  setAttendanceShares(presentShare, absentShare) {
    this.attendanceSharesTarget.set(presentShare, absentShare);
  }

  /**
   * Organic timing: three incommensurate sines never repeat on a beat, so the
   * swell never feels like a metronome the way a single sin(t) does.
   */
  static breath(t) {
    // Constant output (no breathing animation)
    return 0.5;
  }

  update(elapsed, master, activity, dt) {
    const u = this.material.uniforms;
    u.uTime.value = elapsed;
    u.uMaster.value = master;
    u.uBreath.value = LivingGarden.breath(elapsed);
    u.uActivity.value = activity;

    // Ease the displayed hue toward hueTarget rather than jumping: an
    // exponential approach (this frame closes a fixed *fraction* of
    // whatever distance remains) so the blend is frame-rate independent
    // and settles smoothly rather than at a constant, mechanical speed.
    //
    // The distance is computed mod 1 turn and wrapped into (-0.5, 0.5]
    // before easing — a plain subtraction would, e.g., ease from 350°
    // toward 10° the "long" way through the entire wheel instead of
    // straight across the 0°/360° seam.
    if (dt > 0) {
      const current = u.uHueShift.value;
      let delta = this.hueTarget - current;
      delta -= Math.round(delta);
      const ease = 1 - Math.exp(-dt / HUE_EASE_SECONDS);
      u.uHueShift.value = current + delta * ease;

      const shares = u.uAttendanceShares.value;
      shares.x += (this.attendanceSharesTarget.x - shares.x) * ease;
      shares.y += (this.attendanceSharesTarget.y - shares.y) * ease;
    }
  }

  dispose() {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * CMS: restored — the upstream merge dropped this along with the PNG garden
 * path, but loadGardenTexture below still needs it. Reads a PNG's IHDR from
 * the first 24 bytes so the decoder can be asked for a GPU-safe bitmap up
 * front, instead of materialising the full image and shrinking it after.
 */
async function readPngSize(blob) {
  const head = new DataView(await blob.slice(0, 24).arrayBuffer());
  if (head.byteLength < 24 || head.getUint32(0) !== 0x89504e47) return null;
  return { width: head.getUint32(16), height: head.getUint32(20) };
}

/**
 * Fallback path only — used when the garden video can't load. garden.png is
 * 7805×6640, 207 MB of decoded RGBA and wider than the 4096 MAX_TEXTURE_SIZE
 * that plenty of mobile GPUs report. Uploaded as-is it costs a quarter-
 * gigabyte of VRAM on desktop and fails outright on a phone, leaving a black
 * garden. The plane is never drawn wider than ~1300 CSS px, so we decode
 * straight to a GPU-safe size and upload that instead.
 */
async function loadGardenTexture(url) {
  const limit = Math.min(
    renderer.capabilities.maxTextureSize,
    window.innerWidth < 720 ? 1600 : 2560
  );

  const response = await fetch(url);
  if (!response.ok) throw new Error(`garden.png → HTTP ${response.status}`);
  const blob = await response.blob();

  // Read the header first so we can ask the decoder for a small bitmap directly,
  // instead of materialising all 207 MB and shrinking it afterwards.
  const size = await readPngSize(blob);
  const scale = size ? Math.min(1, limit / Math.max(size.width, size.height)) : 1;

  let source;
  if (size && scale < 1) {
    const opts = {
      resizeWidth: Math.round(size.width * scale),
      resizeHeight: Math.round(size.height * scale),
      resizeQuality: "high"
    };
    // Older Safari ignores or rejects the resize options; the drawImage below
    // still scales correctly, it just pays for the full decode first.
    source = await createImageBitmap(blob, opts).catch(() => createImageBitmap(blob));
  } else {
    source = await createImageBitmap(blob);
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((size?.width ?? source.width) * scale));
  canvas.height = Math.max(1, Math.round((size?.height ?? source.height) * scale));

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

/**
 * CMS: last resort for the garden layer — the committed still image, used when
 * no video can be had at all (R2 unconfigured, bucket unreachable, CORS wrong).
 * Runs once: a plane already showing something is left alone, so a later scene
 * switch that fails cannot replace live video with a static image.
 */
let stillFallbackUsed = false;
async function useStillGardenFallback() {
  if (stillFallbackUsed || livingGarden) return;
  stillFallbackUsed = true;

  try {
    const texture = await loadGardenTexture(asset("garden.png"));
    // A 7805×6640 decode easily outlives an unmount.
    if (!alive()) { texture.dispose(); return; }

    livingGarden = new LivingGarden(texture);
    resize();
    console.warn("[Flight Garden] no video render available — showing the still garden instead.");
  } catch (err) {
    console.warn("[Flight Garden] still garden unavailable; rendering without a garden layer.", err);
  }
}

/**
 * Loads the garden video as a looping, muted THREE.VideoTexture — the only
 * source the garden layer has. Rejects if the URL won't load, which is what
 * lets loadGarden() give up cleanly and leave the rest of the scene running.
 */
async function loadGardenVideoTexture(url) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.src = url;
  video.loop = true;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.preload = "auto";

  await new Promise((resolve, reject) => {
    video.addEventListener("loadeddata", resolve, { once: true });
    video.addEventListener("error", () => reject(video.error ?? new Error("video load error")), { once: true });
  });

  // Append to DOM to prevent Chrome's compositor from throttling video updates
  video.style.position = "absolute";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  video.style.overflow = "hidden";
  video.style.zIndex = "-1";
  // CMS: into the host, not document.body — the element must go away with
  // this instance rather than accumulating one 4K decoder per remount.
  host.appendChild(video);

  try {
    await video.play();
  } catch (err) {
    // Autoplay blocked — the texture is still valid, just paused on the
    // first frame. Retry once the user interacts with the page.
    const resume = () => video.play().catch(() => { });
    // CMS: routed through on() so the retry listener is torn down on dispose.
    on(window, "pointerdown", resume, { once: true });
    on(window, "touchstart", resume, { once: true });
  }

  // Belt-and-suspenders for an uninterrupted loop: video.loop already
  // replays at the end, but browsers also pause this element on their own —
  // it is 1px and transparent, so it reads as offscreen — under memory or
  // battery pressure, and whenever the tab goes to the background.
  //
  // Only fight that while the tab is actually visible. Calling play() on a
  // hidden tab just loses a race with the browser's own suspend, and the
  // resulting play/pause churn makes the decoder slower to come back than if
  // it had been left alone. Resuming is instead deferred to the
  // visibilitychange below, which fires once, at the moment it can succeed.
  video.addEventListener("pause", () => {
    if (document.visibilityState === "visible") video.play().catch(() => { });
  });

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  // Gate GPU uploads on real decoded frames, not on animation frames.
  //
  // At 3840×2160 one frame is ~33 MB of RGBA. THREE re-uploads whenever
  // needsUpdate is set, and update() runs once per render tick — so flagging
  // it unconditionally pushes ~33 MB at display refresh (60 Hz or higher)
  // for a source that only produces 30 new frames a second. Half or more of
  // that bus traffic re-sends a frame the GPU already holds.
  //
  // requestVideoFrameCallback fires once per decoded frame, so it flags the
  // texture only when there is genuinely something new. Firefox doesn't
  // implement it yet and falls back to the old every-tick behaviour.
  //
  // Uploads stay suppressed mid-seek either way, which is what stops Chrome
  // showing a blurry keyframe at the loop boundary.
  const hasFrameCallback = typeof video.requestVideoFrameCallback === "function";
  let frameReady = true;
  let lastFrameFlag = performance.now();

  if (hasFrameCallback) {
    const onDecodedFrame = () => {
      frameReady = true;
      lastFrameFlag = performance.now();
      video.requestVideoFrameCallback(onDecodedFrame);
    };
    video.requestVideoFrameCallback(onDecodedFrame);
  }

  texture.update = function () {
    if (video.readyState < video.HAVE_CURRENT_DATA || video.seeking) return;

    if (hasFrameCallback && !frameReady) {
      // rVFC only fires for frames the compositor actually presents, so it
      // goes silent in a background tab — and can stay silent coming back if
      // the browser suspended and re-armed the decoder underneath us. Without
      // this escape hatch the garden freezes on whichever frame was uploaded
      // last. Silence longer than ~250ms while playing means the callback
      // chain is no longer driving us, so upload anyway; a callback firing
      // again refreshes lastFrameFlag and hands control back to it.
      if (video.paused || performance.now() - lastFrameFlag < 250) return;
    }

    frameReady = false;
    this.needsUpdate = true;
  };

  // Coming back from another tab or app: the browser may have paused this
  // element, and nothing was composited while it was hidden, so rVFC has
  // been silent and the texture still holds whatever frame was current when
  // the tab went away. Resume playback and force one upload so the garden is
  // live again immediately rather than showing a stale frame until the next
  // decode lands.
  const onVisibility = () => {
    if (document.visibilityState !== "visible") return;
    if (video.paused) video.play().catch(() => { });
    frameReady = true;
    lastFrameFlag = performance.now();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const mediaAspect = video.videoWidth / video.videoHeight;
  const mediaResolution = [video.videoWidth, video.videoHeight];

  /**
   * Tears the element down completely. Scenes swap videos at runtime, so a
   * discarded one that keeps its listeners — and keeps decoding — would stack
   * up a 4K decoder per switch. Detaching the source is what actually frees
   * the decoder; removing the node alone does not.
   */
  const dispose = () => {
    document.removeEventListener("visibilitychange", onVisibility);
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    texture.dispose();
  };

  return { texture, video, mediaAspect, mediaResolution, dispose };
}

/* =================================================================
   6B · SCENES — a data source bound to an artwork
   ---------------------------------------------------------------
   The app is a player for visualizations, not one visualization. A
   scene names where its numbers come from, which render(s) it draws
   on, and what those numbers do to them. Everything below reads this
   table; nothing downstream hard-codes "flight" or "weather".

   To add one, copy the `template` block at the bottom, give it an id,
   and add its video ids to VIDEO_KEYS in apps/api/src/services/flight-video.ts so the presigner
   will sign them. No engine code changes.
   ================================================================= */

/**
 * Where a video id resolves to a URL.
 *
 * By default the app asks its own /api/garden-video?id=<id>, which 302s to a
 * short-lived presigned R2 URL — that keeps the bucket private and the R2
 * credentials server-side. Setting R2_PUBLIC_BASE to the bucket's public base
 * (its "Public Development URL", https://pub-<hash>.r2.dev, or a custom
 * domain bound to it) streams straight off R2's CDN instead, which caches
 * better.
 *
 * Either way the bucket's CORS policy must allow this app's origin: the
 * VideoTexture is uploaded to the GPU, so without CORS headers the WebGL
 * context is tainted and the upload throws.
 */
const R2_PUBLIC_BASE = "";

/** Must mirror VIDEO_KEYS in apps/api/src/services/flight-video.ts — that file is the security boundary. */
const VIDEO_PATHS = {
  "flight-garden": "flight-simulation/4k_render_final_001.mp4",
  "weather-warm": "flight-simulation/weather_warm.mp4"
};

/**
 * The weather scene's location picker — ids and order must mirror
 * LOCATIONS in apps/api/src/services/flight-locations.ts, that file is the security boundary
 * (the /wind route only accepts ids on this allowlist, never an arbitrary query).
 */
const WEATHER_LOCATIONS = [
  { id: "bengaluru", label: "Bengaluru, India" },
  { id: "reykjavik", label: "Reykjavik, Iceland" },
  { id: "oslo", label: "Oslo, Norway" },
  { id: "london", label: "London, United Kingdom" },
  { id: "newyork", label: "New York, United States" },
  { id: "tokyo", label: "Tokyo, Japan" },
  { id: "dubai", label: "Dubai, UAE" },
  { id: "cairo", label: "Cairo, Egypt" },
  { id: "sydney", label: "Sydney, Australia" },
  { id: "riodejaneiro", label: "Rio de Janeiro, Brazil" }
];

const DEFAULT_LOCATION_ID = "bengaluru";

const ART = {
  /**
   * Rather than show a black plane, a scene whose clip will not load falls
   * back to this one and says so in the console — a safety net for a bad
   * signature or an object missing from the bucket.
   *
   * Set to null to disable the fallback and leave the plane empty instead.
   */
  fallbackVideoId: "flight-garden",

  url(videoId) {
    // ?video=<url> still wins, for dropping in a local test render.
    const override = new URLSearchParams(location.search).get("video");
    if (override) return override;

    if (R2_PUBLIC_BASE) {
      const path = VIDEO_PATHS[videoId];
      if (path) return R2_PUBLIC_BASE.replace(/\/$/, "") + "/" + path;
    }
    // CMS: the standalone app served /api/garden-video from its own origin;
    // here it is a route on the Hono API — see apiUrl() at the top of the factory.
    return apiUrl(`/garden-video?id=${encodeURIComponent(videoId)}`);
  }
};

/**
 * Maps a live reading onto the video's playbackRate.
 *
 * Shared by every scene: a value is normalised to 0..1 across [min, max],
 * then that 0..1 spans [minRate, maxRate]. At the defaults below, calm air
 * plays at normal speed and a gusty day nudges it slightly faster — never
 * slower than real time.
 */
function rateFrom(value, { min, max, minRate, maxRate }) {
  return lerp(minRate, maxRate, clamp((value - min) / (max - min), 0, 1));
}

const WIND_TO_RATE = { min: 18, max: 38, minRate: 1, maxRate: 1.1 };

/**
 * Piecewise-linear lookup for the weather scene's hue tint: anchors are
 * [tempC, hueTurns] pairs sorted by tempC, and a reading between two anchors
 * gets the straight-line blend between their hues. Outside the range, the
 * nearest anchor's hue holds steady rather than extrapolating.
 */
function hueForTemp(tempC, anchors) {
  if (tempC <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [t0, h0] = anchors[i - 1];
    const [t1, h1] = anchors[i];
    if (tempC <= t1) return lerp(h0, h1, (tempC - t0) / (t1 - t0));
  }
  return anchors[anchors.length - 1][1];
}

/**
 * CMS: every route on this API answers in the repo-wide envelope,
 * `{ success, data }` on success and `{ success: false, error: { message } }`
 * on failure — see apps/api/src/lib/response.ts. Upstream's endpoints returned
 * the reading at the top level, so both feed helpers below unwrap it here
 * rather than every caller learning about the envelope.
 *
 * A non-2xx still carries a parseable body, so the message is read out of it
 * before falling back to the status code.
 */
async function unwrapEnvelope(endpoint, res) {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.success !== true || body.data === undefined) {
    throw new Error(body?.error?.message || `${endpoint} → HTTP ${res.status}`);
  }
  return body.data;
}

/**
 * The live feed. One WeatherAPI call returns wind *and* temperature, so the
 * weather scene costs no extra rate limit over the flight scene.
 *
 * The key never reaches the browser — GET /api/flight-simulation/wind proxies
 * it server-side, reading WEATHERAPI_KEY from the API's environment.
 */
async function fetchReading(endpoint) {
  const data = await unwrapEnvelope(endpoint, await fetch(endpoint));
  if (typeof data.kph !== "number") {
    throw new Error(`${endpoint} returned no kph`);
  }
  return data;
}

/**
 * The attendance scene's feed — present/absent/late headcounts from
 * trava-app. Same shape of proxy as fetchReading and the /wind route: the trava-app
 * API key never reaches the browser, GET /api/flight-simulation/attendance reads it server-side
 * from TRAVA_ATTENDANCE_API_KEY.
 */
async function fetchAttendanceReading(endpoint) {
  const data = await unwrapEnvelope(endpoint, await fetch(endpoint));
  if (
    typeof data.present !== "number" ||
    typeof data.absent !== "number" ||
    typeof data.late !== "number"
  ) {
    throw new Error(`${endpoint} returned incomplete attendance counts`);
  }
  return data;
}

/** Which category the HUD calls out as driving the current tint. */
function labelForAttendance({ present, absent, late }) {
  const total = present + absent + late;
  if (total <= 0) return null;
  const top = Math.max(present, absent, late);
  if (top === present) return "Mostly Present";
  if (top === late) return "Mostly Late";
  return "Mostly Absent";
}

const SCENES = {
  /* ---------------------------------------------------------------
     1 · FLIGHT — live air traffic as butterflies in a garden
     --------------------------------------------------------------- */
  flight: {
    name: "Flight Garden",
    blurb: "Butterflies are flights",

    art: { mode: "single", videoId: "flight-garden" },

    data: {
      endpoint: "/wind",
      pollMs: 5 * 60 * 1000,   // real-time enough without hammering the free tier
      /** Wind sets how fast the garden breathes. */
      apply(reading, ctx) {
        const rate = rateFrom(reading.kph, WIND_TO_RATE);
        ctx.setPlaybackRate(rate);
        return { wind: reading.kph, rate };
      }
    },

    /** Butterflies, terminal captions and the airport selector belong to this scene. */
    flights: true,
    panels: { tower: true, stats: true, legend: true, detail: true, weather: false }
  },

  /* ---------------------------------------------------------------
     2 · WEATHER — temperature picks the render, wind sets its pace
     --------------------------------------------------------------- */
  weather: {
    name: "Weather Garden",
    blurb: "Temperature colours the garden",

    /**
     * One render (the red clip) for the whole scene — temperature rotates
     * its hue in the shader instead of swapping to a separately-rendered
     * clip. `anchors` are [tempC, hueTurns] control points the current
     * reading is linearly interpolated between (see hueForTemp); 0 turns is
     * the source's own red, so a hot reading needs no rotation at all.
     *
     * Each anchor's hue is the source video's own hue (~0°/red) rotated to
     * match a 9-stop temperature palette (0-4 deep blue ... 40+ magenta),
     * placed at that band's midpoint so a reading interpolates smoothly
     * between bands rather than jumping at their edges. The last anchor
     * (40°C, magenta) is written as a *negative* turn (-0.1111, i.e. -40°)
     * rather than +0.8889: interpolating in "turns" space takes the
     * straight-line path between two anchors, and going from 37°C's 0.0
     * (red) up to +0.8889 would sweep the *long* way around the wheel
     * through yellow/green/cyan/blue on approach to 40°C. The negative
     * form is the same angle (GLSL's fract() wraps it to the identical
     * 320° on the GPU) but takes the short path directly from red toward
     * magenta, which is the transition that actually looks right.
     *
     * `labels` mirrors the same 9 bands for the HUD text, independent of
     * the (continuous) hue itself.
     */
    art: {
      mode: "single",
      videoId: "weather-warm",
      thermal: {
        anchors: [
          [2, 0.5556],    // 0–4°C      deep teal/blue  #006699 → 200°
          [7, 0.5556],    // 5–9°C      light blue      #3399CC → 200°
          [12, 0.4475],   // 10–14°C    mint/soft green #66C2A5 → 161°
          [17, 0.3333],   // 15–19°C    bright green    #4AAF4A → 120°
          [22, 0.1339],   // 20–24°C    pale yellow     #FFE680 → 48°
          [27, 0.0833],   // 25–29°C    soft orange     #FF9933 → 30°
          [32, 0.0556],   // 30–34°C    dark orange     #FF5500 → 20°
          [37, 0],        // 35–39°C    red (native)    #E60000 → 0°
          [40, -0.1111]   // 40°C+      deep magenta    #990066 → 320° (-40°)
        ],
        labels: [
          { upTo: 4, label: "Freezing" },
          { upTo: 9, label: "Chilly" },
          { upTo: 14, label: "Cool" },
          { upTo: 19, label: "Mild" },
          { upTo: 24, label: "Warm" },
          { upTo: 29, label: "Summer" },
          { upTo: 34, label: "Hot" },
          { upTo: 39, label: "Very Hot" },
          { upTo: Infinity, label: "Extreme Heat" }
        ]
      }
    },

    data: {
      endpoint: "/wind",
      // Tells pollScene to append ?location=<selectedLocationId> to the
      // endpoint — only this scene has a location picker (see
      // WEATHER_LOCATIONS/wireLocationSelector); every other scene's
      // /wind call is the plain, location-less one.
      locationParam: true,
      pollMs: 5 * 60 * 1000,
      apply(reading, ctx) {
        ctx.setPlaybackRate(rateFrom(reading.kph, WIND_TO_RATE));

        // Not a render swap any more — just the hue rotation on the one
        // clip. Still returns a band so the HUD keeps its Cool/Mild/Warm text.
        const band = ctx.setThermalTint(reading.tempC);

        return { wind: reading.kph, temp: reading.tempC, band };
      }
    },

    flights: false,
    panels: { tower: true, stats: false, legend: false, detail: false, weather: true }
  },

  /* ---------------------------------------------------------------
     3 · ATTENDANCE — trava-app present/absent/late colours the garden
     --------------------------------------------------------------- */
  attendance: {
    name: "Attendance Art",
    blurb: "Presence colours the garden",

    // Same clip as the weather scene, hue-rotated the same way — no new
    // render to source, just a different reading driving the same uHueShift.
    art: { mode: "single", videoId: "weather-warm" },

    data: {
      endpoint: "/attendance",
      fetch: fetchAttendanceReading,
      pollMs: 5 * 60 * 1000,
      apply(reading, ctx) {
        const band = ctx.setAttendanceTint(reading);
        return { present: reading.present, absent: reading.absent, late: reading.late, band };
      }
    },

    flights: false,
    panels: { tower: true, stats: false, legend: false, detail: false, weather: false, attendance: true }
  },

  /* ---------------------------------------------------------------
     4 · TEMPLATE — copy this block to add a visualization
     ---------------------------------------------------------------
     Flip `enabled` to true and it appears in the switcher. Then:

       1. point data.endpoint at your feed. If it needs a secret key,
          add a route to apps/api's flight-simulation router and proxy it
          there, the way /wind hides WEATHERAPI_KEY — never call a keyed API from
          this file, it ships to the browser.
       2. add your video ids to VIDEO_PATHS above AND to VIDEO_KEYS in
          apps/api/src/services/flight-video.ts. The presigner only signs allowlisted ids.
       3. write apply(): it receives the parsed reading, drives the art
          through ctx, and returns whatever the HUD should show.

     ctx gives you:
       ctx.setPlaybackRate(n)     — speed of the current render
       ctx.selectBand(value)      — for art.mode "banded": picks the band
                                    and swaps the video when it changes
       ctx.setThermalTint(value)  — for art.thermal: rotates the current
                                    render's hue between its anchors instead
                                    of swapping clips (see the weather scene)
     --------------------------------------------------------------- */
  template: {
    enabled: false,
    name: "Scene 3",
    blurb: "Describe the data here",

    art: { mode: "single", videoId: "flight-garden" },

    data: {
      endpoint: "/wind",
      pollMs: 5 * 60 * 1000,
      apply(reading, ctx) {
        ctx.setPlaybackRate(rateFrom(reading.kph, WIND_TO_RATE));
        return {};
      }
    },

    flights: false,
    panels: { tower: true, stats: false, legend: false, detail: false, weather: true }
  }
};

/** Which scene the app opens on. */
const DEFAULT_SCENE = "flight";

/** Scene ids the switcher offers — `enabled: false` keeps a draft out of it. */
const sceneIds = () => Object.keys(SCENES).filter((id) => SCENES[id].enabled !== false);

/** Every video id a scene's art can put on screen, whatever its art.mode. */
function sceneVideoIds(scene) {
  if (scene.art.mode === "single") return [scene.art.videoId];
  if (scene.art.mode === "banded") return (scene.art.bands ?? []).map((b) => b.id);
  return [];
}

/** Video ids already warmed into the browser's HTTP cache, or being warmed. */
const prefetchedVideoIds = new Set();

/**
 * Warms one video into the browser's HTTP cache without holding it in this
 * tab's memory: the response is read in a loop and each chunk discarded
 * immediately, but the network layer still writes the full body to disk
 * cache as it streams past — same mechanism a plain `<link rel=prefetch>`
 * uses, just for a resource type that isn't a valid `as` for that tag.
 *
 * The R2 GET this hits is signed with a `public, max-age=3600` cache
 * override (see presignR2Get in apps/api/src/services/flight-video.ts) — without that, the object's
 * own stored headers might not be cacheable at all, and this would just
 * burn bandwidth for nothing.
 */
async function prefetchVideo(videoId) {
  if (prefetchedVideoIds.has(videoId)) return;
  prefetchedVideoIds.add(videoId);

  try {
    const res = await fetch(ART.url(videoId));
    if (!res.ok || !res.body) throw new Error(`prefetch ${videoId} → HTTP ${res.status}`);

    const reader = res.body.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch (err) {
    // Best-effort only — a failed warm-up just means the next switch to
    // this scene pays the normal network cost instead of a cached one.
    prefetchedVideoIds.delete(videoId);
    console.warn(`[Flight Garden] prefetch of "${videoId}" failed — will retry on next switch.`, err);
  }
}

/**
 * Warms every other enabled scene's video(s) in the background once the
 * active one is up and playing, so switching back later is a cache hit
 * instead of a multi-second refetch. Fire-and-forget: never awaited, and
 * never competes with the active scene's own load since it only starts
 * after activateScene's own awaits have resolved.
 */
function prefetchOtherScenes(activeId) {
  for (const id of sceneIds()) {
    if (id === activeId) continue;
    for (const videoId of sceneVideoIds(SCENES[id])) prefetchVideo(videoId);
  }
}

let gardenVideoEl = null;

/**
 * Loads a .glb as a THREE.Group via GLTFLoader. mainflower.glb ships
 * uncompressed (no KHR_draco_mesh_compression), so no DRACOLoader is needed.
 */
const gltfLoader = new GLTFLoader();
async function loadGlb(url) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, (gltf) => resolve(gltf), undefined, (err) => reject(err));
  });
}

/**
 * Target bloom diameter (world units, XY) for each terminal flower, chosen so
 * the petal landing spots' maxR (0.38 T1 / 0.46 T2 — see PETAL_LANDING_SPOTS,
 * the radius flights actually land within) sits inside the petals with
 * margin rather than overflowing them. mainflower.glb's own authored scale
 * is normalized out below, so these are the only numbers that matter for
 * sizing.
 */
const TERMINAL_FLOWER_DIAMETER = { T1: 1.05, T2: 1.30 };

/** Extra z-lift so the blooms sit forward of the ground/video plane, toward the camera. */
const TERMINAL_FLOWER_Z_LIFT = 0.35;

/** Cheap dependency-free hash, seeding the value-noise lattice below. */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Smoothed (Perlin-style) value noise, returned in -1..1. Used instead of a
 * plain sine so the petal float reads as organic drift rather than a
 * metronome — every vertex samples a slightly different point on the
 * lattice (via its own position + seed), so neighbouring petals never move
 * in lockstep the way a shared sin(t) would.
 */
function valueNoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (lerp(lerp(a, b, u), lerp(c, d, u), v)) * 2 - 1;
}

/**
 * Current "reaction" intensity per terminal, 0 (calm) up to ~2.4 (just hit).
 * Spikes when a flight touches down or lifts off at that terminal (see
 * triggerFlowerReaction, called from Butterfly's enterParked/enterClimb) and
 * decays back to zero, so the bloom visibly shivers at the moment it's
 * landed on or left, layered on top of its constant ambient drift.
 */
const terminalReaction = { T1: 0, T2: 0 };
const REACTION_DECAY = 1.1; // per second

function triggerFlowerReaction(terminal, strength = 1) {
  terminalReaction[terminal] = Math.min(2.4, (terminalReaction[terminal] ?? 0) + strength);
}

/**
 * Per-mesh state for the petal float, keyed by { posAttr, basePositions,
 * radius, centerX/Y, seed, terminal } — updated once per frame in animate().
 * CPU-side vertex displacement (rather than an onBeforeCompile shader hook)
 * so it works regardless of whether meshes/materials end up shared between
 * the T1/T2 clones, and so it's trivially visible/debuggable without
 * depending on WebGL program-cache behaviour.
 */
const floatingPetalMeshes = [];

/**
 * Registers `mesh` for the gentle per-frame bob: vertices far from the
 * mesh's own bounding-sphere centre (petal tips) drift up and down more than
 * vertices near it (the flower's core) — a cheap stand-in for real
 * cloth/soft-body physics. `basePositions` is a frozen copy of the original
 * buffer so displacement is always computed fresh from the rest pose, never
 * accumulated frame over frame. `terminal` ("T1"/"T2") ties the mesh to
 * terminalReaction so it shivers when its own flights land or depart.
 */
function registerPetalFloat(mesh, seed, terminal) {
  const geometry = mesh.geometry;
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;
  const radius = Math.max(sphere?.radius ?? 1, 0.001);
  const centerX = sphere?.center.x ?? 0;
  const centerY = sphere?.center.y ?? 0;

  const posAttr = geometry.attributes.position;
  floatingPetalMeshes.push({
    posAttr,
    basePositions: Float32Array.from(posAttr.array),
    radius,
    centerX,
    centerY,
    seed,
    terminal
  });
}

/** Advances every registered petal float and decays terminalReaction — called once per frame from animate(). */
function updateTerminalFlowers(dt, elapsed) {
  terminalReaction.T1 = Math.max(0, terminalReaction.T1 - dt * REACTION_DECAY);
  terminalReaction.T2 = Math.max(0, terminalReaction.T2 - dt * REACTION_DECAY);

  for (const f of floatingPetalMeshes) {
    const { posAttr, basePositions, radius, centerX, centerY, seed, terminal } = f;
    const reaction = terminalReaction[terminal] ?? 0;
    const arr = posAttr.array;
    for (let i = 0; i < arr.length; i += 3) {
      const bx = basePositions[i];
      const by = basePositions[i + 1];
      const dx = bx - centerX;
      const dy = by - centerY;
      const reach = clamp(Math.sqrt(dx * dx + dy * dy) / radius, 0, 1) ** 2;

      const ambient = valueNoise2(bx * 1.4 + by * 0.9 + seed, elapsed * 0.35 + seed * 4.1);
      const shiver = valueNoise2(bx * 3.1 - by * 2.4 + seed * 7.3, elapsed * 2.6 + seed * 1.7);
      const wobble = ambient + shiver * reaction * 0.9;

      arr[i + 2] = basePositions[i + 2] + wobble * radius * 0.05 * reach;
    }
    posAttr.needsUpdate = true;
  }
}

/**
 * Scales `object` so its own XY bounding-box diagonal matches `diameter`,
 * then centers and grounds it at world-space (x, y, z) — mirrors the
 * measure-after-scale technique used elsewhere in this file so a model can
 * be placed correctly without hand-tuning its raw authored units.
 */
function placeGroundedFlower(object, x, y, z, diameter) {
  object.position.set(0, 0, 0);
  object.scale.setScalar(1);
  object.updateMatrixWorld(true);

  const rawBox = new THREE.Box3().setFromObject(object);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const scale = diameter / Math.max(rawSize.x, rawSize.y);
  object.scale.setScalar(scale);
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x = x - center.x;
  object.position.y = y - center.y;
  object.position.z = z - box.min.z;
  object.updateMatrixWorld(true);
}

/**
 * Where mainflower.glb is served from — deliberately empty.
 *
 * The upstream comment here used to say the blooms "do not render" because the
 * .glb was missing, and invited pointing this at a copy of it. That is stale,
 * and acting on it is a mistake: the 4K render *is* the garden, and both
 * terminal blooms are already baked into it at exactly the T1/T2 positions
 * this file places geometry at. Setting a URL loads a second set of flowers on
 * top of the painted ones — two blooms per terminal, visibly overlapping.
 *
 * The CMS does still ship mainflower.glb under public/media/flight-garden/
 * (it is left over from the pre-video design, when the garden was assembled
 * from GLBs). Its presence is not a reason to load it.
 *
 * Only set this if a render is ever produced *without* the blooms painted in.
 */
const MAINFLOWER_URL = "";

/** Terminal 1 + Terminal 2 blooms — see the metaphor map at the top of this file. */
function loadTerminalFlowers() {
  if (!MAINFLOWER_URL) {
    // Not a warning: this is the normal, correct path — the blooms come from
    // the render, not from geometry. See MAINFLOWER_URL above.
    return;
  }

  loadGlb(MAINFLOWER_URL)
    .then((gltf) => {
      const t1 = gltf.scene;
      const t2 = gltf.scene.clone(true);

      // t2's meshes share t1's geometry buffers by default (clone(true) copies
      // the reference, not the data) — clone them too so each flower's petal
      // float can mutate its own vertex positions independently.
      t2.traverse((child) => {
        if (child.isMesh) child.geometry = child.geometry.clone();
      });

      [[t1, "T1"], [t2, "T2"]].forEach(([flower, terminal]) => {
        flower.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            registerPetalFloat(child, Math.random() * 100, terminal);
          }
        });
      });

      placeGroundedFlower(t1, TERMINAL_T1.x, TERMINAL_T1.y, TERMINAL_T1.z + TERMINAL_FLOWER_Z_LIFT, TERMINAL_FLOWER_DIAMETER.T1);
      placeGroundedFlower(t2, TERMINAL.x, TERMINAL.y, TERMINAL.z + TERMINAL_FLOWER_Z_LIFT, TERMINAL_FLOWER_DIAMETER.T2);

      scene.add(t1, t2);
    })
    .catch((err) => {
      console.warn("[Flight Garden] mainflower.glb unavailable — terminal blooms stay empty.", err);
    });
}

/* =================================================================
   7B · GARDEN RUNTIME — one plane, any number of renders
   ================================================================= */

/** Torn down whenever the plane is pointed at a different render. */
let disposeGardenVideo = null;

/** The video id currently on screen, so a no-op swap costs nothing. */
let currentVideoId = null;

/**
 * Points the garden plane at `videoId`.
 *
 * Builds the LivingGarden on first call and re-targets it after that, so a
 * scene switch never rebuilds the plane or disturbs anything sitting on it.
 *
 * If the clip will not load — it is not uploaded yet, CORS is misconfigured,
 * R2 is unreachable — this falls back to ART.fallbackVideoId once. That is
 * what lets the weather scene run today against renders that do not exist,
 * instead of showing a black plane. A failure with no fallback left leaves
 * the previous render playing rather than tearing the scene down.
 */
async function setGardenVideo(videoId, { allowFallback = true } = {}) {
  if (videoId === currentVideoId) return true;

  const url = ART.url(videoId);
  let media;

  try {
    media = await loadGardenVideoTexture(url);
  } catch (err) {
    const fallback = ART.fallbackVideoId;
    if (allowFallback && fallback && fallback !== videoId) {
      console.warn(
        `[Flight Garden] render "${videoId}" unavailable at ${url} — falling back to "${fallback}". ` +
        `Upload it to R2 under VIDEO_KEYS["${videoId}"] to use its own art.`,
        err
      );
      return setGardenVideo(fallback, { allowFallback: false });
    }
    console.warn(`[Flight Garden] render "${videoId}" unavailable at ${url}.`, err);
    // CMS: upstream stops here and leaves the plane empty, because in that
    // project a missing render means a misconfigured bucket someone is about to
    // fix. A CMS display is unattended, and R2 is optional here — with the env
    // vars unset /garden-video answers 503 and this is the *normal* path, not a
    // fault. garden.png ships in public/media, so the garden still has a floor
    // to stand on; without this the whole piece renders over a black plane.
    await useStillGardenFallback();
    return false;
  }

  // Swap first, then dispose: releasing the outgoing decoder before the new
  // texture is bound would blank the plane for a frame.
  const previousDispose = disposeGardenVideo;

  if (livingGarden) {
    livingGarden.setMedia(media.texture, media.mediaAspect, media.mediaResolution);
  } else {
    livingGarden = new LivingGarden(media.texture, media.mediaAspect, media.mediaResolution);
  }

  gardenVideoEl = media.video;
  disposeGardenVideo = media.dispose;
  currentVideoId = videoId;

  if (previousDispose) previousDispose();

  resize();
  return true;
}

/* =================================================================
   7C · SCENE RUNTIME — binds a feed to the art
   ================================================================= */

let activeSceneId = null;
let scenePollTimer = null;

/** Last values a scene's apply() returned, for the HUD to render. */
let sceneReadout = {};

/** The band the weather-style art is currently showing. */
let currentBand = null;

/**
 * { kph, tempC } while the weather panel's sliders are driving the scene
 * instead of a live reading, or null when the poll is in charge. Set by the
 * slider `input` handlers, cleared by the Realtime button.
 */
let manualReading = null;

/** Which WEATHER_LOCATIONS id the weather scene's picker is currently on. */
let selectedLocationId = DEFAULT_LOCATION_ID;

/**
 * The handle a scene's `apply()` drives the artwork through. Keeping this
 * behind a small interface is what lets a scene be pure configuration: it
 * never touches the renderer, the texture, or the video element directly.
 */
function sceneContext(scene) {
  return {
    setPlaybackRate(rate) {
      if (gardenVideoEl) gardenVideoEl.playbackRate = rate;
    },

    /**
     * Picks the band `value` falls in and swaps the render if it changed.
     * Returns the band so apply() can hand its label to the HUD.
     */
    selectBand(value) {
      const bands = scene.art.bands ?? [];
      const band = bands.find((b) => value <= b.upTo) ?? bands[bands.length - 1];
      if (!band) return null;

      if (band.id !== currentBand?.id) {
        currentBand = band;
        // Deliberately not awaited: the poll should not stall on a 4K load.
        setGardenVideo(band.id);
      }
      return band;
    },

    /**
     * Rotates the current render's hue to match `value` on art.thermal's
     * anchors, and returns the matching label band for the HUD — the
     * tint-only sibling of selectBand, for a scene with one render instead
     * of one per band.
     */
    setThermalTint(value) {
      const thermal = scene.art.thermal;
      if (!thermal) return null;

      livingGarden?.setHueShift(hueForTemp(value, thermal.anchors));

      const labels = thermal.labels ?? [];
      const band = labels.find((b) => value <= b.upTo) ?? labels[labels.length - 1] ?? null;
      currentBand = band;
      return band;
    },

    /**
     * Sizes the shader's green/red/orange blotches to the counts' shares of
     * the total (see LivingGarden.setAttendanceShares) and returns a label
     * naming which category is largest, for the HUD.
     */
    setAttendanceTint(counts) {
      const { present, absent, late } = counts;
      const total = present + absent + late;
      if (total > 0) {
        livingGarden?.setAttendanceShares(present / total, absent / total);
      }
      const band = labelForAttendance(counts);
      currentBand = band;
      return band;
    }
  };
}

async function pollScene(sceneId) {
  const scene = SCENES[sceneId];
  if (!scene?.data) return;

  // The sliders are in charge: skip the fetch and re-apply their values,
  // so a live reading landing mid-override can't quietly overwrite it.
  if (manualReading) {
    sceneReadout = scene.data.apply(manualReading, sceneContext(scene)) ?? {};
    renderSceneReadout();
    return;
  }

  try {
    const endpoint = scene.data.locationParam
      // CMS: scene endpoints are paths on the Hono flight-simulation router now,
      // resolved through apiUrl() so a display can talk to a remote API origin.
      ? apiUrl(`${scene.data.endpoint}?location=${encodeURIComponent(selectedLocationId)}`)
      : apiUrl(scene.data.endpoint);
    const fetchFn = scene.data.fetch ?? fetchReading;
    const reading = await fetchFn(endpoint);

    // A slow request can land after the user has already switched away.
    if (activeSceneId !== sceneId) return;

    sceneReadout = scene.data.apply(reading, sceneContext(scene)) ?? {};
    renderSceneReadout();
  } catch (err) {
    console.warn(`[Flight Garden] ${scene.name}: live data unavailable — art unchanged.`, err);
  }
}

/**
 * Returns the first poll's promise (rather than firing it and forgetting)
 * so activateScene can await it — the caller decides whether a scene switch
 * should hold its reveal for that first reading or not.
 */
function startScenePolling(sceneId) {
  stopScenePolling();
  const scene = SCENES[sceneId];
  if (!scene?.data) return Promise.resolve();

  const first = pollScene(sceneId);
  scenePollTimer = setInterval(() => pollScene(sceneId), scene.data.pollMs);
  return first;
}

function stopScenePolling() {
  if (scenePollTimer) clearInterval(scenePollTimer);
  scenePollTimer = null;
}

/**
 * Brings a scene up: shows its panels, points the plane at its art, starts
 * its feed, and runs its flight simulation only if it has one.
 */
async function activateScene(sceneId) {
  const scene = SCENES[sceneId];
  if (!scene) {
    console.warn(`[Flight Garden] unknown scene "${sceneId}".`);
    return;
  }

  activeSceneId = sceneId;
  sceneReadout = {};
  currentBand = null;

  // A leftover override from the scene just left shouldn't silently steer
  // this one — each scene starts back on the live feed.
  manualReading = null;
  if (ui.realtimeBtn) ui.realtimeBtn.disabled = true;

  stopScenePolling();
  applyScenePanels(scene);

  // Butterflies belong to the flight scene; anything else starts from a
  // clean garden so a stale flight cannot outlive its own visualization.
  if (scene.flights) {
    loadAirport(ui.select.value || "BLR");
  } else {
    clearAirport();
    clearDetail();
  }

  // "single" art is pinned; "banded" art waits for the first reading to tell
  // it which band to show, so it opens on the middle of the range rather
  // than flashing a clip it is about to replace.
  if (scene.art.mode === "single") {
    await setGardenVideo(scene.art.videoId);

    // A thermal-tinted scene opens unshifted — the render's own native
    // colour — rather than guessing a band. It's an instant no-op default
    // that's always a real, correct-looking frame; startScenePolling below
    // is awaited, so this is what shows for at most one reading's latency,
    // never as a lingering wrong-coloured flash.
    if (scene.art.thermal) livingGarden?.setHueShift(0);
  } else if (scene.art.mode === "banded") {
    const bands = scene.art.bands ?? [];
    const opening = bands[Math.floor(bands.length / 2)];
    if (opening) {
      currentBand = opening;
      await setGardenVideo(opening.id);
    }
  }

  // Only the attendance scene uses the shader's three-colour blend; every
  // other scene falls back to uHueShift (or none) as before.
  livingGarden?.setAttendanceMix(sceneId === "attendance");

  // Awaited so a scene switch's veil stays down until the art is not just
  // loaded but correctly coloured/paced — otherwise the reveal exposes a
  // half-second window of the wrong hue (or, before this, the outgoing
  // scene's own video still playing underneath).
  await startScenePolling(sceneId);

  // Deliberately not awaited: this scene is already up, so warming the
  // *other* one's video happens quietly in the background and must never
  // delay the veil lifting on this one.
  prefetchOtherScenes(sceneId);
}

/**
 * Brings up the first scene. Called from BOOT rather than here: activateScene
 * reads `ui`, a const declared further down the file, so running it during
 * module evaluation would hit its temporal dead zone.
 *
 * If the video cannot load at all the rest of the piece keeps rendering —
 * every other layer is independent of the plane.
 */
async function loadGarden() {
  await activateScene(DEFAULT_SCENE);
}

loadTerminalFlowers();

/* =================================================================
   8 · FLIGHT PATHS
   No fixed corridors or holding stack — each flight just draws a
   gentle curve from a random point on the cube's edge to (or from) a
   random landing spot on its terminal flower, on the fly.
   ================================================================= */

/** A random point along the cube's inner edge, where flights enter/exit view. */
function randomEdgePoint(z = ALT.cruise) {
  const side = randInt(0, 3);
  const t = rand(-1, 1);
  switch (side) {
    case 0: return new THREE.Vector3(-GARDEN.edgeX, t * GARDEN.edgeY, z);
    case 1: return new THREE.Vector3(GARDEN.edgeX, t * GARDEN.edgeY, z);
    case 2: return new THREE.Vector3(t * GARDEN.edgeX, -GARDEN.edgeY, z);
    default: return new THREE.Vector3(t * GARDEN.edgeX, GARDEN.edgeY, z);
  }
}

/**
 * Fixed landing spots, one per petal, rather than any random point on the
 * bloom — flights land on an actual petal, like a real terminal's gates.
 * T1 (domestic pier) gets fewer petals than T2 (hero, international).
 */
// Together these must exceed MAX_BUTTERFLIES, or a busy bloom runs out of
// perches and flights start doubling up (see claimLandingSpot).
const PETAL_LANDING_COUNT = { T1: 6, T2: 9 };

// Perches sit in a band across the bloom rather than on one ring: as a
// fraction of maxR, inner keeps them off the flower's core, outer keeps them
// off the rim. A band gives the sunflower placement below two dimensions to
// spread across, so spots stay far apart without crowding a single circle.
const PETAL_LANDING_BAND = {
  T1: { inner: 0.50, outer: 1.00 },
  T2: { inner: 0.50, outer: 1.00 }
};

// These are dimensioned against the butterfly itself. At its largest a parked
// one spans 0.30 × 0.48 × BUTTERFLY_SCALE × 1.08 ≈ 0.183 world units, and the
// counts and band above put the closest pair of perches ~0.21 apart. Jitter
// displaces two neighbours by at most 2·j·√2 ≈ 0.023 toward each other, which
// leaves ~0.19 — still clear of a wingspan. Raising the jitter or the counts
// without redoing that arithmetic is what puts wings back on top of wings.
const PETAL_LANDING_JITTER = 0.008;   // per-landing wobble, breaks up the lattice
const PETAL_SHARE_OFFSET = 0.062;     // step aside when a perch is already taken
const PETAL_SHARE_LIFT = 0.004;       // and sit a hair higher, so no z-fighting

/**
 * Per-group nudge, independent of the flower's own position (TERMINAL_T1 /
 * TERMINAL) — x moves that petal ring left(-)/right(+), y moves it
 * down(-)/up(+), without touching the flower model itself.
 */
const PETAL_LANDING_OFFSET = {
  T1: { x: -0.2, y: 0.2 },
  T2: { x: 0.2, y: 0.3 }
};

/** ~137.5°, the angle between consecutive florets in a real sunflower head. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Perches laid out the way a flower head actually packs its florets: step the
 * golden angle each time and push the radius out as sqrt(i), which is what
 * keeps real seed heads evenly dense from core to rim.
 *
 * The point here is that no two perches line up. Stepping by a whole fraction
 * of a turn — as an evenly divided ring does — puts every spot on a spoke, and
 * a dozen butterflies sitting on spokes reads as a clock face, not a garden.
 * The golden angle never repeats, so the arrangement looks scattered while
 * still being near-perfectly spaced.
 */
const PETAL_LANDING_SPOTS = (() => {
  const maxR = { T1: 0.38, T2: 0.46 };
  const spots = {};
  for (const terminal of ["T1", "T2"]) {
    const center = terminal === "T1" ? TERMINAL_T1 : TERMINAL;
    const offset = PETAL_LANDING_OFFSET[terminal];
    const count = PETAL_LANDING_COUNT[terminal];
    const band = PETAL_LANDING_BAND[terminal];
    // Phase the two blooms differently so they aren't mirror images.
    const phase = terminal === "T1" ? 0.7 : 2.1;

    spots[terminal] = Array.from({ length: count }, (_, i) => {
      const t = Math.sqrt((i + 0.5) / count);          // even areal density
      const r = maxR[terminal] * lerp(band.inner, band.outer, t);
      const angle = i * GOLDEN_ANGLE + phase;
      return new THREE.Vector3(
        center.x + offset.x + Math.cos(angle) * r,
        center.y + offset.y + Math.sin(angle) * r,
        ALT.ground
      );
    });
  }
  return spots;
})();

/**
 * How many butterflies are on each perch. A count rather than a flag: when a
 * bloom is completely full the extras have to go somewhere, and knowing how
 * many are already there is what lets claimLandingSpot fan them out instead
 * of dropping them on top of each other.
 */
const petalOccupied = {
  T1: new Array(PETAL_LANDING_COUNT.T1).fill(0),
  T2: new Array(PETAL_LANDING_COUNT.T2).fill(0)
};

/**
 * Claims the emptiest perch on `terminal`, breaking ties at random so a busy
 * bloom fills out evenly instead of always loading the low indices first.
 *
 * Every landing gets a small random wobble, so a butterfly returning to a
 * perch another one used earlier doesn't land on the exact same pixel — the
 * arrangement stays alive across the whole simulation rather than snapping
 * back to a fixed lattice.
 *
 * If the bloom is genuinely full — more domestic arrivals than T1 has perches
 * — the newcomer steps aside by PETAL_SHARE_OFFSET at the golden angle and
 * sits a hair higher, so it perches *beside* the occupant. Two butterflies
 * sharing a crowded petal looks like a real flower; two occupying identical
 * coordinates looks like a bug.
 */
function claimLandingSpot(terminal) {
  const occ = petalOccupied[terminal];

  let min = Infinity;
  for (let i = 0; i < occ.length; i++) if (occ[i] < min) min = occ[i];
  const tied = [];
  for (let i = 0; i < occ.length; i++) if (occ[i] === min) tied.push(i);

  const index = pick(tied);
  const share = occ[index];
  occ[index] += 1;

  const position = PETAL_LANDING_SPOTS[terminal][index].clone();

  if (share > 0) {
    const a = share * GOLDEN_ANGLE;
    position.x += Math.cos(a) * PETAL_SHARE_OFFSET;
    position.y += Math.sin(a) * PETAL_SHARE_OFFSET;
    position.z += share * PETAL_SHARE_LIFT;
  }

  position.x += rand(-PETAL_LANDING_JITTER, PETAL_LANDING_JITTER);
  position.y += rand(-PETAL_LANDING_JITTER, PETAL_LANDING_JITTER);

  return { index, position };
}

/** Frees a previously claimed perch so another flight can land on it. */
function releaseLandingSpot(terminal, index) {
  if (index == null) return;
  const occ = petalOccupied[terminal];
  occ[index] = Math.max(0, occ[index] - 1);
}

/**
 * Gentle cubic-Bézier path between two points, whichever direction — the
 * midpoint control points just interpolate altitude smoothly between the
 * two ends, so the same helper covers both arrivals (cruise → ground) and
 * departures (ground → cruise).
 */
function flightCurve(from, to) {
  const c1 = from.clone().lerp(to, 0.33);
  c1.z = lerp(from.z, to.z, 0.45);
  const c2 = from.clone().lerp(to, 0.66);
  c2.z = lerp(from.z, to.z, 0.85);
  return new THREE.CubicBezierCurve3(from.clone(), c1, c2, to.clone());
}

/* =================================================================
   9 · TERMINAL ROUTING + LANDING PULSE
   No fixed gates — a flight just picks a terminal (domestic vs
   international, mirroring BLR's real split) and lands at a random
   spot on that flower. The pulse ring is a generic "the garden
   noticed" flourish, reused for both touchdown and takeoff.
   ================================================================= */

/** Indian domestic sectors — everything else routes through the T2 (hero) pier. */
let DOMESTIC_CODES = new Set(["BLR", "DEL", "BOM", "MAA", "HYD", "CCU", "GOI"]);

/** Which flower a flight belongs on, mirroring BLR's real domestic/international split. */
function routeTerminal(flight) {
  const other = flight.kind === "arrival" ? flight.origin : flight.destination;
  return DOMESTIC_CODES.has(other) ? "T1" : "T2";
}

/* ---------------- pooled expanding pulse rings ---------------- */

const pulseLayer = new THREE.Group();
scene.add(pulseLayer);

const WHITE = new THREE.Color(0xffffff);
const _landColor = new THREE.Color();

const PULSE_MAX = 6;
const pulseRings = [];

function buildPulseRings() {
  const geo = new THREE.RingGeometry(0.055, 0.072, 44);
  for (let i = 0; i < PULSE_MAX; i++) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    }));
    mesh.visible = false;
    mesh.renderOrder = 4;
    pulseLayer.add(mesh);
    pulseRings.push({ mesh, life: 0 });
  }
}

let pulseCursor = 0;

function spawnPulse(position, color) {
  // reuse the deadest ring rather than allocating
  let slot = pulseRings.find((p) => p.life <= 0);
  if (!slot) { slot = pulseRings[pulseCursor]; pulseCursor = (pulseCursor + 1) % PULSE_MAX; }

  slot.life = 1;
  slot.mesh.position.copy(position);
  slot.mesh.material.color.copy(color);
  slot.mesh.visible = true;
}

function updatePulses(dt, master) {
  for (const p of pulseRings) {
    if (p.life <= 0) continue;

    p.life -= dt * 1.5;
    if (p.life <= 0) { p.mesh.visible = false; p.life = 0; continue; }

    const t = 1 - p.life;                       // 0 → 1 as it expands
    p.mesh.scale.setScalar(1 + t * 4.2);
    p.mesh.material.opacity = Math.pow(p.life, 1.4) * 0.55 * master;
  }
}

/* =================================================================
   10 · ZONE LABELS (projected DOM — crisp type, no texture atlas)
   ================================================================= */

// CMS: labelLayer now comes from buildDom() at the top of the factory.

const ZONES = [
  { kind: "terminal", name: "Terminal 1", note: "Domestic", pos: new THREE.Vector3(TERMINAL_T1.x, TERMINAL_T1.y + 0.72, ALT.ground) },
  { kind: "terminal", name: "Terminal 2", note: "Garden Terminal", pos: new THREE.Vector3(TERMINAL.x, TERMINAL.y + 0.72, ALT.ground) }
];

function buildZoneLabels() {
  for (const zone of ZONES) {
    const el = document.createElement("div");
    el.className = "zone-label";
    el.dataset.kind = zone.kind;
    el.innerHTML =
      `<span class="zl-name">${zone.name}</span>` +
      `<span class="zl-note">${zone.note}</span>`;
    labelLayer.appendChild(el);
    zone.el = el;
  }
}

const _proj = new THREE.Vector3();

/** Cached label half-widths; invalidated on resize (breakpoints change type size). */
let labelMetricsDirty = true;

function projectLabel(el, worldPos, visible) {
  if (!visible) { el.style.opacity = "0"; return; }

  _proj.copy(worldPos).project(camera);
  if (_proj.z > 1) { el.style.opacity = "0"; return; }

  const vw = canvas.clientWidth;
  const vh = canvas.clientHeight;

  if (labelMetricsDirty || el._halfWidth === undefined) el._halfWidth = el.offsetWidth / 2;

  // Captions name regions, not points, so keep them fully on screen rather than
  // letting a portrait crop slice "Arrival Meadow" in half at the edge.
  const marginX = el._halfWidth + 10;
  const x = clamp((_proj.x * 0.5 + 0.5) * vw, marginX, vw - marginX);
  const y = clamp((-_proj.y * 0.5 + 0.5) * vh, 18, vh - 18);

  el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  el.style.opacity = "1";
}

/**
 * The title card names the metaphor first; the in-world captions take over once
 * it has faded. Revealing both at once stacks three layers of type on the same
 * pixels — the one thing this piece cannot afford.
 */
// CMS: the option wins when set, so a display can force full motion (or damp
// it) regardless of the OS setting; otherwise honour the viewer's preference.
const REDUCED_MOTION =
  options.reducedMotion ??
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
const ZONE_REVEAL_AT = REDUCED_MOTION ? 0.2 : 4.2;

function updateLabels() {
  // Terminal captions name the flight scene's blooms — they mean nothing in
  // any other visualization.
  const show = !!SCENES[activeSceneId]?.flights && introTime > ZONE_REVEAL_AT;
  for (const zone of ZONES) projectLabel(zone.el, zone.pos, show);
  labelMetricsDirty = false;
}

buildPulseRings();
buildZoneLabels();

/* =================================================================
   11 · AMBIENT MOTES — pollen + fireflies (GPU-driven)
   Slow, weightless drift. This is the "alive" layer that plays
   even when the airport is quiet.
   ================================================================= */

const MOTE_COUNT = 900;
const FIREFLY_SHARE = 0.22;

/**
 * Drift, wrap and twinkle all happen in the vertex shader, so this layer costs
 * one uniform write per frame no matter how many motes there are. The old CPU
 * loop rewrote a 520-element position buffer every frame for the same effect.
 */
const MOTE_VERT = /* glsl */`
  attribute float aSeed;
  attribute float aKind;      // 0 = pollen, 1 = firefly
  attribute vec2  aDrift;

  uniform float uTime;
  uniform float uScale;       // drawing-buffer height * 0.5 (size attenuation)
  uniform float uBoundY;

  varying vec3  vColor;
  varying float vAlpha;

  void main(){
    vec3 p = position;

    // sideways sway is bounded, so only the rise needs wrapping
    p.x += sin(uTime * 0.28 + aSeed * 6.2) * 0.09 + aDrift.x;
    p.y  = mod(p.y + aDrift.y * uTime + uBoundY, 2.0 * uBoundY) - uBoundY;
    p.z += sin(uTime * 0.42 + aSeed * 3.1) * 0.04;

    float firefly = step(0.5, aKind);

    // fireflies blink; pollen simply shimmers
    float s = sin(uTime * (0.9 + aSeed * 0.8) + aSeed * 20.0);
    float blink = pow(max(s, 0.0), 5.0);
    float shimmer = 0.35 + 0.30 * sin(uTime * 0.7 + aSeed * 12.0);

    vAlpha = mix(shimmer, blink, firefly);
    vColor = mix(
      mix(vec3(1.0, 0.85, 0.62), vec3(0.62, 0.90, 1.0), step(0.75, aSeed)), // pollen, gold-biased
      vec3(1.0, 0.88, 0.55),                                                // firefly, warm gold
      firefly
    );

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = mix(0.065, 0.115, firefly) * (uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const MOTE_FRAG = /* glsl */`
  precision mediump float;

  uniform float uMaster;
  varying vec3  vColor;
  varying float vAlpha;

  void main(){
    // procedural radial falloff — no texture fetch, no atlas
    float d = length(gl_PointCoord - 0.5);
    float a = pow(smoothstep(0.5, 0.0, d), 2.2) * vAlpha * uMaster;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

const motes = (() => {
  const positions = new Float32Array(MOTE_COUNT * 3);
  const seeds = new Float32Array(MOTE_COUNT);
  const kinds = new Float32Array(MOTE_COUNT);
  const drift = new Float32Array(MOTE_COUNT * 2);

  // a share of the field clusters near the flower instead of scattering
  // uniformly — the "tiny golden dust motes near the garden centre" the
  // living-garden brief asks for, reusing this pooled system rather than
  // standing up a second particle system.
  const TERMINAL_MOTE_SHARE = 0.22;
  const terminalCount = Math.round(MOTE_COUNT * TERMINAL_MOTE_SHARE);

  for (let i = 0; i < MOTE_COUNT; i++) {
    const nearTerminal = i < terminalCount;

    if (nearTerminal) {
      const a = rand(0, Math.PI * 2);
      const r = Math.pow(Math.random(), 0.5) * 0.62;   // denser toward the centre
      positions[i * 3 + 0] = TERMINAL.x + Math.cos(a) * r;
      positions[i * 3 + 1] = TERMINAL.y + Math.sin(a) * r;
      positions[i * 3 + 2] = rand(0.10, 1.55);
    } else {
      // keep the sway inside the frame's inner opening, but now spanning
      // the cube's full height (floor to just under the rim) instead of a
      // shallow slice, so the field reads as filling the whole volume
      positions[i * 3 + 0] = rand(-GARDEN.innerX + 0.12, GARDEN.innerX - 0.12);
      positions[i * 3 + 1] = rand(-GARDEN.innerY, GARDEN.innerY);
      positions[i * 3 + 2] = rand(0.05, 1.65);
    }

    // seeds below 0.6 read as the warm/gold pollen colour in MOTE_VERT, so
    // pinning the terminal cluster below that keeps it reliably golden
    seeds[i] = nearTerminal ? rand(0, 0.55) : Math.random();
    kinds[i] = nearTerminal ? 0 : (Math.random() < FIREFLY_SHARE ? 1 : 0);

    drift[i * 2 + 0] = rand(-0.05, 0.05);
    drift[i * 2 + 1] = kinds[i] ? rand(0.006, 0.022) : rand(0.014, 0.065);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
  geo.setAttribute("aDrift", new THREE.BufferAttribute(drift, 2));

  const mat = new THREE.ShaderMaterial({
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uMaster: { value: 0 },
      uScale: { value: 450 },
      uBoundY: { value: GARDEN.innerY }
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);

  return { points, geo, mat };
})();

function updateMotes(elapsed, master) {
  motes.mat.uniforms.uTime.value = elapsed;
  motes.mat.uniforms.uMaster.value = 0.78 * master;
}

/* =================================================================
   11B · GRASS DUST FILL — a dense field of grass-toned specks laid
   over the foliage so the cube's interior reads as a rushing, packed
   point cloud rather than a flat carpet. Sits above the grass in the
   depth buffer (like the motes) so density is never lost to occlusion,
   and steers clear of both terminal blooms so the flowers stay clean.
   ================================================================= */

const GRASS_DUST_COUNT = 6000;

const GRASS_DUST_VERT = /* glsl */`
  attribute float aSeed;
  attribute float aSize;

  uniform float uTime;
  uniform float uScale;

  varying vec3  vColor;
  varying float vAlpha;

  void main(){
    vec3 p = position;

    // small wind-sway — enough to read as "alive," never enough to
    // break the illusion of a packed, static-ish scatter
    p.x += sin(uTime * 0.55 + aSeed * 8.3) * 0.012;
    p.y += cos(uTime * 0.47 + aSeed * 6.1) * 0.012;

    // brisk shimmer per-speck gives the "rushing" flicker of light off
    // a dense point cloud, independent of the slower sway above
    float shimmer = 0.5 + 0.5 * sin(uTime * (1.4 + aSeed * 2.2) + aSeed * 40.0);
    vAlpha = mix(0.45, 1.0, shimmer);

    vec3 deep      = vec3(0.045, 0.16, 0.045);
    vec3 mid       = vec3(0.14, 0.38, 0.09);
    vec3 highlight = vec3(0.56, 0.74, 0.24);
    vec3 col = mix(deep, mid, smoothstep(0.0, 0.6, aSeed));
    col = mix(col, highlight, smoothstep(0.65, 1.0, aSeed));
    vColor = col;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * (uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const GRASS_DUST_FRAG = /* glsl */`
  precision mediump float;

  uniform float uMaster;
  varying vec3  vColor;
  varying float vAlpha;

  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vAlpha * uMaster * 0.85;
    gl_FragColor = vec4(vColor, a);
  }
`;

const grassDust = (() => {
  const positions = new Float32Array(GRASS_DUST_COUNT * 3);
  const seeds = new Float32Array(GRASS_DUST_COUNT);
  const sizes = new Float32Array(GRASS_DUST_COUNT);

  const terminals = [TERMINAL, TERMINAL_T1];
  const exclusionRadius = 0.85;

  let i = 0;
  let guard = 0;
  while (i < GRASS_DUST_COUNT && guard < GRASS_DUST_COUNT * 8) {
    guard++;
    const x = rand(-GARDEN.innerX + 0.08, GARDEN.innerX - 0.08);
    const y = rand(-GARDEN.innerY + 0.08, GARDEN.innerY - 0.08);
    const tooCloseToBloom = terminals.some((t) => Math.hypot(x - t.x, y - t.y) < exclusionRadius);
    if (tooCloseToBloom) continue;

    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = rand(0.06, 0.30);
    seeds[i] = Math.random();
    sizes[i] = rand(0.010, 0.026);
    i++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geo.setDrawRange(0, i);

  const mat = new THREE.ShaderMaterial({
    vertexShader: GRASS_DUST_VERT,
    fragmentShader: GRASS_DUST_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uMaster: { value: 0 },
      uScale: { value: 450 }
    },
    transparent: true,
    depthWrite: false,
    depthTest: false
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  scene.add(points);

  return { points, geo, mat };
})();

function updateGrassDust(elapsed, master) {
  grassDust.mat.uniforms.uTime.value = elapsed;
  grassDust.mat.uniforms.uMaster.value = master;
}

/* =================================================================
   12 · SPARKLE FIELD (pooled)
   Fires on touchdown and on rotation — the little "puff" that sells
   contact with a flower.
   ================================================================= */

const SPARKLE_MAX = 320;

const sparkles = (() => {
  const positions = new Float32Array(SPARKLE_MAX * 3);
  const colors = new Float32Array(SPARKLE_MAX * 3);
  const base = new Float32Array(SPARKLE_MAX * 3);
  const vel = new Float32Array(SPARKLE_MAX * 3);
  const life = new Float32Array(SPARKLE_MAX);
  const maxLife = new Float32Array(SPARKLE_MAX);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    map: GLOW_TEX,
    size: 0.055,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  scene.add(points);

  let cursor = 0;

  return {
    geo, mat, points, positions, colors, base, vel, life, maxLife,
    next() { const i = cursor; cursor = (cursor + 1) % SPARKLE_MAX; return i; }
  };
})();

function emitSparkles(position, color, count = 14, spread = 0.10, speed = 0.28) {
  for (let n = 0; n < count; n++) {
    const i = sparkles.next();
    const ix = i * 3;

    sparkles.positions[ix + 0] = position.x + rand(-spread, spread);
    sparkles.positions[ix + 1] = position.y + rand(-spread, spread);
    sparkles.positions[ix + 2] = position.z + rand(-0.02, 0.06);

    const a = rand(0, Math.PI * 2);
    const s = rand(0.25, 1) * speed;
    sparkles.vel[ix + 0] = Math.cos(a) * s;
    sparkles.vel[ix + 1] = Math.sin(a) * s + 0.12;
    sparkles.vel[ix + 2] = rand(0.02, 0.14);

    sparkles.base[ix + 0] = color.r;
    sparkles.base[ix + 1] = color.g;
    sparkles.base[ix + 2] = color.b;

    sparkles.maxLife[i] = rand(0.5, 1.1);
    sparkles.life[i] = sparkles.maxLife[i];
  }
}

function updateSparkles(dt, master) {
  const { positions, colors, base, vel, life, maxLife } = sparkles;

  for (let i = 0; i < SPARKLE_MAX; i++) {
    if (life[i] <= 0) continue;
    const ix = i * 3;

    life[i] -= dt;
    if (life[i] <= 0) {
      colors[ix] = colors[ix + 1] = colors[ix + 2] = 0;  // additive black = gone
      continue;
    }

    positions[ix + 0] += vel[ix + 0] * dt;
    positions[ix + 1] += vel[ix + 1] * dt;
    positions[ix + 2] += vel[ix + 2] * dt;

    vel[ix + 0] *= 0.94;
    vel[ix + 1] *= 0.94;
    vel[ix + 2] *= 0.94;

    const k = (life[i] / maxLife[i]) ** 1.6 * master;
    colors[ix + 0] = base[ix + 0] * k;
    colors[ix + 1] = base[ix + 1] * k;
    colors[ix + 2] = base[ix + 2] * k;
  }

  sparkles.geo.attributes.position.needsUpdate = true;
  sparkles.geo.attributes.color.needsUpdate = true;
}

/* =================================================================
   13 · TRAIL RIBBON
   A tapered, additive ribbon of recent positions. Because the
   blending is additive, fading the vertex colour to black *is*
   fading to transparent — no per-vertex alpha needed.
   ================================================================= */

const TRAIL_POINTS = 52;

/**
 * Trail palettes. The head is always the brighter, cooler end — that is the
 * cue that tells you which way a flight is travelling without reading a label.
 */
const TRAIL_STYLE = {
  inbound: { head: "#5ad2ff", tail: "#1030c8", width: 1.00, gain: 0.90 },
  final: { head: "#7ee0ff", tail: "#1642dc", width: 0.90, gain: 0.90 },
  holding: { head: "#8fc8ff", tail: "#2a4f9e", width: 0.62, gain: 0.46 },
  boarding: { head: "#ffd79a", tail: "#e07a20", width: 0.70, gain: 0.50 },
  climb: { head: "#6cc4ff", tail: "#ff9d38", width: 1.00, gain: 1.00 },
  gone: { head: "#6cc4ff", tail: "#ff9d38", width: 1.00, gain: 1.00 }
};

/**
 * A luminous silk ribbon. Three vertices per sample — a bright core flanked by
 * two dark edges — so additive blending produces a soft-shouldered band of
 * light rather than the flat strip a two-vertex ribbon gives you.
 */
class TrailRibbon {
  constructor() {
    this.points = [];
    this.baseWidth = 0.014;
    this.widthScale = 1;
    this.gain = 1;
    this.intensity = 0;

    this.head = new THREE.Color("#d3f4ff");
    this.tail = new THREE.Color("#1746e0");
    this._c = new THREE.Color();

    const verts = TRAIL_POINTS * 3;
    this.positions = new Float32Array(verts * 3);
    this.colors = new Float32Array(verts * 3);

    // two quads per segment: left→core and core→right
    const indices = new Uint16Array((TRAIL_POINTS - 1) * 12);
    for (let i = 0; i < TRAIL_POINTS - 1; i++) {
      const a = i * 3;
      const b = a + 3;
      indices.set([
        a, a + 1, b, a + 1, b + 1, b,        // left half
        a + 1, a + 2, b + 1, a + 2, b + 2, b + 1 // right half
      ], i * 12);
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.geo.setIndex(new THREE.BufferAttribute(indices, 1));

    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this._perp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._smoothPoints = Array.from(
      { length: TRAIL_POINTS },
      () => new THREE.Vector3()
    );
  }

  /** Re-tint the ribbon for a flight state, blending the livery into the tail. */
  setStyle(state, liveryColor) {
    const s = TRAIL_STYLE[state];
    if (!s) return;

    this.head.set(s.head);
    this.tail.set(s.tail).lerp(liveryColor, 0.30);
    this.widthScale = s.width;
    this.gain = s.gain;
  }

  /** `emit` false lets an idle (parked) trail drain away gracefully. */
  update(position, emit, master) {
    const pts = this.points;

    if (emit) {
      if (!pts.length || pts[0].distanceToSquared(position) > 0.0004) {
        pts.unshift(position.clone());
      } else {
        pts[0].copy(position);
      }
      while (pts.length > TRAIL_POINTS) pts.pop();
      this.intensity = Math.min(1, this.intensity + 0.05);
    } else {
      if (pts.length) pts.pop();
      this.intensity = Math.max(0, this.intensity - 0.03);
    }

    if (pts.length < 3 || this.intensity <= 0.001) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = false; // trails disabled — butterflies fly clean
    return;

    const n = pts.length;
    const width = this.baseWidth * this.widthScale;

    // Round the raw position history before building the ribbon. A compact
    // 1-2-1 filter removes the ruler-like joints while retaining the
    // butterfly's actual turns and loops.
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const j = Math.min(i, n - 1);
      const before = pts[Math.max(0, j - 1)];
      const current = pts[j];
      const after = pts[Math.min(j + 1, n - 1)];
      this._smoothPoints[i]
        .copy(current)
        .multiplyScalar(0.5)
        .addScaledVector(before, 0.25)
        .addScaledVector(after, 0.25);
    }

    for (let i = 0; i < TRAIL_POINTS; i++) {
      const p = this._smoothPoints[i];
      const prev = this._smoothPoints[Math.max(0, i - 1)];
      const next = this._smoothPoints[Math.min(i + 1, TRAIL_POINTS - 1)];

      this._dir.subVectors(next, prev);
      if (this._dir.lengthSq() < 1e-8) this._dir.set(1, 0, 0);
      this._perp.set(-this._dir.y, this._dir.x, 0).normalize();

      const life = i / (TRAIL_POINTS - 1);

      // taper: narrow at the butterfly, swelling just behind it, gone at the tail
      const w = width * Math.pow(1 - life, 0.70) * (i === 0 ? 0.45 : 1);
      const fade = Math.pow(1 - life, 1.85) * this.intensity * this.gain * 0.84 * master;

      // turn blue fast: the near-white head must be a glint, not the whole ribbon
      this._c.copy(this.head).lerp(this.tail, Math.pow(life, 0.40));

      const ix = i * 9;
      // left edge · bright core · right edge
      this.positions[ix + 0] = p.x + this._perp.x * w;
      this.positions[ix + 1] = p.y + this._perp.y * w;
      this.positions[ix + 2] = p.z;
      this.positions[ix + 3] = p.x;
      this.positions[ix + 4] = p.y;
      this.positions[ix + 5] = p.z;
      this.positions[ix + 6] = p.x - this._perp.x * w;
      this.positions[ix + 7] = p.y - this._perp.y * w;
      this.positions[ix + 8] = p.z;

      const edge = fade * 0.10;
      const core = fade;

      this.colors[ix + 0] = this._c.r * edge;
      this.colors[ix + 1] = this._c.g * edge;
      this.colors[ix + 2] = this._c.b * edge;
      this.colors[ix + 3] = this._c.r * core;
      this.colors[ix + 4] = this._c.g * core;
      this.colors[ix + 5] = this._c.b * core;
      this.colors[ix + 6] = this._c.r * edge;
      this.colors[ix + 7] = this._c.g * edge;
      this.colors[ix + 8] = this._c.b * edge;
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  dispose() {
    scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
    this.points.length = 0;
  }
}

/* =================================================================
   14 · FLIGHT MODEL
   ================================================================= */

let flightSeq = 0;

/**
 * `airlineCode` pins the carrier — a parked aircraft keeps its livery when it
 * turns around into a departure, so the flight number must match it too.
 * `terminal` ("T1"/"T2"), when given, biases the route to a city on that
 * pier — used so a flight seeded straight onto a flower matches its pier.
 */
/**
 * CMS: flight board supplied by the API (GET /api/flight-simulation/flights).
 * The simulation *draws names from* this queue — motion, timing and gate
 * assignment stay local, because those are the visualization, not the data.
 * When the queue is empty (API down, empty response, or simply drained) the
 * original local generation takes over, so the garden never stalls.
 */
let roster = [];

function setRosterQueue(flights) {
  roster = Array.isArray(flights) ? flights.slice() : [];
}

/**
 * Pulls the next roster entry that fits this slot, preferring one already on
 * the right pier so a domestic sector doesn't taxi to the international petals.
 * Entries referencing an airline or route the current catalog doesn't know are
 * discarded rather than rendered with a missing livery.
 */
function takeRosterFlight(airportCode, terminal) {
  if (!roster.length) return null;

  const usable = (f) =>
    f && AIRLINES[f.airline] &&
    (f.origin === airportCode || f.destination === airportCode);

  let index = roster.findIndex((f) => usable(f) && (!terminal || f.terminal === terminal));
  if (index === -1) index = roster.findIndex(usable);
  if (index === -1) { roster.length = 0; return null; }

  return roster.splice(index, 1)[0];
}

function makeFlight(kind, airportCode, airlineCode, terminal) {
  // CMS: prefer a real board entry; fall back to local generation below.
  const booked = airlineCode ? null : takeRosterFlight(airportCode, terminal);

  if (booked) {
    const spec = AIRLINES[booked.airline];
    const other = booked.origin === airportCode ? booked.destination : booked.origin;
    flightSeq++;

    return {
      airline: {
        code: booked.airline,
        name: spec.name,
        color: spec.color,
        threeColor: new THREE.Color(spec.color)
      },
      // The board carries "6E2431"; the HUD renders code and number apart.
      number: Number(booked.flightNumber.slice(booked.airline.length)) || 0,
      id: `${booked.airline} ${booked.flightNumber.slice(booked.airline.length)}`,
      // `kind` is the simulation's need (a free gate wants an arrival), which
      // outranks the board's own direction — the butterfly must fly the leg the
      // scene has room for.
      kind,
      origin: kind === "arrival" ? other : airportCode,
      destination: kind === "arrival" ? airportCode : other,
      uid: flightSeq
    };
  }

  const code = airlineCode ?? pick(AIRLINE_CODES);
  const spec = AIRLINES[code];
  const airport = AIRPORTS[airportCode];

  let pool = airport.routes;
  if (terminal) {
    const onPier = airport.routes.filter((c) => DOMESTIC_CODES.has(c) === (terminal === "T1"));
    if (onPier.length) pool = onPier;
  }
  const other = pick(pool);

  flightSeq++;

  const number = randInt(spec.range[0], spec.range[1]);

  return {
    airline: {
      code,
      name: spec.name,
      color: spec.color,
      threeColor: new THREE.Color(spec.color)
    },
    number,
    id: `${code} ${number}`,
    kind,                                     // "arrival" | "departure"
    origin: kind === "arrival" ? other : airportCode,
    destination: kind === "arrival" ? airportCode : other,
    uid: flightSeq
  };
}

const routeText = (f) => `${f.origin} → ${f.destination}`;
const routeLong = (f) => `${CITIES[f.origin] ?? f.origin} → ${CITIES[f.destination] ?? f.destination}`;

/* =================================================================
   15 · BUTTERFLY — a flight with wings
   States: inbound → parked → boarding → climb → gone
   ================================================================= */

const butterflies = [];

class Butterfly {
  constructor(flight, terminal, opts = {}) {
    this.flight = flight;
    this.airline = flight.airline;
    this.terminal = terminal;

    this.position = new THREE.Vector3();
    this.heading = 0;
    this.restHeading = rand(0, Math.PI * 2);
    this.bank = 0;
    this.speed = 0;
    this.dead = false;
    this.opacity = 0;
    this.highlight = 0;

    // personality — small variances so no two flights read identically
    this.flutter = rand(0.85, 1.25);
    // Real butterflies are not all one size. Kept narrow: enough to break up
    // a row of identical silhouettes, not enough to read as depth or to make
    // one flight look more important than another.
    this.sizeVariation = rand(0.92, 1.08);
    this.wanderSeed = rand(0, Math.PI * 2);
    this.wanderAmp = rand(0.012, 0.030);
    this.lane = rand(-0.09, 0.09);   // lateral offset so flight paths spread apart
    this.weaveAmp = rand(0.035, 0.070);
    this.weaveTurns = rand(2.2, 3.6);

    // wing character: a unique speckle field, and how much livery shows through
    this.seed = Math.random();
    this.tint = rand(0.85, 1.0);
    this._styledState = null;

    this.curve = null;
    this.curveLen = 1;
    this.u = 0;

    this.landingIndex = null;
    this.landingSpot = null;
    this.claimLanding(terminal);
    this.dwellTimer = 0;
    this.boardTimer = 0;
    this.dustTimer = rand(0, 0.15);

    this._tangent = new THREE.Vector3(1, 0, 0);
    this._prevAngle = 0;
    this._tmp = new THREE.Vector3();

    this.buildMesh();
    this.trail = new TrailRibbon();

    if (opts.spawnParked) this.enterParked(true);
    else if (flight.kind === "arrival") this.enterInbound();
    else this.enterBoarding();
  }

  /* ---------------- construction ---------------- */

  /** Releases any petal this butterfly currently holds, then claims a fresh one on `terminal`. */
  claimLanding(terminal) {
    releaseLandingSpot(this.terminal, this.landingIndex);
    const { index, position } = claimLandingSpot(terminal);
    this.landingIndex = index;
    this.landingSpot = position;
  }

  buildMesh() {
    const color = this.airline.threeColor;

    this.mesh = new THREE.Group();
    this.mesh.rotation.order = "ZYX";   // heading → bank → pitch
    this.mesh.renderOrder = 10;
    this.mesh.scale.setScalar(0.6 * BUTTERFLY_SCALE);      // Reduce butterfly size by 40%
    scene.add(this.mesh);

    // wing/body/antennae are all one sprite — baked into the atlas art —
    // animated by swapping frames rather than rotating separate pieces.
    this.wingMat = makeButterflyMaterial(color, this.tint);
    this.wingMesh = new THREE.Mesh(SHARED.butterflyGeo, this.wingMat);
    this.wingMesh.renderOrder = 10;
    this.mesh.add(this.wingMesh);

    // No halo or core-glow sprite: the source render carries its own
    // light, and stacking additive glows on top of it read as a lamp
    // with a butterfly drawn on it rather than as a butterfly.

    // invisible, generously sized hit target for hover / tap
    this.pickMat = new THREE.SpriteMaterial({ opacity: 0, transparent: true, depthWrite: false });
    this.pick = new THREE.Sprite(this.pickMat);
    this.pick.scale.setScalar(0.26);
    this.pick.userData.butterfly = this;
    this.mesh.add(this.pick);
  }

  /* ---------------- state entry ---------------- */

  setCurve(curve) {
    this.curve = curve;
    this.curveLen = Math.max(0.001, curve.getLength());
    this.u = 0;
  }

  /** Fly straight in from a random point on the cube's edge to a landing spot. */
  enterInbound() {
    this.state = "inbound";
    this.claimLanding(this.terminal);
    this.setCurve(flightCurve(randomEdgePoint(ALT.cruise), this.landingSpot));

    this.curve.getPointAt(0, this.position);
    this.mesh.position.copy(this.position);
    this.opacity = 0;
  }

  /**
   * Which way a perched butterfly faces.
   *
   * Not uniformly random: a real butterfly settles facing away from the
   * flower it is standing on, wings clear of the bloom. Fully random headings
   * put a third of them nose-first into the centre, which reads as scattered
   * litter rather than as something alive that chose to land there.
   *
   * So face outward from the bloom's centre, then scatter by up to ~50° so
   * they don't all splay out in a perfect starburst either.
   */
  restingHeading() {
    const center = this.terminal === "T1" ? TERMINAL_T1 : TERMINAL;
    const offset = PETAL_LANDING_OFFSET[this.terminal];
    const outward = Math.atan2(
      this.landingSpot.y - (center.y + offset.y),
      this.landingSpot.x - (center.x + offset.x)
    );
    return outward + rand(-0.88, 0.88);
  }

  enterParked(instant = false) {
    this.state = "parked";
    this.flight.kind = "arrival";

    this.position.copy(this.landingSpot);
    this.mesh.position.copy(this.position);
    this.speed = 0;
    this.dwellTimer = rand(11, 22) / sim.intensity;
    this.restHeading = this.restingHeading();

    if (instant) {
      this.opacity = 1;
      this.heading = this.restHeading;
    } else {
      // touchdown: a bloom of light where it landed
      spawnPulse(this.position, _landColor.copy(COLOR.arrival).lerp(WHITE, 0.18));
      emitSparkles(this.position, COLOR.arrival, 18, 0.06, 0.30);
      triggerFlowerReaction(this.terminal, 1.4);
    }
  }

  /** A parked flight becomes a departure: new flight number, new route. */
  enterBoarding() {
    this.state = "boarding";

    // Same aircraft, same livery — so the same carrier, and a flight number
    // drawn from that carrier's range rather than a random one.
    this.flight = makeFlight("departure", sim.code, this.airline.code, this.terminal);

    this.position.copy(this.landingSpot);
    this.mesh.position.copy(this.position);
    this.boardTimer = rand(2.4, 3.8);
    this.opacity = Math.max(this.opacity, 0.001);
  }

  enterClimb() {
    this.state = "climb";

    // a flight already sitting on the flower simply flies back out
    spawnPulse(this.position, COLOR.departure);
    emitSparkles(this.position, COLOR.departure, 22, 0.07, 0.44);
    triggerFlowerReaction(this.terminal, 1.0);

    // free the petal the moment it lifts off, so another flight can claim it
    releaseLandingSpot(this.terminal, this.landingIndex);
    this.landingIndex = null;

    this.setCurve(flightCurve(this.position.clone(), randomEdgePoint(ALT.cruise)));
  }

  enterGone() {
    this.state = "gone";
  }

  /* ---------------- per-frame ---------------- */

  update(dt, elapsed, master) {
    // One place owns the trail palette: whenever the flight changes state the
    // ribbon re-tints, so an arrival's cool silk warms to amber on climb-out.
    if (this._styledState !== this.state) {
      this.trail.setStyle(this.state, this.airline.threeColor);
      this._styledState = this.state;
    }

    switch (this.state) {
      case "inbound": this.updateInbound(dt); break;
      case "parked": this.updateParked(dt); break;
      case "boarding": this.updateBoarding(dt); break;
      case "climb": this.updateClimb(dt); break;
      case "gone": this.updateGone(dt); break;
    }

    this.applyBreeze(dt, elapsed);
    this.applyPose(dt);
    this.applyWings(dt);
    this.applyMaterials(master);

    const moving = this.speed > 0.05;
    this.trail.update(this.position, moving && this.opacity > 0.2, master);

    // golden fairy dust, sprinkled sparingly along the flight path — skipped
    // under reduced motion, which keeps the glow but drops the extra particles
    if (!REDUCED_MOTION && moving && this.opacity > 0.3) {
      this.dustTimer -= dt;
      if (this.dustTimer <= 0) {
        this.dustTimer = rand(0.10, 0.18);
        emitSparkles(this.position, FAIRY_DUST_COLOR, 2, 0.05, 0.10);
      }
    }
  }

  /** Advance along the active curve; returns true when the curve ends. */
  advance(dt, speed) {
    this.speed = speed;
    this.u = Math.min(1, this.u + (speed * dt) / this.curveLen);

    this.curve.getPointAt(this.u, this.position);
    this.curve.getTangentAt(Math.min(0.999, this.u), this._tangent);

    // Flights share four corridors; nudge each one sideways, most at mid-path,
    // so they read as a stream of individual aircraft rather than a queue.
    const envelope = Math.sin(Math.PI * this.u);
    const weave = Math.sin(
      this.u * Math.PI * 2 * this.weaveTurns + this.wanderSeed
    ) * this.weaveAmp * envelope;
    const spread = envelope * this.lane + weave;
    this.position.x -= this._tangent.y * spread;
    this.position.y += this._tangent.x * spread;

    return this.u >= 1;
  }

  updateInbound(dt) {
    // Fade against path progress, not wall time: flight paths differ in
    // length, and a flight must be fully solid well before it lands.
    this.opacity = clamp(this.u / 0.20, 0, 1);

    // decelerate on the way in — arrivals *arrive*
    const speed = lerp(1.20, 0.14, easeInOutSine(this.u));

    if (this.advance(dt, speed)) this.enterParked();
  }

  updateParked(dt) {
    this.speed = 0;
    this.dwellTimer -= dt;
    this.position.copy(this.landingSpot);
    if (this.dwellTimer <= 0) this.enterBoarding();
  }

  updateBoarding(dt) {
    this.speed = 0;
    this.opacity = Math.min(1, this.opacity + dt * 1.1);
    this.boardTimer -= dt;

    // brighten toward the moment of release, then let go
    const t = 1 - clamp(this.boardTimer / 3.0, 0, 1);
    this.highlight = Math.sin(t * Math.PI) * 0.55 + easeInCubic(t) * 0.35;

    this.position.copy(this.landingSpot);
    if (this.boardTimer <= 0) this.enterClimb();
  }

  updateClimb(dt) {
    this.highlight = Math.max(0, this.highlight - dt * 0.9);

    // dissolve into the edge of the garden rather than crossing the frame
    this.opacity = Math.min(1, (1 - this.u) / 0.16);

    const speed = lerp(0.22, 1.55, easeInCubic(this.u));
    if (this.advance(dt, speed)) this.enterGone();
  }

  updateGone(dt) {
    this.opacity -= dt * 2.5;
    this.speed = Math.max(0, this.speed - dt * 0.4);
    this._tmp.copy(this._tangent).multiplyScalar(this.speed * dt);
    this.position.add(this._tmp);

    if (this.opacity <= 0) this.dead = true;
  }

  /** Weightless drift, applied on top of the flight path. */
  applyBreeze(dt, elapsed) {
    // Breeze physics disabled
    return;
  }

  /** Heading from the tangent, bank from the rate of turn. */
  applyPose(dt) {
    const grounded = this.state === "parked" || this.state === "boarding";

    if (!grounded) {
      const angle = Math.atan2(this._tangent.y, this._tangent.x);
      const turn = angleDelta(this._prevAngle, angle);
      this._prevAngle = angle;

      // shortest-path heading interpolation, so it never spins the long way
      this.heading += angleDelta(this.heading, angle) * Math.min(1, dt * 7);

      const targetBank = clamp((turn / Math.max(dt, 1e-4)) * 0.30, -0.85, 0.85);
      this.bank += (targetBank - this.bank) * Math.min(1, dt * 3.5);
    } else {
      this.heading += angleDelta(this.heading, this.restHeading) * Math.min(1, dt * 2);
      this.bank += (0 - this.bank) * Math.min(1, dt * 3);
    }

    this.mesh.position.copy(this.position);

    // altitude reads as scale: higher flights sit smaller against the garden
    const altitude = clamp((this.position.z - ALT.ground) / (ALT.cruise - ALT.ground), 0, 1);
    this.mesh.scale.setScalar(0.48 * BUTTERFLY_SCALE * this.sizeVariation * (1 - altitude * 0.22));

    this.mesh.rotation.z = this.heading - Math.PI / 2;
    this.mesh.rotation.y = this.bank;
    this.mesh.rotation.x = grounded ? -0.26 : -0.30 + Math.abs(this.bank) * 0.12;
  }

  /** Picks the atlas frame for this instant — a real captured flap cycle
   *  played back at a per-state rate, rather than a synthetic rotation. */
  applyWings(dt) {
    let rate;

    // Much slower than the old procedural-shader rates — that version was
    // a smooth continuous rotation, so a fast rate still read as fluid;
    // snapping between real captured frames at the same rate instead
    // reads as a frantic blur, and the source footage's own natural pace
    // is a slow, graceful ~2-2.5s per cycle (rate 2.3-2.7 ≈ one cycle
    // every 2π/rate seconds).
    if (this.state === "parked") {
      rate = 1.0 * this.flutter;
    } else if (this.state === "boarding") {
      rate = 1.8 * this.flutter;
    } else {
      rate = (2.3 + this.speed * 1.3) * this.flutter;
    }

    this.flapPhase = (this.flapPhase ?? rand(0, 6.28)) + rate * dt;

    const cycle = (this.flapPhase / (Math.PI * 2)) % 1;
    this.wingMat.uniforms.uFrame.value = cycle * BUTTERFLY_ATLAS_FRAMES;
  }

  applyMaterials(master) {
    const o = clamp(this.opacity, 0, 1) * master;

    this.wingMat.uniforms.uOpacity.value = o;
    this.wingMat.uniforms.uHighlight.value = this.highlight;

    const selected = this === pinned || this === hovered;
    this.wingMat.uniforms.uSelect.value = selected ? 1 : 0;
  }

  /* ---------------- teardown ---------------- */

  dispose() {
    releaseLandingSpot(this.terminal, this.landingIndex);
    this.landingIndex = null;

    scene.remove(this.mesh);

    this.wingMat.dispose();
    this.pickMat.dispose();
    this.trail.dispose();

    this.mesh.clear();
  }

  /* ---------------- readouts ---------------- */

  get statusLabel() { return STATUS_LABEL[this.state] ?? "—"; }
  get zoneLabel() { return ZONE_LABEL[this.state] ?? "—"; }

  get terminalLabel() {
    return this.terminal === "T1" ? "Terminal 1" : "Terminal 2";
  }

  get altitudeLabel() {
    if (this.state === "parked" || this.state === "boarding") return "On stand";
    const t = clamp((this.position.z - ALT.ground) / (ALT.cruise - ALT.ground), 0, 1);
    return `${(Math.round(t * ALT.ceiling / 500) * 500).toLocaleString()} ft`;
  }
}

/* =================================================================
   16 · SIMULATION
   No gates to reserve: a flight simply appears at the edge, flies in,
   lands at a random spot on its terminal flower, sits a while, then
   the same butterfly flies back out again as a departure.
   ================================================================= */

const sim = {
  code: "BLR",
  intensity: 1,
  maxInAir: 8,
  arrivalTimer: 0
};

/** Total flights visible at once — the closest thing left to a gate count. */
const MAX_BUTTERFLIES = 14;

const inAirCount = () => butterflies.filter((b) => b.state === "inbound").length;

function spawnArrival() {
  if (butterflies.length >= MAX_BUTTERFLIES || inAirCount() >= sim.maxInAir) return null;

  // domestic sectors land at T1, everything else at T2
  const flight = makeFlight("arrival", sim.code);
  const terminal = routeTerminal(flight);
  const b = new Butterfly(flight, terminal);

  butterflies.push(b);
  return b;
}

function spawnParked() {
  const flight = makeFlight("arrival", sim.code);
  const terminal = routeTerminal(flight);
  const b = new Butterfly(flight, terminal, { spawnParked: true });
  butterflies.push(b);
  return b;
}

function nextArrivalDelay() {
  return rand(2.2, 4.6) / sim.intensity;
}

function updateSimulation(dt) {
  // Only a scene that declares flights spawns and steps butterflies. Without
  // this the weather scene would keep an invisible airport running.
  if (!SCENES[activeSceneId]?.flights) return;

  sim.arrivalTimer -= dt;
  if (sim.arrivalTimer <= 0) {
    spawnArrival();
    sim.arrivalTimer = nextArrivalDelay();
  }

  // reverse iteration: safe removal while stepping the array
  for (let i = butterflies.length - 1; i >= 0; i--) {
    const b = butterflies[i];
    b.update(dt, elapsed, master);

    if (b.dead) {
      if (b === hovered) setHovered(null);
      if (b === pinned) setPinned(null);
      b.dispose();
      butterflies.splice(i, 1);
    }
  }
}

/** Drop a flight straight into a climb-out, already partway up its trail. */
function seedDeparture() {
  const flight = makeFlight("arrival", sim.code);
  const terminal = routeTerminal(flight);
  const b = new Butterfly(flight, terminal, { spawnParked: true });
  butterflies.push(b);

  b.enterBoarding();
  b.enterClimb();
  b.u = 0.30;
  b.opacity = 1;
  b.curve.getPointAt(b.u, b.position);
  b.mesh.position.copy(b.position);
}

function seedAirport(code) {
  sim.code = code;
  // CMS: authored simulationSpeed scales the airport's own traffic level. The
  // concurrent-flight ceiling stays derived from the base intensity, so a fast
  // setting arrives more often rather than overcrowding the gates.
  sim.intensity = AIRPORTS[code].intensity * (options.simulationSpeed ?? 1);
  sim.maxInAir = 4 + Math.round(AIRPORTS[code].intensity * 4);
  sim.arrivalTimer = 1.4;

  // a handful already parked so the terminal never looks abandoned
  const INITIAL_PARKED = 5;
  const parked = Array.from({ length: INITIAL_PARKED }, spawnParked);

  // The whole metaphor — arrive, land, sit, board, depart — has to be
  // legible in the first three seconds, so every state is on screen
  // from frame one.
  parked[0].dwellTimer = rand(1.8, 3.0);   // will start boarding almost at once
  seedDeparture();
  spawnArrival();
  spawnArrival();
}

function clearAirport() {
  for (const b of butterflies) b.dispose();
  butterflies.length = 0;

  setHovered(null);
  setPinned(null);
}

/* =================================================================
   17 · UI — glass dashboard
   ================================================================= */

// CMS: `ui` is built by buildDom() from the same markup index.html used to
// carry, so every `ui.*` write below is unchanged from the original.

/* --- airport selector --- */
// CMS: was a one-shot loop; now re-runnable so a catalog arriving from the API
// can repopulate it.
function buildAirportOptions() {
  ui.select.replaceChildren();
  for (const [code, meta] of Object.entries(AIRPORTS)) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = `${CITIES[code] ?? code} · ${code}`;
    option.title = meta.full;
    ui.select.appendChild(option);
  }
}
buildAirportOptions();

/* --- airline legend: fixed roster, counts fade in and out --- */
const airlineRows = new Map();

function buildAirlineKey() {
  ui.airlineKey.replaceChildren();
  airlineRows.clear();

  for (const code of AIRLINE_CODES) {
    const spec = AIRLINES[code];

    const li = document.createElement("li");
    li.className = "idle";
    li.innerHTML =
      `<span class="ak-left">` +
      `<span class="dot" style="background:${spec.color};color:${spec.color}"></span>` +
      `<span class="ak-name">${spec.name}</span></span>` +
      `<span class="ak-count">0</span>`;

    ui.airlineKey.appendChild(li);
    airlineRows.set(code, { li, count: li.querySelector(".ak-count") });
  }
}
buildAirlineKey();

/**
 * CMS: swaps the built-in reference tables for the API's catalog and rebuilds
 * the two bits of HUD that are derived from them. Called once, shortly after
 * boot, while the intro veil is still up — so the rebuild is invisible.
 */
function applyCatalog(catalog) {
  if (!catalog?.airports?.length || !catalog.airlines?.length) return;

  AIRLINES = Object.fromEntries(
    catalog.airlines.map((a) => [a.code, {
      name: a.name,
      color: a.color,
      range: a.flightNumberRange,
    }])
  );
  AIRLINE_CODES = Object.keys(AIRLINES);

  AIRPORTS = Object.fromEntries(
    catalog.airports.map((a) => [a.code, {
      tower: a.tower,
      full: a.full,
      intensity: a.intensity,
      routes: a.routes,
    }])
  );

  CITIES = { ...CITIES, ...(catalog.cities ?? {}) };
  // A route is "domestic" (T1) when the catalog itself lists it as a servable
  // airport city in India; the API sends the same split it generates against.
  DOMESTIC_CODES = new Set(catalog.domesticCodes ?? [...DOMESTIC_CODES]);

  buildAirportOptions();
  buildAirlineKey();

  // Keep showing the current airport if the new catalog still has it.
  const code = AIRPORTS[sim.code] ? sim.code : Object.keys(AIRPORTS)[0];
  ui.select.value = code;
  loadAirport(code);
}

/* --- counters are derived from live state every tick, never incremented --- */
let hudTimer = 0;

function updateHUD(dt) {
  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.2;

  let arrivals = 0, departures = 0, parked = 0;
  const perAirline = new Map();

  for (const b of butterflies) {
    if (b.state === "inbound") arrivals++;
    else if (b.state === "boarding" || b.state === "climb") departures++;
    else if (b.state === "parked") parked++;

    perAirline.set(b.airline.code, (perAirline.get(b.airline.code) ?? 0) + 1);
  }

  ui.arrivals.textContent = arrivals;
  ui.departures.textContent = departures;
  ui.parked.textContent = parked;
  ui.active.textContent = butterflies.length;

  for (const [code, row] of airlineRows) {
    const n = perAirline.get(code) ?? 0;
    row.count.textContent = n;
    row.li.classList.toggle("idle", n === 0);
  }

  if (pinned) renderDetail(pinned);
  else if (hovered) renderDetail(hovered);

  // a hovered flight can change state mid-hover — keep the tooltip honest
  if (hovered) writeTooltip(hovered);
}

/* --- detail panel --- */

function renderDetail(b) {
  ui.detailEmpty.hidden = true;
  ui.detailBody.hidden = false;
  ui.unpinBtn.hidden = b !== pinned;

  ui.dSwatch.style.background = b.airline.color;
  ui.dSwatch.style.color = b.airline.color;

  ui.dFlight.textContent = b.flight.id;
  ui.dAirline.textContent = `${b.airline.name} · ${routeLong(b.flight)}`;

  ui.dStatus.textContent = b.statusLabel;
  ui.dStatus.dataset.state = b.state;

  ui.dRoute.textContent = routeText(b.flight);
  ui.dTerminal.textContent = b.terminalLabel;
  ui.dZone.textContent = b.zoneLabel;
  ui.dAlt.textContent = b.altitudeLabel;
}

function clearDetail() {
  ui.detailEmpty.hidden = false;
  ui.detailBody.hidden = true;
  ui.unpinBtn.hidden = true;
}

/* --- hover / pick --- */

let hovered = null;
let pinned = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/** e.g. "AI 204 · Arriving · Terminal 2" */
function writeTooltip(b) {
  ui.tooltip.innerHTML =
    `<span class="tt-accent">${b.flight.id}</span> · ${b.statusLabel}` +
    ` · ${b.terminalLabel}`;
}

function setHovered(b) {
  hovered = b;

  if (b) {
    writeTooltip(b);
    ui.tooltip.classList.add("visible");
    if (!pinned) renderDetail(b);
  } else {
    ui.tooltip.classList.remove("visible");
    if (!pinned) clearDetail();
  }

  canvas.style.cursor = b ? "pointer" : "default";
}

function setPinned(b) {
  pinned = b;
  if (b) renderDetail(b);
  else if (hovered) renderDetail(hovered);
  else clearDetail();
}

function pickAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  pointer.x = (x / rect.width) * 2 - 1;
  pointer.y = -(y / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const targets = butterflies.filter((b) => b.opacity > 0.25).map((b) => b.pick);
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length ? hits[0].object.userData.butterfly : null;
}

/**
 * CMS: every listener below goes through this so it is torn down on dispose.
 * The original registered them at module scope and never removed them, which
 * would double them on every React remount.
 */
function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  cleanups.push(() => target.removeEventListener(type, handler, opts));
}

// CMS: the tooltip is positioned inside the container now, so it follows the
// pointer relative to the canvas rather than the viewport.
function moveTooltip(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  ui.tooltip.style.transform =
    `translate(-50%, -160%) translate(${clientX - rect.left}px, ${clientY - rect.top}px)`;
}

on(canvas, "pointermove", (e) => {
  if (e.pointerType === "mouse") setParallaxTarget(e.clientX, e.clientY);

  moveTooltip(e.clientX, e.clientY);

  const hit = pickAt(e.clientX, e.clientY);
  if (hit !== hovered) setHovered(hit);
});

on(canvas, "pointerleave", () => setHovered(null));

on(canvas, "pointerdown", (e) => {
  const hit = pickAt(e.clientX, e.clientY);
  setPinned(hit && hit === pinned ? null : hit);

  // on touch there is no hover, so drive the tooltip from the tap
  if (e.pointerType !== "mouse") {
    moveTooltip(e.clientX, e.clientY);
    setHovered(hit);
  }
});

on(ui.unpinBtn, "click", () => setPinned(null));

/* --- scene switching --- */

/**
 * Shows only the panels a scene declares, and tags <body> with the scene id
 * so purely presentational rules (the terminal captions, for one) can follow
 * along in CSS rather than in here.
 */
function applyScenePanels(scene) {
  const panels = scene.panels ?? {};
  const blocks = {
    tower: ui.towerPanel,
    stats: ui.statsPanel,
    legend: ui.legendPanel,
    detail: ui.detailPanel,
    weather: ui.weatherPanel,
    attendance: ui.attendancePanel
  };

  for (const [key, el] of Object.entries(blocks)) {
    if (el) el.hidden = !panels[key];
  }

  // The airport picker steers the flight simulation; in any other scene it
  // would be a control with nothing behind it.
  if (ui.airportWrap) ui.airportWrap.hidden = !scene.flights;

  // CMS: scoped to this instance's root instead of document.body — several
  // instances can share a page, and the stylesheet keys off [data-scene] under
  // .fg-root rather than on the document.
  dom.root.dataset.scene = activeSceneId ?? "";
  ui.towerTitle.textContent = scene.name;
  ui.towerSub.textContent = scene.blurb;
}

/** Paints whatever the active scene's apply() last returned. */
function renderSceneReadout() {
  const r = sceneReadout;

  if (ui.statTemp) {
    ui.statTemp.textContent = typeof r.temp === "number" ? r.temp.toFixed(1) : "\u2014";
  }
  if (ui.statWind) {
    ui.statWind.textContent = typeof r.wind === "number" ? r.wind.toFixed(1) : "\u2014";
  }

  // While the poll is in charge, keep the sliders tracking it so grabbing
  // one starts from the current reading instead of wherever they last sat.
  if (!manualReading) {
    if (ui.manualTemp && typeof r.temp === "number") ui.manualTemp.value = r.temp;
    if (ui.manualWind && typeof r.wind === "number") ui.manualWind.value = r.wind;
  }

  if (ui.statPresent) {
    ui.statPresent.textContent = typeof r.present === "number" ? r.present : "—";
  }
  if (ui.statAbsent) {
    ui.statAbsent.textContent = typeof r.absent === "number" ? r.absent : "—";
  }
  if (ui.statLate) {
    ui.statLate.textContent = typeof r.late === "number" ? r.late : "—";
  }
}

function buildSceneSelector() {
  if (!ui.sceneSelect) return;

  for (const id of sceneIds()) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = SCENES[id].name;
    option.title = SCENES[id].blurb;
    ui.sceneSelect.appendChild(option);
  }

  ui.sceneSelect.value = DEFAULT_SCENE;

  ui.sceneSelect.addEventListener("change", (e) => {
    const id = e.target.value;

    // Same breath of darkness the airport switch uses, so a scene change
    // reads as a deliberate cut rather than a glitch.
    ui.veil.classList.add("switching");
    ui.veil.classList.remove("lifted");

    setTimeout(async () => {
      // Awaited: activateScene doesn't resolve until its render is loaded
      // AND correctly coloured, so the veil hides the whole load — a new
      // clip (or a network-bound one, like the weather scene's) never gets
      // exposed mid-fetch or on a placeholder colour.
      await activateScene(id);
      ui.veil.classList.remove("switching");
      ui.veil.classList.add("lifted");
    }, 300);
  });
}

/**
 * Wires the weather panel's temp/wind fields and Realtime button. Typing a
 * value into either engages manualReading and re-applies it immediately, so
 * the hue/speed change is visible without waiting on pollScene's interval;
 * Realtime clears it and forces one live poll to hand control straight back.
 */
function wireWeatherManualControls() {
  const applyManual = () => {
    if (!activeSceneId || !ui.manualTemp || !ui.manualWind) return;

    const tempC = Number(ui.manualTemp.value);
    const kph = Number(ui.manualWind.value);
    // A field mid-edit ("-", "", a trailing ".") parses to NaN — ignore the
    // keystroke rather than push a broken reading into the shader.
    if (!Number.isFinite(tempC) || !Number.isFinite(kph)) return;

    manualReading = { tempC, kph };
    if (ui.realtimeBtn) ui.realtimeBtn.disabled = false;
    pollScene(activeSceneId);
  };

  ui.manualTemp?.addEventListener("input", applyManual);
  ui.manualWind?.addEventListener("input", applyManual);

  ui.realtimeBtn?.addEventListener("click", () => {
    manualReading = null;
    ui.realtimeBtn.disabled = true;
    if (activeSceneId) pollScene(activeSceneId);
  });
}

/**
 * Builds the weather scene's country/city picker and wires it: choosing a
 * place points selectedLocationId (read by pollScene, see its
 * locationParam branch) at the new id, drops any manual override so the
 * scene shows that place's actual weather rather than stale numbers, and
 * polls immediately instead of waiting for the 5-minute interval.
 */
function buildLocationSelector() {
  if (!ui.locationSelect) return;

  for (const { id, label } of WEATHER_LOCATIONS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    ui.locationSelect.appendChild(option);
  }
  ui.locationSelect.value = DEFAULT_LOCATION_ID;

  ui.locationSelect.addEventListener("change", (e) => {
    selectedLocationId = e.target.value;

    manualReading = null;
    if (ui.realtimeBtn) ui.realtimeBtn.disabled = true;

    if (activeSceneId) pollScene(activeSceneId);
  });
}

/* --- airport switching --- */

/**
 * CMS: setTimeout that must not fire into a disposed scene. Every pending
 * timer is cancelled by dispose().
 */
const timers = new Set();
function later(fn, ms) {
  const id = setTimeout(() => {
    timers.delete(id);
    if (alive()) fn();
  }, ms);
  timers.add(id);
  return id;
}
cleanups.push(() => {
  for (const id of timers) clearTimeout(id);
  timers.clear();
});

function loadAirport(code) {
  const meta = AIRPORTS[code];
  if (!meta) return;
  // CMS: an authored label overrides the catalog's tower name.
  ui.towerTitle.textContent = options.label?.trim() || meta.tower;
  ui.towerSub.textContent = `Live Traffic · ${meta.full}`;

  clearAirport();
  seedAirport(code);
  hudTimer = 0;
}

/** CMS: shared by the HUD picker and the imperative setAirport() handle. */
function switchAirport(code) {
  if (!AIRPORTS[code] || code === sim.code) return;
  if (ui.select.value !== code) ui.select.value = code;

  // a breath of darkness, then the new field of traffic
  ui.veil.classList.add("switching");
  ui.veil.classList.remove("lifted");

  later(() => {
    loadAirport(code);
    ui.veil.classList.remove("switching");
    ui.veil.classList.add("lifted");
  }, 300);
}

on(ui.select, "change", (e) => {
  const code = e.target.value;
  switchAirport(code);
  options.onAirportChange?.(code);
});

/* =================================================================
   18 · CINEMATIC INTRO
   ================================================================= */

let master = 0;              // global 0→1 reveal, multiplies every opacity
let introStarted = false;
let introTime = 0;
let introStartedAt = 0;
let cameraStart = 0;
let cameraEnd = 0;

function beginIntro() {
  if (introStarted) return;
  introStarted = true;
  introStartedAt = performance.now();
  // CMS: guarded — this can otherwise fire one frame after dispose().
  requestAnimationFrame(() => { if (alive()) ui.veil.classList.add("lifted"); });
}

/**
 * The intro runs on wall-clock time, deliberately *not* on the simulation's
 * clamped dt. The veil and title card are CSS animations; if the reveal rode
 * the sim clock it would drift out of step with them on any machine that
 * renders below 24fps — the card would finish explaining the metaphor long
 * before the captions that replace it ever appeared.
 */
function updateIntro() {
  if (!introStarted) return;

  introTime = (performance.now() - introStartedAt) / 1000;
  master = easeOutCubic(clamp((introTime - 0.35) / 2.0, 0, 1));

  // slow dolly-in: the garden settles into frame rather than snapping
  if (introTime < 2.6) {
    const t = easeOutCubic(clamp(introTime / 2.6, 0, 1));
    camera.position.z = lerp(cameraStart, cameraEnd, t);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }
}

/* =================================================================
   18b · PARALLAX DEPTH
   The layers already sit at different z — garden 0, routes and motes
   mid-air, butterflies up to cruise. Translating the camera by a
   hair's breadth turns that separation into real parallax without
   touching the framing (the offset is ~1% of the focus box).
   ================================================================= */

const PARALLAX_X = REDUCED_MOTION ? 0 : 0.062;
const PARALLAX_Y = REDUCED_MOTION ? 0 : 0.046;

const parallax = { x: 0, y: 0, tx: 0, ty: 0, hasPointer: false };

function setParallaxTarget(clientX, clientY) {
  parallax.hasPointer = true;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  parallax.tx = (x / rect.width - 0.5) * 2;
  parallax.ty = (y / rect.height - 0.5) * 2;
}

function updateParallax(dt, elapsed) {
  // No pointer, no motion: the frame must never drift on its own, only ever
  // respond to a real hover/touch target.
  if (!parallax.hasPointer) {
    parallax.tx = 0;
    parallax.ty = 0;
  }

  const k = Math.min(1, dt * 2.2);
  parallax.x += (parallax.tx - parallax.x) * k;
  parallax.y += (parallax.ty - parallax.y) * k;

  // Camera coordinates are managed by OrbitControls to support full 3D interactive manipulation.
}

/* =================================================================
   19 · RESIZE — frames the garden on any aspect ratio
   ================================================================= */

/**
 * Frame the *garden*, not the plane.
 *
 * Most of the render is black margin around the white shadow box. Fitting the
 * whole plane wastes the viewport — badly so on a phone. Instead we contain a
 * focus box drawn around the artwork and let the dead margin crop off-screen;
 * since the margin is black and so is the clear colour, the seam is invisible.
 *
 * On portrait the box tightens to the frame's inner opening, so the foliage
 * bleeds to the screen edges instead of floating in a sea of black.
 */
function fitCamera() {
  let focusWidth = GARDEN.width;
  let focusHeight = GARDEN.height;

  if (livingGarden && livingGarden.cubeSize) {
    // Zoom out the model by setting a wider framing boundary (65% margin padding)
    focusWidth = livingGarden.cubeSize.x * 1.65;
    focusHeight = livingGarden.cubeSize.y * 1.65;
  }

  const fovY = THREE.MathUtils.degToRad(camera.fov);
  const distForHeight = (focusHeight / 2) / Math.tan(fovY / 2);

  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect);
  const distForWidth = (focusWidth / 2) / Math.tan(fovX / 2);

  cameraEnd = Math.min(distForHeight, distForWidth);
  cameraStart = cameraEnd;

  if (!introStarted || introTime > 2.6) camera.position.z = cameraEnd;
}

function resize() {
  // CMS: guard against a 0x0 box. The container can measure zero while the
  // panel is hidden or mid-transition, and an aspect of 0/0 = NaN poisons the
  // projection matrix permanently — the scene never comes back.
  const w = canvas.clientWidth || host.clientWidth;
  const h = canvas.clientHeight || host.clientHeight;
  if (!w || !h) return;

  // CMS: capped rather than native devicePixelRatio — see maxPixelRatio.
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);

  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fitCamera();

  // point size attenuation matches three's own: drawing-buffer height / 2
  motes.mat.uniforms.uScale.value = renderer.getDrawingBufferSize(_bufferSize).y * 0.5;

  if (livingGarden) {
    livingGarden.material.uniforms.uSharpenAmount.value = pickSharpenAmount(canvas.clientWidth);
  }

  labelMetricsDirty = true;   // type size changes across breakpoints
}

/**
 * Creates and appends a floating pill-shaped button to toggle the entire HUD overlay.
 */
/**
 * CMS: scoped to this instance. Upstream queried document for ".hud", appended
 * the button to document.body and toggled a class there — with more than one
 * garden on a page that button would drive whichever HUD matched first, and it
 * would outlive the instance that created it. Everything here is looked up
 * inside dom.root, mounted inside it, and torn down with it.
 */
function initHUDToggle() {
  const hud = dom.root.querySelector(".hud");
  if (!hud) return;

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "hud-toggle-btn hud-active-btn";

  const label = document.createElement("span");
  label.textContent = "HIDE UI";
  toggleBtn.appendChild(label);

  dom.root.appendChild(toggleBtn);

  const toggleHUD = () => {
    const isActive = hud.classList.toggle("hud-active");
    dom.root.classList.toggle("hud-active", isActive);
    toggleBtn.classList.toggle("hud-active-btn", isActive);
    label.textContent = isActive ? "HIDE UI" : "SHOW UI";
  };

  on(toggleBtn, "click", toggleHUD);
}
const _bufferSize = new THREE.Vector2();

/**
 * CMS: the original listened on window resize, which is wrong here — the
 * container changes size independently of the viewport (CMS side panel, the
 * ScreenStage transform, an editor layout shift). A ResizeObserver on the host
 * covers all of those AND the plain window-resize case.
 */
const resizeObserver = new ResizeObserver(() => resize());
resizeObserver.observe(host);
cleanups.push(() => resizeObserver.disconnect());

// orientationchange doesn't always resize the element synchronously.
on(window, "orientationchange", () => later(resize, 120));

resize();

/* =================================================================
   20 · MAIN LOOP
   ================================================================= */

const clock = new THREE.Clock();
let elapsed = 0;

/**
 * Diagnostics for "the video lags" — load the page with ?debug=video.
 *
 * The two causes look identical on screen but have opposite fixes, and this
 * tells them apart:
 *
 *   dropped frames high, buffer healthy  → the GPU/decoder can't keep up.
 *       A 3840×2160 frame is ~33 MB per texture upload; the cost is
 *       resolution, so a smaller render is what helps.
 *   buffer near zero, dropped frames low → the stream is starving playback.
 *       At 80 Mbps a browser's byte-capped media buffer only holds ~3s, so
 *       the cost is bitrate and a lower-bitrate encode is what helps.
 */
let frameCount = 0;
function startVideoDiagnostics() {
  if (!new URLSearchParams(location.search).has("debug")) return;

  let lastReport = performance.now();
  setInterval(() => {
    const now = performance.now();
    const fps = frameCount / ((now - lastReport) / 1000);
    frameCount = 0;
    lastReport = now;

    if (!gardenVideoEl) {
      console.log(`[diag] render ${fps.toFixed(1)} fps — no video element yet`);
      return;
    }

    const v = gardenVideoEl;
    const q = v.getVideoPlaybackQuality?.();
    let ahead = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.currentTime >= v.buffered.start(i) && v.currentTime <= v.buffered.end(i)) {
        ahead = v.buffered.end(i) - v.currentTime;
        break;
      }
    }
    const dropped = q ? q.droppedVideoFrames : 0;
    const total = q ? q.totalVideoFrames : 0;
    const dropPct = total ? (dropped / total) * 100 : 0;

    console.log(
      `[diag] render ${fps.toFixed(1)} fps | buffered ahead ${ahead.toFixed(1)}s | ` +
      `dropped ${dropped}/${total} (${dropPct.toFixed(1)}%) | ` +
      `readyState ${v.readyState} | paused ${v.paused} | rate ${v.playbackRate.toFixed(2)}`
    );
  }, 2000);
}
startVideoDiagnostics();

function render() {
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

// CMS: the original called requestAnimationFrame(animate) with no stored
// handle, so the loop could never be stopped — every remount added another
// permanent loop rendering into a dead canvas. Now the id is kept and the
// disposed flag short-circuits any frame already queued.
let rafId = 0;

function animate() {
  if (disposed) return;
  rafId = requestAnimationFrame(animate);
  // CMS: upstream's frame counter, kept — it drives the video texture's
  // every-other-frame upload throttle further down.
  frameCount++;

  const dt = Math.min(clock.getDelta(), MAX_DT);
  elapsed += dt;

  if (controls) controls.update();

  updateIntro();
  updateParallax(dt, elapsed);
  updateSimulation(dt);
  updatePulses(dt, master);

  const activity = clamp(butterflies.length / 14, 0, 1);
  livingGarden?.update(elapsed, master, activity, dt);
  updateTerminalFlowers(dt, elapsed);

  updateMotes(elapsed, master);
  updateGrassDust(elapsed, master);
  updateSparkles(dt, master);
  updateLabels();

  updateHUD(dt);
  render();
}

/* =================================================================
   21 · BOOT
   ================================================================= */

/**
 * CMS: reflects the flight-feed state on the tower's live dot — green when the
 * board is real API data, amber when the garden is running on local generation
 * because the API is unreachable or returned nothing. Deliberately quiet: an
 * unattended screen should degrade without shouting about it.
 */
function setFeedState(state) {
  ui.feedDot.dataset.feed = state;
  ui.feedDot.title =
    state === "live" ? "Live flight board"
      : state === "simulated" ? "Simulated traffic — flight data unavailable"
        : "Connecting to flight data…";
}
setFeedState("connecting");

// CMS: the opening airport is authored content now, not hard-coded to BLR.
const initialAirport =
  (options.airportCode && AIRPORTS[options.airportCode] ? options.airportCode : null) ??
  Object.keys(AIRPORTS)[0];

ui.select.value = initialAirport;
loadAirport(initialAirport);
clearDetail();

buildSceneSelector();
wireWeatherManualControls();
buildLocationSelector();

initHUDToggle();
initPostProcessing();
animate();

// CMS: upstream calls loadGarden() here and lifts the veil when it settles.
// activateScene seeds the airport, points the plane at the scene's render and
// starts its feed; it is safe to call now because `ui` is initialised above.
// Guarded, because a 4K video can easily still be loading at unmount.
loadGarden().finally(() => { if (alive()) beginIntro(); });

// If the video is slow, still reveal the piece. CMS: later(), so the timer is
// cancelled on dispose instead of firing into a torn-down scene.
later(beginIntro, 2500);

/* =================================================================
   22 · TEARDOWN  (added for the CMS integration)
   ================================================================= */

/**
 * Releases everything this instance allocated. Three.js does not free GPU
 * memory on garbage collection, so geometries, materials, textures and render
 * targets have to be walked explicitly — and the WebGL context itself has to be
 * given back, or a browser hits its ~16-context ceiling after enough remounts
 * and starts killing older canvases.
 */
function dispose() {
  if (disposed) return;
  disposed = true;

  cancelAnimationFrame(rafId);

  // CMS: the scene runtime owns a 4K <video> and its decoder. Detaching the
  // source is what actually frees the decoder — removing the node is not
  // enough — and nothing else in this teardown reaches it.
  disposeGardenVideo?.();
  disposeGardenVideo = null;
  stopScenePolling();

  // Registered listeners, timers and the ResizeObserver.
  for (const undo of cleanups.splice(0)) {
    try { undo(); } catch (err) { console.warn("[Flight Garden] cleanup failed:", err); }
  }

  // Butterflies own pooled geometry/material clones; they already know how.
  for (const b of butterflies) b.dispose();
  butterflies.length = 0;

  controls?.dispose();
  composer?.dispose?.();

  const freedTextures = new Set();
  const freeMaterial = (material) => {
    for (const value of Object.values(material)) {
      if (value && value.isTexture && !freedTextures.has(value)) {
        freedTextures.add(value);
        value.dispose();
      }
    }
    material.dispose();
  };

  scene.traverse((obj) => {
    obj.geometry?.dispose?.();
    const material = obj.material;
    if (Array.isArray(material)) material.forEach(freeMaterial);
    else if (material) freeMaterial(material);
  });
  scene.clear();

  renderer.dispose();
  renderer.renderLists?.dispose?.();
  // Hand the context back rather than waiting for GC to maybe do it.
  renderer.forceContextLoss?.();

  dom.destroy();
}

return {
  dispose,
  setAirport: (code) => { if (alive()) switchAirport(code); },
  setCatalog: (catalog) => { if (alive()) applyCatalog(catalog); },
  setRoster: (flights) => { if (alive()) setRosterQueue(flights); },
  setFeedState: (state) => { if (alive()) setFeedState(state); },
};

} // ── end createFlightGarden ──────────────────────────────────────────────
