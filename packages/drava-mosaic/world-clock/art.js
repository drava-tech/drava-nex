/**
 * The live artwork behind the bands: assets/world_map.glb drawn as a field of
 * white point particles sampled over its land surface on black, seen at a slight tilt with a slow camera sway. The countries in the bands light up in their band's
 * temperature color with a pulse rippling out from each city; a 2D overlay
 * adds a ring and a label at each city.
 *
 * `bands` is the clock's band list; each entry's `place` gives the country
 * (iso) and city (lat/lon), and `art` holds the live inputs ({ color }) that
 * clock.js updates whenever new weather arrives.
 */
import { regionOf, toModel } from "./mapWarp.js";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const WAITING_COLOR = [150, 156, 170];
const MAX_BANDS = 5;
const PARTICLES = 70000;
// Sizes below are for a 1440px-wide screen and grow with larger screens (see
// `k` in layout()), so the labels and dots keep their proportion on a 4K display.
const LABEL_FONT = (k) => `600 ${11 * k}px Inter, system-ui, sans-serif`;
const LABEL_PAD = 9;

// Model units → scene units, and the model's land extent (x/z, north is -z).
const SCALE = 1 / 1000;
const EXTENT = { minX: -6297.2, maxX: 6910.4, minZ: -2806.0, maxZ: 3893.2 };
const CENTER_X = (EXTENT.minX + EXTENT.maxX) / 2;
const CENTER_Z = (EXTENT.minZ + EXTENT.maxZ) / 2;

const TILT = 0.55; // radians from straight down
const SWAY = 0.07; // radians of slow side-to-side camera drift

// Loaded once and shared by every clock view: three.js, the GLB's land
// surface sampled into particles, and country outlines for highlighting.
let assets;
function loadAssets() {
  assets ??= (async () => {
    const [THREE, { GLTFLoader }, { MeshSurfaceSampler }, topojson, { default: world }, { default: glbUrl }] =
      await Promise.all([
        import("three"),
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/math/MeshSurfaceSampler.js"),
        import("topojson-client"),
        import("world-atlas/countries-110m.json"),
        import("./assets/world_map.glb?url"),
      ]);

    const gltf = await new GLTFLoader().loadAsync(glbUrl);
    let flat;
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.name.startsWith("WorldFlat")) flat = o;
    });
    // Sampled in the mesh's own coordinates, which is what mapWarp.js maps to.
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(flat.geometry)).build();
    const model = new Float32Array(PARTICLES * 3);
    const p = new THREE.Vector3();
    for (let i = 0; i < PARTICLES; i++) {
      sampler.sample(p);
      model.set([p.x, p.y, p.z], i * 3);
    }

    const countries = new Map(topojson.feature(world, world.objects.countries).features.map((f) => [f.id, f.geometry]));
    return { THREE, model, countries };
  })();
  return assets;
}

