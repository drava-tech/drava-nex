// Shared Types for Event-driven Digital Signage, CMS & IoT Platform

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

export type WsServerMessage =
  | { type: 'WELCOME'; screenId: string; content: WsContent }
  | { type: 'CONTENT_UPDATE'; screenId: string; content: WsContent; timestamp: number }
  | { type: 'PING' }
  | { type: 'SCREEN_COMMAND'; command: string; value?: any; timestamp: number }
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
  | { type: 'PONG' };

export type WsCmsMessage =
  | { type: 'SCREEN_UPDATED'; screenId: string; content: WsContent; source: 'screen' | 'cms' }
  | { type: 'ACTIVE_SCREENS_LIST'; activeScreenIds: string[] };

export interface BroadcastRequest {
  screenId: string;
  content: WsContent;
  source?: 'screen' | 'cms';
}
