import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { getVerticals } from "@/lib/projects";
import { ProjectRouter } from "./_components/project-router";

interface ProjectPageProps {
  params: Promise<{
    id: string;
    subpath?: string[];
  }>;
}

export default async function ProjectDetailPage({ params }: ProjectPageProps) {
  const [user, verticals] = await Promise.all([requireAdmin(), getVerticals()]);
  const { id, subpath = [] } = await params;

  return (
    <div className="flex flex-1 flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black h-0 overflow-hidden">
      <ProjectRouter user={user} projectId={id} subpath={subpath} verticals={verticals} />
    </div>
  );
}
