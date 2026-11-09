import { TRAINER } from '../script.js';

// The channel between the bench in the Simulation Zone (the camera) and the trainer page.
//   bench → page  { type: 'seen', tags, facing }   what the camera sees on the mat, on every change
//                                                  and once a second; facing: the car's side toward it
//   bench → page  { type: 'mistake', kind }       a wrong action by the visitor ('no_base': a part before the first)
//   page → bench  { type: 'reset' }                a new session: the bench puts the parts back in the tray
//   page → bench  { type: 'status', status }       the trainer's state, for TRAVIS (see main.js)
// The camera picture itself doesn't go through the channel: the bench draws it straight into
// the page (window.vecFeed, main.js), as the page sits in an iframe of the same origin.
export const CHANNEL = 'vec-assembly';

const FPS = 10;          // frames the "classifier" looks at per second
const CONFIRM = 3;       // frames in a row a part must be seen before it counts
const LOSE = 10;         // frames in a row a counted part must be missing before it stops counting
const CAMERA_LOST = 2500; // ms without a word from the bench: the camera isn't looking at the build

/**
 * A stand-in for the real trainer's backend (web_server.py + inference_loop.py): it "classifies"
 * FPS frames a second from what the bench reports and answers status() in the shape of the real
 * /api/status. A part counts once seen for CONFIRM frames and stays counted; next_step is the first step whose
 * parts aren't all counted. A counted part that belongs to a later step is a mismatch: the amber
 * banner, and a mismatch frame against the accuracy.
 */
export class Backend {
  constructor() {
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.addEventListener('message', (e) => this.#message(e.data));
    this.seen = new Set();
    this.facing = null;
    this.heard = 0;
    this.reset({ quiet: true });
    setInterval(() => this.#frame(), 1000 / FPS);
  }

  /** A new session (the page's requestReset): counts start over and the bench clears the mat. */
  reset({ quiet = false } = {}) {
    this.confirmed = new Set();
    this.streak = {};
    this.missing = {};
    this.totalFrames = 0;
    this.mismatchFrames = 0;
    this.startedAt = Date.now() / 1000;
    if (!quiet) this.channel.postMessage({ type: 'reset' });
  }

  /** Tell the bench (TRAVIS) where the trainer is. */
  report(status) {
    this.channel.postMessage({ type: 'status', status });
  }

  #message(m) {
    if (m?.type === 'mistake') { this.onMistake?.(m.kind); return; }
    if (m?.type !== 'seen') return;
    this.seen = new Set(m.tags);
    this.facing = m.facing;
    this.heard = Date.now();
  }

  get #aimed() {
    return Date.now() - this.heard < CAMERA_LOST;
  }

  #frame() {
    const seen = this.#aimed ? this.seen : new Set();
    for (const tag of Object.keys(TRAINER.tagLabels)) {
      if (seen.has(tag)) {
        this.streak[tag] = (this.streak[tag] ?? 0) + 1;
        this.missing[tag] = 0;
        if (this.streak[tag] >= CONFIRM) this.confirmed.add(tag);
      } else {
        this.streak[tag] = 0;
        if (this.#aimed) this.missing[tag] = (this.missing[tag] ?? 0) + 1;
        if (this.missing[tag] >= LOSE) this.confirmed.delete(tag);
      }
    }
    this.totalFrames++;
    if (this.#early().length) this.mismatchFrames++;
  }

  #nextStep() {
    return TRAINER.states.find((s) => !s.requires.every((t) => this.confirmed.has(t))) ?? null;
  }

  /** Counted parts that belong to a step after the current one. */
  #early() {
    const next = this.#nextStep();
    if (!next) return [];
    return [...this.confirmed].filter((t) => !next.requires.includes(t));
  }

  /** The same fields as the real /api/status. */
  status() {
    const next = this.#nextStep();
    const i = next ? TRAINER.states.indexOf(next) : TRAINER.states.length;
    const early = this.#early();
    const message = !this.#aimed ? TRAINER.messages.noCamera
      : early.length ? TRAINER.messages.early(TRAINER.tagLabels[early[0]], next.label) : '';
    return {
      completed_step: i > 0 ? TRAINER.states[i - 1].step : null,
      confirmed_tags: [...this.confirmed],
      instructions: next?.instructions ?? null,
      message,
      mismatch: early.length > 0,
      mismatch_frames: this.mismatchFrames,
      model: next?.model ?? TRAINER.states.at(-1).model,
      next_step: next,
      product_name: TRAINER.product,
      session_started_at: this.startedAt,
      states: TRAINER.states,
      tag_labels: TRAINER.tagLabels,
      tag_probs: {},
      total_frames: this.totalFrames,
    };
  }
}
