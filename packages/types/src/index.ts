// Shared Types for Event-driven Digital Signage, CMS & IoT Platform

// --- Product domain (schemas + types) ---
export * from "./products.js";

// --- Portfolio domain (schemas + types) ---
export * from "./portfolio.js";

// --- Visitor domain (face-recognition entrance tracking) ---
export * from "./visitors.js";

// --- Media library → display content mapping (PDF/sheet/YouTube/Drive embeds) ---
export * from "./media-content.js";

// --- Flight Garden simulation runtime data (airport catalog + flight roster) ---
export * from "./flight-simulation.js";

// --- Experience templates (code-defined; shared by CMS UI + API validation) ---
export const TEMPLATE_KEYS = [
  "portfolio",
  "live-stream",
  "product-showcase",
  "welcome",
  "object-recognition",
  "flight-simulation",
  "gallery",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === "string" && (TEMPLATE_KEYS as readonly string[]).includes(value);
}

// --- Signage & CMS Types ---
export interface Screen {
  id: string;
  name: string;
  location?: string;
  status: 'online' | 'offline' | 'maintenance';
  lastSeenAt: Date;
  currentPlaylistId?: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface Content {
  id: string;
  title: string;
  type: 'image' | 'video' | 'html' | 'stream' | 'weather';
  url: string;
  duration: number; // in seconds
  createdAt: Date;
  updatedAt: Date;
}

export interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
}

export interface PlaylistItem {
  id: string;
  contentId: string;
  sequence: number;
  duration: number; // override duration if needed
}

export interface Schedule {
  id: string;
  playlistId: string;
  screenId?: string; // target screen (or group/tag if extended)
  startTime: Date;
  endTime: Date;
  cronExpression?: string; // recurring schedule rules
  priority: number;
}

export interface Rule {
  id: string;
  name: string;
  triggerEvent: string; // e.g. "sensor:motion_detected"
  conditions: RuleCondition[];
  actions: RuleAction[];
  isActive: boolean;
}

export interface RuleCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
  value: string | number | boolean;
}

export interface RuleAction {
  type: 'play_content' | 'set_brightness' | 'reboot' | 'trigger_alarm';
  payload: Record<string, unknown>;
}

// --- IoT & Event-driven Platform Types ---
export interface DeviceTelemetry {
  deviceId: string;
  timestamp: number;
  metrics: {
    cpuUsage?: number;
    memoryUsage?: number;
    temperature?: number;
    networkSignal?: number;
    screenOnline?: boolean;
    sensorData?: Record<string, unknown>;
  };
}

export interface IoTEvent {
  eventId: string;
  deviceId: string;
  topic: string;
  payload: unknown;
  timestamp: number;
}

export interface DeviceCommand {
  commandId: string;
  deviceId: string;
  action: string;
  payload?: Record<string, unknown>;
  sentAt: number;
}

/** Kinds of registered device the platform can address (REST: /api/devices). */
export type DeviceKind = 'light' | 'scene' | 'camera' | 'speaker' | 'ir' | 'generic';

/** Desired state for a controllable light. brightness is 0-100. */
export interface LightState {
  on: boolean;
  brightness?: number;
  color?: string;
}

/**
 * A single IR command sent to the CrabController bridge (twt/av/ir/command).
 * `device` is the bridge-side remote name (e.g. "ac", "tv"), `command` is the
 * verb (AC: power_on|power_off|set_temp|set_mode|set_fan; other remotes: a
 * codebook key name), and `params` carries verb arguments (e.g. { temp: 24 }).
 */
export interface IrCommand {
  device: string;
  command: string;
  params?: Record<string, unknown>;
}

/**
 * Last-known state of an IR air-conditioner, mirrored from the discrete commands
 * the CMS has sent (the Tuya AC "scene" carries the full state each press). Used
 * to rehydrate the Climate panel on reload. mode ∈ cool|heat|auto|fan|dry,
 * fan ∈ auto|low|mid|high.
 */
export interface IrAcState {
  power: boolean;
  temp: number;
  mode: string;
  fan: string;
}

// --- WebSocket Protocol Types ---

export type WsContentType = 'video' | 'image' | 'html' | 'stream' | 'experience';

/** Wire format the publisher EXE pushes for a live stream. */
export type StreamFormat = 'h264' | 'mjpeg';

