/**
 * The Fabric artwork, generated live: one panel of cloth per band, side by
 * side with a sharp line between them, each a sheet of tiny lit beads that
 * slowly folds and crumples, drawn with WebGL into the given canvas. Each
 * panel is tinted with its band's temperature color, has folds of its own and
 * moves in its own way (see MOTIONS), driven by its band's wind.
 *
 * A panel is a flat sheet of beads pushed around by layered 3D noise: a broad
 * layer folds it over itself and a finer one wrinkles it, then the panel's
 * motion moves it. Each panel runs on its own clock, ticking faster the
 * windier its city, and the wind also makes its motion bigger, so a calm city
 * barely stirs while a windy one heaves. Every bead is shaded twice, once by
 * the fold it sits on (so the folds read) and once as a little sphere (so the
 * surface looks beaded).
 *
 * `getBands` returns one { color: [r, g, b], windKph } per band, or nothing
 * for a band whose weather hasn't arrived yet. Read from CSS on the canvas:
 * --art-rows (1 when the bands are stacked as rows, as on phones).
 */
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MAX_BANDS = 5;
const WAITING_COLOR = [150, 156, 170];

// The view is 2 units tall at the sheet. Each panel's sheet reaches this far
// past its panel so the folds never pull it inside.
const SHEET_MARGIN = 0.75;
const SPACING = 0.0088; // between beads on the flat sheet
const BEAD = 1.7 * SPACING; // bead diameter: a little over the spacing, so the cloth reads as closed
const FOV = (30 * Math.PI) / 180;
// Wind speed (km/h) at which a panel is fully stirred; calmer is gentler,
// down to still air.
const FULL_WIND_KPH = 40;
// How fast a panel's clock runs, in seconds per second, in still air and at
// full wind.
const CALM_PACE = 0.3;
const FULL_PACE = 2.2;
// The panels' motions, in band order (see motion() in the shader).
const MOTIONS = ["billow", "wave", "swirl", "flutter", "drift"];
// The black line between panels, in the screen's own pixels: one is the
// finest line the screen can show.
const DIVIDER = 1;

/**
 * The beads of one panel's sheet, w by h units around its centre: their flat
 * positions (jittered off a grid so no pattern shows) and a random number each.
 */
function sheet(w, h) {
  const cols = Math.ceil(w / SPACING);
  const rows = Math.ceil(h / SPACING);
  const flat = new Float32Array(cols * rows * 2);
  const rand = new Float32Array(cols * rows);
  for (let r = 0, i = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++, i++) {
      flat[i * 2] = (c + Math.random()) * SPACING - w / 2;
      flat[i * 2 + 1] = (r + Math.random()) * SPACING - h / 2;
      rand[i] = Math.random();
    }
  }
  return { flat, rand, count: cols * rows };
}

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

