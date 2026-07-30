import { Suspense } from "react";
import { SheetViewer } from "./_components/SheetViewer";

/**
 * Full-screen spreadsheet viewer, loaded in an iframe as `/display/sheet?src=…`
 * (see mediaEmbedUrl in @platform/types). Parsing happens in the browser rather
 * than through a hosted Office/Google viewer, which would need the file to be
 * reachable from the public internet — a signage server on a LAN isn't.
 */
export default function SheetPage() {
  return (
    <Suspense fallback={null}>
      <SheetViewer />
    </Suspense>
  );
}
