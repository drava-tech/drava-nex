// Builds the DOM the original standalone index.html provided, inside a host
// element supplied by React.
//
// Why the engine owns this markup instead of React rendering it: the HUD is
// written to imperatively from the 60fps render loop (~200 direct
// `el.textContent = …` / `classList` call sites in flight-garden.js). Expressing
// it as React state would mean a reconciliation pass every frame and rewriting
// every one of those call sites, for no user-visible gain. Keeping the markup
// here lets the ported engine code stay untouched.
//
// The class names match the original stylesheet exactly (now scoped under
// .fg-root — see flight-garden.css).
//
// Structure follows index.html as of upstream 3f4129c, which consolidated the
// four free-floating glass panels into one vertical sidebar (`.hud-panel`) of
// `.hp-block` sections, and added the scene switcher, weather and attendance
// blocks. Sections the active scene does not use are hidden by the engine via
// their *Panel handles below, not removed.

export interface FlightGardenDom {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  labelLayer: HTMLDivElement;
  ui: FlightGardenUi;
  /** Removes every node this builder added to the host. */
  destroy: () => void;
}

export interface FlightGardenUi {
  // ── Scene switcher ──────────────────────────────────────────────────────
  sceneSelect: HTMLSelectElement;

  // ── Tower / airport ─────────────────────────────────────────────────────
  select: HTMLSelectElement;
  towerTitle: HTMLElement;
  towerSub: HTMLElement;
  towerPanel: HTMLElement;
  /** The airport picker's wrapper — hidden wholesale in non-flight scenes. */
  airportWrap: HTMLElement;

  // ── Flight counters ─────────────────────────────────────────────────────
  statsPanel: HTMLElement;
  arrivals: HTMLElement;
  departures: HTMLElement;
  parked: HTMLElement;
  active: HTMLElement;

  // ── Weather scene ───────────────────────────────────────────────────────
  weatherPanel: HTMLElement;
  locationSelect: HTMLSelectElement;
  statTemp: HTMLElement;
  statWind: HTMLElement;
  /** Manual overrides: when either holds a value the live poll stands down. */
  manualTemp: HTMLInputElement;
  manualWind: HTMLInputElement;
  realtimeBtn: HTMLButtonElement;

  // ── Attendance scene ────────────────────────────────────────────────────
  attendancePanel: HTMLElement;
  statPresent: HTMLElement;
  statAbsent: HTMLElement;
  statLate: HTMLElement;

  // ── Legend + detail ─────────────────────────────────────────────────────
  legendPanel: HTMLElement;
  airlineKey: HTMLElement;
  detailPanel: HTMLElement;
  detailEmpty: HTMLElement;
  detailBody: HTMLElement;
  unpinBtn: HTMLButtonElement;
  dSwatch: HTMLElement;
  dFlight: HTMLElement;
  dAirline: HTMLElement;
  dStatus: HTMLElement;
  dRoute: HTMLElement;
  dTerminal: HTMLElement;
  dZone: HTMLElement;
  dAlt: HTMLElement;

  // ── Overlays ────────────────────────────────────────────────────────────
  tooltip: HTMLElement;
  veil: HTMLElement;
  /** Live connection indicator for the flight-data feed (added for the CMS). */
  feedDot: HTMLElement;
}

/** Tiny helper so the markup below reads close to the original HTML. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/** One `.stat` cell of a counter row. */
function statCell(kind: string, label: string, initial = "0"): string {
  return (
    `<div class="stat" data-kind="${kind}">` +
    `<span class="stat-value">${initial}</span>` +
    `<span class="stat-label">${label}</span>` +
    `</div>`
  );
}

