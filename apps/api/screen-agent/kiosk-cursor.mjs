/**
 * kiosk-cursor.mjs — runs kiosk-cursor.cs (compiled in memory by PowerShell's
 * Add-Type, so nothing to build or install) as a long-lived child process and
 * talks to it over stdin/stdout. See kiosk-cursor.cs for why: node is
 * DPI-unaware and cannot put the cursor on a non-primary monitor that uses a
 * different scaling, so with SCREEN_AGENT_FOLLOW_WINDOW set the agent hands
 * all cursor POSITIONING to this helper and keeps clicks/scroll on nut-js.
 *
 * Never fatal: until the helper reports "ready" (or while it is restarting
 * after a crash) `ready` is false and agent.mjs falls back to plain nut-js.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENSURE_TIMEOUT_MS = 500;
const RESTART_MIN_MS = 2_000;
const RESTART_MAX_MS = 60_000;

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function startKioskCursor(processName, { debug = false } = {}) {
  let child = null;
  let ready = false;
  let stopped = false;
  let restartDelay = RESTART_MIN_MS;
  let nextId = 1;
  const pending = new Map();

  function settleAll() {
    for (const done of pending.values()) done(false);
    pending.clear();
  }

  function spawnHelper() {
    const script =
      // ProgressPreference: with output redirected, PowerShell would otherwise
      // serialise Add-Type's progress records to stderr as "#< CLIXML" noise.
      `$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; ` +
      `Add-Type -TypeDefinition ([IO.File]::ReadAllText(${psQuote(path.join(HERE, 'kiosk-cursor.cs'))})); ` +
      `[KioskCursor]::Run(${psQuote(processName)}, $${debug ? 'true' : 'false'})`;
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    const self = child;
    self.stdin.on('error', () => {}); // EPIPE while it is exiting — the exit handler covers it

    readline.createInterface({ input: self.stdout }).on('line', (line) => {
      if (line.startsWith('ok ')) {
        const done = pending.get(line.slice(3));
        if (done) done(true);
      } else if (line.startsWith('pos ')) {
        if (debug) console.debug(`[agent] move -> (${line.slice(4).replace(' ', ', ')})`);
      } else if (line.startsWith('ready ')) {
        ready = true;
        restartDelay = RESTART_MIN_MS;
        console.info(`[agent] Following the "${processName}" window: ${line.slice(6)}`);
      } else if (line.startsWith('target ')) {
        console.info(`[agent] Cursor area now: ${line.slice(7)}`);
      } else if (line.trim()) {
        console.info(`[agent] kiosk-cursor: ${line}`);
      }
    });
    readline.createInterface({ input: self.stderr }).on('line', (line) => {
      if (line.trim()) console.error(`[agent] kiosk-cursor: ${line}`);
    });

    self.on('exit', (code) => {
      if (child !== self) return;
      ready = false;
      child = null;
      settleAll();
      if (stopped) return;
      console.warn(
        `[agent] kiosk-cursor helper exited (${code}); plain nut-js until it restarts in ${restartDelay}ms.`
      );
      setTimeout(spawnHelper, restartDelay);
      restartDelay = Math.min(restartDelay * 2, RESTART_MAX_MS);
    });
  }

  function send(line) {
    if (!ready || !child || !child.stdin.writable) return false;
    child.stdin.write(`${line}\n`);
    return true;
  }

  spawnHelper();

  return {
    get ready() {
      return ready;
    },
    /** Relative move in the pad's units; the helper scales by the monitor's DPI. */
    move(dx, dy) {
      return Number.isFinite(dx) && Number.isFinite(dy) && send(`m ${dx} ${dy}`);
    },
    jiggle() {
      return send('j');
    },
    /**
     * Resolves once the cursor is inside the kiosk window (moved to its centre
     * if it was elsewhere), so a click or wheel event that follows lands on the
     * kiosk. Resolves false, never rejects, if the helper is unavailable.
     */
    ensureInside() {
      const id = String(nextId++);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(false);
        }, ENSURE_TIMEOUT_MS);
        pending.set(id, (ok) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(ok);
        });
        if (!send(`f ${id}`)) pending.get(id)?.(false);
      });
    },
    stop() {
      stopped = true;
      child?.kill();
    },
  };
}
