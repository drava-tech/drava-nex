import { resolve } from "node:path";
import { defineConfig } from "vite";

// The Data Art Studio as it ships inside the CMS. The source is the standalone
// project's, with its fetches pointed at the Hono API (/api/data-art-studio/*,
// see apps/api/src/routes/data-art-studio.ts) instead of its Vercel functions.
//
// `pnpm build` writes dist/, which apps/cms copies into public/data-art-studio
// before `next dev` / `next build` (apps/cms/scripts/sync-data-art-studio.mjs),
// so the pages are served same-origin with the CMS and the /api proxy.
export default defineConfig({
  // Relative URLs so dist/ works from /data-art-studio/ (or any other sub-path).
  base: "./",
  // Files in public/ are copied as-is, so runtime paths like
  // "../assets/butterfly_atlas.webp" in flight-garden/main.js keep working.
  publicDir: "public",
  server: {
    // Standalone dev: proxy the API so the studio's /api/data-art-studio/*
    // calls reach a locally running Hono server.
    proxy: { "/api": process.env.INTERNAL_API_URL ?? "http://localhost:4000" },
    open: "/velocitymapping.html",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Three.js alone is ~600 kB; this is expected, not a problem.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        studio: resolve(import.meta.dirname, "velocitymapping.html"),
        flightGarden: resolve(import.meta.dirname, "flight-garden/index.html"),
        worldClock: resolve(import.meta.dirname, "world-clock/index.html"),
      },
    },
  },
});
