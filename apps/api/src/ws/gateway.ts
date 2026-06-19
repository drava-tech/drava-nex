import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { WsServerMessage, WsClientMessage, WsCmsMessage, WsContent, BroadcastRequest } from '@platform/types';

// ─── Registry ─────────────────────────────────────────────────────────────────
// Per-screen WebSocket connections (one screen can have multiple tabs/devices)
const screenRegistry = new Map<string, Set<WebSocket>>();
// CMS browser clients (all admin tabs)
const cmsRegistry = new Set<WebSocket>();
// Last known content per screen — for WELCOME on reconnect
const contentCache = new Map<string, WsContent>();

// ─── Config path resolution ───────────────────────────────────────────────────
function getConfigDir(): string {
  if (process.env['CONFIG_DIR']) return process.env['CONFIG_DIR'];
  const fromApiDir = join(process.cwd(), '..', 'screens', 'public', 'config');
  if (existsSync(fromApiDir)) return fromApiDir;
  const fromRoot = join(process.cwd(), 'apps', 'screens', 'public', 'config');
  if (existsSync(fromRoot)) return fromRoot;
  throw new Error('[gateway] Cannot locate config dir. Set CONFIG_DIR env var.');
}

async function persistScreenAssignment(screenId: string, contentId: string): Promise<void> {
  try {
    const dir = getConfigDir();
    const raw = await readFile(join(dir, 'screens.json'), 'utf-8');
    const config = JSON.parse(raw) as { screens: { screenId: string; screenName: string; contentId: string }[] };
    config.screens = config.screens.map((s) =>
      s.screenId === screenId ? { ...s, contentId } : s
    );
    await writeFile(join(dir, 'screens.json'), JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[gateway] Failed to persist screen assignment:', err);
  }
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────
export function broadcast(req: BroadcastRequest): number {
  contentCache.set(req.screenId, req.content);

  const msg: WsServerMessage = {
    type: 'CONTENT_UPDATE',
    screenId: req.screenId,
    content: req.content,
    timestamp: Date.now(),
  };
  const frame = JSON.stringify(msg);

  const sockets = screenRegistry.get(req.screenId);
  if (!sockets) return 0;
  let count = 0;
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(frame);
      count++;
    }
  }
  return count;
}

export function broadcastToCms(msg: WsCmsMessage): void {
  const frame = JSON.stringify(msg);
  for (const ws of cmsRegistry) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(frame);
    }
  }
}

export function getContentCache(screenId: string): WsContent | undefined {
  return contentCache.get(screenId);
}

export function getConnectedScreenIds(): string[] {
  return Array.from(screenRegistry.keys()).filter(
    (id) => (screenRegistry.get(id)?.size ?? 0) > 0
  );
}

// ─── Gateway factory ──────────────────────────────────────────────────────────
export function createGateway(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    let registeredScreenId: string | null = null;
    let isCmsClient = false;

    ws.on('message', (raw: Buffer) => {
      let msg: WsClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsClientMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'REGISTER': {
          registeredScreenId = msg.screenId;
          if (!screenRegistry.has(msg.screenId)) {
            screenRegistry.set(msg.screenId, new Set());
          }
          screenRegistry.get(msg.screenId)!.add(ws);

          const cached = contentCache.get(msg.screenId);
          if (cached) {
            const welcome: WsServerMessage = {
              type: 'WELCOME',
              screenId: msg.screenId,
              content: cached,
            };
            ws.send(JSON.stringify(welcome));
          }
          break;
        }

        case 'CMS_REGISTER': {
          isCmsClient = true;
          cmsRegistry.add(ws);
          break;
        }

        case 'CONTENT_CHANGE_REQUEST': {
          const { screenId, content } = msg;
          contentCache.set(screenId, content);

          // Confirm to the requesting screen immediately
          const update: WsServerMessage = {
            type: 'CONTENT_UPDATE',
            screenId,
            content,
            timestamp: Date.now(),
          };
          ws.send(JSON.stringify(update));

          // Also fan out to any other connections for this screen
          const sockets = screenRegistry.get(screenId);
          if (sockets) {
            const frame = JSON.stringify(update);
            for (const sock of sockets) {
              if (sock !== ws && sock.readyState === WebSocket.OPEN) {
                sock.send(frame);
              }
            }
          }

          // Notify CMS browsers
          broadcastToCms({ type: 'SCREEN_UPDATED', screenId, content, source: 'screen' });

          // Persist assignment asynchronously
          persistScreenAssignment(screenId, content.id).catch(() => null);
          break;
        }

        case 'PONG':
          break;
      }
    });

    ws.on('close', () => {
      if (registeredScreenId) {
        screenRegistry.get(registeredScreenId)?.delete(ws);
      }
      if (isCmsClient) {
        cmsRegistry.delete(ws);
      }
    });
  });

  // Heartbeat — prune dead connections every 30s
  const heartbeat = setInterval(() => {
    const ping = JSON.stringify({ type: 'PING' } satisfies WsServerMessage);
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(ping);
    });
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}