export interface WsContent {
  id: string;
  type: WsContentType;
  source: string;
  loop?: boolean;
  muted?: boolean;
  title?: string;
  /** Code-defined template assigned to the experience (e.g. "portfolio"). */
  templateKey?: string;
  /** Per-template authored content, keyed by templateKey. */
  templateContent?: Record<string, unknown>;
}

/** Sentinel content for a screen with nothing assigned (and no default media) — renders the idle logo screen instead of playing anything. */
export const IDLE_WS_CONTENT: WsContent = {
  id: "__idle__",
  type: "image",
  source: "",
};

export interface AudioStatus {
  volume: number;
  muted: boolean;
  device: string;
}

export type CameraStatus =
  | 'online'
  | 'waiting'
  | 'detecting'
  | 'camera_unavailable'
  | 'service_offline';

export interface CameraStatusUpdate {
  cameraId: string;
  screenId: string;
  status: CameraStatus;
  timestamp: number;
  message?: string;
  /** Confidence (0-1) of the current best detection guess, if any. */
  confidence?: number;
  /** Label of the current best detection guess, if any. */
  label?: string;
}

export type WsServerMessage =
  | { type: 'WELCOME'; screenId: string; content: WsContent }
  | { type: 'CONTENT_UPDATE'; screenId: string; content: WsContent; timestamp: number }
  | { type: 'PING' }
  | { type: 'SCREEN_COMMAND'; command: string; value?: any; timestamp: number }
  | ({ type: 'CAMERA_STATUS_UPDATE' } & CameraStatusUpdate)
  // Live-stream relay: tells a subscriber whether a publisher is currently
  // pushing this stream (drives the "stream is going on" vs "waiting" state).
  | { type: 'STREAM_STATUS'; streamId: string; active: boolean; format?: StreamFormat }
  | { type: 'AUDIO_BRIDGE_REGISTER_ACK' }
  | { type: 'AUDIO_BRIDGE_REGISTER_NACK'; reason: string }
  // Sent only to the registered native audio-bridge socket (apps/api/audio-helper/bridge.mjs).
  | { type: 'AUDIO_COMMAND'; action: 'set-volume' | 'set-mute' | 'toggle-mute'; value?: number | boolean }
  // Native screen-agent relay (apps/api/screen-agent/agent.mjs) — one agent
  // registers per screenId (it runs on the Windows PC physically driving that
  // screen's TV). ACK/NACK go only to the registering socket; CURSOR_CONTROL
  // here is the gateway's relay of a CMS tablet's CURSOR_CONTROL client
  // message (below), sent only to whichever agent is registered for that
  // screenId, so it can simulate the real OS-level mouse input.
  | { type: 'SCREEN_AGENT_REGISTER_ACK' }
  | { type: 'SCREEN_AGENT_REGISTER_NACK'; reason: string }
  | {
      type: 'CURSOR_CONTROL';
      action: 'move' | 'click' | 'scroll';
      dx?: number;
      dy?: number;
      deltaY?: number;
      /** Which physical button a 'click' simulates — omitted means 'left'. */
      button?: 'left' | 'right';
    };

