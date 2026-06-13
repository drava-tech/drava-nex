import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { MQTTDeviceManager } from '@platform/iot';

import { db, sql } from '@platform/db';

const app = new Hono();

// ─── Middleware ───────────────────────────────────────────────────────────────
// CORS_ORIGIN in .env: comma-separated list, e.g. "http://192.168.1.100,http://localhost"
const corsOrigins = process.env['CORS_ORIGIN']
  ? process.env['CORS_ORIGIN'].split(',').map(s => s.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost'];

app.use('*', cors({
  origin: corsOrigins,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ─── Startup Guard ────────────────────────────────────────────────────────────
// packages/db loads DATABASE_URL from root .env if not already in process.env.
// If it's still unset after that, fail fast with a clear message.
if (!process.env['DATABASE_URL']) {
  console.error('[FATAL] DATABASE_URL is not set. Add it to your root .env file and restart.');
  process.exit(1);
}

// ─── MQTT Setup ───────────────────────────────────────────────────────────────
const mqttManager = new MQTTDeviceManager(
  process.env['MQTT_BROKER_URL'] ?? 'mqtt://localhost:1883'
);
mqttManager.connect();

// ─── Health ───────────────────────────────────────────────────────────────────
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
app.get('/api/screens', async (c) => {
  const data = await db.query.screens.findMany();
  return c.json({ data, total: data.length });
});

app.get('/api/content', async (c) => {
  const data = await db.query.contents.findMany({
    where: (contents, { eq }) => eq(contents.active, true),
  });
  return c.json({ data, total: data.length });
});

app.post('/api/rules/evaluate', async (c) => {
  const body = await c.req.json().catch(() => null);
  const rules = await db.query.rules.findMany({
    where: (rules, { eq }) => eq(rules.enabled, true),
  });
  return c.json({ matched: [], evaluated: rules.length, trigger: body });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
const PORT = Number(process.env['PORT'] ?? 4000);
const mqttUrl = process.env['MQTT_BROKER_URL'] ?? 'mqtt://localhost:1883';

serve({ fetch: app.fetch, port: PORT }, () => {
  console.info('');
  console.info('┌─────────────────────────────────────────────────────────┐');
  console.info('│          @platform/api  —  CMS Platform Gateway         │');
  console.info('├─────────────────────────────────────────────────────────┤');
  console.info(`│  API running on  →  http://localhost:${PORT}               │`);
  console.info(`│  MQTT            →  ${mqttUrl}`);
  console.info(`│  WebSocket       →  ws://localhost:${PORT}/ws`);
  console.info('├─────────────────────────────────────────────────────────┤');
  console.info('│  GET  /health         (alias for /api/health)            │');
  console.info('│  GET  /api/health                                        │');
  console.info('│  GET  /api/screens                                       │');
  console.info('│  GET  /api/content                                       │');
  console.info('│  POST /api/rules/evaluate                                │');
  console.info('└─────────────────────────────────────────────────────────┘');
  console.info('');
  console.info(`Database : connecting... (verify at http://localhost:${PORT}/health)`);
  console.info(`MQTT     : ${mqttUrl}`);
  console.info('');
});
