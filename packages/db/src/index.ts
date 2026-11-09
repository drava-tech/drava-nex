/**
 * @platform/db — Public API
 */

// ─── Database Client ──────────────────────────────────────────────────────────
export { db, pool, checkDatabaseHealth } from "./client.js";
export type { Database } from "./client.js";

// ─── Schema (Tables + Enums + Relations) ──────────────────────────────────────
export * from "./schema/index.js";

// ─── Queries ──────────────────────────────────────────────────────────────────
export * from "./queries/screens.js";
export * from "./queries/screen-groups.js";
export * from "./queries/screen-content-history.js";
export * from "./queries/screen-uptime.js";
export * from "./queries/dashboard-activity.js";
export * from "./queries/dashboard-stats.js";
export * from "./queries/experiences.js";
export * from "./queries/experience-types.js";
export * from "./queries/media.js";
export * from "./queries/gmail-ingest.js";
export * from "./queries/products.js";
export * from "./queries/devices.js";
export * from "./queries/users.js";
export * from "./queries/visitors.js";
export * from "./queries/door-events.js";
export * from "./queries/whiteboards.js";
export * from "./queries/portfolio.js";
export * from "./queries/companies.js";
export * from "./queries/ambient-mode.js";
// ─── Drizzle Utilities ────────────────────────────────────────────────────────
export { sql, eq, and, or, gt, gte, lt, lte, ne, inArray, count, isNull, isNotNull } from "drizzle-orm";
