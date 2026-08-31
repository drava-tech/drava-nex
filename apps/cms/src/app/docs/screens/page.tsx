import { DocTitle, DocLead, DocH2, DocP, DocList, DocScreenshot } from "../_components/doc-typography";

export default function DocsScreensPage() {
  return (
    <article>
      <DocTitle>Screens & Live Control</DocTitle>
      <DocLead>Register displays, mirror them live, and remote-control touch and audio.</DocLead>

      <DocH2 id="overview">Overview</DocH2>
      <DocP>
        Screens is the device registry for every display connected to the CMS. From a screen&apos;s detail
        page you get a live mirror of what it&apos;s showing, a remote trackpad to control on-screen touch,
        and controls for the device&apos;s system audio — all synced in real time over a WebSocket connection.
      </DocP>

      <DocH2 id="how-to-access">How to Access</DocH2>
      <DocP>
        Available to both <strong>Admins</strong> and <strong>Guests</strong>. Open <strong>Screens</strong>{" "}
        from the sidebar, then select a device to see its live controls.
      </DocP>
      <DocScreenshot caption="Screens & Live Control" />

      <DocH2 id="key-capabilities">Key Capabilities</DocH2>
      <DocList>
        <li>Register and manage every display connected to the CMS.</li>
        <li>Watch a live mirror of exactly what a screen is currently rendering.</li>
        <li>Remote-control touch input on a screen via a virtual trackpad.</li>
        <li>Adjust a device&apos;s system audio remotely.</li>
      </DocList>
    </article>
  );
}
