// @ts-nocheck
import { defineConfig } from "drizzle-kit";


/**
 * Drizzle Kit Configuration
 *
 * PLACEHOLDER: PostgreSQL is not yet configured.
 * Do not run `drizzle-kit generate` or `drizzle-kit migrate` until
 * DATABASE_URL is set in your environment.
 *
 * Usage (when DB is ready):
 *   pnpm --filter @platform/db db:generate   # generate migration SQL files
 *   pnpm --filter @platform/db db:migrate    # apply migrations to DB
 *   pnpm --filter @platform/db db:studio     # open Drizzle Studio
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    // TODO: Set DATABASE_URL in your .env before running drizzle-kit commands
    url: process.env["DATABASE_URL"] ?? "postgresql://placeholder:placeholder@localhost:5432/cms_platform",
  },
  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },
  verbose: true,
  strict: true,
});
