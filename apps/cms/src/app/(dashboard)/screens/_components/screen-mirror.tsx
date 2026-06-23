"use client";

import { useEffect, useRef, useState } from "react";
import { screenMirrorUrl } from "@/lib/screen-url";

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
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          // Resolve client-side (reads window.location) and mount the iframe.
          setSrc(screenMirrorUrl(screenId));
          io.disconnect();
        }
      },
      { rootMargin: "150px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [screenId]);

  return (
    <div ref={ref} className="absolute inset-0 w-full h-full bg-zinc-950">
      {src ? (
        <iframe
          src={src}
          title={title ?? `Screen ${screenId}`}
          className="absolute inset-0 w-full h-full border-0"
          style={{ pointerEvents: interactive ? "auto" : "none" }}
        />
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
