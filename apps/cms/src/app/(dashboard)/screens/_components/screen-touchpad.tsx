"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  MousePointer2,
} from "lucide-react";
import type { DocumentKind } from "@platform/types";
import { useScreenCursorControl } from "@/hooks/useScreenCursorControl";
import { sendRemoteCommand } from "@/actions/screen-actions";
import { ZOOM_IN, ZOOM_OUT } from "@/lib/display/zoom-protocol";

/** Beyond this travel (px) a press is a drag, not a tap. */
const TAP_MOVE_PX = 6;
/** A tap must be shorter than this (ms). */
const TAP_MS = 250;
/** A second tap within this time / distance arms double-tap-and-drag. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 30;
/** Cursor acceleration: gain = MIN + speed(px/ms) * ACCEL, capped at MAX.
 * Slow strokes stay ~1:1 so small movements stay precise. */
const CURSOR_MIN_GAIN = 1.0;
const CURSOR_ACCEL = 1.4;
const CURSOR_MAX_GAIN = 4;
/** Wheel steps per finger pixel (the agent's mouse.scrollUp/Down = 1 notch per step). */
const SCROLL_GAIN = 4;
/** Momentum: release speed (px/ms) needed, per-16ms-frame decay, stop speed. */
const MOMENTUM_MIN_SPEED = 0.15;
const MOMENTUM_STOP_SPEED = 0.02;
const MOMENTUM_DECAY = 0.95;
/** Pinch: spread change (px) before it counts as a pinch, and the distance
 * ratio per zoom step. */
const PINCH_DECIDE_PX = 14;
const PINCH_STEP = 1.25;

interface ScreenTouchpadProps {
  /** The screen whose physical PC this pad drives — see useScreenCursorControl. */
  screenId: string;
  /**
   * Which document viewer is live on the screen, from documentKindOf() in
   * @platform/types, or null/undefined for anything else. Decides whether the
   * zoom row and pinch are offered at all — the viewers are the only surfaces
   * that answer ZOOM_IN/ZOOM_OUT, and a control that silently does nothing is
   * worse than none.
   */
  documentKind?: DocumentKind | null;
}

type Pt = { x: number; y: number };

/**
 * A touch surface that drives the REAL OS-level mouse cursor on the Windows PC
 * physically showing this screen's TV (via its native screen-agent), modeled on
 * a laptop trackpad:
 *
 *  - one-finger drag: move the cursor, with speed-based acceleration
 *  - one-finger tap: left click; two-finger tap: right click
 *  - double-tap then drag: click-and-drag (holds the left button)
 *  - two-finger drag: vertical + horizontal scroll with momentum
 *  - pinch: zoom in / out (document viewers only, app-level ZOOM_IN/OUT)
 *
 * There are no scroll strips: scrolling is the two-finger gesture only.
 * Pinch is the only zoom control (no +/- buttons). It is the one APP-level
 * command: the screen-agent has no keyboard binding, so it only acts when a
 * viewer that answers ZOOM_IN / ZOOM_OUT is live; see the documentKind prop.
 */
