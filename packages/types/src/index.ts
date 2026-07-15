// Shared Types for Event-driven Digital Signage, CMS & IoT Platform

// --- Product domain (schemas + types) ---
export * from "./products.js";

// --- Visitor domain (face-recognition entrance tracking) ---
export * from "./visitors.js";

// --- Experience templates (code-defined; shared by CMS UI + API validation) ---
export const TEMPLATE_KEYS = ["portfolio", "live-stream", "product-showcase"] as const;
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
export type DeviceKind = 'light' | 'scene' | 'camera' | 'speaker' | 'generic';

/** Desired state for a controllable light. brightness is 0-100. */
export interface LightState {
  on: boolean;
  brightness?: number;
  color?: string;
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
  | { type: 'STREAM_STATUS'; streamId: string; active: boolean; format?: StreamFormat };

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
  // Unreal Engine / external automation subscribes to the event channel. Auth is
  // an API key, sent here or as a `?apiKey=` query param on the WS URL.
  | { type: 'UE_REGISTER'; apiKey?: string }
  // Camera detection events
  | import('./products.js').ProductDetectedEvent
  | import('./products.js').ProductLostEvent;

/**
 * Events the gateway pushes to subscribed Unreal Engine / automation clients
 * (see WsClientMessage 'UE_REGISTER'). A superset is intentional: UE can ignore
 * event types it doesn't care about.
 */
export type WsUeEvent =
  | { type: 'UE_REGISTER_ACK' }
  | { type: 'UE_REGISTER_NACK'; reason: string }
  | { type: 'LIGHT_STATE_CHANGED'; deviceId: string; state: Record<string, unknown>; timestamp: number }
  | { type: 'DEVICE_STATUS_CHANGED'; deviceId: string; status: string; timestamp: number }
  | { type: 'SCREEN_CONTENT_CHANGED'; screenId: string; content: WsContent; timestamp: number }
  | { type: 'PRODUCT_DETECTED'; cameraId: string; label: string; confidence: number; productId?: string; timestamp: number };

export type WsCmsMessage =
  | { type: 'SCREEN_UPDATED'; screenId: string; content: WsContent; source: 'screen' | 'cms' }
  | { type: 'ACTIVE_SCREENS_LIST'; activeScreenIds: string[] }
  | ({ type: 'CAMERA_STATUS_UPDATE' } & CameraStatusUpdate);

export interface BroadcastRequest {
  screenId: string;
  content: WsContent;
  source?: 'screen' | 'cms';
}
