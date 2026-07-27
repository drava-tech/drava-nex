import { requireAdmin } from "@/lib/auth-helpers";
import { BrowserView } from "./_components/browser-view";

/**
 * An in-app browser for opening any link without leaving the CMS. Admin-only:
 * unlike the other dashboard pages it isn't scoped to platform content, so it
 * stays out of guest mode.
 */
export default async function BrowserPage() {
  await requireAdmin();

  return (
    <div className="flex h-[calc(100vh-5rem)] min-h-0 flex-col overflow-hidden bg-zinc-100 dark:bg-black">
      <BrowserView />
    </div>
  );
}
