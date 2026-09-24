import { desc, count } from "drizzle-orm";
import { db } from "../client.js";
import { doorEvent, type DoorEvent } from "../schema/door-events.js";

/**
 * Door event history — one row per lock toggle. See
 * apps/api/src/routes/door-events.ts, which is the only writer.
 */

export interface DoorEventListResult {
  items: DoorEvent[];
  total: number;
}

export async function recordDoorEvent(
  lockId: string,
  action: "locked" | "unlocked",
  source: "voice" | "cms" = "cms"
): Promise<DoorEvent> {
  const [row] = await db.insert(doorEvent).values({ lockId, action, source }).returning();
  if (!row) throw new Error("Failed to record door event");
  return row;
}

export async function listDoorEvents(limit = 50): Promise<DoorEventListResult> {
  const totalRows = await db.select({ total: count() }).from(doorEvent);
  const total = totalRows[0]?.total ?? 0;

  const items = await db
    .select()
    .from(doorEvent)
    .orderBy(desc(doorEvent.createdAt))
    .limit(limit);

  return { items, total };
}
