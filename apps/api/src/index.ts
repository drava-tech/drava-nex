// Load env FIRST — before any module that reads process.env at import time
// (@platform/db, ./lib/auth). This import MUST stay at the very top.
import './lib/load-env.js';

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAdaptorServer } from '@hono/node-server';
import { MQTTDeviceManager } from '@platform/iot';
import { db, sql } from '@platform/db';
import { productsRouter } from './routes/products.js';
import { portfolioRouter } from './routes/portfolio.js';
import { companiesRouter } from './routes/companies.js';
import { mediaRouter, uploadRouter, mediaStreamRouter, mediaFilesRouter } from './routes/media.js';
import { setupRouter } from './routes/setup.js';
import { devicesRouter } from './routes/devices.js';
import { setMqttPublisher, setMqttManager, setIrManager } from './services/devices.js';
import { startCasambiIngest } from './services/casambi-ingest.js';
import { startIrIngest } from './services/ir-ingest.js';
import { startHomeAssistantIngest } from './services/home-assistant-ingest.js';
import { startGmailIngest } from './services/gmail-ingest.js';
import { startScreenUptimeSampler } from './services/screen-uptime.js';
import { screensRouter } from './routes/screens.js';
import { experiencesRouter } from './routes/experiences.js';
import { experienceTypesRouter } from './routes/experience-types.js';
import { flightSimulationRouter } from './routes/flight-simulation.js';
import { dravaMosaicRouter } from './routes/drava-mosaic.js';
import { internalRouter } from './routes/internal.js';
import { usersRouter } from './routes/users.js';
import { visitorsRouter } from './routes/visitors.js';
import { createDoorEventsRouter } from './routes/door-events.js';
import { visionTriggerRouter } from './routes/vision-trigger.js';
import { visionSnapshotRouter } from './routes/vision-snapshot.js';
import { projectsRouter } from './routes/projects.js';
import { meRouter } from './routes/me.js';
import { auth } from './lib/auth.js';
import { createGateway } from './ws/gateway.js';
import { audioRouter } from './routes/audio.js';
import { audioService } from './services/audio.js';
import { whiteboardsRouter } from './routes/whiteboards.js';
import { ambientModesRouter } from './routes/ambient-modes.js';

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
// Setup endpoint for first admin (must be before the catch-all auth handler)
app.route('/api/auth/setup', setupRouter);
// Better Auth handles /api/auth/* (sign-in/out, session, bearer, etc.).
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// Every domain lives in its own router. Public reads and per-route guards are
// defined inside each router; this file only composes them. Mounts are listed in
// a stable order: identity first, then resource routers alphabetically.
app.route('/api/me', meRouter);
app.route('/api/devices', devicesRouter);
app.route('/api/experiences', experiencesRouter);
app.route('/api/experience-types', experienceTypesRouter);
app.route('/api/flight-simulation', flightSimulationRouter);
app.route('/api/drava-mosaic', dravaMosaicRouter);
app.route('/api/internal', internalRouter);
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
app.route('/api/door-events', createDoorEventsRouter(mqttManager));
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

// ─── Crash containment ───────────────────────────────────────────────────────
// Without these, ANY stray async throw anywhere in the process is fatal — and
// because a restarting API used to reset every screen to idle, a single bad
// HTTP response blanked every screen in the building. That is not theoretical:
// an aborted media range request threw ERR_INVALID_STATE from inside a
// microtask 46 times in one day (see fileWebStream in routes/media.ts), taking
// the API down 25 times and interrupting a live presentation.
//
// Log and keep serving, deliberately. The textbook argument for exiting on an
// uncaught exception is that process state may be corrupt; weighed against
// every screen in an office going dark, staying up is the better failure mode
// for this workload. These are logged loudly so they stay visible rather than
// silently accumulating — a hit here is still a bug to fix.
process.on('uncaughtException', (err: Error) => {
  console.error('[fatal] uncaught exception (staying up):', err);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[fatal] unhandled rejection (staying up):', reason);
});

// ─── Shutdown ────────────────────────────────────────────────────────────────
// Screens are deliberately NOT reset to idle here any more. This used to wipe
// every screen's assignment on the way down and again on the way up, so an
// unattended crash-restart blanked the whole fleet. The database is the source
// of truth and each screen re-syncs from it on reconnect (the gateway resolves
// content on REGISTER, and LiveScreenPlayer re-fetches /api/screens/:id/config
// whenever its socket reconnects), so a restart now costs a brief reconnect
// instead of everyone's content.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[shutdown] ${signal} received — closing`);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Screens are NOT reset to idle on boot any more — see the shutdown comment
// above. Each screen re-resolves its own content from the database when it
// registers, so a restart restores what was playing instead of blanking it.
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
