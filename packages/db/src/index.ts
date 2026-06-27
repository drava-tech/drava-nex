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
export * from "./queries/media.js";
export * from "./queries/products.js";

// ─── Drizzle Utilities ────────────────────────────────────────────────────────
export { sql, eq, and, or, gt, gte, lt, lte, ne, inArray, count, isNull, isNotNull } from "drizzle-orm";
