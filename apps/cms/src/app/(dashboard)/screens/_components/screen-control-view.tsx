"use client";

import { useState } from "react";
import { Camera, Wifi, WifiOff, Layers } from "lucide-react";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import { assignExperience, assignMedia } from "@/actions/screen-actions";
import { ScreenMirror } from "./screen-mirror";
import { ScreenAssignmentPicker } from "./screens-assignment-picker";
import type { CameraStatusUpdate, WsContent } from "@platform/types";

interface ScreenControlViewProps {
  screenId: string;
  screenName: string;
  experiences: { id: string; title: string }[];
}

/**
 * Full-page interactive control for one screen. The big surface is the live
 * screen player (touch to explore); interactions relay to every client of the
 * screen so the TV stays in sync. "Change content" reuses the assignment picker.
 */
export function ScreenControlView({ screenId, screenName, experiences }: ScreenControlViewProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [online, setOnline] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatusUpdate | null>(null);

  useCmsScreenSync({
    onScreenUpdated: () => {},
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
          <span className="hidden md:inline text-[10px] text-zinc-400 dark:text-zinc-600 font-medium">
            · touch to explore — mirrored on the TV in realtime
          </span>
        </div>
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-zinc-100 dark:text-zinc-900 text-[10px] font-bold uppercase tracking-wider transition-colors"
        >
          <Layers className="h-3.5 w-3.5" /> Change content
        </button>
      </div>

      {/* Big interactive screen */}
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="relative w-full max-w-[1600px] aspect-[16/9] max-h-full rounded-2xl border-[6px] border-zinc-800 dark:border-zinc-900 shadow-2xl bg-zinc-950 overflow-hidden">
          <ScreenMirror screenId={screenId} title={screenName} interactive />
        </div>
      </div>

      {showPicker && (
        <ScreenAssignmentPicker
          screenName={screenName}
          experiences={experiences}
          onAssign={handleAssign}
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
