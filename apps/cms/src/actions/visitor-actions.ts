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

export async function mergeVisitor(sourceUuid: string, targetUuid: string) {
  await requireAdmin();
  const res = await apiFetch<VisitorListItem>(
    `/api/visitors/${encodeURIComponent(sourceUuid)}/merge`,
    { method: "POST", body: JSON.stringify({ targetUuid }) }
  );
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/visitors");
  return res.data;
}

export async function listVisitorPhotos(uuid: string): Promise<number[]> {
  await requireAdmin();
  const res = await apiFetch<{ photos: number[] }>(
    `/api/visitors/${encodeURIComponent(uuid)}/photos`
  );
  if (!res.ok) throw new Error(res.error.message);
  return res.data.photos;
}

export async function deleteVisitorPhoto(uuid: string, photoNumber: number) {
  await requireAdmin();
  const res = await apiFetch(
    `/api/visitors/${encodeURIComponent(uuid)}/photos/${photoNumber}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/visitors");
}
