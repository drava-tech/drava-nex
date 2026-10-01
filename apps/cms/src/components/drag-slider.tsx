"use client";

import React from "react";

/**
 * A draggable slider with a real thumb and a generous touch target.
 *
 * Lives here rather than in the Environment page's own controls.tsx because it
 * is now shared with the screen-control surfaces (the video scrub bar); that
 * file re-exports it so the Environment page's imports are unchanged.
 *
 * An earlier drag implementation made the handle visibly jump, because mid-drag
 * positions raced ahead of the throttled onChange and then snapped back to the
 * last confirmed value on release. This fixes the race properly rather than
 * avoiding it: while a drag is in progress the thumb renders from local state
 * and the incoming `value` prop is ignored, so a late parent update can never
 * yank it backwards. onChange is throttled during the drag and always fired
 * once more on release with the final position, so the committed value matches
 * where the finger stopped.
 */
export function DragSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  disabled = false,
  step = 1,
  commitMs = 250,
  onPreview,
  onPreviewEnd,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  /**
   * Quantisation of the emitted value. The default of 1 suits a 0-100
   * percentage; a video timeline passes a fraction so a two-hour file doesn't
   * lose half a second of precision per pixel.
   */
  step?: number;
  /**
   * How often a drag is allowed to commit. 250ms was tuned for the lighting
   * mesh, where each commit is an MQTT publish; a consumer whose commits are
   * cheaper (or more visible, like a seek on a TV) should say so explicitly.
   */
  commitMs?: number;
  /**
   * Every position the thumb passes through, unthrottled — for a consumer that
   * wants to show something WHILE dragging (a video scrub preview) rather than
   * only act on the committed value.
   *
   * Separate from onChange on purpose: onChange is throttled because each call
   * is a real command over the wire, whereas this is local and wants every
   * frame. A consumer doing anything expensive here must throttle it itself.
   */
  onPreview?: (value: number) => void;
  /** The drag ended — tear down whatever onPreview was driving. */
  onPreviewEnd?: () => void;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [local, setLocal] = React.useState(value);
  const lastSent = React.useRef(0);

  // While dragging, local wins — see the note above about the jump.
  const shown = dragging ? local : value;
  const span = max - min;
  const pct = span > 0 ? ((shown - min) / span) * 100 : 0;

  const valueAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return shown;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return shown;
    const x = Math.max(0, Math.min(clientX - r.left, r.width));
    const raw = min + (x / r.width) * span;
    return Math.round(raw / step) * step;
  };

  // The thumb follows the finger from local state on every move, so this only
  // paces what actually reaches the device. The forced commit on release
  // guarantees the final value lands regardless of where the throttle fell.
  const commit = (v: number, force = false) => {
    const now = Date.now();
    if (force || now - lastSent.current > commitMs) {
      lastSent.current = now;
      onChange(v);
    }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuenow={shown}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-disabled={disabled}
      // Tall, transparent hit area around a thin visible track — easy to grab
      // on a touchscreen without making the control look heavy.
      className={`relative flex h-8 w-full touch-none items-center ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = valueAt(e.clientX);
        setDragging(true);
        setLocal(v);
        onPreview?.(v);
        commit(v, true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const v = valueAt(e.clientX);
        setLocal(v);
        onPreview?.(v);
        commit(v);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        const v = valueAt(e.clientX);
        setDragging(false);
        setLocal(v);
        commit(v, true); // always land on exactly where the finger stopped
        onPreviewEnd?.();
      }}
      onPointerCancel={() => {
        setDragging(false);
        onPreviewEnd?.();
      }}
    >
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 shadow-inner dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%`, transition: dragging ? "none" : "width 150ms ease-out" }}
        />
      </div>
      <div
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-primary shadow-md dark:border-zinc-900"
        style={{ left: `${pct}%`, transition: dragging ? "none" : "left 150ms ease-out" }}
      />
    </div>
  );
}
