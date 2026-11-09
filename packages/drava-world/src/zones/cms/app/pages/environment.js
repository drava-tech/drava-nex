// Environment (environment/_components/environment-view.tsx in the real Nex): four device
// panels, Climate, Lighting, Audio and Security. One is focused, large on the left; the
// other three stack on the right, compact; tap one to bring it forward. The focused panel
// is remembered. In the virtual centre the devices are Zone 02's own: its stretch fabric
// ceiling and strip light, its air conditioner, the walls' speakers and the door lock.

import { DEFAULT_GROUP_COLOR, LIGHT_PRESETS, WARM_WHITE_HEX } from '../../shared/seed.js';
import { dragSlider, esc, h, icon, modal, switchHtml } from '../ui.js';

const PANELS = ['climate', 'lighting', 'audio', 'security'];
const ROLES = ['top', 'middle', 'bottom'];
const FOCUS_KEY = 'cms_environment_panel';
const MODES = ['Cool', 'Heat', 'Auto', 'Fan', 'Dry'];
const VOLUME_STEP = 2;

let focused = (() => { try { const f = localStorage.getItem(FOCUS_KEY); return PANELS.includes(f) ? f : 'lighting'; } catch { return 'lighting'; } })();
let flipFrom = null;                    // panel rects before a focus change, to animate from
const open = {};                        // light groups opened to their fixtures
const ambient = { editing: null, draft: null, notice: null, busy: null };

/** Fixtures sharing a name but for a trailing number are one group. */
export function groupLights(lights) {
  const order = [], bucket = new Map();
  for (const l of lights) {
    const key = l.name.replace(/\s*\d+\s*$/, '').trim() || l.name;
    if (!bucket.has(key)) { bucket.set(key, []); order.push(key); }
    bucket.get(key).push(l);
  }
  return order.map((name) => ({ name, members: bucket.get(name) }));
}

/** Near-neutral colours use the fixtures' white LEDs ("warm"); anything else their colour LEDs. */
export function isWarm(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255, max = Math.max(r, g, b);
  return max > 0 && (max - Math.min(r, g, b)) / max < 0.25;
}

