import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth.js";

/**
 * API keys for machine clients (Unreal Engine, IoT cameras, automation). Only a
 * SHA-256 hash of the key is stored — the plaintext is shown once at creation.
 * `scopes` gate what a key may do (e.g. "devices:write", "screens:command"),
 * with "ns:*" and "*" wildcards. See queries/api-keys.ts for verification.
 */
export const apiKey = pgTable(
  "api_key",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    // Human label, e.g. "Unreal Engine — Lobby".
    name: text("name").notNull(),
    // First chars of the plaintext key, shown to admins to identify a key.
    prefix: text("prefix").notNull(),
    // SHA-256 hex of the full plaintext key.
    keyHash: text("key_hash").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // Optional user a key acts as; pure machine keys may have none.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("api_key_hash_unique_idx").on(table.keyHash),
    index("api_key_prefix_idx").on(table.prefix),
  ]
);

export type ApiKey = typeof apiKey.$inferSelect;
export type NewApiKey = typeof apiKey.$inferInsert;
