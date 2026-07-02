import { LiveStreamCanvas } from "@platform/ui/templates/live-stream";

/**
 * Small corner box showing the live feed of whatever camera is mapped to this
 * screen (streamId = cameraId, published by services/product-vision). The camera
 * is exclusively claimed by that Docker container via usbipd passthrough, so the
 * browser can't reach it directly via getUserMedia — this relays already-captured
 * frames over the existing live-stream WS protocol instead.
 */
export function CameraPreviewOverlay({ cameraId, wsUrl }: { cameraId?: string; wsUrl: string }) {
  if (!cameraId) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 34,
        width: 220,
        height: 124,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.25)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
    >
      <LiveStreamCanvas streamId={cameraId} fit="cover" label="Camera" wsUrl={wsUrl} />
    </div>
  );
}
