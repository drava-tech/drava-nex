import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { ProjectsContainer } from "../_components/projects-container";

interface ProjectPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ProjectDetailPage({ params }: ProjectPageProps) {
  const user = await requireAdmin();
  const { id } = await params;

  return (
    <div className="flex flex-1 flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black h-full">
      <ProjectsContainer user={user} projectId={id} />
    </div>
  );
}
