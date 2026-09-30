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
import { mouse, Point, screen, Button } from '@nut-tree-fork/nut-js';

// Instant jumps instead of nut-js's default glide animation — a real
// trackpad moves the cursor 1:1 with the drag, not on a delay.
mouse.config.mouseSpeed = 0;

const WS_URL = process.env.SCREEN_AGENT_WS_URL || 'ws://ec-cms/ws/';
const SECRET = process.env.BROADCAST_SECRET || '';
const SCREEN_ID = process.env.SCREEN_ID || '';
// Off by default: the per-move trace below fires on EVERY mouse-move message
// (hundreds a second during a drag), and this process now logs to a file
// rather than a console. Set SCREEN_AGENT_DEBUG=1 in .env to turn it on
// while diagnosing, then turn it back off.
const DEBUG = process.env.SCREEN_AGENT_DEBUG === '1';

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

/**
 * A net-zero-displacement nudge — move the real cursor by (+1,+1) then
 * immediately back by (-1,-1). Forces at least one genuine OS-level
 * mouse-move event through the input stack as soon as the agent comes
 * online, which is the standard fix for a cursor Windows/Chrome hasn't
 * (re)drawn yet without a fresh real input event. Harmless no-op if the
 * cursor was already visible.
 */
async function jiggleCursor() {
  try {
    const pos = await mouse.getPosition();
    await mouse.setPosition(new Point(pos.x + 1, pos.y + 1));
    await mouse.setPosition(pos);
  } catch (err) {
    console.error('[agent] Cursor jiggle failed:', err);
  }
}

// The connect-time jiggle above only primes the cursor once, at process
// startup — but the same "Windows/Chrome hasn't redrawn the cursor sprite"
// state can recur any time the real cursor sits still for a while (focus
// changes, the driven app repainting over it, etc.), well after the agent
// itself has been online and working for hours. Re-priming at the start of
// every *fresh* drag (not every single move event, which would be wasteful
// and could introduce visible jitter) covers that recurring case cheaply.
const MOVE_IDLE_REPRIME_MS = 1_500;
let lastMoveAt = 0;

async function handleCursorControl(msg) {
  try {
    if (msg.action === 'move' && typeof msg.dx === 'number' && typeof msg.dy === 'number') {
      const now = Date.now();
      if (now - lastMoveAt > MOVE_IDLE_REPRIME_MS) {
        await jiggleCursor();
      }
      lastMoveAt = now;
      const pos = await mouse.getPosition();
      const width = await screen.width();
      const height = await screen.height();
      // msg.dx/dy arrive as floats (client-side CURSOR_GAIN scaling) — round
      // to an exact integer pixel target rather than handing nut-js/Windows a
      // fractional position and hoping it truncates sensibly every time.
      const next = new Point(
        Math.round(Math.min(Math.max(pos.x + msg.dx, 0), width - 1)),
        Math.round(Math.min(Math.max(pos.y + msg.dy, 0), height - 1))
      );
      await mouse.setPosition(next);
      // Diagnostic: confirms move commands are actually arriving and
      // landing on sane, changing coordinates — check agent.log during a
      // drag if the cursor still isn't visible on the TV despite clicks/
      // scroll working, to tell a functional bug from a pure OS/Chrome
      // cursor-rendering visibility issue. Gated behind SCREEN_AGENT_DEBUG
      // because it is per-move and would otherwise dominate the log.
      if (DEBUG) console.debug(`[agent] move -> (${next.x}, ${next.y})`);
    } else if (msg.action === 'click') {
      await mouse.click(msg.button === 'right' ? Button.RIGHT : Button.LEFT);
    } else if (msg.action === 'scroll' && typeof msg.deltaY === 'number') {
      const amount = Math.round(Math.abs(msg.deltaY));
      if (amount === 0) return;
      if (msg.deltaY > 0) await mouse.scrollDown(amount);
      else await mouse.scrollUp(amount);
    } else if (msg.action === 'scrollH' && typeof msg.deltaX === 'number') {
      const amount = Math.round(Math.abs(msg.deltaX));
      if (amount === 0) return;
      if (msg.deltaX > 0) await mouse.scrollRight(amount);
      else await mouse.scrollLeft(amount);
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
      jiggleCursor();
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
