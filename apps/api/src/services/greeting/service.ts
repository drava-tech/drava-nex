import type { GreetingConfig } from "./config.js";
import { LogOnce } from "../../lib/log-once.js";
import { Batcher } from "./batcher.js";
import type { BusyReason, GreetingPresentation, GreetingRequest } from "./screen.js";
import {
  arrivalText,
  cleanName,
  dayKey,
  genericText,
  isReturning,
  renameText,
  spokenName,
  type GreetedPerson,
} from "./text.js";

/**
 * The greeting rules, with every side effect injected (DB, clock, screen) so
 * they can be unit-tested without a database, a gateway or real timers. The
 * production wiring lives in ./index.ts.
 *
 * Rules in one place:
 *  - A visitor is greeted at most once per day (the visitor_greeting row is the
 *    gate) and at most once BY NAME per day: a named greeting from any path
 *    (arrival, rename, merge) upgrades a 'generic' row, never a 'named' one.
 *  - A visitor whose greeting was due while the screen was busy gets a 'skipped'
 *    row instead (GREET_BUSY_SKIPS_DAY): not a greeting, but it blocks every
 *    greeting for them for the rest of the day. It is only written when the
 *    visitor has no row yet, so an earlier greeting is never overwritten.
 *  - No player connected (screen offline): nothing is shown, said or RECORDED —
 *    the next sighting simply tries again.
 *  - An arrival must be fresh: a replayed or old sighting never greets someone
 *    who has since left.
 *  - Only speech-safe names are ever said (control characters stripped, capped,
 *    placeholders like "unknown"/"test" treated as an unknown visitor).
 *  - Triggers (arrival, rename, merge) only QUEUE a visitor. The daily gate runs
 *    when the batch is flushed, inside the screen controller's serialised step
 *    and after it has looked at the screen — so what is recorded always matches
 *    what happened on screen. Arrival and merge share one batch; rename has its
 *    own. Each batch speaks once.
 *  - The visitor is always re-read from the DB — event payloads are never
 *    trusted for names.
 *  - Callers gate on isVisionTriggerArmed(); GREETING_ENABLED is checked here too.
 *
 * Logging: one line per decision, with a reason, and repeats stay quiet — cache
 * hits are silent, and per-visitor reasons that can recur every ~30 s (stale,
 * offline) are logged at most once per 5 minutes.
 */

export type GreetingKind = "generic" | "named";
export type GreetingSource = "arrival" | "rename" | "merge";

export interface VisitorSnapshot {
  name: string;
  firstSeen: Date;
}

export interface GreetingServiceDeps {
  config: GreetingConfig;
  now: () => Date;
  getVisitor(uuid: string): Promise<VisitorSnapshot | null>;
  /**
   * Seen within `windowSeconds` (default GREET_PRESENCE_WINDOW_SECONDS)? Must be
   * answered on the DB's clock (last_seen is written by the DB's now()), not by
   * comparing the API host's clock against last_seen.
   */
  isInRoom(uuid: string, windowSeconds?: number): Promise<boolean>;
  /** True when this call won the day's gate (see recordGreeting in @platform/db). */
  recordGreeting(input: {
    visitorUuid: string;
    greetDate: string;
    kind: GreetingKind;
    source: GreetingSource;
  }): Promise<boolean>;
  /** Insert a 'skipped' row if the visitor has none today; true if one was written. */
  recordSkipped(input: {
    visitorUuid: string;
    greetDate: string;
    source: GreetingSource;
    reason: BusyReason;
  }): Promise<boolean>;
  present(request: GreetingRequest): Promise<void>;
}

/** One visitor waiting in a batch for the screen to be looked at. */
interface PendingItem extends GreetedPerson {
  uuid: string;
  /** What will be SAID: '' for an unknown visitor, or when names aren't spoken. */
  name: string;
  /** 'named' = identified (even if GREET_NAME_MODE keeps the name unspoken). */
  kind: GreetingKind;
  source: GreetingSource;
  day: string;
}

