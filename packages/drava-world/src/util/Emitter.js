// Tiny event emitter shared by the core services.
export class Emitter {
  #handlers = new Map();

  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(fn);
    return () => this.#handlers.get(event)?.delete(fn);
  }

  emit(event, ...args) {
    this.#handlers.get(event)?.forEach((fn) => {
      try { fn(...args); } catch (err) { console.error(`[${event}]`, err); }
    });
  }
}
