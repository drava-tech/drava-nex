import { Emitter } from '../util/Emitter.js';

// Lines recorded with ElevenLabs (pnpm voice, scripts/voice.js): manifest.json maps each line's
// text to its mp3, per voice. A line not in it (e.g. the recap) uses the browser's voice.
const VOICE_BASE = `${import.meta.env.BASE_URL}voice/`;

/**
 * TRAVIS, the host. Queues lines, shows them as captions (via the HUD) and,
 * when voice is on, plays their ElevenLabs recording, or speaks them with the
 * browser's speech engine when there is none.
 *
 * Other people can speak through the same queue (e.g. the CEO in the Holobox):
 * say(lines, { speaker: { name, voice: 'alt' } }) captions them under their own name
 * and, when possible, in a different voice from TRAVIS.
 *
 * `level` (0..1) rises while anyone is speaking; `speaker` is who is speaking now
 * (null for TRAVIS). The Holobox reads both to animate.
 * Emits: 'line' (text, speakerName), 'start', 'end', 'idle'.
 */
export class Travis extends Emitter {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.voiceOn = true;
    this.level = 0;
    this.voice = null;
    this.altVoice = null;                 // a second voice for guest speakers
    this.recorded = { travis: {}, alt: {} };
    this.audio = null;
    fetch(`${VOICE_BASE}manifest.json`).then((r) => r.json()).then((m) => { this.recorded = m; }).catch(() => {});
    this.synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
    if (this.synth) {
      this.#pickVoice();
      this.synth.addEventListener?.('voiceschanged', () => this.#pickVoice());
    }
  }

  #pickVoice() {
    const voices = this.synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
    if (!voices.length) return;
    const score = (v) =>
      (/natural|neural|online/i.test(v.name) ? 8 : 0) +
      (/en[-_]GB/i.test(v.lang) ? 4 : /en[-_]IN/i.test(v.lang) ? 3 : /en[-_]US/i.test(v.lang) ? 2 : 0) +
      (/ryan|guy|daniel|george|male|david|mark|rishi|prabhat/i.test(v.name) ? 2 : 0) +
      (v.localService ? 1 : 0);
    const ranked = voices.sort((a, b) => score(b) - score(a));
    this.voice = ranked[0];
    this.altVoice = ranked.find((v) => v !== this.voice && v.name !== this.voice.name) || this.voice;
  }

  setVoice(on) {
    this.voiceOn = on;
    if (!on) { this.synth?.cancel(); this.audio?.pause(); }
  }

  /**
   * Say one line or several. Options:
   *  interrupt: drop anything queued and cut in now
   *  pause:     ms to hold after the line before the next one
   *  speaker:   { name, voice: 'alt' } for someone other than TRAVIS
   * Returns a promise that resolves when the (last) line has finished.
   */
  say(lines, { interrupt = false, pause = 350, speaker = null } = {}) {
    const list = Array.isArray(lines) ? lines : [lines];
    if (interrupt) this.stop();
    let last;
    for (const text of list) {
      last = new Promise((resolve) => this.queue.push({ text, pause, speaker, resolve }));
    }
    if (!this.current) this.#next();
    return last;
  }

  stop() {
    this.queue.forEach((q) => q.resolve());
    this.queue = [];
    this.synth?.cancel();
    this.audio?.pause();
    if (this.current) { clearTimeout(this.current.timer); this.current.resolve(); this.current = null; }
  }

  get busy() {
    return !!this.current || this.queue.length > 0;
  }

  #next() {
    const item = this.queue.shift();
    if (!item) { this.current = null; this.emit('idle'); return; }
    this.current = item;
    this.emit('line', item.text, item.speaker?.name ?? 'TRAVIS');
    this.emit('start');

    let finished = false;
    const started = performance.now();
    const minMs = Math.max(1500, item.text.length * 38); // keep captions readable
    const finish = () => {
      if (finished || this.current !== item) return;
      const elapsed = performance.now() - started;
      if (elapsed < minMs) { clearTimeout(item.timer); item.timer = setTimeout(finish, minMs - elapsed); return; }
      finished = true;
      clearTimeout(item.timer);
      this.emit('end');
      setTimeout(() => { item.resolve(); if (this.current === item) this.#next(); }, item.pause);
    };

    // Reading-time fallback so captions advance even without speech.
    const readMs = Math.max(2200, item.text.length * 62);
    const guest = item.speaker?.voice === 'alt';
    const file = this.voiceOn && this.recorded[guest ? 'alt' : 'travis']?.[item.text];
    if (file) {
      const audio = (this.audio = new Audio(VOICE_BASE + file));
      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
      item.timer = setTimeout(finish, readMs * 2 + 6000); // only if playback stalls
    } else if (this.voiceOn && this.synth) {
      try {
        const u = new SpeechSynthesisUtterance(item.text);
        const voice = guest ? this.altVoice : this.voice;
        if (voice) u.voice = voice;
        u.rate = guest ? 0.85 : 0.88; // a little slower than the browser default, so it never sounds rushed
        u.pitch = guest ? 1.02 : 0.92;
        u.onend = finish;
        u.onerror = finish;
        this.synth.speak(u);
        item.timer = setTimeout(finish, readMs + 6000);
      } catch {
        item.timer = setTimeout(finish, readMs);
      }
    } else {
      item.timer = setTimeout(finish, readMs);
    }
  }

  /** Who is speaking right now: the speaker object, or null for TRAVIS or silence. */
  get speaker() {
    return this.current?.speaker ?? null;
  }

  update(dt, t) {
    const talking = !!this.current;
    const target = talking ? 0.45 + 0.55 * Math.abs(Math.sin(t * 11.3) * Math.sin(t * 4.1 + 1.2)) : 0;
    this.level += (target - this.level) * Math.min(1, dt * 14);
  }
}
