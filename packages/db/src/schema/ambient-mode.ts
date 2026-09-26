import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * A named whole-room lighting preset ("pre-entry", "entry", "meeting",
 * "presentation"): one colour, one brightness, and whether the strip light
 * takes part. Editable from the CMS Environment page; applied by the CMS and
 * by TRAVIS ("Travis, meeting mode") through the same service
 * (apps/api/src/services/ambient-modes.ts).
 *
 * `key` is the stable identity the code refers to; `label` is display text
 * only, so renaming a mode in the UI can never break the voice or API side.
 */
export const ambientMode = pgTable("ambient_mode", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  // Display order in the CMS.
  position: integer("position").notNull().default(0),
  // "#RRGGBB". The warm-white value means "the fixtures' white LEDs" (a
  // Casambi warm scene); anything else is a colour (a colour scene + RGB).
  color: text("color").notNull(),
  // 0-100, applied to every fixture that takes part in the mode.
  brightness: integer("brightness").notNull(),
  // false = the strip light is switched off in this mode instead of following
  // the colour/brightness.
  stripOn: boolean("strip_on").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AmbientMode = typeof ambientMode.$inferSelect;
export type NewAmbientMode = typeof ambientMode.$inferInsert;
