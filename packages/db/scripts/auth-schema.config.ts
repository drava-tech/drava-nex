/**
 * Generator-only config for `pnpm auth:generate` (the better-auth CLI).
 *
 * The runtime auth instance lives in apps/api. This file exists so the auth
 * tables can be generated into this package without importing the API. Keep
 * the options that shape the schema — additional fields and plugins — in sync
 * with apps/api/src/lib/auth.ts; the shared field definitions already are,
 * because both import them from src/auth-fields.ts.
 */
import { betterAuth } from "better-auth"

import { userAdditionalFields } from "../src/auth-fields"

export const auth = betterAuth({
  emailAndPassword: { enabled: true },
  user: { additionalFields: userAdditionalFields },
})
