import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getScreens, getActiveScreens } from "@/actions/screen-actions";
import { BrowserView } from "./_components/browser-view";

/**
 * Paste a link, pick screens, send — the routed replacement for the
 * AddLinkDialog -> PushToScreenModal popup chain. Landing state: no screen
 * live yet. See /browser/live/[screenId] for the post-send state.
 */
export default async function BrowserPage() {
  await requireGuestOrAdmin();
  const [screens, activeScreenIds] = await Promise.all([getScreens(), getActiveScreens()]);

  return <BrowserView screens={screens} activeScreenIds={activeScreenIds} />;
}
