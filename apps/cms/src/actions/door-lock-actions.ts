"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

export async function toggleDoorLock(action: "locked" | "unlocked") {
  await requireAdmin();
  const res = await apiFetch<{ success: boolean }>(
    "/api/door-events/toggle",
    {
      method: "POST",
      body: JSON.stringify({ action }),
    }
  );
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/door-lock");
  return res.data;
}
