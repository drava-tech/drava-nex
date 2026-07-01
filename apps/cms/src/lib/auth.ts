/**
 * Auth instance for CMS server-side use (Server Actions, middleware).
 * The HTTP handler for /api/auth/* now lives in the Hono API app.
 * This module keeps the same betterAuth config so server helpers
 * (requireAdmin, etc.) can call auth.api.getSession() directly.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@platform/db";
import * as schema from "@platform/db";

// Single-origin model: trust only the public origin (nginx) + explicit extras.
const CMS_URL = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000";

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
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
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

export type Auth = typeof auth;
