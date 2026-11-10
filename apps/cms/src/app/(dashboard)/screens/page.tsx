import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getScreens, getActiveScreens, getActiveWhiteboardSessions } from "@/actions/screen-actions";
import { getExperiences } from "@/actions/project-actions";
import { getScreenGroups } from "@/actions/screen-group-actions";
import { ScreensController } from "./_components/screens-controller";

export default async function ScreensPage() {
  const user = await requireGuestOrAdmin();
  const [screens, experiences, activeScreenIds, activeWhiteboards, groups] = await Promise.all([
    getScreens(),
    getExperiences(),
    getActiveScreens(),
    getActiveWhiteboardSessions(),
    getScreenGroups(),
  ]);
  const role = (user as { role?: string }).role;
  const isAdmin = role === "ADMIN" || role === "SUPERADMIN";

  return (
    <div className="flex flex-col bg-zinc-100 dark:bg-transparent h-[calc(100vh-5rem)] min-h-0 overflow-hidden">
      <ScreensController
        initialScreens={screens}
        isAdmin={isAdmin}
        experiences={experiences}
        initialActiveScreenIds={activeScreenIds}
        activeWhiteboards={activeWhiteboards}
        groups={groups}
      />
    </div>
  );
}
