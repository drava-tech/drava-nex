import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { db, project, eq, and, isNull } from "@platform/db";
import { notFound } from "next/navigation";
import { ProjectRouter } from "./_components/project-router";

interface ProjectPageProps {
  params: Promise<{
    id: string;
    subpath?: string[];
  }>;
}

export default async function ProjectDetailPage({ params }: ProjectPageProps) {
  await requireAdmin();
  const { id, subpath = [] } = await params;

  const [dbProject] = await db
    .select()
    .from(project)
    .where(and(eq(project.slug, id), isNull(project.deletedAt)))
    .limit(1);

  if (!dbProject) notFound();

  return (
    <div className="flex flex-1 flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black h-0 overflow-hidden">
      <ProjectRouter project={dbProject} subpath={subpath} />
    </div>
  );
}
