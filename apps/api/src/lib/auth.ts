import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { db } from "@platform/db";
import * as schema from "@platform/db";
import os from "os";

function getLocalNetworkOrigins(port: string | number = 3000): string[] {
  const origins: string[] = [];
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (iface) {
        for (const net of iface) {
          if (net.family === "IPv4" && !net.internal) {
            origins.push(`http://${net.address}:${port}`);
          }
        }
      }
    }
  } catch { /* ignore */ }
  return origins;
}

// In local dev, auth lives on the same port as the CMS (3000 via proxy) so
// the browser client sees consistent origins. The base URL must match.
const CMS_URL = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000";

const localOrigins =
  process.env.NODE_ENV === "development"
    ? [
        ...getLocalNetworkOrigins(process.env["CMS_PORT"] ?? 3000),
        ...getLocalNetworkOrigins(process.env["API_PORT"] ?? 4000),
      ]
    : [];

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
  secret: process.env["BETTER_AUTH_SECRET"]!,
  baseURL: CMS_URL,
  trustedOrigins: [
    CMS_URL,
    ...localOrigins,
    ...(process.env["BETTER_AUTH_TRUSTED_ORIGINS"]
      ?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? []),
  ],
});
