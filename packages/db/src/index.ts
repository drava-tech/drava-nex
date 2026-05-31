/**
 * @platform/db — Public API
 *
 * Import everything your app needs from this single entry point:
 *
 * @example
 * import { db, screens, experiences, type Screen } from '@platform/db';
 */

// ─── Database Client ──────────────────────────────────────────────────────────
export { db, pool } from "./client.js";
export type { Database } from "./client.js";

// ─── Schema (Tables + Enums + Relations) ──────────────────────────────────────
export * from "./schema/index.js";
