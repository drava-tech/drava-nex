import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    env: {
      // Tests must never reach a real database. @platform/db's client prefers
      // process.env.DATABASE_URL over any .env file, so pinning it here to a
      // dead port (127.0.0.1:1) means an unmocked query fails fast with
      // ECONNREFUSED instead of silently writing to whatever the root .env
      // points at. Tests mock their DB calls; this is the safety net.
      DATABASE_URL: "postgresql://tests:tests@127.0.0.1:1/never_connects",
    },
  },
});
