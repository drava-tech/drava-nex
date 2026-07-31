/**
 * agent.mjs — native Windows agent that drives the real OS mouse cursor.
 *
 * Runs on the Windows PC that physically drives one screen's TV (alongside
 * its kiosk Chrome), and connects OUT to the already-running Dockerized API
 * over the same WebSocket gateway used by CMS tabs and screens — same
 * "native helper bridges out to the container" pattern as
 * apps/api/audio-helper/bridge.mjs. A CMS tablet's touchpad sends relative
 * move/click/scroll deltas for this PC's screenId; this agent applies them as
 * REAL OS-level mouse input, so remote control works for whatever's actually
 * on screen (a browser tab, YouTube, anything else) with no app-specific
 * plumbing — a real click always lands correctly, by definition.
 *
 * Run via: node --env-file=.env agent.mjs (see run.bat / a "ScreenAgent"
 * Scheduled Task, mirroring AudioBridge/VisionFaceCamera).
 */

import { WebSocket } from 'ws';
import { mouse, Point, screen } from '@nut-tree-fork/nut-js';

// Instant jumps instead of nut-js's default glide animation — a real
// trackpad moves the cursor 1:1 with the drag, not on a delay.
mouse.config.mouseSpeed = 0;

const WS_URL = process.env.SCREEN_AGENT_WS_URL || 'ws://ec-cms/ws/';
const SECRET = process.env.BROADCAST_SECRET || '';
const SCREEN_ID = process.env.SCREEN_ID || '';

if (!SECRET) {
  console.error('[agent] BROADCAST_SECRET is not set — copy .env.example to .env and fill it in. Exiting.');
  process.exit(1);
}
if (!SCREEN_ID) {
  console.error(
    '[agent] SCREEN_ID is not set — copy .env.example to .env and set it to THIS PC\'s own screenId ' +
    '(the same one its kiosk Chrome is pointed at, e.g. chrome.exe --kiosk ".../display/main-TV" -> SCREEN_ID=main-TV). Exiting.'
  );
  process.exit(1);
}

// ─── OS-level cursor control (nut-js) ───────────────────────────────────────

async function handleCursorControl(msg) {
  try {
    if (msg.action === 'move' && typeof msg.dx === 'number' && typeof msg.dy === 'number') {
      const pos = await mouse.getPosition();
      const width = await screen.width();
      const height = await screen.height();
      const next = new Point(
        Math.min(Math.max(pos.x + msg.dx, 0), width - 1),
        Math.min(Math.max(pos.y + msg.dy, 0), height - 1)
      );
      await mouse.setPosition(next);
    } else if (msg.action === 'click') {
      await mouse.leftClick();
    } else if (msg.action === 'scroll' && typeof msg.deltaY === 'number') {
      const amount = Math.round(Math.abs(msg.deltaY));
      if (amount === 0) return;
      if (msg.deltaY > 0) await mouse.scrollDown(amount);
      else await mouse.scrollUp(amount);
    }
  } catch (err) {
    console.error('[agent] Failed to apply cursor control:', err);
  }
}

// ─── WS connection to the Dockerized API gateway ────────────────────────────

let ws = null;
let reconnectDelay = 3000;
let reconnectTimer = null;
const RECONNECT_MAX_MS = 30_000;
const NACK_BACKOFF_MS = 30_000;

function connect() {
  console.info(`[agent] Connecting to ${WS_URL}...`);
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.info('[agent] WS connected, registering...');
    ws.send(JSON.stringify({ type: 'SCREEN_AGENT_REGISTER', screenId: SCREEN_ID, secret: SECRET }));
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'SCREEN_AGENT_REGISTER_ACK') {
      console.info(`[agent] Registered as the screen-agent for "${SCREEN_ID}".`);
      reconnectDelay = 3000;
    } else if (msg.type === 'SCREEN_AGENT_REGISTER_NACK') {
      console.error(
        `[agent] Registration rejected: ${msg.reason}. Check BROADCAST_SECRET matches the API's. ` +
        `Backing off ${NACK_BACKOFF_MS}ms.`
      );
      reconnectDelay = NACK_BACKOFF_MS;
    } else if (msg.type === 'CURSOR_CONTROL') {
      handleCursorControl(msg);
    }
  });

  ws.on('close', () => {
    console.warn(`[agent] WS disconnected. Reconnecting in ${reconnectDelay}ms...`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[agent] WS error:', err.message);
    ws.close();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

connect();
