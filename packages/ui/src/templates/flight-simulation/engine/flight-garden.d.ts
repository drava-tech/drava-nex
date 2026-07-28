// Typed boundary for the ported Flight Garden engine (flight-garden.js).
//
// The implementation is deliberately untyped JavaScript — see the header
// comment in flight-garden.js. This declaration is what every caller sees, so
// the React layer is fully type-checked even though the engine internals are
// not.

import type { FlightGardenHandle, FlightGardenOptions } from "./types";

/**
 * Boots one isolated instance of the Flight Garden into `host`.
 *
 * The engine creates its own canvas and HUD inside the host element, owns a
 * WebGL context and a requestAnimationFrame loop, and must be shut down with
 * the returned `dispose()` — nothing is released automatically.
 *
 * Browser-only: it touches `document` and `window` immediately, so it must not
 * be imported during server rendering. Load it from inside an effect
 * (`await import(...)`) rather than at module scope.
 */
export function createFlightGarden(
  host: HTMLElement,
  options?: FlightGardenOptions
): FlightGardenHandle;
