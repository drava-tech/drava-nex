"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Maximize, Minimize, Save, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@platform/ui";
import { ScreenMirror } from "@/app/(dashboard)/screens/_components/screen-mirror";
import { ScreenTouchpad } from "@/app/(dashboard)/screens/_components/screen-touchpad";

export interface LiveScreen {
  screenId: string;
  screenName: string;
  isOnline: boolean;
}

interface LiveControlDialogProps {
  experienceName: string;
  screens: LiveScreen[];
  /** Every screen in the system, for the "switch screen" dropdown — falls back to `screens` when omitted. */
  allScreens?: LiveScreen[];
  onClose: () => void;
  /** Extra controls rendered below the mirror (e.g. the whiteboard's tool palette) — replaces the default caption when given. */
  toolbar?: React.ReactNode;
  /**
   * When set, shows a "Save link" action in the header — the content just
   * pushed is an ad-hoc link (Browser tool) not yet kept in the Media
   * Library. Resolves once the save actually lands.
   */
  onSaveLink?: () => Promise<void>;
  /**
   * When the pushed content is a page/embed (link, YouTube, Drive, PDF,
   * sheet, deck...), switches from tap-on-mirror control to a blank OS-cursor
   * touchpad with no preview — more accurate than tapping an exact spot on a
   * shrunk mirror, and works uniformly no matter what's actually on screen
   * since it drives the real cursor on the TV's own PC (see ScreenTouchpad).
   */
  showTouchpad?: boolean;
}

/**
 * Inline control for a live experience — reuses the same interactive
 * ScreenMirror as the full /screens/<id> control page, without navigating
 * away from the experiences dashboard. A dropdown lets you switch to
 * controlling any other screen in the system instantly, not just the ones
 * this content was pushed to.
 */
export function LiveControlDialog({ experienceName, screens, allScreens, onClose, toolbar, onSaveLink, showTouchpad }: LiveControlDialogProps) {
  const switchableScreens = allScreens && allScreens.length > 0 ? allScreens : screens;
  const [activeScreenId, setActiveScreenId] = useState(screens[0]?.screenId);
  const activeScreen =
    switchableScreens.find((s) => s.screenId === activeScreenId) ?? screens[0] ?? switchableScreens[0];

  const mirrorFrameRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSaveLink = async () => {
    if (!onSaveLink || saving || saved) return;
    setSaving(true);
    try {
      await onSaveLink();
      setSaved(true);
    } catch {
      // best-effort — leave the button as-is so the admin can retry
    } finally {
      setSaving(false);
    }
  };

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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="-mx-1.5 -my-1 flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <h2 className="truncate text-base font-bold tracking-wide text-zinc-900 uppercase dark:text-zinc-100">
                    {activeScreen?.screenName}
                  </h2>
                  <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
                {switchableScreens.map((s) => (
                  <DropdownMenuItem
                    key={s.screenId}
                    className="cursor-pointer gap-2"
                    onSelect={() => setActiveScreenId(s.screenId)}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.isOnline ? "bg-green-500" : "bg-zinc-400"}`}
                    />
                    <span className="truncate">{s.screenName}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onSaveLink && (
              <button
                onClick={handleSaveLink}
                disabled={saving || saved}
                title={saved ? "Saved to Media Library" : "Save link to Media Library"}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:pointer-events-none ${
                  saved
                    ? "bg-green-600 text-white"
                    : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-950 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-850 dark:hover:text-zinc-100"
                }`}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : saved ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? "Saving…" : saved ? "Saved" : "Save link"}
              </button>
            )}
            {/* Fullscreen only makes sense for the tap-on-mirror model — the
                touchpad has no preview to fullscreen, so it skips this
                toggle entirely. */}
            {!showTouchpad && (
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit full screen" : "Full screen"}
                className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
              >
                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </button>
            )}
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
        {showTouchpad ? (
          // No preview at all — a blank touchpad that drives the REAL OS
          // cursor on the TV's own PC (see ScreenTouchpad/screen-agent),
          // instead of tapping a mirrored preview of the page.
          activeScreen && (
            <div className="shrink-0 flex items-center justify-center">
              <div className="relative w-[48rem] max-w-full h-72 rounded-2xl border-[6px] border-zinc-800 dark:border-zinc-900 shadow-2xl overflow-hidden">
                <ScreenTouchpad screenId={activeScreen.screenId} />
              </div>
            </div>
          )
        ) : (
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
        )}

        {!isFullscreen && !toolbar && !showTouchpad && (
          <p className="mt-3 text-center text-[10px] text-zinc-400 dark:text-zinc-600 font-medium">
            Touch to explore — mirrored on the TV in realtime
          </p>
        )}
      </div>
    </div>
  );
}
