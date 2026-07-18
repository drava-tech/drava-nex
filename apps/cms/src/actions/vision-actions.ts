"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

export async function getVisionTriggerArmed(): Promise<boolean> {
  await requireAdmin();
  const res = await apiFetch<{ armed: boolean }>("/api/vision-trigger");
  if (!res.ok) {
    console.error("[vision] getVisionTriggerArmed failed", res.error);
    return false;
  }
  return res.data.armed;
}

export async function setVisionTriggerArmed(armed: boolean): Promise<boolean> {
  await requireAdmin();
  const res = await apiFetch<{ armed: boolean }>("/api/vision-trigger", {
    method: "POST",
    body: JSON.stringify({ armed }),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/visitors");
  return res.data.armed;
}
