import { resolve } from "node:path";
import { defineConfig } from "vite";

// Drava World as it ships inside the CMS. The source is the drava-world repo's
// (github.com/drava-tech/drava-world), copied in by tools/sync-drava-world.mjs,
// which also prefixes the code's root paths ("/zone1.glb", "/cms/…") with
// /drava-world/.
//
// `pnpm build` writes dist/, which apps/cms copies into public/drava-world
// before `next dev` / `next build` (apps/cms/scripts/sync-drava-world.mjs), so
// the pages are served same-origin with the CMS.
//
// The pages must match drava-world's own vite.config.js; the sync stops with
// an error if they don't (PAGES in tools/sync-drava-world.mjs).
export default defineConfig({
  // Absolute, not "./": the zone router pushes /drava-world/zone/<id>, and a
  // relative base would resolve the assets against that address.
  base: "/drava-world/",
  publicDir: "public",
  // TRAVIS's bridge is a machine at a venue; inside the CMS there isn't one, so
  // don't try to reach ws://localhost:8765 from every screen. ?bridge=<url> on
  // the iframe's address still turns it on.
  define: {
    "import.meta.env.VITE_TRAVIS_BRIDGE": JSON.stringify(process.env.VITE_TRAVIS_BRIDGE ?? "off"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        cms: resolve(import.meta.dirname, "cms/index.html"),
        display: resolve(import.meta.dirname, "cms/display.html"),
        push: resolve(import.meta.dirname, "push/index.html"),
        "push-display": resolve(import.meta.dirname, "push/display.html"),
        assembly: resolve(import.meta.dirname, "assembly/index.html"),
      },
    },
  },
});
