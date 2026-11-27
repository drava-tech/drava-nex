"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@platform/ui";
import { screenMirrorUrl } from "@/lib/screen-url";

/** The TV's resolution. The mirror lays the page out at this size and scales it to fit, so it looks
 * the same whatever width the card or the console (sidebar open or closed) gives it. */
const TV_WIDTH = 1920;
const TV_HEIGHT = 1080;

/**
 * Embeds the screens player for a screen as a live, realtime mirror of the TV —
 * the same rendering (template/media/idle), content sync, and command handling.
 * Lazy-mounts the iframe when scrolled into view to keep many cards light.
 */
export function ScreenMirror({
  screenId,
  title,
  interactive = false,
  fillWidth = false,
}: {
  screenId: string;
  title?: string;
  interactive?: boolean;
  /**
   * Lay the page out as wide as the box allows (at the TV's height) instead of a fixed 1920 wide, so
   * a page that sizes itself from the viewport, like Drava Mosaic, fills a wider-than-16:9 panel
   * with no side bars. Not an exact mirror of the TV's framing, so only for pages built for it.
   */
  fillWidth?: boolean;
}) {
  const [ref, shouldMount] = useInView<HTMLDivElement>("150px");
  const boxRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 0, left: 0, top: 0, width: TV_WIDTH });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // Fit the whole TV frame inside the box (contain), centred. Scaling by width alone cut the
    // bottom off whenever the box was wider than 16:9, as the big control view is.
    const measure = () => {
      const scale = Math.min(el.clientWidth / TV_WIDTH, el.clientHeight / TV_HEIGHT);
      // Wider than 16:9: let the page itself be wider rather than leave bars either side.
      const width = fillWidth && scale > 0 ? Math.max(TV_WIDTH, el.clientWidth / scale) : TV_WIDTH;
      setFit({
        scale,
        left: (el.clientWidth - width * scale) / 2,
        top: (el.clientHeight - TV_HEIGHT * scale) / 2,
        width,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shouldMount, fillWidth]);

  return (
    <div ref={ref} className="absolute inset-0 w-full h-full bg-zinc-950">
      {shouldMount ? (
        <div ref={boxRef} className="absolute inset-0 overflow-hidden">
          <iframe
            src={screenMirrorUrl(screenId)}
            title={title ?? `Screen ${screenId}`}
            scrolling="no"
            className="absolute border-0"
            style={{
              width: fit.width,
              height: TV_HEIGHT,
              left: fit.left,
              top: fit.top,
              transform: `scale(${fit.scale})`,
              transformOrigin: "top left",
              visibility: fit.scale > 0 ? "visible" : "hidden",
              pointerEvents: interactive ? "auto" : "none",
              overflow: "hidden",
            }}
          />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[8px] font-bold text-white/30 tracking-[0.3em] uppercase">
            Loading preview…
          </span>
        </div>
      )}
    </div>
  );
}
