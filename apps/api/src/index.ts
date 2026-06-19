import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAdaptorServer } from '@hono/node-server';
import { MQTTDeviceManager } from '@platform/iot';
import { db, sql, experience, isNull } from '@platform/db';
import { asc, desc } from 'drizzle-orm';
import { requireAuth } from './middleware/auth.js';
import { createGateway, broadcast, broadcastToCms, getContentCache } from './ws/gateway.js';
import { readFile, existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BroadcastRequest } from '@platform/types';

const readFileAsync = promisify(readFile);

const app = new Hono();

// ─── CORS ─────────────────────────────────────────────────────────────────────
const corsOrigins = process.env['CORS_ORIGIN']
  ? process.env['CORS_ORIGIN'].split(',').map(s => s.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost'];

app.use('*', cors({
  origin: corsOrigins,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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

// ─── Config file helper ───────────────────────────────────────────────────────
function getConfigDir(): string {
  if (process.env['CONFIG_DIR']) return process.env['CONFIG_DIR'];
  const fromApiDir = join(process.cwd(), '..', 'screens', 'public', 'config');
  if (existsSync(fromApiDir)) return fromApiDir;
  return join(process.cwd(), 'apps', 'screens', 'public', 'config');
}

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

// ─── Protected routes ─────────────────────────────────────────────────────────
type SessionUser = { id: string; name: string; email: string; role: string };

app.get('/api/me', requireAuth, async (c) => {
  const user = c.get('user' as never) as SessionUser;
  return c.json({ user });
});

// ─── Experiences list ─────────────────────────────────────────────────────────
app.get('/api/projects', async (c) => {
  const rows = await db
    .select({ slug: experience.slug, name: experience.name, position: experience.position })
    .from(experience)
    .where(isNull(experience.deletedAt))
    .orderBy(asc(experience.position), desc(experience.createdAt));
  const verticals = rows.map((r) => ({ id: r.slug, title: r.name, position: r.position }));
  return c.json({ verticals });
});

// ─── Contents list (public — screens picker reads this) ───────────────────────
app.get('/api/contents', async (c) => {
  try {
    const raw = await readFileAsync(join(getConfigDir(), 'contents.json'), 'utf-8');
    return c.json(JSON.parse(raw));
  } catch {
    return c.json({ contents: [] });
  }
});

// ─── Screen config fallback (for WS-disconnected recovery) ───────────────────
app.get('/api/screens/:screenId/config', (c) => {
  const screenId = c.req.param('screenId');
  const content = getContentCache(screenId);
  if (!content) return c.json({ error: 'Not found' }, 404);
  return c.json({ screenId, content });
});

// ─── Internal broadcast (called by CMS Server Actions) ────────────────────────
const BROADCAST_SECRET = process.env['BROADCAST_SECRET'] ?? 'dev-secret';

app.post('/api/internal/broadcast', async (c) => {
  if (c.req.header('x-broadcast-secret') !== BROADCAST_SECRET) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const body = await c.req.json<BroadcastRequest>();
  const delivered = broadcast({ screenId: body.screenId, content: body.content, source: 'cms' });
  // Also notify CMS clients so multiple admin tabs stay in sync
  broadcastToCms({ type: 'SCREEN_UPDATED', screenId: body.screenId, content: body.content, source: 'cms' });
  return c.json({ ok: true, delivered });
});

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

httpServer.listen(PORT, () => {
  console.info('');
  console.info('┌─────────────────────────────────────────────────────────┐');
  console.info('│          @platform/api  —  CMS Platform Gateway         │');
  console.info('├─────────────────────────────────────────────────────────┤');
  console.info(`│  HTTP  →  http://localhost:${PORT}                          │`);
  console.info(`│  WS    →  ws://localhost:${PORT}/ws/                         │`);
  console.info('└─────────────────────────────────────────────────────────┘');
  console.info('');
});
