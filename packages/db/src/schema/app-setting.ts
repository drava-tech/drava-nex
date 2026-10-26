import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Small key/value settings that must survive an API restart (e.g. the
 * welcome-trigger arm switch). Values are plain text; callers own the format.
 */
export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppSetting = typeof appSetting.$inferSelect;