export function renderEnvironment(app) {
  const env = app.state.environment;
  const wide = innerWidth >= 1024;
  const order = [focused, ...PANELS.filter((p) => p !== focused)];
  const page = h(`<div class="page env ${wide ? 'wide' : ''}">
    <h1 class="env-title">Environment</h1>
    <div class="env-grid">${PANELS.map((p) => {
      const primary = p === focused;
      const area = primary ? 'primary' : ROLES[order.indexOf(p) - 1];
      return `<div class="env-card ${primary ? 'primary' : 'compact'}" data-panel="${p}" style="grid-area:${area}">
        <div class="env-inner ${flipFrom ? 'enter' : ''}">${PANEL[p](env, primary)}</div></div>`;
    }).join('')}</div>
  </div>`);

  // Tap a compact panel to focus it; the cards glide to their new places (FLIP).
  page.querySelectorAll('.env-card.compact').forEach((card) => card.addEventListener('click', () => {
    flipFrom = Object.fromEntries([...page.querySelectorAll('[data-panel]')].map((el) => [el.dataset.panel, el.getBoundingClientRect()]));
    focused = card.dataset.panel;
    try { localStorage.setItem(FOCUS_KEY, focused); } catch { /* private mode */ }
    app.refresh();
  }));
  if (flipFrom) {
    const from = flipFrom;
    flipFrom = null;
    requestAnimationFrame(() => page.querySelectorAll('[data-panel]').forEach((el) => {
      const a = from[el.dataset.panel], b = el.getBoundingClientRect();
      if (!a || !b.width) return;
      el.animate([
        { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, transformOrigin: 'top left' },
        { transform: 'none', transformOrigin: 'top left' },
      ], { duration: 1300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }));
  }

  wireClimate(app, page);
  wireLighting(app, page);
  wireAudio(app, page);
  wireSecurity(app, page);
  return page;
}

/* ---------------------------------------------------------------- panels */

const head = (ico, tone, title, badge, sw, big) => `<div class="env-head ${big ? 'big' : ''}">
  <div class="row" style="gap:8px;flex-wrap:nowrap"><span class="env-chip ${tone}">${icon(ico, big ? 'ico sm' : 'ico xs')}</span><h3>${title}</h3></div>
  <div class="row" style="gap:${big ? 12 : 8}px;flex-wrap:nowrap"><span class="env-badge ${big ? '' : 'xl-only'}">${badge}</span>${sw}</div></div>`;

const compactBar = (value, label, pct) => `<div class="env-compact"><div class="row" style="gap:4px;align-items:baseline"><span class="env-num">${value}</span><span class="env-sub">${label}</span></div>
  ${pct === null ? '' : `<div class="env-bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`}</div>`;

const PANEL = {
  climate(env, big) {
    const c = env.climate;
    const body = !big ? compactBar(`${c.temp}°`, esc(c.mode), ((c.temp - 16) / 14) * 100) : `
      <div class="clim">
        <div class="clim-modes">${MODES.map((m) => `<button class="clim-mode ${c.mode.toLowerCase() === m.toLowerCase() ? 'on' : ''}" data-mode="${m}">${m}</button>`).join('')}</div>
        <div class="clim-dial-wrap"><div class="clim-dial">
          <div class="clim-disc"></div>
          <svg viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="climate-arc" gradientUnits="userSpaceOnUse" x1="40" y1="165" x2="40" y2="70">
            <stop offset="0%" stop-color="#000"/><stop offset="55%" stop-color="#761A2A"/><stop offset="100%" stop-color="#E21D3E"/></linearGradient></defs>
            <path d="${ARC}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="4" stroke-linecap="round"/>
            <path d="${ARC}" fill="none" stroke="url(#climate-arc)" stroke-width="4" stroke-linecap="round" pathLength="100" stroke-dasharray="${Math.min(100, Math.max(0, ((c.temp - 16) / 14) * 100))} 100" style="transition:stroke-dasharray 150ms ease-out"/></svg>
          <div class="clim-face"><span class="clim-temp">${c.temp}°</span><span class="clim-target">Target</span></div>
        </div></div>
        <div class="clim-steps"><button class="clim-step" data-temp="1" aria-label="Increase temperature" title="Increase temperature">${icon('Plus', 'ico lg')}</button>
          <button class="clim-step" data-temp="-1" aria-label="Decrease temperature" title="Decrease temperature">${icon('Minus', 'ico lg')}</button></div>
      </div>`;
    return `${head('Thermometer', 'red', 'Climate', c.power ? 'Online' : 'Off', switchHtml(c.power, 'data-sw="climate"'), big)}
      <div class="env-body ${c.power ? '' : 'off'}">${body}</div>`;
  },

  lighting(env, big) {
    const groups = groupLights(env.lights);
    const onCount = groups.filter((g) => g.members.some((m) => m.on)).length;
    const body = !big
      ? `<div class="env-compact"><span class="env-num">${groups.length ? `${onCount}/${groups.length}` : '—'}</span><span class="env-sub" style="margin-top:6px">${groups.length === 1 ? 'Light On' : 'Lights On'}</span></div>`
      : `<div class="light-wrap"><div class="light-list" data-keep-scroll="lights">${groups.map((g) => groupCard(env, g)).join('')}</div>${ambientPanel(env)}</div>`;
    return `${head('Lightbulb', 'red', 'Lighting', groups.length ? `${onCount}/${groups.length} On` : 'None', switchHtml(onCount > 0, 'data-sw="lights"'), big)}${body}`;
  },

  audio(env, big) {
    const a = env.audio;
    const level = a.power && !a.muted ? a.volume : 0;
    const body = !big ? compactBar(a.muted ? 'Mute' : `${a.volume}%`, 'Volume', level) : `
      <div class="aud">
        <div class="center"><div class="row" style="gap:4px;align-items:baseline;justify-content:center"><span class="aud-num">${a.muted ? 0 : a.volume}</span><span class="aud-pct">%</span></div>
          <p class="env-sub" style="margin-top:4px">Master Volume</p>${a.device ? `<p class="aud-dev">${esc(a.device)}</p>` : ''}</div>
        <div class="aud-bar"><i style="width:${level}%"></i></div>
        <div class="aud-btns"><button class="aud-btn" data-vol="-1" aria-label="Decrease volume">${icon('Minus', 'ico xl')}</button>
          <button class="aud-btn ${a.muted ? 'muted' : ''}" data-mute aria-label="${a.muted ? 'Unmute' : 'Mute'}">${icon(a.muted ? 'VolumeX' : 'Volume2', 'ico lg')}<span>${a.muted ? 'Muted' : 'Mute'}</span></button>
          <button class="aud-btn" data-vol="1" aria-label="Increase volume">${icon('Plus', 'ico xl')}</button></div>
      </div>`;
    return `${head('Speaker', 'red', 'Audio', a.power ? 'Playing' : 'Off', switchHtml(a.power, 'data-sw="audio"'), big)}
      <div class="env-body ${a.power ? '' : 'off'}">${body}</div>`;
  },

  security(env, big) {
    const locked = env.security.locked;
    const body = !big ? `<div class="env-compact"><span class="env-num">${locked ? 'Locked' : 'Unlocked'}</span></div>` : `
      <div class="sec-panel">
        <button class="sec-btn ${locked ? 'locked' : ''}" data-lock>${icon(locked ? 'Lock' : 'LockOpen', 'ico huge')}</button>
        <span class="sec-word">${locked ? 'Locked' : 'Unlocked'}</span>
        <p class="sec-note ${locked ? 'locked' : ''}">${locked ? 'System is fully locked and secured' : 'System is unlocked'}</p>
      </div>`;
    return `${head(locked ? 'Lock' : 'LockOpen', 'red', 'Security', locked ? 'Locked' : 'Unlocked', switchHtml(locked, 'data-sw="security"'), big)}
      <div class="env-body">${body}</div>`;
  },
};

// The climate dial's open 270° arc (r 88 round (100, 100)): bottom-left, over the top, to bottom-right.
const ARC = 'M 37.77 162.23 A 88 88 0 1 1 162.23 162.23';

/* ---------------------------------------------------------------- lighting parts */

function ambientPanel(env) {
  const modes = env.ambientModes;
  const ed = modes.find((m) => m.key === ambient.editing);
  const d = ambient.draft;
  const isPreset = d && LIGHT_PRESETS.some((p) => same(p.hex, d.color));
  return `<div class="amb">
    <div class="amb-grid">${modes.map((m) => `<div class="amb-card ${env.activeMode === m.key ? 'on' : ''}">
        <button class="amb-apply" data-apply="${m.key}" ${ambient.busy ? 'disabled' : ''} aria-label="Set ${esc(m.label)} mode">
          <span class="row" style="gap:6px;flex-wrap:nowrap"><i class="sw-dot" style="background:${esc(m.color)}"></i><b>${ambient.busy === m.key ? 'Setting…' : esc(m.label)}</b></span>
          <small>${m.brightness}%${m.stripOn ? '' : ' · strip off'}</small></button>
        <button class="amb-edit" data-edit="${m.key}" title="Edit ${esc(m.label)}" aria-label="Edit ${esc(m.label)}">${icon('Pencil', 'ico xxs')}</button></div>`).join('')}</div>
    ${ambient.notice ? `<p class="amb-note ${ambient.notice.error ? 'err' : ''}">${esc(ambient.notice.text)}</p>` : ''}
    ${ed && d ? `<div class="amb-editor">
      <span class="caps-xs muted">Edit ${esc(ed.label)}</span>
      <div class="row" style="gap:6px">${LIGHT_PRESETS.map((p) => `<button class="swatch lg ${same(d.color, p.hex) ? 'ring' : ''}" data-draft-color="${p.hex}" title="${p.name}" aria-label="${p.name}" style="background:${p.hex}"></button>`).join('')}
        <label class="swatch lg custom ${isPreset ? '' : 'ring'}" title="Custom colour" ${isPreset ? '' : `style="background:${esc(d.color)}"`}>${icon('Pipette', 'ico xxs')}<input type="color" data-draft-custom value="${esc(d.color.toLowerCase())}"></label>
        <span class="mono xs muted">${esc(d.color.toUpperCase())}${same(d.color, WARM_WHITE_HEX) ? ' · warm white' : ''}</span></div>
      <div class="dim-row"><span class="caps-xxs muted" style="width:64px">Brightness</span><div class="grow" data-slider="draft"></div><b class="xs tab">${d.brightness}%</b></div>
      <div class="row" style="justify-content:space-between"><span class="caps-xs muted">Strip light on</span>${switchHtml(d.stripOn, 'data-draft-strip')}</div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost-caps sm" data-amb-cancel>Cancel</button><button class="btn caps-solid sm" data-amb-save>Save</button></div>
    </div>` : ''}
  </div>`;
}

const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();

function statusDot(members) {
  const online = members.filter((m) => m.status === 'online').length;
  const tone = online === members.length ? 'ok' : online ? 'part' : 'down';
  const label = online === members.length ? 'Reachable' : online ? `Only ${online} of ${members.length} reachable` : 'Not reachable';
  return `<i class="sdot ${tone}" title="${label}"></i>`;
}

function colourRow(mode, uuids, label) {
  const ids = esc(uuids.join(','));
  return `<div class="row" style="gap:10px">
    <div class="row" style="gap:8px"><button class="mode-pill ${mode === 'warm' ? 'warm' : ''}" data-mode-set="warm" data-ids="${ids}" title="Warm white — the fixture's own white LEDs">${icon('Flame', 'ico xxs')} Warm</button>
      <button class="mode-pill ${mode === 'colour' ? 'colour' : ''}" data-mode-set="colour" data-ids="${ids}" title="Colour mode — unlocks the swatches">${icon('Palette', 'ico xxs')} Colour</button></div>
    <div class="row swatches ${mode === 'warm' ? 'locked' : ''}" style="gap:6px" ${mode === 'warm' ? 'title="Switch to Colour to use these"' : ''}>
      ${LIGHT_PRESETS.map((p) => `<button class="swatch" data-color="${p.hex}" data-ids="${ids}" title="${p.name}" aria-label="${p.name}" style="background:${p.hex}"></button>`).join('')}
      <button class="swatch custom" data-custom data-ids="${ids}" data-label="${esc(label)}" title="Custom colour" aria-label="Custom colour">${icon('Pipette', 'ico xxs')}</button></div></div>`;
}

const dimmer = (uuids, value) => `<div class="dim-row"><span class="caps-xxs muted" style="width:32px">Dim</span><div class="grow" data-slider="dim" data-ids="${esc(uuids.join(','))}" data-value="${value}"></div><b class="xs tab" style="width:32px;text-align:right">${value}%</b></div>`;

function groupCard(env, g) {
  const uuids = g.members.map((m) => m.uuid);
  const on = g.members.some((m) => m.on);
  const many = g.members.length > 1;
  const mode = env.groupMode[g.name] ?? 'warm';
  const offline = g.members.every((m) => m.status === 'offline');
  return `<div class="lgroup ${offline ? 'offline' : ''}">
    <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
      <div class="row" style="gap:8px;flex-wrap:nowrap;min-width:0">${statusDot(g.members)}<b class="caps-sm trunc">${esc(g.name)}</b>
        ${many ? `<button class="tiny-btn" data-open="${esc(g.name)}" title="${open[g.name] ? 'Hide individual drivers' : 'Control drivers individually'}">${g.members.length} ${icon('ChevronDown', `ico xxs ${open[g.name] ? 'flip' : ''}`)}</button>` : ''}</div>
      <div class="row" style="gap:8px;flex-wrap:nowrap"><button class="tiny-btn" data-identify="${esc(uuids.join(','))}" title="Flash ${esc(g.name)} to see which fixture it is">${icon('Radar', 'ico xxs')} Identify</button>
        ${switchHtml(on, `data-power="${esc(uuids.join(','))}"`)}</div>
    </div>
    <div style="margin-top:10px">${dimmer(uuids, Math.max(0, ...g.members.map((m) => (m.on ? m.brightness : 0))))}</div>
    <div style="margin-top:8px">${colourRow(mode, uuids, g.name)}</div>
    ${many && open[g.name] ? `<div class="lmembers">${g.members.map((m) => `<div class="lmember">
      <div class="row" style="justify-content:space-between;flex-wrap:nowrap"><div class="row" style="gap:8px">${statusDot([m])}<span class="caps-xs muted">${esc(m.name)}</span></div>
        <div class="row" style="gap:8px;flex-wrap:nowrap"><button class="tiny-btn" data-identify="${m.uuid}" title="Flash ${esc(m.name)}">${icon('Radar', 'ico xxs')} ID</button>${switchHtml(m.on, `data-power="${m.uuid}"`)}</div></div>
      <div style="margin-top:8px">${dimmer([m.uuid], m.on ? m.brightness : 0)}</div>
      <div style="margin-top:8px">${colourRow(mode, [m.uuid], m.name)}</div></div>`).join('')}</div>` : ''}
  </div>`;
}

/* ---------------------------------------------------------------- actions */

const ids = (el) => el.dataset.ids?.split(',').filter(Boolean) ?? [];

function wireClimate(app, page) {
  const card = page.querySelector('[data-panel="climate"]');
  card.querySelector('[data-sw="climate"]').addEventListener('click', (e) => { e.stopPropagation(); app.env((env) => { env.climate.power = !env.climate.power; }, { event: 'env-climate' }); });
  card.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); app.env((env) => { env.climate.mode = b.dataset.mode; env.climate.power = true; }, { event: 'env-climate' }); }));
  card.querySelectorAll('[data-temp]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    app.env((env) => {
      const c = env.climate;
      if (!['cool', 'heat'].includes(c.mode.toLowerCase())) c.mode = 'Cool';
      c.temp = Math.max(16, Math.min(30, c.temp + Number(b.dataset.temp)));
      c.power = true;
    }, { event: 'env-climate' });
  }));
}

