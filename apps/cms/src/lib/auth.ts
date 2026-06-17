import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@platform/db";
import * as schema from "@platform/db";
import os from "os";

// Helper to get local network IP origins during development
function getLocalNetworkOrigins(port: string | number = 3000): string[] {
  const origins: string[] = [];
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const netInterface = interfaces[name];
      if (netInterface) {
        for (const net of netInterface) {
          if (net.family === "IPv4" && !net.internal) {
            origins.push(`http://${net.address}:${port}`);
          }
        }
      }
    }
  } catch (error) {
    // Fallback quietly if any network API error occurs
  }
  return origins;
}

const localOrigins = process.env.NODE_ENV === "development"
  ? getLocalNetworkOrigins(process.env.CMS_PORT || 3000)
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
        input: false, // never accept role from client input
      },
    },
  },
  secret: process.env["BETTER_AUTH_SECRET"]!,
  baseURL: process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
  trustedOrigins: [
    process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
    ...localOrigins,
    ...(process.env["BETTER_AUTH_TRUSTED_ORIGINS"]
      ?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? []),
  ],
});

export type Auth = typeof auth;
