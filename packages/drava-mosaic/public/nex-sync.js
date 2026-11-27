// Nex-only (tools/sync-drava-mosaic.mjs adds a <script> for this to the studio and World Clock
// pages; it never touches this file). Inside the CMS the studio is an iframe and the same screen
// is open in several places (the TV, a console's mirror), so what an operator chooses here has to
// reach the others and what the others chose has to be applied here. The parent frame
// (DravaMosaicRenderer) carries it over the gateway; see packages/ui/.../drava-mosaic/content.ts.
//
// It works on the pages' DOM, as a click would, and never patches Mosaic's own code, so Mosaic
// can change freely as long as the ids and classes below stay.
//
//   studio    (velocitymapping.html)  data card, art card, Generate, back, which page is open
//   world clock (world-clock/, ?embed=1)  cities and their order, artwork, clock style, Show Clock
//
// Studio <-> CMS:   data-art-state (up) / data-art-apply (down) / data-art-ready (up)
// Clock  <-> studio: world-clock-state / world-clock-ready (up), world-clock-apply / -report (down)
(() => {
  "use strict";
  const ORIGIN = location.origin;
  if (window.parent === window) return; // opened on its own: nothing to share with

  const isId = (x) => typeof x === "string" && x.length <= 64;
  const idOrNull = (x) => (isId(x) ? x : null);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // { places, art, style, running } or null; anything else off the wire is dropped.
  function readClock(c) {
    if (!c || typeof c !== "object" || !Array.isArray(c.places)) return null;
    const places = [...new Set(c.places.filter(isId))].slice(0, 5);
    const running = c.running !== false;
    if (running && !places.length) return null;
    return { places, art: idOrNull(c.art), style: idOrNull(c.style), running };
  }

  // ── Studio ──────────────────────────────────────────────────────────────
  function initStudio(frame) {
    const PAGES = ["page1", "page2", "pageFlight", "pageWeather", "pageClock"];
    const activePage = () => PAGES.find((id) => document.getElementById(id)?.classList.contains("active")) || null;
    let childClock = null; // what the World Clock frame last reported
    let frameReady = false; // the World Clock frame has said it is up
    let remoteOpen = false; // the clock page was opened for another client's view, not by this operator
    let pendingClock = null; // a clock to hand the frame once it says it is up
    let pendingWant = null; // a view that arrived while the splash still owns the screen
    let seeded = false;
    let applying = false;
    let last = ""; // the view last sent or applied, so neither is sent twice
    // The gateway echoes a view back to its sender. By then the operator may have moved on, and
    // replaying the echo would undo that, so views sent in the last couple of seconds are ignored.
    const sent = [];
    const ECHO_MS = 2000;

    function read() {
      const page = activePage();
      if (page !== "pageClock") {
        childClock = null;
        frameReady = false;
        remoteOpen = false;
      }
      const data = document.querySelector(".data-item.selected");
      const art = document.querySelector(".art-card.selected");
      return {
        data: data ? data.id : null,
        art: art ? art.id : null,
        open: page !== null && page !== "page1",
        clock: page === "pageClock" ? childClock : null,
      };
    }

    function emit() {
      if (applying || !seeded) return;
      const state = read();
      const json = JSON.stringify(state);
      if (json === last) return;
      last = json;
      sent.push({ json, at: Date.now() });
      if (sent.length > 8) sent.shift();
      window.parent.postMessage({ type: "data-art-state", state }, ORIGIN);
    }

    let timer = 0;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!seeded) {
          if (!activePage()) return; // still on the splash
          seeded = true;
          last = JSON.stringify(read());
          if (pendingWant) {
            const want = pendingWant;
            pendingWant = null;
            apply(want);
          }
          return;
        }
        emit();
      }, 40);
    };
    new MutationObserver(schedule).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });

    // Back to the landing the way the page's own controls do it.
    function leave() {
      const page = activePage();
      if (page === "page2") document.getElementById("backBtn")?.click();
      else if (page === "pageWeather") document.getElementById("weatherBackBtn")?.click();
      else {
        const frameEl = page === "pageFlight" ? document.getElementById("flightGardenFrame") : frame;
        const type = page === "pageFlight" ? "flight-garden-back" : "world-clock-back";
        if (frameEl?.contentWindow) {
          window.dispatchEvent(new MessageEvent("message", { data: { type }, origin: ORIGIN, source: frameEl.contentWindow }));
        }
      }
    }

    function apply(want) {
      if (!seeded) {
        pendingWant = want;
        return;
      }
      const wantOpen = want.open === true;
      const wantClock = readClock(want.clock);
      const wantJson = JSON.stringify({ data: idOrNull(want.data), art: idOrNull(want.art), open: wantOpen, clock: wantClock });
      if (sent.some((s) => s.json === wantJson && Date.now() - s.at < ECHO_MS)) return;
      const have = read();
      const sameCards = (!want.data || have.data === want.data) && (!want.art || have.art === want.art);
      // A view that says nothing about the clock (null) leaves the clock as it is.
      if (have.open === wantOpen && sameCards && (!wantClock || !wantOpen || same(have.clock, wantClock))) {
        // Already there; only the clock may still need telling.
        last = JSON.stringify(have);
        return;
      }
      applying = true;
      try {
        if (have.open && (!wantOpen || !sameCards)) leave();
        const dataEl = want.data && document.getElementById(want.data);
        if (dataEl && dataEl.classList.contains("data-item") && !dataEl.classList.contains("selected")) dataEl.click();
        const artEl = want.art && document.getElementById(want.art);
        if (artEl && artEl.classList.contains("art-card") && artEl.style.display !== "none" && !artEl.classList.contains("selected")) artEl.click();
        if (wantOpen) {
          if (!read().open) {
            remoteOpen = true;
            pendingClock = wantClock;
            document.getElementById("lpGenerateBtn")?.click();
          } else if (wantClock) {
            if (frameReady) frame.contentWindow?.postMessage({ type: "world-clock-apply", clock: wantClock }, ORIGIN);
            else pendingClock = wantClock;
          }
        }
      } finally {
        applying = false;
      }
      last = JSON.stringify(read());
    }

    window.addEventListener("message", (e) => {
      if (e.origin !== ORIGIN) return;
      const m = e.data;
      if (!m || typeof m !== "object") return;
      if (e.source === frame.contentWindow) {
        if (m.type === "world-clock-state") {
          childClock = readClock(m.clock);
          if (m.echo) last = JSON.stringify(read()); // the clock obeyed a view we were handed: not news
          else schedule();
        } else if (m.type === "world-clock-ready") {
          frameReady = true;
          // A clock somebody else chose goes in. If this operator opened the page, publish the clock it
          // starts on; if another client did, wait for its clock rather than answer with our own.
          const clock = pendingClock;
          pendingClock = null;
          if (clock) frame.contentWindow.postMessage({ type: "world-clock-apply", clock }, ORIGIN);
          else if (!remoteOpen) frame.contentWindow.postMessage({ type: "world-clock-report" }, ORIGIN);
        }
      } else if (e.source === window.parent && m.type === "data-art-apply" && m.state && typeof m.state === "object") {
        apply(m.state);
      }
    });
    window.parent.postMessage({ type: "data-art-ready" }, ORIGIN);
    schedule();
  }

  // ── World Clock (embedded in the studio) ─────────────────────────────────
  function initClock(root) {
    const STORAGE = { places: "world-clock:places", art: "world-clock:art", clock: "world-clock:clock" };
    const DEFAULT_ART = "map";
    const DEFAULT_STYLE = "analog";
    const query = () => new URLSearchParams(location.search);

    function read() {
      const q = query();
      const urlPlaces = (q.get("places") || "").split(",").filter(Boolean);
      if (urlPlaces.length) {
        return { places: urlPlaces, art: q.get("art") || DEFAULT_ART, style: q.get("clock") || DEFAULT_STYLE, running: true };
      }
      if (!root.classList.contains("landing-view")) return null;
      const picked = [...root.querySelectorAll(".country-card.selected")]
        .map((card) => ({ id: card.dataset.id, pos: Number(card.querySelector(".country-badge")?.textContent) || 0 }))
        .filter((p) => p.id)
        .sort((a, b) => a.pos - b.pos)
        .map((p) => p.id);
      const art = root.querySelector('.lp-arts:not(.lp-clocks) .lp-art-option[aria-checked="true"]');
      const style = root.querySelector('.lp-clocks .lp-art-option[aria-checked="true"]');
      return { places: picked, art: art ? art.dataset.id : DEFAULT_ART, style: style ? style.dataset.id : DEFAULT_STYLE, running: false };
    }

    let last = JSON.stringify(read());
    function report(echo) {
      const clock = read();
      last = JSON.stringify(clock);
      window.parent.postMessage({ type: "world-clock-state", clock, echo: echo === true }, ORIGIN);
    }

    let timer = 0;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (JSON.stringify(read()) !== last) report(false);
      }, 40);
    };
    new MutationObserver(schedule).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-checked"] });

    // Shows `want` the way the page itself would after a click: through its own route().
    function apply(want) {
      const have = read();
      if (have && same(have, want)) {
        report(true);
        return;
      }
      try {
        localStorage.setItem(STORAGE.places, JSON.stringify(want.places));
        localStorage.setItem(STORAGE.art, want.art || DEFAULT_ART);
        localStorage.setItem(STORAGE.clock, want.style || DEFAULT_STYLE);
      } catch {}
      const q = ["embed=1"];
      if (want.running) q.push("places=" + want.places.map(encodeURIComponent).join(","));
      if (want.art && want.art !== DEFAULT_ART) q.push("art=" + encodeURIComponent(want.art));
      if (want.running && want.style && want.style !== DEFAULT_STYLE) q.push("clock=" + encodeURIComponent(want.style));
      history.pushState(null, "", "?" + q.join("&"));
      dispatchEvent(new PopStateEvent("popstate"));
      // A picker with nobody picked can't be stored (the page treats an empty list as "never chosen").
      if (!want.running && !want.places.length) root.querySelector(".lp-clear")?.click();
      report(true);
    }

    window.addEventListener("message", (e) => {
      if (e.origin !== ORIGIN || e.source !== window.parent) return;
      const m = e.data;
      if (!m || typeof m !== "object") return;
      if (m.type === "world-clock-report") report(false);
      else if (m.type === "world-clock-apply") {
        const want = readClock(m.clock);
        if (want) apply(want);
      }
    });
    window.parent.postMessage({ type: "world-clock-ready" }, ORIGIN);
  }

  // Loaded with `defer` after the page's own scripts, so the World Clock has drawn its first view.
  const flag = (name) => new URLSearchParams(location.search).has(name);
  const studioFrame = document.getElementById("worldClockFrame");
  if (studioFrame) initStudio(studioFrame);
  else if (document.getElementById("app") && flag("embed") && !flag("preview")) initClock(document.getElementById("app"));
})();
