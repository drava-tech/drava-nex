/**
 * The Particles artwork: a looping film of beaded cloth, drawn with WebGL into
 * the given canvas and tinted one band at a time, side by side, with a color
 * for each band's temperature. The bands melt into each other across soft
 * seams that wander with slow noise. Until the video arrives the bands show
 * their color alone.
 *
 * `getBands` returns one { tempC } per band, or nothing for a band whose
 * weather hasn't arrived yet. Read from CSS on the canvas: --art-rows
 * (1 when the bands are stacked as rows, as on phones).
 */
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MAX_BANDS = 5;
const WAITING_COLOR = [150, 156, 170];

// In the R2 video bucket; its ends are cross-dissolved, so it loops cleanly.
const VIDEO_URL = "/api/drava-mosaic/video?name=particle_fabric.mp4"; // nex: streamed same-origin by the API.
const VIDEO_ASPECT = 16 / 9; // until the video says otherwise
const PLAYBACK_RATE = 0.75;
const RETRY_MS = 5000;
// Temperature → tint (°C). Much purer than the bands' colors in clock.js: the
// shader brightens the tint, and anything less pure washes out to pastel.
const TINT_STOPS = [
  [-20, [0, 51, 204]],
  [-10, [0, 82, 245]],
  [0, [0, 128, 255]],
  [7, [0, 183, 255]],
  [14, [0, 168, 245]],
  [16, [0, 204, 184]],
  [18, [0, 204, 0]],
  [20, [230, 222, 0]],
  [23, [255, 179, 0]],
  [27, [255, 100, 10]],
  [32, [255, 10, 10]],
  [40, [194, 0, 26]],
];
// How fast the seams wander, in noise units per second.
const SEAM_DRIFT = 0.48;

export function tintFor(t) {
  if (t <= TINT_STOPS[0][0]) return TINT_STOPS[0][1];
  for (let i = 1; i < TINT_STOPS.length; i++) {
    const [t1, c1] = TINT_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = TINT_STOPS[i - 1];
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => v + (c1[j] - v) * k);
    }
  }
  return TINT_STOPS[TINT_STOPS.length - 1][1];
}

const VERTEX = /* glsl */ `
  attribute vec2 aPosition;
  varying vec2 vUv;

  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D uVideo;
  uniform vec2 uCover; // how much of the film the screen shows, so it fills without stretching
  uniform vec2 uTexel; // one pixel of the film
  uniform float uCount; // how many bands there are
  uniform float uRows; // 1 when the bands are stacked as rows
  uniform float uSeamTime; // how far the seams have wandered
  uniform vec3 uColors[${MAX_BANDS}]; // each band's tint, 0–1
  varying vec2 vUv;

  const vec3 LUMA = vec3(0.299, 0.587, 0.114);
  const float SEAM = 0.12; // how far a seam blends to each side, in screens
  const float SEAM_WANDER = 0.092; // how far a seam strays, in screens
  const float SEAM_SCALE = 3.0;
  const float TINT = 0.92; // how much of the result is the tint, not the film

  float hash(vec2 p) {
    p = fract(mod(p, 289.0) * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // Four layers of noise, each finer and fainter than the last.
  float layered(vec2 p) {
    float sum = 0.0;
    float size = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += size * noise(p);
      p *= 2.02;
      size *= 0.5;
    }
    return sum / 0.9375;
  }

  // The film's color grade, ahead of the tint: richer, with the highlights
  // lifted, the shadows sunk and the contrast raised, so the folds read.
  vec3 grade(vec3 c) {
    float lum = dot(c, LUMA);
    c = mix(vec3(lum), c, 1.65);
    float high = max(c.r, max(c.g, c.b));
    float low = min(c.r, min(c.g, c.b));
    float saturation = high < 0.001 ? 0.0 : (high - low) / high;
    c = mix(vec3(lum), c, 2.0 - saturation);
    c += (1.0 - c) * max(lum - 0.5, 0.0) * 2.0;
    c *= 1.0 - 0.8 * max(0.5 - lum, 0.0) * 2.0;
    c = (c * 0.93 - 0.5) * 1.29 + 0.5;
    return clamp(c, 0.0, 1.0);
  }

  void main() {
    // Where this point falls among the bands, the seams pushed about by noise.
    float along = uRows > 0.5 ? 1.0 - vUv.y : vUv.x;
    float across = uRows > 0.5 ? vUv.x : vUv.y;
    float wander = layered(vec2(
      across * SEAM_SCALE + uSeamTime * 0.35,
      along * SEAM_SCALE * 0.55 + uSeamTime * 0.15
    ));
    float place = clamp(along + (wander - 0.5) * 2.0 * SEAM_WANDER, 0.0, 1.0);

    // Each band's share of this point, and from them the tint.
    vec3 tint = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < ${MAX_BANDS}; i++) {
      float n = float(i);
      if (n >= uCount) break;
      float share = smoothstep(n / uCount - SEAM, n / uCount + SEAM, place)
        * (1.0 - smoothstep((n + 1.0) / uCount - SEAM, (n + 1.0) / uCount + SEAM, place));
      tint += uColors[i] * share;
      total += share;
    }
    tint /= total;

    vec2 uv = 0.5 + (vUv - 0.5) * uCover;

    // Sharpened against its neighbours, so the beads stay crisp.
    vec3 film = texture2D(uVideo, uv).rgb;
    vec3 blur = (texture2D(uVideo, uv + vec2(uTexel.x, 0.0)).rgb + texture2D(uVideo, uv - vec2(uTexel.x, 0.0)).rgb
      + texture2D(uVideo, uv + vec2(0.0, uTexel.y)).rgb + texture2D(uVideo, uv - vec2(0.0, uTexel.y)).rgb) * 0.25;
    vec3 graded = grade(clamp(film + film - blur, 0.0, 1.0));

    // The tint carried by the cloth's light and shade, its brightest beads
    // washing out toward white, with a trace of the plain film left in.
    float lum = dot(graded, LUMA);
    vec3 tinted = tint * (0.5 + 1.1 * pow(lum, 0.85));
    tinted = mix(tinted, vec3(1.0), smoothstep(0.85, 1.0, lum) * 0.62);
    gl_FragColor = vec4(clamp(mix(graded, clamp(tinted, 0.0, 1.0), TINT), 0.0, 1.0), 1.0);
  }
`;

