import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { getScreenContent, setScreenExperience } from '@platform/db';
import type { WsServerMessage, WsClientMessage, WsCmsMessage, WsContent, BroadcastRequest, StreamFormat } from '@platform/types';

// ─── Registry ─────────────────────────────────────────────────────────────────
// Per-screen WebSocket connections (one screen can have multiple tabs/devices)
const screenRegistry = new Map<string, Set<WebSocket>>();
// CMS browser clients (all admin tabs)
const cmsRegistry = new Set<WebSocket>();
// Last known content per screen — fast path for WELCOME on reconnect
const contentCache = new Map<string, WsContent>();
// Last in-template view state per screen (absolute "SET_*" interaction), so a
// client that joins AFTER a navigation (e.g. a freshly-opened CMS mirror or a
// reconnecting TV) converges to the current view. Cleared when content changes.
const viewStateCache = new Map<string, { command: string; value?: unknown }>();

// ─── Live-stream relay ──────────────────────────────────────────────────────────
// One publisher EXE per streamId pushes binary media frames; the gateway fans them
// out to every subscribing screen. The media never touches the DB or HTTP layer.
const streamPublishers = new Map<string, WebSocket>();
const streamSubscribers = new Map<string, Set<WebSocket>>();
// Latest decoder-init (config) + last keyframe per stream, so a late-joining screen
// can start decoding immediately instead of waiting for the next keyframe.
interface StreamCacheEntry {
  format: StreamFormat;
  config?: Buffer;
  lastKeyframe?: Buffer;
}
const streamCache = new Map<string, StreamCacheEntry>();

function broadcastStreamStatus(streamId: string, active: boolean): void {
  const subs = streamSubscribers.get(streamId);
  if (!subs) return;
  const msg: WsServerMessage = {
    type: 'STREAM_STATUS',
    streamId,
    active,
    format: streamCache.get(streamId)?.format,
  };
  const frame = JSON.stringify(msg);
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) ws.send(frame);
  }
}

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
  // New content resets the in-template view — drop any stale view state.
  viewStateCache.delete(req.screenId);

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
    let liveCount = 0; // real (non-preview) players only
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        if (!(ws as WebSocket & { isPreview?: boolean }).isPreview) liveCount++;
      } else {
        sockets.delete(ws);
      }
    }
    if (sockets.size === 0) {
      screenRegistry.delete(id);
      return false;
    }
    // Online only when at least one real player (not just CMS preview iframes) is connected.
    return liveCount > 0;
  });
}

// ─── Gateway factory ──────────────────────────────────────────────────────────
export function createGateway(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    let registeredScreenId: string | null = null;
    let isCmsClient = false;
    // Live-stream roles for this socket
    let publishingStreamId: string | null = null;
    const subscribedStreamIds = new Set<string>();

    ws.on('message', (raw: Buffer, isBinary: boolean) => {
      // Binary frames are live media from a registered publisher → relay verbatim
      // to every subscriber of that stream. Never JSON-parse these.
      if (isBinary) {
        if (!publishingStreamId) return;
        const streamId = publishingStreamId;
        const frameType = raw.length > 0 ? raw.readUInt8(0) : 2;
        const entry = streamCache.get(streamId);
        if (entry) {
          if (frameType === 0) entry.config = Buffer.from(raw);
          else if (frameType === 1) entry.lastKeyframe = Buffer.from(raw);
        }
        const subs = streamSubscribers.get(streamId);
        if (subs) {
          for (const sub of subs) {
            if (sub.readyState === WebSocket.OPEN) sub.send(raw, { binary: true });
          }
        }
        return;
      }

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
          // Preview clients (CMS embeds) get content + commands like any client,
          // but must NOT count as a live screen for online/offline status.
          if (msg.preview) (ws as WebSocket & { isPreview?: boolean }).isPreview = true;
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

          // After WELCOME, replay the screen's current in-template view state to
          // THIS socket only, so a late joiner lands on the same page/video.
          const replayViewState = () => {
            const vs = viewStateCache.get(sid);
            if (!vs || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({
              type: 'SCREEN_COMMAND',
              command: vs.command,
              value: vs.value,
              timestamp: Date.now(),
            }));
          };

          const cached = contentCache.get(sid);
          if (cached) {
            sendWelcome(cached);
            replayViewState();
          } else {
            // Cache is empty (e.g. right after an API restart). Fall back to the
            // authoritative DB so the screen syncs to current content on connect
            // instead of staying on stale page-load content.
            void getScreenContent(sid).then((content) => {
              if (content) {
                contentCache.set(sid, content);
                sendWelcome(content);
                replayViewState();
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
          // New content resets the in-template view — drop any stale view state.
          viewStateCache.delete(screenId);

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

        case 'SCREEN_INTERACTION': {
          // Cache absolute view-state interactions so late joiners can converge.
          if (msg.command.startsWith('SET_')) {
            viewStateCache.set(msg.screenId, { command: msg.command, value: msg.value });
          }
          // Relay an interaction from one client to every client of the screen
          // (including the sender) so all instances apply it identically.
          sendCommandToScreen(msg.screenId, msg.command, msg.value);
          break;
        }

        case 'STREAM_PUBLISH': {
          // This socket becomes the publisher (EXE) for the stream.
          publishingStreamId = msg.streamId;
          streamPublishers.set(msg.streamId, ws);
          streamCache.set(msg.streamId, { format: msg.format });
          broadcastStreamStatus(msg.streamId, true);
          break;
        }

        case 'STREAM_SUBSCRIBE': {
          const { streamId } = msg;
          if (!streamSubscribers.has(streamId)) streamSubscribers.set(streamId, new Set());
          streamSubscribers.get(streamId)!.add(ws);
          subscribedStreamIds.add(streamId);

          const entry = streamCache.get(streamId);
          const status: WsServerMessage = {
            type: 'STREAM_STATUS',
            streamId,
            active: streamPublishers.has(streamId),
            format: entry?.format,
          };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(status));
            // Bootstrap a late joiner: replay decoder init + last keyframe.
            if (entry?.config) ws.send(entry.config, { binary: true });
            if (entry?.lastKeyframe) ws.send(entry.lastKeyframe, { binary: true });
          }
          break;
        }

        case 'STREAM_UNSUBSCRIBE': {
          const subs = streamSubscribers.get(msg.streamId);
          if (subs) {
            subs.delete(ws);
            if (subs.size === 0) streamSubscribers.delete(msg.streamId);
          }
          subscribedStreamIds.delete(msg.streamId);
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
            // No clients left for this screen — forget its view state so a
            // returning screen starts from its content's default view.
            viewStateCache.delete(registeredScreenId);
          }
        }
        broadcastActiveScreensToCms();
      }
      if (isCmsClient) {
        cmsRegistry.delete(ws);
      }
      // Publisher gone → drop its cache and tell subscribers the stream stopped.
      if (publishingStreamId && streamPublishers.get(publishingStreamId) === ws) {
        const stoppedId = publishingStreamId;
        streamPublishers.delete(stoppedId);
        streamCache.delete(stoppedId);
        broadcastStreamStatus(stoppedId, false);
      }
      // Subscriber gone → remove from each stream it was watching.
      for (const sid of subscribedStreamIds) {
        const subs = streamSubscribers.get(sid);
        if (subs) {
          subs.delete(ws);
          if (subs.size === 0) streamSubscribers.delete(sid);
        }
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