type CachedKind = GreetingKind | "skipped";

/** After a database error the greeting rules stand down for this long. */
export const DB_ERROR_PAUSE_MS = 5 * 60_000;
/** A per-visitor reason that can recur on every sighting is logged this often at most. */
export const REPEAT_LOG_MS = 5 * 60_000;
/**
 * The vision service only writes last_seen once per 30 s per visitor, so a genuine
 * sighting can be up to that much behind when the event arrives.
 */
export const VISION_TOUCH_COOLDOWN_SECONDS = 30;

/** What GET /api/greeting/status reports from memory. */
export interface ServiceStatus {
  breaker: { paused: boolean; until: string | null; lastError: string | null };
  lastGreeting: { at: string; text: string | null; names: string[] } | null;
  /** Since this process started. */
  counters: { staleIgnored: number; offlineSkipped: number; errors: number };
}

export class GreetingService {
  // (uuid -> row kind) for today only. Lets the repeated VISITOR_DETECTED events
  // (every >=30 s while someone stays in frame) skip the DB entirely. A cached
  // 'skipped' blocks arrivals just like a greeting does.
  private cacheDay = "";
  private readonly cache = new Map<string, CachedKind>();
  /** Visitors queued for an arrival batch that hasn't been decided yet. */
  private readonly pending = new Set<string>();
  // Circuit breaker: a database error (e.g. 42P01, visitor_greeting not
  // migrated yet) is logged ONCE, then every trigger is skipped until this time.
  private pausedUntil = 0;
  private lastError: string | null = null;
  private lastGreeting: ServiceStatus["lastGreeting"] = null;
  private readonly counters = { staleIgnored: 0, offlineSkipped: 0, errors: 0 };
  private readonly once: LogOnce;
  private readonly arrivals: Batcher<PendingItem>;
  private readonly renames: Batcher<PendingItem>;

  constructor(private readonly deps: GreetingServiceDeps) {
    this.once = new LogOnce(() => deps.now().getTime());
    this.arrivals = new Batcher(deps.config.batchWindowMs, (items) => this.flush(items, "arrival"));
    this.renames = new Batcher(deps.config.batchWindowMs, (items) => this.flush(items, "rename"));
  }

  private get rules() {
    const c = this.deps.config;
    return {
      timezone: c.timezone,
      afternoonHour: c.afternoonHour,
      eveningHour: c.eveningHour,
      maxNames: c.maxNames,
    };
  }

  /** Today's key, clearing yesterday's cache when the day has rolled over. */
  private today(now: Date): string {
    const day = dayKey(now, this.deps.config.timezone);
    if (day !== this.cacheDay) {
      this.cache.clear();
      this.cacheDay = day;
    }
    return day;
  }

  private paused(now: Date): boolean {
    return now.getTime() < this.pausedUntil;
  }

  private tripBreaker(what: string, err: unknown): void {
    this.pausedUntil = this.deps.now().getTime() + DB_ERROR_PAUSE_MS;
    this.counters.errors += 1;
    const detail = err instanceof Error ? err.message : String(err);
    this.lastError = `${what}: ${detail}`;
    console.error(`[greeting] ${what} failed — greetings paused for ${DB_ERROR_PAUSE_MS / 60_000} min: ${detail}`);
  }

  /** A failure in the screen controller counts against the same breaker. */
  reportScreenError(label: string, err: unknown): void {
    if (this.paused(this.deps.now())) return; // already logged once; stay quiet while paused
    this.tripBreaker(label, err);
  }

  /** Forget today's cached answer for a visitor (their name changed while greetings were off). */
  invalidate(uuid: string): void {
    this.cache.delete(uuid);
  }

