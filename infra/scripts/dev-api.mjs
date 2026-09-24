/**
 * Dev runner for apps/api: `tsc --watch` + a compiled Node process.
 *
 * Why not tsx (the obvious choice, and what this replaces):
 * measured on this repo, `tsx watch src/index.ts` takes ~17s to reach a
 * healthy /health, while `node dist/index.js` takes ~2.1s. The gap is not the
 * database, MQTT or Home Assistant — those all connect in under 2s combined —
 * it is tsx spending ~14s loading the TypeScript module graph before a single
 * line of application code runs. For comparison, `tsc` does strictly more work
 * (a full typecheck of the same 48 files) in 6.5s. tsx is simply pathological
 * here, and no amount of tuning changed it (watch vs no-watch made no
 * difference, and repeat runs got no cache benefit).
 *
 * Why not `concurrently "tsc --watch" "node --watch dist/index.js"`:
 * tsc emits ~48 files per rebuild and `node --watch` restarts on each one, so
 * every edit becomes a restart storm. Instead this waits for tsc to report a
 * *finished* compile and restarts exactly once, which is both correct and
 * quiet.
 *
 * Bonus over tsx: type errors now surface in the dev loop. tsx strips types
 * without checking them, so a type error only appeared at build time.
 *
 * Usage (via apps/api's `dev` script):
 *   node infra/scripts/dev-api.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const apiDir = join(repoRoot, 'apps', 'api');

// The root .env is gitignored, so a fresh clone does not have one — and
// `node --env-file` fails hard ("not found") rather than starting without it.
// Caught here so the message names the fix instead of surfacing as a child
// process dying mid-boot. See the setup steps in README.md.
const envFile = join(repoRoot, '.env');
if (!existsSync(envFile)) {
  console.error(
    '[dev-api] No .env at the repo root — the API cannot start without it.\n' +
      '          Create one from the template:  cp .env.example .env\n' +
      '          then fill in DATABASE_URL and BETTER_AUTH_SECRET (see README.md).',
  );
  process.exit(1);
}

// Resolve TypeScript's JS entry point and run it with the current Node, rather
// than the .bin shim — avoids .cmd/shell quoting differences on Windows.
const requireFromApi = createRequire(join(apiDir, 'package.json'));
const tscBin = requireFromApi.resolve('typescript/bin/tsc');

/** tsc prints this when a compile pass finishes, clean or not. */
const COMPILE_DONE = /Found (\d+) error/;

let server = null;
let restarting = false;
let pending = null;
let firstCompile = true;

/** Newest mtime under `dir` for files matching `test`, or 0 if none. */
function newestMtime(dir, test) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestMtime(full, test));
    else if (test(e.name)) {
      try { newest = Math.max(newest, statSync(full).mtimeMs); } catch { /* raced */ }
    }
  }
  return newest;
}

/**
 * Is the committed build already up to date with the sources? If so the server
 * can boot straight away (~2s) instead of waiting out tsc's first full
 * typecheck (~6.5s), which is the difference between a 10s and a 3s `pnpm dev`.
 */
function buildIsCurrent() {
  const dist = newestMtime(join(apiDir, 'dist'), (n) => n.endsWith('.js'));
  if (!dist) return false;
  const src = newestMtime(join(apiDir, 'src'), (n) => n.endsWith('.ts'));
  return src <= dist;
}

function startServer() {
  // Absolute paths on purpose: infra/scripts/free-dev-ports.mjs identifies our
  // own leftover dev servers by looking for the repo path in a process's
  // command line. With relative args this process would be invisible to it —
  // i.e. exactly the stale listener the guard exists to clean up.
  server = spawn(process.execPath, [`--env-file=${envFile}`, join(apiDir, 'dist', 'index.js')], {
    cwd: apiDir,
    stdio: 'inherit',
  });
  server.on('exit', (code, signal) => {
    // Only report a genuine crash — a restart kills it deliberately.
    if (!restarting && code !== null && code !== 0) {
      console.error(`[dev-api] server exited with code ${code}${signal ? ` (${signal})` : ''}`);
    }
  });
  startBridge();
}

let bridgeProcess = null;

function startBridge() {
  if (process.platform !== 'win32' || bridgeProcess) return;
  const bridgeScript = join(apiDir, 'audio-helper', 'bridge.mjs');
  if (!existsSync(bridgeScript)) return;
  bridgeProcess = spawn(process.execPath, [bridgeScript], {
    cwd: join(apiDir, 'audio-helper'),
    stdio: 'inherit',
  });
  bridgeProcess.on('exit', () => {
    bridgeProcess = null;
  });
}

async function stopServer() {
  if (!server) return;
  restarting = true;
  const dying = server;
  server = null;
  await new Promise((done) => {
    dying.once('exit', done);
    dying.kill();
    // Don't hang the dev loop if it refuses to go.
    setTimeout(() => { try { dying.kill('SIGKILL'); } catch {} done(); }, 3000).unref();
  });
  restarting = false;
}

/** Debounced so a burst of tsc output can't queue several restarts. */
function scheduleRestart(errorCount) {
  if (errorCount > 0) {
    console.error(`[dev-api] ${errorCount} type error(s) — keeping the previous build running`);
    return;
  }
  clearTimeout(pending);
  pending = setTimeout(async () => {
    // The very first compile only confirms what we already booted from, when
    // the build was current — don't churn the server for nothing.
    if (firstCompile) {
      firstCompile = false;
      if (server && bootedFromCurrentBuild) return;
    } else {
      console.log('[dev-api] rebuilt — restarting server');
    }
    await stopServer();
    startServer();
  }, 100);
}

// Boot the existing build right away when it is already current, so the API is
// answering while tsc does its first pass in the background. When it is stale
// we wait, rather than briefly serving yesterday's code.
const bootedFromCurrentBuild = buildIsCurrent();
if (bootedFromCurrentBuild) {
  console.log('[dev-api] build is current — starting server while tsc checks');
  startServer();
}

const tsc = spawn(process.execPath, [tscBin, '--watch', '--preserveWatchOutput', '--pretty', 'false'], {
  cwd: apiDir,
  stdio: ['ignore', 'pipe', 'inherit'],
});

let buffer = '';
tsc.stdout.setEncoding('utf8');
tsc.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const m = line.match(COMPILE_DONE);
    if (m) scheduleRestart(Number(m[1]));
  }
});

tsc.on('exit', (code) => {
  console.error(`[dev-api] tsc --watch exited (code ${code}) — stopping`);
  stopServer().finally(() => process.exit(code ?? 1));
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    // Kill both halves so nothing is left holding port 4000 (see
    // infra/scripts/free-dev-ports.mjs for why stale listeners matter here).
    try { tsc.kill(); } catch {}
    try { bridgeProcess?.kill(); } catch {}
    stopServer().finally(() => process.exit(0));
  });
}
