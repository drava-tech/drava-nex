"use client";

import { useState } from "react";
import { Camera, Radio } from "lucide-react";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import { CAMERAS } from "@/lib/display/camera-config";
import type { CameraStatusUpdate } from "@platform/types";

interface CameraSelectorProps {
  value: string;
  onChange: (cameraId: string) => void;
  /** Show "Screen default" as a selectable option that clears the override (empty string). */
  allowDefault?: boolean;
}

const STATUS_COPY: Record<CameraStatusUpdate["status"], string> = {
  online: "Connected",
  waiting: "Waiting",
  detecting: "Detecting",
  camera_unavailable: "Unavailable",
  service_offline: "Offline",
};

/**
 * Reusable camera picker for any template that needs live product detection.
 * Renders only where a template mounts it (e.g. Product Showcase), and shows
 * the selected camera's live detection probability, streamed over the same
 * WS channel the CMS uses for screen sync.
 */
export function CameraSelector({ value, onChange, allowDefault = true }: CameraSelectorProps) {
  const [statusByCamera, setStatusByCamera] = useState<Record<string, CameraStatusUpdate>>({});

  useCmsScreenSync({
    onScreenUpdated: () => {},
    onCameraStatusUpdated: (status) => {
      setStatusByCamera((prev) => ({ ...prev, [status.cameraId]: status }));
    },
  });

  const liveStatus = value ? statusByCamera[value] : undefined;
  const confidencePct =
    liveStatus?.confidence !== undefined ? Math.round(liveStatus.confidence * 100) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded-md border border-zinc-300 bg-zinc-100 px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        >
          {allowDefault && <option value="">Screen default</option>}
          {CAMERAS.map((camera) => (
            <option key={camera.id} value={camera.id}>
              {camera.label}
            </option>
          ))}
        </select>
      </div>

      {value && (
        <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[11px] dark:border-zinc-800 dark:bg-zinc-900/60">
          <Camera className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <span className="font-medium text-zinc-600 dark:text-zinc-300">
            {liveStatus ? STATUS_COPY[liveStatus.status] : "No signal yet"}
          </span>
          {confidencePct !== null && (
            <span className="ml-auto flex items-center gap-1 font-bold text-violet-600 dark:text-violet-400">
              <Radio className="h-3 w-3" />
              {liveStatus?.label ? `${liveStatus.label} · ` : ""}
              {confidencePct}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
