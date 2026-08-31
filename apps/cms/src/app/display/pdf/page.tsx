import { Suspense } from "react";
import { PdfViewer } from "./_components/PdfViewer";

/**
 * Full-screen PDF viewer, loaded in an iframe as `/display/pdf?src=…` (see
 * mediaEmbedUrl in @platform/types). Rendering happens in the browser via
 * PDF.js rather than through the host browser's built-in viewer, which is a
 * privileged extension desktop Chrome ships but embedded signage engines
 * often omit, refuses to run sandboxed, and exposes no readable scroll
 * position — so it can neither be driven remotely nor resumed where it was
 * left.
 *
 * Scrolls continuously the way a PDF opened in a browser does, rather than
 * paging: it opens at the top, fit to width, with no visible chrome beyond a
 * page counter until someone actually interacts.
 */
export default function PdfPage() {
  return (
    <Suspense fallback={null}>
      <PdfViewer />
    </Suspense>
  );
}
