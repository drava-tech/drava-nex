import React from "react";
import { notFound } from "next/navigation";
import { db, experience, eq, and, isNull } from "@platform/db";
import { requireAdmin } from "@/lib/auth-helpers";
import { isTemplateKey } from "@/lib/templates";
import { TEMPLATE_DEFINITIONS } from "@/templates/definitions";

interface PreviewPageProps {
  params: Promise<{ id: string; subpath?: string[] }>;
}

/**
 * Full-screen, chrome-free preview of an experience's template — opened in a new
 * tab from the CMS. Renders the assigned template's active view scaled to fit the
 * whole window (mode="preview"), so you see it the way it looks on the screen.
 */
export default async function ExperiencePreviewPage({ params }: PreviewPageProps) {
  await requireAdmin();
  const { id, subpath = [] } = await params;

  const [exp] = await db
    .select()
    .from(experience)
    .where(and(eq(experience.slug, id), isNull(experience.deletedAt)))
    .limit(1);

  if (!exp) notFound();

  const key = isTemplateKey(exp.templateKey) ? exp.templateKey : null;
  if (!key) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-black text-white/50 text-sm">
        No template assigned to this experience.
      </div>
    );
  }

  const Layout = TEMPLATE_DEFINITIONS[key].Layout;
  return (
    <div className="w-screen h-screen bg-black overflow-hidden">
      <Layout experience={exp} subpath={subpath} mode="preview" />
    </div>
  );
}
