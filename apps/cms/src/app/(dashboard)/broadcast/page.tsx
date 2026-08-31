import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getScreens } from "@/actions/screen-actions";
import { getExperiences } from "@/actions/project-actions";
import { getExperienceTypes } from "@/actions/experience-type-actions";
import { PublishBoard } from "./_components/publish-board";

/**
 * Tablet-oriented "drag a card onto the screen box to publish it" page —
 * an alternative to the checkbox-list ScreenAssignmentPicker/PushToScreenModal
 * flow for rapid-fire pushing across several screens in one sitting.
 */
/** This page targets only the 86" TV — not every registered screen. */
const BROADCAST_TARGET_SCREEN_NAME = "tv-86inch";

export default async function BroadcastPage() {
  await requireGuestOrAdmin();
  const [allScreens, experiences, experienceTypes] = await Promise.all([
    getScreens(),
    getExperiences(),
    getExperienceTypes(),
  ]);
  const screens = allScreens.filter(
    (s) => s.screenName.trim().toLowerCase() === BROADCAST_TARGET_SCREEN_NAME
  );

  return (
    <div className="flex h-[calc(100vh-5rem)] min-h-0 flex-col overflow-hidden bg-zinc-100 dark:bg-transparent">
      <PublishBoard initialScreens={screens} experiences={experiences} experienceTypes={experienceTypes} />
    </div>
  );
}
