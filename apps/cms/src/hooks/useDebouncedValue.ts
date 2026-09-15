"use client";

import { useEffect, useState } from "react";

/**
 * The value, but only after it has stopped changing for `delayMs`.
 *
 * Used for search boxes that drive a server request: without this every
 * keystroke is its own round trip, and the results flicker between whichever
 * responses happen to land out of order. Pair it with a request-sequence guard
 * if out-of-order responses would be visible.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
