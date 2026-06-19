import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { db, experience, isNull } from "@platform/db";
import { asc, desc } from "drizzle-orm";
import { ProjectsList } from "./_components/projects-list";

export default async function ProjectsPage() {
  await requireAdmin();
  const experiences = await db
    .select()
    .from(experience)
    .where(isNull(experience.deletedAt))
    .orderBy(asc(experience.position), desc(experience.createdAt));

  return (
    <div className="flex flex-1 flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black overflow-y-auto">
      <ProjectsList projects={experiences} />
    </div>
  );
}
