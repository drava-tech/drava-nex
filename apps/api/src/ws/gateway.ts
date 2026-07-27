import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import {
  getScreenContent,
  setScreenExperience,
  getScreenWhiteboardState,
  setScreenWhiteboardState,
  getScreenBlanked,
  verifyApiKey,
  scopeSatisfies,
} from '@platform/db';
import {
  isWhiteboardCommand,
  isSettlingWhiteboardCommand,
  applyWhiteboardCommand,
  initialWhiteboardSyncState,
  WHITEBOARD_START,
  WHITEBOARD_STOP,
  WHITEBOARD_SYNC,
  type WhiteboardSyncState,
  type WhiteboardSurface,
  type WhiteboardStroke,
} from '../services/whiteboard-state.js';
import type {
  CameraStatus,
  CameraStatusUpdate,
  WsServerMessage,
  WsClientMessage,
  WsCmsMessage,
  WsUeEvent,
  WsContent,
  BroadcastRequest,
  StreamFormat,
  AudioStatus,
} from '@platform/types';
import { getCameraScreen } from '../lib/camera-map.js';
import { resolveDetectedProduct } from '../services/detection.js';

// ─── Registry ─────────────────────────────────────────────────────────────────
// Per-screen WebSocket connections (one screen can have multiple tabs/devices)
const screenRegistry = new Map<string, Set<WebSocket>>();
// CMS browser clients (all admin tabs)
const cmsRegistry = new Set<WebSocket>();
// Unreal Engine / automation clients subscribed to the platform event channel.
const ueRegistry = new Set<WebSocket>();
// Last known content per screen — fast path for WELCOME on reconnect
const contentCache = new Map<string, WsContent>();
// Last in-template view state per screen (absolute "SET_*" interaction), so a
// client that joins AFTER a navigation (e.g. a freshly-opened CMS mirror or a
// reconnecting TV) converges to the current view. Cleared when content changes.
const viewStateCache = new Map<string, { command: string; value?: unknown }>();
// Live whiteboard state per screen — reconstructed from SCREEN_INTERACTION
// commands via the same reducer the CMS/TV clients use, and persisted to the
// screen row on "settling" commands. Presence in this map means "active";
// unlike viewStateCache, this is deliberately NOT cleared when the last
// socket disconnects — surviving that is the whole point (a TV refresh
// closes its one socket right before/as it reconnects).
const whiteboardStateCache = new Map<string, WhiteboardSyncState>();
// Full-black overlay per screen, set by an admin "Stop" action. Same
// survives-a-reconnect requirement as whiteboardStateCache: presence/value here
// is checked (and DB-backed-up) on REGISTER so a screen that reconnects while
// stopped comes back up still black, not showing its assigned content again.
const screenBlankedCache = new Map<string, boolean>();
// Tracks active camera product takeovers (screenId -> detectionLabel)
const screenTakeover = new Map<string, string>();
const cameraStatusCache = new Map<string, CameraStatusUpdate>();
const cameraHeartbeatTimers = new Map<string, NodeJS.Timeout>();
const CAMERA_HEARTBEAT_TIMEOUT_MS = 15_000;

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

// ─── Native audio bridge ────────────────────────────────────────────────────────
// apps/api/audio-helper/bridge.mjs runs on the Windows host (the API container
// is Linux and can't execute the NAudio-based audio-helper.exe itself) and
// connects out to this gateway to relay volume/mute commands + status. A
// single expected connection; a fresh registration supersedes any stale one.
let audioBridge: WebSocket | null = null;
let audioStatusCache: AudioStatus = { volume: 50, muted: false, device: 'Unknown Device' };

export function sendAudioCommand(
  action: 'set-volume' | 'set-mute' | 'toggle-mute',
  value?: number | boolean
): boolean {
  if (!audioBridge || audioBridge.readyState !== WebSocket.OPEN) {
    console.warn('[gateway] Audio bridge not connected — dropping command:', action);
    return false;
  }
  audioBridge.send(JSON.stringify({ type: 'AUDIO_COMMAND', action, value } satisfies WsServerMessage));
  return true;
}

export function getAudioStatus(): AudioStatus {
  return audioStatusCache;
}

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