  /** Snapshot of the in-memory state for the status endpoint. */
  status(): ServiceStatus {
    const now = this.deps.now();
    return {
      breaker: {
        paused: this.paused(now),
        until: this.paused(now) ? new Date(this.pausedUntil).toISOString() : null,
        lastError: this.lastError,
      },
      lastGreeting: this.lastGreeting,
      counters: { ...this.counters },
    };
  }

  private who(uuid: string, name: string): string {
    return name || `unknown ${uuid.slice(0, 8)}`;
  }

  // ─── Triggers (queue only; the gate runs at flush) ──────────────────────────

  /**
   * A recognised face (VISITOR_DETECTED). Fire-and-forget; never throws.
   * `eventLastSeen` is the vision service's own timestamp for the sighting.
   */
  async onVisitorDetected(uuid: string, opts: { eventLastSeen?: string } = {}): Promise<void> {
    if (!this.deps.config.enabled) return;
    try {
      const now = this.deps.now();
      const day = this.today(now);
      if (this.cache.has(uuid) || this.pending.has(uuid) || this.paused(now)) return;

      // Freshness, part 1: the event's own timestamp (an old, replayed event).
      const fresh = this.deps.config.arrivalFreshSeconds;
      const eventTime = opts.eventLastSeen ? Date.parse(opts.eventLastSeen) : NaN;
      if (!Number.isNaN(eventTime) && now.getTime() - eventTime > fresh * 1000) {
        this.ignoreStale(uuid, `event is ${Math.round((now.getTime() - eventTime) / 1000)}s old`);
        return;
      }

      this.pending.add(uuid);
      let queued = false;
      try {
        const visitor = await this.deps.getVisitor(uuid);
        if (!visitor) {
          this.once.log(`unknown:${uuid}`, REPEAT_LOG_MS, () =>
            console.info(`[greeting] unknown-visitor ${uuid.slice(0, 8)} — not in the visitor table, ignored`)
          );
          return;
        }

        // Freshness, part 2: the database's own last_seen (the vision service writes
        // it, and the DB clock judges it). This is the authority; part 1 is a cheap early out.
        if (!(await this.deps.isInRoom(uuid, fresh + VISION_TOUCH_COOLDOWN_SECONDS))) {
          this.ignoreStale(uuid, `not seen in the last ${fresh + VISION_TOUCH_COOLDOWN_SECONDS}s`);
          return;
        }

        const cleaned = cleanName(visitor.name);
        const kind: GreetingKind = cleaned ? "named" : "generic";
        const spoken = spokenName(cleaned, this.deps.config.nameMode);

        if (cleaned === "" && visitor.name.trim() !== "") {
          this.once.log(`placeholder:${uuid}`, REPEAT_LOG_MS, () =>
            console.info(`[greeting] name not speakable — treated as unknown — ${uuid.slice(0, 8)}`)
          );
        }

        if (kind === "generic" && this.deps.config.greetUnknown === "off") {
          // Nothing will ever be shown for this visitor, so the screen is irrelevant:
          // just mark them greeted for the day.
          const won = await this.deps.recordGreeting({ visitorUuid: uuid, greetDate: day, kind, source: "arrival" });
          this.cache.set(uuid, kind);
          if (won) console.info(`[greeting] unknown visitor ${uuid.slice(0, 8)} recorded as greeted (GREET_UNKNOWN=off)`);
          return;
        }

        this.arrivals.add({
          uuid,
          name: spoken,
          kind,
          source: "arrival",
          day,
          returning: isReturning(visitor.firstSeen, now, this.deps.config.timezone),
        });
        queued = true;
      } finally {
        if (!queued) this.pending.delete(uuid);
      }
    } catch (err) {
      this.tripBreaker("arrival greeting", err);
    }
  }

  private ignoreStale(uuid: string, why: string): void {
    this.counters.staleIgnored += 1;
    this.once.log(`stale:${uuid}`, REPEAT_LOG_MS, () =>
      console.info(`[greeting] ignored stale sighting (${why}) — ${uuid.slice(0, 8)}`)
    );
  }

