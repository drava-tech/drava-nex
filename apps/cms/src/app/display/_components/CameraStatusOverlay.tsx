import type { CameraStatusUpdate } from "@platform/types";

interface CameraStatusOverlayProps {
  status: CameraStatusUpdate | null;
}

const COPY: Record<CameraStatusUpdate["status"], { label: string; tone: "ok" | "warn" | "bad" }> = {
  online: { label: "Camera connected", tone: "ok" },
  waiting: { label: "Camera connected - waiting for product", tone: "ok" },
  detecting: { label: "Camera triggered product", tone: "ok" },
  camera_unavailable: { label: "Camera not connected", tone: "bad" },
  service_offline: { label: "Camera service offline", tone: "warn" },
};

const COLORS = {
  ok: { dot: "#4ade80", border: "rgba(74,222,128,0.35)" },
  warn: { dot: "#fbbf24", border: "rgba(251,191,36,0.35)" },
  bad: { dot: "#f87171", border: "rgba(248,113,113,0.35)" },
};

export function CameraStatusOverlay({ status }: CameraStatusOverlayProps) {
  if (!status) return null;

  const copy = COPY[status.status];
  const colors = COLORS[copy.tone];

  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        top: 24,
        zIndex: 35,
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: "min(520px, calc(100vw - 48px))",
        border: `1px solid ${colors.border}`,
        borderRadius: 999,
        backgroundColor: "rgba(0,0,0,0.72)",
        padding: "9px 14px",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          backgroundColor: colors.dot,
          boxShadow: `0 0 10px ${colors.dot}`,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
        {copy.label}
      </span>
    </div>
  );
}
