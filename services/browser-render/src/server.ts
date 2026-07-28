import http from "node:http";
import puppeteer, { type Browser } from "puppeteer";
import { WebSocket } from "ws";
import { SessionManager } from "./sessions.js";
import type { ControlMessage } from "./protocol.js";

const WS_GATEWAY_URL = process.env["WS_GATEWAY_URL"] || "ws://api:4000/ws";
const BROADCAST_SECRET = process.env["BROADCAST_SECRET"] || "";
const MAX_SESSIONS = Number(process.env["MAX_SESSIONS"] || 8);
const HEALTH_PORT = Number(process.env["PORT"] || 8090);

if (!BROADCAST_SECRET) {
  console.error("[browser-render] BROADCAST_SECRET is not set — the gateway will reject registration. Exiting.");
  process.exit(1);
}

let browser: Browser | null = null;
let sessions: SessionManager | null = null;
let control: WebSocket | null = null;
let registered = false;

async function launchBrowser(): Promise<Browser> {
  for (;;) {
    try {
      return await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
        ],
      });
    } catch (err) {
      console.error("[browser-render] Chromium launch failed, retrying in 5s:", (err as Error).message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ─── Control connection to the platform's /ws gateway ──────────────────────────
// Same reconnect-with-backoff shape as apps/api/audio-helper/bridge.mjs, which
// connects to the same gateway for the same reason (a first-party Node process
// outside the CMS/screens that needs to both receive commands and report status).

let reconnectDelay = 3000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_MAX_MS = 30_000;
const NACK_BACKOFF_MS = 30_000;

function sendControl(msg: ControlMessage | Record<string, unknown>): void {
  if (control && control.readyState === WebSocket.OPEN) {
    control.send(JSON.stringify(msg));
  }
}

function connect(): void {
  console.info(`[browser-render] Connecting to ${WS_GATEWAY_URL}...`);
  const sock = new WebSocket(WS_GATEWAY_URL);
  control = sock;

  sock.on("open", () => {
    console.info("[browser-render] WS connected, registering...");
    sock.send(JSON.stringify({ type: "BROWSER_RENDER_REGISTER", secret: BROADCAST_SECRET }));
  });

  sock.on("message", (raw) => {
    let msg: ControlMessage;
    try {
      msg = JSON.parse(raw.toString()) as ControlMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "BROWSER_RENDER_REGISTER_ACK":
        console.info("[browser-render] Registered with API.");
        registered = true;
        reconnectDelay = 3000;
        break;
      case "BROWSER_RENDER_REGISTER_NACK":
        console.error(
          `[browser-render] Registration rejected: ${msg.reason}. Check BROADCAST_SECRET matches the API's. Backing off ${NACK_BACKOFF_MS}ms.`
        );
        reconnectDelay = NACK_BACKOFF_MS;
        break;
      case "BROWSER_SESSION_START":
        void sessions?.start(msg);
        break;
      case "BROWSER_SESSION_STOP":
        void sessions?.stop(msg.sessionId);
        break;
      case "BROWSER_CONTROL":
        void sessions?.control(msg);
        break;
    }
  });

  sock.on("close", () => {
    registered = false;
    console.warn(`[browser-render] WS disconnected. Reconnecting in ${reconnectDelay}ms...`);
    scheduleReconnect();
  });

  sock.on("error", (err) => {
    console.error("[browser-render] WS error:", err.message);
    sock.close();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

// ─── Health endpoint (compose healthcheck) ──────────────────────────────────────

http
  .createServer((req, res) => {
    if (req.url === "/health" && browser && registered) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessions: sessions?.activeCount ?? 0 }));
      return;
    }
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  })
  .listen(HEALTH_PORT, () => console.info(`[browser-render] Health endpoint on :${HEALTH_PORT}`));

async function main(): Promise<void> {
  browser = await launchBrowser();
  console.info("[browser-render] Chromium launched.");
  sessions = new SessionManager({
    browser,
    wsGatewayUrl: WS_GATEWAY_URL,
    maxSessions: MAX_SESSIONS,
    sendControl,
  });
  connect();
}

void main();