export function startParticleArt(canvas, getBands) {
  // The landing page's preview shares its canvas, and so this context, with
  // the fabric, so this asks for what the fabric needs and undoes what it left on.
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: true, premultipliedAlpha: true });
  if (!gl) return () => {};
  gl.disable(gl.DEPTH_TEST);
  for (let i = 0; i < gl.getParameter(gl.MAX_VERTEX_ATTRIBS); i++) gl.disableVertexAttribArray(i);

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

  const quad = gl.createBuffer();
  const at = gl.getAttribLocation(program, "aPosition");
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);

  // One black pixel until the video has a frame to show.
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const video = Object.assign(document.createElement("video"), {
    crossOrigin: "anonymous",
    muted: true,
    loop: true,
    playsInline: true,
    preload: "auto",
    defaultPlaybackRate: PLAYBACK_RATE, // kept through a reload, unlike playbackRate
    playbackRate: PLAYBACK_RATE,
    src: VIDEO_URL,
  });
  const play = () => {
    if (!reducedMotion) video.play().catch(() => {});
  };
  play();
  // A failed load is final for a video, so keep trying until the network's back.
  let retry = 0;
  const onError = () => {
    clearTimeout(retry);
    retry = setTimeout(() => {
      video.load();
      play();
    }, RETRY_MS);
  };
  video.addEventListener("error", onError);
  let uploaded = -1; // the video time now on the texture

  let colors = [];
  const colorData = new Float32Array(MAX_BANDS * 3);
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

    // Ease toward the latest colors, at the same pace on slow frames.
    const bands = getBands().slice(0, MAX_BANDS);
    if (!bands.length) bands.push(null);
    const n = bands.length;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-(ms - last) / 450);
    last = ms;
    colors = bands.map((b, i) => {
      const target = b ? tintFor(b.tempC) : WAITING_COLOR;
      return (colors[i] ?? target).map((c, j) => c + (target[j] - c) * ease);
    });

    // A new frame of the film, if there is one.
    if (video.readyState >= 2 && video.currentTime !== uploaded) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      uploaded = video.currentTime;
    }

    // With reduced motion the cloth holds still, so it's only redrawn when
    // something it shows changes.
    const frameKey = `${colors.map((c) => c.map(Math.round))}|${w}x${h}|${rows}|${uploaded}`;
    if (reducedMotion && frameKey === drawnKey) return;
    drawnKey = frameKey;

    gl.viewport(0, 0, w, h);
    const videoAspect = video.videoWidth ? video.videoWidth / video.videoHeight : VIDEO_ASPECT;
    gl.uniform2f(u("uCover"), Math.min(aspect / videoAspect, 1), Math.min(videoAspect / aspect, 1));
    gl.uniform2f(u("uTexel"), 1 / (video.videoWidth || 1920), 1 / (video.videoHeight || 1080));
    gl.uniform1f(u("uCount"), n);
    gl.uniform1f(u("uRows"), rows);
    gl.uniform1f(u("uSeamTime"), reducedMotion ? 0 : (ms / 1000) * SEAM_DRIFT);
    colors.forEach((c, i) => colorData.set(c.map((v) => v / 255), i * 3));
    gl.uniform3fv(u("uColors[0]"), colorData);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  frame = requestAnimationFrame(draw);

  return function stop() {
    cancelAnimationFrame(frame);
    clearTimeout(retry);
    video.removeEventListener("error", onError);
    // Dropping the source stops the download as well as the playback.
    video.pause();
    video.removeAttribute("src");
    video.load();
    gl.deleteBuffer(quad);
    gl.deleteTexture(texture);
    gl.deleteProgram(program);
  };
}
