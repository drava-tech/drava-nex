import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import {
  getScreenContent,
  getScreenIdsByTemplateKey,
  setScreenExperience,
  getScreenWhiteboardState,
  setScreenWhiteboardState,
  getScreenBlanked,
  resetScreenToIdle,
  clearRecentContentForScreen,
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
import { IDLE_WS_CONTENT } from '@platform/types';
import type {
  CameraStatus,
  CameraStatusUpdate,
  WsServerMessage,
  WsClientMessage,
  WsCmsMessage,
  WsContent,
  BroadcastRequest,
  StreamFormat,
  AudioStatus,
  MatInventoryDisplayItem,
} from '@platform/types';
import { getCameraScreen } from '../lib/camera-map.js';
import { resolveDetectedProduct } from '../services/detection.js';
import { resolveMatInventory } from '../services/inventory.js';

// ─── Registry ─────────────────────────────────────────────────────────────────
// Per-screen WebSocket connections (one screen can have multiple tabs/devices)
const screenRegistry = new Map<string, Set<WebSocket>>();
// CMS browser clients (all admin tabs)
const cmsRegistry = new Set<WebSocket>();
// Last known content per screen — fast path for WELCOME on reconnect
const contentCache = new Map<string, WsContent>();
// In-template view state, per screen AND per content: screenId -> contentKey
// -> (SET_* command -> value). Two levels of nesting, each for its own reason:
//
//  - Per COMMAND (innermost), because a template can have independently-nested
//    state (portfolio's SET_PORTFOLIO_VIEW picks which category page is
//    active, while that category's own SET_FILM_VIEW picks which film within
//    it). A single shared slot would let the inner command silently clobber
//    the outer one, losing "how did we even get to this page".
//  - Per CONTENT, so switching a screen away to something else and back
//    RESUMES the first content where it was left instead of restarting it —
//    the "backgrounded app" behaviour (portfolio -> a PDF -> portfolio comes
//    back on the same category/film). Keeping each content's state under its
//    own key is also what makes that safe: a replay only ever reads the slot
//    for the content currently on screen, so one content's SET_* commands can
//    never leak into a different one.
//
// Replayed both to a client that joins AFTER a navigation (a freshly-opened
// CMS mirror or a reconnecting TV, via REGISTER) and to every client of a
// screen when content is pushed to it (via broadcast), so the physical TV and
// the CMS mirror always converge on the same view. In-memory only — a kiosk
// restart (freshLaunch) and an API restart both deliberately wipe it.
const viewStateCache = new Map<string, Map<string, Map<string, unknown>>>();
// How many distinct contents keep a remembered position per screen, evicted
// oldest-first. The values are tiny, so this is about bounding unbounded
// growth on a long-lived screen, not about saving meaningful memory. Kept
// comfortably above the 5 entries "Recently Opened" offers
// (getRecentContentForScreen), so nothing an operator can still see in that
// list has already had its position evicted here.
const VIEW_STATE_MEMORY_PER_SCREEN = 10;

/** Identity of a piece of content for view-state purposes — mirrors the
 * id+type pair every "did the content actually change" check already uses. */
function contentKeyOf(content: WsContent): string {
  return `${content.type}:${content.id}`;
}

/** This content's remembered SET_* commands on this screen, if any. */
function getViewState(screenId: string, content: WsContent): Map<string, unknown> | undefined {
  return viewStateCache.get(screenId)?.get(contentKeyOf(content));
}

/**
 * The slot to record this content's view state into, creating it if needed and
 * evicting the screen's least-recently-used content once past the cap. Map
 * iteration is insertion-ordered, so re-inserting on access is what keeps
 * "least recently used" accurate.
 */
function touchViewState(screenId: string, content: WsContent): Map<string, unknown> {
  let byContent = viewStateCache.get(screenId);
  if (!byContent) {
    byContent = new Map();
    viewStateCache.set(screenId, byContent);
  }

  const key = contentKeyOf(content);
  const existing = byContent.get(key);
  const slot = existing ?? new Map<string, unknown>();
  // Re-insert (delete first) so this key moves to the end = most recent.
  byContent.delete(key);
  byContent.set(key, slot);

  while (byContent.size > VIEW_STATE_MEMORY_PER_SCREEN) {
    const oldest = byContent.keys().next().value;
    if (oldest === undefined) break;
    byContent.delete(oldest);
  }
  return slot;
}
// Live whiteboard state per screen — reconstructed from SCREEN_INTERACTION
// commands via the same reducer the CMS/TV clients use, and persisted to the
// screen row on "settling" commands. Presence in this map means "active";
// unlike viewStateCache, this is deliberately NOT cleared when the last
// socket disconnects — surviving that is the whole point (a TV refresh
// closes its one socket right before/as it reconnects).
const whiteboardStateCache = new Map<string, WhiteboardSyncState>();
// screenId -> the saved whiteboard_document id a CMS operator is currently
// live-pushing there (see /whiteboards/[id]/live/[deviceId]). Lets another
// CMS tab's "Control" button (the /screens list) jump straight back into
// that same live session instead of the generic screen-control page. Set
// explicitly by that route (not derived from whiteboardStateCache above,
// which has no concept of a saved document id) and cleared on stop.
// In-memory only, same trade-off as screenTakeover below — an API restart
// drops it, so Control just falls back to the generic page until the
// operator reopens/re-pushes the board.
const screenWhiteboardDocument = new Map<string, string>();
// Full-black overlay per screen, set by an admin "Stop" action. Same
// survives-a-reconnect requirement as whiteboardStateCache: presence/value here
// is checked (and DB-backed-up) on REGISTER so a screen that reconnects while
// stopped comes back up still black, not showing its assigned content again.
const screenBlankedCache = new Map<string, boolean>();
// Tracks active camera product takeovers (screenId -> detectionLabel)
const screenTakeover = new Map<string, string>();
// Tracks the current mat-inventory takeover per screen (screenId -> detectionLabel -> count),
// the multi-item counterpart to screenTakeover above. Drives the "Object
// Recognition" experience template (see applyMatInventoryUpdate below).
const screenMatInventory = new Map<string, Record<string, number>>();
// The single current mat state, independent of which screen(s) happen to have
// the experience assigned right now. experience.templateContent in the DB is
// never the live source of truth for this template (see content.ts) — it's
// only ever the sample/default the CMS falls back to. So a screen that's
// freshly assigned "Object Recognition" (or reconnects before the next
// physical change on the mat) needs this to show current reality immediately,
// instead of stale/default content until the mat happens to change again.
let latestObjectRecognitionItems: MatInventoryDisplayItem[] | null = null;
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

// ─── Native screen agents ────────────────────────────────────────────────────
// apps/api/screen-agent/agent.mjs runs on the Windows PC that physically
// drives one screen's TV (alongside its kiosk Chrome) and registers itself
// here, keyed by screenId — unlike audioBridge there can be many of these,
// one per screen, since each screen has its own PC. A CMS tablet's
// CURSOR_CONTROL is forwarded verbatim to whichever agent is registered for
// that screenId, which then simulates the real OS-level mouse move/click/
// scroll — no video/screenshot ever flows through this map, only tiny
// control messages.
const screenAgentRegistry = new Map<string, WebSocket>();

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

/** Record (or clear, with null) which saved whiteboard is being live-pushed to a screen right now. */
export function setScreenWhiteboardDocument(screenId: string, documentId: string | null): void {
  if (documentId) screenWhiteboardDocument.set(screenId, documentId);
  else screenWhiteboardDocument.delete(screenId);
}

/** screenId -> whiteboard_document id, for every screen currently live-pushing one. */
export function getActiveWhiteboardDocuments(): Record<string, string> {
  return Object.fromEntries(screenWhiteboardDocument);
}

/**
 * Fully stop a screen's whiteboard overlay — live command, in-memory cache,
 * and DB persistence, so it neither lingers on top of freshly-assigned
 * content right now nor gets resumed on the TV's next reconnect. Called from
 * pushScreenContent() (see routes/screens.ts), so every path that changes
 * what a screen is showing — experience/media/queue assignment, queue
 * navigation, default-media changes, "reset to idle", the door-screen
 * trigger — clears a stale whiteboard the same way, instead of leaving it up
 * over content nobody meant it to cover.
 */
export function stopScreenWhiteboard(screenId: string): void {
  whiteboardStateCache.delete(screenId);
  screenWhiteboardDocument.delete(screenId);
  sendCommandToScreen(screenId, WHITEBOARD_STOP);
  setScreenWhiteboardState(screenId, null).catch((err) =>
    console.error('[gateway] Failed to clear whiteboard state for', screenId, err)
  );
}

export function broadcastActiveScreensToCms() {
  const msg = {
    type: 'ACTIVE_SCREENS_LIST',
    activeScreenIds: getConnectedScreenIds(),
  };
  broadcastToCms(msg as any);
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────
/**
 * Send a content's remembered SET_* commands to whichever sockets are given —
 * shared by the REGISTER replay (one joining socket) and by every content push
 * (all of a screen's sockets). Insertion order matters: the outer command was
 * set first, on the original navigation into the page, so it naturally
 * replays before the inner one that refines it.
 *
 * Safe to send immediately after CONTENT_UPDATE without waiting for the new
 * template to mount: clients dispatch these through dispatchReplayableEvent
 * (packages/ui/src/lib/replayable-window-event.ts), which buffers the last
 * value per event name so a listener mounting later still catches up.
 */
function sendViewStateTo(sockets: Iterable<WebSocket>, screenId: string, content: WsContent): void {
  const state = getViewState(screenId, content);
  if (!state) return;
  for (const [command, value] of state) {
    const frame = JSON.stringify({ type: 'SCREEN_COMMAND', command, value, timestamp: Date.now() });
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    }
  }
}

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
  // Restore where this content was last left off, so re-pushing something the
  // screen has shown before resumes it instead of restarting it — for the
  // physical TV and any CMS mirror alike, since both are in this same set.
  sendViewStateTo(sockets, req.screenId, req.content);
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

/**
 * Drop a screen's active product-detection takeover flag without re-fetching
 * or re-broadcasting content — the caller (an explicit CMS assignment) is
 * about to push fresh content itself. Without this, a takeover armed before
 * the assignment lingers and a subsequent PRODUCT_LOST would still treat that
 * old detection as authoritative (harmlessly, since it re-reads the DB — but
 * more importantly a screen with an active takeover shouldn't look "stuck"
 * to camera state that's no longer relevant to what the admin just chose).
 */
export function clearTakeoverFlag(screenId: string): void {
  screenTakeover.delete(screenId);
}

export async function resetScreenTakeover(screenId: string): Promise<boolean> {
  if (screenTakeover.get(screenId)) {
    screenTakeover.delete(screenId);
    const content = await getScreenContent(screenId);
    if (content) {
      contentCache.set(screenId, content);

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
        // Reverting off a detection takeover resumes the underlying content
        // where it was left, same as any other push (see broadcast).
        sendViewStateTo(sockets, screenId, content);
      }

      broadcastToCms({ type: 'SCREEN_UPDATED', screenId, content, source: 'cms' });
    }
    return true;
  }
  return false;
}

