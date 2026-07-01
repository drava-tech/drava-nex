import { eq } from "drizzle-orm";
import { db } from "../client.js";
import { user, type User } from "../schema/auth.js";

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
