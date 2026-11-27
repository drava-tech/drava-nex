import { DocTitle, DocLead, DocH2, DocP } from "../_components/doc-typography";

export default function DocsSettingsPage() {
  return (
    <article>
      <DocTitle>Settings</DocTitle>
      <DocLead>Appearance and your account.</DocLead>

      <DocH2 id="appearance">Appearance</DocH2>
      <DocP>
        Choose <strong>Dark</strong> or <strong>Day</strong>. The choice is remembered on this device only, and is the
        same switch as the one in the account menu.
      </DocP>

      <DocH2 id="account">Your account</DocH2>
      <DocP>Shows the name, email and role you&apos;re signed in with, and what that role can do.</DocP>

      <DocH2 id="how-to-access">How to Access</DocH2>
      <DocP>
        Available to <strong>Admins</strong> only. Open <strong>Settings</strong> from the sidebar.
      </DocP>
    </article>
  );
}
