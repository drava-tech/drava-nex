import { notFound } from "next/navigation";
import { getScreenLiveRow, getScreenContent } from "@platform/db";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getExperiences } from "@/actions/project-actions";
import { LiveScreenSurface } from "@/components/live-screen-surface";

interface PageProps {
  // deviceId = a screen's screenId, same convention as
  // experiences/[experienceId]/live/[deviceId] and browser/live/[deviceId].
  params: Promise<{ deviceId: string }>;
}

/**
 * Routed live control for a media queue (or single item) just pushed from
 * the Media Library multi-select (see MediaQueuePushModal) — Next/Prev
 * through the queue, with the control surface (mirror vs touchpad)
 * switching per item as you step through it.
 */
export default async function MediaLivePage({ params }: PageProps) {
  await requireGuestOrAdmin();
  const { deviceId } = await params;

  const row = await getScreenLiveRow(deviceId);
  if (!row) notFound();

  const [experiences, content] = await Promise.all([getExperiences(), getScreenContent(deviceId)]);

  return (
    <LiveScreenSurface
      screenId={deviceId}
      screenName={row.screenName}
      initialBlanked={row.blanked}
      initialShowTouchpad={content?.type === "html"}
      queueMediaIds={row.currentQueueMediaIds ?? undefined}
      initialQueueIndex={row.currentQueueIndex ?? undefined}
      changeContent={{
        experiences,
        defaultMediaAssetId: row.defaultMediaAssetId,
        defaultMediaName: row.defaultMediaName,
      }}
    />
  );
}
