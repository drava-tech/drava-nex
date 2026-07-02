/**
 * Manually clears an active camera-detection takeover on a screen, reverting it
 * to its assigned/idle content. Needed because VISION_HOLD_PRODUCT=true means the
 * screen never reverts on its own once something is detected — this sends the
 * same PRODUCT_LOST the vision service would send on natural object removal,
 * reusing the existing gateway protocol (apps/api/src/ws/gateway.ts) as-is.
 *
 * Usage:
 *   node infra/scripts/reset-detection.js <cameraId> <label>
 *   pnpm vision:reset camera-01 coster
 */

// Internal admin tool only, talking to our own nginx with a locally-issued
// mkcert dev certificate — Node doesn't trust it by default.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const wsUrl = process.env.CMS_WEBSOCKET_URL || "wss://192.168.1.250/ws/";
const [, , cameraId, label] = process.argv;

if (!cameraId || !label) {
  console.error("Usage: node infra/scripts/reset-detection.js <cameraId> <label>");
  console.error("Example: node infra/scripts/reset-detection.js camera-01 coster");
  process.exit(1);
}

const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "PRODUCT_LOST",
    cameraId,
    label,
    lostAt: new Date().toISOString(),
  }));
  console.log(`Sent PRODUCT_LOST for cameraId=${cameraId} label=${label}`);
  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 1000);
};

ws.onerror = (e) => {
  console.error("WS error:", e.message ?? e);
  process.exit(1);
};
