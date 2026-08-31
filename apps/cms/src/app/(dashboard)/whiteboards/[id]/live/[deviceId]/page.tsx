import { notFound } from "next/navigation";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getWhiteboardDocument } from "@/actions/whiteboard-actions";
import { getScreens, getActiveScreens } from "@/actions/screen-actions";
import { WhiteboardOverlay } from "../../../../_components/whiteboard/whiteboard-overlay";

interface PageProps {
  // deviceId = a screen's screenId — same convention as
  // experiences/[experienceId]/live/[deviceId], media/live/[deviceId], and
  // browser/live/[deviceId].
  params: Promise<{ id: string; deviceId: string }>;
}

/**
 * Routed live-push state for one saved whiteboard — /whiteboards/<id>/live/<deviceId>.
 * Reached after picking a screen in PushToScreenModal (see
 * WhiteboardOverlay.handleSelectPushTarget), which auto-saves the board first
 * so this page always has a real document to load. Renders the same embedded
 * editor as /whiteboards/<id>, just auto-resuming the live session against
 * deviceId on mount (via initialPushTarget) instead of showing the screen
 * picker again.
 */
export default async function WhiteboardLivePage({ params }: PageProps) {
  await requireGuestOrAdmin();
  const { id, deviceId } = await params;

  const [doc, screens, activeScreenIds] = await Promise.all([
    getWhiteboardDocument(id),
    getScreens(),
    getActiveScreens(),
  ]);
  if (!doc) notFound();

  const screenRow = screens.find((s) => s.screenId === deviceId);
  if (!screenRow) notFound();

  return (
    <WhiteboardOverlay
      variant="embedded"
      initialDocumentId={id}
      initialPushTarget={{
        screenId: deviceId,
        screenName: screenRow.screenName,
        isOnline: activeScreenIds.includes(deviceId),
      }}
    />
  );
}
