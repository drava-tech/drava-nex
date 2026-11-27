import {
  pgTable,
  pgEnum,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Role Enum ────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["ADMIN", "GUEST", "SUPERADMIN"]);

// ─── User ─────────────────────────────────────────────────────────────────────
// Table name "user" matches Better Auth Drizzle adapter convention.

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: userRoleEnum("role").notNull().default("GUEST"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("user_email_unique_idx").on(table.email)]
);

// ─── Session ──────────────────────────────────────────────────────────────────

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("session_token_unique_idx").on(table.token),
    // Better Auth resolves a user's sessions by user_id, and the FK cascade
    // from `user` needs it too — without an index both were sequential scans.
    index("session_user_id_idx").on(table.userId),
    // Built for the dashboard's "active users" count
    //   SELECT count(DISTINCT user_id) FROM session WHERE expires_at > now()
    // whose tile has since been removed. Kept (dropping it needs a migration);
    // expires_at leads so an expiry range is a direct scan.
    index("session_expires_at_user_id_idx").on(table.expiresAt, table.userId),
  ]
);

// ─── Account ──────────────────────────────────────────────────────────────────

export const account = pgTable(
  "account",
  {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  },
  // Better Auth reads a user's accounts by user_id on every email/password
  // sign-in (that is where the password hash lives), and the FK cascade from
  // `user` uses it as well. The table had no indexes at all.
  (table) => [index("account_user_id_idx").on(table.userId)]
);

// ─── Verification ─────────────────────────────────────────────────────────────

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