/** Push a CONTENT_UPDATE to a screen's live sockets + notify CMS watchers. */
function pushContentUpdateToScreen(screenId: string, content: WsContent): void {
  contentCache.set(screenId, content);

  const update: WsServerMessage = { type: 'CONTENT_UPDATE', screenId, content, timestamp: Date.now() };
  const frame = JSON.stringify(update);
  const sockets = screenRegistry.get(screenId);
  if (sockets) {
    for (const sock of sockets) {
      if (sock.readyState === WebSocket.OPEN) sock.send(frame);
    }
    sendViewStateTo(sockets, screenId, content);
  }

  broadcastToCms({ type: 'SCREEN_UPDATED', screenId, content, source: 'cms' });
}

/**
 * Apply a stability-confirmed product detection to the camera's screen.
 *
 * Single implementation shared by every producer: the browser detection loop
 * (PRODUCT_DETECTED over the screen WebSocket, see useServerDetection.ts) and
 * the headless relay (POST /api/internal/vision-event). Validation, the minimum
 * confidence floor and the ACTIVE-product lookup all live in
 * resolveDetectedProduct — nothing here re-implements them.
 *
 * Returns why nothing was displayed, so callers/tests can tell "rejected" from
 * "unmapped camera".
 */
export type ProductDetectionOutcome =
  | { applied: true; screenId: string; productId: string }
  | { applied: false; reason: 'NO_SCREEN' | 'INVALID_EVENT' | 'LOW_CONFIDENCE' | 'NO_MATCH' };

