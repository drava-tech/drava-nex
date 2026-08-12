import { notFound } from "next/navigation";
import { db, screen, experience, eq, and, isNull, getScreenContent } from "@platform/db";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getExperiences } from "@/actions/project-actions";
import { getScreens, getActiveScreens } from "@/actions/screen-actions";
import { LiveExperienceControlView } from "../_components/live-experience-control-view";

interface PageProps {
  params: Promise<{ experienceId: string; deviceId: string }>;
}

/**
 * Premium, experience-scoped live control workspace at
 * /experiences/<experienceId>/live/<deviceId> (deviceId = a screen's
 * screenId). Reached from the Experiences grid's "Control" action. Mirrors
 * the exact same live screen as /screens/<deviceId> — this route only adds
 * the experience-scoped header/switcher and a more premium skin around the
 * shared control primitives (see LiveExperienceControlView).
 */
export default async function LiveExperienceControlPage({ params }: PageProps) {
  await requireGuestOrAdmin();
  const { experienceId, deviceId } = await params;

  const [experienceRow] = await db
    .select({ id: experience.id, name: experience.name })
    .from(experience)
    .where(and(eq(experience.id, experienceId), isNull(experience.deletedAt)))
    .limit(1);
  if (!experienceRow) notFound();

  const [screenRow] = await db
    .select({
      screenName: screen.screenName,
      blanked: screen.blanked,
      interactionEnabled: screen.interactionEnabled,
      currentQueueMediaIds: screen.currentQueueMediaIds,
      currentQueueIndex: screen.currentQueueIndex,
    })
    .from(screen)
    .where(and(eq(screen.screenId, deviceId), isNull(screen.deletedAt)))
    .limit(1);
  if (!screenRow) notFound();

  const [experiences, content, allScreens, activeScreenIds] = await Promise.all([
    getExperiences(),
    getScreenContent(deviceId),
    getScreens(),
    getActiveScreens(),
  ]);

  // Other screens currently showing this same experience — feeds the header
  // switcher. The active screen is excluded here; the switcher always shows
  // it first using the live (WS-derived) online state instead.
  const liveScreens = allScreens
    .filter(
      (s) =>
        s.screenId !== deviceId &&
        s.currentContentKind === "experience" &&
        s.currentExperienceId === experienceId
    )
    .map((s) => ({
      screenId: s.screenId,
      screenName: s.screenName,
      isOnline: activeScreenIds.includes(s.screenId),
    }));

  return (
    <LiveExperienceControlView
      experienceId={experienceRow.id}
      experienceName={experienceRow.name}
      deviceId={deviceId}
      screenName={screenRow.screenName}
      experiences={experiences}
      initialBlanked={screenRow.blanked}
      initialInteractionEnabled={screenRow.interactionEnabled}
      initialShowTouchpad={content?.type === "html"}
      initialQueueMediaIds={screenRow.currentQueueMediaIds ?? undefined}
      initialQueueIndex={screenRow.currentQueueIndex ?? undefined}
      liveScreens={liveScreens}
    />
  );
}
