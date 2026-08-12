import { Camera } from "lucide-react";
import type { CameraStatusUpdate } from "@platform/types";

const CAMERA_COPY: Record<CameraStatusUpdate["status"], string> = {
  online: "Camera connected",
  waiting: "Waiting for product",
  detecting: "Product triggered",
  camera_unavailable: "Camera not connected",
  service_offline: "Camera service offline",
};

export function CameraStatusBadge({ status }: { status: CameraStatusUpdate }) {
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
