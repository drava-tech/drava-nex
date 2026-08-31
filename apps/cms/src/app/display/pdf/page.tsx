import { Suspense } from "react";
import { PdfViewer } from "./_components/PdfViewer";

/**
 * Full-screen PDF viewer, loaded in an iframe as `/display/pdf?src=…` (see
 * mediaEmbedUrl in @platform/types). Rendering happens in the browser via
 * PDF.js rather than through the host browser's built-in viewer, which is a
 * privileged extension desktop Chrome ships but embedded signage engines
 * often omit, refuses to run sandboxed, and exposes no readable page/zoom
 * state — so it can neither be driven remotely (a screen with no native
 * agent has no other way to zoom) nor resumed where it was left.
 *
 * Defaults to exactly what the built-in viewer showed before: page 1, fit to
 * width, no visible chrome until someone actually interacts.
 */
export default function PdfPage() {
  return (
    <Suspense fallback={null}>
      <PdfViewer />
    </Suspense>
  );
}
