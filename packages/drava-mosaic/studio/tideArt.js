/**
 * The Tide artwork, generated live for the studio's Weather and Attendance
 * pieces in place of a rendered video: a mass of water made of fine beads in
 * a white box seen from above, its swells rising toward you, folding over
 * and casting shadows into the troughs and onto the walls, its currents
 * swirling and its surface sloshing between the walls.
 *
 * It is simulated, not animated, in the way of Refik Anadol's fluid data
 * sculptures: the water is moved by a fluid solver, and the beads ride it
 * with no collisions between them, so they stream freely.
 *
 * - The currents are a 2D incompressible fluid (Stam's "stable fluids") on a
 *   grid filling the box, stirred by an evolving curl-noise field, gusts of
 *   wind and two drifting whirlpools, the walls turning the flow.
 * - The surface is a wave simulation on the same grid, so waves travel,
 *   reflect off the walls and slosh. It's drawn HEIGHT times taller than it's
 *   simulated, and drawn toward each crest so crests sharpen ("choppy"
 *   waves, as in film water). What's pushed into a wall rides up it.
 * - On it float LAYERS sheets of beads, stacked, as in the Garden render. Each
 *   sheet's folds are a field the currents carry, so the currents wind them
 *   into swirls and S-curves and pile them up where the water meets; a
 *   little viscosity smooths them and they slowly give way to fresh ones
 *   (RELAX). The sheets beneath flow a little slower and at an angle, so the
 *   sheets slide across and tuck under each other. Stretched too thin
 *   (TEAR), a sheet tears and shows the one below. And where the ink the
 *   currents carry runs thin (OPENING), the sheets are absent, so the box's
 *   floor shows through in channels that swirl with the flow. The swirls
 *   rise toward you: each whirlpool lifts its sheets (SWIRL_LIFT), and some
 *   beads (FLYERS) float up out of them in rising spirals, then settle.
 * - The beads ride their sheet's current, each living a few seconds and then
 *   reappearing somewhere else so they stay spread evenly, and bobbing a
 *   little on its own rhythm as it floats. Each is drawn as a tiny lit
 *   sphere with its own depth, dark where it meets its neighbours, over a
 *   darker body that fills any gap and reads as the crevices between them.
 * - The light is a key light with a shadow map, so the swells shadow what's
 *   behind them, plus the room's light, less in troughs and folds, and a wet
 *   glint on each bead.
 *
 * The studio colours a video art from two films played in step: the render
 * in grey, and a "velocity pass" that marks how lively each pixel is (black
 * still, white fast, red for anything never coloured, like the box). This art
 * draws both into one texture: the render in the top half and its velocity
 * pass in the bottom half, the same size. Liveliness mixes the current's
 * speed with the surface's motion and height, so fast streams and crests
 * read as the liveliest. Wind (setWind) makes everything rougher and faster.
 *
 * Needs WebGL 2 with float render targets (EXT_color_buffer_float).
 */

const FOV = (30 * Math.PI) / 180;
// The camera sits this far in front of the box's rim, so the view is two
// units tall at the rim.
const FOCAL = 1 / Math.tan(FOV / 2);
const RIM = 0.085; // the box's flat white rim, in view units
const DEPTH = 1.4; // from the rim down to the box's floor
const SURFACE = -0.72; // the water's resting level, well down, so the walls show
const HEIGHT = 2.4; // the waves are drawn this many times taller than simulated
const CHOP = 0.22; // how strongly the surface is drawn toward each crest
const THICK = 0.035; // how far below the surface the deepest beads ride
const BODY = 0.04; // the body under the beads, this far below the surface
const TEAR = 3.8; // stretched to about this many times its area, a sheet tears
const LAYERS = 3; // sheets of beads, stacked: they tuck under each other as the Garden render's do
const LAYER_GAP = 0.11; // between the sheets' resting levels
const RELAX = 0.45; // how fast (per second) a sheet's carried folds give way to fresh ones
// Where the ink the currents carry is thinner than this, a sheet is absent,
// so the box's floor shows through in channels that swirl with the flow. A
// sheet per entry, top first: the ones beneath reach a little further, so
// the edges step down like terraces.
const OPENING = [0.33, 0.28, 0.24];
// The swirls rise toward you: a sheet lifts this far at a whirlpool's heart
// (where the current's curl is SWIRL or more), and FLYERS of the beads float
// up out of the swirls, spiralling, up to FLY above their sheet.
const SWIRL_LIFT = 0.17;
const SWIRL = 2.6;
const FLYERS = 0.14;
const FLY = 0.42;
const GRAIN = 0.0165; // a bead's diameter, in view units
const GRID_X = 224; // simulation cells across the box (they're square)
const INK_DETAIL = 3; // the ink is carried on a grid this many times finer, to keep its filaments
const SIDE = 448; // beads: SIDE × SIDE, shared among the sheets
const SHADOW_SIZE = 2048; // the shadow map's size, in texels
const JACOBI = 40; // pressure solver iterations
const WAVE_SPEED = 0.75; // units a second
// Wind speed (km/h) at which the water is at its roughest; calmer is gentler.
const FULL_WIND_KPH = 40;
// How fast the water's clock runs, in seconds per second, in still air and
// at full wind.
const CALM_PACE = 0.6;
const FULL_PACE = 1.6;
// The water's roughness when no wind is given (Attendance).
const DEFAULT_ENERGY = 0.45;
// Simulated seconds run before the first frame, so it opens mid-flow, in
// steps of WARM_STEP; the GPU is flushed every few, so it never has one long
// stretch of work (which Windows, for one, ends by resetting the GPU).
const WARM_UP = 5;
const WARM_STEP = 1 / 15;

const f = (n) => n.toFixed(5);

// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT licence).
const NOISE = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

const HASH = /* glsl */ `
  uint hashu(uint x) {
    x ^= x >> 16; x *= 0x7feb352dU;
    x ^= x >> 15; x *= 0x846ca68bU;
    x ^= x >> 16;
    return x;
  }
  float hash(uint x) { return float(hashu(x)) / 4294967295.0; }
`;

// The camera looks straight down -z at the box, its rim at z = 0.
const PROJECT = /* glsl */ `
  uniform float uAspect;

  vec4 project(vec3 p) {
    const float focal = ${f(FOCAL)};
    const float near = 0.1;
    const float far = 20.0;
    float z = p.z - focal;
    return vec4(
      p.x * focal / uAspect,
      p.y * focal,
      z * (far + near) / (near - far) + 2.0 * far * near / (near - far),
      -z
    );
  }
`;

const HEAD = "#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n";

// ---- The simulation: full-grid passes, one cell per fragment ----

const QUAD_VERTEX = `${HEAD}
  in vec2 aPos;
  out vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

// Each grid pass knows the grid: its texel (1 / cells), a cell's size in
// view units, and half the box.
const GRID = /* glsl */ `
  in vec2 vUv;
  out vec4 outColor;
  uniform vec2 uTexel;
  uniform float uCell;
  uniform vec2 uHalf;
  vec2 place(vec2 uv) { return (uv * 2.0 - 1.0) * uHalf; } // where a cell is in the box
`;

// The current's curl (how it spins) in each cell.
const CURL = `${HEAD}${GRID}
  uniform sampler2D uVel;
  void main() {
    float l = texture(uVel, vUv - vec2(uTexel.x, 0.0)).y;
    float r = texture(uVel, vUv + vec2(uTexel.x, 0.0)).y;
    float b = texture(uVel, vUv - vec2(0.0, uTexel.y)).x;
    float t = texture(uVel, vUv + vec2(0.0, uTexel.y)).x;
    outColor = vec4(((r - l) - (t - b)) / (2.0 * uCell), 0.0, 0.0, 1.0);
  }
