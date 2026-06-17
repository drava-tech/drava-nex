import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { ScreensController } from "./_components/screens-controller";

export default async function ScreensPage() {
  await requireGuestOrAdmin();

  return (
    <div className="flex flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black h-[calc(100vh-5rem)] min-h-0 overflow-hidden">
      <ScreensController />
    </div>
  );
}
