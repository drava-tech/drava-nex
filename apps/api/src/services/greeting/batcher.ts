/**
 * Collects items for a short window, then hands them over as one batch.
 *
 * The first add() opens the window; later adds join it WITHOUT extending it, so
 * a steady stream of people can't postpone a greeting forever. An add() after
 * the flush starts a new batch. windowMs = 0 disables grouping: every item is
 * flushed on its own, immediately.
 */
export class Batcher<T> {
  private items: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly windowMs: number,
    private readonly onFlush: (items: T[]) => void
  ) {}

  add(item: T): void {
    if (this.windowMs <= 0) {
      this.onFlush([item]);
      return;
    }
    this.items.push(item);
    if (this.timer) return; // window already open — join it, don't extend it
    this.timer = setTimeout(() => this.flush(), this.windowMs);
    // Never keep the process alive just to deliver a greeting.
    this.timer.unref?.();
  }

  private flush(): void {
    const batch = this.items;
    this.items = [];
    this.timer = null;
    if (batch.length > 0) this.onFlush(batch);
  }
}