`;

// What stirs the water: curl noise, gusts and the whirlpools. (Vorticity
// confinement, the usual way to keep small swirls alive, was tried and drew
// straight seams through the ink; without it the flow is silkier.)
const FORCE = `${HEAD}${GRID}
  uniform sampler2D uVel;
  uniform float uTime;
  uniform float uDt;
  uniform float uEnergy;
  uniform vec2 uWind;
  uniform vec4 uPools; // two whirlpools' centres
  uniform vec4 uPools2; // and two more
  uniform vec4 uSpin; // and how hard each turns
  ${NOISE}

  vec2 pool(vec2 p, vec2 c, float spin) {
    vec2 d = p - c;
    return spin * vec2(-d.y, d.x) * exp(-dot(d, d) / 0.22);
  }

  void main() {
    vec2 p = place(vUv);
    vec2 v = texture(uVel, vUv).xy;
    float e = uEnergy;

    // A slowly changing field of swirls: the curl of a noise, so it only turns
    // the water, never piles it up.
    const float k = 0.8;
    const float d = 0.05;
    float tn = uTime * 0.05;
    float n0 = snoise(vec3(p * k, tn));
    float nx = snoise(vec3((p + vec2(d, 0.0)) * k, tn));
    float ny = snoise(vec3((p + vec2(0.0, d)) * k, tn));
    vec2 force = vec2(ny - n0, n0 - nx) / d * (0.05 + 0.1 * e);

    // Gusts: the wind pushing where it blows hardest, which sets the water
    // circling (an even push everywhere would do nothing in a closed box).
    float gust = 0.5 + 0.5 * snoise(vec3(p * 0.55 - uWind * uTime * 0.5, uTime * 0.07 + 20.0));
    force += uWind * gust * gust * 0.7;

    force += pool(p, uPools.xy, uSpin.x) + pool(p, uPools.zw, uSpin.y)
      + pool(p, uPools2.xy, uSpin.z) + pool(p, uPools2.zw, uSpin.w);
    outColor = vec4(v + force * uDt, 0.0, 1.0);
  }
`;

// Carries a field along the current, tracing each cell back to where its
// water came from. The current itself fades a little; the ink drifts back
// toward a marbled pattern so it never washes out to one tone.
const ADVECT = `${HEAD}${GRID}
  uniform sampler2D uVel;
  uniform sampler2D uSrc;
  uniform float uDt;
  uniform float uTime;
  uniform float uInk; // 1 when carrying the ink
  ${NOISE}

  void main() {
    vec2 v = texture(uVel, vUv).xy;
    vec2 from = vUv - uDt * v / (2.0 * uHalf);
    vec4 s = texture(uSrc, from);
    if (uInk < 0.5) {
      // A little viscosity: blending toward the neighbours damps the
      // grid-scale checkerboard a solver like this can't see, which would
      // otherwise speckle the surface.
      vec2 around = 0.25 * (texture(uSrc, from - vec2(uTexel.x, 0.0)).xy + texture(uSrc, from + vec2(uTexel.x, 0.0)).xy
        + texture(uSrc, from - vec2(0.0, uTexel.y)).xy + texture(uSrc, from + vec2(0.0, uTexel.y)).xy);
      s.xy = mix(s.xy, around, 1.0 - exp(-uDt * 6.0));
      outColor = vec4(s.xy * exp(-uDt * 0.35), 0.0, 1.0);
    } else {
      vec2 p = place(vUv);
      float n = snoise(vec3(p * 0.5, uTime * 0.012));
      float marble = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(n * 7.0 + p.x * 1.3 + p.y * 0.6));
      outColor = vec4(mix(s.x, marble, 1.0 - exp(-uDt * 0.1)), 0.0, 0.0, 1.0);
    }
  }
`;

// How much water each cell gains or loses; the walls let none through.
const DIVERGENCE = `${HEAD}${GRID}
  uniform sampler2D uVel;
  void main() {
    vec2 c = texture(uVel, vUv).xy;
    float l = texture(uVel, vUv - vec2(uTexel.x, 0.0)).x;
    float r = texture(uVel, vUv + vec2(uTexel.x, 0.0)).x;
    float b = texture(uVel, vUv - vec2(0.0, uTexel.y)).y;
    float t = texture(uVel, vUv + vec2(0.0, uTexel.y)).y;
    if (vUv.x - uTexel.x < 0.0) l = -c.x;
    if (vUv.x + uTexel.x > 1.0) r = -c.x;
    if (vUv.y - uTexel.y < 0.0) b = -c.y;
    if (vUv.y + uTexel.y > 1.0) t = -c.y;
    outColor = vec4((r - l + t - b) / (2.0 * uCell), 0.0, 0.0, 1.0);
  }
`;

// One step toward the pressure that keeps the water from piling up.
const PRESSURE = `${HEAD}${GRID}
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  void main() {
    float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    float div = texture(uDivergence, vUv).x;
    outColor = vec4((l + r + b + t - div * uCell * uCell) * 0.25, 0.0, 0.0, 1.0);
  }
`;

// Takes the pressure's push off the current, which leaves it flowing
// without piling up, and stops it at the walls.
const GRADIENT = `${HEAD}${GRID}
  uniform sampler2D uVel;
  uniform sampler2D uPressure;
  void main() {
    float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    vec2 v = texture(uVel, vUv).xy - vec2(r - l, t - b) / (2.0 * uCell);
    if (vUv.x - uTexel.x < 0.0 || vUv.x + uTexel.x > 1.0) v.x = 0.0;
    if (vUv.y - uTexel.y < 0.0 || vUv.y + uTexel.y > 1.0) v.y = 0.0;
    outColor = vec4(v, 0.0, 1.0);
  }
`;

// The surface: height and how fast it's rising, moved on one step of the
// wave equation. Reading past the edge reads the edge, so waves reflect off
// the walls. Gusts and a slow push at the box's own sloshing rhythm drive
// it; whirlpools draw it down.
const WAVES = `${HEAD}${GRID}
  uniform sampler2D uWave;
  uniform sampler2D uCurl;
  uniform float uTime;
  uniform float uDt;
  uniform float uEnergy;
  uniform vec2 uWind;
  uniform float uSlosh; // the box's lowest sloshing rhythm, radians a second
  ${NOISE}

  void main() {
    vec2 p = place(vUv);
    vec2 s = texture(uWave, vUv).xy;
    float l = texture(uWave, vUv - vec2(uTexel.x, 0.0)).x;
    float r = texture(uWave, vUv + vec2(uTexel.x, 0.0)).x;
    float b = texture(uWave, vUv - vec2(0.0, uTexel.y)).x;
    float t = texture(uWave, vUv + vec2(0.0, uTexel.y)).x;
    float lap = (l + r + b + t - 4.0 * s.x) / (uCell * uCell);
    float e = uEnergy;

    float drive = (0.1 + 0.4 * e) * snoise(vec3(p * 1.3 - uWind * uTime * 1.6, uTime * 0.35));
    drive += (0.05 + 0.12 * e) * cos(3.14159 * vUv.x) * sin(uSlosh * uTime);
    drive += 0.18 * (0.5 + 0.5 * snoise(vec3(p * 0.6, uTime * 0.05 + 40.0))) * cos(3.14159 * vUv.y) * sin(uSlosh * 1.83 * uTime + 1.0);
    float w = texture(uCurl, vUv).x;
    drive -= 0.004 * min(w * w, 1.0);

    const float c = ${f(WAVE_SPEED)};
    // Damping on the rising speed's own curvature calms grid-scale ripples
    // and leaves the swell.
    float riseLap = (texture(uWave, vUv - vec2(uTexel.x, 0.0)).y + texture(uWave, vUv + vec2(uTexel.x, 0.0)).y
      + texture(uWave, vUv - vec2(0.0, uTexel.y)).y + texture(uWave, vUv + vec2(0.0, uTexel.y)).y - 4.0 * s.y);
    float rise = s.y + uDt * (c * c * lap - 0.55 * s.y - 0.6 * s.x + drive) + 0.12 * riseLap;
    outColor = vec4(s.x + uDt * rise, rise, 0.0, 1.0);
  }
