import { eq, sql } from "drizzle-orm";
import { db } from "../client.js";
import { appSetting } from "../schema/app-setting.js";

/** Read a setting; null when it has never been written. Throws if the table is unreachable. */
export async function getAppSetting(key: string): Promise<string | null> {
  const [row] = await db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, key)).limit(1);
  return row?.value ?? null;
}

/** Upsert a setting. */
export async function setAppSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSetting)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: sql`now()` } });
}