export async function applyProductDetection(input: {
  cameraId: string;
  label: string;
  confidence: number;
  detectedAt?: string;
}): Promise<ProductDetectionOutcome> {
  const screenId = getCameraScreen(input.cameraId);
  if (!screenId) return { applied: false, reason: 'NO_SCREEN' };

  noteCameraHeartbeat(input.cameraId);
  updateCameraStatus(input.cameraId, 'detecting', undefined, {
    confidence: input.confidence,
    label: input.label,
  });

  const res = await resolveDetectedProduct({
    cameraId: input.cameraId,
    detectionLabel: input.label,
    confidence: input.confidence,
    detectedAt: input.detectedAt,
  });

  if (!res.matched || !res.productId) {
    return { applied: false, reason: res.reason ?? 'NO_MATCH' };
  }

  const content: WsContent = {
    id: `detection-${res.productId}`,
    type: 'experience',
    source: '',
    title: res.name || input.label,
    templateKey: 'product-showcase',
    templateContent: {
      'product-showcase': { productId: res.productId },
    },
  };

  // Remember WHICH label owns the takeover — PRODUCT_LOST for a different
  // label must not clear someone else's screen.
  screenTakeover.set(screenId, input.label);

  pushContentUpdateToScreen(screenId, content);

  return { applied: true, screenId, productId: res.productId };
}

