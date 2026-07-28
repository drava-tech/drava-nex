import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The template content parsers are pure, but the Flight Garden DOM builder
    // needs a document — jsdom covers both.
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
