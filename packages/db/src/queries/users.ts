import { asc, eq, sql } from "drizzle-orm";
import { db } from "../client.js";
import { session, user, type User } from "../schema/auth.js";

export async function getUserById(id: string): Promise<User | null> {
  const [row] = await db.select().from(user).where(eq(user.id, id)).limit(1);
  return row ?? null;
}

export async function setUserRole(id: string, role: "ADMIN" | "GUEST" | "SUPERADMIN"): Promise<void> {
  await db.update(user).set({ role, updatedAt: new Date() }).where(eq(user.id, id));
}

export async function deleteUserById(id: string): Promise<void> {
  await db.delete(user).where(eq(user.id, id));
}

export interface UserListRow {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "GUEST" | "SUPERADMIN";
  createdAt: string;
  /** When they last used the CMS (their newest session's last refresh); null = never signed in. */
  lastActiveAt: string | null;
}

/** Everyone who can sign in, oldest first, with when they were last active. */
export async function listUsers(): Promise<UserListRow[]> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      lastActiveAt: sql<Date | null>`max(${session.updatedAt})`,
    })
    .from(user)
    .leftJoin(session, eq(session.userId, user.id))
    .groupBy(user.id)
    .orderBy(asc(user.createdAt));
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt).toISOString() : null,
  }));
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(sql`lower(${user.email}) = lower(${email})`)
    .limit(1);
  return row ?? null;
}

/** Sign someone out everywhere (after a role change or a new password). */
export async function deleteUserSessions(userId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId));
}
