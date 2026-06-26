"use server";

import { db } from "@platform/db";
import { user } from "@platform/db";
import { eq } from "@platform/db";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { auth } from "@/lib/auth";

export async function createUser(
  name: string,
  email: string,
  password: string,
  role: "ADMIN" | "GUEST"
) {
  await requireAdmin();

  const result = await auth.api.signUpEmail({
    body: { email, password, name },
  });

  if (!result?.user) {
    throw new Error("Failed to create user.");
  }

  if (role === "ADMIN") {
    await db
      .update(user)
      .set({ role: "ADMIN" })
      .where(eq(user.id, result.user.id));
  }

  revalidatePath("/users");
  return result.user.id;
}

export async function deleteUser(targetUserId: string) {
  const currentUser = await requireAdmin();

  if (currentUser.id === targetUserId) {
    throw new Error("You cannot delete your own account.");
  }

  const target = await db.query.user.findFirst({
    where: eq(user.id, targetUserId),
  });

  if (target?.role === "SUPERADMIN") {
    throw new Error("The super admin account cannot be deleted.");
  }

  await db.delete(user).where(eq(user.id, targetUserId));
  revalidatePath("/users");
}