// A country's outline in model x/z, as rings with bounding boxes.
function countryRings(geometry, place) {
  if (!geometry) return [];
  const region = regionOf(place.lon, place.lat);
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flat().map((ring) => {
    const pts = ring.map(([lon, lat]) => toModel(lon, lat, region));
    const xs = pts.map((q) => q[0]);
    const zs = pts.map((q) => q[1]);
    return { pts, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  });
}

function inside(rings, x, z) {
  let hit = false;
  for (const { pts, box } of rings) {
    if (x < box[0] || x > box[2] || z < box[1] || z > box[3]) continue;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i];
      const [xj, zj] = pts[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
  }
  return hit;
}

const VERTEX = /* glsl */ `
  attribute float aBand;
  attribute float aRand;
  attribute float aDist;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec3 uColors[${MAX_BANDS}];
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    float twinkle = 0.5 + 0.5 * sin(uTime * 1.3 + aRand * 40.0);
    if (aBand < -0.5) {
      vColor = vec3(1.0);
      vAlpha = 0.32 + 0.18 * twinkle;
      gl_PointSize = 1.6 * uPixelRatio;
    } else {
      // Pulse rippling outward from the city.
      float wave = 0.5 + 0.5 * sin(uTime * 2.4 - aDist * 6.0);
      vColor = mix(uColors[int(aBand + 0.5)], vec3(1.0), 0.2);
      vAlpha = 0.6 + 0.4 * wave;
      gl_PointSize = (2.4 + 1.3 * wave) * uPixelRatio;
      p.y += 0.05 * wave;
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.15, d));
  }
`;

export function startArt(canvas, bands) {
  const overlay = document.createElement("canvas");
  overlay.className = "art";
  overlay.setAttribute("aria-hidden", "true");
  canvas.after(overlay);
  const ctx = overlay.getContext("2d");

  // The GLB's CC BY 4.0 licence requires credit.
  const credit = document.createElement("span");
  credit.className = "credit";
  credit.textContent = "World Map by Daniel.Riches · CC BY 4.0";
  overlay.after(credit);

  let stopped = false;
  let frame = 0;
  let cleanup = () => {};

  loadAssets()
    .then((a) => {
      if (!stopped) cleanup = run(a);
    })
    .catch((err) => console.error("World map failed to load", err));

  function run({ THREE, model, countries }) {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 400);
    const scenePoint = (x, z) => new THREE.Vector3((x - CENTER_X) * SCALE, 0, (z - CENTER_Z) * SCALE);

    // Particles in scene units, tagged with the band whose country they fall in.
    const rings = bands.map((b) => countryRings(countries.get(b.place.iso), b.place));
    const cities = bands.map((b) => toModel(b.place.lon, b.place.lat));
    const position = new Float32Array(PARTICLES * 3);
    const band = new Float32Array(PARTICLES).fill(-1);
    const rand = new Float32Array(PARTICLES);
    const dist = new Float32Array(PARTICLES);
    for (let i = 0; i < PARTICLES; i++) {
      const x = model[i * 3];
      const z = model[i * 3 + 2];
      position.set([(x - CENTER_X) * SCALE, model[i * 3 + 1] * SCALE, (z - CENTER_Z) * SCALE], i * 3);
      rand[i] = Math.random();
      // A country with several picked cities is shared out: each point goes
      // to the nearest of them.
      let owner = -1;
      let best = Infinity;
      rings.forEach((r, k) => {
        const d = Math.hypot(x - cities[k][0], z - cities[k][1]);
        if (d < best && inside(r, x, z)) {
          owner = k;
          best = d;
        }
      });
      if (owner >= 0) {
        band[i] = owner;
        dist[i] = Math.hypot(x - cities[owner][0], z - cities[owner][1]) * SCALE;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("aBand", new THREE.BufferAttribute(band, 1));
    geometry.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
    geometry.setAttribute("aDist", new THREE.BufferAttribute(dist, 1));
    const uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uColors: { value: Array.from({ length: MAX_BANDS }, () => new THREE.Color()) },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms,
      transparent: true,
      depthWrite: false,
    });
    scene.add(new THREE.Points(geometry, material));

    const cityPoints = cities.map(([x, z]) => scenePoint(x, z));
    const corners = [
      scenePoint(EXTENT.minX, EXTENT.minZ),
      scenePoint(EXTENT.maxX, EXTENT.minZ),
      scenePoint(EXTENT.minX, EXTENT.maxZ),
      scenePoint(EXTENT.maxX, EXTENT.maxZ),
    ];
    const colors = bands.map(() => [...WAITING_COLOR]);
    let W = 0;
    let H = 0;
    let dpr = 1;
    let k = 1; // size scale for the screen
    let distance = 20;
        let last = 0;

    function placeCamera(sway) {
      camera.position.set(
        Math.sin(sway) * Math.sin(TILT) * distance,
        Math.cos(TILT) * distance,
        Math.cos(sway) * Math.sin(TILT) * distance,
      );
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    }

    const toScreen = (v) => {
      const s = v.clone().project(camera);
      return [((s.x + 1) / 2) * W, ((1 - s.y) / 2) * H];
    };

    function layout() {
      W = innerWidth;
      H = innerHeight;
      dpr = Math.min(devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, false);
      overlay.width = Math.round(W * dpr);
      overlay.height = Math.round(H * dpr);
      // The tighter of the width and the 16:9 height, against a 1440px screen.
      k = Math.max(1, Math.min(W, H * 1.78) / 1440);
      uniforms.uPixelRatio.value = dpr * k;
      camera.aspect = W / H;
      camera.clearViewOffset();
      camera.updateProjectionMatrix();

      // Fit the map into the clear space between the writing: below the top
      // strip with the city names and times, above the foot strip with the
      // readings. On phones the bands are rows with their writing
      // at the foot of each, so the map fits above the first band's writing
      // instead.
      const rect = (b, sel) => b.el.querySelector(sel).getBoundingClientRect();
      const rows = matchMedia("(max-width: 640px)").matches;
      const top = rows ? H * 0.05 : Math.max(...bands.map((b) => rect(b, ".time").bottom)) + H * 0.06;
      const bottom = rows
        ? Math.min(Math.min(...bands.map((b) => rect(b, ".place").top)) - H * 0.06, H * 0.7)
        : Math.min(...bands.map((b) => rect(b, ".temp").top)) - H * 0.06;
      const box = { x: W * 0.02, y: top, w: W * 0.96, h: Math.max(H * 0.3, bottom - top) };
      const bounds = () => {
        const s = corners.map(toScreen);
        const xs = s.map((q) => q[0]);
        const ys = s.map((q) => q[1]);
        return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      };
      for (let i = 0; i < 6; i++) {
        placeCamera(0);
        const b = bounds();
        distance *= Math.max((b.x1 - b.x0) / box.w, (b.y1 - b.y0) / box.h);
      }
      placeCamera(0);
      const b = bounds();
      // Shift the view so the map sits centred in the box.
      camera.setViewOffset(W, H, (b.x0 + b.x1) / 2 - (box.x + box.w / 2), (b.y0 + b.y1) / 2 - (box.y + box.h / 2), W, H);
    }

    function draw(ms) {
      frame = requestAnimationFrame(draw);
      const t = reducedMotion ? 0 : ms / 1000;
      // Time-based easing, so colors settle at the same pace on slow frames.
      const ease = reducedMotion ? 1 : 1 - Math.exp(-(ms - last) / 450);
      last = ms;
      uniforms.uTime.value = t;
      placeCamera(Math.sin(t * 0.06) * SWAY);

      bands.forEach((b, i) => {
        const target = b.art?.color ?? WAITING_COLOR;
        colors[i] = colors[i].map((v, j) => v + (target[j] - v) * ease);
        uniforms.uColors.value[i].setRGB(...colors[i].map((v) => v / 255));
      });
      renderer.render(scene, camera);

      // Rings and labels, drawn in screen space on the overlay.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const screen = cityPoints.map(toScreen);
      const labels = placeLabels(screen);
      bands.forEach((b, i) => {
        const [cx, cy] = screen[i];
        const glow = colors[i].map((c) => Math.round(c + (255 - c) * 0.3)).join(" ");

        const phase = reducedMotion ? 0.35 : (ms / 2600 + i * 0.21) % 1;
        ctx.strokeStyle = `rgb(${glow} / ${(1 - phase) * 0.9})`;
        ctx.lineWidth = 1.5 * k;
        ctx.beginPath();
        ctx.arc(cx, cy, (6 + phase * 30) * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgb(${glow})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 2.8 * k, 0, Math.PI * 2);
        ctx.fill();

        // Label pill, with a short tick back to the city.
        const l = labels[i];
        ctx.strokeStyle = `rgb(${glow} / 0.6)`;
        ctx.lineWidth = k;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(l.x + (l.x + l.w / 2 < cx ? l.w : 0), l.y + l.h / 2);
        ctx.stroke();
        ctx.fillStyle = "rgb(11 13 18 / 0.78)";
        ctx.beginPath();
        ctx.roundRect(l.x, l.y, l.w, l.h, l.h / 2);
        ctx.fill();
        ctx.strokeStyle = `rgb(${glow} / 0.7)`;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.fillText(l.text, l.x + LABEL_PAD * k, l.y + l.h / 2 + 0.5 * k);
      });
    }

    // Puts each city's label beside it, trying several spots so labels of
    // nearby cities (say Madrid and Marrakesh) don't sit on each other.
    function placeLabels(screen) {
      ctx.font = LABEL_FONT(k);
      ctx.letterSpacing = "0.08em";
      ctx.textBaseline = "middle";
      const placed = [];
      return screen.map(([cx, cy], i) => {
        const text = bands[i].place.city.toUpperCase();
        const w = ctx.measureText(text).width + LABEL_PAD * 2 * k;
        const h = 20 * k;
        const spots = [
          [14 * k, -h / 2],
          [-14 * k - w, -h / 2],
          [12 * k, -h - 10 * k],
          [12 * k, 10 * k],
          [-12 * k - w, -h - 10 * k],
          [-12 * k - w, 10 * k],
          [-w / 2, -h - 20 * k],
          [-w / 2, 20 * k],
        ].map(([dx, dy]) => ({ x: cx + dx, y: cy + dy, w, h, text }));
        const clear = (r) =>
          r.x > 4 && r.x + r.w < W - 4 && r.y > 4 &&
          placed.every((p) => r.x > p.x + p.w + 4 || r.x + r.w < p.x - 4 || r.y > p.y + p.h + 3 || r.y + r.h < p.y - 3);
        const spot = spots.find(clear) ?? spots[0];
        placed.push(spot);
        return spot;
      });
    }

    let resizeTimer;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(layout, 120);
    };

    layout();
    addEventListener("resize", onResize);
    frame = requestAnimationFrame(draw);

    return () => {
      clearTimeout(resizeTimer);
      removeEventListener("resize", onResize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }

  return function stop() {
    stopped = true;
    cancelAnimationFrame(frame);
    cleanup();
  };
}
