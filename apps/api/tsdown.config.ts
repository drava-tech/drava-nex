import { defineConfig } from "tsdown"

// Bundles the API into dist/. The @workspace/* packages are just-in-time (they
// export TypeScript source), which Node cannot import at runtime, so they are
// inlined here. Their own dependencies stay external and are declared in this
// package.json.
export default defineConfig({
  // seed-admin ships in the image so the first admin can be created in the
  // container: docker compose exec api node dist/seed-admin.mjs --email ...
  entry: { index: "src/index.ts", "seed-admin": "scripts/seed-admin.ts" },
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@workspace\//],
})
