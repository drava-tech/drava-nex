import { DEFAULT_PLACE_IDS, LOCATIONS_BY_ID, MAX_PLACES, resolvePlaceId } from "./locations.js";
import { startClock } from "./clock.js";
import { CLOCK_STYLES, startLanding } from "./landing.js";
import { ARTS_BY_ID, DEFAULT_ART } from "./arts.js";

// The selection lives in the URL (?places=newyork,london,tokyo&art=fabric&clock=digital), so a
// clock can be bookmarked and the back button returns to the picker. The last
// choice is also remembered so the picker reopens with it.
const STORAGE_KEY = "world-clock:places";
const ART_KEY = "world-clock:art";
const CLOCK_KEY = "world-clock:clock";
const DEFAULT_CLOCK = "analog";
const isClockStyle = (id) => CLOCK_STYLES.some((c) => c.id === id);
const root = document.getElementById("app");
let stopView = null;

// Opened inside Data Art Studio (?embed=1): the studio picks the artwork, and
// the picker gets a way back to the studio.
const EMBED = new URLSearchParams(location.search).has("embed");
// The studio's landing preview (?preview=1): the clock for the remembered
// cities and clock style, with nothing to click.
const PREVIEW = new URLSearchParams(location.search).has("preview");
if (PREVIEW) document.documentElement.classList.add("preview-mode");

function placesFromUrl() {
  const ids = (new URLSearchParams(location.search).get("places") || "").split(",").map(resolvePlaceId);
  return [...new Set(ids)].filter((id) => LOCATIONS_BY_ID.has(id)).slice(0, MAX_PLACES);
}

function rememberedPlaces() {
  try {
    const ids = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(ids) && ids.length) return [...new Set(ids.map(resolvePlaceId))];
  } catch {}
  return DEFAULT_PLACE_IDS;
}

function artFromUrl() {
  const id = new URLSearchParams(location.search).get("art");
  return ARTS_BY_ID.get(id) ?? ARTS_BY_ID.get(DEFAULT_ART);
}

function rememberedArt() {
  const fromUrl = new URLSearchParams(location.search).get("art");
  if (ARTS_BY_ID.has(fromUrl)) return fromUrl;
  try {
    const id = localStorage.getItem(ART_KEY);
    if (ARTS_BY_ID.has(id)) return id;
  } catch {}
  return DEFAULT_ART;
}

function clockFromUrl() {
  const id = new URLSearchParams(location.search).get("clock");
  return isClockStyle(id) ? id : DEFAULT_CLOCK;
}

function rememberedClock() {
  try {
    const id = localStorage.getItem(CLOCK_KEY);
    if (isClockStyle(id)) return id;
  } catch {}
  return DEFAULT_CLOCK;
}

function route() {
  stopView?.();
  stopView = null;
  root.replaceChildren();

  const ids = PREVIEW
    ? rememberedPlaces().filter((id) => LOCATIONS_BY_ID.has(id)).slice(0, MAX_PLACES)
    : placesFromUrl();
  if (ids.length) {
    document.title = "World Clock";
    stopView = startClock(
      root,
      ids.map((id) => LOCATIONS_BY_ID.get(id)),
      { art: artFromUrl(), clockStyle: PREVIEW ? rememberedClock() : clockFromUrl(), onBack: () => navigate(EMBED ? `?embed=1&art=${artFromUrl().id}` : "") },
    );
  } else {
    document.title = "World Clock · Choose cities";
    stopView = startLanding(root, rememberedPlaces(), rememberedArt(), rememberedClock(), {
      onExit: EMBED ? () => window.parent.postMessage({ type: "world-clock-back" }, "*") : null,
      onStart(chosen, art, clock) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(chosen));
          localStorage.setItem(ART_KEY, art);
          localStorage.setItem(CLOCK_KEY, clock);
        } catch {}
        const params = [`places=${chosen.join(",")}`];
        if (EMBED) params.unshift("embed=1");
        if (art !== DEFAULT_ART) params.push(`art=${art}`);
        if (clock !== DEFAULT_CLOCK) params.push(`clock=${clock}`);
        navigate(`?${params.join("&")}`);
      },
    });
  }
}

function navigate(search) {
  history.pushState(null, "", search || location.pathname);
  route();
}

addEventListener("popstate", route);
route();
