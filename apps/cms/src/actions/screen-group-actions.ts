"use server";

import { revalidatePath } from "next/cache";
import { listScreenGroups, type ScreenGroupRow } from "@platform/db";
import { apiFetch } from "@/lib/api-client";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";

// Reads stay direct (DB); mutations go through the Hono API, as in
// screen-actions.ts. Each returns { success, error } so the Screens page can
// show the API's message (e.g. a duplicate name) inline.

type Result = { success: true } | { success: false; error: string };

function done(res: { ok: boolean; error?: { message: string } }): Result {
  if (!res.ok) return { success: false, error: res.error?.message ?? "Something went wrong." };
  revalidatePath("/screens");
  return { success: true };
}

export async function getScreenGroups(): Promise<ScreenGroupRow[]> {
  await requireGuestOrAdmin();
  return listScreenGroups();
}

export async function createScreenGroup(name: string, screenIds: string[] = []): Promise<Result> {
  await requireAdmin();
  const res = await apiFetch<{ id: string }>(`/api/screen-groups`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return done(res);
  if (screenIds.length > 0 && res.data) {
    return done(
      await apiFetch(`/api/screen-groups/${encodeURIComponent(res.data.id)}/screens`, {
        method: "PUT",
        body: JSON.stringify({ screenIds }),
      })
    );
  }
  return done(res);
}

export async function renameScreenGroup(id: string, name: string): Promise<Result> {
  await requireAdmin();
  return done(
    await apiFetch(`/api/screen-groups/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    })
  );
}

export async function deleteScreenGroup(id: string): Promise<Result> {
  await requireAdmin();
  return done(await apiFetch(`/api/screen-groups/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function setScreenGroupMembers(id: string, screenIds: string[]): Promise<Result> {
  await requireAdmin();
  return done(
    await apiFetch(`/api/screen-groups/${encodeURIComponent(id)}/screens`, {
      method: "PUT",
      body: JSON.stringify({ screenIds }),
    })
  );
}

export async function moveScreenToGroup(screenId: string, groupId: string | null): Promise<Result> {
  await requireAdmin();
  return done(
    await apiFetch(`/api/screen-groups/screen/${encodeURIComponent(screenId)}`, {
      method: "PUT",
      body: JSON.stringify({ groupId }),
    })
  );
}
