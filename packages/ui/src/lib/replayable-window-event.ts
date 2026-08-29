"use client";

import { useEffect } from "react";

/**
 * A late-joining client's SET_* listener (e.g. PortfolioLiveApp's
 * "portfolio-set-view") often isn't mounted yet when the gateway replays its
 * cached view-state right after WELCOME — the content has to flow through a
 * multi-render preload pipeline first. A plain window.dispatchEvent loses
 * that replay entirely. This remembers the last value per event name so a
 * listener that mounts afterward can catch up immediately instead of
 * defaulting to its initial state.
 */
const lastEventDetail = new Map<string, unknown>();

export function dispatchReplayableEvent(name: string, detail?: unknown): void {
  lastEventDetail.set(name, detail);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function useReplayableWindowEvent<T = unknown>(
  name: string,
  handler: (detail: T) => void
): void {
  useEffect(() => {
    if (lastEventDetail.has(name)) {
      handler(lastEventDetail.get(name) as T);
    }
    const onEvent = (e: Event) => handler((e as CustomEvent<T>).detail);
    window.addEventListener(name, onEvent);
    return () => window.removeEventListener(name, onEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}

/**
 * The last value dispatched under `name`, for a consumer that subscribes to a
 * fixed list of event names imperatively and so can't use the hook above.
 * Same catch-up purpose — see the docblock on lastEventDetail.
 */
export function lastReplayableDetail<T = unknown>(name: string): T | undefined {
  return lastEventDetail.get(name) as T | undefined;
}
