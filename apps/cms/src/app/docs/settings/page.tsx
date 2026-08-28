import { DocTitle, DocLead, DocH2, DocP, DocList, DocScreenshot } from "../_components/doc-typography";

export default function DocsSettingsPage() {
  return (
    <article>
      <DocTitle>Settings</DocTitle>
      <DocLead>Experience-type configuration for the CMS.</DocLead>

      <DocH2 id="overview">Overview</DocH2>
      <DocP>
        Settings holds configuration for how experience types behave across the CMS.
      </DocP>

      <DocH2 id="how-to-access">How to Access</DocH2>
      <DocP>
        Available to <strong>Admins</strong> only. Open <strong>Settings</strong> from the sidebar.
      </DocP>
      <DocScreenshot caption="Settings" />

      <DocH2 id="key-capabilities">Key Capabilities</DocH2>
      <DocList>
        <li>Configure experience-type behavior for the CMS.</li>
      </DocList>
    </article>
  );
}
