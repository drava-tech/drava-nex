import { requireGuestOrAdmin, getCurrentUser } from "@/lib/auth-helpers";
import { ScreensController } from "./_components/screens-controller";

export default async function ScreensPage() {
  await requireGuestOrAdmin();
  const currentUser = await getCurrentUser();
  const role = (currentUser as { role?: string } | null)?.role;

  return (
    <div className="flex flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black h-[calc(100vh-5rem)] min-h-0 overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 shrink-0 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Exhibition Screens</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {role === "ADMIN"
              ? "Monitor status, adjust volume/brightness, and change playbacks for all display screens."
              : "View active screen content assigned to you."}
          </p>
        </div>
      </div>
      <ScreensController />
    </div>
  );
}
