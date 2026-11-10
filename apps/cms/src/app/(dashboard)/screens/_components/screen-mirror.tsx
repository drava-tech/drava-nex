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
}: {
  screenId: string;
  title?: string;
  interactive?: boolean;
}) {
  const [ref, shouldMount] = useInView<HTMLDivElement>("150px");
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / TV_WIDTH);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shouldMount]);

  return (
    <div ref={ref} className="absolute inset-0 w-full h-full bg-zinc-950">
      {shouldMount ? (
        <div ref={boxRef} className="absolute inset-0 overflow-hidden">
          <iframe
            src={screenMirrorUrl(screenId)}
            title={title ?? `Screen ${screenId}`}
            scrolling="no"
            className="absolute left-0 top-0 border-0"
            style={{
              width: TV_WIDTH,
              height: TV_HEIGHT,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              visibility: scale > 0 ? "visible" : "hidden",
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
