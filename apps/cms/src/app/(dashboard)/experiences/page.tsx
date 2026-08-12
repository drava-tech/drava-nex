import React from "react";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { db, experience, experienceToType, isNull } from "@platform/db";
import { asc, desc } from "drizzle-orm";
import { ProjectsList } from "./_components/projects-list";
import { getExperienceTypes } from "@/actions/experience-type-actions";
import { getScreens, getActiveScreens } from "@/actions/screen-actions";
import { extractCoverImage } from "@/lib/extract-cover-image";

export default async function ProjectsPage() {
  const user = await requireGuestOrAdmin();
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";

  const [experiences, experienceTypes, assignments, screens, activeScreenIds] = await Promise.all([
    db
      .select()
      .from(experience)
      .where(isNull(experience.deletedAt))
      .orderBy(asc(experience.position), desc(experience.createdAt)),
    getExperienceTypes(),
    db
      .select({
        experienceId: experienceToType.experienceId,
        typeId: experienceToType.typeId,
      })
      .from(experienceToType),
    getScreens(),
    getActiveScreens(),
  ]);

  const typeIdsByExperience = new Map<string, string[]>();
  for (const { experienceId, typeId } of assignments) {
    const list = typeIdsByExperience.get(experienceId);
    if (list) list.push(typeId);
    else typeIdsByExperience.set(experienceId, [typeId]);
  }

  const projects = experiences.map((exp) => ({
    ...exp,
    typeIds: typeIdsByExperience.get(exp.id) ?? [],
    // Resolved server-side so the showcase pills can render a thumbnail
    // without a dedicated coverImage column.
    coverImage: extractCoverImage(exp.templateContent),
  }));

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-[#050310] p-6 font-['Satoshi',sans-serif]">
      <ProjectsList
        projects={projects}
        isAdmin={isAdmin}
        experienceTypes={experienceTypes}
        screens={screens}
        initialActiveScreenIds={activeScreenIds}
      />
    </div>
  );
}
