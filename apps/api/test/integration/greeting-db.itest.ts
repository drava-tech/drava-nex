import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  VisitorNotFoundError,
  countGreetingsForDay,
  getAppSetting,
  getScreenGreetingState,
  isScreenIdle,
  isVisitorInRoom,
  mergeVisitor,
  pool,
  pruneVisitorGreetings,
  recordGreeting,
  recordSkippedGreeting,
  setAppSetting,
  updateVisitorContact,
  updateVisitorContactWithPrevious,
} from "@platform/db";
import { isIdleState } from "../../src/services/greeting/screen.js";
import { assertLocalDatabaseUrl } from "./guard.js";

/**
 * Real SQL against the throwaway local database (see global-setup.ts): the gate,
 * its races, the transaction behind rename detection, merge + cascades, the DB
 * clock, the combined screen-state query, retention and settings.
 */

const DAY = "2099-01-01";

beforeEach(() => {
  // Paranoia, every test: the pool must be pointed at the throwaway local database.
  assertLocalDatabaseUrl(process.env["DATABASE_URL"], "DATABASE_URL (as the db package sees it)");
});

async function visitor(name = "", opts: { lastSeenAgoSeconds?: number; firstSeenDaysAgo?: number } = {}): Promise<string> {
  const uuid = randomUUID();
  await pool.query(
    `INSERT INTO visitor (uuid, name, first_seen, last_seen)
     VALUES ($1, $2, now() - ($3 || ' days')::interval, now() - ($4 || ' seconds')::interval)`,
    [uuid, name, String(opts.firstSeenDaysAgo ?? 0), String(opts.lastSeenAgoSeconds ?? 0)]
  );
  return uuid;
}
const greetingRow = async (uuid: string, day = DAY) =>
  (await pool.query("SELECT kind, source, skip_reason FROM visitor_greeting WHERE visitor_uuid=$1 AND greet_date=$2", [uuid, day])).rows[0] as
    | { kind: string; source: string; skip_reason: string | null }
    | undefined;

