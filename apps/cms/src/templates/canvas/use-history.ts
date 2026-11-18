"use client";

import { useCallback, useRef, useState } from "react";

const LIMIT = 100;

/**
 * Undo/redo over an immutable value.
 *
 *  - `set(next)` records one undo step.
 *  - Continuous gestures (drag, resize, rotate, typing in a colour picker) call
 *    `begin()` once, then `set(next, { record: false })` per frame, then
 *    `end()` — the whole gesture becomes ONE undo step, not hundreds.
 */
export function useHistory<T>(initial: T) {
  const [present, setPresent] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const checkpoint = useRef<T | null>(null);
  const presentRef = useRef(present);
  presentRef.current = present;
  // Bumps on every history change so canUndo/canRedo re-render.
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const push = (prev: T) => {
    past.current.push(prev);
    if (past.current.length > LIMIT) past.current.shift();
    future.current = [];
  };

  const set = useCallback((next: T | ((prev: T) => T), opts: { record?: boolean } = {}) => {
    const prev = presentRef.current;
    const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
    if (Object.is(value, prev)) return;
    if (opts.record !== false && checkpoint.current === null) push(prev);
    presentRef.current = value;
    setPresent(value);
    bump();
  }, []);

  const begin = useCallback(() => {
    if (checkpoint.current === null) checkpoint.current = presentRef.current;
  }, []);

  const end = useCallback(() => {
    const start = checkpoint.current;
    checkpoint.current = null;
    if (start !== null && !Object.is(start, presentRef.current)) {
      push(start);
      bump();
    }
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(presentRef.current);
    presentRef.current = prev;
    setPresent(prev);
    bump();
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(presentRef.current);
    presentRef.current = next;
    setPresent(next);
    bump();
  }, []);

  return {
    value: present,
    set,
    begin,
    end,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
