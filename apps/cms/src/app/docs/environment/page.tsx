import { DocTitle, DocLead, DocH2, DocP, DocList, DocScreenshot } from "../_components/doc-typography";

export default function DocsEnvironmentPage() {
  return (
    <article>
      <DocTitle>Environment Controls</DocTitle>
      <DocLead>Smart-building IoT control for the space around your screens.</DocLead>

      <DocH2 id="overview">Overview</DocH2>
      <DocP>
        Environment brings smart-building IoT controls into the CMS: door locks, lighting and color,
        climate/AC, audio zones, security, and IR-remote-controlled devices.
      </DocP>

      <DocH2 id="how-to-access">How to Access</DocH2>
      <DocP>
        Available to <strong>Admins</strong> only. Open <strong>Environment</strong> from the sidebar.
      </DocP>
      <DocScreenshot caption="Environment Controls" />

      <DocH2 id="key-capabilities">Key Capabilities</DocH2>
      <DocList>
        <li>Lock and unlock doors.</li>
        <li>Control lighting, including color.</li>
        <li>Adjust climate/AC settings.</li>
        <li>Manage audio zones and security devices.</li>
        <li>Send commands to IR-remote-controlled equipment.</li>
      </DocList>
    </article>
  );
}
