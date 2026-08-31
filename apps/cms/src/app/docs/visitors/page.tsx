import { DocTitle, DocLead, DocH2, DocP, DocList, DocScreenshot } from "../_components/doc-typography";

export default function DocsVisitorsPage() {
  return (
    <article>
      <DocTitle>Visitors</DocTitle>
      <DocLead>A face-capture log of visitors detected by the system.</DocLead>

      <DocH2 id="overview">Overview</DocH2>
      <DocP>
        Visitors keeps a log of visitor captures, each with a photo, for review.
      </DocP>

      <DocH2 id="how-to-access">How to Access</DocH2>
      <DocP>
        Available to <strong>Admins</strong> only. Open <strong>Visitors</strong> from the sidebar.
      </DocP>
      <DocScreenshot caption="Visitors" />

      <DocH2 id="key-capabilities">Key Capabilities</DocH2>
      <DocList>
        <li>Browse a log of captured visitor photos.</li>
      </DocList>
    </article>
  );
}
