import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { getVerticals } from "@/lib/projects";
import { ProjectsDashboardContainer } from "./_components/projects-dashboard-container";

export default async function ProjectsPage() {
  const [user, verticals] = await Promise.all([requireAdmin(), getVerticals()]);
  return (
    <div className="flex flex-1 flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black h-0 overflow-hidden">
      <ProjectsDashboardContainer user={user} verticals={verticals} />
    </div>
  );
}
