import { DocTitle, DocLead, DocH2, DocP, DocList, DocScreenshot } from "../_components/doc-typography";

export default function DocsMediaPage() {
  return (
    <article>
      <DocTitle>Media Library</DocTitle>
      <DocLead>Upload, organize, and push media assets to screens.</DocLead>

      <DocH2 id="overview">Overview</DocH2>
      <DocP>
        The Media Library is where images, videos, and linked web content live. Media can be filtered,
        previewed, and queued up to push to one or more screens at once.
      </DocP>

      <DocH2 id="how-to-access">How to Access</DocH2>
      <DocP>
        Available to <strong>Admins</strong> only. Open <strong>Media</strong> from the sidebar.
      </DocP>
      <DocScreenshot caption="Media Library" />

      <DocH2 id="key-capabilities">Key Capabilities</DocH2>
      <DocList>
        <li>Upload and manage image and video assets.</li>
        <li>Add a link (URL) and have its type auto-detected for embedding.</li>
        <li>Preview media before pushing it live.</li>
        <li>Bulk-queue media to push to multiple screens at once.</li>
      </DocList>
    </article>
  );
}
