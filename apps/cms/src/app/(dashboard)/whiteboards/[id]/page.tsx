import { notFound } from "next/navigation";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getWhiteboardDocument } from "@/actions/whiteboard-actions";
import { WhiteboardOverlay } from "../../_components/whiteboard/whiteboard-overlay";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Deep link to one saved whiteboard — /whiteboards/<id>. Renders the editor
 * embedded in this page's own content area (sidebar stays visible), as
 * opposed to the FAB's full-screen popup overlay elsewhere in the dashboard —
 * see the "variant" doc on WhiteboardOverlay itself. Reached by opening a
 * saved board from the /whiteboards list, or by leaving a live session (see
 * /whiteboards/[id]/live/[deviceId] — that's where pushing a board to a
 * screen actually lands, per WhiteboardOverlay.handleSelectPushTarget).
 */
export default async function WhiteboardPage({ params }: PageProps) {
  await requireGuestOrAdmin();
  const { id } = await params;

  const doc = await getWhiteboardDocument(id);
  if (!doc) notFound();

  return <WhiteboardOverlay variant="embedded" initialDocumentId={id} />;
}
