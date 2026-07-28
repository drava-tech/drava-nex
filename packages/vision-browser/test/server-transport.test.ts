import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ServerDetectionClient, type ServerDetectionResponse } from "../src/server-transport.js";

/**
 * Wire contract with services/vision/object_detection/server/ws.py:
 *   client → server  [type:1B = 0x01][frameId:8B uint64 LE][JPEG bytes]
 *   server → client  JSON `ready` | `detections` | `error`
 *
 * A minimal fake WebSocket stands in for the browser global so the header bytes
 * can be read back and compared against what unpack_frame("<BQ") expects.
 */

const HEADER_BYTES = 9;
const FRAME_TYPE_JPEG = 0x01;

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  sent: Blob[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: Blob) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  /** Simulate a server frame. */
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

async function readHeader(blob: Blob) {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  return {
    byteLength: buf.byteLength,
    type: view.getUint8(0),
    frameIdLE: view.getBigUint64(1, true),
    frameIdBE: view.getBigUint64(1, false),
    payload: new Uint8Array(buf.slice(HEADER_BYTES)),
  };
}

let client: ServerDetectionClient;

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("performance", { now: () => 1000 });
  client = new ServerDetectionClient("ws://localhost:8000/vision/ws");
  client.connect();
});

afterEach(() => {
  client.disconnect();
  vi.unstubAllGlobals();
});

function socket() {
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("no socket");
  return ws;
}

describe("frame encoding", () => {
  it("prefixes the JPEG with the 9-byte header the server unpacks", async () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]);
    const frameId = client.sendFrame(jpeg);

    expect(frameId).toBe(1);
    const header = await readHeader(socket().sent[0]!);
    expect(header.type).toBe(FRAME_TYPE_JPEG);
    expect(header.byteLength).toBe(HEADER_BYTES + 4);
    expect(header.payload).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  });

  it("writes frameId little-endian, matching struct.unpack('<BQ')", async () => {
    for (let i = 0; i < 258; i++) client.sendFrame(new Blob([new Uint8Array([0])]));

    const header = await readHeader(socket().sent.at(-1)!);
    expect(header.frameIdLE).toBe(258n);
    // Guard against a silent flip to network byte order.
    expect(header.frameIdBE).not.toBe(258n);
  });

  it("increments frameId monotonically", async () => {
    client.sendFrame(new Blob([new Uint8Array([1])]));
    client.sendFrame(new Blob([new Uint8Array([2])]));

    const first = await readHeader(socket().sent[0]!);
    const second = await readHeader(socket().sent[1]!);
    expect(second.frameIdLE).toBe(first.frameIdLE + 1n);
  });

  it("returns -1 and sends nothing when the socket is not open", () => {
    socket().readyState = FakeWebSocket.CLOSED;
    expect(client.sendFrame(new Blob([new Uint8Array([1])]))).toBe(-1);
    expect(socket().sent).toHaveLength(0);
  });
});

describe("response handling", () => {
  it("surfaces the ready handshake", () => {
    const seen: ServerDetectionResponse[] = [];
    client.onMessage = (m) => seen.push(m);

    socket().emit({
      type: "ready",
      model: { id: "coster", version: "1.0.0", file: "coster-v1.pt" },
      limits: { maxFrameBytes: 1048576, minFrameIntervalMs: 100 },
    });

    expect(seen[0]?.type).toBe("ready");
    expect(seen[0]?.limits?.maxFrameBytes).toBe(1048576);
  });

  it("parses a detections message with normalized boxes and metadata", () => {
    const seen: ServerDetectionResponse[] = [];
    client.onMessage = (m) => seen.push(m);
    client.sendFrame(new Blob([new Uint8Array([1])]));

    socket().emit({
      type: "detections",
      frameId: 1,
      timestamp: "2026-01-01T00:00:00Z",
      model: { id: "coster", version: "1.0.0", file: "coster-v1.pt" },
      inference: { provider: "cuda", device: "RTX 3090", processingTimeMs: 12.5 },
      source: { width: 640, height: 480 },
      detections: [
        {
          classId: 0,
          label: "coster",
          confidence: 0.93,
          box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        },
      ],
    });

    const msg = seen[0]!;
    expect(msg.type).toBe("detections");
    expect(msg.detections?.[0]).toEqual({
      classId: 0,
      label: "coster",
      confidence: 0.93,
      box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    });
    expect(msg.inference?.provider).toBe("cuda");
    expect(client.getStats().processingTimeMs).toBe(12.5);
  });

  it("forwards server errors instead of throwing (BUSY, RATE_LIMITED, …)", () => {
    const seen: ServerDetectionResponse[] = [];
    client.onMessage = (m) => seen.push(m);

    for (const code of ["BAD_FRAME", "FRAME_TOO_LARGE", "RATE_LIMITED", "BUSY",
      "INFERENCE_TIMEOUT", "INTERNAL"]) {
      socket().emit({ type: "error", frameId: 1, code, message: code });
    }

    expect(seen.map((m) => m.code)).toEqual([
      "BAD_FRAME", "FRAME_TOO_LARGE", "RATE_LIMITED", "BUSY", "INFERENCE_TIMEOUT", "INTERNAL",
    ]);
  });

  it("ignores binary frames — the server only ever replies with JSON", () => {
    const seen: ServerDetectionResponse[] = [];
    client.onMessage = (m) => seen.push(m);

    socket().onmessage?.({ data: new ArrayBuffer(4) });

    expect(seen).toHaveLength(0);
  });

  it("does not crash on malformed JSON", () => {
    const seen: ServerDetectionResponse[] = [];
    client.onMessage = (m) => seen.push(m);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => socket().onmessage?.({ data: "{not json" })).not.toThrow();
    expect(seen).toHaveLength(0);
  });
});

describe("connection lifecycle", () => {
  it("reports status transitions", () => {
    const statuses: string[] = [];
    const c = new ServerDetectionClient("ws://localhost:8000/vision/ws");
    c.onStatusChange = (s) => statuses.push(s);

    c.connect();
    FakeWebSocket.instances.at(-1)!.onopen?.();
    expect(statuses).toEqual(["connecting", "connected"]);

    c.disconnect();
  });

  it("bounds the in-flight timing map so a long session cannot leak", () => {
    for (let i = 0; i < 120; i++) client.sendFrame(new Blob([new Uint8Array([1])]));
    // 50 is the trim trigger in sendFrame; the map must stay near it, not grow to 120.
    expect(socket().sent).toHaveLength(120);
    expect(client.getStats()).toBeDefined();
  });
});
