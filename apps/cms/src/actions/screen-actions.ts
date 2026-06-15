"use server";

import { readScreensJson, writeScreensJson } from "../lib/config-writer";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";

export async function assignContent(screenId: string, contentId: string) {
  await requireGuestOrAdmin();

  const config = await readScreensJson();

  config.screens = config.screens.map((s: { screenId: string; screenName: string; contentId: string }) =>
    s.screenId === screenId ? { ...s, contentId } : s
  );

  await writeScreensJson(config);
  revalidatePath("/screens");
  revalidatePath("/");
}

export async function addScreen(screenId: string, screenName: string, contentId: string) {
  await requireAdmin();

  const config = await readScreensJson();

  if (config.screens.some((s: { screenId: string }) => s.screenId === screenId)) {
    throw new Error(`Screen ID "${screenId}" already exists.`);
  }

  config.screens.push({ screenId, screenName, contentId });
  await writeScreensJson(config);
  revalidatePath("/screens");
  revalidatePath("/");
}

export async function removeScreen(screenId: string) {
  await requireAdmin();

  const config = await readScreensJson();
  config.screens = config.screens.filter(
    (s: { screenId: string }) => s.screenId !== screenId
  );
  await writeScreensJson(config);
  revalidatePath("/screens");
  revalidatePath("/");
}
