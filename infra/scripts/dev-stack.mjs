/**
 * Runs the CMS dev stack, sets the room to Pre-entry, and starts the TRAVIS voice agent next to it.
 *
 *   node infra/scripts/dev-stack.mjs [--no-travis] turbo run dev ...
 *
 * Once per launch of this script (not on the API's own auto-restarts while developing):
 * - Pre-entry: when the API and its MQTT link are up, the lights are put into the "Pre-entry"
 *   ambient mode (the colour/brightness saved in the CMS), through the same voice endpoint
 *   Travis uses. Opt out with PRE_ENTRY_ON_START=0. It never retries after the first success.
 * - Travis: starts once the API answers /health, so its first commands already reach the CMS.
 *   Travis and the CMS are independent: if Travis exits (the "goodbye" command, a crash, its
 *   window closed) the CMS keeps running and nothing restarts it. To bring it back, run
 *   `python main.py` in services/voice-agent. Only one Travis can run (agent/single_instance.py),
 *   so that is safe even if this launcher's copy is still up. When the CMS command ends
 *   (Ctrl+C, crash), Travis is stopped with it.
 *   Opt out with --no-travis or TRAVIS_AUTOSTART=0. Skipped, with a note, if the voice agent has
 *   no .venv on this machine (e.g. a server or a teammate who doesn't run Travis).
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const agentDir = join(repoRoot, 'services', 'voice-agent');
const isWindows = process.platform === 'win32';
const python = join(agentDir, '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');
const HEALTH_URL = process.env.TRAVIS_WAIT_FOR_URL ?? 'http://127.0.0.1:4000/health';
const API_ORIGIN = new URL(HEALTH_URL).origin;
const MAX_WAIT_MS = 120_000;
const EXIT_ALREADY_RUNNING = 3; // agent/single_instance.py

const args = process.argv.slice(2);
const noTravis = args[0] === '--no-travis';
const command = noTravis ? args.slice(1) : args;
if (command.length === 0) {
  console.error('usage: node infra/scripts/dev-stack.mjs [--no-travis] <command...>');
  process.exit(2);
}

const log = (msg) => console.log(`[travis] ${msg}`);
const logRoom = (msg) => console.log(`[room] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let travis = null;
let stopping = false;

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (isWindows) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
}

function pipeWithPrefix(stream, out) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) out.write(`[travis] ${line}\n`);
  });
}

/** /health as JSON, or null while the API isn't answering. */
async function health() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Wait until the API answers (and, with needMqtt, until its MQTT link is up). True if it did in time. */
async function waitForApi(what, needMqtt) {
  const began = Date.now();
  let told = false;
  for (;;) {
    const h = await health();
    if (h && (!needMqtt || h.mqtt === 'ok')) return true;
    if (stopping) return false;
    if (Date.now() - began > MAX_WAIT_MS) return false;
    if (!told) {
      told = true;
      (what === 'room' ? logRoom : log)(`waiting for the API${needMqtt ? ' and MQTT' : ''} (${HEALTH_URL})...`);
    }
    await sleep(1500);
  }
}

function envValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(join(repoRoot, '.env'), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

/** Put the lights into Pre-entry through the voice endpoint, with a few retries (lights can lag MQTT). */
async function applyPreEntry() {
  if (process.env.PRE_ENTRY_ON_START === '0') return logRoom('Pre-entry on start is off (PRE_ENTRY_ON_START=0).');
  const secret = envValue('VOICE_AGENT_SECRET');
  if (!secret) return logRoom('VOICE_AGENT_SECRET is not set in .env — leaving the lights as they are.');
  if (!(await waitForApi('room', true))) {
    if (stopping) return;
    logRoom('the API or MQTT did not come up in time — leaving the lights as they are.');
    return;
  }
  const key = randomUUID();
  for (let attempt = 1; attempt <= 3 && !stopping; attempt++) {
    try {
      const res = await fetch(`${API_ORIGIN}/api/internal/voice/device-command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-voice-secret': secret, 'x-idempotency-key': key },
        body: JSON.stringify({ action: 'ambient_mode', target: 'pre-entry' }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json().catch(() => ({}));
      const message = body?.data?.message ?? body?.error?.message ?? `HTTP ${res.status}`;
      if (res.ok && body?.success) return logRoom(message);
      logRoom(`attempt ${attempt}/3: ${message}`);
    } catch (e) {
      logRoom(`attempt ${attempt}/3: ${e.message}`);
    }
    await sleep(5000);
  }
  logRoom('could not set Pre-entry — the lights are as they were.');
}

async function startTravis() {
  if (noTravis || process.env.TRAVIS_AUTOSTART === '0') return log('autostart is off — CMS only.');
  if (!existsSync(python)) return log(`no voice-agent .venv on this machine (${python}) — CMS only.`);

  if (!(await waitForApi('travis', false)) && !stopping) {
    log(`API not answering at ${HEALTH_URL} after ${MAX_WAIT_MS / 1000}s — starting Travis anyway.`);
  }
  if (stopping) return;

  log('starting (stop with Ctrl+C or say goodbye; restart later with `python main.py` in services/voice-agent).');
  travis = spawn(python, ['-u', 'main.py'], {
    cwd: agentDir,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  pipeWithPrefix(travis.stdout, process.stdout);
  pipeWithPrefix(travis.stderr, process.stderr);
  travis.on('exit', (code) => {
    if (stopping) return;
    if (code === EXIT_ALREADY_RUNNING) log('another Travis is already running — leaving it be.');
    else log(`stopped (exit ${code}). The CMS is still running. To start Travis again: cd services/voice-agent && python main.py`);
  });
}

// Re-quote arguments that contain spaces: the shell would otherwise split them.
const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const cms = spawn(command.map(quote).join(' '), { cwd: repoRoot, stdio: 'inherit', shell: true });
applyPreEntry().catch((e) => logRoom(`could not set Pre-entry: ${e.message}`));
startTravis().catch((e) => log(`could not start: ${e.message}`));

function shutdown() {
  stopping = true;
  killTree(travis);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
cms.on('exit', (code) => {
  shutdown();
  process.exit(code ?? 0);
});