const VERTEX = /* glsl */ `
  attribute vec2 aFlat; // where the bead sits on its panel's flat sheet
  attribute float aRand;
  uniform float uTime; // the panel's own clock (see CALM_PACE)
  uniform int uMotion; // which of MOTIONS the panel moves with
  uniform float uFocal; // 1 / tan(half the field of view)
  uniform float uAspect;
  uniform float uDistance; // from the camera to the sheet
  uniform vec2 uDrift; // the camera's slow sway
  uniform float uPixels; // the canvas height in pixels, halved
  uniform float uBead;
  uniform vec2 uCenter; // the panel's centre on the screen, in view units
  uniform vec2 uSeed; // where in the noise this panel's folds come from
  uniform float uWind; // the panel's wind, 0 (still) to 1 (full)
  varying vec3 vNormal;
  varying float vShadow;
  varying float vRand;

  ${NOISE}

  vec3 noise3(vec3 q) {
    return vec3(snoise(q), snoise(q + vec3(31.4, 0.0, 0.0)), snoise(q + vec3(0.0, 47.2, 0.0)));
  }

  // Where the panel carries a point of its sheet: broad folds that lay it
  // over itself and wrinkles, then the panel's motion on top, as big as its
  // wind (a little even in still air).
  vec3 fold(vec2 s) {
    float t = uTime;
    float a = 0.2 + 0.8 * uWind;
    vec2 q = s + uSeed;
    // drift: the folds slide sideways across the panel, like cloth on a line
    // in a steady wind.
    if (uMotion == 4) q.x -= t * 0.25;

    vec3 p = vec3(s, 0.0);
    p += noise3(vec3(q * 0.55, t * 0.08)) * vec3(0.55, 0.55, 1.1);
    p += noise3(vec3(q * 1.6, t * 0.13 + 10.0)) * vec3(0.15, 0.15, 0.36);

    if (uMotion == 0) {
      // billow: great slow swells rising and falling under the cloth.
      p += noise3(vec3(q * 0.3, t * 0.35 + 40.0)) * vec3(0.08, 0.08, 0.75) * a;
    } else if (uMotion == 1) {
      // wave: ripples running up the panel, like a flag.
      float phase = q.y * 2.6 - t * 2.2 + snoise(vec3(q * 0.5, t * 0.15 + 50.0)) * 1.6;
      p.z += sin(phase) * 0.16 * a;
      p.y += cos(phase) * 0.04 * a;
    } else if (uMotion == 2) {
      // swirl: the cloth twists round the middle of the panel, one way then
      // the other.
      float turn = sin(t * 0.55) * 0.5 * a / (1.0 + dot(s, s) * 1.5);
      p.xy = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * p.xy;
      p.z += snoise(vec3(q * 0.9, t * 0.3 + 60.0)) * 0.25 * a;
    } else if (uMotion == 3) {
      // flutter: a fast, fine shiver all over.
      p += noise3(vec3(q * 3.2, t * 1.6 + 70.0)) * vec3(0.025, 0.025, 0.11) * a;
    } else {
      // drift: low gusts lifting the sliding folds.
      p.z += snoise(vec3(q * 0.8, t * 0.4 + 80.0)) * 0.3 * a;
    }
    return p;
  }

  void main() {
    const float e = 0.01;
    vec3 p = fold(aFlat);
    vec3 du = fold(aFlat + vec2(e, 0.0)) - p;
    vec3 dv = fold(aFlat + vec2(0.0, e)) - p;
    vec3 n = normalize(cross(du, dv));
    // Where a fold turns the sheet away, its underside is what shows, in the
    // fold's shadow.
    float under = step(n.z, 0.0);
    vNormal = n * (1.0 - 2.0 * under);
    vShadow = mix(0.38, 1.0, smoothstep(-1.0, 0.55, p.z)) * mix(1.0, 0.7, under);
    vRand = aRand;

    // The camera looks straight down -z from in front of the sheets.
    vec3 v = p + vec3(uCenter - uDrift, -uDistance);
    const float near = 0.1;
    const float far = 20.0;
    gl_Position = vec4(
      v.x * uFocal / uAspect,
      v.y * uFocal,
      v.z * (far + near) / (near - far) + 2.0 * far * near / (near - far),
      -v.z
    );
    // Beads grow where the sheet stretches, so it never opens up.
    float stretch = clamp(sqrt(length(cross(du, dv)) / (e * e)), 1.0, 1.4);
    gl_PointSize = uBead * (0.85 + 0.3 * aRand) * stretch * uFocal * uPixels / -v.z;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uColor; // the panel's band color, 0–1
  varying vec3 vNormal;
  varying float vShadow;
  varying float vRand;

  // The overlay blend mode: darkens where the base is dark, lightens where
  // it is light, keeping the base's contrast under the blend color.
  vec3 overlay(vec3 base, vec3 blend) {
    return mix(2.0 * base * blend, 1.0 - 2.0 * (1.0 - base) * (1.0 - blend), step(0.5, base));
  }

  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    vec3 sphere = vec3(c.x, -c.y, sqrt(1.0 - r2)); // the bead's own surface

    // Soft studio light from the upper left, in front.
    vec3 light = normalize(vec3(-0.35, 0.65, 0.68));
    float fold = clamp(dot(vNormal, light) * 0.6 + 0.45, 0.0, 1.0);
    float bead = max(dot(sphere, light), 0.0);
    float contact = mix(0.55, 1.0, sphere.z); // shade where beads meet
    float shine = pow(max(dot(reflect(-light, sphere), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * 0.25;
    float lum = (0.12 + 0.88 * fold) * (0.45 + 0.55 * bead) * contact * vShadow + shine * fold;
    lum *= 0.94 + 0.12 * vRand;

    // The band color over the cloth's light and shade: the brightness is
    // first eased into a middle range so highlights stay colored and shadows
    // don't sink to black.
    float shade = mix(0.25, 0.68, smoothstep(0.05, 0.9, lum));
    gl_FragColor = vec4(overlay(vec3(shade), uColor * 0.86), 1.0);
  }
`;

