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
