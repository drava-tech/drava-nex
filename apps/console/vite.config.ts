import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const API_URL = process.env.API_URL ?? "http://localhost:4000"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    // Same-origin in dev: the browser only ever talks to :3000, so auth cookies
    // work with no CORS. No `rewrite` — the API's own routes are under /api.
    // Production does the same job in nginx.
    proxy: {
      "/api": { target: API_URL, changeOrigin: true },
      "/ws": { target: API_URL.replace(/^http/, "ws"), ws: true, changeOrigin: true },
    },
  },
})
