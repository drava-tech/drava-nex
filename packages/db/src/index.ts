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
export * from "./queries/experiences.js";
export * from "./queries/experience-types.js";
export * from "./queries/media.js";
export * from "./queries/products.js";
export * from "./queries/api-keys.js";
export * from "./queries/devices.js";
export * from "./queries/users.js";

// ─── Drizzle Utilities ────────────────────────────────────────────────────────
export { sql, eq, and, or, gt, gte, lt, lte, ne, inArray, count, isNull, isNotNull } from "drizzle-orm";
