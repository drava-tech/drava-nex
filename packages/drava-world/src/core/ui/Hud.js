import { Emitter } from '../../util/Emitter.js';
import { BRAND } from '../../config.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Everything drawn over the 3D view: zone title, objectives, captions (TRAVIS or a guest speaker),
 * interaction prompts, info cards, the minimap, the floor map and dialogs.
 *
 * Emits: 'voice' (bool), 'sound' (bool), 'quality' ('high'|'low'), 'teleport' (stopId),
 *        'step' (-1 | 1, previous / next stop), 'overlay' (bool — true while a dialog/map
 *        covers the view), 'skip', 'enter' (step inside the Welcome Zone).
 */
export class Hud extends Emitter {
  constructor(root, { zones, settings }) {
    super();
    this.root = root;
    this.zones = zones;
    this.settings = settings;
    this.voiceOn = true;
    this.soundOn = true;
    this.overlays = new Set();
    root.className = 'hud';
    root.innerHTML = this.#template();
    this.$ = (sel) => root.querySelector(sel);
    this.#wire();
    if (settings.debug) this.$('.fps').hidden = false;
  }

  #template() {
    return `
    <header class="hud-top">
      <div class="brandmark"><b>${esc(BRAND.name.toUpperCase())}</b><span>Experience Centre</span></div>
      <div class="zone-chip" hidden><span class="zn"></span><span class="zt"><small></small><strong></strong></span></div>
      <div class="mode-switch" role="group" hidden></div>
      <div class="hud-actions">
        <span class="bridge" data-s="connecting" title="Link to the physical TRAVIS system"><i></i><span>TRAVIS link</span></span>
        <button type="button" class="hbtn" data-act="map" aria-label="Floor map">Map <kbd>M</kbd></button>
        <button type="button" class="hbtn" data-act="voice" aria-pressed="true">Voice on</button>
        <button type="button" class="hbtn" data-act="sound" aria-pressed="true">Sound on</button>
        <button type="button" class="hbtn icon" data-act="help" aria-label="Help and controls">?</button>
      </div>
    </header>

    <aside class="objectives" hidden aria-label="In this zone">
      <h3>In this zone</h3>
      <ol></ol>
    </aside>

    <div class="prompt" hidden><kbd></kbd><span></span></div>
    <div class="stop-title" aria-hidden="true"><div class="kicker"></div><div class="st-name"></div></div>

    <div class="caption" hidden aria-live="polite">
      <div class="orb"></div>
      <div class="cap-body"><div class="cap-name">TRAVIS</div><p class="cap-text"></p></div>
    </div>

    <aside class="info" hidden>
      <button type="button" class="info-close" aria-label="Close">×</button>
      <div class="kicker info-kicker"></div>
      <h2 class="info-title"></h2>
      <p class="info-body"></p>
      <div class="info-client"><span>For clients</span><p></p></div>
    </aside>

    <div class="minimap" hidden><svg viewBox="-10 -13 20 26" aria-label="Minimap"></svg></div>
    <button type="button" class="skip" hidden><span>Skip arrival</span> <kbd>Space</kbd></button>
    <button type="button" class="enter-cta" hidden><i class="ring-ico"></i>Step inside <kbd>Enter</kbd></button>
    <div class="look-hint" hidden></div>
    <nav class="stops" hidden aria-label="Stops in this zone">
      <button type="button" class="st-step" data-step="-1" aria-label="Previous stop">←</button>
      <ol></ol>
      <button type="button" class="st-step" data-step="1" aria-label="Next stop">→</button>
    </nav>
    <div class="toast" role="status"></div>
    <div class="fade"></div>
    <div class="fps" hidden></div>

    <section class="overlay start" data-overlay="start" hidden>
      <div class="start-in">
        <div class="kicker">${esc(BRAND.name)} · ${esc(BRAND.tagline)}</div>
        <h1>The Experience<br>Centre<em>.</em></h1>
        <p class="lede">Six zones, one host. Walk the centre with TRAVIS, our own trained AI, and try every interaction as a visitor would. Zone 01, the Welcome Zone, is open; the other rooms are being built.</p>
        <div class="start-row">
          <button type="button" class="btn big" data-start>Enter the centre</button>
        </div>
        <ul class="controls">
          <li><i class="ring-ico"></i><span>Click a glowing ring to travel there</span></li>
          <li><kbd>Drag</kbd><span>Look around</span></li>
          <li><kbd>←</kbd><kbd>→</kbd><span>Previous / next stop</span></li>
          <li><kbd>Click</kbd><kbd>E</kbd><span>Use what's under the cursor</span></li>
          <li><kbd>M</kbd><span>Floor map</span></li>
        </ul>
        <div class="quality" role="group" aria-label="Graphics">
          <span>Graphics</span>
          <button type="button" data-q="high">High</button>
          <button type="button" data-q="low">Performance</button>
        </div>
      </div>
    </section>

    <section class="overlay" data-overlay="map" hidden>
      <div class="dialog map-dlg">
        <button type="button" class="info-close" data-close aria-label="Close">×</button>
        <div class="kicker">Floor map</div>
        <h2>One loop through the centre</h2>
        <div class="plan"></div>
        <p class="note">Click a zone to go straight there, or walk through the doors from zone to zone. Every room is open; the ones marked "Empty room" are still being built. Inside a zone, travel between its stops with the glowing rings, the stops bar or the minimap.</p>
      </div>
    </section>

    <section class="overlay" data-overlay="help" hidden>
      <div class="dialog help-dlg">
        <button type="button" class="info-close" data-close aria-label="Close">×</button>
        <div class="kicker">How to move</div>
        <h2>Controls</h2>
        <div class="help-grid">
          <div><h4>Mouse and keyboard</h4><ul>
            <li>Click a glowing ring, a stop in the bar below or a point on the minimap: travel there</li>
            <li><kbd>←</kbd> <kbd>→</kbd> or <kbd>1</kbd>–<kbd>5</kbd>: previous, next or numbered stop</li>
            <li>Drag the view: look around</li><li>Click, or <kbd>E</kbd>: use what's under the cursor</li>
            <li><kbd>M</kbd>: floor map · <kbd>H</kbd>: this help · <kbd>V</kbd>: voice</li></ul></div>
          <div><h4>Touch</h4><ul>
            <li>Drag anywhere: look</li><li>Tap a ring or a stop: travel there</li><li>Tap an object: use it</li></ul></div>
          <div><h4>TRAVIS link</h4><p class="bridge-help"></p></div>
        </div>
      </div>
    </section>

    <section class="overlay" data-overlay="locked" hidden>
      <div class="dialog locked-dlg">
        <div class="kicker locked-kicker"></div>
        <h2 class="locked-title"></h2>
        <p class="locked-body"></p>
        <div class="row">
          <button type="button" class="btn" data-back>Back to the Welcome Zone</button>
          <button type="button" class="btn ghost" data-map>Open the floor map</button>
        </div>
      </div>
    </section>`;
  }

  #wire() {
    this.root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'map') this.toggleMap();
      const zone = e.target.closest('.plan [data-zone]')?.dataset.zone;
      if (zone) this.emit('zone', zone);
      if (act === 'help') this.open('help');
      if (act === 'voice') this.setVoice(!this.voiceOn);
      if (act === 'sound') this.setSound(!this.soundOn);
      if (e.target.closest('[data-close]')) this.close(e.target.closest('[data-overlay]').dataset.overlay);
    });
    this.$('.info-close').addEventListener('click', () => this.info(null));
    this.$('.skip').addEventListener('click', () => this.emit('skip'));
    this.$('.mode-switch').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      b.blur();
      if (b.getAttribute('aria-pressed') !== 'true') this.emit('mode', b.dataset.mode);
    });
    this.$('.enter-cta').addEventListener('click', () => this.emit('enter'));
    this.$('.stops').addEventListener('click', (e) => {
      e.target.closest('button')?.blur(); // no lingering focus ring after a mouse click
      const step = e.target.closest('[data-step]')?.dataset.step;
      if (step) { this.emit('step', Number(step)); return; }
      const id = e.target.closest('[data-stop]')?.dataset.stop;
      if (id) this.emit('teleport', id);
    });

    addEventListener('keydown', (e) => {
      if (/^(INPUT|TEXTAREA)$/.test(e.target?.tagName)) return;
      if (e.code === 'KeyM' && !this.overlays.has('start')) this.toggleMap();
      if (e.code === 'KeyH' && !this.overlays.has('start')) this.overlays.has('help') ? this.close('help') : this.open('help');
      if (e.code === 'KeyV' && !this.overlays.has('start')) this.setVoice(!this.voiceOn);
      if (e.code === 'Space' && !this.$('.skip').hidden) { e.preventDefault(); this.emit('skip'); }
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !this.$('.enter-cta').hidden && !this.covered) { e.preventDefault(); this.emit('enter'); }
      if (!this.$('.stops').hidden && !this.covered && !e.repeat) {
        if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') { e.preventDefault(); this.emit('step', e.code === 'ArrowRight' ? 1 : -1); }
        const n = /^Digit([1-9])$/.exec(e.code)?.[1];
        const stop = n && this.stops?.[Number(n) - 1];
        if (stop) this.emit('teleport', stop.id);
      }
      if (e.code === 'Escape') {
        for (const o of ['map', 'help']) if (this.overlays.has(o)) this.close(o);
        if (!this.$('.info').hidden) this.info(null);
      }
    });

    this.$('.quality').addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]')?.dataset.q;
      if (q) this.setQuality(q);
    });
    this.setQuality(this.settings.quality, false);
  }

  setQuality(q, emit = true) {
    this.root.querySelectorAll('[data-q]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === q)));
    if (emit) this.emit('quality', q);
  }

  setVoice(on) {
    this.voiceOn = on;
    const b = this.$('[data-act="voice"]');
    b.textContent = on ? 'Voice on' : 'Voice off';
    b.setAttribute('aria-pressed', String(on));
    this.emit('voice', on);
  }

  setSound(on) {
    this.soundOn = on;
    const b = this.$('[data-act="sound"]');
    b.textContent = on ? 'Sound on' : 'Sound off';
    b.setAttribute('aria-pressed', String(on));
    this.emit('sound', on);
  }

  /* ---------- overlays ---------- */

  open(name) {
    const el = this.root.querySelector(`[data-overlay="${name}"]`);
    if (!el) return;
    el.hidden = false;
    void el.offsetWidth; // start the fade-in from the hidden state
    el.classList.add('on');
    this.overlays.add(name);
    this.emit('overlay', true);
  }

  close(name) {
    const el = this.root.querySelector(`[data-overlay="${name}"]`);
    if (!el || el.hidden) return;
    el.classList.remove('on');
    el.hidden = true;
    this.overlays.delete(name);
    if (!this.overlays.size) this.emit('overlay', false);
  }

  get covered() {
    return this.overlays.size > 0;
  }

  /** Title screen. Resolves when the visitor enters. */
  showStart() {
    this.open('start');
    return new Promise((resolve) => {
      this.$('[data-start]').addEventListener('click', () => {
        this.close('start');
        resolve();
      }, { once: true });
      setTimeout(() => this.$('[data-start]').focus(), 50);
    });
  }

  /** "This zone isn't open yet" card. Resolves with 'back' or 'map'. */
  showLocked(zone) {
    this.$('.locked-kicker').textContent = `Zone ${zone.n} · ${zone.verb}`;
    this.$('.locked-title').textContent = `${zone.name} is being built`;
    this.$('.locked-body').textContent = `${zone.blurb} This virtual centre opens one zone at a time, and this one is next. For now, TRAVIS will take you back to the Welcome Zone.`;
    this.open('locked');
    return new Promise((resolve) => {
      const el = this.root.querySelector('[data-overlay="locked"]');
      const on = (e) => {
        const b = e.target.closest('[data-back],[data-map]');
        if (!b) return;
        el.removeEventListener('click', on);
        this.close('locked');
        resolve(b.hasAttribute('data-map') ? 'map' : 'back');
      };
      el.addEventListener('click', on);
    });
  }

  toggleMap() {
    if (this.overlays.has('map')) { this.close('map'); return; }
    this.#renderPlan();
    this.open('map');
  }

  #renderPlan() {
    // Top row 01-03, bottom row 06-04: the loop runs east, then returns west to the start.
    const order = [0, 1, 2, 5, 4, 3];
    const label = { live: 'Open', empty: 'Empty room', next: 'Being built', planned: 'Planned' };
    this.$('.plan').innerHTML = order.map((i) => {
      const z = this.zones[i];
      const here = z.id === this.zoneId;
      // Each room is a button: click it to go straight to that zone.
      return `<button type="button" class="plan-room ${z.status} ${here ? 'here' : ''}" data-zone="${z.id}" aria-label="${here ? `${esc(z.name)}: you are here` : `Go to ${esc(z.name)}`}">
        <span class="pr-top"><span class="pr-n">${z.n}</span><span class="pr-s">${here ? 'You are here' : label[z.status]}</span></span>
        <strong>${esc(z.short)}</strong><small>${esc(z.verb)}</small><span class="pr-b">${esc(z.blurb)}</span>
        ${here ? '' : '<span class="pr-go">Go there →</span>'}</button>`;
    }).join('') + '<div class="plan-lane" aria-hidden="true"><span>Entry →</span><span>← Exit</span></div>';
  }

  /* ---------- in-world UI ---------- */

  setZone(zone) {
    this.zoneId = zone.id;
    const chip = this.$('.zone-chip');
    chip.hidden = false;
    chip.querySelector('.zn').textContent = zone.n;
    chip.querySelector('small').textContent = zone.verb;
    chip.querySelector('strong').textContent = zone.name;
  }

  /**
   * A zone's own switch in the top bar, between two (or more) ways its exhibit runs: options
   * [{ id, label }] and the one that's on, or null to take it away. A press emits 'mode' (id).
   */
  modeSwitch(options, active = null, label = '') {
    const el = this.$('.mode-switch');
    el.hidden = !options;
    if (!options) return;
    el.setAttribute('aria-label', label);
    el.innerHTML = options.map((o) => `<button type="button" data-mode="${esc(o.id)}" aria-pressed="${o.id === active}">${esc(o.label)}</button>`).join('');
  }

  showPlayUI(on) {
    for (const s of ['.objectives', '.caption', '.minimap']) this.$(s).hidden = !on;
    this.showStops(on);
  }

  showStops(on) {
    this.$('.stops').hidden = !on || !this.stops?.length;
  }

  /** The call to action at the entrance, before the visitor has stepped inside. */
  enterButton(on) {
    this.$('.enter-cta').hidden = !on;
  }

  /* ---------- stops ---------- */

  /** list: [{ id, label }] in the order a visitor would take them. */
  setStops(list) {
    this.stops = list;
    this.$('.stops ol').innerHTML = list.map((s, i) =>
      `<li><button type="button" data-stop="${esc(s.id)}"><span class="st-n">${String(i + 1).padStart(2, '0')}</span><span class="st-l">${esc(s.label)}</span></button></li>`).join('');
    this.stopState = {};
  }

  /** Highlight where the visitor is (here), where they're heading (going) and the suggested next stop. */
  markStops({ here = null, going = null, next = null } = {}) {
    const st = this.stopState || {};
    if (st.here === here && st.going === going && st.next === next) return;
    this.stopState = { here, going, next };
    this.root.querySelectorAll('.stops [data-stop]').forEach((b) => {
      const id = b.dataset.stop;
      b.classList.toggle('here', id === here);
      b.classList.toggle('going', id === going);
      b.classList.toggle('next', id === next && id !== here && !going);
      if (id === here) b.setAttribute('aria-current', 'location'); else b.removeAttribute('aria-current');
    });
    this.root.querySelectorAll('.mm-pt').forEach((g) => g.classList.toggle('here', g.dataset.id === here));
  }

  /** Cinematic title as the visitor arrives at a stop; stopTitle(null) clears it. */
  stopTitle(kicker, name) {
    const el = this.$('.stop-title');
    clearTimeout(this.titleTimer);
    if (!kicker) { el.classList.remove('on'); return; }
    el.querySelector('.kicker').textContent = kicker;
    el.querySelector('.st-name').textContent = name;
    el.classList.remove('on');
    void el.offsetWidth; // restart the transition
    el.classList.add('on');
    this.titleTimer = setTimeout(() => el.classList.remove('on'), 2400);
  }

  setObjectives(list) {
    this.objectives = list.map((o) => ({ ...o, done: false }));
    this.#renderObjectives();
  }

  completeObjective(id) {
    const o = this.objectives?.find((x) => x.id === id);
    if (!o || o.done) return false;
    o.done = true;
    this.#renderObjectives(id);
    return true;
  }

  #renderObjectives(justDone) {
    const next = this.objectives.find((o) => !o.done);
    this.$('.objectives ol').innerHTML = this.objectives.map((o) =>
      `<li class="${o.done ? 'done' : ''} ${o === next ? 'next' : ''} ${o.id === justDone ? 'pop' : ''}"><i></i><span>${esc(o.text)}</span></li>`).join('');
  }

  caption(text, name = 'TRAVIS') {
    this.$('.cap-name').textContent = name;
    this.$('.caption').classList.toggle('guest', name !== 'TRAVIS');
    const el = this.$('.cap-text');
    clearInterval(this.capTimer);
    el.textContent = '';
    let i = 0;
    this.capTimer = setInterval(() => {
      i += 2;
      el.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(this.capTimer);
    }, 18);
  }

  speaking(on) {
    this.$('.caption').classList.toggle('talking', on);
  }

  prompt(item, { touch = false } = {}) {
    const el = this.$('.prompt');
    if (!item) { el.hidden = true; return; }
    el.hidden = false;
    el.querySelector('kbd').textContent = touch ? 'Tap' : 'Click';
    el.querySelector('span').textContent = `${item.verb} · ${item.label}`;
  }

  /** A one-off hint about looking and travelling, shown for a few seconds. */
  lookHint(text, ms = 6500) {
    const el = this.$('.look-hint');
    clearTimeout(this.lookTimer);
    el.textContent = text;
    el.hidden = false;
    this.lookTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  info(card) {
    const el = this.$('.info');
    if (!card) { el.hidden = true; this.infoId = null; return; }
    this.infoId = card.id;
    el.querySelector('.info-kicker').textContent = card.kicker;
    el.querySelector('.info-title').textContent = card.title;
    el.querySelector('.info-body').textContent = card.body;
    el.querySelector('.info-client p').textContent = card.client;
    el.hidden = false;
  }

  /** cta: the button is the way on to the next zone: brand red, beckoning, so it can't be missed. */
  skipButton(on, label = 'Skip arrival', { cta = false } = {}) {
    this.$('.skip').hidden = !on;
    this.$('.skip span').textContent = label;
    this.$('.skip').classList.toggle('cta', on && cta);
  }

  toast(text, ms = 2600) {
    const t = this.$('.toast');
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('on'), ms);
  }

  /** Fade the whole view to black (true) or back (false). */
  fade(on, ms = 260) {
    const f = this.$('.fade');
    f.style.transitionDuration = `${ms}ms`;
    f.classList.toggle('on', on);
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Full-screen portal transition with the destination name. */
  async portal(label, sub) {
    const f = this.$('.fade');
    f.innerHTML = `<div class="warp"><i></i><i></i><i></i></div><div class="warp-t"><div class="kicker">${esc(sub)}</div><div class="warp-n">${esc(label)}</div></div>`;
    f.classList.add('portal');
    await this.fade(true, 380);
    await new Promise((r) => setTimeout(r, 900));
  }

  async endPortal() {
    const f = this.$('.fade');
    await this.fade(false, 420);
    f.classList.remove('portal');
    f.innerHTML = '';
  }

  bridge(status, url) {
    const b = this.$('.bridge');
    b.dataset.s = status;
    const text = { online: 'TRAVIS live', connecting: 'Finding TRAVIS', offline: 'Simulated', off: 'Simulated' }[status] || status;
    b.querySelector('span').textContent = text;
    b.title = status === 'online'
      ? `Connected to TRAVIS at ${url}.`
      : `Not connected to TRAVIS (${url}). The zone runs on its own.`;
    this.$('.bridge-help').textContent = status === 'online'
      ? `Connected to TRAVIS at ${url}. The zone tells TRAVIS when a visitor steps inside.`
      : `Not connected. Start TRAVIS's WebSocket bridge on this machine (port 8765), or open this page with ?bridge=ws://host:8765. The zone works the same without it.`;
  }

  fps(value) {
    const el = this.$('.fps');
    if (!el.hidden) el.textContent = `${value} fps`;
  }

  /* ---------- minimap ---------- */

  /**
   * plan: { walls: [[x1,z1,x2,z2]...], features: [{type: 'line'|'rect'|'poly', ...}], points: [{id,x,z,label}] }
   */
  setMinimap(plan) {
    const svg = this.$('.minimap svg');
    const [minX, minZ, w, h] = plan.viewBox;
    svg.setAttribute('viewBox', `${minX} ${minZ} ${w} ${h}`);
    let s = `<rect x="${minX + 0.1}" y="${minZ + 0.1}" width="${w - 0.2}" height="${h - 0.2}" rx="0.6" class="mm-bg"/>`;
    for (const [x1, z1, x2, z2] of plan.walls) s += `<line x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}" class="mm-wall"/>`;
    for (const f of plan.features) {
      if (f.type === 'line') s += `<line x1="${f.x1}" y1="${f.z1}" x2="${f.x2}" y2="${f.z2}" class="mm-${f.cls}"/>`;
      else if (f.type === 'poly') s += `<polyline points="${f.points.map(([x, z]) => `${x},${z}`).join(' ')}" class="mm-${f.cls}"/>`;
      else s += `<rect x="${f.x - f.w / 2}" y="${f.z - f.d / 2}" width="${f.w}" height="${f.d}" rx="0.15" class="mm-${f.cls}"/>`;
    }
    for (const p of plan.points) {
      s += `<g class="mm-pt" data-id="${p.id}" tabindex="0" role="button" aria-label="Travel to ${esc(p.label)}"><circle cx="${p.x}" cy="${p.z}" r="0.55"/><circle cx="${p.x}" cy="${p.z}" r="1.1" class="mm-hit"/></g>`;
    }
    s += `<g class="mm-me"><path d="M0 -0.9 L0.6 0.6 L0 0.25 L-0.6 0.6 Z"/></g>`;
    svg.innerHTML = s;
    this.mmMe = svg.querySelector('.mm-me');
    this.mmT = null;
    svg.querySelectorAll('.mm-pt').forEach((g) => {
      const go = () => this.emit('teleport', g.dataset.id);
      g.addEventListener('click', go);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  updateMinimap(x, z, yaw) {
    if (!this.mmMe) return;
    const t = `translate(${x.toFixed(2)} ${z.toFixed(2)}) rotate(${(-yaw * 180 / Math.PI).toFixed(1)})`;
    if (t === this.mmT) return;                        // standing still: leave the DOM alone
    this.mmT = t;
    this.mmMe.setAttribute('transform', t);
  }
}
