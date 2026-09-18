import { defineConfig } from "tsdown"

// Bundles the API into dist/. The @workspace/* packages are just-in-time (they
// export TypeScript source), which Node cannot import at runtime, so they are
// inlined here. Their own dependencies stay external and are declared in this
// package.json.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@workspace\//],
})