`;

// ---- Drawing ----

// The light: a key from the upper left and in front, low enough that the
// swells cast long shadows into the troughs and onto the walls.
const LIGHT = [-0.52, 0.5, 0.66];
const LIGHT_GLSL = `normalize(vec3(${LIGHT.map(f).join(", ")}))`;
// A soft fill from the opposite side, as a studio's bounce card would give:
// it casts no shadows, and keeps the shadowed side from going black.
const FILL_GLSL = "normalize(vec3(0.5, -0.45, 0.75))";

// The sea's shape, shared by the water's body and the grains.
const SEA = /* glsl */ `
  uniform sampler2D uWave;
  uniform highp sampler2DArray uFold;
  uniform vec2 uHalf;
  uniform float uLayer; // which sheet, 0 the top
  uniform sampler2D uCurl; // how the current spins

  // Keeps v within lim: untouched well inside, and squeezed into a band
  // against the wall the further past it it is pushed.
  float pile(float v, float lim) {
    const float k = 0.1;
    float a = abs(v);
    float inner = lim - k;
    if (a <= inner) return v;
    return sign(v) * (inner + k * (1.0 - exp(-(a - inner) / k)));
  }

  // Where a sheet carries the bead resting at p: its folds as the currents
  // have carried them (see FOLD_PASS), on the water's swell, which every
  // sheet rides together (made HEIGHT times taller, for drama, and drawn
  // toward each crest so crests sharpen).
  vec3 surfaceAt(vec2 p) {
    vec2 uv = p / (2.0 * uHalf) + 0.5;
    vec2 tx = 1.0 / vec2(textureSize(uWave, 0));
    float h = texture(uWave, uv).x;
    float l = texture(uWave, uv - vec2(tx.x, 0.0)).x;
    float r = texture(uWave, uv + vec2(tx.x, 0.0)).x;
    float b = texture(uWave, uv - vec2(0.0, tx.y)).x;
    float t = texture(uWave, uv + vec2(0.0, tx.y)).x;
    vec2 cell = 2.0 * uHalf * tx;
    vec2 slope = vec2(r - l, t - b) / (2.0 * cell) * ${f(HEIGHT)};
    vec3 d = vec3(-${f(CHOP)} * slope, ${f(HEIGHT)} * h);
    d += texture(uFold, vec3(uv, uLayer)).xyz;
    // A whirlpool draws its water up toward you as it turns.
    d.z += ${f(SWIRL_LIFT)} * smoothstep(${f(SWIRL * 0.2)}, ${f(SWIRL)}, abs(texture(uCurl, uv).x)) * (1.0 - 0.25 * uLayer);
    // At the walls the sheet stays against them, so no gap opens; what's
    // pushed into a wall rides up it instead.
    vec2 wall = uHalf - abs(p);
    float pin = smoothstep(0.0, 0.35, min(wall.x, wall.y));
    vec2 outward = wall.x < wall.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
    d.z += (1.0 - pin) * max(dot(d.xy, outward), 0.0) * 1.3;
    d.xy *= pin;
    vec3 s = vec3(p, ${f(SURFACE)} - uLayer * ${f(LAYER_GAP)}) + d;
    // Nothing climbs past the box's rim, and the deepest troughs settle
    // softly above the floor, never through it.
    const float rimTop = -0.1;
    if (s.z > rimTop - 0.15) s.z = rimTop - 0.15 * exp(-(s.z - rimTop + 0.15) / 0.15);
    const float floorAt = ${f(-DEPTH + 0.12)};
    if (s.z < floorAt + 0.1) s.z = floorAt + 0.1 * exp((s.z - floorAt - 0.1) / 0.1);
    vec2 lim = uHalf - 0.006;
    s.x = pile(s.x, lim.x);
    s.y = pile(s.y, lim.y);
    return s;
  }

  // Facing the camera: where a fold turns the sheet over, its underside
  // (and then under is 1). stretch is how many times its resting area
  // the sheet is stretched to here.
  vec3 surfaceNormal(vec2 p, vec3 s, out float stretch, out float under) {
    const float e = 0.012;
    vec3 c = cross(surfaceAt(p + vec2(e, 0.0)) - s, surfaceAt(p + vec2(0.0, e)) - s);
    stretch = length(c) / (e * e);
    vec3 n = normalize(c);
    under = step(n.z, 0.0);
    return n.z < 0.0 ? -n : n;
  }

  // How open a place is to the room's light: less down low (so the sheets
  // beneath, and the gaps between them, sit in shade) and tucked in a fold.
  float openness(vec2 p, vec3 s, vec3 n) {
    float lift = smoothstep(${f(SURFACE - 0.5)}, ${f(SURFACE + 0.18)}, s.z);
    vec2 wall = uHalf - abs(s.xy);
    float corner = mix(0.7, 1.0, smoothstep(0.0, 0.15, min(wall.x, wall.y)));
    return mix(0.28, 1.0, lift) * mix(0.75, 1.0, n.z) * corner;
  }
`;

// A sheet's own current: the water's, slower and turned a little for the
// sheets beneath, so the sheets slide across each other. And where it's
// open (see OPENING).
const LAYER_FLOW = /* glsl */ `
  float opening(float layer) {
    return layer == 0.0 ? ${f(OPENING[0])} : (layer == 1.0 ? ${f(OPENING[1])} : ${f(OPENING[2])});
  }

  vec2 layerFlow(vec2 v, float layer) {
    float a = layer == 0.0 ? 0.0 : (layer == 1.0 ? 0.55 : -0.5);
    float k = 1.0 - 0.18 * layer;
    return k * mat2(cos(a), sin(a), -sin(a), cos(a)) * v;
  }
`;

// How lit a place is by the key light, from the shadow map: what the light
// sees first is lit, what's behind it is in shadow. Softened over four
// samples around it.
const SHADOW = /* glsl */ `
  uniform highp sampler2D uShadow;
  uniform mat4 uLight;

  float lightAt(vec3 p) {
    vec4 q = uLight * vec4(p, 1.0);
    vec3 s = q.xyz / q.w * 0.5 + 0.5;
    vec2 tx = 3.0 / vec2(textureSize(uShadow, 0));
    float z = s.z - 0.0015;
    return 0.25 * (step(z, texture(uShadow, s.xy + vec2(-tx.x, -0.4 * tx.y)).r)
      + step(z, texture(uShadow, s.xy + vec2(tx.x, 0.4 * tx.y)).r)
      + step(z, texture(uShadow, s.xy + vec2(-0.4 * tx.x, tx.y)).r)
      + step(z, texture(uShadow, s.xy + vec2(0.4 * tx.x, -tx.y)).r));
  }
`;

// The water's liveliness, for the velocity pass: how high it rides (so the
// colours follow the swells and folds), its current's speed, and how fast
// its surface is moving.
const LIVELY = /* glsl */ `
  float liveliness(vec2 v, vec2 w, float e, float z) {
    return clamp(0.4 * smoothstep(${f(SURFACE - 0.28)}, ${f(SURFACE + 0.32)}, z)
      + 0.22 * min(length(v) / (0.12 + 0.3 * e), 1.4)
      + 0.1 * min(abs(w.y) / (0.08 + 0.15 * e), 1.4), 0.0, 1.0);
  }
`;

const BOX_VERTEX = `${HEAD}
  in vec3 aPos;
  in float aFace; // 0 rim, 1 left wall, 2 right, 3 bottom, 4 top, 5 floor
  out vec3 vPos;
  out float vFace;
  ${PROJECT}
  void main() {
    vPos = aPos;
    vFace = aFace;
    gl_Position = project(aPos);
  }
`;

const BOX_FRAGMENT = `${HEAD}
  in vec3 vPos;
  in float vFace;
  out vec4 outColor;
  uniform float uVelocity;
  uniform vec2 uHalf;
  ${SHADOW}

  void main() {
    // The box is never coloured: red in the velocity pass.
    if (uVelocity > 0.5) {
      outColor = vec4(1.0, 0.0, 0.0, 1.0);
      return;
    }
    int face = int(vFace + 0.5);
    float lum;
    vec3 n = vec3(0.0, 0.0, 1.0);
    if (face == 0) {
      // The rim, with a fine shadow along its inner edge.
      vec2 d = abs(vPos.xy) - uHalf;
      lum = 0.93 - 0.08 * (1.0 - smoothstep(0.0, 0.01, max(d.x, d.y)));
    } else if (face == 5) {
      lum = 0.8; // light, like the walls, for the tears to show
    } else {
      // Each wall fades toward the floor and into the corners.
      float t = clamp(-vPos.z / ${f(DEPTH)}, 0.0, 1.0);
      float lit;
      float dark;
      float along;
      if (face == 1) { lit = 0.92; dark = 0.62; along = uHalf.y - abs(vPos.y); n = vec3(1.0, 0.0, 0.0); }
      else if (face == 2) { lit = 0.86; dark = 0.56; along = uHalf.y - abs(vPos.y); n = vec3(-1.0, 0.0, 0.0); }
      else if (face == 3) { lit = 0.96; dark = 0.66; along = uHalf.x - abs(vPos.x); n = vec3(0.0, 1.0, 0.0); }
      else { lit = 0.9; dark = 0.6; along = uHalf.x - abs(vPos.x); n = vec3(0.0, -1.0, 0.0); }
      lum = mix(lit, dark, pow(t, 0.7));
      lum *= mix(0.82, 1.0, smoothstep(0.0, 0.3, along));
    }
    // The water's shadow on the walls.
    lum *= mix(0.62, 1.0, lightAt(vPos + n * 0.004));
    outColor = vec4(vec3(lum), 1.0);
  }
