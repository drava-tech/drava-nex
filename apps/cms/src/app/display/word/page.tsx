import { Suspense } from "react";
import { WordViewer } from "./_components/WordViewer";

/**
 * Full-screen Word-document viewer, loaded in an iframe as `/display/word?src=…`
 * (see mediaEmbedUrl in @platform/types). Converted to HTML in the browser
 * (mammoth) rather than through a hosted Office/Google viewer, which would
 * require the file to be reachable from the public internet — a signage
 * server on a LAN isn't.
 */
export default function WordPage() {
  return (
    <Suspense fallback={null}>
      <WordViewer />
    </Suspense>
  );
}
