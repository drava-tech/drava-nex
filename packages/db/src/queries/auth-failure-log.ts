import { desc, count } from "drizzle-orm";
import { db } from "../client.js";
import { authFailureLog, type AuthFailureLog } from "../schema/auth-failure-log.js";

/**
 * Durable record of rejected internal-route requests. See
 * apps/api/src/lib/internal-auth.ts, which is the only writer.
 */

export interface RecordAuthFailureInput {
  route: string;
  reason: "unauthorized" | "rate_limited";
  sourceIp: string;
}

export async function recordAuthFailure(input: RecordAuthFailureInput): Promise<AuthFailureLog> {
  const [row] = await db.insert(authFailureLog).values(input).returning();
  if (!row) throw new Error("Failed to record auth failure log");
  return row;
}

export interface AuthFailureLogListResult {
  items: AuthFailureLog[];
  total: number;
}

export async function listAuthFailureLog(limit = 50): Promise<AuthFailureLogListResult> {
  const totalRows = await db.select({ total: count() }).from(authFailureLog);
  const total = totalRows[0]?.total ?? 0;

  const items = await db.select().from(authFailureLog).orderBy(desc(authFailureLog.createdAt)).limit(limit);

  return { items, total };
}
