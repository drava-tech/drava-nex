import { DocTitle, DocLead, DocH2, DocP, DocList, DocScreenshot } from "../_components/doc-typography";

export default function DocsSettingsPage() {
  return (
    <article>
      <DocTitle>Settings</DocTitle>
      <DocLead>Who can sign in to Nex, and what they can do.</DocLead>

      <DocH2 id="overview">Overview</DocH2>
      <DocP>
        Settings is where the super admin adds the people who use Nex and chooses their role.
      </DocP>

      <DocH2 id="how-to-access">How to Access</DocH2>
      <DocP>
        Available to <strong>Admins</strong> only. Open <strong>Settings</strong> from the sidebar.
      </DocP>
      <DocScreenshot caption="Settings" />

      <DocH2 id="key-capabilities">Key Capabilities</DocH2>
      <DocList>
        <li>Add users, change their role or password, and remove them (super admin only).</li>
      </DocList>
    </article>
  );
}