export function ScreenTouchpad({ screenId, documentKind }: ScreenTouchpadProps) {
  const { agentOnline, moveCursor, click, pressButton, releaseButton, scroll, scrollHorizontal } =
    useScreenCursorControl(screenId);

  /** Fire-and-forget: a failed zoom is a no-op the operator can simply repeat. */
  const zoom = useCallback(
    (direction: "in" | "out") => {
      void sendRemoteCommand(screenId, direction === "in" ? ZOOM_IN : ZOOM_OUT).catch((err) =>
        console.error("Failed to send zoom command:", err)
      );
    },
    [screenId]
  );

  // ── Scrolling: remainder-carrying + momentum, shared by the two-finger pad
  // gesture and the strips. Sub-step deltas used to be rounded to 0 and lost;
  // now the fraction carries to the next event.
  const scrollAccum = useRef({ x: 0, y: 0 });
  const momentum = useRef<{ vx: number; vy: number; raf: number | null }>({ vx: 0, vy: 0, raf: null });

  const stopMomentum = useCallback(() => {
    const m = momentum.current;
    if (m.raf !== null) cancelAnimationFrame(m.raf);
    m.raf = null;
    m.vx = 0;
    m.vy = 0;
  }, []);

  /** dx/dy in finger pixels (natural scrolling: content follows the finger). */
  const applyScroll = useCallback(
    (dx: number, dy: number) => {
      const acc = scrollAccum.current;
      acc.y += -dy * SCROLL_GAIN;
      acc.x += dx * SCROLL_GAIN;
      const ys = Math.trunc(acc.y);
      const xs = Math.trunc(acc.x);
      if (ys !== 0) {
        acc.y -= ys;
        scroll(ys);
      }
      if (xs !== 0) {
        acc.x -= xs;
        scrollHorizontal(xs);
      }
    },
    [scroll, scrollHorizontal]
  );

  /** Fling: vx/vy in px per ms at release, decaying each frame. */
  const startMomentum = useCallback(
    (vx: number, vy: number) => {
      stopMomentum();
      if (Math.hypot(vx, vy) < MOMENTUM_MIN_SPEED) return;
      const m = momentum.current;
      m.vx = vx;
      m.vy = vy;
      let last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(now - last, 50);
        last = now;
        applyScroll(m.vx * dt, m.vy * dt);
        const decay = Math.pow(MOMENTUM_DECAY, dt / 16);
        m.vx *= decay;
        m.vy *= decay;
        if (Math.hypot(m.vx, m.vy) < MOMENTUM_STOP_SPEED) {
          m.raf = null;
          return;
        }
        m.raf = requestAnimationFrame(tick);
      };
      m.raf = requestAnimationFrame(tick);
    },
    [applyScroll, stopMomentum]
  );

  // ── Main pad: a small multi-touch state machine over pointer events.
  const pointers = useRef(new Map<number, Pt>());
  const pad = useRef({
    mode: "idle" as "idle" | "move" | "two" | "drag",
    // one finger
    startX: 0,
    startY: 0,
    startT: 0,
    moved: false,
    lastT: 0,
    remX: 0,
    remY: 0,
    dragHeld: false,
    // double-tap detection
    lastTapT: 0,
    lastTapX: 0,
    lastTapY: 0,
    // two fingers
    twoStartT: 0,
    twoTravel: 0,
    twoCx: 0,
    twoCy: 0,
    twoDist: 0,
    twoKind: "undecided" as "undecided" | "scroll" | "pinch",
    pinchRef: 0,
    vx: 0,
    vy: 0,
    lastTwoT: 0,
  });

  const readPair = () => {
    const [a, b] = Array.from(pointers.current.values());
    if (!a || !b) return { cx: 0, cy: 0, dist: 0 };
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  const endDrag = useCallback(() => {
    const st = pad.current;
    if (st.dragHeld) {
      st.dragHeld = false;
      releaseButton();
    }
  }, [releaseButton]);

  // Never leave the OS button held or a fling running if the pad goes away.
  useEffect(
    () => () => {
      endDrag();
      stopMomentum();
    },
    [endDrag, stopMomentum]
  );

  const handlePadDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      stopMomentum();
      const st = pad.current;
      const map = pointers.current;
      map.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = performance.now();

      if (map.size === 1) {
        st.startX = e.clientX;
        st.startY = e.clientY;
        st.startT = now;
        st.lastT = now;
        st.moved = false;
        st.remX = 0;
        st.remY = 0;
        const isSecondTap =
          now - st.lastTapT < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - st.lastTapX, e.clientY - st.lastTapY) < DOUBLE_TAP_DIST;
        st.mode = isSecondTap ? "drag" : "move";
      } else if (map.size === 2) {
        // A second finger turns whatever was happening into a two-finger gesture.
        endDrag();
        const { cx, cy, dist } = readPair();
        st.mode = "two";
        st.twoStartT = now;
        st.twoTravel = 0;
        st.twoCx = cx;
        st.twoCy = cy;
        st.twoDist = dist;
        st.pinchRef = dist;
        st.twoKind = "undecided";
        st.vx = 0;
        st.vy = 0;
        st.lastTwoT = now;
        st.lastTapT = 0; // a two-finger touch never arms a double tap
      }
    },
    [endDrag, stopMomentum]
  );

  const handlePadMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const map = pointers.current;
      const prev = map.get(e.pointerId);
      if (!prev) return;
      const st = pad.current;
      const now = performance.now();
      map.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (st.mode === "two" && map.size >= 2) {
        const { cx, cy, dist } = readPair();
        const dcx = cx - st.twoCx;
        const dcy = cy - st.twoCy;
        st.twoCx = cx;
        st.twoCy = cy;
        st.twoTravel += Math.abs(dcx) + Math.abs(dcy);

        if (st.twoKind === "undecided") {
          const spread = Math.abs(dist - st.twoDist);
          if (documentKind && spread > PINCH_DECIDE_PX && spread > st.twoTravel) st.twoKind = "pinch";
          else if (st.twoTravel > TAP_MOVE_PX) st.twoKind = "scroll";
        }

        if (st.twoKind === "pinch") {
          const ratio = dist / (st.pinchRef || dist);
          if (ratio > PINCH_STEP) {
            zoom("in");
            st.pinchRef = dist;
          } else if (ratio < 1 / PINCH_STEP) {
            zoom("out");
            st.pinchRef = dist;
          }
        } else if (st.twoKind === "scroll") {
          applyScroll(dcx, dcy);
          const dt = Math.max(now - st.lastTwoT, 1);
          // Smoothed velocity so one jittery frame doesn't fling the page.
          st.vx = st.vx * 0.6 + (dcx / dt) * 0.4;
          st.vy = st.vy * 0.6 + (dcy / dt) * 0.4;
        }
        st.lastTwoT = now;
        return;
      }

      // One finger.
      if (map.size !== 1 || (st.mode !== "move" && st.mode !== "drag")) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (!st.moved) {
        if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) <= TAP_MOVE_PX) return;
        st.moved = true;
        if (st.mode === "drag") {
          st.dragHeld = true;
          pressButton();
        }
      }
      const dt = Math.max(now - st.lastT, 1);
      st.lastT = now;
      // Speed-based acceleration: slow strokes stay ~1:1 for precision, fast
      // strokes sweep the whole screen.
      const speed = Math.hypot(dx, dy) / dt; // px/ms
      const gain = Math.min(CURSOR_MIN_GAIN + speed * CURSOR_ACCEL, CURSOR_MAX_GAIN);
      st.remX += dx * gain;
      st.remY += dy * gain;
      const mx = Math.trunc(st.remX);
      const my = Math.trunc(st.remY);
      if (mx !== 0 || my !== 0) {
        st.remX -= mx;
        st.remY -= my;
        moveCursor(mx, my);
      }
    },
    [applyScroll, documentKind, moveCursor, pressButton, zoom]
  );

  const handlePadUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const map = pointers.current;
      if (!map.has(e.pointerId)) return;
      const st = pad.current;
      const now = performance.now();
      const cancelled = e.type === "pointercancel";
      map.delete(e.pointerId);

      if (st.mode === "two") {
        if (map.size === 1) {
          // First finger lifted ends the two-finger gesture; the other finger is ignored.
          if (!cancelled && st.twoKind === "undecided" && st.twoTravel <= TAP_MOVE_PX && now - st.twoStartT < TAP_MS) {
            click("right");
          } else if (!cancelled && st.twoKind === "scroll") {
            startMomentum(st.vx, st.vy);
          }
          st.mode = "idle";
        } else if (map.size === 0) {
          st.mode = "idle";
        }
        return;
      }

      if (map.size > 0) return;
      if (st.mode === "drag") {
        if (st.dragHeld) endDrag();
        else if (!cancelled) {
          click("left"); // second tap = double click
          st.lastTapT = 0;
        }
      } else if (st.mode === "move" && !cancelled && !st.moved && now - st.startT < TAP_MS) {
        click("left");
        st.lastTapT = now;
        st.lastTapX = st.startX;
        st.lastTapY = st.startY;
      }
      st.mode = "idle";
    },
    [click, endDrag, startMomentum]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ touchAction: "none", overscrollBehavior: "contain" }}>
      <div
        onPointerDown={handlePadDown}
        onPointerMove={handlePadMove}
        onPointerUp={handlePadUp}
        onPointerCancel={handlePadUp}
        className="relative flex flex-1 select-none items-center justify-center bg-zinc-100 dark:bg-zinc-900"
        style={{ touchAction: "none", overscrollBehavior: "contain", cursor: "default" }}
      >
        <div className="pointer-events-none flex flex-col items-center gap-2 text-zinc-400 dark:text-zinc-600">
          <MousePointer2 className="h-6 w-6" />
          <p className="text-center text-[10px] font-bold uppercase tracking-widest">
            Drag to move · tap to click · two fingers to scroll
          </p>
        </div>
      </div>

      {agentOnline === false && (
        <p className="px-4 py-2 text-center text-xs text-amber-600 dark:text-amber-400">
          Screen agent not connected — this pad won't reach the TV.
        </p>
      )}
    </div>
  );
}
