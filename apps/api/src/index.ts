import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { MQTTDeviceManager } from '@platform/iot';
import type { Screen, Content, Schedule } from '@platform/types';

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

// ─── Demo Data ────────────────────────────────────────────────────────────────
const DEMO_SCREENS: Screen[] = [
  {
    id: 'screen-001',
    name: 'Lobby Display',
    location: 'Main Entrance',
    status: 'online',
    lastSeenAt: new Date(),
    currentPlaylistId: 'playlist-morning',
    tags: ['lobby', 'high-traffic'],
    metadata: { resolution: '1920x1080', orientation: 'landscape' },
  },
  {
    id: 'screen-002',
    name: 'Cafeteria Board',
    location: 'Floor 2 – Cafeteria',
    status: 'online',
    lastSeenAt: new Date(),
    currentPlaylistId: 'playlist-lunch',
    tags: ['cafeteria', 'internal'],
    metadata: { resolution: '3840x2160', orientation: 'landscape' },
  },
  {
    id: 'screen-003',
    name: 'Reception Kiosk',
    location: 'Reception',
    status: 'offline',
    lastSeenAt: new Date(Date.now() - 3600_000),
    tags: ['reception', 'interactive'],
    metadata: { resolution: '1080x1920', orientation: 'portrait' },
  },
];

const DEMO_CONTENT: Content[] = [
  {
    id: 'c-001',
    title: 'Morning Welcome Banner',
    type: 'image',
    url: 'https://cdn.platform.local/images/morning-banner.jpg',
    duration: 10,
    createdAt: new Date('2025-01-15'),
    updatedAt: new Date('2025-05-20'),
  },
  {
    id: 'c-002',
    title: 'Product Showcase Reel',
    type: 'video',
    url: 'https://cdn.platform.local/videos/product-reel-q2.mp4',
    duration: 45,
    createdAt: new Date('2025-03-01'),
    updatedAt: new Date('2025-05-28'),
  },
  {
    id: 'c-003',
    title: 'Live Weather Widget',
    type: 'weather',
    url: 'https://weather.platform.local/embed',
    duration: 15,
    createdAt: new Date('2025-01-10'),
    updatedAt: new Date('2025-01-10'),
  },
];

const DEMO_SCHEDULES: Schedule[] = [
  {
    id: 'sched-001',
    playlistId: 'playlist-morning',
    screenId: 'screen-001',
    startTime: new Date('2025-06-01T08:00:00'),
    endTime: new Date('2025-06-01T12:00:00'),
    cronExpression: '0 8 * * MON-FRI',
    priority: 1,
  },
];

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
app.get('/api/screens', (c: any) => {
  return c.json({ data: DEMO_SCREENS, total: DEMO_SCREENS.length });
});

app.get('/api/content', (c) => {
  return c.json({ data: DEMO_CONTENT, total: DEMO_CONTENT.length });
});

app.get('/api/schedules', (c) => {
  return c.json({ data: DEMO_SCHEDULES, total: DEMO_SCHEDULES.length });
});

app.post('/api/rules/evaluate', async (c) => {
  return c.json({
    message: 'Rule engine evaluation entry point — placeholder',
    received: await c.req.json().catch(() => null),
  });
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
  console.info('│  GET  /api/schedules                                     │');
  console.info('│  POST /api/rules/evaluate                                │');
  console.info('└─────────────────────────────────────────────────────────┘');
  console.info('');
  console.info(`Database : connecting... (verify at http://localhost:${PORT}/health)`);
  console.info(`MQTT     : ${mqttUrl}`);
  console.info('');

  console.info('📺 Registered Screens:');
  DEMO_SCREENS.forEach((s) => {
    const icon = s.status === 'online' ? '🟢' : s.status === 'offline' ? '🔴' : '🟡';
    console.info(`   ${icon} [${s.id}] ${s.name} — ${s.location}`);
  });

  console.info('');
  console.info('📦 Content Library:');
  DEMO_CONTENT.forEach((c) => {
    console.info(`   📁 [${c.id}] "${c.title}" (${c.type}, ${c.duration}s)`);
  });

  console.info('');
  console.info('📅 Active Schedules:');
  DEMO_SCHEDULES.forEach((s) => {
    console.info(`   🗓  [${s.id}] Playlist: ${s.playlistId} → Screen: ${s.screenId ?? 'all'} | cron: ${s.cronExpression ?? 'one-time'}`);
  });
  console.info('');
});
