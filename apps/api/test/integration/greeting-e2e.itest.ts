import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl } from "./guard.js";

/**
 * The whole chain on real infrastructure, in one process: POST /vision-event ->
 * internal route -> greeting service -> screen controller -> real SQL -> gateway
 * -> a (mock) TV socket. Only the TV and the clock-driven timers are stand-ins.
 */

// Configure the feature BEFORE anything imports it (config is read once, lazily).
process.env["GREETING_ENABLED"] = "true";
process.env["GREETING_VOICE"] = "screen";
process.env["GREET_UNKNOWN"] = "generic";
process.env["GREET_BATCH_WINDOW_MS"] = "0";
process.env["WELCOME_SCREEN_DURATION_SECONDS"] = "1";
process.env["BROADCAST_SECRET"] = "it-secret";

assertLocalDatabaseUrl(process.env["DATABASE_URL"], "DATABASE_URL (as the api sees it)");

const { pool } = await import("@platform/db");
const { createGateway } = await import("../../src/ws/gateway.js");
const { internalRouter } = await import("../../src/routes/internal.js");
const { getGreetingStatus, persistArmedState, restoreArmedState, pruneOldGreetings } = await import("../../src/services/greeting/index.js");
const { setVisionTriggerArmed, isVisionTriggerArmed } = await import("../../src/services/door-screen-trigger.js");
const { dayKey } = await import("../../src/services/greeting/text.js");

const TODAY = dayKey(new Date(), "Asia/Kolkata");
const SCREEN = "main-screen";

class MockTv extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  frames() {
    return this.sent.map((s) => JSON.parse(s) as { type: string; command?: string; value?: any; content?: any });
  }
  greets() {
    return this.frames().filter((f) => f.type === "SCREEN_COMMAND" && f.command === "GREET");
  }
  welcomes() {
    return this.frames().filter((f) => f.type === "CONTENT_UPDATE" && f.content?.templateKey === "welcome");
  }
}

const wss = createGateway();
function connectTv(): MockTv {
  const tv = new MockTv();
  wss.emit("connection", tv as never, {} as never);
  tv.emit("message", JSON.stringify({ type: "REGISTER", screenId: SCREEN, preview: false, freshLaunch: false }));
  return tv;
}

async function sighting(uuid: string, extra: Record<string, unknown> = {}) {
  return internalRouter.request("/vision-event", {
    method: "POST",
    headers: { "content-type": "application/json", "x-broadcast-secret": "it-secret" },
    body: JSON.stringify({ type: "VISITOR_DETECTED", uuid, name: "", isNew: false, lastSeen: new Date().toISOString(), hasImage: false, ...extra }),
  });
}

async function newVisitor(name: string, lastSeenAgoSeconds = 0): Promise<string> {
  const uuid = randomUUID();
  await pool.query(
    "INSERT INTO visitor (uuid, name, first_seen, last_seen) VALUES ($1, $2, now() - interval '30 days', now() - ($3 || ' seconds')::interval)",
    [uuid, name, String(lastSeenAgoSeconds)]
  );
  return uuid;
}
const row = async (uuid: string) =>
  (await pool.query("SELECT kind, source, skip_reason FROM visitor_greeting WHERE visitor_uuid=$1 AND greet_date=$2", [uuid, TODAY])).rows[0] as
    | { kind: string; source: string; skip_reason: string | null }
    | undefined;
const screen = async () =>
  (await pool.query("SELECT current_content_kind kind, current_experience_id exp FROM screen WHERE screen_id=$1", [SCREEN])).rows[0] as { kind: string | null; exp: string | null };
const quiet = () => new Promise((r) => setTimeout(r, 350));
const eventually = (fn: () => void | Promise<void>) => vi.waitFor(fn, { timeout: 6000, interval: 50 });

let tv: MockTv;
let welcomeId: string;
let otherId: string;

beforeAll(async () => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  welcomeId = randomUUID();
  otherId = randomUUID();
  await pool.query("INSERT INTO screen (screen_id, screen_name) VALUES ($1, 'tv') ON CONFLICT DO NOTHING", [SCREEN]);
  await pool.query(
    "INSERT INTO experience (id, name, slug, template_key, template_content) VALUES ($1, 'Welcome Screen', 'welcome-screen', 'welcome', $2::jsonb)",
    [welcomeId, JSON.stringify({ welcome: { title: "Hi" } })]
  );
  await pool.query("INSERT INTO experience (id, name, slug, template_key) VALUES ($1, 'Other', 'other-exp', 'portfolio')", [otherId]);
  tv = connectTv();
  await quiet();
});
afterAll(() => vi.restoreAllMocks());