  /**
   * The host named an unknown visitor in the CMS. The caller has already
   * checked the name went from blank to non-blank; presence is checked here and
   * the daily gate at flush. Out of the room -> nothing now (their next arrival
   * is greeted normally).
   */
  async onVisitorRenamed(uuid: string): Promise<void> {
    // Whatever happens next, a cached 'generic' is now stale.
    this.cache.delete(uuid);
    if (!this.deps.config.enabled) return;
    try {
      const now = this.deps.now();
      const day = this.today(now);
      if (this.paused(now)) return;
      const visitor = await this.deps.getVisitor(uuid);
      if (!visitor) return;
      const cleaned = cleanName(visitor.name);
      if (!cleaned) {
        console.info(`[greeting] rename of ${uuid.slice(0, 8)}: name not speakable — no greeting`);
        return;
      }
      if (!(await this.deps.isInRoom(uuid))) {
        console.info(`[greeting] rename of ${uuid.slice(0, 8)}: not in the room — no greeting`);
        return;
      }
      this.renames.add({
        uuid,
        name: spokenName(cleaned, this.deps.config.nameMode),
        kind: "named",
        source: "rename",
        day,
        returning: false,
      });
    } catch (err) {
      this.tripBreaker("rename greeting", err);
    }
  }

  /**
   * An unknown face was merged into this (target) visitor. Greets with arrival
   * wording, batched with arrivals, if the target is named and in the room.
   */
  async onVisitorMerged(targetUuid: string): Promise<void> {
    this.cache.delete(targetUuid);
    if (!this.deps.config.enabled) return;
    try {
      const now = this.deps.now();
      const day = this.today(now);
      if (this.paused(now)) return;
      const visitor = await this.deps.getVisitor(targetUuid);
      if (!visitor) return;
      const cleaned = cleanName(visitor.name);
      if (!cleaned) {
        console.info(`[greeting] merge into ${targetUuid.slice(0, 8)}: name not speakable — no greeting`);
        return;
      }
      if (!(await this.deps.isInRoom(targetUuid))) {
        console.info(`[greeting] merge into ${targetUuid.slice(0, 8)}: not in the room — no greeting`);
        return;
      }
      this.arrivals.add({
        uuid: targetUuid,
        name: spokenName(cleaned, this.deps.config.nameMode),
        kind: "named",
        source: "merge",
        day,
        returning: isReturning(visitor.firstSeen, now, this.deps.config.timezone),
      });
    } catch (err) {
      this.tripBreaker("merge greeting", err);
    }
  }

  // ─── Batch flush: hand the screen controller the three outcomes ─────────────

  private flush(items: PendingItem[], mode: "arrival" | "rename"): void {
    const request: GreetingRequest = {
      onOffline: () => this.handleOffline(items),
      onBusy: async (reason) => {
        await this.guarded("busy handling", () => this.handleBusy(items, reason));
      },
      admit: () => this.guarded("greeting gate", () => this.admit(items, mode)),
    };
    void this.deps
      .present(request)
      .catch((err) => console.error("[greeting] failed to present greeting:", err))
      .finally(() => {
        for (const item of items) this.pending.delete(item.uuid);
      });
  }

