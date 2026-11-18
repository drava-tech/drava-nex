"use server";

import { and, desc, inArray, isNull, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, experience } from "@platform/db";
import { normalizeCanvasContent, readCanvasContent, type CanvasContent } from "@platform/ui/templates/canvas";
import { normalizeStoryContent, readStoryContent, type StoryContent } from "@platform/ui/templates/story";
import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

/**
 * Templates (sidebar) = experiences on the "canvas" (Design) and "story"
 * templates. Creating, editing and pushing go through the same experience API
 * every other template uses, so these push, schedule and appear in Our Story
 * like any experience. Reads stay direct, as in project-actions.ts.
 */

type Kind = "canvas" | "story";

interface CardBase {
  id: string;
  name: string;
  slug: string;
  updatedAt: string;
}

export type DesignCard =
  | (CardBase & { kind: "canvas"; pageCount: number; /** First page only. */ preview: CanvasContent })
  | (CardBase & { kind: "story"; appCount: number; /** Apps without their items — enough for the home tiles. */ preview: StoryContent });

export async function listDesigns(): Promise<DesignCard[]> {
  await requireAdmin();
  const rows = await db
    .select({
      id: experience.id,
      name: experience.name,
      slug: experience.slug,
      templateKey: experience.templateKey,
      updatedAt: experience.updatedAt,
      templateContent: experience.templateContent,
    })
    .from(experience)
    .where(and(inArray(experience.templateKey, ["canvas", "story"]), isNull(experience.deletedAt)))
    .orderBy(desc(experience.updatedAt));

  return rows.map((r): DesignCard => {
    const base = { id: r.id, name: r.name, slug: r.slug, updatedAt: r.updatedAt.toISOString() };
    if (r.templateKey === "story") {
      const s = readStoryContent(r.templateContent) ?? normalizeStoryContent(null);
      const apps = s.apps.map((a) => {
        switch (a.kind) {
          case "timeline":
            return { ...a, events: [] };
          case "map":
            return { ...a, pins: [] };
          case "showcase":
            return { ...a, items: [] };
          case "hotspots":
            return { ...a, hotspots: [] };
        }
      });
      return { ...base, kind: "story", appCount: s.apps.length, preview: { ...s, apps } };
    }
    const c = readCanvasContent(r.templateContent) ?? normalizeCanvasContent(null);
    return { ...base, kind: "canvas", pageCount: c.pages.length, preview: { ...c, pages: c.pages.slice(0, 1) } };
  });
}

function slugFor(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "design";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

type CreateResult = { success: true; slug: string } | { success: false; error: string };

async function createTemplated(kind: Kind, name: string, content: unknown, fallbackName: string): Promise<CreateResult> {
  const trimmed = name.trim() || fallbackName;
  const slug = slugFor(trimmed);
  const created = await apiFetch<{ id: string }>(`/api/experiences`, {
    method: "POST",
    body: JSON.stringify({ name: trimmed, slug, templateKey: kind, typeIds: [] }),
  });
  if (!created.ok) return { success: false, error: created.error.message };

  const saved = await apiFetch(`/api/experiences/${encodeURIComponent(created.data.id)}/content`, {
    method: "PATCH",
    body: JSON.stringify({ templateKey: kind, content }),
  });
  if (!saved.ok) return { success: false, error: saved.error.message };

  revalidatePath("/templates");
  revalidatePath("/experiences");
  return { success: true, slug };
}

export async function createDesign(name: string, content: CanvasContent): Promise<CreateResult> {
  await requireAdmin();
  return createTemplated("canvas", name, normalizeCanvasContent(content), "Untitled design");
}

export async function createStory(name: string, content: StoryContent): Promise<CreateResult> {
  await requireAdmin();
  return createTemplated("story", name, normalizeStoryContent(content), "Untitled story");
}

export async function duplicateDesign(id: string): Promise<CreateResult> {
  await requireAdmin();
  const [row] = await db
    .select({ name: experience.name, templateKey: experience.templateKey, templateContent: experience.templateContent })
    .from(experience)
    .where(and(eq(experience.id, id), isNull(experience.deletedAt)))
    .limit(1);
  if (!row) return { success: false, error: "Not found." };
  const name = `${row.name} (copy)`;
  if (row.templateKey === "story") {
    return createTemplated("story", name, readStoryContent(row.templateContent) ?? normalizeStoryContent(null), name);
  }
  return createTemplated("canvas", name, readCanvasContent(row.templateContent) ?? normalizeCanvasContent(null), name);
}

export async function deleteDesign(id: string): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const res = await apiFetch(`/api/experiences/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return { success: false, error: res.error.message };
  revalidatePath("/templates");
  revalidatePath("/experiences");
  return { success: true };
}
