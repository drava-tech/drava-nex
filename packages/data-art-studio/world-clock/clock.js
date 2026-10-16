import { startArt } from "./art.js";
import { startFabricArt } from "./fabricArt.js";
import { createAnalogClock } from "./analogClock.js";

const WEATHER_REFRESH_MS = 10 * 60 * 1000;

// Temperature → color. Each band is filled with the color for its current
// temperature, interpolated between these stops (°C).
const TEMP_STOPS = [
  [-20, [40, 30, 110]],
  [-5, [45, 85, 190]],
  [5, [40, 140, 210]],
  [12, [40, 175, 175]],
  [18, [90, 185, 110]],
  [24, [235, 190, 60]],
  [30, [240, 130, 45]],
  [36, [220, 60, 45]],
  [44, [150, 20, 50]],
];

export function tempColor(t) {
  if (t <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = TEMP_STOPS[i - 1];
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1][1];
}

// Dark text on light fills (yellows), white text on everything else.
export function inkFor([r, g, b]) {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#14161c" : "#ffffff";
}

/**
 * Renders one band per place into `root` and keeps them live, over `art`
 * (an entry of ARTS in arts.js).
 */
export function startClock(root, places, { art, clockStyle, onBack }) {
  root.className = ["clock-view", art.id === "map" && "map-art", clockStyle === "digital" && "digital"].filter(Boolean).join(" ");
  root.style.setProperty("--count", places.length);

  const canvas = document.createElement("canvas");
  canvas.className = "art";
  canvas.setAttribute("aria-hidden", "true");
  root.append(canvas);

  const back = document.createElement("button");
  back.className = "back";
  back.type = "button";
  back.innerHTML = `<svg class="arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13 8H3M7 4 3 8l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Change countries`;
  back.addEventListener("click", onBack);
  root.append(back);

  const bands = places.map((place) => {
    const el = document.createElement("section");
    el.className = "band loading";
    el.innerHTML = `
      <div class="place">
        <div class="country"></div>
        <div class="meta"></div>
      </div>
      <div class="time">
        <span class="label">Time</span>
        <div class="clock"></div>
      </div>
      <div class="temp"><span class="label">Temp</span><span class="value">--</span><span class="unit">°C</span></div>
      <div class="wind"><span class="label">Wind</span><span class="value">--</span><span class="unit">km/h</span></div>
    `;
    el.querySelector(".country").textContent = place.city;
    el.querySelector(".meta").textContent = place.country;
    // The strip shows the time on a clock face; phones keep the digits.
    const analog = createAnalogClock();
    el.querySelector(".time").append(analog.el);
    root.append(el);

    return {
      place,
      el,
      tz: place.tz,
      clock: el.querySelector(".clock"),
      analog,
      meta: el.querySelector(".meta"),
      value: el.querySelector(".temp .value"),
      wind: el.querySelector(".wind .value"),
    };
  });

  function tick() {
    const now = new Date();
    for (const band of bands) {
      band.clock.textContent = new Intl.DateTimeFormat("en-GB", {
        timeZone: band.tz,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(now);
      band.analog.set(now, band.tz);
    }
  }

  let statusEl;
  function setStatus(text) {
    if (!text) {
      statusEl?.remove();
      statusEl = null;
      return;
    }
    statusEl ??= root.appendChild(Object.assign(document.createElement("div"), { className: "status" }));
    statusEl.textContent = text;
  }

  async function loadWeather() {
    try {
      const res = await fetch(`/api/data-art-studio/weather?ids=${places.map((p) => p.id).join(",")}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const byId = new Map(data.map((w) => [w.id, w]));
      for (const band of bands) {
        const w = byId.get(band.place.id);
        if (!w) continue;
        const color = tempColor(w.tempC);
        band.el.style.setProperty("--temp-color", `rgb(${color.join(" ")})`);
        const ink = inkFor(color);
        band.el.style.setProperty("--ink", ink);
        band.el.classList.toggle("light", ink !== "#ffffff");
        band.el.classList.remove("loading");
        band.art = { color, windKph: w.windKph };
        band.value.textContent = Math.round(w.tempC);
        if (w.windKph != null) band.wind.textContent = Math.round(w.windKph);
        band.meta.textContent = w.condition ? `${band.place.country} · ${w.condition}` : band.place.country;
        if (w.tzId) band.tz = w.tzId;
      }
      setStatus(null);
    } catch (err) {
      // Keep the last good readings on screen; just flag that they're stale.
      setStatus(`Weather unavailable: ${err.message}`);
    }
  }

  tick();
  loadWeather();
  const timers = [setInterval(tick, 1000), setInterval(loadWeather, WEATHER_REFRESH_MS)];
  const stopArt =
    art.id === "map" ? startArt(canvas, bands) : startFabricArt(canvas, () => bands.map((b) => b.art));

  return function stop() {
    timers.forEach(clearInterval);
    stopArt();
  };
}
