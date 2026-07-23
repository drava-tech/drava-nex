"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";
import type { VisitorListItem } from "@platform/types";

export async function updateVisitor(
  uuid: string,
  input: { name?: string; email?: string }
) {
  await requireAdmin();
  const res = await apiFetch<VisitorListItem>(
    `/api/visitors/${encodeURIComponent(uuid)}`,
    { method: "PATCH", body: JSON.stringify(input) }
  );
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/visitors");
  return res.data;
}

/** Staff adds a guest manually — no camera scan, so no embedding is enrolled. */
export async function createVisitor(input: { name: string; email?: string; photoUrl?: string }) {
  await requireAdmin();
  const res = await apiFetch<VisitorListItem>("/api/visitors", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/visitors");
  return res.data;
}
