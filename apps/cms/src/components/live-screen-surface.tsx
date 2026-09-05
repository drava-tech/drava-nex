"use client";

import { useState } from "react";
import Link from "next/link";
import { Wifi, WifiOff, Layers, RotateCcw, Ban, Play, ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, AppWindow, Minimize2, Maximize2, Power, RefreshCw, Minus, Plus, Volume2, VolumeX, Rewind, FastForward, Pause } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@platform/ui";
import { useScreenControls } from "@/hooks/useScreenControls";
import { useSystemAudio } from "@/hooks/useSystemAudio";
import { assignExperience, assignMedia, assignDefaultMedia, sendRemoteCommand } from "@/actions/screen-actions";
import { SCREEN_TO_CAMERA } from "@/lib/display/camera-config";
import { MEDIA_SEEK, MEDIA_TOGGLE_PLAY } from "@/lib/display/playback-protocol";
import { CameraStatusBadge } from "@/components/camera-status-badge";
import { ScreenMirror } from "@/app/(dashboard)/screens/_components/screen-mirror";
import { ScreenTouchpad } from "@/app/(dashboard)/screens/_components/screen-touchpad";
import { ScreenAssignmentPicker } from "@/app/(dashboard)/screens/_components/screens-assignment-picker";
import type { WsContent } from "@platform/types";

/** Per-tap step for the volume -/+ buttons — see screen-touchpad.tsx. */
const VOLUME_STEP = 5;
/** Per-tap jump for the transport's rewind/forward buttons, in seconds. */
const SEEK_STEP_SECONDS = 10;

/**
 * Whether the live content is something with a timeline to scrub. A native
 * video is its own wire type; YouTube shares "html" with PDF/slides/word/
 * sheet/links, so it has to be told apart by its embed URL — the same test
 * HtmlRenderer uses to decide whether to attach the IFrame Player API.
 */
function isPlayableMedia(content: { type: string; source?: string } | null): boolean {
  if (!content) return false;
  if (content.type === "video") return true;
  return content.type === "html" && /^https:\/\/www\.youtube\.com\/embed\//.test(content.source ?? "");
}

interface LiveScreenSurfaceProps {
  screenId: string;
  screenName: string;
  initialBlanked?: boolean;
  initialShowTouchpad?: boolean;
  queueMediaIds?: string[];
  initialQueueIndex?: number;
  changeContent?: {
    experiences: { id: string; title: string; coverImage?: string | null }[];
    defaultMediaAssetId?: string | null;
    defaultMediaName?: string | null;
  }
  /** Whatever's actually live on the screen right now, so re-picking the same
   * content can be skipped as a no-op — see handleAssign. */
  initialContent?: { id: string; type: string; source?: string } | null;
  backHref?: string;
}

