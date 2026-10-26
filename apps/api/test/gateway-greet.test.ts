import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("@platform/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@platform/db")>();
  return {
    ...actual,
    getScreenContent: vi.fn().mockResolvedValue(null),
    resetScreenToIdle: vi.fn().mockResolvedValue(undefined),
    clearRecentContentForScreen: vi.fn().mockResolvedValue(undefined),
    setScreenExperience: vi.fn().mockResolvedValue(undefined),
    getScreenWhiteboardState: vi.fn().mockResolvedValue(null),
    setScreenWhiteboardState: vi.fn().mockResolvedValue(undefined),
    getScreenBlanked: vi.fn().mockResolvedValue(false),
  };
});

import { createGateway, sendCommandToScreen, getConnectedScreenIds } from "../src/ws/gateway.js";
import { getLastGreetAck, resetGreetAckForTests } from "../src/lib/greet-ack.js";

class MockWebSocket extends EventEmitter {
  readyState = 1; // OPEN
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.emit("close");
  }
  frames() {
    return this.sent.map((s) => JSON.parse(s) as { type: string; command?: string; value?: unknown });
  }
}

const settle = () => new Promise((r) => setTimeout(r, 40));

function connect(wss: ReturnType<typeof createGateway>, screenId: string, opts: { preview?: boolean; freshLaunch?: boolean } = {}) {
  const ws = new MockWebSocket();
  wss.emit("connection", ws as never, {} as never);
  ws.emit("message", JSON.stringify({ type: "REGISTER", screenId, preview: !!opts.preview, freshLaunch: !!opts.freshLaunch }));
  return ws;
}

let infoSpy: ReturnType<typeof vi.spyOn>;
const quiet = () => {
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
  resetGreetAckForTests();
};
const unquiet = () => infoSpy.mockRestore(); // NOT vi.restoreAllMocks(): that would wipe the db mocks above

describe("GREET through the gateway", () => {
  beforeEach(quiet);
  afterEach(unquiet);

  it("is delivered live to every connected socket of the screen", async () => {
    const wss = createGateway();
    const tv = connect(wss, "greet-live");
    const mirror = connect(wss, "greet-live", { preview: true });
    await settle();

    const delivered = sendCommandToScreen("greet-live", "GREET", { text: "Good morning. Welcome.", speak: true });

    expect(delivered).toBe(2);
    for (const ws of [tv, mirror]) {
      expect(ws.frames().find((f) => f.command === "GREET")?.value).toEqual({ text: "Good morning. Welcome.", speak: true });
    }
  });

  it("is NEVER replayed to a screen that connects later", async () => {
    const wss = createGateway();
    connect(wss, "greet-replay");
    await settle();
    sendCommandToScreen("greet-replay", "GREET", { text: "Good morning. Welcome.", speak: true });

    // the TV reconnects (not a fresh launch), and a second TV joins
    const reconnected = connect(wss, "greet-replay", { freshLaunch: false });
    const second = connect(wss, "greet-replay");
    await settle();

    for (const ws of [reconnected, second]) {
      expect(ws.frames().some((f) => f.command === "GREET")).toBe(false);
      expect(ws.frames().some((f) => f.type === "WELCOME")).toBe(true); // it still gets its normal handshake
    }
  });

  it("is not replayed after a fresh launch either", async () => {
    const wss = createGateway();
    connect(wss, "greet-fresh");
    await settle();
    sendCommandToScreen("greet-fresh", "GREET", { text: "Good morning. Welcome.", speak: true });

    const rebooted = connect(wss, "greet-fresh", { freshLaunch: true });
    await settle();
    expect(rebooted.frames().some((f) => f.command === "GREET")).toBe(false);
  });

  it("does not reach another screen", async () => {
    const wss = createGateway();
    const other = connect(wss, "greet-other");
    await settle();
    expect(sendCommandToScreen("greet-elsewhere", "GREET", { text: "x", speak: true })).toBe(0);
    expect(other.frames().some((f) => f.command === "GREET")).toBe(false);
  });

  it("the gateway keeps no GREET state of its own (source check)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../src/ws/gateway.ts", import.meta.url), "utf8");
    // The gateway may handle the ack the TV sends back, but must never reference the GREET command
    // itself (no GREET_COMMAND, no 'GREET' string): that is what would let something cache or replay it.
    const mentions = source.split("\n").filter((l) => /GREET_COMMAND|['"`]GREET['"`]/.test(l));
    expect(mentions).toEqual([]);
  });
});

describe("GREET_ACK from the TV", () => {
  beforeEach(quiet);
  afterEach(unquiet);

  it("is recorded when a real TV reports that it spoke", async () => {
    const wss = createGateway();
    const tv = connect(wss, "ack-tv");
    await settle();

    tv.emit("message", JSON.stringify({ type: "GREET_ACK", screenId: "ack-tv", spoke: true, voice: "Microsoft Heera" }));

    expect(getLastGreetAck()).toMatchObject({ screenId: "ack-tv", spoke: true, voice: "Microsoft Heera" });
    expect(getLastGreetAck()?.at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("records a failure with its reason", async () => {
    const wss = createGateway();
    const tv = connect(wss, "ack-fail");
    await settle();

    tv.emit("message", JSON.stringify({ type: "GREET_ACK", screenId: "ack-fail", spoke: false, error: "speech did not start" }));

    expect(getLastGreetAck()).toMatchObject({ spoke: false, error: "speech did not start" });
  });

  it("is ignored from a CMS preview mirror", async () => {
    const wss = createGateway();
    const mirror = connect(wss, "ack-preview", { preview: true });
    await settle();

    mirror.emit("message", JSON.stringify({ type: "GREET_ACK", screenId: "ack-preview", spoke: true }));

    expect(getLastGreetAck()).toBeNull();
  });

  it("clips oversized fields and treats a non-true 'spoke' as false", async () => {
    const wss = createGateway();
    const tv = connect(wss, "ack-clip");
    await settle();

    tv.emit("message", JSON.stringify({ type: "GREET_ACK", screenId: "ack-clip", spoke: "yes", error: "x".repeat(5000), voice: "v".repeat(5000) }));

    const ack = getLastGreetAck()!;
    expect(ack.spoke).toBe(false);
    expect(ack.error).toHaveLength(300);
    expect(ack.voice).toHaveLength(200);
  });

  it("an ack does not make the screen 'online' or alter the connected list", async () => {
    const wss = createGateway();
    const tv = connect(wss, "ack-online");
    await settle();
    const before = getConnectedScreenIds();
    tv.emit("message", JSON.stringify({ type: "GREET_ACK", screenId: "some-other-screen", spoke: true }));
    expect(getConnectedScreenIds()).toEqual(before);
  });
});
