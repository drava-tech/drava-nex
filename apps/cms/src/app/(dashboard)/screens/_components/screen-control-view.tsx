"use client";

import { useState } from "react";
import { Camera, Wifi, WifiOff, Layers, RotateCcw, Ban, Play, Lock, Unlock } from "lucide-react";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import { assignExperience, assignMedia, assignDefaultMedia, resetDetection, setScreenBlanked, setScreenInteractionEnabled } from "@/actions/screen-actions";
import { SCREEN_TO_CAMERA } from "@/lib/display/camera-config";
import { ScreenMirror } from "./screen-mirror";
import { ScreenTouchpad } from "./screen-touchpad";
import { ScreenAssignmentPicker } from "./screens-assignment-picker";
import type { CameraStatusUpdate, WsContent } from "@platform/types";

interface ScreenControlViewProps {
  screenId: string;
  screenName: string;
  experiences: { id: string; title: string }[];
  defaultMediaAssetId?: string | null;
  defaultMediaName?: string | null;
  initialBlanked?: boolean;
  initialInteractionEnabled?: boolean;
  /** When the screen's current content is a page/embed (link, YouTube, Drive,
   * PDF, sheet, deck...), shows the blank OS-cursor touchpad instead of
   * tap-on-mirror — see LiveControlDialog and ScreenTouchpad. */
  initialShowTouchpad?: boolean;
}

/**
 * Full-page interactive control for one screen. The big surface is the live
 * screen player (touch to explore); interactions relay to every client of the
 * screen so the TV stays in sync. "Change content" reuses the assignment picker.
 */