function wireAudio(app, page) {
  const card = page.querySelector('[data-panel="audio"]');
  card.querySelector('[data-sw="audio"]').addEventListener('click', (e) => { e.stopPropagation(); app.env((env) => { env.audio.power = !env.audio.power; }, { event: 'env-audio' }); });
  card.querySelectorAll('[data-vol]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    app.env((env) => {
      const a = env.audio;
      a.volume = Math.max(0, Math.min(100, (a.muted ? 0 : a.volume) + Number(b.dataset.vol) * VOLUME_STEP));
      a.muted = false;
    }, { event: 'env-audio' });
  }));
  card.querySelector('[data-mute]')?.addEventListener('click', (e) => { e.stopPropagation(); app.env((env) => { env.audio.muted = !env.audio.muted; }, { event: 'env-audio' }); });
}

function wireSecurity(app, page) {
  const card = page.querySelector('[data-panel="security"]');
  const toggle = (e) => { e.stopPropagation(); app.setLocked(!app.state.environment.security.locked); };
  card.querySelector('[data-sw="security"]').addEventListener('click', toggle);
  card.querySelector('[data-lock]')?.addEventListener('click', toggle);
}

function setPower(app, uuids, on) {
  app.env((env) => {
    for (const l of env.lights) if (uuids.includes(l.uuid)) { l.on = on; if (on && l.brightness <= 0) l.brightness = 100; }
  }, { event: 'env-light' });
}