  /** Run a DB step: log-once breaker on failure, nothing recorded or shown. */
  private async guarded<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
    if (this.paused(this.deps.now())) return null;
    try {
      return await fn();
    } catch (err) {
      this.tripBreaker(what, err);
      return null;
    }
  }

  /** No player is connected: nothing shown, said or recorded; the next sighting retries. */
  private handleOffline(items: PendingItem[]): void {
    for (const item of items) {
      this.counters.offlineSkipped += 1;
      this.once.log(`offline:${item.uuid}`, REPEAT_LOG_MS, () =>
        console.info(`[greeting] screen offline — not greeted yet — ${this.who(item.uuid, item.name)}`)
      );
    }
  }

  /** The screen is showing (or about to show) the welcome screen: run the daily gate. */
  private async admit(items: PendingItem[], mode: "arrival" | "rename"): Promise<GreetingPresentation | null> {
    const won: PendingItem[] = [];
    for (const item of items) {
      const ok = await this.deps.recordGreeting({
        visitorUuid: item.uuid,
        greetDate: item.day,
        kind: item.kind,
        source: item.source,
      });
      // Won or not, today's row for this visitor now has (at least) this kind.
      this.cache.set(item.uuid, item.kind);
      if (ok) won.push(item);
      else {
        this.once.log(`already:${item.uuid}:${item.day}`, 24 * 3_600_000, () =>
          console.info(`[greeting] already greeted today — ${this.who(item.uuid, item.name)}`)
        );
      }
    }
    if (won.length === 0) return null;

    const now = this.deps.now();
    const presentation = mode === "rename" ? this.composeRename(won, now) : this.composeArrival(won, now);
    if (presentation) {
      const who = presentation.names.length > 0 ? ` — ${presentation.names.join(", ")}` : "";
      console.info(
        `[greeting] greeted ${presentation.voiceText ? `"${presentation.voiceText}"` : "(screen only)"}${who}`
      );
      this.lastGreeting = { at: now.toISOString(), text: presentation.voiceText, names: presentation.names };
    }
    return presentation;
  }

  /** The screen is busy: nothing is shown or said. Record why, per GREET_BUSY_SKIPS_DAY. */
  private async handleBusy(items: PendingItem[], reason: BusyReason): Promise<void> {
    const skipsDay = this.deps.config.busySkipsDay === "all" || reason === "whiteboard";
    const affected: PendingItem[] = [];

    for (const item of items) {
      if (skipsDay) {
        // Only if they have no row today — an earlier greeting is never overwritten.
        const inserted = await this.deps.recordSkipped({
          visitorUuid: item.uuid,
          greetDate: item.day,
          source: item.source,
          reason,
        });
        this.cache.set(item.uuid, inserted ? "skipped" : item.kind);
        if (inserted) affected.push(item);
      } else {
        // Not a day-long skip for this reason: the visitor counts as greeted, silently.
        const won = await this.deps.recordGreeting({
          visitorUuid: item.uuid,
          greetDate: item.day,
          kind: item.kind,
          source: item.source,
        });
        this.cache.set(item.uuid, item.kind);
        if (won) affected.push(item);
      }
    }

    if (affected.length > 0) {
      const who = affected.map((i) => this.who(i.uuid, i.name)).join(", ");
      console.info(
        skipsDay
          ? `[greeting] screen busy (${reason}) — skipped, no greeting today — ${who}`
          : `[greeting] screen busy (${reason}) — skipped (counted as greeted) — ${who}`
      );
    }
  }

  // ─── Wording ────────────────────────────────────────────────────────────────

  private composeArrival(won: PendingItem[], now: Date): GreetingPresentation | null {
    const named = won.filter((i) => i.name);
    if (named.length > 0) {
      // Unknown visitors in a mixed batch are never mentioned.
      return { voiceText: arrivalText(named, now, this.rules), names: named.map((i) => i.name) };
    }
    // Identified, but GREET_NAME_MODE (or a name with no speakable first word) keeps names unsaid.
    if (won.some((i) => i.kind === "named")) return { voiceText: genericText(now, this.rules), names: [] };
    if (this.deps.config.greetUnknown === "generic") return { voiceText: genericText(now, this.rules), names: [] };
    if (this.deps.config.greetUnknown === "screen") return { voiceText: null, names: [] }; // welcome screen only
    return null;
  }

  private composeRename(won: PendingItem[], now: Date): GreetingPresentation {
    const names = won.map((i) => i.name).filter(Boolean);
    return { voiceText: renameText(names, now, this.rules), names };
  }
}
