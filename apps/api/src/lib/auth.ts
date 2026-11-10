import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { db } from "@platform/db";
import * as schema from "@platform/db";

// Single-origin model: the browser reaches everything through one host (nginx).
// baseURL and trusted origins are just that public origin, plus any explicit
// extras in BETTER_AUTH_TRUSTED_ORIGINS. No dynamic per-port IP enumeration.
const CMS_URL = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000";

// Embedding the CMS in an <iframe> on ANOTHER site: the default SameSite=Lax
// session cookie is never sent inside a cross-site frame, so the dashboard
// loops back to /login. SameSite=None fixes that but requires Secure (HTTPS
// only) and drops the browser's CSRF backstop on cookie-authed routes, so it
// is opt-in. Same-host framing (ec-cms / 192.168.1.250, any port) needs none of this.
const ALLOW_IFRAME_EMBED =
  process.env["ALLOW_IFRAME_EMBED"] === "true" && CMS_URL.startsWith("https://");

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,      // refresh if older than 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minute cache
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "GUEST",
        input: false,
      },
    },
  },
  // Bearer plugin: lets mobile clients send `Authorization: Bearer <token>`
  // and have getSession resolve it (cookie + bearer both work via one call).
  plugins: [bearer()],
  ...(ALLOW_IFRAME_EMBED && {
    advanced: { defaultCookieAttributes: { sameSite: "none", secure: true } },
  }),
  secret: process.env["BETTER_AUTH_SECRET"]!,
  baseURL: CMS_URL,
  trustedOrigins: [
    CMS_URL,
    ...(process.env["BETTER_AUTH_TRUSTED_ORIGINS"]
      ?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? []),
  ],
});
