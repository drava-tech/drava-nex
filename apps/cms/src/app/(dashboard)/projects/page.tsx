import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { ProjectsContainer } from "./_components/projects-container";

export default async function ProjectsPage() {
  const user = await requireAdmin();
  return (
    <div className="flex flex-1 flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black h-full">
      <ProjectsContainer user={user} projectId="experience-center" />
    </div>
  );
}
