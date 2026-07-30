"use server";

import { revalidatePath } from "next/cache";
import { listWhiteboardDocuments, getWhiteboardDocument as getWhiteboardDocumentDb } from "@platform/db";
import { apiFetch } from "@/lib/api-client";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import type { WhiteboardPageData } from "@/lib/whiteboard-canvas";

// Reads stay direct (Server Components / DB). Writes go through the Hono API so
// the same endpoint serves the browser, Unreal Engine, and mobile.

export async function listWhiteboards() {
  await requireGuestOrAdmin();
  return listWhiteboardDocuments();
}

export async function getWhiteboardDocument(id: string) {
  await requireGuestOrAdmin();
  return getWhiteboardDocumentDb(id);
}

export interface SavedWhiteboard {
  id: string;
  name: string;
  pages: WhiteboardPageData[];
  createdAt: string;
  updatedAt: string;
}

/** Create a new saved whiteboard. Returns its id. */
export async function createWhiteboard(name: string, pages: WhiteboardPageData[]): Promise<string> {
  await requireGuestOrAdmin();
  const res = await apiFetch<{ id: string }>("/api/whiteboards", {
    method: "POST",
    body: JSON.stringify({ name, pages }),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/whiteboards");
  return res.data.id;
}

/** Re-save an existing whiteboard (name and/or pages). */
export async function updateWhiteboard(
  id: string,
  updates: { name?: string; pages?: WhiteboardPageData[] }
): Promise<void> {
  await requireGuestOrAdmin();
  const res = await apiFetch(`/api/whiteboards/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/whiteboards");
}

export async function deleteWhiteboard(id: string): Promise<void> {
  await requireGuestOrAdmin();
  const res = await apiFetch(`/api/whiteboards/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/whiteboards");
}
