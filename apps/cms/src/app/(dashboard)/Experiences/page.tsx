import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { db, project, isNull } from "@platform/db";
import { desc } from "drizzle-orm";
import { ProjectsList } from "./_components/projects-list";

export default async function ProjectsPage() {
  await requireAdmin();
  const projects = await db
    .select()
    .from(project)
    .where(isNull(project.deletedAt))
    .orderBy(desc(project.createdAt));

  return (
    <div className="flex flex-1 flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black overflow-y-auto">
      <ProjectsList projects={projects} />
    </div>
  );
}