export function startFabricArt(canvas, getBands) {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: true, premultipliedAlpha: true });
  if (!gl) return () => {};

  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  gl.useProgram(program);
  const u = (name) => gl.getUniformLocation(program, name);

  const flatBuffer = gl.createBuffer();
  const randBuffer = gl.createBuffer();
  for (const [name, buffer, size] of [["aFlat", flatBuffer, 2], ["aRand", randBuffer, 1]]) {
    const at = gl.getAttribLocation(program, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, size, gl.FLOAT, false, 0, 0);
  }
  let count = 0;
  let sheetKey = "";

  gl.enable(gl.DEPTH_TEST);
  const focal = 1 / Math.tan(FOV / 2);
  gl.uniform1f(u("uFocal"), focal);
  gl.uniform1f(u("uDistance"), focal); // so the view is 2 units tall at the sheet
  gl.uniform1f(u("uBead"), BEAD);

  // Each panel's own place in the noise, so no two fold alike.
  const seeds = Array.from({ length: MAX_BANDS }, (_, i) => [17.3 * (i + 1), -9.1 * (i + 1)]);
  let colors = [];
  let winds = [];
  const clocks = Array.from({ length: MAX_BANDS }, (_, i) => 100 * i); // each panel's own time
  let last = performance.now();
  let frame = 0;
  let drawnKey = "";

  function draw(ms) {
    frame = requestAnimationFrame(draw);

    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    const aspect = w / h;
    const rows = parseFloat(getComputedStyle(canvas).getPropertyValue("--art-rows")) || 0;

    // Ease toward the latest colors and winds, at the same pace on slow frames.
    const bands = getBands().slice(0, MAX_BANDS);
    if (!bands.length) bands.push(null);
    const n = bands.length;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-(ms - last) / 450);
    const windEase = reducedMotion ? 1 : 1 - Math.exp(-(ms - last) / 2500);
    const dt = Math.min(Math.max(ms - last, 0), 100) / 1000; // a stalled tab doesn't jump ahead
    last = ms;
    colors = bands.map((b, i) => {
      const target = b?.color ?? WAITING_COLOR;
      return (colors[i] ?? target).map((c, j) => c + (target[j] - c) * ease);
    });
    winds = bands.map((b, i) => {
      const target = Math.min((b?.windKph ?? 0) / FULL_WIND_KPH, 1);
      return (winds[i] ?? 0) + (target - (winds[i] ?? 0)) * windEase;
    });
    // Each panel's clock runs at its wind's pace; the wind eases, so the pace
    // does too.
    if (!reducedMotion) winds.forEach((wind, i) => (clocks[i] += dt * (CALM_PACE + (FULL_PACE - CALM_PACE) * wind)));

    // One sheet, the size of a panel and its margin, drawn once per panel. A
    // new one when the screen's shape or the number of panels changes.
    const panelW = rows ? 2 * aspect : (2 * aspect) / n;
    const panelH = rows ? 2 / n : 2;
    const key = `${panelW.toFixed(2)}x${panelH.toFixed(2)}`;
    if (key !== sheetKey) {
      sheetKey = key;
      const s = sheet(panelW + 2 * SHEET_MARGIN, panelH + 2 * SHEET_MARGIN);
      count = s.count;
      gl.bindBuffer(gl.ARRAY_BUFFER, flatBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, s.flat, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, randBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, s.rand, gl.STATIC_DRAW);
    }

    // With reduced motion the cloth holds still, so it's only redrawn when
    // something it shows changes.
    const frameKey = `${colors.map((c) => c.map(Math.round))}|${winds.map((v) => v.toFixed(2))}|${w}x${h}|${rows}`;
    if (reducedMotion && frameKey === drawnKey) return;
    drawnKey = frameKey;

    const t = reducedMotion ? 0 : ms / 1000;
    gl.viewport(0, 0, w, h);
    gl.uniform1f(u("uAspect"), aspect);
    gl.uniform1f(u("uPixels"), h / 2);
    gl.uniform2f(u("uDrift"), Math.sin(t * 0.03) * 0.05, Math.cos(t * 0.025) * 0.03);

    // Black, which shows as the lines between the panels.
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    const half = DIVIDER / 2;
    const length = rows ? h : w;
    for (let i = 0; i < n; i++) {
      // The panel in pixels along the screen, less half the line on each
      // inner side; WebGL counts rows from the bottom.
      const a = Math.round((i * length) / n + (i ? half : 0));
      const b = Math.round(((i + 1) * length) / n - (i < n - 1 ? half : 0));
      if (rows) gl.scissor(0, h - b, w, b - a);
      else gl.scissor(a, 0, b - a, h);

      // Behind the beads, the band's color at its deepest shade, so any gap
      // between them reads as a dark crease rather than showing the page.
      const color = colors[i].map((c) => c / 255);
      const deep = color.map((c) => 2 * 0.25 * c * 0.86);
      gl.clearColor(deep[0], deep[1], deep[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform3f(u("uColor"), ...color);
      gl.uniform1f(u("uWind"), winds[i]);
      gl.uniform1f(u("uTime"), clocks[i]);
      gl.uniform1i(u("uMotion"), i % MOTIONS.length);
      gl.uniform2f(u("uSeed"), ...seeds[i]);
      gl.uniform2f(u("uCenter"), rows ? 0 : -aspect + (i + 0.5) * panelW, rows ? 1 - (i + 0.5) * panelH : 0);
      gl.drawArrays(gl.POINTS, 0, count);
    }
    gl.disable(gl.SCISSOR_TEST);
  }
  frame = requestAnimationFrame(draw);

  return function stop() {
    cancelAnimationFrame(frame);
    gl.deleteBuffer(flatBuffer);
    gl.deleteBuffer(randBuffer);
    gl.deleteProgram(program);
  };
}
