import { DocTitle, DocLead, DocH2, DocP, DocList } from "./_components/doc-typography";

export default function DocsIntroductionPage() {
  return (
    <article>
      <DocTitle>Introduction</DocTitle>
      <DocLead>
        This is the reference guide for the CMS: what each part of the product does, and how to get to it.
      </DocLead>

      <DocH2 id="welcome">Welcome</DocH2>
      <DocP>
        The CMS is where you manage the screens, content, and smart-building systems tied to your spaces.
        From here you can push media and your interactive portfolio to displays live, manage the devices
        themselves, and control the environment around them.
      </DocP>

      <DocH2 id="how-to-use-these-docs">How to use these docs</DocH2>
      <DocP>
        Each page in the sidebar covers one feature: a short description of what it does, the exact nav
        path or URL you use to reach it, and the required role. Pages are grouped the same way the
        product is organized — core day-to-day workflow first, then content tools, smart-environment
        controls, and administration.
      </DocP>

      <DocH2 id="roles">Roles: Admin vs Guest</DocH2>
      <DocP>Every feature in this CMS is gated to one of two roles:</DocP>
      <DocList>
        <li>
          <strong>Admin</strong> — full access to every feature, including media management, environment
          controls, visitor logs, and settings.
        </li>
        <li>
          <strong>Guest</strong> — a restricted view limited to a handful of day-to-day screens (Dashboard,
          Broadcast, Screens, Whiteboards), toggled from the profile menu as &quot;Guest Mode&quot;.
        </li>
      </DocList>
    </article>
  );
}
