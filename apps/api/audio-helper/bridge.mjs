/**
 * bridge.mjs — native Windows bridge for system audio control.
 *
 * The API (cms-api) runs in a Linux Docker container and can never execute
 * audio-helper.exe (Windows-only NAudio/WASAPI) — spawn() always fails there.
 * This script runs natively on the Windows host instead: it spawns
 * audio-helper.exe locally exactly as the old in-container code used to, and
 * relays commands/status to the API over the same WebSocket gateway used by
 * CMS tabs and screens — connecting OUT to the already-running Dockerized
 * API, the same pattern already used by the live-stream publisher EXE.
 *
 * Run via: node --env-file=.env bridge.mjs  (see run.bat / the AudioBridge
 * Scheduled Task, mirroring VisionFaceCamera/ProductVisionCamera).
 */

import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WS_URL = process.env.AUDIO_BRIDGE_WS_URL || 'ws://192.168.0.250/ws/';
const SECRET = process.env.BROADCAST_SECRET || '';

if (!SECRET) {
  console.error('[bridge] BROADCAST_SECRET is not set — copy .env.example to .env and fill it in. Exiting.');
  process.exit(1);
}

// ─── audio-helper.exe management (same logic the old services/audio.ts had) ──

let child = null;
let latestStatus = { volume: 50, muted: false, device: 'Unknown Device' };

function resolveHelperPath() {
  const candidates = [
    path.resolve(__dirname, 'bin/Release/net9.0/audio-helper.exe'),
    path.resolve(__dirname, 'bin/Debug/net9.0/audio-helper.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

function startHelper() {
  if (child) return;

  let helperPath = resolveHelperPath();
  if (!fs.existsSync(helperPath)) {
    console.info('[bridge] audio-helper.exe not found. Triggering dotnet build...');
    try {
      execSync('dotnet build -c Release', { cwd: __dirname, stdio: 'inherit' });
      helperPath = resolveHelperPath();
    } catch (err) {
      console.error('[bridge] Failed to compile audio-helper C# binary:', err);
    }
  }

  console.info(`[bridge] Spawning audio-helper from: ${helperPath}`);
  try {
    child = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    console.error('[bridge] Failed to spawn audio-helper child process:', err);
    return;
  }

  child.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const payload = JSON.parse(line.trim());
        if (payload.type === 'status') {
          latestStatus = { volume: payload.volume, muted: payload.muted, device: payload.device };
          sendStatus();
        }
      } catch {
        // ignore non-JSON output
      }
    }
  });

  child.stderr?.on('data', (data) => {
    console.error(`[bridge] audio-helper stderr: ${data.toString().trim()}`);
  });

  child.on('error', (err) => {
    console.error('[bridge] audio-helper process error:', err);
  });

  child.on('close', (code) => {
    console.warn(`[bridge] audio-helper exited with code ${code}. Restarting in 3s...`);
    child = null;
    setTimeout(startHelper, 3000);
  });
}

function sendHelperCommand(cmd) {
  if (!child || !child.stdin || child.stdin.writableEnded) {
    console.warn('[bridge] audio-helper stdin not writable, cannot send command. Restarting...');
    startHelper();
    return;
  }
  try {
    child.stdin.write(JSON.stringify(cmd) + '\n');
  } catch (err) {
    console.error('[bridge] Error writing to audio-helper stdin:', err);
  }
}

// ─── WS connection to the Dockerized API gateway ────────────────────────────

let ws = null;
let reconnectDelay = 3000;
let reconnectTimer = null;
const RECONNECT_MAX_MS = 30_000;
const NACK_BACKOFF_MS = 30_000;

function connect() {
  console.info(`[bridge] Connecting to ${WS_URL}...`);
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.info('[bridge] WS connected, registering...');
    ws.send(JSON.stringify({ type: 'AUDIO_BRIDGE_REGISTER', secret: SECRET }));
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'AUDIO_BRIDGE_REGISTER_ACK') {
      console.info('[bridge] Registered with API.');
      reconnectDelay = 3000;
      sendStatus();
    } else if (msg.type === 'AUDIO_BRIDGE_REGISTER_NACK') {
      console.error(
        `[bridge] Registration rejected: ${msg.reason}. Check BROADCAST_SECRET matches the API's. ` +
        `Backing off ${NACK_BACKOFF_MS}ms.`
      );
      reconnectDelay = NACK_BACKOFF_MS;
    } else if (msg.type === 'AUDIO_COMMAND') {
      sendHelperCommand({ action: msg.action, value: msg.value });
    }
  });

  ws.on('close', () => {
    console.warn(`[bridge] WS disconnected. Reconnecting in ${reconnectDelay}ms...`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[bridge] WS error:', err.message);
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

function sendStatus() {
  // Dropped silently if not connected — the exe keeps running, and the next
  // successful reconnect + status line resyncs the API's cache.
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'AUDIO_BRIDGE_STATUS', ...latestStatus }));
}

startHelper();
connect();