`;

// A sheet's folds, as a field of how far each place is carried (xyz),
// moved along by the sheet's current each step, so the currents carry the
// folds, wind them into swirls and pile them up where the water meets. A
// little viscosity smooths them, and they give way slowly (RELAX) to fresh
// folds, so they never wear flat. With uReset they're the fresh folds.
const FOLD_PASS = `${HEAD}${GRID}
  uniform highp sampler2DArray uFold;
  uniform sampler2D uVel;
  uniform float uLayer;
  uniform float uDt;
  uniform float uTime;
  uniform float uEnergy;
  uniform vec2 uDrift; // how far the wind has carried the folds
  uniform float uReset;
  ${NOISE}
  ${LAYER_FLOW}

  vec3 noise3(vec3 q) {
    return vec3(snoise(q), snoise(q + vec3(31.4, 0.0, 0.0)), snoise(q + vec3(0.0, 47.2, 0.0)));
  }

  void main() {
    vec2 p = place(vUv);
    float e = uEnergy;
    vec2 seed = vec2(13.7, -7.3) * uLayer;
    vec3 fresh = noise3(vec3((p - uDrift) * 1.45 + seed, uTime * 0.05 + uLayer * 9.0)) * vec3(0.1, 0.1, 0.4) * (0.8 + 0.4 * e)
      + noise3(vec3((p - uDrift) * 4.2 + seed + 5.0, uTime * 0.09 + 20.0)) * vec3(0.03, 0.03, 0.1) * (0.7 + 0.6 * e)
      + noise3(vec3(p * 9.0 + seed + 11.0, uTime * 0.2 + 30.0)) * vec3(0.006, 0.006, 0.014);
    if (uReset > 0.5) {
      outColor = vec4(fresh, 1.0);
      return;
    }
    vec2 v = layerFlow(texture(uVel, vUv).xy, uLayer);
    vec2 from = vUv - uDt * v / (2.0 * uHalf);
    vec3 d = texture(uFold, vec3(from, uLayer)).xyz;
    vec3 around = 0.25 * (texture(uFold, vec3(from - vec2(uTexel.x, 0.0), uLayer)).xyz
      + texture(uFold, vec3(from + vec2(uTexel.x, 0.0), uLayer)).xyz
      + texture(uFold, vec3(from - vec2(0.0, uTexel.y), uLayer)).xyz
      + texture(uFold, vec3(from + vec2(0.0, uTexel.y), uLayer)).xyz);
    d = mix(d, around, 1.0 - exp(-uDt * 0.5));
    d = mix(d, fresh, 1.0 - exp(-uDt * ${f(RELAX)}));
    outColor = vec4(d, 1.0);
  }
`;

// A sheet's shape, worked out once a step, for its body and its beads to
// read: where each place is carried (xyz) and how open it is (w), and its
// normal (xyz) and stretch (w, negative on a fold's underside).
const SURFACE_PASS = `${HEAD}
  in vec2 vUv;
  layout(location = 0) out vec4 outSurface;
  layout(location = 1) out vec4 outNormal;
  ${SEA}
  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * uHalf;
    vec3 s = surfaceAt(p);
    float stretch;
    float under;
    vec3 n = surfaceNormal(p, s, stretch, under);
    outSurface = vec4(s, openness(p, s, n) * (under > 0.5 ? 0.7 : 1.0));
    outNormal = vec4(n, under > 0.5 ? -stretch : stretch);
  }
`;

// The water's body: a sheet under the grains, so no gap between them shows
// through. It's what's drawn into the shadow map, as the mass that casts the
// shadows: being under the beads, it never shadows the beads it carries.
const WATER_VERTEX = `${HEAD}
  in vec2 aUv;
  out vec2 vUv;
  out vec3 vWorld;
  out vec3 vNormal;
  out float vOpen;
  out float vStretch;
  uniform float uShadowPass;
  uniform mat4 uLight;
  uniform highp sampler2DArray uSurface;
  uniform highp sampler2DArray uSurfaceNormal;
  uniform float uLayer;
  ${PROJECT}
  void main() {
    vUv = aUv;
    vec4 s = texture(uSurface, vec3(aUv, uLayer));
    vec4 n = texture(uSurfaceNormal, vec3(aUv, uLayer));
    vNormal = n.xyz;
    vStretch = abs(n.w);
    vOpen = s.w;
    vWorld = s.xyz - vec3(0.0, 0.0, ${f(BODY)});
    gl_Position = uShadowPass > 0.5 ? uLight * vec4(vWorld, 1.0) : project(vWorld);
  }
`;

const WATER_FRAGMENT = `${HEAD}
  in vec2 vUv;
  in vec3 vWorld;
  in vec3 vNormal;
  in float vOpen;
  in float vStretch;
  out vec4 outColor;
  uniform sampler2D uVel;
  uniform sampler2D uInk;
  uniform sampler2D uWave;
  uniform float uVelocity;
  uniform float uShadowPass;
  uniform float uEnergy;
  uniform float uLayer;
  ${SHADOW}
  ${LIVELY}
  ${LAYER_FLOW}

  void main() {
    float ink = texture(uInk, vUv).x;
    // Where the ink runs thin the sheet is open, and the box shows through.
    // The body stops a little short of the beads' edge, so the edge is beads.
    if (ink < opening(uLayer) + 0.025) discard;
    // Stretched too thin, the sheet tears, and the floor shows through.
    if (vStretch > ${f(TEAR)} * (0.8 + 0.5 * ink)) discard;
    if (uShadowPass > 0.5) {
      outColor = vec4(0.0);
      return;
    }
    if (uVelocity > 0.5) {
      outColor = vec4(vec3(liveliness(texture(uVel, vUv).xy, texture(uWave, vUv).xy, uEnergy, vWorld.z + ${f(BODY)})), 1.0);
      return;
    }
    vec3 n = normalize(vNormal);
    float lit = lightAt(vWorld + n * 0.012);
    // Darker than the beads: what shows between them reads as the crevices.
    float albedo = mix(0.26, 0.32, texture(uInk, vUv).x);
    float lum = albedo * (0.34 * vOpen + 0.8 * max(dot(n, ${LIGHT_GLSL}), 0.0) * lit
      + 0.28 * vOpen * max(dot(n, ${FILL_GLSL}), 0.0));
    outColor = vec4(vec3(lum), 1.0);
  }
