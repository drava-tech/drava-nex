import React from "react";
import { notFound } from "next/navigation";
import { db, experience, eq, and, isNull } from "@platform/db";
import { requireAdmin } from "@/lib/auth-helpers";
import { isTemplateKey, type TemplateKey } from "@/lib/templates";
import { TEMPLATE_DEFINITIONS } from "@/templates/definitions";
import { readPortfolioContent } from "@platform/ui/templates/portfolio";
import { readLiveStreamContent } from "@platform/ui/templates/live-stream";
import { readProductShowcaseContent } from "@platform/ui/templates/product-showcase";
import { readWelcomeContent } from "@platform/ui/templates/welcome";
import { readObjectRecognitionContent } from "@platform/ui/templates/object-recognition";
import { readFlightSimulationContent } from "@platform/ui/templates/flight-simulation";

/**
 * Per-template reader for the experience's saved content slice. Table-driven so
 * adding a template is one entry here (and one in @/templates/definitions) —
 * a missing entry is a compile error, not a silent fallback to another
 * template's content.
 */
const CONTENT_READERS: Record<
  TemplateKey,
  (templateContent: Record<string, unknown> | null | undefined) => unknown | null
> = {
  portfolio: readPortfolioContent,
  "live-stream": readLiveStreamContent,
  "product-showcase": readProductShowcaseContent,
  welcome: readWelcomeContent,
  "object-recognition": readObjectRecognitionContent,
  "flight-simulation": readFlightSimulationContent,
};

interface EditPageProps {
  params: Promise<{ id: string }>;
}

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-screen h-screen flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 text-zinc-500 text-sm">
      {children}
    </div>
  );
}

/**
 * Full-tab content editor (opened from the CMS in a new tab). Chrome-free (root
 * layout only). Renders the assigned template's editor Workspace.
 */
export default async function ExperienceEditPage({ params }: EditPageProps) {
  await requireAdmin();
  const { id } = await params;

  const [exp] = await db
    .select()
    .from(experience)
    .where(and(eq(experience.slug, id), isNull(experience.deletedAt)))
    .limit(1);

  if (!exp) notFound();

  const key = isTemplateKey(exp.templateKey) ? exp.templateKey : null;
  if (!key) return <FullScreenMessage>Assign a template to this experience first.</FullScreenMessage>;

  const def = TEMPLATE_DEFINITIONS[key];
  const Workspace = def.Workspace;
  if (!Workspace) return <FullScreenMessage>This template has no content editor.</FullScreenMessage>;

  const initialContent =
    CONTENT_READERS[key](exp.templateContent) ?? def.defaultContent;

  return <Workspace experience={exp} initialContent={initialContent} />;
}
