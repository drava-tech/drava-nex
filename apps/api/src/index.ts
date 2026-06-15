import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { MQTTDeviceManager } from '@platform/iot';
import { db, sql } from '@platform/db';
import { requireAuth } from './middleware/auth.js';

const app = new Hono();

// ─── CORS ─────────────────────────────────────────────────────────────────────
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
if (!process.env['DATABASE_URL']) {
  console.error('[FATAL] DATABASE_URL is not set.');
  process.exit(1);
}

// ─── MQTT ─────────────────────────────────────────────────────────────────────
const mqttManager = new MQTTDeviceManager(
  process.env['MQTT_BROKER_URL'] ?? 'mqtt://localhost:1883'
);
mqttManager.connect();

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

// ─── Protected placeholder ────────────────────────────────────────────────────
// Business routes (screens, content, etc.) will be added here as DB tables
// are created for them. Auth middleware is wired and ready.
type SessionUser = { id: string; name: string; email: string; role: string };

app.get('/api/me', requireAuth, async (c) => {
  const user = c.get('user' as never) as SessionUser;
  return c.json({ user });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
const PORT = Number(process.env['PORT'] ?? 4000);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.info('');
  console.info('┌─────────────────────────────────────────────────────────┐');
  console.info('│          @platform/api  —  CMS Platform Gateway         │');
  console.info('├─────────────────────────────────────────────────────────┤');
  console.info(`│  API running on  →  http://localhost:${PORT}               │`);
  console.info('├─────────────────────────────────────────────────────────┤');
  console.info('│  GET  /health         (public)                           │');
  console.info('│  GET  /api/health     (public)                           │');
  console.info('│  GET  /api/me         (requires auth)                    │');
  console.info('└─────────────────────────────────────────────────────────┘');
  console.info('');
});