export function buildDom(host: HTMLElement): FlightGardenDom {
  // index.html carried `hud-active` on <body>; the toggle button in the engine
  // (initHUDToggle) flips it here instead, so the stylesheet's hidden-HUD rules
  // apply per instance rather than per document.
  const root = el("div", "fg-root hud-active");

  // ── Stage: the visualization itself ──────────────────────────────────────
  const stage = el("div", "stage");
  const canvas = el("canvas", "fg-canvas");
  const vignette = el("div", "vignette");
  vignette.setAttribute("aria-hidden", "true");
  const labelLayer = el("div", "label-layer");
  labelLayer.setAttribute("aria-hidden", "true");
  stage.append(canvas, vignette, labelLayer);

  // ── HUD: one glass sidebar of blocks ─────────────────────────────────────
  const hud = el("main", "hud hud-active");
  const hudPanel = el("div", "panel hud-panel");

  const scenePanel = el("section", "hp-block scene");
  scenePanel.innerHTML =
    `<h2 class="eyebrow">Visualization</h2>` +
    `<label class="select-wrap">` +
    `<span class="sr-only">Select visualization</span>` +
    `<select class="scene-select"></select>` +
    `</label>`;

  const tower = el("section", "hp-block tower");
  tower.innerHTML =
    `<div class="tower-head">` +
    `<span class="live-dot" aria-hidden="true"></span>` +
    `<h1 class="tower-title">BLR Garden Tower</h1>` +
    `</div>` +
    `<p class="tower-sub">Live Traffic · Kempegowda Intl</p>` +
    `<label class="select-wrap airport-select-wrap">` +
    `<span class="sr-only">Select airport</span>` +
    `<select></select>` +
    `</label>`;

  const stats = el("section", "hp-block stats");
  stats.innerHTML =
    statCell("arrival", "Arrivals") +
    statCell("departure", "Departures") +
    statCell("parked", "Landed") +
    statCell("active", "Active");

  const weather = el("section", "hp-block weather-block");
  weather.hidden = true;
  weather.innerHTML =
    `<label class="select-wrap location-select-wrap">` +
    `<span class="sr-only">Select location</span>` +
    `<select class="location-select"></select>` +
    `</label>` +
    `<div class="stats">` +
    statCell("arrival", "Temp &deg;C", "&mdash;") +
    statCell("departure", "Wind km/h", "&mdash;") +
    `</div>` +
    `<div class="weather-manual">` +
    `<label class="weather-field">` +
    `<span class="weather-field-label">Temp &deg;C</span>` +
    `<input type="number" class="manual-temp" min="-10" max="40" step="0.5" placeholder="—" />` +
    `</label>` +
    `<label class="weather-field">` +
    `<span class="weather-field-label">Wind km/h</span>` +
    `<input type="number" class="manual-wind" min="0" max="60" step="0.5" placeholder="—" />` +
    `</label>` +
    `<button type="button" class="realtime-btn" disabled>` +
    `<span class="live-dot" aria-hidden="true"></span> Realtime` +
    `</button>` +
    `</div>`;

  const attendance = el("section", "hp-block attendance-block");
  attendance.hidden = true;
  attendance.innerHTML =
    `<div class="stats stats-3">` +
    statCell("present", "Present", "&mdash;") +
    statCell("absent", "Absent", "&mdash;") +
    statCell("late", "Late", "&mdash;") +
    `</div>`;

  const legend = el("section", "hp-block legend");
  legend.innerHTML =
    `<h2 class="eyebrow">Carriers in Garden</h2>` +
    `<ul class="airline-key"></ul>`;

  const detail = el("section", "hp-block detail");
  detail.innerHTML =
    `<header class="detail-head">` +
    `<h2 class="eyebrow">Flight Detail</h2>` +
    `<button class="unpin" type="button" hidden>Pinned · clear</button>` +
    `</header>` +
    `<p class="detail-empty">Hover a butterfly to inspect its flight. Click to pin.</p>` +
    `<div class="detail-body" hidden>` +
    `<div class="detail-top">` +
    `<span class="swatch" aria-hidden="true"></span>` +
    `<div class="detail-id">` +
    `<span class="flight-no">—</span>` +
    `<span class="airline-name">—</span>` +
    `</div>` +
    `<span class="status-chip">—</span>` +
    `</div>` +
    `<dl class="detail-grid">` +
    `<div><dt>Route</dt><dd class="d-route">—</dd></div>` +
    `<div><dt>Terminal</dt><dd class="d-terminal">—</dd></div>` +
    `<div><dt>Zone</dt><dd class="d-zone">—</dd></div>` +
    `<div><dt>Altitude</dt><dd class="d-alt">—</dd></div>` +
    `</dl>` +
    `</div>`;

  hudPanel.append(scenePanel, tower, stats, weather, attendance, legend, detail);
  hud.append(hudPanel);

  // ── Overlays ─────────────────────────────────────────────────────────────
  const tooltip = el("div", "tooltip");
  tooltip.setAttribute("role", "status");
  tooltip.setAttribute("aria-live", "polite");

  const veil = el("div", "veil");
  veil.setAttribute("aria-hidden", "true");

  const titlecard = el("div", "titlecard");
  titlecard.innerHTML =
    `<span class="tc-kicker">Flight Garden</span>` +
    `<span class="tc-line">An airport, rendered as a living garden</span>` +
    `<span class="tc-sub">Butterflies are flights · Flowers are terminals</span>`;

  root.append(stage, hud, tooltip, veil, titlecard);
  host.appendChild(root);

  // The tower's live dot doubles as the flight-feed indicator (see
  // setFeedState). Scoped to `tower` on purpose: the weather block's Realtime
  // button carries a `.live-dot` of its own.
  const feedDot = tower.querySelector<HTMLElement>(".live-dot")!;

  const q = <T extends HTMLElement>(scope: HTMLElement, sel: string): T =>
    scope.querySelector<T>(sel)!;

  const ui: FlightGardenUi = {
    sceneSelect: q<HTMLSelectElement>(scenePanel, ".scene-select"),

    select: q<HTMLSelectElement>(tower, "select"),
    towerTitle: q(tower, ".tower-title"),
    towerSub: q(tower, ".tower-sub"),
    towerPanel: tower,
    airportWrap: q(tower, ".airport-select-wrap"),

    statsPanel: stats,
    arrivals: q(stats, '[data-kind="arrival"] .stat-value'),
    departures: q(stats, '[data-kind="departure"] .stat-value'),
    parked: q(stats, '[data-kind="parked"] .stat-value'),
    active: q(stats, '[data-kind="active"] .stat-value'),

    weatherPanel: weather,
    locationSelect: q<HTMLSelectElement>(weather, ".location-select"),
    statTemp: q(weather, '[data-kind="arrival"] .stat-value'),
    statWind: q(weather, '[data-kind="departure"] .stat-value'),
    manualTemp: q<HTMLInputElement>(weather, ".manual-temp"),
    manualWind: q<HTMLInputElement>(weather, ".manual-wind"),
    realtimeBtn: q<HTMLButtonElement>(weather, ".realtime-btn"),

    attendancePanel: attendance,
    statPresent: q(attendance, '[data-kind="present"] .stat-value'),
    statAbsent: q(attendance, '[data-kind="absent"] .stat-value'),
    statLate: q(attendance, '[data-kind="late"] .stat-value'),

    legendPanel: legend,
    airlineKey: q(legend, ".airline-key"),

    detailPanel: detail,
    detailEmpty: q(detail, ".detail-empty"),
    detailBody: q(detail, ".detail-body"),
    unpinBtn: q<HTMLButtonElement>(detail, ".unpin"),
    dSwatch: q(detail, ".swatch"),
    dFlight: q(detail, ".flight-no"),
    dAirline: q(detail, ".airline-name"),
    dStatus: q(detail, ".status-chip"),
    dRoute: q(detail, ".d-route"),
    dTerminal: q(detail, ".d-terminal"),
    dZone: q(detail, ".d-zone"),
    dAlt: q(detail, ".d-alt"),

    tooltip,
    veil,
    feedDot,
  };

  return {
    root,
    canvas,
    labelLayer,
    ui,
    destroy: () => root.remove(),
  };
}
