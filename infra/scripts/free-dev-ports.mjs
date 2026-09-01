/**
 * Frees the local dev ports before `turbo run dev` starts, but only from our
 * own leftover processes.
 *
 * Why this exists: on Windows, closing the terminal does NOT kill the tree that
 * `pnpm dev` spawns (pnpm -> turbo -> `next dev` / `tsx watch`). The children
 * outlive the shell and keep holding port 3000/4000. The next `pnpm dev` then
 * looks like it hangs or "is slow", when in fact an old server — potentially
 * days old, serving stale code — already owns the port. That exact case cost
 * real debugging time: a Next dev server was found still running from the
 * previous day.
 *
 * Ctrl+C stops dev cleanly and leaves nothing behind; this is the safety net
 * for every other way a terminal goes away (window closed, VS Code restarted,
 * machine sleep, crash).
 *
 * Safety: a process is killed ONLY when its command line points inside this
 * repo. Anything else on the port (another project, some unrelated app) is
 * reported and left completely alone — this must never become a blunt
 * "kill whatever is on port 3000".
 *
 * Run automatically by the root `dev` script. Also usable directly:
 *   node infra/scripts/free-dev-ports.mjs           # default ports
 *   node infra/scripts/free-dev-ports.mjs 3000 4000 5000
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 3000 = apps/cms (next dev -p 3000), 4000 = apps/api (matches the nginx
// api_upstream in infra/nginx/default.conf).
const DEFAULT_PORTS = [3000, 4000];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const isWindows = process.platform === 'win32';

const ports = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  : DEFAULT_PORTS;

/** Normalise a path for comparison: lowercase, forward slashes. */
const BACKSLASH = String.fromCharCode(92);
const norm = (s) => String(s ?? '').toLowerCase().split(BACKSLASH).join('/');
const repoKey = norm(repoRoot);

function sh(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** PIDs listening on `port`. */
function listenersOn(port) {
  const pids = new Set();
  if (isWindows) {
    for (const line of sh('netstat', ['-ano', '-p', 'tcp']).split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1] ?? '';
      // Match the port exactly — ":3000" must not also match ":30000".
      if (!local.endsWith(':' + port)) continue;
      const pid = Number(cols[cols.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  } else {
    for (const l of sh('lsof', ['-nP', '-tiTCP:' + port, '-sTCP:LISTEN']).split('\n')) {
      const pid = Number(l.trim());
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  }
  return [...pids];
}

/** Full command line of a pid, for the ownership check. */
function commandLine(pid) {
  if (isWindows) {
    // wmic is gone on recent Windows 11, so go through PowerShell/CIM.
    return sh('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ]).trim();
  }
  return sh('ps', ['-o', 'command=', '-p', String(pid)]).trim();
}

function killTree(pid) {
  if (isWindows) {
    // /T so the whole child tree goes, not just the parent.
    sh('taskkill', ['/PID', String(pid), '/T', '/F']);
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

let freed = 0;
let foreign = 0;

for (const port of ports) {
  for (const pid of listenersOn(port)) {
    const cmd = commandLine(pid);
    if (norm(cmd).includes(repoKey)) {
      killTree(pid);
      console.log(`free-dev-ports: port ${port} — killed leftover dev server (pid ${pid})`);
      freed++;
    } else {
      console.warn(
        `free-dev-ports: port ${port} is held by pid ${pid}, which is NOT from this repo — left alone.\n` +
          `  ${cmd || '(command line unavailable)'}`,
      );
      foreign++;
    }
  }
}

if (freed === 0 && foreign === 0) console.log('free-dev-ports: ports clear');
// Always succeed: a foreign listener is the user's call, and dev should still
// start (the dev server will report the conflict itself).
process.exit(0);
