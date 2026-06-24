import React from "react";
import { notFound } from "next/navigation";
import { db, experience, eq, and, isNull } from "@platform/db";
import { requireAdmin } from "@/lib/auth-helpers";
import { isTemplateKey } from "@/lib/templates";
import { TEMPLATE_DEFINITIONS } from "@/templates/definitions";
import {
  DEFAULT_PORTFOLIO_CONTENT,
  readPortfolioContent,
} from "@platform/ui/templates/portfolio";
import {
  DEFAULT_LIVE_STREAM_CONTENT,
  readLiveStreamContent,
} from "@platform/ui/templates/live-stream";

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
    key === "live-stream"
      ? readLiveStreamContent(exp.templateContent) ?? DEFAULT_LIVE_STREAM_CONTENT
      : readPortfolioContent(exp.templateContent) ?? DEFAULT_PORTFOLIO_CONTENT;
  return <Workspace experience={exp} initialContent={initialContent} />;
}
