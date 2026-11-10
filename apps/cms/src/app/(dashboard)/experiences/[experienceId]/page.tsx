import { notFound } from "next/navigation";
import { db, experience, experienceToType, eq, and, isNull } from "@platform/db";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getExperienceTypes } from "@/actions/experience-type-actions";
import { getScreens, getActiveScreens } from "@/actions/screen-actions";
import { experienceCover } from "@/lib/extract-cover-image";
import { ExperienceDetailView } from "./_components/experience-detail-view";

interface PageProps {
  params: Promise<{ experienceId: string }>;
}

/**
 * Detail/hub page for one experience — status (is it live, and where),
 * quick links to Edit content / Preview / Control, and the metadata/delete
 * actions the Experiences grid's long-press menu also exposes. Reuses the
 * same modals/actions as the grid (EditExperienceModal, PushToScreenModal,
 * deleteProject) rather than duplicating them.
 */
export default async function ExperiencePage({ params }: PageProps) {
  const user = await requireGuestOrAdmin();
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
  const { experienceId } = await params;

  const [row] = await db
    .select()
    .from(experience)
    .where(and(eq(experience.id, experienceId), isNull(experience.deletedAt)))
    .limit(1);
  if (!row) notFound();

  const [typeAssignments, experienceTypes, screens, activeScreenIds] = await Promise.all([
    db
      .select({ typeId: experienceToType.typeId })
      .from(experienceToType)
      .where(eq(experienceToType.experienceId, experienceId)),
    getExperienceTypes(),
    getScreens(),
    getActiveScreens(),
  ]);

  const liveScreens = screens
    .filter((s) => s.currentContentKind === "experience" && s.currentExperienceId === experienceId)
    .map((s) => ({ screenId: s.screenId, screenName: s.screenName, isOnline: activeScreenIds.includes(s.screenId) }));

  return (
    <div className="flex flex-1 flex-col min-h-0 gap-4 overflow-hidden p-4">
      <ExperienceDetailView
        experience={{
          id: row.id,
          name: row.name,
          slug: row.slug,
          templateKey: row.templateKey,
          typeIds: typeAssignments.map((t) => t.typeId),
          coverImage: experienceCover(row.templateContent, row.templateKey),
          createdAt: row.createdAt.toISOString(),
        }}
        isAdmin={isAdmin}
        experienceTypes={experienceTypes}
        liveScreens={liveScreens}
      />
    </div>
  );
}
