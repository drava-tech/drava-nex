import { tempColor } from "./clock.js";
import { LOCATIONS, LOCATIONS_BY_ID, MAX_PLACES } from "./locations.js";
import { ARTS, ARTS_BY_ID } from "./arts.js";
import { startMapPreview } from "./mapPreview.js";
import { createAnalogClock } from "./analogClock.js";

/**
 * The city picker, laid out like Data Art Studio's "Compose your piece"
 * landing: the bands on the left, a live preview in the middle and the
 * countries to choose from on the right. `initial` is the starting selection
 * (ids, in band order), `initialArt` the starting artwork's id and
 * `initialClock` the starting clock style ("analog" or "digital"); `onStart`
 * receives the chosen ids, in the order they were picked, the artwork id and
 * the clock style. `onExit`, when given, adds a back button (used when the
 * picker is embedded in Data Art Studio).
 * Returns a function that stops the preview's timers.
 */
export const CLOCK_STYLES = [
  { id: "analog", name: "Analog" },
  { id: "digital", name: "Digital" },
];

export function startLanding(root, initial, initialArt, initialClock, { onStart, onExit }) {
  root.className = "landing-view";
  root.style.removeProperty("--count");
  root.innerHTML = `
    <div class="landing">
      <header class="landing-header">
        <h1 class="landing-kicker">World <span>Clock</span></h1>
        <p class="landing-title">Compose Your Screen</p>
        <p class="landing-sub">Pick up to ${MAX_PLACES} cities. Each one becomes a band with its local time and temperature.</p>
      </header>

      <div class="lp-shell">
        <section class="lp-panel lp-bands" aria-label="Bands">
          <h2 class="lp-panel-title">Bands</h2>
          <ol class="band-list"></ol>
          <button class="lp-clear" type="button">Clear all</button>
        </section>

        <div class="lp-preview-col">
          <section class="lp-panel lp-preview" aria-label="Preview">
            <div class="lp-preview-head">
              <span class="lp-badge">Live Preview</span>
              <span class="lp-preview-title"></span>
              <span class="lp-preview-blurb">Right now</span>
            </div>
            <div class="lp-frame">
              <canvas class="lp-art" aria-hidden="true"></canvas>
              <canvas class="lp-map" aria-hidden="true"></canvas>
              <div class="mini-bands"></div>
              <p class="lp-empty">Pick a city to start</p>
            </div>
          </section>
          <div class="lp-options">
            <div class="lp-arts" role="radiogroup" aria-label="Artwork">
              <span class="lp-arts-label">Artwork</span>
            </div>
            <div class="lp-arts lp-clocks" role="radiogroup" aria-label="Clock">
              <span class="lp-arts-label">Clock</span>
            </div>
          </div>
          <button class="lp-generate" type="button">Show Clock</button>
          <p class="lp-hint" aria-live="polite"></p>
        </div>

        <section class="lp-panel lp-countries" aria-label="Cities">
          <h2 class="lp-panel-title">Cities</h2>
          <div class="lp-search-wrap">
            <svg class="lp-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
            <input class="lp-search" type="search" placeholder="Search cities or countries" aria-label="Search cities" />
          </div>
          <ul class="country-list"></ul>
        </section>
      </div>
    </div>
  `;

  const selected = initial.filter((id) => LOCATIONS_BY_ID.has(id)).slice(0, MAX_PLACES);
  const bandList = root.querySelector(".band-list");
  const countryList = root.querySelector(".country-list");
  const search = root.querySelector(".lp-search");
  const miniBands = root.querySelector(".mini-bands");
  const frame = root.querySelector(".lp-frame");
  const previewTitle = root.querySelector(".lp-preview-title");
  const hint = root.querySelector(".lp-hint");
  const generate = root.querySelector(".lp-generate");
  const weather = new Map(); // id → { tempC, windKph }, filled in as the preview fetches it
  const artCanvas = root.querySelector(".lp-art");
  const mapCanvas = root.querySelector(".lp-map");
  let art = ARTS_BY_ID.has(initialArt) ? initialArt : ARTS[0].id;
  let stopArt = null;

  const artButtons = ARTS.map((a) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lp-art-option";
    btn.setAttribute("role", "radio");
    btn.textContent = a.name;
    btn.dataset.id = a.id;
    btn.addEventListener("click", () => {
      if (art === a.id) return;
      art = a.id;
      renderArt();
    });
    return btn;
  });
  root.querySelector(".lp-arts").append(...artButtons);

  // Analog clock faces or digital times in the strips, on the preview as on
  // the clock.
  let clockStyle = CLOCK_STYLES.some((c) => c.id === initialClock) ? initialClock : CLOCK_STYLES[0].id;
  const clockButtons = CLOCK_STYLES.map((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lp-art-option";
    btn.setAttribute("role", "radio");
    btn.textContent = c.name;
    btn.dataset.id = c.id;
    btn.addEventListener("click", () => {
      clockStyle = c.id;
      renderClockStyle();
    });
    return btn;
  });
  root.querySelector(".lp-clocks").append(...clockButtons);

  function renderClockStyle() {
    for (const btn of clockButtons) btn.setAttribute("aria-checked", btn.dataset.id === clockStyle);
    frame.classList.toggle("digital", clockStyle === "digital");
  }

  // The band artworks run in the preview as on the clock; the world map is
  // stood in for by a flat map (see mapPreview.js).
  function renderArt() {
    for (const btn of artButtons) btn.setAttribute("aria-checked", btn.dataset.id === art);
    const chosen = ARTS_BY_ID.get(art);
    const isMap = chosen.id === "map";
    frame.classList.toggle("has-art", !isMap);
    frame.classList.toggle("has-map", isMap);
    frame.classList.toggle("no-wind", Boolean(chosen.noWind));
    frame.classList.toggle("band-lines", Boolean(chosen.bandLines));
    const colorOf = (id) => (weather.has(id) ? tempColor(weather.get(id).tempC) : null);
    stopArt?.();
    stopArt = !isMap
      ? chosen.start(artCanvas, () =>
          selected.map((id) => weather.has(id) && { color: colorOf(id), tempC: weather.get(id).tempC, windKph: weather.get(id).windKph }),
        )
      : startMapPreview(mapCanvas, () => selected.map((id) => ({ place: LOCATIONS_BY_ID.get(id), color: colorOf(id) })));
  }

  const cards = new Map(
    LOCATIONS.map((place) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "country-card";
      btn.innerHTML = `<span class="country-badge"></span><span class="country-name"></span><span class="country-city"></span>`;
      btn.querySelector(".country-name").textContent = place.city;
      btn.querySelector(".country-city").textContent = place.country;
      btn.addEventListener("click", () => toggle(place.id));
      li.append(btn);
      countryList.append(li);
      return [place.id, btn];
    }),
  );

  function toggle(id) {
    const i = selected.indexOf(id);
    if (i >= 0) selected.splice(i, 1);
    else if (selected.length < MAX_PLACES) selected.push(id);
    render();
  }

  // Moves the band at `from` to `to` (both indexes into `selected`), keeping
  // keyboard focus on it when `refocus` is set.
  function move(from, to, refocus) {
    if (to < 0 || to >= selected.length || to === from) return;
    const [id] = selected.splice(from, 1);
    selected.splice(to, 0, id);
    render();
    if (refocus) bandList.children[to].querySelector("button").focus();
  }

  // Lets a band be dragged up or down the list into a new place, with the
  // others sliding aside to make room. A press that moves less than a few
  // pixels stays a click, which removes the band.
  let justDragged = false;
  function sortable(btn, from) {
    btn.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      const items = [...bandList.children].slice(0, selected.length);
      const rects = items.map((li) => li.getBoundingClientRect());
      const step = rects.length > 1 ? rects[1].top - rects[0].top : 0;
      let to = from;
      let dragging = false;

      const onMove = (e) => {
        const dy = e.clientY - down.clientY;
        if (!dragging) {
          if (Math.abs(dy) < 6) return;
          dragging = true;
          bandList.classList.add("is-sorting");
          items[from].classList.add("dragging");
        }
        // Held within the list.
        const offset = Math.min(Math.max(dy, rects[0].top - rects[from].top), rects.at(-1).top - rects[from].top);
        items[from].style.transform = `translateY(${offset}px)`;
        const middle = rects[from].top + rects[from].height / 2 + offset;
        to = rects.filter((r, k) => k !== from && r.top + r.height / 2 < middle).length;
        items.forEach((li, k) => {
          if (k === from) return;
          const shift = k > from && k <= to ? -step : k < from && k >= to ? step : 0;
          li.style.transform = shift ? `translateY(${shift}px)` : "";
        });
      };

      const onUp = () => {
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        removeEventListener("pointercancel", onUp);
        if (!dragging) return;
        // The release also fires a click, which mustn't remove the band.
        justDragged = true;
        setTimeout(() => (justDragged = false));
        bandList.classList.remove("is-sorting");
        if (to === from) render();
        else move(from, to);
      };

      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
      addEventListener("pointercancel", onUp);
    });
  }

  function render() {
    bandList.replaceChildren(
      ...Array.from({ length: MAX_PLACES }, (_, i) => {
        const li = document.createElement("li");
        const place = LOCATIONS_BY_ID.get(selected[i]);
        if (place) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "band-item selected";
          btn.title = `Drag to reorder, click to remove ${place.city}`;
          btn.setAttribute("aria-label", `${place.city}, band ${i + 1}. Click to remove, Alt+Up or Alt+Down to move.`);
          btn.innerHTML = `<svg class="band-grip" viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg><span class="band-num">${i + 1}</span><span class="band-name"></span><svg class="band-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
          btn.querySelector(".band-name").textContent = place.city;
          btn.addEventListener("click", () => {
            if (!justDragged) toggle(place.id);
          });
          btn.addEventListener("keydown", (e) => {
            if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
            e.preventDefault();
            move(i, i + (e.key === "ArrowUp" ? -1 : 1), true);
          });
          sortable(btn, i);
          li.append(btn);
        } else {
          li.className = "band-item empty";
          li.innerHTML = `<span class="band-num">${i + 1}</span><span class="band-name">Empty</span>`;
        }
        return li;
      }),
    );

    const full = selected.length >= MAX_PLACES;
    for (const [id, btn] of cards) {
      const pos = selected.indexOf(id);
      btn.classList.toggle("selected", pos >= 0);
      btn.querySelector(".country-badge").textContent = pos >= 0 ? pos + 1 : "";
      btn.disabled = pos < 0 && full;
    }

    generate.disabled = selected.length === 0;
    previewTitle.textContent = `${selected.length} ${selected.length === 1 ? "Band" : "Bands"}`;
    hint.textContent =
      selected.length === 0
        ? "Select at least one city"
        : full
          ? "All bands filled. Remove one to swap it out."
          : `${selected.length} of ${MAX_PLACES} selected`;

    renderPreview();
    fetchWeather();
  }

  // The preview is a small version of the clock: one band per pick, with its
  // live temperature once the weather arrives.
  function renderPreview() {
    frame.classList.toggle("is-empty", selected.length === 0);
    miniBands.style.setProperty("--count", Math.max(selected.length, 1));
    miniBands.replaceChildren(
      ...selected.map((id) => {
        const place = LOCATIONS_BY_ID.get(id);
        const el = document.createElement("div");
        el.className = "mini-band";
        el.dataset.id = id;
        el.innerHTML = `
          <span class="mini-country"></span>
          <span class="mini-time"><span class="mini-label">Time</span><span class="mini-value"></span></span>
          <span class="mini-temp"><span class="mini-label">Temp</span><span class="mini-value"></span></span>
          <span class="mini-wind"><span class="mini-label">Wind</span><span class="mini-value"></span></span>`;
        el.querySelector(".mini-country").textContent = place.city;
        el.analog = createAnalogClock();
        el.querySelector(".mini-time").append(el.analog.el);
        return el;
      }),
    );
    paintPreview();
  }

  function paintPreview() {
    const now = new Date();
    for (const el of miniBands.children) {
      const place = LOCATIONS_BY_ID.get(el.dataset.id);
      el.querySelector(".mini-time .mini-value").textContent = new Intl.DateTimeFormat("en-GB", {
        timeZone: place.tz,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(now);
      el.analog.set(now, place.tz);
      const w = weather.get(place.id);
      if (!w) continue;
      el.querySelector(".mini-temp .mini-value").textContent = `${Math.round(w.tempC)}°C`;
      if (w.windKph != null) el.querySelector(".mini-wind .mini-value").textContent = `${Math.round(w.windKph)} km/h`;
    }
  }

  // Debounced so clicking through several countries makes one request.
  let fetchTimer;
  function fetchWeather() {
    clearTimeout(fetchTimer);
    const missing = selected.filter((id) => !weather.has(id));
    if (!missing.length) return;
    fetchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/drava-mosaic/weather?ids=${missing.join(",")}`);
        if (!res.ok) return;
        for (const w of await res.json()) weather.set(w.id, { tempC: w.tempC, windKph: w.windKph });
        paintPreview();
      } catch {
        // The preview just stays neutral; the clock reports weather errors.
      }
    }, 400);
  }

  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    for (const place of LOCATIONS) {
      const match = !q || place.country.toLowerCase().includes(q) || place.city.toLowerCase().includes(q);
      cards.get(place.id).parentElement.hidden = !match;
    }
  });

  root.querySelector(".lp-clear").addEventListener("click", () => {
    selected.length = 0;
    render();
  });

  generate.addEventListener("click", () => onStart([...selected], art, clockStyle));

  if (onExit) {
    const exit = document.createElement("button");
    exit.className = "lp-exit";
    exit.type = "button";
    exit.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13 8H3M7 4 3 8l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Studio`;
    exit.addEventListener("click", onExit);
    root.querySelector(".landing").prepend(exit);
  }

  render();
  renderArt();
  renderClockStyle();
  const clockTimer = setInterval(paintPreview, 1000);

  return function stop() {
    clearInterval(clockTimer);
    clearTimeout(fetchTimer);
    stopArt?.();
  };
}
