/**
 * Synthesised sound, no audio files needed: a welcome chime, a light-sheet sweep, a teleport whoosh
 * and the rush of the World Zone's waterfall.
 * Browsers only allow audio after a click, so call start() from one.
 */
export class AudioFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(ctx.destination);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(on ? 0.8 : 0, this.ctx.currentTime + 0.3);
  }

  #tone(freq, start, dur, { type = 'sine', gain = 0.12 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  #noise(dur) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  /** The steady rush of falling water (the World Zone's waterfall), faded in; water(false) fades it out. */
  water(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (on && !this.waterGain) {
      const src = this.#noise(4);
      src.loop = true;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 1400;
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 160;
      this.waterGain = ctx.createGain();
      this.waterGain.gain.value = 0;
      src.connect(high).connect(low).connect(this.waterGain).connect(this.master);
      src.start();
    }
    if (!this.waterGain) return;
    const g = this.waterGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(on ? 0.06 : 0, now + 1.5);
  }

  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    [659.3, 880, 1174.7, 1318.5].forEach((f, i) => this.#tone(f, t + i * 0.11, 1.6, { gain: 0.07 }));
    this.#tone(329.6, t, 2.4, { gain: 0.05, type: 'triangle' });
  }

  scan(duration = 1.8) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.linearRampToValueAtTime(660, t + duration);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1200;
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.1);
    g.gain.linearRampToValueAtTime(0.0, t + duration);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  whoosh(duration = 0.9) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.#noise(duration);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + duration * 0.6);
    f.frequency.exponentialRampToValueAtTime(400, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + duration * 0.4);
    g.gain.linearRampToValueAtTime(0, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  /** A drop of water: a soft blip that falls quickly in pitch (a touch on the World Zone's glass). */
  drop() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1000 + Math.random() * 400, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.28);
  }

  /** Something found: two soft bell notes a fifth apart. */
  ping() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    this.#tone(784, t, 1.1, { gain: 0.05 });
    this.#tone(1174.7, t + 0.09, 1.3, { gain: 0.045 });
  }

  tick() {
    if (!this.ctx) return;
    this.#tone(1400, this.ctx.currentTime, 0.08, { gain: 0.04, type: 'square' });
  }

  /** A door lock: a solid mechanical clunk, then a short beep (rising when it opens, falling when it locks). */
  latch(open = true) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.#noise(0.09);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    this.#tone(110, t, 0.12, { gain: 0.1, type: 'triangle' });
    const [a, b] = open ? [1318.5, 1760] : [1318.5, 987.8];
    this.#tone(a, t + 0.14, 0.12, { gain: 0.04 });
    this.#tone(b, t + 0.27, 0.18, { gain: 0.04 });
  }

  /**
   * The hologram powering up: a short swell as it appears. (It used to leave a steady 196 Hz tone
   * running, which nothing ever stopped, so it droned on through every zone.) hum(false) is a no-op.
   */
  hum(on) {
    if (!this.ctx || !on) return;
    const t = this.ctx.currentTime;
    this.#tone(98, t, 2.5, { gain: 0.08, type: 'triangle' });
    this.#tone(392, t + 0.4, 2.0, { gain: 0.04 });
  }
}