export function LiveScreenSurface({
  screenId,
  screenName,
  initialBlanked = false,
  initialShowTouchpad = false,
  queueMediaIds,
  initialQueueIndex = 0,
  changeContent,
  initialContent = null,
  backHref,
}: LiveScreenSurfaceProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [minimizing, setMinimizing] = useState(false);
  const [maximizing, setMaximizing] = useState(false);
  const [closingApp, setClosingApp] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [currentDefault, setCurrentDefault] = useState<{ id: string | null; name: string | null }>({
    id: changeContent?.defaultMediaAssetId ?? null,
    name: changeContent?.defaultMediaName ?? null,
  });
  const [currentContent, setCurrentContent] = useState(initialContent);
  /** Optimistic only: SET_PLAYBACK fans out to the screen registry, never to
   * CMS sockets, so this panel cannot observe real playback state. Reset on
   * every content change, where "playing" is known to be true again. */
  const [assumePlaying, setAssumePlaying] = useState(true);

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
    resettingState,
    resetState,
    queueIndex,
    navigatingQueue,
    navigateQueue,
  } = useScreenControls({
    screenId,
    initialBlanked,
    initialShowTouchpad,
    queueMediaIds,
    initialQueueIndex,
    // Keep the no-op check in handleAssign honest: without this, currentContent
    // only ever reflects pushes made from THIS panel, so a reset-to-idle, a
    // queue step, or another admin tab would leave it pointing at content
    // that is no longer live — and re-picking that content would be
    // misread as a redundant push and silently dropped.
    onContentUpdated: (content) => {
      setCurrentContent(content);
      // Anything newly pushed starts playing, so the optimistic toggle has a
      // known-good state again at every content change.
      setAssumePlaying(true);
    },
  });

  const hasQueue = Boolean(queueMediaIds && queueMediaIds.length > 0);

  /** Any kiosk window command in flight — surfaced on the collapsed App menu's
   * trigger, since its items' own busy states are hidden while it's closed. */
  const appBusy = reloading || minimizing || maximizing || closingApp;

  // Same office-wide system audio endpoint as the touchpad's volume row and
  // the Environment Control Audio tile — one physical PC's speakers,
  // independent of whatever content is assigned, so it's always visible here
  // regardless of what's live.
  const { volume, muted, adjustVolume, toggleMute } = useSystemAudio();

  const handleAssign = async (content: WsContent) => {
    setShowPicker(false);
    // Re-picking whatever's already live is a no-op on the real screen (its
    // player dedupes by content key), so skip the round trip entirely and
    // leave the screen exactly where it is rather than re-pushing it back to
    // its own remembered position. Reliable only because onContentUpdated
    // above keeps currentContent tracking the real live content.
    if (currentContent?.id === content.id && currentContent?.type === content.type) return;
    setCurrentContent({ id: content.id, type: content.type });
    // "experience" is the one type the picker's Experiences tab ever sends;
    // every other type (video/image from Files, or any other media kind —
    // document/presentation/sheet/word/youtube/drive/link — surfaced by
    // Recently Opened) is a media asset id, so treat "experience" as the
    // special case rather than allowlisting just video/image, which used to
    // be the only two kinds this picker could ever produce.
    if (content.type === "experience") {
      await assignExperience(screenId, content.id);
    } else {
      await assignMedia(screenId, content.id);
    }
  };

  const showTransport = isPlayableMedia(currentContent);

  const handleSeek = async (delta: number) => {
    await sendRemoteCommand(screenId, MEDIA_SEEK, { delta });
  };

  const handleTogglePlay = async () => {
    setAssumePlaying((prev) => !prev);
    await sendRemoteCommand(screenId, MEDIA_TOGGLE_PLAY);
  };

  const handleMinimize = async () => {
    setMinimizing(true);
    try {
      await sendRemoteCommand(screenId, "APP_MINIMIZE");
    } finally {
      setMinimizing(false);
    }
  };

  const handleMaximize = async () => {
    setMaximizing(true);
    try {
      await sendRemoteCommand(screenId, "APP_MAXIMIZE");
    } finally {
      setMaximizing(false);
    }
  };

  const handleReload = async () => {
    setReloading(true);
    try {
      await sendRemoteCommand(screenId, "RELOAD");
    } finally {
      setReloading(false);
    }
  };

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
    <div className="flex h-full min-h-0 flex-col p-4 gap-4 bg-zinc-100 dark:bg-black overflow-hidden">
      {/* Action bar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {backHref && (
            <Link
              href={backHref}
              aria-label="Back"
              className="flex items-center justify-center rounded-xl p-2 text-zinc-500 transition-colors hover:bg-zinc-500/10 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
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
              className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-slate-300"
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
            onClick={resetState}
            disabled={resettingState}
            title="Reset the current content to its initial state (e.g. portfolio 1st frame)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#432992] bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {resettingState ? "Resetting..." : "Reset view"}
          </button>
          <button
            onClick={resetToIdle}
            disabled={resettingToIdle}
            title="Clear the current assignment and fall back to the default/idle media"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#432992] bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {resettingToIdle ? "Resetting..." : "Reset to idle"}
          </button>
          <button
            onClick={toggleBlank}
            disabled={togglingBlank}
            title={blanked ? "Resume — bring the screen's content back" : "Stop — blank the screen to solid black"}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 ${blanked
              ? "border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400"
              : "border-[#432992] bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400"
              }`}
          >
            {blanked ? <Play className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
            {togglingBlank ? "..." : blanked ? "Resume" : "Stop"}
          </button>
          {/* Kiosk window controls (refresh/minimize/maximize/close) collapsed
              into one menu — four permanent buttons crowded the action bar,
              and these are occasional maintenance actions, unlike the live
              content controls beside them. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={appBusy}
              title="Kiosk app controls on the TV's PC — refresh, minimize, maximize, close"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#432992] bg-zinc-500/10 hover:bg-zinc-500/20 data-[state=open]:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            >
              <AppWindow className="h-3.5 w-3.5" />
              {appBusy ? "..." : "App"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onSelect={handleReload}
                disabled={reloading}
                className="cursor-pointer gap-2"
                title="Reload the browser on the TV's PC — needed after a CMS redeploy so the kiosk picks up the new build"
              >
                <RefreshCw className="h-4 w-4" /> Refresh
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={handleMinimize}
                disabled={minimizing}
                className="cursor-pointer gap-2"
                title="Minimize the kiosk app on the TV's PC, revealing its desktop"
              >
                <Minimize2 className="h-4 w-4" /> Minimize
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={handleMaximize}
                disabled={maximizing}
                className="cursor-pointer gap-2"
                title="Bring the kiosk app back to fullscreen on the TV's PC"
              >
                <Maximize2 className="h-4 w-4" /> Maximize
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                // Deferred so the menu finishes closing before the blocking
                // window.confirm inside the handler freezes the main thread.
                onSelect={() => setTimeout(handleCloseApp, 0)}
                disabled={closingApp}
                className="cursor-pointer gap-2 text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                title="Close the kiosk app on the TV's PC entirely"
              >
                <Power className="h-4 w-4" /> Close app
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Transport cluster — only for content with a timeline. Grouped in
              its own pill and placed beside the volume controls so it reads as
              media transport, and stays clearly separate from the Stop/Resume
              button above, which shares a Play icon but blanks the screen
              rather than controlling playback. */}
          {showTransport && (
            <div className="flex items-center gap-0.5 rounded-xl bg-zinc-500/10 px-1 py-1">
              <button
                onClick={() => handleSeek(-SEEK_STEP_SECONDS)}
                title={`Back ${SEEK_STEP_SECONDS}s`}
                aria-label={`Back ${SEEK_STEP_SECONDS} seconds`}
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-300 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-850 dark:hover:text-zinc-100"
              >
                <Rewind className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleTogglePlay}
                title={assumePlaying ? "Pause" : "Play"}
                aria-label={assumePlaying ? "Pause" : "Play"}
                className="flex min-w-[3.5rem] items-center justify-center gap-1.5 rounded-lg p-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 transition-colors hover:bg-zinc-300 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-850 dark:hover:text-zinc-100"
              >
                {assumePlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {assumePlaying ? "Pause" : "Play"}
              </button>
              <button
                onClick={() => handleSeek(SEEK_STEP_SECONDS)}
                title={`Forward ${SEEK_STEP_SECONDS}s`}
                aria-label={`Forward ${SEEK_STEP_SECONDS} seconds`}
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-300 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-850 dark:hover:text-zinc-100"
              >
                <FastForward className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Volume cluster — always rendered, independent of what content is
              live (video, image, experience, or the touchpad), since it
              drives the PC's system audio rather than any one piece of
              content. */}
          <div className="flex items-center gap-0.5 rounded-xl bg-zinc-500/10 px-1 py-1">
            <button
              onClick={() => adjustVolume(-VOLUME_STEP)}
              title="Decrease volume"
              aria-label="Decrease volume"
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-300 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-850 dark:hover:text-zinc-100"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={toggleMute}
              title={muted ? "Unmute" : "Mute"}
              aria-label={muted ? "Unmute" : "Mute"}
              aria-pressed={muted}
              className={`flex min-w-[3.5rem] items-center justify-center gap-1.5 rounded-lg p-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${muted
                  ? "text-red-600 dark:text-red-400"
                  : "text-zinc-500 hover:bg-zinc-300 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-850 dark:hover:text-zinc-100"
                }`}
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              {muted ? "Muted" : `${volume}%`}
            </button>
            <button
              onClick={() => adjustVolume(VOLUME_STEP)}
              title="Increase volume"
              aria-label="Increase volume"
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-300 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-850 dark:hover:text-zinc-100"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

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
          <div className="relative flex h-full min-h-0 w-full max-w-[1600px] flex-col rounded-2xl border-[3px] border-[#432992] shadow-2xl overflow-hidden">
            <ScreenTouchpad screenId={screenId} />
          </div>
        </div>
      ) : (
        /* Big interactive screen */
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="relative w-full max-w-[1600px] aspect-[16/9] max-h-full rounded-2xl border-[6px] border-[#432992] shadow-2xl bg-zinc-950 overflow-hidden">
            <ScreenMirror screenId={screenId} title={screenName} interactive />
          </div>
        </div>
      )}

      {changeContent && showPicker && (
        <ScreenAssignmentPicker
          screenId={screenId}
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
