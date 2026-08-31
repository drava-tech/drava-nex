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
  return (
    <span
      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-slate-300"
      title={status.message}
    >
      <Camera className="h-3 w-3" />
      {CAMERA_COPY[status.status]}
    </span>
  );
}
