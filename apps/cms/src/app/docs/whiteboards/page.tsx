import { DocTitle, DocLead, DocH2, DocP, DocList, DocScreenshot } from "../_components/doc-typography";

export default function DocsWhiteboardsPage() {
  return (
    <article>
      <DocTitle>Whiteboards</DocTitle>
      <DocLead>Drawing and annotation boards that can be overlaid live on a screen.</DocLead>

      <DocH2 id="overview">Overview</DocH2>
      <DocP>
        Whiteboards let you sketch and annotate, then push that board live as an overlay on top of
        whatever a screen is currently displaying.
      </DocP>

      <DocH2 id="how-to-access">How to Access</DocH2>
      <DocP>
        Available to both <strong>Admins</strong> and <strong>Guests</strong>. Open{" "}
        <strong>Whiteboards</strong> from the sidebar.
      </DocP>
      <DocScreenshot caption="Whiteboards" />

      <DocH2 id="key-capabilities">Key Capabilities</DocH2>
      <DocList>
        <li>Create and edit drawing/annotation boards.</li>
        <li>Overlay a whiteboard live on top of a screen&apos;s current content.</li>
      </DocList>
    </article>
  );
}
