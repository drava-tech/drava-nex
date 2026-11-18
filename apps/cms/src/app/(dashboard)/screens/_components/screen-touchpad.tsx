"use client";

import { useCallback, useEffect, useRef } from "react";
import { Hand, MousePointer2 } from "lucide-react";
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
/** Wheel units per finger pixel (120 = one notch of a real mouse wheel). */
const SCROLL_GAIN = 4;
/** Momentum: release speed (px/ms) needed, per-16ms-frame decay, stop speed. */
const MOMENTUM_MIN_SPEED = 0.15;
const MOMENTUM_STOP_SPEED = 0.02;
const MOMENTUM_DECAY = 0.95;
/** A finger that stopped this long (ms) before lifting does not fling. */
const MOMENTUM_MAX_IDLE_MS = 80;
/** Velocity is sampled over at least this long (ms). The tablet reports each
 * finger in its own event, often <1ms apart, and dividing by that gap made
 * the release speed (and so the fling) explode. */
const VELOCITY_SAMPLE_MS = 12;
/** Pinch: change in finger spread per zoom step, as a ratio. PINCH_DAMP_PX is
 * added to both sides so fingers held close together (where a few pixels of
 * jitter is a big ratio) cannot flick the zoom in and out. */
const PINCH_STEP = 1.2;
const PINCH_DAMP_PX = 40;

interface ScreenTouchpadProps {
  /** The screen whose physical PC this pad drives — see useScreenCursorControl. */
  screenId: string;
  /**
   * Which document viewer is live on the screen, from documentKindOf() in
   * @platform/types, or null/undefined for anything else. A document viewer
   * puts the pad in TOUCHSCREEN mode (drag scrolls, pinch zooms); anything
   * else keeps it a trackpad. The viewers are also the only surfaces that
   * answer ZOOM_IN/ZOOM_OUT, so pinch exists only in touchscreen mode.
   */
  documentKind?: DocumentKind | null;
}

type Pt = { x: number; y: number };

/**
 * A touch surface that drives the screen's PC (via its native screen-agent).
 * It has two modes, chosen by what is on the screen:
 *
 * TOUCHSCREEN — a PDF / slides / Word viewer is live (documentKind set). Works
 * like the touchscreen in your hand; there is no cursor to aim:
 *  - one-finger drag: scroll, content follows the finger, with momentum
 *  - two fingers: pinch to zoom in / out (app-level ZOOM_IN/OUT), nothing else
 *
 * TRACKPAD — anything else (a website, YouTube). A tap needs something to aim
 * at and the pad shows no picture of the page, so it is a laptop trackpad:
 *  - one-finger drag: move the cursor, with speed-based acceleration
 *  - one-finger tap: left click; two-finger tap: right click
 *  - double-tap then drag: click-and-drag (holds the left button)
 *  - two-finger drag: scroll with momentum
 *
 * Splitting by content is what keeps two fingers unambiguous: in touchscreen
 * mode they only ever zoom, in trackpad mode they only ever scroll. Guessing
 * between pinch and scroll from the same gesture read drags as pinches.
 */