/**
 * Clear a product takeover — only the one owned by `label`. A stale PRODUCT_LOST
 * for a product that has since been superseded, or for a screen showing normal
 * assigned content, is a no-op rather than an unexpected screen change.
 */
export async function clearProductDetection(input: {
  cameraId: string;
  label: string;
}): Promise<boolean> {
  const screenId = getCameraScreen(input.cameraId);
  if (!screenId) return false;

  noteCameraHeartbeat(input.cameraId);
  updateCameraStatus(input.cameraId, 'waiting');

  if (screenTakeover.get(screenId) !== input.label) return false;
  return resetScreenTakeover(screenId);
}

/**
 * Applies a full mat-inventory snapshot (services/vision's dedicated-camera
 * OBJECT worker, via POST /api/internal/vision-event) to whichever screen the
 * camera maps to. Multi-item counterpart to applyProductDetection above —
 * this one is called from routes/internal.ts, not a screen's own WS
 * connection, since the Python service talks HTTP, not a screen socket.
 */
export async function applyMatInventoryUpdate(cameraId: string, rawItems: unknown): Promise<void> {
  const resolution = await resolveMatInventory({ cameraId, items: rawItems });
  if (!resolution.resolved) return;

  // Tracked regardless of whether any screen has this experience assigned
  // right now, so whichever screen gets assigned it next (even with the mat
  // otherwise unchanged) picks up current reality immediately — see
  // getLiveObjectRecognitionContent.
  latestObjectRecognitionItems = resolution.items;

  // Destination isn't a fixed camera->screen env mapping — it's whichever
  // screen(s) currently have the "Object Recognition" experience pushed to
  // them via the CMS (ExperiencePreviewModal's screen picker), same as any
  // other experience. Pick a different screen in the CMS and the mat feed
  // follows it there; push to none and the feed just has nowhere to go.
  const targetScreenIds = await getScreenIdsByTemplateKey('object-recognition');
  if (targetScreenIds.length === 0) return;

  const inventoryRecord: Record<string, number> = {};
  for (const item of resolution.items) inventoryRecord[item.detectionLabel] = item.count;

  for (const screenId of targetScreenIds) {
    if (resolution.items.length === 0) {
      // Empty mat — clear any active takeover and fall back to the screen's
      // assigned content, same as PRODUCT_LOST does for the single-item path.
      // If the screen has nothing else assigned, there's no fallback to
      // revert to — push an explicit empty object-recognition state instead
      // of leaving pushContentUpdateToScreen uncalled, which would otherwise
      // leave contentCache (and every future WELCOME) stuck on the last
      // nonempty inventory forever, even after the mat was actually cleared.
      if (screenMatInventory.has(screenId)) {
        screenMatInventory.delete(screenId);
        const content = await getScreenContent(screenId);
        pushContentUpdateToScreen(
          screenId,
          content ?? {
            id: `object-recognition-${screenId}`,
            type: 'experience',
            source: '',
            title: 'Object Recognition',
            templateKey: 'object-recognition',
            templateContent: { 'object-recognition': { items: [] } },
          }
        );
      }
      broadcastToCms({ type: 'INVENTORY_UPDATE', cameraId, screenId, items: [], timestamp: Date.now() });
      continue;
    }

    const content: WsContent = {
      id: `object-recognition-${screenId}`,
      type: 'experience',
      source: '',
      title: 'Object Recognition',
      templateKey: 'object-recognition',
      templateContent: { 'object-recognition': { items: resolution.items } },
    };

    screenMatInventory.set(screenId, inventoryRecord);
    pushContentUpdateToScreen(screenId, content);
    broadcastToCms({ type: 'INVENTORY_UPDATE', cameraId, screenId, items: resolution.items, timestamp: Date.now() });
  }
}

