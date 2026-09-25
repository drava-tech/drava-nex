import { describe, expect, it, vi } from "vitest";
import { CmsClient, CmsError } from "../src/cms/client.js";
import { executeResolution } from "../src/cms/execute.js";
import { EventLog } from "../src/utils/logger.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(fetchImpl: typeof fetch, secret = "s3cret") {
  return new CmsClient({ baseUrl: "http://127.0.0.1:4000", secret, timeoutMs: 1000, fetchImpl, retryDelayMs: 1 });
}

const lightsOn = { endpoint: "lights" as const, body: { action: "on" } };

describe("CmsClient", () => {
  it("posts to /api/voice-control with its own secret and an idempotency key", async () => {
    const fetchImpl = vi.fn(async () => json(200, { success: true, data: { message: "Turned on 4 lights." } }));
    const c = client(fetchImpl as unknown as typeof fetch);
    c.setSessionId("sess-1");
    await expect(c.send(lightsOn)).resolves.toEqual({ message: "Turned on 4 lights." });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:4000/api/voice-control/lights");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-travis-vc-key"]).toBe("s3cret");
    expect(headers["x-session-id"]).toBe("sess-1");
    expect(headers["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual({ action: "on" });
  });

  it("retries once on a network error with the SAME idempotency key", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json(200, { success: true, data: { message: "Door locked." } }));
    await client(fetchImpl).send({ endpoint: "door", body: { action: "lock" } });
    const keys = fetchImpl.mock.calls.map(([, init]) => (init.headers as Record<string, string>)["x-idempotency-key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("does not retry an HTTP error; surfaces the CMS error code and message", async () => {
    const fetchImpl = vi.fn(async () =>
      json(404, { success: false, error: { code: "NOT_FOUND", message: 'I couldn\'t find a screen matching "x".' } })
    );
    const err = await client(fetchImpl as unknown as typeof fetch).send(lightsOn).catch((e) => e);
    expect(err).toBeInstanceOf(CmsError);
    expect(err).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses to call without a secret", async () => {
    const fetchImpl = vi.fn();
    await expect(client(fetchImpl, "").send(lightsOn)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("executeResolution", () => {
  const log = new EventLog(() => {});

  it("speaks the CMS message", async () => {
    const cms = { send: vi.fn(async () => ({ message: "Turned on 4 lights." })) };
    await expect(executeResolution({ kind: "request", request: lightsOn }, cms, log)).resolves.toBe("Turned on 4 lights.");
  });

  it("speaks the API's error message (it names the real options)", async () => {
    const send = vi.fn().mockRejectedValue(new CmsError(`I couldn't find a screen called "x". The screens are: A, B.`, "NOT_FOUND", 404));
    await expect(executeResolution({ kind: "request", request: lightsOn }, { send }, log)).resolves.toBe(
      `I couldn't find a screen called "x". The screens are: A, B.`
    );
  });

  it("never calls the CMS for ask / reply", async () => {
    const send = vi.fn();
    await executeResolution({ kind: "ask", question: "Which screen?", slot: "screen" }, { send }, log);
    await executeResolution({ kind: "reply", text: "No." }, { send }, log);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("EventLog", () => {
  it("prints deltas from the wake word and a latency summary", () => {
    let t = 1_000;
    const lines: string[] = [];
    const log = new EventLog((l) => lines.push(l), () => t);
    log.event("WAKE_WORD_DETECTED");
    t += 250;
    log.event("STT_RESULT", { text: "lights on" });
    t += 50;
    log.event("CMS_REQUEST");
    log.endExchange();
    expect(lines[1]).toMatch(/STT_RESULT\s+\+250ms \(Δ250ms\) \{"text":"lights on"\}/);
    expect(lines.at(-1)).toBe("LATENCY WAKE_WORD_DETECTED=0 STT_RESULT=250 CMS_REQUEST=300 (ms from wake word)");
  });
});
