import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { db, experience, eq, and, isNull } from "@platform/db";
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

  const [dbExperience] = await db
    .select()
    .from(experience)
    .where(and(eq(experience.slug, id), isNull(experience.deletedAt)))
    .limit(1);

  if (!dbExperience) notFound();

  return (
    <div className="flex flex-1 flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black h-0 overflow-hidden">
      <ProjectRouter project={dbExperience} subpath={subpath} />
    </div>
  );
}
