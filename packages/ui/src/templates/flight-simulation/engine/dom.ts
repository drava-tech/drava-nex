// Builds the DOM the original standalone index.html provided, inside a host
// element supplied by React.
//
// Why the engine owns this markup instead of React rendering it: the HUD is
// written to imperatively from the 60fps render loop (~200 direct
// `el.textContent = …` / `classList` call sites in flight-garden.ts). Expressing
// it as React state would mean a reconciliation pass every frame and rewriting
// every one of those call sites, for no user-visible gain. Keeping the markup
// here lets the ported engine code stay untouched.
//
// The class names match the original stylesheet exactly (now scoped under
// .fg-root — see flight-garden.css).

export interface FlightGardenDom {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  labelLayer: HTMLDivElement;
  ui: FlightGardenUi;
  /** Removes every node this builder added to the host. */
  destroy: () => void;
}

export interface FlightGardenUi {
  select: HTMLSelectElement;
  towerTitle: HTMLElement;
  towerSub: HTMLElement;
  arrivals: HTMLElement;
  departures: HTMLElement;
  parked: HTMLElement;
  active: HTMLElement;
  airlineKey: HTMLElement;
  detailEmpty: HTMLElement;
  detailBody: HTMLElement;
  unpinBtn: HTMLButtonElement;
  dSwatch: HTMLElement;
  dFlight: HTMLElement;
  dAirline: HTMLElement;
  dStatus: HTMLElement;
  dRoute: HTMLElement;
  dGate: HTMLElement;
  dZone: HTMLElement;
  dAlt: HTMLElement;
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

export function buildDom(host: HTMLElement): FlightGardenDom {
  const root = el("div", "fg-root");

  // ── Stage: the visualization itself ──────────────────────────────────────
  const stage = el("div", "stage");
  const canvas = el("canvas", "fg-canvas");
  const vignette = el("div", "vignette");
  vignette.setAttribute("aria-hidden", "true");
  const labelLayer = el("div", "label-layer");
  labelLayer.setAttribute("aria-hidden", "true");
  stage.append(canvas, vignette, labelLayer);

  // ── HUD: glass control-tower overlay ─────────────────────────────────────
  const hud = el("main", "hud");

  const tower = el("section", "panel tower");
  tower.innerHTML =
    `<div class="tower-head">` +
    `<span class="live-dot" aria-hidden="true"></span>` +
    `<h1 class="tower-title">BLR Garden Tower</h1>` +
    `</div>` +
    `<p class="tower-sub">Live Traffic · Kempegowda Intl</p>` +
    `<label class="select-wrap">` +
    `<span class="sr-only">Select airport</span>` +
    `<select></select>` +
    `</label>`;

  const stats = el("section", "panel stats");
  stats.innerHTML = (
    [
      ["arrival", "Arrivals"],
      ["departure", "Departures"],
      ["parked", "At Gates"],
      ["active", "Active"],
    ] as const
  )
    .map(
      ([kind, label]) =>
        `<div class="stat" data-kind="${kind}">` +
        `<span class="stat-value">0</span>` +
        `<span class="stat-label">${label}</span>` +
        `</div>`
    )
    .join("");

  const legend = el("section", "panel legend");
  legend.innerHTML =
    `<h2 class="eyebrow">Airspace Key</h2>` +
    `<ul class="route-key">` +
    `<li><i class="line cyan"></i><span>Arrival corridor</span></li>` +
    `<li><i class="line amber"></i><span>Departure trail</span></li>` +
    `<li><i class="line white dashed"></i><span>Holding pattern</span></li>` +
    `</ul>` +
    `<h2 class="eyebrow airline-head">Carriers in Garden</h2>` +
    `<ul class="airline-key"></ul>`;

  const detail = el("section", "panel detail");
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
    `<div><dt>Gate</dt><dd class="d-gate">—</dd></div>` +
    `<div><dt>Zone</dt><dd class="d-zone">—</dd></div>` +
    `<div><dt>Altitude</dt><dd class="d-alt">—</dd></div>` +
    `</dl>` +
    `</div>`;

  hud.append(tower, stats, legend, detail);

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
    `<span class="tc-sub">Butterflies are flights · Flowers are gates</span>`;

  root.append(stage, hud, tooltip, veil, titlecard);
  host.appendChild(root);

  // The live dot doubles as the flight-feed indicator (see setFeedState).
  const feedDot = tower.querySelector<HTMLElement>(".live-dot")!;

  const q = <T extends HTMLElement>(scope: HTMLElement, sel: string): T =>
    scope.querySelector<T>(sel)!;

  const ui: FlightGardenUi = {
    select: q<HTMLSelectElement>(tower, "select"),
    towerTitle: q(tower, ".tower-title"),
    towerSub: q(tower, ".tower-sub"),

    arrivals: q(stats, '[data-kind="arrival"] .stat-value'),
    departures: q(stats, '[data-kind="departure"] .stat-value'),
    parked: q(stats, '[data-kind="parked"] .stat-value'),
    active: q(stats, '[data-kind="active"] .stat-value'),

    airlineKey: q(legend, ".airline-key"),

    detailEmpty: q(detail, ".detail-empty"),
    detailBody: q(detail, ".detail-body"),
    unpinBtn: q<HTMLButtonElement>(detail, ".unpin"),
    dSwatch: q(detail, ".swatch"),
    dFlight: q(detail, ".flight-no"),
    dAirline: q(detail, ".airline-name"),
    dStatus: q(detail, ".status-chip"),
    dRoute: q(detail, ".d-route"),
    dGate: q(detail, ".d-gate"),
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
