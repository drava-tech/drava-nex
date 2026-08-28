import { DocTitle, DocLead, DocH2, DocP, DocList, DocScreenshot } from "../_components/doc-typography";

export default function DocsAdministrationPage() {
  return (
    <article>
      <DocTitle>Administration Tools</DocTitle>
      <DocLead>User/role admin, product catalog, and kiosk browsing — not in the main sidebar.</DocLead>

      <DocH2 id="overview">Overview</DocH2>
      <DocP>
        These three tools are fully functional routes that aren&apos;t currently linked from the main
        sidebar. They&apos;re reachable by visiting their URL directly while signed in as an Admin.
      </DocP>

      <DocH2 id="users">Users</DocH2>
      <DocP>
        User and role administration. Available to <strong>Admins</strong> only — not currently linked in
        the sidebar, open it by navigating to <code>/users</code> directly.
      </DocP>
      <DocScreenshot caption="Users" />

      <DocH2 id="products">Products</DocH2>
      <DocP>
        Product catalog CRUD, used by the Product Showcase template. Available to <strong>Admins</strong>{" "}
        only — not currently linked in the sidebar, open it by navigating to <code>/products</code> directly.
      </DocP>
      <DocScreenshot caption="Products" />

      <DocH2 id="browser">Browser</DocH2>
      <DocP>
        Kiosk-style web browsing pushed to a device. Available to <strong>Admins</strong> only — not
        currently linked in the sidebar, open it by navigating to <code>/browser</code> directly.
      </DocP>
      <DocScreenshot caption="Browser" />

      <DocList>
        <li>All three are live, working routes — just not linked from the sidebar today.</li>
      </DocList>
    </article>
  );
}
