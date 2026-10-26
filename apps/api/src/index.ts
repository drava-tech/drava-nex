// Load env FIRST — before any module that reads process.env at import time
// (@platform/db, ./lib/auth). This import MUST stay at the very top.
import './lib/load-env.js';

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAdaptorServer } from '@hono/node-server';
import { MQTTDeviceManager } from '@platform/iot';
import { db, sql, resetAllScreensToIdle } from '@platform/db';
import { productsRouter } from './routes/products.js';
import { portfolioRouter } from './routes/portfolio.js';
import { companiesRouter } from './routes/companies.js';
import { mediaRouter, uploadRouter, mediaStreamRouter, mediaFilesRouter } from './routes/media.js';
import { setupRouter } from './routes/setup.js';
import { devicesRouter } from './routes/devices.js';
import { setMqttPublisher, setMqttManager, setIrManager } from './services/devices.js';
import { setDoorLockMqttManager } from './services/home-assistant.js';
import { startCasambiIngest } from './services/casambi-ingest.js';
import { startIrIngest } from './services/ir-ingest.js';
import { startHomeAssistantIngest } from './services/home-assistant-ingest.js';
import { startGmailIngest } from './services/gmail-ingest.js';
import { startScreenUptimeSampler } from './services/screen-uptime.js';
import { screensRouter, pushScreenContent } from './routes/screens.js';
import { experiencesRouter } from './routes/experiences.js';
import { experienceTypesRouter } from './routes/experience-types.js';
import { flightSimulationRouter } from './routes/flight-simulation.js';
import { internalRouter } from './routes/internal.js';
import { voiceInternalRouter } from './routes/voice-internal.js';
import { ambientModesRouter } from './routes/ambient-modes.js';
import { usersRouter } from './routes/users.js';
import { visitorsRouter } from './routes/visitors.js';
import { createDoorEventsRouter } from './routes/door-events.js';
import { visionTriggerRouter } from './routes/vision-trigger.js';
import { greetingRouter } from './routes/greeting.js';
import { visionSnapshotRouter } from './routes/vision-snapshot.js';
import { projectsRouter } from './routes/projects.js';
import { meRouter } from './routes/me.js';
import { auth } from './lib/auth.js';
import { createGateway, getConnectedScreenIds, setScreenBlankState } from './ws/gateway.js';
import { audioRouter } from './routes/audio.js';
import { audioService } from './services/audio.js';
import { whiteboardsRouter } from './routes/whiteboards.js';
import { isGreetingEnabled } from './lib/greeting-flag.js';

const app = new Hono();

// ─── CORS ─────────────────────────────────────────────────────────────────────
const corsOrigins = process.env['CORS_ORIGIN']
  ? process.env['CORS_ORIGIN'].split(',').map(s => s.trim())
  : ['http://localhost:3000'];

app.use('*', cors({
  origin: corsOrigins,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-broadcast-secret'],
  credentials: true,
}));

// ─── Startup Guard ────────────────────────────────────────────────────────────
if (!process.env['DATABASE_URL']) {
  console.error('[FATAL] DATABASE_URL is not set.');
  process.exit(1);
}

// ─── MQTT ─────────────────────────────────────────────────────────────────────
const mqttManager = new MQTTDeviceManager(
  process.env['MQTT_BROKER_URL'] ?? 'mqtt://localhost:1883'
);
mqttManager.connect();

// Let the device-driver layer publish MQTT commands without importing the
// manager directly (avoids a circular import; see services/devices.ts).
setMqttPublisher((deviceId, command) => mqttManager.publishCommand(deviceId, command));
setMqttManager(mqttManager);
setIrManager(mqttManager);
setDoorLockMqttManager(mqttManager);
void startCasambiIngest(mqttManager);
void startIrIngest(mqttManager);
startHomeAssistantIngest();
void startGmailIngest();

// ─── Health (public) ──────────────────────────────────────────────────────────
async function buildHealthPayload() {
  let dbStatus = 'disconnected';
  try {
    await db.execute(sql`SELECT 1`);
    dbStatus = 'ok';
  } catch (err: unknown) {
    dbStatus = `error: ${(err as Error).message}`;
  }

  return {
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    api: 'ok',
    database: dbStatus,
    mqtt: mqttManager.isConnected() ? 'ok' : 'unavailable',
    timestamp: new Date().toISOString(),
  };
}

app.get('/health', async (c) => c.json(await buildHealthPayload()));
app.get('/api/health', async (c) => c.json(await buildHealthPayload()));

// ─── Routes ───────────────────────────────────────────────────────────────────
// Better Auth handles /api/auth/* (sign-in/out, session, bearer, etc.).
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
app.route('/api/auth/setup', setupRouter);

