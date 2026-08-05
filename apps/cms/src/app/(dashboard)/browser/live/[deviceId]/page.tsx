import { notFound } from "next/navigation";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getScreens, getActiveScreens } from "@/actions/screen-actions";
import { BrowserView } from "../../_components/browser-view";

interface PageProps {
  // deviceId = a screen's screenId — same convention as
  // experiences/[experienceId]/live/[deviceId].
  params: Promise<{ deviceId: string }>;
}

/** Post-send state of /browser: same link-picker + screen-list on the left,
 * the big touchpad now live on the right for the screen just pushed to. */
export default async function BrowserLivePage({ params }: PageProps) {
  await requireGuestOrAdmin();
  const { deviceId } = await params;
  const [screens, activeScreenIds] = await Promise.all([getScreens(), getActiveScreens()]);

  if (!screens.some((s) => s.screenId === deviceId)) notFound();

  return <BrowserView screens={screens} activeScreenIds={activeScreenIds} deviceId={deviceId} />;
}
