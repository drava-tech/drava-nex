import { notFound } from "next/navigation";
import { getScreenLiveRow, getScreenContent } from "@platform/db";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getExperiences } from "@/actions/project-actions";
import { LiveScreenSurface } from "@/components/live-screen-surface";

interface PageProps {
  // deviceId = a screen's screenId, same convention as the other
  // .../live/[deviceId] routes (media, experiences, browser).
  params: Promise<{ deviceId: string }>;
}

/**
 * Live control page landed on right after publishing from /broadcast — same
 * full-page surface as /screens/<screenId> (LiveScreenSurface), just kept
 * under the /broadcast route so the sidebar stays on "Broadcast" instead of
 * jumping over to "Screens".
 */
export default async function BroadcastLivePage({ params }: PageProps) {
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
      changeContent={{
        experiences,
        defaultMediaAssetId: row.defaultMediaAssetId,
        defaultMediaName: row.defaultMediaName,
      }}
      initialContent={content ? { id: content.id, type: content.type, source: content.source } : null}
      backHref="/broadcast"
    />
  );
}
