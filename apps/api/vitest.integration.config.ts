import { defineConfig } from "vitest/config";

/**
 * Opt-in integration suite: `pnpm test:integration` (needs the local Docker
 * Postgres up). Runs ONLY against a throwaway database on localhost:5433 — the
 * global setup refuses anything else (test/integration/guard.ts). The ordinary
 * unit config keeps its dead-port DATABASE_URL; this one deliberately does not.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.itest.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // one database, one process: tests share state on purpose and clean up after themselves
    fileParallelism: false,
  },
});