/** Set (or clear) a screen's full-black overlay and push the command live. */
export function setScreenBlankState(screenId: string, blanked: boolean): void {
  screenBlankedCache.set(screenId, blanked);
  sendCommandToScreen(screenId, blanked ? 'SCREEN_BLANK' : 'SCREEN_UNBLANK');
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

  // Mirror to the UE/automation event channel (no-op if no subscribers).
  emitScreenContentChanged(req.screenId, req.content);

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

/** Push a platform event to every subscribed Unreal Engine / automation client. */
export function broadcastToUe(event: WsUeEvent): void {
  if (ueRegistry.size === 0) return;
  const frame = JSON.stringify(event);
  for (const ws of ueRegistry) {
    if (ws.readyState === WebSocket.OPEN) ws.send(frame);
  }
}

/** Notify UE subscribers that a screen's content changed (mirrors CONTENT_UPDATE). */
function emitScreenContentChanged(screenId: string, content: WsContent): void {
  broadcastToUe({ type: 'SCREEN_CONTENT_CHANGED', screenId, content, timestamp: Date.now() });
}

function sendCameraStatusToScreen(screenId: string, status: CameraStatusUpdate): void {
  const sockets = screenRegistry.get(screenId);
  if (!sockets) return;
  const msg: WsServerMessage = { type: 'CAMERA_STATUS_UPDATE', ...status };
  const frame = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(frame);
  }
}

function broadcastCameraStatus(status: CameraStatusUpdate): void {
  sendCameraStatusToScreen(status.screenId, status);
  broadcastToCms({ type: 'CAMERA_STATUS_UPDATE', ...status });
}

function updateCameraStatus(
  cameraId: string,
  status: CameraStatus,
  message?: string,
  detection?: { confidence?: number; label?: string },
): CameraStatusUpdate | null {
  const screenId = getCameraScreen(cameraId);
  if (!screenId) return null;

  const next: CameraStatusUpdate = {
    cameraId,
    screenId,
    status,
    timestamp: Date.now(),
    ...(message ? { message } : {}),
    ...(detection?.confidence !== undefined ? { confidence: detection.confidence } : {}),
    ...(detection?.label !== undefined ? { label: detection.label } : {}),
  };
  cameraStatusCache.set(cameraId, next);
  broadcastCameraStatus(next);
  return next;
}

function noteCameraHeartbeat(cameraId: string): void {
  const current = cameraStatusCache.get(cameraId);
  if (!current || current.status === 'service_offline') {
    updateCameraStatus(cameraId, 'waiting');
  } else {
    cameraStatusCache.set(cameraId, { ...current, timestamp: Date.now() });
  }

  const existing = cameraHeartbeatTimers.get(cameraId);
  if (existing) clearTimeout(existing);

  const timeout = setTimeout(() => {
    updateCameraStatus(cameraId, 'service_offline', 'Camera service heartbeat stopped.');
    cameraHeartbeatTimers.delete(cameraId);
  }, CAMERA_HEARTBEAT_TIMEOUT_MS);
  cameraHeartbeatTimers.set(cameraId, timeout);
}

export function getContentCache(screenId: string): WsContent | undefined {
  return contentCache.get(screenId);
}

