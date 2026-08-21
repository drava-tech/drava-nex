import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getScreens, getActiveScreens } from "@/actions/screen-actions";
import { getExperiences } from "@/actions/project-actions";
import { PublishBoard } from "./_components/publish-board";

/**
 * Tablet-oriented "drag a card onto the screen box to publish it" page —
 * an alternative to the checkbox-list ScreenAssignmentPicker/PushToScreenModal
 * flow for rapid-fire pushing across several screens in one sitting.
 */
export default async function PublishPage() {
  await requireGuestOrAdmin();
  const [screens, experiences, activeScreenIds] = await Promise.all([
    getScreens(),
    getExperiences(),
    getActiveScreens(),
  ]);

  return (
    <div className="flex h-[calc(100vh-5rem)] min-h-0 flex-col overflow-hidden bg-zinc-100 dark:bg-transparent">
      <PublishBoard
        initialScreens={screens}
        initialActiveScreenIds={activeScreenIds}
        experiences={experiences}
      />
    </div>
  );
}