export type WsClientMessage =
  | { type: 'REGISTER'; screenId: string; preview?: boolean }
  | { type: 'CMS_REGISTER' }
  | { type: 'CONTENT_CHANGE_REQUEST'; screenId: string; content: WsContent }
  // A user interaction on one client (e.g. CMS control view or a touchscreen)
  // that should be applied on every client of the screen, keeping them in sync.
  | { type: 'SCREEN_INTERACTION'; screenId: string; command: string; value?: any }
  // Live-stream relay handshakes. The publisher EXE sends STREAM_PUBLISH then
  // pushes binary media frames; a viewing screen sends STREAM_SUBSCRIBE.
  | { type: 'STREAM_PUBLISH'; streamId: string; format: StreamFormat }
  | { type: 'STREAM_SUBSCRIBE'; streamId: string }
  | { type: 'STREAM_UNSUBSCRIBE'; streamId: string }
  | { type: 'PONG' }
  | { type: 'CAMERA_REGISTER'; cameraId: string; registeredAt?: string }
  | { type: 'CAMERA_HEARTBEAT'; cameraId: string; sentAt?: string }
  | { type: 'CAMERA_STATUS'; cameraId: string; status: CameraStatus; message?: string; updatedAt?: string; confidence?: number; label?: string }
  // Camera detection events
  | import('./products.js').ProductDetectedEvent
  | import('./products.js').ProductLostEvent
  // Native audio bridge (apps/api/audio-helper/bridge.mjs) registers itself.
  // Auth is a shared secret (BROADCAST_SECRET), matching the internal.ts
  // machine-to-machine trust pattern.
  | { type: 'AUDIO_BRIDGE_REGISTER'; secret: string }
  // Bridge reports current OS volume/mute/device after every change (both
  // CMS-initiated and externally-initiated, e.g. the Windows tray).
  | ({ type: 'AUDIO_BRIDGE_STATUS' } & AudioStatus)
  // Native screen-agent (apps/api/screen-agent/agent.mjs) registers itself for
  // one screenId — it runs on the Windows PC physically driving that screen's
  // TV and simulates real OS-level mouse input there, so remote control works
  // for whatever's actually on screen (a browser tab, YouTube, anything else)
  // with no app-specific plumbing. Auth mirrors AUDIO_BRIDGE_REGISTER
  // (BROADCAST_SECRET), but keyed per-screenId rather than a single global
  // connection, since each screen has its own PC.
  | { type: 'SCREEN_AGENT_REGISTER'; screenId: string; secret: string }
  // A CMS control-pad drives the OS cursor on whichever PC is registered for
  // this screenId — relative motion (dx/dy), a click at the current OS cursor
  // position (optionally 'right' for a right-click, e.g. a trackpad's right
  // button), or a scroll (deltaY). Dropped silently if no agent is
  // registered for the screen — trackpad deltas are fire-and-forget.
  | {
      type: 'CURSOR_CONTROL';
      screenId: string;
      action: 'move' | 'click' | 'scroll';
      dx?: number;
      dy?: number;
      deltaY?: number;
      button?: 'left' | 'right';
    };

export type WsCmsMessage =
  | { type: 'SCREEN_UPDATED'; screenId: string; content: WsContent; source: 'screen' | 'cms' }
  | { type: 'ACTIVE_SCREENS_LIST'; activeScreenIds: string[] }
  | { type: 'MEDIA_LIBRARY_UPDATED' }
  | ({ type: 'CAMERA_STATUS_UPDATE' } & CameraStatusUpdate)
  // Face-vision: a visitor was recognized/enrolled at an entrance camera. Drives
  // the live-updating CMS Visitors list. Emitted by services/vision via the
  // internal event relay (POST /api/internal/vision-event). `name` may be ""
  // (the CMS already has it from the initial GET /api/visitors load).
  | { type: 'VISITOR_DETECTED'; uuid: string; name: string; isNew: boolean; lastSeen: string; hasImage: boolean }
  // Full current mat contents, resolved to catalogue products. Emitted by
  // services/vision's OBJECT worker via the internal event relay (POST
  // /api/internal/vision-event) — drives live admin-facing mat-contents views.
  | { type: 'INVENTORY_UPDATE'; cameraId: string; screenId: string; items: import('./products.js').MatInventoryDisplayItem[]; timestamp: number }
  // Door lock state changed (manual toggle via the CMS) — drives the live
  // Door Lock panel. Emitted directly from apps/api/src/routes/door-events.ts.
  | { type: 'DOOR_EVENT'; id: string; lockId: string; action: 'locked' | 'unlocked'; createdAt: string; total: number }
  // System volume/mute, relayed from the native audio bridge (see WsClientMessage
  // AUDIO_BRIDGE_STATUS) — drives the live Audio tile in Environment Control.
  | ({ type: 'AUDIO_STATUS_UPDATE' } & AudioStatus)
  // A light's real-world state changed — either a CMS-initiated command was
  // applied, or the Casambi ingest service observed a change from another
  // source (wall switch, Casambi app, another user). Drives the live
  // Lighting panel in Environment Control.
  | { type: 'LIGHT_STATE_UPDATE'; deviceId: string; state: Record<string, unknown> }
  // An IR device changed — a CMS command was applied (state echoed back), or the
  // IR ingest observed the CrabController bridge going online/offline (status).
  // Drives the live Climate panel + Remotes overlay in Environment Control.
  | { type: 'IR_STATE_UPDATE'; deviceId: string; state?: Record<string, unknown>; status?: string }
  // A screen's native screen-agent (apps/api/screen-agent) connected or
  // disconnected — drives the "Agent not connected" hint on the tablet
  // touchpad (see useScreenCursorControl). Broadcast on register/disconnect,
  // and replayed for every currently-connected screenId on CMS_REGISTER.
  | { type: 'SCREEN_AGENT_STATUS'; screenId: string; connected: boolean };

export interface BroadcastRequest {
  screenId: string;
  content: WsContent;
  source?: 'screen' | 'cms';
}