function setColor(app, uuids, hex, opts) {
  app.env((env) => {
    for (const l of env.lights) if (uuids.includes(l.uuid)) { l.color = hex.toUpperCase(); l.on = true; if (l.brightness <= 0) l.brightness = 100; }
    env.activeMode = null;
  }, { event: 'env-light', ...opts });
}

function wireLighting(app, page) {
  const card = page.querySelector('[data-panel="lighting"]');
  card.querySelector('[data-sw="lights"]').addEventListener('click', (e) => {
    e.stopPropagation();
    const env = app.state.environment;
    setPower(app, env.lights.map((l) => l.uuid), !env.lights.some((l) => l.on));
  });
  if (!card.classList.contains('primary')) return;

  card.addEventListener('click', (e) => {
    const t = e.target.closest('button, label');
    if (!t) return;
    e.stopPropagation();
    if (t.dataset.power) setPower(app, ids({ dataset: { ids: t.dataset.power } }), !t.classList.contains('on'));
    else if (t.dataset.identify) app.identify(t.dataset.identify.split(','));
    else if (t.dataset.open) { open[t.dataset.open] = !open[t.dataset.open]; app.refresh(); }
    else if (t.dataset.modeSet) {
      const uuids = ids(t);
      const group = groupLights(app.state.environment.lights).find((g) => g.members.some((m) => uuids.includes(m.uuid)));
      app.env((env) => {
        env.groupMode[group.name] = t.dataset.modeSet;
        for (const l of env.lights) if (group.members.some((m) => m.uuid === l.uuid)) l.on = true;
        env.activeMode = null;
      }, { event: 'env-light' });
    } else if (t.dataset.color) setColor(app, ids(t), t.dataset.color);
    else if (t.dataset.custom !== undefined) colourPicker(app, ids(t), t.dataset.label);
    else if (t.dataset.apply) applyMode(app, t.dataset.apply);
    else if (t.dataset.edit) {
      const m = app.state.environment.ambientModes.find((x) => x.key === t.dataset.edit);
      ambient.editing = m.key;
      ambient.draft = { color: m.color, brightness: m.brightness, stripOn: m.stripOn };
      ambient.notice = null;
      app.refresh();
    } else if (t.dataset.draftColor) { ambient.draft.color = t.dataset.draftColor; app.refresh(); }
    else if (t.dataset.draftStrip !== undefined) { ambient.draft.stripOn = !ambient.draft.stripOn; app.refresh(); }
    else if (t.dataset.ambCancel !== undefined) { ambient.editing = null; ambient.draft = null; app.refresh(); }
    else if (t.dataset.ambSave !== undefined) {
      const key = ambient.editing, draft = ambient.draft;
      ambient.editing = null;
      ambient.draft = null;
      app.env((env) => { Object.assign(env.ambientModes.find((m) => m.key === key), draft); });
      ambient.notice = { text: `${app.state.environment.ambientModes.find((m) => m.key === key).label} saved. Tap it to apply.` };
      app.refresh();
    }
  });
  card.querySelector('[data-draft-custom]')?.addEventListener('input', (e) => { ambient.draft.color = e.target.value.toUpperCase(); });
  card.querySelector('[data-draft-custom]')?.addEventListener('change', () => app.refresh());

  card.querySelectorAll('[data-slider="dim"]').forEach((el) => {
    const uuids = ids(el);
    const label = el.nextElementSibling;
    dragSlider(el, {
      value: Number(el.dataset.value),
      onChange: (v, final) => {
        label.textContent = `${v}%`;
        app.env((env) => {
          for (const l of env.lights) if (uuids.includes(l.uuid)) { l.brightness = v; l.on = v > 0; }
          env.activeMode = null;
        }, { render: final, event: final ? 'env-light' : null });
      },
    });
  });
  const draftSlider = card.querySelector('[data-slider="draft"]');
  if (draftSlider) {
    const label = draftSlider.nextElementSibling;
    dragSlider(draftSlider, { value: ambient.draft.brightness, onChange: (v) => { ambient.draft.brightness = v; label.textContent = `${v}%`; } });
  }
}

