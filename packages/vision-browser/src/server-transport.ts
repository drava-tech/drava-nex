export interface ServerDetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ServerDetection {
  classId: number;
  label: string;
  confidence: number;
  box: ServerDetectionBox;
}

export interface ServerDetectionResponse {
  type: "detections" | "ready" | "error";
  frameId?: number;
  timestamp?: string;
  model?: { id: string; version: string; file: string };
  inference?: { provider: string; device: string; processingTimeMs: number };
  source?: { width: number; height: number };
  detections?: ServerDetection[];
  code?: string;
  message?: string;
  limits?: { maxFrameBytes: number; minFrameIntervalMs: number };
}

export class ServerDetectionClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private frameIdCounter = 0;
  private sentTimes = new Map<number, number>();
  private stats = {
    rttMs: 0,
    processingTimeMs: 0,
  };

  onMessage: (msg: ServerDetectionResponse) => void = () => {};
  onStatusChange: (status: "connecting" | "connected" | "disconnected") => void = () => {};

  constructor(private wsUrl: string) {}

  connect() {
    if (this.ws) return;

    this.onStatusChange("connecting");
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.onStatusChange("connected");
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const msg = JSON.parse(event.data) as ServerDetectionResponse;
        if (msg.type === "detections" && msg.frameId !== undefined) {
          const sentAt = this.sentTimes.get(msg.frameId);
          if (sentAt !== undefined) {
            this.stats.rttMs = performance.now() - sentAt;
            this.sentTimes.delete(msg.frameId);
          }
          if (msg.inference?.processingTimeMs !== undefined) {
            this.stats.processingTimeMs = msg.inference.processingTimeMs;
          }
        }
        this.onMessage(msg);
      } catch (e) {
        console.error("[ServerDetectionClient] error parsing response", e);
      }
    };

    ws.onclose = () => {
      this.cleanup();
      this.onStatusChange("disconnected");
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  sendFrame(blob: Blob): number {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return -1;
    
    const frameId = ++this.frameIdCounter;
    this.sentTimes.set(frameId, performance.now());

    const header = new ArrayBuffer(9);
    const view = new DataView(header);
    view.setUint8(0, 0x01);
    view.setBigUint64(1, BigInt(frameId), true);

    const finalBlob = new Blob([header, blob], { type: "application/octet-stream" });
    this.ws.send(finalBlob);

    if (this.sentTimes.size > 50) {
      const oldestKeys = Array.from(this.sentTimes.keys()).slice(0, 10);
      oldestKeys.forEach((k) => this.sentTimes.delete(k));
    }

    return frameId;
  }

  getStats() {
    return { ...this.stats };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
  }

  private cleanup() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.sentTimes.clear();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
  }
}
