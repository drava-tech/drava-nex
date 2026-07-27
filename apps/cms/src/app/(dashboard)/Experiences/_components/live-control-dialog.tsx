"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize, Minimize, X } from "lucide-react";
import { ScreenMirror } from "../../screens/_components/screen-mirror";

export interface LiveScreen {
  screenId: string;
  screenName: string;
  isOnline: boolean;
}

interface LiveControlDialogProps {
  experienceName: string;
  screens: LiveScreen[];
  onClose: () => void;
  /** Extra controls rendered below the mirror (e.g. the whiteboard's tool palette) — replaces the default caption when given. */
  toolbar?: React.ReactNode;
}

/**
 * Inline control for a live experience — reuses the same interactive
 * ScreenMirror as the full /screens/<id> control page, without navigating
 * away from the experiences dashboard. If the experience is live on more
 * than one screen, tabs switch which mirror is shown.
 */
export function LiveControlDialog({ experienceName, screens, onClose, toolbar }: LiveControlDialogProps) {
  const [activeScreenId, setActiveScreenId] = useState(screens[0]?.screenId);
  const activeScreen = screens.find((s) => s.screenId === activeScreenId) ?? screens[0];

  const mirrorFrameRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === mirrorFrameRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      mirrorFrameRef.current?.requestFullscreen();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 select-none"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" />

      <div
        className="relative w-full md:w-auto max-w-[95vw] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-t-3xl md:rounded-3xl p-6 shadow-2xl flex flex-col max-h-[95vh] overflow-y-auto transition-all transform scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4 gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  activeScreen?.isOnline ? "bg-green-500 shadow-[0_0_6px_#22c55e] animate-pulse" : "bg-zinc-400"
                }`}
              />
              {activeScreen?.isOnline ? "Live" : "Offline"} · {experienceName}
            </p>
            {screens.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {screens.map((s) => (
                  <button
                    key={s.screenId}
                    type="button"
                    onClick={() => setActiveScreenId(s.screenId)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      s.screenId === activeScreen?.screenId
                        ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                        : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${s.isOnline ? "bg-green-500" : "bg-zinc-400"}`} />
                    {s.screenName}
                  </button>
                ))}
              </div>
            ) : (
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase truncate">
                {activeScreen?.screenName}
              </h2>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit full screen" : "Full screen"}
              className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {!activeScreen?.isOnline && (
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            This screen is offline — showing its last known state. Touch won't reach the TV until it reconnects.
          </p>
        )}

        {/* Interactive mirror — touch relays to the TV in realtime. The TV is
            16:9, so fullscreen letterboxes to that ratio (via the classic
            `min(100vw, 100vh*ratio)` trick) instead of stretching to whatever
            the browser window's own aspect ratio happens to be. When there's a
            toolbar (the whiteboard case), it sits BESIDE the mirror instead of
            below it — narrows the mirror a bit, but the toolbar gets a proper
            vertical rail instead of fighting the mirror for vertical space. */}
        <div className={isFullscreen ? "shrink-0 flex items-center justify-center" : "shrink-0 flex items-center gap-4"}>
          {/* The modal is now shrink-to-fit (w-auto) on desktop, so the mirror
              can't be sized via flex-grow/percentage-of-parent — there's no
              determinate space to grow into, which collapsed it to nothing.
              It gets a real fixed width instead; aspect-[16/9] derives the
              height from that, and max-w-full caps it on narrow viewports. */}
          <div className={isFullscreen ? "" : "flex items-center justify-center"}>
            <div
              ref={mirrorFrameRef}
              className={
                isFullscreen
                  ? "fixed inset-0 flex items-center justify-center bg-black"
                  : "relative w-[48rem] max-w-full aspect-[16/9] rounded-2xl border-[6px] border-zinc-800 dark:border-zinc-900 shadow-2xl bg-zinc-950 overflow-hidden"
              }
            >
            {isFullscreen ? (
              <div
                className="relative bg-zinc-950"
                style={{ width: "min(100vw, 177.78vh)", height: "min(100vh, 56.25vw)" }}
              >
                {activeScreen && (
                  <ScreenMirror screenId={activeScreen.screenId} title={activeScreen.screenName} interactive />
                )}
                <button
                  onClick={toggleFullscreen}
                  title="Exit full screen"
                  className="absolute top-4 right-4 z-20 p-2 rounded-xl bg-black/50 hover:bg-black/70 text-white backdrop-blur-sm transition-colors"
                >
                  <Minimize className="h-4 w-4" />
                </button>
                {/* No CMS toolbar overlay here on purpose — fullscreen shows only
                    the mirrored screen itself (which already has its own
                    on-screen controls, e.g. the whiteboard's draw/undo/exit bar).
                    Overlaying page/save controls on top of that covered the
                    actual drawing surface. Exit fullscreen to reach them. */}
              </div>
            ) : (
              activeScreen && (
                <ScreenMirror screenId={activeScreen.screenId} title={activeScreen.screenName} interactive />
              )
            )}
            </div>
          </div>

          {/* Side rail — only when a toolbar was actually given (the whiteboard case). */}
          {!isFullscreen && toolbar && (
            <div className="shrink-0 w-44 max-h-full overflow-y-auto">{toolbar}</div>
          )}
        </div>
        {!isFullscreen && !toolbar && (
          <p className="mt-3 text-center text-[10px] text-zinc-400 dark:text-zinc-600 font-medium">
            Touch to explore — mirrored on the TV in realtime
          </p>
        )}
      </div>
    </div>
  );
}
