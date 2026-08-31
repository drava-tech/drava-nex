"use client";

import { useState } from "react";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import {
  assignMedia,
  resetDetection as resetDetectionAction,
  setScreenBlanked,
  advanceScreenQueue,
} from "@/actions/screen-actions";
import type { CameraStatusUpdate } from "@platform/types";

interface UseScreenControlsOptions {
  screenId: string;
  initialBlanked?: boolean;
  initialShowTouchpad?: boolean;
  /**
   * Ordered media-asset id list this screen was pushed as part of — enables
   * queue prev/next tracking off the same onScreenUpdated event instead of a
   * second WS connection. Omit for non-queue consumers; queueIndex/
   * navigateQueue are then simply unused.
   */
  queueMediaIds?: string[];
  initialQueueIndex?: number;
  /**
   * Called with whatever content this screen switched to, from ANY source —
   * this control panel, another admin tab, a queue step, a reset to idle, or
   * a kiosk relaunch. Lets a caller keep its own notion of "what's live"
   * honest instead of trusting a page-load snapshot.
   */
  onContentUpdated?: (content: { id: string; type: string }) => void;
}

/**
 * Shared live-control state for one screen — blank/resume, reset-detection,
 * reset-to-idle, and (optionally) queue position — backed by
 * a single useCmsScreenSync subscription. Extracted out of ScreenControlView
 * so the /screens/:screenId page and the /experiences/.../live/:deviceId page
 * run off one implementation instead of two copies of the same optimistic
 * update + rollback logic.
 */
export function useScreenControls({
  screenId,
  initialBlanked = false,
  initialShowTouchpad = false,
  queueMediaIds,
  initialQueueIndex = 0,
  onContentUpdated,
}: UseScreenControlsOptions) {
  const [online, setOnline] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatusUpdate | null>(null);
  const [showTouchpad, setShowTouchpad] = useState(initialShowTouchpad);

  const [resetting, setResetting] = useState(false);
  const [resettingToIdle, setResettingToIdle] = useState(false);
  const [blanked, setBlanked] = useState(initialBlanked);
  const [togglingBlank, setTogglingBlank] = useState(false);

  const [queueIndex, setQueueIndex] = useState(initialQueueIndex);
  const [navigatingQueue, setNavigatingQueue] = useState(false);

  useCmsScreenSync({
    // Keep the touchpad in sync with whatever's actually assigned now, not
    // just what was live at page load — e.g. reassigning to a video should
    // drop back to the regular interactive mirror, and pushing a new link
    // should switch into touchpad mode.
    onScreenUpdated: (updatedScreenId, content) => {
      if (updatedScreenId !== screenId) return;
      setShowTouchpad(content.type === "html");
      onContentUpdated?.({ id: content.id, type: content.type });
      // Keeps the "N of M" counter in sync across every open control panel
      // (another tab, a second admin) — derived from the live content id
      // rather than a bespoke WS message.
      if (queueMediaIds) {
        const idx = queueMediaIds.indexOf(content.id);
        if (idx !== -1) setQueueIndex(idx);
      }
    },
    onActiveScreensUpdated: (ids) => setOnline(ids.includes(screenId)),
    onCameraStatusUpdated: (status) => {
      if (status.screenId === screenId) setCameraStatus(status);
    },
  });

  const resetDetection = async () => {
    setResetting(true);
    try {
      await resetDetectionAction(screenId);
    } catch (err) {
      console.error("Failed to reset detection:", err);
    } finally {
      setResetting(false);
    }
  };

  // Clears the current assignment so the screen falls back to its default/idle
  // media — same effect as "nothing assigned yet".
  const resetToIdle = async () => {
    setResettingToIdle(true);
    try {
      await assignMedia(screenId, null);
    } catch (err) {
      console.error("Failed to reset to idle:", err);
    } finally {
      setResettingToIdle(false);
    }
  };

  const toggleBlank = async () => {
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

  const navigateQueue = async (direction: "next" | "prev") => {
    if (navigatingQueue) return;
    setNavigatingQueue(true);
    try {
      setQueueIndex(await advanceScreenQueue(screenId, direction));
    } catch (err) {
      // best-effort — DB stays authoritative, leave the counter as-is, retryable
      console.error("Failed to navigate queue:", err);
    } finally {
      setNavigatingQueue(false);
    }
  };

  return {
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
  };
}
