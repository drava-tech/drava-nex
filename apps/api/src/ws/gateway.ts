import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { getScreenContent, setScreenExperience } from '@platform/db';
import type { WsServerMessage, WsClientMessage, WsCmsMessage, WsContent, BroadcastRequest } from '@platform/types';

// ─── Registry ─────────────────────────────────────────────────────────────────
// Per-screen WebSocket connections (one screen can have multiple tabs/devices)
const screenRegistry = new Map<string, Set<WebSocket>>();
// CMS browser clients (all admin tabs)
const cmsRegistry = new Set<WebSocket>();
// Last known content per screen — fast path for WELCOME on reconnect
const contentCache = new Map<string, WsContent>();

export function sendCommandToScreen(screenId: string, command: string, value?: any): number {
  const msg = {
    type: 'SCREEN_COMMAND',
    command,
    value,
    timestamp: Date.now(),
  };
  const frame = JSON.stringify(msg);

  const sockets = screenRegistry.get(screenId);
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

export function broadcastActiveScreensToCms() {
  const msg = {
    type: 'ACTIVE_SCREENS_LIST',
    activeScreenIds: getConnectedScreenIds(),
  };
  broadcastToCms(msg as any);
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
  return Array.from(screenRegistry.keys()).filter((id) => {
    const sockets = screenRegistry.get(id);
    if (!sockets) return false;
    let activeCount = 0;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        activeCount++;
      } else {
        sockets.delete(ws);
      }
    }
    if (activeCount === 0) {
      screenRegistry.delete(id);
      return false;
    }
    return true;
  });
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
          const sid = msg.screenId;
          registeredScreenId = sid;
          if (!screenRegistry.has(sid)) {
            screenRegistry.set(sid, new Set());
          }
          screenRegistry.get(sid)!.add(ws);
          broadcastActiveScreensToCms();

          const sendWelcome = (content: WsContent) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const welcome: WsServerMessage = { type: 'WELCOME', screenId: sid, content };
            ws.send(JSON.stringify(welcome));
          };

          const cached = contentCache.get(sid);
          if (cached) {
            sendWelcome(cached);
          } else {
            // Cache is empty (e.g. right after an API restart). Fall back to the
            // authoritative DB so the screen syncs to current content on connect
            // instead of staying on stale page-load content.
            void getScreenContent(sid).then((content) => {
              if (content) {
                contentCache.set(sid, content);
                sendWelcome(content);
              }
            }).catch((err) => console.error('[gateway] WELCOME lookup failed for', sid, err));
          }
          break;
        }

        case 'CMS_REGISTER': {
          isCmsClient = true;
          cmsRegistry.add(ws);
          // Send initial active screens list on registration
          const welcomeMsg = {
            type: 'ACTIVE_SCREENS_LIST',
            activeScreenIds: getConnectedScreenIds(),
          };
          ws.send(JSON.stringify(welcomeMsg));
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

          // Persist assignment asynchronously (content.id is the experience id)
          setScreenExperience(screenId, content.id).catch((err) =>
            console.error('[gateway] Failed to persist screen assignment:', err)
          );
          break;
        }

        case 'PONG':
          break;
      }
    });

    ws.on('close', () => {
      if (registeredScreenId) {
        const sockets = screenRegistry.get(registeredScreenId);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) {
            screenRegistry.delete(registeredScreenId);
          }
        }
        broadcastActiveScreensToCms();
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
