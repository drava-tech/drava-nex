"use client";

import { useState } from "react";
import { Wifi, WifiOff, Layers, RotateCcw, Ban, Play, ChevronLeft, ChevronRight, Minimize2, Maximize2, Power } from "lucide-react";
import { useScreenControls } from "@/hooks/useScreenControls";
import { assignExperience, assignMedia, assignDefaultMedia, sendRemoteCommand } from "@/actions/screen-actions";
import { SCREEN_TO_CAMERA } from "@/lib/display/camera-config";
import { CameraStatusBadge } from "@/components/camera-status-badge";
import { ScreenMirror } from "@/app/(dashboard)/screens/_components/screen-mirror";
import { ScreenTouchpad } from "@/app/(dashboard)/screens/_components/screen-touchpad";
import { ScreenAssignmentPicker } from "@/app/(dashboard)/screens/_components/screens-assignment-picker";
import type { WsContent } from "@platform/types";

interface LiveScreenSurfaceProps {
  screenId: string;
  screenName: string;
  initialBlanked?: boolean;
  /** When the screen's current content is a page/embed (link, YouTube, Drive,
   * PDF, sheet, deck...), shows the blank OS-cursor touchpad instead of
   * tap-on-mirror — see LiveControlDialog and ScreenTouchpad. */
  initialShowTouchpad?: boolean;
  /** Present only for a queue push (Media multi-select) — renders the
   * "Item N of M" nav pill and enables Next/Prev. */
  queueMediaIds?: string[];
  initialQueueIndex?: number;
  /** Present only when this screen should offer a "Change content" picker —
   * /screens/:screenId has one, /media/live/:deviceId intentionally doesn't
   * (reassigning away would orphan the queue that page exists to show). */
  changeContent?: {
    experiences: { id: string; title: string }[];
    defaultMediaAssetId?: string | null;
    defaultMediaName?: string | null;
  };
}

/**
 * Full-page interactive control for one screen — shared by /screens/:screenId
 * and /media/live/:deviceId, which were previously two byte-identical copies
 * of this exact JSX (ScreenControlView and MediaLiveView). The big surface is
 * the live screen player (touch to explore, or the OS-cursor touchpad for
 * page content); interactions relay to every client of the screen so the TV
 * stays in sync.
 */