export async function resetScreenTakeover(screenId: string): Promise<boolean> {
  if (screenTakeover.get(screenId)) {
    screenTakeover.delete(screenId);
    const content = await getScreenContent(screenId);
    if (content) {
      contentCache.set(screenId, content);
      viewStateCache.delete(screenId);

      const update: WsServerMessage = {
        type: 'CONTENT_UPDATE',
        screenId,
        content,
        timestamp: Date.now(),
      };
      const frame = JSON.stringify(update);
      
      const sockets = screenRegistry.get(screenId);
      if (sockets) {
        for (const sock of sockets) {
          if (sock.readyState === WebSocket.OPEN) {
            sock.send(frame);
          }
        }
      }

      broadcastToCms({ type: 'SCREEN_UPDATED', screenId, content, source: 'cms' });
      emitScreenContentChanged(screenId, content);
    }
    return true;
  }
  return false;
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
    let isUeClient = false;
    let isAudioBridge = false;
    const reqUrl = _req.url ?? '';
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

          for (const status of cameraStatusCache.values()) {
            if (status.screenId === sid && ws.readyState === WebSocket.OPEN) {
              const msg: WsServerMessage = { type: 'CAMERA_STATUS_UPDATE', ...status };
              ws.send(JSON.stringify(msg));
            }
          }

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

          // If a whiteboard is live on this screen, resume it for the newly
          // (re)connected client — this is what lets a TV survive a refresh
          // mid-session instead of falling back to the assigned content.
          const sendWhiteboardState = (state: WhiteboardSyncState) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({
              type: 'SCREEN_COMMAND',
              command: WHITEBOARD_START,
              value: { surface: state.surface },
              timestamp: Date.now(),
            }));
            ws.send(JSON.stringify({
              type: 'SCREEN_COMMAND',
              command: WHITEBOARD_SYNC,
              value: { strokes: state.strokes, surface: state.surface },
              timestamp: Date.now(),
            }));
          };
          const replayWhiteboardState = () => {
            const cachedWb = whiteboardStateCache.get(sid);
            if (cachedWb) {
              sendWhiteboardState(cachedWb);
              return;
            }
            // Not in memory (e.g. right after an API restart) — fall back to DB.
            void getScreenWhiteboardState(sid)
              .then((row) => {
                if (!row?.active || !row.state) return;
                const state = row.state as { surface: WhiteboardSurface; strokes: WhiteboardStroke[] };
                const restored: WhiteboardSyncState = { strokes: state.strokes, current: null, surface: state.surface };
                whiteboardStateCache.set(sid, restored);
                sendWhiteboardState(restored);
              })
              .catch((err) => console.error('[gateway] Whiteboard state lookup failed for', sid, err));
          };

          // If the screen was stopped (blanked), resume that for the newly
          // (re)connected client — same reconnect-resilience need as the
          // whiteboard state below.
          const replayBlankState = () => {
            const cachedBlanked = screenBlankedCache.get(sid);
            if (cachedBlanked !== undefined) {
              if (cachedBlanked && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'SCREEN_COMMAND', command: 'SCREEN_BLANK', timestamp: Date.now() }));
              }
              return;
            }
            // Not in memory (e.g. right after an API restart) — fall back to DB.
            void getScreenBlanked(sid)
              .then((blanked) => {
                screenBlankedCache.set(sid, blanked);
                if (blanked && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'SCREEN_COMMAND', command: 'SCREEN_BLANK', timestamp: Date.now() }));
                }
              })
              .catch((err) => console.error('[gateway] Blanked-state lookup failed for', sid, err));
          };

          const cached = contentCache.get(sid);
          if (cached) {
            sendWelcome(cached);
            replayViewState();
            replayWhiteboardState();
            replayBlankState();
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
              replayWhiteboardState();
              replayBlankState();
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
          for (const status of cameraStatusCache.values()) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'CAMERA_STATUS_UPDATE', ...status } satisfies WsCmsMessage));
            }
          }
          // Send initial audio status (gateway owns this cache directly —
          // no import of services/audio.ts, which now depends on gateway.ts
          // for command/status relay, not the other way around).
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'AUDIO_STATUS_UPDATE', ...audioStatusCache } satisfies WsCmsMessage));
          }
          break;
        }

        case 'AUDIO_BRIDGE_REGISTER': {
          const expected = process.env['BROADCAST_SECRET'];
          if (!expected || msg.secret !== expected) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'AUDIO_BRIDGE_REGISTER_NACK', reason: 'unauthorized' } satisfies WsServerMessage));
            }
            ws.close();
            break;
          }
          // A fresh registration supersedes any stale one (e.g. bridge restart).
          if (audioBridge && audioBridge !== ws && audioBridge.readyState === WebSocket.OPEN) {
            audioBridge.close();
          }
          isAudioBridge = true;
          audioBridge = ws;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'AUDIO_BRIDGE_REGISTER_ACK' } satisfies WsServerMessage));
          }
          break;
        }

        case 'AUDIO_BRIDGE_STATUS': {
          if (!isAudioBridge) break; // ignore from any unauthenticated socket
          audioStatusCache = { volume: msg.volume, muted: msg.muted, device: msg.device };
          broadcastToCms({ type: 'AUDIO_STATUS_UPDATE', ...audioStatusCache });
          break;
        }

        case 'UE_REGISTER': {
          // Unreal Engine / automation subscribes to the event channel. Auth is an
          // API key with the "events:subscribe" scope, sent in the message or as a
          // `?apiKey=` query param on the WS URL.
          const keyFromUrl = (() => {
            try {
              return new URL(reqUrl, 'http://localhost').searchParams.get('apiKey') ?? undefined;
            } catch {
              return undefined;
            }
          })();
          const rawKey = msg.apiKey ?? keyFromUrl;
          void (async () => {
            const key = rawKey ? await verifyApiKey(rawKey) : null;
            if (!key || !scopeSatisfies(key.scopes, 'events:subscribe')) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'UE_REGISTER_NACK', reason: 'unauthorized' } satisfies WsUeEvent));
              }
              return;
            }
            isUeClient = true;
            ueRegistry.add(ws);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'UE_REGISTER_ACK' } satisfies WsUeEvent));
            }
          })();
          break;
        }

        case 'CONTENT_CHANGE_REQUEST': {
          const { screenId, content } = msg;
          contentCache.set(screenId, content);
          // New content resets the in-template view — drop any stale view state.
          viewStateCache.delete(screenId);
          // Mirror to UE/automation subscribers.
          emitScreenContentChanged(screenId, content);

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

          if (isWhiteboardCommand(msg.command)) {
            const value = msg.value as any;

            if (msg.command === WHITEBOARD_STOP) {
              whiteboardStateCache.delete(msg.screenId);
              setScreenWhiteboardState(msg.screenId, null).catch((err) =>
                console.error('[gateway] Failed to clear whiteboard state:', err)
              );
            } else {
              const next =
                msg.command === WHITEBOARD_START
                  ? initialWhiteboardSyncState((value?.surface as WhiteboardSurface) ?? 'light')
                  : applyWhiteboardCommand(
                      whiteboardStateCache.get(msg.screenId) ?? initialWhiteboardSyncState(),
                      msg.command,
                      value
                    );
              whiteboardStateCache.set(msg.screenId, next);

              if (isSettlingWhiteboardCommand(msg.command)) {
                const snapshot: { surface: WhiteboardSurface; strokes: WhiteboardStroke[] } = {
                  surface: next.surface,
                  strokes: next.strokes,
                };
                setScreenWhiteboardState(msg.screenId, snapshot).catch((err) =>
                  console.error('[gateway] Failed to persist whiteboard state:', err)
                );
              }
            }
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

        case 'CAMERA_REGISTER': {
          noteCameraHeartbeat(msg.cameraId);
          updateCameraStatus(msg.cameraId, 'waiting');
          break;
        }

        case 'CAMERA_HEARTBEAT': {
          noteCameraHeartbeat(msg.cameraId);
          break;
        }

        case 'CAMERA_STATUS': {
          noteCameraHeartbeat(msg.cameraId);
          updateCameraStatus(msg.cameraId, msg.status, msg.message, {
            confidence: msg.confidence,
            label: msg.label,
          });
          break;
        }

        case 'PRODUCT_DETECTED': {
          const screenId = getCameraScreen(msg.cameraId);
          if (!screenId) break;
          noteCameraHeartbeat(msg.cameraId);
          updateCameraStatus(msg.cameraId, 'detecting', undefined, {
            confidence: msg.confidence,
            label: msg.label,
          });

          void resolveDetectedProduct({
            cameraId: msg.cameraId,
            detectionLabel: msg.label,
            confidence: msg.confidence,
            detectedAt: msg.detectedAt,
          }).then((res) => {
            if (res.matched && res.productId) {
              const content: WsContent = {
                id: `detection-${res.productId}`,
                type: 'experience',
                source: '',
                title: res.name || msg.label,
                templateKey: 'product-showcase',
                templateContent: {
                  'product-showcase': { productId: res.productId }
                }
              };
              
              screenTakeover.set(screenId, msg.label);
              
              contentCache.set(screenId, content);
              viewStateCache.delete(screenId);

              const update: WsServerMessage = {
                type: 'CONTENT_UPDATE',
                screenId,
                content,
                timestamp: Date.now(),
              };
              const frame = JSON.stringify(update);

              const sockets = screenRegistry.get(screenId);
              if (sockets) {
                for (const sock of sockets) {
                  if (sock.readyState === WebSocket.OPEN) {
                    sock.send(frame);
                  }
                }
              }

              broadcastToCms({ type: 'SCREEN_UPDATED', screenId, content, source: 'cms' });
              emitScreenContentChanged(screenId, content);
              broadcastToUe({
                type: 'PRODUCT_DETECTED',
                cameraId: msg.cameraId,
                label: msg.label,
                confidence: msg.confidence,
                productId: res.productId,
                timestamp: Date.now(),
              });
            }
          });
          break;
        }

        case 'PRODUCT_LOST': {
          const screenId = getCameraScreen(msg.cameraId);
          if (!screenId) break;
          noteCameraHeartbeat(msg.cameraId);
          updateCameraStatus(msg.cameraId, 'waiting');

          if (screenTakeover.get(screenId) === msg.label) {
            void resetScreenTakeover(screenId);
          }
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
      if (isUeClient) {
        ueRegistry.delete(ws);
      }
      if (isAudioBridge && audioBridge === ws) {
        audioBridge = null;
        // Leave audioStatusCache as last-known-good rather than resetting to
        // the generic fallback — the CMS shows stale-but-plausible numbers.
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
