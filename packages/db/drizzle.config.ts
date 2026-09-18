import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

// The repo root .env is the single source of DATABASE_URL.
config({ path: "../../.env", quiet: true })

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set (see .env.example at the repo root)")

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
})
