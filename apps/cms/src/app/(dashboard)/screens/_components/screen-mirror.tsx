"use client";

import { useInView } from "@platform/ui";
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
  isOnline,
  loadStream = true,
}: {
  screenId: string;
  title?: string;
  interactive?: boolean;
  /** When provided, shows a centered "Live Mirror"/"No Signal" indicator,
   * matching how the Experiences card centers its category label. Omitted by
   * callers (e.g. the full-page live control view) that don't want this
   * overlay. */
  isOnline?: boolean;
  /** False skips mounting the iframe entirely — just the isOnline indicator
   * over the card's own background. Used by the Screens grid, which shouldn't
   * spin up a live stream per card just from being visible; the real stream
   * only starts once the user clicks into the full Control view. */
  loadStream?: boolean;
}) {
  const [ref, inView] = useInView<HTMLDivElement>("150px");
  const shouldMount = loadStream && inView;

  return (
    <div ref={ref} className={`absolute inset-0 w-full h-full ${loadStream && isOnline !== false ? "bg-zinc-950" : "bg-white"}`}>
      {isOnline !== undefined && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-1.5">
          <span className="flex items-center gap-1.5 text-sm font-light text-zinc-800">
            {isOnline && (
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_6px_#22c55e] animate-pulse" />
            )}
            {isOnline ? "Live Mirror" : "No Signal"}
          </span>
        </div>
      )}
      {!loadStream ? null : shouldMount ? (
        <iframe
          src={screenMirrorUrl(screenId)}
          title={title ?? `Screen ${screenId}`}
          scrolling="no"
          className="absolute inset-0 w-full h-full border-0"
          style={{ pointerEvents: interactive ? "auto" : "none", overflow: "hidden" }}
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
