import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { WhiteboardOverlay } from "../../_components/whiteboard/whiteboard-overlay";

/**
 * Blank whiteboard editor — /whiteboards/new. A static sibling of
 * /whiteboards/[id], so it's matched before the dynamic segment (Next.js
 * prioritizes static routes) instead of falling into getWhiteboardDocument("new")
 * and 404ing. No initialDocumentId is passed, so WhiteboardOverlay starts in
 * its own default blank state ("Untitled Whiteboard", no id) — Save and
 * Push-to-screen both auto-create the document the first time either is used
 * (see WhiteboardOverlay's persistSave / handleSelectPushTarget).
 */
export default async function NewWhiteboardPage() {
  await requireGuestOrAdmin();
  return <WhiteboardOverlay variant="embedded" />;
}
