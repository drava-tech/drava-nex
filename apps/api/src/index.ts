import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

// Load environment variables from root .env if running in local dev
try {
  let currentDir = process.cwd();
  let foundEnvPath = '';
  while (true) {
    const checkPath = resolve(currentDir, '.env');
    if (existsSync(checkPath)) {
      foundEnvPath = checkPath;
      break;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  if (foundEnvPath) {
    const envContent = readFileSync(foundEnvPath, 'utf-8');
    for (const line of envContent.split(/\r?\n/)) {
      if (line.trim().startsWith('#') || !line.includes('=')) continue;
      const firstEq = line.indexOf('=');
      const key = line.slice(0, firstEq).trim();
      let val = line.slice(firstEq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  }
} catch (e) {
  console.warn('[api] Failed to load .env file:', e);
}

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAdaptorServer } from '@hono/node-server';
import { MQTTDeviceManager } from '@platform/iot';
import { db, sql, experience, isNull, listScreens, getScreenContent, listExperiences } from '@platform/db';
import { requireAuth } from './middleware/auth.js';
import { createGateway, broadcast, broadcastToCms, sendCommandToScreen, getConnectedScreenIds } from './ws/gateway.js';
import type { BroadcastRequest } from '@platform/types';

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
  const verticals = rows.map((r) => ({ id: r.slug, title: r.name, position: r.position }));
  return c.json({ verticals });
});

// ─── Experiences list (public — screens touch-picker reads this) ──────────────
app.get('/api/experiences', async (c) => {
  return c.json({ experiences: await listExperiences() });
});

// ─── Screen list (public — screens launcher reads this) ───────────────────────
app.get('/api/screens', async (c) => {
  return c.json({ screens: await listScreens() });
});

// ─── Active screens list (public) ─────────────────────────────────────────────
app.get('/api/screens/active', (c) => {
  return c.json({ activeScreenIds: getConnectedScreenIds() });
});

// ─── Screen config (DB-authoritative; used on connect/reload to sync) ─────────
app.get('/api/screens/:screenId/config', async (c) => {
  const screenId = c.req.param('screenId');
  const content = await getScreenContent(screenId);
  if (!content) return c.json({ content: null }, 404);
  return c.json({ screenId, content });
});

// ─── Internal broadcast (called by CMS Server Actions) ────────────────────────
const BROADCAST_SECRET = process.env['BROADCAST_SECRET'] || 'dev-secret';

app.post('/api/internal/broadcast', async (c) => {
  const secretHeader = c.req.header('x-broadcast-secret');
  if (secretHeader !== BROADCAST_SECRET) {
    console.warn(`[api] Broadcast rejected: secret mismatch (header: "${secretHeader ? '***' : ''}", expected: "${BROADCAST_SECRET ? '***' : ''}")`);
    return c.json({ error: 'Forbidden' }, 403);
  }
  const body = await c.req.json<BroadcastRequest>();
  const delivered = broadcast({ screenId: body.screenId, content: body.content, source: 'cms' });
  console.info(`[api] Broadcast for screen "${body.screenId}" delivered to ${delivered} clients`);
  // Also notify CMS clients so multiple admin tabs stay in sync
  broadcastToCms({ type: 'SCREEN_UPDATED', screenId: body.screenId, content: body.content, source: 'cms' });
  return c.json({ ok: true, delivered });
});

// ─── Internal screen command (called by CMS Server Actions) ───────────────────
app.post('/api/internal/command', async (c) => {
  if (c.req.header('x-broadcast-secret') !== BROADCAST_SECRET) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const body = await c.req.json<{ screenId: string; command: string; value?: any }>();
  const delivered = sendCommandToScreen(body.screenId, body.command, body.value);
  console.info(`[api] Command "${body.command}" for screen "${body.screenId}" delivered to ${delivered} clients`);
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

httpServer.listen(PORT, () => {
  console.info('');
  console.info('┌─────────────────────────────────────────────────────────┐');
  console.info('│          @platform/api  —  CMS Platform Gateway         │');
  console.info('├─────────────────────────────────────────────────────────┤');
  console.info(`│  HTTP  →  http://localhost:${PORT}                      │`);
  console.info(`│  WS    →  ws://localhost:${PORT}/ws/                    │`);
  console.info('└─────────────────────────────────────────────────────────┘');
  console.info('');
});
