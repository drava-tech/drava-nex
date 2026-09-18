import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { betterAuth } from "better-auth"
import * as schema from "@workspace/db"
import { userAdditionalFields } from "@workspace/db"

import { env } from "../env"
import { db } from "./db"

/**
 * The runtime auth instance. Schema-shaping options (additional fields,
 * plugins) must match packages/db/scripts/auth-schema.config.ts, which the CLI
 * uses to generate the tables. The shared field definitions come from one
 * place, so those cannot drift.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    // No public sign-up: an admin creates accounts (see scripts/seed-admin.ts).
    disableSignUp: true,
  },
  user: { additionalFields: userAdditionalFields },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // Saves a DB round-trip per request; revocation lags by at most this long.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
})

export type SessionUser = typeof auth.$Infer.Session.user