`;

// The grains: where each is on the flat sea, how deep in the water, and how
// old. Each rides the current and, when its time is up, starts again
// somewhere new. Each step also places it in the box, on the surface (sunk
// by its depth), and works out how it looks, once, for drawing to read.
const GRAINS = `${HEAD}
  layout(location = 0) out vec4 outState;
  layout(location = 1) out vec4 outPlace; // xyz: where it is in the box; w: its fade
  layout(location = 2) out vec4 outNormal; // xyz: the surface's normal there; w: its openness
  layout(location = 3) out vec4 outLook; // x: its albedo; y: its liveliness
  uniform sampler2D uState;
  uniform sampler2D uVel;
  uniform sampler2D uInk;
  uniform sampler2D uWave;
  uniform highp sampler2DArray uSurface;
  uniform highp sampler2DArray uSurfaceNormal;
  uniform vec2 uHalf;
  uniform float uEnergy;
  uniform float uDt;
  uniform float uTime;
  uniform uint uRound; // changes every step, so new places are new
  uniform sampler2D uCurl;
  ${HASH}
  ${LIVELY}
  ${LAYER_FLOW}

  void main() {
    ivec2 at = ivec2(gl_FragCoord.xy);
    uint id = uint(at.y * ${SIDE} + at.x);
    vec4 s = texelFetch(uState, at, 0);
    vec2 uv = s.xy / (2.0 * uHalf) + 0.5;
    // Which sheet the bead is in, a third of the beads to each, and how deep
    // in it, from its depth.
    float layer = floor(s.z * 2.999);
    s.xy += layerFlow(texture(uVel, uv).xy, layer) * uDt;
    s.xy = clamp(s.xy, -uHalf + 0.004, uHalf - 0.004);
    s.w += uDt;
    float life = 3.0 + 4.0 * hash(id * 3u + 1u); // short, so the beads keep spreading evenly
    if (s.w > life) {
      uint n = id * 7919u + uRound * 104729u;
      s.xy = (vec2(hash(n), hash(n + 1u)) * 2.0 - 1.0) * (uHalf - 0.004);
      s.z = hash(n + 2u);
      s.w = 0.0;
    }
    outState = s;
    layer = floor(s.z * 2.999);
    float deep = fract(s.z * 2.999);

    uv = s.xy / (2.0 * uHalf) + 0.5;
    vec4 here = texture(uSurface, vec3(uv, layer));
    vec3 surface = here.xyz;
    vec4 shape = texture(uSurfaceNormal, vec3(uv, layer));
    vec3 n = normalize(shape.xyz);
    // Each grain fades in and out over its life, so none pops.
    float fade = smoothstep(0.0, 0.9, s.w) * (1.0 - smoothstep(life - 1.2, life, s.w));
    // Floating, each bead bobs a little on the swell, on its own rhythm, so
    // neighbours jostle as they do in the Garden render.
    float own = hash(id * 3u + 2u);
    float bob = sin(uTime * (1.4 + 1.6 * own) + own * 40.0) * ${f(GRAIN * 0.35)} * (0.6 + 0.8 * uEnergy);
    vec3 bead = surface - n * (0.003 + deep * ${f(THICK)} - bob);
    // Where the sheet tears, its beads drop out unevenly, so a few are left
    // loose at the edges of the hole.
    if (abs(shape.w) > ${f(TEAR)} * (0.75 + 0.9 * own)) bead.z = -50.0; // out of sight
    // Where the sheet is open there are no beads; at its edge they thin out
    // unevenly, a few left loose.
    float open = texture(uInk, uv).x < opening(layer) + (own - 0.5) * 0.06 ? 1.0 : 0.0;
    // A few beads float up out of the swirls toward you, spiralling as they
    // rise over their life, then settle back. They rise only in a swirl, and
    // further the windier it is; once up, they float over the openings too.
    float lift = 0.0;
    if (own < ${f(FLYERS)}) {
      float swirl = smoothstep(${f(SWIRL * 0.25)}, ${f(SWIRL)}, abs(texture(uCurl, uv).x));
      float up = sin(3.14159 * clamp(s.w / life, 0.0, 1.0));
      lift = ${f(FLY)} * up * up * swirl * (0.6 + 0.6 * uEnergy) * (0.5 + 0.5 * fract(own * 37.0));
      float a = s.w * (2.2 + 2.5 * fract(own * 53.0)) + own * 300.0;
      bead.xy += vec2(cos(a), sin(a)) * lift * 0.3;
      bead.xy = clamp(bead.xy, -uHalf + 0.01, uHalf - 0.01);
      bead.z += lift;
    }
    // Nothing rises past the box's rim; it eases to a stop just below it.
    const float rimTop = -0.06;
    if (bead.z > rimTop - 0.12 && bead.z > -40.0) bead.z = rimTop - 0.12 * exp(-(bead.z - rimTop + 0.12) / 0.12);
    if (open > 0.5 && lift < 0.04) bead.z = -50.0;
    outPlace = vec4(bead, fade);
    outNormal = vec4(n, here.w * (1.0 - 0.3 * deep));
    float albedo = mix(0.8, 0.97, texture(uInk, uv).x) * (1.0 - 0.2 * deep);
    // z: how much bigger the bead is drawn where the sheet is stretched, so
    // it stays closed.
    // A floating bead is among the liveliest.
    float lively = liveliness(texture(uVel, uv).xy, texture(uWave, uv).xy, uEnergy, surface.z);
    lively = mix(lively, 1.0, smoothstep(0.03, 0.2, lift));
    outLook = vec4(albedo, lively,
      clamp(sqrt(abs(shape.w)), 1.0, 2.0), 1.0);
  }
`;

// Each grain is a tiny lit sphere, drawn as a point the size of its sphere,
// with the sphere's own depth so grains nestle into each other.
const GRAIN_VERTEX = `${HEAD}
  uniform sampler2D uPlace;
  uniform sampler2D uNormal;
  uniform sampler2D uLook;
  uniform float uPixels; // the pass's height in pixels, halved
  out vec3 vCenter;
  out float vRadius;
  out vec3 vNormal;
  out float vOpen;
  out float vAlbedo;
  out float vLively;
  ${HASH}
  ${PROJECT}

  void main() {
    ivec2 at = ivec2(gl_VertexID % ${SIDE}, gl_VertexID / ${SIDE});
    vec4 place = texelFetch(uPlace, at, 0);
    vec4 normal = texelFetch(uNormal, at, 0);
    vec4 look = texelFetch(uLook, at, 0);
    float own = hash(uint(gl_VertexID) * 3u + 2u);
    vCenter = place.xyz;
    vRadius = 0.5 * ${f(GRAIN)} * (0.75 + 0.5 * own) * (0.35 + 0.65 * place.w) * look.z;
    vNormal = normal.xyz;
    vOpen = normal.w;
    vAlbedo = look.x;
    vLively = look.y;
    vec4 clip = project(place.xyz);
    gl_Position = clip;
    gl_PointSize = max(2.0 * vRadius * ${f(FOCAL)} * uPixels / clip.w, 1.0);
  }
`;

const GRAIN_FRAGMENT = `${HEAD}
  in vec3 vCenter;
  in float vRadius;
  in vec3 vNormal;
  in float vOpen;
  in float vAlbedo;
  in float vLively;
  out vec4 outColor;
  uniform float uVelocity;
  ${SHADOW}
  ${PROJECT}

  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    // The point on the grain's sphere this pixel sees (the camera looks
    // down -z), and its depth.
    vec3 sphere = vec3(c.x, -c.y, sqrt(1.0 - r2));
    vec3 p = vCenter + sphere * vRadius;
    vec4 clip = project(p);
    gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
    if (uVelocity > 0.5) {
      outColor = vec4(vec3(vLively), 1.0);
      return;
    }
    // Lit as a sphere sitting on the surface: its own roundness, the swell
    // it's on, the shadow it's in, and a wet glint.
    vec3 L = ${LIGHT_GLSL};
    vec3 n = normalize(vNormal * 0.9 + sphere * 0.7);
    float lit = lightAt(p + vNormal * 0.004);
    float diffuse = max(dot(n, L), 0.0) * mix(0.45, 1.0, sphere.z);
    float glint = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0) * 0.38 * lit;
    float contact = mix(0.22, 1.0, pow(sphere.z, 0.6)); // dark where beads meet, as in the Garden render
    float fill = 0.28 * max(dot(n, ${FILL_GLSL}), 0.0);
    float lum = vAlbedo * ((0.34 + fill) * vOpen * contact + 0.83 * diffuse * lit) + glint;
    outColor = vec4(vec3(lum), 1.0);
  }
