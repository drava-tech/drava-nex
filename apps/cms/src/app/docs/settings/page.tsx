import { DocTitle, DocLead, DocH2, DocP } from "../_components/doc-typography";

export default function DocsSettingsPage() {
  return (
    <article>
      <DocTitle>Settings</DocTitle>
      <DocLead>Workspace configuration.</DocLead>

      <DocH2 id="overview">Overview</DocH2>
      <DocP>There&apos;s nothing to set up here yet.</DocP>

      <DocH2 id="how-to-access">How to Access</DocH2>
      <DocP>
        Available to <strong>Admins</strong> only. Open <strong>Settings</strong> from the sidebar.
      </DocP>
    </article>
  );
}