export function ScreenControlView({
  screenId,
  screenName,
  experiences,
  defaultMediaAssetId = null,
  defaultMediaName = null,
  initialBlanked = false,
  initialInteractionEnabled = true,
  initialShowTouchpad = false,
}: ScreenControlViewProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [online, setOnline] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatusUpdate | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resettingToIdle, setResettingToIdle] = useState(false);
  const [blanked, setBlanked] = useState(initialBlanked);
  const [togglingBlank, setTogglingBlank] = useState(false);
  const [interactionEnabled, setInteractionEnabled] = useState(initialInteractionEnabled);
  const [togglingInteraction, setTogglingInteraction] = useState(false);
  const [showTouchpad, setShowTouchpad] = useState(initialShowTouchpad);
  const [currentDefault, setCurrentDefault] = useState<{ id: string | null; name: string | null }>({
    id: defaultMediaAssetId,
    name: defaultMediaName,
  });

  const handleResetDetection = async () => {
    setResetting(true);
    try {
      await resetDetection(screenId);
    } catch (err) {
      console.error("Failed to reset detection:", err);
    } finally {
      setResetting(false);
    }
  };

  // Clears the current assignment so the screen falls back to its default/idle
  // media — same effect as "nothing assigned yet".
  const handleResetToIdle = async () => {
    setResettingToIdle(true);
    try {
      await assignMedia(screenId, null);
    } catch (err) {
      console.error("Failed to reset to idle:", err);
    } finally {
      setResettingToIdle(false);
    }
  };

  const handleToggleBlank = async () => {
    const next = !blanked;
    setTogglingBlank(true);
    setBlanked(next);
    try {
      await setScreenBlanked(screenId, next);
    } catch (err) {
      console.error("Failed to toggle screen blank state:", err);
      setBlanked(!next);
    } finally {
      setTogglingBlank(false);
    }
  };

  const handleToggleInteraction = async () => {
    const next = !interactionEnabled;
    setTogglingInteraction(true);
    setInteractionEnabled(next);
    try {
      await setScreenInteractionEnabled(screenId, next);
    } catch (err) {
      console.error("Failed to toggle screen interaction state:", err);
      setInteractionEnabled(!next);
    } finally {
      setTogglingInteraction(false);
    }
  };

  useCmsScreenSync({
    // Keep the touchpad in sync with whatever's actually assigned now, not
    // just what was live at page load — e.g. reassigning to a video should
    // drop back to the regular interactive mirror, and pushing a new link
    // should switch into touchpad mode.
    onScreenUpdated: (updatedScreenId, content) => {
      if (updatedScreenId !== screenId) return;
      setShowTouchpad(content.type === "html");
    },
    onActiveScreensUpdated: (ids) => setOnline(ids.includes(screenId)),
    onCameraStatusUpdated: (status) => {
      if (status.screenId === screenId) setCameraStatus(status);
    },
  });

  const handleAssign = async (content: WsContent) => {
    setShowPicker(false);
    if (content.type === "video" || content.type === "image") {
      await assignMedia(screenId, content.id);
    } else {
      await assignExperience(screenId, content.id);
    }
  };

  const handleSetDefault = async (item: { id: string; name: string }) => {
    setCurrentDefault({ id: item.id, name: item.name });
    try {
      await assignDefaultMedia(screenId, item.id);
    } catch (err) {
      console.error("Failed to set default media:", err);
      setCurrentDefault({ id: defaultMediaAssetId, name: defaultMediaName });
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 md:p-6 gap-4 bg-zinc-100 dark:bg-black overflow-hidden">
      {/* Action bar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              online
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-zinc-500/10 text-zinc-500"
            }`}
          >
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {online ? "Online" : "Offline"}
          </span>
          <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase">
            {screenName}
          </h1>
          {cameraStatus && <CameraStatusBadge status={cameraStatus} />}
          {currentDefault.name && (
            <span
              className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-zinc-500/10 text-zinc-500 dark:text-zinc-400"
              title="Shown when nothing else is assigned"
            >
              Default: {currentDefault.name}
            </span>
          )}
          <span className="hidden md:inline text-[10px] text-zinc-400 dark:text-zinc-600 font-medium">
            {showTouchpad ? "· drag the pad below to drive the cursor on the TV" : "· touch to explore — mirrored on the TV in realtime"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {SCREEN_TO_CAMERA[screenId] && (
            <button
              onClick={handleResetDetection}
              disabled={resetting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            >
              {resetting ? "Resetting..." : "Reset detection"}
            </button>
          )}
          <button
            onClick={handleResetToIdle}
            disabled={resettingToIdle}
            title="Clear the current assignment and fall back to the default/idle media"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-500/30 bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {resettingToIdle ? "Resetting..." : "Reset to idle"}
          </button>
          <button
            onClick={handleToggleBlank}
            disabled={togglingBlank}
            title={blanked ? "Resume — bring the screen's content back" : "Stop — blank the screen to solid black"}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 ${
              blanked
                ? "border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400"
                : "border-zinc-500/30 bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400"
            }`}
          >
            {blanked ? <Play className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
            {togglingBlank ? "..." : blanked ? "Resume" : "Stop"}
          </button>
          <button
            onClick={handleToggleInteraction}
            disabled={togglingInteraction}
            title={
              interactionEnabled
                ? "Disable controls — nobody can click/scroll/type into this screen"
                : "Enable controls — allow touch/click/scroll/type on this screen"
            }
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 ${
              interactionEnabled
                ? "border-zinc-500/30 bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400"
                : "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400"
            }`}
          >
            {interactionEnabled ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {togglingInteraction ? "..." : interactionEnabled ? "Controls On" : "Controls Off"}
          </button>
          <button
            onClick={() => setShowPicker(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-zinc-100 dark:text-zinc-900 text-[10px] font-bold uppercase tracking-wider transition-colors"
          >
            <Layers className="h-3.5 w-3.5" /> Change content
          </button>
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

      {showPicker && (
        <ScreenAssignmentPicker
          screenName={screenName}
          experiences={experiences}
          currentDefaultMediaAssetId={currentDefault.id}
          onAssign={handleAssign}
          onSetDefault={handleSetDefault}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

const CAMERA_COPY: Record<CameraStatusUpdate["status"], string> = {
  online: "Camera connected",
  waiting: "Waiting for product",
  detecting: "Product triggered",
  camera_unavailable: "Camera not connected",
  service_offline: "Camera service offline",
};

function CameraStatusBadge({ status }: { status: CameraStatusUpdate }) {
  const bad = status.status === "camera_unavailable" || status.status === "service_offline";
  const detecting = status.status === "detecting";

  return (
    <span
      className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
        bad
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : detecting
            ? "bg-green-500/10 text-green-600 dark:text-green-400"
            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }`}
      title={status.message}
    >
      <Camera className="h-3 w-3" />
      {CAMERA_COPY[status.status]}
    </span>
  );
}
