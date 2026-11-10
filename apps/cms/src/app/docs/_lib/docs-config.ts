export type DocHeading = { id: string; text: string };

export type DocPage = {
  slug: string;
  title: string;
  description: string;
  headings: DocHeading[];
};

export type DocSection = {
  label: string;
  pages: DocPage[];
};

const STANDARD_HEADINGS: DocHeading[] = [
  { id: "overview", text: "Overview" },
  { id: "how-to-access", text: "How to Access" },
  { id: "key-capabilities", text: "Key Capabilities" },
];

export const docsNav: DocSection[] = [
  {
    label: "Getting Started",
    pages: [
      {
        slug: "",
        title: "Introduction",
        description: "What this CMS does and how to find your way around.",
        headings: [
          { id: "welcome", text: "Welcome" },
          { id: "how-to-use-these-docs", text: "How to use these docs" },
          { id: "roles", text: "Roles: Admin vs Guest" },
        ],
      },
    ],
  },
  {
    label: "Core Workflow",
    pages: [
      {
        slug: "dashboard",
        title: "Dashboard",
        description: "The home overview screen: uptime, storage, media stats, and recent activity.",
        headings: STANDARD_HEADINGS,
      },
      {
        slug: "broadcast",
        title: "Broadcast / Publish Board",
        description: "Drag-and-drop UI for pushing media and portfolio items live to a screen.",
        headings: STANDARD_HEADINGS,
      },
      {
        slug: "screens",
        title: "Screens & Live Control",
        description: "Register and manage displays, mirror them live, and remote-control touch and audio.",
        headings: STANDARD_HEADINGS,
      },
      {
        slug: "media",
        title: "Media Library",
        description: "Upload, organize, and push media assets to screens.",
        headings: STANDARD_HEADINGS,
      },
      {
        slug: "whiteboards",
        title: "Whiteboards",
        description: "Drawing and annotation boards that can be overlaid live on a screen.",
        headings: STANDARD_HEADINGS,
      },
    ],
  },
  {
    label: "Smart Environment",
    pages: [
      {
        slug: "environment",
        title: "Environment Controls",
        description: "Smart-building IoT control: door locks, lighting, climate, audio zones, and security.",
        headings: STANDARD_HEADINGS,
      },
    ],
  },
  {
    label: "People & Access",
    pages: [
      {
        slug: "visitors",
        title: "Visitors",
        description: "Face-capture visitor log.",
        headings: STANDARD_HEADINGS,
      },
      {
        slug: "settings",
        title: "Settings",
        description: "Who can sign in to Nex, and what they can do.",
        headings: STANDARD_HEADINGS,
      },
      {
        slug: "administration",
        title: "Administration Tools",
        description: "User/role admin, product catalog, and kiosk browsing — not in the main sidebar.",
        headings: [
          { id: "overview", text: "Overview" },
          { id: "users", text: "Users" },
          { id: "products", text: "Products" },
          { id: "browser", text: "Browser" },
        ],
      },
    ],
  },
];

export const flatPages: DocPage[] = docsNav.flatMap((section) => section.pages);

export const pageBySlug: Map<string, DocPage> = new Map(
  flatPages.map((page) => [page.slug, page])
);

export function getDocPath(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}
