export const ease = {
  linear: (t) => t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  // Quintic: zero speed and zero acceleration at both ends, so glides start and land without a jolt.
  smoother: (t) => t * t * t * (t * (t * 6 - 15) + 10),
  sine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
};

/** Animate fn(eased, raw) from 0 to 1 over `duration` ms. Resolves when done. */
export function tween(duration, fn, easing = ease.inOut) {
  return new Promise((resolve) => {
    if (duration <= 0) { fn(1, 1); resolve(); return; }
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / duration);
      fn(easing(k), k);
      if (k < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Shortest-way interpolation between two angles (radians). */
export const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
