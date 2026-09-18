import { z } from "zod"

/**
 * The API's entire configuration, validated once at boot. A missing or
 * malformed variable stops the process with a readable list — instead of
 * surfacing hours later as a failed request.
 */
const optional = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v))

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  /** The origin browsers use (console and API are served same-origin). */
  APP_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32, "Generate with: openssl rand -hex 32"),
  BETTER_AUTH_URL: z.url(),
  UPLOAD_TICKET_SECRET: z.string().min(32, "Generate with: openssl rand -hex 32"),

  // Storage. May be unset in early development; routes that need it answer 503.
  R2_ACCESS_KEY_ID: optional,
  R2_SECRET_ACCESS_KEY: optional,
  R2_BUCKET: optional,
  R2_ENDPOINT: optional,
  R2_REGION: z.string().default("auto"),
  R2_PUBLIC_BASE_URL: optional,
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 ** 3),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error("[env] Invalid configuration:")
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`)
    }
    console.error("See .env.example at the repo root.")
    process.exit(1)
  }
  return parsed.data
}

export const env = loadEnv()
