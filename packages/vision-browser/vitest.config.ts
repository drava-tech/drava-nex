import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // StabilityFilter and the frame header are pure logic — no DOM needed.
    // (capture.ts, which does need one, is not covered here.)
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
