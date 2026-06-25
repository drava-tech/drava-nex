import React from "react";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { db, experience, isNull } from "@platform/db";
import { asc, desc } from "drizzle-orm";
import { ProjectsList } from "./_components/projects-list";

export default async function ProjectsPage() {
  const user = await requireGuestOrAdmin();
  const isAdmin = user.role === "ADMIN";

  const experiences = await db
    .select()
    .from(experience)
    .where(isNull(experience.deletedAt))
    .orderBy(asc(experience.position), desc(experience.createdAt));

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <ProjectsList projects={experiences} isAdmin={isAdmin} />
    </div>
  );
}
