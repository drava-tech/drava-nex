/**
 * The world map artwork as the picker's preview: a flat map of the countries
 * on the studio grey, with each picked city's country filled in its
 * temperature color and a dot at the city. The clock's own map (art.js) needs
 * three.js, too heavy to load just for a preview.
 *
 * `getBands` returns one { place, color } per picked city, color being an
 * [r, g, b] or null while the weather hasn't arrived. Redrawn every second so
 * it picks up new picks and weather. Returns a function that stops it.
 */
const LAT_TOP = 84;
const LAT_BOTTOM = -58;
const LAND = "rgb(255 255 255 / 0.85)";
const WAITING = "rgb(150 156 170)";

let outlines;
function loadOutlines() {
  outlines ??= Promise.all([import("topojson-client"), import("world-atlas/countries-110m.json")]).then(
    ([topojson, { default: world }]) =>
      // Antarctica (010) would only fill the foot of the frame.
      topojson.feature(world, world.objects.countries).features.filter((f) => f.id !== "010"),
  );
  return outlines;
}

export function startMapPreview(canvas, getBands) {
  let features = null;
  let stopped = false;
  loadOutlines()
    .then((f) => {
      if (stopped) return;
      features = f;
      draw();
    })
    .catch((err) => console.error("Map preview failed to load", err));

  function draw() {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!features || !W) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Equirectangular, fitted between the strip at the top and the
    // temperatures along the foot.
    const box = { x: W * 0.04, y: H * 0.22, w: W * 0.92, h: H * 0.56 };
    const scale = Math.min(box.w / 360, box.h / (LAT_TOP - LAT_BOTTOM));
    const ox = box.x + (box.w - 360 * scale) / 2;
    const oy = box.y + (box.h - (LAT_TOP - LAT_BOTTOM) * scale) / 2;
    const project = ([lon, lat]) => [ox + (lon + 180) * scale, oy + (LAT_TOP - lat) * scale];

    const bands = getBands();
    const colorByIso = new Map();
    for (const { place, color } of bands) if (!colorByIso.has(place.iso)) colorByIso.set(place.iso, color);

    // Outlines crossing the date line (Russia, Fiji) are unwrapped so they
    // don't streak across the map, drawn again a world-width over to fill in
    // the other edge, and clipped to the map.
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, 0, 360 * scale, H);
    ctx.clip();
    for (const f of features) {
      const path = new Path2D();
      const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const ring of polygons.flat()) {
        const pts = [];
        for (const [lon, lat] of ring) {
          const prev = pts.length ? pts[pts.length - 1][0] : lon;
          pts.push([lon - 360 * Math.round((lon - prev) / 360), lat]);
        }
        const lons = pts.map((p) => p[0]);
        const copies = [0, Math.max(...lons) > 180 ? -360 : null, Math.min(...lons) < -180 ? 360 : null];
        for (const dx of copies.filter((d) => d != null)) {
          pts.forEach(([lon, lat], i) => (i ? path.lineTo(...project([lon + dx, lat])) : path.moveTo(...project([lon + dx, lat]))));
          path.closePath();
        }
      }
      const picked = colorByIso.has(f.id);
      const color = colorByIso.get(f.id);
      ctx.fillStyle = !picked ? LAND : color ? `rgb(${color.join(" ")})` : WAITING;
      ctx.fill(path);
    }
    ctx.restore();

    for (const { place } of bands) {
      const [x, y] = project([place.lon, place.lat]);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#111";
      ctx.stroke();
    }
  }

  const timer = setInterval(draw, 1000);
  const resize = new ResizeObserver(draw);
  resize.observe(canvas);

  return function stop() {
    stopped = true;
    clearInterval(timer);
    resize.disconnect();
  };
}
