// @ts-nocheck
import { defineConfig } from "drizzle-kit";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load environment variables from the root .env file
try {
  const envPath = resolve(__dirname, "../../.env");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*DATABASE_URL\s*=\s*["']?(.*?)["']?\s*$/);
    if (match && match[1]) {
      process.env["DATABASE_URL"] = match[1].trim();
      break;
    }
  }
} catch (e) {
  // Ignore if file doesn't exist or is not readable
}


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
  schema: "./dist/schema/index.js",
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
