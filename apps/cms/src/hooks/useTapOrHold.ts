"use client";

import { useEffect, useRef } from "react";
import type React from "react";

/** How long a press must last to count as a hold (ms). */
const HOLD_MS = 500;
/** A finger that travels this far (px) was scrolling, not pressing. */
const MOVE_CANCEL_PX = 10;

/**
 * Tells a tap from a press-and-hold on one control whose tap already does
 * something (opens a menu) and whose hold should do something else. Spread the
 * returned props on the element.
 *
 * Built for a Radix DropdownMenuTrigger: calling preventDefault in
 * onPointerDown is how Radix's own composed handler knows to skip its
 * open-on-press, so the tap is reported on RELEASE instead. A hold must not
 * flash the menu open first.
 *
 * A right-click counts as a hold. So does Android's own long-press
 * `contextmenu`; preventDefault there also stops the system's text-selection
 * callout from appearing over the control.
 */
export function useTapOrHold({
  onTap,
  onHold,
  holdEnabled = true,
}: {
  onTap: () => void;
  onHold: () => void;
  /** False: a hold does nothing, and a tap still reports on release. */
  holdEnabled?: boolean;
}) {
  const onTapRef = useRef(onTap);
  const onHoldRef = useRef(onHold);
  onTapRef.current = onTap;
  onHoldRef.current = onHold;

  const press = useRef<{ id: number | null; x: number; y: number; timer: number | null; held: boolean }>({
    id: null,
    x: 0,
    y: 0,
    timer: null,
    held: false,
  });

  const clearTimer = () => {
    const p = press.current;
    if (p.timer !== null) window.clearTimeout(p.timer);
    p.timer = null;
  };

  useEffect(() => () => clearTimer(), []);

  const hold = () => {
    const p = press.current;
    if (p.held) return; // the timer and Android's contextmenu both report one hold
    p.held = true;
    onHoldRef.current();
  };

  return {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      const p = press.current;
      p.held = false;
      clearTimer();
      if (e.button !== 0) return; // a right-click arrives as contextmenu
      e.preventDefault();
      p.id = e.pointerId;
      p.x = e.clientX;
      p.y = e.clientY;
      if (holdEnabled) {
        p.timer = window.setTimeout(() => {
          p.timer = null;
          hold();
        }, HOLD_MS);
      }
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const p = press.current;
      if (e.pointerId !== p.id) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_CANCEL_PX) {
        clearTimer();
        p.id = null;
      }
    },
    onPointerUp(e: React.PointerEvent<HTMLElement>) {
      const p = press.current;
      if (e.pointerId !== p.id) return;
      p.id = null;
      clearTimer();
      if (!p.held) onTapRef.current();
    },
    onPointerCancel() {
      clearTimer();
      press.current.id = null;
    },
    onContextMenu(e: React.MouseEvent<HTMLElement>) {
      e.preventDefault();
      clearTimer();
      press.current.id = null;
      if (holdEnabled) hold();
    },
    style: { WebkitTouchCallout: "none" } as React.CSSProperties,
  };
}
