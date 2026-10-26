/**
 * "Log this at most once per key per window" — keeps a decision visible without
 * letting a repeated sighting (VISITOR_DETECTED every ~30 s while someone stands
 * in frame) turn into log spam.
 */
export class LogOnce {
  private readonly last = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Runs `write` and returns true unless this key was already written inside `ttlMs`. */
  log(key: string, ttlMs: number, write: () => void): boolean {
    const t = this.now();
    const previous = this.last.get(key);
    if (previous !== undefined && t - previous < ttlMs) return false;
    this.last.set(key, t);
    if (this.last.size > 2_000) {
      // bounded: forget the oldest half
      const stale = [...this.last.entries()].sort((a, b) => a[1] - b[1]).slice(0, 1_000);
      for (const [k] of stale) this.last.delete(k);
    }
    write();
    return true;
  }
}