/**
 * The live mat state, wired to a specific screen's content shape — or null if
 * no detection has ever come through yet (nothing to override with). Used
 * wherever a screen's "Object Recognition" content would otherwise fall back
 * to the experience's stale/default DB row (routes/screens.ts's
 * pushScreenContent on fresh assignment; REGISTER's DB-fallback path on
 * reconnect) — real detections still win once they occur, this only fills
 * the gap before the first one after (re)assignment.
 */
export function getLiveObjectRecognitionContent(screenId: string): WsContent | null {
  if (latestObjectRecognitionItems === null) return null;
  return {
    id: `object-recognition-${screenId}`,
    type: 'experience',
    source: '',
    title: 'Object Recognition',
    templateKey: 'object-recognition',
    templateContent: { 'object-recognition': { items: latestObjectRecognitionItems } },
  };
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
    let isAudioBridge = false;
    let isScreenAgent = false;
    let agentScreenId: string | null = null;
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

          // After WELCOME, replay the CURRENT content's cached view-state
          // commands to THIS socket only, so a late joiner lands on the same
          // page/video the screen is already on.
          const replayViewState = (content: WsContent) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            sendViewStateTo([ws], sid, content);
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

          // `onResolved` receives whatever content this screen actually
          // settled on — the caller can't just assume idle, since the DB
          // lookup below is async and may well resolve to real content.
          const resolveAndSendWelcome = (onResolved?: (content: WsContent) => void) => {
            const cached = contentCache.get(sid);
            if (cached) {
              sendWelcome(cached);
              replayViewState(cached);
              replayWhiteboardState();
              replayBlankState();
              onResolved?.(cached);
            } else {
              // Cache is empty (e.g. right after an API restart, or just
              // cleared below by a fresh-launch reset). Fall back to the
              // authoritative DB so the screen syncs to current content on
              // connect instead of staying on stale page-load content.
              void getScreenContent(sid).then((dbContent) => {
                // Same DB-is-never-live-truth gap as pushScreenContent — an
                // API restart wipes this in-memory cache, so without this a
                // reconnecting object-recognition screen would show the
                // stale/default DB row until the mat next changes.
                const resolved =
                  dbContent?.templateKey === 'object-recognition'
                    ? getLiveObjectRecognitionContent(sid) ?? dbContent
                    : dbContent;
                // Nothing assigned (and no default media) — still send
                // WELCOME with the idle sentinel, same as pushScreenContent,
                // so a client that was already rendering OLD content (e.g. a
                // kiosk mid-freshLaunch-reset) actually gets told to switch
                // to idle instead of silently hearing nothing and staying
                // stuck on whatever it last rendered.
                const content = resolved ?? IDLE_WS_CONTENT;
                contentCache.set(sid, content);
                sendWelcome(content);
                if (resolved) replayViewState(resolved);
                replayWhiteboardState();
                replayBlankState();
                onResolved?.(content);
              }).catch((err) => console.error('[gateway] WELCOME lookup failed for', sid, err));
            }
          };

          if (msg.freshLaunch && !msg.preview) {
            // A real screen/kiosk process just (re)started (not a preview
            // mirror, not a mid-session reconnect after a network blip) —
            // clear this screen's stale in-memory state and reset its DB row
            // to idle before resolving WELCOME, the same idea as
            // resetScreensAndExit's boot/shutdown reset (apps/api/src/index.ts),
            // but scoped to just this one screen instead of all of them.
            // Deliberately destructive, including every remembered per-content
            // view position: reopening the kiosk app is meant to come up idle
            // with everything erased, not resume where it left off.
            contentCache.delete(sid);
            viewStateCache.delete(sid);
            whiteboardStateCache.delete(sid);
            setScreenBlankState(sid, false);
            void Promise.all([
              clearRecentContentForScreen(sid).catch((err) =>
                console.error('[gateway] clearRecentContentForScreen failed for', sid, err)
              ),
              resetScreenToIdle(sid).catch((err) =>
                console.error('[gateway] resetScreenToIdle failed for', sid, err)
              ),
            ]).finally(() => {
              // Tell the CMS what this screen ACTUALLY settled on rather than
              // assuming idle — normally that is idle (the reset above just
              // ran), but hardcoding the sentinel made every CMS tab show
              // "No content assigned" even when real content had resolved.
              resolveAndSendWelcome((content) => {
                broadcastToCms({ type: 'SCREEN_UPDATED', screenId: sid, content, source: 'screen' });
              });
            });
          } else {
            resolveAndSendWelcome();
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
          // Send current screen-agent connectivity so a freshly-opened control
          // page immediately knows which screens already have a live agent.
          for (const agentScreenIdKey of screenAgentRegistry.keys()) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'SCREEN_AGENT_STATUS',
                  screenId: agentScreenIdKey,
                  connected: true,
                } satisfies WsCmsMessage)
              );
            }
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

        case 'SCREEN_AGENT_REGISTER': {
          const expected = process.env['BROADCAST_SECRET'];
          if (!expected || msg.secret !== expected) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'SCREEN_AGENT_REGISTER_NACK', reason: 'unauthorized' } satisfies WsServerMessage));
            }
            ws.close();
            break;
          }
          // A fresh registration for the same screenId supersedes any stale one
          // (e.g. agent restart).
          const existing = screenAgentRegistry.get(msg.screenId);
          if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
            existing.close();
          }
          isScreenAgent = true;
          agentScreenId = msg.screenId;
          screenAgentRegistry.set(msg.screenId, ws);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'SCREEN_AGENT_REGISTER_ACK' } satisfies WsServerMessage));
          }
          broadcastToCms({ type: 'SCREEN_AGENT_STATUS', screenId: msg.screenId, connected: true });
          break;
        }

        // A CMS tablet's touchpad driving the OS cursor on whichever PC is
        // registered for this screenId — forwarded verbatim to that agent.
        // No caller waits on an ack, so a missing agent just drops it.
        case 'CURSOR_CONTROL': {
          const agent = screenAgentRegistry.get(msg.screenId);
          if (agent && agent.readyState === WebSocket.OPEN) {
            agent.send(
              JSON.stringify({
                type: 'CURSOR_CONTROL',
                action: msg.action,
                dx: msg.dx,
                dy: msg.dy,
                deltaY: msg.deltaY,
                deltaX: msg.deltaX,
                button: msg.button,
              } satisfies WsServerMessage)
            );
          }
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

        case 'SCREEN_INTERACTION': {
          // Cache absolute view-state interactions so late joiners can
          // converge, and so this content resumes here if the screen is
          // switched away and later switched back — recorded against the
          // content currently on screen (see viewStateCache above), one slot
          // per command name so an inner command (e.g. SET_FILM_VIEW) doesn't
          // clobber an outer one (e.g. SET_PORTFOLIO_VIEW).
          if (msg.command.startsWith('SET_')) {
            // No current content means there's nothing to attribute this
            // position to — it would be unreplayable, so drop it.
            const current = contentCache.get(msg.screenId);
            if (current) {
              touchViewState(msg.screenId, current).set(msg.command, msg.value);
            }
          }

          if (msg.command === 'RESET_STATE' || msg.command === 'RESET_VIEW') {
            const current = contentCache.get(msg.screenId);
            if (current) {
              viewStateCache.get(msg.screenId)?.delete(contentKeyOf(current));
            }
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
          void applyProductDetection({
            cameraId: msg.cameraId,
            label: msg.label,
            confidence: msg.confidence,
            detectedAt: msg.detectedAt,
          }).catch((err) =>
            console.error('[gateway] PRODUCT_DETECTED failed:', err)
          );
          break;
        }

        case 'PRODUCT_LOST': {
          void clearProductDetection({
            cameraId: msg.cameraId,
            label: msg.label,
          }).catch((err) => console.error('[gateway] PRODUCT_LOST failed:', err));
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
      if (isAudioBridge && audioBridge === ws) {
        audioBridge = null;
        // Leave audioStatusCache as last-known-good rather than resetting to
        // the generic fallback — the CMS shows stale-but-plausible numbers.
      }
      if (isScreenAgent && agentScreenId && screenAgentRegistry.get(agentScreenId) === ws) {
        screenAgentRegistry.delete(agentScreenId);
        broadcastToCms({ type: 'SCREEN_AGENT_STATUS', screenId: agentScreenId, connected: false });
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