describe("migrations 0039-0041 on top of the cloned schema", () => {
  it("visitor_greeting has the columns, the unique key, the cascade FK and the kind CHECK", async () => {
    const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='visitor_greeting'")).rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(["id", "visitor_uuid", "greet_date", "kind", "source", "skip_reason", "greeted_at"]));

    const indexes = (await pool.query("SELECT indexdef FROM pg_indexes WHERE tablename='visitor_greeting'")).rows.map((r) => r.indexdef);
    expect(indexes.some((d: string) => /UNIQUE.*\(visitor_uuid, greet_date\)/.test(d))).toBe(true);

    const fk = (await pool.query("SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='visitor_greeting'::regclass AND contype='f'")).rows[0];
    expect(fk.d).toMatch(/ON DELETE CASCADE/);

    const u = await visitor("CheckKind");
    await expect(
      pool.query("INSERT INTO visitor_greeting (visitor_uuid, greet_date, kind, source) VALUES ($1, $2, 'bogus', 'arrival')", [u, DAY])
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("0040 and 0041 can be applied again without error", async () => {
    for (const file of ["0040_visitor_greeting_skipped.sql", "0041_app_setting.sql"]) {
      const sql = readFileSync(new URL(`../../../../packages/db/drizzle/${file}`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) await pool.query(statement);
    }
  });
});

describe("the daily gate", () => {
  it("generic inserts once; a second attempt loses", async () => {
    const u = await visitor();
    expect(await recordGreeting({ visitorUuid: u, greetDate: DAY, kind: "generic", source: "arrival" })).toBe(true);
    expect(await recordGreeting({ visitorUuid: u, greetDate: DAY, kind: "generic", source: "arrival" })).toBe(false);
  });

  it("named upgrades generic exactly once, and never a named row", async () => {
    const u = await visitor("Priya");
    await recordGreeting({ visitorUuid: u, greetDate: DAY, kind: "generic", source: "arrival" });
    expect(await recordGreeting({ visitorUuid: u, greetDate: DAY, kind: "named", source: "rename" })).toBe(true);
    expect(await greetingRow(u)).toMatchObject({ kind: "named", source: "rename" });
    expect(await recordGreeting({ visitorUuid: u, greetDate: DAY, kind: "named", source: "merge" })).toBe(false);
  });

  it("skipped is written only when there is no row, and blocks every greeting for the day", async () => {
    const u = await visitor("Priya");
    expect(await recordSkippedGreeting({ visitorUuid: u, greetDate: DAY, source: "arrival", reason: "content" })).toBe(true);
    expect(await greetingRow(u)).toEqual({ kind: "skipped", source: "arrival", skip_reason: "content" });

    expect(await recordSkippedGreeting({ visitorUuid: u, greetDate: DAY, source: "arrival", reason: "whiteboard" })).toBe(false);
    expect((await greetingRow(u))?.skip_reason).toBe("content"); // first reason kept
    expect(await recordGreeting({ visitorUuid: u, greetDate: DAY, kind: "generic", source: "arrival" })).toBe(false);
    expect(await recordGreeting({ visitorUuid: u, greetDate: DAY, kind: "named", source: "rename" })).toBe(false);
    expect(await recordGreeting({ visitorUuid: u, greetDate: DAY, kind: "named", source: "merge" })).toBe(false);
    expect((await greetingRow(u))?.kind).toBe("skipped");
  });

  it("skipped never overwrites an earlier greeting", async () => {
    const generic = await visitor();
    await recordGreeting({ visitorUuid: generic, greetDate: DAY, kind: "generic", source: "arrival" });
    expect(await recordSkippedGreeting({ visitorUuid: generic, greetDate: DAY, source: "arrival", reason: "content" })).toBe(false);
    expect((await greetingRow(generic))?.kind).toBe("generic");

    const named = await visitor("Arjun");
    await recordGreeting({ visitorUuid: named, greetDate: DAY, kind: "named", source: "arrival" });
    expect(await recordSkippedGreeting({ visitorUuid: named, greetDate: DAY, source: "arrival", reason: "blanked" })).toBe(false);
    expect((await greetingRow(named))?.kind).toBe("named");
  });

  it("the next day is independent", async () => {
    const u = await visitor("Priya");
    await recordSkippedGreeting({ visitorUuid: u, greetDate: DAY, source: "arrival", reason: "content" });
    expect(await recordGreeting({ visitorUuid: u, greetDate: "2099-01-02", kind: "named", source: "arrival" })).toBe(true);
  });

  it("races: exactly one of many simultaneous attempts wins", async () => {
    const u = await visitor("Priya");
    const named = await Promise.all(
      Array.from({ length: 8 }, () => recordGreeting({ visitorUuid: u, greetDate: DAY, kind: "named", source: "arrival" }))
    );
    expect(named.filter(Boolean)).toHaveLength(1);

    const v = await visitor("Arjun");
    const mixed = await Promise.all([
      recordSkippedGreeting({ visitorUuid: v, greetDate: DAY, source: "arrival", reason: "content" }),
      recordGreeting({ visitorUuid: v, greetDate: DAY, kind: "named", source: "arrival" }),
      recordGreeting({ visitorUuid: v, greetDate: DAY, kind: "generic", source: "arrival" }),
      recordSkippedGreeting({ visitorUuid: v, greetDate: DAY, source: "rename", reason: "whiteboard" }),
    ]);
    expect(mixed.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect((await pool.query("SELECT count(*)::int n FROM visitor_greeting WHERE visitor_uuid=$1 AND greet_date=$2", [v, DAY])).rows[0].n).toBe(1);
  });
});

describe("rename detection transaction", () => {
  it("returns the previous name alongside the same visitor row the plain update returns", async () => {
    const a = await visitor("");
    const b = await visitor("");
    const withPrev = await updateVisitorContactWithPrevious(a, { name: "Priya" });
    const plain = await updateVisitorContact(b, { name: "Priya" });
    expect(withPrev.previousName).toBe("");
    expect(withPrev.visitor.name).toBe("Priya");
    expect(Object.keys(withPrev.visitor).sort()).toEqual(Object.keys(plain).sort());
  });

  it("two simultaneous edits of a blank name: exactly one of them sees it blank", async () => {
    const u = await visitor("");
    const results = await Promise.all([
      updateVisitorContactWithPrevious(u, { name: "First" }),
      updateVisitorContactWithPrevious(u, { name: "Second" }),
    ]);
    const sawBlank = results.filter((r) => r.previousName === "");
    expect(sawBlank).toHaveLength(1);
    // the other one saw the winner's name
    const other = results.find((r) => r.previousName !== "")!;
    expect(["First", "Second"]).toContain(other.previousName);
  });

  it("a missing visitor is a VisitorNotFoundError", async () => {
    await expect(updateVisitorContactWithPrevious(randomUUID(), { name: "x" })).rejects.toBeInstanceOf(VisitorNotFoundError);
  });
});

describe("merge and the greeting table", () => {
  it("merging deletes the source, moves its embeddings, and cascades its greeting rows", async () => {
    const source = await visitor("");
    const target = await visitor("Priya");
    await pool.query("INSERT INTO visitor_embedding (visitor_uuid, embedding, photo_number) VALUES ($1, (SELECT array_fill(0.01::float4, ARRAY[512])::vector), 1)", [source]);
    await recordGreeting({ visitorUuid: source, greetDate: DAY, kind: "generic", source: "arrival" });
    await recordGreeting({ visitorUuid: target, greetDate: DAY, kind: "named", source: "arrival" });

    const merged = await mergeVisitor(source, target);

    expect(merged.uuid).toBe(target);
    expect((await pool.query("SELECT count(*)::int n FROM visitor WHERE uuid=$1", [source])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int n FROM visitor_embedding WHERE visitor_uuid=$1", [target])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int n FROM visitor_greeting WHERE visitor_uuid=$1", [source])).rows[0].n).toBe(0); // cascaded
    expect(await greetingRow(target)).toMatchObject({ kind: "named" }); // the survivor keeps its own row
  });
});

describe("presence on the DATABASE's clock", () => {
  it("compares last_seen with now() in SQL", async () => {
    const recent = await visitor("A", { lastSeenAgoSeconds: 10 });
    const old = await visitor("B", { lastSeenAgoSeconds: 200 });
    expect(await isVisitorInRoom(recent, 30)).toBe(true);
    expect(await isVisitorInRoom(old, 30)).toBe(false);
    expect(await isVisitorInRoom(old, 300)).toBe(true);
    expect(await isVisitorInRoom(randomUUID(), 300)).toBe(false);
  });
});

describe("getScreenGreetingState agrees with isScreenIdle", () => {
  async function screenRow(opts: { kind?: string | null; experience?: string | null; media?: string | null; defaultMedia?: string | null; blanked?: boolean; whiteboard?: boolean }) {
    const id = `it-screen-${randomUUID().slice(0, 8)}`;
    await pool.query(
      `INSERT INTO screen (screen_id, screen_name, current_content_kind, current_experience_id, current_media_asset_id, default_media_asset_id, blanked, whiteboard_active)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7)`,
      [id, opts.kind ?? null, opts.experience ?? null, opts.media ?? null, opts.defaultMedia ?? null, opts.blanked ?? false, opts.whiteboard ?? false]
    );
    return id;
  }
  async function media(): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO media_asset (id, type, url, name) VALUES ($1, 'video', '/media/x.mp4', 'x')", [id]);
    return id;
  }
  async function experience(deleted = false): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO experience (id, name, slug, deleted_at) VALUES ($1, 'e', $2, $3)", [id, `it-${id}`, deleted ? new Date() : null]);
    return id;
  }

  it("agrees on every shape of screen", async () => {
    const m1 = await media();
    const m2 = await media();
    const e1 = await experience();
    const cases: Record<string, string> = {
      "nothing assigned": await screenRow({}),
      "nothing assigned, default set": await screenRow({ defaultMedia: m1 }),
      "default media playing": await screenRow({ kind: "media", media: m1, defaultMedia: m1 }),
      "other media playing": await screenRow({ kind: "media", media: m2, defaultMedia: m1 }),
      "media, no default": await screenRow({ kind: "media", media: m2 }),
      "an experience": await screenRow({ kind: "experience", experience: e1 }),
      "blanked, nothing assigned": await screenRow({ blanked: true }),
      "whiteboard over nothing": await screenRow({ whiteboard: true }),
    };
    for (const [label, id] of Object.entries(cases)) {
      const state = await getScreenGreetingState(id);
      expect(isIdleState(state), label).toBe(await isScreenIdle(id));
    }
    expect(isIdleState(await getScreenGreetingState("no-such-screen"))).toBe(false);
    expect(await isScreenIdle("no-such-screen")).toBe(false);
  });

  it("reports blank and whiteboard from the row, and ignores a soft-deleted experience", async () => {
    const deleted = await experience(true);
    const live = await experience();
    const blanked = await getScreenGreetingState(await screenRow({ blanked: true }));
    expect(blanked).toMatchObject({ blanked: true, whiteboardActive: false });
    expect(await getScreenGreetingState(await screenRow({ whiteboard: true }))).toMatchObject({ whiteboardActive: true });
    expect((await getScreenGreetingState(await screenRow({ kind: "experience", experience: deleted })))?.experienceId).toBeNull();
    expect((await getScreenGreetingState(await screenRow({ kind: "experience", experience: live })))?.experienceId).toBe(live);
  });
});

describe("status counts and retention", () => {
  const day = "2098-06-15";

  it("counts a day's outcomes by kind and skip reason", async () => {
    const [a, b, c, d] = [await visitor("A"), await visitor("B"), await visitor("C"), await visitor("D")];
    await recordGreeting({ visitorUuid: a, greetDate: day, kind: "named", source: "arrival" });
    await recordGreeting({ visitorUuid: b, greetDate: day, kind: "generic", source: "arrival" });
    await recordSkippedGreeting({ visitorUuid: c, greetDate: day, source: "arrival", reason: "content" });
    await recordSkippedGreeting({ visitorUuid: d, greetDate: day, source: "arrival", reason: "whiteboard" });

    const rows = await countGreetingsForDay(day);
    const get = (kind: string, reason: string | null = null) => rows.find((r) => r.kind === kind && r.skipReason === reason)?.count ?? 0;
    expect(get("named")).toBe(1);
    expect(get("generic")).toBe(1);
    expect(get("skipped", "content")).toBe(1);
    expect(get("skipped", "whiteboard")).toBe(1);
  });

  it("purges only days strictly before the cutoff", async () => {
    const [old, edge, fresh] = [await visitor("Old"), await visitor("Edge"), await visitor("Fresh")];
    await recordGreeting({ visitorUuid: old, greetDate: "2097-01-01", kind: "named", source: "arrival" });
    await recordGreeting({ visitorUuid: edge, greetDate: "2097-02-01", kind: "named", source: "arrival" });
    await recordGreeting({ visitorUuid: fresh, greetDate: "2097-03-01", kind: "named", source: "arrival" });

    const removed = await pruneVisitorGreetings("2097-02-01");

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await greetingRow(old, "2097-01-01")).toBeUndefined();
    expect(await greetingRow(edge, "2097-02-01")).toBeDefined(); // the cutoff day itself stays
    expect(await greetingRow(fresh, "2097-03-01")).toBeDefined();
  });
});

describe("app settings", () => {
  it("returns null before the first write, then upserts", async () => {
    const key = `it-${randomUUID()}`;
    expect(await getAppSetting(key)).toBeNull();
    await setAppSetting(key, "true");
    expect(await getAppSetting(key)).toBe("true");
    await setAppSetting(key, "false");
    expect(await getAppSetting(key)).toBe("false");
    expect((await pool.query("SELECT count(*)::int n FROM app_setting WHERE key=$1", [key])).rows[0].n).toBe(1);
  });
});