`;

// ---- WebGL plumbing ----

function program(gl, vertex, fragment, attributes = []) {
  const p = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[Tide]", gl.getShaderInfoLog(shader));
      return null;
    }
    gl.attachShader(p, shader);
  }
  attributes.forEach((name, i) => gl.bindAttribLocation(p, i, name));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error("[Tide]", gl.getProgramInfoLog(p));
    return null;
  }
  // Every uniform, with its type, so set() can take any of them by name.
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = { at: gl.getUniformLocation(p, info.name), type: info.type };
  }
  return { p, uniforms };
}

function texture(gl, w, h, internal, type, filter, data = null) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, data);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

// A field read from one texture and written to another, then swapped.
function pingPong(make) {
  let read = make();
  let write = make();
  return {
    get read() { return read; },
    get write() { return write; },
    swap() { [read, write] = [write, read]; },
    all: () => [read, write],
  };
}

/** The box: its rim out past the view's edges, four walls and the floor. */
function boxCorners(X, Y, aspect) {
  const OX = aspect + 0.1;
  const OY = 1.1;
  const D = -DEPTH;
  const quads = [
    [0, [-OX, Y, 0], [OX, Y, 0], [OX, OY, 0], [-OX, OY, 0]],
    [0, [-OX, -OY, 0], [OX, -OY, 0], [OX, -Y, 0], [-OX, -Y, 0]],
    [0, [-OX, -Y, 0], [-X, -Y, 0], [-X, Y, 0], [-OX, Y, 0]],
    [0, [X, -Y, 0], [OX, -Y, 0], [OX, Y, 0], [X, Y, 0]],
    [1, [-X, -Y, 0], [-X, Y, 0], [-X, Y, D], [-X, -Y, D]],
    [2, [X, -Y, 0], [X, Y, 0], [X, Y, D], [X, -Y, D]],
    [3, [-X, -Y, 0], [X, -Y, 0], [X, -Y, D], [-X, -Y, D]],
    [4, [-X, Y, 0], [X, Y, 0], [X, Y, D], [-X, Y, D]],
    [5, [-X, -Y, D], [X, -Y, D], [X, Y, D], [-X, Y, D]],
  ];
  const data = [];
  for (const [face, a, b, c, d] of quads) {
    for (const v of [a, b, c, a, c, d]) data.push(...v, face);
  }
  return new Float32Array(data);
}


/**
 * The key light's view, as a matrix: looking along the light at the box,
 * squared up to just hold it (rim to floor), for the shadow map.
 */
function lightMatrix(halfX, halfY) {
  const len = Math.hypot(...LIGHT);
  const z = LIGHT.map((c) => c / len); // toward the light
  const up = [0, 1, 0];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a); return a.map((c) => c / l); };
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // The box's corners in the light's view, to fit the view to them.
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const cx of [-halfX, halfX]) for (const cy of [-halfY, halfY]) for (const cz of [0.1, -DEPTH]) {
    const c = [cx, cy, cz];
    const v = [dot(c, x), dot(c, y), dot(c, z)];
    lo = lo.map((m, i) => Math.min(m, v[i]));
    hi = hi.map((m, i) => Math.max(m, v[i]));
  }
  // View (rows x, y, z) then an orthographic squeeze of lo..hi into -1..1,
  // nearest the light (highest z) at depth -1. Column-major for WebGL.
  const s = [2 / (hi[0] - lo[0]), 2 / (hi[1] - lo[1]), -2 / (hi[2] - lo[2])];
  const o = [-(hi[0] + lo[0]) / (hi[0] - lo[0]), -(hi[1] + lo[1]) / (hi[1] - lo[1]), (hi[2] + lo[2]) / (hi[2] - lo[2])];
  // Depth: z = hi maps to -1, z = lo to +1.
  return new Float32Array([
    s[0] * x[0], s[1] * y[0], s[2] * z[0], 0,
    s[0] * x[1], s[1] * y[1], s[2] * z[1], 0,
    s[0] * x[2], s[1] * y[2], s[2] * z[2], 0,
    o[0], o[1], o[2], 1,
  ]);
}

/**
 * Starts the art in the caller's WebGL 2 context, so what it draws never has
 * to be copied between contexts. Returns its texture (the render on top, its
 * velocity pass below) and the means to size it, set its wind, draw the next
 * frame and read a small copy back; or null without WebGL 2 and float render
 * targets.
 *
 * It leaves the context as the caller's own drawing expects: no framebuffer,
 * vertex array or program of its own bound, no depth test, blending or
 * scissor, and the unpack settings as they were.
 */
export function createTideArt(gl) {
  if (typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) return null;
  if (!gl.getExtension("EXT_color_buffer_float")) return null;
  // Full-precision fields if they can be filtered, else half precision.
  const precise = !!gl.getExtension("OES_texture_float_linear");
  const FIELD = precise ? [gl.RGBA32F, gl.FLOAT] : [gl.RGBA16F, gl.HALF_FLOAT];

  const programs = {
    curl: program(gl, QUAD_VERTEX, CURL, ["aPos"]),
    force: program(gl, QUAD_VERTEX, FORCE, ["aPos"]),
    advect: program(gl, QUAD_VERTEX, ADVECT, ["aPos"]),
    divergence: program(gl, QUAD_VERTEX, DIVERGENCE, ["aPos"]),
    pressure: program(gl, QUAD_VERTEX, PRESSURE, ["aPos"]),
    gradient: program(gl, QUAD_VERTEX, GRADIENT, ["aPos"]),
    waves: program(gl, QUAD_VERTEX, WAVES, ["aPos"]),
    fold: program(gl, QUAD_VERTEX, FOLD_PASS, ["aPos"]),
    surface: program(gl, QUAD_VERTEX, SURFACE_PASS, ["aPos"]),
    grains: program(gl, QUAD_VERTEX, GRAINS, ["aPos"]),
    box: program(gl, BOX_VERTEX, BOX_FRAGMENT, ["aPos", "aFace"]),
    water: program(gl, WATER_VERTEX, WATER_FRAGMENT, ["aUv"]),
    grain: program(gl, GRAIN_VERTEX, GRAIN_FRAGMENT),
  };
  if (Object.values(programs).some((p) => !p)) return null;

  // Sets a program's uniforms by name; textures go to the next free unit.
  function use(prog, values) {
    gl.useProgram(prog.p);
    let unit = 0;
    for (const [name, value] of Object.entries(values)) {
      const u = prog.uniforms[name];
      if (!u) continue; // unused in this program
      if (u.type === gl.SAMPLER_2D || u.type === gl.SAMPLER_2D_ARRAY) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(u.type === gl.SAMPLER_2D ? gl.TEXTURE_2D : gl.TEXTURE_2D_ARRAY, value);
        gl.uniform1i(u.at, unit++);
      } else if (u.type === gl.FLOAT) gl.uniform1f(u.at, value);
      else if (u.type === gl.FLOAT_VEC2) gl.uniform2fv(u.at, value);
      else if (u.type === gl.FLOAT_VEC4) gl.uniform4fv(u.at, value);
      else if (u.type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(u.at, false, value);
      else if (u.type === gl.UNSIGNED_INT) gl.uniform1ui(u.at, value);
      else gl.uniform1i(u.at, value);
    }
  }

  function vao(setup) {
    const v = gl.createVertexArray();
    gl.bindVertexArray(v);
    setup();
    gl.bindVertexArray(null);
    return v;
  }
  // Buffers are kept in owned, to be freed with what they belong to.
  let owned = [];
  function buffer(data, target = gl.ARRAY_BUFFER) {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    owned.push(b);
    return b;
  }
  const quad = vao(() => {
    buffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  });
  const empty = gl.createVertexArray(); // the grains need no attributes
  const quadBuffers = owned;
  owned = []; // from here on, the box's shape's

  // Runs a grid pass into a target.
  function pass(prog, target, values) {
    use(prog, values);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let width = 0;
  let height = 0;
  let aspect = 16 / 9;
  let builtFor = "";
  let sim = null; // the fields, grains and meshes, made for the box's shape
  let half = [0, 0];
  let time = 0;
  let round = 0;
  let energy = DEFAULT_ENERGY;
  let energyTarget = DEFAULT_ENERGY;
  let drift = [0, 0]; // how far the wind has carried the rolling folds
  // The velocity pass only sets where the colours fall, and the water moves
  // under a pixel a frame, so it's redrawn every other frame; the texture
  // keeps it in between. A fresh texture (after a resize) needs it at once.
  let velocityDue = true;
  let out = null; // what it draws into: the two passes, and their depth
  let small = null; // a small copy, for reading back (see readSmall)

  function target(w, h, depth) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (depth) {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, rb, w, h };
  }
  // A texture array with a layer per sheet; fbos is filled by the caller.
  function layered(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, FIELD[0], w, h, LAYERS);
    return { tex, w, h, fbos: new Array(LAYERS).fill(null) };
  }
  // A framebuffer writing one layer of each of these arrays.
  function layerTarget(arrays, layer) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const att = arrays.map((a, i) => {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, a.tex, 0, layer);
      return gl.COLOR_ATTACHMENT0 + i;
    });
    gl.drawBuffers(att);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  }

  function drop(t) {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
    if (t.rb) gl.deleteRenderbuffer(t.rb);
  }

  function release() {
    if (!sim) return;
    const targets = [...sim.vel.all(), ...sim.ink.all(), ...sim.wave.all(), ...sim.pressure.all(),
      ...sim.state.all(), sim.curl, sim.divergence, sim.place, sim.normal, sim.look, sim.shadow];
    for (const t of targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
      if (t.all) gl.deleteFramebuffer(t.all);
    }
    for (const a of [...sim.fold.all(), sim.surf, sim.surfNormal]) {
      gl.deleteTexture(a.tex);
      a.fbos.forEach((fbo) => gl.deleteFramebuffer(fbo));
    }
    gl.deleteVertexArray(sim.water);
    gl.deleteVertexArray(sim.box);
    owned.forEach((b) => gl.deleteBuffer(b));
    owned = [];
  }

  function build() {
    const key = aspect.toFixed(3);
    if (key === builtFor) return;
    builtFor = key;
    release();
    half = [aspect - RIM, 1 - RIM];
    const nx = GRID_X;
    const ny = Math.round((GRID_X * half[1]) / half[0]);
    const field = () => texture(gl, nx, ny, FIELD[0], FIELD[1], gl.LINEAR);

    // The grains start scattered through the box at every age.
    const start = new Float32Array(SIDE * SIDE * 4);
    for (let i = 0; i < SIDE * SIDE; i++) {
      start[i * 4] = (Math.random() * 2 - 1) * (half[0] - 0.004);
      start[i * 4 + 1] = (Math.random() * 2 - 1) * (half[1] - 0.004);
      start[i * 4 + 2] = Math.random();
      start[i * 4 + 3] = Math.random() * 3;
    }
    let first = true;
    const state = pingPong(() => {
      const t = texture(gl, SIDE, SIDE, gl.RGBA32F, gl.FLOAT, gl.NEAREST, first ? start : null);
      first = false;
      return t;
    });
    // Where each bead is in the box and how it looks, written alongside its
    // state (see GRAINS): each state texture has a framebuffer that writes
    // it and these three at once.
    const place = texture(gl, SIDE, SIDE, gl.RGBA32F, gl.FLOAT, gl.NEAREST);
    const normal = texture(gl, SIDE, SIDE, gl.RGBA16F, gl.HALF_FLOAT, gl.NEAREST);
    const look = texture(gl, SIDE, SIDE, gl.RGBA16F, gl.HALF_FLOAT, gl.NEAREST);
    const attachments = [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3];
    for (const t of state.all()) {
      t.all = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.all);
      [t, place, normal, look].forEach((x, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, attachments[i], gl.TEXTURE_2D, x.tex, 0));
      gl.drawBuffers(attachments);
    }

    // The sheets' carried folds (see FOLD_PASS) and their shapes (see
    // SURFACE_PASS): a texture array, a layer per sheet, with a framebuffer
    // per layer (the shapes' writing both their textures at once).
    const sw = nx * 2;
    const sh = ny * 2;
    const fold = pingPong(() => {
      const a = layered(sw, sh);
      a.fbos = a.fbos.map((_, i) => layerTarget([a], i));
      return a;
    });
    const surf = layered(sw, sh);
    const surfNormal = layered(sw, sh);
    surf.fbos = surf.fbos.map((_, i) => layerTarget([surf, surfNormal], i));

    // The shadow map: the depth of what the key light sees first.
    const shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
    const shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // The water's sheet: a vertex at every cell, edge to edge.
    const uvs = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        uvs[(j * nx + i) * 2] = i / (nx - 1);
        uvs[(j * nx + i) * 2 + 1] = j / (ny - 1);
      }
    }
    const indices = new Uint16Array((nx - 1) * (ny - 1) * 6);
    let k = 0;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        indices.set([a, a + 1, a + nx, a + 1, a + nx + 1, a + nx], k);
        k += 6;
      }
    }
    const water = vao(() => {
      buffer(uvs);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      buffer(indices, gl.ELEMENT_ARRAY_BUFFER);
    });
    const corners = boxCorners(half[0], half[1], aspect);
    const box = vao(() => {
      buffer(corners);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
    });

    sim = {
      nx, ny,
      texel: [1 / nx, 1 / ny],
      cell: (2 * half[0]) / nx,
      vel: pingPong(field),
      ink: pingPong(() => texture(gl, nx * INK_DETAIL, ny * INK_DETAIL, FIELD[0], FIELD[1], gl.LINEAR)),
      wave: pingPong(field),
      pressure: pingPong(field),
      curl: field(),
      divergence: field(),
      state, place, normal, look, fold, surf, surfNormal, sw, sh,
      shadow: { tex: shadowTex, fbo: shadowFbo, w: SHADOW_SIZE, h: SHADOW_SIZE },
      light: lightMatrix(half[0], half[1]),
      water, waterCount: indices.length,
      box, boxCount: corners.length / 4,
    };
    // Every field starts still, at zero.
    for (const t of [...sim.ink.all(), ...sim.vel.all(), ...sim.wave.all(), ...sim.pressure.all(), sim.curl, sim.divergence]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    time = 30 + Math.random() * 60;
    // The sheets start with fresh folds.
    for (let i = 0; i < LAYERS; i++) {
      pass(programs.fold, { fbo: sim.fold.read.fbos[i], w: sim.sw, h: sim.sh }, {
        uTexel: [1 / sim.sw, 1 / sim.sh], uCell: sim.cell / 2, uHalf: half, uLayer: i, uReset: 1,
        uTime: time, uEnergy: energy, uDrift: drift, uDt: 0, uVel: sim.vel.read.tex,
        uFold: sim.fold.write.tex, // unread, but bound, so it never points at what's being written
      });
    }
    // The ink starts already marbled: one long step of drifting toward its
    // pattern while the water is still.
    pass(programs.advect, sim.ink.write, {
      uTexel: [sim.texel[0] / INK_DETAIL, sim.texel[1] / INK_DETAIL], uCell: sim.cell, uHalf: half,
      uVel: sim.vel.read.tex, uSrc: sim.ink.read.tex, uDt: 100, uTime: time, uInk: 1,
    });
    sim.ink.swap();
    const steps = Math.round(WARM_UP / WARM_STEP);
    for (let n = 0; n < steps; n++) {
      step(WARM_STEP, n === steps - 1); // the beads only need placing at the end
      if (n % 5 === 4) gl.flush();
    }
    velocityDue = true;
  }

  // One step of the simulation, dt simulated seconds; and, unless not
  // `beads`, the surface's shape and the beads on it.
  function step(dt, beads = true) {
    time += dt;
    round++;
    const e = energy;
    const [hx, hy] = half;
    const grid = { uTexel: sim.texel, uCell: sim.cell, uHalf: half };
    // The wind turns slowly about the box.
    const angle = time * 0.03 + 2 * Math.sin(time * 0.011);
    const blow = 0.04 + 0.32 * e;
    const wind = [Math.cos(angle) * blow, Math.sin(angle) * blow * 0.6];
    // The folds roll along with the wind.
    drift = [drift[0] + wind[0] * 0.45 * dt, drift[1] + wind[1] * 0.45 * dt];
    // The whirlpools wander the box, turning opposite ways.
    const pools = [
      0.62 * hx * Math.sin(time * 0.071), 0.5 * hy * Math.sin(time * 0.113 + 1),
      -0.58 * hx * Math.sin(time * 0.053 + 2), 0.45 * hy * Math.cos(time * 0.089),
    ];
    const pools2 = [
      0.45 * hx * Math.cos(time * 0.083 + 4), -0.55 * hy * Math.sin(time * 0.061 + 3),
      -0.4 * hx * Math.cos(time * 0.097 + 1), -0.5 * hy * Math.cos(time * 0.067 + 5),
    ];
    const turn = 0.3 + 0.5 * e;
    const spin = [turn, -turn * 0.85, -turn * 0.7, turn * 0.75];

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);

    pass(programs.curl, sim.curl, { ...grid, uVel: sim.vel.read.tex });
    pass(programs.force, sim.vel.write, {
      ...grid, uVel: sim.vel.read.tex,
      uTime: time, uDt: dt, uEnergy: e, uWind: wind, uPools: pools, uPools2: pools2, uSpin: spin,
    });
    sim.vel.swap();
    pass(programs.advect, sim.vel.write, { ...grid, uVel: sim.vel.read.tex, uSrc: sim.vel.read.tex, uDt: dt, uTime: time, uInk: 0 });
    sim.vel.swap();
    pass(programs.divergence, sim.divergence, { ...grid, uVel: sim.vel.read.tex });
    for (let i = 0; i < JACOBI; i++) {
      pass(programs.pressure, sim.pressure.write, { ...grid, uPressure: sim.pressure.read.tex, uDivergence: sim.divergence.tex });
      sim.pressure.swap();
    }
    pass(programs.gradient, sim.vel.write, { ...grid, uVel: sim.vel.read.tex, uPressure: sim.pressure.read.tex });
    sim.vel.swap();
    pass(programs.advect, sim.ink.write, { ...grid, uTexel: [sim.texel[0] / INK_DETAIL, sim.texel[1] / INK_DETAIL], uVel: sim.vel.read.tex, uSrc: sim.ink.read.tex, uDt: dt, uTime: time, uInk: 1 });
    sim.ink.swap();

    // The waves take small enough steps to stay steady.
    const steps = Math.max(1, Math.ceil((WAVE_SPEED * dt) / sim.cell / 0.45));
    const slosh = (WAVE_SPEED * Math.PI) / (2 * hx);
    for (let i = 0; i < steps; i++) {
      pass(programs.waves, sim.wave.write, {
        ...grid, uWave: sim.wave.read.tex, uCurl: sim.curl.tex,
        uTime: time - dt + ((i + 1) * dt) / steps, uDt: dt / steps, uEnergy: e, uWind: wind, uSlosh: slosh,
      });
      sim.wave.swap();
    }

    for (let i = 0; i < LAYERS; i++) {
      pass(programs.fold, { fbo: sim.fold.write.fbos[i], w: sim.sw, h: sim.sh }, {
        uTexel: [1 / sim.sw, 1 / sim.sh], uCell: sim.cell / 2, uHalf: half, uLayer: i, uReset: 0,
        uFold: sim.fold.read.tex, uVel: sim.vel.read.tex, uTime: time, uDt: dt, uEnergy: e, uDrift: drift,
      });
    }
    sim.fold.swap();

    if (!beads) return;
    for (let i = 0; i < LAYERS; i++) {
      pass(programs.surface, { fbo: sim.surf.fbos[i], w: sim.sw, h: sim.sh }, {
        uHalf: half, uLayer: i, uFold: sim.fold.read.tex, uWave: sim.wave.read.tex, uCurl: sim.curl.tex,
      });
    }
    pass(programs.grains, { fbo: sim.state.write.all, w: SIDE, h: SIDE }, {
      uSurface: sim.surf.tex, uSurfaceNormal: sim.surfNormal.tex,
      ...grid, uState: sim.state.read.tex, uVel: sim.vel.read.tex, uInk: sim.ink.read.tex,
      uWave: sim.wave.read.tex, uDt: dt, uEnergy: e, uRound: round, uTime: time, uDrift: drift,
      uCurl: sim.curl.tex,
    });
    sim.state.swap();
  }

  const shared = () => ({
    uAspect: aspect, uHalf: half, uTime: time, uEnergy: energy, uLight: sim.light, uDrift: drift,
    uWave: sim.wave.read.tex, uVel: sim.vel.read.tex, uInk: sim.ink.read.tex, uShadow: sim.shadow.tex,
    uPlace: sim.place.tex, uNormal: sim.normal.tex, uLook: sim.look.tex,
    uSurface: sim.surf.tex, uSurfaceNormal: sim.surfNormal.tex,
  });

  // The shadow map: the water's body seen from the key light.
  function drawShadows() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, sim.shadow.fbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    // It can't read what it's drawing: its shadow sampler gets a stand-in, as
    // left unset it would still point at the shadow map from the last frame,
    // and WebGL refuses the draw.
    const values = { ...shared(), uShadow: sim.curl.tex };
    for (let i = 0; i < LAYERS; i++) {
      use(programs.water, { ...values, uShadowPass: 1, uVelocity: 0, uLayer: i });
      gl.bindVertexArray(sim.water);
      gl.drawElements(gl.TRIANGLES, sim.waterCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  // Draws one pass into the half of the texture that starts y pixels up.
  function draw(y, velocity) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.viewport(0, y, width, height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, y, width, height);
    if (velocity) gl.clearColor(1, 0, 0, 1);
    else gl.clearColor(0.93, 0.93, 0.93, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    const values = { ...shared(), uVelocity: velocity ? 1 : 0, uShadowPass: 0, uPixels: height / 2 };
    use(programs.box, values);
    gl.bindVertexArray(sim.box);
    gl.drawArrays(gl.TRIANGLES, 0, sim.boxCount);

    for (let i = 0; i < LAYERS; i++) {
      use(programs.water, { ...values, uLayer: i });
      gl.bindVertexArray(sim.water);
      gl.drawElements(gl.TRIANGLES, sim.waterCount, gl.UNSIGNED_SHORT, 0);
    }

    use(programs.grain, values);
    gl.bindVertexArray(empty);
    gl.drawArrays(gl.POINTS, 0, SIDE * SIDE);
  }

  return {
    /** The two passes: the render in the top half, its velocity pass below. */
    get texture() { return out ? out.tex : null; },
    /** Each pass's size in pixels (the texture is twice as tall). */
    get width() { return width; },
    get height() { return height; },

    resize(w, h) {
      w = Math.max(2, Math.round(w));
      h = Math.max(2, Math.round(h));
      if (w === width && h === height) return;
      width = w;
      height = h;
      aspect = w / h;
      drop(out);
      out = target(w, h * 2, true);
      velocityDue = true;
    },

    /** The wind in km/h, or null for the water's usual roughness. */
    setWind(kph) {
      energyTarget = Number.isFinite(kph) ? Math.min(Math.max(kph, 0) / FULL_WIND_KPH, 1) : DEFAULT_ENERGY;
    },

    /** How fast the water's clock runs in this wind, in seconds per second. */
    paceFor(kph) {
      const e = Number.isFinite(kph) ? Math.min(Math.max(kph, 0) / FULL_WIND_KPH, 1) : DEFAULT_ENERGY;
      return CALM_PACE + (FULL_PACE - CALM_PACE) * e;
    },

    /** Moves the water on by dt real seconds and draws it (see velocityDue). */
    render(dt) {
      if (!width || !height) return;
      // Its own uploads are raw data, never flipped.
      const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
      const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      build();
      dt = Math.min(Math.max(dt || 0, 0), 0.1); // a stalled tab doesn't jump ahead
      // The wind changes gradually, and the pace with it.
      energy += (energyTarget - energy) * (1 - Math.exp(-dt / 2.5));
      const simDt = Math.min(dt, 1 / 30) * (CALM_PACE + (FULL_PACE - CALM_PACE) * energy);
      if (simDt > 0) step(simDt);

      drawShadows();
      draw(height, false); // the render, in the top half
      if (velocityDue) draw(0, true); // its velocity pass, below
      velocityDue = !velocityDue;

      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(null);
      gl.activeTexture(gl.TEXTURE0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    },

    /**
     * Both passes scaled down to w × h each and read back as RGBA bytes,
     * bottom row first: { main, velocity }, pixel for pixel alike.
     *
     * Unless `now`, it doesn't wait for the GPU, which would stall drawing:
     * it starts a read and hands back the last one finished, a frame or two
     * old (null until the first is). With `now` it reads and waits.
     */
    readSmall(w, h, now = false) {
      if (!out) return null;
      if (!small || small.w !== w || small.h !== h * 2) {
        drop(small);
        if (small?.pbo) gl.deleteBuffer(small.pbo);
        if (small?.fence) gl.deleteSync(small.fence);
        small = target(w, h * 2, false);
        small.pixels = new Uint8Array(w * h * 2 * 4);
        small.pbo = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, small.pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, small.pixels.byteLength, gl.STREAM_READ);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        small.ready = false;
        small.fence = null;
      }
      const n = w * h * 4;
      const result = () => ({ velocity: small.pixels.subarray(0, n), main: small.pixels.subarray(n, 2 * n) });

      // Collect the read in flight, if the GPU has finished it.
      if (small.fence) {
        const state = gl.clientWaitSync(small.fence, 0, 0);
        if (state === gl.ALREADY_SIGNALED || state === gl.CONDITION_SATISFIED) {
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, small.pbo);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, small.pixels);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          gl.deleteSync(small.fence);
          small.fence = null;
          small.ready = true;
        } else if (!now) {
          return small.ready ? result() : null;
        }
      }

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, out.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, small.fbo);
      gl.blitFramebuffer(0, 0, out.w, out.h, 0, 0, small.w, small.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, small.fbo);
      if (now) {
        if (small.fence) { gl.deleteSync(small.fence); small.fence = null; }
        gl.readPixels(0, 0, small.w, small.h, gl.RGBA, gl.UNSIGNED_BYTE, small.pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        small.ready = true;
        return result();
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, small.pbo);
      gl.readPixels(0, 0, small.w, small.h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      small.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      return small.ready ? result() : null;
    },

    dispose() {
      release();
      drop(out);
      if (small?.pbo) gl.deleteBuffer(small.pbo);
      if (small?.fence) gl.deleteSync(small.fence);
      drop(small);
      for (const prog of Object.values(programs)) gl.deleteProgram(prog.p);
      gl.deleteVertexArray(quad);
      gl.deleteVertexArray(empty);
      quadBuffers.forEach((b) => gl.deleteBuffer(b));
    },
  };
}