export function LiveScreenSurface({
  screenId,
  screenName,
  initialBlanked = false,
  initialShowTouchpad = false,
  queueMediaIds,
  initialQueueIndex = 0,
  changeContent,
}: LiveScreenSurfaceProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [minimizing, setMinimizing] = useState(false);
  const [maximizing, setMaximizing] = useState(false);
  const [closingApp, setClosingApp] = useState(false);
  const [currentDefault, setCurrentDefault] = useState<{ id: string | null; name: string | null }>({
    id: changeContent?.defaultMediaAssetId ?? null,
    name: changeContent?.defaultMediaName ?? null,
  });

  const {
    online,
    cameraStatus,
    showTouchpad,
    blanked,
    togglingBlank,
    toggleBlank,
    resetting,
    resetDetection,
    resettingToIdle,
    resetToIdle,
    queueIndex,
    navigatingQueue,
    navigateQueue,
  } = useScreenControls({
    screenId,
    initialBlanked,
    initialShowTouchpad,
    queueMediaIds,
    initialQueueIndex,
  });

  const hasQueue = Boolean(queueMediaIds && queueMediaIds.length > 0);

  const handleAssign = async (content: WsContent) => {
    setShowPicker(false);
    if (content.type === "video" || content.type === "image") {
      await assignMedia(screenId, content.id);
    } else {
      await assignExperience(screenId, content.id);
    }
  };

  // Only take effect on the physical TV — a no-op there if it's a regular
  // browser tab rather than the LobbyKiosk WebView2 host (see LiveScreenPlayer).
  const handleMinimize = async () => {
    setMinimizing(true);
    try {
      await sendRemoteCommand(screenId, "APP_MINIMIZE");
    } finally {
      setMinimizing(false);
    }
  };

  // Brings the kiosk app back to fullscreen after a remote Minimize (or if
  // someone minimized it by hand on the TV's PC) — a no-op there if it's a
  // regular browser tab rather than the LobbyKiosk WebView2 host.
  const handleMaximize = async () => {
    setMaximizing(true);
    try {
      await sendRemoteCommand(screenId, "APP_MAXIMIZE");
    } finally {
      setMaximizing(false);
    }
  };

  // Exits the kiosk app entirely — it won't come back until someone relaunches
  // it or the TV's PC reboots/logs in again (Startup shortcut), so confirm first.
  const handleCloseApp = async () => {
    if (!window.confirm(`Close the kiosk app on "${screenName}"? It won't reopen until the TV is relaunched or rebooted.`)) {
      return;
    }
    setClosingApp(true);
    try {
      await sendRemoteCommand(screenId, "APP_CLOSE");
    } finally {
      setClosingApp(false);
    }
  };

  const handleSetDefault = async (item: { id: string; name: string }) => {
    setCurrentDefault({ id: item.id, name: item.name });
    try {
      await assignDefaultMedia(screenId, item.id);
    } catch (err) {
      console.error("Failed to set default media:", err);
      setCurrentDefault({ id: changeContent?.defaultMediaAssetId ?? null, name: changeContent?.defaultMediaName ?? null });
    }
  };

  return (
    // h-full, not flex-1 — the parent scroll region (dashboard-layout-client's
    // overflow-y-auto div) is a plain block container, not a flex container,
    // so flex-1 here has nothing to grow against and this would otherwise
    // shrink to its content height. The screen mirror below masks that (it
    // sizes itself from aspect-[16/9], independent of ancestor height), but
    // the touchpad has no aspect ratio and needs a real height chain to fill
    // the screen instead of collapsing to just its own button bar.
    <div className="flex h-full min-h-0 flex-col p-4 gap-4 bg-zinc-100 dark:bg-black overflow-hidden">
      {/* Action bar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 px-1 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${online
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-zinc-500/10 text-zinc-500"
              }`}
          >
            {online ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-3 w-3" />}
            {/* {online ? "Online" : "Offline"} */}
          </span>
          <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase">
            {screenName}
          </h1>
          {cameraStatus && <CameraStatusBadge status={cameraStatus} />}
          {changeContent && currentDefault.name && (
            <span
              className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-zinc-500/10 text-zinc-500 dark:text-zinc-400"
              title="Shown when nothing else is assigned"
            >
              Default: {currentDefault.name}
            </span>
          )}
          {hasQueue && (
            <div className="flex items-center gap-1 rounded-xl bg-zinc-200/60 px-1 py-1 dark:bg-zinc-900">
              <button
                onClick={() => navigateQueue("prev")}
                disabled={navigatingQueue || queueIndex === 0}
                title="Previous item"
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-300 hover:text-zinc-950 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-850 dark:hover:text-zinc-100"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[4.5rem] text-center text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Item {queueIndex + 1} of {queueMediaIds!.length}
              </span>
              <button
                onClick={() => navigateQueue("next")}
                disabled={navigatingQueue || queueIndex === queueMediaIds!.length - 1}
                title="Next item"
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-300 hover:text-zinc-950 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-850 dark:hover:text-zinc-100"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* <span className="hidden md:inline text-[10px] text-zinc-400 dark:text-zinc-600 font-medium">
            {showTouchpad ? "· drag the pad below to drive the cursor on the TV" : "· touch to explore — mirrored on the TV in realtime"}
          </span> */}
          {/* // for testing */}
        </div>
        <div className="flex items-center gap-2">
          {SCREEN_TO_CAMERA[screenId] && (
            <button
              onClick={resetDetection}
              disabled={resetting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            >
              {resetting ? "Resetting..." : "Reset detection"}
            </button>
          )}
          <button
            onClick={resetToIdle}
            disabled={resettingToIdle}
            title="Clear the current assignment and fall back to the default/idle media"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-500/30 bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {resettingToIdle ? "Resetting..." : "Reset to idle"}
          </button>
          <button
            onClick={toggleBlank}
            disabled={togglingBlank}
            title={blanked ? "Resume — bring the screen's content back" : "Stop — blank the screen to solid black"}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 ${blanked
              ? "border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400"
              : "border-zinc-500/30 bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400"
              }`}
          >
            {blanked ? <Play className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
            {togglingBlank ? "..." : blanked ? "Resume" : "Stop"}
          </button>
          <button
            onClick={handleMinimize}
            disabled={minimizing}
            title="Minimize the kiosk app on the TV's PC, revealing its desktop"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-500/30 bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <Minimize2 className="h-3.5 w-3.5" /> {minimizing ? "..." : "Minimize"}
          </button>
          <button
            onClick={handleMaximize}
            disabled={maximizing}
            title="Bring the kiosk app back to fullscreen on the TV's PC"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-500/30 bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <Maximize2 className="h-3.5 w-3.5" /> {maximizing ? "..." : "Maximize"}
          </button>
          <button
            onClick={handleCloseApp}
            disabled={closingApp}
            title="Close the kiosk app on the TV's PC entirely"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <Power className="h-3.5 w-3.5" /> {closingApp ? "..." : "Close app"}
          </button>
          {changeContent && (
            <button
              onClick={() => setShowPicker(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-zinc-100 dark:text-zinc-900 text-[10px] font-bold uppercase tracking-wider transition-colors"
            >
              <Layers className="h-3.5 w-3.5" /> Change content
            </button>
          )}
        </div>
      </div>

      {showTouchpad ? (
        // No preview — a blank touchpad that drives the REAL OS cursor on the
        // TV's own PC (see ScreenTouchpad/screen-agent), instead of tapping a
        // mirrored preview of the page.
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="relative flex h-full min-h-0 w-full max-w-[1600px] flex-col rounded-2xl border-[3px] border-zinc-800 dark:border-zinc-900 shadow-2xl overflow-hidden">
            <ScreenTouchpad screenId={screenId} />
          </div>
        </div>
      ) : (
        /* Big interactive screen */
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="relative w-full max-w-[1600px] aspect-[16/9] max-h-full rounded-2xl border-[6px] border-zinc-800 dark:border-zinc-900 shadow-2xl bg-zinc-950 overflow-hidden">
            <ScreenMirror screenId={screenId} title={screenName} interactive />
          </div>
        </div>
      )}

      {changeContent && showPicker && (
        <ScreenAssignmentPicker
          screenName={screenName}
          experiences={changeContent.experiences}
          currentDefaultMediaAssetId={currentDefault.id}
          onAssign={handleAssign}
          onSetDefault={handleSetDefault}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
