import { Emitter } from '../../../util/Emitter.js';

// The session report: how a build went, step by step. One JSON shape (below) is what the completed
// screen shows, the CSV download writes and an optional server stores.
//
//   {
//     user: 'optional id', product: 'Shaft Assembly',
//     totalSeconds: 214.3, cleanSteps: 3, totalSteps: 4, mistakes: 1,
//     steps: [{ label: 'Shaft', seconds: 12.1, mistakes: 0, builtAhead: false }, ...]
//   }

/**
 * The three events the trainer fires (main.js), whatever the source: here the bench's parts and the
 * vision stand-in (backend.js), in a real centre the classifier or the virtual build.
 *   session_start                  the visitor starts (or restarts) a build
 *   step_changed(stepIndex)        the current step changed; stepIndex === steps.length: finished
 *   mistake(stepIndex, type)       a wrong action: 'out_of_order' (a part for a later step went on),
 *                                  'no_base' (a part dropped before the first one is on)
 */
export const sessionEvents = new Emitter();

export class SessionReport {
  constructor(steps, { product = '', user = null } = {}) {
    this.steps = steps;
    this.product = product;
    this.user = user;
    this.reset();
  }

  reset() {
    this.t0 = Date.now();
    this.cur = null;
    this.enteredAt = 0;
    this.sec = this.steps.map(() => 0);
    this.mist = this.steps.map(() => 0);
    this.ahead = this.steps.map(() => false);
  }

  /** idx === steps.length: finished. Steps jumped over were built ahead of the trainer's order. */
  stepChanged(idx) {
    const now = Date.now();
    if (this.cur !== null && this.cur < this.steps.length) this.sec[this.cur] += (now - this.enteredAt) / 1000;
    if (this.cur !== null && idx > this.cur + 1) for (let i = this.cur + 1; i < idx; i++) this.ahead[i] = true;
    this.cur = idx;
    this.enteredAt = now;
  }

  /** A wrong action on step `idx` (the event's stepIndex; the current step if not given). */
  mistake(idx = this.cur) {
    if (idx !== null && idx >= 0 && idx < this.steps.length) this.mist[idx]++;
  }

  /** The report so far, in the schema above. Call it when the build is finished to freeze it. */
  build() {
    const now = Date.now();
    const rows = this.steps.map((s, i) => {
      // The step being timed now has its time so far.
      const seconds = this.sec[i] + (i === this.cur ? (now - this.enteredAt) / 1000 : 0);
      return {
        label: s.label,
        seconds: this.ahead[i] && seconds < 1 ? null : Math.round(seconds * 10) / 10,
        mistakes: this.mist[i],
        builtAhead: this.ahead[i],
      };
    });
    return {
      user: this.user,
      product: this.product,
      totalSeconds: Math.round(((now - this.t0) / 1000) * 10) / 10,
      cleanSteps: rows.filter((r) => r.mistakes === 0).length,
      totalSteps: rows.length,
      mistakes: rows.reduce((n, r) => n + r.mistakes, 0),
      steps: rows,
    };
  }
}

/** The report as CSV text: a row a step, then the totals. */
export function reportCsv(report) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['step', 'label', 'seconds', 'mistakes', 'built_ahead'].join(',')];
  report.steps.forEach((s, i) => lines.push([i + 1, q(s.label), s.seconds ?? '', s.mistakes, s.builtAhead].join(',')));
  lines.push('');
  lines.push(['user', q(report.user)].join(','));
  lines.push(['product', q(report.product)].join(','));
  lines.push(['total_seconds', report.totalSeconds].join(','));
  lines.push(['clean_steps', `${report.cleanSteps}/${report.totalSteps}`].join(','));
  lines.push(['mistakes', report.mistakes].join(','));
  return lines.join('\r\n');
}

/** Hand the file to the browser to save. */
export function downloadCsv(report, name = 'assembly-report.csv') {
  const url = URL.createObjectURL(new Blob([reportCsv(report)], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** POST the report to a server (TRAINER.report.url); a failure is logged, never shown. */
export async function postReport(url, report) {
  if (!url) return;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report), keepalive: true });
    if (!res.ok) console.warn('[report] the server answered', res.status);
  } catch (err) {
    console.warn('[report] not sent:', err.message);
  }
}
