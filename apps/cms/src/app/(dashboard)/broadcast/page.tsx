import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getScreens, getActiveScreens } from "@/actions/screen-actions";
import { getExperiences } from "@/actions/project-actions";
import { getExperienceTypes } from "@/actions/experience-type-actions";
import { getScreenGroups } from "@/actions/screen-group-actions";
import { PublishBoard } from "./_components/publish-board";

/**
 * Tablet-oriented "drag a card onto the screen box to publish it" page —
 * an alternative to the checkbox-list ScreenAssignmentPicker/PushToScreenModal
 * flow for rapid-fire pushing across several screens in one sitting.
 */
/** The 86" TV is listed first so the board opens on it; the arrows page to the rest. */
const PRIMARY_SCREEN_NAME = "tv-86inch";

const isPrimary = (screenName: string) =>
  screenName.trim().toLowerCase() === PRIMARY_SCREEN_NAME;

export default async function BroadcastPage() {
  await requireGuestOrAdmin();
  const [allScreens, activeScreenIds, experiences, experienceTypes, screenGroups] = await Promise.all([
    getScreens(),
    getActiveScreens(),
    getExperiences(),
    getExperienceTypes(),
    // A missing groups table (an unmigrated database) just means no group dropdown.
    getScreenGroups().catch(() => []),
  ]);
  // Stable sort: only moves the TV to the front, the rest keep listScreens() order.
  const screens = [...allScreens].sort(
    (a, b) => Number(isPrimary(b.screenName)) - Number(isPrimary(a.screenName))
  );

  return (
    <div className="flex h-[calc(100vh-5rem)] min-h-0 flex-col overflow-hidden bg-zinc-100 dark:bg-transparent">
      <PublishBoard
        initialScreens={screens}
        initialActiveScreenIds={activeScreenIds}
        experiences={experiences}
        experienceTypes={experienceTypes}
        screenGroups={screenGroups}
      />
    </div>
  );
}