/** Put every light into a saved mode (TRAVIS applies the same modes by voice in the real centre). */
async function applyMode(app, key) {
  const mode = app.state.environment.ambientModes.find((m) => m.key === key);
  ambient.busy = key;
  ambient.notice = null;
  app.refresh();
  await new Promise((r) => setTimeout(r, 450));   // the scene recall settling, as in the real one
  ambient.busy = null;
  const warm = isWarm(mode.color);
  app.env((env) => {
    for (const g of groupLights(env.lights)) {
      const strip = g.name === 'Strip Light';
      if (strip && !mode.stripOn) { for (const m of g.members) env.lights.find((l) => l.uuid === m.uuid).on = false; continue; }
      env.groupMode[g.name] = warm ? 'warm' : 'colour';
      for (const m of g.members) Object.assign(env.lights.find((l) => l.uuid === m.uuid), { on: true, brightness: mode.brightness, ...(warm ? {} : { color: mode.color.toUpperCase() }) });
    }
    env.activeMode = key;
  }, { event: 'env-mode' });
  ambient.notice = null;   // success shows on the tile itself
  app.refresh();
}

/* ---------------------------------------------------------------- colour picker */

const hexToRgb = (hex) => { const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 }; };
const rgbToHex = (r, g, b) => `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1).toUpperCase()}`;
const hsvToRgb = (hh, s, v) => { const f = (n, k = (n + hh / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0); return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) }; };
function rgbToHsv(r, g, b) {
  const v = Math.max(r, g, b), c = v - Math.min(r, g, b);
  const hh = c && (v === r ? (g - b) / c : v === g ? 2 + (b - r) / c : 4 + (r - g) / c);
  return { h: 60 * (hh < 0 ? hh + 6 : hh), s: v && c / v, v: v / 255 };
}

