import { Suspense } from "react";
import { SlidesViewer } from "./_components/SlidesViewer";

/**
 * Full-screen slide-deck viewer, loaded in an iframe as `/display/slides?src=…`
 * (see mediaEmbedUrl in @platform/types). Parsing happens in the browser rather
 * than through a hosted Office/Google viewer, which would need the file to be
 * reachable from the public internet — a signage server on a LAN isn't.
 *
 * Navigation is manual only (prev/next overlay + arrow keys) — the deck never
 * advances on its own.
 */
export default function SlidesPage() {
  return (
    <Suspense fallback={null}>
      <SlidesViewer />
    </Suspense>
  );
}
