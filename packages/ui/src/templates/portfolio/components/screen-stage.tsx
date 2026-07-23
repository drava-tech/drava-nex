"use client";

import React, { useEffect, useRef, useState } from "react";

interface ScreenStageProps {
  /** Real design width in px (the screen resolution). */
  width?: number;
  /** Real design height in px. */
  height?: number;
  /**
   * "fit-width" (default): scales to the container width, keeps 16:9, shows a
   * badge + border — for the in-CMS preview.
   * "fit-screen": fills the parent and scales to fit BOTH dimensions, centered on
   * black, no chrome — for the full-screen preview tab and the live screen.
   */
  variant?: "fit-width" | "fit-screen";
  children: React.ReactNode;
  className?: string;
}

/**
 * A fixed design surface (default 1920×1080) whose children are authored in REAL
 * pixel coordinates (1:1 with the physical screen) and CSS-transform-scaled to fit.
 */
export function ScreenStage({
  width = 1920,
  height = 1080,
  variant = "fit-width",
  children,
  className,
}: ScreenStageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setScale(variant === "fit-screen" ? Math.min(w / width, h / height) : w / width);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height, variant]);

  if (variant === "fit-screen") {
    return (
      <div
        ref={ref}
        className={`relative w-full h-full overflow-hidden bg-black ${className ?? ""}`}
        // Kiosk/touchscreen displays: a swipe here must never pan/bounce/zoom
        // the page — only the app's own tap/drag handlers should react to it.
        style={{ touchAction: "none", overscrollBehavior: "none" }}
      >
        <div
          className="absolute top-1/2 left-1/2"
          style={{
            width,
            height,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: "center",
            visibility: scale ? "visible" : "hidden",
          }}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`relative w-full max-w-[1920px] mx-auto overflow-hidden rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-950 shadow-lg ${className ?? ""}`}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <div
        className="absolute top-0 left-0"
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          visibility: scale ? "visible" : "hidden",
        }}
      >
        {children}
      </div>

      <span className="absolute bottom-2 right-2 z-10 px-2 py-0.5 rounded-md bg-black/60 text-[10px] font-mono text-white/80 tracking-wider pointer-events-none">
        {width} × {height}
      </span>
    </div>
  );
}
