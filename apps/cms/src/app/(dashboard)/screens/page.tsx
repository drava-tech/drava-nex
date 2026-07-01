import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getScreens, getActiveScreens } from "@/actions/screen-actions";
import { getExperiences } from "@/actions/project-actions";
import { ScreensController } from "./_components/screens-controller";

export default async function ScreensPage() {
  const user = await requireGuestOrAdmin();
  const [screens, experiences, activeScreenIds] = await Promise.all([
    getScreens(),
    getExperiences(),
    getActiveScreens(),
  ]);
  const role = (user as { role?: string }).role;
  const isAdmin = role === "ADMIN" || role === "SUPERADMIN";

  return (
    <div className="flex flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black h-[calc(100vh-5rem)] min-h-0 overflow-hidden">
      <ScreensController
        initialScreens={screens}
        isAdmin={isAdmin}
        experiences={experiences}
        initialActiveScreenIds={activeScreenIds}
      />
    </div>
  );
}
