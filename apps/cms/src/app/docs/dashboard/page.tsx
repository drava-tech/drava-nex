import { DocTitle, DocLead, DocH2, DocP, DocList, DocScreenshot } from "../_components/doc-typography";

export default function DocsDashboardPage() {
  return (
    <article>
      <DocTitle>Dashboard</DocTitle>
      <DocLead>The home screen — a quick pulse check on the whole system.</DocLead>

      <DocH2 id="overview">Overview</DocH2>
      <DocP>
        The Dashboard is the first thing you see after logging in. It summarizes system uptime, storage
        usage, media stats, and a feed of recent activity across the CMS.
      </DocP>

      <DocH2 id="how-to-access">How to Access</DocH2>
      <DocP>
        Available to both <strong>Admins</strong> and <strong>Guests</strong> — it&apos;s the first screen
        you land on after logging in.
      </DocP>
      <DocScreenshot caption="Dashboard" />

      <DocH2 id="key-capabilities">Key Capabilities</DocH2>
      <DocList>
        <li>See system uptime and storage usage at a glance.</li>
        <li>View media library stats.</li>
        <li>Follow a live feed of recent activity across the CMS.</li>
      </DocList>
    </article>
  );
}
