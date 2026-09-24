import { timingSafeEqual } from "crypto";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { recordAuthFailure } from "@platform/db";

/**
 * Shared hardening for the two machine-to-machine internal routes
 * (routes/internal.ts's vision-event relay, routes/voice-internal.ts's voice
 * relay) — both are guarded by a single static secret header with no
 * per-caller identity, so this is the entire defensive surface between
 * "anyone who reaches this port" and admin-equivalent control. Centralized so
 * fixing one of these routes always fixes the other; historically they
 * duplicated an identical (and identically weak) checkSecret().
 */

/**
 * Constant-time secret comparison. A plain `===` short-circuits on the first
 * mismatched byte, so response time can leak how many leading bytes of a
 * guessed secret were correct — theoretical on a LAN-only deployment, but a
 * one-line fix for a real class of attack. Different lengths are rejected
 * immediately without a timing-safe compare: a secret's length isn't the
 * sensitive part, and timingSafeEqual requires equal-length buffers anyway.
 */
export function secretsMatch(provided: string | undefined | null, expected: string | undefined | null): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Best-effort caller identity for logging/rate-limiting — the real socket
 *  address (this route is called directly, not through nginx, so there's no
 *  trustworthy X-Forwarded-For to prefer here). */
export function sourceIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Fixed-window rate limiter, keyed per caller (typically sourceIp()), for one
 * route group. In-memory and per-process: fine for this single-instance
 * deployment, resets on restart, and deliberately not shared across routes —
 * a burst against /vision-event shouldn't count against /voice-internal.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  /** True if this call is within budget; false if the caller should be throttled. */
  check(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }
}

/**
 * Log a rejected-auth attempt loudly AND durably. Console alone (the
 * original fix) doesn't survive a process restart or log rotation — a real
 * security incident review needs this to still be there afterward, so every
 * rejection also gets a row in auth_failure_log. Fire-and-forget: a logging
 * failure must never turn an already-rejected request into a 500.
 */
export function logAuthFailure(route: string, c: Context): void {
  const ip = sourceIp(c);
  console.error(`[${route}] UNAUTHORIZED request from ${ip} at ${new Date().toISOString()}`);
  recordAuthFailure({ route, reason: "unauthorized", sourceIp: ip }).catch((err) =>
    console.error(`[${route}] failed to record auth failure:`, err)
  );
}

/** Log a rate-limit rejection — distinct from an auth failure so the two are
 *  easy to tell apart when reading logs later. Also durable, same reasoning
 *  as logAuthFailure. */
export function logRateLimited(route: string, c: Context): void {
  const ip = sourceIp(c);
  console.error(`[${route}] RATE LIMITED request from ${ip} at ${new Date().toISOString()}`);
  recordAuthFailure({ route, reason: "rate_limited", sourceIp: ip }).catch((err) =>
    console.error(`[${route}] failed to record auth failure:`, err)
  );
}