/** Light Colour: a hue × brightness spectrum, a preview, the hex code and RGB values. */
function colourPicker(app, uuids, label) {
  const first = app.state.environment.lights.find((l) => l.uuid === uuids[0]);
  let color = { ...hexToRgb(first?.color ?? DEFAULT_GROUP_COLOR), hex: (first?.color ?? DEFAULT_GROUP_COLOR).toUpperCase() };
  let lastHue = 0;
  modal(`<button class="icon-btn round cp-x" data-close aria-label="Close">${icon('X')}</button>
    <div class="row" style="gap:8px;margin-bottom:24px">${icon('Settings2')}<h3 class="caps-title">Light Colour</h3><span class="tag">${esc(label || 'Light')}</span></div>
    <div class="cp">
      <div class="cp-spec"><i class="cp-handle"></i></div>
      <div class="stack" style="gap:10px"><span class="caps-xs muted">Preview</span><div class="cp-prev"></div></div>
      <div class="stack" style="gap:26px">
        <div><span class="caps-xs muted">Hex Code</span><div class="cp-hex"><b class="mono" data-hex></b><button class="icon-btn" data-copy aria-label="Copy">${icon('Copy')}</button></div></div>
        <div><span class="caps-xs muted">Edit Hex Code</span><div class="row" style="gap:10px;flex-wrap:nowrap;margin-top:10px">
          <input class="input cp-in mono" data-hexin><button class="btn cp-apply" data-apply>Apply</button></div><span class="cp-err" hidden>Invalid HEX format</span></div>
        <div><span class="caps-xs muted">RGB Values</span><div class="row" style="gap:6px;flex-wrap:nowrap;margin-top:10px">
          ${['r', 'g', 'b'].map((c) => `<label class="cp-rgb"><span>${c}</span><input type="number" min="0" max="255" data-ch="${c}"></label>`).join('')}</div></div>
      </div>
    </div>`, {
    cls: 'colour',
    onMount(el, close) {
      const spec = el.querySelector('.cp-spec'), handle = el.querySelector('.cp-handle'), prev = el.querySelector('.cp-prev');
      const hexIn = el.querySelector('[data-hexin]'), err = el.querySelector('.cp-err');
      let lastSend = 0;
      const paint = (hh, v, hex) => {
        const r = spec.getBoundingClientRect();
        handle.style.transform = `translate(${(hh / 360) * r.width}px, ${(1 - v) * r.height}px)`;
        prev.style.background = hex;
        prev.style.opacity = Math.max(0.2, v);
      };
      const sync = () => {
        const { h: hh, s, v } = rgbToHsv(color.r, color.g, color.b);
        if (s > 0) lastHue = hh;
        paint(s === 0 ? lastHue : hh, v, color.hex);
        el.querySelector('[data-hex]').textContent = color.hex;
        el.querySelectorAll('[data-ch]').forEach((i) => { if (document.activeElement !== i) i.value = color[i.dataset.ch]; });
      };
      const send = (final) => { const now = Date.now(); if (final || now - lastSend > 32) { lastSend = now; setColor(app, uuids, color.hex, { render: false }); } };
      const pick = (e, final) => {
        const r = spec.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - r.left, r.width)), y = Math.max(0, Math.min(e.clientY - r.top, r.height));
        const hh = (x / r.width) * 360, v = 1 - y / r.height;
        const rgb = hsvToRgb(hh, 1, v);
        color = { ...rgb, hex: rgbToHex(rgb.r, rgb.g, rgb.b) };
        lastHue = hh;
        paint(hh, v, color.hex);
        el.querySelector('[data-hex]').textContent = color.hex;
        el.querySelectorAll('[data-ch]').forEach((i) => { i.value = color[i.dataset.ch]; });
        hexIn.value = color.hex;
        send(final);
      };
      let drag = false;
      spec.addEventListener('pointerdown', (e) => { spec.setPointerCapture(e.pointerId); drag = true; pick(e, false); });
      spec.addEventListener('pointermove', (e) => { if (drag && e.buttons) pick(e, false); });
      spec.addEventListener('pointerup', (e) => { drag = false; pick(e, true); });
      hexIn.value = color.hex;
      hexIn.addEventListener('input', () => { const ok = /^#[0-9A-F]{6}$/i.test(hexIn.value); err.hidden = ok; hexIn.classList.toggle('bad', !ok); el.querySelector('[data-apply]').disabled = !ok; });
      el.querySelector('[data-apply]').addEventListener('click', () => {
        if (!/^#[0-9A-F]{6}$/i.test(hexIn.value)) return;
        color = { ...hexToRgb(hexIn.value), hex: hexIn.value.toUpperCase() };
        send(true);
        close();
      });
      el.querySelectorAll('[data-ch]').forEach((i) => i.addEventListener('input', () => {
        color[i.dataset.ch] = Math.max(0, Math.min(255, parseFloat(i.value) || 0));
        color.hex = rgbToHex(color.r, color.g, color.b);
        hexIn.value = color.hex;
        sync();
        send(true);
      }));
      el.querySelector('[data-copy]').addEventListener('click', () => navigator.clipboard?.writeText(color.hex).catch(() => {}));
      requestAnimationFrame(sync);
    },
    onClose: () => app.refresh(),
  });
}
