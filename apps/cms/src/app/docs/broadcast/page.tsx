import { DocTitle, DocLead, DocH2, DocP, DocList, DocScreenshot } from "../_components/doc-typography";

export default function DocsBroadcastPage() {
  return (
    <article>
      <DocTitle>Broadcast / Publish Board</DocTitle>
      <DocLead>Push media and experiences live to a screen with a drag-and-drop board.</DocLead>

      <DocH2 id="overview">Overview</DocH2>
      <DocP>
        The Broadcast page is a &quot;swipe to publish&quot; board: drag media or an experience onto a target
        screen to push it live. It also opens a live control view for a device, so you can watch what a
        screen is showing in real time.
      </DocP>

      <DocH2 id="how-to-access">How to Access</DocH2>
      <DocP>
        Available to both <strong>Admins</strong> and <strong>Guests</strong>. Open{" "}
        <strong>Broadcast</strong> from the sidebar, then drag content onto a screen to publish it live.
      </DocP>
      <DocScreenshot caption="Broadcast / Publish Board" />

      <DocH2 id="key-capabilities">Key Capabilities</DocH2>
      <DocList>
        <li>Drag-and-drop content directly onto a screen to publish it live.</li>
        <li>Open a live mirror of a specific device to confirm what is currently showing.</li>
        <li>Available to Guest-mode users for day-to-day content pushes.</li>
      </DocList>
    </article>
  );
}