// Every domain lives in its own router. Public reads and per-route guards are
// defined inside each router; this file only composes them. Mounts are listed in
// a stable order: identity first, then resource routers alphabetically.
app.route('/api/me', meRouter);
app.route('/api/devices', devicesRouter);
app.route('/api/experiences', experiencesRouter);
app.route('/api/experience-types', experienceTypesRouter);
app.route('/api/flight-simulation', flightSimulationRouter);
app.route('/api/internal', internalRouter);
app.route('/api/greeting', greetingRouter);
app.route('/api/internal/voice', voiceInternalRouter);
app.route('/api/ambient-modes', ambientModesRouter);
app.route('/api/media', mediaRouter);
app.route('/api/media/stream', mediaStreamRouter);
app.route('/media', mediaFilesRouter);
app.route('/api/products', productsRouter);
app.route('/api/portfolio', portfolioRouter);
app.route('/api/companies', companiesRouter);
app.route('/api/projects', projectsRouter);
app.route('/api/screens', screensRouter);
app.route('/api/upload', uploadRouter);
app.route('/api/users', usersRouter);
app.route('/api/visitors', visitorsRouter);
app.route('/api/whiteboards', whiteboardsRouter);
app.route('/api/audio', audioRouter);
app.route('/audio', audioRouter);
app.route('/api/door-events', createDoorEventsRouter());
app.route('/api/vision-trigger', visionTriggerRouter);
app.route('/api/vision-snapshot', visionSnapshotRouter);

// ─── WS info ─────────────────────────────────────────────────────────────────
app.get('/ws/', (c) => c.text('WebSocket upgrade required', 426));

// ─── Bootstrap ────────────────────────────────────────────────────────────────
const PORT = Number(process.env['PORT'] ?? 4000);

const httpServer = createAdaptorServer({ fetch: app.fetch });
const wss = createGateway();

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/ws')) {
    wss.handleUpgrade(req, socket as never, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[FATAL] Port ${PORT} already in use — another API instance is running. ` +
      `Use a single 'pnpm dev'; don't also run 'pnpm --filter @platform/api dev'.`
    );
  } else {
    console.error('[FATAL] HTTP server error:', err);
  }
  process.exit(1);
});

// ─── Shutdown → reset screens to idle immediately ────────────────────────────
// The DB reset at boot (below) only takes effect once a screen reconnects —
// without this, a screen still connected when the app is closed just freezes
// on whatever it was last showing until the app comes back. Push every
// currently-connected screen to idle live, the same way an operator's
// "reset to idle" button does (setScreenBlankState + pushScreenContent),
// on top of the same DB reset so screens that are offline right now (or that
// reconnect while the app is down) pick up idle on their next connect too.
let shuttingDown = false;
async function resetScreensAndExit(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[shutdown] ${signal} received — resetting screens to idle`);
  try {
    await resetAllScreensToIdle();
    await Promise.all(
      getConnectedScreenIds().map(async (screenId) => {
        setScreenBlankState(screenId, false);
        await pushScreenContent(screenId);
      })
    );
    console.info('[shutdown] all screens reset to idle');
  } catch (err: unknown) {
    console.error('[shutdown] failed to reset screens to idle:', err);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void resetScreensAndExit('SIGINT'));
process.on('SIGTERM', () => void resetScreensAndExit('SIGTERM'));

// Every screen resets to idle on boot — see resetAllScreensToIdle. Runs
// before the server starts accepting connections so no screen can register
// over WS and get replayed stale content first. Best-effort: a failure here
// shouldn't block the whole API from starting.
// With GREETING_ENABLED the welcome screen is transient, so a stale one is
// reverted first (logged, pushed like a normal revert); the reset then clears
// everything else. With it off (the default) this is exactly the plain reset.
function resetScreensOnBoot(): Promise<void> {
  if (!isGreetingEnabled()) return resetAllScreensToIdle();
  return import('./services/greeting/index.js')
    .then(async (greeting) => {
      await greeting.restoreArmedState(); // the operator's arm/disarm choice (disarmed if unreadable)
      await greeting.revertStaleWelcomeOnStartup();
      greeting.startRetentionPurge();
    })
    .catch((err: unknown) => console.error('[startup] greeting startup failed:', err))
    .then(() => resetAllScreensToIdle());
}

resetScreensOnBoot()
  .then(() => console.info('[startup] all screens reset to idle'))
  .catch((err: unknown) => console.error('[startup] failed to reset screens to idle:', err))
  .finally(() => {
    httpServer.listen(PORT, () => {
      audioService.start();
      startScreenUptimeSampler();
      console.info('');
      console.info('┌─────────────────────────────────────────────────────────┐');
      console.info('│          @platform/api  —  CMS Platform Gateway         │');
      console.info('├─────────────────────────────────────────────────────────┤');
      console.info(`│  HTTP  →  http://localhost:${PORT}                      │`);
      console.info(`│  WS    →  ws://localhost:${PORT}/ws/                    │`);
      console.info('└─────────────────────────────────────────────────────────┘');
      console.info('');
    });
  });
