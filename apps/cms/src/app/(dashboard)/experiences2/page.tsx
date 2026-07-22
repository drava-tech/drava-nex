import React from "react";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { db, experience, experienceToType, isNull } from "@platform/db";
import { asc, desc } from "drizzle-orm";
// Experience 2 — variant of the experiences grid (see projects-list-2).
import { ProjectsList2 } from "../experiences/_components/projects-list-2";
import { getExperienceTypes } from "@/actions/experience-type-actions";
import { extractCoverImage } from "@/lib/extract-cover-image";

export default async function ProjectsPage2() {
  const user = await requireGuestOrAdmin();
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";

  const [experiences, experienceTypes, assignments] = await Promise.all([
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
    coverImage: extractCoverImage(exp.templateContent),
  }));

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <ProjectsList2
        projects={projects}
        isAdmin={isAdmin}
        experienceTypes={experienceTypes}
      />
    </div>
  );
}
