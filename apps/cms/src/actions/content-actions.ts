"use server";

import { readContentsJson, writeContentsJson } from "../lib/config-writer";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";

export async function addContent(
  id: string,
  source: string,
  loop: boolean,
  muted: boolean
) {
  await requireAdmin();

  const config = await readContentsJson();

  if (config.contents.some((c: { id: string }) => c.id === id)) {
    throw new Error(`Content ID "${id}" already exists.`);
  }

  config.contents.push({ id, type: "video", source, loop, muted });
  await writeContentsJson(config);
  revalidatePath("/contents");
  revalidatePath("/screens");
  revalidatePath("/");
}

export async function removeContent(id: string) {
  await requireAdmin();

  const config = await readContentsJson();
  config.contents = config.contents.filter(
    (c: { id: string }) => c.id !== id
  );
  await writeContentsJson(config);
  revalidatePath("/contents");
  revalidatePath("/screens");
  revalidatePath("/");
}