export function ScreenTouchpad({ screenId, documentKind }: ScreenTouchpadProps) {
  const { agentOnline, moveCursor, click, pressButton, releaseButton, scroll, scrollHorizontal } =
    useScreenCursorControl(screenId);
  const touchMode = !!documentKind;

  /** Fire-and-forget: a failed zoom is a no-op the operator can simply repeat. */
  const zoom = useCallback(
    (direction: "in" | "out") => {
      void sendRemoteCommand(screenId, direction === "in" ? ZOOM_IN : ZOOM_OUT).catch((err) =>
        console.error("Failed to send zoom command:", err)
      );
    },
    [screenId]
  );

  // ── Scrolling: remainder-carrying + momentum, shared by both modes.
  // Sub-step deltas carry to the next event instead of rounding to 0.
  const scrollAccum = useRef({ x: 0, y: 0 });
  const momentum = useRef<{ vx: number; vy: number; raf: number | null }>({ vx: 0, vy: 0, raf: null });

  const stopMomentum = useCallback(() => {
    const m = momentum.current;
    if (m.raf !== null) cancelAnimationFrame(m.raf);
    m.raf = null;
    m.vx = 0;
    m.vy = 0;
  }, []);

  /**
   * dx/dy in finger pixels. Natural scrolling on both axes: the content
   * follows the finger, like a touchscreen. The agent's positive deltaY is a
   * wheel-down and positive deltaX a wheel-right, so both are negated.
   */
  const applyScroll = useCallback(
    (dx: number, dy: number) => {
      const acc = scrollAccum.current;
      acc.y += -dy * SCROLL_GAIN;
      acc.x += -dx * SCROLL_GAIN;
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

  // ── Pad state: a small multi-touch state machine over pointer events.
  const pointers = useRef(new Map<number, Pt>());
  const pad = useRef({
    mode: "idle" as "idle" | "move" | "drag" | "two" | "scroll" | "pinch",
    // one finger
    startX: 0,
    startY: 0,
    startT: 0,
    moved: false,
    lastT: 0,
    remX: 0,
    remY: 0,
    dragHeld: false,
    // double-tap detection (trackpad)
    lastTapT: 0,
    lastTapX: 0,
    lastTapY: 0,
    // two fingers (trackpad)
    twoStartT: 0,
    /** Largest net midpoint movement so far, for tap vs scroll. */
    twoTravel: 0,
    twoStartCx: 0,
    twoStartCy: 0,
    twoCx: 0,
    twoCy: 0,
    twoScrolling: false,
    // release velocity, finger px/ms (both scroll gestures)
    vx: 0,
    vy: 0,
    velDx: 0,
    velDy: 0,
    velT: 0,
    lastActiveT: 0,
    // pinch (touchscreen)
    pinchRef: 0,
  });
  const pinchRaf = useRef<number | null>(null);

  const readPair = useCallback(() => {
    const [a, b] = Array.from(pointers.current.values());
    if (!a || !b) return { cx: 0, cy: 0, dist: 0 };
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }, []);

  const resetVelocity = useCallback((now: number) => {
    const st = pad.current;
    st.vx = 0;
    st.vy = 0;
    st.velDx = 0;
    st.velDy = 0;
    st.velT = now;
    st.lastActiveT = now;
  }, []);

  /** Smoothed release velocity, sampled over VELOCITY_SAMPLE_MS windows. */
  const trackVelocity = useCallback((dx: number, dy: number, now: number) => {
    const st = pad.current;
    st.velDx += dx;
    st.velDy += dy;
    if (dx !== 0 || dy !== 0) st.lastActiveT = now;
    const dt = now - st.velT;
    if (dt < VELOCITY_SAMPLE_MS) return;
    st.vx = st.vx * 0.5 + (st.velDx / dt) * 0.5;
    st.vy = st.vy * 0.5 + (st.velDy / dt) * 0.5;
    st.velDx = 0;
    st.velDy = 0;
    st.velT = now;
  }, []);

  /**
   * One zoom step per decisive change in finger spread. Run once per animation
   * frame, after every finger's move for that frame has landed: the tablet
   * reports each finger in its own event, and judging the spread in between
   * them is what flickered the zoom in/out.
   */
  const evaluatePinch = useCallback(() => {
    pinchRaf.current = null;
    const st = pad.current;
    if (st.mode !== "pinch" || pointers.current.size < 2) return;
    const { dist } = readPair();
    const ratio = (dist + PINCH_DAMP_PX) / (st.pinchRef + PINCH_DAMP_PX);
    if (ratio > PINCH_STEP) {
      zoom("in");
      st.pinchRef = dist;
    } else if (ratio < 1 / PINCH_STEP) {
      zoom("out");
      st.pinchRef = dist;
    }
  }, [readPair, zoom]);

  const endDrag = useCallback(() => {
    const st = pad.current;
    if (st.dragHeld) {
      st.dragHeld = false;
      releaseButton();
    }
  }, [releaseButton]);

  // Never leave the OS button held, a fling running or a pinch frame queued
  // if the pad goes away.
  useEffect(
    () => () => {
      endDrag();
      stopMomentum();
      if (pinchRaf.current !== null) cancelAnimationFrame(pinchRaf.current);
    },
    [endDrag, stopMomentum]
  );

  const handlePadDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      stopMomentum();
      const st = pad.current;
      const map = pointers.current;
      // The first finger of a new touch: anything still in the map is a
      // finger whose pointerup never arrived, and it would pair with this one.
      if (e.isPrimary) map.clear();
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
        resetVelocity(now);
        if (touchMode) {
          st.mode = "scroll";
          return;
        }
        const isSecondTap =
          now - st.lastTapT < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - st.lastTapX, e.clientY - st.lastTapY) < DOUBLE_TAP_DIST;
        st.mode = isSecondTap ? "drag" : "move";
      } else if (map.size === 2) {
        // A second finger turns whatever was happening into a two-finger gesture.
        endDrag();
        const { cx, cy, dist } = readPair();
        st.twoStartT = now;
        st.lastTapT = 0; // a two-finger touch never arms a double tap
        if (touchMode) {
          st.mode = "pinch";
          st.pinchRef = dist;
          return;
        }
        st.mode = "two";
        st.twoTravel = 0;
        st.twoStartCx = cx;
        st.twoStartCy = cy;
        st.twoCx = cx;
        st.twoCy = cy;
        st.twoScrolling = false;
        resetVelocity(now);
      }
    },
    [endDrag, readPair, resetVelocity, stopMomentum, touchMode]
  );

  const handlePadMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const map = pointers.current;
      const prev = map.get(e.pointerId);
      if (!prev) return;
      const st = pad.current;
      const now = performance.now();
      map.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Touchscreen: two fingers only ever zoom, judged once per frame.
      if (st.mode === "pinch") {
        if (pinchRaf.current === null) pinchRaf.current = requestAnimationFrame(evaluatePinch);
        return;
      }

      // Touchscreen: one finger scrolls, content following the finger.
      if (st.mode === "scroll") {
        if (map.size !== 1) return;
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        applyScroll(dx, dy);
        trackVelocity(dx, dy, now);
        return;
      }

      // Trackpad: two fingers only ever scroll; a tap is a right click.
      if (st.mode === "two") {
        if (map.size < 2) return;
        const { cx, cy } = readPair();
        const dcx = cx - st.twoCx;
        const dcy = cy - st.twoCy;
        st.twoCx = cx;
        st.twoCy = cy;
        st.twoTravel = Math.max(st.twoTravel, Math.hypot(cx - st.twoStartCx, cy - st.twoStartCy));
        if (!st.twoScrolling && st.twoTravel > TAP_MOVE_PX) st.twoScrolling = true;
        if (st.twoScrolling) {
          applyScroll(dcx, dcy);
          trackVelocity(dcx, dcy, now);
        }
        return;
      }

      // Trackpad: one finger moves the cursor.
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
    [applyScroll, evaluatePinch, moveCursor, pressButton, readPair, trackVelocity]
  );

  const handlePadUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const map = pointers.current;
      if (!map.has(e.pointerId)) return;
      const st = pad.current;
      const now = performance.now();
      const cancelled = e.type === "pointercancel";
      map.delete(e.pointerId);
      const flingOk = !cancelled && now - st.lastActiveT < MOMENTUM_MAX_IDLE_MS;

      if (st.mode === "pinch") {
        // Lifting either finger ends the pinch; a finger left down does
        // nothing until the next fresh touch.
        st.mode = "idle";
        return;
      }

      if (st.mode === "scroll") {
        if (map.size === 0) {
          if (flingOk) startMomentum(st.vx, st.vy);
          st.mode = "idle";
        }
        return;
      }

      if (st.mode === "two") {
        if (map.size === 1) {
          // First finger lifted ends the two-finger gesture; the other finger is ignored.
          if (!cancelled && !st.twoScrolling && st.twoTravel <= TAP_MOVE_PX && now - st.twoStartT < TAP_MS) {
            click("right");
          } else if (st.twoScrolling && flingOk) {
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

  const HintIcon = touchMode ? Hand : MousePointer2;

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
          <HintIcon className="h-6 w-6" />
          <p className="text-center text-[10px] font-bold uppercase tracking-widest">
            {touchMode
              ? "Drag to scroll · pinch to zoom"
              : "Drag to move · tap to click · two fingers to scroll"}
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
