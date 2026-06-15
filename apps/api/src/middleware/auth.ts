import { db, sql } from "@platform/db";
import type { Context, Next } from "hono";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "GUEST";
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

async function verifySession(c: Context): Promise<SessionUser | null> {
  const cookieHeader = c.req.header("cookie") ?? "";

  const match =
    cookieHeader.match(/better-auth\.session_token=([^;]+)/) ??
    cookieHeader.match(/__Secure-better-auth\.session_token=([^;]+)/);

  if (!match || !match[1]) return null;

  const token = decodeURIComponent(match[1]);

  // Use raw SQL to avoid drizzle ESM/CJS type conflicts in this ESM package.
  const result = await db.execute<SessionUser>(sql`
    SELECT u.id, u.name, u.email, u.role,
           u.email_verified AS "emailVerified",
           u.image, u.created_at AS "createdAt", u.updated_at AS "updatedAt"
    FROM "session" s
    JOIN "user" u ON s.user_id = u.id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
    LIMIT 1
  `);

  return (result.rows[0] as SessionUser | undefined) ?? null;
}

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const currentUser = await verifySession(c);
  if (!currentUser) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", currentUser);
  return next();
}

export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  const currentUser = await verifySession(c);
  if (!currentUser) return c.json({ error: "Unauthorized" }, 401);
  if (currentUser.role !== "ADMIN") return c.json({ error: "Forbidden" }, 403);
  c.set("user", currentUser);
  return next();
}

export async function requireGuestOrAdmin(c: Context, next: Next): Promise<Response | void> {
  const currentUser = await verifySession(c);
  if (!currentUser) return c.json({ error: "Unauthorized" }, 401);
  if (currentUser.role !== "ADMIN" && currentUser.role !== "GUEST") {
    return c.json({ error: "Forbidden" }, 403);
  }
  c.set("user", currentUser);
  return next();
}