describe("greet on arrival, end to end", () => {
  it("a named arrival at an idle screen: welcome pushed (muted), line spoken, recorded, then reverted", async () => {
    const priya = await newVisitor("Priya");

    expect((await sighting(priya)).status).toBe(200);

    await eventually(() => expect(tv.greets()).toHaveLength(1));
    expect(tv.greets()[0]!.value).toMatchObject({ speak: true });
    expect(tv.greets()[0]!.value.text).toMatch(/^Good (morning|afternoon|evening), Priya\. Welcome back\.$/);

    // the welcome screen went out with the API's policy flags
    const welcome = tv.welcomes().at(-1)!;
    expect(welcome.content.templateContent.welcome).toMatchObject({ muted: true, narrate: false });

    expect(await row(priya)).toEqual({ kind: "named", source: "arrival", skip_reason: null });
    expect((await screen()).exp).toBe(welcomeId);

    // WELCOME_SCREEN_DURATION_SECONDS=1: it goes back by itself
    await eventually(async () => expect((await screen()).kind).toBeNull());
  });

  it("repeated sightings stay quiet: one greeting, one row", async () => {
    const dev = await newVisitor("Dev");
    await sighting(dev);
    await eventually(() => expect(tv.greets().filter((g) => g.value.text.includes("Dev"))).toHaveLength(1));

    for (let i = 0; i < 3; i++) await sighting(dev);
    await quiet();

    expect(tv.greets().filter((g) => g.value.text.includes("Dev"))).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int n FROM visitor_greeting WHERE visitor_uuid=$1", [dev])).rows[0].n).toBe(1);
    await eventually(async () => expect((await screen()).kind).toBeNull());
  });

  it("an unknown visitor is greeted without a name", async () => {
    const stranger = await newVisitor("");
    await sighting(stranger);
    await eventually(() => expect(tv.greets().some((g) => /^Good (morning|afternoon|evening)\. Welcome\.$/.test(g.value.text))).toBe(true));
    expect(await row(stranger)).toMatchObject({ kind: "generic" });
    await eventually(async () => expect((await screen()).kind).toBeNull());
  });

  it("a busy screen: nothing shown or said, the visitor is 'skipped' for the day — even once it frees up", async () => {
    await pool.query("UPDATE screen SET current_content_kind='experience', current_experience_id=$1 WHERE screen_id=$2", [otherId, SCREEN]);
    const arjun = await newVisitor("Arjun");
    const greetsBefore = tv.greets().length;

    await sighting(arjun);
    await eventually(async () => expect(await row(arjun)).toEqual({ kind: "skipped", source: "arrival", skip_reason: "content" }));
    expect(tv.greets()).toHaveLength(greetsBefore);
    expect((await screen()).exp).toBe(otherId); // untouched

    // the screen frees up; a fresh process would also find the DB row — simulate the cache being gone
    await pool.query("UPDATE screen SET current_content_kind=NULL, current_experience_id=NULL WHERE screen_id=$1", [SCREEN]);
    await sighting(arjun);
    await quiet();
    expect(tv.greets()).toHaveLength(greetsBefore);
    expect((await row(arjun))?.kind).toBe("skipped");
  });

  it("a stale sighting greets nobody and records nothing", async () => {
    const meera = await newVisitor("Meera", 600); // last seen 10 minutes ago
    const greetsBefore = tv.greets().length;

    await sighting(meera, { lastSeen: new Date(Date.now() - 600_000).toISOString() });
    await quiet();

    expect(tv.greets()).toHaveLength(greetsBefore);
    expect(await row(meera)).toBeUndefined();
  });

  it("with the TV offline nothing is recorded; the next sighting, once it is back, greets", async () => {
    const kiran = await newVisitor("Kiran");
    tv.close();
    await quiet();

    await sighting(kiran);
    await quiet();
    expect(await row(kiran)).toBeUndefined();

    tv = connectTv();
    await quiet();
    await sighting(kiran);
    await eventually(() => expect(tv.greets().some((g) => g.value.text.includes("Kiran"))).toBe(true));
    expect((await row(kiran))?.kind).toBe("named");
    await eventually(async () => expect((await screen()).kind).toBeNull());
  });

  it("disarmed: ignored; re-armed: greets", async () => {
    const asha = await newVisitor("Asha");
    setVisionTriggerArmed(false);
    try {
      await sighting(asha);
      await quiet();
      expect(await row(asha)).toBeUndefined();
    } finally {
      setVisionTriggerArmed(true);
    }
    await sighting(asha);
    await eventually(() => expect(tv.greets().some((g) => g.value.text.includes("Asha"))).toBe(true));
    await eventually(async () => expect((await screen()).kind).toBeNull());
  });

  it("an oversized body is refused with 413", async () => {
    const res = await internalRouter.request("/vision-event", {
      method: "POST",
      headers: { "content-type": "application/json", "x-broadcast-secret": "it-secret" },
      body: JSON.stringify({ type: "CAMERA_SNAPSHOT", cameraId: "c", jpegBase64: "x".repeat(2.5 * 1024 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it("the status reflects it all, from the database and from memory", async () => {
    tv.emit("message", JSON.stringify({ type: "GREET_ACK", screenId: SCREEN, spoke: true, voice: "Test Voice" }));

    const status = await getGreetingStatus();

    expect(status).toMatchObject({
      enabled: true,
      armed: true,
      voice: "screen",
      nameMode: "full",
      screen: { id: SCREEN, online: true },
      breaker: { paused: false },
      lastTvAck: { spoke: true, voice: "Test Voice" },
    });
    expect(status.today.date).toBe(TODAY);
    expect(status.today.greeted).toBeGreaterThanOrEqual(5); // Priya, Dev, the stranger, Kiran, Asha
    expect(status.today.skipped).toBe(1);
    expect(status.today.skippedByReason).toEqual({ content: 1 });
    expect(status.lastGreeting?.text).toMatch(/Asha/);
    expect(status.counters.staleIgnored).toBeGreaterThanOrEqual(1);
  });
});

describe("the arm switch survives a restart", () => {
  const setting = async () => (await pool.query("SELECT value FROM app_setting WHERE key='vision_trigger_armed'")).rows[0]?.value as string | undefined;

  it("a disarm is persisted and restored; an arm too", async () => {
    await persistArmedState(false);
    expect(await setting()).toBe("false");
    setVisionTriggerArmed(true); // what a fresh process starts as
    await restoreArmedState();
    expect(isVisionTriggerArmed()).toBe(false);

    await persistArmedState(true);
    setVisionTriggerArmed(false);
    await restoreArmedState();
    expect(isVisionTriggerArmed()).toBe(true);
  });

  it("with no stored choice it stays armed (the default)", async () => {
    await pool.query("DELETE FROM app_setting WHERE key='vision_trigger_armed'");
    setVisionTriggerArmed(true);
    await restoreArmedState();
    expect(isVisionTriggerArmed()).toBe(true);
  });

  it("if the setting cannot be read it starts DISARMED, and says why", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await pool.query("ALTER TABLE app_setting RENAME TO app_setting_hidden");
    try {
      setVisionTriggerArmed(true);
      await restoreArmedState();
      expect(isVisionTriggerArmed()).toBe(false);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("starting DISARMED"), expect.anything());
    } finally {
      await pool.query("ALTER TABLE app_setting_hidden RENAME TO app_setting");
      error.mockRestore();
      setVisionTriggerArmed(true);
    }
  });

  it("a failure to persist never throws (the in-memory switch has already changed)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await pool.query("ALTER TABLE app_setting RENAME TO app_setting_hidden");
    try {
      await expect(persistArmedState(false)).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith(expect.stringContaining("could not persist"), expect.anything());
    } finally {
      await pool.query("ALTER TABLE app_setting_hidden RENAME TO app_setting");
      error.mockRestore();
    }
  });
});

describe("retention", () => {
  it("purges visitor_greeting rows older than GREETING_RETENTION_DAYS (30) and keeps the rest", async () => {
    const dayOffset = (days: number) => dayKey(new Date(Date.now() - days * 86_400_000), "Asia/Kolkata");
    const [old, edge, recent] = [await newVisitor("Old"), await newVisitor("Edge"), await newVisitor("Recent")];
    for (const [u, days] of [[old, 45], [edge, 29], [recent, 3]] as const) {
      await pool.query("INSERT INTO visitor_greeting (visitor_uuid, greet_date, kind, source) VALUES ($1, $2, 'named', 'arrival')", [u, dayOffset(days)]);
    }

    const removed = await pruneOldGreetings();

    expect(removed).toBeGreaterThanOrEqual(1);
    const left = async (u: string) => (await pool.query("SELECT count(*)::int n FROM visitor_greeting WHERE visitor_uuid=$1", [u])).rows[0].n;
    expect(await left(old)).toBe(0);
    expect(await left(edge)).toBe(1);
    expect(await left(recent)).toBe(1);
  });
});
